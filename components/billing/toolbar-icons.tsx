'use client';

import { Printer, RefreshCw, type LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// The small icon buttons QuickBooks puts above its lists and reports
// (refresh, print, export, settings), each named on hover.

export function ToolbarIcon({
  icon: Icon,
  label,
  onClick,
  href,
  disabled,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  /** Opens in a new tab (a QuickBooks page). */
  href?: string;
  disabled?: boolean;
  loading?: boolean;
}) {
  const button = href ? (
    <Button asChild variant="ghost" size="icon" className="size-8">
      <a href={href} target="_blank" rel="noreferrer" aria-label={label}>
        <Icon className="size-4" />
      </a>
    </Button>
  ) : (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      loading={loading}
    >
      {!loading && <Icon className="size-4" />}
    </Button>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Reads QuickBooks again (every Billing page reads it when it loads). */
export function RefreshIcon() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <ToolbarIcon
      icon={RefreshCw}
      label="Refresh from QuickBooks"
      loading={pending}
      onClick={() => start(() => router.refresh())}
    />
  );
}

export function PrintIcon() {
  return (
    <ToolbarIcon icon={Printer} label="Print" onClick={() => window.print()} />
  );
}
