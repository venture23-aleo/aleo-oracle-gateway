/**
 * Leo CLI Execution Module
 *
 * This module handles the execution of Leo CLI commands for Aleo program interactions.
 * It provides queue-based execution, process monitoring, and transaction ID extraction.
 * Supports concurrent execution with resource monitoring and retry mechanisms.
 *
 */
import { spawn, type ChildProcess } from 'node:child_process';
import PQueue from 'p-queue';
import { log, logDebug, logError } from './logger.js';
import { leoCliConfig, oracleConfig, queueConfig } from '../config/index.js';
import { retry } from './pRetry.js';
import { monitorProcessResources, resetIOTracking } from './processMonitor.js';

/**
 * Global execution queue for Leo CLI commands
 * Ensures controlled concurrency and prevents system overload
 */
const queue = new PQueue({ concurrency: queueConfig.concurrency });

// Export the queue for use in other modules
export { queue };

/**
 * Aleo program name from configuration
 * Used in all Leo CLI commands
 */
const aleoProgramName = oracleConfig.aleoProgram.name;

/**
 * Result of a Leo CLI execution
 * Contains success status, output data, and error information
 */
export interface LeoExecutionResult {
  /** Whether the execution was successful */
  success: boolean;
  /** Standard output from the Leo CLI command */
  data: string;
  /** Error output from the Leo CLI command */
  errorOutput: string;
  /** Label used for identification and logging */
  label: string;
}

/**
 * Parameters for executing a Leo CLI command
 * Defines the function to call and its inputs
 */
export interface LeoExecutionParams {
  /** Array of input parameters for the Leo function */
  inputs: string[];
  /** Label for identification and logging */
  label: string;
  /** Name of the Leo function to execute */
  functionName: string;
}

/**
 * Execute a Leo CLI command with process monitoring and retry logic
 *
 * This function spawns a Leo CLI process to execute a specific function in the
 * Aleo program. It includes resource monitoring, error handling, and retry
 * mechanisms. The function supports both successful and failed execution detection
 * based on transaction IDs and status codes.
 *
 * @param inputs - Parameters for the Leo function execution
 * @param label - Label for the execution (used in logging and identification)
 * @param functionName - Name of the Leo function to execute
 *
 * @returns Promise that resolves to the execution result
 *
 * @throws {Error} If the Leo CLI command fails and retries are exhausted
 */
const executeLeo = async ({
  inputs,
  label,
  functionName,
}: LeoExecutionParams): Promise<LeoExecutionResult> => {
  const func = (): Promise<LeoExecutionResult> =>
    new Promise((resolve, reject) => {
      let dataOutput = '';
      let errorOutput = '';

      log(`${label} Executing Leo with ${leoCliConfig.threads} threads`);

      const leoProcess: ChildProcess = spawn(
        'leo',
        [
          'execute',
          //   '--program',
          //   aleoProgramName,
          //   `${functionName}`,
          `${aleoProgramName}/${functionName}`,
            ...inputs,
            '--network',
            leoCliConfig.network,
            '--endpoint',
            leoCliConfig.endpoint,
            '--broadcast',
            '-y',
            '-d'
        ],
        { env: { ...process.env, RAYON_NUM_THREADS: leoCliConfig.threads.toString() } }
      );

      const startTime = Date.now();
      const lastLogTime = startTime;
      let monitor: NodeJS.Timeout | null = null;
      if (leoCliConfig.enableResourceProfiling && leoProcess.pid) {
        monitor = setInterval(
          () => monitorProcessResources(leoProcess.pid!, startTime, lastLogTime, label),
          leoCliConfig.resourceProfilingInterval
        );
      }

      leoProcess.stdout?.on('data', (data: Buffer) => {
        log(`${label} ${data}`);
        dataOutput += data.toString();
        if (/at[0-9a-z]{50,}/.test(dataOutput)) {
          leoProcess.kill();
        }
      });

      leoProcess.stderr?.on('data', (data: Buffer) => {
        logError(`${label} leo cli error: ${data}`);
        errorOutput += data.toString();
      });

      leoProcess.on('close', (code: number | null) => {
        log(`${label} Process exited with code ${code}`);
        if (leoCliConfig.enableResourceProfiling && monitor) {
          clearInterval(monitor);
          monitor = null;
        }
        resetIOTracking(leoProcess.pid!);

        // Check if the transaction was successful despite the error code
        const hasTransactionId =
          /at[0-9a-z]{50,}/.test(dataOutput) || /at[0-9a-z]{50,}/.test(errorOutput);
        const hasSuccessStatus =
          dataOutput.includes('status code 201') || errorOutput.includes('status code 201');

        const isCleanExit = code === 0 && !errorOutput;

        if (isCleanExit || hasTransactionId || hasSuccessStatus) {
          resolve({ success: true, data: dataOutput, errorOutput, label });
        } else {
          const message = errorOutput?.trim()
            ? `[${label}] ${errorOutput.trim()}`
            : `[${label}] Process exited with code ${code}`;
          logError(message);
          reject(new Error(message));
        }
      });
    });

  return await retry({ func, label, retries: 3 });
};

/**
 * Execute a Leo CLI command through the global queue
 *
 * This function adds a Leo CLI execution task to the global queue, ensuring
 * controlled concurrency and preventing system overload. It logs the current
 * queue size for monitoring purposes.
 *
 * @param inputs - Parameters for the Leo function execution
 * @param label - Label for the execution (used in logging and identification)
 * @param functionName - Name of the Leo function to execute
 *
 * @returns Promise that resolves to the execution result
 *
 * @see executeLeo for detailed execution logic
 */
export const executeLeoWithQueue = async ({
  inputs,
  label,
  functionName,
}: LeoExecutionParams): Promise<void | LeoExecutionResult> => {
  logDebug(`Queue size: ${queue.size}`);
  return await queue.add(() => executeLeo({ inputs, label, functionName }));
};

/**
 * Extract transaction ID from Leo CLI execution output
 *
 * This function parses the output from a Leo CLI command to extract the
 * transaction ID. It searches both standard output and error output for
 * the transaction ID pattern (alphanumeric string starting with 'at').
 *
 * @param leoResult - The result object from Leo CLI execution
 *
 * @returns The transaction ID if found, null otherwise
 *
 */
export const extractTransactionId = (leoResult: LeoExecutionResult): string | null => {
  const regex = /at[0-9a-z]{50,}/;

  const match = leoResult.data.match(regex) || leoResult.errorOutput?.match(regex);

  return match ? match[0] : null;
};
