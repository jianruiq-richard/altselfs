import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const avatar = await prisma.avatar.findUnique({
      where: { id: params.id },
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
  } catch (error) {
    console.error('Error fetching avatar:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}