import { NextResponse } from "next/server";
import { loadBlueprint, pickValidator } from "@qrpay/sdk/blueprint";
import { join } from "node:path";
import { withWallet } from "../../lib/server";

export const dynamic = "force-dynamic";

/**
 * Everything a client-side qrpay SDK instance needs to build txs:
 *   - the compiled Aiken validator (Plutus V3 hex)
 *   - the tUSDM asset descriptor
 *   - the admin pkh (baked into every order's datum)
 */
export async function GET() {
  const bp = loadBlueprint(join(process.cwd(), "..", "escrow", "plutus.json"));
  const v = pickValidator(bp, "escrow.escrow.spend");
  const { client } = await withWallet("admin");
  return NextResponse.json({
    validator: { type: v.type, script: v.script },
    usdc: client.cfg.usdc,
    adminPkh: client.cfg.adminPkh,
    scriptAddress: client.scriptAddress,
    network: "Preprod",
  });
}
