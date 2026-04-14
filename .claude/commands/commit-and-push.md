## Commit and Push

Execute the following steps in order. Stop immediately if any step fails.

### 1. Review Changes

- Detect the current Git branch name.
- Run `git status` and `git diff` (staged + unstaged) to review all changes.
- Summarize what was modified (files, features, fixes, etc.). Use this summary to generate the commit message later.

### 2. Lint and Build Checks

Run both commands. If **either** fails, STOP and output the errors. Do not proceed.

```
npm run lint
npm run build
```

### 3. Stage All Changes

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
- Status of: lint, build, rebase, push

### Rules

- **Never** proceed past a failing step.
- **Do not** ask for confirmation — execute deterministically.
- The commit message **must** reflect the actual diff.
