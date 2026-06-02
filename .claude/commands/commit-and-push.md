## Commit and Push

Execute the following steps in order. Stop immediately if any step fails.

### 1. Review Changes

- Detect the current Git branch name.
- Run `git status` and `git diff` (staged + unstaged) to review all changes.
- Summarize what was modified (files, features, fixes, etc.). Use this summary to generate the commit message later.

### 2. CI-Mirror Checks (format, types, tests, build)

These mirror the GitHub Actions pipeline in `.github/workflows/ci.yml` **exactly** — `prettier --check` → `tsc --noEmit` → `vitest run` → `next build` — so a green local run guarantees a green CI run and the push never fails on a check CI would have caught.

Run in order. The first command auto-fixes formatting so it can never block the push (CI only runs `--check`); if **any** of the remaining three fails, STOP and output the errors. Do not proceed.

```
npm run format        # prettier --write .  (auto-fix; CI runs `prettier --check .`)
npx tsc --noEmit      # type check
npm run test          # vitest run
npm run build         # next build
```

Notes:

- `npm run format` runs **before** staging (step 3) so reformatted files are included in the commit. `.prettierrc` sets `endOfLine: "auto"`, so on a Windows (CRLF) working tree this does not churn line endings.
- **Do NOT add `npm run lint` (eslint) to this gate** — CI does not run it, and the repo currently carries pre-existing eslint errors that would falsely block every push. The CI contract is the four commands above. If CI's `ci.yml` changes, update this step to match.

### 3. Stage All Changes

**Only when the current branch is `main`**, pin the commit identity to the
project service account so the Vercel production-deploy attribution lands on
the right address. On any other branch, skip this step — feature-branch
commits keep the user's own identity.

```
if [ "$(git rev-parse --abbrev-ref HEAD)" = "main" ]; then
  git config user.email "vercel.hfse@gmail.com"
fi
```

Then stage:

```
git add .
```

### 4. Generate Commit Message

- Use **Conventional Commits** format (`feat`, `fix`, `refactor`, `chore`, `docs`, `style`, `perf`, `test`, etc.).
- The message must be clear, descriptive, and based on the **actual diff** — never vague like "update" or "fix stuff".
- Maximum **4 lines** total (subject + body if needed).
- Use a HEREDOC to pass the message:

```
git commit -m "$(cat <<'EOF'
<type>(<optional scope>): <subject>

<optional body — 1-2 lines max>
EOF
)"
```

### 5. Rebase Before Push

Pull with rebase against the current branch:

```
git pull --rebase origin <current-branch>
```

If the rebase fails, STOP and report the conflict. Do not push.

### 6. Push

```
git push origin <current-branch>
```

### 7. Final Summary

Output a summary including:

- Commit message used
- Branch name
- Status of: format, tsc, test, build, rebase, push

### Rules

- **Never** proceed past a failing step.
- **Do not** ask for confirmation — execute deterministically.
- The commit message **must** reflect the actual diff.
