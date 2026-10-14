import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { parseWebhookPayload, verifyIntuitSignature } from '@/lib/qbo/webhook';

describe('verifyIntuitSignature', () => {
  const body = '{"eventNotifications":[]}';
  const verifier = 'test-verifier';
  const good = createHmac('sha256', verifier).update(body).digest('base64');

  it('accepts the right signature', () => {
    expect(verifyIntuitSignature(body, good, verifier)).toBe(true);
  });
  it('refuses a wrong, missing or different-length signature', () => {
    expect(verifyIntuitSignature(body, 'AAAA', verifier)).toBe(false);
    expect(verifyIntuitSignature(body, null, verifier)).toBe(false);
    expect(verifyIntuitSignature(body + ' ', good, verifier)).toBe(false);
  });
});

describe('parseWebhookPayload', () => {
  it('reads the eventNotifications shape, Invoice and Payment only', () => {
    expect(
      parseWebhookPayload({
        eventNotifications: [
          {
            realmId: '9341',
            dataChangeEvent: {
              entities: [
                { name: 'Invoice', id: '130', operation: 'Update' },
                { name: 'Payment', id: '201', operation: 'Create' },
                { name: 'Customer', id: '58', operation: 'Update' },
              ],
            },
          },
        ],
      })
    ).toEqual([
      { entity: 'Invoice', id: '130', operation: 'Update' },
      { entity: 'Payment', id: '201', operation: 'Create' },
    ]);
  });

  it('reads the CloudEvents shape the same way', () => {
    expect(
      parseWebhookPayload([
        { type: 'qbo.invoice.voided.v1', intuitentityid: '130' },
        { type: 'qbo.payment.deleted.v1', intuitentityid: '201' },
        { type: 'qbo.customer.updated.v1', intuitentityid: '58' },
      ])
    ).toEqual([
      { entity: 'Invoice', id: '130', operation: 'voided' },
      { entity: 'Payment', id: '201', operation: 'deleted' },
    ]);
  });

  it('reads a single CloudEvent sent as one object', () => {
    expect(
      parseWebhookPayload({
        type: 'qbo.payment.created.v1',
        intuitentityid: '201',
      })
    ).toEqual([{ entity: 'Payment', id: '201', operation: 'created' }]);
  });

  it('returns nothing for junk', () => {
    expect(parseWebhookPayload(null)).toEqual([]);
    expect(parseWebhookPayload({ foo: 1 })).toEqual([]);
  });
});
