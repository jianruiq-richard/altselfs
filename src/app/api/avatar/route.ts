import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@clerk/nextjs/server';
import { isDemoMode } from '@/lib/dev-auth';

export async function POST(req: NextRequest) {
  try {
    // Handle demo mode
    if (isDemoMode) {
      const { name, description, systemPrompt } = await req.json();

      if (!name || !systemPrompt) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      }

      // Create a demo user if not exists
      let user = await prisma.user.findUnique({
        where: { clerkId: 'demo-user-id' },
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            clerkId: 'demo-user-id',
            email: 'demo@example.com',
            name: 'Demo User',
            role: 'INVESTOR',
          },
        });
      }

      const avatar = await prisma.avatar.create({
        data: {
          name,
          description,
          systemPrompt,
          investorId: user.id,
        },
      });

      return NextResponse.json({ avatar });
    }

    const authResult = await auth();
    const userId = authResult.userId;

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name, description, systemPrompt } = await req.json();

    if (!name || !systemPrompt) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Find the user in our database
    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user || user.role !== 'INVESTOR') {
      return NextResponse.json({ error: 'User not found or not an investor' }, { status: 403 });
    }

    // Create the avatar
    const avatar = await prisma.avatar.create({
      data: {
        name,
        description,
        systemPrompt,
        investorId: user.id,
      },
    });

    return NextResponse.json({ avatar });
  } catch (error) {
    console.error('Error creating avatar:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET() {
  try {
    // Handle demo mode - return all avatars for demo
    if (isDemoMode) {
      const avatars = await prisma.avatar.findMany({
        where: { status: 'ACTIVE' },
        include: {
          investor: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return NextResponse.json({ avatars });
    }

    const authResult = await auth();
    const userId = authResult.userId;

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all active avatars for browsing (for candidates)
    const avatars = await prisma.avatar.findMany({
      where: { status: 'ACTIVE' },
      include: {
        investor: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json({ avatars });
  } catch (error) {
    console.error('Error fetching avatars:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}