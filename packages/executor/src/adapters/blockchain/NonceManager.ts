/**
 * Nonce Manager
 * Handles concurrent transaction nonce management
 * Prevents nonce conflicts and supports transaction recovery
 */

import {
  createPublicClient,
  http,
  type PublicClient,
  type Address,
} from 'viem';
import { polygon } from 'viem/chains';
import { createLogger } from '@polymarket-arb/shared';

const logger = createLogger({ name: 'executor:nonce' });

interface PendingNonce {
  nonce: number;
  timestamp: number;
  txHash?: string;
}

export interface NonceManagerConfig {
  rpcUrl: string;
  chainId: number;
  maxConcurrentTx: number;
  lockTimeoutMs: number;
}

/**
 * Manages nonces for concurrent transaction submission
 */
export class NonceManager {
  private client: PublicClient;
  private config: NonceManagerConfig;
  private pendingNonces: Map<number, PendingNonce> = new Map();
  private nextNonce: number | null = null;
  private address: Address | null = null;
  private mutex = Promise.resolve();

  constructor(config: NonceManagerConfig) {
    this.config = config;
    
    this.client = createPublicClient({
      chain: polygon,
      transport: http(config.rpcUrl),
    });
  }

  /**
   * Initialize with wallet address
   */
  async initialize(address: Address): Promise<void> {
    this.address = address;
    await this.syncNonce();
    logger.info({ address, nonce: this.nextNonce }, 'Nonce manager initialized');
  }

  /**
   * Sync nonce from chain
   */
  async syncNonce(): Promise<number> {
    if (!this.address) {
      throw new Error('Nonce manager not initialized');
    }

    const onChainNonce = await this.client.getTransactionCount({
      address: this.address,
      blockTag: 'pending',
    });

    this.nextNonce = onChainNonce;
    
    // Clear any pending nonces that are now confirmed
    for (const [nonce, _pending] of this.pendingNonces) {
      if (nonce < onChainNonce) {
        this.pendingNonces.delete(nonce);
      }
    }

    logger.debug({ onChainNonce, pending: this.pendingNonces.size }, 'Nonce synced');
    return onChainNonce;
  }

  /**
   * Acquire the next available nonce
   * Uses mutex to prevent race conditions
   */
  async acquireNonce(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.mutex = this.mutex.then(async () => {
        try {
          // Check for expired pending nonces
          this.cleanupExpiredNonces();

          // Check concurrent limit
          if (this.pendingNonces.size >= this.config.maxConcurrentTx) {
            throw new Error(`Max concurrent transactions (${this.config.maxConcurrentTx}) reached`);
          }

          // Sync if we don't have a nonce yet
          if (this.nextNonce === null) {
            await this.syncNonce();
          }

          const nonce = this.nextNonce!;
          this.nextNonce = nonce + 1;

          // Track pending nonce
          this.pendingNonces.set(nonce, {
            nonce,
            timestamp: Date.now(),
          });

          logger.debug({ nonce, pending: this.pendingNonces.size }, 'Nonce acquired');
          resolve(nonce);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  /**
   * Mark a nonce as having a transaction hash
   */
  markNonceSent(nonce: number, txHash: string): void {
    const pending = this.pendingNonces.get(nonce);
    if (pending) {
      pending.txHash = txHash;
    }
  }

  /**
   * Release a nonce (transaction confirmed or failed)
   */
  releaseNonce(nonce: number, confirmed: boolean): void {
    this.pendingNonces.delete(nonce);
    
    if (!confirmed) {
      // Transaction failed - may need to resync nonce
      logger.warn({ nonce }, 'Nonce released without confirmation');
    } else {
      logger.debug({ nonce }, 'Nonce confirmed and released');
    }
  }

  /**
   * Clean up expired pending nonces
   */
  private cleanupExpiredNonces(): void {
    const now = Date.now();
    
    for (const [nonce, pending] of this.pendingNonces) {
      if (now - pending.timestamp > this.config.lockTimeoutMs) {
        logger.warn({ nonce, age: now - pending.timestamp }, 'Nonce lock expired');
        this.pendingNonces.delete(nonce);
        
        // Need to resync as we may have a gap
        this.nextNonce = null;
      }
    }
  }

  /**
   * Force resync nonces - call after transaction errors
   */
  async forceResync(): Promise<void> {
    this.pendingNonces.clear();
    this.nextNonce = null;
    await this.syncNonce();
    logger.info('Nonce manager force resynced');
  }

  /**
   * Get current pending nonce count
   */
  getPendingCount(): number {
    return this.pendingNonces.size;
  }

  /**
   * Check if we can accept more transactions
   */
  canAcceptTransaction(): boolean {
    this.cleanupExpiredNonces();
    return this.pendingNonces.size < this.config.maxConcurrentTx;
  }
}
