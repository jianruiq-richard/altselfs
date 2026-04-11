'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  BookOpen,
  Brain,
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
} from 'lucide-react';

type AvatarItem = {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  chatsCount: number;
};

type Props = {
  avatarCount: number;
  totalChats: number;
  totalTokens: number;
  totalCompletion: number;
  avatars: AvatarItem[];
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
  avatarCount,
  totalChats,
  totalTokens,
  totalCompletion,
  avatars,
}: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'overview' | 'skills' | 'knowledge' | 'personality' | 'values'>('overview');
  const [isPublic, setIsPublic] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [skills, setSkills] = useState(initialSkills);
  const [knowledge, setKnowledge] = useState(initialKnowledge);
  const [bio, setBio] = useState('专注于 AI 与软件方向的投资人，关注长期价值与执行力。');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    systemPrompt: '',
  });

  const knowledgeTokens = useMemo(() => knowledge.reduce((sum, item) => sum + item.tokens, 0), [knowledge]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleCreateAvatar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.systemPrompt.trim() || isLoading) return;

    setIsLoading(true);
    try {
      const res = await fetch('/api/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        console.error('Failed to create avatar');
        return;
      }

      router.refresh();
      setFormData({ name: '', description: '', systemPrompt: '' });
      setActiveTab('overview');
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">我的数字分身</h1>
          <p className="mt-2 text-gray-500">不断充实你的数字分身，让它越来越懂你</p>
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setIsPublic((v) => !v)}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            {isPublic ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            {isPublic ? '公开展示' : '仅自己可见'}
          </button>
          <Link href="/digital-twins" className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            <MessageCircle className="mr-2 h-4 w-4" />
            与我的分身对话
          </Link>
        </div>
      </div>

      <div className="mb-8 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-purple-50 p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h3 className="mb-1 text-xl font-bold text-gray-900">完整度: {totalCompletion}%</h3>
            <p className="text-sm text-gray-600">继续完善，让你的数字分身更加丰满</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-blue-600">{(totalTokens + knowledgeTokens).toLocaleString()}</div>
            <p className="text-sm text-gray-600">上下文 tokens</p>
          </div>
        </div>
        <div className="mb-4 h-3 overflow-hidden rounded-full bg-white/80">
          <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-600" style={{ width: `${totalCompletion}%` }} />
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

      <div className="mb-6 flex flex-wrap gap-2">
        {[
          ['overview', '概览'],
          ['skills', '技能专长'],
          ['knowledge', '知识库'],
          ['personality', '性格特质'],
          ['values', '价值观'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key as typeof activeTab)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              activeTab === key ? 'bg-gray-900 text-white' : 'border border-gray-300 text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? (
        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="text-xl font-bold text-gray-900">基础信息与分身创建</h2>
            <p className="mt-1 text-sm text-gray-500">这些信息会影响你的数字分身表现与表达风格</p>

            <form onSubmit={handleCreateAvatar} className="mt-5 space-y-4">
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium text-gray-700">分身名称</label>
                <input
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  placeholder="例如：王先生的投资分身"
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="description" className="text-sm font-medium text-gray-700">个人简介</label>
                <textarea
                  id="description"
                  name="description"
                  rows={3}
                  value={formData.description}
                  onChange={handleChange}
                  placeholder="简单介绍这个分身的背景和投资偏好..."
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="systemPrompt" className="text-sm font-medium text-gray-700">系统提示词</label>
                <textarea
                  id="systemPrompt"
                  name="systemPrompt"
                  rows={8}
                  value={formData.systemPrompt}
                  onChange={handleChange}
                  required
                  placeholder="请详细描述你的投资标准、沟通方式、关注领域..."
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {isLoading ? '创建中...' : '保存并创建分身'}
              </button>
            </form>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6">
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

          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-gray-900">我的分身列表</h3>
            <p className="mt-1 text-sm text-gray-500">已创建 {avatarCount} 个分身 · 总会话 {totalChats}</p>
            <div className="mt-4 space-y-3">
              {avatars.length > 0 ? (
                avatars.map((avatar) => (
                  <div key={avatar.id} className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
                    <div>
                      <p className="font-medium text-gray-900">{avatar.name}</p>
                      <p className="text-sm text-gray-500">会话数 {avatar.chatsCount}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-2 py-0.5 text-xs ${avatar.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-700'}`}>
                        {avatar.status === 'ACTIVE' ? '启用中' : '已停用'}
                      </span>
                      <Link href={`/investor/avatar/${avatar.id}`} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                        管理
                      </Link>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">
                  你还没有创建分身，先在上面填写信息创建第一个分身。
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === 'skills' ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">技能专长</h2>
              <p className="text-sm text-gray-500">记录你的技能和专长，AI会学习你的专业知识</p>
            </div>
            <button
              type="button"
              onClick={() =>
                setSkills((prev) => [...prev, { id: Date.now(), name: '新技能（演示）', level: '初级', category: '演示', description: '可后续接入真实编辑能力。' }])
              }
              className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus className="mr-1 h-4 w-4" />
              添加技能
            </button>
          </div>
          <div className="space-y-3">
            {skills.map((skill) => (
              <div key={skill.id} className="rounded-lg border border-gray-200 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="mb-1 flex items-center gap-2">
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
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">知识库（无限上下文）</h2>
              <p className="text-sm text-gray-500">像 Figma demo 一样先展示概念，后续再逐项接通</p>
            </div>
            <button
              type="button"
              onClick={() =>
                setKnowledge((prev) => [...prev, { id: Date.now(), title: '新知识（演示）', content: '可后续接入真实内容编辑。', tokens: 600, type: '演示' }])
              }
              className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus className="mr-1 h-4 w-4" />
              添加知识
            </button>
          </div>

          <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-blue-900">总计 {knowledgeTokens.toLocaleString()} tokens</p>
                <p className="mt-1 text-sm text-blue-700">持续积累知识，分身表达会更接近你</p>
              </div>
              <TrendingUp className="h-8 w-8 text-blue-600" />
            </div>
          </div>

          <div className="space-y-3">
            {knowledge.map((item) => (
              <div key={item.id} className="rounded-lg border border-gray-200 p-4">
                <div className="mb-1 flex items-center justify-between">
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
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <h2 className="text-xl font-bold text-gray-900">性格特质</h2>
          <p className="mt-1 text-sm text-gray-500">描述你的性格特点，让数字分身更像你</p>
          <div className="mt-4 space-y-3">
            <textarea rows={3} className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="沟通风格，例如：友好、直接、幽默..." />
            <textarea rows={3} className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="思考方式，例如：理性分析、注重细节..." />
            <textarea rows={3} className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="决策偏好，例如：数据驱动、长期主义..." />
            <button type="button" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">保存性格特质</button>
          </div>
        </div>
      ) : null}

      {activeTab === 'values' ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <h2 className="text-xl font-bold text-gray-900">价值观与人生理念</h2>
          <p className="mt-1 text-sm text-gray-500">分享你的价值观、人生目标和理念</p>
          <div className="mt-4 space-y-3">
            <textarea rows={4} value={bio} onChange={(e) => setBio(e.target.value)} className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="核心价值观" />
            <textarea rows={4} className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="人生目标" />
            <textarea rows={4} className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="工作理念" />
            <textarea rows={4} className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm" placeholder="生活态度" />
            <button type="button" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">保存价值观</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
