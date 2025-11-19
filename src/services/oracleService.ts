import {
  EnclaveInfo,
  OracleClient,
  type AttestationResponse,
} from '@venture23-aleo/aleo-oracle-sdk';
import { createWriteStream, existsSync, mkdirSync, readFileSync, type WriteStream } from 'node:fs';
import axios from 'axios';
import {
  delegateAleoTransaction,
  executeLeoWithQueue,
  extractTransactionId,
  type LeoExecutionResult,
} from '@utils/leoExecutor.js';
import { log, logDebug, logError, logWarn } from '@utils/logger.js';
import { discordNotifier } from '@utils/discordNotifier.js';
import { periodicPriceUpdateCronConfig, deviationBasedPriceUpdateCronConfig, oracleConfig } from '@configs/index.js';
import { retry } from '@utils/pRetry.js';
import { CronJob, validateCronExpression } from 'cron';
import z from 'zod';

/**
 * Oracle configuration
 * @type {OracleConfig}
 */
const {
  notarizers,
  verifier,
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
  cronJobs: {
    periodic: Record<string, CoinStats | null>;
    deviation: Record<string, CoinStats | null>;
  };
}

interface SetSgxDataParams {
  coinName: string;
  checkDeviation: boolean;
}

export interface OracleServiceInterface {
  /** Whether the service is initialized */
  isInitialized: boolean;
  /** Initialize the service */
  initialize(): Promise<void>;
  /** Set the SGX unique ID */
  // setSgxUniqueId(uniqueId: string): Promise<any>;
  // /** Set the public key */
  // setSignerPublicKey(publicKey: string): Promise<any>;

  /** Get the attestation report */
  getAttestationReport(coinName: string): Promise<AttestationResponse>;
  /** Prepare the attestation report for verulend */
  prepareAttestationReportForVerulend(): Promise<AttestationResponse[]>;
  /** Set the SGX data */
  setSgxData(params: SetSgxDataParams): Promise<any>;
  /** Start the price update cron job */
  startCronJob(coinName?: string | null): void;
  /** Stop the price update cron job */
  stopCronJob(coinName?: string | null): void;
  /** Get the cron job stats */
  getCronJobStats(coinName?: string | null): any;
  /** Handle the price update cron */
  handlePeriodicPriceUpdateCron(coinName?: string | null): Promise<any>;
  /** Handle the deviation based price update cron */
  handleDeviationBasedPriceUpdateCron(coinName?: string | null): Promise<any>;
  /** Start the periodic price update cron */
  startPeriodicPriceUpdateCron(coinName?: string | null): void;
  /** Stop the periodic price update cron */
  stopPeriodicPriceUpdateCron(coinName?: string | null): void;
  /** Start the deviation based price update cron */
  startDeviationBasedPriceUpdateCron(coinName?: string | null): void;
  /** Stop the deviation based price update cron */
  stopDeviationBasedPriceUpdateCron(coinName?: string | null): void;
  /** Get the stats */
  getStats(): any;
}

export class OracleService implements OracleServiceInterface {
  // private oracleClient: OracleClient;
  public isInitialized: boolean;
  private periodicPriceUpdateStats: Record<string, CoinStats | null>;
  private deviationPriceUpdateStats: Record<string, CoinStats | null>;
  private periodicPriceUpdateCronJob: Record<string, CronJob | null>;
  private deviationPriceUpdateCronJob: Record<string, CronJob | null>;
  private coinPriceStream: Record<string, WriteStream>;


