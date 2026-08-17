/** Serializable order shape used by /api/orders/* and consumed by the UI. */
export interface WireOrder {
  orderId: string;
  txHash: string;
  outputIndex: number;
  user: string;
  merchant: string | null;
  merchantPubkey: string;
  usdcAmount: string;
  fiatCurrency: string;
  fiatAmount: string;
  encryptedPaymentAddr: string;
  status: "Placed" | "Accepted" | "Paid" | "Disputed";
  /** True when the order exists only in the off-chain registry so far —
   *  the place tx was submitted but Blockfrost hasn't indexed it yet.
   *  Shown to merchants immediately; accepting waits for indexing. */
  pending?: boolean;
  acceptDeadline: number;
  completeDeadline: number;
  disputeDeadline: number;
  // Off-chain metadata (populated when the order was placed via this app)
  paymentAddress?: string | null;
  payeeName?: string | null;
  buyerConfirmed?: number | null;
  merchantPaid?: number | null;
  placeTxHash?: string | null;
  acceptTxHash?: string | null;
  buyerConfirmedTxHash?: string | null;
  completeTxHash?: string | null;
}
