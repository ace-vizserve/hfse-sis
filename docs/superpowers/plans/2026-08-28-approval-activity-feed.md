# Approval Activity Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the header bell into an Activity side sheet that logs every action on the approvals you are part of, and give the two mark-change screens a history timeline.

**Architecture:** No migration, no new table. Events are **derived on read** from `approval_requests` + `approval_request_stages` (declarations) and `grade_change_requests` (mark changes). A server route scopes and merges them, because the two flows are guarded very differently — declarations are RLS-scoped to their ladder, while `grade_change_requests` is readable by any account with a role. The live badge count is untouched.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (service client in routes), `@tanstack/react-query`, shadcn primitives, Tailwind v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-28-approval-activity-feed-design.md`

## Global Constraints

- **Design system is binding (Hard Rule #7).** Tokens only from `app/globals.css`. No `#rrggbb`, `oklch(...)`, `slate-*`, `zinc-*`, `gray-*`, `bg-white`, `bg-black` in `app/` or `components/`.
- **Status colour uses the §9.3 recipes only** — mint for went-through, destructive for turned-down, accent/indigo for started. Three tones, no fourth.
- **Plain English in every user-visible string.** No "request", "payload", "cursor", "invalidate", "stage_order" on screen. Teachers' words: a **mark change**, a **filing**, **turned down**.
- **Vitest tests import their globals explicitly** — `import { describe, it, expect } from 'vitest';` — because `tsc` type-checks test files.
- **Never edit repo files with shell scripts or heredocs.** Edit/Write tools only.
- **`SheetContent` is NOT a flex column.** Any sheet whose body must scroll has to pass `flex flex-col` itself.
- **The badge count is out of scope.** `useChangeRequestCount`, `useDeclarationCount`, `countInboxActionable` and `getSidebarChangeRequestCount` are not modified by any task here.

---

## What already exists — read this before Task 1

Three findings from reading the code, and they shrink the job:

1. **The declarations page already has the history timeline.** `app/(attendance)/attendance/declarations/decision-sheet.tsx:249-330` renders "Where this has got to" — a numbered rail, one row per step, who decided and when, the decision note, followed by `RegisterOutcome`. Plate B of the mockup is largely already live there. Only one gap remains (Task 6).
2. **`StaffDeclarationView` already carries `ladder: RequestLadder | null`** (`lib/declarations/staff.ts:110`), so nothing new has to load it.
3. **The mark-change screens show the facts but not the story.** `change-requests-data-table.tsx` and `my-requests-table.tsx` both render `reviewed_by_email`, `reviewed_at`, `decision_note` and `applied_at` as table columns. A teacher is not blind to the outcome — but there is no one place that reads it end to end. That is what Task 5 adds.

**Correction to the spec:** §6 lists `register_written` as its own event kind. The approved mockup instead shows it as the **payload on the final approval row**, because the register write happens in the same second as that approval (verified in production at `10:01:19` / `10:01:20`) and two rows a second apart read as a glitch. This plan follows the mockup. The `applied` event on a mark change **does** stay its own row — there, the registrar applies it separately and often much later.

---

## File structure

**Create**

