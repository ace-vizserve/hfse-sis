import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { getUserRole, type SidebarBadges } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getSidebarChangeRequestCount } from "@/lib/change-requests/sidebar-counts";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = getUserRole(user);
  // Null-role users are parents — proxy.ts normally redirects them to
  // /parent before they reach this layout, but if they land here directly
  // (e.g. bookmarked /grading), redirect server-side as well.
  if (!role) redirect("/parent");

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar:state")?.value !== "false";

  const service = createServiceClient();
  const sidebarBadges: SidebarBadges = {
    changeRequests: await getSidebarChangeRequestCount(service, role, user.id),
  };

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar role={role} email={user.email ?? ""} badges={sidebarBadges} userId={user.id} />
      <SidebarInset>
        <header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md print:hidden">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mx-1 h-4" />
          <div className="text-sm font-medium text-muted-foreground">HFSE Markbook</div>
        </header>
        <div className="flex-1 bg-muted px-6 py-8 md:px-10 md:py-10 print:bg-background print:p-0">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
