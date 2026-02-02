import { leoCliConfig, oracleConfig } from '@configs/index.js';
import { log, logError } from '@utils/logger.js';
import type { LeoExecutionParams, LeoExecutionResult } from '@utils/leoExecutor.js';

import type { AleoKeyProvider, ProgramManager } from '@provablehq/sdk';
import SuperJSON from 'superjson';


type ProvableContext = {
  sdk: typeof import('@provablehq/sdk/mainnet.js');
  programManager: ProgramManager;
};

let contextPromise: Promise<ProvableContext> | null = null;

function defaultProverUrl(network: 'testnet' | 'mainnet'): string {
  return `https://api.provable.com/prove/${network}/prove`;
}

async function getProvableContext(): Promise<ProvableContext> {
  if (contextPromise) return contextPromise;

  contextPromise = (async () => {
    const network = leoCliConfig.network;
    const sdk = await import(`@provablehq/sdk/${network}.js`) as typeof import('@provablehq/sdk/mainnet.js')

    if (typeof sdk.initThreadPool === 'function') {
      const rawThreads =
        process.env.PROVABLE_THREAD_POOL_THREADS ?? process.env.PROVABLE_THREADS;
      const threads = rawThreads ? Number.parseInt(rawThreads, 10) : undefined;
      const threadCount = Number.isFinite(threads) && (threads as number) > 0 ? (threads as number) : undefined;

      log(
        `[provable] initThreadPool(${threadCount ?? 'auto'}) (set PROVABLE_THREAD_POOL_THREADS to reduce memory)`
      );
      await sdk.initThreadPool(threadCount);
    }

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('Missing PRIVATE_KEY (required to build proving requests)');
    }

    const aleoApiHost =
      oracleConfig.provableDelegatedProving?.aleoApiHost ??
      'https://api.explorer.provable.com/v1';

    const account = new sdk.Account({ privateKey });
    const networkClient = new sdk.AleoNetworkClient(aleoApiHost);

    const keyProvider: AleoKeyProvider = new sdk.AleoKeyProvider();
    keyProvider.useCache(true);

    const recordProvider = new sdk.NetworkRecordProvider(account, networkClient);
    const programManager = new sdk.ProgramManager(aleoApiHost, keyProvider, recordProvider);
    programManager.setAccount(account);

    return { sdk, programManager } as unknown as ProvableContext;
  })();

  return await contextPromise as ProvableContext;
}

export async function executeWithProvableDelegatedProving({
  inputs,
  label,
  functionName,
}: LeoExecutionParams): Promise<LeoExecutionResult> {
  const delegatedConfig = oracleConfig.provableDelegatedProving;

  if (!delegatedConfig?.enabled) {
    throw new Error(`[${label}] Provable delegated proving is not enabled`);
  }

  const apiKey = delegatedConfig.apiKey ?? process.env.PROVABLE_API_KEY;
  const consumerId = delegatedConfig.consumerId ?? process.env.PROVABLE_CONSUMER_ID;

  if (!apiKey || !consumerId) {
    throw new Error(
      `[${label}] Missing Provable credentials: set PROVABLE_API_KEY and PROVABLE_CONSUMER_ID`
    );
  }

  const proverUrl =
    delegatedConfig.proverUrl ?? defaultProverUrl(leoCliConfig.network);
  const programName = "veru_oracle_interface_v3.aleo" || oracleConfig.aleoProgram.name;
  const baseFeeCredits = delegatedConfig.baseFeeCredits ?? 0.25;
  const priorityFeeCredits = delegatedConfig.priorityFeeCredits ?? 0;
  const privateFee = delegatedConfig.privateFee ?? false;
  const broadcast = delegatedConfig.broadcast ?? true;

  try {
    const { programManager } = await getProvableContext();

    log(`${label} Building proving request (program=${programName}, function=${functionName})`);

    const provingRequest = await programManager.provingRequest({
      programName,
      functionName,
      baseFee: baseFeeCredits,
      priorityFee: priorityFeeCredits,
      privateFee,
      inputs,
      broadcast,
    });

    log(`${label} Submitting proving request to provable delegated proving service`);

    const provingResponse = await programManager.networkClient.submitProvingRequest({
      provingRequest,
      url: proverUrl,
      apiKey,
      consumerId,
    });

    return {
      success: true,
      data: SuperJSON.stringify(provingResponse),
      errorOutput: '',
      label,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`${label} Delegated proving failed: ${message}`);
    throw new Error(`[${label}] Delegated proving failed: ${message}`);
  }
}

