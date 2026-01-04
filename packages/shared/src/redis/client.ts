/**
 * Redis Client Factory
 * Creates configured Redis client instances
 */

import Redis from 'ioredis';

export interface RedisConfig {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  retryDelayMs?: number;
  maxRetries?: number;
}

const DEFAULT_CONFIG: Required<RedisConfig> = {
  url: '',
  host: 'localhost',
  port: 6379,
  password: '',
  db: 0,
  keyPrefix: 'arb:',
  retryDelayMs: 1000,
  maxRetries: 10,
};

/**
 * Create a Redis client from configuration
 */
export function createRedisClient(config: RedisConfig = {}): Redis {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  // Prefer URL if provided (for Docker/production)
  if (finalConfig.url) {
    return new Redis(finalConfig.url, {
      keyPrefix: finalConfig.keyPrefix,
      retryStrategy: (times) => {
        if (times > finalConfig.maxRetries) return null;
        return Math.min(times * finalConfig.retryDelayMs, 5000);
      },
      lazyConnect: true,
    });
  }

  return new Redis({
    host: finalConfig.host,
    port: finalConfig.port,
    password: finalConfig.password || undefined,
    db: finalConfig.db,
    keyPrefix: finalConfig.keyPrefix,
    retryStrategy: (times) => {
      if (times > finalConfig.maxRetries) return null;
      return Math.min(times * finalConfig.retryDelayMs, 5000);
    },
    lazyConnect: true,
  });
}

/**
 * Create a Redis client from environment variables
 */
export function createRedisClientFromEnv(): Redis {
  return createRedisClient({
    url: process.env.REDIS_URL,
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : undefined,
    password: process.env.REDIS_PASSWORD,
  });
}
