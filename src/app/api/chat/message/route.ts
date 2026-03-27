import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@clerk/nextjs/server';
import { createChatCompletion, evaluateConversation } from '@/lib/openrouter';
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
        const demoResponse = `感谢你分享你的项目想法！作为 ${chat.avatar.name}，我很乐意为你提供一些建议。

基于你刚才的描述，我有几个问题：
1. 你们的目标市场规模有多大？
2. 目前有哪些直接竞争对手？
3. 你们的核心竞争优势是什么？

这是一个演示回复，因为系统还没有配置真实的AI API密钥。在生产环境中，这里会连接到真实的AI模型来生成个性化的投资建议。

请继续分享更多关于你项目的详细信息！`;

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
            qualificationReason: '当前处于演示模式，已默认标记为“待补充信息”。',
            summary: '演示模式：系统未调用真实模型，请继续补充项目信息后再由真实模型评估。',
            needsInvestorReview: false,
            lastEvaluatedAt: new Date(),
          },
        });
      } else {
        const aiResponse = await createChatCompletion(messagesForAI);

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
              ? `AI调用失败：${detail}`
              : '抱歉，我现在无法回复。请稍后再试，或者联系技术支持。',
          role: 'assistant',
        },
      });

      await prisma.chat.update({
        where: { id: chatId },
        data: {
          qualificationStatus: 'PENDING',
          qualificationReason: '本轮AI回复失败，评估暂未更新。',
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
