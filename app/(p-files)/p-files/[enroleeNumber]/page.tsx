import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, CheckCircle2, FileWarning, ShieldAlert } from 'lucide-react';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import { freshenAyDocuments } from '@/lib/sis/freshen-document-statuses';
import { getStudentDocumentDetail } from '@/lib/p-files/queries';
import { DOCUMENT_SLOTS, GROUP_LABELS, type DocumentGroup } from '@/lib/p-files/document-config';
import { DocumentCard } from '@/components/p-files/document-card';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';

export default async function StudentDocumentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ enroleeNumber: string }>;
  searchParams: Promise<{ ay?: string }>;
}) {
  const { enroleeNumber } = await params;
  const { ay: ayParam } = await searchParams;
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (sessionUser.role !== 'p-file' && sessionUser.role !== 'admin' && sessionUser.role !== 'superadmin') redirect('/');

  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear(service);
  if (!currentAy) notFound();

  // Respect the `?ay=` searchParam so links from the historical-AY dashboard
  // resolve against the right admissions tables. Falls back to current AY
  // when the param is missing or not a known AY.
  const ayCodes = await listAyCodes(service);
  const selectedAy =
    ayParam && ayCodes.includes(ayParam) ? ayParam : currentAy.ay_code;

  // Auto-flip any expired-but-still-Valid doc statuses for this AY before
  // the page reads them. Cached 60s; existing PATCH routes invalidate via
  // the sis:${ayCode} tag.
  await freshenAyDocuments(selectedAy);

  const student = await getStudentDocumentDetail(selectedAy, enroleeNumber);
  if (!student) notFound();

  const docRow = student.rawDocRow;
  const canWrite = sessionUser.role === 'p-file' || sessionUser.role === 'superadmin';

  // Group slots by their document group
  const groups: { group: DocumentGroup; label: string; slots: typeof student.slots }[] = [];
  const groupOrder: DocumentGroup[] = ['student', 'student-expiring', 'parent', 'stp'];
  for (const g of groupOrder) {
    const groupSlots = student.slots.filter((slot) => {
      const config = DOCUMENT_SLOTS.find((s) => s.key === slot.key);
      return config?.group === g;
    });
    if (groupSlots.length > 0) {
      groups.push({ group: g, label: GROUP_LABELS[g], slots: groupSlots });
    }
  }

  const pct = student.total > 0 ? Math.round((student.complete / student.total) * 100) : 0;
  const isFullyComplete = pct === 100;
  const hasExpired = student.expired > 0;

  return (
    <PageShell>
      <Link
        href={{ pathname: '/p-files', query: { ay: selectedAy } }}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All students · {selectedAy}
      </Link>

      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          P-Files · Student Documents
        </p>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            {student.fullName}.
          </h1>
          {isFullyComplete ? (
            <Badge variant="outline" className="h-7 w-fit border-brand-mint bg-brand-mint/20 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink">
              <CheckCircle2 className="size-3.5" /> Complete
            </Badge>
          ) : hasExpired ? (
            <Badge variant="outline" className="h-7 w-fit border-brand-amber/40 bg-brand-amber/10 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-amber">
              <ShieldAlert className="size-3.5" /> {student.expired} expired
            </Badge>
          ) : (
            <Badge variant="outline" className="h-7 w-fit border-border bg-muted px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <FileWarning className="size-3.5" /> {student.missing} missing
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-5">
          {/* Percentage circle */}
          <div className="relative size-16 shrink-0 rounded-full border border-border/60 bg-card shadow-xs">
            <svg viewBox="0 0 64 64" className="size-full -rotate-90">
              <circle
                cx="32" cy="32" r="28"
                fill="none"
                className="stroke-muted"
                strokeWidth="4"
              />
              <circle
                cx="32" cy="32" r="28"
                fill="none"
                className={isFullyComplete ? 'stroke-brand-mint' : 'stroke-primary'}
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 28}`}
                strokeDashoffset={`${2 * Math.PI * 28 * (1 - pct / 100)}`}
                style={{ transition: 'stroke-dashoffset 0.4s ease' }}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center font-mono text-sm font-semibold tabular-nums text-foreground">
              {pct}%
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <span className="font-mono text-sm font-medium tabular-nums text-foreground">
              {student.complete}/{student.total} documents
            </span>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-muted-foreground">
              {student.studentNumber && (
                <>
                  <span className="font-mono tabular-nums">{student.studentNumber}</span>
                  <span className="text-hairline-strong">·</span>
                </>
              )}
              {student.level && (
                <>
                  <span>{student.level}</span>
                  <span className="text-hairline-strong">·</span>
                </>
              )}
              {student.section && <span>{student.section}</span>}
            </div>
          </div>
        </div>
      </header>

      {groups.map((g) => (
        <section key={g.group} className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
              {g.label}
            </h2>
            <Badge variant="outline" className="h-5 border-border bg-muted px-2 font-mono text-[10px] tabular-nums text-muted-foreground">
              {g.slots.filter((s) => s.status === 'valid').length}/{g.slots.length}
            </Badge>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.slots.map((slot) => {
              const config = DOCUMENT_SLOTS.find((s) => s.key === slot.key);
              const url = docRow[slot.key] as string | null | undefined;
              return (
                <DocumentCard
                  key={slot.key}
                  enroleeNumber={enroleeNumber}
                  slotKey={slot.key}
                  label={slot.label}
                  status={slot.status}
                  url={url ?? null}
                  expiryDate={slot.expiryDate}
                  expires={config?.expires ?? false}
                  meta={config?.meta ?? null}
                  canWrite={canWrite}
                />
              );
            })}
          </div>
        </section>
      ))}
    </PageShell>
  );
}
