import * as React from 'react';

export function AdviserCell({ name }: { name: string | null }) {
  if (!name) {
    return <span className="text-sm text-muted-foreground">Unassigned</span>;
  }
  return <span className="text-sm text-foreground">{name}</span>;
}
