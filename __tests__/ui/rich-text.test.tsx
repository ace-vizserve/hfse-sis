import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RichText } from '@/components/ui/rich-text';

// THE APP'S ONLY HTML SINK.
//
// `RichText` is the single component using dangerouslySetInnerHTML. The
// protection is that `normalizeRichText` re-parses the string against the same
// schema the editor writes with, so anything the schema cannot represent is
// dropped. These tests exist so that if someone ever "simplifies" the
// component by passing `html` straight through, the suite says so loudly.

describe('RichText', () => {
  it('renders the formatting a teacher applied', () => {
    const { container } = render(
      <RichText html="<p><strong>Ravi</strong> improved.</p>" />
    );
    expect(container.querySelector('strong')?.textContent).toBe('Ravi');
    expect(container.textContent).toBe('Ravi improved.');
  });

  it('renders a bulleted list as a list', () => {
    const { container } = render(
      <RichText html="<ul><li><p>Leads group work</p></li><li><p>Fluency</p></li></ul>" />
    );
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('drops a script tag rather than injecting it', () => {
    const { container } = render(
      <RichText html={'<p>hi</p><script>window.__pwned = true</script>'} />
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('__pwned');
  });

  it('drops an img onerror payload', () => {
    const { container } = render(
      <RichText html={'<p>a</p><img src=x onerror="window.__pwned=1">'} />
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('onerror');
  });

  it('strips a javascript: href but keeps the words', () => {
    const { container } = render(
      <RichText html={'<p><a href="javascript:alert(1)">click</a></p>'} />
    );
    expect(container.innerHTML).not.toContain('javascript:');
    expect(container.textContent).toBe('click');
  });

  it('drops an inline style', () => {
    const { container } = render(
      <RichText html={'<p><span style="color:#c00">urgent</span></p>'} />
    );
    expect(container.innerHTML).not.toContain('style=');
    expect(container.textContent).toBe('urgent');
  });

  it('renders text that predates the editor', () => {
    // Rows written before any of this hold bare sentences, not HTML.
    const { container } = render(<RichText html="Just a sentence." />);
    expect(container.textContent).toBe('Just a sentence.');
  });

  it('renders nothing for an empty field', () => {
    // A blank note must not leave a stray empty paragraph on the page.
    for (const value of [null, undefined, '', '<p></p>', '<p><br></p>']) {
      const { container } = render(<RichText html={value} />);
      expect(container.innerHTML).toBe('');
    }
  });

  it('adds the print adjustments only when asked', () => {
    const { container: plain } = render(<RichText html="<p>x</p>" />);
    const { container: printed } = render(<RichText html="<p>x</p>" print />);

    expect(plain.firstElementChild?.className).not.toContain('print:');
    expect(printed.firstElementChild?.className).toContain('print:');
  });
});
