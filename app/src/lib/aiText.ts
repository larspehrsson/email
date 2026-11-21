// Text in and out of writing help: the model reads plain text and answers in plain text
// (paragraphs, "- " lists); the composer holds HTML. Import-free, for the unit tests.

/** Longest original sent along (a long thread's quoted history): the newest part is kept. */
export const ORIGINAL_MAX = 60_000;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The model's plain text as the composer's HTML: paragraphs, line breaks, "- " lists. */
export function textToHtml(text: string): string {
  const blocks = text.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/);
  return blocks
    .map((b) => {
      const lines = b.split('\n');
      if (lines.every((l) => /^\s*[-•*]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li><p>${esc(l.replace(/^\s*[-•*]\s+/, ''))}</p></li>`).join('')}</ul>`;
      }
      return `<p>${lines.map(esc).join('<br>')}</p>`;
    })
    .join('');
}

/** Plain text of some HTML (block ends become line breaks), given a parser (the DOM's). */
export function htmlToText(html: string, parse: (h: string) => { body: { innerText?: string; textContent: string | null } }): string {
  // Block ends and <br> as new lines before the markup goes.
  const marked = html
    // Not text: a newsletter's CSS would fill the prompt.
    .replace(/<(style|script|head|title|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '$&\n')
    .replace(/<li[^>]*>/gi, '$&- ');
  const text = parse(marked).body.textContent ?? '';
  return text
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The original for the prompt: whole, or its newest part when very long. */
export function clipOriginal(text: string): string {
  if (text.length <= ORIGINAL_MAX) return text;
  return `${text.slice(0, ORIGINAL_MAX)}\n[… older quoted history left out]`;
}
