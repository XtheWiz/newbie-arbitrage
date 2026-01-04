/**
 * Signal Generator
 * 
 * 🚀 RUST-PORTABLE: Converts trade recommendations to signal format.
 */

import type { TradeRecommendation, StrategyConfig } from './types.js';

export interface Signal {
  action: 'BUY_YES' | 'BUY_NO' | 'SELL_YES' | 'SELL_NO';
  price: number;
  size: number;
  confidence: number;
  expectedProfit: number;
  urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  ttlMs: number;
}

/**
 * Determine signal urgency based on opportunity characteristics
 */
export function determineUrgency(
  spread: number,
  confidence: number,
  config: StrategyConfig
): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  // Higher spread + higher confidence = more urgent
  const urgencyScore = spread * 10 + confidence * 0.5;

  if (urgencyScore > 0.8) return 'CRITICAL';
  if (urgencyScore > 0.5) return 'HIGH';
  if (urgencyScore > 0.3) return 'MEDIUM';
  return 'LOW';
}

/**
 * Calculate TTL based on market conditions
 * Faster markets need shorter TTL
 */
export function calculateTTL(
  urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
  volume24h: number
): number {
  const baseTTL = {
    LOW: 10000,      // 10 seconds
    MEDIUM: 5000,    // 5 seconds
    HIGH: 2000,      // 2 seconds
    CRITICAL: 1000,  // 1 second
  };

  // Reduce TTL for high-volume markets
  const volumeFactor = volume24h > 100000 ? 0.5 : 1;
  
  return Math.round(baseTTL[urgency] * volumeFactor);
}

/**
 * Generate a trading signal from a recommendation
 */
export function generateSignal(
  recommendation: TradeRecommendation,
  spread: number,
  volume24h: number,
  config: StrategyConfig
): Signal | null {
  if (!recommendation.shouldTrade) {
    return null;
  }

  const confidence = recommendation.riskAdjustedReturn > 1 
    ? Math.min(recommendation.riskAdjustedReturn / 5, 1)
    : recommendation.riskAdjustedReturn;

  const urgency = determineUrgency(spread, confidence, config);
  const ttlMs = calculateTTL(urgency, volume24h);

  // Determine action based on side
  const action: Signal['action'] = recommendation.side === 'YES' ? 'BUY_YES' : 'BUY_NO';

  return {
    action,
    price: recommendation.maxPrice,
    size: recommendation.size,
    confidence,
    expectedProfit: recommendation.expectedProfit,
    urgency,
    ttlMs,
  };
}
