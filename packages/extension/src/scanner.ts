import { createHash } from 'node:crypto';
export interface MarkedBlock {
  start_line: number;
  end_line: number;
  marker_line: number;
  note: string;
  key: string;
}
interface Comment {
  start: number;
  end: number;
  text: string;
}

// A conservative lexer: directives are recognized only in actual comment tokens.
// Explicit start/end markers remain the escape hatch for language-specific grammar.
export function lex(source: string, language: string) {
  const masked = source.split('');
  const comments: Comment[] = [];
  const hash = [
    'python',
    'shellscript',
    'ruby',
    'yaml',
    'toml',
    'r',
    'perl',
    'powershell',
    'dockerfile',
  ].includes(language);
  const dash = ['sql', 'lua', 'haskell'].includes(language);
  const slash = ![
    'python',
    'shellscript',
    'yaml',
    'toml',
    'sql',
    'html',
    'xml',
    'markdown',
  ].includes(language);
  let i = 0,
    line = 0;
  const blank = (a: number, b: number) => {
    for (let j = a; j < b; j++) if (source[j] !== '\n' && source[j] !== '\r') masked[j] = ' ';
  };
  while (i < source.length) {
    if (source[i] === '\n') {
      line++;
      i++;
      continue;
    }
    let close = '',
      offset = 0,
      single = false;
    if (
      source.startsWith('<!--', i) &&
      ['html', 'xml', 'vue', 'svelte', 'markdown'].includes(language)
    ) {
      close = '-->';
      offset = 4;
    } else if (source.startsWith('/*', i) && (slash || language === 'sql')) {
      close = '*/';
      offset = 2;
    } else if (slash && source.startsWith('//', i)) {
      single = true;
      offset = 2;
    } else if (hash && source[i] === '#') {
      single = true;
      offset = 1;
    } else if (dash && source.startsWith('--', i)) {
      single = true;
      offset = 2;
    }
    if (offset) {
      const start = i,
        startLine = line;
      let end = single ? source.indexOf('\n', i) : source.indexOf(close, i + offset);
      if (end < 0) end = source.length;
      else if (!single) end += close.length;
      const text = source.slice(
        i + offset,
        single ? end : end - (source.endsWith(close, end) ? close.length : 0),
      );
      line += (source.slice(i, end).match(/\n/g) ?? []).length;
      comments.push({ start: startLine, end: line, text });
      blank(start, end);
      i = end;
      continue;
    }
    const quote = source[i];
    if (quote === '"' || quote === "'" || quote === '`') {
      const start = i;
      const triple = language === 'python' && source.startsWith(quote.repeat(3), i);
      const delimiter = triple ? quote.repeat(3) : quote;
      i += delimiter.length;
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source.startsWith(delimiter, i)) {
          i += delimiter.length;
          break;
        }
        i++;
      }
      line += (source.slice(start, i).match(/\n/g) ?? []).length;
      blank(start, i);
      continue;
    }
    i++;
  }
  return { masked: masked.join(''), comments };
}

export function scanDirectives(source: string, language: string): MarkedBlock[] {
  const lines = source.split(/\r?\n/);
  const { masked, comments } = lex(source, language);
  const clean = masked.split(/\r?\n/);
  const directives = comments.flatMap((c) =>
    c.text.split(/\r?\n/).flatMap((part, n) => {
      const match = /^\s*\*?\s*(?:@ding-code|ding-code)(?:-(start|end))?\s*(?::\s*(.*))?\s*$/.exec(
        part,
      );
      return match
        ? [
            {
              kind: match[1] ?? 'auto',
              note: match[2]?.trim() ?? '',
              line: c.start + n,
              after: c.end + 1,
            },
          ]
        : [];
    }),
  );
  const result: MarkedBlock[] = [];
  const counts = new Map<string, number>();
  const add = (d: (typeof directives)[number], start: number, end: number) => {
    while (start <= end && !lines[start]?.trim()) start++;
    while (end >= start && !lines[end]?.trim()) end--;
    if (start > end) return;
    const identity = `${d.kind}:${d.note}`;
    const count = counts.get(identity) ?? 0;
    counts.set(identity, count + 1);
    result.push({
      start_line: start + 1,
      end_line: end + 1,
      marker_line: d.line + 1,
      note: d.note,
      key: createHash('sha256').update(`${identity}:${count}`).digest('hex'),
    });
  };
  for (let index = 0; index < directives.length; index++) {
    const d = directives[index];
    if (d.kind === 'end') continue;
    if (d.kind === 'start') {
      let depth = 1,
        j = index + 1;
      for (; j < directives.length; j++) {
        if (directives[j].kind === 'start') depth++;
        if (directives[j].kind === 'end') depth--;
        if (!depth) break;
      }
      if (!depth) {
        add(d, d.after, directives[j].line - 1);
        index = j;
      }
      continue; // Unclosed ranges are ignored rather than capturing the rest of a file.
    }
    let start = d.after;
    while (start < lines.length && !clean[start].trim() && !lines[start].trim()) start++;
    if (start >= lines.length || !clean[start].trim()) continue;
    if (['html', 'xml', 'vue', 'svelte'].includes(language) && /^\s*</.test(clean[start])) {
      let depth = 0,
        end = start;
      for (let n = start; n < lines.length; n++) {
        for (const tag of clean[n].matchAll(/<(\/?)([\w-]+)\b[^>]*?(\/?)>/g)) {
          if (tag[1]) depth--;
          else if (
            !tag[3] &&
            !/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(
              tag[2],
            )
          )
            depth++;
        }
        end = n;
        if (depth <= 0) break;
      }
      add(d, start, end);
      continue;
    }
    if (language === 'sql') {
      let end = start;
      while (end < lines.length - 1 && !clean[end].includes(';') && clean[end + 1].trim()) end++;
      add(d, start, end);
      continue;
    }
    const baseIndent = lines[start].match(/^\s*/)![0].replace(/\t/g, '    ').length;
    let end = start,
      balance = 0,
      seenOpen = false;
    for (let n = start; n < lines.length; n++) {
      const text = clean[n];
      if (n > start && balance === 0) {
        const indent = lines[n].match(/^\s*/)![0].replace(/\t/g, '    ').length;
        if (
          text.trim() &&
          indent <= baseIndent &&
          !/^\s*(else\b|elif\b|except\b|finally\b|catch\b|\{)/.test(text)
        )
          break;
        if (!text.trim() && !lines[n].trim()) {
          let next = n + 1;
          while (next < lines.length && !clean[next].trim()) next++;
          if (next >= lines.length || lines[next].search(/\S/) <= baseIndent) break;
        }
      }
      for (const char of text) {
        if ('([{'.includes(char)) {
          balance++;
          seenOpen = true;
        } else if (')]}'.includes(char)) balance = Math.max(0, balance - 1);
      }
      end = n;
      if (balance === 0 && seenOpen && !text.trimEnd().endsWith(':')) {
        const next = clean[n + 1] ?? '';
        if (
          !/^\s*(else\b|elif\b|except\b|finally\b|catch\b|\{)/.test(next) &&
          (language !== 'python' || !clean[start].trimEnd().endsWith(':'))
        )
          break;
      }
      if (
        n === start &&
        balance === 0 &&
        !text.trimEnd().endsWith(':') &&
        !/^\s*\{/.test(clean[n + 1] ?? '') &&
        (clean[n + 1]?.search(/\S/) ?? -1) <= baseIndent
      )
        break;
    }
    add(d, start, end);
  }
  return result;
}