  constructor() {
    // Initialize flag
    this.isInitialized = false;

    // Statistics
    this.periodicPriceUpdateStats = {};
    this.deviationPriceUpdateStats = {};
    this.periodicPriceUpdateCronJob = {};
    this.deviationPriceUpdateCronJob = {};
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
    const notarizerInfo = notarizers[0];
    const protocol = notarizerInfo!.https ? 'https' : 'http';
    const url = `${protocol}://${notarizerInfo!.address}:${notarizerInfo!.port}${endpoint}`;
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
    const protocol = verifier.https ? 'https' : 'http';
    const url = `${protocol}://${verifier.address}:${verifier.port}${endpoint}`;
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

  /**
   * Set the SGX unique ID
   * @returns The success, unique ID, and transaction ID
   */
  // async setSgxUniqueId(uniqueId: string): Promise<{ success: boolean; uniqueId: string; transactionId: string }> {
  //   const requestString = '[setSgxUniqueId]';
  //   try {

  //     log(`${requestString} SGX Unique Id: ${uniqueId}`);

  //     const leoResult = await executeLeoWithQueue({
  //       inputs: [uniqueId],
  //       label: 'SET_SGX_UNIQUE_ID',
  //       functionName: SET_UNIQUE_ID_FUNCTION_NAME,
  //     });

  //     const transactionId = extractTransactionId(leoResult as LeoExecutionResult);
  //     if (transactionId) {
  //       log(`${requestString} Transaction ID: ${transactionId}`);
  //       // Send success notification with transaction details
  //       await discordNotifier.sendTransactionAlert('sgx_unique_id', transactionId, 'confirmed', {
  //         uniqueId,
  //       });
  //     } else {
  //       throw new Error('Transaction ID not found in leo output.');
  //     }

  //     return { success: true, uniqueId, transactionId };
  //   } catch (error) {
  //     logError(`${requestString} error setting unique id`, error as Error);
  //     await discordNotifier.sendErrorAlert(error as Error, {
  //       operation: 'setSgxUniqueId',
  //       requestString,
  //     });
  //     throw error;
  //   }
  // }

  /**
   * Set the public key
   * @returns The success, signer public key, and transaction ID
   */
  // async setSignerPublicKey(signerPubKey: string): Promise<{ success: boolean; signerPubKey: string; transactionId: string }> {
  //   const requestString = '[setSignerPublicKey]';
  //   try {

  //     const leoResult = await executeLeoWithQueue({
  //       inputs: [signerPubKey, 'true'],
  //       label: 'SET_SGX_PUBLIC_KEY',
  //       functionName: SET_PUBLIC_KEY_FUNCTION_NAME,
  //     });

  //     const transactionId = extractTransactionId(leoResult as LeoExecutionResult);
  //     if (transactionId) {
  //       log(`${requestString} Transaction ID: ${transactionId}`);

  //       // Send success notification with transaction details
  //       await discordNotifier.sendTransactionAlert('sgx_public_key', transactionId, 'confirmed', {
  //         signerPubKey,
  //       });
  //     } else {
  //       throw new Error('Transaction ID not found in leo output.');
  //     }

  //     return { success: true, signerPubKey, transactionId };
  //   } catch (error) {
  //     logError(`${requestString} error setting public key`, error as Error);
  //     await discordNotifier.sendErrorAlert(error as Error, {
  //       operation: 'setSignerPublicKey',
  //       requestString,
  //     });
  //     throw error;
  //   }
  // }

  shuffleNotarizers(): typeof notarizers {
    const shuffled = [...notarizers];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }

    logDebug(`Shuffled notarizers: ${JSON.stringify(shuffled)}`);
    return shuffled;
  }

  checkTokenPriceDeviation(coinName: string, currentPrice: number, lastPriceData: { price: number; timestamp: number }): boolean {
    const requestString = `[checkDeviationBasedPriceUpdateCron:${coinName}]`;
    // Calculate deviation percentage
    const deviationThreshold = deviationBasedPriceUpdateCronConfig.tokens[coinName]?.deviation || 0;
    const priceDifference = Math.abs(currentPrice - lastPriceData.price);
    const deviationPercentage = (priceDifference / lastPriceData.price) * 100;

    logDebug(
      `${requestString} Last price: ${lastPriceData.price}, Current price: ${currentPrice}, Deviation: ${deviationPercentage.toFixed(2)}%, Threshold: ${deviationThreshold}%`
    );

    // Check if deviation exceeds threshold
    if (deviationPercentage >= deviationThreshold) {
      log(
        `${requestString} Deviation ${deviationPercentage.toFixed(2)}% exceeds threshold ${deviationThreshold}%, updating price...`
      );
      return true;
    }

    return false;
  }

