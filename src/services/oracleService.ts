import {
  EnclaveInfo,
  OracleClient,
  type AttestationResponse,
} from '@venture23-aleo/aleo-oracle-sdk';
import { createWriteStream, existsSync, mkdirSync, type WriteStream } from 'node:fs';
import axios from 'axios';
import {
  executeLeoWithQueue,
  extractTransactionId,
  type LeoExecutionResult,
} from '@utils/leoExecutor.js';
import { log, logDebug, logError, logWarn } from '@utils/logger.js';
import { discordNotifier } from '@utils/discordNotifier.js';
import { cronConfig, oracleConfig } from '@configs/index.js';
import { retry } from '@utils/pRetry.js';
import { CronJob, validateCronExpression } from 'cron';

/**
 * Oracle configuration
 * @type {OracleConfig}
 */
const {
  notarizer: NOTARIZER_CONFIG,
  verifer: VERIFIER_CONFIG,
  supportedCoins: COIN_LIST,
  aleoProgram: {
    function: {
      setUniqueId: SET_UNIQUE_ID_FUNCTION_NAME,
      setPublicKey: SET_PUBLIC_KEY_FUNCTION_NAME,
      setSgxData: SET_SGX_DATA_FUNCTION_NAME,
    },
  },
} = oracleConfig;

/**
 * Coin price data
 * @interface CoinPriceData
 */
interface CoinPriceData {
  /** The name of the coin */
  coinName: string;
  /** The timestamp of the price update */
  timestamp: number;
  /** The price of the coin */
  price: string;
}

/**
 * SGX data result
 * @interface SgxDataResult
 */
interface SgxDataResult {
  /** The name of the coin */
  coinName: string;
  /** The transaction ID */
  txnId: string | null;
  /** The error message */
  errorMsg: string | null;
}

/**
 * Coin statistics
 * @interface CoinStats
 */
interface CoinStats {
  /** The total number of runs */
  totalRuns: number;
  /** The number of successful runs */
  successfulRuns: number;
  /** The number of failed runs */
  failedRuns: number;
  /** The last run */
  lastRun: Date | null;
  /** The last success */
  lastSuccess: Date | null;
  /** The last error */
  lastError: Date | null;
  /** Whether the cron is enabled */
  cronEnabled: boolean;
  /** The cron schedule */
  cronSchedule: string;
}

/**
 * Service statistics
 * @interface ServiceStats
 */
interface ServiceStats {
  /** The uptime of the service */
  uptime: number;
  /** The memory usage of the service */
  memory: NodeJS.MemoryUsage;
  /** The cron job status */
  cronJob: Record<string, CoinStats | null>;
}

export interface OracleServiceInterface {
  /** Whether the service is initialized */
  isInitialized: boolean;
  /** Initialize the service */
  initialize(): Promise<void>;
  /** Set the SGX unique ID */
  setSgxUniqueId(): Promise<any>;
  /** Set the public key */
  setPublicKey(): Promise<any>;
  /** Set the SGX data */
  setSgxData(coinName: string): Promise<any>;
  /** Start the cron job */
  startCronJob(coinName?: string | null): void;
  /** Stop the cron job */
  stopCronJob(coinName?: string | null): void;
  /** Get the cron job status */
  getCronJobStatus(coinName?: string | null): any;
  /** Handle the price update cron */
  handlePriceUpdateCron(coinName?: string | null): Promise<any>;
  /** Get the stats */
  getStats(): any;
}

export class OracleService implements OracleServiceInterface {
  private oracleClient: OracleClient;
  public isInitialized: boolean;
  private stats: Record<string, CoinStats | null>;
  private cronJob: Record<string, CronJob | null>;
  private coinPriceStream: Record<string, WriteStream>;

  constructor() {
    this.oracleClient = new OracleClient({
      notarizer: NOTARIZER_CONFIG,
      verifier: VERIFIER_CONFIG,
      quiet: false,
    });

    // Initialize flag
    this.isInitialized = false;

    // Statistics
    this.stats = {};
    this.cronJob = {};
    this.coinPriceStream = {};
  }

