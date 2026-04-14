'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  GraduationCap,
  Loader2,
  Plus,
  Sliders,
  Target,
  UserRound,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { NewSheetSchema, type NewSheetInput } from '@/lib/schemas/new-sheet';

type Term = { id: string; term_number: number; label: string; is_current: boolean };
type Level = { id: string; code: string; label: string; level_type: 'primary' | 'secondary' };
type Section = { id: string; name: string; level: Level | Level[] | null };
type Subject = { id: string; code: string; name: string; is_examinable: boolean };
type Config = {
  subject_id: string;
  level_id: string;
  ww_max_slots: number;
  pt_max_slots: number;
};

const first = <T,>(v: T | T[] | null): T | null =>
  Array.isArray(v) ? v[0] ?? null : v ?? null;

function TileIcon({ icon: Icon }: { icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
      <Icon className="size-4" />
    </div>
  );
}

export function NewSheetForm({
  terms,
  sections,
  subjects,
  configs,
}: {
  terms: Term[];
  sections: Section[];
  subjects: Subject[];
  configs: Config[];
}) {
  const router = useRouter();
  const defaultTerm = terms.find((t) => t.is_current) ?? terms[0];

  const form = useForm<NewSheetInput>({
    resolver: zodResolver(NewSheetSchema),
    defaultValues: {
      term_id: defaultTerm?.id ?? '',
      section_id: '',
      subject_id: '',
      ww_slots: 3,
      ww_each: 10,
      pt_slots: 3,
      pt_each: 10,
      qa_total: 50,
      teacher_name: '',
    },
  });

  const termId = form.watch('term_id');
  const sectionId = form.watch('section_id');
  const subjectId = form.watch('subject_id');
  const wwSlots = form.watch('ww_slots');
  const wwEach = form.watch('ww_each');
  const ptSlots = form.watch('pt_slots');
  const ptEach = form.watch('pt_each');
  const qaTotal = form.watch('qa_total');
  const teacherName = form.watch('teacher_name') ?? '';

  const sectionLevelId = useMemo(() => {
    const sec = sections.find((s) => s.id === sectionId);
    return first(sec?.level ?? null)?.id ?? null;
  }, [sections, sectionId]);

  const allowedSubjectIds = useMemo(() => {
    if (!sectionLevelId) return new Set<string>();
    return new Set(
      configs.filter((c) => c.level_id === sectionLevelId).map((c) => c.subject_id),
    );
  }, [configs, sectionLevelId]);

  const sectionsGrouped = useMemo(() => {
    const map = new Map<string, Section[]>();
    for (const s of sections) {
      const label = first(s.level)?.label ?? 'Unknown';
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(s);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [sections]);

  const selectedSection = sections.find((s) => s.id === sectionId);
  const selectedSubject = subjects.find((s) => s.id === subjectId);
  const selectedTerm = terms.find((t) => t.id === termId);
  const selectedLevel = first(selectedSection?.level ?? null);

  const wwTotal = (wwSlots || 0) * (wwEach || 0);
  const ptTotal = (ptSlots || 0) * (ptEach || 0);

  async function onSubmit(values: NewSheetInput) {
    try {
      const res = await fetch('/api/grading-sheets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          term_id: values.term_id,
          section_id: values.section_id,
          subject_id: values.subject_id,
          ww_totals: Array(values.ww_slots).fill(values.ww_each),
          pt_totals: Array(values.pt_slots).fill(values.pt_each),
          qa_total: values.qa_total,
          teacher_name: values.teacher_name?.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'failed');
      toast.success('Grading sheet created');
      router.push(`/grading/${body.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create grading sheet');
    }
  }

  const busy = form.formState.isSubmitting;
  const canSubmit = !busy && !!termId && !!sectionId && !!subjectId;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="grid gap-6 lg:grid-cols-12"
      >
        <div className="flex flex-col gap-6 lg:col-span-8">
          <Card className="@container/card">
            <CardHeader>
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                Step 1 · Assignment
              </CardDescription>
              <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                Where does this sheet belong?
              </CardTitle>
              <CardAction>
                <TileIcon icon={Target} />
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <FormField
                control={form.control}
                name="term_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Term</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="— pick a term —" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {terms.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.label}
                            {t.is_current ? ' · current' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      The sheet&apos;s reporting period. Current term is pre-selected.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="section_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Section</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v);
                        form.setValue('subject_id', '');
                      }}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="— pick a section —" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {sectionsGrouped.map(([label, list]) => (
                          <SelectGroup key={label}>
                            <SelectLabel>{label}</SelectLabel>
                            {list.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Sections are grouped by level. Picking one filters the subject list below.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="subject_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subject</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={!sectionId}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              sectionId ? '— pick a subject —' : '— pick a section first —'
                            }
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {subjects
                          .filter((s) => allowedSubjectIds.has(s.id))
                          .map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                              {!s.is_examinable && ' · letter grade'}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Only subjects with a weight configuration for this level appear here.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card className="@container/card">
            <CardHeader>
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                Step 2 · Score slots
              </CardDescription>
              <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                Assessment structure
              </CardTitle>
              <CardAction>
                <TileIcon icon={Sliders} />
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <div className="grid gap-5 sm:grid-cols-2">
                <NumberField
                  control={form.control}
                  name="ww_slots"
                  label="Written Works · slots"
                  description="Max 5 per project rules."
                  min={0}
                  max={5}
                />
                <NumberField
                  control={form.control}
                  name="ww_each"
                  label="Written Works · max each"
                  description="Highest score a student can earn per slot."
                  min={1}
                />
                <NumberField
                  control={form.control}
                  name="pt_slots"
                  label="Performance Tasks · slots"
                  description="Max 5 per project rules."
                  min={0}
                  max={5}
                />
                <NumberField
                  control={form.control}
                  name="pt_each"
                  label="Performance Tasks · max each"
                  description="Highest score a student can earn per slot."
                  min={1}
                />
              </div>

              <div className="h-px bg-border" />

              <NumberField
                control={form.control}
                name="qa_total"
                label="Quarterly Assessment · max"
                description="The single QA exam is one score out of this max."
                min={1}
              />
            </CardContent>
          </Card>

          <Card className="@container/card">
            <CardHeader>
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                Step 3 · Teacher
              </CardDescription>
              <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                Who teaches this sheet?
              </CardTitle>
              <CardAction>
                <TileIcon icon={UserRound} />
              </CardAction>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="teacher_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Teacher name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Ms. Tan"
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormDescription>
                      Optional. Shown on the grading sheet list and on the report card.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
        </div>

        <aside className="lg:col-span-4">
          <div className="lg:sticky lg:top-6">
            <Card className="@container/card">
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  Live preview
                </CardDescription>
                <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  Sheet summary
                </CardTitle>
                <CardAction>
                  <TileIcon icon={GraduationCap} />
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-5">
                <dl className="space-y-3 text-sm">
                  <SummaryRow label="Subject" value={selectedSubject?.name} />
                  <SummaryRow
                    label="Section"
                    value={
                      selectedSection
                        ? `${selectedLevel?.label ? `${selectedLevel.label} · ` : ''}${selectedSection.name}`
                        : undefined
                    }
                  />
                  <SummaryRow label="Term" value={selectedTerm?.label} />
                  <SummaryRow label="Teacher" value={teacherName.trim() || undefined} />
                </dl>

                <div className="h-px bg-border" />

                <div className="grid grid-cols-3 gap-3">
                  <Metric
                    label="WW"
                    value={`${wwSlots}×${wwEach}`}
                    sub={`= ${wwTotal}`}
                  />
                  <Metric
                    label="PT"
                    value={`${ptSlots}×${ptEach}`}
                    sub={`= ${ptTotal}`}
                  />
                  <Metric label="QA" value={`${qaTotal}`} sub="max" />
                </div>

                <Button type="submit" disabled={!canSubmit} className="w-full">
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  {busy ? 'Creating…' : 'Create grading sheet'}
                </Button>
                {!canSubmit && !busy && (
                  <p className="text-center text-xs text-muted-foreground">
                    Pick a term, section, and subject to continue.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </aside>
      </form>
    </Form>
  );
}

function NumberField({
  control,
  name,
  label,
  description,
  min,
  max,
}: {
  control: ReturnType<typeof useForm<NewSheetInput>>['control'];
  name: 'ww_slots' | 'ww_each' | 'pt_slots' | 'pt_each' | 'qa_total';
  label: string;
  description: string;
  min?: number;
  max?: number;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type="number"
              min={min}
              max={max}
              value={Number.isFinite(field.value) ? field.value : ''}
              onChange={(e) => {
                const raw = e.target.value;
                field.onChange(raw === '' ? Number.NaN : Number(raw));
              }}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
            />
          </FormControl>
          <FormDescription>{description}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function SummaryRow({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={
          value
            ? 'truncate text-right font-medium text-foreground'
            : 'text-right text-muted-foreground/60'
        }
      >
        {value ?? '—'}
      </dd>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-serif text-lg font-semibold leading-none tabular-nums text-foreground">
        {value}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">{sub}</p>
    </div>
  );
}
