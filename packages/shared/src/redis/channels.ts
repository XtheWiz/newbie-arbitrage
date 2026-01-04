/**
 * Redis Pub/Sub Channel Definitions
 * Central registry for all message channels
 */

export const CHANNELS = {
  // Market data channels (Ingestor → Strategy Engine)
  MARKET_ORDERBOOK: 'market:orderbook',
  MARKET_TRADE: 'market:trade',
  MARKET_SNAPSHOT: 'market:snapshot',

  // Signal channels (Strategy Engine → Executor)
  SIGNALS_TRADE: 'signals:trade',
  SIGNALS_CANCEL: 'signals:cancel',
  SIGNALS_UPDATE: 'signals:update',

  // Execution channels (Executor → All)
  EXECUTION_RESULT: 'execution:result',
  EXECUTION_ERROR: 'execution:error',
  EXECUTION_PENDING: 'execution:pending',

  // System channels
  SYSTEM_HEALTH: 'system:health',
  SYSTEM_CONFIG: 'system:config',
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];

/**
 * Get all channels a service should subscribe to
 */
export function getServiceChannels(
  service: 'ingestor' | 'strategy-engine' | 'executor'
): ChannelName[] {
  switch (service) {
    case 'ingestor':
      return [CHANNELS.SYSTEM_CONFIG];
    case 'strategy-engine':
      return [
        CHANNELS.MARKET_ORDERBOOK,
        CHANNELS.MARKET_TRADE,
        CHANNELS.EXECUTION_RESULT,
        CHANNELS.SYSTEM_CONFIG,
      ];
    case 'executor':
      return [
        CHANNELS.SIGNALS_TRADE,
        CHANNELS.SIGNALS_CANCEL,
        CHANNELS.SYSTEM_CONFIG,
      ];
  }
}
