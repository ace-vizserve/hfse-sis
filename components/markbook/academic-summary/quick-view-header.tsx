import Link from 'next/link';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

export function QuickViewHeader({
  title,
  subtitle,
  ayQuery,
}: {
  title: string;
  subtitle: string;
  ayQuery: string; // '' or '?ay=AY9999' — preserves AY on the back-link
}) {
  return (
    <header className="space-y-3">
      <Breadcrumb>
        <BreadcrumbList className="font-mono text-[11px] uppercase tracking-[0.14em]">
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/records">Records</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href={`/records/academic-summary${ayQuery}`}>
                Academic Summary
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <h1 className="font-serif text-[32px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[38px]">
        {title}
      </h1>
      <p className="max-w-3xl text-[15px] leading-relaxed text-muted-foreground">
        {subtitle}
      </p>
    </header>
  );
}
