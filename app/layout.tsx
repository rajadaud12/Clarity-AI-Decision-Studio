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
  themeColor: "#fbfcfe",
};

export const metadata: Metadata = {
  title: "Clarity — Decision Studio",
  description: "Turn an uncertain question into a clear, evidence-shaped decision.",
  icons: {
    icon: [
      { url: "/BotLogo.webp", type: "image/webp" },
      { url: "/favicon.ico" },
    ],
    shortcut: "/BotLogo.webp",
    apple: "/BotLogo.webp",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={manrope.variable} suppressHydrationWarning>{children}</body>
    </html>
  );
}
