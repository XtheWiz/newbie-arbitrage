/**
 * Configuration Loader
 * Environment-based configuration with validation
 */

import { z } from 'zod';

/**
 * Base configuration schema
 */
export const baseConfigSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  serviceName: z.string().min(1),
  redisUrl: z.string().url().optional(),
  redisHost: z.string().default('localhost'),
  redisPort: z.coerce.number().default(6379),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

export type BaseConfig = z.infer<typeof baseConfigSchema>;

/**
 * Load and validate configuration from environment
 */
export function loadConfig<T extends z.ZodObject<z.ZodRawShape>>(
  schema: T,
  envMapping: Record<keyof z.infer<T>, string>
): z.infer<T> {
  const values: Record<string, unknown> = {};

  for (const [key, envKey] of Object.entries(envMapping)) {
    values[key] = process.env[envKey as string];
  }

  const result = schema.safeParse(values);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${errors}`);
  }

  return result.data;
}

/**
 * Load base configuration
 */
export function loadBaseConfig(serviceName: string): BaseConfig {
  return loadConfig(baseConfigSchema, {
    nodeEnv: 'NODE_ENV',
    serviceName: 'SERVICE_NAME',
    redisUrl: 'REDIS_URL',
    redisHost: 'REDIS_HOST',
    redisPort: 'REDIS_PORT',
    logLevel: 'LOG_LEVEL',
  });
}
