/**
 * Normalize scraped / stored supplier descriptions.
 * Fixes leftover HTML entities (nbsp;), broken Hebrew abbreviations (מ ר → מ״ר),
 * junk symbols, and messy whitespace.
 */
export function cleanDescription(raw) {
  if (raw === null || raw === undefined) return '';
  let text = String(raw);
  if (!text.trim()) return '';

  // Decode HTML entities repeatedly (&amp;nbsp; → &nbsp; → space)
  for (let i = 0; i < 5; i++) {
    const prev = text;
    text = text
      .replace(/&nbsp;/gi, ' ')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#(\d+);/g, (_, n) => {
        const code = Number(n);
        return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
      })
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
        const code = parseInt(h, 16);
        return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
      });
    if (text === prev) break;
  }

  // Strip HTML tags
  text = text.replace(/<\/?[^>]+>/g, ' ');

  // Leftover broken entity names from buggy scrapers (nbsp; after &amp; was stripped)
  text = text
    .replace(/\bnbsp;/gi, ' ')
    .replace(/\bnbsp\b/gi, ' ')
    .replace(/\bamp;/gi, '&')
    .replace(/\bamp\b/gi, '&')
    .replace(/\bquot;/gi, '"')
    .replace(/\bquot\b/gi, '"')
    .replace(/\bapos;/gi, "'")
    .replace(/\bapos\b/gi, "'")
    .replace(/\blt;/gi, '')
    .replace(/\bgt;/gi, '');

  // Zero-width / bidi marks / soft hyphens
  text = text.replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u00AD]/g, '');

  // Decorative junk often left from marketing sites
  text = text
    .replace(/[◦•●○▪▸►◆◇★☆]/g, ' ')
    .replace(/\[\s*\]/g, ' ')
    .replace(/#\d{4,6}\b/g, ' ')
    .replace(/[|]{2,}/g, ' | ');

  // Restore common Hebrew abbreviations broken when " was stripped (מ"ר → מ ר)
  const hebrewAbbrevs = [
    [/מ\s+ר(?=[\s.,;:!?)\]}]|$)/g, 'מ״ר'],
    [/ע\s+י(?=[\s.,;:!?)\]}]|$)/g, 'ע״י'],
    [/פ\s+ת(?=[\s.,;:!?)\]}]|$)/g, 'פ״ת'],
    [/מת\s+א(?=[\s.,;:!?)\]}]|$)/g, 'מת״א'],
    [/ת\s+א(?=[\s.,;:!?)\]}]|$)/g, 'ת״א'],
    [/ב\s+ב(?=[\s.,;:!?)\]}]|$)/g, 'ב״ב'],
    [/ר\s+א(?=[\s.,;:!?)\]}]|$)/g, 'ר״א'],
  ];
  for (const [pattern, replacement] of hebrewAbbrevs) {
    text = text.replace(pattern, replacement);
  }

  // Orphan semicolons left from broken nbsp; cleanup (e.g. "-;" ".;")
  text = text
    .replace(/([.,\-:()[\]])\s*;+/g, '$1 ')
    .replace(/;{2,}/g, ' ')
    .replace(/(^|\s);+(\s|$)/g, '$1$2');

  // Normalize quotes / dashes
  text = text
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\.{4,}/g, '...');

  // Collapse whitespace
  text = text.replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  text = text.replace(/ +([.,;:!?)])/g, '$1');

  return text;
}
