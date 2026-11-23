import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BillSahi: is your bill sahi?",
  description:
    "Snap any Indian bill. AI reads every line, then BillSahi redoes the math: line totals, GST, service charge, MRP and the GSTIN check digit.",
};

export const viewport: Viewport = {
  themeColor: "#24318c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
