"use client";

import { useState } from "react";

import { SubjectConfigEditDialog, type SubjectConfigDraft } from "@/components/sis/subject-config-edit-dialog";
import { ChartLegendChip } from "@/components/dashboard/chart-legend-chip";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Subject = { id: string; code: string; name: string; is_examinable: boolean };
type Level = { id: string; code: string; label: string };
type Config = {
  id: string;
  subject_id: string;
  level_id: string;
  ww_weight: number;
  pt_weight: number;
  qa_weight: number;
  ww_max_slots: number;
  pt_max_slots: number;
  qa_max: number;
};

// Classify weight ratios into the canonical HFSE profiles (KD #4). Primary
// levels use 40/40/20; Secondary levels use 30/50/20. Anything else is
// flagged as "custom" so registrars can spot non-standard configs fast.
type WeightProfile = "primary" | "secondary" | "custom";

function classifyProfile(ww: number, pt: number, qa: number): WeightProfile {
  if (ww === 40 && pt === 40 && qa === 20) return "primary";
  if (ww === 30 && pt === 50 && qa === 20) return "secondary";
  return "custom";
}

// Per-profile visual recipe. Tints mirror the legend ChartLegendChip
// gradients below (fresh→mint, primary→indigo, stale→amber, very-stale→
// destructive). Each cell uses a low-opacity bg-gradient at the same
// direction as the chip (-to-b) so the cell reads as a pale wash of the
// chip's color, not a flat tint. Hover brightens both stops; invalid-weight
// (sum ≠ 100) overrides with a destructive gradient.
const PROFILE_CLASS: Record<WeightProfile, string> = {
  primary:
    "border-brand-mint/50 bg-gradient-to-b from-chart-5/25 to-chart-3/15 " +
    "hover:from-chart-5/40 hover:to-chart-3/25 hover:border-brand-mint",
  secondary:
    "border-brand-indigo/50 bg-gradient-to-b from-brand-indigo/15 to-brand-navy/10 " +
    "hover:from-brand-indigo/25 hover:to-brand-navy/20 hover:border-brand-indigo",
  custom:
    "border-brand-amber/50 bg-gradient-to-b from-brand-amber/25 to-brand-amber/10 " +
    "hover:from-brand-amber/35 hover:to-brand-amber/20 hover:border-brand-amber",
};

