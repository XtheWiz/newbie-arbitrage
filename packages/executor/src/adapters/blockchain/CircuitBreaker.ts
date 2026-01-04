/**
 * Circuit Breaker
 * Stops all trading when safety thresholds are breached
 */

import {
  createPublicClient,
  http,
  formatUnits,
  type PublicClient,
  type Address,
  erc20Abi,
} from 'viem';
import { polygon } from 'viem/chains';
import { createLogger } from '@polymarket-arb/shared';

const logger = createLogger({ name: 'executor:circuit-breaker' });

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  rpcUrl: string;
  minBalanceUSDC: number;
  maxConsecutiveReverts: number;
  cooldownMs: number;
  usdcAddress: Address;
}

export interface CircuitBreakerStatus {
  state: CircuitBreakerState;
  consecutiveReverts: number;
  lastRevertTime: number | null;
  lastBalanceCheck: number;
  currentBalance: number;
  reason?: string;
}

/**
 * Circuit breaker pattern for trading safety
 * - CLOSED: Normal operation, trading allowed
 * - OPEN: Trading halted, waiting for cooldown
 * - HALF_OPEN: Testing if issues resolved
 */
export class CircuitBreaker {
  private client: PublicClient;
  private config: CircuitBreakerConfig;
  private walletAddress: Address | null = null;
  
  private state: CircuitBreakerState = 'CLOSED';
  private consecutiveReverts = 0;
  private lastRevertTime: number | null = null;
  private tripTime: number | null = null;
  private currentBalance = 0;
  private lastBalanceCheck = 0;

  constructor(config: CircuitBreakerConfig) {
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
    this.walletAddress = address;
    await this.checkBalance();
    logger.info(
      { address, balance: this.currentBalance, state: this.state },
      'Circuit breaker initialized'
    );
  }

  /**
   * Check if trading is allowed
   */
  async canTrade(): Promise<{ allowed: boolean; reason?: string }> {
    // Check if in cooldown
    if (this.state === 'OPEN') {
      const timeSinceTrip = Date.now() - (this.tripTime ?? 0);
      
      if (timeSinceTrip < this.config.cooldownMs) {
        const remainingMs = this.config.cooldownMs - timeSinceTrip;
        return {
          allowed: false,
          reason: `Circuit breaker open, cooldown: ${Math.ceil(remainingMs / 1000)}s remaining`,
        };
      }
      
      // Try to recover - move to HALF_OPEN
      this.state = 'HALF_OPEN';
      logger.info('Circuit breaker entering HALF_OPEN state');
    }

    // Check balance
    const balanceOk = await this.checkBalance();
    if (!balanceOk) {
      this.trip(`Balance below minimum: $${this.currentBalance.toFixed(2)} < $${this.config.minBalanceUSDC}`);
      return {
        allowed: false,
        reason: `Insufficient balance: $${this.currentBalance.toFixed(2)}`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record successful execution
   */
  recordSuccess(): void {
    this.consecutiveReverts = 0;
    
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      this.tripTime = null;
      logger.info('Circuit breaker recovered, entering CLOSED state');
    }
  }

  /**
   * Record failed execution (revert)
   */
  recordRevert(error?: string): void {
    this.consecutiveReverts++;
    this.lastRevertTime = Date.now();

    logger.warn(
      { consecutiveReverts: this.consecutiveReverts, error },
      'Transaction reverted'
    );

    if (this.consecutiveReverts >= this.config.maxConsecutiveReverts) {
      this.trip(`${this.consecutiveReverts} consecutive reverts`);
    }
  }

  /**
   * Trip the circuit breaker
   */
  private trip(reason: string): void {
    this.state = 'OPEN';
    this.tripTime = Date.now();
    
    logger.error(
      { reason, consecutiveReverts: this.consecutiveReverts },
      'Circuit breaker TRIPPED'
    );
  }

  /**
   * Check USDC balance
   */
  private async checkBalance(): Promise<boolean> {
    if (!this.walletAddress) return false;

    try {
      // Only check every 10 seconds
      if (Date.now() - this.lastBalanceCheck < 10000 && this.lastBalanceCheck > 0) {
        return this.currentBalance >= this.config.minBalanceUSDC;
      }

      const balance = await this.client.readContract({
        address: this.config.usdcAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [this.walletAddress],
      });

      // USDC has 6 decimals
      this.currentBalance = parseFloat(formatUnits(balance, 6));
      this.lastBalanceCheck = Date.now();

      logger.debug({ balance: this.currentBalance }, 'Balance checked');

      return this.currentBalance >= this.config.minBalanceUSDC;
    } catch (error) {
      logger.error({ error }, 'Failed to check balance');
      return true; // Don't trip on RPC errors
    }
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.state = 'CLOSED';
    this.consecutiveReverts = 0;
    this.tripTime = null;
    this.lastRevertTime = null;
    logger.info('Circuit breaker manually reset');
  }

  /**
   * Get current status
   */
  getStatus(): CircuitBreakerStatus {
    return {
      state: this.state,
      consecutiveReverts: this.consecutiveReverts,
      lastRevertTime: this.lastRevertTime,
      lastBalanceCheck: this.lastBalanceCheck,
      currentBalance: this.currentBalance,
      reason: this.state === 'OPEN' 
        ? `Tripped at ${new Date(this.tripTime ?? 0).toISOString()}` 
        : undefined,
    };
  }
}
