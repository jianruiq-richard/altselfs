import { redirect } from 'next/navigation';
import { AdminUsersClient } from '@/components/admin-users-client';
import { requireOpsAdmin } from '@/lib/ops-auth';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const admin = await requireOpsAdmin();
  if (!admin) redirect('/dashboard');

  return <AdminUsersClient adminName={admin.name} />;
}