  /**
   * Initialize the service
   * @returns The service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      log('Initializing Oracle Service...');

      // Ensure the 'prices' directory exists before creating coin tracking files
      const pricesDir = './prices';
      if (!existsSync(pricesDir)) {
        logDebug(`'${pricesDir}' directory does not exist. Creating...`);
        try {
          mkdirSync(pricesDir, { recursive: true });
          log(`Created '${pricesDir}' directory for price tracking files.`);
        } catch (err) {
          logError(`Failed to create '${pricesDir}' directory:`, err);
          throw err;
        }
      }

      // Create coin tracking files
      for (const coin of COIN_LIST) {
        const filePath = `${pricesDir}/${coin.toLowerCase()}_price.txt`;
        this.coinPriceStream[coin] = createWriteStream(filePath, { flags: 'a' });
        logDebug(`Price tracking file stream created for ${coin}: ${filePath}`);
      }

      this.isInitialized = true;
      log('Oracle Service initialized successfully');

      this.startCronJob();
    } catch (error) {
      logError('Failed to initialize Oracle Service', error as Error);
      await discordNotifier.sendErrorAlert(error as Error, {
        operation: 'initialize',
        coins: COIN_LIST,
      });
      throw error;
    }
  }

  /**
   * Build the attestation request
   * @param coinName - The name of the coin
   * @returns The attestation request
   */
  buildAttestationRequest(coinName: string): any {
    const attestationRequest = oracleConfig.attestationRequest;
    attestationRequest.url = `price_feed: ${coinName.toLowerCase()}`;
    return attestationRequest;
  }

  /**
   * Helper to request the notarizer backend using axios.request for both GET and POST.
   * @param endpoint - API endpoint (e.g. '/notarize')
   * @param method - HTTP method ('get' or 'post')
   * @param payload - Data to send (for POST), or query params (for GET)
   * @returns Axios response
   */
  requestNotarizer = async (endpoint: string, method: 'get' | 'post' = 'post', payload?: any) => {
    const protocol = NOTARIZER_CONFIG.https ? 'https' : 'http';
    const url = `${protocol}://${NOTARIZER_CONFIG.address}:${NOTARIZER_CONFIG.port}${endpoint}`;
    logDebug(
      `[requestNotarizer] ${method.toUpperCase()} ${url} with payload: ${JSON.stringify(payload)}`
    );
    try {
      const response = await axios.request({
        url,
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        ...(method === 'get' ? { params: payload } : { data: payload }),
      });
      logDebug(`[requestNotarizer] Response from ${url}: ${JSON.stringify(response.data)}`);
      return response.data;
    } catch (error) {
      logError(`[requestNotarizer] Error requesting ${url}:`, error);
      throw error;
    }
  };

  /**
   * Helper to request the verifier backend using axios.request for both GET and POST.
   * @param endpoint - API endpoint (e.g. '/notarize')
   * @param method - HTTP method ('get' or 'post')
   * @param payload - Data to send (for POST), or query params (for GET)
   * @returns Axios response
   */
  requestVerifier = async (endpoint: string, method: 'get' | 'post' = 'post', payload?: any) => {
    const protocol = VERIFIER_CONFIG.https ? 'https' : 'http';
    const url = `${protocol}://${VERIFIER_CONFIG.address}:${VERIFIER_CONFIG.port}${endpoint}`;
    logDebug(
      `[requestVerifier] ${method.toUpperCase()} ${url} with payload: ${JSON.stringify(payload)}`
    );
    try {
      const response = await axios.request({
        url,
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        ...(method === 'get' ? { params: payload } : { data: payload }),
      });
      logDebug(`[requestVerifier] Response from ${url}: ${JSON.stringify(response.data)}`);
      return response.data;
    } catch (error) {
      logError(`[requestVerifier] Error requesting ${url}:`, error);
      throw error;
    }
  };

