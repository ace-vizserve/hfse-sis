'use client';

import Link from 'next/link';
import * as React from 'react';

import { ComparisonBarChart } from '@/components/dashboard/charts/comparison-bar-chart';
import { DonutChart } from '@/components/dashboard/charts/donut-chart';
import { LabeledPieChart } from '@/components/dashboard/charts/labeled-pie-chart';
import {
  HouseEntriesDrillSheet,
  HouseStandingDrillSheet,
} from '@/components/house-points/drills/house-drill-sheets';
import { Sheet } from '@/components/ui/sheet';
import { houseEventRows, type HouseEntryDrill } from '@/lib/house-points/drill';
import type {
  HouseBreakdown,
  HouseEntryLine,
} from '@/lib/house-points/house-breakdown';

// The house page's charts with their drill sheets — the Admissions pattern
// (components/admissions/drills/chart-drill-cards.tsx): each wrapper owns one
// <Sheet>, the chart's onSegmentClick picks the segment, and the sheet opens on
// it. The page (a Server Component) keeps the card chrome around each one.

// ── Award mix donut → the awards on that slice ─────────────────────────────

export type AwardSlice = {
  name: string;
  value: number;
  /** The award labels on this slice — one, or the tail folded into "Other". */
  awards: string[];
};

export function AwardMixDrillChart({
  slices,
  centerValue,
  centerLabel,
  centerHint,
  entries,
  houseName,
  fileStem,
}: {
  slices: AwardSlice[];
  centerValue: string;
  centerLabel: string;
  centerHint: string;
  entries: HouseEntryLine[];
  houseName: string;
  fileStem: string;
}) {
  const [segment, setSegment] = React.useState<string | null>(null);
  const slice = slices.find((s) => s.name === segment) ?? null;
  const drill = React.useMemo<HouseEntryDrill | null>(
    () =>
      slice
        ? { target: 'award', label: slice.name, awards: slice.awards }
        : null,
    [slice]
  );
  const isOther = slice !== null && slice.awards.length > 1;
  return (
    <Sheet open={!!segment} onOpenChange={(o) => !o && setSegment(null)}>
      <DonutChart
        data={slices.map(({ name, value }) => ({ name, value }))}
        centerValue={centerValue}
        centerLabel={centerLabel}
        centerHint={centerHint}
        onSegmentClick={setSegment}
      />
      {slice && drill && (
        <HouseEntriesDrillSheet
          drill={drill}
          entries={entries}
          houseName={houseName}
          eyebrow="Award mix"
          title={isOther ? 'Other awards' : `${slice.awards[0]} awards`}
          description={
            isOther
              ? `The smaller awards folded into one slice: ${slice.awards.join(', ')}.`
              : undefined
          }
          csvFilename={`${fileStem}-award-${slug(isOther ? 'other' : slice.awards[0])}.csv`}
        />
      )}
    </Sheet>
  );
}

// ── House share pie → that house's events ──────────────────────────────────

export type ShareHouse = { id: string; code: string; name: string };

export function HouseShareDrillChart({
  data,
  colors,
  houses,
  eventTotals,
  ayCode,
  currentHouseId,
  fileStem,
}: {
  data: { name: string; value: number }[];
  colors: string[];
  /** The houses behind `data`, by slice name. */
  houses: ShareHouse[];
  eventTotals: HouseBreakdown['eventTotals'];
  ayCode: string;
  currentHouseId: string;
  fileStem: string;
}) {
  const [segment, setSegment] = React.useState<string | null>(null);
  const house = houses.find((h) => h.name === segment) ?? null;
  const rows = React.useMemo(
    () => (house ? houseEventRows(eventTotals, house.id) : []),
    [house, eventTotals]
  );
  const isThisHouse = house?.id === currentHouseId;
  return (
    <Sheet open={!!segment} onOpenChange={(o) => !o && setSegment(null)}>
      <LabeledPieChart
        data={data}
        colors={colors}
        height={220}
        onSegmentClick={setSegment}
      />
      {house && (
        <HouseStandingDrillSheet
          rows={rows}
          eyebrow="Against the other houses"
          title={`Where ${house.name}'s points came from`}
          description={
            isThisHouse ? (
              `Every event ${house.name} scored in during ${ayCode}, and its place among the houses.`
            ) : (
              <>
                Every event {house.name} scored in during {ayCode}, and its
                place among the houses.{' '}
                <Link
                  href={`/records/house-points/houses/${encodeURIComponent(house.code.toLowerCase())}?ay=${encodeURIComponent(ayCode)}`}
                  className="font-medium text-foreground underline-offset-4 hover:text-primary hover:underline"
                >
                  Open {house.name}&apos;s page
                </Link>
              </>
            )
          }
          csvFilename={`${fileStem}-${slug(house.name)}-events.csv`}
        />
      )}
    </Sheet>
  );
}

