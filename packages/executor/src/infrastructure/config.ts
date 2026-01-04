/**
 * Executor Configuration
 */

import { z } from 'zod';

export const executorConfigSchema = z.object({
  // Trading mode
  mode: z.enum(['PAPER', 'LIVE']).default('PAPER'),
  
  // Polygon RPC configuration
  polygonRpcUrl: z.string().url(),
  chainId: z.number().default(137), // Polygon mainnet
  
  // Wallet configuration
  privateKey: z.string().min(64).optional(), // Required for LIVE mode
  
  // Gas configuration
  maxFeePerGasGwei: z.number().default(500), // Max 500 gwei
  priorityFeeMultiplier: z.number().default(1.5), // 1.5x the base priority fee
  gasLimitBuffer: z.number().default(1.2), // 20% buffer on gas estimates
  
  // Nonce management
  maxConcurrentTx: z.number().default(5),
  nonceLockTimeoutMs: z.number().default(30000), // 30s
  
  // Circuit breaker
  minBalanceUSDC: z.number().default(100), // Stop if balance < 100 USDC
  maxConsecutiveReverts: z.number().default(3),
  circuitBreakerCooldownMs: z.number().default(300000), // 5 min cooldown
  
  // Polymarket specific
  polymarketApiUrl: z.string().default('https://clob.polymarket.com'),
  usdcAddress: z.string().default('0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'), // Polygon USDC
  ctfExchangeAddress: z.string().default('0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E'), // CTF Exchange
});

export type ExecutorConfig = z.infer<typeof executorConfigSchema>;

export const DEFAULT_EXECUTOR_CONFIG: Partial<ExecutorConfig> = {
  mode: 'PAPER',
  chainId: 137,
  maxFeePerGasGwei: 500,
  priorityFeeMultiplier: 1.5,
  gasLimitBuffer: 1.2,
  maxConcurrentTx: 5,
  nonceLockTimeoutMs: 30000,
  minBalanceUSDC: 100,
  maxConsecutiveReverts: 3,
  circuitBreakerCooldownMs: 300000,
};

/**
 * Load executor configuration from environment
 */
export function loadExecutorConfig(): ExecutorConfig {
  const config = {
    mode: process.env.EXECUTOR_MODE ?? 'PAPER',
    polygonRpcUrl: process.env.POLYGON_RPC_URL ?? 'https://polygon-rpc.com',
    chainId: parseInt(process.env.POLYGON_CHAIN_ID ?? '137', 10),
    privateKey: process.env.PRIVATE_KEY,
    maxFeePerGasGwei: parseFloat(process.env.MAX_FEE_PER_GAS_GWEI ?? '500'),
    priorityFeeMultiplier: parseFloat(process.env.PRIORITY_FEE_MULTIPLIER ?? '1.5'),
    gasLimitBuffer: parseFloat(process.env.GAS_LIMIT_BUFFER ?? '1.2'),
    maxConcurrentTx: parseInt(process.env.MAX_CONCURRENT_TX ?? '5', 10),
    nonceLockTimeoutMs: parseInt(process.env.NONCE_LOCK_TIMEOUT_MS ?? '30000', 10),
    minBalanceUSDC: parseFloat(process.env.MIN_BALANCE_USDC ?? '100'),
    maxConsecutiveReverts: parseInt(process.env.MAX_CONSECUTIVE_REVERTS ?? '3', 10),
    circuitBreakerCooldownMs: parseInt(process.env.CIRCUIT_BREAKER_COOLDOWN_MS ?? '300000', 10),
    polymarketApiUrl: process.env.POLYMARKET_API_URL ?? 'https://clob.polymarket.com',
    usdcAddress: process.env.USDC_ADDRESS ?? '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    ctfExchangeAddress: process.env.CTF_EXCHANGE_ADDRESS ?? '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
  };

  return executorConfigSchema.parse(config);
}
