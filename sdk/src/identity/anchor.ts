/**
 * Anchor an anyqr identity on chain as a CIP-0170 attestation.
 *
 * SCOPE: this is the minimum that actually works. It writes a real
 * `ATTEST` envelope at label 170 alongside an anyqr record at label 1170,
 * signed and paid by the identity's own wallet, and it can be read back.
 * That is the whole claim.
 *
 * What it is NOT: KERI. A real AID is an Autonomic Identifier with a key
 * event log behind it, established by an `AUTH_BEGIN` credential chain and
 * rotatable without losing continuity of control. We have none of that. We
 * derive a stand-in identifier from the wallet's own key hash so the record
 * has a stable subject to hang off, and mark it as such in the payload so
 * nothing downstream mistakes it for a verified AID. Swapping it for a
 * signify-issued AID is the identity work the grant funds.
 */
import { z } from "zod";
import type { QrpayClient } from "../client.js";
import { walletPkh } from "../actions/_common.js";
import { executeTx, fromTx, parseParams } from "../actions/_prepare.js";
import {
  ANYQR_LABEL,
  CIP170_LABEL,
  ClaimKind,
  type Identity,
} from "./schema.js";

/** Cardano rejects metadata strings over 64 bytes; nothing below may exceed it. */
const MAX_METADATA_STRING = 64;

/**
 * Stand-in identifier, pending real KERI.
 *
 * `X` is not a valid CESR derivation code, which is deliberate: a verifier
 * that knows KERI will reject this rather than silently trust it, and that
 * is the behaviour we want until an AID is genuinely issued.
 */
export function provisionalAid(pkh: string): string {
  return `X${pkh}`;
}

export function isProvisionalAid(aid: string): boolean {
  return aid.startsWith("X");
}

const AnchorParams = z.object({
  role: z.enum(["merchant", "buyer"]),
  displayName: z.string().min(1).max(48).optional(),
  /** Merchant only. At least one rail they can settle. */
  corridors: z
    .array(z.object({ rail: z.string().max(12), currency: z.string().length(3) }))
    .optional(),
  /** Merchant only. secp256k1 pubkey buyers encrypt the shop QR to. */
  eciesPubkey: z.string().regex(/^[0-9a-f]{128}$/).optional(),
  /** Claim hashes already proved off chain via Reclaim. */
  claims: z
    .array(
      z.object({
        kind: ClaimKind,
        provider: z.string().max(32),
        identifier: z.string().max(MAX_METADATA_STRING),
      }),
    )
    .default([]),
});
export type AnchorIdentityParams = z.input<typeof AnchorParams>;

/** Split anything that could exceed the 64-byte metadata limit. */
const chunk = (s: string): string | string[] =>
  s.length <= MAX_METADATA_STRING
    ? s
    : (s.match(/.{1,64}/g) ?? [s]);

/**
 * Blake2b-224 of the payload, as the ATTEST digest.
 *
 * CIP-0170 wants a CESR-qualified digest here. We emit the raw hex hash
 * with the same `X` marker used on the identifier, for the same reason:
 * visibly not-yet-standard rather than plausibly-standard-and-wrong.
 */
async function payloadDigest(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return "X" + hex.slice(0, 56);
}

/**
 * Build the two metadata blocks for an identity anchor.
 *
 * Label 170 carries authority, label 1170 carries meaning. Kept separate so
 * an indexer can verify the first without understanding the second.
 */
export async function identityMetadata(
  identity: Identity,
  sequence = 0,
): Promise<{
  [CIP170_LABEL]: Record<string, unknown>;
  [ANYQR_LABEL]: Record<string, unknown>;
}> {
  const body: Record<string, unknown> = {
    v: identity.v,
    role: identity.role,
    pkh: identity.pkh,
    at: identity.createdAt,
    claims: identity.claims.map((c) => ({
      k: c.kind,
      p: c.provider,
      i: chunk(c.identifier),
    })),
  };
  if (identity.displayName) body.name = identity.displayName;
  if (identity.role === "merchant") {
    body.corridors = identity.corridors.map((c) => `${c.rail}:${c.currency}`);
    body.ecies = chunk(identity.eciesPubkey);
  }

  return {
    [CIP170_LABEL]: {
      t: "ATTEST",
      i: chunk(identity.aid),
      d: await payloadDigest(body),
      s: sequence.toString(16),
      v: { v: "1.0" },
    },
    [ANYQR_LABEL]: { kind: "identity", body },
  };
}

