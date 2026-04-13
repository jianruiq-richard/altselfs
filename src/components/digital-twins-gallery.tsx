'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { BookOpen, Briefcase, Code, MessageCircle, Palette, Search, Star, TrendingUp } from 'lucide-react';

export type DigitalTwinCategory = 'all' | 'tech' | 'business' | 'design' | 'knowledge';

export type DigitalTwinCard = {
  id: string;
  name: string;
  avatarEmoji?: string | null;
  avatarUrl?: string | null;
  title: string;
  bio: string;
  tags: string[];
  skills: string[];
  conversations: number;
  rating: number;
  category: Exclude<DigitalTwinCategory, 'all'>;
  isPublic: boolean;
  detailHref?: string | null;
  chatHref?: string | null;
};

const categories: Array<{ id: DigitalTwinCategory; name: string; Icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'all', name: '全部', Icon: Star },
  { id: 'tech', name: '技术', Icon: Code },
  { id: 'business', name: '商业', Icon: Briefcase },
  { id: 'design', name: '设计', Icon: Palette },
  { id: 'knowledge', name: '知识', Icon: BookOpen },
];

type SortBy = 'popular' | 'rating' | 'recent';

export default function DigitalTwinsGallery({ cards }: { cards: DigitalTwinCard[] }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<DigitalTwinCategory>('all');
  const [sortBy, setSortBy] = useState<SortBy>('popular');

  const filteredTwins = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return cards
      .filter((twin) => {
        const matchesSearch =
          query.length === 0 ||
          twin.name.toLowerCase().includes(query) ||
          twin.title.toLowerCase().includes(query) ||
          twin.bio.toLowerCase().includes(query) ||
          twin.tags.some((tag) => tag.toLowerCase().includes(query)) ||
          twin.skills.some((skill) => skill.toLowerCase().includes(query));
        const matchesCategory = selectedCategory === 'all' || twin.category === selectedCategory;
        return twin.isPublic && matchesSearch && matchesCategory;
      })
      .sort((a, b) => {
        if (sortBy === 'popular') return b.conversations - a.conversations;
        if (sortBy === 'rating') return b.rating - a.rating;
        return 0;
      });
  }, [cards, searchQuery, selectedCategory, sortBy]);

  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">数字分身大厅</h1>
        <p className="mt-2 text-gray-500">探索其他用户的数字分身，与他们的知识和经验对话</p>
      </div>

      <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6">
        <div className="mb-6 flex flex-col gap-4 md:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索数字分身、技能、领域..."
              className="w-full rounded-xl border border-gray-300 py-2.5 pl-10 pr-3 text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSortBy('popular')}
              className={`inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium ${
                sortBy === 'popular' ? 'bg-[#030213] text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <TrendingUp className="mr-2 h-4 w-4" />
              最热门
            </button>
            <button
              type="button"
              onClick={() => setSortBy('rating')}
              className={`inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium ${
                sortBy === 'rating' ? 'bg-[#030213] text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Star className="mr-2 h-4 w-4" />
              最高分
            </button>
          </div>
        </div>

        <div className="inline-flex h-9 flex-wrap items-center rounded-xl bg-[#ececf0] p-[3px] text-[#717182]">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              className={`inline-flex h-[calc(100%-1px)] items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-2 py-1 text-sm font-medium transition-[color,box-shadow] ${
                selectedCategory === cat.id
                  ? 'border-transparent bg-white text-[#030213]'
                  : 'border-transparent text-[#717182] hover:text-[#030213]'
              }`}
            >
              <cat.Icon className="mr-1.5 h-4 w-4" />
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {filteredTwins.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center">
          <p className="text-gray-500">没有找到匹配的数字分身</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredTwins.map((twin) => (
            <div key={twin.id} className="rounded-xl border bg-white p-6 transition-shadow hover:shadow-lg">
              <div className="mb-4 flex items-start gap-4">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-3xl text-white">
                  {twin.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={twin.avatarUrl} alt={twin.name} className="h-full w-full object-cover" />
                  ) : (
                    twin.avatarEmoji || twin.name.slice(0, 1)
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="mb-1 truncate font-bold text-gray-900">{twin.name}</h3>
                  <p className="mb-2 text-sm text-gray-600">{twin.title}</p>
                  <div className="flex items-center gap-2 text-sm">
                    <div className="flex items-center">
                      <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />
                      <span className="ml-1 font-medium text-gray-800">{twin.rating.toFixed(1)}</span>
                    </div>
                    <span className="text-gray-400">·</span>
                    <span className="text-gray-500">{twin.conversations} 次对话</span>
                  </div>
                </div>
              </div>

              <p className="mb-4 line-clamp-2 text-sm text-gray-600">{twin.bio}</p>

              <div className="mb-4 flex flex-wrap gap-2">
                {twin.tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="rounded-md border border-transparent bg-[#ececf0] px-2 py-0.5 text-xs text-[#030213]">
                    {tag}
                  </span>
                ))}
              </div>

              <div className="mb-4">
                <p className="mb-2 text-xs text-gray-500">擅长领域</p>
                <div className="flex flex-wrap gap-1">
                  {twin.skills.slice(0, 3).map((skill) => (
                    <span key={skill} className="rounded-md border px-2 py-0.5 text-xs text-[#030213]">
                      {skill}
                    </span>
                  ))}
                  {twin.skills.length > 3 ? (
                    <span className="rounded-md border px-2 py-0.5 text-xs text-[#030213]">
                      +{twin.skills.length - 3}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex gap-2">
                {twin.detailHref ? (
                  <Link href={twin.detailHref} className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-center text-sm text-gray-700 hover:bg-gray-50">
                    查看详情
                  </Link>
                ) : (
                  <button type="button" className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700">
                    查看详情
                  </button>
                )}

                {twin.chatHref ? (
                  <Link href={twin.chatHref} className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-blue-700">
                    <span className="inline-flex items-center justify-center">
                      <MessageCircle className="mr-1.5 h-4 w-4" />
                      开始对话
                    </span>
                  </Link>
                ) : (
                  <button type="button" className="flex-1 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white">
                    开始对话
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
