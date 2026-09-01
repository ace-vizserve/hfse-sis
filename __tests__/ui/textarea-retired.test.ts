import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

// THE PLAIN TEXTAREA IS RETIRED. EVERY MULTI-LINE FIELD IS THE EDITOR.
//
// All 35 of them were swapped in one pass. The risk this guards is not that
// someone reverts a field — it is that the NEXT multi-line field, added months
// from now, reaches for `Textarea` because it is still sitting in
// `components/ui/` looking like a normal choice. One plain box among 35
// formatting ones is the kind of inconsistency nobody files a bug about and
// everybody notices.
//
// `components/ui/textarea.tsx` is deliberately kept rather than deleted: it is
// the shadcn primitive, and a future surface that genuinely wants an unstyled
// plain box (a paste-a-CSV target, say) should be able to reach for it — but
// deliberately, by removing itself from this list, not by accident.

function grep(pattern: string): string[] {
  try {
    return execFileSync(
      'git',
      ['grep', '-l', '-E', pattern, '--', 'app', 'components'],
      { encoding: 'utf8' }
    )
      .split('\n')
      .filter(Boolean);
  } catch {
    // git grep exits 1 when nothing matches, which is the passing case.
    return [];
  }
}

/**
 * Matching lines, minus the ones that only TALK about the pattern.
 *
 * Several of these files carry comments explaining why they are no longer a
 * textarea — `daily-entry.tsx` records that 30 editors on one screen would be
 * heavier than 30 plain boxes, which is exactly the note a future reader
 * needs. A guard that fails on its own explanation would get deleted, so
 * comment lines and backticked prose are dropped.
 */
function codeLines(pattern: string): string[] {
  try {
    return execFileSync(
      'git',
      ['grep', '-n', '-E', pattern, '--', 'app', 'components'],
      { encoding: 'utf8' }
    )
      .split('\n')
      .filter(Boolean)
      .filter((line) => {
        const code = line.slice(line.indexOf(':', line.indexOf(':') + 1) + 1);
        const trimmed = code.trim();
        if (trimmed.startsWith('*') || trimmed.startsWith('//')) return false;
        return !/`[^`]*<textarea/.test(code);
      });
  } catch {
    return [];
  }
}

describe('the plain Textarea is retired', () => {
  it('is imported by nothing', () => {
    expect(grep("from '@/components/ui/textarea'")).toEqual([]);
  });

  it('is rendered by nothing', () => {
    expect(grep('<Textarea[ />]')).toEqual([]);
  });

  it('has no hand-rolled raw <textarea> anywhere', () => {
    // The evaluation write-up was one of these for a long time, bypassing the
    // design system entirely (09-design-system.md §4.1 bans raw HTML controls
    // where a primitive exists).
    expect(
      codeLines('<textarea').filter(
        (line) => !line.startsWith('components/ui/textarea.tsx')
      )
    ).toEqual([]);
  });
});
