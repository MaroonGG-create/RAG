import { ParseFailure } from '../parsed-document.types';
import { decodePlainText } from '../plain-text.parser';

function utf16BeBuffer(text: string): Buffer {
  const leBuffer = Buffer.from(text, 'utf16le');
  const beBuffer = Buffer.allocUnsafe(leBuffer.length);

  for (let index = 0; index < leBuffer.length; index += 2) {
    beBuffer[index] = leBuffer[index + 1];
    beBuffer[index + 1] = leBuffer[index];
  }

  return Buffer.concat([Buffer.from([0xfe, 0xff]), beBuffer]);
}

describe('decodePlainText', () => {
  it('decodes UTF-8 without BOM', () => {
    expect(decodePlainText(Buffer.from('hello', 'utf8'))).toBe(
      'hello',
    );
  });

  it('decodes UTF-8 with BOM', () => {
    const buffer = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('hello', 'utf8'),
    ]);

    expect(decodePlainText(buffer)).toBe('hello');
  });

  it('decodes UTF-16 LE with BOM', () => {
    const buffer = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('hello', 'utf16le'),
    ]);

    expect(decodePlainText(buffer)).toBe('hello');
  });

  it('decodes UTF-16 BE with BOM', () => {
    expect(decodePlainText(utf16BeBuffer('你好'))).toBe('你好');
  });

  it('throws for empty content', () => {
    expect(() => decodePlainText(Buffer.from('', 'utf8'))).toThrow(
      new ParseFailure('文件内容为空'),
    );
  });

  it('throws for whitespace-only content', () => {
    expect(() => decodePlainText(Buffer.from('   \n  ', 'utf8'))).toThrow(
      new ParseFailure('文件内容为空'),
    );
  });

  it('throws for invalid encoding replacement characters', () => {
    expect(() => decodePlainText(Buffer.from([0xff]))).toThrow(
      new ParseFailure('文件编码无法识别，请转换为 UTF-8 编码后重新上传'),
    );
  });

  it('decodes Chinese UTF-8 text', () => {
    expect(decodePlainText(Buffer.from('你好世界', 'utf8'))).toBe(
      '你好世界',
    );
  });
});
