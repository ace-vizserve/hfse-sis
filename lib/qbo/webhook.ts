import { createHmac, timingSafeEqual } from 'node:crypto';

export type ChangedEntity = {
  entity: 'Invoice' | 'Payment';
  id: string;
  operation: string;
};

/** Intuit signs the raw body: base64(HMAC-SHA256(verifier token, body)). */
export function verifyIntuitSignature(
  rawBody: string,
  signature: string | null,
  verifier: string
): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', verifier).update(rawBody).digest();
  const given = Buffer.from(signature, 'base64');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const ENTITY: Record<string, ChangedEntity['entity']> = {
  invoice: 'Invoice',
  payment: 'Payment',
};

/**
 * Both shapes Intuit sends: the long-standing `eventNotifications` body, and
 * the CloudEvents array (`type: "qbo.invoice.updated.v1"`, `intuitentityid`).
 * Only Invoice and Payment matter here; everything else is dropped.
 */
export function parseWebhookPayload(json: unknown): ChangedEntity[] {
  const out: ChangedEntity[] = [];
  if (Array.isArray(json)) {
    for (const ev of json as Array<Record<string, unknown>>) {
      const parts = String(ev?.type ?? '').split('.');
      const entity = ENTITY[parts[1] ?? ''];
      const id = String(ev?.intuitentityid ?? '');
      if (parts[0] === 'qbo' && entity && id) {
        out.push({ entity, id, operation: parts[2] ?? '' });
      }
    }
    return out;
  }
  const notes = (json as { eventNotifications?: unknown })?.eventNotifications;
  if (!Array.isArray(notes)) return out;
  for (const n of notes as Array<Record<string, any>>) {
    for (const e of n?.dataChangeEvent?.entities ?? []) {
      const entity = ENTITY[String(e?.name ?? '').toLowerCase()];
      if (entity && e?.id) {
        out.push({
          entity,
          id: String(e.id),
          operation: String(e.operation ?? ''),
        });
      }
    }
  }
  return out;
}
