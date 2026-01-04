/**
 * Logger Utility
 * Structured logging using Pino
 */

import pino from 'pino';

export interface LoggerConfig {
  name: string;
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  prettyPrint?: boolean;
}

export function createLogger(config: LoggerConfig): pino.Logger {
  const { name, level = 'info', prettyPrint = process.env.NODE_ENV !== 'production' } = config;

  return pino({
    name,
    level,
    transport: prettyPrint
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
    base: {
      service: name,
      env: process.env.NODE_ENV ?? 'development',
    },
  });
}

// Default shared logger instance
export const logger = createLogger({ name: 'polymarket-arb' });
