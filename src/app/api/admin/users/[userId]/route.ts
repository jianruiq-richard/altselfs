import { NextRequest, NextResponse } from 'next/server';
import { getAdminUserDetail } from '@/lib/admin-users-data';
import { requireOpsAdmin } from '@/lib/ops-auth';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const admin = await requireOpsAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { userId } = await params;
    const data = await getAdminUserDetail(userId);
    if (!data) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    return NextResponse.json(data);
  } catch (error) {
    console.error('[admin-users] detail failed', error);
    return NextResponse.json({ error: 'Failed to load user detail' }, { status: 500 });
  }
}
