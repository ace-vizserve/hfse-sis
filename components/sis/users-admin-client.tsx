"use client";

import { Ban, CheckCircle2, Loader2, Mail, Shield, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLES, type Role } from "@/lib/auth/roles";
import type { AdminUserRow } from "@/lib/sis/users/queries";

const ROLE_LABEL: Record<Role, string> = {
  teacher: "Teacher",
  registrar: "Registrar",
  school_admin: "School Admin",
  superadmin: "Superadmin",
  "p-file": "P-Files",
  admissions: "Admissions",
};

export function UsersAdminClient({ users, currentUserId }: { users: AdminUserRow[]; currentUserId: string }) {
  const [filter, setFilter] = useState("");
  const filtered = users.filter((u) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return (
      u.email.toLowerCase().includes(q) ||
      u.display_name.toLowerCase().includes(q) ||
      (u.role ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="user-filter">Filter</Label>
          <Input
            id="user-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search email / name / role…"
          />
        </div>
        <InviteUserDialog />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead className="w-[120px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  {filter ? "No users match that filter." : "No staff users yet."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((u) => <UserRow key={u.id} user={u} isSelf={u.id === currentUserId} />)
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function UserRow({ user, isSelf }: { user: AdminUserRow; isSelf: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function setRole(next: Role) {
    if (next === user.role) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sis/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "update failed");
      toast.success(`Role updated: ${user.email} → ${ROLE_LABEL[next]}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "update failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleDisabled() {
    const next = !user.disabled;
    setBusy(true);
    try {
      const res = await fetch(`/api/sis/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ disabled: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "update failed");
      toast.success(next ? `Disabled: ${user.email}` : `Enabled: ${user.email}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <TableRow className={user.disabled ? "opacity-60" : ""}>
      <TableCell>
        <div className="font-medium text-foreground">{user.display_name}</div>
        <div className="font-mono text-[11px] text-muted-foreground">{user.email}</div>
      </TableCell>
      <TableCell>
        <Select value={user.role ?? undefined} onValueChange={(v) => setRole(v as Role)} disabled={busy || isSelf}>
          <SelectTrigger className="h-8 w-[160px]">
            <SelectValue placeholder="— no role —" />
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABEL[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        {user.disabled ? (
          <Badge variant="blocked">
            <Ban className="size-3" /> Disabled
          </Badge>
        ) : (
          <Badge variant="success">
            <CheckCircle2 className="size-3" /> Active
          </Badge>
        )}
      </TableCell>
      <TableCell className="font-mono text-[11px] tabular-nums text-muted-foreground">
        {user.last_sign_in_at
          ? new Date(user.last_sign_in_at).toLocaleDateString("en-SG", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })
          : "—"}
      </TableCell>
      <TableCell>
        <Button
          type="button"
          size="sm"
          variant={user.disabled ? "default" : "destructive"}
          disabled={busy || isSelf}
          onClick={toggleDisabled}
          className="gap-1.5"
          title={isSelf ? "You cannot disable your own account here" : undefined}>
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : user.disabled ? (
            <CheckCircle2 className="size-3.5" />
          ) : (
            <Ban className="size-3.5" />
          )}
          {user.disabled ? "Enable" : "Disable"}
        </Button>
      </TableCell>
    </TableRow>
  );
}

function InviteUserDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role>("teacher");
  const [saving, setSaving] = useState(false);

  async function submit() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      toast.error("Valid email required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/sis/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          role,
          displayName: displayName.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "invite failed");
      toast.success(`Invite sent to ${trimmed}`);
      setOpen(false);
      setEmail("");
      setDisplayName("");
      setRole("teacher");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "invite failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <UserPlus className="size-3.5" />
          Invite user
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="size-4 text-primary" /> Invite user
          </DialogTitle>
          <DialogDescription>
            Sends a magic-link invitation. The invitee signs in once with the link; their role is assigned immediately
            on the account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="new.user@hfse.edu.sg"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">Display name (optional)</Label>
            <Input
              id="invite-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Jane Smith"
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              <span className="inline-flex items-center gap-1.5">
                <Shield className="size-3.5" /> Role
              </span>
            </Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={saving || !email}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}
            {saving ? "Inviting…" : "Send invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
