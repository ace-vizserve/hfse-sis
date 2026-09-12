/**
 * <DocumentChaseQueueStrip> now accepts an optional `counts` prop so a
 * caller that already fetched the same counts for its own CSV export (the
 * Admissions and Records dashboards) can hand them straight to the strip
 * instead of both the page and the strip separately calling
 * `getDocumentChaseQueueCounts` for the same (ayCode, lens) — that was two
 * real reads per render before this change.
 *
 * `getDocumentChaseQueueCounts` is mocked here (not the component under
 * test) so each assertion can prove which code path ran: supplying `counts`
 * must skip the loader entirely, and omitting it must still fall back to the
 * loader exactly as before (P-Files never pre-fetches and must keep working
 * unchanged).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const getDocumentChaseQueueCountsMock = vi.fn();

vi.mock('@/lib/sis/document-chase-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sis/document-chase-queue')>()),
  getDocumentChaseQueueCounts: (...args: unknown[]) =>
    getDocumentChaseQueueCountsMock(...args),
}));

import { DocumentChaseQueueStrip } from '@/components/sis/document-chase-queue-strip';
import {
  CHASE_TILE_ORDER,
  type DocumentChaseQueueCounts,
} from '@/lib/sis/document-chase-queue';

// The component under test returns a plain (already-resolved, since the
// component itself is the only async part) React element tree — walk its
// `props.children` chain collecting every string leaf, without needing a DOM
// renderer. Used to prove a tile's rendered label came from a specific
// source string rather than a hardcoded duplicate.
function collectStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const child of node) collectStrings(child, out);
  } else if (
    node &&
    typeof node === 'object' &&
    'props' in (node as Record<string, unknown>)
  ) {
    collectStrings(
      (node as { props?: { children?: unknown } }).props?.children,
      out
    );
  }
  return out;
}

const NOTHING_VISIBLE: DocumentChaseQueueCounts = {
  promised: 0,
  validation: 0,
  revalidation: 0,
  expiringSoon: 0,
};

const SOME_VISIBLE: DocumentChaseQueueCounts = {
  promised: 3,
  validation: 0,
  revalidation: 1,
  expiringSoon: 0,
};

beforeEach(() => {
  getDocumentChaseQueueCountsMock.mockReset();
});

describe('DocumentChaseQueueStrip', () => {
  it('renders from a supplied counts prop without calling the loader', async () => {
    const element = await DocumentChaseQueueStrip({
      ayCode: 'AY2026',
      lens: 'admissions',
      counts: SOME_VISIBLE,
    });
    expect(getDocumentChaseQueueCountsMock).not.toHaveBeenCalled();
    expect(element).not.toBeNull();
  });

  it('returns null from a supplied counts prop when nothing is visible for the lens', async () => {
    const element = await DocumentChaseQueueStrip({
      ayCode: 'AY2026',
      lens: 'admissions',
      counts: NOTHING_VISIBLE,
    });
    expect(getDocumentChaseQueueCountsMock).not.toHaveBeenCalled();
    expect(element).toBeNull();
  });

  it('falls back to its own fetch when no counts prop is supplied (P-Files path)', async () => {
    getDocumentChaseQueueCountsMock.mockResolvedValue(SOME_VISIBLE);
    const element = await DocumentChaseQueueStrip({
      ayCode: 'AY2026',
      lens: 'p-files',
    });
    expect(getDocumentChaseQueueCountsMock).toHaveBeenCalledTimes(1);
    expect(getDocumentChaseQueueCountsMock).toHaveBeenCalledWith(
      'AY2026',
      'p-files'
    );
    expect(element).not.toBeNull();
  });

  it('falls back to its own fetch and returns null when the self-fetched counts have nothing visible', async () => {
    getDocumentChaseQueueCountsMock.mockResolvedValue(NOTHING_VISIBLE);
    const element = await DocumentChaseQueueStrip({
      ayCode: 'AY2026',
      lens: 'p-files',
    });
    expect(getDocumentChaseQueueCountsMock).toHaveBeenCalledTimes(1);
    expect(element).toBeNull();
  });

  it('renders every tile label from the shared CHASE_TILE_ORDER list, not a private copy — a future edit to only one list would fail this', async () => {
    const labelFor = (target: string) =>
      CHASE_TILE_ORDER.find((t) => t.target === target)!.label;

    // Admissions lens shows revalidation + validation + promised (expiringSoon
    // is always zeroed for this lens).
    const admissionsElement = await DocumentChaseQueueStrip({
      ayCode: 'AY2026',
      lens: 'admissions',
      counts: {
        promised: 1,
        validation: 1,
        revalidation: 1,
        expiringSoon: 0,
      },
    });
    const admissionsText = collectStrings(admissionsElement);
    expect(admissionsText).toContain(
      labelFor('awaiting-document-revalidation')
    );
    expect(admissionsText).toContain(labelFor('awaiting-document-validation'));
    expect(admissionsText).toContain(labelFor('awaiting-promised-documents'));

    // P-Files lens shows revalidation + expiringSoon (validation + promised
    // are always zeroed for this lens) — covers the remaining tile.
    const pFilesElement = await DocumentChaseQueueStrip({
      ayCode: 'AY2026',
      lens: 'p-files',
      counts: {
        promised: 0,
        validation: 0,
        revalidation: 1,
        expiringSoon: 1,
      },
    });
    const pFilesText = collectStrings(pFilesElement);
    expect(pFilesText).toContain(labelFor('awaiting-document-revalidation'));
    expect(pFilesText).toContain(labelFor('awaiting-expiring-documents'));
  });
});
