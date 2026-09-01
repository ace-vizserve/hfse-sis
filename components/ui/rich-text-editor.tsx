'use client';

import * as React from 'react';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import {
  Bold,
  ChevronsDownUp,
  ChevronsUpDown,
  Eraser,
  Heading,
  Italic,
  Link2,
  Link2Off,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from 'lucide-react';

import { RICH_TEXT_EXTENSIONS, textFromDoc } from '@/lib/rich-text';
import { RICH_TEXT_PROSE_CLASS } from '@/lib/rich-text/prose';
import { cn } from '@/lib/utils';

import { Button } from './button';
import { Input } from './input';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Separator } from './separator';
import { Toggle } from './toggle';

/**
 * THE MULTI-LINE TEXT INPUT FOR THE WHOLE APP.
 *
 * Replaces `Textarea` everywhere. The toolbar shows on every field, short
 * confirm boxes included — that was an explicit call, so do not reintroduce a
 * "toolbar only on the long fields" variant.
 *
 * Two design decisions worth knowing before you change the layout:
 *
 * 1. The toolbar sits on `bg-muted/40` with a hairline under it, because in
 *    this design system that pairing already means "header row of a data
 *    surface" (09-design-system.md §3.1). The toolbar is the header row of a
 *    text surface, so it borrows the meaning rather than inventing one.
 *
 * 2. **Expand grows the field in place; it is NOT a full-screen dialog.** Most
 *    of these boxes already live inside a Dialog or a Sheet, and several sit in
 *    an AlertDialog nested inside a Sheet. A dialog here would be a dialog
 *    inside a dialog, which this project does not do.
 *
 * Emits `''` for an empty field, never `'<p></p>'`. Call sites that need NULL
 * keep whatever `orNull`-style wrapper they already use with `Textarea`.
 */
export interface RichTextEditorProps {
  value: string | null | undefined;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  /** The field's own cap. Shows a counter and turns it red when exceeded. */
  maxLength?: number;
  /** Matches `Textarea`'s `rows` so a swap keeps the field the same height. */
  rows?: number;
  disabled?: boolean;
  /** Opt in to local draft recovery. Use a key unique to the record + field. */
  draftKey?: string;
  id?: string;
  className?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'aria-label'?: string;
}

/** `Textarea` renders ~20px a row over 12px of vertical padding. */
function minHeightForRows(rows: number): number {
  return Math.max(rows, 2) * 20 + 24;
}

function ToolbarButton({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Toggle
      size="sm"
      pressed={active ?? false}
      disabled={disabled}
      aria-label={label}
      title={label}
      // The editor loses its selection the moment the button takes focus, so
      // formatting would apply to nothing.
      onMouseDown={(e) => e.preventDefault()}
      onPressedChange={onClick}
      className="size-7 min-w-7 p-0 text-ink-3 hover:text-foreground"
    >
      <Icon className="size-3.5" />
    </Toggle>
  );
}

function ToolbarDivider() {
  return (
    <Separator orientation="vertical" className="mx-0.5 h-4 self-center" />
  );
}

