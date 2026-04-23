"use client";

import { BookOpen, CalendarCheck, ChevronDown, ChevronUp, ClipboardCheck, FileStack, FolderOpen, Home, ShieldCheck, Users } from "lucide-react";
import { useRouter } from "next/navigation";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isRouteAllowed, type Role } from "@/lib/auth/roles";

const MODULES = [
  { value: "markbook", label: "Markbook", icon: BookOpen, href: "/markbook" },
  { value: "attendance", label: "Attendance", icon: CalendarCheck, href: "/attendance" },
  { value: "evaluation", label: "Evaluation", icon: ClipboardCheck, href: "/evaluation" },
  { value: "p-files", label: "P-Files", icon: FolderOpen, href: "/p-files" },
  { value: "admissions", label: "Admissions", icon: FileStack, href: "/admissions" },
  { value: "records", label: "Records", icon: Users, href: "/records" },
  { value: "sis", label: "SIS Admin", icon: ShieldCheck, href: "/sis" },
] as const;

type ModuleValue = (typeof MODULES)[number]["value"];

type ModuleSwitcherProps = {
  currentModule: ModuleValue | null;
  role: Role | null;
};

// Single source of truth for "which modules can this role reach?" —
// derived from `ROUTE_ACCESS` via `isRouteAllowed` so the switcher, the
// proxy middleware, and the server-side redirects never drift. Pre-fix
// the visibility was hard-coded per-layout, which led to registrars
// seeing dead `p-files`/`sis` entries and teachers seeing no switcher at
// all despite having access to 3 modules.
export function ModuleSwitcher({ currentModule, role }: ModuleSwitcherProps) {
  const router = useRouter();
  const current = currentModule ? MODULES.find((m) => m.value === currentModule) : null;
  const Icon = current?.icon ?? Home;
  const label = current?.label ?? "Home";

  const allowedModules = MODULES.filter((m) => isRouteAllowed(m.href, role));
  const canSwitch = allowedModules.length > 1;

  if (!canSwitch) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-3.5" />
        </div>
        <div className="flex flex-col leading-none">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">
            HFSE
          </span>
          <span className="font-serif text-sm font-semibold tracking-tight text-foreground">{label}</span>
        </div>
      </div>
    );
  }

  function handleChange(value: string) {
    const target = allowedModules.find((m) => m.value === value);
    if (target && target.value !== currentModule) {
      router.push(target.href);
    }
  }

  return (
    <Select value={currentModule ?? undefined} onValueChange={handleChange}>
      <SelectTrigger className="h-auto w-auto gap-2 rounded-lg border-border/60 bg-card px-2.5 py-1.5 shadow-xs transition-all hover:border-primary/30 hover:shadow-sm focus:ring-1 focus:ring-primary/20 [&>svg]:hidden">
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-start leading-none">
            <span className="font-serif text-sm font-semibold tracking-tight text-foreground">
              {currentModule ? <SelectValue /> : label}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col -space-y-1 text-muted-foreground/50">
          <ChevronUp className="size-3" />
          <ChevronDown className="size-3" />
        </div>
      </SelectTrigger>
      <SelectContent align="start" className="min-w-[180px]">
        {allowedModules.map((m) => {
          const MIcon = m.icon;
          return (
            <SelectItem key={m.value} value={m.value} className="py-2">
              <div className="flex items-center gap-2.5">
                <div className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <MIcon className="size-3" />
                </div>
                <div className="flex flex-col leading-none">
                  <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    HFSE
                  </span>
                  <span className="font-serif text-[13px] font-semibold tracking-tight text-foreground">{m.label}</span>
                </div>
              </div>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
