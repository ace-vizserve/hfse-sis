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
