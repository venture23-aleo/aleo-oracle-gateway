import { leoCliConfig, oracleConfig } from '@configs/index.js';
import { log, logError } from '@utils/logger.js';
import type { LeoExecutionParams, LeoExecutionResult } from '@utils/leoExecutor.js';
import type { AleoKeyProvider, ProgramManager } from '@provablehq/sdk';
import SuperJSON from 'superjson';
import { fetchWithRetry, retry } from '@utils/pRetry.js';


export class BroadcastError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BroadcastError';
  }
}

type ProvableContext = {
  sdk: typeof import('@provablehq/sdk/mainnet.js');
  programManager: ProgramManager;
};

let contextPromise: Promise<ProvableContext> | null = null;

function defaultProverBase(network: 'testnet' | 'mainnet'): string {
  return `https://api.provable.com/prove/${network}`;
}

function resolveProverBase(
  network: 'testnet' | 'mainnet',
  configuredUrl?: string
): string {
  // If nothing is configured, use the canonical base from the docs:
  // https://api.provable.com/prove/${network}
  if (!configuredUrl) return defaultProverBase(network);

  // If the user configures a URL, treat it as the full proverBase and only
  // strip a trailing slash. No path rewriting here to avoid confusion.
  try {
    const url = new URL(configuredUrl);
    // Remove trailing slash from the full URL if present.
    url.pathname = url.pathname.replace(/\/$/, '');
    return url.toString().replace(/\/$/, '');
  } catch {
    return configuredUrl.replace(/\/$/, '');
  }
}

export type GetProvableJwtParams = {
  proverBase: string;
  consumerId: string;
  apiKey: string;
  label: string;
};

async function getProvableJwt({ proverBase, consumerId, apiKey, label }: GetProvableJwtParams): Promise<string> {
  let jwtUrl: string;
  try {
    const base = new URL(proverBase);
    jwtUrl = `${base.origin}/jwts/${consumerId}`;
  } catch {
    jwtUrl = `https://api.provable.com/jwts/${consumerId}`;
  }

  const res = await fetchWithRetry(jwtUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Provable-API-Key': apiKey,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `${label} Failed to obtain Provable JWT: ${res.status} ${text || ''}`.trim()
    );
  }

  const authHeader =
    res.headers.get('authorization') ?? res.headers.get('Authorization');

  if (!authHeader) {
    throw new Error(
      `${label} Provable JWT response missing Authorization header`
    );
  }

  return authHeader;
}

type ProverPubKey = {
  key_id: string;
  public_key: string;
};

type GetProverPubKeyParams = {
  proverBase: string;
  jwt: string;
  label: string;
};

type SendEncryptedProvingRequestParams = {
  proverBase: string;
  jwt: string;
  payload: { key_id: string; ciphertext: string };
  label: string;
};

type BroadcastProvableResponse = {
  broadcast_result: {
    status: string;
    message: string;
    status_code: number;
  };
};



async function getProverPubKey({ proverBase, jwt, label }: GetProverPubKeyParams): Promise<ProverPubKey> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: jwt,
  };

  const res = await fetchWithRetry(`${proverBase}/pubkey`, {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `${label} Failed to get prover pubkey: ${res.status} ${text || ''}`.trim()
    );
  }

  return (await res.json()) as ProverPubKey;
}

async function sendEncryptedProvingRequest({ proverBase, jwt, payload, label }: SendEncryptedProvingRequestParams): Promise<unknown> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: jwt,
  };

  const res = await fetchWithRetry(`${proverBase}/prove/encrypted`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let body: unknown = null;

  if (text) {
    // log(`${label} Proving response text: ${text}`);
    try {
      body = JSON.parse(text);
    } catch {
      log(`${label} Proving response text parsing failed: ${text}`);
      body = { message: text };
    }
  }

  if (!res.ok) {
    const message =
      (body as { message?: string } | null)?.message ??
      text ??
      `Delegated proving failed with status ${res.status}`;
    throw new Error(`${label} ${message}`);
  }

  return body ?? {};
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

  return contextPromise as unknown as ProvableContext;
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

  const proverBase = resolveProverBase(
    leoCliConfig.network,
    delegatedConfig.proverUrl
  );
  const programName = oracleConfig.aleoProgram.name;
  const baseFeeCredits = delegatedConfig.baseFeeCredits ?? 0.25;
  const priorityFeeCredits = delegatedConfig.priorityFeeCredits ?? 0;
  const privateFee = delegatedConfig.privateFee ?? false;
  const broadcast = delegatedConfig.broadcast ?? true;

  const { programManager, sdk } = await getProvableContext();

  const func = async () => {
    try {
      const jwt = await getProvableJwt({ proverBase, apiKey, consumerId, label });

      const pubkey = await getProverPubKey({ proverBase, jwt, label });

      log(`${label} Building proving request (program=${programName}, function=${functionName}), public key=${pubkey.public_key}`);

      const provingRequest = await programManager.provingRequest({
        programName,
        functionName,
        baseFee: baseFeeCredits,
        priorityFee: priorityFeeCredits,
        privateFee,
        inputs,
        broadcast,
      });

      log(`${label} Encrypting proving request for delegated proving`);

      const ciphertext = sdk.encryptProvingRequest(pubkey.public_key, provingRequest);

      const payload = {
        key_id: pubkey.key_id,
        ciphertext,
      };

      log(`${label} Submitting encrypted proving request to Provable delegated proving service`);

      const provingResponse = await sendEncryptedProvingRequest(
        { proverBase, jwt, payload, label }
      );

      // log(`${label} Proving response: ${JSON.stringify(provingResponse)}`);

      if (broadcast) {
        const { status_code, message = '' } = (provingResponse as BroadcastProvableResponse).broadcast_result;
        if (status_code !== 200) {
          throw new BroadcastError(`${label} Failed to broadcast proving request: ${message} with status code ${status_code}`);
        }
        log(`${label} Proving request broadcasted successfully`);
      }

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
  return retry({ func, label, retries: 1 });
}

