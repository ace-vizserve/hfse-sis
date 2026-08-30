import { cn } from '@/lib/utils';

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // `bg-accent` (not `bg-white`) — hard rule #7 bans `bg-white` in
        // `app/` and `components/`, and `--accent` is one of the few fill
        // tokens with a real `.dark` override, so the placeholder stays
        // visible on both canvases without the component branching on theme.
        // The former `from-muted via-muted/60 to-muted` were inert: nothing
        // ever set `bg-gradient-*` to activate them.
        'animate-pulse rounded-md border border-hairline bg-accent',
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
