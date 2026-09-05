import {
  ChevronRight,
  Database,
  MessagesSquare,
  PanelLeftClose,
  Plug,
  Settings,
  SquarePen,
} from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MinacoBrandMark } from '@/components/minaco-brand-mark';
import { ProductIntelligencePage } from '@/components/product-intelligence-page';
import { productBrand } from '@/lib/brand';

const previewDiscussions = [
  'Lovable growth signals',
  'AI video market map',
  'Weekly product launches',
];

export default function ProductIntelligencePreviewRoute() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="grid h-dvh min-h-0 min-w-0 grid-cols-1 overflow-hidden bg-[#090a0a] text-[#fffaf0] md:grid-cols-[244px_minmax(0,1fr)]">
      <aside className="hidden min-h-0 border-r border-[#fffaf0]/10 bg-[#0c0d0e] md:flex md:flex-col">
        <div className="flex h-16 shrink-0 items-center justify-between px-4">
          <Link href="/product-intelligence-preview" className="inline-flex items-center gap-2 font-semibold leading-none text-[#fffaf0]">
            <MinacoBrandMark className="block h-9 w-9 shrink-0 overflow-hidden rounded-[9px]" imageClassName="h-full w-full object-contain" />
            <span className="text-[15px]">{productBrand.name}</span>
          </Link>
          <PanelLeftClose className="h-4 w-4 text-[#fffaf0]/24" />
        </div>

        <button type="button" className="mx-3 mb-3 inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-[7px] border border-[#f2c36b]/70 bg-[#f2c36b] px-4 text-[13px] font-bold text-[#100e0c]">
          <SquarePen className="h-4 w-4" />
          New discussion
        </button>

        <nav className="grid shrink-0 gap-0.5 border-b border-[#fffaf0]/10 px-2.5 pb-3" aria-label="Workspace preview navigation">
          <Link href="/product-intelligence-preview" aria-current="page" className="flex min-h-[38px] items-center gap-2.5 rounded-[7px] bg-[#fffaf0]/[0.085] px-3 text-[13px] text-[#fffaf0]">
            <Database className="h-4 w-4 shrink-0 text-[#f2c36b]" />
            <span>Product Intelligence</span>
          </Link>
          <span className="flex min-h-[38px] items-center gap-2.5 rounded-[7px] px-3 text-[13px] text-[#fffaf0]/45">
            <MessagesSquare className="h-4 w-4 shrink-0" />
            <span>Discussion</span>
          </span>
          <span className="flex min-h-[38px] items-center gap-2.5 rounded-[7px] px-3 text-[13px] text-[#fffaf0]/45">
            <Plug className="h-4 w-4 shrink-0" />
            <span>Connectors</span>
          </span>
          <span className="flex min-h-[38px] items-center gap-2.5 rounded-[7px] px-3 text-[13px] text-[#fffaf0]/45">
            <Settings className="h-4 w-4 shrink-0" />
            <span>Settings</span>
          </span>
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <div className="mb-2 flex items-center justify-between px-1.5">
            <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#fffaf0]/28">Recent discussions</span>
            <span className="text-[9px] tabular-nums text-[#fffaf0]/24">3</span>
          </div>
          <div className="grid gap-1">
            {previewDiscussions.map((discussion) => (
              <span key={discussion} className="truncate rounded-[7px] px-2 py-2 text-[11px] text-[#fffaf0]/38">{discussion}</span>
            ))}
          </div>
        </div>

        <div className="shrink-0 border-t border-[#fffaf0]/10 p-3">
          <div className="grid min-h-[58px] grid-cols-[38px_minmax(0,1fr)_18px] items-center gap-2.5 rounded-[7px] border border-[#fffaf0]/10 bg-[#fffaf0]/[0.025] p-2">
            <span className="grid h-[38px] w-[38px] place-items-center rounded-[7px] bg-[#f8dfaa] text-[11px] font-extrabold text-[#16130d]">JR</span>
            <span className="grid min-w-0">
              <strong className="truncate text-xs text-[#fffaf0]">Preview account</strong>
              <span className="truncate text-[10px] text-[#fffaf0]/30">Product workspace</span>
            </span>
            <ChevronRight className="h-3.5 w-3.5 text-[#fffaf0]/24" />
          </div>
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#090a0a]">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[#fffaf0]/10 px-4 md:hidden">
          <MinacoBrandMark className="block h-8 w-8 shrink-0 overflow-hidden rounded-[8px]" imageClassName="h-full w-full object-contain" />
          <strong className="min-w-0 flex-1 truncate text-sm text-[#fffaf0]">Product Intelligence</strong>
          <span className="rounded-full border border-[#f2c36b]/20 bg-[#f2c36b]/[0.07] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[#f2c36b]">Preview</span>
        </header>
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <ProductIntelligencePage />
        </div>
      </section>
    </div>
  );
}
