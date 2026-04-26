import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { getSessionUser } from "@/lib/supabase/server";
import { ChangePasswordForm } from "./change-password-form";

export default async function AccountPage() {
  const sessionUser = await getSessionUser();
  const role = sessionUser?.role ?? null;

  return (
    <PageShell className="max-w-2xl">
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Account
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Account settings.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Your signed-in identity and how to change your password.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
            Signed-in identity
          </CardTitle>
          <CardDescription>Read-only. Ask the registrar to change your email or role.</CardDescription>
        </CardHeader>
        <CardContent className="border-t border-border p-0">
          <dl className="divide-y divide-border">
            <div className="flex items-center justify-between px-6 py-4">
              <dt className="text-sm text-muted-foreground">Email</dt>
              <dd className="text-sm font-medium text-foreground">{sessionUser?.email ?? "—"}</dd>
            </div>
            <div className="flex items-center justify-between px-6 py-4">
              <dt className="text-sm text-muted-foreground">Role</dt>
              <dd className="text-sm font-bold uppercase font-mono text-primary">{role ?? "no role"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
            Change password
          </CardTitle>
          <CardDescription>
            Use a strong password you don&apos;t use anywhere else. Minimum 8 characters.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </PageShell>
  );
}
