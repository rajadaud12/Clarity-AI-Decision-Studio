import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0b0f14",
};

export const metadata: Metadata = {
  title: "Verdict",
  description: "Turn an uncertain question into a clear, evidence-shaped decision.",
  icons: {
    icon: "/favicon.ico?v=4",
    shortcut: "/favicon.ico?v=4",
    apple: "/favicon.ico?v=4",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={manrope.variable} suppressHydrationWarning>{children}</body>
    </html>
  );
}
