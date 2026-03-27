import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@clerk/nextjs/server';

export async function POST(req: NextRequest) {
  try {
    const { userId } = auth();

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

export async function GET(req: NextRequest) {
  try {
    const { userId } = auth();

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