  /**
   * Track the coin price
   * @param coinName - The name of the coin
   * @param timestamp - The timestamp of the price update
   * @param price - The price of the coin
   */
  async trackCoinPrice({ coinName, timestamp, price }: CoinPriceData): Promise<void> {
    try {
      (this.coinPriceStream[coinName] as WriteStream).write(`${timestamp} ${price}\n`);
    } catch (error) {
      logError(`Error tracking the ${coinName} price`, error as Error);
      await discordNotifier.sendErrorAlert(error as Error, {
        operation: 'trackCoinPrice',
        coinName,
        timestamp,
      });
    }
  }

  async getEnclaveInfo(): Promise<EnclaveInfo> {
    const enclavesInfo: EnclaveInfo[] = await retry({
      func: () => this.oracleClient.enclavesInfo(),
      label: 'ENCLAVES_INFO',
      retries: 3,
    });
    if (!enclavesInfo.length) {
      throw new Error('Enclave info not found');
    }
    return enclavesInfo[0]!;
  }

  async compareSgxUniqueId(uniqueId: string): Promise<boolean> {
    const enclaveInfo = await this.getEnclaveInfo();
    const aleoInfo = enclaveInfo.info.aleo;

    // Type guard to check if aleoInfo has uniqueId property
    if ('uniqueId' in aleoInfo) {
      return uniqueId === aleoInfo.uniqueId;
    }

    throw new Error('Enclave info does not contain uniqueId');
  }

  /**
   * Set the SGX unique ID
   * @returns The success, unique ID, and transaction ID
   */
  async setSgxUniqueId(): Promise<{ success: boolean; uniqueId: string; transactionId: string }> {
    const requestString = '[setSgxUniqueId]';
    try {
      log(`${requestString} Setting SGX unique id in aleo program...`);
      const enclaveInfo = await this.getEnclaveInfo();

      const aleoInfo = enclaveInfo.info.aleo;

      // Type guard to check if aleoInfo has uniqueId property
      if (!('uniqueId' in aleoInfo)) {
        throw new Error('Enclave info does not contain uniqueId');
      }

      const { uniqueId } = aleoInfo;

      log(`${requestString} SGX Unique Id: ${uniqueId}`);

      const leoResult = await executeLeoWithQueue({
        inputs: [uniqueId],
        label: 'SET_SGX_UNIQUE_ID',
        functionName: SET_UNIQUE_ID_FUNCTION_NAME,
      });

      const transactionId = extractTransactionId(leoResult as LeoExecutionResult);
      if (transactionId) {
        log(`${requestString} Transaction ID: ${transactionId}`);

        // Send success notification with transaction details
        await discordNotifier.sendTransactionAlert('sgx_unique_id', transactionId, 'confirmed', {
          uniqueId,
        });
      } else {
        throw new Error('Transaction ID not found in leo output.');
      }

      return { success: true, uniqueId, transactionId };
    } catch (error) {
      logError(`${requestString} error setting unique id`, error as Error);
      await discordNotifier.sendErrorAlert(error as Error, {
        operation: 'setSgxUniqueId',
        requestString,
      });
      throw error;
    }
  }

  /**
   * Set the public key
   * @returns The success, signer public key, and transaction ID
   */
  async setPublicKey(): Promise<{ success: boolean; signerPubKey: string; transactionId: string }> {
    const requestString = '[setPublicKey]';
    try {
      log(`${requestString} Setting public key in aleo program`);
      const enclaveInfo = await this.getEnclaveInfo();

      const { signerPubKey } = enclaveInfo;
      log(`${requestString} Signer Public key: ${signerPubKey}`);

      const leoResult = await executeLeoWithQueue({
        inputs: [signerPubKey, 'true'],
        label: 'SET_SGX_PUBLIC_KEY',
        functionName: SET_PUBLIC_KEY_FUNCTION_NAME,
      });

      const transactionId = extractTransactionId(leoResult as LeoExecutionResult);
      if (transactionId) {
        log(`${requestString} Transaction ID: ${transactionId}`);

        // Send success notification with transaction details
        await discordNotifier.sendTransactionAlert('sgx_public_key', transactionId, 'confirmed', {
          signerPubKey,
        });
      } else {
        throw new Error('Transaction ID not found in leo output.');
      }

      return { success: true, signerPubKey, transactionId };
    } catch (error) {
      logError(`${requestString} error setting public key`, error as Error);
      await discordNotifier.sendErrorAlert(error as Error, {
        operation: 'setPublicKey',
        requestString,
      });
      throw error;
    }
  }