  async getAttestationReport(coinName: string): Promise<AttestationResponse> {
    const requestString = `[getAttestationReport:${coinName}]`;
    let result: AttestationResponse | null = null;
    try {
      const attestationRequest = this.buildAttestationRequest(coinName);
      logDebug(`${requestString} Attestation Request: ${JSON.stringify(attestationRequest)}`);
      const shuffledNotarizers = this.shuffleNotarizers();
      let success = false;
      let errorMsg: string | null = null;

      while (shuffledNotarizers.length > 0 && !success) {
        try {
          const randomlySelectedIndex = Math.floor(Math.random() * shuffledNotarizers.length);

          const selectedNotarizer = shuffledNotarizers[randomlySelectedIndex];

          shuffledNotarizers.splice(randomlySelectedIndex, 1);

          logDebug(`${requestString} Selected Notarizer: ${JSON.stringify(selectedNotarizer)}`);

          const oracleClient = new OracleClient({
            notarizer: selectedNotarizer!,
            // @ts-expect-error TODO: to add mtls cert 
            verifier: oracleConfig.verifier!,
            quiet: false,
          })

          const notarizeResult = await oracleClient.notarize(attestationRequest);
          // logDebug(`[setSgxData] Attestation result: ${JSON.stringify(notarizeResult)}`);

          if (!notarizeResult || notarizeResult.length === 0) {
            errorMsg = `No notarization result received for ${coinName}`;
            throw new Error(errorMsg);
          }

          success = true;

          result = notarizeResult[0] as AttestationResponse;

          break;
        } catch (error) {
          logError(`${requestString} error getting attestation report`, error as Error);
          success = false;
          logError(`${requestString} ${errorMsg}`);
          log(`${requestString} Trying next notarizer...`);
        }
      }
    } catch (error) {
      logError(`${requestString} error getting attestation report`, error as Error);
      // await discordNotifier.sendErrorAlert(error as Error, {
      //   operation: 'getAttestationReport',
      //   coinName,
      // });
      throw error;
    }

    if (!result) {
      throw new Error(`No attestation report received for ${coinName}`);
    }

    return result as AttestationResponse;
  }


  async prepareAttestationReportForVerulend(): Promise<AttestationResponse[]> {
    const requestString = `[prepareAttestationReportForVerulend]`;
    try {

      const tokens = ['ALEO', 'USDC', 'USDT'];
      const responses: AttestationResponse[] = [];

      for (const token of tokens) {
        const result = await this.getAttestationReport(token);
        logDebug(`${requestString} Attestation report for ${token}: ${JSON.stringify(result)}`);
        responses.push(result);
      }

      return responses;
    } catch (error) {
      logError(`${requestString} error preparing attestation report for verulend`, error as Error);
      throw error;
    }
  }

  /**
   * Set the SGX data
   * @param coinName - The name of the coin
   * @returns The coin name, transaction ID, and error message
   */
  async setSgxData({ coinName, checkDeviation = false }: SetSgxDataParams): Promise<SgxDataResult> {
    const requestString = `[setSgxData:${coinName}]`;
    try {
      let success = false;

      let response = null;

      let errorMsg = null;

      while (!success) {
        try {
          const result = await this.getAttestationReport(coinName);
          const {
            oracleData: { report, userData, signature, address, requestHash },
            timestamp,
            attestationData,
          } = result;

          logDebug(`${requestString} Attestation data: ${attestationData}`);
          await this.trackCoinPrice({ coinName, timestamp, price: attestationData });

          let shouldUpdatePrice = true;

          if (checkDeviation) {
            shouldUpdatePrice = this.checkTokenPriceDeviation(coinName, parseFloat(attestationData), this.getLastTrackedPrice(coinName) as { price: number; timestamp: number });
          }

          if (!shouldUpdatePrice) {
            success = true;
            continue;
          }

          const leoResult = await delegateAleoTransaction({
            inputs: [userData, report, signature, address],
            functionName: SET_SGX_DATA_FUNCTION_NAME,
            label: `SET_SGX_DATA:${coinName}`,
          });

          const transactionId = extractTransactionId(leoResult as LeoExecutionResult);
          if (transactionId) {
            log(`${requestString} Transaction ID: ${transactionId}`);

            // Send success notification with transaction details
            await discordNotifier.sendTransactionAlert(coinName, transactionId, 'confirmed', {
              enclaveUrl: result.enclaveUrl,
              price: attestationData,
              requestHash,
              timestamp,
            });

            success = true;

            response = { coinName, txnId: transactionId, errorMsg: null }
          } else {
            errorMsg = `Transaction ID not found in leo output for ${coinName} with error ${leoResult?.errorOutput}`;
            throw new Error(errorMsg);
          }
          
        } catch (error) {
          if (!errorMsg) {
            errorMsg = (error as Error).message;
          }
          success = false;
          logError(`${requestString} ${errorMsg}`);
          log(`${requestString} Trying next notarizer...`);
        }
      }

      if(!success) {
        throw new Error(errorMsg as string);
      }

      return response as SgxDataResult;

    } catch (error) {
      logError(`${requestString} error setting sgx data`, error as Error);

      // Send error notification
      // await discordNotifier.sendPriceUpdateAlert(coinName, 'failed', null, error as Error);
      await discordNotifier.sendErrorAlert(error as Error, {
        operation: 'setSgxData',
        coinName,
      });

      const err = new Error('Error setting the sgx data');
      (err as any).data = { coinName, txnId: null, errorMsg: (error as Error)?.message };
      throw err;
    }
  }

