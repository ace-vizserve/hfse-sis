import type { DocumentStatus } from "./document-config";

// Slot triage used by both the "Action queue" panel + the in-section sort
// on the student-detail page. Lower urgency rank = more urgent. Ties are
// broken by expiry (sooner-first), then by slot key for stability.

export type SlotUrgencyInput = {
  key: string;
  status: DocumentStatus;
  expiryDate: string | null;
};

export type SlotUrgencyKind =
  | "expired"
  | "rejected"
  | "missing"
  | "expiring-30"
  | "expiring-60"
  | "expiring-90"
  | "uploaded"
  | "to-follow"
  | "valid"
  | "na";

const RANK: Record<SlotUrgencyKind, number> = {
  expired: 0,
  rejected: 1,
  missing: 2,
  "expiring-30": 3,
  "expiring-60": 4,
  "expiring-90": 5,
  uploaded: 6,
  "to-follow": 7,
  valid: 8,
  na: 9,
};

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target - today.getTime()) / 86_400_000);
}

export function classifyUrgency(slot: SlotUrgencyInput): SlotUrgencyKind {
  if (slot.status === "expired") return "expired";
  if (slot.status === "rejected") return "rejected";
  if (slot.status === "missing") return "missing";
  if (slot.status === "uploaded") return "uploaded";
  if (slot.status === "na") return "na";
  if (slot.status === "valid" && slot.expiryDate) {
    const days = daysUntil(slot.expiryDate);
    if (days !== null && days >= 0) {
      if (days <= 30) return "expiring-30";
      if (days <= 60) return "expiring-60";
      if (days <= 90) return "expiring-90";
    }
  }
  return "valid";
}

export function rankUrgency(slot: SlotUrgencyInput): number {
  const kind = classifyUrgency(slot);
  return RANK[kind];
}

// Sort comparator — most urgent first.
export function compareSlotsByUrgency(a: SlotUrgencyInput, b: SlotUrgencyInput): number {
  const ra = rankUrgency(a);
  const rb = rankUrgency(b);
  if (ra !== rb) return ra - rb;
  // Tiebreak by expiry (sooner = more urgent).
  const da = daysUntil(a.expiryDate);
  const db = daysUntil(b.expiryDate);
  if (da !== null && db !== null && da !== db) return da - db;
  if (da !== null && db === null) return -1;
  if (da === null && db !== null) return 1;
  return a.key.localeCompare(b.key);
}

export function isActionable(kind: SlotUrgencyKind): boolean {
  return (
    kind === "expired" ||
    kind === "rejected" ||
    kind === "missing" ||
    kind === "expiring-30" ||
    kind === "expiring-60"
  );
}

// Short human-facing descriptor used by both the Action queue rows and
// the urgency badge near each slot card. Falls back to a status verb
// when no expiry math applies.
export function urgencyDescriptor(slot: SlotUrgencyInput): string {
  const kind = classifyUrgency(slot);
  const days = daysUntil(slot.expiryDate);
  switch (kind) {
    case "expired":
      if (days !== null && days < 0) {
        const overdue = Math.abs(days);
        return `Expired ${overdue} day${overdue === 1 ? "" : "s"} ago`;
      }
      return "Expired";
    case "rejected":
      return "Rejected — needs replacement";
    case "missing":
      return "Missing — never uploaded";
    case "expiring-30":
      if (days === 0) return "Expires today";
      return `Expires in ${days} day${days === 1 ? "" : "s"}`;
    case "expiring-60":
      return `Expires in ${days} days`;
    case "expiring-90":
      return `Expires in ${days} days`;
    case "uploaded":
      return "Awaiting registrar review";
    case "to-follow":
      return "Parent promised — pending re-upload";
    case "valid":
      return slot.expiryDate ? `Valid through ${slot.expiryDate}` : "On file";
    case "na":
      return "Not applicable";
  }
}
