/**
 * anyqr identity schema — CIP-0170 attestations, Reclaim zkTLS proofs and
 * reputation scoring.
 *
 * SCHEMA ONLY. Nothing here builds, signs or submits a transaction; these
 * are the shapes those transactions will carry.
 *
 * Layering, from the outside in:
 *
 *   tx metadata
 *     170  -> the CIP-0170 envelope (KERI/ACDC). Says WHO signed and that
 *             their authority is established. Opaque to us.
 *     1170 -> the anyqr payload. Says WHAT was attested: a merchant
 *             identity, a buyer identity, a Reclaim proof, a score.
 *
 * The split matters. CIP-0170 carries authority, we carry meaning; an
 * indexer can verify the first without understanding the second, and we
 * can change ours without touching the standard.
 */
import { z } from "zod";

/* -------------------------------------------------------------------- */
/* CIP-0170 envelope                                                     */
/* -------------------------------------------------------------------- */

/** Metadata label reserved by CIP-0170 for KERI-backed attestations. */
export const CIP170_LABEL = 170;

/**
 * anyqr's application metadata label, sitting beside 170 in the same tx.
 *
 * NOT YET REGISTERED. CIP-10 is the label registry and this number must be
 * claimed there before mainnet, or we risk colliding with another project's
 * payloads. Treat as provisional.
 */
export const ANYQR_LABEL = 1170;

/** CESR qb64 identifier — a KERI AID, or a SAID for schemas and digests. */
const Qb64 = z.string().min(24).regex(/^[A-Za-z0-9_-]+$/, "expected CESR qb64");

/** Version block. `k` and `a` appear only on authority transitions. */
export const Cip170Version = z.object({
  v: z.string(), // CIP version, e.g. "1.0"
  k: z.string().optional(), // KERI version, e.g. "KERI10"
  a: z.string().optional(), // ACDC version, e.g. "ACDC10"
});

/** Publishes the credential chain that establishes signing authority for `i`. */
export const AuthBegin = z.object({
  t: z.literal("AUTH_BEGIN"),
  s: Qb64, // SAID of the leaf credential schema
  i: Qb64, // AID of the signer
  c: z.string(), // credential chain byte-stream (CESR qb2/qb64b)
  v: Cip170Version,
  m: z.record(z.string(), z.unknown()).optional(), // indexing aid
});

/** A single verifiable record signed by an already-authorised AID. */
export const Attest = z.object({
  t: z.literal("ATTEST"),
  i: Qb64, // AID of the signer
  d: Qb64, // digest of the data being signed
  s: z.string().regex(/^[0-9a-f]+$/, "hex sequence number"),
  v: Cip170Version,
});

/** Revokes the authority previously established by AUTH_BEGIN. */
export const AuthEnd = AuthBegin.extend({ t: z.literal("AUTH_END") });

export const Cip170Envelope = z.discriminatedUnion("t", [
  AuthBegin,
  Attest,
  AuthEnd,
]);

/* -------------------------------------------------------------------- */
/* Reclaim zkTLS proofs                                                  */
/* -------------------------------------------------------------------- */

/**
 * A Reclaim proof as their SDK emits it, client-side.
 *
 * This is the OFF-CHAIN shape. It never goes on chain in full: it is large,
 * and `parameters` can carry values a merchant would not want public. What
 * we attest is its `identifier` — the claim hash — inside a ReclaimClaim
 * below. Anyone holding the full proof can verify it against that hash;
 * anyone else learns only that a claim of a given kind was made.
 */
export const ReclaimProof = z.object({
  identifier: z.string(), // hash of claimData, the thing we anchor
  claimData: z.object({
    provider: z.string(), // e.g. "binance-p2p-merchant"
    parameters: z.string(), // JSON string, provider-specific
    owner: z.string(), // address that requested the proof
    timestampS: z.number().int(),
    context: z.string(),
    identifier: z.string(),
    epoch: z.number().int(),
  }),
  signatures: z.array(z.string()).min(1),
  witnesses: z.array(z.object({ id: z.string(), url: z.string().url() })).min(1),
});

/** What a Reclaim provider is being used to prove, in anyqr's terms. */
export const ClaimKind = z.enum([
  "payment_account", // controls the bank/UPI account they will pay from
  "p2p_history", // has completed trades on an existing P2P venue
  "social", // controls a named social account
  "email", // controls an email address
]);

/** The on-chain form: the claim hash and what it means, never the payload. */
export const ReclaimClaim = z.object({
  kind: ClaimKind,
  provider: z.string(),
  identifier: z.string(), // ReclaimProof.identifier
  provedAt: z.number().int(), // POSIX ms
  expiresAt: z.number().int().optional(), // re-proof cadence, if any
});

/* -------------------------------------------------------------------- */
/* Identity records                                                      */
/* -------------------------------------------------------------------- */

/** Cardano payment key hash, blake2b-224, hex. */
const Pkh = z.string().regex(/^[0-9a-f]{56}$/, "expected a 28-byte pkh");

