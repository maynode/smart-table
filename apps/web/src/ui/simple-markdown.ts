/** Minimal Markdown → safe HTML (headings, lists, tables, bold, code, paragraphs). */
export function renderSimpleMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let i = 0;
  let inUl = false;
  let inOl = false;
  let inTable = false;

  const closeLists = () => {
    if (inUl) {
      html.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      html.push('</ol>');
      inOl = false;
    }
  };
  const closeTable = () => {
    if (inTable) {
      html.push('</tbody></table>');
      inTable = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*\|/.test(line) && line.includes('|')) {
      closeLists();
      const cells = splitTableRow(line);
      const next = lines[i + 1] ?? '';
      const isSep = /^\s*\|?[\s-:|]+$/.test(next) && next.includes('-');
      if (!inTable) {
        html.push('<table class="md-table"><thead><tr>');
        for (const c of cells) html.push(`<th>${inline(c)}</th>`);
        html.push('</tr></thead><tbody>');
        inTable = true;
        i += isSep ? 2 : 1;
        continue;
      }
      if (isSep) {
        i += 2;
        continue;
      }
      html.push('<tr>');
      for (const c of cells) html.push(`<td>${inline(c)}</td>`);
      html.push('</tr>');
      i += 1;
      continue;
    }

    closeTable();

    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) {
      closeLists();
      const level = h[1].length;
      html.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      closeLists();
      html.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`);
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      if (inOl) {
        html.push('</ol>');
        inOl = false;
      }
      if (!inUl) {
        html.push('<ul>');
        inUl = true;
      }
      html.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`);
      i += 1;
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      if (inUl) {
        html.push('</ul>');
        inUl = false;
      }
      if (!inOl) {
        html.push('<ol>');
        inOl = true;
      }
      html.push(`<li>${inline(line.replace(/^\d+\.\s+/, ''))}</li>`);
      i += 1;
      continue;
    }

    if (line.trim() === '') {
      closeLists();
      i += 1;
      continue;
    }

    closeLists();
    html.push(`<p>${inline(line)}</p>`);
    i += 1;
  }

  closeLists();
  closeTable();
  return html.join('\n');
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  // 仅允许 http(s) 链接，避免 javascript: XSS
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  return s;
}
