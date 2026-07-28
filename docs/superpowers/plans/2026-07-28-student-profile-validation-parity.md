# Student Profile Validation Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the admissions portal's field-format rules (NRIC, phone, email, postal code, nationality) onto the shared SIS Student Profile editors, and mask passport/pass-number display everywhere it currently renders in the clear.

**Architecture:** Two independent slices sharing the same 8 "sensitive" fields. Slice A (validation) adds format-checked zod helpers to `lib/schemas/sis.ts` plus a new constrained nationality combobox; Slice B (masking) adds a reveal-toggle to both the edit sheets and the read-only view tabs. Ordering matters: the nationality combobox UI ships _before_ the schema tightens to reject off-list nationality strings, so there is never a window where the schema is stricter than what the UI lets a user type.

**Tech Stack:** Next.js 16 App Router, zod v4, React Hook Form, shadcn `Command`/`Popover`/`Input`, `country-state-city` (new npm dependency), Vitest + `@testing-library/react`.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-28-student-profile-validation-parity-design.md` — this plan implements it exactly; do not add scope beyond it.
- **Required-ness parity is explicitly out of scope** (spec's "Explicitly out of scope" section) — every new/changed schema field stays optional (nullable), same as today.
- **Passport/pass number _format_ validation is explicitly out of scope** (open item in the spec) — only _display masking_ of these fields is in scope this plan.
- NRIC regex: `/^[STFGM]\d{7}[A-Z]$/` — verbatim, no case-folding transform added.
- Phone regex: `/^\+?\d+$/` — verbatim.
- Postal code regex: `/^\d+$/` — digits only, no extra length bound beyond the existing `max(60)` ceiling already on the field.
- Email: replace the custom regex with zod's built-in `.email()`.
- Nationality: stored value is the **country name** (e.g. `"Philippines"`), never a demonym or ISO code — confirmed against the portal's `LocationSelector` (`field.onChange(value?.name)`).
- A stored value outside the canonical list must keep displaying (as a selectable "(current)" option) and must not be force-changed by this work — no backfill, no retroactive rejection of existing DB rows.
- Masking scope is **exactly 8 fields**: `passportNumber`, `pass` (student) and `father`/`mother`/`guardian` × `Passport`/`Pass` (6 more). Expiry-date fields are never masked.
- Design system: use only primitives already listed in `docs/context/09-design-system.md` §4.1 (`Input`, `Command`, `Popover`, `Button`) — no new tokens, no raw hex/oklch/gray values (Hard Rule #7).
- Test runner: `npm test` (`vitest run`). Compile-check: `npx next build` per this project's workflow rule — run it after every task that touches a `.tsx`/`.ts` file under `app/`, `components/`, or `lib/`.

---

### Task 1: Country data module

**Files:**

- Create: `lib/data/countries.ts`
- Test: `__tests__/data/countries.test.ts`

**Interfaces:**

- Produces: `COUNTRY_NAMES: readonly string[]` (sorted, deduplicated country names) and `COUNTRY_NAME_SET: ReadonlySet<string>` — both consumed by Task 3 (combobox UI) and Task 6 (schema refine).

- [ ] **Step 1: Install the npm dependency**

Run: `npm install country-state-city`

Verify it landed in `package.json` under `"dependencies"` (not `devDependencies` — this ships in the browser bundle for the combobox).

- [ ] **Step 2: Write the failing test**

Create `__tests__/data/countries.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { COUNTRY_NAMES, COUNTRY_NAME_SET } from '@/lib/data/countries';

describe('COUNTRY_NAMES', () => {
  it('is non-empty', () => {
    expect(COUNTRY_NAMES.length).toBeGreaterThan(100);
  });

  it('contains real country names used at HFSE', () => {
    expect(COUNTRY_NAMES).toContain('Philippines');
    expect(COUNTRY_NAMES).toContain('Singapore');
  });

  it('has no duplicate entries', () => {
    expect(new Set(COUNTRY_NAMES).size).toBe(COUNTRY_NAMES.length);
  });

  it('is sorted alphabetically', () => {
    const sorted = [...COUNTRY_NAMES].sort((a, b) => a.localeCompare(b));
    expect(COUNTRY_NAMES).toEqual(sorted);
  });
});

describe('COUNTRY_NAME_SET', () => {
  it('contains every name from COUNTRY_NAMES', () => {
    for (const name of COUNTRY_NAMES) {
      expect(COUNTRY_NAME_SET.has(name)).toBe(true);
    }
  });

  it('rejects an arbitrary non-country string', () => {
    expect(COUNTRY_NAME_SET.has('Not A Real Country')).toBe(false);
  });
});
```

- [ ] **Step 2b: Run test to verify it fails**

Run: `npm test -- __tests__/data/countries.test.ts`
Expected: FAIL — `Cannot find module '@/lib/data/countries'`

- [ ] **Step 3: Write the implementation**

Create `lib/data/countries.ts`:

```ts
import { Country } from 'country-state-city';

// Canonical country-name list for the nationality field (student + all 3
// parent slots). Only `name` is used — this app has no need for the
// package's iso codes, phone codes, or geo data. Deduplicated because a
// couple of territories in the upstream dataset share a display name.
const rawNames = Country.getAllCountries().map((c) => c.name);

export const COUNTRY_NAMES: readonly string[] = Array.from(
  new Set(rawNames)
).sort((a, b) => a.localeCompare(b));

