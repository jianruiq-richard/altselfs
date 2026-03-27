import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@clerk/nextjs/server';
import { isDemoMode } from '@/lib/dev-auth';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const avatarId = searchParams.get('avatarId');

    if (!avatarId) {
      return NextResponse.json({ error: 'Avatar ID is required' }, { status: 400 });
    }

    // Handle demo mode
    if (isDemoMode) {
      // Create or find demo candidate user
      let user = await prisma.user.findUnique({
        where: { clerkId: 'demo-candidate-id' },
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            clerkId: 'demo-candidate-id',
            email: 'demo-candidate@example.com',
            name: 'Demo Candidate',
            role: 'CANDIDATE',
          },
        });
      }

      // Check if avatar exists
      const avatar = await prisma.avatar.findUnique({
        where: { id: avatarId },
      });

      if (!avatar) {
        return NextResponse.json({ error: 'Avatar not found' }, { status: 404 });
      }

      // Find existing chat or create new one
      let chat = await prisma.chat.findFirst({
        where: {
          candidateId: user.id,
          avatarId: avatarId,
          status: 'ACTIVE',
        },
        include: {
          messages: {
            orderBy: {
              createdAt: 'asc',
            },
          },
        },
      });

      if (!chat) {
        // Create new chat
        chat = await prisma.chat.create({
          data: {
            candidateId: user.id,
            avatarId: avatarId,
            title: `与 ${avatar.name} 的对话`,
          },
          include: {
            messages: {
              orderBy: {
                createdAt: 'asc',
              },
            },
          },
        });
      }

      return NextResponse.json({ chat });
    }

    const authResult = await auth();
    const userId = authResult.userId;

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find the user in our database
    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user || user.role !== 'CANDIDATE') {
      return NextResponse.json({ error: 'User not found or not a candidate' }, { status: 403 });
    }

    // Check if avatar exists
    const avatar = await prisma.avatar.findUnique({
      where: { id: avatarId },
    });

    if (!avatar) {
      return NextResponse.json({ error: 'Avatar not found' }, { status: 404 });
    }

    // Find existing chat or create new one
    let chat = await prisma.chat.findFirst({
      where: {
        candidateId: user.id,
        avatarId: avatarId,
        status: 'ACTIVE',
      },
      include: {
        messages: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!chat) {
      // Create new chat
      chat = await prisma.chat.create({
        data: {
          candidateId: user.id,
          avatarId: avatarId,
          title: `与 ${avatar.name} 的对话`,
        },
        include: {
          messages: {
            orderBy: {
              createdAt: 'asc',
            },
          },
        },
      });
    }

    return NextResponse.json({ chat });
  } catch (error) {
    console.error('Error fetching/creating chat:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}