'use client';

import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  FileCheck,
  FileText,
  Inbox,
  Mail,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { NotifyDialog } from '@/components/p-files/notify-dialog';
import { PromiseDialog } from '@/components/p-files/promise-dialog';
import { DocumentValidationActions } from '@/components/sis/document-validation-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  OPTIONAL_DOCUMENT_SLOT_KEYS,
  STP_CONDITIONAL_SLOT_KEYS,
  type DocumentSlot,
} from '@/lib/sis/queries';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Documents tab — split-pane viewer
//
// Left pane: scannable list of every document slot for the applicant, grouped
// by category (Non-expiring / Expiring / Parent or Guardian / STP). Each row
// is a button — click loads the file into the right preview pane.
//
// Right pane: sticky preview that renders the selected slot's PDF (iframe) or
// image (<img>) inline, with the existing approve / reject controls relocated
// into the footer where the file is actually visible. Hidden until a slot is
// selected, and below the `lg` breakpoint the viewer falls back to the legacy
// per-row dialog flow rather than trying to cram a split layout into a
// phone-width viewport.
//
// API contract:  `/api/sis/students/[enroleeNumber]/document/[slotKey]` is
// untouched — `<DocumentValidationActions>` already calls it. The viewer is
// purely a UX redesign.
// ─────────────────────────────────────────────────────────────────────────────

type ApplicationLite = {
  stpApplicationType: string | null;
  /**
   * Used to gate the admissions chase actions (Notify / Promise) on per-slot
   * cards — only un-enrolled applicants in the active funnel scope can be
   * chased here. Enrolled rows belong to the P-Files renewal lifecycle,
   * which surfaces its own actions on /p-files/[enroleeNumber].
   */
  applicationStatus?: string | null;
  motherEmail?: string | null;
  fatherEmail?: string | null;
  guardianEmail?: string | null;
};

type Props = {
  application: ApplicationLite;
  documents: DocumentSlot[];
  enroleeNumber: string;
  ayCode: string;
  // Document rights, resolved by the page from the viewer's capabilities.
  //
  // BOTH DEFAULT TO FALSE, deliberately. This component used to take no
  // permission input at all, so it rendered Approve / Reject / Notify /
  // Mark-as-promised to anyone who could open the applicant page — and the
  // routes behind those buttons gate on capabilities the viewer may not hold.
  // The academic coordinator got the full set and a 403 on every click, since
  // migration 106 moved document work off her (KD #173). A caller that forgets
  // these now shows a read-only record, which is the safe way to be wrong.
  //
  // Gated here at the call site rather than inside DocumentValidationActions:
  // that component is mounted from more than one surface, and the answer
  // depends on which student is on screen, not on the button.
  /** `documents_pre_enrolment.validate` — approve or reject an upload. */
  canValidate?: boolean;
  /** `documents_pre_enrolment.chase` — remind the parent, or record a
   *  promised-by date. */
  canChase?: boolean;
};

// Active funnel statuses where the admissions team may chase parents
// to act on outstanding documents. Mirrors the gate in
// lib/sis/document-chase-queue.ts + lib/p-files/notify-helpers.ts.
const ADMISSIONS_CHASE_STATUSES = new Set([
  'Submitted',
  'Ongoing Verification',
  'Processing',
]);

// Slot statuses on which the admissions team can usefully fire chase
// actions (Notify / Promise). Excludes Valid (no action needed) +
// Expired (renewal lens — that's P-Files territory per KD #60).
function isAdmissionsChaseable(status: string | null): boolean {
  const s = (status ?? '').trim().toLowerCase();
  return s === 'to follow' || s === 'rejected' || s === 'uploaded' || s === '';
}

type FilterKey = 'all' | 'pending' | 'valid' | 'rejected' | 'expiring';

const FILTER_OPTIONS: ReadonlyArray<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending validation' },
  { key: 'valid', label: 'Validated' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'expiring', label: 'Expiring soon' },
];

const EXPIRY_SOON_WINDOW_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

// Same category buckets as the previous inline tab. The parent / guardian
// bucket and the STP bucket are conditionally rendered based on the
// applicant's profile.
const DOC_CATEGORY_KEYS = {
  nonExpiring: new Set(['idPicture', 'birthCert', 'educCert', 'medical']),
  expiring: new Set(['passport', 'pass']),
  parentGuardian: new Set([
    'motherPassport',
    'motherPass',
    'fatherPassport',
    'fatherPass',
    'guardianPassport',
    'guardianPass',
  ]),
} as const;

