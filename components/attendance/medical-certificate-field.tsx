'use client';

import { FileText, Paperclip, TriangleAlert, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit, ApiError } from '@/lib/query/fetcher';

// The medical certificate for one excused day, attached where the day is
// marked.
//
// Mr Ace: *"the simplest way is just allow the SIS users to upload the MC."*
// That is the whole feature. Somebody is standing at the register with a
// certificate in their hand for one child on one day, and this is where it
// goes.
//
// ⚠ ONE CONTROL, AND IT ASKS ONE QUESTION. It never asks whether a parent has
// already filed for the day — the person using it has no way to know, and the
// server does. `POST /api/declarations/staff` creates a filing when there is
// none and attaches the certificate to the one that is already there when
// there is. Nothing about that reaches this component, and nothing about it
// should: a branch on this screen would be a branch a teacher has to
// understand.
//
// ⚠ BUILT ONCE, RENDERED IN TWO PLACES — the term sheet's marking dialog and
// the Daily register's excused panel. There is no `variant` and no `density`
// prop, deliberately: the controls sit on one `flex-wrap` row, so the narrow
// dialog wraps them and the wide roster row does not. A second layout would
// be a second thing to keep in step.
//
// ⚠ NEVER A DIALOG. In the marking palette this renders INSIDE an open dialog,
// and two stacked dialogs fight over the focus trap — dismissing the inner one
// takes the outer one with it. The whole interaction is inline.
//
// ── THE EMPTY CONTROL AND THE RECORD ARE THE SAME BAND ────────────────────
//
// Saving swaps one for the other in place, under the same eyebrow. The
// "on file" line is deliberately shaped like `FilingCard` — the muted pill,
// the indigo document icon, the 12px sentence with a quiet trailing clause —
// because a certificate the office just attached and a certificate a parent
// filed are the same fact, and the sheet already has a voice for it.
//
// ⚠ The empty state is NOT wrapped in that pill. The marking dialog's redesign
// killed three nested boxes of one colour ("i personally dont like this"), and
// putting bordered inputs inside a filled container would rebuild one.

/** What the office may hand in. Mirrors `ACCEPTED` on the upload route. */
const ACCEPTED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

/**
 * ⚠ THE SERVER'S OWN SENTENCES, WORD FOR WORD. These checks run in the browser
 * only to save a round trip; the upload route enforces both and is the thing
 * that actually decides. Two wordings for one rule is how a person learns to
 * distrust the message.
 */
const WRONG_TYPE_MESSAGE = 'Attach a PDF or a photo (JPG, PNG or WEBP).';
const BAD_LINK_MESSAGE =
  'That link must start with https:// — copy it from the certificate itself.';

/** 10 MB, matching the upload route and P-Files. */
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const TOO_BIG_MESSAGE =
  'That file is larger than 10 MB. Please attach a smaller one.';

/** The eyebrow over the band — the marking dialog's voice, matched exactly. */
const BAND_EYEBROW =
  'font-mono text-[10px] font-semibold tracking-[0.13em] text-muted-foreground uppercase';

export type MedicalCertificateFieldProps = {
  /** The enrolment the register is keyed on — `section_students.id`. */
  sectionStudentId: string;
  /** The one day, `yyyy-MM-dd`. Both surfaces mark a day at a time. */
  date: string;
  /** Named in the accessible labels, since a roster shows thirty of these. */
  studentName: string;
  /**
   * A certificate is already on this day — from a parent's filing, or from an
   * earlier upload here. The control is replaced by the record of it.
   */
  hasCertificate: boolean;
};

