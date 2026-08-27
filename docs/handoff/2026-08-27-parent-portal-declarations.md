# Handoff — Student Absence & Travel Declaration (parent portal side)

**For:** the admissions-portal SPA team / agent.
**SIS side status:** the table, the API and the validation are **built and live**
as of 2026-08-27 (migration 125 applied). Nothing below is speculative — every
endpoint described here exists and answers today.

Paste the block below to the portal agent as its brief.

---

## The brief

You are building one new feature in the HFSE parent portal: **Student Absence
and Travel Declaration**. It lives under **Services**.

The backend already exists in the SIS and is live. You are building the UI and
the calls into it. Do not build your own tables for this — the SIS owns the
record.

### What it is for

Today, when a child is away, the reason reaches the school as a WhatsApp message
to the teacher, or a paper medical certificate handed in at the office, or
nothing at all — and the teacher guesses whether to mark the day absent or
excused. This form replaces that guess. A parent declares the absence, attaches
the certificate, and the school approves it; on approval the register is marked
excused automatically.

That matters more than it sounds. When a child's attendance falls short the
school sends a warning letter listing the days missed, and whoever writes it
currently has to ask around to find out which of those days had a certificate.

### Build the form as a stepper

**Use your stepper component.** The parent is answering a sequence of questions
and several of them change what comes next — a travel declaration asks nothing
about medical certificates, and "no certificate" hides the upload entirely.
Putting all of that on one screen produces a form that visibly rearranges itself
while someone is filling it in, which reads as broken. One question per step,
with the back button working, is the right shape.

Steps, in order:

1. **Who is this about?** Multi-select of the parent's children. Most parents
   have one; show it selected and move on. Several children on one submission is
   supported and expected — siblings catch the same thing.
2. **Absence or travel?** Two choices. This picks the branch.
3. **When?** Start date and end date. A single day is the common case, so make
   "one day" the easy path — same-day start and end is valid.
4. **Absence branch only — is there a medical certificate?** Two choices: _with
   medical certificate_ / _without_.
5. **Absence branch, with certificate only — attach it.** Either a file upload
   **or** a link. Singapore's digital MCs come as an `mc.gov.sg` URL, so a paste
   box is genuinely useful and not a fallback. A photo of a paper certificate is
   the other half. Accept either, or both.
6. **Travel branch only — where?** Country (required), city (optional).
7. **Anything the teacher should know?** Optional note, 300 characters.
8. **Review and submit.** Show back what they said before they send it.

Then **a status list**, which is the other half of the feature and not optional:
a parent who files something must be able to see what happened to it. Each
filing shows the child, the dates, and its status.

---

## The API

Base: the SIS origin. Every call is cross-origin and needs the parent's Supabase
access token as `Authorization: Bearer <token>` — the same token you already use
for the report-card calls. There is no cookie and no session handshake.

⚠ **These are the first portal endpoints that accept writes.** Preflight
`OPTIONS` now genuinely fires before every POST, because a JSON body makes it a
non-simple request. That is handled server-side; just be aware you will see the
extra request in the network tab.

### 1. The children to show in step 1

```
GET /api/parent/v2/enrolled-students
Authorization: Bearer <token>
```

```json
{
  "students": [
    {
      "studentNumber": "H250123",
      "name": "Ana Reyes",
      "levelCode": "P4",
      "sectionName": "Diligence",
      "className": "P4 Diligence"
    }
  ]
}
```

Use `className` as the label under the child's name — two siblings can share a
first name in a hurry, and nobody shares a class as well.

⚠ **Do NOT use `GET /api/parent/v2/students` for this.** That one is the
report-card screen's list and is **gated on publication**: a child who is
enrolled and attending, but whose report card is not published at this moment,
is correctly missing from it. Using it here would hide a child from their own
parent for the entire stretch between publications — and it would not look like
a bug, it would look like the child simply is not there.

`studentNumber` is the only student identifier any of these endpoints accepts.
There are no uuids in this API.

### 2. Upload the certificate (optional, absence only)

```
POST /api/parent/v2/declarations/evidence
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <the file>
```

- **Accepted:** PDF, JPG, PNG, WEBP. Max **10 MB**, one file per call.
- **Returns `201`:** `{ "path": "declarations/<uuid>/<uuid>.pdf" }`

Hold that `path` and send it with the declaration in the next call. **Do not try
to construct the path yourself** — it is checked server-side against the
uploading parent and a path you build will be rejected.

Errors are plain sentences meant to be shown as-is: `"That file is larger than
10 MB. Please attach a smaller one."`, `"Attach a PDF or a photo (JPG, PNG or
WEBP)."`

### 3. File the declaration

```
POST /api/parent/v2/declarations
Authorization: Bearer <token>
Content-Type: application/json
```

**Absence:**

```json
{
  "declarationType": "absence",
  "studentNumbers": ["H250123"],
  "startDate": "2026-09-16",
  "endDate": "2026-09-18",
  "withMedical": true,
  "evidencePath": "declarations/<uuid>/<uuid>.pdf",
  "evidenceUrl": "https://mc.gov.sg/xxxx",
  "parentNote": "Fever since Monday."
}
```

