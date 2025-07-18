import { validateCronExpression } from 'cron';
import { z } from 'zod';

export const configSchema = z.object({
  server: z.object({
    port: z.number().int().min(1).max(65535),
    host: z.string(),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']),
  }),
  queue: z.object({
    concurrency: z.number().int().min(1),
  }),
  leoCli: z.object({
    threads: z.number().int().min(1),
    enableResourceProfiling: z.boolean(),
    resourceProfilingInterval: z.number().int().min(1000),
    network: z.enum(['testnet', 'mainnet']),
    endpoint: z.string(),
    privateKey: z.string(),
  }),
  oracle: z.object({
    attestationRequest: z.object({
      url: z.string(),
      requestMethod: z.enum(['GET', 'POST']),
      selector: z.string(),
      responseFormat: z.enum(['json', 'html']),
      encodingOptions: z.object({
        value: z.enum(['float', 'int', 'string']),
        precision: z.number().int().min(0).max(12),
      }),
      requestHeaders: z.record(z.string(), z.string()),
    }),
    verifer: z.object({
      address: z.string().regex(/^[-a-zA-Z0-9.]+$/),
      port: z.number().int().min(1).max(65535),
      https: z.boolean(),
      resolve: z.boolean(),
    }),
    notarizer: z.object({
      address: z.string().regex(/^[-a-zA-Z0-9.]+$/),
      port: z.number().int().min(1).max(65535),
      https: z.boolean(),
      resolve: z.boolean(),
    }),
    aleoProgram: z.object({
      name: z.string().regex(/^[a-zA-Z0-9_\.]+$/),
      function: z.object({
        setUniqueId: z.string(),
        setSgxData: z.string(),
        setPublicKey: z.string(),
      }),
    }),
    supportedCoins: z.preprocess((val: unknown) => {
      if (typeof val === 'string') {
        return val.split(',').map((coin: string) => coin.trim().toUpperCase());
      }
      return val;
    }, z.array(z.string())),
  }),

  cron: z.object({
    tokens: z.record(
      z.string(),
      z.object({
        schedule: z.string().refine(
          (val: string) => {
            const validation = validateCronExpression(val);
            if (!validation.valid) {
              return false;
            }
            return val;
          },
          { message: 'Invalid cron schedule' }
        ),
        enabled: z.preprocess((val: unknown) => {
          if (typeof val === 'boolean') return val;
          return val === 'true';
        }, z.boolean()),
      })
    ),
  }),

  discord: z.object({
    webhookUrl: z.string().optional(),
    enableTransactionAlert: z.preprocess((val: unknown) => {
      if (typeof val === 'boolean') return val;
      return val === 'true';
    }, z.boolean()),
    enablePriceUpdateAlert: z.preprocess((val: unknown) => {
      if (typeof val === 'boolean') return val;
      return val === 'true';
    }, z.boolean()),
    enableCronJobAlert: z.preprocess((val: unknown) => {
      if (typeof val === 'boolean') return val;
      return val === 'true';
    }, z.boolean()),
    enableServiceStatusAlert: z.preprocess((val: unknown) => {
      if (typeof val === 'boolean') return val;
      return val === 'true';
    }, z.boolean()),
    enableSystemHealthAlert: z.preprocess((val: unknown) => {
      if (typeof val === 'boolean') return val;
      return val === 'true';
    }, z.boolean()),
    enableErrorAlert: z.preprocess((val: unknown) => {
      if (typeof val === 'boolean') return val;
      return val === 'true';
    }, z.boolean()),
  }),
  security: z
    .object({
      internalApiKey: z.string().min(1),
      requireApiKey: z.preprocess((val: unknown) => {
        if (typeof val === 'boolean') return val;
        return val === 'true';
      }, z.boolean()),
    })
    .optional(),
});

export type ConfigSchema = z.infer<typeof configSchema>;
