import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-indigo/25 disabled:pointer-events-none disabled:opacity-70 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-gradient-to-b from-brand-indigo to-brand-indigo-deep text-white shadow-button hover:from-brand-indigo-light hover:to-brand-indigo hover:shadow-button-hover active:translate-y-px active:shadow-button-active',
        destructive:
          'bg-gradient-to-b from-destructive to-destructive/80 text-white shadow-md transition-shadow hover:from-destructive/90 hover:to-destructive/70 hover:shadow-lg active:translate-y-px active:shadow-sm',
        warning:
          'bg-gradient-to-b from-brand-amber to-brand-amber/80 text-white shadow-md transition-shadow hover:from-brand-amber/90 hover:to-brand-amber/70 hover:shadow-lg active:translate-y-px active:shadow-sm',
        // §9.3 healthy state — pairs with Badge variant="success" (mint→sky
        // gradient + white text). Same craft as destructive/warning so the
        // healthy/warning/blocked trio renders consistently across the app.
        success:
          'bg-gradient-to-b from-brand-mint to-brand-sky text-white shadow-md transition-shadow hover:from-brand-mint/90 hover:to-brand-sky/90 hover:shadow-lg active:translate-y-px active:shadow-sm',
        outline:
          'border border-brand-indigo-soft/60 bg-accent/60 text-brand-indigo-deep shadow-input hover:border-brand-indigo-soft hover:bg-accent hover:text-brand-indigo-deep hover:shadow-sm',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-brand-indigo underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

type ButtonBaseProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

// `loading` is on the primitive rather than at the call site because
// 09a-design-patterns.md:210 says so: "if the treatment is reusable, promote it
// to the variant in components/ui/button.tsx". It was reusable — 83 files
// imported Loader2 and ~107 hand-rolled `disabled={busy}`, in four different
// idioms that disagreed about spinner size and whether the label changed.
//
// `asChild` and `loading` are mutually exclusive AT THE TYPE LEVEL: Slot
// renders exactly one child, so injecting a spinner beside it breaks at
// runtime. Better a compile error than a blank button.
export type ButtonProps = ButtonBaseProps &
  (
    | { asChild: true; loading?: never; loadingText?: never }
    | {
        asChild?: false;
        /** In flight. Shows a spinner, marks the button busy, blocks clicks. */
        loading?: boolean;
        /**
         * Replaces the label while loading. Keep the same verb — "Save" becomes
         * "Saving…", "Publish" becomes "Publishing…" — so the control keeps its
         * name through the whole action. Omit it to leave the label alone and
         * let the spinner carry the state.
         */
        loadingText?: React.ReactNode;
      }
  );

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (allProps, ref) => {
    const {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      loadingText,
      disabled,
      children,
      ...props
    } = allProps as ButtonBaseProps & {
      asChild?: boolean;
      loading?: boolean;
      loadingText?: React.ReactNode;
    };

    const classes = cn(buttonVariants({ variant, size, className }));

    if (asChild) {
      return (
        <Slot className={classes} ref={ref} {...props}>
          {children}
        </Slot>
      );
    }

    return (
      <button
        className={classes}
        ref={ref}
        // Announced to screen readers; the visual spinner is not.
        aria-busy={loading || undefined}
        // Matches what all ~107 hand-rolled sites already did, and the base
        // class already carries the look (disabled:opacity-70).
        //
        // Known trade, recorded rather than hidden: `disabled` removes the
        // button from the accessibility tree, so a screen reader loses focus
        // and never hears the aria-busy it was just given. The fix is
        // `aria-disabled` plus a click guard, which changes focus behaviour on
        // every button in the app — too much to bundle into this change.
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          // Size and spacing come from the base class ([&_svg]:size-4, gap-2),
          // which is the point: the four idioms this replaces used size-3.5,
          // size-4 and h-4 w-4 interchangeably.
          //
          // It keeps spinning under prefers-reduced-motion. A progress
          // indicator that has stopped reads as a hung button, and this is
          // status, not decoration — the motion IS the information.
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : null}
        {loading && loadingText !== undefined ? loadingText : children}
      </button>
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
