'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Image from 'next/image';
import { FolderOpen, History, LogOut, UserCog, type LucideIcon } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { NAV_BY_MODULE } from '@/lib/auth/roles';

const ROLE_LABEL: Record<string, string> = {
  'p-file': 'P-File Officer',
  school_admin: 'School Admin',
  admin: 'Admin',
  superadmin: 'Superadmin',
};

const ICON_BY_HREF: Record<string, LucideIcon> = {
  '/p-files': FolderOpen,
  '/p-files/audit-log': History,
};

const ACTIVE_INDICATOR =
  'relative h-9 before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-r-full before:bg-brand-indigo before:opacity-0 before:transition-opacity data-[active=true]:before:opacity-100';

export function PFilesSidebar({ email, role }: { email: string; role: string }) {
  const router = useRouter();
  const pathname = usePathname();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  const initials =
    email
      .split('@')[0]
      .split(/[._-]/)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('')
      .slice(0, 2) || 'PF';

  const sections = NAV_BY_MODULE['p-files'];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-3 py-4">
        <Link
          href="/p-files"
          className="flex items-center gap-3 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <Image
            src="/hfse-logo-favicon.webp"
            alt=""
            width={36}
            height={36}
            className="size-9 shrink-0 rounded-xl"
          />
          <div className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/60">
              HFSE
            </span>
            <span className="truncate font-serif text-base font-semibold tracking-tight text-sidebar-foreground">
              P-Files
            </span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-1.5 py-3">
        {sections.map((section, i) => (
          <SidebarGroup key={i}>
            {section.label && (
              <SidebarGroupLabel className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/50">
                {section.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const Icon = ICON_BY_HREF[item.href] ?? FolderOpen;
                  const isActive = pathname === item.href;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={item.label}
                        className={ACTIVE_INDICATOR}
                      >
                        <Link href={item.href}>
                          <Icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        <div className="mb-2 flex items-center gap-3 group-data-[collapsible=icon]:hidden">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-indigo to-brand-navy text-[11px] font-semibold text-white shadow-brand-tile">
            {initials}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div
              className="truncate text-xs font-medium text-sidebar-foreground"
              title={email}
            >
              {email}
            </div>
            <div className="mt-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/60">
              {ROLE_LABEL[role] ?? role}
            </div>
          </div>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname === '/account'}
              tooltip="Account"
              className="relative h-9 before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-r-full before:bg-brand-indigo before:opacity-0 before:transition-opacity data-[active=true]:before:opacity-100"
            >
              <Link href="/account">
                <UserCog />
                <span>Account</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={signOut}
              tooltip="Sign out"
              className="h-9 text-sidebar-foreground/70 hover:bg-destructive/10 hover:text-destructive"
            >
              <LogOut />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
