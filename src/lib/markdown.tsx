import type { ReactNode } from 'react';

/**
 * 极简 Markdown 渲染器（Gitea/Typora 常用子集）。
 *
 * 渲染成 React 节点而不是 innerHTML，天然免疫脚本注入；
 * 需要覆盖的语法：标题、段落、无序/有序列表、引用、分割线、围栏代码、
 * 表格、行内代码、粗体、斜体、删除线、链接、自动链接。
 */

let keySeed = 0;
const nextKey = (): string => `md_${(keySeed += 1)}`;

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;

  const patterns: Array<{ re: RegExp; build: (m: RegExpExecArray) => ReactNode }> = [
    { re: /^`([^`]+)`/, build: (m) => <code key={nextKey()}>{m[1]}</code> },
    {
      re: /^\*\*([^*]+)\*\*/,
      build: (m) => <strong key={nextKey()}>{renderInline(m[1])}</strong>,
    },
    { re: /^__([^_]+)__/, build: (m) => <strong key={nextKey()}>{renderInline(m[1])}</strong> },
    { re: /^\*([^*]+)\*/, build: (m) => <em key={nextKey()}>{renderInline(m[1])}</em> },
    { re: /^_([^_]+)_/, build: (m) => <em key={nextKey()}>{renderInline(m[1])}</em> },
    { re: /^~~([^~]+)~~/, build: (m) => <del key={nextKey()}>{renderInline(m[1])}</del> },
    {
      re: /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/,
      build: (m) => (
        <a key={nextKey()} href={m[2]} target="_blank" rel="noreferrer noopener">
          {m[1]}
        </a>
      ),
    },
    {
      re: /^(https?:\/\/[^\s<]+)/,
      build: (m) => (
        <a key={nextKey()} href={m[1]} target="_blank" rel="noreferrer noopener">
          {m[1]}
        </a>
      ),
    },
    { re: /^&lt;([^&]+)&gt;/, build: (m) => <span key={nextKey()}>{m[1]}</span> },
    { re: /^\n/, build: () => <br key={nextKey()} /> },
  ];

  while (rest.length > 0) {
    let matched = false;
    for (const pattern of patterns) {
      const m = pattern.re.exec(rest);
      if (m) {
        nodes.push(pattern.build(m));
        rest = rest.slice(m[0].length);
        matched = true;
        break;
      }
    }
    if (matched) continue;

    /* 普通字符：吃到下一个可能的标记前面 */
    const stop = rest.slice(1).search(/[`*_~[\]\n]|https?:\/\//);
    const take = stop < 0 ? rest.length : stop + 1;
    nodes.push(rest.slice(0, take));
    rest = rest.slice(take);
  }

  return nodes;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function renderMarkdown(source: string): ReactNode[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;

  const flushParagraph = (buffer: string[]): void => {
    if (buffer.length === 0) return;
    blocks.push(<p key={nextKey()}>{renderInline(escapeHtml(buffer.join('\n')))}</p>);
    buffer.length = 0;
  };

  const paragraph: string[] = [];

  while (index < lines.length) {
    const line = lines[index];

    /* 围栏代码 */
    const fence = /^\s*```(.*)$/.exec(line);
    if (fence) {
      flushParagraph(paragraph);
      const lang = fence[1].trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(
        <pre key={nextKey()} data-lang={lang || undefined}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    /* 标题 */
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph(paragraph);
      const level = heading[1].length;
      const content = renderInline(escapeHtml(heading[2]));
      const Tag = (`h${Math.min(level + 1, 6)}`) as 'h2';
      blocks.push(<Tag key={nextKey()}>{content}</Tag>);
      index += 1;
      continue;
    }

    /* 分割线 */
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushParagraph(paragraph);
      blocks.push(<hr key={nextKey()} />);
      index += 1;
      continue;
    }

    /* 引用 */
    if (/^\s*>/.test(line)) {
      flushParagraph(paragraph);
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push(
        <blockquote key={nextKey()}>{renderInline(escapeHtml(quote.join('\n')))}</blockquote>,
      );
      continue;
    }

    /* 表格：| a | b | + |---| */
    if (/^\s*\|/.test(line) && /^\s*\|?[\s:-]+\|/.test(lines[index + 1] ?? '')) {
      flushParagraph(paragraph);
      const rows: string[][] = [];
      const readCells = (row: string): string[] =>
        row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim());
      const head = readCells(line);
      index += 2;
      while (index < lines.length && /^\s*\|/.test(lines[index])) {
        rows.push(readCells(lines[index]));
        index += 1;
      }
      blocks.push(
        <table key={nextKey()}>
          <thead>
            <tr>
              {head.map((cell) => (
                <th key={nextKey()}>{renderInline(escapeHtml(cell))}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={nextKey()}>
                {row.map((cell) => (
                  <td key={nextKey()}>{renderInline(escapeHtml(cell))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }

    /* 列表 */
    const list = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (list) {
      flushParagraph(paragraph);
      const ordered = /\d+\./.test(list[2]);
      const items: string[] = [];
      const isItem = (value: string): boolean =>
        ordered ? /^\s*\d+\.\s+/.test(value) : /^\s*[-*+]\s+/.test(value);
      while (index < lines.length && isItem(lines[index])) {
        items.push(lines[index].replace(/^\s*(?:[-*+]|\d+\.)\s+/, ''));
        index += 1;
      }
      const children = items.map((item) => (
        <li key={nextKey()}>{renderInline(escapeHtml(item))}</li>
      ));
      blocks.push(ordered ? <ol key={nextKey()}>{children}</ol> : <ul key={nextKey()}>{children}</ul>);
      continue;
    }

    /* 空行：结束段落 */
    if (line.trim() === '') {
      flushParagraph(paragraph);
      index += 1;
      continue;
    }

    paragraph.push(line);
    index += 1;
  }

  flushParagraph(paragraph);
  return blocks;
}
