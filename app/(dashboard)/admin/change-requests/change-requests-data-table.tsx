"use client";

import {
  ArrowUpRight,
  CalendarIcon,
  CheckCircle2,
  Circle,
  CircleCheck,
  CircleX,
  Filter,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import type { DateRange } from "react-day-picker";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ChangeRequestDecisionButtons } from "./decision-buttons";

export type AdminRequestRow = {
  id: string;
  grading_sheet_id: string;
  grade_entry_id: string;
  field_changed: string;
  slot_index: number | null;
  current_value: string | null;
  proposed_value: string;
  reason_category: string;
  justification: string;
  status: "pending" | "approved" | "rejected" | "applied" | "cancelled";
  requested_by_email: string;
  requested_at: string;
  reviewed_by_email: string | null;
  reviewed_at: string | null;
  decision_note: string | null;
  applied_by: string | null;
  applied_at: string | null;
};

const STATUS_CONFIG: Record<AdminRequestRow["status"], { label: string; icon: React.ElementType; className: string }> =
  {
    pending: {
      label: "Awaiting Review",
      icon: Circle,
      className: "border-border bg-muted text-muted-foreground",
    },
    approved: {
      label: "Approved · Awaiting Changes",
      icon: CheckCircle2,
      className: "border-primary/30 bg-primary/10 text-primary",
    },
    applied: {
      label: "Changes Applied",
      icon: CircleCheck,
      className: "border-brand-mint bg-brand-mint/30 text-ink",
    },
    rejected: {
      label: "Declined",
      icon: XCircle,
      className: "border-destructive/30 bg-destructive/10 text-destructive",
    },
    cancelled: {
      label: "Cancelled",
      icon: CircleX,
      className: "border-border bg-muted/50 text-muted-foreground",
    },
  };

function fieldLabel(field: string, slot: number | null): string {
  switch (field) {
    case "ww_scores":
      return slot != null ? `W${slot + 1}` : "WW";
    case "pt_scores":
      return slot != null ? `PT${slot + 1}` : "PT";
    case "qa_score":
      return "QA";
    case "letter_grade":
      return "Letter";
    case "is_na":
      return "N/A";
    default:
      return field;
  }
}

type StatusFilter = "all" | AdminRequestRow["status"];

