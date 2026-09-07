import type { Metadata } from "next";
import { Space_Grotesk, Anton } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

// Loaded for the default "Hormozi" caption style. Montserrat Black was the
// first choice but has a documented rendering bug with -webkit-text-stroke
// (google/fonts#4212) — thick strokes choke small letter counters (P/O/G/S)
// into solid black blobs. Anton is bold/condensed by design for exactly this
// caption use case and doesn't hit that bug.
const anton = Anton({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-anton",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CaptionLab — Animated Typography for Short-Form Video",
  description:
    "Turn speech into styled, animated captions. Every aspect customisable, but you never have to customise anything.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`h-full dark ${spaceGrotesk.variable} ${anton.variable}`}>
      <body className="min-h-full flex flex-col bg-zinc-950 text-white">
        {children}
      </body>
    </html>
  );
}
