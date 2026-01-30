import { validateCronExpression } from 'cron';
import { z } from 'zod';

export const configSchema = z.object({
  server: z.object({
    port: z.coerce.number().int().min(1).max(65535),
    host: z.string(),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']),
  }),
  queue: z.object({
    concurrency: z.coerce.number().int().min(1),
  }),
  leoCli: z.object({
    threads: z.coerce.number().int().min(1),
    enableResourceProfiling: z.coerce.boolean(),
    resourceProfilingInterval: z.coerce.number().int().min(1000),
    network: z.enum(['testnet', 'mainnet']),
    endpoint: z.string(),
  }),
  oracle: z.object({
    attestationRequest: z.object({
      url: z.string(),
      requestMethod: z.enum(['GET', 'POST']),
      selector: z.string(),
      responseFormat: z.enum(['json', 'html']),
      encodingOptions: z.object({
        value: z.enum(['float', 'int', 'string']),
        precision: z.coerce.number().int().min(0).max(12),
      }),
      requestHeaders: z.record(z.string(), z.string()).optional(),
    }),
    leoExecutorApiUrl: z.url().optional(),
    provableDelegatedProving: z
      .object({
        enabled: z.coerce.boolean(),
        aleoApiHost: z.preprocess(
          (val: unknown) => (val === '' ? undefined : val),
          z.string().url().optional()
        ),
        proverUrl: z.preprocess(
          (val: unknown) => (val === '' ? undefined : val),
          z.string().url().optional()
        ),
        apiKey: z.preprocess(
          (val: unknown) => (val === '' ? undefined : val),
          z.string().min(1).optional()
        ),
        consumerId: z.preprocess(
          (val: unknown) => (val === '' ? undefined : val),
          z.string().min(1).optional()
        ),
        baseFeeCredits: z.preprocess(
          (val: unknown) => (val === '' ? undefined : val),
          z.coerce.number().optional()
        ),
        priorityFeeCredits: z.preprocess(
          (val: unknown) => (val === '' ? undefined : val),
          z.coerce.number().min(0).optional()
        ),
        privateFee: z.preprocess(
          (val: unknown) => (val === '' ? undefined : val),
          z.coerce.boolean().optional()
        ),
        broadcast: z.preprocess(
          (val: unknown) => (val === '' ? undefined : val),
          z.coerce.boolean().optional()
        ),
      })
      .optional(),
    verifyAttestation: z.coerce.boolean(),
    verifier: z.object({
      address: z.string().regex(/^[-a-zA-Z0-9.]+$/),
      port: z.coerce.number().int().min(1).max(65535),
      https: z.coerce.boolean(),
      resolve: z.coerce.boolean(),
      tls: z.object({
        keyPath: z.string(),
        certPath: z.string(),
        caPath: z.string(),
        rejectUnauthorized: z.coerce.boolean(),
        servername: z.string(),
      }).nullable(),
    }).required(),
    notarizers: z.array(z.object({
      address: z.string().regex(/^[-a-zA-Z0-9.]+$/),
      port: z.coerce.number().int().min(1).max(65535),
      https: z.coerce.boolean(),
      resolve: z.coerce.boolean(),
      tls: z.object({
        keyPath: z.string(),
        certPath: z.string(),
        caPath: z.string(),
        rejectUnauthorized: z.coerce.boolean(),
        servername: z.string(),
      }),
    }).required()),
    aleoProgram: z.object({
      name: z.string().regex(/^[a-zA-Z0-9_\.]+$/),
      function: z.object({
        setUniqueId: z.string(),
        setSingleSgxData: z.string(),
        setMultipleSgxData: z.string(),
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

  periodicPriceUpdateCron: z.object({
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
  deviationBasedPriceUpdateCron: z.object({
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
        deviation: z.coerce.number().min(0),
      })
    ),
  }),

  discord: z.object({
    webhookUrl: z.string().optional(),
    enableTransactionAlert: z.coerce.boolean(),
    enablePriceUpdateAlert: z.coerce.boolean(),
    enableCronJobAlert: z.coerce.boolean(),
    enableServiceStatusAlert: z.coerce.boolean(),
    enableSystemHealthAlert: z.coerce.boolean(),
    enableErrorAlert: z.coerce.boolean(),
  }),
  security: z
    .object({
      internalApiKey: z.string().min(1),
      requireApiKey: z.coerce.boolean(),
    })
    .optional(),
});

export type ConfigSchema = z.infer<typeof configSchema>;
