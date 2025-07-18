/**
 * Process Resource Monitoring Module
 *
 * This module provides comprehensive monitoring capabilities for Leo CLI processes,
 * including CPU usage, memory consumption, and I/O statistics. It supports
 * concurrent monitoring of multiple processes without interference.
 *
 * @module ProcessMonitor
 */

import { readFileSync } from 'node:fs';
import pidusage from 'pidusage';
import { log } from './logger.js';

/**
 * I/O Statistics interface for process monitoring
 * Contains read/write byte counts and other I/O metrics
 */
interface IOStats {
  /** Total bytes read by the process */
  read_bytes: number;
  /** Total bytes written by the process */
  write_bytes: number;
  /** Additional I/O metrics from /proc filesystem */
  [key: string]: number;
}

/**
 * Comprehensive process metrics for monitoring and analysis
 * Contains CPU, memory, I/O, and timing information
 */
interface ProcessMetrics {
  /** CPU usage percentage */
  cpu: number;
  /** Memory usage in megabytes */
  memory: number;
  /** I/O read delta in KB/s (if available) */
  readDelta?: number;
  /** I/O write delta in KB/s (if available) */
  writeDelta?: number;
  /** Total time elapsed since process start in seconds */
  timeElapsed: number;
}

/**
 * Global process I/O statistics tracker
 * Maps process IDs to their I/O statistics to support concurrent monitoring
 * of multiple processes without interference.
 *
 * @private
 */
const processIOStats = new Map<number, IOStats | null>();

/**
 * Read I/O statistics for a process from the Linux /proc filesystem
 *
 * This function reads the `/proc/{pid}/io` file to get detailed I/O statistics
 * for a specific process. This is Linux-specific and will return null on
 * other operating systems or if the process has ended.
 *
 * @param pid - The process ID to read I/O stats for
 * @returns I/O statistics object or null if not available
 *
 * @private
 */
function readProcessIO(pid: number): IOStats | null {
  try {
    const ioData = readFileSync(`/proc/${pid}/io`, 'utf8');
    const ioStats: IOStats = { read_bytes: 0, write_bytes: 0 };
    ioData.split('\n').forEach(line => {
      const [key, value] = line.split(': ');
      if (key && value) ioStats[key] = Number(value);
    });
    return ioStats;
  } catch {
    return null; // Could be non-Linux or process ended
  }
}

/**
 * Monitor and log resource usage of a Leo CLI process
 *
 * This function provides real-time monitoring of a Leo CLI process, tracking
 * CPU usage, memory consumption, and I/O statistics. It logs the metrics
 * and calculates deltas for I/O operations. The function supports concurrent
 * monitoring of multiple processes without interference.
 *
 * @param pid - The process ID to monitor
 * @param startTime - The timestamp when the process started (for elapsed time calculation)
 * @param lastLogTime - The timestamp of the last log entry (for rate limiting)
 * @param label - A label for the process (used in log messages for identification)
 *
 * @returns Promise that resolves when monitoring is complete
 *
 * @throws {Error} If pidusage fails to get process statistics
 */
export const monitorProcessResources = async (
  pid: number,
  startTime: number,
  lastLogTime: number,
  label: string = ''
): Promise<void> => {
  const stats = await pidusage(pid);
  const ioStats = readProcessIO(pid);

  if (ioStats) {
    const lastIO = processIOStats.get(pid);
    if (lastIO) {
      const readDelta = ioStats.read_bytes - lastIO.read_bytes;
      const writeDelta = ioStats.write_bytes - lastIO.write_bytes;
      log(
        `${label} Leo Cli process: CPU: ${stats.cpu.toFixed(2)}% | Memory: ${(stats.memory / 1024 / 1024).toFixed(2)} MB | Read: ${(readDelta / 1024).toFixed(2)} KB/s | Write: ${(writeDelta / 1024).toFixed(2)} KB/s`
      );
    } else {
      log(
        `${label} Leo Cli process CPU: ${stats.cpu.toFixed(2)}% | Memory: ${(stats.memory / 1024 / 1024).toFixed(2)} MB | Read: 0 KB/s | Write: 0 KB/s`
      );
    }
    processIOStats.set(pid, ioStats);
  } else {
    log(
      `${label} Leo Cli process CPU: ${stats.cpu.toFixed(2)}% | Memory: ${(stats.memory / 1024 / 1024).toFixed(2)} MB | I/O stats not available`
    );
  }

  const currentTime = Date.now();
  if (currentTime - lastLogTime >= 1000) {
    log(`${label} Time taken: ${(currentTime - startTime) / 1000} seconds`);
    lastLogTime = currentTime;
  }
};

/**
 * Get comprehensive process metrics without logging
 *
 * This function retrieves detailed metrics for a process including CPU usage,
 * memory consumption, I/O statistics, and elapsed time. Unlike monitorProcessResources,
 * this function does not log the metrics but returns them as a structured object
 * for programmatic use.
 *
 * @param pid - The process ID to get metrics for
 * @param startTime - The timestamp when the process started
 *
 * @returns Promise that resolves to a ProcessMetrics object
 *
 * @throws {Error} If pidusage fails to get process statistics
 */
export const getProcessMetrics = async (
  pid: number,
  startTime: number
): Promise<ProcessMetrics> => {
  const stats = await pidusage(pid);
  const ioStats = readProcessIO(pid);
  const currentTime = Date.now();

  const metrics: ProcessMetrics = {
    cpu: stats.cpu,
    memory: stats.memory / 1024 / 1024, // Convert to MB
    timeElapsed: (currentTime - startTime) / 1000, // Convert to seconds
  };

  if (ioStats) {
    const lastIO = processIOStats.get(pid);
    if (lastIO) {
      metrics.readDelta = (ioStats.read_bytes - lastIO.read_bytes) / 1024; // KB/s
      metrics.writeDelta = (ioStats.write_bytes - lastIO.write_bytes) / 1024; // KB/s
    }
    processIOStats.set(pid, ioStats);
  }

  return metrics;
};

/**
 * Reset I/O tracking state for process cleanup
 *
 * This function cleans up the I/O tracking data for processes. It should be called
 * when a process ends to prevent memory leaks and ensure accurate tracking for
 * subsequent processes. If no PID is provided, it clears all tracking data.
 *
 * @param pid - Optional process ID to clean up. If not provided, clears all tracking data
 *
 */
export const resetIOTracking = (pid?: number): void => {
  if (pid) {
    processIOStats.delete(pid);
  } else {
    // Clear all process tracking data
    processIOStats.clear();
  }
};

/**
 * Get the number of processes currently being tracked
 *
 * This function returns the count of processes that are currently being monitored
 * for I/O statistics. Useful for debugging and monitoring system health.
 *
 * @returns The number of processes currently being tracked
 *
 */
export const getTrackedProcessCount = (): number => {
  return processIOStats.size;
};

/**
 * Get all currently tracked process IDs
 *
 * This function returns an array of all process IDs that are currently being
 * monitored for I/O statistics. Useful for debugging and process management.
 *
 * @returns Array of process IDs currently being tracked
 *
 */
export const getTrackedProcessIds = (): number[] => {
  return Array.from(processIOStats.keys());
};
