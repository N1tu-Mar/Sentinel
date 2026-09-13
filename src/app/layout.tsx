import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Sentinel",
  description: "Investigates every chargeback across Stripe, Salesforce and Gmail, responds, and checks that it worked.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <nav className="border-b border-rule bg-ink text-sheet">
          <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-4 py-2.5 text-sm sm:px-6">
            <Link href="/" className="font-semibold tracking-tight">
              Sentinel
            </Link>
            <Link href="/" className="text-sheet/75 hover:text-sheet">
              Disputes
            </Link>
            <Link href="/eval" className="text-sheet/75 hover:text-sheet">
              Evaluation
            </Link>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
