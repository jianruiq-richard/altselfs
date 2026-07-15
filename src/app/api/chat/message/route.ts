import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@clerk/nextjs/server';
import { createChatCompletion, evaluateConversation, getOpenRouterModel } from '@/lib/openrouter';
import { isDemoMode } from '@/lib/dev-auth';

export async function POST(req: NextRequest) {
  try {
    const { chatId, message } = await req.json();

    if (!chatId || !message) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    let user;

    // Handle demo mode
    if (isDemoMode) {
      user = await prisma.user.findUnique({
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
    } else {
      const authResult = await auth();
      const userId = authResult.userId;

      if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // Find the user in our database
      user = await prisma.user.findUnique({
        where: { clerkId: userId },
      });

      if (!user || user.role !== 'CANDIDATE') {
        return NextResponse.json({ error: 'User not found or not a candidate' }, { status: 403 });
      }
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
    await prisma.message.create({
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
      ...chat.messages.map((m) => ({
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
      // Check if we have OpenRouter API key
      if (!process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY.includes('your_openrouter_api_key_here')) {
        // Return a demo response if no real API key
        const demoResponse = `Hi, I am ${chat.avatar.name}'s digital twin.

Thanks for reaching out. To help assess fit, could you share:
1. What problem are you trying to solve?
2. What relevant experience or context should I know?
3. What outcome are you hoping for?

This is demo mode because the AI API key is not configured. Configure the AI service to receive real responses.

Thanks.`;

        await prisma.message.create({
          data: {
            chatId: chatId,
            content: demoResponse,
            role: 'assistant',
          },
        });

        await prisma.chat.update({
          where: { id: chatId },
          data: {
            qualificationStatus: 'NEEDS_INFO',
            qualificationScore: 40,
            qualificationReason: 'Demo mode defaulted to "Needs more information".',
            summary: 'Demo mode: candidate provided an initial message, but no real AI evaluation was run.',
            needsInvestorReview: false,
            lastEvaluatedAt: new Date(),
          },
        });
      } else {
        const aiResponse = await createChatCompletion(messagesForAI, getOpenRouterModel('CHAT'));

        // Save AI message
        await prisma.message.create({
          data: {
            chatId: chatId,
            content: aiResponse,
            role: 'assistant',
          },
        });

        const allMessagesForEvaluation = [
          ...chat.messages.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
          {
            role: 'user' as const,
            content: message,
          },
          {
            role: 'assistant' as const,
            content: aiResponse,
          },
        ];

        const evaluation = await evaluateConversation(chat.avatar.systemPrompt, allMessagesForEvaluation);

        await prisma.chat.update({
          where: { id: chatId },
          data: {
            qualificationStatus: evaluation.status,
            qualificationScore: evaluation.score,
            qualificationReason: evaluation.reason,
            summary: evaluation.summary,
            needsInvestorReview: evaluation.needsInvestorReview || evaluation.status === 'QUALIFIED',
            lastEvaluatedAt: new Date(),
            status: evaluation.status === 'QUALIFIED' ? 'COMPLETED' : 'ACTIVE',
          },
        });
      }

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
      const detail = error instanceof Error ? error.message : 'unknown';

      // Save fallback message if AI fails
      await prisma.message.create({
        data: {
          chatId: chatId,
          content:
            process.env.NODE_ENV === 'development'
              ? `AI response failed: ${detail}`
              : 'The assistant is temporarily unavailable. Please try again later or contact support.',
          role: 'assistant',
        },
      });

      await prisma.chat.update({
        where: { id: chatId },
        data: {
          qualificationStatus: 'PENDING',
          qualificationReason: 'AI response failed, so evaluation is pending.',
          lastEvaluatedAt: new Date(),
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
