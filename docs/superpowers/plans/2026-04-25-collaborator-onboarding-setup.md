# Collaborator onboarding setup — implementation plan

> **Status:** Planned. Not yet executed. Run when the first external collaborator is about to start (roadmap: post-Sprint-21).
>
> **To trigger execution:** "Execute the collaborator-onboarding plan at `docs/superpowers/plans/2026-04-25-collaborator-onboarding-setup.md`."

## Goal

Make the codebase safe to accept PRs from collaborators who don't have the author's full mental model. Tools catch the dumb stuff (formatting, dead code, new lint errors) so review time focuses on design and correctness.

## What to add — and why each

Four additions, in install order:

1. **Prettier** — kills whitespace/formatting debate on PRs. Zero-config pre-commit formatter. Biggest ROI for lowest cost.
2. **husky + lint-staged** — runs lint + Prettier on staged files at pre-commit. Blocks bad code at the author's machine; PRs arrive clean.
3. **GitHub Actions CI** — `lint + build + fallow audit` on every PR. Last-line defense that can't be bypassed.
4. **`CONTRIBUTING.md`** — one short file pointing at existing docs (`CLAUDE.md`, `.claude/rules/*`, sprint plan). Not a reinvention.

### What we deliberately do NOT add

- **`eslint-config-airbnb`** — 2018 config, pre-flat-config, unaware of React Compiler rules, would produce ~2000 violations on first run that mean nothing. If stronger lint is wanted, use `@antfu/eslint-config` (modern, flat-config-native) or add the 3-4 specific rules we care about directly.
- **Husky v9 default behavior** that runs shell scripts in `.husky/` — use the simpler flat install.

## Project-specific context the plan must respect

- **Tech stack** (don't break): Next.js 16, React 19, ESLint 9 flat config (`eslint.config.js` exists at root), React Compiler plugin (`react-hooks/purity`, `react-hooks/static-components`), TypeScript strict.
- **Hard Rule #7**: `app/globals.css` is the only token source. No hardcoded colors. Prettier won't touch this, but contributors need to know.
- **KD #44**: Canonical `DatePicker` / `DateTimePicker`. Native `<input type="date">` banned.
- **Hard rules in `.claude/rules/hard-rules.md`**: seven rules that never ship broken. CONTRIBUTING.md must link to it.
- **Fallow baselines** already live at `fallow-baselines/*.json`. CI audit step should reference them.
- **Package manager**: npm (`package-lock.json` present). Not pnpm/yarn/bun.

## Execution order

### Step 1: Install Prettier

```bash
npm install --save-dev prettier eslint-config-prettier
```

Create `.prettierrc.json`:

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "bracketSameLine": false,
  "arrowParens": "always"
}
```

Create `.prettierignore`:

```
.next
node_modules
.fallow
fallow-baselines
public
*.generated.ts
supabase/migrations
```

Add scripts to `package.json`:

```json
{
  "scripts": {
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  }
}
```

**One-time project-wide format** (creates one giant diff, isolate it in its own commit):

```bash
npx prettier --write .
git add .
git commit -m "chore: format codebase with prettier"
```

Then add `eslint-config-prettier` to `eslint.config.js` as the LAST item in the config array so Prettier wins formatting conflicts with ESLint.

### Step 2: husky + lint-staged pre-commit hook

```bash
npm install --save-dev husky lint-staged
npx husky init
```

Replace `.husky/pre-commit` contents with:

```
npx lint-staged
```

Add to `package.json`:

```json
{
  "lint-staged": {
    "*.{ts,tsx,js,jsx}": [
      "eslint --fix",
      "prettier --write"
    ],
    "*.{json,md,css}": [
      "prettier --write"
    ]
  }
}
```

Test it:

```bash
git add <any file>
git commit -m "test: verify pre-commit hook"  # should run lint + prettier on staged files
```

**Important**: `git commit --no-verify` bypasses this — tell collaborators it's forbidden except for emergency hotfixes. CI is the backstop.

### Step 3: GitHub Actions CI

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # fallow audit needs history for --base main

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: Format check
        run: npm run format:check

      - name: Lint
        run: npm run lint

      - name: Type check
        run: npx tsc --noEmit

      - name: Build
        run: npm run build
        env:
          # Placeholder env vars for build-time type checking.
          # Prod secrets live in Vercel; these are just to keep build happy.
          NEXT_PUBLIC_SUPABASE_URL: https://placeholder.supabase.co
          NEXT_PUBLIC_SUPABASE_ANON_KEY: placeholder
          SUPABASE_SERVICE_KEY: placeholder
          NEXT_PUBLIC_PARENT_PORTAL_URL: https://placeholder

      - name: Fallow audit (PR only)
        if: github.event_name == 'pull_request'
        run: |
          npx fallow audit \
            --base ${{ github.base_ref }} \
            --dead-code-baseline fallow-baselines/dead-code.json \
            --health-baseline fallow-baselines/health.json \
            --dupes-baseline fallow-baselines/dupes.json \
            --format annotations
```

**Important**:
- The `Build` step's placeholder env vars keep the Next.js build happy at compile time. Real Supabase calls only happen at runtime; compile-time only needs the strings to exist.
- The fallow audit uses `--format annotations` which creates inline PR comments — collaborators see the issue exactly where they made it, no separate UI to check.
- Branch protection (GitHub → Settings → Branches → main) must require `verify` to pass before merge. Do this after the first successful CI run.

### Step 4: CONTRIBUTING.md

Create `CONTRIBUTING.md` at repo root:

