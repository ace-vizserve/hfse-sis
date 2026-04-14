'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
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
  ManualAddStudentSchema,
  type ManualAddStudentInput,
} from '@/lib/schemas/manual-add-student';

const DEFAULTS: ManualAddStudentInput = {
  student_number: '',
  last_name: '',
  first_name: '',
  middle_name: '',
  late_enrollee: false,
};

export function ManualAddStudent({
  sectionId,
  nextIndex,
}: {
  sectionId: string;
  nextIndex: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm<ManualAddStudentInput>({
    resolver: zodResolver(ManualAddStudentSchema),
    defaultValues: DEFAULTS,
  });

  async function onSubmit(values: ManualAddStudentInput) {
    try {
      const res = await fetch(`/api/sections/${sectionId}/students`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          student_number: values.student_number,
          last_name: values.last_name,
          first_name: values.first_name,
          middle_name: values.middle_name?.trim() || null,
          enrollment_status: values.late_enrollee ? 'late_enrollee' : 'active',
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'failed');
      toast.success('Student added');
      setOpen(false);
      form.reset(DEFAULTS);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add student');
    }
  }

  const busy = form.formState.isSubmitting;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset(DEFAULTS);
      }}
    >
      <SheetTrigger asChild>
        <Button size="sm">
          <UserPlus className="h-4 w-4" />
          Manually add student
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="space-y-3 border-b border-border p-6">
          <SheetTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Add student manually
          </SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground">
            Adds a new row to{' '}
            <span className="font-mono text-foreground">public.students</span> (if the student
            number is new) and enrols them in this section. The student will be assigned index{' '}
            <span className="font-mono tabular-nums text-foreground">#{nextIndex}</span>.
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
              <FormField
                control={form.control}
                name="student_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Student number</FormLabel>
                    <FormControl>
                      <Input autoFocus {...field} />
                    </FormControl>
                    <FormDescription>
                      Stable cross-year ID. Never reused even after the student leaves.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="last_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="first_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="middle_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Middle name</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormDescription>Optional.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="late_enrollee"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm font-normal text-foreground">
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={(v) => field.onChange(v === true)}
                          className="mt-0.5"
                        />
                        <span>
                          Late enrollee
                          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                            Assessments before the enrolment date will be marked N/A.
                          </span>
                        </span>
                      </label>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <SheetFooter className="flex-row justify-end gap-2 border-t border-border p-6 sm:justify-end">
              <SheetClose asChild>
                <Button type="button" variant="outline" size="sm">
                  Cancel
                </Button>
              </SheetClose>
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
                {busy ? 'Adding…' : 'Add student'}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
