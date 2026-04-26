# Sonner → Sileo Shim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `sonner` toast library with `sileo` while leaving every existing `toast.X(...)` call site (~154 calls across 55 files) and the `<Toaster />` mount in `app/layout.tsx` mechanically untouched.

**Architecture:** Rewire the `'sonner'` module specifier via `tsconfig.json` `compilerOptions.paths` to resolve to a local file (`components/ui/sonner.tsx`). That file is rewritten as a sonner-shaped facade — preserves the `toast` and `Toaster` public surface — that delegates internally to `sileo`. Result: zero call-site touches, swap reversible by editing one tsconfig line.

**Tech Stack:** Next.js 16 (App Router, Turbopack), TypeScript (strict, `moduleResolution: "bundler"`), `sileo` (replacing `sonner`).

**Spec:** `docs/superpowers/specs/2026-04-26-sonner-to-sileo-shim-design.md`

---

## File Structure

| File | Role | Change |
|---|---|---|
| `package.json` + `package-lock.json` | dependency manifest | uninstall `sonner`, install `sileo` |
| `tsconfig.json` | TS path resolution | +1 entry under `compilerOptions.paths` redirecting `'sonner'` → `./components/ui/sonner.tsx` |
| `components/ui/sonner.tsx` | sonner-shaped facade | full rewrite — imports from `'sileo'`, re-exports `Toaster` + `toast` + `ToasterProps` with sonner-compatible signatures |
| `app/layout.tsx` | not touched | `<Toaster position="top-right" richColors closeButton />` continues to work; wrapper discards sonner-only props |
| 55 call-site files | not touched | `import { toast } from 'sonner'` continues to resolve, now to the local shim |

---

## Tasks

### Task 1: Swap the dependency

**Files:**
- Modify: `package.json`, `package-lock.json` (auto-managed by npm)

- [ ] **Step 1: Uninstall sonner**

Run: `npm uninstall sonner`
Expected: removes `sonner` from `dependencies` in `package.json`; lockfile updates; no errors.

- [ ] **Step 2: Install sileo**

Run: `npm install sileo`
Expected: adds `sileo` to `dependencies` in `package.json`; lockfile updates.

**If the install fails** (package not found / 404 / unpublished):
- Stop here. Do not proceed.
- Report to user: "`sileo` is not resolvable on the npm registry under that name. The swap cannot proceed as specified."
- Roll back: `npm install sonner` to restore the previous state.
- Wait for direction (different package name, scoped package, GitHub install URL, or fallback plan).

- [ ] **Step 3: Verify package.json reflects the swap**

Use Read on `package.json` and confirm:
- `dependencies` no longer contains `"sonner"`.
- `dependencies` now contains `"sileo"` with a version range.

- [ ] **Step 4: Do not commit yet**

The codebase is currently broken — every `import { toast } from 'sonner'` will fail to resolve because the package is gone and the path alias isn't in place yet. Build will not pass. Defer the commit until Task 5.

---

### Task 2: Add the tsconfig path alias

**Files:**
- Modify: `tsconfig.json`

- [ ] **Step 1: Read current tsconfig.json**

Use Read on `tsconfig.json`. Confirm `compilerOptions.paths` currently contains exactly:

```json
"paths": {
  "@/*": ["./*"]
}
```

- [ ] **Step 2: Add the sonner alias**

Use Edit to change:

```json
    "paths": {
      "@/*": ["./*"]
    }
```

to:

```json
    "paths": {
      "@/*": ["./*"],
      "sonner": ["./components/ui/sonner.tsx"]
    }
```

- [ ] **Step 3: Verify the edit**

Use Read on `tsconfig.json` and confirm both entries exist under `paths` and the JSON is still valid (trailing commas, brace balance).

The codebase is still broken at this point — the file at `./components/ui/sonner.tsx` still has its old contents, which import `Toaster as Sonner` from `'sonner'` (now self-referential through the alias and missing from node_modules). Task 3 fixes this.

---

### Task 3: Rewrite components/ui/sonner.tsx as the shim

**Files:**
- Modify: `components/ui/sonner.tsx` (full rewrite)

- [ ] **Step 1: Read the current file**

Use Read on `components/ui/sonner.tsx` to confirm the current contents (sonner-themed wrapper, ~57 lines) before overwriting.