  /**
   * Get the last tracked price for a coin
   * @param coinName - The name of the coin
   * @returns The last price and timestamp, or null if not found
   */
  getLastTrackedPrice(coinName: string): { price: number; timestamp: number } | null {
    try {
      const filePath = `./ prices / ${coinName.toLowerCase()} _price.txt`;
      if (!existsSync(filePath)) {
        logDebug(`Price file not found for ${coinName}: ${filePath} `);
        return null;
      }

      const fileContent = readFileSync(filePath, 'utf-8');
      const lines = fileContent.trim().split('\n').filter((line) => line.trim());

      if (lines.length === 0) {
        logDebug(`No price data found for ${coinName}`);
        return null;
      }

      // Get the last line (most recent price)
      const lastLine = lines[lines.length - 1]!.trim();
      const [timestampStr, priceStr] = lastLine.split(' ');

      if (!timestampStr || !priceStr) {
        logWarn(`Invalid price data format for ${coinName}: ${lastLine} `);
        return null;
      }

      const timestamp = parseInt(timestampStr, 10);
      const price = parseFloat(priceStr);

      if (isNaN(timestamp) || isNaN(price)) {
        logWarn(`Invalid price data values for ${coinName}: timestamp = ${timestampStr}, price = ${priceStr} `);
        return null;
      }

      return { price, timestamp };
    } catch (error) {
      logError(`Error reading last tracked price for ${coinName}`, error as Error);
      return null;
    }
  }

  /**
   * Handle the deviation based price update cron
   * Checks if current price deviates from last tracked price by threshold
   * @param coinName - The name of the coin
   * @returns The void
   */
  async handleDeviationBasedPriceUpdateCron(coinName: string): Promise<SgxDataResult | null> {
    const requestString = `[handleDeviationBasedPriceUpdateCron:${coinName}]`;
    try {
      const requestString = `[handleDeviationBasedPriceUpdateCron:${coinName}]`;
      if (!this.deviationPriceUpdateStats[coinName]) {
        this.deviationPriceUpdateStats[coinName] = {
          totalRuns: 0,
          successfulRuns: 0,
          failedRuns: 0,
          lastRun: null,
          lastSuccess: null,
          lastError: null,
          cronEnabled: true,
          cronSchedule: deviationBasedPriceUpdateCronConfig.tokens[coinName]?.schedule || '',

        };
      }

      const stats = this.deviationPriceUpdateStats[coinName];

      stats.totalRuns++;
      stats.lastRun = new Date();

      const startTime = Date.now();
      logDebug(
        `${requestString} Starting deviation check cycle ${stats.totalRuns} for ${coinName}`
      );

      // Get the last tracked price
      const lastPriceData = this.getLastTrackedPrice(coinName);

      if (!lastPriceData) {
        logDebug(`${requestString} No previous price found, updating price directly`);
        // If no previous price, update directly
        const result = await this.setSgxData({ coinName, checkDeviation: true });
        stats.successfulRuns++;
        stats.lastSuccess = new Date();
        return result;
      }

      let successCount = 0;
      let errorCount = 0;

      let response: SgxDataResult | null = null;

      const coinStartTime = Date.now();
      try {
        log(`${requestString} Updating ${coinName} price...`);

        response = await this.setSgxData({ coinName, checkDeviation: true });

        const coinDuration = Date.now() - coinStartTime;

        log(`${requestString} Successfully updated ${coinName} price in ${coinDuration} ms`);

        successCount++;
      } catch (err) {
        const coinDuration = Date.now() - coinStartTime;
        logError(`${requestString} Failed to update ${coinName} price after ${coinDuration} ms`, err as Error);
        errorCount++;
        response = (err as any)?.data as SgxDataResult;
      }
      const duration = Date.now() - startTime;

      if (errorCount === 0) {
        stats.successfulRuns++;
        stats.lastSuccess = new Date();
        logDebug(
          `${requestString} Price update cycle ${stats.totalRuns} completed successfully in ${duration} ms`
        );

        // Send success notification
        // await discordNotifier.sendCronJobAlert(`${ coinName } price_update`, 'success', null, duration);
      } else {
        stats.failedRuns++;
        stats.lastError = new Date();
        logWarn(
          `${requestString} Price update cycle ${stats.totalRuns} completed with ${errorCount} errors in ${duration} ms`
        );
      }
      return response;
    } catch (error) {
      logError(`${requestString} Failed to handle deviation price update cron`, error as Error);
      await discordNotifier.sendErrorAlert(error as Error, {
        operation: 'handleDeviationBasedPriceUpdateCron',
        coinName,
      });
      throw error;
    }
  }

