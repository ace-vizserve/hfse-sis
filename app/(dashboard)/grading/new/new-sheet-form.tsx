'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from '@/components/ui/field';
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

  const [termId, setTermId] = useState(defaultTerm?.id ?? '');
  const [sectionId, setSectionId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [wwSlots, setWwSlots] = useState(3);
  const [wwEach, setWwEach] = useState(10);
  const [ptSlots, setPtSlots] = useState(3);
  const [ptEach, setPtEach] = useState(10);
  const [qaTotal, setQaTotal] = useState(50);
  const [teacherName, setTeacherName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/grading-sheets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          term_id: termId,
          section_id: sectionId,
          subject_id: subjectId,
          ww_totals: Array(wwSlots).fill(wwEach),
          pt_totals: Array(ptSlots).fill(ptEach),
          qa_total: qaTotal,
          teacher_name: teacherName.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'failed');
      router.push(`/grading/${body.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
      setBusy(false);
    }
  }

  const canSubmit = !busy && !!termId && !!sectionId && !!subjectId;

  return (
    <form onSubmit={submit}>
      <Card className="@container/card">
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Step 1 · Assignment
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Where does this sheet belong?
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="term">Term</FieldLabel>
              <Select value={termId} onValueChange={setTermId} required>
                <SelectTrigger id="term">
                  <SelectValue placeholder="— pick a term —" />
                </SelectTrigger>
                <SelectContent>
                  {terms.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                      {t.is_current ? ' · current' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                The sheet&apos;s reporting period. Current term is pre-selected.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="section">Section</FieldLabel>
              <Select
                value={sectionId}
                onValueChange={(v) => {
                  setSectionId(v);
                  setSubjectId('');
                }}
                required
              >
                <SelectTrigger id="section">
                  <SelectValue placeholder="— pick a section —" />
                </SelectTrigger>
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
              <FieldDescription>
                Sections are grouped by level. Picking one filters the subject list below.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="subject">Subject</FieldLabel>
              <Select
                value={subjectId}
                onValueChange={setSubjectId}
                required
                disabled={!sectionId}
              >
                <SelectTrigger id="subject">
                  <SelectValue
                    placeholder={sectionId ? '— pick a subject —' : '— pick a section first —'}
                  />
                </SelectTrigger>
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
              <FieldDescription>
                Only subjects with a weight configuration for this level appear here.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card className="@container/card mt-5">
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Step 2 · Score slots
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Assessment structure
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="num-ww-slots">Written Works · slots</FieldLabel>
                <Input
                  id="num-ww-slots"
                  type="number"
                  value={wwSlots}
                  min={0}
                  max={5}
                  onChange={(e) => setWwSlots(Number(e.target.value))}
                />
                <FieldDescription>Max 5 per project rules.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="num-ww-each">Written Works · max each</FieldLabel>
                <Input
                  id="num-ww-each"
                  type="number"
                  value={wwEach}
                  min={1}
                  onChange={(e) => setWwEach(Number(e.target.value))}
                />
                <FieldDescription>Highest score a student can earn per slot.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="num-pt-slots">Performance Tasks · slots</FieldLabel>
                <Input
                  id="num-pt-slots"
                  type="number"
                  value={ptSlots}
                  min={0}
                  max={5}
                  onChange={(e) => setPtSlots(Number(e.target.value))}
                />
                <FieldDescription>Max 5 per project rules.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="num-pt-each">Performance Tasks · max each</FieldLabel>
                <Input
                  id="num-pt-each"
                  type="number"
                  value={ptEach}
                  min={1}
                  onChange={(e) => setPtEach(Number(e.target.value))}
                />
                <FieldDescription>Highest score a student can earn per slot.</FieldDescription>
              </Field>
            </div>

            <FieldSeparator />

            <Field>
              <FieldLabel htmlFor="num-qa-total">Quarterly Assessment · max</FieldLabel>
              <Input
                id="num-qa-total"
                type="number"
                value={qaTotal}
                min={1}
                onChange={(e) => setQaTotal(Number(e.target.value))}
              />
              <FieldDescription>
                The single QA exam is one score out of this max.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card className="@container/card mt-5">
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Step 3 · Teacher
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Who teaches this sheet?
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="teacher">Teacher name</FieldLabel>
              <Input
                id="teacher"
                value={teacherName}
                onChange={(e) => setTeacherName(e.target.value)}
                placeholder="e.g. Ms. Tan"
              />
              <FieldDescription>
                Optional. Shown on the grading sheet list and on the report card.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive" className="mt-5">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Summary + submit */}
      <Card className="@container/card mt-5">
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Summary
              </p>
              <p className="text-sm text-foreground">
                {canSubmit ? (
                  <>
                    <span className="font-medium">{selectedSubject?.name}</span> ·{' '}
                    {selectedSection?.name} · {selectedTerm?.label}
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    Pick a term, section, and subject above.
                  </span>
                )}
              </p>
            </div>
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={!canSubmit}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {busy ? 'Creating…' : 'Create grading sheet'}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
