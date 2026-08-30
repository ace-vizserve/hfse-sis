// Cache Components (next.config.ts) requires each segment to prerender into a
// static shell or declare that it blocks. Unlike the other nine module layouts,
// this one reads no session at all — it is the logged-out email quick-action
// shell (KD #123). It blocks because the confirm page BELOW it validates a
// signed token from the URL, which is per-request data. Kept on the MODULE
// layout, not the root, so the rest of the app keeps validating.
export const instant = false;

// Standalone shell for unauthenticated one-click action pages (the email
// quick-action confirm page). No module sidebar, no command palette — these
// pages are reached by an approver clicking a button in their inbox and are
// not part of the signed-in app. The root layout still provides <html>,
// <body>, fonts, and the <Toaster>; this group layout only centers content.
export default function ActionLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-muted/30 px-4 py-12">
      {children}
    </main>
  );
}
