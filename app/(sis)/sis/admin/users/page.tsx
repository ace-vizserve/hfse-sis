import { ArrowLeft, UserCog } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { UsersAdminClient } from "@/components/sis/users-admin-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { listStaffUsers } from "@/lib/sis/users/queries";
import { getSessionUser } from "@/lib/supabase/server";

// SIS Admin · User provisioning. Superadmin only. Lists staff users,
// lets the superadmin invite + change role + enable/disable. Removes the
// dev dependency that previously required Supabase Studio access to add
// or change users.
export default async function UsersAdminPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");
  if (sessionUser.role !== "superadmin") redirect("/sis");

  const users = await listStaffUsers();

  return (
    <PageShell>
      <Link
        href="/sis"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        SIS Admin
      </Link>

      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          SIS Admin · Users
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Staff accounts.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Invite new staff, change roles, or disable accounts. Parent accounts are created by the enrolment portal and
          aren&apos;t shown here. Disabling bans sign-ins but preserves the user record so audit-log foreign keys stay
          intact.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            {users.length} staff user{users.length === 1 ? "" : "s"}
          </CardDescription>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
            <span className="inline-flex items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <UserCog className="size-4" />
              </div>
              Directory
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <UsersAdminClient users={users} currentUserId={sessionUser.id} />
        </CardContent>
      </Card>
    </PageShell>
  );
}