- [ ] **Step 2: Write the shim**

Use Write to replace the entire file contents with:

```tsx
'use client';

import * as React from 'react';
import { sileo, Toaster as SileoToaster } from 'sileo';

type SileoToasterProps = React.ComponentProps<typeof SileoToaster>;

type LegacySonnerProps = {
  richColors?: boolean;
  closeButton?: boolean;
  theme?: string;
};

export type ToasterProps = SileoToasterProps & LegacySonnerProps;

export function Toaster(props: ToasterProps) {
  const { richColors: _r, closeButton: _c, theme: _t, ...sileoProps } = props;
  return <SileoToaster {...sileoProps} />;
}

type ToastOpts = { description?: string };

function show(kind: 'success' | 'error' | 'warning' | 'info') {
  return (title: string, opts?: ToastOpts) =>
    sileo[kind]({ title, ...(opts ?? {}) });
}

type SonnerPromiseMessages<T> = {
  loading: string | { title: string };
  success: string | ((data: T) => string) | { title: string };
  error: string | ((err: unknown) => string) | { title: string };
};

function normalize<T>(
  value: SonnerPromiseMessages<T>['success'],
  arg?: T,
): { title: string } {
  if (typeof value === 'string') return { title: value };
  if (typeof value === 'function')
    return { title: String((value as (a: T) => string)(arg as T)) };
  return value;
}

export const toast = {
  success: show('success'),
  error: show('error'),
  warning: show('warning'),
  info: show('info'),
  promise<T>(p: Promise<T>, msgs: SonnerPromiseMessages<T>) {
    return sileo.promise(p, {
      loading: normalize(msgs.loading),
      success: normalize(msgs.success),
      error: normalize(msgs.error),
    });
  },
  // Stubs — zero call sites today; preserved so a future call doesn't crash the build.
  dismiss: (_?: unknown) => {},
  loading: (_title?: string, _opts?: ToastOpts) => {},
  custom: (_node: React.ReactNode) => {},
  message: (_title: string, _opts?: ToastOpts) => {},
};
```

- [ ] **Step 3: Verify the file**

Use Read on `components/ui/sonner.tsx` and confirm:
- First import line is `import * as React from 'react';`.
- Second import line is `import { sileo, Toaster as SileoToaster } from 'sileo';`.
- `export const toast` exists with `success / error / warning / info / promise / dismiss / loading / custom / message` keys.
- `export function Toaster` and `export type ToasterProps` exist.
- File has `'use client';` directive on line 1.

---

### Task 4: Verify type-check + build

**Files:**
- None modified — verification only.

- [ ] **Step 1: TypeScript compile**

Run: `npx tsc --noEmit`
Expected: no errors. Type errors here typically mean either (a) the `sileo` package's actual types don't match the docs the user pasted (the shim signatures need adjustment), or (b) some call site passes a shape the shim doesn't accept (e.g. `toast.success({ title: 'x' })` instead of `toast.success('x')` — none expected per grep, but possible).

If errors appear:
- Read the exact error.
- If it's about a call-site shape the shim doesn't cover, widen the shim signatures (do NOT modify the call site — Task 4 is verification, not call-site changes).
- If it's about `sileo`'s real exports differing from docs, adjust the shim's import line and the delegated calls accordingly.

- [ ] **Step 2: Next.js production build**

Run: `npx next build`
Expected: build completes with `Compiled successfully` and no errors. Warnings are acceptable.

If the build fails, read the exact error. Common causes and fixes:
- "Module not found: 'sonner'" → tsconfig alias not honored. Verify `tsconfig.json` was saved with the new entry. Restart any cached dev process.
- "Cannot find module 'sileo'" inside `components/ui/sonner.tsx` → `npm install sileo` did not complete. Re-run Task 1 Step 2.
- Type error in the shim → the package's real types differ from the docs. Read `node_modules/sileo/dist/index.d.ts` (or wherever its types live) and adjust the shim.

- [ ] **Step 3: Confirm clean build output**

Verify the build output ends with a successful summary (route table) and exits with code 0. Do not proceed past this step if the build is not clean.

---

### Task 5: Commit the swap

**Files:**
- Stage: `package.json`, `package-lock.json`, `tsconfig.json`, `components/ui/sonner.tsx`

