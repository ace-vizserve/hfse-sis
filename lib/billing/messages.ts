// The fixed sentences Billing shows staff when something below QuickBooks
// goes wrong. The raw database / tile text goes to the server log, never to
// the screen.

/** A tile (stage) write failed after the history was stored. */
export const STAGE_NOT_UPDATED =
  "The Registration / Fees stage couldn't be updated just now; the invoices and payments are saved. The hourly check will try again.";

/** The SIS couldn't read its own records before anything went to QuickBooks. */
export const SIS_READ_FAILED =
  "The SIS couldn't read its records just now. Nothing was sent to QuickBooks — try again.";

/** QuickBooks accepted the write; the SIS copy failed and the sync fills it. */
export const SIS_CATCH_UP =
  'Saved in QuickBooks; the SIS copy will catch up within the hour.';
