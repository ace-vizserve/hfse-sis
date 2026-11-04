---
name: staff-guide
description: Build an HFSE SIS staff user guide as a PDF, with a minimal front page and the school logo, a contents page, and one page per step with a real, labelled screenshot, like docs/training/parent-events-guide.pdf and books-supplies-tracking-guide.pdf. Use whenever he asks for a guide, user guide, how-to, handout, instructions or training PDF for a SIS or parent portal feature, or asks to update or re-shoot an existing one, even if he only says "make a guide for this" or "add images like the books list".
argument-hint: "[feature, e.g. parent events]"
---

**Arguments:** $ARGUMENTS

# Staff guide

A guide is for school staff, not developers. It shows the real screens, in the order someone does the work, so they can follow it without being trained. The design is settled (Mr Ace approved it 2026-11-04), so spend the effort on getting the steps and screenshots right, not on the look. Don't restyle it unless he asks.

## 1. Learn the feature

Read the code and docs for the feature, including its KD and any spec or plan, then click through it on the local stack. Note:

- The real order of the work, and who does each part (staff, parents).
- Who is allowed to do it. Take this from the route's role check, not from memory.
- What it does not do, and anything that could surprise someone. These become the "Good to know" notes.

If the feature is on `main` but not on production, say so when you hand the guide over.

## 2. Write the guide as data

Write `guide.json` in the scratchpad. `example/parent-events.json` is a complete real one, so copy its shape:

```json
{
  "title": "Parent events",
  "summary": "One sentence saying what the guide covers.",
  "date": "November 2026",
  "groups": [
    { "name": "Setting up an event", "steps": [
      { "title": "Start a new event", "body": "One to three sentences.", "shot": "01-list.png" }
    ] }
  ],
  "notes": [{ "label": "No emails", "text": "The SIS sends no invitations..." }]
}
```

Leave out `date` to use this month. Each step gets exactly one page and one screenshot, because the contents page counts on it.

Write the way a colleague would explain it:

- Step titles say what the person does: "Tick what was handed over", not "Handover tracking".
- Use the exact words on the screen for buttons and menus, so people can find them: "Go to SIS Admin → Parent events."
- Plain English, with no developer words (route, migration, table, API, sync). Staff are not IT.
- Only what is true today. Don't describe a planned feature, and don't invent a rule. Check anything you aren't sure of against the code.
- Group steps by stage of the work, and split staff and parent parts into separate groups.
- Always add an "About the screenshots" note saying they use sample data.

## 3. Take the screenshots

Capture from the **local stack only** (Docker Supabase plus `next dev` on `localhost:3000`, using `.env.development.local`), so no real child's name or number ever reaches a PDF that gets passed around. See `docs/context/24-local-dev.md`. Never point a capture at production, even read-only. Staff log in as `admin@local.test`, and the password for every local account is `local.test`.

Write a capture script in the scratchpad using `scripts/annotate.cjs` (`signIn`, `shot`). Use a 1440-wide viewport, with a height that fits the screen (950 to 1500), so the app shows full size. If a capture has to create data, create it through the app's own routes and delete it afterwards.

For the parent portal, it runs from `../app-online-admission` on `localhost:5173`. Start it with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set to the local stack, because its own `.env` may point at production. `e2e/parent-portal/` has helpers for setting up a local family. If you use them, the capture has to be a temporary Playwright spec in that folder; delete it after.

Look at every screenshot before using it:

- Labels go beside what they point to and must not cover anything the step talks about. Move them with `side`, `gap`, `dx` and `dy`.
- Label text is short and says what the thing is for, not its name.
- Three or fewer labels on most screens. More than five means the step should be split.
- The screen has believable data on it, not empty tables, unless the empty state is the point.
- No dev button, error overlay or half-loaded page.

If a screen looks broken and the code seems right, restart `next dev` before assuming a bug. Don't run `next build` in the working tree, because it breaks the running dev server.

## 4. Build the PDF

From the repo root:

```bash
node .claude/skills/staff-guide/scripts/build-guide.cjs <guide.json> <shots-dir> docs/training/<feature>-guide.pdf <preview-dir>
```

It warns and exits 2 if anything is cut off at the bottom of a page. Fix that by making the screenshot shorter or the text tighter.

## 5. Check it yourself

Look at every PNG in the preview folder before handing it over: the front page, the contents page numbers, and that each step's text matches its screenshot. Don't ask him to check it for you.

## 6. Hand it over

Tell him the file path, the page count, and in a line or two anything he should know: what the guide leaves out, or whether the feature is live yet. Commit only if he asks. Copying a guide into a chat or email is his call, so when he asks for that message, keep it short.

If this replaces an older guide, mention the old file and remove it only once he says so.
