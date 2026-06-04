// Central env-var gate. On import, validates required public vars and
// emits a structured build-time warning when missing. Exports a typed
// `env` object so call sites read from one source of truth.
//
// NEXT_PUBLIC_SIS_URL is the deployed app's origin (e.g.
// https://sis.hfse.edu.sg). Email CTA deep-links in change-request /
// P-Files / publication notifications use this to render absolute URLs
// most email clients can navigate. When unset, links render as
// relative paths and recipients see non-clickable buttons. KD #16
// (emails are best-effort) means we WARN, not fail — a missing
// NEXT_PUBLIC_SIS_URL shouldn't block a hotfix to grading or another
// non-email feature.

if (!process.env.NEXT_PUBLIC_SIS_URL) {
  console.warn(
    '[hfse-sis] NEXT_PUBLIC_SIS_URL is not set. ' +
      'Email CTAs in change-request, P-Files, and publication ' +
      'notifications will render as relative URLs that most email ' +
      'clients cannot navigate. Set this to the deployed app origin ' +
      '(e.g. https://sis.hfse.edu.sg) before the next deployment.'
  );
}

// Server-only. Secret that signs the one-click approve/reject action tokens
// in change-request emails. When unset, signing throws and the email buttons
// fall back to the in-app deep-link (the quick-action page can't verify a
// token without it). Warned, not failed — a missing secret degrades the
// quick-action convenience but never blocks email or grading.
if (!process.env.CHANGE_REQUEST_ACTION_SECRET) {
  console.warn(
    '[hfse-sis] CHANGE_REQUEST_ACTION_SECRET is not set. ' +
      'Email one-click approve/reject buttons will fall back to the ' +
      'in-app deep-link (approvers must log in to act). Set this to a ' +
      'random server-only string (>=32 chars) before the next deployment.'
  );
}

export const env = {
  NEXT_PUBLIC_SIS_URL: process.env.NEXT_PUBLIC_SIS_URL ?? '',
} as const;
