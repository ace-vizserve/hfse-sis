import { Skeleton } from '@/components/ui/skeleton';

/** Mirrors the invoice screen — title bar, view switch + stepper, the
 *  invoice with Invoice activity beside it, and the footer bar. */
export default function Loading() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="shrink-0 border-b border-border bg-card">
        <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
          <Skeleton className="size-9 rounded-md" />
          <Skeleton className="h-6 w-56" />
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-8 w-56" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-muted/50">
        <div className="mx-auto grid max-w-400 grid-cols-1 gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Skeleton className="h-[640px] rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
      <div className="flex h-16 shrink-0 items-center justify-end gap-3 border-t border-border bg-card px-6">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-10 w-32" />
      </div>
    </div>
  );
}
