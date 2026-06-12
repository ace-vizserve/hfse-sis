'use client';

import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';

// Inline SVG illustration — a browser window with a simplified SIS layout
// (sidebar + content area) to visually communicate "this needs a wider screen."
function DesktopIllustration() {
  return (
    <svg
      viewBox="0 0 320 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full max-w-[280px]"
      aria-hidden="true"
    >
      {/* Browser chrome */}
      <rect
        x="1"
        y="1"
        width="318"
        height="198"
        rx="10"
        className="fill-card stroke-border"
        strokeWidth="1.5"
      />
      {/* Title bar */}
      <rect
        x="1"
        y="1"
        width="318"
        height="28"
        rx="10"
        className="fill-muted"
      />
      <rect x="1" y="15" width="318" height="14" className="fill-muted" />
      {/* Traffic lights */}
      <circle cx="18" cy="14" r="4" className="fill-destructive/40" />
      <circle cx="30" cy="14" r="4" className="fill-brand-amber/40" />
      <circle cx="42" cy="14" r="4" className="fill-brand-mint/40" />
      {/* Address bar */}
      <rect
        x="56"
        y="8"
        width="208"
        height="12"
        rx="6"
        className="fill-background stroke-border"
        strokeWidth="1"
      />

      {/* App body */}
      {/* Sidebar */}
      <rect x="1" y="29" width="64" height="170" className="fill-sidebar" />
      {/* Sidebar logo area */}
      <rect
        x="9"
        y="37"
        width="48"
        height="10"
        rx="3"
        className="fill-muted-foreground/20"
      />
      {/* Sidebar nav items */}
      {[56, 72, 88, 104, 120, 136].map((y, i) => (
        <rect
          key={i}
          x="9"
          y={y}
          width={i === 0 ? 48 : 36}
          height="8"
          rx="3"
          className={i === 0 ? 'fill-primary/20' : 'fill-muted-foreground/15'}
        />
      ))}

      {/* Content area */}
      {/* Top bar */}
      <rect x="65" y="29" width="254" height="22" className="fill-background" />
      <rect
        x="73"
        y="35"
        width="80"
        height="10"
        rx="3"
        className="fill-muted-foreground/20"
      />
      <rect
        x="287"
        y="35"
        width="24"
        height="10"
        rx="5"
        className="fill-primary/25"
      />

      {/* Content */}
      <rect
        x="65"
        y="51"
        width="254"
        height="148"
        className="fill-background"
      />
      {/* Metric cards */}
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={73 + i * 60}
          y="59"
          width="52"
          height="32"
          rx="5"
          className="fill-card stroke-border"
          strokeWidth="1"
        />
      ))}
      {/* Table header */}
      <rect
        x="73"
        y="101"
        width="238"
        height="12"
        rx="3"
        className="fill-muted"
      />
      {/* Table rows */}
      {[0, 1, 2, 3, 4].map((i) => (
        <rect
          key={i}
          x="73"
          y={119 + i * 16}
          width="238"
          height="10"
          rx="2"
          className="fill-muted/50"
        />
      ))}
    </svg>
  );
}

export function ScreenGuard() {
  const pathname = usePathname();

  // Parent portal is intentionally designed for mobile — parents view report
  // cards on their phones, so the guard must not block that route group.
  if (pathname.startsWith('/parent')) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-8 overflow-hidden bg-background px-8 lg:hidden">
      {/* School logo */}
      <Image
        src="/hfse-logo.webp"
        alt="HFSE International School"
        width={120}
        height={40}
        className="h-10 w-auto object-contain"
        priority
      />

      {/* Browser illustration */}
      <div className="w-full max-w-[280px] rounded-xl border border-border shadow-sm overflow-hidden">
        <DesktopIllustration />
      </div>

      {/* Message */}
      <div className="max-w-xs text-center">
        <h1 className="font-serif text-2xl font-semibold text-foreground">
          Use a larger screen
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          HFSE SIS is built for desktop and laptop browsers. Please open this
          page on a device with a wider screen.
        </p>
      </div>

      {/* Refresh — lets the user check after resizing without a manual reload */}
      <Button
        size="sm"
        onClick={() => window.location.reload()}
        className="gap-2"
      >
        <RefreshCw className="h-4 w-4" />
        Refresh
      </Button>
    </div>
  );
}
