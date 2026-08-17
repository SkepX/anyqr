use aiken/crypto.{VerificationKeyHash}
use cardano/assets.{AssetName, PolicyId}

/// Lifecycle of a single escrow order.
///
/// Placed    -> user locked USDC; awaiting a merchant to accept.
/// Accepted  -> a merchant took the order; user should push encrypted UPI id.
/// Paid      -> user (or merchant, in fast-path) signalled fiat leg completed.
///              Merchant can now claim USDC after the dispute window elapses
///              unless a dispute is raised.
/// Disputed  -> either party escalated; admin resolves.
pub type Status {
  Placed
  Accepted
  Paid
  Disputed
}

/// A single order lives as a UTXO at the escrow validator address.
/// The `usdc_amount` of asset `(usdc_policy, usdc_name)` is locked alongside.
pub type Order {
  /// Unique id. In practice = tx hash of the placeOrder tx, set off-chain
  /// so the SDK can reference it before the tx confirms.
  order_id: ByteArray,
  /// Pkh of the user who placed the order.
  user: VerificationKeyHash,
  /// Pkh of the merchant who accepted. `None` until Accepted.
  merchant: Option<VerificationKeyHash>,
  /// Merchant's secp256k1 pubkey (uncompressed, no 0x04 prefix) for ECIES
  /// encryption of the payment address. Empty until Accepted.
  merchant_pubkey: ByteArray,
  /// Which asset is escrowed.
  usdc_policy: PolicyId,
  usdc_name: AssetName,
  /// Amount of USDC (6dp).
  usdc_amount: Int,
  /// Fiat currency code, e.g. "INR".
  fiat_currency: ByteArray,
  /// Fiat amount in the smallest unit (paise, cents, etc).
  fiat_amount: Int,
  /// ECIES ciphertext of the target UPI/PIX/etc address, encrypted for the
  /// merchant. Empty until user pushes it via SetPaymentAddr.
  encrypted_payment_addr: ByteArray,
  /// Current lifecycle status.
  status: Status,
  /// POSIX ms after which the user can cancel if no merchant accepted.
  accept_deadline: Int,
  /// POSIX ms after which the user can force-refund if the merchant
  /// accepted but never called Complete.
  complete_deadline: Int,
  /// POSIX ms until which the user can dispute after MarkPaid.
  dispute_deadline: Int,
  /// Admin (resolver) pkh. Only used on Resolve.
  admin: VerificationKeyHash,
}

/// Actions on an escrow UTXO.
pub type Action {
  /// Merchant claims the order and publishes their ECIES pubkey.
  Accept { merchant: VerificationKeyHash, merchant_pubkey: ByteArray }
  /// User attaches the encrypted payment address after seeing merchant pubkey.
  SetPaymentAddr { encrypted: ByteArray }
  /// User (or fast-path merchant) marks the fiat leg as sent. Starts dispute
  /// window.
  MarkPaid
  /// Merchant claims the locked USDC. Only valid after dispute_deadline
  /// and while status is Paid.
  Complete
  /// User cancels an unaccepted order and reclaims USDC.
  CancelUnaccepted
  /// User force-refunds after the merchant accepted but never completed.
  Refund
  /// Either party escalates to admin.
  RaiseDispute
  /// Admin decides winner. `to_merchant: True` -> USDC to merchant.
  Resolve { to_merchant: Bool }
}
