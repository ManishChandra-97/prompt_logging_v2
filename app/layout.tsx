import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CPU Evaluator",
  description: "Local prompt debugging for Computershare voice intake",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
