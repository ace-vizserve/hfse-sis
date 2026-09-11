import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ExportCsvButton,
  ExportCsvButtonPending,
} from '@/components/dashboard/export-csv-button';

afterEach(() => vi.restoreAllMocks());

// jsdom's Blob may not implement .text(); FileReader works everywhere.
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe('ExportCsvButton', () => {
  it('downloads the sectioned CSV under the given filename, with an Exported line added', async () => {
    const blobs: Blob[] = [];
    const createUrl = vi.fn((b: Blob) => {
      blobs.push(b);
      return 'blob:x';
    });
    Object.assign(URL, {
      createObjectURL: createUrl,
      revokeObjectURL: vi.fn(),
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    render(
      <ExportCsvButton
        data={{
          filename: 'attendance-dashboard-AY2026.csv',
          scope: [['Page', 'Attendance dashboard']],
          sections: [
            { title: 'Key figures', headers: ['Figure'], rows: [['Absences']] },
          ],
        }}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe('attendance-dashboard-AY2026.csv');
    expect(blobs).toHaveLength(1);
    const text = await readBlob(blobs[0]);
    expect(text).toContain('Page,Attendance dashboard');
    expect(text).toMatch(/Exported,\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    expect(text).toContain('Key figures');
  });

  it('renders a disabled button while the page is still loading', () => {
    render(<ExportCsvButtonPending />);
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });
});
