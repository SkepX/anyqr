import { describe, expect, it } from "vitest";
import { Data } from "@lucid-evolution/lucid";
import { loadBlueprint, pickValidator } from "../blueprint.js";
import { Action, OrderDatum } from "../types.js";

const BLUEPRINT_PATH = new URL(
  "../../../escrow/plutus.json",
  import.meta.url,
).pathname;

describe("blueprint", () => {
  it("loads and finds the escrow validator", () => {
    const bp = loadBlueprint(BLUEPRINT_PATH);
    expect(bp.validators.length).toBeGreaterThan(0);
    const v = pickValidator(bp, "escrow.escrow.spend");
    expect(v.type).toBe("PlutusV3");
    expect(v.script.length).toBeGreaterThan(100);
  });
});

describe("datum encoding", () => {
  it("roundtrips an Order through Data.to/from", () => {
    const datum: typeof OrderDatum = {
      order_id: "deadbeef",
      user: "11".repeat(28),
      merchant: null,
      merchant_pubkey: "",
      usdc_policy: "aa".repeat(28),
      usdc_name: "55534443",
      usdc_amount: 1_000_000n,
      fiat_currency: Buffer.from("INR", "utf8").toString("hex"),
      fiat_amount: 850_000n,
      encrypted_payment_addr: "",
      status: "Placed",
      accept_deadline: 2_000_000n,
      complete_deadline: 5_000_000n,
      dispute_deadline: 0n,
      admin: "33".repeat(28),
    };
    const cbor = Data.to(datum, OrderDatum);
    const back = Data.from(cbor, OrderDatum);
    expect(back).toEqual(datum);
  });

  it("roundtrips an Accepted order with merchant", () => {
    const datum: typeof OrderDatum = {
      order_id: "aabb",
      user: "11".repeat(28),
      merchant: "22".repeat(28),
      merchant_pubkey: "0403".repeat(16),
      usdc_policy: "aa".repeat(28),
      usdc_name: "55534443",
      usdc_amount: 1_000_000n,
      fiat_currency: "494e52",
      fiat_amount: 850_000n,
      encrypted_payment_addr: "cafebabe",
      status: "Accepted",
      accept_deadline: 2_000_000n,
      complete_deadline: 5_000_000n,
      dispute_deadline: 0n,
      admin: "33".repeat(28),
    };
    const cbor = Data.to(datum, OrderDatum);
    expect(Data.from(cbor, OrderDatum)).toEqual(datum);
  });
});

describe("action encoding", () => {
  it("encodes each redeemer variant", () => {
    const roundtrip = (a: typeof Action) => {
      const cbor = Data.to(a, Action);
      expect(Data.from(cbor, Action)).toEqual(a);
    };

    roundtrip({
      Accept: {
        merchant: "22".repeat(28),
        merchant_pubkey: "0403".repeat(16),
      },
    });
    roundtrip({ SetPaymentAddr: { encrypted: "cafe" } });
    roundtrip("MarkPaid");
    roundtrip("Complete");
    roundtrip("CancelUnaccepted");
    roundtrip("Refund");
    roundtrip("RaiseDispute");
    roundtrip({ Resolve: { to_merchant: true } });
    roundtrip({ Resolve: { to_merchant: false } });
  });
});
