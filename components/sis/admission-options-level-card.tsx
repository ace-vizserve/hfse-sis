import { Ban } from 'lucide-react';

import { AdmissionOptionSessionSwitch } from '@/components/sis/admission-option-session-switch';
import {
  AdmissionOptionRowMenu,
  type SheetLevel,
} from '@/components/sis/admission-option-sheet';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { AdminOptionGroup, NameReach } from '@/lib/admissions/options';

// One SIS level on /sis/admin/admission-options — the 09a §8 level / group
// container card. The grouping IS the mapping: every level name parents see
// sits under the SIS level it counts as, so "HFSE International Education
// Programme – Year 2 (equivalent to Primary One)" is read as Primary One off
// the card it is on, with no "counts as" column to scan.
export function AdmissionOptionsLevelCard({
  group,
  ayCode,
  levels,
  nameReach,
}: {
  group: AdminOptionGroup;
  ayCode: string;
  levels: readonly SheetLevel[];
  /** Every level name's reach across all years — for the drawer's warning. */
  nameReach: Record<string, NameReach>;
}) {
  const sessions = group.combos.flatMap((c) => c.sessions);
  const open = sessions.filter((s) => s.isOpen).length;
  const names = new Set(group.combos.map((c) => c.levelLabel)).size;

  return (
    <Card className="@container/card gap-0 py-0">
      <CardHeader className="border-b border-border py-5">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Counts as
        </CardDescription>
        <CardTitle className="font-serif text-[22px] tracking-tight">
          {group.levelLabel}
        </CardTitle>
        <CardAction>
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy font-mono text-[12px] font-semibold text-white shadow-brand-tile">
            {group.levelCode}
          </div>
        </CardAction>
      </CardHeader>

      <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-border bg-muted/30 px-6 py-3 text-[13px] text-muted-foreground">
        <span>
          <span className="font-medium tabular-nums text-foreground">
            {names}
          </span>{' '}
          {names === 1 ? 'level name' : 'level names'}
        </span>
        <span>
          <span className="font-medium tabular-nums text-foreground">
            {open}
          </span>{' '}
          of {sessions.length} sessions open
        </span>
      </div>

      <ul className="divide-y divide-border">
        {group.combos.map((combo) => {
          const noneOpen = combo.sessions.every((s) => !s.isOpen);
          return (
            <li
              key={`${combo.levelLabel}\u0000${combo.classTypeLabel}`}
              className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-center md:gap-6"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium text-foreground">
                    {combo.classTypeLabel}
                  </span>
                  <Badge
                    variant="outline"
                    className="h-5 border-border bg-card px-2 text-[11px] font-medium text-muted-foreground"
                  >
                    {combo.track}
                  </Badge>
                  {noneOpen && (
                    <Badge
                      variant="outline"
                      className="h-5 border-destructive/40 bg-destructive/10 px-2 text-[11px] text-destructive"
                    >
                      <Ban className="h-3 w-3" />
                      Not offered
                    </Badge>
                  )}
                </div>
                <p className="text-[13px] text-muted-foreground">
                  {combo.levelLabel}
                </p>
              </div>

              <div className="flex items-center justify-between gap-4 md:justify-end">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  {combo.sessions.map((s) => (
                    <AdmissionOptionSessionSwitch
                      key={s.id}
                      optionId={s.id}
                      schedule={s.schedule}
                      isOpen={s.isOpen}
                      levelLabel={combo.levelLabel}
                      classTypeLabel={combo.classTypeLabel}
                    />
                  ))}
                </div>
                <AdmissionOptionRowMenu
                  ayCode={ayCode}
                  levels={levels}
                  target={{
                    levelLabel: combo.levelLabel,
                    classTypeLabel: combo.classTypeLabel,
                    levelId: combo.levelId,
                    track: combo.track,
                    nameReach: nameReach[combo.levelLabel] ?? {
                      options: 1,
                      ayCodes: [ayCode],
                    },
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
