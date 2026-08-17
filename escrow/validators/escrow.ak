//// QRPay escrow validator.
////
//// Each order lives at its own UTXO of this validator. The datum is an
//// `Order`, the redeemer an `Action`. Every state transition either:
//// (a) produces a continuing output at the same address with an updated
////     datum and preserved escrow value, or
//// (b) releases the escrowed USDC to a specific party (user or merchant)
////     and terminates the order.

use aiken/collection/list
use aiken/interval
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{from_asset, from_lovelace, merge}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction, placeholder,
}
use qrpay/helpers.{
  find_continuing_output, lower_bound, preserves_escrow, signed_by,
  value_paid_to_pkh,
}
use qrpay/types.{
  Accept, Accepted, Action, CancelUnaccepted, Complete, Disputed, MarkPaid,
  Order, Paid, Placed, RaiseDispute, Refund, Resolve, SetPaymentAddr,
}

validator escrow {
  spend(
    datum_opt: Option<Order>,
    action: Action,
    utxo_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(order) = datum_opt
    let signers = tx.extra_signatories

    // Locate the input we are spending so we can find its address for
    // continuing-output checks.
    expect Some(own_input) =
      list.find(tx.inputs, fn(i) { i.output_reference == utxo_ref })
    let own_address: Address = own_input.output.address

    when action is {
      // --- merchant claims the order ------------------------------------
      Accept { merchant, merchant_pubkey } -> {
        expect order.status == Placed
        expect signed_by(signers, merchant)
        // must be before accept_deadline
        expect lower_bound(tx.validity_range) < order.accept_deadline
        // continuing output with updated datum
        let cont = find_continuing_output(tx.outputs, own_address)
        expect InlineDatum(new_data) = cont.datum
        expect new_order: Order = new_data
        and {
          preserves_escrow(cont, order, new_order),
          new_order.status == Accepted,
          new_order.merchant == Some(merchant),
          new_order.merchant_pubkey == merchant_pubkey,
          // dispute deadline is set later when MarkPaid runs
          new_order.dispute_deadline == order.dispute_deadline,
          // encrypted_payment_addr is preserved as empty for now
          new_order.encrypted_payment_addr == order.encrypted_payment_addr,
        }
      }

      // --- user attaches encrypted payment address ----------------------
      SetPaymentAddr { encrypted } -> {
        expect order.status == Accepted
        expect signed_by(signers, order.user)
        let cont = find_continuing_output(tx.outputs, own_address)
        expect InlineDatum(new_data) = cont.datum
        expect new_order: Order = new_data
        and {
          preserves_escrow(cont, order, new_order),
          new_order.status == Accepted,
          new_order.merchant == order.merchant,
          new_order.merchant_pubkey == order.merchant_pubkey,
          new_order.encrypted_payment_addr == encrypted,
          new_order.dispute_deadline == order.dispute_deadline,
        }
      }

      // --- user (or merchant) signals fiat leg complete ------------------
      MarkPaid -> {
        // Debug: emit which status we saw so we can tell if the enum tag is
        // encoded differently than expected.
        trace @"markpaid.saw_status": order.status
        trace @"markpaid.expected_Accepted": Accepted
        trace @"markpaid.expected_Placed": Placed
        trace @"markpaid.expected_Paid": Paid
        expect (order.status == Accepted)?
        expect Some(m) = order.merchant
        expect (signed_by(signers, order.user) || signed_by(signers, m))?
        let now = lower_bound(tx.validity_range)
        let cont = find_continuing_output(tx.outputs, own_address)
        expect InlineDatum(new_data) = cont.datum
        expect new_order: Order = new_data
        and {
          preserves_escrow(cont, order, new_order)?,
          (new_order.status == Paid)?,
          (new_order.merchant == order.merchant)?,
          (new_order.merchant_pubkey == order.merchant_pubkey)?,
          (new_order.encrypted_payment_addr == order.encrypted_payment_addr)?,
          (new_order.dispute_deadline >= now + 60_000)?,
          (new_order.dispute_deadline <= now + 1_800_000)?,
        }
      }

      // --- USDC released to merchant after dispute window ----------------
      // No signature required: anyone (in practice our server bot) may
      // trigger the release, because the escrowed USDC can only go to
      // the merchant and only after the dispute deadline. This is what
      // makes the release automatic — no wallet popup for the merchant.
      Complete -> {
        expect order.status == Paid
        expect Some(m) = order.merchant
        // must be after dispute_deadline
        expect lower_bound(tx.validity_range) > order.dispute_deadline
        // merchant must receive the full escrowed USDC
        let received =
          value_paid_to_pkh(
            tx.outputs,
            m,
            order.usdc_policy,
            order.usdc_name,
          )
        received >= order.usdc_amount
      }

      // --- user cancels before merchant accepts --------------------------
      CancelUnaccepted -> {
        expect order.status == Placed
        expect signed_by(signers, order.user)
        let received =
          value_paid_to_pkh(
            tx.outputs,
            order.user,
            order.usdc_policy,
            order.usdc_name,
          )
        received >= order.usdc_amount
      }

      // --- user force-refunds after a no-show merchant -------------------
      Refund -> {
        // valid if accepted but merchant never called Complete
        expect or {
          order.status == Accepted,
          order.status == Paid && lower_bound(tx.validity_range) > order.complete_deadline,
        }
        expect signed_by(signers, order.user)
        // if just Accepted, allow after complete_deadline
        expect lower_bound(tx.validity_range) > order.complete_deadline
        let received =
          value_paid_to_pkh(
            tx.outputs,
            order.user,
            order.usdc_policy,
            order.usdc_name,
          )
        received >= order.usdc_amount
      }

      // --- either party escalates ---------------------------------------
      RaiseDispute -> {
        expect Some(m) = order.merchant
        expect signed_by(signers, order.user) || signed_by(signers, m)
        // only valid mid-flight
        expect or {
          order.status == Accepted,
          order.status == Paid,
        }
        let cont = find_continuing_output(tx.outputs, own_address)
        expect InlineDatum(new_data) = cont.datum
        expect new_order: Order = new_data
        and {
          preserves_escrow(cont, order, new_order),
          new_order.status == Disputed,
          new_order.merchant == order.merchant,
          new_order.merchant_pubkey == order.merchant_pubkey,
          new_order.encrypted_payment_addr == order.encrypted_payment_addr,
          new_order.dispute_deadline == order.dispute_deadline,
        }
      }

      // --- admin resolves a dispute -------------------------------------
      Resolve { to_merchant } -> {
        expect order.status == Disputed
        expect signed_by(signers, order.admin)
        let target =
          if to_merchant {
            expect Some(m) = order.merchant
            m
          } else {
            order.user
          }
        let received =
          value_paid_to_pkh(
            tx.outputs,
            target,
            order.usdc_policy,
            order.usdc_name,
          )
        received >= order.usdc_amount
      }
    }
  }

  else(_ctx) {
    fail @"escrow validator does not accept other script purposes"
  }
}

