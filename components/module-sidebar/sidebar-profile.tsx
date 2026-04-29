"use client";

import { ChevronsUpDown, LogOut, UserCog } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import type { Role } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/client";

const ROLE_LABEL: Record<Role | "parent", string> = {
  teacher: "Teacher",
  registrar: "Registrar",
  school_admin: "School Admin",
  admin: "Admin",
  superadmin: "Superadmin",
  "p-file": "P-File Officer",
  admissions: "Admissions",
  parent: "Parent",
};

type SidebarProfileProps = {
  email: string;
  role: Role | "parent";
};

function deriveInitials(email: string): string {
  return (
    email
      .split("@")[0]
      .split(/[._-]/)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 2) || "HF"
  );
}

export function SidebarProfile({ email, role }: SidebarProfileProps) {
  const router = useRouter();
  const initials = deriveInitials(email);
  const roleLabel = ROLE_LABEL[role];
  const isParent = role === "parent";

  async function signOut() {
    if (isParent) {
      // Parents don't have a Supabase session in the SIS — their auth is
      // the parent_session cookie. Clear it and bounce back to the parent
      // portal so a staff user sharing the same browser keeps their
      // staff Supabase session intact.
      try {
        await fetch("/api/parent/exit", {
          method: "POST",
          credentials: "same-origin",
        });
      } catch {
        // Best-effort. If the network call fails, the cookie's TTL (2h)
        // will expire it on its own.
      }
      const portalUrl =
        process.env.NEXT_PUBLIC_PARENT_PORTAL_URL ??
        "https://enrol.hfse.edu.sg/admission/dashboard";
      window.location.href = portalUrl;
      return;
    }
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-indigo to-brand-navy text-[11px] font-semibold text-white shadow-brand-tile">
            {initials}
          </div>
          <div className="min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
            <div className="truncate text-xs font-medium text-sidebar-foreground" title={email}>
              {email}
            </div>
            <div className="mt-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/60">
              {roleLabel}
            </div>
          </div>
          <ChevronsUpDown className="size-3.5 shrink-0 text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={8} className="w-[260px] p-0">
        <div className="flex items-center gap-2.5 border-b border-border px-3 py-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-indigo to-brand-navy text-xs font-semibold text-white shadow-brand-tile">
            {initials}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-medium text-foreground" title={email}>
              {email}
            </div>
            <div className="mt-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {roleLabel}
            </div>
          </div>
        </div>
        <div className="p-1.5">
          {!isParent && (
            <>
              <Link
                href="/account"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                <UserCog className="size-4 text-muted-foreground" />
                <span>Account</span>
              </Link>
              <Separator className="my-1.5" />
            </>
          )}
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive focus-visible:ring-2 focus-visible:ring-sidebar-ring">
            <LogOut className="size-4" />
            <span>{isParent ? "Done viewing" : "Sign out"}</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
