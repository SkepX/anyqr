/**
 * Minimal UPI QR parser. UPI QRs are URIs like:
 *   upi://pay?pa=alice@upi&pn=Alice&am=100.00&cu=INR&tn=for%20chai
 * Returns null if not a UPI QR.
 */
export interface UpiQR {
  paymentAddress: string; // pa
  payeeName?: string; // pn
  amount?: number; // am (rupees, floating)
  currency?: string; // cu (usually INR)
  note?: string; // tn
  raw: string;
}

export function parseUpiQr(text: string): UpiQR | null {
  const trimmed = text.trim();
  if (!/^upi:\/\/pay\?/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    const params = url.searchParams;
    const pa = params.get("pa");
    if (!pa) return null;
    const amStr = params.get("am");
    return {
      paymentAddress: pa,
      payeeName: params.get("pn") ?? undefined,
      amount: amStr ? Number(amStr) : undefined,
      currency: params.get("cu") ?? "INR",
      note: params.get("tn") ?? undefined,
      raw: trimmed,
    };
  } catch {
    return null;
  }
}
