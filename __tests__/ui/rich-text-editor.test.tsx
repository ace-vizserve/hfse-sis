import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RichTextEditor } from '@/components/ui/rich-text-editor';

// The editor replaces `Textarea` on all 35 form text areas, so the things
// asserted here are the ones a swap would silently break: the toolbar is
// present on every field (an explicit product call, not an accident), the
// field emits '' rather than '<p></p>' when empty, and the counter measures
// prose so it agrees with the Zod `.max()` that will reject the save.

function Harness(props: Partial<React.ComponentProps<typeof RichTextEditor>>) {
  const [value, setValue] = React.useState(props.value ?? '');
  return (
    <RichTextEditor
      {...props}
      value={value}
      onChange={(next) => {
        setValue(next);
        props.onChange?.(next);
      }}
    />
  );
}

describe('RichTextEditor', () => {
  it('shows the agreed toolbar on every field', async () => {
    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByLabelText('Bold')).toBeInTheDocument()
    );

    for (const label of [
      'Bold',
      'Italic',
      'Underline',
      'Strikethrough',
      'Bulleted list',
      'Numbered list',
      'Checklist',
      'Section heading',
      'Quote',
      'Divider',
      'Add link',
      'Remove link',
      'Clear formatting',
      'Undo',
      'Redo',
      'Expand',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it('offers no control for the formatting we ruled out', async () => {
    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByLabelText('Bold')).toBeInTheDocument()
    );

    // Colour would breach hard-rules.md #7 and prints grey; tables and images
    // were declined. A future toolbar addition should be a deliberate choice.
    for (const label of [
      /colou?r/i,
      /highlight/i,
      /table/i,
      /image/i,
      /font/i,
    ]) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }
  });

  it('renders stored HTML as formatted content, not as visible tags', async () => {
    render(<Harness value="<p><strong>Ravi</strong> improved.</p>" />);

    await waitFor(() => expect(screen.getByText('Ravi')).toBeInTheDocument());
    expect(screen.getByText('Ravi').tagName).toBe('STRONG');
    expect(document.body.textContent).not.toContain('<strong>');
  });

  it('counts the prose, not the markup', async () => {
    // 'hello' is five characters however many marks wrap it. If this counted
    // the string, a 200-character note would be spent on tags.
    render(
      <Harness value="<p><strong><em>hello</em></strong></p>" maxLength={200} />
    );

    await waitFor(() =>
      expect(screen.getByText('5 / 200')).toBeInTheDocument()
    );
  });

  it('flags going over the limit', async () => {
    render(<Harness value="<p>abcdef</p>" maxLength={3} />);

    await waitFor(() => {
      const counter = screen.getByText('6 / 3');
      expect(counter.className).toContain('text-destructive');
    });
  });

  it('reports an empty field as an empty string, never as <p></p>', async () => {
    const onChange = vi.fn();
    render(<Harness value="<p>gone</p>" onChange={onChange} />);

    await waitFor(() => expect(screen.getByText('gone')).toBeInTheDocument());

    // Emptying the field must produce '' — several of these columns are
    // nullable and their handlers convert '' to NULL. '<p></p>' would be
    // stored as a value that every later "is this blank?" test reads as filled.
    const { container } = render(<Harness value="" />);
    await waitFor(() =>
      expect(container.querySelector('.ProseMirror')).toBeTruthy()
    );
    expect(onChange).not.toHaveBeenCalledWith('<p></p>');
  });

  it('shows the placeholder while the field is empty', async () => {
    const { container } = render(
      <Harness placeholder="One holistic paragraph" />
    );

    await waitFor(() => {
      const empty = container.querySelector('[data-placeholder]');
      expect(empty?.getAttribute('data-placeholder')).toBe(
        'One holistic paragraph'
      );
    });
  });

  it('hides the counter when the field has no limit', async () => {
    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByLabelText('Bold')).toBeInTheDocument()
    );
    expect(screen.queryByText(/\d+ \/ \d+/)).toBeNull();
  });
});