```markdown
# Contributing to HFSE SIS

Thanks for contributing. This repo has accumulated context over many sprints — below is the tight path to being productive. Skim it once, bookmark it.

## Before your first PR

1. **Read `CLAUDE.md`.** It's the project's living contract — tech stack, roles, hard rules. Don't skip it.
2. **Read `.claude/rules/hard-rules.md`.** Seven rules that never ship broken. If your change might touch any of them, read the relevant context doc in `docs/context/` first.
3. **Skim `docs/sprints/development-plan.md`.** Status snapshot at the top tells you what's shipped, what's in-flight, what's deferred.

## Setup

```bash
npm install
cp .env.local.example .env.local  # fill in actual values from 1Password / your onboarder
npm run dev
```

## Making a change

1. Branch off `main`. Name: `feat/<short>`, `fix/<short>`, `chore/<short>`.
2. Write code. Follow the patterns in adjacent files — consistency beats cleverness here.
3. **`npm run lint` and `npm run build` must pass locally.** CI enforces this.
4. Pre-commit hook will auto-format + lint-fix staged files. Don't use `--no-verify`.
5. Commit in the Conventional Commits style — see `git log --oneline -20` for examples.
6. Push, open PR against `main`. CI runs lint + build + type check + fallow audit.

## What the tools do

- **ESLint** — catches bugs, enforces React Compiler rules (purity, static components).
- **Prettier** — formatting. Runs automatically on save via editor + pre-commit.
- **TypeScript** — strict mode. `any` requires a comment explaining why.
- **Fallow** — drift detector. Only fails CI if your PR *introduces* new dead code / complexity beyond the saved baselines in `fallow-baselines/`.

## Where to find things

| Question | File |
|---|---|
| What's the grading formula? | `docs/context/02-grading-system.md` + `lib/compute/quarterly.ts` |
| How do roles work? | `docs/context/03-workflow-and-roles.md` + `lib/auth/roles.ts` |
| Database schema? | `docs/context/04-database-schema.md` + `supabase/migrations/` |
| Design tokens? | `docs/context/09-design-system.md` + `app/globals.css` |
| Which API routes exist? | `docs/context/07-api-routes.md` |
| Module-specific stuff? | `docs/context/{12-p-files, 13-sis, 15-markbook, 16-attendance, 19-evaluation}-module.md` |
| Dashboard patterns? | `docs/context/20-dashboards.md` |

## Things that will get flagged in review

- Hardcoded colors outside `app/globals.css` (Hard Rule #7)
- Native `<input type="date">` instead of `<DatePicker>` (KD #44)
- `getUser()` in server components instead of `getSessionUser()` (perf-patterns §1)
- Client-side grade computation (Hard Rule #2 — it's always server-side)
- New API route without `requireRole()` at the top
- `revalidateTag()` missing a second arg in Next.js 16 (it deprecated the single-arg form)

## Escape hatches (use sparingly)

- `// fallow-ignore-next-line <rule>` — one-line suppression with a reason in comment
- `// eslint-disable-next-line <rule>` — same pattern
- `// @ts-expect-error <reason>` — only with a real reason

No `// @ts-ignore` without a ticket number pointing at the real fix.

## When stuck

- Existing patterns first — `grep` for a similar feature and copy the shape.
- `docs/context/` has 20+ topic docs. One probably covers your question.
- Still stuck — ask in the shared channel, don't guess at conventions.
```

### Step 5: Verify end-to-end

1. Create a throwaway branch, make a bad commit (add trailing whitespace, add an unused import), push:
   - Pre-commit hook should catch the formatting + unused import
   - If you bypass with `--no-verify` and push, CI should fail on `format:check` and `lint`
2. Make a good commit on the same branch, push. CI should pass.
3. Delete the branch.

### Step 6: Enable branch protection on GitHub

- Settings → Branches → Add rule for `main`
- Require PR review before merge
- Require status check: `verify` (the CI job name)
- Require branches to be up to date before merging
- Do NOT check "Include administrators" until after your first collaborator lands a successful PR — you need to be able to emergency-bypass while the setup bakes in.

## Post-setup cleanup

- **Refresh fallow baselines** after the initial Prettier format commit (it changes many files; baselines should reflect post-format state): `npx fallow dead-code --save-baseline fallow-baselines/dead-code.json` and equivalent for dupes + health. Commit the updated baselines.
- **Add a `.editorconfig`** if collaborators use different editors — enforces indent + line-ending conventions at the editor level: one file, tiny payload, stops whitespace noise from non-VSCode editors.

## Gotchas to watch for during execution

1. **Prettier vs ESLint formatting conflict**: `eslint-config-prettier` disables the ESLint rules Prettier handles. It MUST come last in the ESLint flat config array. If you see ESLint complaining about formatting that Prettier just fixed, the order is wrong.
2. **husky init creates a default pre-commit that runs `npm test`**: we have no tests. Replace the contents with `npx lint-staged` before committing.
3. **Windows line endings**: `git status` has been warning about LF → CRLF on every commit this session. Consider adding a `.gitattributes` with `* text=auto eol=lf` to normalize — do it in a dedicated commit, not mixed with other work.
4. **`next build` needs env vars even for type checking**: the CI step passes placeholders. Don't remove them thinking they're unused.
5. **`fetch-depth: 0` on the checkout step**: fallow audit compares against the base branch via git history — shallow clones break it.

## Estimated time

- Step 1 (Prettier + initial format): 30 min
- Step 2 (husky + lint-staged): 20 min
- Step 3 (GitHub Actions CI): 30 min (most time in first-run iteration when env vars don't quite fit)
- Step 4 (CONTRIBUTING.md): 15 min
- Step 5-6 (verify + branch protection): 15 min
- **Total: ~2 hours wall clock** for a focused session.
