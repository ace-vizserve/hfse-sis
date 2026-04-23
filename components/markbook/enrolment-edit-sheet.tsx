'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
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
import {
  ENROLLMENT_STATUS_LABELS,
  ENROLLMENT_STATUS_VALUES,
  type EnrollmentStatus,
} from '@/lib/schemas/enrolment';

export function EnrolmentEditSheet({
  sectionId,
  enrolmentId,
  initial,
  studentName,
  indexNumber,
  children,
}: {
  sectionId: string;
  enrolmentId: string;
  initial: {
    bus_no: string | null;
    classroom_officer_role: string | null;
    enrollment_status: EnrollmentStatus;
  };
  studentName: string;
  indexNumber: number;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busNo, setBusNo] = useState(initial.bus_no ?? '');
  const [officer, setOfficer] = useState(initial.classroom_officer_role ?? '');
  const [status, setStatus] = useState<EnrollmentStatus>(initial.enrollment_status);
  const [saving, setSaving] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // Re-seed from latest initial whenever we reopen.
      setBusNo(initial.bus_no ?? '');
      setOfficer(initial.classroom_officer_role ?? '');
      setStatus(initial.enrollment_status);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(
        `/api/sections/${sectionId}/students/${enrolmentId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            bus_no: busNo,
            classroom_officer_role: officer,
            enrollment_status: status,
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'save failed');
      toast.success(`Updated ${studentName}`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'save failed');
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
              <span className="font-mono tabular-nums">#{indexNumber}</span> · {studentName}
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={onSubmit}>
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
                Shown on the attendance sheet header. Leave blank if not applicable.
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
              <p className="text-[11px] text-muted-foreground">Display-only. No reporting impact.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Enrolment status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as EnrollmentStatus)}>
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
                Withdrawing sets <code className="font-mono">withdrawal_date</code> to today. Rejoining clears it. Pre-enrolment / post-withdrawal scores stay as N/A.
              </p>
            </div>
          </div>

          <SheetFooter className="flex-row justify-end gap-2 border-t border-border p-6">
            <SheetClose asChild>
              <Button type="button" variant="outline" size="sm">
                Cancel
              </Button>
            </SheetClose>
            <Button type="submit" size="sm" disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </SheetFooter>
        </form>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
