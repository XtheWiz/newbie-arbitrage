/**
 * EIP-1559 Gas Fetcher
 * Dynamic gas price calculation for next-block inclusion
 */

import {
  createPublicClient,
  http,
  formatGwei,
  parseGwei,
  type PublicClient,
  type Chain,
} from 'viem';
import { polygon } from 'viem/chains';
import { createLogger } from '@polymarket-arb/shared';

const logger = createLogger({ name: 'executor:gas' });

export interface GasEstimate {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  gasPrice: bigint;
  baseFee: bigint;
  estimatedNextBaseFee: bigint;
}

export interface GasFetcherConfig {
  rpcUrl: string;
  chainId: number;
  maxFeePerGasGwei: number;
  priorityFeeMultiplier: number;
}

/**
 * Fetches and calculates optimal EIP-1559 gas parameters
 * Designed for aggressive next-block inclusion
 */
export class GasFetcher {
  private client: PublicClient;
  private config: GasFetcherConfig;
  private lastGasEstimate: GasEstimate | null = null;
  private lastFetchTime = 0;
  private cacheMs = 2000; // Cache for 2 seconds

  constructor(config: GasFetcherConfig) {
    this.config = config;
    
    const chain: Chain = config.chainId === 137 ? polygon : polygon;
    
    this.client = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    });
  }

  /**
   * Get current gas estimate optimized for next-block inclusion
   */
  async getGasEstimate(): Promise<GasEstimate> {
    const now = Date.now();
    
    // Return cached value if fresh
    if (this.lastGasEstimate && now - this.lastFetchTime < this.cacheMs) {
      return this.lastGasEstimate;
    }

    try {
      // Get current block for base fee
      const block = await this.client.getBlock({ blockTag: 'latest' });
      const baseFee = block.baseFeePerGas ?? parseGwei('30');

      // Get fee history for priority fee estimation
      const feeHistory = await this.client.getFeeHistory({
        blockCount: 5,
        rewardPercentiles: [25, 50, 75],
      });

      // Calculate median priority fee from recent blocks
      const priorityFees = feeHistory.reward?.flat() ?? [];
      const medianPriorityFee = this.median(priorityFees);

      // Apply multiplier for aggressive inclusion
      const adjustedPriorityFee = BigInt(
        Math.floor(Number(medianPriorityFee) * this.config.priorityFeeMultiplier)
      );

      // Ensure minimum priority fee (1 gwei)
      const minPriorityFee = parseGwei('1');
      const maxPriorityFeePerGas = adjustedPriorityFee > minPriorityFee 
        ? adjustedPriorityFee 
        : minPriorityFee;

      // Estimate next block base fee (can increase by max 12.5%)
      const estimatedNextBaseFee = (baseFee * 1125n) / 1000n;

      // Calculate max fee: next base fee + priority fee
      // Add 25% buffer for safety
      let maxFeePerGas = ((estimatedNextBaseFee + maxPriorityFeePerGas) * 125n) / 100n;

      // Cap at configured maximum
      const maxFeePerGasLimit = parseGwei(this.config.maxFeePerGasGwei.toString());
      if (maxFeePerGas > maxFeePerGasLimit) {
        maxFeePerGas = maxFeePerGasLimit;
        logger.warn(
          { maxFeePerGasGwei: formatGwei(maxFeePerGas) },
          'Gas price capped at maximum'
        );
      }

      // Legacy gas price for non-EIP-1559 fallback
      const gasPrice = maxFeePerGas;

      const estimate: GasEstimate = {
        maxFeePerGas,
        maxPriorityFeePerGas,
        gasPrice,
        baseFee,
        estimatedNextBaseFee,
      };

      this.lastGasEstimate = estimate;
      this.lastFetchTime = now;

      logger.debug(
        {
          baseFeeGwei: formatGwei(baseFee),
          priorityFeeGwei: formatGwei(maxPriorityFeePerGas),
          maxFeeGwei: formatGwei(maxFeePerGas),
        },
        'Gas estimate calculated'
      );

      return estimate;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch gas estimate');
      
      // Return fallback values
      const fallbackPriorityFee = parseGwei('30');
      const fallbackMaxFee = parseGwei('100');
      
      return {
        maxFeePerGas: fallbackMaxFee,
        maxPriorityFeePerGas: fallbackPriorityFee,
        gasPrice: fallbackMaxFee,
        baseFee: parseGwei('50'),
        estimatedNextBaseFee: parseGwei('56'),
      };
    }
  }

  /**
   * Get aggressive gas params for time-sensitive transactions
   */
  async getAggressiveGasParams(): Promise<{
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }> {
    const estimate = await this.getGasEstimate();
    
    // Increase priority by 50% for aggressive inclusion
    const aggressivePriority = (estimate.maxPriorityFeePerGas * 150n) / 100n;
    const aggressiveMaxFee = estimate.estimatedNextBaseFee + aggressivePriority;

    const maxFeePerGasLimit = parseGwei(this.config.maxFeePerGasGwei.toString());
    
    return {
      maxFeePerGas: aggressiveMaxFee > maxFeePerGasLimit ? maxFeePerGasLimit : aggressiveMaxFee,
      maxPriorityFeePerGas: aggressivePriority,
    };
  }

  private median(values: bigint[]): bigint {
    if (values.length === 0) return parseGwei('30');
    
    const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const mid = Math.floor(sorted.length / 2);
    
    return sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2n;
  }
}