  /**
   * Handle periodic price update cron
   * @param coinName - The name of the coin
   * @returns The SgxDataResult
   */
  async handlePeriodicPriceUpdateCron(coinName: string): Promise<SgxDataResult | null> {
    const requestString = `[handlePeriodicPriceUpdateCron:${coinName}]`;
    try {

      if (!this.periodicPriceUpdateStats[coinName]) {
        this.periodicPriceUpdateStats[coinName] = {
          totalRuns: 0,
          successfulRuns: 0,
          failedRuns: 0,
          lastRun: null,
          lastSuccess: null,
          lastError: null,
          cronEnabled: true,
          cronSchedule: periodicPriceUpdateCronConfig.tokens[coinName]?.schedule || '',
        };
      }

      const stats = this.periodicPriceUpdateStats[coinName];

      stats.totalRuns++;
      stats.lastRun = new Date();

      const startTime = Date.now();
      logDebug(
        `${requestString} Starting price update cycle ${stats.totalRuns} for coins: ${coinName}`
      );

      // Send started notification
      await discordNotifier.sendCronJobAlert(`${coinName} price_update`, 'started', null, null);

      let successCount = 0;
      let errorCount = 0;

      let response: SgxDataResult | null = null;

      const coinStartTime = Date.now();
      try {
        log(`${requestString} Updating ${coinName} price...`);

        response = await this.setSgxData({ coinName, checkDeviation: false });

        const coinDuration = Date.now() - coinStartTime;

        log(`${requestString} Successfully updated ${coinName} price in ${coinDuration} ms`);

        successCount++;
      } catch (err) {
        const coinDuration = Date.now() - coinStartTime;
        logError(`${requestString} Failed to update ${coinName} price after ${coinDuration} ms`, err as Error);
        errorCount++;
        response = (err as any)?.data as SgxDataResult;
      }
      const duration = Date.now() - startTime;

      if (errorCount === 0) {
        stats.successfulRuns++;
        stats.lastSuccess = new Date();
        logDebug(
          `${requestString} Price update cycle ${stats.totalRuns} completed successfully in ${duration} ms`
        );

        // Send success notification
        // await discordNotifier.sendCronJobAlert(`${coinName} price_update`, 'success', null, duration);
      } else {
        stats.failedRuns++;
        stats.lastError = new Date();
        logWarn(
          `${requestString} Price update cycle ${stats.totalRuns} completed with ${errorCount} errors in ${duration} ms`
        );
        // Send failure notification
        // await discordNotifier.sendCronJobAlert(
        //   `${coinName} price_update`,
        //   'failed',
        //   new Error(`${errorCount} coins failed to update`),
        //   duration
        // );
      }

      return response;
    } catch (error) {
      logError(`${requestString} Failed to handle periodic price update cron for ${coinName}`, error as Error);
      await discordNotifier.sendErrorAlert(error as Error, {
        operation: 'handlePeriodicPriceUpdateCron',
        coinName,
      });
      throw error;
    }
  }


