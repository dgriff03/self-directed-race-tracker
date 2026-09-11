import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Milemark — Live race tracking",
  description: "Follow every mile with live race tracking, aid station estimates, and splits.",
  referrer: "strict-origin",
  robots: { index: false, follow: false },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
