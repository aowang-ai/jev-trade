import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const plex = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex",
  display: "swap",
});

const site = "https://www.jev-trade.com";
const title = "Jev Trade | Live Jev trading bot on crypto and other assets";
const description =
  "Jev Trade is live Jev trading: a bot that reads the book every tick and trades BTC, ETH, SOL, DOGE, and BNB.";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      name: "Jev Trade",
      url: `${site}/`,
      description,
    },
    {
      "@type": "WebApplication",
      name: "Jev Trade",
      url: `${site}/`,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      description,
      isAccessibleForFree: true,
      codeRepository: "https://github.com/aowang-ai/jev-trade",
    },
    {
      "@type": "SoftwareSourceCode",
      name: "jev-trade",
      url: "https://github.com/aowang-ai/jev-trade",
      codeRepository: "https://github.com/aowang-ai/jev-trade",
      programmingLanguage: "TypeScript",
      license: "https://opensource.org/licenses/MIT",
    },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title,
  description,
  applicationName: "Jev Trade",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-icon.png" }],
  },
  openGraph: {
    title,
    description,
    url: "/",
    siteName: "Jev Trade",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: title }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={plex.variable}>
      <head>
        <link rel="describedby" href="https://www.jev-trade.com/llms.txt" />
      </head>
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        {children}
      </body>
    </html>
  );
}
