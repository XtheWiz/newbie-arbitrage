/**
 * Ingestor Service Entry Point
 * WebSocket listener that publishes market data to Redis
 */

import { createLogger } from '@polymarket-arb/shared';
import { PolymarketWSClient } from './adapters/websocket/index.js';
import { MarketDataPublisher } from './adapters/redis/index.js';

const logger = createLogger({ name: 'ingestor' });

async function main(): Promise<void> {
  logger.info('Starting Ingestor service...');

  // Initialize components
  const wsClient = new PolymarketWSClient({
    url: process.env.POLYMARKET_WS_URL ?? 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
    reconnectDelayMs: 1000,
    maxReconnectAttempts: 10,
  });

  const publisher = new MarketDataPublisher();

  // Connect to Redis
  await publisher.connect();

  // Handle order book updates
  wsClient.on('orderbook', async (orderBook) => {
    try {
      await publisher.publishOrderBook(orderBook);
    } catch (error) {
      logger.error({ error }, 'Failed to publish order book');
    }
  });

  wsClient.on('fatal', (error) => {
    logger.fatal({ error }, 'Fatal WebSocket error');
    process.exit(1);
  });

  // Connect to Polymarket WebSocket
  await wsClient.connect();

  // Subscribe to configured markets
  const markets = process.env.MARKETS?.split(',') ?? [];
  if (markets.length > 0) {
    wsClient.subscribe(markets);
  }

  logger.info('Ingestor service started');

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down...');
    await wsClient.disconnect();
    await publisher.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  logger.fatal({ error }, 'Failed to start Ingestor');
  process.exit(1);
});
