import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cisco Market + Buyer Intelligence Agent",
  description: "Source-backed Cisco account and buyer intelligence research"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
