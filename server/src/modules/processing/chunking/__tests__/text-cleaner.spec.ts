import { cleanText } from '../text-cleaner';

describe('cleanText', () => {
  it('normalizes Windows line breaks', () => {
    expect(cleanText('a\r\nb\r\nc')).toBe('a\nb\nc');
  });

  it('normalizes old Mac line breaks', () => {
    expect(cleanText('a\rb\rc')).toBe('a\nb\nc');
  });

  it('removes zero width characters', () => {
    expect(cleanText('a\u200Bb\u200Cc\u200Dd\uFEFFe')).toBe(
      'abcde',
    );
  });

  it('compresses three or more line breaks to two', () => {
    expect(cleanText('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('keeps two line breaks unchanged', () => {
    expect(cleanText('a\n\nb')).toBe('a\n\nb');
  });

  it('trims surrounding whitespace', () => {
    expect(cleanText('  hello  ')).toBe('hello');
  });

  it('returns empty string for empty input', () => {
    expect(cleanText('')).toBe('');
  });

  it('handles combined cleanup rules', () => {
    expect(cleanText('  \r\n\u200Btext\r\n\r\n\r\n  ')).toBe(
      'text',
    );
  });

  it('returns empty string for whitespace-only text', () => {
    expect(cleanText('   \n\n  ')).toBe('');
  });
});
