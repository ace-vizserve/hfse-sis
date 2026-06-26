'use client';

import { useRouter } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type AyPickerProps = {
  ays: Array<{ ayCode: string; label: string; isCurrent: boolean }>;
  selected: string;
};

export function AyPicker({ ays, selected }: AyPickerProps) {
  const router = useRouter();
  return (
    <Select
      value={selected}
      onValueChange={(code) => router.push(`/sis/ay-setup?ay=${code}`)}
    >
      <SelectTrigger className="w-[240px]" aria-label="Choose academic year">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ays.map((ay) => (
          <SelectItem key={ay.ayCode} value={ay.ayCode}>
            {ay.label}
            {ay.isCurrent ? ' · Active' : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
