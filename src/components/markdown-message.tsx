import type { ReactNode } from 'react';

type MarkdownMessageProps = {
  content: string;
  inverted?: boolean;
  compact?: boolean;
  renderMediaPreview?: (args: {
    href: string;
    label: string;
    kind: 'image' | 'link' | 'code' | 'bare';
    key: string;
  }) => ReactNode | null;
};

type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'code'; language: string; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | {
      type: 'table';
      headers: string[];
      alignments: Array<'left' | 'center' | 'right'>;
      rows: string[][];
    }
  | { type: 'hr' };

function splitTableRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cell = '';

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character === '\\' && trimmed[index + 1] === '|') {
      cell += '|';
      index += 1;
      continue;
    }
    if (character === '|') {
      cells.push(cell.trim());
      cell = '';
      continue;
    }
    cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

function parseTableDelimiter(line: string) {
  if (!line.includes('|')) return null;
  const cells = splitTableRow(line);
  if (cells.length < 2 || cells.some((cell) => !/^:?-{3,}:?$/.test(cell))) return null;
  return cells.map((cell): 'left' | 'center' | 'right' => {
    if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
    if (cell.endsWith(':')) return 'right';
    return 'left';
  });
}

function isTableStart(lines: string[], index: number) {
  if (index + 1 >= lines.length || !lines[index].includes('|')) return false;
  const headers = splitTableRow(lines[index]);
  const alignments = parseTableDelimiter(lines[index + 1]);
  return headers.length >= 2 && alignments?.length === headers.length;
}

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

    if (isTableStart(lines, index)) {
      const headers = splitTableRow(lines[index]);
      const alignments = parseTableDelimiter(lines[index + 1]) || headers.map(() => 'left' as const);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        const cells = splitTableRow(lines[index]).slice(0, headers.length);
        while (cells.length < headers.length) cells.push('');
        rows.push(cells);
        index += 1;
      }
      blocks.push({ type: 'table', headers, alignments, rows });
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
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isSpecialLine(lines[index]) &&
      !isTableStart(lines, index)
    ) {
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

type InlineRenderOptions = Pick<MarkdownMessageProps, 'renderMediaPreview'>;

function findToken(text: string) {
  const candidates: Array<{ index: number; type: 'code' | 'image' | 'link' | 'strong' | 'em'; marker?: string }> = [];
  const codeIndex = text.indexOf('`');
  const imageIndex = text.indexOf('![');
  const linkIndex = text.indexOf('[');
  const strongAsteriskIndex = text.indexOf('**');
  const strongUnderscoreIndex = text.indexOf('__');
  const emAsteriskIndex = text.indexOf('*');
  const emUnderscoreIndex = text.indexOf('_');

  if (codeIndex >= 0) candidates.push({ index: codeIndex, type: 'code' });
  if (imageIndex >= 0) candidates.push({ index: imageIndex, type: 'image' });
  if (linkIndex >= 0) candidates.push({ index: linkIndex, type: 'link' });
  if (strongAsteriskIndex >= 0) candidates.push({ index: strongAsteriskIndex, type: 'strong', marker: '**' });
  if (strongUnderscoreIndex >= 0) candidates.push({ index: strongUnderscoreIndex, type: 'strong', marker: '__' });
  if (emAsteriskIndex >= 0) candidates.push({ index: emAsteriskIndex, type: 'em', marker: '*' });
  if (emUnderscoreIndex >= 0) candidates.push({ index: emUnderscoreIndex, type: 'em', marker: '_' });

  return candidates.sort((a, b) => a.index - b.index)[0] || null;
}

function renderInlineMediaPreview(
  options: InlineRenderOptions | undefined,
  args: {
    href: string;
    label?: string;
    kind: 'image' | 'link' | 'code' | 'bare';
    key: string;
  }
) {
  return options?.renderMediaPreview?.({
    href: args.href,
    label: args.label || '',
    kind: args.kind,
    key: args.key,
  }) || null;
}

function parseInline(text: string, keyPrefix = 'inline', options?: InlineRenderOptions): ReactNode[] {
  const token = findToken(text);
  if (!token) return splitLineBreaks(text, `${keyPrefix}-text`, options);

  const before = text.slice(0, token.index);
  const afterStart = text.slice(token.index);
  const nodes: ReactNode[] = [...splitLineBreaks(before, `${keyPrefix}-before`, options)];

  if (token.type === 'code') {
    const end = afterStart.indexOf('`', 1);
    if (end > 0) {
      const codeText = afterStart.slice(1, end);
      const mediaPreview = renderInlineMediaPreview(options, {
        href: codeText,
        kind: 'code',
        key: `${keyPrefix}-code-media`,
      });
      if (mediaPreview) {
        nodes.push(mediaPreview);
        nodes.push(...parseInline(afterStart.slice(end + 1), `${keyPrefix}-after-code`, options));
        return nodes;
      }
      nodes.push(
        <code key={`${keyPrefix}-code`} className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.92em]">
          {codeText}
        </code>
      );
      nodes.push(...parseInline(afterStart.slice(end + 1), `${keyPrefix}-after-code`, options));
      return nodes;
    }
  }

  if (token.type === 'image') {
    const labelEnd = afterStart.indexOf(']');
    const hrefStart = labelEnd >= 0 ? afterStart.indexOf('(', labelEnd) : -1;
    const hrefEnd = hrefStart >= 0 ? afterStart.indexOf(')', hrefStart) : -1;
    if (labelEnd > 1 && hrefStart === labelEnd + 1 && hrefEnd > hrefStart) {
      const label = afterStart.slice(2, labelEnd);
      const href = afterStart.slice(hrefStart + 1, hrefEnd);
      const mediaPreview = renderInlineMediaPreview(options, {
        href,
        label,
        kind: 'image',
        key: `${keyPrefix}-image-media`,
      });
      if (mediaPreview) {
        nodes.push(mediaPreview);
        nodes.push(...parseInline(afterStart.slice(hrefEnd + 1), `${keyPrefix}-after-image`, options));
        return nodes;
      }
      nodes.push(label || href);
      nodes.push(...parseInline(afterStart.slice(hrefEnd + 1), `${keyPrefix}-after-image`, options));
      return nodes;
    }
  }

  if (token.type === 'link') {
    const labelEnd = afterStart.indexOf(']');
    const hrefStart = labelEnd >= 0 ? afterStart.indexOf('(', labelEnd) : -1;
    const hrefEnd = hrefStart >= 0 ? afterStart.indexOf(')', hrefStart) : -1;
    if (labelEnd > 0 && hrefStart === labelEnd + 1 && hrefEnd > hrefStart) {
      const label = afterStart.slice(1, labelEnd);
      const rawHref = afterStart.slice(hrefStart + 1, hrefEnd);
      const mediaPreview = renderInlineMediaPreview(options, {
        href: rawHref,
        label,
        kind: 'link',
        key: `${keyPrefix}-link-media`,
      });
      if (mediaPreview) {
        nodes.push(mediaPreview);
        nodes.push(...parseInline(afterStart.slice(hrefEnd + 1), `${keyPrefix}-after-link`, options));
        return nodes;
      }
      const href = normalizeHref(rawHref);
      const external = /^https?:/i.test(href);
      nodes.push(
        <a
          key={`${keyPrefix}-link`}
          href={href}
          target={external ? '_blank' : undefined}
          rel={external ? 'noreferrer' : undefined}
          className="font-medium underline underline-offset-2"
        >
          {parseInline(label, `${keyPrefix}-link-label`, options)}
        </a>
      );
      nodes.push(...parseInline(afterStart.slice(hrefEnd + 1), `${keyPrefix}-after-link`, options));
      return nodes;
    }
  }

  if (token.type === 'strong' && token.marker) {
    const end = afterStart.indexOf(token.marker, token.marker.length);
    if (end > token.marker.length) {
      nodes.push(
        <strong key={`${keyPrefix}-strong`} className="font-semibold">
          {parseInline(afterStart.slice(token.marker.length, end), `${keyPrefix}-strong-text`, options)}
        </strong>
      );
      nodes.push(...parseInline(afterStart.slice(end + token.marker.length), `${keyPrefix}-after-strong`, options));
      return nodes;
    }
  }

  if (token.type === 'em' && token.marker) {
    const end = afterStart.indexOf(token.marker, token.marker.length);
    if (end > token.marker.length) {
      nodes.push(
        <em key={`${keyPrefix}-em`} className="italic">
          {parseInline(afterStart.slice(token.marker.length, end), `${keyPrefix}-em-text`, options)}
        </em>
      );
      nodes.push(...parseInline(afterStart.slice(end + token.marker.length), `${keyPrefix}-after-em`, options));
      return nodes;
    }
  }

  nodes.push(afterStart[0]);
  nodes.push(...parseInline(afterStart.slice(1), `${keyPrefix}-fallback`, options));
  return nodes;
}

