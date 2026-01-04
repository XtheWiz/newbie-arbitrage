/**
 * Signal Port Interface
 * Defines how the strategy engine outputs trading signals
 */

import type { ITradeSignal } from '@polymarket-arb/shared';

export interface ISignalPort {
  /**
   * Publish a trading signal
   */
  publish(signal: ITradeSignal): Promise<void>;

  /**
   * Cancel a previously published signal
   */
  cancel(signalId: string): Promise<void>;
}
