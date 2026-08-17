export interface Country {
  code: string; // ISO ccy
  name: string;
  flag: string; // emoji fallback until we ship SVGs
  symbol: string;
  live?: boolean; // false = coming soon
}

export const COUNTRIES: Country[] = [
  { code: "INR", name: "India", flag: "🇮🇳", symbol: "₹", live: true },
  { code: "IDR", name: "Indonesia", flag: "🇮🇩", symbol: "Rp" },
  { code: "BRL", name: "Brazil", flag: "🇧🇷", symbol: "R$" },
  { code: "ARS", name: "Argentina", flag: "🇦🇷", symbol: "$" },
  { code: "VES", name: "Venezuela", flag: "🇻🇪", symbol: "Bs" },
  { code: "NGN", name: "Nigeria", flag: "🇳🇬", symbol: "₦" },
  { code: "COP", name: "Colombia", flag: "🇨🇴", symbol: "$" },
  { code: "USD-EC", name: "Ecuador", flag: "🇪🇨", symbol: "$" },
  { code: "PEN", name: "Peru", flag: "🇵🇪", symbol: "S/" },
  { code: "PHP", name: "Philippines", flag: "🇵🇭", symbol: "₱" },
];
