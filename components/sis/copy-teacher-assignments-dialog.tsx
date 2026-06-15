'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2, UserCheck } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiFetch, jsonInit, ApiError } from '@/lib/query/fetcher';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

// "Copy teachers from [prior AY]" on /sis/ay-setup. Maps prior-AY sections
// to target-AY sections by (level_id, name) — same key `create_academic_year`
// uses when it copies sections. Skips retired sections and assignments that
// already exist on the target.
export function CopyTeacherAssignmentsDialog({
  targetAyCode,
  sourceOptions,
  children,
  open: openProp,
  onOpenChange,
}: {
  targetAyCode: string;
  sourceOptions: Array<{ ayCode: string; label: string }>;
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const [sourceAy, setSourceAy] = useState(sourceOptions[0]?.ayCode ?? '');
  const [result, setResult] = useState<null | {
    copied: number;
    skipped_no_section: number;
    skipped_already_existed: number;
    source_total: number;
  }>(null);

  type CopyResponse = {
    copied?: number;
    skipped_no_section?: number;
    skipped_already_existed?: number;
    source_total?: number;
  };

  const copyMutation = useMutation({
    mutationFn: () =>
      apiFetch<CopyResponse>(
        '/api/sis/ay-setup/copy-teacher-assignments',
        jsonInit('POST', { sourceAyCode: sourceAy, targetAyCode })
      ),
    onSuccess: (body) => {
      setResult({
        copied: Number(body.copied ?? 0),
        skipped_no_section: Number(body.skipped_no_section ?? 0),
        skipped_already_existed: Number(body.skipped_already_existed ?? 0),
        source_total: Number(body.source_total ?? 0),
      });
      toast.success(
        `Copied ${body.copied ?? 0} teacher assignment${(body.copied ?? 0) === 1 ? '' : 's'} from ${sourceAy}.`
      );
      router.refresh();
    },
    onError: (e) => {
      // Preserve the original fallback: `body?.error ?? 'copy failed'`.
      const serverError =
        e instanceof ApiError && e.body && typeof e.body === 'object'
          ? (e.body as { error?: string }).error
          : undefined;
      toast.error(serverError ?? 'copy failed');
    },
  });
  const submitting = copyMutation.isPending;

  function commit() {
    if (!sourceAy) return;
    setResult(null);
    copyMutation.mutate();
  }

  const disabled = sourceOptions.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setResult(null);
      }}
    >
      {children && (
        <DialogTrigger asChild>
          <span>{children}</span>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="size-5 text-primary" />
            Copy teachers to {targetAyCode}
          </DialogTitle>
          <DialogDescription>
            Carries <strong>teacher_assignments</strong> from a prior AY into{' '}
            {targetAyCode}, matching sections by{' '}
            <code className="font-mono text-[12px]">(level, name)</code>.
            Retired sections are skipped. Existing assignments on the target are
            left untouched.
          </DialogDescription>
        </DialogHeader>

        {disabled ? (
          <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            No other AYs to copy from. Create a second AY before using this.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2">
              <Label htmlFor="sourceAy">Source AY</Label>
              <Select
                value={sourceAy}
                onValueChange={setSourceAy}
                disabled={submitting}
              >
                <SelectTrigger id="sourceAy" className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sourceOptions.map((o) => (
                    <SelectItem key={o.ayCode} value={o.ayCode}>
                      {o.ayCode} — {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-center gap-3 rounded-xl border border-border bg-muted/30 p-3 font-mono text-[12px] text-muted-foreground">
              <span className="text-foreground">{sourceAy}</span>
              <ArrowRight className="size-3.5" />
              <span className="text-foreground">{targetAyCode}</span>
            </div>

            {result && (
              <div className="space-y-1 rounded-xl border border-border bg-card p-4 text-[12px]">
                <ResultRow label="Source rows" value={result.source_total} />
                <ResultRow
                  label="Copied"
                  value={result.copied}
                  tone="primary"
                />
                <ResultRow
                  label="Skipped (no matching section)"
                  value={result.skipped_no_section}
                />
                <ResultRow
                  label="Skipped (already existed)"
                  value={result.skipped_already_existed}
                />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            {result ? 'Done' : 'Cancel'}
          </Button>
          {!result && (
            <Button
              type="button"
              onClick={commit}
              disabled={submitting || disabled}
            >
              {submitting ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Copying…
                </>
              ) : (
                'Copy teachers'
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResultRow({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'primary';
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={
          'font-mono tabular-nums ' +
          (tone === 'primary'
            ? 'font-semibold text-foreground'
            : 'text-foreground')
        }
      >
        {value.toLocaleString('en-SG')}
      </span>
    </div>
  );
}
