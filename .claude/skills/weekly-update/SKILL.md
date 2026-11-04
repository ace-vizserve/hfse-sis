---
name: weekly-update
description: Build the HFSE SIS weekly progress update - the Excel Gantt (HFSE-SIS-Weekly-Update-<dd>-<dd>-<Mon>-<yyyy>.xlsx) of one Mon-Fri week's shipped milestones, in-progress work and meetings with the school. Use when Mr Ace asks for a "weekly update", "progress update", "weekly gantt" or "update for this week".
argument-hint: "[week, e.g. 19-23 Oct] [items to add, e.g. meeting with Ms Joann Mon 2-3 PM]"
---

**Arguments:** $ARGUMENTS

Read the arguments (or his message) for two things:
- **The week:** any form, e.g. "19-23 Oct", "last week" or "this week". If there is none, use the rule in step 1.
- **Items to add:** meetings, features or anything else he names. Each one gets its own row.

# Weekly update

The weekly update is an **Excel Gantt**, never an online doc, HTML page or chat table. The school reads it, so it is written for a normal person, not a developer.

## 1. Pick the week

- The week he names. If he names none: made on a Monday → the week just ended; made later in the week → this week.
- Mon-Fri only. No previous-week section and no Upcoming rows unless he asks.
- File: `HFSE-SIS-Weekly-Update-<d>-<d>-<Mon>-<yyyy>.xlsx` in `files/progress-reports/` (gitignored), e.g. `HFSE-SIS-Weekly-Update-19-23-Oct-2026.xlsx`.

## 2. Gather what happened

```bash
git log origin/main --since=<Mon> --until=<Sat> --date=short --pretty="%ad %h %s"   # what is LIVE
git log main --since=<Mon> --until=<Sat> --date=short --pretty="%ad %h %s"          # incl. not pushed
```

Also read the CLAUDE.md "Session context" block for modules still being built.

**Check, don't trust CLAUDE.md, whether a migration is on production.** If a shipped row depends on a migration, query production read-only. The connection string is `PROD_DB_URL` in `.env.prod-db`. Run `psql` through Docker with `node --env-file=.env.prod-db` and a `spawnSync('docker', ['run','--rm','-e','PGURL', 'public.ecr.aws/supabase/postgres:17.11.0.002','sh','-c','psql "$PGURL" -At -c "$Q"'])` script in the scratchpad, as `scripts/local/pull-prod-config.mjs` connects. Pass `PGOPTIONS='-c default_transaction_read_only=on'`. Check the constraint, function or column the migration adds. If CLAUDE.md is stale, fix that line too.

## 3. Choose the rows - essential only

- **A row is a milestone:** a NEW thing someone at the school can now do. Group many commits into one row.
- **Leave out:** bug fixes, data imports or corrections, restyles or rearranged pages, small improvements, tests, docs, internal or technical work.
- **Aim for about 4-6 feature rows,** plus the module still being built and the meetings.
- **A module still being built** (e.g. Billing) is **In progress**, band included, until it is live with production keys. Never call groundwork finished while anything is open. Give a new module its groundwork rows (setup, data gathering, testing before going live).
- **Add every meeting and feature he names,** even if it rode in with another row.

## 4. Statuses - only these

| Status | Colour | Use |
|---|---|---|
| Shipped | green | live on production (pushed + migration applied) |
| Shipped - for checking | amber | live, being checked with the school |
| Revised | purple | an existing feature, improved and live on production |
| In progress | blue | still being built; Finished / Days show "-" |
| Upcoming | light blue | only if he asks for upcoming rows |
| Meeting | navy | a meeting with the school; the status cell shows its day and time |

Never invent another status ("Done", "Completed", "Built - not yet live", "For checking", "Held"). Meetings go in their own band at the top, e.g. "MEETINGS WITH MS JOANN", with the date and time he gives. Their description only says what the meeting was about. Never invent outcomes; ask him for them.

## 5. Write it so a normal person understands it

- **Feature name:** what people can do, in everyday words. Write "Approve or update many items at once", not "Bulk actions on work queues". Write "Holidays for one level only", not "Calendar closures for one level".
- **Description:** two short sentences. First what staff or parents can now do, then one concrete example.
- **No system words:** module, queue, switcher, migration, sandbox, encrypted, keys, credit note, chart of accounts, commit, sync, API, RLS, route, DataTable, KD.
- Use "school year", not "AY". Use "Primary 1", not "P1". Use "cancel", not "void". Use "practice copy", not "sandbox".
- Neither one bare sentence nor a five-sentence paragraph.

## 5b. Ask once, then build

Git cannot see meetings, school-side events or work done outside the repo. Before building, ask ONE short question, in plain prose, not a multi-select form. In that message:
- list the rows you plan to include (number, name, status);
- ask whether there were meetings or other items to add, with day, time and who;
- ask any real open point, e.g. whether a migration is still not on production after you checked.

If he already listed the items in the arguments or his message, and nothing is open, skip the question and build straight away. Do not ask again after he answers.

## 6. Build it

Write the rows as JSON in the scratchpad, shaped like `example-19-23-Oct-2026.json` beside this file. Then run:

```bash
python .claude/skills/weekly-update/gen_weekly.py <scratchpad>/rows.json files/progress-reports/HFSE-SIS-Weekly-Update-<...>.xlsx
```

The script draws the navy/cyan layout: title band, status tiles, numbered module bands (1.1, 2.1...), the Mon-Fri day grid with an orange status-date line on Friday, descriptions and the legend. It refuses an unknown status.

## 7. Report

Reply with the file name and the row list (number, name, status), in a few lines. Flag only what he must answer, e.g. a migration not on production or meeting outcomes. No recap.
