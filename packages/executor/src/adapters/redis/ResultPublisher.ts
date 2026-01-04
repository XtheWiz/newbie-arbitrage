/**
 * Execution Result Publisher
 * Publishes execution results back to Redis
 */

import {
  createPublisher,
  Publisher,
  CHANNELS,
  createRedisClientFromEnv,
  createLogger,
} from '@polymarket-arb/shared';
import type { ExecutionResultEvent } from '@polymarket-arb/shared';

const logger = createLogger({ name: 'executor:result-publisher' });

export interface ExecutionResultData {
  signalId: string;
  success: boolean;
  txHash?: string;
  executedPrice?: number;
  executedSize?: number;
  error?: string;
  gasUsed?: number;
}

export class ResultPublisher {
  private publisher: Publisher;

  constructor() {
    const redis = createRedisClientFromEnv();
    this.publisher = createPublisher(redis);
  }

  async publishResult(result: ExecutionResultData): Promise<void> {
    const channel = result.success
      ? CHANNELS.EXECUTION_RESULT
      : CHANNELS.EXECUTION_ERROR;

    await this.publisher.publish(channel, result);

    if (result.success) {
      logger.info({ signalId: result.signalId, txHash: result.txHash }, 'Execution success');
    } else {
      logger.error({ signalId: result.signalId, error: result.error }, 'Execution failed');
    }
  }

  async disconnect(): Promise<void> {
    await this.publisher.disconnect();
  }
}
