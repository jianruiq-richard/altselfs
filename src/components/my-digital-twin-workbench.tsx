'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  BookOpen,
  Brain,
  Clock,
  Eye,
  EyeOff,
  Heart,
  MessageCircle,
  Plus,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Upload,
  Briefcase,
  Users,
} from 'lucide-react';

export type AvatarItem = {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  chatsCount: number;
};

export type DefaultAvatarItem = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  avatar: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  isPublic: boolean;
  chatsCount: number;
};

export type ReceivedConversationItem = {
  id: string;
  avatarId: string;
  chatId: string | null;
  visitor: {
    name: string;
    avatar: string;
    title: string;
  };
  lastMessage: string;
  messageCount: number;
  startTime: string;
  lastActiveTime: string;
  status: 'active' | 'completed';
  aiSummary: string;
};

type Props = {
  totalTokens: number;
  totalCompletion: number;
  defaultAvatar: DefaultAvatarItem;
  receivedConversations: ReceivedConversationItem[];
};

const completionAreas = [
  { name: '基础信息', progress: 100, Icon: Sparkles },
  { name: '技能专长', progress: 75, Icon: Brain },
  { name: '工作经历', progress: 60, Icon: Briefcase },
  { name: '知识库', progress: 45, Icon: BookOpen },
  { name: '价值观', progress: 30, Icon: Heart },
  { name: '人生目标', progress: 20, Icon: Target },
] as const;

const initialSkills = [
  { id: 1, name: '投研分析', level: '专家', category: '工作', description: '擅长识别关键投资信号，形成结构化判断。' },
  { id: 2, name: '项目评估', level: '高级', category: '技术', description: '可快速理解项目架构与实现方案。' },
  { id: 3, name: '沟通协作', level: '高级', category: '软技能', description: '对创业者反馈直接且可执行。' },
];

const initialKnowledge = [
  { id: 1, title: '投资方法论', content: '包含赛道判断、团队判断、风险控制等。', tokens: 2400, type: '工作' },
  { id: 2, title: '沟通风格规范', content: '偏好清晰、简洁、有结论的表达方式。', tokens: 1600, type: '性格' },
];

