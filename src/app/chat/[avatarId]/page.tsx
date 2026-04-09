'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { FigmaShell } from '@/components/figma-shell';

interface Message {
  id: string;
  content: string;
  role: string;
  createdAt: string;
}

interface Avatar {
  id: string;
  name: string;
  description: string;
  avatar?: string;
  investor: {
    name: string;
  };
}

interface Chat {
  id: string;
  title?: string;
  messages: Message[];
}

export default function ChatPage() {
  const params = useParams();
  const { user } = useUser();
  const avatarId = params.avatarId as string;

  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const fetchAvatarAndChat = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch avatar info
      const avatarResponse = await fetch(`/api/avatar/${avatarId}`);
      if (avatarResponse.ok) {
        const avatarData = await avatarResponse.json();
        setAvatar(avatarData.avatar);
      }

      // Fetch or create chat
      const chatResponse = await fetch(`/api/chat?avatarId=${avatarId}`);
      if (chatResponse.ok) {
        const chatData = await chatResponse.json();
        setChat(chatData.chat);
        setMessages(chatData.chat.messages || []);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [avatarId]);

  useEffect(() => {
    if (avatarId && user) {
      void fetchAvatarAndChat();
    }
  }, [avatarId, user, fetchAvatarAndChat]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !chat || isSending) return;

    setIsSending(true);
    const userMessage = newMessage.trim();
    setNewMessage('');

    // Add user message to UI immediately
    const tempUserMessage: Message = {
      id: 'temp-user',
      content: userMessage,
      role: 'user',
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempUserMessage]);

    try {
      const response = await fetch('/api/chat/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chatId: chat.id,
          message: userMessage,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        // Replace temp message and add AI response
        setMessages(data.messages);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      // Remove temp message on error
      setMessages(prev => prev.filter(m => m.id !== 'temp-user'));
    } finally {
      setIsSending(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">加载中...</p>
        </div>
      </div>
    );
  }

  if (!avatar) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900 mb-4">分身不存在</h1>
          <p className="text-slate-600">请检查链接是否正确</p>
        </div>
      </div>
    );
  }

  return (
    <FigmaShell
      homeHref="/candidate"
      title={avatar.name}
      subtitle={`来自 ${avatar.investor.name || 'OPC成员'} 的数字分身`}
      actions={
        <Link href="/candidate" className="text-sm text-blue-700 hover:underline">
          返回分身大厅
        </Link>
      }
    >
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="h-[56vh] overflow-y-auto p-5">
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.length === 0 && (
              <div className="py-8 text-center">
                <p className="mb-4 text-slate-600">开始与 {avatar.name} 对话吧！</p>
                <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-800">
                  <p className="mb-2 font-medium">提示：</p>
                  <ul className="space-y-1 text-left">
                    <li>• 介绍你的项目和团队背景</li>
                    <li>• 说明你的商业模式和市场机会</li>
                    <li>• 询问投资建议和改进方向</li>
                  </ul>
                </div>
              </div>
            )}

            {messages.map((message, index) => (
              <div key={message.id || index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-xs rounded-2xl px-4 py-3 lg:max-w-md ${
                    message.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-900'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  <p className={`mt-1 text-xs ${message.role === 'user' ? 'text-blue-100' : 'text-slate-500'}`}>
                    {new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}

            {isSending && (
              <div className="flex justify-start">
                <div className="max-w-xs rounded-2xl bg-slate-100 px-4 py-3 text-slate-700 lg:max-w-md">
                  正在回复...
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-slate-200 p-4">
          <form onSubmit={sendMessage} className="mx-auto flex max-w-3xl gap-3">
            <textarea
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="输入你的消息..."
              className="flex-1 resize-none rounded-xl border border-slate-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(e);
                }
              }}
            />
            <button
              type="submit"
              disabled={!newMessage.trim() || isSending}
              className="self-end rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSending ? '发送中...' : '发送'}
            </button>
          </form>
        </div>
      </div>
    </FigmaShell>
  );
}
