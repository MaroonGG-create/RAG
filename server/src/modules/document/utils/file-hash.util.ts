import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    // 即使当前限制为 20MB，也保持流式计算，避免文件上限调整后占用整块内存。
    stream.on('data', (chunk: string | Buffer) => {
      hash.update(chunk);
    });
    stream.on('error', (error: Error) => {
      reject(error);
    });
    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });
  });
}
