import type { ReactNode } from 'react';

type MarkdownMessageProps = {
  content: string;
  inverted?: boolean;
  compact?: boolean;
};

type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'code'; language: string; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'hr' };

function isSpecialLine(line: string) {
  const trimmed = line.trim();
  return (
    /^```/.test(trimmed) ||
    /^#{1,6}\s+/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    /^[-*+]\s+/.test(trimmed) ||
    /^\d+[.)]\s+/.test(trimmed) ||
    /^([-*_]\s*){3,}$/.test(trimmed)
  );
}

function parseBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const fence = trimmed.match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', language: fence[1] || '', text: codeLines.join('\n') });
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }

    if (/^([-*_]\s*){3,}$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', text: quoteLines.join('\n') });
      continue;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const orderedList = Boolean(ordered);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        const match = orderedList ? current.match(/^\d+[.)]\s+(.+)$/) : current.match(/^[-*+]\s+(.+)$/);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ type: 'list', ordered: orderedList, items });
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isSpecialLine(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraphLines.join('\n') });
  }

  return blocks;
}

function normalizeHref(href: string) {
  const trimmed = href.trim();
  if (/^(https?:|mailto:|\/|#)/i.test(trimmed)) return trimmed;
  return '#';
}

function findToken(text: string) {
  const candidates: Array<{ index: number; type: 'code' | 'link' | 'strong' | 'em'; marker?: string }> = [];
  const codeIndex = text.indexOf('`');
  const linkIndex = text.indexOf('[');
  const strongAsteriskIndex = text.indexOf('**');
  const strongUnderscoreIndex = text.indexOf('__');
  const emAsteriskIndex = text.indexOf('*');
  const emUnderscoreIndex = text.indexOf('_');

  if (codeIndex >= 0) candidates.push({ index: codeIndex, type: 'code' });
  if (linkIndex >= 0) candidates.push({ index: linkIndex, type: 'link' });
  if (strongAsteriskIndex >= 0) candidates.push({ index: strongAsteriskIndex, type: 'strong', marker: '**' });
  if (strongUnderscoreIndex >= 0) candidates.push({ index: strongUnderscoreIndex, type: 'strong', marker: '__' });
  if (emAsteriskIndex >= 0) candidates.push({ index: emAsteriskIndex, type: 'em', marker: '*' });
  if (emUnderscoreIndex >= 0) candidates.push({ index: emUnderscoreIndex, type: 'em', marker: '_' });

  return candidates.sort((a, b) => a.index - b.index)[0] || null;
}

function parseInline(text: string, keyPrefix = 'inline'): ReactNode[] {
  const token = findToken(text);
  if (!token) return splitLineBreaks(text, `${keyPrefix}-text`);

  const before = text.slice(0, token.index);
  const afterStart = text.slice(token.index);
  const nodes: ReactNode[] = [...splitLineBreaks(before, `${keyPrefix}-before`)];

  if (token.type === 'code') {
    const end = afterStart.indexOf('`', 1);
    if (end > 0) {
      nodes.push(
        <code key={`${keyPrefix}-code`} className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.92em]">
          {afterStart.slice(1, end)}
        </code>
      );
      nodes.push(...parseInline(afterStart.slice(end + 1), `${keyPrefix}-after-code`));
      return nodes;
    }
  }

  if (token.type === 'link') {
    const labelEnd = afterStart.indexOf(']');
    const hrefStart = labelEnd >= 0 ? afterStart.indexOf('(', labelEnd) : -1;
    const hrefEnd = hrefStart >= 0 ? afterStart.indexOf(')', hrefStart) : -1;
    if (labelEnd > 0 && hrefStart === labelEnd + 1 && hrefEnd > hrefStart) {
      const href = normalizeHref(afterStart.slice(hrefStart + 1, hrefEnd));
      const external = /^https?:/i.test(href);
      nodes.push(
        <a
          key={`${keyPrefix}-link`}
          href={href}
          target={external ? '_blank' : undefined}
          rel={external ? 'noreferrer' : undefined}
          className="font-medium underline underline-offset-2"
        >
          {parseInline(afterStart.slice(1, labelEnd), `${keyPrefix}-link-label`)}
        </a>
      );
      nodes.push(...parseInline(afterStart.slice(hrefEnd + 1), `${keyPrefix}-after-link`));
      return nodes;
    }
  }

  if (token.type === 'strong' && token.marker) {
    const end = afterStart.indexOf(token.marker, token.marker.length);
    if (end > token.marker.length) {
      nodes.push(
        <strong key={`${keyPrefix}-strong`} className="font-semibold">
          {parseInline(afterStart.slice(token.marker.length, end), `${keyPrefix}-strong-text`)}
        </strong>
      );
      nodes.push(...parseInline(afterStart.slice(end + token.marker.length), `${keyPrefix}-after-strong`));
      return nodes;
    }
  }

  if (token.type === 'em' && token.marker) {
    const end = afterStart.indexOf(token.marker, token.marker.length);
    if (end > token.marker.length) {
      nodes.push(
        <em key={`${keyPrefix}-em`} className="italic">
          {parseInline(afterStart.slice(token.marker.length, end), `${keyPrefix}-em-text`)}
        </em>
      );
      nodes.push(...parseInline(afterStart.slice(end + token.marker.length), `${keyPrefix}-after-em`));
      return nodes;
    }
  }

  nodes.push(afterStart[0]);
  nodes.push(...parseInline(afterStart.slice(1), `${keyPrefix}-fallback`));
  return nodes;
}

function splitLineBreaks(text: string, keyPrefix: string): ReactNode[] {
  if (!text) return [];
  const parts = text.split('\n');
  return parts.flatMap((part, index) =>
    index === 0 ? [part] : [<br key={`${keyPrefix}-br-${index}`} />, part]
  );
}

export function MarkdownMessage({ content, inverted = false, compact = false }: MarkdownMessageProps) {
  const blocks = parseBlocks(content);
  const tone = inverted ? 'text-white' : 'text-current';
  const subtleTone = inverted ? 'border-white/30 text-white/90' : 'border-slate-300 text-slate-700';
  const codeTone = inverted ? 'bg-white/15 text-white' : 'bg-slate-950 text-slate-100';
  const headingClass = compact ? 'text-sm font-semibold leading-6' : 'text-base font-semibold leading-7';

  return (
    <div className={`space-y-2 break-words text-sm leading-6 ${tone}`}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <div key={index} className={headingClass}>
              {parseInline(block.text, `heading-${index}`)}
            </div>
          );
        }

        if (block.type === 'paragraph') {
          return <p key={index}>{parseInline(block.text, `paragraph-${index}`)}</p>;
        }

        if (block.type === 'quote') {
          return (
            <blockquote key={index} className={`border-l-2 pl-3 ${subtleTone}`}>
              {parseInline(block.text, `quote-${index}`)}
            </blockquote>
          );
        }

        if (block.type === 'code') {
          return (
            <pre key={index} className={`overflow-x-auto rounded-lg p-3 font-mono text-xs leading-5 ${codeTone}`}>
              <code>{block.text}</code>
            </pre>
          );
        }

        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul';
          return (
            <Tag key={index} className={`${block.ordered ? 'list-decimal' : 'list-disc'} space-y-1 pl-5`}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{parseInline(item, `list-${index}-${itemIndex}`)}</li>
              ))}
            </Tag>
          );
        }

        return <hr key={index} className={inverted ? 'border-white/25' : 'border-slate-200'} />;
      })}
    </div>
  );
}
