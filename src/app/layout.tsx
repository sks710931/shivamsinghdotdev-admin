import type { Metadata } from "next";
import { DM_Sans, Space_Grotesk, Space_Mono } from "next/font/google";

import "./globals.css";

const sans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm",
});

const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display-family",
});

const mono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono-family",
});

export const metadata: Metadata = {
  title: {
    default: "Blog admin",
    template: "%s · Blog admin",
  },
  description: "Private desk for the portfolio blog.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${display.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-dvh bg-ink font-sans text-paper">{children}</body>
    </html>
  );
}
