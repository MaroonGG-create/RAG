import { ParseFailure } from './parsed-document.types';

export function decodePlainText(buffer: Buffer): string {
  let text: string;

  if (hasBom(buffer, [0xef, 0xbb, 0xbf])) {
    text = buffer.subarray(3).toString('utf8');
  } else if (hasBom(buffer, [0xff, 0xfe])) {
    text = buffer.subarray(2).toString('utf16le');
  } else if (hasBom(buffer, [0xfe, 0xff])) {
    text = swapUtf16Be(buffer.subarray(2)).toString('utf16le');
  } else {
    text = buffer.toString('utf8');
  }

  if (text.includes('\uFFFD')) {
    throw new ParseFailure('文件编码无法识别，请转换为 UTF-8 编码后重新上传');
  }

  if (text.trim().length === 0) {
    throw new ParseFailure('文件内容为空');
  }

  return text;
}

function hasBom(buffer: Buffer, bytes: number[]): boolean {
  return bytes.every((byte, index) => buffer[index] === byte);
}

function swapUtf16Be(buffer: Buffer): Buffer {
  const swapped = Buffer.allocUnsafe(buffer.length);

  for (let index = 0; index < buffer.length; index += 2) {
    swapped[index] = buffer[index + 1] ?? 0;
    swapped[index + 1] = buffer[index];
  }

  return swapped;
}
