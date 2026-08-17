use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/interval.{Finite, Interval, IntervalBound}

use cardano/address.{Address, VerificationKey}
use cardano/assets.{Value, quantity_of}
use cardano/transaction.{Output}
use qrpay/types.{Order}

/// True if the transaction is signed by `pkh`.
pub fn signed_by(signatories: List<VerificationKeyHash>, pkh: VerificationKeyHash) -> Bool {
  list.has(signatories, pkh)
}

/// Lower bound of the tx validity range in POSIX ms.
/// Fails compile if the range is unbounded — we require a lower bound for
/// every state transition that reads time.
pub fn lower_bound(range: Interval) -> Int {
  when range.lower_bound is {
    IntervalBound { bound_type: Finite(t), .. } -> t
    _ -> fail @"tx validity range must have a finite lower bound"
  }
}

/// Upper bound of the tx validity range in POSIX ms.
pub fn upper_bound(range: Interval) -> Int {
  when range.upper_bound is {
    IntervalBound { bound_type: Finite(t), .. } -> t
    _ -> fail @"tx validity range must have a finite upper bound"
  }
}

/// Find exactly one continuing output paying to `own_address`. Returns its
/// datum-inline order and value. Fails if there is 0 or >1 continuing output.
pub fn find_continuing_output(
  outputs: List<Output>,
  own_address: Address,
) -> Output {
  let matches = list.filter(outputs, fn(o) { o.address == own_address })
  when matches is {
    [only] -> only
    _ -> fail @"expected exactly one continuing output"
  }
}

/// Value of a specific asset held in `val`.
pub fn asset_qty(val: Value, policy: ByteArray, name: ByteArray) -> Int {
  quantity_of(val, policy, name)
}

/// Common invariant check on a continuing output: escrow value preserved,
/// order id unchanged, participants unchanged (unless explicitly updated).
pub fn preserves_escrow(
  new_out: Output,
  old_order: Order,
  new_order: Order,
) -> Bool {
  and {
    // USDC value preserved
    asset_qty(new_out.value, old_order.usdc_policy, old_order.usdc_name) == old_order.usdc_amount,
    // order id immutable
    new_order.order_id == old_order.order_id,
    // asset descriptor immutable
    new_order.usdc_policy == old_order.usdc_policy,
    new_order.usdc_name == old_order.usdc_name,
    new_order.usdc_amount == old_order.usdc_amount,
    // fiat leg immutable
    new_order.fiat_currency == old_order.fiat_currency,
    new_order.fiat_amount == old_order.fiat_amount,
    // participants immutable
    new_order.user == old_order.user,
    new_order.admin == old_order.admin,
    // deadlines immutable (they're set at placement)
    new_order.accept_deadline == old_order.accept_deadline,
    new_order.complete_deadline == old_order.complete_deadline,
  }
}

/// Sum of a specific asset paid to a given verification key address.
pub fn value_paid_to_pkh(
  outputs: List<Output>,
  pkh: VerificationKeyHash,
  policy: ByteArray,
  name: ByteArray,
) -> Int {
  list.foldr(
    outputs,
    0,
    fn(o, acc) {
      when o.address.payment_credential is {
        VerificationKey(h) ->
          if h == pkh {
            acc + asset_qty(o.value, policy, name)
          } else {
            acc
          }
        _ -> acc
      }
    },
  )
}
