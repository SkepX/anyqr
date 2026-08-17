// Generate a fresh Preprod wallet, print the address, save seed to disk.
// Usage: node scripts/gen-wallet.mjs <name>
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import {
  Blockfrost,
  Lucid,
  generateSeedPhrase,
} from "@lucid-evolution/lucid";

const NAME = process.argv[2] ?? "user";
const OUT_DIR = new URL("../.wallets/", import.meta.url).pathname;
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
const OUT = `${OUT_DIR}${NAME}.seed`;

if (existsSync(OUT)) {
  console.error(`refusing to overwrite ${OUT}`);
  process.exit(1);
}

const key = process.env.BLOCKFROST_PROJECT_ID;
if (!key) {
  console.error("BLOCKFROST_PROJECT_ID not set");
  process.exit(1);
}

const lucid = await Lucid(
  new Blockfrost("https://cardano-preprod.blockfrost.io/api/v0", key),
  "Preprod",
);

const seed = generateSeedPhrase();
lucid.selectWallet.fromSeed(seed);
const addr = await lucid.wallet().address();

writeFileSync(OUT, seed + "\n", { mode: 0o600 });
console.log(`wallet:  ${NAME}`);
console.log(`seed at: ${OUT} (chmod 600)`);
console.log(`address: ${addr}`);
