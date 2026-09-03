import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en" className="h-full dark">
      <body className="min-h-full flex flex-col bg-zinc-950 text-white">
        {children}
      </body>
    </html>
  );
}
