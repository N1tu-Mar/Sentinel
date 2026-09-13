"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M12 2.75 4.75 5.5v5.75c0 4.55 3.05 8.4 7.25 9.75 4.2-1.35 7.25-5.2 7.25-9.75V5.5L12 2.75Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path d="m8.6 12.1 2.4 2.4 4.5-4.9" stroke="var(--color-amber)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Light marketing header on the landing page; the dark app nav everywhere else. */
export function SiteHeader() {
  const pathname = usePathname();

  if (pathname === "/")
    return (
      <>
        <p role="note" className="border-b border-slate-100 bg-white px-4 py-2 text-center text-xs tracking-wide text-slate-500">
          Demo — synthetic disputes in Stripe test mode. No real customer data.
        </p>
        <header className="bg-white">
          <nav aria-label="Main" className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-6 py-4">
            <div className="flex items-center gap-3">
              <Link href="/" className="flex min-h-11 items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
                <BrandMark className="text-slate-900" />
                Sentinel
              </Link>
              <span className="hidden text-xs text-slate-500 sm:inline">chargeback operations, verified</span>
            </div>
            <div className="flex items-center gap-5 text-sm text-slate-600">
              <Link href="/disputes" className="inline-flex min-h-11 items-center hover:text-slate-900">
                Dispute queue
              </Link>
              <Link href="/eval" className="inline-flex min-h-11 items-center hover:text-slate-900">
                Evaluation
              </Link>
            </div>
          </nav>
        </header>
      </>
    );

  return (
    <nav className="border-b border-rule bg-ink text-sheet">
      <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-4 py-2.5 text-sm sm:px-6">
        <Link href="/" className="font-semibold tracking-tight">
          Sentinel
        </Link>
        <Link href="/disputes" className="text-sheet/75 hover:text-sheet">
          Disputes
        </Link>
        <Link href="/eval" className="text-sheet/75 hover:text-sheet">
          Evaluation
        </Link>
        <Link href="/sandbox" className="text-sheet/75 hover:text-sheet">
          Sandbox
        </Link>
      </div>
    </nav>
  );
}
