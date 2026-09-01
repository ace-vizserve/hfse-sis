import type { Extensions } from '@tiptap/core';
import { TaskItem } from '@tiptap/extension-list/task-item';
import { TaskList } from '@tiptap/extension-list/task-list';
import StarterKit from '@tiptap/starter-kit';

/**
 * THE ONE SCHEMA. Imported by both the editor and the parsing helpers so that
 * what the toolbar can produce and what the parser will accept cannot drift.
 *
 * This list is also the app's HTML allow-list, and it is an allow-list by
 * construction rather than a blocklist somebody has to maintain: TipTap parses
 * incoming HTML against this schema, and a node or mark that is not defined
 * here has nowhere to be put, so it is dropped. That is what lets us render
 * stored HTML without adding DOMPurify — but it only holds while every parse
 * goes through THIS array. Do not build a second extension list.
 *
 * Deliberately absent, per the agreed feature set: text colour, highlight,
 * font family/size, tables, images, text alignment. Colour would breach
 * hard-rules.md #7 (tokens only), and it prints grey on the school's printer.
 *
 * `code` and `codeBlock` come with StarterKit and are switched off — this is a
 * school information system, not a developer tool.
 */
export const RICH_TEXT_EXTENSIONS: Extensions = [
  StarterKit.configure({
    code: false,
    codeBlock: false,

    // ONE heading level, not six. Long write-ups and incident reports get
    // section breaks; a 200-character note never needs an outline.
    heading: { levels: [3] },

    link: {
      // A link is opened from the read-only surfaces, never from inside the
      // editor — clicking in the editor should put the caret where you clicked.
      openOnClick: false,
      autolink: true,
      defaultProtocol: 'https',

      // THE ONE XSS VECTOR THE SCHEMA DOES NOT CLOSE BY ITSELF. `<a>` is an
      // allowed node, so a `javascript:` href would survive the parse on the
      // strength of the tag alone. The protocol has to be checked separately.
      protocols: ['http', 'https', 'mailto', 'tel'],
    },
  }),

  TaskList,

  // Flat checklists only. Nested tick-boxes inside a discipline record's
  // follow-up actions read as clutter, and they print badly.
  TaskItem.configure({ nested: false }),
];
