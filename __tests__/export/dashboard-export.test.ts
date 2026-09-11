import { describe, expect, it } from 'vitest';

import { buildSectionedCsv } from '@/lib/csv';
import {
  dashboardFilename,
  insightsFilename,
  kpiSection,
  roundTo,
} from '@/lib/export/dashboard-export';

const BOM = '﻿';

describe('buildSectionedCsv', () => {
  it('writes scope lines, then each section as title, header, rows, separated by blank lines', () => {
    const csv = buildSectionedCsv(
      [
        ['Page', 'Attendance dashboard'],
        ['Academic year', 'AY2026'],
      ],
      [
        {
          title: 'Key figures',
          headers: ['Figure', 'This period'],
          rows: [['Late incidents', 12]],
        },
        {
          title: 'Daily attendance',
          headers: ['Date', 'Rate (%)'],
          rows: [['2026-08-03', 94.2]],
        },
      ]
    );
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Page,Attendance dashboard',
      'Academic year,AY2026',
      '',
      'Key figures',
      'Figure,This period',
      'Late incidents,12',
      '',
      'Daily attendance',
      'Date,Rate (%)',
      '2026-08-03,94.2',
    ]);
  });

  it('escapes commas, quotes and newlines and leaves null cells empty', () => {
    const csv = buildSectionedCsv(
      [],
      [
        {
          title: 'Sections, all',
          headers: ['Name', 'Note'],
          rows: [
            ['P1 "Joy"', null],
            ['a\nb', 3],
          ],
        },
      ]
    );
    expect(csv.slice(1).split('\r\n')).toEqual([
      '"Sections, all"',
      'Name,Note',
      '"P1 ""Joy""",',
      '"a\nb",3',
    ]);
  });

  it('keeps an empty section as title + header so the reader sees it had no rows', () => {
    const csv = buildSectionedCsv(
      [],
      [{ title: 'Over quota', headers: ['Student'], rows: [] }]
    );
    expect(csv.slice(1).split('\r\n')).toEqual(['Over quota', 'Student']);
  });
});

describe('kpiSection', () => {
  it('builds the Key figures section with blank cells for a missing comparison', () => {
    expect(
      kpiSection([
        {
          label: 'Attendance rate (%)',
          current: 94.2,
          previous: 93.1,
          change: 1.1,
        },
        { label: 'Absences', current: 40 },
      ])
    ).toEqual({
      title: 'Key figures',
      headers: ['Figure', 'This period', 'Previous period', 'Change'],
      rows: [
        ['Attendance rate (%)', 94.2, 93.1, 1.1],
        ['Absences', 40, null, null],
      ],
    });
  });
});

describe('filenames', () => {
  it('names dashboard files by module, page, AY and range', () => {
    expect(
      dashboardFilename({
        module: 'attendance',
        ayCode: 'AY2026',
        from: '2026-08-01',
        to: '2026-08-31',
      })
    ).toBe('attendance-dashboard-AY2026-2026-08-01_to_2026-08-31.csv');
    expect(dashboardFilename({ module: 'p-files', ayCode: 'AY2026' })).toBe(
      'p-files-dashboard-AY2026.csv'
    );
  });

  it('names insights files by module, AY and comparison AY', () => {
    expect(
      insightsFilename({
        module: 'records',
        ayCode: 'AY2026',
        compareAy: 'AY2025',
      })
    ).toBe('records-insights-AY2026-vs-AY2025.csv');
    expect(insightsFilename({ module: 'records', ayCode: 'AY2026' })).toBe(
      'records-insights-AY2026.csv'
    );
  });
});

describe('roundTo', () => {
  it('rounds to the given decimals and passes null through', () => {
    expect(roundTo(94.2345, 1)).toBe(94.2);
    expect(roundTo(null, 1)).toBeNull();
    expect(roundTo(undefined, 1)).toBeNull();
  });
});