// ── Ranked bars → that event's / that student's awards ─────────────────────

export type DrillBar = {
  category: string;
  current: number;
  /** The event or student id the bar stands for. */
  id: string;
  /** Its full name (the category may be shortened). */
  label: string;
  /** A student's number, for the link to their record. */
  studentNumber?: string;
};

export function EventBarsDrillChart({
  bars,
  color,
  height,
  entries,
  houseName,
  fileStem,
}: {
  bars: DrillBar[];
  color: string;
  height: number;
  entries: HouseEntryLine[];
  houseName: string;
  fileStem: string;
}) {
  const [segment, setSegment] = React.useState<string | null>(null);
  const bar = bars.find((b) => b.category === segment) ?? null;
  const drill = React.useMemo<HouseEntryDrill | null>(
    () => (bar ? { target: 'event', eventId: bar.id } : null),
    [bar]
  );
  return (
    <Sheet open={!!segment} onOpenChange={(o) => !o && setSegment(null)}>
      <ComparisonBarChart
        data={bars.map(({ category, current }) => ({ category, current }))}
        orientation="horizontal"
        yFormat="number"
        height={height}
        color={color}
        seriesLabel="Points"
        onSegmentClick={setSegment}
      />
      {bar && drill && (
        <HouseEntriesDrillSheet
          drill={drill}
          entries={entries}
          houseName={houseName}
          eyebrow="Points by event"
          title={bar.label}
          description={
            <>
              {houseName}&apos;s awards at this event.{' '}
              <Link
                href={`/records/house-points/${encodeURIComponent(bar.id)}`}
                className="font-medium text-foreground underline-offset-4 hover:text-primary hover:underline"
              >
                Open the event
              </Link>
            </>
          }
          csvFilename={`${fileStem}-${slug(bar.label)}.csv`}
        />
      )}
    </Sheet>
  );
}

export function StudentBarsDrillChart({
  bars,
  color,
  height,
  entries,
  houseName,
  fileStem,
}: {
  bars: DrillBar[];
  color: string;
  height: number;
  entries: HouseEntryLine[];
  houseName: string;
  fileStem: string;
}) {
  const [segment, setSegment] = React.useState<string | null>(null);
  const bar = bars.find((b) => b.category === segment) ?? null;
  const drill = React.useMemo<HouseEntryDrill | null>(
    () => (bar ? { target: 'student', studentId: bar.id } : null),
    [bar]
  );
  return (
    <Sheet open={!!segment} onOpenChange={(o) => !o && setSegment(null)}>
      <ComparisonBarChart
        data={bars.map(({ category, current }) => ({ category, current }))}
        orientation="horizontal"
        yFormat="number"
        height={height}
        color={color}
        seriesLabel="Points"
        onSegmentClick={setSegment}
      />
      {bar && drill && (
        <HouseEntriesDrillSheet
          drill={drill}
          entries={entries}
          houseName={houseName}
          eyebrow="Top contributors"
          title={bar.label}
          description={
            bar.studentNumber ? (
              <>
                Every award this student earned for {houseName}.{' '}
                <Link
                  href={`/records/students/${encodeURIComponent(bar.studentNumber)}`}
                  className="font-medium text-foreground underline-offset-4 hover:text-primary hover:underline"
                >
                  Open the student record
                </Link>
              </>
            ) : (
              `Every award this student earned for ${houseName}.`
            )
          }
          csvFilename={`${fileStem}-${slug(bar.label)}.csv`}
        />
      )}
    </Sheet>
  );
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'drill'
  );
}
