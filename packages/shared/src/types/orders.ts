/**
 * Order Types
 */

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET' | 'FOK' | 'GTC';
export type OrderStatus =
  | 'PENDING'
  | 'OPEN'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REJECTED';

export interface Order {
  orderId: string;
  marketId: string;
  tokenId: string;
  side: OrderSide;
  type: OrderType;
  price: number;
  size: number;
  filledSize: number;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
}

export interface OrderRequest {
  marketId: string;
  tokenId: string;
  side: OrderSide;
  type: OrderType;
  price: number;
  size: number;
  expiresAt?: number;
}

export interface OrderResult {
  success: boolean;
  order?: Order;
  error?: string;
  txHash?: string;
}