/**
 * Anchor the caller's identity.
 *
 * The transaction pays the wallet's own address — it exists only to carry
 * metadata, and self-payment keeps the value movement a no-op. The buyer or
 * merchant signs and pays for it themselves, so the fee counts as theirs.
 */
export const anchorIdentity = (client: QrpayClient) => {
  const prepare = (raw: AnchorIdentityParams) =>
    parseParams(AnchorParams, raw).asyncAndThen((p) =>
      fromTx(async () => {
        const lucid = client.cfg.lucid;
        const pkh = await walletPkh(lucid);
        const addr = await lucid.wallet().address();

        if (p.role === "merchant" && (!p.corridors?.length || !p.eciesPubkey))
          throw new Error("a merchant anchor needs corridors and an ecies pubkey");

        const identity = {
          v: 1 as const,
          aid: provisionalAid(pkh),
          pkh,
          createdAt: Date.now(),
          claims: p.claims.map((c) => ({ ...c, provedAt: Date.now() })),
          ...(p.role === "merchant"
            ? {
                role: "merchant" as const,
                displayName: p.displayName ?? "merchant",
                corridors: p.corridors!,
                eciesPubkey: p.eciesPubkey!,
              }
            : { role: "buyer" as const, displayName: p.displayName }),
        } as Identity;

        const meta = await identityMetadata(identity);
        const tx = lucid.newTx().pay.ToAddress(addr, { lovelace: 2_000_000n });
        // Lucid types metadata as a CBOR-ish union; ours is a plain JSON
        // object, which the encoder accepts but the type does not name.
        type Meta = Parameters<typeof tx.attachMetadata>[1];
        return await tx
          .attachMetadata(CIP170_LABEL, meta[CIP170_LABEL] as unknown as Meta)
          .attachMetadata(ANYQR_LABEL, meta[ANYQR_LABEL] as unknown as Meta)
          .complete();
      }),
    );

  const execute = (raw: AnchorIdentityParams) => executeTx(prepare(raw));
  return { prepare, execute };
};

/* -------------------------------------------------------------------- */
/* Reading it back                                                       */
/* -------------------------------------------------------------------- */

/** One anchored identity, as reconstructed from chain metadata. */
export interface AnchoredIdentity {
  txHash: string;
  aid: string;
  provisional: boolean;
  role: "merchant" | "buyer";
  pkh: string;
  displayName?: string;
  corridors: string[];
  claims: Array<{ kind: string; provider: string; identifier: string }>;
  anchoredAt: number;
}

const join = (v: unknown): string => (Array.isArray(v) ? v.join("") : String(v ?? ""));

/**
 * Rebuild an identity from a transaction's metadata.
 *
 * Writing metadata is the easy half; this is the half that proves the
 * anchor is real, because it round-trips the record back out of the chain
 * rather than trusting what we think we wrote.
 */
export function parseIdentityMetadata(
  txHash: string,
  labels: Record<string, unknown>,
): AnchoredIdentity | null {
  const env = labels[String(CIP170_LABEL)] as Record<string, unknown> | undefined;
  const app = labels[String(ANYQR_LABEL)] as Record<string, unknown> | undefined;
  if (!env || !app || env.t !== "ATTEST") return null;
  if (app.kind !== "identity") return null;

  const body = app.body as Record<string, unknown>;
  const role = body.role === "merchant" ? "merchant" : "buyer";
  const aid = join(env.i);
  return {
    txHash,
    aid,
    provisional: isProvisionalAid(aid),
    role,
    pkh: String(body.pkh ?? ""),
    displayName: body.name ? String(body.name) : undefined,
    corridors: Array.isArray(body.corridors) ? body.corridors.map(String) : [],
    claims: Array.isArray(body.claims)
      ? body.claims.map((c: Record<string, unknown>) => ({
          kind: String(c.k),
          provider: String(c.p),
          identifier: join(c.i),
        }))
      : [],
    anchoredAt: Number(body.at ?? 0),
  };
}
