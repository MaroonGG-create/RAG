import { ChatMessage } from '../llm/llm.types';
import { RetrievalResult } from '../retrieval/retrieval.types';

const SYSTEM_PROMPT = `你是一个知识库问答助手。请根据下方提供的参考资料回答用户问题。

回答规则：
1. 只能基于参考资料中的内容回答问题，不得编造、猜测或使用参考资料以外的知识。
2. 如果参考资料中没有相关信息，请明确回答"根据知识库中的资料，我无法回答这个问题"。
3. 回答使用中文，语言简洁明了。
4. 如果参考资料中有多个相关片段，请综合归纳后回答。
5. 回答中不要提及"来源1""来源2"等标注编号。
6. 回答中不要提及文档名、页码、chunkId 等内部元数据。`;

export interface BuiltPrompt {
  messages: ChatMessage[];
  context: string;
  usedResultCount: number;
}

export function buildRagPrompt(
  question: string,
  results: RetrievalResult[],
  maxChars: number,
): BuiltPrompt {
  const { context, usedResultCount } = buildContext(results, maxChars);
  const userPrompt = `参考资料：\n\n${context}\n\n用户问题：${question}`;

  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    context,
    usedResultCount,
  };
}

function buildContext(
  results: RetrievalResult[],
  maxChars: number,
): { context: string; usedResultCount: number } {
  const parts: string[] = [];
  let usedResultCount = 0;
  let currentLength = 0;

  for (let index = 0; index < results.length; index += 1) {
    const part = `[来源${index + 1}] ${results[index].content}`;
    const separator = parts.length === 0 ? '' : '\n\n';
    const availableLength =
      maxChars - currentLength - separator.length;

    if (availableLength <= 0) {
      break;
    }

    if (part.length > availableLength) {
      if (parts.length === 0) {
        parts.push(part.slice(0, availableLength));
        usedResultCount = 1;
      }

      break;
    }

    parts.push(part);
    currentLength += separator.length + part.length;
    usedResultCount += 1;
  }

  return {
    context: parts.join('\n\n'),
    usedResultCount,
  };
}
