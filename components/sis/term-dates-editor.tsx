"use client";

import { CalendarRange, CheckCircle2, Loader2, Lock, Sparkle, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { TermRow } from "@/lib/sis/ay-setup/queries";

type TermDraft = {
  id: string;
  term_number: number;
  label: string;
  start_date: string; // '' when null
  end_date: string;
  virtue_theme: string; // '' when null — free-text, used by Evaluation module + report card
  grading_lock_date: string; // '' when null — advisory cutoff chip on /markbook/grading
};

// "Term dates" dialog triggered from each AY row in /sis/ay-setup.
// Each term is its own card; a single "Save all" button flushes every
// dirty term in parallel via Promise.allSettled so partial failures don't
// block the rest.
export function TermDatesEditor({
  ayCode,
  ayLabel,
  terms,
  children,
}: {
  ayCode: string;
  ayLabel: string;
  terms: TermRow[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<TermDraft[]>(() => toDrafts(terms));
  const [savingAll, setSavingAll] = useState(false);
  const [justSavedIds, setJustSavedIds] = useState<Set<string>>(new Set());

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setDrafts(toDrafts(terms));
      setJustSavedIds(new Set());
    }
  }

  function updateDraft(id: string, patch: Partial<TermDraft>) {
    setDrafts((current) => current.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    // Clear the "just saved" check on the term the user is editing so the
    // visual state doesn't lie.
    setJustSavedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function isDirty(draft: TermDraft): boolean {
    const original = terms.find((t) => t.id === draft.id);
    return (
      (draft.start_date || "") !== (original?.start_date ?? "") ||
      (draft.end_date || "") !== (original?.end_date ?? "") ||
      (draft.virtue_theme.trim() || "") !== (original?.virtue_theme ?? "") ||
      (draft.grading_lock_date || "") !== (original?.grading_lock_date ?? "")
    );
  }

  async function saveAll() {
    // Pre-validate all dirty drafts — abort cleanly on any date-order issue
    // so we don't half-commit the batch.
    const dirtyDrafts = drafts.filter(isDirty);
    if (dirtyDrafts.length === 0) {
      setOpen(false);
      return;
    }
    for (const d of dirtyDrafts) {
      if (d.start_date && d.end_date && d.start_date > d.end_date) {
        toast.error(`${d.label}: end date must be on or after start date`);
        return;
      }
    }

    setSavingAll(true);
    const results = await Promise.allSettled(
      dirtyDrafts.map(async (d) => {
        const res = await fetch(`/api/sis/ay-setup/terms/${d.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            startDate: d.start_date || null,
            endDate: d.end_date || null,
            virtueTheme: d.virtue_theme.trim() || null,
            gradingLockDate: d.grading_lock_date || null,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? "save failed");
        }
        return d.id;
      }),
    );

    const succeeded = new Set<string>();
    const failures: string[] = [];
    results.forEach((r, i) => {
      const d = dirtyDrafts[i];
      if (r.status === "fulfilled") {
        succeeded.add(d.id);
      } else {
        failures.push(`${d.label}: ${r.reason instanceof Error ? r.reason.message : "save failed"}`);
      }
    });

    setJustSavedIds(succeeded);
    setSavingAll(false);

    if (failures.length === 0) {
      toast.success(`${dirtyDrafts.length} term${dirtyDrafts.length === 1 ? "" : "s"} updated.`);
      router.refresh();
      setTimeout(() => setOpen(false), 400);
    } else {
      toast.error(failures.join(" · "));
      // Partial success still worth refreshing so the UI reflects what did land.
      if (succeeded.size > 0) router.refresh();
    }
  }

  const sorted = drafts.slice().sort((a, b) => a.term_number - b.term_number);
  const dirtyCount = sorted.filter(isDirty).length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="flex max-h-[min(800px,88vh)] flex-col gap-0 p-0 sm:max-w-3xl">
        <ScrollArea className="flex max-h-full flex-col overflow-hidden">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle className="flex items-center gap-2 font-serif text-xl">
              <CalendarRange className="size-5 text-primary" />
              Term dates — {ayCode}
            </DialogTitle>
            <DialogDescription>
              {ayLabel}. Dates unblock the Attendance calendar and report-card publish windows. Virtue themes appear as
              the parenthetical on T1&ndash;T3 report cards (&ldquo;Form Class Adviser&rsquo;s Comments (HFSE Virtues:
              &hellip;)&rdquo;) and as the prompt in the Evaluation module.
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 py-4">
            {sorted.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No terms configured for this AY yet. Re-run the AY creation wizard.
              </div>
            ) : (
              <div className="space-y-3">
                {sorted.map((draft) => (
                  <TermCard
                    key={draft.id}
                    draft={draft}
                    dirty={isDirty(draft)}
                    justSaved={justSavedIds.has(draft.id)}
                    saving={savingAll && isDirty(draft)}
                    onChange={(patch) => updateDraft(draft.id, patch)}
                  />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-row items-center justify-between gap-2 border-t border-border px-6 py-4 sm:justify-between">
          <div className="flex items-center text-xs text-muted-foreground">
            {dirtyCount > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-brand-amber" aria-hidden="true" />
                {dirtyCount} unsaved change{dirtyCount === 1 ? "" : "s"}
              </span>
            ) : (
              <span>All saved.</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={savingAll}>
              Close
            </Button>
            <Button type="button" onClick={saveAll} disabled={savingAll || dirtyCount === 0}>
              {savingAll && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              {dirtyCount === 0 ? "Saved" : `Save ${dirtyCount} term${dirtyCount === 1 ? "" : "s"}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TermCard({
  draft,
  dirty,
  justSaved,
  saving,
  onChange,
}: {
  draft: TermDraft;
  dirty: boolean;
  justSaved: boolean;
  saving: boolean;
  onChange: (patch: Partial<TermDraft>) => void;
}) {
  return (
    <div
      className={
        "rounded-xl border bg-card p-4 transition-colors " +
        (dirty ? "border-brand-amber/40 bg-brand-amber-light/20" : "border-border")
      }>
      {/* Header row: term label + dirty/saved indicator. */}
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-base font-semibold tracking-tight text-foreground">{draft.label}</h3>
        <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">
          {saving ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Saving…
            </span>
          ) : justSaved ? (
            <span className="inline-flex items-center gap-1 text-primary">
              <CheckCircle2 className="size-3" />
              Saved
            </span>
          ) : dirty ? (
            <span className="inline-flex items-center gap-1 text-brand-amber">
              <span className="size-1.5 rounded-full bg-brand-amber" aria-hidden="true" />
              Unsaved
            </span>
          ) : (
            <span className="text-muted-foreground/50">Up to date</span>
          )}
        </div>
      </div>

      {/* Dates row: Start + End side by side. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field htmlFor={`start-${draft.id}`} label="Start date" icon={CalendarRange}>
          <DatePicker id={`start-${draft.id}`} value={draft.start_date} onChange={(v) => onChange({ start_date: v })} />
        </Field>
        <Field
          htmlFor={`end-${draft.id}`}
          label="End date"
          icon={CalendarRange}
          warning={
            draft.start_date && draft.end_date && draft.start_date > draft.end_date
              ? "Must be on or after start date"
              : null
          }>
          <DatePicker id={`end-${draft.id}`} value={draft.end_date} onChange={(v) => onChange({ end_date: v })} />
        </Field>
      </div>

      {/* Secondary row: Virtue + Grading lock. */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px]">
        <Field htmlFor={`virtue-${draft.id}`} label="Virtue theme" icon={Sparkle}>
          <Input
            id={`virtue-${draft.id}`}
            value={draft.virtue_theme}
            onChange={(e) => onChange({ virtue_theme: e.target.value })}
            placeholder="e.g. Faith, Hope, Love"
            maxLength={200}
            className="h-9"
          />
        </Field>
        <Field htmlFor={`lock-${draft.id}`} label="Grading lock by" icon={Lock}>
          <DatePicker
            id={`lock-${draft.id}`}
            value={draft.grading_lock_date}
            onChange={(v) => onChange({ grading_lock_date: v })}
          />
        </Field>
      </div>
    </div>
  );
}

function Field({
  htmlFor,
  label,
  icon: Icon,
  warning,
  children,
}: {
  htmlFor: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  warning?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <label
        htmlFor={htmlFor}
        className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </label>
      {children}
      {warning && (
        <p className="flex items-center gap-1 font-mono text-[10px] text-destructive">
          <XCircle className="size-3" />
          {warning}
        </p>
      )}
    </div>
  );
}

function toDrafts(terms: TermRow[]): TermDraft[] {
  return terms.map((t) => ({
    id: t.id,
    term_number: t.term_number,
    label: t.label,
    start_date: t.start_date ?? "",
    end_date: t.end_date ?? "",
    virtue_theme: t.virtue_theme ?? "",
    grading_lock_date: t.grading_lock_date ?? "",
  }));
}