**Travel:**

```json
{
  "declarationType": "travel",
  "studentNumbers": ["H250123", "H250124"],
  "startDate": "2026-12-01",
  "endDate": "2026-12-10",
  "destinationCountry": "Malaysia",
  "destinationCity": "Penang",
  "parentNote": "Family visit."
}
```

⚠ **The two shapes are strict and must not be mixed.** Sending `withMedical` on
a travel declaration, or `destinationCountry` on an absence, is rejected rather
than ignored. That is deliberate — it is the mistake most likely to be made from
your side, and a silent drop would be far harder to debug than an error.

**Field rules, enforced server-side:**

| Field                   | Rule                                                     |
| ----------------------- | -------------------------------------------------------- |
| `studentNumbers`        | 1–10, no duplicates, must be the parent's own children   |
| `startDate` / `endDate` | `YYYY-MM-DD`; end not before start                       |
| range length            | at most **60 days**                                      |
| `startDate`             | no more than **30 days** in the past, **365 days** ahead |
| `withMedical: true`     | requires `evidencePath` or `evidenceUrl`                 |
| `evidenceUrl`           | **`https://` only**                                      |
| `parentNote`            | ≤ 300 characters                                         |
| `destinationCountry`    | required on travel                                       |

**Returns `201`:**

```json
{
  "filingGroupId": "…",
  "declarations": [
    {
      "id": "…",
      "studentNumber": "H250123",
      "studentName": "…",
      "status": "pending"
    }
  ]
}
```

One row per child — a submission covering two siblings comes back as two
declarations, and they are approved separately, because each child's own form
class adviser is the first approver.

**`400`** carries field-level messages already written for a parent to read:

```json
{
  "error": "Please check the form.",
  "issues": [
    {
      "path": "endDate",
      "message": "The last day cannot be before the first day."
    }
  ]
}
```

Put each `message` under the field named by `path`. Do not rewrite them — they
are worded for parents on purpose, and the SIS team maintains them.

**`403`** — a child not on this account, or an attachment that cannot be matched
to this parent.

⚠ **`200` with `"alreadyFiled": true` is SUCCESS, not an error.** If a parent
double-taps submit on a bad connection the server returns the filing that
already exists rather than creating a second one. Show the confirmation screen.

### 4. The status list

```
GET /api/parent/v2/declarations
GET /api/parent/v2/declarations?studentNumber=H250123
GET /api/parent/v2/declarations?status=pending
```

Returns `{ "declarations": [...] }`, newest first, each with:

`id`, `filingGroupId`, `declarationType`, `studentNumber`, `studentName`,
`startDate`, `endDate`, `withMedical`, `evidenceUrl`, `hasUpload`,
`destinationCountry`, `destinationCity`, `parentNote`, `status`, `statusLabel`,
`filedAt`.

**Use `statusLabel` for display, not `status`.** The four values are:

| `status`    | `statusLabel`       |
| ----------- | ------------------- |
| `pending`   | **With the school** |
| `approved`  | **Approved**        |
| `rejected`  | **Not approved**    |
| `cancelled` | **Withdrawn**       |

"With the school" rather than "Pending" is deliberate — _pending_ reads as
_stuck_ to a parent watching a form they filed about a sick child.

⚠ **Both parents see the same list.** It is scoped by child, not by who filed —
if the mother files, the father sees it too. Do not filter it client-side to the
signed-in parent.

### Rate limits

Writes: 5 per minute per parent, 10 per minute per IP. Reads: 20 per minute.
A `429` carries `Retry-After`. This is generous for real use — if you are hitting
it, something is retrying in a loop.

---

## Things that are NOT yours to build

- **Approval.** Two people at the school approve each declaration — the child's
  form class adviser, then an officer in charge. That is SIS-side. Your job ends
  at showing the status.
- **The register.** On final approval the SIS marks those days excused itself.
- **Editing or withdrawing a filing.** Not built yet on either side. If parents
  need it, say so and it gets added to the SIS first.
- **Notifying the parent of the outcome.** Not built yet. For now the status list
  is how they find out, so make it easy to get back to.

## Open questions the school has not answered

Worth knowing so you do not design around a guess:

1. Nobody currently holds the "officer in charge" post, so approvals may sit at
   the first stage until the school names someone.
2. Whether an approved absence should affect the child's attendance percentage.
   Today it does not — an excused day counts as present.

---

## Notes for the SIS side (not part of the portal brief)

- CORS allowlist is `ADMISSIONS_PORTAL_ORIGIN` plus hardcoded
  `http://localhost:5173` and the staging Vercel origin (`lib/cors.ts`). If the
  portal moves origin, that env var must move with it or every call fails
  preflight.
- `corsHeaders(origin, methods)` defaults to `GET, OPTIONS`; only the two
  declaration routes pass anything else, and
  `__tests__/api/cors-methods.test.ts` fails if that leaks to the read-only
  routes.
- Files land in the existing public `parent-portal` bucket under
  `declarations/<parent user id>/<uuid>.<ext>`.
