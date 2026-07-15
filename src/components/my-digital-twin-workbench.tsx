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
  { name: 'Basic Info', progress: 100, Icon: Sparkles },
  { name: 'Skills', progress: 75, Icon: Brain },
  { name: 'Work Experience', progress: 60, Icon: Briefcase },
  { name: 'Knowledge Base', progress: 45, Icon: BookOpen },
  { name: 'Values', progress: 30, Icon: Heart },
  { name: 'Life Goals', progress: 20, Icon: Target },
] as const;

const initialSkills = [
  { id: 1, name: 'Investment Research', level: 'Expert', category: 'Work', description: 'Market research, company analysis, and decision support.' },
  { id: 2, name: 'Project Evaluation', level: 'Advanced', category: 'Technical', description: 'Evaluates feasibility, constraints, and execution risk.' },
  { id: 3, name: 'Communication', level: 'Advanced', category: 'Soft skills', description: 'Clear, concise, conclusion-first communication.' },
];

const initialKnowledge = [
  { id: 1, title: 'Investment Methodology', content: 'Includes market decisions, team decisions, risk controls, and related principles.', tokens: 2400, type: 'Work' },
  { id: 2, title: 'Communication Style Guide', content: 'Prefers clear, concise, conclusion-first communication.', tokens: 1600, type: 'Style' },
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
  const [bio, setBio] = useState(defaultAvatar.description || 'Investor focused on AI and software, with emphasis on long-term value and execution.');
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
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">My Digital Twin</h1>
          <p className="mt-2 text-sm text-gray-500 sm:text-base">Keep enriching your digital twin so it understands you better over time</p>
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
              {isPublic ? 'Public' : 'Private'}
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
            Chat with my twin
          </Link>
        </div>
      </div>

      <div className="mb-8 rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-purple-50 p-4 sm:p-6">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="mb-1 text-xl font-bold text-gray-900">Completion: {totalCompletion}%</h3>
            <p className="text-sm text-gray-600">Keep improving your digital twin with richer context</p>
          </div>
          <div className="text-left sm:text-right">
            <div className="text-3xl font-bold text-blue-600">{(totalTokens + knowledgeTokens).toLocaleString()}</div>
            <p className="text-sm text-gray-600">Context tokens</p>
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
          ['overview', 'Overview'],
          ['conversations', `Received conversations ${receivedConversations.length}`],
          ['skills', 'Skills'],
          ['knowledge', 'Knowledge Base'],
          ['personality', 'Personality'],
          ['values', 'Values'],
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
            <h2 className="text-xl font-bold text-gray-900">Basic Info</h2>
            <p className="mt-1 text-sm text-gray-500">This information shapes how others understand your digital twin</p>

            <form onSubmit={handleSaveAvatar} className="mt-5 space-y-4">
              <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-4xl text-white">
                  {(formData.name || 'Twin').slice(0, 1)}
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
                >
                  Change avatar
                </button>
              </div>

              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium text-gray-700">Twin name</label>
                <input
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  placeholder="Example: Alex Chen"
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="description" className="text-sm font-medium text-gray-700">Professional tagline</label>
                <textarea
                  id="description"
                  name="description"
                  rows={2}
                  value={formData.description}
                  onChange={handleChange}
                  placeholder="Example: Investor, operator, and product strategist"
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="systemPrompt" className="text-sm font-medium text-gray-700">Bio</label>
                <textarea
                  id="systemPrompt"
                  name="systemPrompt"
                  rows={5}
                  value={formData.systemPrompt}
                  onChange={handleChange}
                  required
                  placeholder="Briefly describe this twin's background and investment preferences..."
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="rounded-xl bg-[#030213] px-4 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-60"
              >
                {isLoading ? 'Saving...' : 'Save twin profile'}
              </button>
            </form>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-gray-900">Quick enrichment</h3>
            <p className="mt-1 text-sm text-gray-500">Build your digital twin quickly through multiple inputs</p>
            <div className="mt-4 space-y-3">
              <button type="button" className="flex w-full items-center justify-start rounded-xl border border-gray-300 px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-50">
                <Upload className="mr-3 h-5 w-5" />
                Upload resume (auto-extract skills and experience)
              </button>
              <button type="button" className="flex w-full items-center justify-start rounded-xl border border-gray-300 px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-50">
                <MessageCircle className="mr-3 h-5 w-5" />
                Enrich through conversation (AI-guided questions)
              </button>
              <button type="button" className="flex w-full items-center justify-start rounded-xl border border-gray-300 px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-50">
                <BookOpen className="mr-3 h-5 w-5" />
                Import documents (notes, blogs, articles)
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-green-200 bg-gradient-to-br from-green-50 to-blue-50 p-6">
            <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                  <Users className="h-5 w-5 text-green-600" />
                  Received conversations
                </h3>
                <p className="mt-1 text-sm text-gray-500">Recent visitors who interacted with your digital twin</p>
              </div>
              <div className="text-left sm:text-right">
                <div className="text-3xl font-bold text-green-600">{receivedConversations.length}</div>
                <p className="text-sm text-gray-600">Total conversations</p>
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
                        <span>{conv.messageCount} messages</span>
                        <span>·</span>
                        <span>{new Date(conv.lastActiveTime).toLocaleDateString('en-US')}</span>
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
              View all conversations
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
                Received conversation history
              </h2>
              <p className="text-sm text-gray-500">View visitors who chatted with your digital twin and AI summaries</p>
            </div>
            <span className="self-start rounded-full bg-gray-100 px-4 py-2 text-sm text-gray-700">
              {receivedConversations.length} conversations
            </span>
          </div>

          {receivedConversations.length === 0 ? (
            <div className="py-12 text-center">
              <Users className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <h3 className="text-lg font-semibold text-gray-900">No conversations yet</h3>
              <p className="mt-1 text-sm text-gray-500">Share your digital twin to start collecting conversations.</p>
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
                          {conv.status === 'active' ? 'Active' : 'Completed'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                        <div className="flex items-center gap-1">
                          <MessageCircle className="h-4 w-4" />
                          <span>{conv.messageCount} messages</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          <span>
                            Started {new Date(conv.startTime).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          <span>
                            Last active {new Date(conv.lastActiveTime).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mb-4 rounded-lg bg-gray-50 p-3">
                    <p className="mb-1 text-xs text-gray-500">Latest message</p>
                    <p className="text-sm text-gray-900">{conv.lastMessage}</p>
                  </div>

                  <div className="rounded-lg border border-blue-200 bg-gradient-to-br from-blue-50 to-purple-50 p-4">
                    <div className="mb-2 flex items-start gap-2">
                      <Sparkles className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" />
                      <h4 className="font-semibold text-gray-900">AI Conversation summary</h4>
                    </div>
                    <p className="ml-7 text-sm leading-relaxed text-gray-700">{conv.aiSummary}</p>
                  </div>

                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    {conv.chatId ? (
                      <Link
                        href={`/avatar/${conv.avatarId}/chat/${conv.chatId}`}
                        className="rounded-lg border border-gray-300 px-3 py-3 text-center text-sm text-gray-700 hover:bg-gray-50 sm:py-2"
                      >
                        View full conversation
                      </Link>
                    ) : (
                      <button type="button" className="rounded-lg border border-gray-300 px-3 py-3 text-sm text-gray-700 sm:py-2">
                        View full conversation
                      </button>
                    )}
                    {conv.chatId ? (
                      <Link
                        href={`/avatar/${conv.avatarId}/chat/${conv.chatId}`}
                        className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-3 py-3 text-sm text-gray-700 hover:bg-gray-50 sm:py-2"
                      >
                        <MessageCircle className="mr-2 h-4 w-4" />
                        Open chat
                      </Link>
                    ) : (
                      <button type="button" className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-3 py-3 text-sm text-gray-700 sm:py-2">
                        <MessageCircle className="mr-2 h-4 w-4" />
                        Open chat
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
              <h2 className="text-xl font-bold text-gray-900">Skills</h2>
              <p className="text-sm text-gray-500">Skills your digital twin can use in AI-assisted conversations</p>
            </div>
            <button
              type="button"
              onClick={() =>
                setSkills((prev) => [...prev, { id: Date.now(), name: 'New skill (Demo)', level: 'Beginner', category: 'Demo', description: 'Add a short description for this skill.' }])
              }
              className="inline-flex items-center rounded-lg bg-[#030213] px-3 py-2 text-sm font-medium text-white hover:bg-black"
            >
              <Plus className="mr-1 h-4 w-4" />
              Add skill
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
              <h2 className="text-xl font-bold text-gray-900">Knowledge Base (demo)</h2>
              <p className="text-sm text-gray-500">Store references that help your digital twin answer with context.</p>
            </div>
            <button
              type="button"
              onClick={() =>
                setKnowledge((prev) => [...prev, { id: Date.now(), title: 'New knowledge item (Demo)', content: 'Add notes, principles, or reference material.', tokens: 600, type: 'Demo' }])
              }
              className="inline-flex items-center rounded-lg bg-[#030213] px-3 py-2 text-sm font-medium text-white hover:bg-black"
            >
              <Plus className="mr-1 h-4 w-4" />
              Add item
            </button>
          </div>

          <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium text-blue-900">{knowledgeTokens.toLocaleString()} context tokens</p>
                <p className="mt-1 text-sm text-blue-700">Used to ground your digital twin’s answers.</p>
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
          <h2 className="text-xl font-bold text-gray-900">Personality</h2>
          <p className="mt-1 text-sm text-gray-500">Capture tone, working style, and communication preferences.</p>
          <div className="mt-4 space-y-3">
            <textarea rows={3} className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="Communication style, e.g. direct, concise, evidence-driven..." />
            <textarea rows={3} className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="Decision style, e.g. risk-aware, fast iteration..." />
            <textarea rows={3} className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="Collaboration preferences, e.g. how you like feedback..." />
            <button type="button" className="rounded-lg bg-[#030213] px-4 py-2 text-sm font-medium text-white hover:bg-black">SavePersonality</button>
          </div>
        </div>
      ) : null}

      {activeTab === 'values' ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-xl font-bold text-gray-900">Values</h2>
          <p className="mt-1 text-sm text-gray-500">Capture your values, goals, and decision boundaries.</p>
          <div className="mt-4 space-y-3">
            <textarea rows={4} value={bio} onChange={(e) => setBio(e.target.value)} className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="Core values" />
            <textarea rows={4} className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="Life Goals" />
            <textarea rows={4} className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="Work principles" />
            <textarea rows={4} className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="Non-negotiables" />
            <button type="button" className="rounded-lg bg-[#030213] px-4 py-2 text-sm font-medium text-white hover:bg-black">SaveValues</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