export function SubjectConfigMatrix({
  subjects,
  levels,
  configs,
  ayCode,
}: {
  subjects: Subject[];
  levels: Level[];
  configs: Config[];
  ayCode: string;
}) {
  const [draft, setDraft] = useState<SubjectConfigDraft | null>(null);
  const [open, setOpen] = useState(false);

  // Index: key = `${subject_id}|${level_id}`, value = config
  const byKey = new Map<string, Config>();
  for (const c of configs) {
    byKey.set(`${c.subject_id}|${c.level_id}`, c);
  }

  function openCell(subject: Subject, level: Level, config: Config) {
    setDraft({
      configId: config.id,
      subjectCode: subject.code,
      subjectName: subject.name,
      levelCode: level.code,
      levelLabel: level.label,
      ayCode,
      ww_weight: Math.round(config.ww_weight * 100),
      pt_weight: Math.round(config.pt_weight * 100),
      qa_weight: Math.round(config.qa_weight * 100),
      ww_max_slots: config.ww_max_slots,
      pt_max_slots: config.pt_max_slots,
      qa_max: config.qa_max,
    });
    setOpen(true);
  }

  return (
    <>
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gradient-to-b from-muted/60 to-muted/30 hover:from-muted/60 hover:to-muted/30">
                <TableHead className="sticky left-0 z-10 w-[220px] border-r border-hairline bg-gradient-to-b from-muted/60 to-muted/30">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-4">
                    Subject
                  </span>
                </TableHead>
                {levels.map((l) => (
                  <TableHead key={l.id} className="min-w-[108px] p-2 text-center align-middle">
                    <div className="mx-auto inline-flex flex-col items-center gap-0.5 rounded-md border border-hairline bg-gradient-to-b from-background to-muted/30 px-2 py-1 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6)]">
                      <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">
                        {l.code}
                      </span>
                      <span className="font-mono text-[9px] tracking-[0.1em] text-muted-foreground">{l.label}</span>
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {subjects.length === 0 && (
                <TableRow>
                  <TableCell colSpan={levels.length + 1} className="py-10 text-center text-sm text-muted-foreground">
                    No subjects configured. Seed them via SQL first.
                  </TableCell>
                </TableRow>
              )}
              {subjects.map((s, rowIdx) => {
                // Alternating row stripes — both as low-opacity gradients so
                // they read as part of the same gradient-craft language as the
                // header row + cell tints (no flat washes).
                const stripeBg =
                  rowIdx % 2 === 1
                    ? "bg-gradient-to-b from-muted/20 to-muted/30"
                    : "bg-gradient-to-b from-background to-muted/10";
                const hoverBg =
                  "hover:from-accent/30 hover:to-accent/40 group-hover:from-accent/30 group-hover:to-accent/40";
                return (
                  <TableRow
                    key={s.id}
                    className={cn("group transition-colors", stripeBg, hoverBg)}>
                    <TableCell
                      className={cn(
                        "sticky left-0 z-10 border-r border-hairline transition-colors",
                        "border-l-2 border-l-brand-indigo",
                        stripeBg,
                        hoverBg,
                      )}>
                      <div className="flex items-center gap-2">
                        <span className="font-serif text-sm font-semibold text-foreground">{s.name}</span>
                        {!s.is_examinable && <Badge variant="muted">Non-exam</Badge>}
                      </div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        {s.code}
                      </div>
                    </TableCell>
                    {levels.map((l) => {
                      const cfg = byKey.get(`${s.id}|${l.id}`);
                      if (!cfg) {
                        return (
                          <TableCell key={l.id} className="p-2 text-center">
                            <span className="font-mono text-[11px] text-muted-foreground/60">—</span>
                          </TableCell>
                        );
                      }
                      const ww = Math.round(cfg.ww_weight * 100);
                      const pt = Math.round(cfg.pt_weight * 100);
                      const qa = Math.round(cfg.qa_weight * 100);
                      const weightsOk = ww + pt + qa === 100;
                      const profile = classifyProfile(ww, pt, qa);
                      return (
                        <TableCell key={l.id} className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => openCell(s, l, cfg)}
                            className={cn(
                              "inline-flex w-full flex-col items-center gap-0.5 rounded-md border px-2 py-1.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6)] transition-all",
                              "hover:-translate-y-0.5 hover:shadow-sm",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/20 focus-visible:border-brand-indigo/60",
                              // Profile tint (primary / secondary / custom)
                              PROFILE_CLASS[profile],
                              // Invalid sum overrides profile tint with destructive gradient
                              // (matches the very-stale legend chip's destructive gradient).
                              !weightsOk &&
                                "border-destructive/60 bg-gradient-to-b from-destructive/20 to-destructive/10 hover:from-destructive/30 hover:to-destructive/15 hover:border-destructive",
                            )}
                            title={`Edit ${s.name} × ${l.code} — weights ${ww}/${pt}/${qa} · slots ${cfg.ww_max_slots}/${cfg.pt_max_slots} · QA/${cfg.qa_max} · ${profile}`}>
                            <span className="font-mono text-[12px] font-semibold tabular-nums text-ink">
                              {ww}·{pt}·{qa}
                            </span>
                            <span className="font-mono text-[9px] tabular-nums text-ink-4">
                              {cfg.ww_max_slots}/{cfg.pt_max_slots} · QA/{cfg.qa_max}
                            </span>
                          </button>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {/* Profile legend strip — uses ChartLegendChip per the app-wide
            legend convention. Each chip here matches the tinted cell recipe
            via shared color semantics (fresh=mint, primary=indigo, stale=
            amber, very-stale=destructive). */}
        <div className="flex flex-wrap items-center gap-3 border-t border-hairline bg-muted/25 px-4 py-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5)]">
          <ChartLegendChip color="fresh" label="Primary · 40·40·20" />
          <ChartLegendChip color="primary" label="Secondary · 30·50·20" />
          <ChartLegendChip color="stale" label="Custom" />
          <ChartLegendChip color="very-stale" label="Invalid · sum ≠ 100" />
        </div>
      </Card>

      <SubjectConfigEditDialog draft={draft} open={open} onOpenChange={setOpen} />
    </>
  );
}