const IdentityBase = z.object({
  v: z.literal(1),
  aid: Qb64, // KERI AID this record belongs to
  pkh: Pkh, // the wallet it speaks for
  createdAt: z.number().int(),
  claims: z.array(ReclaimClaim).default([]),
});

/**
 * A merchant. `corridors` is what they can actually settle, and it is the
 * operative field: reputation is meaningless if it does not say which rail
 * and currency it was earned on.
 */
export const MerchantIdentity = IdentityBase.extend({
  role: z.literal("merchant"),
  displayName: z.string().min(1).max(64),
  corridors: z
    .array(
      z.object({
        rail: z.enum([
          "UPI",
          "PIX",
          "QRIS",
          "VietQR",
          "PromptPay",
          "QRPh",
          "Yape",
          "Nequi",
          "DeUna",
          "MercadoPago",
        ]),
        currency: z.string().length(3), // ISO 4217
      }),
    )
    .min(1),
  /** secp256k1 pubkey the buyer encrypts the shop QR to (ECIES). */
  eciesPubkey: z.string().regex(/^[0-9a-f]{128}$/),
});

/**
 * A buyer. Anchored at signup so the account has a history before it has a
 * reputation; deliberately thinner than a merchant's, because a buyer is
 * risking their own money and needs to prove far less.
 */
export const BuyerIdentity = IdentityBase.extend({
  role: z.literal("buyer"),
  displayName: z.string().min(1).max(64).optional(),
});

export const Identity = z.discriminatedUnion("role", [
  MerchantIdentity,
  BuyerIdentity,
]);

/* -------------------------------------------------------------------- */
/* Reputation                                                            */
/* -------------------------------------------------------------------- */

/**
 * Written once per completed order, by both sides.
 *
 * Mutual and order-scoped on purpose: a rating that is not tied to a
 * settled escrow is an opinion, and opinions are cheap to manufacture.
 * `orderId` makes every point of reputation traceable to a UTxO that was
 * really spent.
 */
export const ReputationAttestation = z.object({
  v: z.literal(1),
  orderId: z.string(),
  subject: Pkh, // who is being rated
  rater: Pkh, // who is rating (the counterparty)
  role: z.enum(["merchant", "buyer"]), // the subject's side of this order
  outcome: z.enum(["settled", "refunded", "disputed"]),
  settleMs: z.number().int().nonnegative(), // accept -> release
  usdcAmount: z.string().regex(/^\d+$/), // bigint as decimal string
  fiatCurrency: z.string().length(3),
  at: z.number().int(),
});

/** Derived, never attested: recomputed from the attestations above. */
export const ReputationScore = z.object({
  v: z.literal(1),
  subject: Pkh,
  orders: z.number().int().nonnegative(),
  settled: z.number().int().nonnegative(),
  disputed: z.number().int().nonnegative(),
  volumeUsdc: z.string().regex(/^\d+$/),
  medianSettleMs: z.number().int().nonnegative(),
  /** Staked ada backing their limit, lovelace as a decimal string. */
  stakeLovelace: z.string().regex(/^\d+$/),
  /** 0..1000. Bounded so a long history cannot buy an unbounded limit. */
  score: z.number().int().min(0).max(1000),
  tier: z.enum(["new", "bronze", "silver", "gold"]),
  /** The only number the validator cares about: the per-order ceiling. */
  maxOrderUsdc: z.string().regex(/^\d+$/),
  computedAt: z.number().int(),
});

/* -------------------------------------------------------------------- */
/* The anyqr metadata payload (label 1170)                               */
/* -------------------------------------------------------------------- */

export const AnyqrPayload = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("identity"), body: Identity }),
  z.object({ kind: z.literal("claim"), body: ReclaimClaim.extend({ pkh: Pkh }) }),
  z.object({ kind: z.literal("reputation"), body: ReputationAttestation }),
]);

/* -------------------------------------------------------------------- */
/* Escrow datum extension                                                */
/* -------------------------------------------------------------------- */

/**
 * What the validator gains. Today an order names its merchant by `pkh`
 * alone; adding the AID lets the contract check an order against a
 * reputation-derived ceiling instead of trusting the order book to have
 * done it off chain.
 *
 * Aiken side:
 *   merchant_aid: Option<ByteArray>   // CESR qb64 AID, None until DID mint
 *   max_order_usdc: Option<Int>       // ceiling in force when accepted
 */
export const EscrowIdentityFields = z.object({
  merchantAid: Qb64.nullable(),
  maxOrderUsdc: z.string().regex(/^\d+$/).nullable(),
});

/* -------------------------------------------------------------------- */

export type Cip170Envelope = z.infer<typeof Cip170Envelope>;
export type ReclaimProof = z.infer<typeof ReclaimProof>;
export type ReclaimClaim = z.infer<typeof ReclaimClaim>;
export type MerchantIdentity = z.infer<typeof MerchantIdentity>;
export type BuyerIdentity = z.infer<typeof BuyerIdentity>;
export type Identity = z.infer<typeof Identity>;
export type ReputationAttestation = z.infer<typeof ReputationAttestation>;
export type ReputationScore = z.infer<typeof ReputationScore>;
export type AnyqrPayload = z.infer<typeof AnyqrPayload>;
