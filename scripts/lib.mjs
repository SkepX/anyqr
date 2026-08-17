import { readFileSync } from "node:fs";
import { Blockfrost, Lucid } from "@lucid-evolution/lucid";

export function loadSeed(name) {
  const path = new URL(`../.wallets/${name}.seed`, import.meta.url).pathname;
  return readFileSync(path, "utf8").trim();
}

export async function mkLucid() {
  const key = process.env.BLOCKFROST_PROJECT_ID;
  if (!key) throw new Error("BLOCKFROST_PROJECT_ID not set");
  return await Lucid(
    new Blockfrost("https://cardano-preprod.blockfrost.io/api/v0", key),
    "Preprod",
  );
}

export async function withWallet(name) {
  const lucid = await mkLucid();
  lucid.selectWallet.fromSeed(loadSeed(name));
  return lucid;
}

export function scanTx(hash) {
  return `https://preprod.cardanoscan.io/transaction/${hash}`;
}