  /**
   * Set the SGX data
   * @param coinName - The name of the coin
   * @returns The coin name, transaction ID, and error message
   */
  async setSgxData(coinName: string): Promise<SgxDataResult> {
    const requestString = `[setSgxData:${coinName}]`;
    try {
      const attestationRequest = this.buildAttestationRequest(coinName);
      logDebug(`${requestString} Attestation Request: ${JSON.stringify(attestationRequest)}`);

      let result: AttestationResponse | null = null;

      if (oracleConfig.verifyAttestation) {
        const notarizeResult = await this.oracleClient.notarize(attestationRequest);
        logDebug(`[setSgxData] Attestation result: ${JSON.stringify(notarizeResult)}`);
        if (!notarizeResult || notarizeResult.length === 0) {
          throw new Error("No attestation response received");
        }
        result = notarizeResult[0]!;
      } else {
        result = await this.requestNotarizer('/notarize', 'post', attestationRequest);
      }

      logDebug(`[setSgxData] Attestation result: ${JSON.stringify(result)}`);

      const {
        oracleData: { report, userData, signature, address, requestHash },
        timestamp,
        attestationData,
      } = result as AttestationResponse;

      logDebug(`${requestString} Attestation data: ${attestationData}`);
      await this.trackCoinPrice({ coinName, timestamp, price: attestationData });

      const leoResult = await executeLeoWithQueue({
        inputs: [userData, report, signature, address],
        functionName: SET_SGX_DATA_FUNCTION_NAME,
        label: `SET_SGX_DATA:${coinName}`,
      });

      const transactionId = extractTransactionId(leoResult as LeoExecutionResult);
      if (transactionId) {
        log(`${requestString} Transaction ID: ${transactionId}`);

        // Send success notification with transaction details
        await discordNotifier.sendTransactionAlert(coinName, transactionId, 'confirmed', {
          price: attestationData,
          requestHash,
          timestamp,
        });

        return { coinName, txnId: transactionId, errorMsg: null };
      } else {
        throw new Error('Transaction ID not found in leo output.');
      }
    } catch (error) {
      logError(`${requestString} error setting sgx data`, error as Error);

      // Send error notification
      await discordNotifier.sendPriceUpdateAlert(coinName, 'failed', null, error as Error);

      const err = new Error('Error setting the sgx data');
      (err as any).data = { coinName, txnId: null, errorMsg: (error as Error)?.message };
      throw err;
    }
  }

  /**
   * Handle the price update cron
   * @param coinName - The name of the coin
   * @returns The void
   */
  async handlePriceUpdateCron(coinName: string): Promise<SgxDataResult | null> {
    if (!this.stats[coinName]) {
      this.stats[coinName] = {
        totalRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
        lastRun: null,
        lastSuccess: null,
        lastError: null,
        cronEnabled: true,
        cronSchedule: cronConfig.tokens[coinName]?.schedule || '',
      };
    }

    this.stats[coinName].totalRuns++;
    this.stats[coinName].lastRun = new Date();

    const startTime = Date.now();
    logDebug(
      `Starting price update cycle ${this.stats[coinName].totalRuns} for coins: ${coinName}`
    );

    // Send started notification
    await discordNotifier.sendCronJobAlert('price_update', 'started', null, null);

    let successCount = 0;
    let errorCount = 0;

    let response: SgxDataResult | null = null;

    const coinStartTime = Date.now();
    try {
      log(`Updating ${coinName} price...`);

      response = await this.setSgxData(coinName);

      const coinDuration = Date.now() - coinStartTime;
      log(`Successfully updated ${coinName} price in ${coinDuration}ms`);
      successCount++;
    } catch (err) {
      const coinDuration = Date.now() - coinStartTime;
      logError(`Failed to update ${coinName} price after ${coinDuration}ms`, err as Error);
      errorCount++;
      response = (err as any)?.data as SgxDataResult;
    }
    const duration = Date.now() - startTime;

    if (errorCount === 0) {
      this.stats[coinName].successfulRuns++;
      this.stats[coinName].lastSuccess = new Date();
      logDebug(
        `Price update cycle ${this.stats[coinName].totalRuns} completed successfully in ${duration}ms`
      );

      // Send success notification
      await discordNotifier.sendCronJobAlert('price_update', 'success', null, duration);
    } else {
      this.stats[coinName].failedRuns++;
      this.stats[coinName].lastError = new Date();
      logWarn(
        `Price update cycle ${this.stats[coinName].totalRuns} completed with ${errorCount} errors in ${duration}ms`
      );

      // Send failure notification
      await discordNotifier.sendCronJobAlert(
        'price_update',
        'failed',
        new Error(`${errorCount} coins failed to update`),
        duration
      );
    }

    return response;
  }

