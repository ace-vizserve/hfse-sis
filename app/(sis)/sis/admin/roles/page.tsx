import { Info } from 'lucide-react';
import { redirect } from 'next/navigation';

import { RolePermissionsEditor } from '@/components/sis/role-permissions-editor';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { PageShell } from '@/components/ui/page-shell';
import { getRoleCapabilities } from '@/lib/auth/permission-map';
import { ROLES, type Role } from '@/lib/auth/roles';
import { getStaffCountsByRole } from '@/lib/auth/staff-list';
import { lockedRoleNote } from '@/lib/copy/data-table';
import { getSessionUser } from '@/lib/supabase/server';

// /sis/admin/roles — what each role is allowed to do.
//
// Superadmin only, gated on the ROLE and not on a capability of its own: a
// capability controlling access to the capability editor could be revoked,
// locking its holder out of the one surface that could restore it.
//
// Reads through getRoleCapabilities rather than querying role_permissions
// directly, so the page shows exactly what the gates will see — including the
// fallback to built-in defaults if the table is ever unreadable.

const LOCKED_ROLE: Role = 'superadmin';

export default async function RolePermissionsPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (sessionUser.role !== 'superadmin') redirect('/sis');

  const [map, peopleByRole] = await Promise.all([
    getRoleCapabilities(),
    getStaffCountsByRole(),
  ]);
  const grants = ROLES.flatMap((role) =>
    (map[role] ?? []).map((capability) => ({ role, capability }))
  );
  const editableRoles = ROLES.filter((role) => role !== LOCKED_ROLE);

  return (
    <PageShell>
      <SisPageHeader
        group="Access & system"
        title="Role permissions."
        description="Set what each role is allowed to do. Everyone with that role gets the same permissions — this page never changes one person's access on its own."
      />

      <section className="rounded-xl border border-border bg-muted/30 p-5">
        <div className="mb-3 flex items-center gap-2">
          <Info className="size-4 text-brand-indigo" />
          <p className="font-serif text-[15px] font-semibold text-foreground">
            How this works
          </p>
        </div>
        <ul className="ml-4 list-disc space-y-1.5 text-[13px] leading-relaxed text-muted-foreground">
          <li>
            <strong className="font-medium text-foreground">
              Changes apply straight away
            </strong>{' '}
            — the next page someone loads uses the new permissions. Nobody has
            to sign out and back in.
          </li>
          <li>
            <strong className="font-medium text-foreground">
              This sets what a role can do, not which module it can open
            </strong>{' '}
            — someone can still reach a module&apos;s address by typing it, but
            every action and list inside will be closed to them, and the menu
            will not offer it. Ask for a module to be opened or closed and
            that&apos;s a change to the code.
          </li>
          <li>
            <strong className="font-medium text-foreground">
              {lockedRoleNote(LOCKED_ROLE)}
            </strong>
          </li>
          <li>
            <strong className="font-medium text-foreground">
              Some permissions always need one holder
            </strong>{' '}
            — approving grade changes, and managing staff accounts. Removing the
            last one is refused, with a message telling you to give it to
            another role first.
          </li>
          <li>
            <strong className="font-medium text-foreground">
              Every change is recorded
            </strong>{' '}
            — the audit log shows who changed which role, and how many
            permissions were added or removed.
          </li>
          <li>
            <strong className="font-medium text-foreground">
              These six roles are fixed
            </strong>{' '}
            — a new role can&apos;t be added here. A role name is stored inside
            every person&apos;s sign-in, and parts of the database check for
            these names directly, so adding one is a development change. Ask,
            and say what the new role should and shouldn&apos;t be able to do.
          </li>
        </ul>
      </section>

      <RolePermissionsEditor
        grants={grants}
        editableRoles={editableRoles}
        lockedRole={LOCKED_ROLE}
        peopleByRole={peopleByRole}
      />
    </PageShell>
  );
}