// ============================================================================
// Tests
// ============================================================================

const t_usdc_policy: ByteArray = #"aaaa"

const t_usdc_name: ByteArray = #"55534443"

const t_user_pkh: ByteArray = #"11111111111111111111111111111111111111111111111111111111"

const t_merchant_pkh: ByteArray = #"22222222222222222222222222222222222222222222222222222222"

const t_admin_pkh: ByteArray = #"33333333333333333333333333333333333333333333333333333333"

const t_merchant_pubkey: ByteArray = #"0403040304030403040304030403040304030403040304030403040304030403"

const t_escrow_hash: ByteArray = #"9999999999999999999999999999999999999999999999999999999999999999"

fn t_escrow_addr() -> Address {
  Address { payment_credential: Script(t_escrow_hash), stake_credential: None }
}

fn t_base_order() -> Order {
  Order {
    order_id: #"deadbeef",
    user: t_user_pkh,
    merchant: None,
    merchant_pubkey: #"",
    usdc_policy: t_usdc_policy,
    usdc_name: t_usdc_name,
    usdc_amount: 1_000_000,
    fiat_currency: "INR",
    fiat_amount: 850_000,
    encrypted_payment_addr: #"",
    status: Placed,
    accept_deadline: 2_000_000,
    complete_deadline: 5_000_000,
    dispute_deadline: 0,
    admin: t_admin_pkh,
  }
}

