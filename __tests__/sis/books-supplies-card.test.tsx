/**
 * The books & supplies checklist on the Supplies stage tile: the tile shows
 * the count and opens the list in a sheet; a tick POSTs the item, "Tick all"
 * sends only the group's ungiven items, read-only disables every checkbox,
 * and a student with no class gets the one-liner. A failed tick rolls back
 * and toasts.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SuppliesChecklist } from '@/components/sis/books-supplies-card';
import type { StudentSupplies } from '@/lib/sis/supplies/types';
import { jsonResponse, stubFetch } from '../_utils/mock-fetch';
import { renderWithClient } from '../_utils/render-with-client';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admissions/applications/E1',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('sonner', async () => ({
  toast: {
    ...(await import('../_utils/mock-toast')).createToastMock(),
    error: toastError,
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const GIVEN = { at: '2027-01-12T02:00:00.000Z', byName: 'Ms Wynne' };

const LIST: StudentSupplies = {
  groups: [
    {
      name: 'English',
      kind: 'book',
      items: [
        {
          id: 'b1',
          title: 'Grammar Workbook P3',
          meta: 'Marshall Cavendish · 9789810115968',
          given: GIVEN,
        },
        { id: 'b2', title: 'Fantastic Mr Fox', meta: null, given: null },
        { id: 'b3', title: 'BFG', meta: null, given: null },
      ],
    },
    {
      name: 'Supplies',
      kind: 'supply',
      items: [{ id: 's1', title: 'Exam pad', meta: null, given: null }],
    },
  ],
};

type Call = { url: string; method: string; body: unknown };

function stubApi(
  get: StudentSupplies,
  post?: (body: unknown) => Response | Promise<Response>
) {
  const calls: Call[] = [];
  const fetchMock = stubFetch(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, body });
    if (method === 'POST') return post ? post(body) : jsonResponse(get);
    return jsonResponse(get);
  });
  return { calls, fetchMock };
}

// Renders the tile's checklist and opens its sheet — the list lives there.
async function renderCard(canEdit = true) {
  const r = renderWithClient(
    <SuppliesChecklist ayCode="AY2027" enroleeNumber="E1" canEdit={canEdit} />
  );
  fireEvent.click(
    await screen.findByRole('button', { name: /Books & supplies/ })
  );
  await screen.findByRole('dialog');
  return r;
}

// The count shows twice once the sheet is open: on the tile and in the sheet.
const count = (text: string) => screen.getAllByText(text)[0];

function group(name: string) {
  return screen.getByRole('region', { name });
}

describe('SuppliesChecklist', () => {
  it('shows the count on the tile and the groups in the sheet', async () => {
    const { calls } = stubApi(LIST);
    await renderCard();

    expect(count('1 of 4 given')).toBeTruthy();
    expect(calls[0].url).toBe('/api/sis/students/E1/supplies?ay=AY2027');
    expect(within(group('English')).getByText('1 of 3')).toBeTruthy();
    expect(within(group('Supplies')).getByText('0 of 1')).toBeTruthy();
    expect(screen.getByText('Marshall Cavendish · 9789810115968')).toBeTruthy();
    expect(screen.getByText('Given 12 Jan · Ms Wynne')).toBeTruthy();
  });

  it('ticking an item POSTs it as given', async () => {
    // The POST never answers, so what shows is the optimistic tick alone.
    const { calls } = stubApi(LIST, () => new Promise<Response>(() => {}));
    await renderCard();

    const box = await screen.findByRole('checkbox', {
      name: /Fantastic Mr Fox/,
    });
    fireEvent.click(box);

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST')).toBe(true)
    );
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/sis/students/E1/supplies');
    expect(post.body).toEqual({ ay: 'AY2027', itemIds: ['b2'], given: true });
    // Optimistic: the count moves before the server answers.
    expect(count('2 of 4 given')).toBeTruthy();
  });

  it('unticking a given item POSTs given: false', async () => {
    const { calls } = stubApi(LIST);
    await renderCard();

    fireEvent.click(
      await screen.findByRole('checkbox', { name: /Grammar Workbook P3/ })
    );
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST')).toBe(true)
    );
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      ay: 'AY2027',
      itemIds: ['b1'],
      given: false,
    });
  });

  it("Tick all sends only the group's ungiven items", async () => {
    const { calls } = stubApi(LIST);
    await renderCard();

    fireEvent.click(
      within(group('English')).getByRole('button', { name: /Tick all/ })
    );

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST')).toBe(true)
    );
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      ay: 'AY2027',
      itemIds: ['b2', 'b3'],
      given: true,
    });
  });

  it('rolls back and toasts when a tick fails', async () => {
    stubApi(LIST, () =>
      jsonResponse(
        { error: "Some of these items are not on this student's list." },
        400
      )
    );
    await renderCard();

    fireEvent.click(
      await screen.findByRole('checkbox', { name: /Fantastic Mr Fox/ })
    );

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toMatch(/not on this student's list/);
    expect(count('1 of 4 given')).toBeTruthy();
    expect(
      screen
        .getByRole('checkbox', { name: /Fantastic Mr Fox/ })
        .getAttribute('data-state')
    ).toBe('unchecked');
  });

  it('read-only disables every checkbox and offers no Tick all', async () => {
    stubApi(LIST);
    await renderCard(false);

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(4);
    for (const b of boxes) expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /Tick all/ })).toBeNull();
  });

  it('hides Tick all on a group whose items are all given', async () => {
    stubApi({
      groups: [
        {
          name: 'Supplies',
          kind: 'supply',
          items: [{ id: 's1', title: 'Exam pad', meta: null, given: GIVEN }],
        },
      ],
    });
    await renderCard();

    expect(count('1 of 1 given')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Tick all/ })).toBeNull();
  });

  it('shows the one-liner when the student has no class', async () => {
    stubApi({ needsClass: true });
    renderWithClient(
      <SuppliesChecklist ayCode="AY2027" enroleeNumber="E1" canEdit />
    );

    expect(
      await screen.findByText(
        "Assign a class to see this student's books and supplies."
      )
    ).toBeTruthy();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});