const STP_KEYS = new Set<string>(STP_CONDITIONAL_SLOT_KEYS);
const OPTIONAL_KEYS = new Set<string>(OPTIONAL_DOCUMENT_SLOT_KEYS);

// ─── helpers ────────────────────────────────────────────────────────────────

function normalizeStatus(raw: string | null): string {
  return (raw ?? '').trim().toLowerCase();
}

type StatusBucket = 'valid' | 'pending' | 'rejected' | 'missing';
function statusBucket(status: string | null, hasFile: boolean): StatusBucket {
  const s = normalizeStatus(status);
  if (s === 'valid') return 'valid';
  if (s === 'rejected' || s === 'expired') return 'rejected';
  if (s === 'uploaded' || s === 'to follow') return 'pending';
  if (!hasFile) return 'missing';
  return 'pending';
}

// Per-bucket gradient recipes — match the design-system §9.3 status pills
// so the icon tiles and badges read with the same colour grammar as
// success / warning / blocked Badges across the app.
const TILE_GRADIENT: Record<StatusBucket, string> = {
  valid: 'bg-gradient-to-br from-brand-mint to-brand-sky',
  pending: 'bg-gradient-to-br from-brand-amber to-brand-amber/80',
  rejected: 'bg-gradient-to-br from-destructive to-destructive/80',
  missing: 'bg-gradient-to-br from-ink-4 to-ink-3',
};

// Bucket → Badge variant. Variants are gradient by design (success /
// warning / blocked) so a `<Badge variant={...}>` call already produces
// the right pill style. Missing falls back to outline so unsubmitted
// slots don't wear an alarm-coloured pill.
type GradientBadgeVariant =
  | 'success'
  | 'warning'
  | 'blocked'
  | 'default'
  | 'outline';
function statusBadgeVariant(bucket: StatusBucket): GradientBadgeVariant {
  if (bucket === 'valid') return 'success';
  if (bucket === 'pending') return 'warning';
  if (bucket === 'rejected') return 'blocked';
  return 'outline';
}

type ExpiryBucket = 'none' | 'fresh' | 'expiring' | 'expired';
function expiryBucket(expiry: string | null): ExpiryBucket {
  if (!expiry) return 'none';
  const t = new Date(expiry).getTime();
  if (Number.isNaN(t)) return 'none';
  const delta = t - Date.now();
  if (delta <= 0) return 'expired';
  if (delta < EXPIRY_SOON_WINDOW_MS) return 'expiring';
  return 'fresh';
}

type FileKind = 'pdf' | 'image' | 'other';
function fileKind(url: string | null): FileKind | null {
  if (!url) return null;
  const lower = url.toLowerCase().split('?')[0].split('#')[0];
  if (lower.endsWith('.pdf')) return 'pdf';
  if (/\.(png|jpe?g|webp|gif|heic|heif|bmp)$/.test(lower)) return 'image';
  return 'other';
}

function fileNameFromUrl(url: string | null): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
    return decodeURIComponent(last);
  } catch {
    return url.split('/').pop() ?? '';
  }
}

