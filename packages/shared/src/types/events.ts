/**
 * Event Types for Redis Pub/Sub Communication
 */

import type { IMarketData } from '../interfaces/IMarketData.js';
import type { ITradeSignal } from '../interfaces/ITradeSignal.js';

/**
 * Base event envelope
 */
export interface BaseEvent<T = unknown> {
  eventId: string;
  eventType: string;
  timestamp: number;
  source: string;
  data: T;
}

/**
 * Market data event (Ingestor → Strategy Engine)
 */
export interface MarketDataEvent extends BaseEvent<IMarketData> {
  eventType: 'MARKET_DATA_UPDATE';
}

/**
 * Trade signal event (Strategy Engine → Executor)
 */
export interface TradeSignalEvent extends BaseEvent<ITradeSignal> {
  eventType: 'TRADE_SIGNAL';
}

/**
 * Execution result (Executor → All)
 */
export interface ExecutionResultEvent
  extends BaseEvent<{
    signalId: string;
    success: boolean;
    txHash?: string;
    executedPrice?: number;
    executedSize?: number;
    error?: string;
    gasUsed?: number;
  }> {
  eventType: 'EXECUTION_RESULT';
}

/**
 * System health event
 */
export interface HealthEvent
  extends BaseEvent<{
    service: string;
    status: 'healthy' | 'degraded' | 'unhealthy';
    uptime: number;
    metrics: Record<string, number>;
  }> {
  eventType: 'HEALTH_CHECK';
}

export type SystemEvent =
  | MarketDataEvent
  | TradeSignalEvent
  | ExecutionResultEvent
  | HealthEvent;

/**
 * Create an event envelope
 */
export function createEvent<T>(
  eventType: string,
  data: T,
  source: string
): BaseEvent<T> {
  return {
    eventId: crypto.randomUUID(),
    eventType,
    timestamp: Date.now(),
    source,
    data,
  };
}
