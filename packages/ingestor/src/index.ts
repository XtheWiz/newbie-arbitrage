/**
 * Ingestor Service Entry Point
 * WebSocket listener that maintains real-time order book state
 * and publishes combined market data to Redis
 */

import type { IOrderBook } from '@polymarket-arb/shared';
import { createLogger } from '@polymarket-arb/shared';
import { PolymarketWSClient } from './adapters/websocket/index.js';
import { MarketDataPublisher } from './adapters/redis/index.js';
import { OrderBookManager } from './domain/index.js';

const logger = createLogger({ name: 'ingestor' });

/**
 * Market configuration - can be loaded from config file or environment
 */
interface MarketConfig {
  marketId: string;
  yesTokenId: string;
  noTokenId: string;
  question?: string;
}

/**
 * Parse market configuration from environment
 * Format: MARKET_ID:YES_TOKEN:NO_TOKEN,MARKET_ID:YES_TOKEN:NO_TOKEN,...
 */
function parseMarketConfig(configStr: string): MarketConfig[] {
  if (!configStr) return [];
  
  return configStr.split(',').map((entry) => {
    const [marketId, yesTokenId, noTokenId] = entry.trim().split(':');
    return { marketId, yesTokenId, noTokenId };
  }).filter((m) => m.marketId && m.yesTokenId && m.noTokenId);
}

async function main(): Promise<void> {
  logger.info('Starting Ingestor service...');

  // Initialize Order Book Manager with 5s stale threshold
  const orderBookManager = new OrderBookManager({
    staleThresholdMs: 5000,
    staleCheckIntervalMs: 1000,
  });

  // Initialize WebSocket client
  const wsClient = new PolymarketWSClient({
    url: process.env.POLYMARKET_WS_URL ?? 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
    reconnectDelayMs: 1000,
    maxReconnectAttempts: 10,
  });

  // Initialize Redis publisher
  const publisher = new MarketDataPublisher();

  // Connect to Redis
  await publisher.connect();

  // Parse and register markets
  const marketConfigs = parseMarketConfig(process.env.MARKET_CONFIG ?? '');
  for (const config of marketConfigs) {
    orderBookManager.registerMarket(config.marketId, config.yesTokenId, config.noTokenId);
  }

  // Start stale data checker
  orderBookManager.startStaleChecker((marketId) => {
    logger.warn({ marketId }, 'Market data became stale, ignoring until fresh data received');
  });

  // Handle order book updates
  wsClient.on('orderbook', async (orderBook: IOrderBook) => {
    try {
      // Update local order book state
      const marketState = orderBookManager.updateOrderBook(orderBook);
      
      if (!marketState) {
        return; // Unknown market, skip
      }

      // Only publish if we have both books and data is fresh
      if (!marketState.isStale && marketState.yesBook && marketState.noBook) {
        // Publish complete market data with both order books
        await publisher.publishCombinedMarketData(marketState);
        
        logger.debug(
          {
            marketId: marketState.marketId,
            yesAsk: marketState.yesBook.bestAsk,
            noAsk: marketState.noBook.bestAsk,
          },
          'Published combined market data'
        );
      }
    } catch (error) {
      logger.error({ error }, 'Failed to process order book');
    }
  });

  wsClient.on('fatal', (error) => {
    logger.fatal({ error }, 'Fatal WebSocket error');
    process.exit(1);
  });

  // Connect to Polymarket WebSocket
  await wsClient.connect();

  // Subscribe to configured markets
  const marketIds = marketConfigs.map((m) => m.marketId);
  if (marketIds.length > 0) {
    wsClient.subscribe(marketIds);
    logger.info({ markets: marketIds }, 'Subscribed to markets');
  } else {
    // Fallback: try simple market list
    const simpleMarkets = process.env.MARKETS?.split(',') ?? [];
    if (simpleMarkets.length > 0) {
      wsClient.subscribe(simpleMarkets);
    }
  }

  logger.info('Ingestor service started');

  // Log stats periodically
  setInterval(() => {
    const stats = orderBookManager.getStats();
    logger.info(stats, 'Order book manager stats');
  }, 30000);

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down...');
    orderBookManager.stopStaleChecker();
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

