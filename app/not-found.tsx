import { RecordNotFound } from '@/components/ui/record-not-found';

// The app-wide 404. Catches anything outside a module's own route group —
// including a genuinely unknown URL — and is the fallback for every module
// that has no `not-found.tsx` of its own.
//
// ⚠ This one renders under the ROOT layout only, so it has no sidebar. The
// per-module files beside each module layout exist so a 404 raised inside
// Records still looks like Records.
export default function NotFound() {
  return <RecordNotFound />;
}
