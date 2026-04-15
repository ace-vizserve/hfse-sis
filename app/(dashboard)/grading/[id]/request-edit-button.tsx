"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  CHANGE_REQUEST_FIELDS,
  ChangeRequestFormSchema,
  REASON_CATEGORIES,
  REASON_CATEGORY_LABELS,
  type ChangeRequestField,
  type ChangeRequestFormInput,
} from "@/lib/schemas/change-request";

// One row per student in this section. Provided by the server component.
export type RequestableStudent = {
  entry_id: string;
  index_number: number;
  student_name: string;
  student_number: string;
  ww_scores: (number | null)[];
  pt_scores: (number | null)[];
  qa_score: number | null;
  letter_grade: string | null;
  is_na: boolean;
  withdrawn: boolean;
};

type Props = {
  sheetId: string;
  isExaminable: boolean;
  wwSlotCount: number;
  ptSlotCount: number;
  students: RequestableStudent[];
};

const FIELD_LABELS: Record<ChangeRequestField, string> = {
  ww_scores: "Written Works (WW)",
  pt_scores: "Performance Tasks (PT)",
  qa_score: "Quarterly Assessment (QA)",
  letter_grade: "Letter grade",
  is_na: "Late enrollee N/A flag",
};

export function RequestEditButton({ sheetId, isExaminable, wwSlotCount, ptSlotCount, students }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Narrow the field options to what this sheet supports.
  const availableFields = useMemo(() => {
    if (isExaminable) {
      return CHANGE_REQUEST_FIELDS.filter((f) => f !== "letter_grade");
    }
    return CHANGE_REQUEST_FIELDS.filter((f) => f === "letter_grade" || f === "is_na");
  }, [isExaminable]);

  const form = useForm<ChangeRequestFormInput>({
    resolver: zodResolver(ChangeRequestFormSchema),
    defaultValues: {
      grading_sheet_id: sheetId,
      grade_entry_id: "",
      field_changed: availableFields[0],
      slot_index: null,
      current_value: null,
      proposed_value: "",
      reason_category: "regrading",
      justification: "",
    },
  });

  const selectedEntryId = form.watch("grade_entry_id");
  const selectedField = form.watch("field_changed");
  const selectedSlot = form.watch("slot_index");

  const selectedStudent = useMemo(
    () => students.find((s) => s.entry_id === selectedEntryId) ?? null,
    [students, selectedEntryId],
  );

  // When student/field/slot changes, refresh the read-only current_value
  // snapshot inside the form so the displayed "from" value stays accurate.
  const currentValueDisplay = useMemo(() => {
    if (!selectedStudent) return "";
    switch (selectedField) {
      case "ww_scores":
        return selectedSlot != null ? String(selectedStudent.ww_scores[selectedSlot] ?? "(blank)") : "";
      case "pt_scores":
        return selectedSlot != null ? String(selectedStudent.pt_scores[selectedSlot] ?? "(blank)") : "";
      case "qa_score":
        return String(selectedStudent.qa_score ?? "(blank)");
      case "letter_grade":
        return selectedStudent.letter_grade ?? "(blank)";
      case "is_na":
        return selectedStudent.is_na ? "true" : "false";
      default:
        return "";
    }
  }, [selectedStudent, selectedField, selectedSlot]);

  const needsSlot = selectedField === "ww_scores" || selectedField === "pt_scores";
  const maxSlot = selectedField === "ww_scores" ? wwSlotCount : ptSlotCount;

  const busy = form.formState.isSubmitting;

  async function onSubmit(values: ChangeRequestFormInput) {
    try {
      const res = await fetch("/api/change-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...values,
          current_value: currentValueDisplay || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "failed to file request");
      toast.success("Change request submitted for approval");
      setOpen(false);
      form.reset();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to submit request");
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset();
      }}>
      <SheetTrigger asChild>
        <Button size="sm">
          <Send className="h-4 w-4" />
          Request edit
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="space-y-2 border-b border-border p-6">
          <SheetTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Request a locked-sheet edit
          </SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground">
            This request will be sent to the administrator for approval. The registrar applies the change after it is
            approved.
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-1 flex-col">
            <div className="flex-1 space-y-5 overflow-y-auto p-6">
              <FormField
                control={form.control}
                name="grade_entry_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Student</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Pick a student…" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {students
                          .filter((s) => !s.withdrawn)
                          .map((s) => (
                            <SelectItem key={s.entry_id} value={s.entry_id}>
                              #{s.index_number} · {s.student_name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="field_changed"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Field to change</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v);
                        // Reset slot when switching fields so the refine() passes.
                        const next = v as ChangeRequestField;
                        form.setValue("slot_index", next === "ww_scores" || next === "pt_scores" ? 0 : null, {
                          shouldValidate: true,
                        });
                      }}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {availableFields.map((f) => (
                          <SelectItem key={f} value={f}>
                            {FIELD_LABELS[f]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {needsSlot && maxSlot > 0 && (
                <FormField
                  control={form.control}
                  name="slot_index"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Slot</FormLabel>
                      <Select
                        value={field.value == null ? "" : String(field.value)}
                        onValueChange={(v) => field.onChange(Number(v))}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Pick a slot…" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Array.from({ length: maxSlot }).map((_, i) => (
                            <SelectItem key={i} value={String(i)}>
                              {selectedField === "ww_scores" ? "W" : "PT"}
                              {i + 1}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {selectedStudent && (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Current value
                  </div>
                  <div className="tabular-nums text-foreground">{currentValueDisplay || "—"}</div>
                </div>
              )}

              <FormField
                control={form.control}
                name="proposed_value"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Proposed value</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={
                          selectedField === "letter_grade"
                            ? "e.g. A"
                            : selectedField === "is_na"
                              ? "true or false"
                              : "e.g. 92"
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      The registrar will type this exact value into the locked sheet when applying the approved request.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="reason_category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason category</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {REASON_CATEGORIES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {REASON_CATEGORY_LABELS[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="justification"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Justification</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Explain in at least 20 characters why this change is needed."
                        rows={5}
                      />
                    </FormControl>
                    <FormDescription>{field.value.trim().length}/20 characters minimum</FormDescription>
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
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {busy ? "Submitting…" : "Submit request"}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
