import { RetrievalResult } from '../../retrieval/retrieval.types';
import { buildRagPrompt } from '../prompt-builder';

function createResult(id: number, content: string): RetrievalResult {
  return {
    chunkId: id,
    documentId: 10 + id,
    documentName: `doc-${id}.txt`,
    chunkIndex: id - 1,
    pageNo: null,
    content,
    score: 0.9 - id / 100,
  };
}

describe('buildRagPrompt', () => {
  it('builds empty context for empty retrieval results', () => {
    const prompt = buildRagPrompt('question', [], 4000);

    expect(prompt.context).toBe('');
    expect(prompt.usedResultCount).toBe(0);
  });

  it('adds source labels for a single result', () => {
    const prompt = buildRagPrompt('q', [createResult(1, 'hello')], 4000);

    expect(prompt.context).toContain('[来源1] hello');
    expect(prompt.usedResultCount).toBe(1);
  });

  it('joins multiple results with source labels', () => {
    const prompt = buildRagPrompt(
      'q',
      [createResult(1, 'a'), createResult(2, 'b'), createResult(3, 'c')],
      4000,
    );

    expect(prompt.usedResultCount).toBe(3);
    expect(prompt.context).toContain('[来源1]');
    expect(prompt.context).toContain('[来源2]');
    expect(prompt.context).toContain('[来源3]');
  });

  it('stops before adding a result that exceeds maxChars', () => {
    const prompt = buildRagPrompt(
      'q',
      [createResult(1, 'a'.repeat(3000)), createResult(2, 'b'.repeat(3000))],
      4000,
    );

    expect(prompt.usedResultCount).toBe(1);
    expect(prompt.context.length).toBeLessThanOrEqual(4000);
  });

  it('truncates the first oversized result', () => {
    const prompt = buildRagPrompt(
      'q',
      [createResult(1, 'a'.repeat(5000))],
      4000,
    );

    expect(prompt.usedResultCount).toBe(1);
    expect(prompt.context).toHaveLength(4000);
  });

  it('returns system and user messages', () => {
    const prompt = buildRagPrompt('q', [createResult(1, 'hello')], 4000);

    expect(prompt.messages[0].role).toBe('system');
    expect(prompt.messages[1].role).toBe('user');
  });

  it('keeps retrieved content out of the system prompt', () => {
    const prompt = buildRagPrompt('q', [createResult(1, 'hello')], 4000);

    expect(prompt.messages[0].content).not.toContain('hello');
    expect(prompt.messages[0].content).toContain('不得编造');
  });

  it('puts question and context in the user prompt', () => {
    const prompt = buildRagPrompt('什么是 RAG', [createResult(1, '资料')], 4000);

    expect(prompt.messages[1].content).toContain('用户问题：什么是 RAG');
    expect(prompt.messages[1].content).toContain('参考资料：');
    expect(prompt.messages[1].content).toContain('[来源1] 资料');
  });
});
