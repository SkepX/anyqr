export interface Country {
  code: string; // ISO ccy
  name: string;
  flag: string;
  symbol: string;
  rail?: string; // e.g. "UPI", "PIX"
  live?: boolean;
}

export const COUNTRIES: Country[] = [
  { code: "INR", name: "India", flag: "🇮🇳", symbol: "₹", rail: "UPI", live: true },
  { code: "IDR", name: "Indonesia", flag: "🇮🇩", symbol: "Rp", rail: "QRIS" },
  { code: "BRL", name: "Brazil", flag: "🇧🇷", symbol: "R$", rail: "PIX" },
  { code: "THB", name: "Thailand", flag: "🇹🇭", symbol: "฿", rail: "PromptPay" },
  { code: "VND", name: "Vietnam", flag: "🇻🇳", symbol: "₫", rail: "VietQR" },
  { code: "PHP", name: "Philippines", flag: "🇵🇭", symbol: "₱", rail: "QR Ph" },
  { code: "ARS", name: "Argentina", flag: "🇦🇷", symbol: "$", rail: "MercadoPago" },
  { code: "COP", name: "Colombia", flag: "🇨🇴", symbol: "$", rail: "Nequi" },
  { code: "USD-EC", name: "Ecuador", flag: "🇪🇨", symbol: "$", rail: "DeUna" },
  { code: "PEN", name: "Peru", flag: "🇵🇪", symbol: "S/", rail: "Yape" },
];
