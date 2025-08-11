import express, { type Request, type Response, type NextFunction, type Router } from 'express';
import { logError } from '@utils/logger.js';
import { discordNotifier } from '@utils/discordNotifier.js';
import { validateInternalApiKey } from '@middlewares/apiKeyMiddleware.js';
import { oracleConfig } from '@configs/index.js';
import type { OracleServiceInterface } from '@services/oracleService.js';

const { supportedCoins: COIN_LIST } = oracleConfig;

/**
 * Oracle routes
 * @param oracleService - The oracle service
 * @returns The router
 */
export const oracleRoutes = (oracleService: OracleServiceInterface): Router => {
  const router = express.Router();

  // Initialize oracle service
  router.use(
    async (
      req: Request,
      res: Response,
      next: NextFunction
    ): Promise<void | Response<any, Record<string, any>>> => {
      if (!oracleService.isInitialized) {
        try {
          await oracleService.initialize();
        } catch (error) {
          return res.status(500).json({
            error: 'Failed to initialize Oracle Service',
            message: (error as Error).message,
          });
        }
      }
      next();
    }
  );

  // API Key validation middleware for all Oracle endpoints
  router.use(validateInternalApiKey);

  // Get service status
  router.get('/status', (req: Request, res: Response) => {
    res.json({
      initialized: oracleService.isInitialized,
      cronJob: oracleService.getCronJobStatus(),
      supportedCoins: oracleConfig.supportedCoins,
    });
  });

  // Set SGX Unique ID
  router.post('/set-sgx-unique-id', async (req: Request, res: Response) => {
    try {
      if(process.env.NODE_ENV === 'production') {
        return res.status(403).json({
          success: false,
          message: 'Setting SGX Unique ID is not allowed in production environment',
          error: 'Forbidden in production',
        });
      }
      const { uniqueId } = req.body;
      if (!uniqueId) {
        return res.status(400).json({
          success: false,
          message: 'Unique ID is required',
          error: 'Unique ID is required',
        })
      }

      console.log(`Setting SGX Unique ID: ${uniqueId}`);
      
      const result = await oracleService.setSgxUniqueId(uniqueId);
      return res.json({
        success: true,
        message: 'SGX Unique ID set successfully',
        data: result,
      });
    } catch (error) {
      logError('API Error: setSgxUniqueId', error as Error);
      await discordNotifier.sendErrorAlert(error as Error, {
        operation: 'api_set_sgx_unique_id',
        endpoint: '/api/oracle/set-sgx-unique-id',
      });
      return res.status(500).json({
        success: false,
        message: 'Failed to set SGX Unique ID',
        error: (error as Error).message,
      });
    }
  });

  // Set Public Key
  router.post('/set-signer-public-key', async (req: Request, res: Response) => {
    try {
      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({
          success: false,
          message: 'Setting SGX Unique ID is not allowed in production environment',
          error: 'Forbidden in production',
        });
      }
      const { signerPubKey } = req.body;
      
      if (!signerPubKey) {
        return res.status(400).json({
          success: false,
          message: 'Public key is required',
          error: 'Public key is required',
        });
      }

      const result = await oracleService.setSignerPublicKey(signerPubKey);
      return res.json({
        success: true,
        message: 'Public key set successfully',
        data: result,
      });
    } catch (error) {
      logError('API Error: setPublicKey', error as Error);
      await discordNotifier.sendErrorAlert(error as Error, {
        operation: 'api_set_signer_public_key',
        endpoint: '/api/oracle/set-signer-public-key',
      });
      return res.status(500).json({
        success: false,
        message: 'Failed to set signer public key',
        error: (error as Error).message,
      });
    }
  });

  // Set SGX Data for a specific coin
  router.post(
    '/set-sgx-data/:coinName',
    async (req: Request, res: Response): Promise<void | Response<any, Record<string, any>>> => {
      try {
        const { coinName } = req.params;

        if (!coinName) {
          return res.status(400).json({
            success: false,
            error: 'Coin name is required',
            message: `Supported coins: ${COIN_LIST.join(', ')}`,
          });
        }

        if (!COIN_LIST.includes(coinName.toUpperCase())) {
          return res.status(400).json({
            success: false,
            error: 'Unsupported coin',
            message: `Supported coins: ${COIN_LIST.join(', ')}`,
          });
        }

        const result = await oracleService.handlePriceUpdateCron(coinName.toUpperCase());
        res.json({
          success: true,
          message: `SGX data set successfully for ${coinName}`,
          data: result,
        });
      } catch (error) {
        logError('API Error: setSgxData', error as Error);
        await discordNotifier.sendErrorAlert(error as Error, {
          operation: 'api_set_sgx_data',
          endpoint: '/api/oracle/set-sgx-data',
          coinName: req.params.coinName as string,
        });
        res.status(500).json({
          success: false,
          message: 'Failed to set SGX data',
          error: (error as Error).message,
          data: (error as any).data || null,
        });
      }
    }
  );

  // Set SGX Data for all coins
  router.post('/set-sgx-data-all', async (req: Request, res: Response) => {
    try {
      const results: any[] = [];
      const errors: Array<{ coinName: string; error: string }> = [];

      for (const coinName of COIN_LIST) {
        try {
          const result = await oracleService.handlePriceUpdateCron(coinName);
          results.push(result);
        } catch (error) {
          errors.push({ coinName, error: (error as Error).message });
        }
      }

      res.json({
        success: errors.length === 0,
        message: `Processed ${results.length} coins successfully, ${errors.length} failed`,
        data: {
          results,
          errors,
        },
      });
    } catch (error) {
      logError('API Error: setSgxDataAll', error as Error);
      await discordNotifier.sendErrorAlert(error as Error, {
        operation: 'api_set_sgx_data_all',
        endpoint: '/api/oracle/set-sgx-data-all',
      });
      res.status(500).json({
        success: false,
        message: 'Failed to set SGX data for all coins',
        error: (error as Error).message,
      });
    }
  });

  // Start cron job
  router.post(
    '/cron/start',
    async (req: Request, res: Response): Promise<void | Response<any, Record<string, any>>> => {
      try {
        const { coinName } = req.body as { coinName?: string };
        if (coinName && !COIN_LIST.includes(coinName.toUpperCase())) {
          return res.status(400).json({
            success: false,
            error: 'Unsupported coin',
            message: `Supported coins: ${COIN_LIST.join(', ')}`,
          });
        }
        oracleService.startCronJob(coinName?.toUpperCase() || null);
        res.json({
          success: true,
          message: 'Cron job started successfully',
        });
      } catch (error) {
        logError('API Error: startCronJob', error as Error);
        await discordNotifier.sendErrorAlert(error as Error, {
          operation: 'api_start_cron_job',
          endpoint: '/api/oracle/cron/start',
        });
        res.status(500).json({
          success: false,
          message: 'Failed to start cron job',
          error: (error as Error).message,
        });
      }
    }
  );

  // Stop cron job
  router.post(
    '/cron/stop',
    async (req: Request, res: Response): Promise<void | Response<any, Record<string, any>>> => {
      try {
        const { coinName } = req.body as { coinName?: string };
        if (coinName && !COIN_LIST.includes(coinName.toUpperCase())) {
          return res.status(400).json({
            success: false,
            error: 'Unsupported coin',
            message: `Supported coins: ${COIN_LIST.join(', ')}`,
          });
        }
        oracleService.stopCronJob(coinName?.toUpperCase() || null);
        res.json({
          success: true,
          message: 'Cron job stopped successfully',
        });
      } catch (error) {
        logError('API Error: stopCronJob', error as Error);
        await discordNotifier.sendErrorAlert(error as Error, {
          operation: 'api_stop_cron_job',
          endpoint: '/api/oracle/cron/stop',
        });
        res.status(500).json({
          success: false,
          message: 'Failed to stop cron job',
          error: (error as Error).message,
        });
      }
    }
  );

  // Get cron job status
  router.get(
    '/cron/status',
    async (req: Request, res: Response): Promise<void | Response<any, Record<string, any>>> => {
      try {
        const { coinName } = req.params;
        if (coinName && !COIN_LIST.includes(coinName.toUpperCase())) {
          return res.status(400).json({
            success: false,
            error: 'Unsupported coin',
            message: `Supported coins: ${COIN_LIST.join(', ')}`,
          });
        }
        const status = oracleService.getCronJobStatus(coinName?.toUpperCase() || null);
        res.json({
          success: true,
          message: 'Cron job status retrieved successfully',
          data: status,
        });
      } catch (error) {
        logError('API Error: getCronJobStatus', error as Error);
        await discordNotifier.sendErrorAlert(error as Error, {
          operation: 'api_get_cron_status',
          endpoint: '/api/oracle/cron/status',
        });
        res.status(500).json({
          success: false,
          message: 'Failed to get cron job status',
          error: (error as Error).message,
        });
      }
    }
  );

  // Get supported coins
  router.get('/coins', (req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        coins: COIN_LIST,
        count: COIN_LIST.length,
      },
    });
  });

  // Get service statistics
  router.get('/stats', async (req: Request, res: Response) => {
    try {
      const stats = oracleService.getStats();
      res.json({
        success: true,
        message: 'Service statistics retrieved successfully',
        data: stats,
      });
    } catch (error) {
      logError('API Error: updatePrices', error as Error);
      await discordNotifier.sendErrorAlert(error as Error, {
        operation: 'api_get_stats',
        endpoint: '/api/oracle/stats',
      });
      res.status(500).json({
        success: false,
        message: 'Failed to get service statistics',
        error: (error as Error).message,
      });
    }
  });

  return router;
};
