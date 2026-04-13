import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auth } from '@clerk/nextjs/server';
import { isDemoMode } from '@/lib/dev-auth';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Demo mode keeps old behavior for quick local verification
    if (isDemoMode) {
      const avatar = await prisma.avatar.findUnique({
        where: { id },
        include: {
          investor: {
            select: {
              name: true,
            },
          },
        },
      });

      if (!avatar) {
        return NextResponse.json({ error: 'Avatar not found' }, { status: 404 });
      }

      return NextResponse.json({ avatar });
    }

    const authResult = await auth();
    const userId = authResult.userId;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({
      where: { clerkId: userId },
    });
    if (!dbUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const avatar = await prisma.avatar.findUnique({
      where: { id },
      include: {
        investor: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!avatar) {
      return NextResponse.json({ error: 'Avatar not found' }, { status: 404 });
    }

    // Only avatar owner can read systemPrompt
    if (avatar.investorId === dbUser.id && dbUser.role === 'INVESTOR') {
      return NextResponse.json({ avatar });
    }

    const safeAvatar = await prisma.avatar.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        avatar: true,
        status: true,
        isPublic: true,
        createdAt: true,
        updatedAt: true,
        investorId: true,
        investor: {
          select: {
            name: true,
          },
        },
      },
    });

    return NextResponse.json({ avatar: safeAvatar });
  } catch (error) {
    console.error('Error fetching avatar:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (isDemoMode) {
      const body = await request.json();
      const existing = await prisma.avatar.findUnique({ where: { id } });
      if (!existing) {
        return NextResponse.json({ error: 'Avatar not found' }, { status: 404 });
      }
      const updated = await prisma.avatar.update({
        where: { id },
        data: {
          name: body.name,
          description: body.description ?? null,
          avatar: body.avatar ?? null,
          status: body.status ?? existing.status,
          isPublic: typeof body.isPublic === 'boolean' ? body.isPublic : existing.isPublic,
          systemPrompt: body.systemPrompt,
        },
      });
      return NextResponse.json({ avatar: updated });
    }

    const authResult = await auth();
    const userId = authResult.userId;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({
      where: { clerkId: userId },
    });
    if (!dbUser || dbUser.role !== 'INVESTOR') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const avatar = await prisma.avatar.findUnique({
      where: { id },
    });
    if (!avatar || avatar.investorId !== dbUser.id) {
      return NextResponse.json({ error: 'Avatar not found or access denied' }, { status: 404 });
    }

    const { name, description, avatar: avatarUrl, status, isPublic, systemPrompt } = await request.json();

    if (!name || !systemPrompt) {
      return NextResponse.json({ error: 'Name and systemPrompt are required' }, { status: 400 });
    }

    const updated = await prisma.avatar.update({
      where: { id },
      data: {
        name,
        description: description ?? null,
        avatar: avatarUrl ?? null,
        status: status ?? avatar.status,
        isPublic: typeof isPublic === 'boolean' ? isPublic : avatar.isPublic,
        systemPrompt,
      },
    });

    return NextResponse.json({ avatar: updated });
  } catch (error) {
    console.error('Error updating avatar:', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2022') {
      return NextResponse.json(
        {
          error: '数据库字段缺失，请先执行最新迁移后再重试',
          code: 'DB_MIGRATION_REQUIRED',
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