  /**
   * Start the deviation-based price update cron
   * Updates price only when deviation from last tracked price exceeds threshold
   * @param coinName - The name of the coin
   * @returns The void
   */
  startDeviationBasedPriceUpdateCron(coinName?: string | null): void {
    const requestString = `[startDeviationBasedPriceUpdateCron]`;
    const coins = coinName ? [coinName] : COIN_LIST;
    for (const coin of coins) {
      if (this.deviationPriceUpdateCronJob[coin]) {
        log(`${requestString} Deviation cron job for ${coin} already running`);
        continue;
      }

      const tokenConfig = deviationBasedPriceUpdateCronConfig.tokens[coin];

      const cronEnabled = tokenConfig?.enabled;
      const cronSchedule = tokenConfig?.schedule;

      if (tokenConfig?.enabled) {
        log(
          `${requestString} Starting deviation cron job for ${coin} with schedule ${JSON.stringify(cronSchedule)} `
        );

        if (!validateCronExpression(cronSchedule! as string)) {
          log(`${requestString} Invalid cron schedule for ${coin}: ${cronSchedule} `);
          continue;
        }

        if (!this.deviationPriceUpdateStats[coin]) {
          this.deviationPriceUpdateStats[coin] = {
            totalRuns: 0,
            successfulRuns: 0,
            failedRuns: 0,
            lastRun: null,
            lastSuccess: null,
            lastError: null,
            cronEnabled: cronEnabled as boolean,
            cronSchedule: cronSchedule! as string,
          };
        }

        this.deviationPriceUpdateCronJob[coin] = CronJob.from({
          name: `Deviation Based Price Update CronJob - ${coin} `,
          cronTime: cronSchedule! as string,
          onTick: async () => {
            await this.handleDeviationBasedPriceUpdateCron(coin);
          },
          errorHandler: async (error: unknown) => {
            logError('[CronError]', error as Error);
            if (this.deviationPriceUpdateStats[coin]) {
              this.deviationPriceUpdateStats[coin]!.lastError = new Date();
            }
            // Send Discord notification for cron error
            await discordNotifier.sendCronJobAlert(`${coin} deviation_price_update`, 'failed', error as Error);
          },
        });

        this.deviationPriceUpdateCronJob[coin]!.start();

        log(
          `${requestString} Deviation cron job for ${coin} started - checking price deviation every ${cronSchedule} `
        );
      }
    }
  }

  /**
   * Start the periodic price update cron
   * Updates price periodically on a fixed schedule regardless of deviation
   * @param coinName - The name of the coin
   * @returns The void
   */
  startPeriodicPriceUpdateCron(coinName?: string | null): void {
    const requestString = `[startPeriodicPriceUpdateCron]`;
    const coins = coinName ? [coinName] : COIN_LIST;
    for (const coin of coins) {
      if (this.periodicPriceUpdateCronJob[coin]) {
        log(`${requestString} Periodic cron job for ${coin} already running`);
        continue;
      }

      const cronEnabled = periodicPriceUpdateCronConfig.tokens[coin]?.enabled;
      const cronSchedule = periodicPriceUpdateCronConfig.tokens[coin]?.schedule;

      if (cronEnabled) {
        if (!validateCronExpression(cronSchedule! as string)) {
          log(`${requestString} Invalid cron schedule for ${coin}: ${cronSchedule} `);
          continue;
        }
        log(
          `${requestString} Starting periodic cron job for ${coin} with schedule ${JSON.stringify(cronSchedule)}`
        );
      }

      this.periodicPriceUpdateStats[coin] = {
        totalRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
        lastRun: null,
        lastSuccess: null,
        lastError: null,
        cronEnabled: cronEnabled as boolean,
        cronSchedule: cronSchedule! as string,
      };

      if (cronEnabled) {
        this.periodicPriceUpdateCronJob[coin] = CronJob.from({
          name: `Periodic Price Update CronJob - ${coin}`,
          cronTime: cronSchedule! as string,
          onTick: async () => {
            await this.handlePeriodicPriceUpdateCron(coin);
          },
          errorHandler: async (error: unknown) => {
            logError('[CronError]', error as Error);
            if (this.periodicPriceUpdateStats[coin]) {
              this.periodicPriceUpdateStats[coin]!.lastError = new Date();
            }
            // Send Discord notification for cron error
            await discordNotifier.sendCronJobAlert(`${coin} price_update`, 'failed', error as Error);
          },
        });

        this.periodicPriceUpdateCronJob[coin]!.start();

        log(
          `${requestString} Periodic cron job for ${coin} started - fetching coin prices every ${cronSchedule}`
        );
      }
    }
  }

