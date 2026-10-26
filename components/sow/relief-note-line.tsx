import { formatWeekdayDay } from '@/components/sow/format';
import { RichText } from '@/components/ui/rich-text';

// One relief teacher's "What did you cover?" as the regular teacher and the
// supervisor read it on that week (boards 7 and 11): "Relief, Wed 8 Apr,
// Discipline 2 (Mr Tan): …". Accent recipe (§9.3) — information handed over,
// not a state anyone has to act on.

export function ReliefNoteLine({
  taughtOn,
  name,
  note,
  classLabel,
}: {
  taughtOn: string;
  name: string;
  note: string;
  /** The class, when the block lists more than one. */
  classLabel?: string;
}) {
  return (
    <div className="w-full rounded-md border border-brand-indigo-soft bg-accent px-3 py-2.5 text-[13px] text-brand-indigo-deep">
      <p className="font-semibold">
        Relief, {formatWeekdayDay(taughtOn)}
        {classLabel ? `, ${classLabel}` : ''} ({name}):
      </p>
      <RichText html={note} className="text-[13px] text-brand-indigo-deep" />
    </div>
  );
}
