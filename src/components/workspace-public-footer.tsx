import Link from 'next/link';

const links = [
  ['Introduction', '/introduction'],
  ['Blog', '/blog'],
  ['Pricing', '/pricing'],
  ['Use cases', '/introduction#demo'],
  ['How it thinks', '/introduction#demo'],
  ['Terms of Service', '/terms'],
  ['Privacy Policy', '/privacy'],
  ['Contact', '/contact'],
] as const;

export function WorkspacePublicFooter() {
  return <footer className="shrink-0 border-t border-white/[0.07] px-4 py-3">
    <nav aria-label="Company and product" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[10px] text-zinc-500">
      {links.map(([label, href]) => <Link key={label} href={href} className="hover:text-zinc-200">{label}</Link>)}
    </nav>
  </footer>;
}
