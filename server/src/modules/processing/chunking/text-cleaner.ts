const ZERO_WIDTH_CHARACTERS = /[\u200B\u200C\u200D\uFEFF]/g;
const THREE_OR_MORE_LINE_BREAKS = /\n{3,}/g;

export function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(ZERO_WIDTH_CHARACTERS, '')
    .replace(THREE_OR_MORE_LINE_BREAKS, '\n\n')
    .trim();
}
