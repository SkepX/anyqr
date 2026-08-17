import { Data } from "@lucid-evolution/lucid";
import { OrderDatum } from "@qrpay/sdk";

const cbor = process.argv[2];
const d = Data.from(cbor, OrderDatum);
console.log(JSON.stringify(d, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
