import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { ServerTiming } from '@/lib/server-timing';

export async function GET() {
  const timing = new ServerTiming('api.user.profile');
  try {
    const { userId } = await timing.time('auth', () => auth(), 'Clerk authentication');
    if (!userId) {
      return timing.finish(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    }

    const user = await timing.time(
      'db_profile',
      () => prisma.user.findUnique({
        where: { clerkId: userId },
        select: {
          id: true,
          email: true,
          name: true,
          nickname: true,
          phone: true,
          wechatId: true,
          role: true,
        },
      }),
      'User profile query',
    );

    if (!user) {
      return timing.finish(NextResponse.json({ error: 'User not found' }, { status: 404 }));
    }

    return timing.finish(NextResponse.json({ user }));
  } catch (error) {
    console.error('Error fetching profile:', error);
    return timing.finish(NextResponse.json({ error: 'Internal server error' }, { status: 500 }));
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const current = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { role: true },
    });

    if (!current) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await req.json();
    const nickname = String(body.nickname || '').trim();
    const phone = String(body.phone || '').trim();
    const wechatId = String(body.wechatId || '').trim();

    if (current.role === 'CANDIDATE' && (!nickname || !phone || !wechatId)) {
      return NextResponse.json(
        { error: 'Candidate profile requires nickname, phone, and wechatId' },
        { status: 400 }
      );
    }

    const user = await prisma.user.update({
      where: { clerkId: userId },
      data: {
        nickname: nickname || null,
        phone: phone || null,
        wechatId: wechatId || null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        nickname: true,
        phone: true,
        wechatId: true,
        role: true,
      },
    });

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Error updating profile:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
