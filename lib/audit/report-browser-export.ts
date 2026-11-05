// A CSV built in the browser never touches the server, so it says so here. The
// download never waits on this and is never stopped by it. `keepalive` lets the
// report finish if the person leaves the page straight away.
export function reportBrowserExport(file: string, rows: number | null): void {
  void fetch('/api/audit-log/export-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file, rows, page: window.location.pathname }),
    keepalive: true,
  }).catch(() => {});
}