| File                                               | Responsibility                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/activity/events.ts`                           | Pure. Turns a ladder or a mark-change row into `ActivityEvent[]`. No I/O — this is where the wording lives and where the tests bite. |
| `lib/activity/feed.ts`                             | Server. Scope resolution, both source fetches, merge, cursor paging, partial-failure handling.                                       |
| `app/api/activity/route.ts`                        | `GET /api/activity` — the only way the browser reads the feed.                                                                       |
| `components/notifications/activity-row.tsx`        | One log row: gradient avatar + tone dot + text + payload blocks.                                                                     |
| `components/notifications/activity-panel.tsx`      | The sheet body: pinned block, tabs, log, load-more, empty state.                                                                     |
| `components/approvals/approval-history-dialog.tsx` | The mark-change timeline dialog, used by both mark-change tables.                                                                    |
| `__tests__/activity/events.test.ts`                | Event derivation, wording, rejected ladders, stable ids.                                                                             |
| `__tests__/activity/feed.test.ts`                  | Scope, merge order, paging, partial failure.                                                                                         |

**Modify**

| File                                                                     | Change                                                                                       |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `components/notifications/notification-bell.tsx`                         | `Bell` → `Activity` icon; `Popover` → `Sheet`; mount `ActivityPanel`. Badge logic untouched. |
| `lib/query/keys.ts:46`                                                   | Add `activityFeed`.                                                                          |
| `app/(markbook)/markbook/change-requests/change-requests-data-table.tsx` | Add a History action per row.                                                                |
| `app/(markbook)/markbook/grading/requests/my-requests-table.tsx`         | Add a History action per row.                                                                |
| `app/(attendance)/attendance/declarations/decision-sheet.tsx:249-330`    | Render steps after a rejection as never-reached.                                             |

---

## Task 1: The event model

**Files:**

- Create: `lib/activity/events.ts`
- Test: `__tests__/activity/events.test.ts`

**Interfaces:**

- Consumes: `RequestLadder`, `RequestLadderStage` from `lib/approvals/inbox.ts`.
- Produces: `ActivityEvent`, `ActivityFlow`, `ActivityTone`, `ActivityDetail`, `initialsFromName`, `buildDeclarationEvents`, `buildGradeChangeEvents`, `sortEventsNewestFirst`, `DeclarationEventInput`, `GradeChangeEventInput`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/activity/events.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

import {
  buildDeclarationEvents,
  buildGradeChangeEvents,
  initialsFromName,
  sortEventsNewestFirst,
} from '@/lib/activity/events';
import type { RequestLadder } from '@/lib/approvals/inbox';

const NAMES = new Map([
  ['u-adviser', 'Radhika Putrevu'],
  ['u-officer', 'Elaine Wee'],
  ['u-registrar', 'Lhen Mendoza'],
  ['u-teacher', 'Grace Lim'],
]);

function ladder(overrides: Partial<RequestLadder> = {}): RequestLadder {
  return {
    requestId: 'req-1',
    flow: 'student_declaration',
    subjectType: 'student_declaration',
    subjectId: 'dec-1',
    status: 'approved',
    currentStageOrder: 2,
    filedByEmail: 'parent@example.com',
    filedAt: '2026-08-24T00:12:00.000Z',
    decidedAt: '2026-08-27T02:01:20.000Z',
    stages: [
      {
        stageOrder: 1,
        label: 'Form class adviser',
        resolver: 'form_adviser',
        status: 'approved',
        sectionId: 'sec-1',
        approverPool: [],
        decidedBy: 'u-adviser',
        decidedByEmail: 'radhika.putrevu@hfse.edu.sg',
        decidedAt: '2026-08-24T01:40:00.000Z',
        decisionNote: 'Family already has the flights.',
      },
      {
        stageOrder: 2,
        label: 'Officer in charge',
        resolver: 'named',
        status: 'approved',
        sectionId: null,
        approverPool: ['u-officer'],
        decidedBy: 'u-officer',
        decidedByEmail: 'elaine.wee@hfse.edu.sg',
        decidedAt: '2026-08-27T02:01:19.000Z',
        decisionNote: null,
      },
    ],
    ...overrides,
  };
}

describe('initialsFromName', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsFromName('Radhika Putrevu')).toBe('RP');
  });

  it('falls back to the local part of an email', () => {
    expect(initialsFromName('elaine.wee@hfse.edu.sg')).toBe('EW');
  });

  it('never throws on empty input', () => {
    expect(initialsFromName('')).toBe('—');
  });
});

describe('buildDeclarationEvents', () => {
  it('emits one filed event and one event per decided step', () => {
    const events = buildDeclarationEvents({
      ladder: ladder(),
      subjectLabel: 'Amelia Ng, travel 3 Sep',
      nameById: NAMES,
      registerWrittenAt: '2026-08-27T02:01:20.000Z',
      registerDaysWritten: 1,
      registerWriteError: null,
    });

    expect(events).toHaveLength(3);
    expect(events.map((e) => e.tone)).toEqual([
      'started',
      'went-through',
      'went-through',
    ]);
  });

  it('names a parent as the filer and never their email address', () => {
    const [filed] = buildDeclarationEvents({
      ladder: ladder(),
      subjectLabel: 'Amelia Ng, travel 3 Sep',
      nameById: NAMES,
      registerWrittenAt: null,
      registerDaysWritten: null,
      registerWriteError: null,
    });

    expect(filed.actorLabel).toBe('A parent');
    expect(filed.predicate).toBe('filed Amelia Ng, travel 3 Sep.');
    expect(JSON.stringify(filed)).not.toContain('parent@example.com');
  });

  it('carries a decision note as a quoted detail', () => {
    const events = buildDeclarationEvents({
      ladder: ladder(),
      subjectLabel: 'Amelia Ng, travel 3 Sep',
      nameById: NAMES,
      registerWrittenAt: null,
      registerDaysWritten: null,
      registerWriteError: null,
    });
    const adviser = events.find((e) => e.actorLabel === 'Radhika Putrevu');

    expect(adviser?.details).toEqual([
      { kind: 'note', text: 'Family already has the flights.' },
    ]);
  });

  // The register write lands in the same second as the final approval, so it
  // is a payload on that row rather than a row of its own.
  it('hangs the register outcome on the last approval, not a separate event', () => {
    const events = buildDeclarationEvents({
      ladder: ladder(),
      subjectLabel: 'Amelia Ng, travel 3 Sep',
      nameById: NAMES,
      registerWrittenAt: '2026-08-27T02:01:20.000Z',
      registerDaysWritten: 1,
      registerWriteError: null,
    });
    const last = events.find((e) => e.actorLabel === 'Elaine Wee');

    expect(events).toHaveLength(3);
    expect(last?.details).toEqual([
      { kind: 'outcome', text: '1 day marked as excused on the register' },
    ]);
  });

  it('pluralises the register outcome', () => {
    const events = buildDeclarationEvents({
      ladder: ladder(),
      subjectLabel: 'Jonah Fernandes, absence 24–26 Aug',
      nameById: NAMES,
      registerWrittenAt: '2026-08-27T02:01:20.000Z',
      registerDaysWritten: 3,
      registerWriteError: null,
    });
    const last = events.find((e) => e.actorLabel === 'Elaine Wee');

    expect(last?.details?.[0]).toEqual({
      kind: 'outcome',
      text: '3 days marked as excused on the register',
    });
  });

  it('says so plainly when the register write failed', () => {
    const events = buildDeclarationEvents({
      ladder: ladder(),
      subjectLabel: 'Amelia Ng, travel 3 Sep',
      nameById: NAMES,
      registerWrittenAt: null,
      registerDaysWritten: null,
      registerWriteError: 'term not found',
    });
    const last = events.find((e) => e.actorLabel === 'Elaine Wee');

    expect(last?.details).toEqual([
      {
        kind: 'outcome',
        text: 'The register could not be marked. An administrator needs to finish this.',
      },
    ]);
  });

  // ⚠ A rejection stops the ladder; later steps stay 'waiting' forever.
  it('emits nothing for steps the ladder never reached', () => {
    const rejected = ladder({
      status: 'rejected',
      stages: [
        {
          stageOrder: 1,
          label: 'Form class adviser',
          resolver: 'form_adviser',
          status: 'approved',
          sectionId: 'sec-1',
          approverPool: [],
          decidedBy: 'u-adviser',
          decidedByEmail: 'radhika.putrevu@hfse.edu.sg',
          decidedAt: '2026-08-20T00:00:00.000Z',
          decisionNote: null,
        },
        {
          stageOrder: 2,
          label: 'Officer in charge',
          resolver: 'named',
          status: 'rejected',
          sectionId: null,
          approverPool: ['u-officer'],
          decidedBy: 'u-officer',
          decidedByEmail: 'elaine.wee@hfse.edu.sg',
          decidedAt: '2026-08-27T08:22:00.000Z',
          decisionNote: 'Please re-send with the medical certificate attached.',
        },
        {
          stageOrder: 3,
          label: 'Principal',
          resolver: 'named',
          status: 'waiting',
          sectionId: null,
          approverPool: ['u-registrar'],
          decidedBy: null,
          decidedByEmail: null,
          decidedAt: null,
          decisionNote: null,
        },
      ],
    });

    const events = buildDeclarationEvents({
      ladder: rejected,
      subjectLabel: 'Idris Rahman, absence 20–21 Aug',
      nameById: NAMES,
      registerWrittenAt: null,
      registerDaysWritten: null,
      registerWriteError: null,
    });

    expect(events).toHaveLength(3);
    expect(events.some((e) => e.predicate.includes('Principal'))).toBe(false);
    expect(events.at(-1)?.tone).toBe('turned-down');
  });

  it('never writes a register outcome onto a turned-down filing', () => {
    const rejected = ladder({
      status: 'rejected',
      stages: [
        {
          stageOrder: 1,
          label: 'Form class adviser',
          resolver: 'form_adviser',
          status: 'rejected',
          sectionId: 'sec-1',
          approverPool: [],
          decidedBy: 'u-adviser',
          decidedByEmail: 'radhika.putrevu@hfse.edu.sg',
          decidedAt: '2026-08-20T00:00:00.000Z',
          decisionNote: null,
        },
      ],
    });

    const events = buildDeclarationEvents({
      ladder: rejected,
      subjectLabel: 'Idris Rahman, absence 20–21 Aug',
      nameById: NAMES,
      registerWrittenAt: '2026-08-27T02:01:20.000Z',
      registerDaysWritten: 2,
      registerWriteError: null,
    });

    expect(events.every((e) => e.details === null)).toBe(true);
  });

  it('gives every event a stable id derived from its own identity', () => {
    const input = {
      ladder: ladder(),
      subjectLabel: 'Amelia Ng, travel 3 Sep',
      nameById: NAMES,
      registerWrittenAt: null,
      registerDaysWritten: null,
      registerWriteError: null,
    };

    expect(buildDeclarationEvents(input).map((e) => e.id)).toEqual(
      buildDeclarationEvents(input).map((e) => e.id)
    );
    expect(buildDeclarationEvents(input).map((e) => e.id)).toEqual([
      'student_declaration:req-1:filed',
      'student_declaration:req-1:step:1',
      'student_declaration:req-1:step:2',
    ]);
  });

  it('links to the filing on the declarations page', () => {
    const [filed] = buildDeclarationEvents({
      ladder: ladder(),
      subjectLabel: 'Amelia Ng, travel 3 Sep',
      nameById: NAMES,
      registerWrittenAt: null,
      registerDaysWritten: null,
      registerWriteError: null,
    });

    expect(filed.href).toBe('/attendance/declarations?req=req-1');
  });
});

describe('buildGradeChangeEvents', () => {
  const base = {
    id: 'gcr-1',
    fieldChanged: 'written_work',
    slotIndex: 3,
    currentValue: '18',
    proposedValue: '21',
    studentLabel: 'Samira Bakhtiari',
    requestedById: 'u-teacher',
    requestedByEmail: 'grace.lim@hfse.edu.sg',
    requestedAt: '2026-08-27T00:47:00.000Z',
    status: 'applied',
    reviewedById: 'u-officer',
    reviewedByEmail: 'elaine.wee@hfse.edu.sg',
    reviewedAt: '2026-08-27T02:00:00.000Z',
    decisionNote: null,
    appliedById: 'u-registrar',
    appliedAt: '2026-08-27T03:05:00.000Z',
    nameById: NAMES,
    href: '/markbook/change-requests?req=gcr-1',
  };

  it('says "You" when the viewer is the one who asked', () => {
    const [asked] = buildGradeChangeEvents({ ...base, viewerId: 'u-teacher' });

    expect(asked.actorLabel).toBe('You');
    expect(asked.predicate).toBe(
      'asked to change Written Work 3 for Samira Bakhtiari.'
    );
  });

  it('names the teacher when the viewer is somebody else', () => {
    const [asked] = buildGradeChangeEvents({ ...base, viewerId: 'u-officer' });

    expect(asked.actorLabel).toBe('Grace Lim');
  });

  it('emits asked, reviewed and applied, in that order', () => {
    const events = buildGradeChangeEvents({ ...base, viewerId: 'u-officer' });

    expect(events.map((e) => e.id)).toEqual([
      'grade_change:gcr-1:requested',
      'grade_change:gcr-1:reviewed',
      'grade_change:gcr-1:applied',
    ]);
    expect(events.at(-1)?.details).toEqual([
      { kind: 'outcome', text: 'Written Work 3 · 18 → 21' },
    ]);
  });

  it('stops at asked while the request is still pending', () => {
    const events = buildGradeChangeEvents({
      ...base,
      viewerId: 'u-officer',
      status: 'pending',
      reviewedAt: null,
      reviewedByEmail: null,
      reviewedById: null,
      appliedAt: null,
      appliedById: null,
    });

    expect(events).toHaveLength(1);
  });

  it('marks a rejection as turned down and carries its reason', () => {
    const events = buildGradeChangeEvents({
      ...base,
      viewerId: 'u-officer',
      status: 'rejected',
      decisionNote: 'The original mark is correct.',
      appliedAt: null,
      appliedById: null,
    });

    expect(events.at(-1)?.tone).toBe('turned-down');
    expect(events.at(-1)?.details).toEqual([
      { kind: 'note', text: 'The original mark is correct.' },
    ]);
  });
});

describe('sortEventsNewestFirst', () => {
  it('sorts by time descending and breaks ties on id', () => {
    const at = '2026-08-27T02:00:00.000Z';
    const mk = (id: string, t: string) =>
      ({ id, at: t }) as ReturnType<typeof buildGradeChangeEvents>[number];

    const sorted = sortEventsNewestFirst([
      mk('b', at),
      mk('a', at),
      mk('c', '2026-08-28T00:00:00.000Z'),
    ]);

    expect(sorted.map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/activity/events.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/activity/events"`.