export default function MyDigitalTwinWorkbench({
  totalTokens,
  totalCompletion,
  defaultAvatar,
  receivedConversations,
}: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'overview' | 'conversations' | 'skills' | 'knowledge' | 'personality' | 'values'>('overview');
  const [isPublic, setIsPublic] = useState(defaultAvatar.isPublic);
  const [isLoading, setIsLoading] = useState(false);
  const [skills, setSkills] = useState(initialSkills);
  const [knowledge, setKnowledge] = useState(initialKnowledge);
  const [bio, setBio] = useState(defaultAvatar.description || '专注于 AI 与软件方向的投资人，关注长期价值与执行力。');
  const [formData, setFormData] = useState({
    name: defaultAvatar.name,
    description: defaultAvatar.description || '',
    systemPrompt: defaultAvatar.systemPrompt || '',
  });

  const knowledgeTokens = useMemo(() => knowledge.reduce((sum, item) => sum + item.tokens, 0), [knowledge]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSaveAvatar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.systemPrompt.trim() || isLoading) return;

    setIsLoading(true);
    try {
      const res = await fetch(`/api/avatar/${defaultAvatar.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          status: defaultAvatar.status,
          isPublic,
        }),
      });

      if (!res.ok) {
        console.error('Failed to update avatar');
        return;
      }

      router.refresh();
      setActiveTab('overview');
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTogglePublic = async () => {
    if (isLoading) return;

    const nextIsPublic = !isPublic;
    setIsPublic(nextIsPublic);
    setIsLoading(true);
    try {
      const res = await fetch(`/api/avatar/${defaultAvatar.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description,
          systemPrompt: formData.systemPrompt,
          status: defaultAvatar.status,
          isPublic: nextIsPublic,
        }),
      });

      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        setIsPublic(!nextIsPublic);
        console.error('Failed to update avatar visibility', detail?.error || res.statusText);
        return;
      }

      router.refresh();
    } catch (error) {
      setIsPublic(!nextIsPublic);
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">我的数字分身</h1>
          <p className="mt-2 text-sm text-gray-500 sm:text-base">不断充实你的数字分身，让它越来越懂你</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-start">
          <button
            type="button"
            onClick={handleTogglePublic}
            disabled={isLoading}
            className="inline-flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <span className="inline-flex items-center gap-2">
              {isPublic ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              {isPublic ? '公开展示' : '仅自己可见'}
            </span>
            <span
              className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors ${
                isPublic ? 'bg-[#030213]' : 'bg-[#cbced4]'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  isPublic ? 'translate-x-[18px]' : 'translate-x-[2px]'
                }`}
              />
            </span>
          </button>
          <Link href="/digital-twins" className="inline-flex items-center justify-center rounded-lg bg-[#030213] px-4 py-3 text-sm font-medium text-white hover:bg-black sm:py-2">
            <MessageCircle className="mr-2 h-4 w-4" />
            与我的分身对话
          </Link>
        </div>
      </div>

      <div className="mb-8 rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-purple-50 p-4 sm:p-6">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="mb-1 text-xl font-bold text-gray-900">完整度: {totalCompletion}%</h3>
            <p className="text-sm text-gray-600">继续完善，让你的数字分身更加丰满</p>
          </div>
          <div className="text-left sm:text-right">
            <div className="text-3xl font-bold text-blue-600">{(totalTokens + knowledgeTokens).toLocaleString()}</div>
            <p className="text-sm text-gray-600">上下文tokens</p>
          </div>
        </div>
        <div className="mb-4 h-3 overflow-hidden rounded-full bg-[#c3c4d1]">
          <div className="h-full rounded-full bg-[#030213]" style={{ width: `${totalCompletion}%` }} />
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {completionAreas.map((area) => (
            <div key={area.name} className="text-center">
              <div className="mb-2 flex justify-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white">
                  <area.Icon className="h-6 w-6 text-blue-600" />
                </div>
              </div>
              <p className="mb-1 text-sm font-medium text-gray-900">{area.name}</p>
              <p className="text-xs text-gray-600">{area.progress}%</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-6 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 text-[#717182]">
        {[
          ['overview', '概览'],
          ['conversations', `收到的对话 ${receivedConversations.length}`],
          ['skills', '技能专长'],
          ['knowledge', '知识库'],
          ['personality', '性格特质'],
          ['values', '价值观'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key as typeof activeTab)}
            className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-2 text-sm font-medium transition-[color,box-shadow] ${
              activeTab === key
                ? 'border-transparent bg-white text-[#030213] shadow-sm ring-1 ring-black/5'
                : 'border-transparent bg-[#ececf0] text-[#717182] hover:text-[#030213]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? (
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="text-xl font-bold text-gray-900">基础信息</h2>
            <p className="mt-1 text-sm text-gray-500">这些信息会影响别人如何认识你的数字分身</p>

            <form onSubmit={handleSaveAvatar} className="mt-5 space-y-4">
              <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-4xl text-white">
                  {(formData.name || '分').slice(0, 1)}
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
                >
                  更换头像
                </button>
              </div>

              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium text-gray-700">分身名称</label>
                <input
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  placeholder="例如：Alex Chen"
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="description" className="text-sm font-medium text-gray-700">职业标签</label>
                <textarea
                  id="description"
                  name="description"
                  rows={2}
                  value={formData.description}
                  onChange={handleChange}
                  placeholder="例如：全栈工程师 & 创业者"
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="systemPrompt" className="text-sm font-medium text-gray-700">个人简介</label>
                <textarea
                  id="systemPrompt"
                  name="systemPrompt"
                  rows={5}
                  value={formData.systemPrompt}
                  onChange={handleChange}
                  required
                  placeholder="简单介绍这个分身的背景和投资偏好..."
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="rounded-xl bg-[#030213] px-4 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-60"
              >
                {isLoading ? '保存中...' : '保存分身信息'}
              </button>
            </form>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-gray-900">快速充实</h3>
            <p className="mt-1 text-sm text-gray-500">通过不同方式快速建立你的数字分身</p>
            <div className="mt-4 space-y-3">
              <button type="button" className="flex w-full items-center justify-start rounded-xl border border-gray-300 px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-50">
                <Upload className="mr-3 h-5 w-5" />
                上传简历（自动提取技能和经历）
              </button>
              <button type="button" className="flex w-full items-center justify-start rounded-xl border border-gray-300 px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-50">
                <MessageCircle className="mr-3 h-5 w-5" />
                通过对话充实（AI引导式提问）
              </button>
              <button type="button" className="flex w-full items-center justify-start rounded-xl border border-gray-300 px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-50">
                <BookOpen className="mr-3 h-5 w-5" />
                导入文档（笔记、博客、文章）
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-green-200 bg-gradient-to-br from-green-50 to-blue-50 p-6">
            <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                  <Users className="h-5 w-5 text-green-600" />
                  收到的对话
                </h3>
                <p className="mt-1 text-sm text-gray-500">其他用户与你的数字分身的对话</p>
              </div>
              <div className="text-left sm:text-right">
                <div className="text-3xl font-bold text-green-600">{receivedConversations.length}</div>
                <p className="text-sm text-gray-600">总对话数</p>
              </div>
            </div>
            <div className="space-y-3">
              {receivedConversations.slice(0, 3).map((conv) => (
                <div key={conv.id} className="rounded-lg border border-gray-200 bg-white p-3 transition-colors hover:border-gray-300">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-xl text-white">
                      {conv.visitor.avatar}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <h4 className="font-semibold text-gray-900">{conv.visitor.name}</h4>
                        <span className="text-sm text-gray-500">·</span>
                        <span className="text-sm text-gray-500">{conv.visitor.title}</span>
                      </div>
                      <p className="mb-1 line-clamp-1 text-sm text-gray-600">{conv.lastMessage}</p>
                      <div className="flex items-center gap-3 text-xs text-gray-400">
                        <span>{conv.messageCount} 条消息</span>
                        <span>·</span>
                        <span>{new Date(conv.lastActiveTime).toLocaleDateString('zh-CN')}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-4 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => setActiveTab('conversations')}
            >
              查看全部对话
            </button>
          </div>
        </div>
      ) : null}

      {activeTab === 'conversations' ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900">
                <Users className="h-5 w-5 text-blue-600" />
                收到的对话记录
              </h2>
              <p className="text-sm text-gray-500">查看所有与你数字分身对话的访客及 AI 总结</p>
            </div>
            <span className="self-start rounded-full bg-gray-100 px-4 py-2 text-sm text-gray-700">
              {receivedConversations.length} 个对话
            </span>
          </div>

          {receivedConversations.length === 0 ? (
            <div className="py-12 text-center">
              <Users className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <h3 className="text-lg font-semibold text-gray-900">还没有收到对话</h3>
              <p className="mt-1 text-sm text-gray-500">当其他用户与你的数字分身对话时，这里会显示记录</p>
            </div>
          ) : (
            <div className="space-y-4">
              {receivedConversations.map((conv) => (
                <div key={conv.id} className="rounded-xl border-2 border-gray-200 p-4 transition-colors hover:border-blue-300 sm:p-5">
                  <div className="mb-4 flex items-start gap-3 sm:gap-4">
                    <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-2xl text-white">
                      {conv.visitor.avatar}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-bold text-gray-900">{conv.visitor.name}</h3>
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{conv.visitor.title}</span>
                        <span
                          className={`rounded px-2 py-0.5 text-xs ${
                            conv.status === 'active' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {conv.status === 'active' ? '进行中' : '已结束'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                        <div className="flex items-center gap-1">
                          <MessageCircle className="h-4 w-4" />
                          <span>{conv.messageCount} 条消息</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          <span>
                            开始于 {new Date(conv.startTime).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          <span>
                            最后活跃 {new Date(conv.lastActiveTime).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mb-4 rounded-lg bg-gray-50 p-3">
                    <p className="mb-1 text-xs text-gray-500">最新消息</p>
                    <p className="text-sm text-gray-900">{conv.lastMessage}</p>
                  </div>

                  <div className="rounded-lg border border-blue-200 bg-gradient-to-br from-blue-50 to-purple-50 p-4">
                    <div className="mb-2 flex items-start gap-2">
                      <Sparkles className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" />
                      <h4 className="font-semibold text-gray-900">AI 对话总结</h4>
                    </div>
                    <p className="ml-7 text-sm leading-relaxed text-gray-700">{conv.aiSummary}</p>
                  </div>

                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    {conv.chatId ? (
                      <Link
                        href={`/avatar/${conv.avatarId}/chat/${conv.chatId}`}
                        className="rounded-lg border border-gray-300 px-3 py-3 text-center text-sm text-gray-700 hover:bg-gray-50 sm:py-2"
                      >
                        查看完整对话
                      </Link>
                    ) : (
                      <button type="button" className="rounded-lg border border-gray-300 px-3 py-3 text-sm text-gray-700 sm:py-2">
                        查看完整对话
                      </button>
                    )}
                    {conv.chatId ? (
                      <Link
                        href={`/avatar/${conv.avatarId}/chat/${conv.chatId}`}
                        className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-3 py-3 text-sm text-gray-700 hover:bg-gray-50 sm:py-2"
                      >
                        <MessageCircle className="mr-2 h-4 w-4" />
                        回复访客
                      </Link>
                    ) : (
                      <button type="button" className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-3 py-3 text-sm text-gray-700 sm:py-2">
                        <MessageCircle className="mr-2 h-4 w-4" />
                        回复访客
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {activeTab === 'skills' ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-gray-900">技能专长</h2>
              <p className="text-sm text-gray-500">记录你的技能和专长，AI会学习你的专业知识</p>
            </div>
            <button
              type="button"
              onClick={() =>
                setSkills((prev) => [...prev, { id: Date.now(), name: '新技能（演示）', level: '初级', category: '演示', description: '可后续接入真实编辑能力。' }])
              }
              className="inline-flex items-center rounded-lg bg-[#030213] px-3 py-2 text-sm font-medium text-white hover:bg-black"
            >
              <Plus className="mr-1 h-4 w-4" />
              添加技能
            </button>
          </div>
          <div className="space-y-3">
            {skills.map((skill) => (
              <div key={skill.id} className="rounded-lg border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-gray-900">{skill.name}</h3>
                      <span className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white">{skill.level}</span>
                      <span className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600">{skill.category}</span>
                    </div>
                    <p className="text-sm text-gray-600">{skill.description}</p>
                  </div>
                  <button type="button" onClick={() => setSkills((prev) => prev.filter((item) => item.id !== skill.id))} className="rounded p-1 text-red-600 hover:bg-red-50">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {activeTab === 'knowledge' ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-gray-900">知识库（无限上下文）</h2>
              <p className="text-sm text-gray-500">像 Figma demo 一样先展示概念，后续再逐项接通</p>
            </div>
            <button
              type="button"
              onClick={() =>
                setKnowledge((prev) => [...prev, { id: Date.now(), title: '新知识（演示）', content: '可后续接入真实内容编辑。', tokens: 600, type: '演示' }])
              }
              className="inline-flex items-center rounded-lg bg-[#030213] px-3 py-2 text-sm font-medium text-white hover:bg-black"
            >
              <Plus className="mr-1 h-4 w-4" />
              添加知识
            </button>
          </div>

          <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium text-blue-900">总计 {knowledgeTokens.toLocaleString()} tokens</p>
                <p className="mt-1 text-sm text-blue-700">持续积累知识，分身表达会更接近你</p>
              </div>
              <TrendingUp className="h-8 w-8 text-blue-600" />
            </div>
          </div>

          <div className="space-y-3">
            {knowledge.map((item) => (
              <div key={item.id} className="rounded-lg border border-gray-200 p-4">
                <div className="mb-1 flex items-start justify-between gap-3">
                  <h3 className="font-semibold text-gray-900">{item.title}</h3>
                  <button type="button" onClick={() => setKnowledge((prev) => prev.filter((k) => k.id !== item.id))} className="rounded p-1 text-red-600 hover:bg-red-50">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <p className="text-sm text-gray-600">{item.content}</p>
                <p className="mt-1 text-xs text-gray-400">{item.tokens.toLocaleString()} tokens · {item.type}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {activeTab === 'personality' ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-xl font-bold text-gray-900">性格特质</h2>
          <p className="mt-1 text-sm text-gray-500">描述你的性格特点，让数字分身更像你</p>
          <div className="mt-4 space-y-3">
            <textarea rows={3} className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="沟通风格，例如：友好、直接、幽默..." />
            <textarea rows={3} className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="思考方式，例如：理性分析、注重细节..." />
            <textarea rows={3} className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="决策偏好，例如：数据驱动、长期主义..." />
            <button type="button" className="rounded-lg bg-[#030213] px-4 py-2 text-sm font-medium text-white hover:bg-black">保存性格特质</button>
          </div>
        </div>
      ) : null}

      {activeTab === 'values' ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-xl font-bold text-gray-900">价值观与人生理念</h2>
          <p className="mt-1 text-sm text-gray-500">分享你的价值观、人生目标和理念</p>
          <div className="mt-4 space-y-3">
            <textarea rows={4} value={bio} onChange={(e) => setBio(e.target.value)} className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="核心价值观" />
            <textarea rows={4} className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="人生目标" />
            <textarea rows={4} className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="工作理念" />
            <textarea rows={4} className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="生活态度" />
            <button type="button" className="rounded-lg bg-[#030213] px-4 py-2 text-sm font-medium text-white hover:bg-black">保存价值观</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
