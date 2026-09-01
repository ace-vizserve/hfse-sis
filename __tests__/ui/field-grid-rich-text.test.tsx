import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FieldGrid, type Field } from '@/components/sis/field-grid';

/**
 * `FieldGrid` shows two KINDS of multi-line text side by side on the same
 * profile panel, and telling them apart is the whole point of these tests.
 *
 *  - `multiline` — the medical boxes. A parent typed them into the external
 *    application form; they never pass through our editor, they are plain, and
 *    `whitespace-pre-line` is what makes their line breaks show.
 *  - `richText` — home address and the two learning-needs boxes. Staff edit
 *    these with the formatting editor on `edit-profile-sheet`, so the column
 *    holds HTML. Printed as text they showed a staff member the `<p>` tags
 *    around their own address.
 *
 * ⚠ If someone marks a plain field `richText` the value still renders (a bare
 * sentence parses to one paragraph), so nothing breaks loudly. The failure is
 * the other way round — a rich field left on `multiline`, which is what these
 * tests are here to keep from coming back.
 */

function renderFields(fields: Field[]) {
  return render(<FieldGrid fields={fields} />);
}

describe('FieldGrid — richText fields', () => {
  it('renders the formatting instead of printing the tags', () => {
    const { container } = renderFields([
      {
        label: 'Home address',
        value: '<p>12 Orchard Road</p><p><strong>#04-01</strong></p>',
        wide: true,
        richText: true,
      },
    ]);

    expect(container.querySelector('strong')?.textContent).toBe('#04-01');
    expect(container.textContent).not.toContain('<p>');
  });

  it('renders a list a staff member typed as a list', () => {
    const { container } = renderFields([
      {
        label: 'Additional learning needs',
        value:
          '<ul><li><p>Reading support</p></li><li><p>Extra time</p></li></ul>',
        richText: true,
      },
    ]);

    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('shows the em-dash for an editor that was opened and cleared', () => {
    // ⚠ `<p></p>` is seven truthy characters, so the plain emptiness test read
    // it as a filled-in field and printed it. `isEmptyRichText` is the test
    // that agrees with the report-card publish gate.
    renderFields([
      { label: 'Other learning needs', value: '<p></p>', richText: true },
    ]);

    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('drops the pre-line rule, which would double every gap', () => {
    // Real `<p>` elements already carry the break. Leaving `whitespace-pre-line`
    // on top of them adds a second one for the newline in the source.
    const { container } = renderFields([
      {
        label: 'Home address',
        value: '<p>a</p><p>b</p>',
        multiline: true,
        richText: true,
      },
    ]);

    const dd = container.querySelector('dd');
    expect(dd?.className).not.toContain('whitespace-pre-line');
  });
});

describe('FieldGrid — plain multiline fields are left alone', () => {
  it('keeps pre-line for a parent-supplied medical box', () => {
    const { container } = renderFields([
      {
        label: 'Allergy details',
        value: 'Peanuts\nShellfish',
        multiline: true,
      },
    ]);

    const dd = container.querySelector('dd');
    expect(dd?.className).toContain('whitespace-pre-line');
    expect(dd?.textContent).toBe('Peanuts\nShellfish');
  });
});
