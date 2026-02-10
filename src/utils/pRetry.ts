import pRetry, { makeRetriable, type RetryContext } from 'p-retry';
import { logWarn } from '@utils/logger.js';
import { BroadcastError } from '@utils/provableDelegatedProving.js';

interface RetryOptions {
  func: () => Promise<any>;
  label: string;
  retries?: number;
  onFailedAttempt?: null | ((error: any) => void);
}

const delayInSeconds = (seconds: number) => new Promise(resolve => setTimeout(resolve, seconds * 1000));

/**
 * Retry a function with exponential backoff
 * @param func - The function to retry
 * @param label - The label for the function
 * @param retries - The number of retries
 * @param onFailedAttempt - The function to call on failed attempt
 * @returns The result of the function
 */
export const retry = ({
  func,
  label,
  retries = 5,
  onFailedAttempt = null,
}: RetryOptions): Promise<any> => {
  return pRetry(func, {
    retries,
    shouldRetry: (context: RetryContext) => {
      const { error, retriesLeft } = context;
      return !(error instanceof BroadcastError) && retriesLeft > 0;
    },
    onFailedAttempt: async (context: RetryContext) => {
      const { error, attemptNumber } = context;
      onFailedAttempt ? onFailedAttempt(error) : logWarn(`Retry ${attemptNumber} for ${label}: ${error.message}`);
      // Use exponential backoff delay: delay = 2 ** attemptNumber seconds
      await delayInSeconds(Math.pow(2, attemptNumber));
    },
  });
};

export const fetchWithRetry = makeRetriable(fetch, {
  retries: 3,
  onFailedAttempt: async (context: RetryContext) => {
    const { error, attemptNumber, retriesLeft, retriesConsumed } = context;
    logWarn(`Retry ${attemptNumber} for fetch: ${error.message} with ${retriesLeft} retries left and ${retriesConsumed} retries consumed`);
    // Use exponential backoff delay: delay = 2 ** attemptNumber seconds
    await delayInSeconds(Math.pow(2, attemptNumber));
  },
});