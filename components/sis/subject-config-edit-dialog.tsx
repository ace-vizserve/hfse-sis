"use client";

import { AlertCircle, CheckCircle2, Loader2, Save, Scale } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubjectConfigUpdateSchema } from "@/lib/schemas/subject-config";
import { cn } from "@/lib/utils";

export type SubjectConfigDraft = {
  configId: string;
  subjectCode: string;
  subjectName: string;
  levelCode: string;
  levelLabel: string;
  ayCode: string;
  ww_weight: number; // integer percentage
  pt_weight: number;
  qa_weight: number;
  ww_max_slots: number;
  pt_max_slots: number;
  qa_max: number; // max possible QA score (default 30 per Hard Rule #1)
};

export function SubjectConfigEditDialog({
  draft,
  open,
  onOpenChange,
}: {
  draft: SubjectConfigDraft | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [ww, setWw] = useState("40");
  const [pt, setPt] = useState("40");
  const [qa, setQa] = useState("20");
  const [wwSlots, setWwSlots] = useState("5");
  const [ptSlots, setPtSlots] = useState("5");
  const [qaMax, setQaMax] = useState("30");
  const [saving, setSaving] = useState(false);

  // Re-seed on draft change (i.e., user opened the dialog for a different row).
  useEffect(() => {
    if (!draft) return;
    setWw(String(draft.ww_weight));
    setPt(String(draft.pt_weight));
    setQa(String(draft.qa_weight));
    setWwSlots(String(draft.ww_max_slots));
    setPtSlots(String(draft.pt_max_slots));
    setQaMax(String(draft.qa_max));
  }, [draft]);

  const wwN = Number(ww) || 0;
  const ptN = Number(pt) || 0;
  const qaN = Number(qa) || 0;
  const sum = wwN + ptN + qaN;
  const sumOk = sum === 100;

  const parsed = SubjectConfigUpdateSchema.safeParse({
    ww_weight: wwN,
    pt_weight: ptN,
    qa_weight: qaN,
    ww_max_slots: Number(wwSlots) || 0,
    pt_max_slots: Number(ptSlots) || 0,
    qa_max: Number(qaMax) || 0,
  });

  async function save() {
    if (!draft) return;
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid values");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/sis/admin/subjects/${draft.configId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "save failed");
      toast.success(`${draft.subjectName} · ${draft.levelCode}: ${wwN}·${ptN}·${qaN} · QA/${Number(qaMax)}`);
      onOpenChange(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl!">
        <DialogHeader>
          <div className="flex items-start gap-3">
            {/* §7.4 gradient icon tile — anchors the dialog's purpose visually. */}
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Scale className="size-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {draft ? `${draft.ayCode} · ${draft.levelLabel}` : "Subject weights"}
              </p>
              <DialogTitle className="font-serif text-xl font-semibold leading-tight tracking-tight text-foreground">
                {draft ? `${draft.subjectName} · ${draft.levelCode}` : "Subject weights"}
              </DialogTitle>
              <DialogDescription className="text-[13px] leading-relaxed text-muted-foreground">
                {draft
                  ? "Changes apply to every grading sheet for this (subject × level) inside the AY."
                  : "Pick a cell to edit."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {draft && (
          <div className="space-y-5">
            {/* Live ratio bar — stacked horizontal segments showing the WW / PT /
                QA proportions so the user can see their choice before saving.
                Clamped to sum; if total ≠ 100 the bar shows partial fill. */}
            <RatioBar ww={wwN} pt={ptN} qa={qaN} sumOk={sumOk} sum={sum} />

            {/* Weights row — three inputs with short, aligned labels. */}
            <FieldRow
              eyebrow="Weights"
              helper="Must sum to 100%. Canonical HFSE: Primary 40·40·20, Secondary 30·50·20.">
              <div className="grid grid-cols-3 gap-3">
                <PercentField label="WW" sublabel="Written Works" value={ww} setValue={setWw} />
                <PercentField label="PT" sublabel="Perf. Tasks" value={pt} setValue={setPt} />
                <PercentField label="QA" sublabel="Quarterly" value={qa} setValue={setQa} />
              </div>
            </FieldRow>

            {/* Max slots row. */}
            <FieldRow eyebrow="Max slots" helper="Hard cap 5 per KD #5. Lowering won't delete existing entries.">
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="WW slots" value={wwSlots} setValue={setWwSlots} maxDigits={1} />
                <NumberField label="PT slots" value={ptSlots} setValue={setPtSlots} maxDigits={1} />
              </div>
            </FieldRow>

            {/* QA max row — single input, label-left input-right. */}
            <FieldRow
              eyebrow="QA max score"
              helper="Denominator of the QA percentage. Canonical 30 per Hard Rule #1; vary per subject (e.g. 50 Math, 20 Art).">
              <div className="max-w-[160px]">
                <NumberField label="Max score" value={qaMax} setValue={setQaMax} maxDigits={3} />
              </div>
            </FieldRow>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={!draft || saving || !parsed.success} className="gap-1.5">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {saving ? "Saving…" : "Save weights"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Thin 3-segment progress bar showing the WW/PT/QA split at a glance.
// Color-coded segments only — no inline labels, no gradients, no inset
// chrome. The compact header row carries the segment legend + live sum
// validation.
function RatioBar({ ww, pt, qa, sumOk, sum }: { ww: number; pt: number; qa: number; sumOk: boolean; sum: number }) {
  // Clamp so the bar never overflows when sum > 100; gap on the right when sum < 100.
  const total = Math.max(sum, 100);
  const pctOf = (n: number) => (n / total) * 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        <div className="flex items-center gap-3 tabular-nums">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-chart-3" /> WW {ww}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-brand-indigo" /> PT {pt}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-brand-amber" /> QA {qa}
          </span>
        </div>
        <span className={cn("inline-flex items-center gap-1 font-semibold", sumOk ? "text-ink" : "text-destructive")}>
          {sumOk ? <CheckCircle2 className="size-3" /> : <AlertCircle className="size-3" />}
          <span className="tabular-nums">{sum}%</span>
        </span>
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        {ww > 0 && (
          <div className="bg-chart-3 transition-[flex-basis] duration-200" style={{ flexBasis: `${pctOf(ww)}%` }} />
        )}
        {pt > 0 && (
          <div
            className="bg-brand-indigo transition-[flex-basis] duration-200"
            style={{ flexBasis: `${pctOf(pt)}%` }}
          />
        )}
        {qa > 0 && (
          <div className="bg-brand-amber transition-[flex-basis] duration-200" style={{ flexBasis: `${pctOf(qa)}%` }} />
        )}
      </div>
    </div>
  );
}

// Labeled form row — eyebrow + children + helper caption. Flat hierarchy
// (no nested card) so the dialog breathes.
function FieldRow({ eyebrow, helper, children }: { eyebrow: string; helper?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 border-t border-hairline pt-4 first:border-t-0 first:pt-0">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{eyebrow}</p>
      {children}
      {helper && <p className="text-[11px] leading-snug text-muted-foreground">{helper}</p>}
    </div>
  );
}

function PercentField({
  label,
  sublabel,
  value,
  setValue,
}: {
  label: string;
  sublabel: string;
  value: string;
  setValue: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="flex items-baseline gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <span className="font-semibold text-foreground">{label}</span>
        <span className="text-muted-foreground">· {sublabel}</span>
      </Label>
      <div className="relative">
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
          className="h-10 pr-7 text-right font-mono text-[15px] font-semibold tabular-nums"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[11px] text-muted-foreground">
          %
        </span>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  setValue,
  maxDigits,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  maxDigits: number;
}) {
  return (
    <div className="space-y-1">
      <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</Label>
      <Input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, "").slice(0, maxDigits))}
        className="h-10 text-right font-mono text-[15px] font-semibold tabular-nums"
      />
    </div>
  );
}
