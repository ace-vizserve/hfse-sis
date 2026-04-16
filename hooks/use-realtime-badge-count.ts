import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Role } from '@/lib/auth/roles';

export function useRealtimeBadgeCount(
  role: Role,
  userId: string,
  initialCount: number,
): number {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    setCount(initialCount);
  }, [initialCount]);

  useEffect(() => {
    const supabase = createClient();

    async function recount() {
      let query = supabase
        .from('grade_change_requests')
        .select('id', { count: 'exact', head: true });

      if (role === 'teacher') {
        query = query.eq('requested_by', userId).eq('status', 'pending');
      } else if (role === 'registrar') {
        query = query.eq('status', 'approved');
      } else if (role === 'admin' || role === 'superadmin') {
        query = query.eq('status', 'pending');
      } else {
        return;
      }

      const { count: fresh } = await query;
      if (fresh != null) setCount(fresh);
    }

    const channel = supabase
      .channel('sidebar-badge-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'grade_change_requests' },
        () => recount(),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'grade_change_requests' },
        () => recount(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [role, userId]);

  return count;
}
