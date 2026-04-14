import Link from "next/link";
import {
  ArrowUpRight,
  ClipboardList,
  History,
  Lock,
  RefreshCw,
  Users,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";

type Tool = {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  icon: LucideIcon;
};

const TOOLS: Tool[] = [
  {
    icon: RefreshCw,
    eyebrow: "Admissions",
    title: "Sync Students",
    description:
      "Pull new, updated, and withdrawn students from the admissions tables for the current academic year.",
    href: "/admin/sync-students",
    cta: "Open sync",
  },
  {
    icon: Users,
    eyebrow: "Rosters",
    title: "Sections & Advisers",
    description:
      "View every section for the current AY and manage enrolment, class advisers, and comments.",
    href: "/admin/sections",
    cta: "Open sections",
  },
  {
    icon: ClipboardList,
    eyebrow: "Grading",
    title: "Grading Sheets",
    description:
      "Create, lock, and review grading sheets for every subject × section × term combination.",
    href: "/grading",
    cta: "Open grading",
  },
  {
    icon: History,
    eyebrow: "Compliance",
    title: "Audit Log",
    description:
      "Append-only record of every post-lock grade change, with field diffs and approval references.",
    href: "/admin/audit-log",
    cta: "Open audit log",
  },
];

export default function AdminHome() {
  return (
    <PageShell>
      <header className="space-y-4 md:space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Administration
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Admin.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Registrar and administrator tools. Pick a task below.
        </p>
      </header>

      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2">
          {TOOLS.map((t) => {
            const Icon = t.icon;
            return (
              <Card
                key={t.href}
                className="@container/card group relative transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
              >
                <CardHeader>
                  <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                    {t.eyebrow}
                  </CardDescription>
                  <CardTitle className="font-serif text-xl font-semibold leading-snug tracking-tight text-foreground @[260px]/card:text-[22px]">
                    {t.title}
                  </CardTitle>
                  <CardAction>
                    <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                      <Icon className="size-5" />
                    </div>
                  </CardAction>
                </CardHeader>
                <CardFooter className="flex-col items-start gap-4 text-sm">
                  <p className="leading-relaxed text-muted-foreground">{t.description}</p>
                  <Button asChild size="sm">
                    <Link href={t.href}>
                      {t.cta}
                      <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <Lock className="size-3" strokeWidth={2.25} />
        <span>AY 2025–26</span>
        <span className="text-border">·</span>
        <span>Supabase Auth</span>
        <span className="text-border">·</span>
        <span>Audit-logged</span>
      </div>
    </PageShell>
  );
}
