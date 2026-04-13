import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@clerk/nextjs/server';
import { isDemoMode } from '@/lib/dev-auth';
import { buildFallbackEmail } from '@/lib/user-identifier';

function defaultTwinName(name?: string | null) {
  const base = String(name || '').trim();
  return base ? `${base} 的数字分身` : '我的数字分身';
}

const DEFAULT_TWIN_PROMPT =
  '你是该用户的数字分身。请保持专业、清晰、真诚的表达，基于已知信息回答问题；信息不足时主动追问，不要编造事实。';

export async function POST(req: NextRequest) {
  try {
    // Handle demo mode
    if (isDemoMode) {
      const { clerkId, email, name, role } = await req.json();

      if (!clerkId || !email || !role) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      }

      // Create user in database for demo
      const user = await prisma.user.create({
        data: {
          clerkId,
          email,
          name,
          role: role === 'INVESTOR' ? 'INVESTOR' : 'CANDIDATE',
        },
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

    const normalizedEmail = String(email || '').trim() || buildFallbackEmail(userId);
    const normalizedRole = role === 'INVESTOR' ? 'INVESTOR' : 'CANDIDATE';
    if (normalizedRole === 'CANDIDATE' && (!nickname || !phone || !wechatId)) {
      return NextResponse.json(
        { error: 'Candidate profile requires nickname, phone, and wechatId' },
        { status: 400 }
      );
    }
    const existingUser = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (existingUser) {
      if (existingUser.role !== normalizedRole) {
        return NextResponse.json(
          { error: 'Role is already fixed for this account and cannot be changed' },
          { status: 409 }
        );
      }

      const user = await prisma.user.update({
        where: { clerkId: userId },
        data: {
          email: normalizedEmail,
          name,
          nickname: normalizedRole === 'CANDIDATE' ? nickname : existingUser.nickname,
          phone: normalizedRole === 'CANDIDATE' ? phone : existingUser.phone,
          wechatId: normalizedRole === 'CANDIDATE' ? wechatId : existingUser.wechatId,
        },
      });

      if (normalizedRole === 'INVESTOR') {
        const hasAvatar = await prisma.avatar.findFirst({
          where: { investorId: user.id },
          select: { id: true },
        });
        if (!hasAvatar) {
          await prisma.avatar.create({
            data: {
              investorId: user.id,
              name: defaultTwinName(user.name),
              description: '这是你的默认数字分身，可在“我的数字分身”页持续完善。',
              systemPrompt: DEFAULT_TWIN_PROMPT,
              status: 'ACTIVE',
            },
          });
        }
      }

      return NextResponse.json({ user });
    }

    // Use authenticated clerk user id, do not trust client-sent clerkId
    const user = await prisma.user.create({
      data: {
        clerkId: userId,
        email: normalizedEmail,
        name,
        nickname: normalizedRole === 'CANDIDATE' ? nickname : null,
        phone: normalizedRole === 'CANDIDATE' ? phone : null,
        wechatId: normalizedRole === 'CANDIDATE' ? wechatId : null,
        role: normalizedRole,
      },
    });

    if (normalizedRole === 'INVESTOR') {
      await prisma.avatar.create({
        data: {
          investorId: user.id,
          name: defaultTwinName(user.name),
          description: '这是你的默认数字分身，可在“我的数字分身”页持续完善。',
          systemPrompt: DEFAULT_TWIN_PROMPT,
          status: 'ACTIVE',
        },
      });
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Error creating user:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
