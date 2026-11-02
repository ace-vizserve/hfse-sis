'use client';

import { FileDown, ImagePlus, PenLine, Plus, Rows2, Type } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// The builder's tools, beside the selected card on wide screens and pinned to
// the bottom of the canvas on narrow ones.

export type ToolbarActions = {
  addQuestion: () => void;
  copyFromEvent: () => void;
  addInfo: () => void;
  addPicture: () => void;
  addSignature: () => void;
  addSection: () => void;
  signatureDisabled: boolean;
};

function Tool({
  label,
  onClick,
  disabled,
  primary,
  side,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  side: 'left' | 'top';
  children: React.ReactNode;
}) {
  const button = (
    <Button
      type="button"
      variant={primary ? 'default' : 'outline'}
      size="icon"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? (
          // A disabled button swallows pointer events, so the span carries the tooltip.
          <span tabIndex={0} className="inline-flex">
            {button}
          </span>
        ) : (
          button
        )}
      </TooltipTrigger>
      <TooltipContent side={side}>
        {disabled && label === 'Add e-signature'
          ? 'The form already has an e-signature'
          : label}
      </TooltipContent>
    </Tooltip>
  );
}

export function FloatingToolbar({
  actions,
  layout,
}: {
  actions: ToolbarActions;
  /** 'side': beside a card (wide screens). 'bar': pinned row (narrow). */
  layout: 'side' | 'bar';
}) {
  const side = layout === 'side' ? 'left' : 'top';
  return (
    <div
      role="toolbar"
      aria-label="Add to the form"
      aria-orientation={layout === 'side' ? 'vertical' : 'horizontal'}
      data-slot="builder-toolbar"
      className={cn(
        'z-20 items-center gap-1.5 rounded-xl border border-border bg-card p-1.5 shadow-md',
        layout === 'side'
          ? 'absolute top-0 left-full ml-4 hidden flex-col xl:flex'
          : 'sticky bottom-4 flex self-center xl:hidden'
      )}
    >
      <Tool
        label="Add question"
        primary
        side={side}
        onClick={actions.addQuestion}
      >
        <Plus />
      </Tool>
      <Tool
        label="Copy from another event"
        side={side}
        onClick={actions.copyFromEvent}
      >
        <FileDown />
      </Tool>
      <Tool label="Add info text" side={side} onClick={actions.addInfo}>
        <Type />
      </Tool>
      <Tool label="Add picture" side={side} onClick={actions.addPicture}>
        <ImagePlus />
      </Tool>
      <Tool
        label="Add e-signature"
        side={side}
        disabled={actions.signatureDisabled}
        onClick={actions.addSignature}
      >
        <PenLine />
      </Tool>
      <Tool label="Add section" side={side} onClick={actions.addSection}>
        <Rows2 />
      </Tool>
    </div>
  );
}
