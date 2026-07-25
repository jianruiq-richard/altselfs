import { NextRequest, NextResponse } from 'next/server';
import { getAdminThreadDetail } from '@/lib/admin-users-data';
import { requireOpsAdmin } from '@/lib/ops-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const admin = await requireOpsAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { threadId } = await params;
    const url = new URL(request.url);
    const data = await getAdminThreadDetail(threadId, {
      limit: Number(url.searchParams.get('limit') || 180),
    });
    if (!data) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    return NextResponse.json(data);
  } catch (error) {
    console.error('[admin-users] thread detail failed', error);
    return NextResponse.json({ error: 'Failed to load thread detail' }, { status: 500 });
  }
}
