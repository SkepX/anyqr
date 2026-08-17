import { Data } from "@lucid-evolution/lucid";
import { StatusSchema } from "@qrpay/sdk";

for (const s of ["Placed", "Accepted", "Paid", "Disputed"]) {
  const cbor = Data.to(s, StatusSchema);
  console.log(s, "->", cbor);
}