export function ChangeRequestsDataTable({
  rows,
  canDecide,
  initialSheetIdFilter,
}: {
  rows: AdminRequestRow[];
  canDecide: boolean;
  initialSheetIdFilter?: string;
}) {
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const [range, setRange] = React.useState<DateRange | undefined>(undefined);
  const [rangeOpen, setRangeOpen] = React.useState(false);
  const [sheetIdFilter, setSheetIdFilter] = React.useState<string | null>(initialSheetIdFilter ?? null);

  const filtered = React.useMemo(() => {
    return rows.filter((r) => {
      if (sheetIdFilter && r.grading_sheet_id !== sheetIdFilter) return false;
      if (status !== "all" && r.status !== status) return false;
      if (range?.from) {
        const ts = new Date(r.requested_at).getTime();
        const from = startOfDay(range.from).getTime();
        if (ts < from) return false;
        if (range.to) {
          const to = endOfDay(range.to).getTime();
          if (ts > to) return false;
        }
      }
      return true;
    });
  }, [rows, status, range, sheetIdFilter]);

  const hasAnyFilter = status !== "all" || range?.from != null || sheetIdFilter != null;

  function clearAll() {
    setStatus("all");
    setRange(undefined);
    setSheetIdFilter(null);
  }

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-col gap-1">
          <CardTitle>Requests</CardTitle>
          <CardDescription>
            {canDecide
              ? "Approve or decline each request. Approvals are not auto-applied — the registrar applies them on the locked sheet."
              : "Read-only view. Only admins and superadmins can approve or decline."}
          </CardDescription>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Date range */}
          <Popover open={rangeOpen} onOpenChange={setRangeOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn("h-9 justify-start gap-2 font-normal", !range?.from && "text-muted-foreground")}>
                <CalendarIcon className="h-4 w-4" />
                {range?.from ? (
                  <span className="font-mono text-[12px] tabular-nums">
                    {formatDay(range.from)}
                    {range.to ? ` – ${formatDay(range.to)}` : ""}
                  </span>
                ) : (
                  <span>Any date</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="range" selected={range} onSelect={setRange} numberOfMonths={2} captionLayout="dropdown" />
              <div className="flex items-center justify-between border-t border-hairline p-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRange(undefined)}
                  disabled={!range?.from}>
                  Clear
                </Button>
                <Button type="button" size="sm" onClick={() => setRangeOpen(false)}>
                  Done
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          {/* Status */}
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Awaiting Review</SelectItem>
              <SelectItem value="approved">Approved · Awaiting Changes</SelectItem>
              <SelectItem value="applied">Changes Applied</SelectItem>
              <SelectItem value="rejected">Declined</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>

          {hasAnyFilter && (
            <Button type="button" variant="ghost" size="sm" onClick={clearAll} className="h-9 gap-1">
              <X className="h-3.5 w-3.5" />
              Clear
            </Button>
          )}

          <div className="ml-auto flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            <Filter className="h-3 w-3" />
            {filtered.length} of {rows.length}
          </div>
        </div>

        {sheetIdFilter && (
          <div className="mt-2 flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs">
            <span className="font-mono uppercase tracking-wider text-muted-foreground">Filtered to sheet</span>
            <span className="font-mono text-foreground">{sheetIdFilter.slice(0, 8)}…</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSheetIdFilter(null)}
              className="ml-auto h-6 gap-1 px-2">
              <X className="h-3 w-3" />
              Clear
            </Button>
          </div>
        )}
      </CardHeader>

      <CardContent className="px-0">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {hasAnyFilter ? "No requests match the current filters." : "No change requests yet."}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Filed</TableHead>
                <TableHead>Teacher</TableHead>
                <TableHead>Field</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>Reason / Justification</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {new Date(r.requested_at).toLocaleString("en-SG", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </TableCell>
                  <TableCell className="text-sm">{r.requested_by_email}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {fieldLabel(r.field_changed, r.slot_index)}
                  </TableCell>
                  <TableCell className="tabular-nums text-sm">
                    {r.current_value ?? "(blank)"} <span className="text-muted-foreground">→</span>{" "}
                    <span className="font-medium">{r.proposed_value}</span>
                  </TableCell>
                  <TableCell className="max-w-xs text-xs text-muted-foreground">
                    <div className="font-mono text-[10px] uppercase tracking-wider">
                      {r.reason_category.replace(/_/g, " ")}
                    </div>
                    <div className="mt-0.5 line-clamp-2">{r.justification}</div>
                    {r.decision_note && <div className="mt-1 line-clamp-1 text-[11px]">Note: {r.decision_note}</div>}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const cfg = STATUS_CONFIG[r.status];
                      const Icon = cfg.icon;
                      return (
                        <Badge
                          variant="outline"
                          className={`h-6 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] ${cfg.className}`}>
                          <Icon className="h-3 w-3" />
                          {cfg.label}
                        </Badge>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/grading/${r.grading_sheet_id}`}
                        className="inline-flex items-center gap-1 text-xs text-primary">
                        Sheet
                        <ArrowUpRight className="size-3" />
                      </Link>
                      {canDecide && r.status === "pending" && <ChangeRequestDecisionButtons requestId={r.id} />}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function startOfDay(d: Date): Date {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

function endOfDay(d: Date): Date {
  const n = new Date(d);
  n.setHours(23, 59, 59, 999);
  return n;
}

function formatDay(d: Date): string {
  return d.toLocaleDateString("en-SG", { month: "short", day: "numeric" });
}
