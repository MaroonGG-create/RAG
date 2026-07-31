import { SEPARATORS, splitText } from '../text-splitter';

function expectMaxLength(chunks: string[], chunkSize: number): void {
  expect(chunks.every((chunk) => chunk.length <= chunkSize)).toBe(true);
}

describe('splitText', () => {
  it('throws when chunkSize is not positive', () => {
    expect(() => splitText('text', 0, 0)).toThrow(
      'chunkSize 必须大于 0',
    );
  });

  it('throws when chunkOverlap is negative', () => {
    expect(() => splitText('text', 100, -1)).toThrow(
      'chunkOverlap 必须大于等于 0 且小于 chunkSize',
    );
  });

  it('throws when chunkOverlap is greater than or equal to chunkSize', () => {
    expect(() => splitText('text', 100, 100)).toThrow(
      'chunkOverlap 必须大于等于 0 且小于 chunkSize',
    );
  });

  it('keeps short text in one chunk', () => {
    expect(splitText('hello', 500, 100)).toEqual(['hello']);
  });

  it('returns empty array for empty text', () => {
    expect(splitText('', 500, 100)).toEqual([]);
  });

  it('splits by paragraphs before harder separators', () => {
    const text = `${'a'.repeat(240)}\n\n${'b'.repeat(240)}\n\n${'c'.repeat(240)}`;
    const chunks = splitText(text, 500, 100);

    expect(chunks.length).toBeGreaterThan(1);
    expectMaxLength(chunks, 500);
  });

  it('splits Chinese sentences without exceeding chunkSize', () => {
    const text = Array.from({ length: 80 }, (_, index) => `第${index}句。`).join('');
    const chunks = splitText(text, 80, 20);

    expect(chunks.length).toBeGreaterThan(1);
    expectMaxLength(chunks, 80);
  });

  it('hard-splits text without separators', () => {
    const text = 'x'.repeat(260);
    const chunks = splitText(text, 100, 20);

    expect(chunks).toHaveLength(3);
    expectMaxLength(chunks, 100);
  });

  it('keeps configured overlap between adjacent chunks when possible', () => {
    const text = Array.from({ length: 260 }, (_, index) =>
      String.fromCharCode(65 + (index % 26)),
    ).join('');
    const chunks = splitText(text, 100, 20);

    expect(chunks[0].slice(-20)).toBe(chunks[1].slice(0, 20));
    expect(chunks[1].slice(-20)).toBe(chunks[2].slice(0, 20));
  });

  it('does not produce chunks larger than chunkSize for mixed content', () => {
    const text = [
      'intro',
      '没有明显空格的中文长文本'.repeat(80),
      'tail',
    ].join('\n');

    expectMaxLength(splitText(text, 120, 30), 120);
  });

  it('handles production chunk configuration', () => {
    const text = '中文内容用于测试切片边界。'.repeat(120);
    const chunks = splitText(text, 500, 100);

    expect(chunks.length).toBeGreaterThan(1);
    expectMaxLength(chunks, 500);
  });

  it('exports the expected separator list', () => {
    expect(SEPARATORS).toEqual([
      '\n\n',
      '\n',
      '。',
      '！',
      '？',
      '. ',
      '! ',
      '? ',
      ' ',
      '',
    ]);
  });
});
