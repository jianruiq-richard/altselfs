'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useUser } from '@clerk/nextjs';

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

  useEffect(() => {
    if (avatarId && user) {
      fetchAvatarAndChat();
    }
  }, [avatarId, user]);

  const fetchAvatarAndChat = async () => {
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
  };

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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  if (!avatar) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">分身不存在</h1>
          <p className="text-gray-600">请检查链接是否正确</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center mr-3">
              {avatar.avatar ? (
                <img
                  src={avatar.avatar}
                  alt={avatar.name}
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              )}
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">{avatar.name}</h1>
              <p className="text-sm text-gray-500">
                来自 {avatar.investor.name || '匿名投资人'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-8">
              <p className="text-gray-500 mb-4">开始与 {avatar.name} 对话吧！</p>
              <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-800">
                <p className="font-medium mb-2">提示：</p>
                <ul className="text-left space-y-1">
                  <li>• 介绍你的项目和团队背景</li>
                  <li>• 说明你的商业模式和市场机会</li>
                  <li>• 询问投资建议和改进方向</li>
                </ul>
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <div
              key={message.id || index}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                  message.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-900 shadow-sm'
                }`}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                <p className={`text-xs mt-1 ${
                  message.role === 'user' ? 'text-blue-100' : 'text-gray-500'
                }`}>
                  {new Date(message.createdAt).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </div>
          ))}

          {isSending && (
            <div className="flex justify-start">
              <div className="bg-white text-gray-900 shadow-sm max-w-xs lg:max-w-md px-4 py-2 rounded-lg">
                <div className="flex items-center space-x-2">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                  <span className="text-sm text-gray-500">正在回复...</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="bg-white border-t p-4">
        <div className="max-w-3xl mx-auto">
          <form onSubmit={sendMessage} className="flex space-x-4">
            <textarea
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="输入你的消息..."
              className="flex-1 resize-none border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
              className="bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed self-end"
            >
              {isSending ? '发送中...' : '发送'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}