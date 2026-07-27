import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { isDemoMode } from '@/lib/dev-auth';
import {
  ProductUserRoleConflictError,
  provisionProductUser,
} from '@/lib/user-provisioning';

export async function POST(req: NextRequest) {
  try {
    // Handle demo mode
    if (isDemoMode) {
      const { clerkId, email, name, role, nickname, phone, wechatId } = await req.json();

      if (!clerkId || !email || !role) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      }

      const user = await provisionProductUser({
        clerkId,
        email,
        name,
        role: role === 'INVESTOR' ? 'INVESTOR' : 'CANDIDATE',
        nickname,
        phone,
        wechatId,
      });

      return NextResponse.json({ user });
    }

    const authResult = await auth();
    const userId = authResult.userId;

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { email, name, role, nickname, phone, wechatId } = await req.json();

    if (!role) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const normalizedRole = role === 'INVESTOR' ? 'INVESTOR' : 'CANDIDATE';
    if (normalizedRole === 'CANDIDATE' && (!nickname || !phone || !wechatId)) {
      return NextResponse.json(
        { error: 'Candidate profile requires nickname, phone, and wechatId' },
        { status: 400 }
      );
    }
    const user = await provisionProductUser({
      clerkId: userId,
      email,
      name,
      role: normalizedRole,
      nickname,
      phone,
      wechatId,
    });

    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof ProductUserRoleConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Error creating user:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