fn t_escrow_utxo(order: Order) -> Input {
  Input {
    output_reference: OutputReference { transaction_id: #"cafe", output_index: 0 },
    output: Output {
      address: t_escrow_addr(),
      value: merge(
        from_lovelace(2_000_000),
        from_asset(order.usdc_policy, order.usdc_name, order.usdc_amount),
      ),
      datum: InlineDatum(order),
      reference_script: None,
    },
  }
}

fn t_continuing_output(new_order: Order) -> Output {
  Output {
    address: t_escrow_addr(),
    value: merge(
      from_lovelace(2_000_000),
      from_asset(new_order.usdc_policy, new_order.usdc_name, new_order.usdc_amount),
    ),
    datum: InlineDatum(new_order),
    reference_script: None,
  }
}

fn t_payout(pkh: ByteArray, amount: Int) -> Output {
  Output {
    address: Address {
      payment_credential: VerificationKey(pkh),
      stake_credential: None,
    },
    value: from_asset(t_usdc_policy, t_usdc_name, amount),
    datum: NoDatum,
    reference_script: None,
  }
}

test accept_happy_path() {
  let order = t_base_order()
  let new_order =
    Order { ..order,
      merchant: Some(t_merchant_pkh),
      merchant_pubkey: t_merchant_pubkey,
      status: Accepted,
    }
  let input = t_escrow_utxo(order)
  let tx =
    Transaction { ..placeholder,
      inputs: [input],
      outputs: [t_continuing_output(new_order)],
      extra_signatories: [t_merchant_pkh],
      validity_range: interval.between(1_000_000, 1_500_000),
    }
  escrow.spend(
    Some(order),
    Accept {
      merchant: t_merchant_pkh,
      merchant_pubkey: t_merchant_pubkey,
    },
    input.output_reference,
    tx,
  )
}

test accept_fails_without_merchant_signature() fail {
  let order = t_base_order()
  let new_order =
    Order { ..order,
      merchant: Some(t_merchant_pkh),
      merchant_pubkey: t_merchant_pubkey,
      status: Accepted,
    }
  let input = t_escrow_utxo(order)
  let tx =
    Transaction { ..placeholder,
      inputs: [input],
      outputs: [t_continuing_output(new_order)],
      extra_signatories: [],
      validity_range: interval.between(1_000_000, 1_500_000),
    }
  escrow.spend(
    Some(order),
    Accept {
      merchant: t_merchant_pkh,
      merchant_pubkey: t_merchant_pubkey,
    },
    input.output_reference,
    tx,
  )
}

test accept_fails_after_deadline() fail {
  let order = t_base_order()
  let new_order =
    Order { ..order,
      merchant: Some(t_merchant_pkh),
      merchant_pubkey: t_merchant_pubkey,
      status: Accepted,
    }
  let input = t_escrow_utxo(order)
  let tx =
    Transaction { ..placeholder,
      inputs: [input],
      outputs: [t_continuing_output(new_order)],
      extra_signatories: [t_merchant_pkh],
      validity_range: interval.between(3_000_000, 3_500_000),
    }
  escrow.spend(
    Some(order),
    Accept {
      merchant: t_merchant_pkh,
      merchant_pubkey: t_merchant_pubkey,
    },
    input.output_reference,
    tx,
  )
}

test cancel_unaccepted_happy_path() {
  let order = t_base_order()
  let input = t_escrow_utxo(order)
  let tx =
    Transaction { ..placeholder,
      inputs: [input],
      outputs: [t_payout(t_user_pkh, order.usdc_amount)],
      extra_signatories: [t_user_pkh],
      validity_range: interval.between(1_000_000, 1_500_000),
    }
  escrow.spend(Some(order), CancelUnaccepted, input.output_reference, tx)
}

test cancel_fails_if_accepted() fail {
  let order =
    Order { ..t_base_order(),
      status: Accepted,
      merchant: Some(t_merchant_pkh),
      merchant_pubkey: t_merchant_pubkey,
    }
  let input = t_escrow_utxo(order)
  let tx =
    Transaction { ..placeholder,
      inputs: [input],
      outputs: [t_payout(t_user_pkh, order.usdc_amount)],
      extra_signatories: [t_user_pkh],
      validity_range: interval.between(1_000_000, 1_500_000),
    }
  escrow.spend(Some(order), CancelUnaccepted, input.output_reference, tx)
}

test mark_paid_happy_path() {
  let order =
    Order { ..t_base_order(),
      status: Accepted,
      merchant: Some(t_merchant_pkh),
      merchant_pubkey: t_merchant_pubkey,
    }
  let paid =
    Order { ..order,
      status: Paid,
      dispute_deadline: 1_500_000 + 900_000,
    }
  let input = t_escrow_utxo(order)
  let tx =
    Transaction { ..placeholder,
      inputs: [input],
      outputs: [t_continuing_output(paid)],
      extra_signatories: [t_user_pkh],
      validity_range: interval.between(1_500_000, 1_500_000),
    }
  escrow.spend(Some(order), MarkPaid, input.output_reference, tx)
}

test complete_happy_path() {
  let order =
    Order { ..t_base_order(),
      status: Paid,
      merchant: Some(t_merchant_pkh),
      merchant_pubkey: t_merchant_pubkey,
      dispute_deadline: 3_000_000,
    }
  let input = t_escrow_utxo(order)
  let tx =
    Transaction { ..placeholder,
      inputs: [input],
      outputs: [t_payout(t_merchant_pkh, order.usdc_amount)],
      extra_signatories: [t_merchant_pkh],
      validity_range: interval.between(4_000_000, 4_500_000),
    }
  escrow.spend(Some(order), Complete, input.output_reference, tx)
}

test complete_fails_before_dispute_deadline() fail {
  let order =
    Order { ..t_base_order(),
      status: Paid,
      merchant: Some(t_merchant_pkh),
      merchant_pubkey: t_merchant_pubkey,
      dispute_deadline: 3_000_000,
    }
  let input = t_escrow_utxo(order)
  let tx =
    Transaction { ..placeholder,
      inputs: [input],
      outputs: [t_payout(t_merchant_pkh, order.usdc_amount)],
      extra_signatories: [t_merchant_pkh],
      validity_range: interval.between(2_500_000, 2_600_000),
    }
  escrow.spend(Some(order), Complete, input.output_reference, tx)
}

test complete_fails_underpaid() fail {
  let order =
    Order { ..t_base_order(),
      status: Paid,
      merchant: Some(t_merchant_pkh),
      merchant_pubkey: t_merchant_pubkey,
      dispute_deadline: 3_000_000,
    }
  let input = t_escrow_utxo(order)
  let tx =
    Transaction { ..placeholder,
      inputs: [input],
      outputs: [t_payout(t_merchant_pkh, order.usdc_amount - 1)],
      extra_signatories: [t_merchant_pkh],
      validity_range: interval.between(4_000_000, 4_500_000),
    }
  escrow.spend(Some(order), Complete, input.output_reference, tx)
}
