/**
 * The Book list page's forms (plan 2026-10-28-books-supplies-tracker.md,
 * Phase 4): Add book / Add supply post the fields, a title is required, Edit
 * opens prefilled and PATCHes, and Remove asks first — refusing outright when
 * any student has been given the item.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AddBookListItemButton,
  BookListItemActions,
  type BookListItemTarget,
  type BookListLevel,
} from '@/components/admissions/book-list-item-sheet';
import { jsonResponse, stubFetch } from '../_utils/mock-fetch';
import { renderWithClient } from '../_utils/render-with-client';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admissions/book-list',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('sonner', async () => ({
  toast: (await import('../_utils/mock-toast')).createToastMock(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const P5: BookListLevel = {
  id: 'level-p5',
  label: 'Primary Five',
  levelType: 'primary',
};
const S1: BookListLevel = {
  id: 'level-s1',
  label: 'Secondary One',
  levelType: 'secondary',
};

type Call = { url: string; method: string; body: unknown };
function stubApi() {
  const calls: Call[] = [];
  stubFetch(async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return jsonResponse({ ok: true });
  });
  return calls;
}

const type = (label: RegExp | string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('Add book', () => {
  it('posts the book for the page’s level and track', async () => {
    const calls = stubApi();
    renderWithClient(
      <AddBookListItemButton
        kind="book"
        ayCode="AY2027"
        level={P5}
        subjects={[]}
        defaultTrack="Global"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add book' }));
    await screen.findByRole('dialog');

    // No subjects on the list yet → the subject is typed straight in.
    type('New subject', 'Science');
    type('Title', 'Science Activity Book 5A');
    type('Publisher', 'Star Publishing');
    type('ISBN', '978-981-1');
    fireEvent.click(screen.getByRole('button', { name: 'Add book' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      url: '/api/sis/supplies/items',
      method: 'POST',
      body: {
        kind: 'book',
        ay: 'AY2027',
        levelId: 'level-p5',
        subject: 'Science',
        title: 'Science Activity Book 5A',
        publisher: 'Star Publishing',
        isbn: '978-981-1',
        classType: 'Global',
      },
    });
  });

  it('needs a title, and sends nothing without one', async () => {
    const calls = stubApi();
    renderWithClient(
      <AddBookListItemButton
        kind="book"
        ayCode="AY2027"
        level={P5}
        subjects={['English']}
        defaultTrack={null}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add book' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Add book' }));
    expect(await screen.findByText('Enter the title.')).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('offers no track on a Secondary level — its books are for both', async () => {
    const calls = stubApi();
    renderWithClient(
      <AddBookListItemButton
        kind="book"
        ayCode="AY2027"
        level={S1}
        subjects={[]}
        defaultTrack={null}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add book' }));
    await screen.findByRole('dialog');
    expect(screen.queryByText('Which classes get it')).toBeNull();
    type('Title', 'Maths 1');
    fireEvent.click(screen.getByRole('button', { name: 'Add book' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toMatchObject({ classType: null, subject: null });
  });
});

describe('Add supply', () => {
  it('posts a title and who it is for', async () => {
    const calls = stubApi();
    renderWithClient(
      <AddBookListItemButton
        kind="supply"
        ayCode="AY2027"
        level={P5}
        subjects={[]}
        defaultTrack={null}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add supply' }));
    await screen.findByRole('dialog');
    expect(screen.queryByLabelText('Publisher')).toBeNull();
    type('Title', 'YS Kit');
    fireEvent.click(screen.getByRole('radio', { name: 'Youngstarters only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add supply' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({
      kind: 'supply',
      ay: 'AY2027',
      title: 'YS Kit',
      youngstartersOnly: true,
    });
  });
});

const BOOK: BookListItemTarget = {
  id: 'item-1',
  kind: 'book',
  title: 'Grammar P5',
  subject: 'English',
  publisher: 'Star',
  isbn: '978-1',
  classType: null,
  levelId: 'level-p5',
  handedOver: 0,
};

function renderActions(item: BookListItemTarget) {
  return renderWithClient(
    <BookListItemActions
      item={item}
      ayCode="AY2027"
      level={P5}
      subjects={['English', 'Mathematics']}
    />
  );
}

/** Opens the row's actions menu and picks one. */
async function pick(item: 'Edit' | 'Remove') {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole('button', { name: 'Actions for Grammar P5' })
  );
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

describe('a row’s Edit and Remove', () => {
  it('Edit opens prefilled and PATCHes the item', async () => {
    const calls = stubApi();
    renderActions(BOOK);
    await pick('Edit');
    await screen.findByRole('dialog');
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(
      'Grammar P5'
    );
    expect(screen.getByRole('radio', { name: 'Both' })).toHaveProperty(
      'ariaChecked',
      'true'
    );
    type('Title', 'Grammar P5 (2nd ed.)');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      url: '/api/sis/supplies/items/item-1',
      method: 'PATCH',
      body: {
        kind: 'book',
        subject: 'English',
        title: 'Grammar P5 (2nd ed.)',
        publisher: 'Star',
        isbn: '978-1',
        classType: null,
      },
    });
  });

  it('Remove asks first, then DELETEs', async () => {
    const calls = stubApi();
    renderActions(BOOK);
    await pick('Remove');
    expect(await screen.findByText('Remove Grammar P5?')).toBeTruthy();
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      url: '/api/sis/supplies/items/item-1',
      method: 'DELETE',
    });
  });

  it('Remove is refused once a student has been given the item', async () => {
    const calls = stubApi();
    renderActions({ ...BOOK, handedOver: 2 });
    await pick('Remove');
    expect(
      await screen.findByText(
        /2 students have been given this; edit it instead/
      )
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    // "Edit it" swaps the confirm for the drawer — never one inside the other.
    fireEvent.click(screen.getByRole('button', { name: 'Edit it' }));
    expect(await screen.findByText('Edit book')).toBeTruthy();
    expect(calls).toEqual([]);
  });
});
