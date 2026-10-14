export function formatSgd(n: number): string {
  return `S$${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatSyncedAt(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const sg = (x: Date) =>
    x.toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore' });
  if (sg(d) === sg(now)) {
    return `Synced ${d.toLocaleTimeString('en-SG', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hour12: false })}`;
  }
  return `Synced ${d.toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short' })}`;
}
