import pRetry, { type FailedAttemptError } from 'p-retry';
import { logWarn } from '@utils/logger.js';

interface RetryOptions {
  func: () => Promise<any>;
  label: string;
  retries?: number;
  onFailedAttempt?: null | ((error: FailedAttemptError) => void);
}

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
    onFailedAttempt:
      onFailedAttempt ||
      ((error: FailedAttemptError) => {
        logWarn(`Retry ${error.attemptNumber} for ${label}: ${error.message}`);
      }),
  });
};
