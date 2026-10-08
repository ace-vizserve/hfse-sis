// Stand-in for `next/server` while the LOCAL seeder runs outside Next.
//
// Everything is the real module (NextResponse, NextRequest, …) except
// `after`, which throws outside a request ("`after` was called outside a
// request scope"). The app's grade-change decision handler
// (lib/change-requests/approval-handler.ts) calls it to send the approver /
// teacher emails once the response is out. The seeder never sends mail
// (register.mjs empties RESEND_API_KEY), so the callback is DROPPED rather
// than run: a mail fan-out that cannot send would only write a misleading
// `notification_status`. A request decided by the seeder therefore keeps the
// notification_status its filing left it with.
//
// Loaded by its file name ('next/server.js'), which ./register.mjs does not
// redirect, so this cannot resolve to itself.
'use strict';

const real = require('next/server.js');

module.exports = {
  ...real,
  after: function after() {},
};