- [ ] **Step 3: Write the implementation**

Create `lib/activity/events.ts`:

```ts
import type { RequestLadder } from '@/lib/approvals/inbox';

/**
 * One thing that happened to an approval, in the shape the panel and the
 * history timeline both render.
 *
 * ⚠ PURE. This module does no I/O and imports nothing from `app/` or
 * `components/`. Every string a person reads is decided here, so the wording
 * is testable without a database or a browser.
 */

export type ActivityFlow = 'grade_change' | 'student_declaration';

/** The three §9.3 tones. There is deliberately no fourth. */
export type ActivityTone = 'started' | 'went-through' | 'turned-down';

export type ActivityDetail =
  | { kind: 'note'; text: string }
  | { kind: 'outcome'; text: string };

export type ActivityEvent = {
  /**
   * ⚠ DERIVED AND STABLE, never an array index. The panel appends pages, and a
   * positional key reorders every row already on screen when a page lands.
   */
  id: string;
  flow: ActivityFlow;
  requestId: string;
  /** ISO timestamp. The sort key. */
  at: string;
  tone: ActivityTone;
  /** "Radhika Putrevu" · "A parent" · "You". Rendered bold. */
  actorLabel: string;
  actorInitials: string;
  /** Follows the actor: "approved the form class adviser step for …". */
  predicate: string;
  details: ActivityDetail[] | null;
  href: string;
};

/**
 * Two letters for the avatar.
 *
 * ⚠ Never throws. This renders in the header of every page in the app; an
 * exception here costs the whole screen, not one circle.
 */
export function initialsFromName(nameOrEmail: string): string {
  const source = (nameOrEmail ?? '').trim();
  if (!source) return '—';

  const base = source.includes('@')
    ? (source.split('@')[0] ?? '').replace(/[._-]+/g, ' ')
    : source;

  const letters = base
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');

  return letters.slice(0, 2) || '—';
}

function personName(
  id: string | null,
  email: string | null,
  nameById: ReadonlyMap<string, string>
): string {
  if (id) {
    const known = nameById.get(id);
    if (known) return known;
  }
  return email ?? 'Someone';
}

// ── Declarations ───────────────────────────────────────────────────────────

export type DeclarationEventInput = {
  ladder: RequestLadder;
  /** "Amelia Ng, travel 3 Sep" — built by the caller, which has the student. */
  subjectLabel: string;
  nameById: ReadonlyMap<string, string>;
  registerWrittenAt: string | null;
  registerDaysWritten: number | null;
  registerWriteError: string | null;
};

export function buildDeclarationEvents(
  input: DeclarationEventInput
): ActivityEvent[] {
  const { ladder, subjectLabel, nameById } = input;
  const href = `/attendance/declarations?req=${ladder.requestId}`;
  const events: ActivityEvent[] = [];

  // ⚠ "A parent", never their email. A parent has no SIS account and their
  // address is not staff-facing information.
  events.push({
    id: `student_declaration:${ladder.requestId}:filed`,
    flow: 'student_declaration',
    requestId: ladder.requestId,
    at: ladder.filedAt,
    tone: 'started',
    actorLabel: 'A parent',
    actorInitials: initialsFromName(subjectLabel),
    predicate: `filed ${subjectLabel}.`,
    details: null,
    href,
  });

  // ⚠ ONLY DECIDED STEPS. A rejection stops the ladder and every later step
  // stays 'waiting' in the table forever; emitting those would invent activity
  // that never happened.
  const decided = ladder.stages.filter(
    (s) =>
      (s.status === 'approved' || s.status === 'rejected') &&
      s.decidedAt != null
  );

  const lastApprovalOrder =
    ladder.status === 'approved'
      ? [...decided].reverse().find((s) => s.status === 'approved')?.stageOrder
      : undefined;

  for (const stage of decided) {
    const details: ActivityDetail[] = [];
    if (stage.decisionNote) {
      details.push({ kind: 'note', text: stage.decisionNote });
    }
    // The register write lands in the same second as the final approval, so it
    // rides on that row rather than becoming a second row a second later.
    if (stage.stageOrder === lastApprovalOrder) {
      const outcome = registerOutcomeText(input);
      if (outcome) details.push({ kind: 'outcome', text: outcome });
    }

    events.push({
      id: `student_declaration:${ladder.requestId}:step:${stage.stageOrder}`,
      flow: 'student_declaration',
      requestId: ladder.requestId,
      at: stage.decidedAt as string,
      tone: stage.status === 'approved' ? 'went-through' : 'turned-down',
      actorLabel: personName(stage.decidedBy, stage.decidedByEmail, nameById),
      actorInitials: initialsFromName(
        personName(stage.decidedBy, stage.decidedByEmail, nameById)
      ),
      predicate: `${
        stage.status === 'approved' ? 'approved' : 'turned down'
      } the ${stage.label.toLocaleLowerCase()} step for ${subjectLabel}.`,
      details: details.length > 0 ? details : null,
      href,
    });
  }

  return events;
}

function registerOutcomeText(input: DeclarationEventInput): string | null {
  if (input.registerWriteError) {
    return 'The register could not be marked. An administrator needs to finish this.';
  }
  if (input.registerWrittenAt == null) return null;
  const days = input.registerDaysWritten ?? 0;
  if (days === 0) return 'No school days fell inside those dates.';
  return `${days} ${days === 1 ? 'day' : 'days'} marked as excused on the register`;
}

// ── Mark changes ───────────────────────────────────────────────────────────

export type GradeChangeEventInput = {
  id: string;
  fieldChanged: string;
  slotIndex: number | null;
  currentValue: string | null;
  proposedValue: string;
  studentLabel: string;
  requestedById: string | null;
  requestedByEmail: string;
  requestedAt: string;
  status: string;
  reviewedById: string | null;
  reviewedByEmail: string | null;
  reviewedAt: string | null;
  decisionNote: string | null;
  appliedById: string | null;
  appliedAt: string | null;
  /** Who is reading. Decides whether the first row says "You". */
  viewerId: string;
  nameById: ReadonlyMap<string, string>;
  href: string;
};

/** "written_work" + slot 3 → "Written Work 3". */
export function markChangeFieldLabel(
  fieldChanged: string,
  slotIndex: number | null
): string {
  const words = fieldChanged
    .split('_')
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
  return slotIndex == null ? words : `${words} ${slotIndex}`;
}

export function buildGradeChangeEvents(
  input: GradeChangeEventInput
): ActivityEvent[] {
  const field = markChangeFieldLabel(input.fieldChanged, input.slotIndex);
  const events: ActivityEvent[] = [];

  const askedBy =
    input.requestedById === input.viewerId
      ? 'You'
      : personName(input.requestedById, input.requestedByEmail, input.nameById);

  events.push({
    id: `grade_change:${input.id}:requested`,
    flow: 'grade_change',
    requestId: input.id,
    at: input.requestedAt,
    tone: 'started',
    actorLabel: askedBy,
    actorInitials: initialsFromName(
      askedBy === 'You'
        ? personName(
            input.requestedById,
            input.requestedByEmail,
            input.nameById
          )
        : askedBy
    ),
    predicate: `asked to change ${field} for ${input.studentLabel}.`,
    details: null,
    href: input.href,
  });

  if (input.reviewedAt) {
    const turnedDown = input.status === 'rejected';
    const reviewer = personName(
      input.reviewedById,
      input.reviewedByEmail,
      input.nameById
    );
    events.push({
      id: `grade_change:${input.id}:reviewed`,
      flow: 'grade_change',
      requestId: input.id,
      at: input.reviewedAt,
      tone: turnedDown ? 'turned-down' : 'went-through',
      actorLabel: reviewer,
      actorInitials: initialsFromName(reviewer),
      predicate: `${turnedDown ? 'turned down' : 'approved'} the mark change for ${input.studentLabel}.`,
      details: input.decisionNote
        ? [{ kind: 'note', text: input.decisionNote }]
        : null,
      href: input.href,
    });
  }

  if (input.appliedAt) {
    const applier = personName(input.appliedById, null, input.nameById);
    events.push({
      id: `grade_change:${input.id}:applied`,
      flow: 'grade_change',
      requestId: input.id,
      at: input.appliedAt,
      tone: 'went-through',
      actorLabel: applier,
      actorInitials: initialsFromName(applier),
      predicate: `applied the mark change for ${input.studentLabel} to the sheet.`,
      details: [
        {
          kind: 'outcome',
          text: `${field} · ${input.currentValue ?? '—'} → ${input.proposedValue}`,
        },
      ],
      href: input.href,
    });
  }

  return events;
}

/**
 * Newest first, ties broken on id.
 *
 * ⚠ The tiebreak is not cosmetic. Two events can share a timestamp to the
 * millisecond, and an unstable order across pages duplicates or drops rows at
 * the cursor boundary.
 */
export function sortEventsNewestFirst<T extends { at: string; id: string }>(
  events: T[]
): T[] {
  return [...events].sort(
    (a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/activity/events.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/activity/events.ts __tests__/activity/events.test.ts
git commit -m "feat(activity): the six things that can happen to an approval, as data"
```

