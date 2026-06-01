'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  ENROLLMENT_STATUS_LABELS,
  ENROLLMENT_STATUS_VALUES,
  WITHDRAWAL_REASON_VALUES,
  WITHDRAWAL_REASON_LABELS,
  type EnrollmentStatus,
  type WithdrawalReason,
} from '@/lib/schemas/enrolment';

type MidTermPayload = {
  termNumber: number;
  termLabel: string;
  sectionId: string;
  sectionStudentId: string;
};

export function EnrolmentEditSheet({
  sectionId,
  enrolmentId,
  ayCode,
  initial,
  studentName,
  indexNumber,
  children,
}: {
  sectionId: string;
  enrolmentId: string;
  ayCode: string;
  initial: {
    bus_no: string | null;
    classroom_officer_role: string | null;
    enrollment_status: EnrollmentStatus;
    withdrawal_reason: string | null;
    withdrawal_notes: string | null;
    late_enrollee_term_number: number | null;
  };
  studentName: string;
  indexNumber: number;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busNo, setBusNo] = useState(initial.bus_no ?? '');
  const [officer, setOfficer] = useState(initial.classroom_officer_role ?? '');
  const [status, setStatus] = useState<EnrollmentStatus>(
    initial.enrollment_status
  );
  const [withdrawalReason, setWithdrawalReason] = useState<
    WithdrawalReason | ''
  >((initial.withdrawal_reason as WithdrawalReason) ?? '');
  const [withdrawalNotes, setWithdrawalNotes] = useState(
    initial.withdrawal_notes ?? ''
  );
  const [lateTermOverride, setLateTermOverride] = useState<number | null>(
    initial.late_enrollee_term_number
  );
  const [showTermOverride, setShowTermOverride] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [confirmReEnrol, setConfirmReEnrol] = useState(false);
  const [pendingMidTerm, setPendingMidTerm] = useState<MidTermPayload | null>(
    null
  );
  const [markAsLate, setMarkAsLate] = useState(true);
  const [applyingLate, setApplyingLate] = useState(false);

  type Position = {
    activeTerm: { termNumber: number } | null;
    nextTerm: { termNumber: number } | null;
    isLateEnrollee: boolean;
    canDeferToNext: boolean;
    daysLeftInActiveTerm: number | null;
  };
  const [position, setPosition] = useState<Position | null>(null);

  useEffect(() => {
    if (
      status === 'late_enrollee' &&
      initial.enrollment_status !== 'late_enrollee' &&
      position === null
    ) {
      fetch(`/api/sis/today-term?ay=${encodeURIComponent(ayCode)}`)
        .then((r) => r.json())
        .then((d) => {
          const pos = (d.position ?? null) as Position | null;
          setPosition(pos);
          if (pos?.activeTerm && lateTermOverride === null) {
            setLateTermOverride(pos.activeTerm.termNumber);
          }
        })
        .catch(() => setPosition(null));
    }
  }, [status, initial.enrollment_status, position, ayCode]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setBusNo(initial.bus_no ?? '');
      setOfficer(initial.classroom_officer_role ?? '');
      setStatus(initial.enrollment_status);
      setWithdrawalReason(
        (initial.withdrawal_reason as WithdrawalReason) ?? ''
      );
      setWithdrawalNotes(initial.withdrawal_notes ?? '');
      setLateTermOverride(initial.late_enrollee_term_number);
      setShowTermOverride(false);
      setPendingMidTerm(null);
      setSaving(false);
      setApplyingLate(false);
      setPosition(null);
    }
  }

  const isWithdrawing =
    status === 'withdrawn' && initial.enrollment_status !== 'withdrawn';
  const isReEnrolling =
    status !== 'withdrawn' && initial.enrollment_status === 'withdrawn';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isWithdrawing) {
      setConfirmWithdraw(true);
      return;
    }
    if (isReEnrolling) {
      setConfirmReEnrol(true);
      return;
    }
    void doSave();
  }

  async function doSave() {
    setConfirmWithdraw(false);
    setConfirmReEnrol(false);
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        bus_no: busNo,
        classroom_officer_role: officer,
        enrollment_status: status,
      };
      if (isWithdrawing) {
        body.withdrawal_reason = withdrawalReason || null;
        body.withdrawal_notes = withdrawalNotes.trim() || null;
      }
      // Correction path: row is already withdrawn — allow the registrar to
      // update the reason without a status change.
      if (
        !isWithdrawing &&
        initial.enrollment_status === 'withdrawn' &&
        withdrawalReason
      ) {
        body.withdrawal_reason = withdrawalReason || null;
        body.withdrawal_notes = withdrawalNotes.trim() || null;
      }
      // New late-enrollee tag — send the registrar's chosen joining term.
      if (
        status === 'late_enrollee' &&
        initial.enrollment_status !== 'late_enrollee' &&
        lateTermOverride !== null
      ) {
        body.late_enrollee_term_number = lateTermOverride;
      }
      const res = await fetch(
        `/api/sections/${sectionId}/students/${enrolmentId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resBody?.error ?? 'save failed');

      const lateTerm = (
        resBody as { lateEnrolleeTerm?: { termLabel: string } | null }
      ).lateEnrolleeTerm;
      const admissionsCascade = (
        resBody as {
          admissionsCascade?: { enroleeNumber: string; ayCode: string } | null;
        }
      ).admissionsCascade;
      const reEnrolment = (resBody as { reEnrolment?: boolean }).reEnrolment;

      const midTermPayload =
        (resBody as { midTermEnrolment?: MidTermPayload | null })
          .midTermEnrolment ?? null;

      if (reEnrolment) {
        toast.success(`Restored ${studentName} to active enrolment`);
      } else if (lateTerm?.termLabel) {
        toast.success(
          `Tagged ${studentName} as late enrollee · ${lateTerm.termLabel}`
        );
      } else if (status === 'late_enrollee') {
        toast.success(`Tagged ${studentName} as late enrollee · between terms`);
      } else if (admissionsCascade) {
        toast.success(
          `Withdrew ${studentName} · admissions also marked Withdrawn`
        );
      } else {
        toast.success(`Updated ${studentName}`);
      }

      if (reEnrolment && midTermPayload?.sectionId) {
        setPendingMidTerm(midTermPayload);
        setMarkAsLate(true);
        return;
      }

      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleTermOverride(termNumber: number) {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/sections/${sectionId}/students/${enrolmentId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ late_enrollee_term_number: termNumber }),
        }
      );
      if (!res.ok) {
        const e = (await res.json()) as { error?: string };
        toast.error(e.error ?? 'Failed to update joining term');
        setLateTermOverride(initial.late_enrollee_term_number);
      } else {
        toast.success(`Joining term updated to T${termNumber}`);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-md">
        <ScrollArea className="h-full">
          <SheetHeader className="space-y-2 border-b border-border p-6">
            <SheetTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
              Edit enrolment
            </SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              <span className="font-mono tabular-nums">#{indexNumber}</span> ·{' '}
              {studentName}
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit}>
            <div className="flex flex-col gap-5 p-6">
              <div className="space-y-2">
                <Label htmlFor="busNo">Bus number</Label>
                <Input
                  id="busNo"
                  value={busNo}
                  onChange={(e) => setBusNo(e.target.value)}
                  placeholder="e.g. SVC7"
                  maxLength={40}
                />
                <p className="text-[11px] text-muted-foreground">
                  Shown on the attendance sheet header. Leave blank if not
                  applicable.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="officer">Classroom officer role</Label>
                <Input
                  id="officer"
                  value={officer}
                  onChange={(e) => setOfficer(e.target.value)}
                  placeholder="e.g. HAPI HAUS"
                  maxLength={80}
                />
                <p className="text-[11px] text-muted-foreground">
                  Display-only. No reporting impact.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">Enrolment status</Label>
                <Select
                  value={status}
                  onValueChange={(v) => setStatus(v as EnrollmentStatus)}
                >
                  <SelectTrigger id="status" className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENROLLMENT_STATUS_VALUES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {ENROLLMENT_STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Withdrawing sets the withdrawal date to today. Restoring to
                  Active reverses the admissions withdrawal. Pre-enrolment /
                  post-withdrawal scores stay as N/A.
                </p>
              </div>

              {/* Withdrawal reason — visible when already withdrawn for correction */}
              {initial.enrollment_status === 'withdrawn' && (
                <div className="space-y-3">
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Withdrawal reason
                  </p>
                  <Select
                    value={withdrawalReason}
                    onValueChange={(v) =>
                      setWithdrawalReason(v as WithdrawalReason)
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a reason..." />
                    </SelectTrigger>
                    <SelectContent>
                      {WITHDRAWAL_REASON_VALUES.map((v) => (
                        <SelectItem key={v} value={v}>
                          {WITHDRAWAL_REASON_LABELS[v]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">
                      Notes
                      {withdrawalReason === 'other' && (
                        <span className="text-destructive"> *</span>
                      )}
                    </label>
                    <Textarea
                      value={withdrawalNotes}
                      onChange={(e) => setWithdrawalNotes(e.target.value)}
                      placeholder="Additional context..."
                      maxLength={200}
                      rows={2}
                    />
                  </div>
                </div>
              )}

              {status === 'late_enrollee' &&
                initial.enrollment_status !== 'late_enrollee' &&
                position?.activeTerm && (
                  <div className="space-y-2">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Joining term
                    </p>
                    <p className="text-[13px] text-muted-foreground">
                      Enrolled after T{position.activeTerm.termNumber} started —
                      choose how this student joins.
                    </p>
                    <div className="space-y-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setLateTermOverride(position.activeTerm!.termNumber)
                        }
                        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${
                          lateTermOverride === position.activeTerm.termNumber
                            ? 'border-primary bg-accent text-foreground'
                            : 'border-hairline text-foreground hover:bg-muted/50'
                        }`}
                      >
                        Join T{position.activeTerm.termNumber} now
                        {position.daysLeftInActiveTerm !== null &&
                          position.daysLeftInActiveTerm < 14 && (
                            <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-brand-amber">
                              ends in {position.daysLeftInActiveTerm}d
                            </span>
                          )}
                      </button>
                      {position.canDeferToNext && position.nextTerm && (
                        <button
                          type="button"
                          onClick={() =>
                            setLateTermOverride(position.nextTerm!.termNumber)
                          }
                          className={`flex w-full items-center rounded-lg border px-3 py-2 text-left text-sm ${
                            lateTermOverride === position.nextTerm.termNumber
                              ? 'border-primary bg-accent text-foreground'
                              : 'border-hairline text-foreground hover:bg-muted/50'
                          }`}
                        >
                          Start in T{position.nextTerm.termNumber} instead
                        </button>
                      )}
                    </div>
                  </div>
                )}

              {initial.enrollment_status === 'late_enrollee' && (
                <div className="space-y-1.5">
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Joining term
                  </p>
                  {!showTermOverride ? (
                    <div className="flex items-center justify-between rounded-lg border border-hairline px-3 py-2">
                      <span className="text-sm text-foreground">
                        {lateTermOverride !== null
                          ? `T${lateTermOverride} (corrected)`
                          : 'Derived from enrolment date'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowTermOverride(true)}
                        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                      >
                        Wrong term?
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Select
                        value={String(lateTermOverride ?? '')}
                        onValueChange={(v) => {
                          const n = Number(v);
                          setLateTermOverride(n);
                          setShowTermOverride(false);
                          void handleTermOverride(n);
                        }}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Select term..." />
                        </SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4].map((n) => (
                            <SelectItem key={n} value={String(n)}>
                              T{n}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <button
                        type="button"
                        onClick={() => setShowTermOverride(false)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <SheetFooter className="flex-row justify-end gap-2 border-t border-border p-6">
              <SheetClose asChild>
                <Button type="button" variant="outline" size="sm">
                  Cancel
                </Button>
              </SheetClose>
              <Button
                type="submit"
                size="sm"
                disabled={saving}
                className="gap-1.5"
              >
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </SheetFooter>
          </form>
        </ScrollArea>
      </SheetContent>

      {/* Withdrawal confirmation — includes optional reason textarea */}
      <AlertDialog open={confirmWithdraw} onOpenChange={setConfirmWithdraw}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Withdraw {studentName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes them from the section roster and marks them as
              Withdrawn in admissions. Their grades, attendance, and history
              remain on file. To move them to another section instead, cancel
              and use the Move action.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-6 pb-2 space-y-4">
            {/* Required reason picker */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Reason <span className="text-destructive">*</span>
              </label>
              <Select
                value={withdrawalReason}
                onValueChange={(v) =>
                  setWithdrawalReason(v as WithdrawalReason)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a reason..." />
                </SelectTrigger>
                <SelectContent>
                  {WITHDRAWAL_REASON_VALUES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {WITHDRAWAL_REASON_LABELS[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Optional notes — required when reason is 'other' */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Notes
                {withdrawalReason === 'other' && (
                  <span className="text-destructive"> *</span>
                )}
              </label>
              <Textarea
                value={withdrawalNotes}
                onChange={(e) => setWithdrawalNotes(e.target.value)}
                placeholder="Additional context..."
                maxLength={200}
                rows={3}
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={
                !withdrawalReason ||
                (withdrawalReason === 'other' && !withdrawalNotes.trim()) ||
                saving
              }
              onClick={() => void doSave()}
            >
              Withdraw
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Re-enrolment confirmation */}
      <AlertDialog open={confirmReEnrol} onOpenChange={setConfirmReEnrol}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore {studentName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This restores the student to active enrolment and reverses the
              admissions withdrawal. Their grades and attendance history remain
              unchanged. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doSave()}>
              Restore enrolment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Mid-term late-enrollee prompt — fires after a successful re-enrolment
          in T2/T3/T4 where the registrar restored to 'active'. */}
      <AlertDialog
        open={pendingMidTerm !== null}
        onOpenChange={(next) => {
          if (!next) {
            setPendingMidTerm(null);
            setOpen(false);
            router.refresh();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enrolling mid-year</AlertDialogTitle>
            <AlertDialogDescription>
              Today falls in <strong>{pendingMidTerm?.termLabel}</strong>. Most
              students who rejoin in {pendingMidTerm?.termLabel} are marked as
              late enrollees so the system knows to skip assessments that
              happened before they came back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-6 pb-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
              <Checkbox
                checked={markAsLate}
                onCheckedChange={(v) => setMarkAsLate(v === true)}
                className="mt-0.5"
              />
              <span>
                Mark as <strong>late enrollee</strong>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Assessments dated before today will be marked N/A on the
                  student&apos;s grading sheets.
                </span>
              </span>
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={applyingLate}
              onClick={() => {
                setPendingMidTerm(null);
                setOpen(false);
                router.refresh();
              }}
            >
              Skip
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={applyingLate}
              onClick={async () => {
                if (!markAsLate || !pendingMidTerm) {
                  setPendingMidTerm(null);
                  setOpen(false);
                  router.refresh();
                  return;
                }
                setApplyingLate(true);
                try {
                  const res = await fetch(
                    `/api/sections/${pendingMidTerm.sectionId}/students/${pendingMidTerm.sectionStudentId}`,
                    {
                      method: 'PATCH',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({
                        enrollment_status: 'late_enrollee',
                      }),
                    }
                  );
                  if (!res.ok)
                    throw new Error('Failed to mark as late enrollee');
                  toast.success(
                    `Marked ${studentName} as late enrollee · ${pendingMidTerm.termLabel}`
                  );
                } catch (e) {
                  toast.error(
                    e instanceof Error
                      ? e.message
                      : 'Could not mark as late enrollee'
                  );
                } finally {
                  setApplyingLate(false);
                  setPendingMidTerm(null);
                  setOpen(false);
                  router.refresh();
                }
              }}
            >
              {applyingLate && <Loader2 className="size-3.5 animate-spin" />}
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