function formatExpiry(expiry: string | null): string | null {
  if (!expiry) return null;
  const d = new Date(expiry);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ─── component ──────────────────────────────────────────────────────────────

export function DocumentsViewer({
  application,
  documents,
  enroleeNumber,
  ayCode,
  canValidate = false,
  canChase = false,
}: Props) {
  // Hide STP slots when the parent didn't opt into the STP sub-flow (KD #61).
  const stpEnabled = !!application.stpApplicationType;
  const visibleDocuments = useMemo(
    () =>
      stpEnabled ? documents : documents.filter((d) => !STP_KEYS.has(d.key)),
    [stpEnabled, documents]
  );

  const isAdmissionsScope =
    !!application.applicationStatus &&
    ADMISSIONS_CHASE_STATUSES.has(application.applicationStatus);
  const recipients = useMemo(
    () => ({
      motherEmail: application.motherEmail ?? null,
      fatherEmail: application.fatherEmail ?? null,
      guardianEmail: application.guardianEmail ?? null,
    }),
    [
      application.motherEmail,
      application.fatherEmail,
      application.guardianEmail,
    ]
  );

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');

  const selectedDoc = selectedKey
    ? (visibleDocuments.find((d) => d.key === selectedKey) ?? null)
    : null;

  // Progress meter — required = total minus always-optional minus
  // (STP-conditional when STP isn't enabled). Matches the gate logic in
  // `app/api/sis/students/[enroleeNumber]/stage/[stageKey]/route.ts`.
  const requiredDocs = visibleDocuments.filter(
    (d) => !OPTIONAL_KEYS.has(d.key) && (stpEnabled || !STP_KEYS.has(d.key))
  );
  const requiredValidated = requiredDocs.filter(
    (d) => statusBucket(d.status, !!d.url) === 'valid'
  ).length;
  const progressPct =
    requiredDocs.length === 0
      ? 0
      : Math.round((requiredValidated / requiredDocs.length) * 100);

  // Filter pill counts so the toolbar surfaces what's behind each option.
  const counts = useMemo(() => {
    const c = {
      all: visibleDocuments.length,
      pending: 0,
      valid: 0,
      rejected: 0,
      expiring: 0,
    };
    for (const d of visibleDocuments) {
      const sb = statusBucket(d.status, !!d.url);
      if (sb === 'pending') c.pending += 1;
      if (sb === 'valid') c.valid += 1;
      if (sb === 'rejected') c.rejected += 1;
      const eb = expiryBucket(d.expiry);
      if (eb === 'expiring' || eb === 'expired') c.expiring += 1;
    }
    return c;
  }, [visibleDocuments]);

  // Apply the active filter to each category's slot list.
  function applyFilter(docs: DocumentSlot[]): DocumentSlot[] {
    if (filter === 'all') return docs;
    return docs.filter((d) => {
      const sb = statusBucket(d.status, !!d.url);
      if (filter === 'pending') return sb === 'pending';
      if (filter === 'valid') return sb === 'valid';
      if (filter === 'rejected') return sb === 'rejected';
      if (filter === 'expiring') {
        const eb = expiryBucket(d.expiry);
        return eb === 'expiring' || eb === 'expired';
      }
      return true;
    });
  }

  const nonExpiringDocs = applyFilter(
    visibleDocuments.filter((d) => DOC_CATEGORY_KEYS.nonExpiring.has(d.key))
  );
  const expiringDocs = applyFilter(
    visibleDocuments.filter((d) => DOC_CATEGORY_KEYS.expiring.has(d.key))
  );
  const parentGuardianDocs = applyFilter(
    visibleDocuments.filter((d) => DOC_CATEGORY_KEYS.parentGuardian.has(d.key))
  );
  const stpDocs = applyFilter(
    visibleDocuments.filter((d) => STP_KEYS.has(d.key))
  );

  const totalAfterFilter =
    nonExpiringDocs.length +
    expiringDocs.length +
    parentGuardianDocs.length +
    stpDocs.length;

  const hasSelection = !!selectedDoc;

  return (
    <div className="space-y-4">
      <Toolbar
        filter={filter}
        setFilter={setFilter}
        counts={counts}
        validatedCount={requiredValidated}
        requiredCount={requiredDocs.length}
        progressPct={progressPct}
      />

      <div
        className={cn(
          'grid gap-4',
          // No selection → list spans full width with a 2-col card grid below.
          // Selection → split: list on the left, preview on the right (lg only;
          // smaller viewports stack via `<DocumentValidationActions>`'s own
          // dialog, which is what already happens for narrow widths).
          hasSelection
            ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]'
            : 'grid-cols-1'
        )}
      >
        <SlotList
          hasSelection={hasSelection}
          selectedKey={selectedKey}
          onSelect={setSelectedKey}
          enroleeNumber={enroleeNumber}
          ayCode={ayCode}
          totalAfterFilter={totalAfterFilter}
          totalBeforeFilter={visibleDocuments.length}
          filter={filter}
          nonExpiringDocs={nonExpiringDocs}
          expiringDocs={expiringDocs}
          parentGuardianDocs={parentGuardianDocs}
          stpDocs={stpDocs}
        />

        {hasSelection && selectedDoc && (
          <PreviewPane
            doc={selectedDoc}
            enroleeNumber={enroleeNumber}
            ayCode={ayCode}
            onClose={() => setSelectedKey(null)}
            isAdmissionsScope={isAdmissionsScope}
            recipients={recipients}
            applicationStatus={application.applicationStatus ?? null}
            canValidate={canValidate}
            canChase={canChase}
          />
        )}
      </div>
    </div>
  );
}

// ─── toolbar ────────────────────────────────────────────────────────────────