---

## Task 2: Scoping and paging the feed

**Files:**

- Create: `lib/activity/feed.ts`
- Test: `__tests__/activity/feed.test.ts`

**Interfaces:**

- Consumes: `ActivityEvent`, `buildDeclarationEvents`, `buildGradeChangeEvents`, `sortEventsNewestFirst` (Task 1); `loadAdvisedSectionIds` from `lib/approvals/resolve.ts`; `loadStaffDeclarations` from `lib/declarations/staff.ts`; `getStaffDisplayNameById` from `lib/auth/staff-list.ts`; `DECLARATION_APPROVAL_FLOW` from `lib/schemas/approval-flows.ts`.
- Produces: `loadActivityPage(service, opts): Promise<ActivityPage>`, types `ActivityPage`, `ActivityCursor`, `ActivityWaitingItem`, `ActivityTab`.

**Design notes the implementer must not re-litigate:**

- **Scope for declarations** mirrors migration 131's policy: you are in a stage's `approver_pool`, or you advise its `section_id` today. Reuse `loadAdvisedSectionIds` — do **not** rewrite the adviser rule.
- **Scope for mark changes** is `requested_by = me OR primary_approver_id = me OR secondary_approver_id = me`. This is **wider than the bell**, which shows approvers only; the requester is added deliberately so a teacher sees their own outcome. ⚠ `grade_change_requests` RLS admits any account with a role, so this filter is the _only_ thing preventing a leak. It must be a database `.or(...)`, never a filter applied after fetching everything.
- **Oversight roles get no widening here.** `listInboxStages` gives coordinators and admins the whole school's queue; the feed deliberately does not. A personal log that includes 400 other people's approvals is not a log.
- **Paging is derive-all-then-slice, bounded.** Each source loads at most `SOURCE_CAP = 400` most-recent requests, all their events are derived, merged and sorted, then sliced at the cursor. This is correct by construction at this scale (hundreds of rows) and avoids the cross-source over-fetch bug entirely. If a school ever passes the cap the page reports `truncated: true` rather than silently ending.
- **One source failing must not blank the other.** `Promise.allSettled`, and the page reports `partial: true`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/activity/feed.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

import { pageEvents, SOURCE_CAP } from '@/lib/activity/feed';
import type { ActivityEvent } from '@/lib/activity/events';

function ev(id: string, at: string): ActivityEvent {
  return {
    id,
    flow: 'grade_change',
    requestId: id,
    at,
    tone: 'started',
    actorLabel: 'Someone',
    actorInitials: 'S',
    predicate: 'did a thing.',
    details: null,
    href: '#',
  };
}

