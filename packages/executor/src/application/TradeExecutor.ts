/**
 * Trade Executor
 * Core execution engine with Paper and Live trading modes
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  parseUnits,
  type PublicClient,
  type WalletClient,
  type Address,
  type Hash,
  type TransactionReceipt,
} from 'viem';
import { polygon } from 'viem/chains';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import type { ITradeSignal } from '@polymarket-arb/shared';
import { createLogger } from '@polymarket-arb/shared';
import { GasFetcher } from '../adapters/blockchain/GasFetcher.js';
import { NonceManager } from '../adapters/blockchain/NonceManager.js';
import { CircuitBreaker } from '../adapters/blockchain/CircuitBreaker.js';
import type { ExecutorConfig } from '../infrastructure/config.js';

const logger = createLogger({ name: 'executor:trade' });

/**
 * Execution result from trade
 */
export interface ExecutionResult {
  signalId: string;
  success: boolean;
  mode: 'PAPER' | 'LIVE';
  txHash?: string;
  executedPrice?: number;
  executedSize?: number;
  gasUsed?: bigint;
  gasCost?: string;
  profit?: number;
  error?: string;
  timestamp: number;
}

/**
 * Paper trade simulation result
 */
interface PaperTradeResult {
  simulatedTxHash: string;
  simulatedPrice: number;
  simulatedSize: number;
  simulatedProfit: number;
  slippage: number;
}

/**
 * Main Trade Executor class
 * Supports both Paper (simulation) and Live (on-chain) trading
 */
export class TradeExecutor {
  private config: ExecutorConfig;
  private publicClient: PublicClient;
  private walletClient: WalletClient | null = null;
  private account: PrivateKeyAccount | null = null;
  
  private gasFetcher: GasFetcher;
  private nonceManager: NonceManager;
  private circuitBreaker: CircuitBreaker;
  
  private paperTradeCount = 0;
  private paperProfitTotal = 0;
  private liveTradeCount = 0;

  constructor(config: ExecutorConfig) {
    this.config = config;

    // Initialize public client for reading
    this.publicClient = createPublicClient({
      chain: polygon,
      transport: http(config.polygonRpcUrl),
    });

    // Initialize components
    this.gasFetcher = new GasFetcher({
      rpcUrl: config.polygonRpcUrl,
      chainId: config.chainId,
      maxFeePerGasGwei: config.maxFeePerGasGwei,
      priorityFeeMultiplier: config.priorityFeeMultiplier,
    });

    this.nonceManager = new NonceManager({
      rpcUrl: config.polygonRpcUrl,
      chainId: config.chainId,
      maxConcurrentTx: config.maxConcurrentTx,
      lockTimeoutMs: config.nonceLockTimeoutMs,
    });

    this.circuitBreaker = new CircuitBreaker({
      rpcUrl: config.polygonRpcUrl,
      minBalanceUSDC: config.minBalanceUSDC,
      maxConsecutiveReverts: config.maxConsecutiveReverts,
      cooldownMs: config.circuitBreakerCooldownMs,
      usdcAddress: config.usdcAddress as Address,
    });

    // Initialize wallet for LIVE mode
    if (config.mode === 'LIVE' && config.privateKey) {
      this.account = privateKeyToAccount(`0x${config.privateKey.replace('0x', '')}`);
      this.walletClient = createWalletClient({
        account: this.account,
        chain: polygon,
        transport: http(config.polygonRpcUrl),
      });
      
      logger.info({ address: this.account.address, mode: 'LIVE' }, 'Wallet initialized');
    } else {
      logger.info({ mode: 'PAPER' }, 'Running in paper trading mode');
    }
  }

  /**
   * Initialize the executor
   */
  async initialize(): Promise<void> {
    if (this.account) {
      await this.nonceManager.initialize(this.account.address);
      await this.circuitBreaker.initialize(this.account.address);
    }
    
    logger.info(
      { mode: this.config.mode, circuitBreaker: this.circuitBreaker.getStatus() },
      'Trade executor initialized'
    );
  }

