'use client';

import { Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  ClassPicker,
  LevelPicker,
} from '@/components/attendance/calendar/event-scope-field';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  SCOPE_CHOICE_LABELS,
  scopeChoiceForEvent,
  sortLevels,
  type ScopeChoice,
} from '@/lib/attendance/event-scope';
import type { EventDetails } from '@/lib/events/event';
import { sgParts, sgToIso } from '@/lib/events/sg-time';

// An event's settings — the parts parents never read as the event itself:
// its link, who it is for, when registration is open, and how parents answer.
// One dialog with a Save button, on the builder's top bar and the event page.

export type EventSettings = Pick<
  EventDetails,
  'scope' | 'opensAt' | 'closesAt' | 'answerMode'
> & { slug: string };

function TimeField({
  iso,
  onChange,
  label,
}: {
  iso: string;
  onChange: (next: string) => void;
  label: string;
}) {
  // Singapore wall-clock time; sent on as an instant with the +08:00 offset.
  const { date, time } = sgParts(iso);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="grid grid-cols-[1fr_7rem] gap-2">
        <DatePicker
          value={date}
          allowClear={false}
          onChange={(d) => d && onChange(sgToIso(d, time))}
        />
        <Input
          type="time"
          aria-label={`${label} time`}
          value={time}
          onChange={(e) =>
            e.target.value && onChange(sgToIso(date, e.target.value))
          }
        />
      </div>
    </div>
  );
}

function ForEditor({
  scope,
  onChange,
}: {
  scope: EventDetails['scope'];
  onChange: (next: EventDetails['scope']) => void;
}) {
  const [choice, setChoice] = useState<ScopeChoice>(
    scopeChoiceForEvent(scope).choice
  );

  function pick(next: ScopeChoice) {
    setChoice(next);
    if (next === 'all' || next === 'primary' || next === 'secondary') {
      onChange({ audience: next, levels: [], sectionIds: [] });
    } else if (next === 'levels') {
      onChange({ audience: 'all', levels: scope.levels, sectionIds: [] });
    } else {
      onChange({ audience: 'all', levels: [], sectionIds: scope.sectionIds });
    }
  }

  return (
    <>
      <div className="space-y-1.5">
        <Label>Who is it for?</Label>
        <Select value={choice} onValueChange={(v) => pick(v as ScopeChoice)}>
          <SelectTrigger className="h-9" aria-label="Who is it for?">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SCOPE_CHOICE_LABELS) as ScopeChoice[]).map((c) => (
              <SelectItem key={c} value={c}>
                {SCOPE_CHOICE_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {choice === 'levels' ? (
        <LevelPicker
          levels={scope.levels}
          onChange={(levels) =>
            onChange({
              audience: 'all',
              levels: sortLevels(levels),
              sectionIds: [],
            })
          }
        />
      ) : null}
      {choice === 'classes' ? (
        <ClassPicker
          sectionIds={scope.sectionIds}
          onChange={(sectionIds) =>
            onChange({ audience: 'all', levels: [], sectionIds })
          }
        />
      ) : null}
    </>
  );
}

export function EventSettingsButton({
  eventId,
  details,
  slug,
  linkPrefix,
  iconOnly,
  onSaved,
}: {
  eventId: string;
  /** The event's details as they stand; the dialog changes only its settings. */
  details: EventDetails;
  slug: string;
  /** "enrol.hfse.edu.sg/events/" */
  linkPrefix: string;
  iconOnly?: boolean;
  /** Called with what was saved; without it the page refreshes. */
  onSaved?: (saved: EventSettings) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<EventSettings>({
    slug,
    scope: details.scope,
    opensAt: details.opensAt,
    closesAt: details.closesAt,
    answerMode: details.answerMode,
  });
  const set = (patch: Partial<EventSettings>) =>
    setDraft((d) => ({ ...d, ...patch }));

  async function save() {
    setBusy(true);
    try {
      const { slug: nextSlug, ...settings } = draft;
      const res = await fetch(`/api/sis/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          details: { ...details, ...settings },
          slug: nextSlug,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        slug?: string;
        error?: string;
        details?: { fieldErrors?: Record<string, string[]> };
      };
      if (!res.ok) {
        const field = Object.values(body.details?.fieldErrors ?? {})[0]?.[0];
        toast.error(field ?? body.error ?? 'Could not save the settings.');
        return;
      }
      toast.success('Settings saved.');
      setOpen(false);
      const saved = { ...draft, slug: body.slug ?? nextSlug };
      if (onSaved) onSaved(saved);
      else router.refresh();
    } catch {
      toast.error('Could not save the settings.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setDraft({
            slug,
            scope: details.scope,
            opensAt: details.opensAt,
            closesAt: details.closesAt,
            answerMode: details.answerMode,
          });
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size={iconOnly ? 'icon' : 'default'}
          aria-label="Event settings"
        >
          <Settings className="size-4" />
          {iconOnly ? null : 'Settings'}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Event settings</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="event-link">Link</Label>
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 text-sm text-muted-foreground">
                {linkPrefix}
              </span>
              <Input
                id="event-link"
                value={draft.slug}
                maxLength={60}
                onChange={(e) => set({ slug: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-3">
            <ForEditor
              key={open ? 'open' : 'closed'}
              scope={draft.scope}
              onChange={(scope) => set({ scope })}
            />
          </div>

          <div className="space-y-3">
            <TimeField
              label="Registration opens"
              iso={draft.opensAt}
              onChange={(opensAt) => set({ opensAt })}
            />
            <TimeField
              label="Registration closes"
              iso={draft.closesAt}
              onChange={(closesAt) => set({ closesAt })}
            />
            <p className="text-xs text-muted-foreground">
              Times are Singapore time.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>How do parents answer?</Label>
            <Select
              value={draft.answerMode}
              onValueChange={(v) =>
                set({ answerMode: v as EventDetails['answerMode'] })
              }
            >
              <SelectTrigger className="h-9" aria-label="How parents answer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="consent">Allowing / Not allowing</SelectItem>
                <SelectItem value="register">Register / Not joining</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </form>
        <DialogFooter>
          <Button onClick={save} disabled={busy || !draft.slug.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
