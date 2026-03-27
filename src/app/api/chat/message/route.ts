import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@clerk/nextjs/server';
import { createChatCompletion } from '@/lib/openrouter';

export async function POST(req: NextRequest) {
  try {
    const { userId } = auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { chatId, message } = await req.json();

    if (!chatId || !message) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Find the user in our database
    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user || user.role !== 'CANDIDATE') {
      return NextResponse.json({ error: 'User not found or not a candidate' }, { status: 403 });
    }

    // Find the chat and verify ownership
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        avatar: true,
        messages: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!chat || chat.candidateId !== user.id) {
      return NextResponse.json({ error: 'Chat not found or access denied' }, { status: 404 });
    }

    // Save user message
    const userMessage = await prisma.message.create({
      data: {
        chatId: chatId,
        content: message,
        role: 'user',
      },
    });

    // Prepare messages for AI
    const messagesForAI = [
      {
        role: 'system' as const,
        content: chat.avatar.systemPrompt,
      },
      ...chat.messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      {
        role: 'user' as const,
        content: message,
      },
    ];

    // Get AI response
    try {
      const aiResponse = await createChatCompletion(messagesForAI);

      // Save AI message
      const assistantMessage = await prisma.message.create({
        data: {
          chatId: chatId,
          content: aiResponse,
          role: 'assistant',
        },
      });

      // Get updated messages
      const updatedMessages = await prisma.message.findMany({
        where: { chatId: chatId },
        orderBy: {
          createdAt: 'asc',
        },
      });

      return NextResponse.json({ messages: updatedMessages });
    } catch (error) {
      console.error('AI response error:', error);

      // Save fallback message if AI fails
      const fallbackMessage = await prisma.message.create({
        data: {
          chatId: chatId,
          content: '抱歉，我现在无法回复。请稍后再试，或者联系技术支持。',
          role: 'assistant',
        },
      });

      const updatedMessages = await prisma.message.findMany({
        where: { chatId: chatId },
        orderBy: {
          createdAt: 'asc',
        },
      });

      return NextResponse.json({ messages: updatedMessages });
    }
  } catch (error) {
    console.error('Error sending message:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}