  /**
   * Execute a trade signal
   */
  async execute(signal: ITradeSignal): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Check circuit breaker
    const canTrade = await this.circuitBreaker.canTrade();
    if (!canTrade.allowed) {
      logger.warn({ signalId: signal.signalId, reason: canTrade.reason }, 'Trade blocked by circuit breaker');
      return {
        signalId: signal.signalId,
        success: false,
        mode: this.config.mode,
        error: canTrade.reason,
        timestamp: startTime,
      };
    }

    // Route to appropriate execution mode
    if (this.config.mode === 'PAPER') {
      return this.executePaperTrade(signal);
    } else {
      return this.executeLiveTrade(signal);
    }
  }

  /**
   * Execute paper trade (simulation)
   */
  private async executePaperTrade(signal: ITradeSignal): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Simulate execution with slippage
      const result = this.simulatePaperTrade(signal);

      this.paperTradeCount++;
      this.paperProfitTotal += result.simulatedProfit;

      logger.info(
        {
          signalId: signal.signalId,
          action: signal.action,
          price: result.simulatedPrice,
          size: result.simulatedSize,
          profit: result.simulatedProfit,
          totalPaperProfit: this.paperProfitTotal,
          tradeCount: this.paperTradeCount,
        },
        '📝 PAPER TRADE executed'
      );

      this.circuitBreaker.recordSuccess();

      return {
        signalId: signal.signalId,
        success: true,
        mode: 'PAPER',
        txHash: result.simulatedTxHash,
        executedPrice: result.simulatedPrice,
        executedSize: result.simulatedSize,
        profit: result.simulatedProfit,
        timestamp: startTime,
      };
    } catch (error) {
      logger.error({ error, signalId: signal.signalId }, 'Paper trade simulation failed');
      
      return {
        signalId: signal.signalId,
        success: false,
        mode: 'PAPER',
        error: error instanceof Error ? error.message : 'Simulation failed',
        timestamp: startTime,
      };
    }
  }

  /**
   * Simulate a paper trade with realistic slippage
   */
  private simulatePaperTrade(signal: ITradeSignal): PaperTradeResult {
    // Simulate slippage (random 0.1% - 0.5%)
    const slippagePercent = 0.001 + Math.random() * 0.004;
    const slippageDirection = signal.action.startsWith('BUY') ? 1 : -1;
    
    const executedPrice = signal.price * (1 + slippagePercent * slippageDirection);
    const executedSize = signal.size;

    // Calculate simulated profit
    // For arbitrage: profit = expectedProfit - slippage cost
    const slippageCost = signal.size * slippagePercent;
    const simulatedProfit = signal.expectedProfit - slippageCost;

    // Generate fake transaction hash
    const simulatedTxHash = `0x${'PAPER'.padEnd(8, '0')}${Date.now().toString(16).padStart(56, '0')}`;

    return {
      simulatedTxHash,
      simulatedPrice: executedPrice,
      simulatedSize: executedSize,
      simulatedProfit: Math.max(0, simulatedProfit),
      slippage: slippagePercent,
    };
  }

  /**
   * Execute live trade on-chain
   */
  private async executeLiveTrade(signal: ITradeSignal): Promise<ExecutionResult> {
    const startTime = Date.now();

    if (!this.walletClient || !this.account) {
      return {
        signalId: signal.signalId,
        success: false,
        mode: 'LIVE',
        error: 'Wallet not configured for LIVE mode',
        timestamp: startTime,
      };
    }

    let nonce: number | null = null;

    try {
      // Check if we can accept more transactions
      if (!this.nonceManager.canAcceptTransaction()) {
        return {
          signalId: signal.signalId,
          success: false,
          mode: 'LIVE',
          error: 'Max concurrent transactions reached',
          timestamp: startTime,
        };
      }

      // Acquire nonce
      nonce = await this.nonceManager.acquireNonce();

      // Get gas parameters
      const gasParams = await this.gasFetcher.getAggressiveGasParams();

      logger.info(
        {
          signalId: signal.signalId,
          action: signal.action,
          nonce,
          maxFeePerGas: formatUnits(gasParams.maxFeePerGas, 9) + ' gwei',
        },
        '🚀 Executing LIVE trade'
      );

      // Build and send transaction
      // NOTE: This is a placeholder - actual implementation depends on Polymarket contracts
      const txHash = await this.sendTradeTransaction(signal, nonce, gasParams);

      this.nonceManager.markNonceSent(nonce, txHash);

      // Wait for receipt
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 60000, // 60 second timeout
      });

      if (receipt.status === 'success') {
        this.nonceManager.releaseNonce(nonce, true);
        this.circuitBreaker.recordSuccess();
        this.liveTradeCount++;

        const gasCost = formatUnits(
          receipt.gasUsed * receipt.effectiveGasPrice,
          18
        );

        logger.info(
          {
            signalId: signal.signalId,
            txHash,
            gasUsed: receipt.gasUsed.toString(),
            gasCost: gasCost + ' MATIC',
          },
          '✅ LIVE trade successful'
        );

        return {
          signalId: signal.signalId,
          success: true,
          mode: 'LIVE',
          txHash,
          executedPrice: signal.price, // TODO: Extract from logs
          executedSize: signal.size,
          gasUsed: receipt.gasUsed,
          gasCost,
          timestamp: startTime,
        };
      } else {
        // Transaction reverted
        this.nonceManager.releaseNonce(nonce, true); // Nonce was used
        this.circuitBreaker.recordRevert('Transaction reverted');

        logger.error({ signalId: signal.signalId, txHash }, '❌ LIVE trade reverted');

        return {
          signalId: signal.signalId,
          success: false,
          mode: 'LIVE',
          txHash,
          error: 'Transaction reverted',
          timestamp: startTime,
        };
      }
    } catch (error) {
      // Release nonce if we haven't sent the transaction
      if (nonce !== null) {
        this.nonceManager.releaseNonce(nonce, false);
      }

      this.circuitBreaker.recordRevert(error instanceof Error ? error.message : 'Unknown error');

      logger.error({ error, signalId: signal.signalId }, '❌ LIVE trade failed');

      return {
        signalId: signal.signalId,
        success: false,
        mode: 'LIVE',
        error: error instanceof Error ? error.message : 'Transaction failed',
        timestamp: startTime,
      };
    }
  }

  /**
   * Send the actual trade transaction
   * NOTE: This is a placeholder - implement actual Polymarket contract calls
   */
  private async sendTradeTransaction(
    signal: ITradeSignal,
    nonce: number,
    gasParams: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }
  ): Promise<Hash> {
    if (!this.walletClient || !this.account) {
      throw new Error('Wallet not initialized');
    }

    // TODO: Implement actual Polymarket CTF Exchange contract call
    // This is a placeholder that would be replaced with actual contract interaction
    
    // For now, throw to indicate not implemented
    throw new Error('Live trading not yet implemented - contract interaction required');

    // Example of what the actual implementation would look like:
    /*
    const hash = await this.walletClient.writeContract({
      address: this.config.ctfExchangeAddress as Address,
      abi: CTF_EXCHANGE_ABI,
      functionName: 'fillOrder',
      args: [...],
      nonce,
      ...gasParams,
    });
    
    return hash;
    */
  }

  /**
   * Get executor statistics
   */
  getStats(): {
    mode: string;
    paperTrades: number;
    paperProfit: number;
    liveTrades: number;
    circuitBreaker: ReturnType<CircuitBreaker['getStatus']>;
    pendingNonces: number;
  } {
    return {
      mode: this.config.mode,
      paperTrades: this.paperTradeCount,
      paperProfit: this.paperProfitTotal,
      liveTrades: this.liveTradeCount,
      circuitBreaker: this.circuitBreaker.getStatus(),
      pendingNonces: this.nonceManager.getPendingCount(),
    };
  }

  /**
   * Reset circuit breaker manually
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
  }

  /**
   * Force resync nonces
   */
  async resyncNonces(): Promise<void> {
    await this.nonceManager.forceResync();
  }
}