export function MedicalCertificateField({
  sectionStudentId,
  date,
  studentName,
  hasCertificate,
}: MedicalCertificateFieldProps) {
  const run = useWriteAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState('');
  // Held across the whole write, not just the request — the success toast does
  // not fire until the awaited refresh has committed (§10.6 / KD #186), and a
  // button that re-enables before then invites a second upload.
  const [busy, setBusy] = useState(false);
  // What is wrong with what they chose, said on the spot. Not a toast: the
  // answer is about a control they are looking at, and the fix is in it.
  const [problem, setProblem] = useState<string | null>(null);
  // Set the moment the write resolves, so the band becomes the record before
  // the page has finished refreshing behind it.
  const [justSaved, setJustSaved] = useState(false);

  // ⚠ REPLACING IS A SEPARATE, DELIBERATE MODE — not a flag on Save.
  //
  // Mr Ace: re-uploading in the SIS "will override it but theres a warning".
  // A day that already carries proof shows the record, not a picker; asking
  // to replace swaps in the warning, and only agreeing to THAT reveals the
  // controls. So the certificate on file cannot be overwritten by anybody who
  // did not read why.
  //
  // ⚠ INLINE, NEVER A SECOND DIALOG. This control renders inside the already
  // open cell-mark dialog, where a stacked dialog fights the focus trap and
  // dismissing the inner one takes the outer one with it — the same reason
  // `OverrideConfirm` swaps that dialog's body instead. It also has to work in
  // the daily register, where there is no dialog at all.
  const [replacing, setReplacing] = useState(false);
  // Set when the SERVER says the day already has proof — the race where the
  // parent uploads in the portal while the office is scanning the paper copy.
  // The warning then appears on a control that was showing an empty picker.
  const [raced, setRaced] = useState(false);

  const onFile = hasCertificate || justSaved;
  // The warning is showing: either they asked to replace, or the server told
  // us one landed while this screen was open.
  const warning = replacing || raced;

  function beginReplace() {
    setProblem(null);
    setReplacing(true);
  }

  function cancelReplace() {
    setProblem(null);
    setReplacing(false);
    setRaced(false);
    setFile(null);
    setLink('');
    if (fileRef.current) fileRef.current.value = '';
  }

  function chooseFile(next: File | null) {
    setProblem(null);
    if (!next) {
      setFile(null);
      return;
    }
    if (!ACCEPTED_TYPES.includes(next.type)) {
      setFile(null);
      setProblem(WRONG_TYPE_MESSAGE);
      return;
    }
    if (next.size > MAX_FILE_SIZE) {
      setFile(null);
      setProblem(TOO_BIG_MESSAGE);
      return;
    }
    setFile(next);
  }

  function clearFile() {
    setFile(null);
    setProblem(null);
    // The same file cannot be re-chosen unless the input forgets it.
    if (fileRef.current) fileRef.current.value = '';
  }

  async function save() {
    const trimmed = link.trim();
    if (!file && !trimmed) {
      setProblem('Choose a file or paste a link first.');
      return;
    }
    if (trimmed && !/^https:\/\/\S+$/i.test(trimmed)) {
      setProblem(BAD_LINK_MESSAGE);
      return;
    }
    setProblem(null);
    setBusy(true);

    // ⚠ TWO REQUESTS, ONE WRITE. The file goes up on its own and comes back as
    // a path, exactly as the parent portal's upload does — the filing body is
    // validated as JSON and a separate upload is what gives this a retry. Both
    // live inside ONE `run`, so a failed upload never reports a saved
    // certificate.
    await run(
      async () => {
        let evidencePath: string | undefined;
        if (file) {
          const form = new FormData();
          form.append('file', file);
          const uploaded = await apiFetch<{ path: string }>(
            '/api/declarations/staff/evidence',
            // ⚠ No `content-type` header. The browser has to set the multipart
            // boundary itself, and naming the type here strips it.
            { method: 'POST', body: form }
          );
          evidencePath = uploaded.path;
        }
        return apiFetch<{ attached?: boolean }>(
          '/api/declarations/staff',
          jsonInit('POST', {
            sectionStudentId,
            // One day at a time on both surfaces — the certificate is recorded
            // against the cell that was clicked.
            startDate: date,
            endDate: date,
            evidencePath,
            evidenceUrl: trimmed || undefined,
            // Only ever set after a person read the warning and went on. The
            // server declines a replacement that does not carry it, which is
            // what makes the warning load-bearing rather than decorative.
            replaceExisting: replacing || raced ? true : undefined,
          })
        );
      },
      {
        pending: 'Saving the certificate…',
        // ⚠ ONE SENTENCE FOR BOTH OUTCOMES. Whether the server created a
        // filing or attached this to one a parent had already sent is not
        // something the person did, chose, or can act on.
        success:
          replacing || raced ? 'Certificate replaced.' : 'Certificate saved.',
        // ⚠ THE "ALREADY ON FILE" REFUSAL IS NOT AN ERROR TO TOAST — it is the
        // warning, arriving late. It happens when a certificate landed between
        // this screen loading and Save being pressed: the parent uploading in
        // the portal while the office scans the paper copy. Returning null
        // suppresses the toast and the band shows the question instead, so the
        // person answers it in the place they are already looking.
        error: (e) => {
          const body =
            e instanceof ApiError
              ? (e.body as { certificateAlreadyOnFile?: boolean } | null)
              : null;
          if (body?.certificateAlreadyOnFile === true) {
            setRaced(true);
            return null;
          }
          return e instanceof Error ? e.message : 'Could not save that.';
        },
        onResolved: () => {
          setJustSaved(true);
          setReplacing(false);
          setRaced(false);
          setFile(null);
          setLink('');
        },
      }
    );
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className={BAND_EYEBROW}>Medical certificate</span>
        {!onFile && (
          <span className="text-[11px] text-muted-foreground">optional</span>
        )}
      </div>

      {onFile && !warning ? (
        // The record. `FilingCard`'s shape, so a certificate the office
        // attached reads in the same voice as one a parent filed.
        <div
          className="flex items-center gap-2.5 rounded-xl bg-muted px-3 py-2.5"
          role="status"
        >
          <FileText className="size-4 shrink-0 text-brand-indigo" aria-hidden />
          <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">
            <span className="font-semibold">Certificate on file</span>
            <span className="text-muted-foreground">
              {' · '}
              {justSaved && !hasCertificate ? 'just added' : 'for this day'}
            </span>
          </span>
          {/* Quiet on purpose. Replacing a certificate is rare and
              consequential, so it must be reachable without inviting itself —
              §9.2's variant for a tertiary action beside a record. */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-[11px] text-muted-foreground"
            onClick={beginReplace}
          >
            Replace
          </Button>
        </div>
      ) : (
        <>
          {warning && (
            // ⚠ THE WARNING IS A BAND IN THIS CONTROL, NOT A DIALOG. Nesting a
            // dialog inside the cell-mark dialog breaks the focus trap, and
            // this same component renders in the daily register where there is
            // no dialog to nest inside.
            <div
              className="flex items-start gap-2.5 rounded-xl bg-destructive/8 px-3 py-2.5 ring-1 ring-inset ring-destructive/20"
              role="alert"
            >
              <TriangleAlert
                className="mt-px size-4 shrink-0 text-destructive"
                aria-hidden
              />
              <p className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">
                <span className="font-semibold">
                  {raced
                    ? 'A certificate arrived while this was open.'
                    : 'This day already has a certificate.'}
                </span>{' '}
                <span className="text-muted-foreground">
                  Saving another one puts it in place of the one on file.{' '}
                  {studentName}&rsquo;s current certificate will no longer be
                  shown here, and this screen cannot bring it back.
                </span>
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {/* ⚠ A REAL AFFORDANCE OVER A HIDDEN INPUT. A bare
                `<input type="file">` renders the browser's own unstyled
                control, which carries none of the design system and reads
                differently in every browser. Same pattern as the P-Files
                uploader. */}
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              className="sr-only"
              disabled={busy}
              aria-label={`Medical certificate file for ${studentName}`}
              onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="h-9 gap-2 font-normal"
            >
              <Paperclip className="size-3.5" aria-hidden />
              Choose a file
            </Button>

            <Input
              value={link}
              disabled={busy}
              onChange={(e) => {
                setLink(e.target.value);
                setProblem(null);
              }}
              // Singapore issues digital MCs as a link, so proof is often a
              // URL and never a file.
              placeholder="Or paste a link"
              aria-label={`Link to the medical certificate for ${studentName}`}
              className="h-9 min-w-[9rem] flex-1 text-[13px]"
            />

            {/* ⚠ `outline`, not the default gradient. The primary action on
                both of these screens is the attendance mark itself — the
                dialog saves it on the pick, the Daily register has its Submit
                bar — and a second gradient button beside either would leave
                the view with no primary at all (09a §9.2). */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={busy}
              loadingText="Saving…"
              onClick={save}
              className="h-9"
            >
              {warning ? 'Replace certificate' : 'Save certificate'}
            </Button>
            {/* Only while replacing — with nothing on file there is nothing to
                go back to, and a Cancel that cleared the picker would read as
                an action rather than an escape. */}
            {warning && onFile && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={cancelReplace}
                className="h-9 text-muted-foreground"
              >
                Keep the one on file
              </Button>
            )}
          </div>

          {file && (
            <div className="flex items-center gap-2">
              <FileText
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                {file.name}
              </span>
              <button
                type="button"
                onClick={clearFile}
                disabled={busy}
                aria-label={`Remove ${file.name}`}
                className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="size-3" aria-hidden />
              </button>
            </div>
          )}

          <span
            className={
              problem
                ? 'text-[11px] leading-snug font-medium text-destructive'
                : 'text-[11px] leading-snug text-muted-foreground'
            }
            role={problem ? 'alert' : undefined}
          >
            {problem ?? 'A PDF or a photo, up to 10 MB. Or a link to it.'}
          </span>
        </>
      )}
    </div>
  );
}
