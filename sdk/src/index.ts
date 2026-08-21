export * from "./types.js";
export * from "./errors.js";
export * from "./client.js";
// NOTE: blueprint.js is NOT re-exported here because it imports node:fs.
// Server code imports it directly from "@qrpay/sdk/blueprint" (see below).

// Actions — each returns { prepare, execute }
export { placeOrder } from "./actions/placeOrder.js";
export { acceptOrder } from "./actions/acceptOrder.js";
export { setPaymentAddr } from "./actions/setPaymentAddr.js";
export { markPaid } from "./actions/markPaid.js";
export { complete } from "./actions/complete.js";
export { cancelUnaccepted } from "./actions/cancelUnaccepted.js";
export { refund } from "./actions/refund.js";
export { raiseDispute } from "./actions/raiseDispute.js";
export { resolveDispute } from "./actions/resolveDispute.js";

// Identity — CIP-0170 attestations (schema + a minimal anchor/read path)
export { anchorIdentity, identityMetadata, parseIdentityMetadata, provisionalAid, isProvisionalAid } from "./identity/anchor.js";
export type { AnchorIdentityParams, AnchoredIdentity } from "./identity/anchor.js";
export * from "./identity/schema.js";

export type { PlaceOrderParams } from "./actions/placeOrder.js";
export type { AcceptOrderParams } from "./actions/acceptOrder.js";
export type { SetPaymentAddrParams } from "./actions/setPaymentAddr.js";
export type { MarkPaidParams } from "./actions/markPaid.js";
export type { CompleteParams } from "./actions/complete.js";
export type { CancelParams } from "./actions/cancelUnaccepted.js";
export type { RefundParams } from "./actions/refund.js";
export type { RaiseDisputeParams } from "./actions/raiseDispute.js";
export type { ResolveDisputeParams } from "./actions/resolveDispute.js";