export const COUNTRY_NAME_SET: ReadonlySet<string> = new Set(COUNTRY_NAMES);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- __tests__/data/countries.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/data/countries.ts __tests__/data/countries.test.ts
git commit -m "feat: add canonical country-name data module"
```

---

### Task 2: `SensitiveInput` component

**Files:**

- Create: `components/sis/sensitive-input.tsx`
- Test: `__tests__/ui/sensitive-input.test.tsx`

**Interfaces:**

- Produces: `SensitiveInput({ value: string; onChange: (next: string) => void; placeholder?: string; className?: string })` — a controlled masked text input with a reveal toggle. Consumed by Task 4 and Task 5's `SchemaField` `kind === 'password'` branches.

- [ ] **Step 1: Write the failing test**

Create `__tests__/ui/sensitive-input.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SensitiveInput } from '@/components/sis/sensitive-input';

describe('SensitiveInput', () => {
  it('renders masked (type="password") by default', () => {
    render(<SensitiveInput value="E1234567" onChange={() => {}} />);
    const input = screen.getByDisplayValue('E1234567');
    expect(input).toHaveAttribute('type', 'password');
  });

  it('reveals the value as plain text when the toggle is clicked', async () => {
    const user = userEvent.setup();
    render(<SensitiveInput value="E1234567" onChange={() => {}} />);

    await user.click(screen.getByRole('button', { name: /show/i }));

    const input = screen.getByDisplayValue('E1234567');
    expect(input).toHaveAttribute('type', 'text');
  });

  it('toggling twice returns to masked', async () => {
    const user = userEvent.setup();
    render(<SensitiveInput value="E1234567" onChange={() => {}} />);

    await user.click(screen.getByRole('button', { name: /show/i }));
    await user.click(screen.getByRole('button', { name: /hide/i }));

    const input = screen.getByDisplayValue('E1234567');
    expect(input).toHaveAttribute('type', 'password');
  });

  it('calls onChange with the typed value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <SensitiveInput value="" onChange={onChange} />
    );

    // `<input type="password">` has no accessible textbox role, so grab it
    // by tag directly — there's exactly one <input> in this component.
    const input = container.querySelector('input');
    expect(input).not.toBeNull();
    await user.type(input as HTMLInputElement, 'X');

    expect(onChange).toHaveBeenCalledWith('X');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/ui/sensitive-input.test.tsx`
Expected: FAIL — `Cannot find module '@/components/sis/sensitive-input'`

- [ ] **Step 3: Write the implementation**

Create `components/sis/sensitive-input.tsx`:

```tsx
'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// Masked-by-default text input with a per-field reveal toggle — used for
// passport/pass numbers (KD pending: student-profile validation-parity
// design, 2026-07-28). Not a real password field (no autocomplete
// implications intended) — `type="password"` is used purely for its
// visual masking behavior.
export function SensitiveInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [revealed, setRevealed] = React.useState(false);
  return (
    <div className="relative">
      <Input
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn('pr-9', className)}
      />
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
        aria-label={revealed ? 'Hide value' : 'Show value'}
      >
        {revealed ? (
          <EyeOff className="size-3.5" />
        ) : (
          <Eye className="size-3.5" />
        )}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- __tests__/ui/sensitive-input.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add components/sis/sensitive-input.tsx __tests__/ui/sensitive-input.test.tsx
git commit -m "feat: add SensitiveInput masked-field component"
```

---

### Task 3: `CountryCombobox` component

**Files:**

- Create: `components/sis/country-combobox.tsx`
- Test: `__tests__/ui/country-combobox.test.tsx`

**Interfaces:**

- Consumes: `COUNTRY_NAMES` from `@/lib/data/countries` (Task 1).
- Produces: `CountryCombobox({ value: string | null; onChange: (next: string | null) => void })` — a single-select searchable combobox over the fixed `COUNTRY_NAMES` list, with an off-list "(current)" fallback item. Consumed by Task 4 and Task 5's `SchemaField` `kind === 'combobox'` branches.

- [ ] **Step 1: Write the failing test**

Create `__tests__/ui/country-combobox.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CountryCombobox } from '@/components/sis/country-combobox';

describe('CountryCombobox', () => {
  it('shows the placeholder when value is null', () => {
    render(<CountryCombobox value={null} onChange={() => {}} />);
    expect(screen.getByText(/select country/i)).toBeInTheDocument();
  });

  it('shows the current value on the trigger', () => {
    render(<CountryCombobox value="Philippines" onChange={() => {}} />);
    expect(screen.getByText('Philippines')).toBeInTheDocument();
  });

  it('searching and selecting a country calls onChange with its name', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CountryCombobox value={null} onChange={onChange} />);

    await user.click(screen.getByRole('combobox'));
    await user.type(
      screen.getByPlaceholderText(/search country/i),
      'Singapore'
    );
    await user.click(await screen.findByText('Singapore'));

    expect(onChange).toHaveBeenCalledWith('Singapore');
  });

  it('shows an off-list stored value as a selectable "(current)" item', async () => {
    const user = userEvent.setup();
    render(<CountryCombobox value="Not A Real Country" onChange={() => {}} />);

    await user.click(screen.getByRole('combobox'));

    expect(
      await screen.findByText('Not A Real Country (current)')
    ).toBeInTheDocument();
  });

  it('does not show a "(current)" item for an already-known value', async () => {
    const user = userEvent.setup();
    render(<CountryCombobox value="Philippines" onChange={() => {}} />);

    await user.click(screen.getByRole('combobox'));

    expect(screen.queryByText(/\(current\)/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/ui/country-combobox.test.tsx`
Expected: FAIL — `Cannot find module '@/components/sis/country-combobox'`

- [ ] **Step 3: Write the implementation**

Create `components/sis/country-combobox.tsx`:

```tsx
'use client';

import * as React from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { COUNTRY_NAMES } from '@/lib/data/countries';
import { cn } from '@/lib/utils';

// Single-select searchable country picker. Stores the country NAME (not a
// demonym, not an ISO code) — matches the admissions portal's own
// LocationSelector, which does `field.onChange(value?.name)`.
//
// A stored value outside COUNTRY_NAMES (a legacy free-text entry, a typo)
// renders as an extra "(current)" item instead of leaving the trigger
// blank — same idiom as edit-profile-sheet.tsx's `kind: 'select'` fallback
// for preferredPaymentScheme/Method. Selecting it is a no-op (it's already
// the value); it exists so the field doesn't look broken/empty.
export function CountryCombobox({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const isKnown = value == null || COUNTRY_NAMES.includes(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-9 w-full justify-between font-normal"
        >
          <span className="truncate">{value ?? 'Select country...'}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search country..." />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {!isKnown && value && (
                <CommandItem value={value} onSelect={() => setOpen(false)}>
                  {value} (current)
                  <Check className="ml-auto size-4 opacity-100" />
                </CommandItem>
              )}
              {COUNTRY_NAMES.map((name) => (
                <CommandItem
                  key={name}
                  value={name}
                  onSelect={() => {
                    onChange(name);
                    setOpen(false);
                  }}
                >
                  {name}
                  <Check
                    className={cn(
                      'ml-auto size-4',
                      value === name ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- __tests__/ui/country-combobox.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add components/sis/country-combobox.tsx __tests__/ui/country-combobox.test.tsx
git commit -m "feat: add CountryCombobox constrained nationality picker"
```

---

### Task 4: Wire the new field kinds into `edit-profile-sheet.tsx`

**Files:**

- Modify: `components/sis/edit-profile-sheet.tsx`
- Test: `__tests__/ui/edit-profile-sheet-field-kinds.test.tsx`

**Interfaces:**

- Consumes: `CountryCombobox` (Task 3), `SensitiveInput` (Task 2).
- Produces: nothing new consumed elsewhere — this task's deliverable is the sheet itself.

- [ ] **Step 1: Write the failing test**

Create `__tests__/ui/edit-profile-sheet-field-kinds.test.tsx`. This renders the sheet already open (via the trigger) and checks the two new field kinds render their new controls instead of a plain text `<input>`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { EditProfileSheet } from '@/components/sis/edit-profile-sheet';
import { renderWithClient } from '../_utils/render-with-client';

async function openSheet() {
  const user = userEvent.setup();
  renderWithClient(
    <EditProfileSheet
      ayCode="AY2026"
      enroleeNumber="ENR-1"
      initial={{ nationality: 'Philippines', passportNumber: 'E1234567' }}
    />
  );
  await user.click(screen.getByRole('button', { name: /edit profile/i }));
  return user;
}

describe('EditProfileSheet — new field kinds', () => {
  it('renders Nationality as a combobox showing the current value', async () => {
    await openSheet();
    const comboboxes = screen.getAllByRole('combobox');
    expect(
      comboboxes.some((el) => el.textContent?.includes('Philippines'))
    ).toBe(true);
  });

  it('renders Passport number masked by default', async () => {
    await openSheet();
    const input = screen.getByDisplayValue('E1234567');
    expect(input).toHaveAttribute('type', 'password');
  });

  it('reveals Passport number when its toggle is clicked', async () => {
    const user = await openSheet();
    const toggles = screen.getAllByRole('button', { name: /show value/i });
    await user.click(toggles[0]);
    expect(screen.getByDisplayValue('E1234567')).toHaveAttribute(
      'type',
      'text'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/ui/edit-profile-sheet-field-kinds.test.tsx`
Expected: FAIL — Nationality still renders a plain text input (no `role="combobox"`), Passport number has no `type="password"`.

- [ ] **Step 3: Implement — imports and `FieldKind`**

In `components/sis/edit-profile-sheet.tsx`, add imports (near the other local imports) and widen `FieldKind`:

```ts
import { CountryCombobox } from '@/components/sis/country-combobox';
import { SensitiveInput } from '@/components/sis/sensitive-input';
```

```ts
type FieldKind =
  | 'text'
  | 'textarea'
  | 'date'
  | 'tribool'
  | 'select'
  | 'combobox'
  | 'password';
```

- [ ] **Step 4: Implement — update `SECTIONS`**

In the `Identity` section, change:

```ts
{ name: 'nationality', label: 'Nationality' },
```

to:

```ts
{ name: 'nationality', label: 'Nationality', kind: 'combobox' },
```

In the `Travel documents` section, change:

```ts
{ name: 'passportNumber', label: 'Passport number' },
{ name: 'passportExpiry', label: 'Passport expiry', kind: 'date' },
{ name: 'pass', label: 'Pass type' },
{ name: 'passExpiry', label: 'Pass expiry', kind: 'date' },
```

to:

```ts
{ name: 'passportNumber', label: 'Passport number', kind: 'password' },
{ name: 'passportExpiry', label: 'Passport expiry', kind: 'date' },
{ name: 'pass', label: 'Pass type', kind: 'password' },
{ name: 'passExpiry', label: 'Pass expiry', kind: 'date' },
```

- [ ] **Step 5: Implement — new `SchemaField` render branches**

In `SchemaField`, add two new branches. Insert them after the existing `kind === 'select'` branch and before the `kind === 'textarea'` branch:

```tsx
if (kind === 'combobox') {
  const v = field.value as string | null | undefined;
  return (
    <FormItem className={wrapperClass}>
      <FormLabel className="text-xs">{cfg.label}</FormLabel>
      <FormControl>
        <CountryCombobox
          value={v ?? null}
          onChange={(next) => field.onChange(next)}
        />
      </FormControl>
      <FormMessage />
    </FormItem>
  );
}
if (kind === 'password') {
  return (
    <FormItem className={wrapperClass}>
      <FormLabel className="text-xs">{cfg.label}</FormLabel>
      <FormControl>
        <SensitiveInput
          value={(field.value as string | null) ?? ''}
          onChange={(next) => field.onChange(next === '' ? null : next)}
          placeholder={cfg.placeholder ?? ''}
        />
      </FormControl>
      <FormMessage />
    </FormItem>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- __tests__/ui/edit-profile-sheet-field-kinds.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 7: Compile check**

Run: `npx next build`
Expected: clean compile, no type errors.

- [ ] **Step 8: Commit**

```bash
git add components/sis/edit-profile-sheet.tsx __tests__/ui/edit-profile-sheet-field-kinds.test.tsx
git commit -m "feat: use CountryCombobox + SensitiveInput in the profile edit sheet"
```

---

### Task 5: Wire the new field kinds into `edit-family-sheet.tsx`

**Files:**

- Modify: `components/sis/edit-family-sheet.tsx`
- Test: `__tests__/ui/edit-family-sheet-field-kinds.test.tsx`

**Interfaces:**

- Consumes: `CountryCombobox` (Task 3), `SensitiveInput` (Task 2).
- Produces: nothing new consumed elsewhere.

Mirrors Task 4, but this file derives `MOTHER_FIELDS` and `GUARDIAN_FIELDS` from `FATHER_FIELDS` via `.map()` — so editing `FATHER_FIELDS` once propagates the `kind` changes to all three parent slots automatically. Do not edit `MOTHER_FIELDS`/`GUARDIAN_FIELDS` directly (they're generated, not hand-written).

- [ ] **Step 1: Write the failing test**

Create `__tests__/ui/edit-family-sheet-field-kinds.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

import { EditFamilySheet } from '@/components/sis/edit-family-sheet';
import { renderWithClient } from '../_utils/render-with-client';

async function openSheet(parent: 'father' | 'mother' | 'guardian') {
  const user = userEvent.setup();
  renderWithClient(
    <EditFamilySheet
      ayCode="AY2026"
      enroleeNumber="ENR-1"
      parent={parent}
      initial={{
        [`${parent}Nationality`]: 'Philippines',
        [`${parent}Passport`]: 'E1234567',
      }}
    />
  );
  await user.click(screen.getByRole('button', { name: /^edit$/i }));
  return user;
}

describe.each(['father', 'mother', 'guardian'] as const)(
  'EditFamilySheet (%s) — new field kinds',
  (parent) => {
    it('renders Nationality as a combobox showing the current value', async () => {
      await openSheet(parent);
      const comboboxes = screen.getAllByRole('combobox');
      expect(
        comboboxes.some((el) => el.textContent?.includes('Philippines'))
      ).toBe(true);
    });

    it('renders Passport masked by default', async () => {
      await openSheet(parent);
      const input = screen.getByDisplayValue('E1234567');
      expect(input).toHaveAttribute('type', 'password');
    });
  }
);
```

Note the `import { vi } from 'vitest'` used by `vi.mock` above must be added to the top import line alongside `describe, expect, it` — write it as `import { describe, expect, it, vi } from 'vitest';`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/ui/edit-family-sheet-field-kinds.test.tsx`
Expected: FAIL for all 3 parent slots — Nationality has no `role="combobox"`, Passport has no `type="password"`.

- [ ] **Step 3: Implement — imports and `FieldKind`**

In `components/sis/edit-family-sheet.tsx`, add imports and widen the local `FieldKind`:

```ts
import { CountryCombobox } from '@/components/sis/country-combobox';
import { SensitiveInput } from '@/components/sis/sensitive-input';
```

```ts
type FieldKind =
  | 'text'
  | 'email'
  | 'date'
  | 'tribool'
  | 'combobox'
  | 'password';
```

- [ ] **Step 4: Implement — update `FATHER_FIELDS`**

Change:

```ts
{ name: 'fatherNationality', label: 'Nationality' },
```

to:

```ts
{ name: 'fatherNationality', label: 'Nationality', kind: 'combobox' },
```

Change:

```ts
{ name: 'fatherPassport', label: 'Passport' },
{ name: 'fatherPassportExpiry', label: 'Passport expiry', kind: 'date' },
{ name: 'fatherPass', label: 'Pass type' },
{ name: 'fatherPassExpiry', label: 'Pass expiry', kind: 'date' },
```

to:

```ts
{ name: 'fatherPassport', label: 'Passport', kind: 'password' },
{ name: 'fatherPassportExpiry', label: 'Passport expiry', kind: 'date' },
{ name: 'fatherPass', label: 'Pass type', kind: 'password' },
{ name: 'fatherPassExpiry', label: 'Pass expiry', kind: 'date' },
```

Do not touch `MOTHER_FIELDS` or `GUARDIAN_FIELDS` — they derive from `FATHER_FIELDS` via `.map()` and will pick up both changes automatically (guardian already filters out `fatherMarital` only, which is unrelated to this change).

- [ ] **Step 5: Implement — new `SchemaField` render branches**

In `SchemaField`, insert two new branches after the `kind === 'date'` branch and before the closing generic `text`/`email` fallback:

```tsx
if (kind === 'combobox') {
  const v = field.value as string | null | undefined;
  return (
    <FormItem className={wrapperClass}>
      <FormLabel className="text-xs">{cfg.label}</FormLabel>
      <FormControl>
        <CountryCombobox
          value={v ?? null}
          onChange={(next) => field.onChange(next)}
        />
      </FormControl>
      <FormMessage />
    </FormItem>
  );
}
if (kind === 'password') {
  return (
    <FormItem className={wrapperClass}>
      <FormLabel className="text-xs">{cfg.label}</FormLabel>
      <FormControl>
        <SensitiveInput
          value={(field.value as string | null) ?? ''}
          onChange={(next) => field.onChange(next === '' ? null : next)}
        />
      </FormControl>
      <FormMessage />
    </FormItem>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- __tests__/ui/edit-family-sheet-field-kinds.test.tsx`
Expected: PASS (6 tests — 2 per parent slot × 3 slots)

- [ ] **Step 7: Compile check**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 8: Commit**

```bash
git add components/sis/edit-family-sheet.tsx __tests__/ui/edit-family-sheet-field-kinds.test.tsx
git commit -m "feat: use CountryCombobox + SensitiveInput in the family edit sheet"
```

---

### Task 6: Tighten `lib/schemas/sis.ts` validation

**Files:**

- Modify: `lib/schemas/sis.ts`
- Test: `__tests__/schemas/sis-profile-validation.test.ts`

**Interfaces:**

- Consumes: `COUNTRY_NAME_SET` from `@/lib/data/countries` (Task 1).
- Produces: no new exports — the existing `ProfileUpdateSchema` / `FatherUpdateSchema` / `MotherUpdateSchema` / `GuardianUpdateSchema` just validate more strictly on 4 field groups (NRIC, phone, email, postal code, nationality).

This task must run _after_ Tasks 4 and 5 so the UI already constrains nationality input to the combobox before the schema starts rejecting off-list free text.

- [ ] **Step 1: Write the failing test**

Create `__tests__/schemas/sis-profile-validation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FatherUpdateSchema, ProfileUpdateSchema } from '@/lib/schemas/sis';

// Every field on these 4 schemas is nullable (only `category` is also
// optional), and the real edit-sheet UI always submits a full form object
// (components/sis/edit-profile-sheet.tsx's buildDefaults() defaults every
// missing key to null) — never a genuine partial patch. So a valid
// `.safeParse()` call here must supply every key; derive an all-null base
// from the schema's own shape and override only the field under test.
const baseProfile = Object.fromEntries(
  Object.keys(ProfileUpdateSchema.shape).map((k) => [k, null])
);
const baseFather = Object.fromEntries(
  Object.keys(FatherUpdateSchema.shape).map((k) => [k, null])
);

describe('ProfileUpdateSchema — NRIC', () => {
  it('accepts a well-formed NRIC', () => {
    expect(
      ProfileUpdateSchema.safeParse({ ...baseProfile, nric: 'S1234567A' })
        .success
    ).toBe(true);
  });

  it('rejects a malformed NRIC', () => {
    expect(
      ProfileUpdateSchema.safeParse({ ...baseProfile, nric: '1234567A' })
        .success
    ).toBe(false);
  });

  it('accepts blank (clears to null)', () => {
    const r = ProfileUpdateSchema.safeParse({ ...baseProfile, nric: '' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nric).toBeNull();
  });
});

describe('ProfileUpdateSchema — phone', () => {
  it('accepts digits with an optional leading +', () => {
    expect(
      ProfileUpdateSchema.safeParse({
        ...baseProfile,
        homePhone: '+6591234567',
      }).success
    ).toBe(true);
    expect(
      ProfileUpdateSchema.safeParse({ ...baseProfile, homePhone: '91234567' })
        .success
    ).toBe(true);
  });

  it('rejects a phone number containing letters or spaces', () => {
    expect(
      ProfileUpdateSchema.safeParse({
        ...baseProfile,
        homePhone: '9123 4567',
      }).success
    ).toBe(false);
    expect(
      ProfileUpdateSchema.safeParse({ ...baseProfile, homePhone: 'call-me' })
        .success
    ).toBe(false);
  });
});

describe('FatherUpdateSchema — email', () => {
  it('accepts a valid email', () => {
    expect(
      FatherUpdateSchema.safeParse({
        ...baseFather,
        fatherEmail: 'dad@example.com',
      }).success
    ).toBe(true);
  });

  it('rejects a malformed email', () => {
    expect(
      FatherUpdateSchema.safeParse({
        ...baseFather,
        fatherEmail: 'not-an-email',
      }).success
    ).toBe(false);
  });
});

describe('ProfileUpdateSchema — postal code', () => {
  it('accepts digits only', () => {
    expect(
      ProfileUpdateSchema.safeParse({ ...baseProfile, postalCode: '520123' })
        .success
    ).toBe(true);
  });

  it('rejects letters', () => {
    expect(
      ProfileUpdateSchema.safeParse({ ...baseProfile, postalCode: 'ABC123' })
        .success
    ).toBe(false);
  });
});

describe('ProfileUpdateSchema — nationality', () => {
  it('accepts a known country name', () => {
    expect(
      ProfileUpdateSchema.safeParse({
        ...baseProfile,
        nationality: 'Philippines',
      }).success
    ).toBe(true);
  });

  it('rejects an arbitrary string that is not a country name', () => {
    expect(
      ProfileUpdateSchema.safeParse({
        ...baseProfile,
        nationality: 'Filipino',
      }).success
    ).toBe(false);
  });

  it('accepts blank (clears to null)', () => {
    const r = ProfileUpdateSchema.safeParse({
      ...baseProfile,
      nationality: '',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nationality).toBeNull();
  });
});

describe('FatherUpdateSchema — nationality', () => {
  it('accepts a known country name', () => {
    expect(
      FatherUpdateSchema.safeParse({
        ...baseFather,
        fatherNationality: 'Singapore',
      }).success
    ).toBe(true);
  });

  it('rejects an arbitrary string', () => {
    expect(
      FatherUpdateSchema.safeParse({ ...baseFather, fatherNationality: 'xyz' })
        .success
    ).toBe(false);
  });
});
```

**Note (found during implementation):** `ProfileUpdateSchema`/`FatherUpdateSchema`/`MotherUpdateSchema`/`GuardianUpdateSchema` have a pre-existing property, unrelated to this task: every field is `.nullable()` but (with the sole exception of `category`) never `.optional()`, so `.safeParse()` requires every key to be present in the payload — this is by design, matching how the real edit-sheet UI always submits a complete form object (`buildDefaults()` fills every missing key with `null`), never a genuine partial patch. The test code above accounts for this via the `baseProfile`/`baseFather` spread. Do not "fix" this by adding `.optional()` to the schemas — that would be an unrelated, unauthorized change to their required-field contract.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/schemas/sis-profile-validation.test.ts`
Expected: FAIL — every "rejects" case currently passes (the old schema accepts anything up to the length cap), so those assertions fail.

- [ ] **Step 3: Implement — new helpers**

In `lib/schemas/sis.ts`, add the import at the top of the file:

```ts
import { COUNTRY_NAME_SET } from '@/lib/data/countries';
```

Add these helpers in the "Helpers" section, after `optionalNumberOrText`:

```ts
// NRIC / FIN — adopted verbatim from the admissions portal's own schema.
const optionalNric = z
  .string()
  .trim()
  .max(40)
  .transform((s) => (s.length === 0 ? null : s))
  .refine((s) => s === null || /^[STFGM]\d{7}[A-Z]$/.test(s), {
    message: 'Enter a valid NRIC/FIN (e.g. S1234567A)',
  })
  .nullable();

// Phone numbers — adopted verbatim from the admissions portal's own
// schema. Digits only, optional leading +.
const optionalPhone = z
  .string()
  .trim()
  .max(60)
  .transform((s) => (s.length === 0 ? null : s))
  .refine((s) => s === null || /^\+?\d+$/.test(s), {
    message: 'Enter digits only, with an optional leading +',
  })
  .nullable();

// Postal code — digits only. No extra length bound beyond the existing
// 60-char ceiling (a Singapore 6-digit code isn't hard-coded — legacy or
// overseas addresses may be on file).
const optionalPostalCode = z
  .string()
  .trim()
  .max(60)
  .transform((s) => (s.length === 0 ? null : s))
  .refine((s) => s === null || /^\d+$/.test(s), {
    message: 'Enter digits only',
  })
  .nullable();

// Nationality — constrained to the canonical country-name list (see
// lib/data/countries.ts). Stores the country NAME, matching the admissions
// portal's LocationSelector. A pre-existing off-list DB value is untouched
// by this refine — it only rejects a NEW write of an off-list string; the
// combobox UI (CountryCombobox) is the only write path once this ships, and
// it either emits a canonical name or leaves an off-list value unchanged.
const optionalNationality = z
  .string()
  .trim()
  .max(80)
  .transform((s) => (s.length === 0 ? null : s))
  .refine((s) => s === null || COUNTRY_NAME_SET.has(s), {
    message: 'Select a country from the list',
  })
  .nullable();
```

- [ ] **Step 4: Implement — swap `optionalEmail`'s predicate**

Change:

```ts
const optionalEmail = z
  .string()
  .trim()
  .transform((s) => (s.length === 0 ? null : s))
  .refine((s) => s === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s), {
    message: 'Enter a valid email',
  })
  .nullable();
```

to:

```ts
const optionalEmail = z
  .string()
  .trim()
  .transform((s) => (s.length === 0 ? null : s))
  .refine((s) => s === null || z.string().email().safeParse(s).success, {
    message: 'Enter a valid email',
  })
  .nullable();
```

- [ ] **Step 5: Implement — apply the new helpers to the 4 schemas**

In `ProfileUpdateSchema`, change:

```ts
nric: optionalText(40),
```

to:

```ts
nric: optionalNric,
```

```ts
nationality: optionalText(80),
```

to:

```ts
nationality: optionalNationality,
```

```ts
homePhone: optionalNumberOrText,
```

to:

```ts
homePhone: optionalPhone,
```

```ts
postalCode: optionalNumberOrText,
```

to:

```ts
postalCode: optionalPostalCode,
```

```ts
contactPersonNumber: optionalNumberOrText,
```

to:

```ts
contactPersonNumber: optionalPhone,
```

```ts
referrerMobile: optionalNumberOrText,
```

to:

```ts
referrerMobile: optionalPhone,
```

In `FatherUpdateSchema`, change:

```ts
fatherNric: optionalText(40),
```

to:

```ts
fatherNric: optionalNric,
```

```ts
fatherMobile: optionalNumberOrText,
```

to:

```ts
fatherMobile: optionalPhone,
```

```ts
fatherNationality: optionalText(80),
```

to:

```ts
fatherNationality: optionalNationality,
```

In `MotherUpdateSchema`, change:

```ts
motherNric: optionalText(40),
```

to:

```ts
motherNric: optionalNric,
```

```ts
motherMobile: optionalNumberOrText,
```

to:

```ts
motherMobile: optionalPhone,
```

```ts
motherNationality: optionalText(80),
```

to:

```ts
motherNationality: optionalNationality,
```

In `GuardianUpdateSchema`, change:

```ts
guardianNric: optionalText(40),
```

to:

```ts
guardianNric: optionalNric,
```

```ts
guardianMobile: optionalNumberOrText,
```

to:

```ts
guardianMobile: optionalPhone,
```

```ts
guardianNationality: optionalText(80),
```

to:

```ts
guardianNationality: optionalNationality,
```

Leave every other field in all 4 schemas untouched — in particular, `passportNumber`/`pass`/`fatherPassport`/`fatherPass`/etc. stay `optionalText(...)` (format validation for these is the explicitly out-of-scope open item), and `optionalNumberOrText` itself stays defined and in use for non-phone fields.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- __tests__/schemas/sis-profile-validation.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS, 0 failures. This confirms no other test file's fixtures relied on the old loose validation (e.g. a seeder-fed fixture with a non-canonical nationality string or a malformed phone number passed into one of these 4 schemas).

If any pre-existing test fails here, that test's fixture data needs a real value substituted (e.g. a fixture nationality of `'Filipino'` → `'Philippines'`) — do not loosen the new validation to make a fixture pass.

- [ ] **Step 8: Compile check**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 9: Commit**

```bash
git add lib/schemas/sis.ts __tests__/schemas/sis-profile-validation.test.ts
git commit -m "feat: validate NRIC, phone, email, postal code, and nationality formats"
```

---

### Task 7: `FieldGrid` sensitive-field masking

**Files:**

- Modify: `components/sis/field-grid.tsx`
- Test: `__tests__/ui/field-grid-sensitive.test.tsx`

**Interfaces:**

- Produces: `Field.sensitive?: boolean` — consumed by Task 8 (`profile-tab.tsx` / `family-tab.tsx`).

- [ ] **Step 1: Write the failing test**

Create `__tests__/ui/field-grid-sensitive.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FieldGrid } from '@/components/sis/field-grid';

describe('FieldGrid — sensitive fields', () => {
  it('masks a sensitive field by default', () => {
    render(
      <FieldGrid
        fields={[{ label: 'Passport', value: 'E1234567', sensitive: true }]}
      />
    );
    expect(screen.queryByText('E1234567')).not.toBeInTheDocument();
    expect(screen.getByText('••••••••')).toBeInTheDocument();
  });

  it('reveals the value when its toggle is clicked, without affecting other rows', async () => {
    const user = userEvent.setup();
    render(
      <FieldGrid
        fields={[
          { label: 'Passport', value: 'E1234567', sensitive: true },
          { label: 'Pass type', value: 'STP', sensitive: true },
        ]}
      />
    );

    const toggles = screen.getAllByRole('button', { name: /show/i });
    await user.click(toggles[0]);

    expect(screen.getByText('E1234567')).toBeInTheDocument();
    expect(screen.queryByText('STP')).not.toBeInTheDocument();
  });

  it('does not mask a non-sensitive field', () => {
    render(<FieldGrid fields={[{ label: 'First name', value: 'Grace' }]} />);
    expect(screen.getByText('Grace')).toBeInTheDocument();
  });

  it('shows the plain empty placeholder for an empty sensitive field, unmasked', () => {
    render(
      <FieldGrid
        fields={[{ label: 'Passport', value: null, sensitive: true }]}
      />
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('••••••••')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /show/i })
    ).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/ui/field-grid-sensitive.test.tsx`
Expected: FAIL — `sensitive` is not a recognized `Field` prop and nothing masks yet.

- [ ] **Step 3: Implement**

In `components/sis/field-grid.tsx`:

Add `'use client';` as the first line of the file (before the existing `import * as React from 'react';`), and add the `Eye`/`EyeOff` import:

```ts
'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { cn } from '@/lib/utils';
```

Add `sensitive` to the `Field` type:

```ts
export type Field = {
  label: string;
  value: FieldValue;
  asDate?: boolean;
  multiline?: boolean;
  wide?: boolean;
  // Mask the rendered value behind a reveal toggle (passport/pass numbers).
  sensitive?: boolean;
};
```

Add the mask constant near `EMPTY_PLACEHOLDER`:

```ts
const MASK_PLACEHOLDER = '••••••••';
```

Replace the `FieldGrid` function body to add per-row reveal state and branch the `dd` rendering:

```tsx
export function FieldGrid({
  fields,
  dimEmpty = false,
}: {
  fields: Field[];
  dimEmpty?: boolean;
}) {
  const [revealed, setRevealed] = React.useState<Set<string>>(new Set());
  const visible = fields;
  if (visible.length === 0) {
    return <p className="text-sm text-muted-foreground">{EMPTY_PLACEHOLDER}</p>;
  }

  function toggleRevealed(key: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      {visible.map((f, i) => {
        const key = `${f.label}-${i}`;
        const empty =
          !f.asDate && typeof f.value !== 'boolean' && isEmpty(f.value);
        const dim = dimEmpty && empty;
        const isMasked = Boolean(f.sensitive) && !empty;
        const isRevealed = revealed.has(key);
        return (
          <div
            key={key}
            className={cn('min-w-0 space-y-0.5', f.wide && 'sm:col-span-2')}
          >
            <dt
              className={cn(
                'font-mono text-[10px] font-semibold uppercase tracking-[0.12em]',
                dim ? 'text-muted-foreground/60' : 'text-muted-foreground'
              )}
            >
              {f.label}
            </dt>
            <dd
              className={cn(
                'break-words text-sm leading-relaxed',
                dim
                  ? 'text-muted-foreground/60'
                  : empty
                    ? 'text-muted-foreground'
                    : 'text-foreground',
                f.multiline && 'whitespace-pre-line',
                isMasked && 'flex items-center gap-1.5'
              )}
            >
              {isMasked ? (
                <>
                  <span>{isRevealed ? renderValue(f) : MASK_PLACEHOLDER}</span>
                  <button
                    type="button"
                    onClick={() => toggleRevealed(key)}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={
                      isRevealed ? `Hide ${f.label}` : `Show ${f.label}`
                    }
                  >
                    {isRevealed ? (
                      <EyeOff className="size-3.5" />
                    ) : (
                      <Eye className="size-3.5" />
                    )}
                  </button>
                </>
              ) : (
                renderValue(f)
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
```

`FieldSectionsCard` (below `FieldGrid` in the same file) is unchanged — it already just renders `<FieldGrid fields={s.fields} />` and passes `sensitive` through untouched since it's part of the `Field` object.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- __tests__/ui/field-grid-sensitive.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — `FieldGrid` is consumed elsewhere (any other tab besides Profile/Family that renders non-sensitive fields); the `'use client'` addition and the new optional prop must not change output for existing non-sensitive callers.

- [ ] **Step 6: Compile check**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 7: Commit**

```bash
git add components/sis/field-grid.tsx __tests__/ui/field-grid-sensitive.test.tsx
git commit -m "feat: add sensitive-field masking to FieldGrid"
```

---

### Task 8: Mark passport/pass fields sensitive on the view tabs

**Files:**

- Modify: `components/sis/profile-tab.tsx`
- Modify: `components/sis/family-tab.tsx`

**Interfaces:**

- Consumes: `Field.sensitive` (Task 7).

This task is pure data wiring — no new logic, so no new test file. Correctness is covered by Task 7's `FieldGrid` tests (which prove the `sensitive` prop masks/reveals correctly) plus the manual browser check in Step 3 below.

- [ ] **Step 1: Update `profile-tab.tsx`**

In `components/sis/profile-tab.tsx`, change the `travelFields` array:

```ts
const travelFields: Field[] = [
  { label: 'Passport number', value: app.passportNumber },
  { label: 'Passport expiry', value: app.passportExpiry, asDate: true },
  { label: 'Pass type', value: app.pass },
  { label: 'Pass expiry', value: app.passExpiry, asDate: true },
];
```

to:

```ts
const travelFields: Field[] = [
  { label: 'Passport number', value: app.passportNumber, sensitive: true },
  { label: 'Passport expiry', value: app.passportExpiry, asDate: true },
  { label: 'Pass type', value: app.pass, sensitive: true },
  { label: 'Pass expiry', value: app.passExpiry, asDate: true },
];
```

- [ ] **Step 2: Update `family-tab.tsx`**

In `components/sis/family-tab.tsx`, there are 3 near-identical blocks (father / mother / guardian). In each, change the `Passport` and `Pass type` field entries to add `sensitive: true`.

Father block — change:

```ts
{ label: 'Passport', value: app.fatherPassport },
{
  label: 'Passport expiry',
  value: app.fatherPassportExpiry,
  asDate: true,
},
{ label: 'Pass type', value: app.fatherPass },
```

to:

```ts
{ label: 'Passport', value: app.fatherPassport, sensitive: true },
{
  label: 'Passport expiry',
  value: app.fatherPassportExpiry,
  asDate: true,
},
{ label: 'Pass type', value: app.fatherPass, sensitive: true },
```

Mother block — change:

```ts
{ label: 'Passport', value: app.motherPassport },
{
  label: 'Passport expiry',
  value: app.motherPassportExpiry,
  asDate: true,
},
{ label: 'Pass type', value: app.motherPass },
```

to:

```ts
{ label: 'Passport', value: app.motherPassport, sensitive: true },
{
  label: 'Passport expiry',
  value: app.motherPassportExpiry,
  asDate: true,
},
{ label: 'Pass type', value: app.motherPass, sensitive: true },
```

Guardian block — change:

```ts
{ label: 'Passport', value: app.guardianPassport },
{
  label: 'Passport expiry',
  value: app.guardianPassportExpiry,
  asDate: true,
},
{ label: 'Pass type', value: app.guardianPass },
```

to:

```ts
{ label: 'Passport', value: app.guardianPassport, sensitive: true },
{
  label: 'Passport expiry',
  value: app.guardianPassportExpiry,
  asDate: true,
},
{ label: 'Pass type', value: app.guardianPass, sensitive: true },
```

- [ ] **Step 3: Manual browser check**

Run `npm run dev`, sign in as a `registrar`/`academic_coordinator`/`school_admin` role, open a student with a populated passport number in Admissions or Records:

- On the Profile tab's "Student passport & pass" card: Passport number and Pass type render as `••••••••` with an eye icon; clicking it reveals the real value; expiries render as plain dates (unmasked) the whole time.
- On the Family tab, repeat for at least one parent slot (father/mother/guardian) that has a passport number on file.
- Open "Edit profile": Passport number and Pass type fields render masked (`type="password"`) with the same reveal icon; Nationality renders as a searchable combobox pre-filled with the student's current nationality.
- Open "Edit" on a parent card: same checks for that parent's Nationality/Passport/Pass fields.
- Try saving the edit sheet with no changes — confirm it still saves cleanly (validates that the new schema rules don't reject the pre-filled/unmodified values).

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS, 0 failures.

- [ ] **Step 5: Compile check**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 6: Commit**

```bash
git add components/sis/profile-tab.tsx components/sis/family-tab.tsx
git commit -m "feat: mask passport/pass numbers on the profile and family view tabs"
```

---

## Post-implementation note

The **passport/pass number format** open item from the design spec is not part of this plan. When the portal's exact regex is available, it's a small follow-up: add `optionalPassportNumber`/`optionalPassNumber` helpers to `lib/schemas/sis.ts` (same shape as Task 6's helpers) and apply them to the 8 fields that Task 6 deliberately left as `optionalText(...)`. No UI change needed for that follow-up — `SensitiveInput` already accepts and displays any string value regardless of format.
