import * as React from 'react';
import { cn } from '@/lib/utils';

type PageHeaderVariant = 'default' | 'hero';

type PageHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  variant?: PageHeaderVariant;
  className?: string;
};

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  variant = 'default',
  className,
}: PageHeaderProps) {
  const isHero = variant === 'hero';

  return (
    <header
      className={cn(
        'flex flex-col gap-5 md:flex-row md:items-end md:justify-between',
        isHero ? 'pb-2' : 'border-b border-hairline pb-6',
        className,
      )}
    >
      <div className={cn('space-y-3', isHero && 'space-y-4')}>
        {eyebrow && (
          <span
            className={cn(
              'inline-flex items-center text-[11px] font-semibold uppercase tracking-[0.14em]',
              isHero
                ? 'text-ink-4'
                : 'rounded-full border border-hairline bg-white px-3 py-1 text-ink-4 shadow-input',
            )}
          >
            {eyebrow}
          </span>
        )}
        <h1
          className={cn(
            'font-serif font-semibold tracking-tight text-ink',
            isHero
              ? 'text-[38px] leading-[1.05] md:text-[44px]'
              : 'text-3xl leading-tight md:text-[2rem]',
          )}
        >
          {title}
        </h1>
        {description && (
          <p
            className={cn(
              'max-w-2xl leading-relaxed text-ink-3',
              isHero ? 'text-[15px]' : 'text-sm',
            )}
          >
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
