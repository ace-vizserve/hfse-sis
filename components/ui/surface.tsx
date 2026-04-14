import * as React from 'react';
import { cn } from '@/lib/utils';

type SurfaceProps = React.HTMLAttributes<HTMLDivElement> & {
  padded?: boolean;
};

export function Surface({
  className,
  padded = true,
  children,
  ...props
}: SurfaceProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-hairline bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_1px_3px_rgba(15,23,42,0.03)]',
        padded && 'p-6 md:p-8',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SurfaceHeader({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 border-b border-hairline px-6 py-5 md:px-8',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SurfaceTitle({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        'font-serif text-lg font-semibold tracking-tight text-ink',
        className,
      )}
      {...props}
    >
      {children}
    </h2>
  );
}

export function SurfaceDescription({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-sm text-ink-3', className)} {...props}>
      {children}
    </p>
  );
}
