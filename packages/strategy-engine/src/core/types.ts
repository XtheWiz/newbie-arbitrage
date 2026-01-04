/**
 * Core Math Types
 * 
 * 🚀 RUST-PORTABLE: These types have no I/O dependencies and map directly
 * to Rust structs. Keep free of any Node.js, Redis, or external dependencies.
 */

/**
 * Represents a detected arbitrage opportunity
 */
export interface ArbitrageOpportunity {
  /** Spread = 1 - (yesPrice + noPrice). Positive = profit opportunity */
  spread: number;
  /** Whether the opportunity is profitable after fees */
  profitable: boolean;
  /** Expected profit per unit (before slippage) */
  expectedProfitPerUnit: number;
  /** Optimal side to trade: 'YES' if buying YES is better, 'NO' otherwise */
  optimalSide: 'YES' | 'NO';
  /** Confidence score 0-1 based on liquidity and spread stability */
  confidence: number;
}

/**
 * Trade recommendation from the strategy engine
 */
export interface TradeRecommendation {
  /** Should we execute this trade? */
  shouldTrade: boolean;
  /** Side to trade */
  side: 'YES' | 'NO';
  /** Recommended position size in tokens */
  size: number;
  /** Maximum price to pay */
  maxPrice: number;
  /** Expected profit in USDC */
  expectedProfit: number;
  /** Risk-adjusted score */
  riskAdjustedReturn: number;
  /** Reason if not trading */
  reason?: string;
}

/**
 * Market snapshot for strategy calculations
 * Minimal data needed for pure math calculations
 */
export interface MarketSnapshot {
  yesPrice: number;
  noPrice: number;
  yesBidDepth: number;
  yesAskDepth: number;
  noBidDepth: number;
  noAskDepth: number;
  volume24h: number;
}

/**
 * Strategy configuration parameters
 */
export interface StrategyConfig {
  /** Minimum spread to consider (e.g., 0.02 = 2%) */
  minSpread: number;
  /** Maximum position size in USDC */
  maxPositionSize: number;
  /** Trading fee percentage (e.g., 0.001 = 0.1%) */
  feePercent: number;
  /** Maximum acceptable slippage */
  maxSlippage: number;
  /** Minimum liquidity required */
  minLiquidity: number;
  /** Risk factor 0-1 (lower = more conservative) */
  riskFactor: number;
}

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  minSpread: 0.02,
  maxPositionSize: 1000,
  feePercent: 0.001,
  maxSlippage: 0.005,
  minLiquidity: 500,
  riskFactor: 0.5,
};
