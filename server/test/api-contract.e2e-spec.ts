import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type {
  SuperTest,
  Test as SuperTestRequest,
} from 'supertest';

import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { KnowledgeBaseController } from '../src/modules/knowledge-base/knowledge-base.controller';
import { KnowledgeBaseService } from '../src/modules/knowledge-base/knowledge-base.service';
import { RagController } from '../src/modules/rag/rag.controller';
import { RagService } from '../src/modules/rag/rag.service';
import { RetrievalController } from '../src/modules/retrieval/retrieval.controller';
import { RetrievalService } from '../src/modules/retrieval/retrieval.service';
import { EmbeddingFailure } from '../src/modules/embedding/embedding.types';

type KnowledgeBaseServiceMock = jest.Mocked<
  Pick<KnowledgeBaseService, 'create' | 'findAll' | 'findOne' | 'remove'>
>;
type RetrievalServiceMock = jest.Mocked<Pick<RetrievalService, 'search'>>;
type RagServiceMock = jest.Mocked<Pick<RagService, 'ask'>>;

describe('API contract (e2e)', () => {
  let app: INestApplication;
  let knowledgeBaseService: KnowledgeBaseServiceMock;
  let retrievalService: RetrievalServiceMock;
  let ragService: RagServiceMock;

  function http(): SuperTest<SuperTestRequest> {
    return request(app.getHttpServer()) as unknown as SuperTest<SuperTestRequest>;
  }

  beforeEach(async () => {
    knowledgeBaseService = {
      create: jest.fn().mockResolvedValue({
        id: 1,
        name: 'kb',
        description: null,
        documentCount: 0,
        createdAt: '2026-07-31T00:00:00.000Z',
        updatedAt: '2026-07-31T00:00:00.000Z',
      }),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({
        id: 1,
        name: 'kb',
        description: null,
        documentCount: 0,
        createdAt: '2026-07-31T00:00:00.000Z',
        updatedAt: '2026-07-31T00:00:00.000Z',
      }),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    retrievalService = {
      search: jest.fn().mockResolvedValue({
        results: [
          {
            chunkId: 11,
            documentId: 22,
            documentName: 'manual.pdf',
            chunkIndex: 0,
            pageNo: 3,
            content: 'content',
            score: 0.91,
          },
        ],
        total: 1,
        took: 8,
      }),
    };
    ragService = {
      ask: jest.fn().mockResolvedValue({
        answer: '知识库中未找到与您问题相关的内容。',
        references: [],
        retrievalTook: 5,
        llmTook: 0,
        took: 5,
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [
        KnowledgeBaseController,
        RetrievalController,
        RagController,
      ],
      providers: [
        { provide: KnowledgeBaseService, useValue: knowledgeBaseService },
        { provide: RetrievalService, useValue: retrievalService },
        { provide: RagService, useValue: ragService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor(new Reflector()));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('wraps successful knowledge base create responses', async () => {
    await http()
      .post('/api/knowledge-bases')
      .send({ name: 'kb' })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: 0,
          message: 'success',
          data: { id: 1, name: 'kb' },
        });
      });

    expect(knowledgeBaseService.create).toHaveBeenCalledWith({ name: 'kb' });
  });

  it('returns validation errors through the global exception filter', async () => {
    await http()
      .post('/api/knowledge-bases')
      .send({ name: '' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe(400);
        expect(body.message).toBe('参数校验失败');
      });
  });

  it('keeps delete responses unwrapped as 204', async () => {
    await http().delete('/api/knowledge-bases/1').expect(204);

    expect(knowledgeBaseService.remove).toHaveBeenCalledWith(1);
  });

  it('maps retrieve request options and returns retrieval DTO without vectors', async () => {
    await http()
      .post('/api/knowledge-bases/1/retrieve')
      .send({ query: '问题', topK: 3, scoreThreshold: 0.8 })
      .expect(201)
      .expect(({ body }) => {
        expect(body.data.results[0]).toEqual({
          chunkId: 11,
          documentId: 22,
          documentName: 'manual.pdf',
          chunkIndex: 0,
          pageNo: 3,
          content: 'content',
          score: 0.91,
        });
        expect(body.data.results[0].vector).toBeUndefined();
      });

    expect(retrievalService.search).toHaveBeenCalledWith(
      1,
      '问题',
      3,
      0.8,
    );
  });

  it('maps embedding failures on retrieve to a safe 502 message', async () => {
    retrievalService.search.mockRejectedValueOnce(
      new EmbeddingFailure('secret upstream error'),
    );

    await http()
      .post('/api/knowledge-bases/1/retrieve')
      .send({ query: '问题' })
      .expect(502)
      .expect(({ body }) => {
        expect(body.message).toBe('检索服务暂时不可用：向量生成失败');
        expect(JSON.stringify(body)).not.toContain('secret upstream error');
      });
  });

  it('wraps ask responses and preserves empty references for no-hit answers', async () => {
    await http()
      .post('/api/knowledge-bases/1/ask')
      .send({ question: '无关问题' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.answer).toBe('知识库中未找到与您问题相关的内容。');
        expect(body.data.references).toEqual([]);
      });

    expect(ragService.ask).toHaveBeenCalledWith(
      1,
      '无关问题',
      undefined,
      undefined,
    );
  });
});