  /**
   * Start both cron jobs (periodic and deviation-based)
   * @param coinName - The name of the coin
   * @returns The void
   */
  startCronJob(coinName?: string | null): void {
    this.startPeriodicPriceUpdateCron(coinName);
    this.startDeviationBasedPriceUpdateCron(coinName);
  }

  /**
   * Stop both cron jobs (periodic and deviation-based)
   * @param coinName - The name of the coin
   * @returns The void
   */
  stopCronJob(coinName?: string | null): void {
    this.stopPeriodicPriceUpdateCron(coinName);
    this.stopDeviationBasedPriceUpdateCron(coinName);
  }

  /**
   * Stop the periodic price update cron
   * @param coinName - The name of the coin
   * @returns The void
   */
  stopPeriodicPriceUpdateCron(coinName?: string | null): void {
    const requestString = `[stopPeriodicPriceUpdateCron]`;
    const coins = coinName ? [coinName] : COIN_LIST;
    for (const coin of coins) {
      if (this.periodicPriceUpdateCronJob[coin]) {
        try {
          log(`🛑 Stopping periodic price update cron job for ${coin}`);
          this.periodicPriceUpdateCronJob[coin]!.stop();
          this.periodicPriceUpdateCronJob[coin] = null;
          this.periodicPriceUpdateStats[coin] = null;
          log(`${requestString} Periodic Price Update cron job for ${coin} stopped`);
          // Send Discord notification for cron job stop
          discordNotifier.sendServiceStatusAlert('Periodic Price Update Cron Job', 'stopped', {
            coinName: coin,
          });
        } catch (error) {
          logError(`${requestString} Error stopping periodic price update cron job for ${coin}`, error as Error);
          discordNotifier.sendErrorAlert(error as Error, {
            operation: 'stopPeriodicPriceUpdateCron',
            coinName: coin,
          });
        }
      }
    }
  }

  /**
   * Stop the deviation-based price update cron
   * @param coinName - The name of the coin
   * @returns The void
   */
  stopDeviationBasedPriceUpdateCron(coinName?: string | null): void {
    const requestString = `[stopDeviationBasedPriceUpdateCron]`;
    const coins = coinName ? [coinName] : COIN_LIST;
    for (const coin of coins) {
      if (this.deviationPriceUpdateCronJob[coin]) {
        try {
          log(`🛑 Stopping deviation cron job for ${coin}`);
          this.deviationPriceUpdateCronJob[coin]!.stop();
          this.deviationPriceUpdateCronJob[coin] = null;
          this.deviationPriceUpdateStats[coin] = null;
          log(`${requestString} Deviation cron job for ${coin} stopped`);
          // Send Discord notification for cron job stop
          discordNotifier.sendServiceStatusAlert('Deviation Based Price Update Cron Job', 'stopped', {
            coinName: coin,
          });
        } catch (error) {
          logError(`Error stopping deviation cron job for ${coin}`, error as Error);
          discordNotifier.sendErrorAlert(error as Error, {
            operation: 'stopDeviationBasedPriceUpdateCron',
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
  getCronJobStats(coinName?: string | null): Record<string, Record<string, CoinStats | null>> {
    const coins = coinName ? [coinName] : COIN_LIST;
    const stats: Record<string, Record<string, CoinStats | null>> = {};
    for (const coin of coins) {
      stats[coin] = {
        periodic: this.periodicPriceUpdateStats[coin] || null,
        deviation: this.deviationPriceUpdateStats[coin] || null,
      };
    }
    return stats as Record<string, Record<string, CoinStats | null>>;
  }

  /**
   * Get the service statistics
   * @returns The service statistics
   */
  getStats(): ServiceStats {
    return {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cronJobs: {
        periodic: this.periodicPriceUpdateStats,
        deviation: this.deviationPriceUpdateStats,
      },
    };
  }
}
