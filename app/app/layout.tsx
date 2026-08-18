import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "./lib/wallet";
import { VersionGuard } from "./components/VersionGuard";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

const TITLE = "anyqr by SyncAI.network: spend stablecoins at any local QR";
const DESCRIPTION =
  "On/off ramp for USDC on Cardano. Pay any local QR with stablecoin, without banks in the middle.";

/** Social cards, icons and alt text come from the files sitting next to this
 *  one — opengraph-image.jpg, twitter-image.jpg, icon.png, apple-icon.png,
 *  favicon.ico — which Next resolves against `metadataBase`. */
export const metadata: Metadata = {
  metadataBase: new URL("https://anyqr.cash"),
  title: { default: TITLE, template: "%s · anyqr" },
  description: DESCRIPTION,
  applicationName: "anyqr",
  keywords: [
    "Cardano",
    "stablecoin",
    "USDC",
    "USDCx",
    "UPI",
    "PIX",
    "QRIS",
    "off ramp",
    "non-custodial",
    "escrow",
  ],
  authors: [{ name: "SyncAI.network" }],
  creator: "SyncAI.network",
  publisher: "SyncAI.network",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "anyqr",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
};

export const viewport: Viewport = {
  themeColor: "#fafaf7",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <VersionGuard />
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