function splitBareMediaUrls(text: string, keyPrefix: string, options?: InlineRenderOptions): ReactNode[] {
  if (!text || !options?.renderMediaPreview) return [text];
  const nodes: ReactNode[] = [];
  const mediaUrlPattern = /((?:https?:\/\/|\/(?!\/))[^\s<>()`]+)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(mediaUrlPattern)) {
    const href = match[1] || '';
    const index = match.index ?? 0;
    const mediaPreview = renderInlineMediaPreview(options, {
      href,
      kind: 'bare',
      key: `${keyPrefix}-media-${index}`,
    });
    if (!mediaPreview) continue;
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index));
    nodes.push(mediaPreview);
    lastIndex = index + href.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes.length > 0 ? nodes : [text];
}

function splitLineBreaks(text: string, keyPrefix: string, options?: InlineRenderOptions): ReactNode[] {
  if (!text) return [];
  const parts = text.split('\n');
  return parts.flatMap((part, index) =>
    index === 0
      ? splitBareMediaUrls(part, `${keyPrefix}-line-${index}`, options)
      : [<br key={`${keyPrefix}-br-${index}`} />, ...splitBareMediaUrls(part, `${keyPrefix}-line-${index}`, options)]
  );
}

export function MarkdownMessage({ content, inverted = false, compact = false, renderMediaPreview }: MarkdownMessageProps) {
  const blocks = parseBlocks(content);
  const tone = inverted ? 'text-white' : 'text-current';
  const subtleTone = inverted ? 'border-white/30 text-white/90' : 'border-slate-300 text-slate-700';
  const codeTone = inverted ? 'bg-white/15 text-white' : 'bg-slate-950 text-slate-100';
  const headingClass = compact ? 'text-sm font-semibold leading-6' : 'text-base font-semibold leading-7';
  const inlineOptions = { renderMediaPreview };

  return (
    <div className={`space-y-2 break-words text-sm leading-6 ${tone}`}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <div key={index} className={headingClass}>
              {parseInline(block.text, `heading-${index}`, inlineOptions)}
            </div>
          );
        }

        if (block.type === 'paragraph') {
          return <div key={index}>{parseInline(block.text, `paragraph-${index}`, inlineOptions)}</div>;
        }

        if (block.type === 'quote') {
          return (
            <blockquote key={index} className={`border-l-2 pl-3 ${subtleTone}`}>
              {parseInline(block.text, `quote-${index}`, inlineOptions)}
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
                <li key={itemIndex}>{parseInline(item, `list-${index}-${itemIndex}`, inlineOptions)}</li>
              ))}
            </Tag>
          );
        }

        if (block.type === 'table') {
          return (
            <div key={index} className="max-w-full overflow-x-auto rounded-md border border-current/15">
              <table className="w-full min-w-max border-collapse text-left text-[0.92em]">
                <thead className="bg-current/[0.045]">
                  <tr>
                    {block.headers.map((header, cellIndex) => (
                      <th
                        key={cellIndex}
                        className={`border-b border-current/15 px-3 py-2 font-semibold ${
                          block.alignments[cellIndex] === 'center'
                            ? 'text-center'
                            : block.alignments[cellIndex] === 'right'
                              ? 'text-right'
                              : 'text-left'
                        }`}
                      >
                        {parseInline(header, `table-${index}-header-${cellIndex}`, inlineOptions)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-t border-current/10 first:border-t-0">
                      {row.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          className={`px-3 py-2 align-top ${
                            block.alignments[cellIndex] === 'center'
                              ? 'text-center'
                              : block.alignments[cellIndex] === 'right'
                                ? 'text-right'
                                : 'text-left'
                          }`}
                        >
                          {parseInline(cell, `table-${index}-${rowIndex}-${cellIndex}`, inlineOptions)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        return <hr key={index} className={inverted ? 'border-white/25' : 'border-slate-200'} />;
      })}
    </div>
  );
}