describe('pageEvents', () => {
  const all = [
    ev('a', '2026-08-28T05:00:00.000Z'),
    ev('b', '2026-08-28T04:00:00.000Z'),
    ev('c', '2026-08-28T03:00:00.000Z'),
    ev('d', '2026-08-28T02:00:00.000Z'),
    ev('e', '2026-08-28T01:00:00.000Z'),
  ];

  it('returns the newest page first and a cursor for the next', () => {
    const page = pageEvents(all, null, 2);

    expect(page.events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(page.nextCursor).toEqual({
      at: '2026-08-28T04:00:00.000Z',
      id: 'b',
    });
  });

  it('continues from the cursor without repeating or skipping', () => {
    const first = pageEvents(all, null, 2);
    const second = pageEvents(all, first.nextCursor, 2);
    const third = pageEvents(all, second.nextCursor, 2);

    expect(second.events.map((e) => e.id)).toEqual(['c', 'd']);
    expect(third.events.map((e) => e.id)).toEqual(['e']);
    expect(third.nextCursor).toBeNull();
  });

  // The bug this guards: two sources that both emitted at the same instant.
  it('does not lose an event that shares a timestamp with the cursor', () => {
    const tied = [
      ev('a', '2026-08-28T05:00:00.000Z'),
      ev('b', '2026-08-28T04:00:00.000Z'),
      ev('c', '2026-08-28T04:00:00.000Z'),
      ev('d', '2026-08-28T03:00:00.000Z'),
    ];

    const first = pageEvents(tied, null, 2);
    const second = pageEvents(tied, first.nextCursor, 2);

    expect(first.events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(second.events.map((e) => e.id)).toEqual(['c', 'd']);
  });

  it('reports no next cursor when the last page exactly fills', () => {
    expect(pageEvents(all.slice(0, 2), null, 2).nextCursor).toBeNull();
  });

  it('caps each source well above anything this school produces', () => {
    expect(SOURCE_CAP).toBeGreaterThanOrEqual(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/activity/feed.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/activity/feed"`.

- [ ] **Step 3: Write the implementation**

Create `lib/activity/feed.ts`:

```ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Role } from '@/lib/auth/roles';
import { getStaffDisplayNameById } from '@/lib/auth/staff-list';
import { loadAdvisedSectionIds } from '@/lib/approvals/resolve';
import { loadLaddersBySubject } from '@/lib/approvals/inbox';
import { loadStaffDeclarations } from '@/lib/declarations/staff';
import { DECLARATION_APPROVAL_FLOW } from '@/lib/schemas/approval-flows';
import { sgToday } from '@/lib/dates';
import {
  buildDeclarationEvents,
  buildGradeChangeEvents,
  sortEventsNewestFirst,
  type ActivityEvent,
} from '@/lib/activity/events';

/**
 * The activity feed, assembled on read.
 *
 * ⚠ THIS RUNS ON THE SERVER AND MUST. `grade_change_requests` is readable by
 * ANY authenticated account holding a role (migration 009) — the narrowing to
 * "yours" has always lived in the API layer. A browser-direct feed would show
 * every teacher the whole school's mark changes. The `.or(...)` below is the
 * only thing standing between this feature and that leak; never move it into
 * JavaScript applied after the fetch.
 */

/** Well above anything this school produces; a guard, not a page size. */
export const SOURCE_CAP = 400;

export type ActivityTab = 'general' | 'grade_change' | 'student_declaration';

export type ActivityCursor = { at: string; id: string } | null;

export type ActivityWaitingItem = {
  id: string;
  requestId: string;
  title: string;
  subtitle: string;
  href: string;
  initials: string;
};

export type ActivityPage = {
  events: ActivityEvent[];
  nextCursor: ActivityCursor;
  waiting: ActivityWaitingItem[];
  /** One of the two sources failed; the list is short, not empty. */
  partial: boolean;
  /** A source hit SOURCE_CAP, so the tail is not reachable. */
  truncated: boolean;
};

/**
 * Slice a fully-derived, newest-first list at a cursor.
 *
 * ⚠ The comparison is on `(at, id)` as a pair, not on `at` alone. Two events
 * can share a timestamp to the millisecond — the register write and its
 * approval very nearly do — and an `at`-only cursor either repeats them or
 * drops them at every page boundary.
 */
export function pageEvents(
  all: ActivityEvent[],
  cursor: ActivityCursor,
  limit: number
): { events: ActivityEvent[]; nextCursor: ActivityCursor } {
  const sorted = sortEventsNewestFirst(all);

  const start = cursor
    ? sorted.findIndex(
        (e) =>
          e.at.localeCompare(cursor.at) < 0 ||
          (e.at === cursor.at && e.id.localeCompare(cursor.id) > 0)
      )
    : 0;

  if (start < 0) return { events: [], nextCursor: null };

  const events = sorted.slice(start, start + limit);
  const more = sorted.length > start + limit;
  const last = events.at(-1);

  return {
    events,
    nextCursor: more && last ? { at: last.at, id: last.id } : null,
  };
}

export type ActivityScope = {
  userId: string;
  role: Role | null;
  tab: ActivityTab;
  cursor: ActivityCursor;
  limit: number;
  today?: string;
};

export async function loadActivityPage(
  service: SupabaseClient,
  scope: ActivityScope
): Promise<ActivityPage> {
  const nameById = new Map(await getStaffDisplayNameById());

  const wantDeclarations =
    scope.tab === 'general' || scope.tab === 'student_declaration';
  const wantMarkChanges =
    scope.tab === 'general' || scope.tab === 'grade_change';

  const [declarations, markChanges] = await Promise.allSettled([
    wantDeclarations
      ? loadDeclarationSide(service, scope, nameById)
      : Promise.resolve({ events: [], waiting: [], truncated: false }),
    wantMarkChanges
      ? loadMarkChangeSide(service, scope, nameById)
      : Promise.resolve({ events: [], waiting: [], truncated: false }),
  ]);

  const parts = [declarations, markChanges];
  const partial = parts.some((p) => p.status === 'rejected');
  for (const p of parts) {
    if (p.status === 'rejected') {
      console.error(
        '[activity] one source failed:',
        p.reason instanceof Error ? p.reason.message : String(p.reason)
      );
    }
  }

  const ok = parts.flatMap((p) => (p.status === 'fulfilled' ? [p.value] : []));
  const all = ok.flatMap((p) => p.events);
  const waiting = ok.flatMap((p) => p.waiting);
  const truncated = ok.some((p) => p.truncated);

  const { events, nextCursor } = pageEvents(all, scope.cursor, scope.limit);
  return { events, nextCursor, waiting, partial, truncated };
}

// ── Declarations ───────────────────────────────────────────────────────────

async function loadDeclarationSide(
  service: SupabaseClient,
  scope: ActivityScope,
  nameById: ReadonlyMap<string, string>
) {
  const today = scope.today ?? sgToday();
  const advisedSectionIds = await loadAdvisedSectionIds(
    service,
    scope.userId,
    today
  );

  // ⚠ The same predicate migration 131 enforces: a step that names me, or a
  // class I advise TODAY (which includes a co-adviser and live relief cover).
  // Both arms are root columns, which is why the flow filter is separate.
  const arms = [`approver_pool.cs.{${scope.userId}}`];
  if (advisedSectionIds.length > 0) {
    arms.push(`section_id.in.(${advisedSectionIds.join(',')})`);
  }

  const { data, error } = await service
    .from('approval_request_stages')
    .select('request_id, approval_requests!inner(flow, subject_id)')
    .eq('approval_requests.flow', DECLARATION_APPROVAL_FLOW)
    .or(arms.join(','))
    .limit(SOURCE_CAP);
  if (error) throw new Error(error.message);

  type Row = {
    request_id: string;
    approval_requests: { subject_id: string } | Array<{ subject_id: string }>;
  };

  const declarationIds = [
    ...new Set(
      ((data ?? []) as unknown as Row[]).map((r) => {
        const req = Array.isArray(r.approval_requests)
          ? r.approval_requests[0]
          : r.approval_requests;
        return req?.subject_id ?? '';
      })
    ),
  ].filter(Boolean);

  if (declarationIds.length === 0) {
    return { events: [], waiting: [], truncated: false };
  }

  const views = await loadStaffDeclarations(service, declarationIds);
  const ladders = await loadLaddersBySubject(service, {
    flow: DECLARATION_APPROVAL_FLOW,
    subjectType: 'student_declaration',
    subjectIds: declarationIds,
  });

  const events: ActivityEvent[] = [];
  const waiting: ActivityWaitingItem[] = [];
  const advised = new Set(advisedSectionIds);

  for (const view of views) {
    const ladder = ladders.get(view.id);
    if (!ladder) continue;

    const label = `${view.studentName}, ${
      view.declarationType === 'travel' ? 'travel' : 'absence'
    } ${formatDayRange(view.startDate, view.endDate)}`;

    events.push(
      ...buildDeclarationEvents({
        ladder,
        subjectLabel: label,
        nameById,
        registerWrittenAt: view.registerWrittenAt,
        registerDaysWritten: view.registerDaysWritten,
        registerWriteError: view.registerWriteError,
      })
    );

    const pending = ladder.stages.find((s) => s.status === 'pending');
    const mine =
      pending != null &&
      (pending.resolver === 'named'
        ? pending.approverPool.includes(scope.userId)
        : pending.sectionId != null && advised.has(pending.sectionId));

    if (mine && pending) {
      waiting.push({
        id: `student_declaration:${ladder.requestId}`,
        requestId: ladder.requestId,
        title: label,
        subtitle: `${pending.label} · ${view.className ?? 'their class'}`,
        href: `/attendance/declarations?req=${ladder.requestId}`,
        initials: initialsOf(view.studentName),
      });
    }
  }

  return {
    events,
    waiting,
    truncated: (data ?? []).length >= SOURCE_CAP,
  };
}

// ── Mark changes ───────────────────────────────────────────────────────────

async function loadMarkChangeSide(
  service: SupabaseClient,
  scope: ActivityScope,
  nameById: ReadonlyMap<string, string>
) {
  // ⚠ THE LEAK GUARD. See this module's header comment before touching it.
  const { data, error } = await service
    .from('grade_change_requests')
    .select(
      `id, field_changed, slot_index, current_value, proposed_value, status,
       requested_by, requested_by_email, requested_at,
       primary_approver_id, secondary_approver_id,
       reviewed_by, reviewed_by_email, reviewed_at, decision_note,
       applied_by, applied_at,
       grade_entry:grade_entries!inner(
         student:students!inner(first_name, last_name, student_number)
       )`
    )
    .or(
      `requested_by.eq.${scope.userId},primary_approver_id.eq.${scope.userId},secondary_approver_id.eq.${scope.userId}`
    )
    .order('requested_at', { ascending: false })
    .limit(SOURCE_CAP);
  if (error) throw new Error(error.message);

  type Student = {
    first_name: string;
    last_name: string;
    student_number: string;
  };
  type Row = {
    id: string;
    field_changed: string;
    slot_index: number | null;
    current_value: string | null;
    proposed_value: string;
    status: string;
    requested_by: string | null;
    requested_by_email: string;
    requested_at: string;
    primary_approver_id: string | null;
    secondary_approver_id: string | null;
    reviewed_by: string | null;
    reviewed_by_email: string | null;
    reviewed_at: string | null;
    decision_note: string | null;
    applied_by: string | null;
    applied_at: string | null;
    grade_entry:
      | { student: Student | Student[] }
      | Array<{ student: Student | Student[] }>;
  };

  const events: ActivityEvent[] = [];
  const waiting: ActivityWaitingItem[] = [];

  for (const row of (data ?? []) as unknown as Row[]) {
    const entry = Array.isArray(row.grade_entry)
      ? row.grade_entry[0]
      : row.grade_entry;
    const student = Array.isArray(entry?.student)
      ? entry?.student[0]
      : entry?.student;
    const studentLabel = student
      ? `${student.first_name} ${student.last_name}`
      : 'a student';

    // Teachers land on "My Requests"; everybody else deep-links into the queue,
    // which is what the existing bell already does for the same reason.
    const href =
      scope.role === 'teacher'
        ? '/markbook/grading/requests'
        : `/markbook/change-requests?req=${row.id}`;

    events.push(
      ...buildGradeChangeEvents({
        id: row.id,
        fieldChanged: row.field_changed,
        slotIndex: row.slot_index,
        currentValue: row.current_value,
        proposedValue: row.proposed_value,
        studentLabel,
        requestedById: row.requested_by,
        requestedByEmail: row.requested_by_email,
        requestedAt: row.requested_at,
        status: row.status,
        reviewedById: row.reviewed_by,
        reviewedByEmail: row.reviewed_by_email,
        reviewedAt: row.reviewed_at,
        decisionNote: row.decision_note,
        appliedById: row.applied_by,
        appliedAt: row.applied_at,
        viewerId: scope.userId,
        nameById,
        href,
      })
    );

    const mine =
      row.status === 'pending' &&
      (row.primary_approver_id === scope.userId ||
        row.secondary_approver_id === scope.userId);

    if (mine) {
      waiting.push({
        id: `grade_change:${row.id}`,
        requestId: row.id,
        title: `${studentLabel} — ${markChangeTitle(row.field_changed, row.slot_index)}`,
        subtitle: 'Mark change',
        href,
        initials: initialsOf(studentLabel),
      });
    }
  }

  return {
    events,
    waiting,
    truncated: (data ?? []).length >= SOURCE_CAP,
  };
}

// ── Small shared helpers ───────────────────────────────────────────────────

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('')
      .slice(0, 2) || '—'
  );
}

function markChangeTitle(field: string, slot: number | null): string {
  const words = field
    .split('_')
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
  return slot == null ? words : `${words} ${slot}`;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * "3 Sep" for one day, "24–26 Aug" for a run.
 *
 * ⚠ Parsed as parts, never `new Date(iso)`. These are plain yyyy-MM-dd school
 * days with no time zone; letting Date interpret them shifts a Singapore
 * morning back a day for any reader west of it.
 */
function formatDayRange(start: string, end: string): string {
  const part = (iso: string, withMonth: boolean) => {
    const [, m, d] = iso.split('-');
    const month = MONTHS[Number(m) - 1];
    if (!month || !d) return '';
    return withMonth ? `${Number(d)} ${month}` : `${Number(d)}`;
  };
  if (start === end) return part(start, true);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return `${part(start, !sameMonth)}–${part(end, true)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/activity/feed.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the column names against the real table**

Run: `npx tsc --noEmit`

Then confirm `slot_index`, `current_value`, `proposed_value`, `primary_approver_id`, `secondary_approver_id`, `reviewed_by`, `applied_by` all exist:

```bash
grep -n "slot_index\|current_value\|proposed_value\|applied_by\|reviewed_by" supabase/migrations/009_change_requests.sql
grep -n "primary_approver_id\|secondary_approver_id" supabase/migrations/044_change_request_hardening.sql
```

Expected: every column appears. If `grade_entry → student` is not a real relationship, fall back to the join `change-requests-data-table.tsx` already uses for `student_label` and mirror it exactly.

- [ ] **Step 6: Commit**

```bash
git add lib/activity/feed.ts __tests__/activity/feed.test.ts
git commit -m "feat(activity): one scoped read for a feed whose two halves are guarded differently"
```

---

## Task 3: The route

**Files:**

- Create: `app/api/activity/route.ts`
- Modify: `lib/query/keys.ts:46`

**Interfaces:**

- Consumes: `loadActivityPage`, `ActivityTab`, `ActivityCursor` (Task 2); `requireRole` from `lib/auth/require-role.ts`; `createServiceClient` from `lib/supabase/service.ts`.
- Produces: `GET /api/activity?tab=&cursor=&limit=` returning `ActivityPage` as JSON. Query key `queryKeys.activityFeed(tab)`.

- [ ] **Step 1: Write the route**

Create `app/api/activity/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import {
  loadActivityPage,
  type ActivityCursor,
  type ActivityTab,
} from '@/lib/activity/feed';

// GET /api/activity
//
// Backs the header Activity panel. Everything the browser knows about the feed
// comes through here.
//
// ⚠ SERVED, NOT READ DIRECT. `grade_change_requests` admits any account with a
// role, so the scoping in `loadActivityPage` is the only thing that keeps one
// teacher out of another's mark changes. See lib/activity/feed.ts.
//
// ⚠ THE BADGE DOES NOT COME THROUGH HERE. `useChangeRequestCount` and
// `useDeclarationCount` stay on their live RLS-scoped browser queries so the
// number cannot drift from the queue it points at (KD #196).

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const TABS: ReadonlySet<string> = new Set([
  'general',
  'grade_change',
  'student_declaration',
]);

export async function GET(request: NextRequest) {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const params = request.nextUrl.searchParams;

  const rawTab = params.get('tab') ?? 'general';
  const tab: ActivityTab = TABS.has(rawTab)
    ? (rawTab as ActivityTab)
    : 'general';

  const rawLimit = Number(params.get('limit') ?? DEFAULT_LIMIT);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.trunc(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

  // The cursor round-trips as "<iso>|<id>" — two fields, one param, no JSON to
  // parse from a query string.
  let cursor: ActivityCursor = null;
  const rawCursor = params.get('cursor');
  if (rawCursor) {
    const [at, ...rest] = rawCursor.split('|');
    const id = rest.join('|');
    if (at && id) cursor = { at, id };
  }

  try {
    const page = await loadActivityPage(createServiceClient(), {
      userId: auth.user.id,
      role: auth.role,
      tab,
      cursor,
      limit,
    });
    return NextResponse.json(page);
  } catch (e) {
    console.error(
      '[activity] feed failed:',
      e instanceof Error ? e.message : String(e)
    );
    // ⚠ 200 with an explicit failure flag, not a 500. This panel opens over
    // whatever the person was doing; a thrown error there costs them the page.
    return NextResponse.json({
      events: [],
      nextCursor: null,
      waiting: [],
      partial: true,
      truncated: false,
    });
  }
}
```

- [ ] **Step 2: Add the query key**

In `lib/query/keys.ts`, beside `changeRequestPreview` at line 46:

```ts
  activityFeed: (tab: string) => ['activity-feed', tab] as const,
```

- [ ] **Step 3: Verify the route compiles and answers**

Run: `npx tsc --noEmit`
Then start the dev server and, signed in as a staff account, open:
`http://localhost:3000/api/activity?tab=general&limit=5`
Expected: JSON with `events`, `nextCursor`, `waiting`, `partial: false`.

- [ ] **Step 4: Commit**

```bash
git add app/api/activity/route.ts lib/query/keys.ts
git commit -m "feat(activity): one endpoint for the panel, and a cursor that survives a tie"
```

---

## Task 4: The panel

**Files:**

- Create: `components/notifications/activity-row.tsx`
- Create: `components/notifications/activity-panel.tsx`
- Modify: `components/notifications/notification-bell.tsx`

**Interfaces:**

- Consumes: `queryKeys.activityFeed`, `apiFetch` from `lib/query/fetcher.ts`, `ActivityEvent`/`ActivityPage`/`ActivityWaitingItem` types.
- Produces: `<ActivityRow event={…} />`, `<ActivityPanel role={…} onNavigate={…} />`.

**Design constraints — these are binding, not suggestions:**

- Tokens only. Tone colours: `bg-brand-mint` / `bg-destructive` / `bg-primary` for the dot; the avatar keeps `bg-gradient-to-br from-brand-indigo to-brand-navy … shadow-brand-tile`.
- Tab labels: **General · Mark changes · Declarations**.
- `SheetContent` must receive `flex flex-col`, and the log gets `flex-1 min-h-0 overflow-y-auto`.
- The panel mounts only while the sheet is open — keep the existing lazy-mount pattern from the bell.
- Empty state per §7.6: muted icon tile, serif one-liner "Nothing yet.", one sentence of guidance.
- Loading uses `Skeleton`, not a spinner.

- [ ] **Step 1: Build the row component**

Create `components/notifications/activity-row.tsx`:

```tsx
'use client';

import Link from 'next/link';

import { cn } from '@/lib/utils';
import type { ActivityEvent, ActivityTone } from '@/lib/activity/events';

/**
 * One row of the activity log.
 *
 * ⚠ THE ONLY PLACE COLOUR IS SPENT, and it is spent on the small mark at the
 * corner of the avatar, in the three §9.3 tones. The avatar itself keeps the
 * standard gradient tile so a long log stays scannable without turning into a
 * fruit salad. Do not colour the circle by flow.
 */

const TONE_DOT: Record<ActivityTone, string> = {
  'went-through': 'bg-brand-mint text-ink',
  'turned-down': 'bg-destructive text-destructive-foreground',
  started: 'bg-primary text-primary-foreground',
};

export function ActivityRow({
  event,
  onNavigate,
}: {
  event: ActivityEvent;
  onNavigate?: () => void;
}) {
  return (
    <li className="border-b border-border last:border-0">
      <Link
        href={event.href}
        onClick={onNavigate}
        className="flex gap-4 px-6 py-5 transition-colors hover:bg-accent"
      >
        <span className="relative size-11 shrink-0">
          <span className="flex size-11 items-center justify-center rounded-full bg-gradient-to-br from-brand-indigo to-brand-navy text-[13px] font-semibold text-white shadow-brand-tile">
            {event.actorInitials}
          </span>
          <span
            className={cn(
              'absolute -bottom-0.5 -right-0.5 size-[18px] rounded-full border-[2.5px] border-card',
              TONE_DOT[event.tone]
            )}
            aria-hidden
          />
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="text-[15px] leading-normal text-ink-3">
            <b className="font-semibold text-foreground">{event.actorLabel}</b>{' '}
            {event.predicate}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider tabular-nums text-ink-5">
            {relativeTime(event.at)}
          </span>
          {event.details?.map((detail, i) => (
            <span
              key={`${event.id}-detail-${i}`}
              className="mt-0.5 rounded-xl border border-brand-indigo-soft/30 bg-accent px-4 py-3 text-[14px] leading-normal text-ink-2"
            >
              {detail.kind === 'note' ? `“${detail.text}”` : detail.text}
            </span>
          ))}
        </span>
      </Link>
    </li>
  );
}

/**
 * ⚠ Never throws and never returns an empty string. This renders inside the
 * app header; an exception costs the whole page, not one timestamp.
 */
export function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return 'Earlier';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
```

- [ ] **Step 2: Build the panel**

Create `components/notifications/activity-panel.tsx`:

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Activity, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiFetch } from '@/lib/query/fetcher';
import { queryKeys } from '@/lib/query/keys';
import type { ActivityEvent } from '@/lib/activity/events';
import { ActivityRow } from '@/components/notifications/activity-row';

type WaitingItem = {
  id: string;
  requestId: string;
  title: string;
  subtitle: string;
  href: string;
  initials: string;
};

type Page = {
  events: ActivityEvent[];
  nextCursor: { at: string; id: string } | null;
  waiting: WaitingItem[];
  partial: boolean;
  truncated: boolean;
};

const TABS = [
  { value: 'general', label: 'General' },
  { value: 'grade_change', label: 'Mark changes' },
  { value: 'student_declaration', label: 'Declarations' },
] as const;

export function ActivityPanel({ onNavigate }: { onNavigate: () => void }) {
  const [tab, setTab] = useState<string>('general');

  const query = useInfiniteQuery({
    queryKey: queryKeys.activityFeed(tab),
    initialPageParam: null as { at: string; id: string } | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ tab, limit: '20' });
      if (pageParam) params.set('cursor', `${pageParam.at}|${pageParam.id}`);
      return apiFetch<Page>(`/api/activity?${params.toString()}`, {
        credentials: 'include',
        signal,
      });
    },
    getNextPageParam: (last) => last.nextCursor,
    // The panel mounts only while the sheet is open, so this is never a wasted
    // background fetch — and a fresh read on open keeps the list from
    // disagreeing with the live badge beside it.
    staleTime: 0,
  });

  const pages = query.data?.pages ?? [];
  const events = pages.flatMap((p) => p.events);
  // The waiting list is the same on every page; take the first.
  const waiting = pages[0]?.waiting ?? [];
  const partial = pages.some((p) => p.partial);

  return (
    // ⚠ This wrapper is what makes the log scroll. SheetContent is a plain
    // block with h-full, so a flex column has to be declared here.
    <div className="flex h-full min-h-0 flex-col">
      {waiting.length > 0 && (
        <div className="border-b border-border bg-accent/60">
          <div className="flex items-center gap-2.5 px-6 pb-3 pt-5">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-foreground">
              Waiting for you
            </span>
            <span className="rounded-full bg-primary px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-primary-foreground">
              {waiting.length}
            </span>
          </div>
          <ul className="flex flex-col gap-2 px-3.5 pb-4">
            {waiting.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  className="flex items-center gap-3.5 rounded-xl border border-brand-indigo-soft/40 bg-card px-4 py-3.5 transition-all hover:-translate-y-px hover:border-brand-indigo-soft hover:shadow-md"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-indigo to-brand-navy text-[13px] font-semibold text-white shadow-brand-tile">
                    {item.initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-foreground">
                      {item.title}
                    </span>
                    <span className="mt-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {item.subtitle}
                    </span>
                  </span>
                  <ChevronRight
                    className="size-4 shrink-0 text-ink-5"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-b border-border px-6 py-5">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="flex-1">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.isLoading ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3.5 px-10 py-14 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl border border-border bg-muted text-ink-5">
              <Activity className="size-6" aria-hidden />
            </span>
            <p className="mt-1.5 font-serif text-xl font-semibold text-foreground">
              Nothing yet.
            </p>
            <p className="max-w-[32ch] text-[14.5px] leading-relaxed text-muted-foreground">
              Approvals you&apos;re part of will appear here as they move —
              filed, approved, turned down.
            </p>
          </div>
        ) : (
          <>
            <ul>
              {events.map((event) => (
                <ActivityRow
                  key={event.id}
                  event={event}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
            {query.hasNextPage && (
              <div className="flex justify-center border-t border-border px-4 py-6">
                <Button
                  variant="ghost"
                  size="sm"
                  loading={query.isFetchingNextPage}
                  loadingText="Loading…"
                  onClick={() => void query.fetchNextPage()}
                >
                  Show older activity
                </Button>
              </div>
            )}
          </>
        )}

        {partial && (
          <p className="border-t border-border px-6 py-3 text-center text-[13px] text-muted-foreground">
            Some activity couldn&apos;t be loaded. This list may be short.
          </p>
        )}
      </div>

      <p className="border-t border-border bg-muted px-6 py-4 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink-5">
        Showing only approvals you are part of
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Swap the bell for the sheet**

In `components/notifications/notification-bell.tsx`:

1. Replace the `Bell` import with `Activity` from `lucide-react`, and `<Bell className="size-4" aria-hidden />` with `<Activity className="size-4" aria-hidden />`.
2. Replace the `Popover` / `PopoverTrigger` / `PopoverContent` imports with `Sheet` / `SheetTrigger` / `SheetContent` / `SheetHeader` / `SheetTitle` from `@/components/ui/sheet`.
3. Replace the whole `<Popover>…</Popover>` block with:

```tsx
<Sheet open={open} onOpenChange={setOpen}>
  <SheetTrigger asChild>
    <button
      type="button"
      aria-label={
        count && count > 0 ? `Activity (${count} waiting for you)` : 'Activity'
      }
      className="relative flex size-8 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Activity className="size-4" aria-hidden />
      {count != null && count > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold tabular-nums text-white">
          {count}
        </span>
      )}
    </button>
  </SheetTrigger>
  {/* ⚠ `flex flex-col` is required — SheetContent's variants are a plain
          block with h-full, so a flex-1 body would not scroll without it. */}
  <SheetContent
    side="right"
    className="flex w-full flex-col gap-0 p-0 sm:max-w-[552px]"
  >
    <SheetHeader className="border-b border-border px-6 py-5">
      <SheetTitle className="font-serif text-[23px] font-semibold tracking-tight">
        Activity
      </SheetTitle>
    </SheetHeader>
    {/* Mounted only while open, so a closed panel costs nothing (KD #56). */}
    {open && <ActivityPanel onNavigate={() => setOpen(false)} />}
  </SheetContent>
</Sheet>
```

4. Delete `NotificationPreviewPanel`, `PreviewRow`, `DeclarationPreviewRow`, `MergedRow`, `previewRowHref`, `declarationRowHref` and the local `relativeTime`. **Keep `deriveInitials` and `formatDayRange` exported** — `__tests__` reference them; check with `grep -rn "deriveInitials\|formatDayRange" __tests__/` and delete only what nothing imports.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npx vitest run --testTimeout=30000
grep -rnE "#[0-9a-fA-F]{6}|oklch\(|slate-|zinc-|gray-|bg-white|bg-black" components/notifications/
```

Expected: tsc clean, suite green, and the grep returns nothing.

- [ ] **Step 5: Browser-verify**

Sign in as a staff account with at least one filing waiting. Confirm: the header icon is the pulse line, the badge count is unchanged from before this task, the sheet opens from the right, the pinned block lists what you owe, tabs filter, the log scrolls, and "Show older activity" appends without reordering rows already on screen. Check at 375px width — the sheet must be full-width there.

- [ ] **Step 6: Commit**

```bash
git add components/notifications/
git commit -m "feat(activity): the bell becomes a panel, and the number keeps its meaning"
```

---

## Task 5: History on the two mark-change screens

**Files:**

- Create: `components/approvals/approval-history-dialog.tsx`
- Modify: `app/(markbook)/markbook/change-requests/change-requests-data-table.tsx`
- Modify: `app/(markbook)/markbook/grading/requests/my-requests-table.tsx`

**Interfaces:**

- Consumes: `buildGradeChangeEvents`, `markChangeFieldLabel` (Task 1).
- Produces: `<ApprovalHistoryDialog events={…} title={…} subtitle={…} footnote={…} />` — takes already-built events so it stays free of data loading and can be reused by a future flow.

- [ ] **Step 1: Build the dialog**

Create `components/approvals/approval-history-dialog.tsx`:

```tsx
'use client';

import { Check, X } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { ActivityEvent, ActivityTone } from '@/lib/activity/events';

/**
 * One approval, end to end.
 *
 * ⚠ THE SPINE BELONGS HERE AND NOT IN THE PANEL. These rows genuinely are one
 * ordered ladder, so a connecting line carries information. In the activity
 * panel, different people's approvals interleave and a line would claim a
 * sequence that is not there.
 *
 * ⚠ OLDEST FIRST, unlike the panel — here you are reading a story rather than
 * checking what is new.
 */

const NODE: Record<ActivityTone, string> = {
  'went-through': 'bg-brand-mint text-ink',
  'turned-down': 'bg-destructive text-destructive-foreground',
  started: 'bg-primary text-primary-foreground',
};

export function ApprovalHistoryDialog({
  trigger,
  title,
  subtitle,
  events,
  footnote,
}: {
  trigger: React.ReactNode;
  title: string;
  subtitle: string;
  events: ActivityEvent[];
  footnote?: string;
}) {
  const ordered = [...events].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="font-serif text-[23px] font-semibold tracking-tight">
            {title}
          </DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        <ol className="max-h-[60vh] overflow-y-auto pt-2">
          {ordered.map((event, index) => (
            <li key={event.id} className="flex gap-4">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full',
                    NODE[event.tone]
                  )}
                >
                  {event.tone === 'went-through' ? (
                    <Check className="size-3.5" aria-hidden />
                  ) : event.tone === 'turned-down' ? (
                    <X className="size-3.5" aria-hidden />
                  ) : null}
                </span>
                {index < ordered.length - 1 && (
                  <span className="my-1 w-0.5 flex-1 bg-border" aria-hidden />
                )}
              </div>

              <div className="min-w-0 flex-1 pb-7">
                <p className="text-[15px] leading-normal text-ink-3">
                  <b className="font-semibold text-foreground">
                    {event.actorLabel}
                  </b>{' '}
                  {event.predicate}
                </p>
                <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider tabular-nums text-ink-5">
                  {absoluteTime(event.at)}
                </p>
                {event.details?.map((detail, i) => (
                  <p
                    key={`${event.id}-d-${i}`}
                    className="mt-2.5 rounded-xl border border-brand-indigo-soft/30 bg-accent px-4 py-3 text-[14px] leading-normal text-ink-2"
                  >
                    {detail.kind === 'note' ? `“${detail.text}”` : detail.text}
                  </p>
                ))}
              </div>
            </li>
          ))}
        </ol>

        {footnote && (
          <p className="border-t border-border pt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-5">
            {footnote}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function absoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-SG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
```

- [ ] **Step 2: Wire it into the admin queue**

In `change-requests-data-table.tsx`, inside the row's actions cell (beside the existing decision buttons), add:

```tsx
<ApprovalHistoryDialog
  trigger={
    <Button variant="ghost" size="sm">
      History
    </Button>
  }
  title={`${row.original.student_label ?? 'A student'} — ${markChangeFieldLabel(
    row.original.field_changed,
    row.original.slot_index ?? null
  )}`}
  subtitle={row.original.sheet_label ?? 'Mark change'}
  events={buildGradeChangeEvents({
    id: row.original.id,
    fieldChanged: row.original.field_changed,
    slotIndex: row.original.slot_index ?? null,
    currentValue: row.original.current_value ?? null,
    proposedValue: row.original.proposed_value,
    studentLabel: row.original.student_label ?? 'a student',
    requestedById: null,
    requestedByEmail: row.original.requested_by_email,
    requestedAt: row.original.requested_at,
    status: row.original.status,
    reviewedById: null,
    reviewedByEmail:
      row.original.primary_reviewed_by_email ?? row.original.reviewed_by_email,
    reviewedAt: row.original.reviewed_at,
    decisionNote: row.original.decision_note ?? null,
    appliedById: null,
    appliedAt: row.original.applied_at,
    viewerId: '',
    nameById: new Map(),
    href: `/markbook/change-requests?req=${row.original.id}`,
  })}
/>
```

⚠ If `slot_index`, `current_value`, `proposed_value`, `decision_note` or `status` are absent from that file's row type, add them to its `select` and its type — check the type declaration around line 138 first.

- [ ] **Step 3: Wire it into My Requests**

Repeat Step 2 in `my-requests-table.tsx`, with `viewerId` set to the signed-in user's id (the page already has it, or pass it down from `page.tsx` as a prop) so the first row reads **"You asked to change …"** rather than the teacher's own name.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npx vitest run --testTimeout=30000
```

Then browser-verify: open both pages, click History on a request that has been approved and applied, and confirm three rows appear in order with the old → new values on the last one. Confirm a still-pending request shows exactly one row.

- [ ] **Step 5: Commit**

```bash
git add components/approvals/ "app/(markbook)/markbook/change-requests/change-requests-data-table.tsx" "app/(markbook)/markbook/grading/requests/my-requests-table.tsx"
git commit -m "feat(approvals): a mark change can finally be read end to end"
```

---

## Task 6: A step the ladder never reached

**Files:**

- Modify: `app/(attendance)/attendance/declarations/decision-sheet.tsx:249-330`

**Why this is the only declarations change:** that section already renders the full timeline — rail, per-step status, decider, time and note. The one thing it gets wrong is a turned-down filing: a rejection stops the ladder, later steps stay `waiting` forever, and they currently render in the same muted style as a step that is still genuinely coming. A reader cannot tell "not yet" from "never".

- [ ] **Step 1: Compute whether the ladder stopped**

Immediately above the `<ol className="space-y-0">` in that section, add:

```tsx
{
  /* ⚠ A rejection ENDS the ladder — every later step keeps status
              'waiting' in the table forever. Rendered the same as a step that
              is still coming, they read as "not yet" when the truth is
              "never". */
}
{
  (() => null)();
}
```

Then inside the `.map`, after the existing `const decided = …`, add:

```tsx
const rejectedAt = all.find((s) => s.status === 'rejected');
const neverReached =
  rejectedAt != null && stage.stageOrder > rejectedAt.stageOrder && !decided;
```

- [ ] **Step 2: Render it differently**

Change the rail marker's class list to add, after the existing `stage.status === 'waiting' && 'bg-muted text-muted-foreground'` entry:

```tsx
neverReached &&
  'border border-dashed border-hairline-strong bg-card text-ink-5';
```

And replace the final `else` branch of the description (the "Nobody has been added to this step yet" paragraph) with a `neverReached` check ahead of it:

```tsx
                    ) : neverReached ? (
                      <p className="text-[13px] text-muted-foreground">
                        Never reached — the filing was turned down before this
                        step.
                      </p>
                    ) : people ? (
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npx vitest run --testTimeout=30000
grep -rnE "#[0-9a-fA-F]{6}|oklch\(|slate-|zinc-|gray-|bg-white|bg-black" "app/(attendance)/attendance/declarations/decision-sheet.tsx"
```

Then browser-verify against a turned-down filing with a step after the rejection. Production has one: check `/attendance/declarations`, Decided tab.

⚠ If no such filing exists, this is untestable in the browser today and the task should say so rather than claim a pass — the unit-level guarantee is Task 1's "emits nothing for steps the ladder never reached".

- [ ] **Step 4: Commit**

```bash
git add "app/(attendance)/attendance/declarations/decision-sheet.tsx"
git commit -m "fix(declarations): a step after a rejection is never reached, not still coming"
```

---

## Self-review notes

**Spec coverage.** §6 event model → Task 1. §7 scope → Task 2. §8 paging → Task 2 (`pageEvents`). §9.1 panel → Task 4. §9.2 View history → Tasks 5 and 6, reduced because the declarations half already exists. §10 testing → the test files in Tasks 1 and 2, plus the browser steps. §11 out-of-scope items are absent from every task, as intended.

**Deviations from the spec, both deliberate and both recorded above:**

1. `register_written` is a payload on the final approval, not its own event.
2. Paging is derive-then-slice against a `SOURCE_CAP`, not per-source over-fetch — simpler and correct by construction at this scale. §8's over-fetch hazard cannot occur because no source is ever cut before the merge.

**Still unverified and worth saying out loud:** Task 2's `grade_entry → student` join is written from the shape of neighbouring queries, not from a run. Step 5 of that task exists to catch it.
