import { PageShell } from '@/components/ui/page-shell';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-4 w-40" />

      <header className="space-y-4">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-4 w-[32rem] max-w-full" />
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-9 w-16" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-3 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-52 rounded-xl" />
        <Skeleton className="h-52 rounded-xl lg:col-span-2" />
      </div>

      <Skeleton className="h-80 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </PageShell>
  );
}