export function RichTextEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  maxLength,
  rows = 3,
  disabled = false,
  draftKey,
  id,
  className,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  'aria-label': ariaLabel,
}: RichTextEditorProps) {
  const [expanded, setExpanded] = React.useState(false);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [linkDraft, setLinkDraft] = React.useState('');
  const [recoverable, setRecoverable] = React.useState<string | null>(null);

  const editor = useEditor({
    extensions: [
      ...RICH_TEXT_EXTENSIONS,
      Placeholder.configure({ placeholder: placeholder ?? '' }),
    ],
    content: value ?? '',
    editable: !disabled,
    // Next.js renders this on the server first; without this the editor and
    // the server markup disagree and React throws a hydration error.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: cn(
          RICH_TEXT_PROSE_CLASS,
          'w-full px-3 py-2 outline-none',
          'overflow-y-auto'
        ),
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
        ...(ariaDescribedBy ? { 'aria-describedby': ariaDescribedBy } : {}),
      },
    },
    onUpdate: ({ editor: e }) => {
      onChange(textFromDoc(e.getJSON()).trim() === '' ? '' : e.getHTML());
    },
    onBlur: () => onBlur?.(),
  });

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      return {
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        bulletList: e.isActive('bulletList'),
        orderedList: e.isActive('orderedList'),
        taskList: e.isActive('taskList'),
        heading: e.isActive('heading', { level: 3 }),
        blockquote: e.isActive('blockquote'),
        link: e.isActive('link'),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        length: textFromDoc(e.getJSON()).trim().length,
      };
    },
  });

  // Follow the value when the form resets or the record is switched. Guarded
  // on inequality, or every keystroke would reset the caret to the start.
  React.useEffect(() => {
    if (!editor) return;
    const next = value ?? '';
    if (next === editor.getHTML()) return;
    if (next === '' && editor.isEmpty) return;
    editor.commands.setContent(next, { emitUpdate: false });
  }, [editor, value]);

  React.useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  // ── Draft recovery ──────────────────────────────────────────────────────
  // The evaluation roster saves only when the teacher presses Save, so a
  // browser that dies twenty minutes into a write-up loses all of it. The
  // draft is offered, never silently applied — quietly overwriting what the
  // server already holds would be worse than losing the draft.
  React.useEffect(() => {
    if (!draftKey || typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(draftKey);
      if (stored && stored !== (value ?? '')) setRecoverable(stored);
    } catch {
      // Private browsing, or site data blocked. A draft is a convenience.
    }
  }, [draftKey, value]);

  React.useEffect(() => {
    if (!draftKey || !editor || typeof window === 'undefined') return;
    const handle = window.setTimeout(() => {
      try {
        const html = editor.isEmpty ? '' : editor.getHTML();
        if (html === (value ?? '')) window.localStorage.removeItem(draftKey);
        else window.localStorage.setItem(draftKey, html);
      } catch {
        // As above — never let storage failure break typing.
      }
    }, 800);
    return () => window.clearTimeout(handle);
  }, [draftKey, editor, value, state?.length]);

  function applyLink() {
    if (!editor) return;
    const raw = linkDraft.trim();
    if (raw === '') return;
    // A bare "hfse.edu.sg" is what people type. Without a protocol the schema
    // treats it as a relative path and the link goes nowhere.
    const href = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    setLinkOpen(false);
    setLinkDraft('');
  }

  const overLimit = maxLength != null && (state?.length ?? 0) > maxLength;

  return (
    <div className={cn('w-full', className)}>
      <div
        data-slot="rich-text-editor"
        aria-invalid={ariaInvalid}
        className={cn(
          'w-full overflow-hidden rounded-md border border-hairline bg-background shadow-input transition-all',
          'hover:border-hairline-strong',
          'focus-within:border-brand-indigo/60 focus-within:shadow-sm focus-within:ring-2 focus-within:ring-brand-indigo/20',
          'aria-[invalid=true]:border-destructive/60 aria-[invalid=true]:focus-within:ring-destructive/30',
          disabled && 'cursor-not-allowed bg-muted/60 opacity-70'
        )}
      >
        <div className="flex flex-wrap items-center gap-0.5 border-b border-hairline bg-muted/40 px-1.5 py-1">
          <ToolbarButton
            icon={Bold}
            label="Bold"
            active={state?.bold}
            disabled={disabled}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          />
          <ToolbarButton
            icon={Italic}
            label="Italic"
            active={state?.italic}
            disabled={disabled}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          />
          <ToolbarButton
            icon={Underline}
            label="Underline"
            active={state?.underline}
            disabled={disabled}
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
          />
          <ToolbarButton
            icon={Strikethrough}
            label="Strikethrough"
            active={state?.strike}
            disabled={disabled}
            onClick={() => editor?.chain().focus().toggleStrike().run()}
          />

          <ToolbarDivider />

          <ToolbarButton
            icon={List}
            label="Bulleted list"
            active={state?.bulletList}
            disabled={disabled}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          />
          <ToolbarButton
            icon={ListOrdered}
            label="Numbered list"
            active={state?.orderedList}
            disabled={disabled}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          />
          <ToolbarButton
            icon={ListChecks}
            label="Checklist"
            active={state?.taskList}
            disabled={disabled}
            onClick={() => editor?.chain().focus().toggleTaskList().run()}
          />

          <ToolbarDivider />

          <ToolbarButton
            icon={Heading}
            label="Section heading"
            active={state?.heading}
            disabled={disabled}
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 3 }).run()
            }
          />
          <ToolbarButton
            icon={Quote}
            label="Quote"
            active={state?.blockquote}
            disabled={disabled}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          />
          <ToolbarButton
            icon={Minus}
            label="Divider"
            disabled={disabled}
            onClick={() => editor?.chain().focus().setHorizontalRule().run()}
          />

          <ToolbarDivider />

          <Popover open={linkOpen} onOpenChange={setLinkOpen}>
            <PopoverTrigger asChild>
              <Toggle
                size="sm"
                pressed={state?.link ?? false}
                disabled={disabled}
                aria-label="Add link"
                title="Add link"
                onMouseDown={(e) => e.preventDefault()}
                className="size-7 min-w-7 p-0 text-ink-3 hover:text-foreground"
              >
                <Link2 className="size-3.5" />
              </Toggle>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-2">
              <div className="flex items-center gap-1.5">
                <Input
                  value={linkDraft}
                  onChange={(e) => setLinkDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      applyLink();
                    }
                  }}
                  placeholder="Paste or type a web address"
                  className="h-8 text-sm"
                  autoFocus
                />
                <Button size="sm" className="h-8" onClick={applyLink}>
                  Add
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <ToolbarButton
            icon={Link2Off}
            label="Remove link"
            disabled={disabled || !state?.link}
            onClick={() => editor?.chain().focus().unsetLink().run()}
          />
          <ToolbarButton
            icon={Eraser}
            label="Clear formatting"
            disabled={disabled}
            onClick={() =>
              editor?.chain().focus().unsetAllMarks().clearNodes().run()
            }
          />

          <ToolbarDivider />

          <ToolbarButton
            icon={Undo2}
            label="Undo"
            disabled={disabled || !state?.canUndo}
            onClick={() => editor?.chain().focus().undo().run()}
          />
          <ToolbarButton
            icon={Redo2}
            label="Redo"
            disabled={disabled || !state?.canRedo}
            onClick={() => editor?.chain().focus().redo().run()}
          />

          <div className="ml-auto">
            <ToolbarButton
              icon={expanded ? ChevronsDownUp : ChevronsUpDown}
              label={expanded ? 'Collapse' : 'Expand'}
              disabled={disabled}
              onClick={() => setExpanded((v) => !v)}
            />
          </div>
        </div>

        {recoverable !== null && (
          <div className="flex flex-wrap items-center gap-2 border-b border-hairline bg-accent px-3 py-1.5">
            <span className="text-[13px] text-accent-foreground">
              You have unsaved changes from an earlier visit.
            </span>
            <div className="ml-auto flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={() => {
                  editor?.commands.setContent(recoverable);
                  onChange(recoverable);
                  setRecoverable(null);
                }}
              >
                Restore them
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={() => {
                  try {
                    if (draftKey) window.localStorage.removeItem(draftKey);
                  } catch {
                    // Nothing to do — the notice goes away either way.
                  }
                  setRecoverable(null);
                }}
              >
                Discard
              </Button>
            </div>
          </div>
        )}

        <EditorContent
          editor={editor}
          id={id}
          style={{
            minHeight: expanded ? '60vh' : minHeightForRows(rows),
            maxHeight: expanded ? '60vh' : undefined,
          }}
          className={cn(
            'w-full overflow-y-auto',
            // Placeholder styling matches the Textarea it replaces.
            '[&_.is-editor-empty:first-child::before]:pointer-events-none',
            '[&_.is-editor-empty:first-child::before]:float-left',
            '[&_.is-editor-empty:first-child::before]:h-0',
            '[&_.is-editor-empty:first-child::before]:text-ink-5',
            '[&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]'
          )}
        />
      </div>

      {maxLength != null && (
        <p
          className={cn(
            'mt-1 text-right font-mono text-[10px] tracking-wider tabular-nums',
            overLimit ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {(state?.length ?? 0).toLocaleString()} / {maxLength.toLocaleString()}
        </p>
      )}
    </div>
  );
}
