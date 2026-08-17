// Send tADA from user → merchant + admin so they can pay tx fees later.
import { withWallet, scanTx } from "./lib.mjs";

const MERCHANT_ADDR =
  "addr_test1qzut959axcszp0pj5j9anuna68353qqevxgx8k6jqmzdscff2swwngll7pqp84l0e2uflamh496sh2v8yn4ack5lt3aqx79xlr";
const ADMIN_ADDR =
  "addr_test1qpyucupvh0ntzwfr75sm60rymwvtv5wca0s47rlthp7hzgnezu2pxa9s83gtcxtgpsafqlp4yhlyl00j5q2fwkrj38xs38xupq";

const lucid = await withWallet("user");
const tx = await lucid
  .newTx()
  .pay.ToAddress(MERCHANT_ADDR, { lovelace: 100_000_000n }) // 100 tADA
  .pay.ToAddress(ADMIN_ADDR, { lovelace: 100_000_000n })
  .complete();
const signed = await tx.sign.withWallet().complete();
const hash = await signed.submit();
console.log("funded merchant + admin, tx:", hash);
console.log("scan:", scanTx(hash));
