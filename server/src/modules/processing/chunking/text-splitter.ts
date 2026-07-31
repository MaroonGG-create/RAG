export const SEPARATORS = [
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
] as const;

export function splitText(
  text: string,
  chunkSize: number,
  chunkOverlap: number,
): string[] {
  if (chunkSize <= 0) {
    throw new Error('chunkSize 必须大于 0');
  }

  if (chunkOverlap < 0 || chunkOverlap >= chunkSize) {
    throw new Error('chunkOverlap 必须大于等于 0 且小于 chunkSize');
  }

  const segments = recursiveSplit(text, chunkSize, [...SEPARATORS]);
  return mergeWithOverlap(segments, chunkSize, chunkOverlap);
}

function recursiveSplit(
  text: string,
  maxLength: number,
  separators: string[],
): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const [separator, ...remainingSeparators] = separators;

  if (separator === undefined || separator === '') {
    return hardSplit(text, maxLength);
  }

  const parts = text.split(separator);
  const result: string[] = [];

  parts.forEach((part, index) => {
    const segment =
      index < parts.length - 1 ? `${part}${separator}` : part;

    if (segment.length === 0) {
      return;
    }

    if (segment.length <= maxLength) {
      result.push(segment);
      return;
    }

    result.push(
      ...recursiveSplit(segment, maxLength, remainingSeparators),
    );
  });

  return result;
}

function hardSplit(text: string, maxLength: number): string[] {
  const result: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    const splitAt = findHardSplitPosition(remaining, maxLength);
    result.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  if (remaining.length > 0) {
    result.push(remaining);
  }

  return result;
}

function findHardSplitPosition(
  text: string,
  maxLength: number,
): number {
  const lastSpaceIndex = text.lastIndexOf(' ', maxLength - 1);

  if (lastSpaceIndex > 0) {
    return lastSpaceIndex + 1;
  }

  return maxLength;
}

function mergeWithOverlap(
  segments: string[],
  chunkSize: number,
  chunkOverlap: number,
): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const segment of segments) {
    if (segment.length === 0) {
      continue;
    }

    if (current.length + segment.length <= chunkSize) {
      current += segment;
      continue;
    }

    if (current.length > 0) {
      chunks.push(current);
      const overlap =
        chunkOverlap > 0 ? current.slice(-chunkOverlap) : '';
      current = mergeOverflow(
        overlap + segment,
        chunks,
        chunkSize,
        chunkOverlap,
      );
      continue;
    }

    current = mergeOverflow(segment, chunks, chunkSize, chunkOverlap);
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

function mergeOverflow(
  text: string,
  chunks: string[],
  chunkSize: number,
  chunkOverlap: number,
): string {
  if (text.length <= chunkSize) {
    return text;
  }

  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const part = text.slice(start, end);

    if (end === text.length) {
      return part;
    }

    chunks.push(part);
    start = chunkOverlap > 0 ? end - chunkOverlap : end;
  }

  return '';
}