  /**
   * Start the cron job
   * @param coinName - The name of the coin
   * @returns The void
   */
  startCronJob(coinName?: string | null): void {
    const coins = coinName ? [coinName] : COIN_LIST;
    for (const coin of coins) {
      if (this.cronJob[coin]) {
        log(`Cron job for ${coin} already running`);
        continue;
      }

      if (cronConfig.tokens[coin]?.enabled) {
        log(
          `Starting cron job for ${coin} with schedule ${JSON.stringify(cronConfig.tokens[coin].schedule)}`
        );

        const cronSchedule = cronConfig.tokens[coin].schedule;
        if (!validateCronExpression(cronSchedule)) {
          log(`Invalid cron schedule for ${coin}: ${cronSchedule}`);
          continue;
        }

        this.stats[coin] = {
          totalRuns: 0,
          successfulRuns: 0,
          failedRuns: 0,
          lastRun: null,
          lastSuccess: null,
          lastError: null,
          cronEnabled: true,
          cronSchedule: cronConfig.tokens[coin].schedule,
        };

        this.cronJob[coin] = CronJob.from({
          name: `FetchCoinPrice-${coin}`,
          cronTime: cronConfig.tokens[coin].schedule,
          onTick: async () => {
            await this.handlePriceUpdateCron(coin);
          },
          errorHandler: async (error: unknown) => {
            logError('[CronError]', error as Error);
            if (this.stats[coin]) {
              this.stats[coin].lastError = new Date();
            }
            // Send Discord notification for cron error
            await discordNotifier.sendCronJobAlert('price_update', 'failed', error as Error);
          },
        });

        this.cronJob[coin]!.start();

        log(
          `Cron job for ${coin} started - fetching coin prices every ${cronConfig.tokens[coin].schedule}`
        );
      }
    }
  }

  /**
   * Stop the cron job
   * @param coinName - The name of the coin
   * @returns The void
   */
  stopCronJob(coinName?: string | null): void {
    const coins = coinName ? [coinName] : COIN_LIST;
    for (const coin of coins) {
      if (this.cronJob[coin]) {
        try {
          log(`🛑 Stopping cron job for ${coin}`);
          this.cronJob[coin]!.stop();
          this.cronJob[coin] = null;
          this.stats[coin] = null;
          log(`Cron job for ${coin} stopped`);
          // Send Discord notification for cron job stop
          discordNotifier.sendServiceStatusAlert('Cron Job', 'offline', {
            coinName: coin,
          });
        } catch (error) {
          logError(`Error stopping cron job for ${coin}`, error as Error);
          discordNotifier.sendErrorAlert(error as Error, {
            operation: 'stopCronJob',
            coinName: coin,
          });
        }
      }
    }
  }

  /**
   * Get the cron job status
   * @param coinName - The name of the coin
   * @returns The cron job status
   */
  getCronJobStatus(coinName?: string | null): Record<string, CoinStats | null> {
    const coins = coinName ? [coinName] : COIN_LIST;
    const status: Record<string, CoinStats | null> = {};
    for (const coin of coins) {
      status[coin] = this.stats[coin] || null;
    }
    return status;
  }

  /**
   * Get the service statistics
   * @returns The service statistics
   */
  getStats(): ServiceStats {
    return {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cronJob: this.stats,
    };
  }
}
