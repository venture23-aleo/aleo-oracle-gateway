import type { Request, Response, NextFunction } from 'express';
import { log, logError } from '../utils/logger.js';
import { securityConfig } from '../config/index.js';

/**
 * Middleware to validate internal API key from request headers
 *
 * This middleware validates the presence and correctness of an internal API key
 * in the request headers. It checks for the 'X-Internal-API-Key' header and
 * compares it against the configured internal API key. If validation fails,
 * it returns an appropriate error response.
 *
 * The middleware can be disabled globally by setting securityConfig.requireApiKey
 * to false, in which case it will pass through all requests.
 *
 * @throws {Error} If there's an error during validation (returns 500 response)
 */
export const validateInternalApiKey = (
  req: Request,
  res: Response,
  next: NextFunction
): void | Response<any, Record<string, any>> => {
  try {
    // Skip validation if API key requirement is disabled
    if (!securityConfig?.requireApiKey) {
      return next();
    }

    const providedApiKey = req.headers['x-internal-api-key'] as string;
    const expectedApiKey = securityConfig?.internalApiKey;

    // Check if API key is provided
    if (!providedApiKey) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Internal API key is required',
        code: 'MISSING_API_KEY',
      });
    }

    // Validate API key
    if (providedApiKey !== expectedApiKey) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Invalid internal API key',
        code: 'INVALID_API_KEY',
      });
    }

    // API key is valid, proceed
    log(`API Key validation successful for ${req.originalUrl} ${req.method} ${req.ip}`);

    next();
  } catch (error) {
    logError('API Key Middleware Error', error as Error);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Error validating API key',
      code: 'MIDDLEWARE_ERROR',
    });
  }
};

/**
 * Optional middleware to validate API key only for specific endpoints
 *
 * This middleware factory creates a middleware function that validates API keys
 * only for specified endpoints. It checks if the current request path matches
 * any of the protected endpoints and applies API key validation accordingly.
 *
 * @param protectedEndpoints - Array of endpoint paths that require API key validation
 *
 * @example
 * ```typescript
 * // Protect specific endpoints
 * const protectedMiddleware = validateApiKeyForEndpoints([
 *   '/api/oracle/set-sgx-data',
 *   '/api/oracle/set-public-key'
 * ]);
 *
 * app.use(protectedMiddleware);
 *
 * // Or protect all /api/oracle routes
 * const oracleMiddleware = validateApiKeyForEndpoints(['/api/oracle']);
 * app.use('/api', oracleMiddleware);
 * ```
 *
 */
export const validateApiKeyForEndpoints = (protectedEndpoints: string[] = []) => {
  return (
    req: Request,
    res: Response,
    next: NextFunction
  ): void | Response<any, Record<string, any>> => {
    const currentPath = req.path;

    // Check if current endpoint requires API key
    const requiresApiKey = protectedEndpoints.some(
      endpoint => currentPath.startsWith(endpoint) || currentPath === endpoint
    );

    // Validate API key if required
    if (requiresApiKey) {
      return validateInternalApiKey(req, res, next);
    }

    // Skip validation for non-protected endpoints
    next();
  };
};
