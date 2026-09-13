"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** An original sheet over its carbon copy, checked. */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true" className={className}>
      <rect x="8" y="2.75" width="12.5" height="15.5" rx="1.5" fill="var(--color-canary)" stroke="var(--color-carbon)" strokeWidth="1.5" />
      <rect x="3.5" y="6" width="12.5" height="15.5" rx="1.5" fill="var(--color-sheet)" stroke="currentColor" strokeWidth="1.75" />
      <path d="m6.9 14 2.3 2.3 4-4.4" stroke="var(--color-carbon)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const APP_LINKS = [
  { href: "/disputes", label: "Disputes" },
  { href: "/eval", label: "Evaluation" },
  { href: "/sandbox", label: "Sandbox" },
];
const LANDING_LINKS = [
  { href: "/disputes", label: "Dispute queue" },
  { href: "/eval", label: "Evaluation" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const landing = pathname === "/";
  const links = landing ? LANDING_LINKS : APP_LINKS;

  return (
    <>
      {landing && (
        <p role="note" className="bg-ink px-4 py-2 text-center text-xs text-sheet/80">
          Demo — synthetic disputes in Stripe test mode. No real customer data.
        </p>
      )}
      <header className={`border-b border-ink/15 ${landing ? "bg-paper" : "bg-sheet"}`}>
        <nav
          aria-label="Main"
          className={`mx-auto flex flex-wrap items-center justify-between gap-x-6 px-4 sm:px-6 ${landing ? "max-w-6xl py-3" : "max-w-[1400px] py-1"}`}
        >
          <div className="flex items-center gap-3">
            <Link href="/" className="flex min-h-11 items-center gap-2 text-ink">
              <BrandMark />
              <span className="display text-lg">Sentinel</span>
            </Link>
            {landing && <span className="field-label hidden text-muted sm:inline">Chargeback operations, verified</span>}
          </div>
          <ul className="flex items-center gap-1 text-sm">
            {links.map((l) => {
              const current = pathname === l.href || pathname.startsWith(`${l.href}/`) || (l.href === "/disputes" && pathname.startsWith("/cases/"));
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    aria-current={current ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center border-b-2 px-2.5 transition-colors ${
                      current ? "border-carbon font-medium text-ink" : "border-transparent text-muted hover:border-rule hover:text-ink"
                    }`}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
    </>
  );
}