function Toolbar({
  filter,
  setFilter,
  counts,
  validatedCount,
  requiredCount,
  progressPct,
}: {
  filter: FilterKey;
  setFilter: (f: FilterKey) => void;
  counts: Record<FilterKey, number>;
  validatedCount: number;
  requiredCount: number;
  progressPct: number;
}) {
  return (
    <Card className="@container/toolbar gap-0 p-0">
      <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Validation progress
          </p>
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-[22px] font-semibold tabular-nums text-foreground">
              {validatedCount}
            </span>
            <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
              of {requiredCount} required validated
            </span>
            <span
              className={cn(
                'font-mono text-[10px] font-semibold uppercase tracking-[0.14em]',
                progressPct === 100
                  ? 'text-brand-mint'
                  : 'text-muted-foreground'
              )}
            >
              {progressPct}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full transition-all',
                progressPct === 100
                  ? 'bg-gradient-to-r from-brand-mint to-brand-mint/70'
                  : 'bg-gradient-to-r from-brand-indigo to-brand-indigo/70'
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      <div className="border-t border-hairline bg-muted/25 px-3 py-2.5">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
          <TabsList variant={'default'}>
            {FILTER_OPTIONS.map((opt) => {
              const count = counts[opt.key];
              return (
                <TabsTrigger
                  key={opt.key}
                  value={opt.key}
                  className="gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]"
                >
                  {opt.label}
                  {count > 0 && <span className="tabular-nums">{count}</span>}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      </div>
    </Card>
  );
}

// ─── slot list ──────────────────────────────────────────────────────────────

function SlotList({
  hasSelection,
  selectedKey,
  onSelect,
  enroleeNumber,
  ayCode,
  totalAfterFilter,
  totalBeforeFilter,
  filter,
  nonExpiringDocs,
  expiringDocs,
  parentGuardianDocs,
  stpDocs,
}: {
  hasSelection: boolean;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  enroleeNumber: string;
  ayCode: string;
  totalAfterFilter: number;
  totalBeforeFilter: number;
  filter: FilterKey;
  nonExpiringDocs: DocumentSlot[];
  expiringDocs: DocumentSlot[];
  parentGuardianDocs: DocumentSlot[];
  stpDocs: DocumentSlot[];
}) {
  if (totalAfterFilter === 0) {
    return (
      <Card className="items-center py-16 text-center">
        <CardContent className="flex flex-col items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Inbox className="size-5" />
          </div>
          <div className="font-serif text-base font-semibold text-foreground">
            {filter === 'all'
              ? 'No documents on file yet'
              : `No documents match "${FILTER_OPTIONS.find((f) => f.key === filter)?.label}"`}
          </div>
          {filter !== 'all' && (
            <p className="text-xs text-muted-foreground">
              {totalBeforeFilter} document{totalBeforeFilter === 1 ? '' : 's'}{' '}
              hidden by the active filter.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <CategoryGroup
        title="Non-expiring documents"
        subtitle="Permanent records — upload once."
        icon={FileCheck}
        docs={nonExpiringDocs}
        hasSelection={hasSelection}
        selectedKey={selectedKey}
        onSelect={onSelect}
        enroleeNumber={enroleeNumber}
        ayCode={ayCode}
      />
      <CategoryGroup
        title="Expiring documents"
        subtitle="Student-scoped — track expiry, parent re-uploads when it lapses."
        icon={CalendarClock}
        docs={expiringDocs}
        hasSelection={hasSelection}
        selectedKey={selectedKey}
        onSelect={onSelect}
        enroleeNumber={enroleeNumber}
        ayCode={ayCode}
      />
      <CategoryGroup
        title="Parent / Guardian documents"
        subtitle="Mother, father and guardian identity documents — all expiring."
        icon={Users}
        docs={parentGuardianDocs}
        hasSelection={hasSelection}
        selectedKey={selectedKey}
        onSelect={onSelect}
        enroleeNumber={enroleeNumber}
        ayCode={ayCode}
      />
      <CategoryGroup
        title="Singapore Student Pass (STP)"
        subtitle="ICA-required documents on top of the standard package."
        icon={ShieldCheck}
        docs={stpDocs}
        hasSelection={hasSelection}
        selectedKey={selectedKey}
        onSelect={onSelect}
        enroleeNumber={enroleeNumber}
        ayCode={ayCode}
      />
    </div>
  );
}

function CategoryGroup({
  title,
  subtitle,
  icon: Icon,
  docs,
  hasSelection,
  selectedKey,
  onSelect,
  enroleeNumber,
  ayCode,
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  docs: DocumentSlot[];
  hasSelection: boolean;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  enroleeNumber: string;
  ayCode: string;
}) {
  if (docs.length === 0) return null;

  // No selection → 2-col grid (current density). Selection → 1-col so the
  // narrower left pane can still fit the icon + label + status row cleanly.
  const gridCols = hasSelection ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2';

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <CardHeader className="border-b border-border px-5 py-4">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {title}
        </CardDescription>
        <CardTitle className="font-serif text-[15px] font-semibold tracking-tight text-foreground">
          {subtitle}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <ul className={cn('grid gap-2 p-3', gridCols)}>
        {docs.map((doc) => (
          <SlotRow
            key={doc.key}
            doc={doc}
            isActive={selectedKey === doc.key}
            onSelect={onSelect}
            enroleeNumber={enroleeNumber}
            ayCode={ayCode}
          />
        ))}
      </ul>
    </Card>
  );
}

function SlotRow({
  doc,
  isActive,
  onSelect,
  enroleeNumber,
  ayCode,
}: {
  doc: DocumentSlot;
  isActive: boolean;
  onSelect: (key: string) => void;
  enroleeNumber: string;
  ayCode: string;
}) {
  const hasFile = !!doc.url;
  const sb = statusBucket(doc.status, hasFile);
  const eb = expiryBucket(doc.expiry);

  // Tile uses the per-bucket gradient + white text + brand-tile shadow —
  // same craft language as the indigo gradient tiles used everywhere else
  // in the SIS (sidebar, hero stats, dialog headers).
  const tileClass = cn(
    'flex size-9 shrink-0 items-center justify-center rounded-xl text-white shadow-brand-tile transition-colors',
    TILE_GRADIENT[sb]
  );

  const formattedExpiry = formatExpiry(doc.expiry);

  return (
    <li id={`slot-${doc.key}`} className="scroll-mt-20">
      <button
        type="button"
        onClick={() => onSelect(doc.key)}
        className={cn(
          'group flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-all',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40',
          isActive
            ? 'border-l-2 border-l-brand-indigo border-y-hairline border-r-hairline bg-brand-indigo/5 shadow-xs'
            : 'border-hairline bg-card hover:-translate-y-0.5 hover:border-brand-indigo/30 hover:shadow-sm'
        )}
      >
        <div className={tileClass}>
          {sb === 'valid' && <CheckCircle2 className="size-4" />}
          {sb === 'pending' && <FileText className="size-4" />}
          {sb === 'rejected' && <AlertTriangle className="size-4" />}
          {sb === 'missing' && <FileText className="size-4" />}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <span className="truncate font-serif text-[14px] font-semibold leading-tight tracking-tight text-foreground">
              {doc.label}
            </span>
            {doc.status ? (
              <Badge variant={statusBadgeVariant(sb)}>{doc.status}</Badge>
            ) : (
              <Badge variant="outline">Missing</Badge>
            )}
          </div>
          {formattedExpiry && (
            <ExpiryChip expiry={formattedExpiry} bucket={eb} />
          )}
        </div>
      </button>
    </li>
  );
}

function ExpiryChip({
  expiry,
  bucket,
}: {
  expiry: string;
  bucket: ExpiryBucket;
}) {
  const tone = cn(
    'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]',
    bucket === 'expired' &&
      'border-destructive/40 bg-gradient-to-b from-destructive/15 to-destructive/5 text-destructive',
    bucket === 'expiring' &&
      'border-brand-amber/40 bg-gradient-to-b from-brand-amber/20 to-brand-amber/5 text-foreground',
    bucket === 'fresh' &&
      'border-hairline bg-gradient-to-b from-muted to-muted/60 text-muted-foreground'
  );
  return (
    <span className={tone}>
      <CalendarClock className="size-3" />
      {bucket === 'expired' ? `Expired ${expiry}` : `Expires ${expiry}`}
    </span>
  );
}

// ─── preview pane ───────────────────────────────────────────────────────────

function PreviewPane({
  doc,
  enroleeNumber,
  ayCode,
  onClose,
  isAdmissionsScope,
  recipients,
  applicationStatus,
  canValidate,
  canChase,
}: {
  doc: DocumentSlot;
  enroleeNumber: string;
  ayCode: string;
  onClose: () => void;
  isAdmissionsScope: boolean;
  recipients: {
    motherEmail: string | null;
    fatherEmail: string | null;
    guardianEmail: string | null;
  };
  applicationStatus: string | null;
  canValidate: boolean;
  canChase: boolean;
}) {
  const kind = fileKind(doc.url);
  const filename = fileNameFromUrl(doc.url);

  // Show Notify + Promise per-slot when this is an active-funnel applicant
  // and the slot is in a chaseable state. Hidden for enrolled rows — those
  // are P-Files territory and surface their own renewal actions on the
  // /p-files/[enroleeNumber] detail page.
  const showAdmissionsChase =
    isAdmissionsScope && isAdmissionsChaseable(doc.status) && canChase;

  return (
    <div className="hidden lg:block">
      <Card className="sticky top-20 gap-0 overflow-hidden p-0">
        <CardHeader className="border-b border-border px-5 py-4">
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Preview
          </CardDescription>
          <CardTitle className="flex items-baseline gap-2 font-serif text-[16px] font-semibold tracking-tight text-foreground">
            {doc.label}
            {doc.status ? (
              <Badge
                variant={statusBadgeVariant(
                  statusBucket(doc.status, !!doc.url)
                )}
              >
                {doc.status}
              </Badge>
            ) : (
              <Badge variant="outline">Missing</Badge>
            )}
          </CardTitle>
          {filename && (
            <p
              className="truncate font-mono text-[11px] text-muted-foreground"
              title={filename}
            >
              {filename}
            </p>
          )}
          <CardAction>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onClose}
              className="size-8 p-0 text-muted-foreground hover:text-foreground"
              aria-label="Close preview"
            >
              <X className="size-4" />
            </Button>
          </CardAction>
        </CardHeader>

        <div className="bg-muted/30">
          <PreviewBody url={doc.url} kind={kind} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/20 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {canValidate && (
              <DocumentValidationActions
                ayCode={ayCode}
                enroleeNumber={enroleeNumber}
                slotKey={doc.key}
                label={doc.label}
                status={doc.status}
                url={doc.url}
                applicationStatus={applicationStatus}
              />
            )}
            {showAdmissionsChase && (
              <>
                <NotifyDialog
                  enroleeNumber={enroleeNumber}
                  slotKey={doc.key}
                  label={doc.label}
                  recipients={recipients}
                  module="admissions"
                  trigger={
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                    >
                      <Mail className="size-3" />
                      Notify parent
                    </Button>
                  }
                />
                <PromiseDialog
                  enroleeNumber={enroleeNumber}
                  slotKey={doc.key}
                  label={doc.label}
                  module="admissions"
                  trigger={
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                    >
                      <CalendarClock className="size-3" />
                      Mark as promised
                    </Button>
                  }
                />
              </>
            )}
          </div>
          {doc.url && (
            <a
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground"
            >
              Open original
              <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      </Card>
    </div>
  );
}

function PreviewBody({
  url,
  kind,
}: {
  url: string | null;
  kind: FileKind | null;
}) {
  const wrapperClass = 'aspect-[4/5] max-h-[calc(100vh-14rem)] w-full';

  if (!url || !kind) {
    return (
      <div
        className={cn(
          wrapperClass,
          'flex flex-col items-center justify-center gap-2 px-6 text-center'
        )}
      >
        <div className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Inbox className="size-5" />
        </div>
        <p className="font-serif text-sm font-semibold text-foreground">
          No file uploaded yet
        </p>
        <p className="max-w-xs text-xs text-muted-foreground">
          The parent hasn&apos;t uploaded this document. There&apos;s nothing to
          validate until it arrives.
        </p>
      </div>
    );
  }

  if (kind === 'pdf') {
    return (
      <iframe
        title="Document preview"
        src={url}
        className={cn(wrapperClass, 'block border-0 bg-white')}
      />
    );
  }

  if (kind === 'image') {
    return (
      <div className={cn(wrapperClass, 'flex items-center justify-center')}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="Document preview"
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        wrapperClass,
        'flex flex-col items-center justify-center gap-3 px-6 text-center'
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <FileText className="size-5" />
      </div>
      <p className="font-serif text-sm font-semibold text-foreground">
        Inline preview not supported
      </p>
      <p className="max-w-xs text-xs text-muted-foreground">
        This file type can&apos;t be rendered in-page. Use the &ldquo;Open
        original&rdquo; link below to view it in a new tab.
      </p>
    </div>
  );
}