- [ ] **Step 1: Inspect what's about to be committed**

Run: `git status`
Expected: 4 modified files (above). No untracked files related to this work. (`.claude/settings.local.json` may show as modified from earlier session state — leave it unstaged.)

Run: `git diff --stat`
Expected: small diff on `tsconfig.json` (+1 line), small diff on `package.json` (-1 +1 lines), larger lockfile diff (auto), full rewrite on `components/ui/sonner.tsx`.

- [ ] **Step 2: Stage exactly the four files**

Run: `git add package.json package-lock.json tsconfig.json components/ui/sonner.tsx`
Do NOT use `git add -A` or `git add .`.

- [ ] **Step 3: Commit**

Run:

```bash
git commit -m "$(cat <<'EOF'
chore(toast): swap sonner -> sileo via path-alias shim

Rewires the 'sonner' module specifier in tsconfig.json to resolve
to components/ui/sonner.tsx, which is rewritten as a sonner-shaped
facade over sileo. Zero call-site changes across the 55 files that
import { toast } from 'sonner'.

Accepted regressions per spec: no closeButton, no richColors, no
Aurora Vault tokens reach into the toast (sileo styles itself).

Spec: docs/superpowers/specs/2026-04-26-sonner-to-sileo-shim-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

Expected: commit lands cleanly, no pre-commit hook failures.

- [ ] **Step 4: Verify the commit**

Run: `git log -1 --stat`
Expected: shows the four files with the diff stats from Step 1.

---

### Task 6: Browser smoke test (manual)

**Files:**
- None modified — runtime verification only.

This task is **manual and user-driven**. The dev server must be started and the tester must trigger real toasts. The agent cannot complete this task autonomously.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (or whichever `dev` script the repo uses — check `package.json` scripts).
Expected: dev server boots; ready URL printed (typically `http://localhost:3000`).

- [ ] **Step 2: Trigger a simple success toast**

Navigate to any page that calls `toast.success` on a save. The grade-sheets / accounts / publish flows are all candidates. Trigger the success path.
Expected: a toast appears in the top-right corner, auto-dismisses after sileo's default duration. Visual style is sileo's default rendering (gooey morph + spring physics per the docs you have).

- [ ] **Step 3: Trigger a simple error toast**

Find a flow that errors visibly — e.g. submitting an invalid form, or a request the backend rejects.
Expected: an error-styled toast appears top-right.

- [ ] **Step 4: Trigger the description shape**

Navigate to `/account/change-password`. Fill the form with a valid password and submit (or whichever path triggers `toast.success('Password updated', { description: '...' })`).
Expected: a success toast appears with both a title ("Password updated") and a description (the additional message text from `change-password-form.tsx:40`).

- [ ] **Step 5: Visual sanity**

- Stack: trigger 3+ toasts in quick succession. Confirm they stack rather than overlap unreadably.
- Auto-dismiss: confirm toasts disappear on their own without intervention (no `closeButton` is expected).
- Position: confirm top-right anchoring (passed via `position="top-right"` from `app/layout.tsx`).

- [ ] **Step 6: Stop the dev server and report results**

Stop the dev server (Ctrl-C).

If all four scenarios rendered correctly, the swap is complete.

If any scenario was broken (no toast appeared, console errors, runtime crash):
- Capture the browser console output and any server-side error.
- Report the symptom + which call-site path was tested.
- Do not attempt to fix in this task — open a follow-up task with the diagnosis.

---

## Self-Review Checklist (run before handing off to executor)

- [ ] Spec §3.1 (tsconfig path alias) → Task 2 ✓
- [ ] Spec §3.2 (shim implementation) → Task 3 ✓
- [ ] Spec §3.3 (npm uninstall/install) → Task 1 ✓
- [ ] Spec §6 (verification: build + 3 browser smoke tests) → Tasks 4 + 6 ✓
- [ ] No placeholders, TBDs, "implement later" — verified
- [ ] Each task has exact file paths, exact commands, exact expected output — verified
- [ ] Commit step uses HEREDOC for clean formatting — verified
- [ ] Risk handling for `sileo` not on npm — Task 1 Step 2 has explicit rollback path ✓
- [ ] Risk handling for tsconfig alias not honored at runtime — Task 4 Step 2 has diagnosis path ✓
