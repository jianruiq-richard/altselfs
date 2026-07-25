import { NextRequest, NextResponse } from 'next/server';
import { listAdminUsers } from '@/lib/admin-users-data';
import { requireOpsAdmin } from '@/lib/ops-auth';

export async function GET(request: NextRequest) {
  const admin = await requireOpsAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const url = new URL(request.url);
    const data = await listAdminUsers({
      query: url.searchParams.get('q'),
      limit: Number(url.searchParams.get('limit') || 25),
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error('[admin-users] list failed', error);
    return NextResponse.json({ error: 'Failed to load users' }, { status: 500 });
  }
}
