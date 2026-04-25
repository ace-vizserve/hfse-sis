'use client';

import * as React from 'react';
import { Workflow } from 'lucide-react';
import { ResponsiveContainer, Sankey, Tooltip } from 'recharts';

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { PipelineStage } from '@/lib/sis/dashboard';

type SankeyNode = { name: string };
type SankeyLink = { source: number; target: number; value: number };

/**
 * PipelineStageSankeyCard — recharts Sankey of applicant flow through pipeline
 * stages. Each node = one stage; each link's width = the count flowing from
 * the prior stage into the next. A thinning ribbon between stages = drop-off.
 *
 * Replaces the previous horizontal-bar PipelineStageChart (rated WEAK in the
 * Sprint 24 dashboard survey for not preserving stage ordering or showing
 * drop-off). recharts ships Sankey natively — no new dep.
 *
 * Click a node → fires onSegmentClick(stageName), which the drill wrapper
 * uses to open the `students-by-pipeline-stage` drill scoped to that stage.
 */
export function PipelineStageSankeyCard({
  data,
  onSegmentClick,
}: {
  data: PipelineStage[];
  onSegmentClick?: (stage: string) => void;
}) {
  // Build nodes + links. Each consecutive pair of stages becomes a link;
  // the link's value = the count at the later stage (the cohort that
  // "made it" forward). Stages with zero flow forward render a node but
  // no outgoing link, which is still readable in Sankey.
  const sankey = React.useMemo<{ nodes: SankeyNode[]; links: SankeyLink[] } | null>(() => {
    if (data.length < 2) return null;
    const nodes: SankeyNode[] = data.map((s) => ({ name: s.label || s.key }));
    const links: SankeyLink[] = [];
    for (let i = 0; i < data.length - 1; i += 1) {
      const v = Math.max(0, data[i + 1].count);
      if (v > 0) links.push({ source: i, target: i + 1, value: v });
    }
    return { nodes, links };
  }, [data]);

  const total = data.reduce((sum, s) => sum + s.count, 0);
  const empty = total === 0 || sankey === null || sankey.links.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Pipeline
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Stage flow
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Workflow className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex h-[340px] flex-col items-center justify-center gap-2 text-center">
            <Workflow className="size-6 text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">No applicant flow yet</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Stage flow appears once at least two stages have populated counts.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <Sankey
              data={sankey!}
              nodeWidth={12}
              nodePadding={24}
              linkCurvature={0.5}
              link={{ stroke: 'var(--color-chart-1)', strokeOpacity: 0.45 }}
              node={{ fill: 'var(--color-chart-1)', stroke: 'var(--color-border)' }}
              margin={{ top: 8, right: 100, bottom: 8, left: 8 }}
              onClick={
                onSegmentClick
                  ? ((nodeData: unknown) => {
                      const p = nodeData as { name?: string; payload?: { name?: string } };
                      const name = p?.payload?.name ?? p?.name;
                      if (name) onSegmentClick(name);
                    }) as never
                  : undefined
              }
            >
              <Tooltip
                contentStyle={{
                  background: 'var(--color-popover)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-md)',
                  fontSize: 11,
                }}
              />
            </Sankey>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
