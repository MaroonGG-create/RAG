import axios, {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import { afterEach, describe, expect, it } from 'vitest'

import http, { ApiError } from '../http'

function response<T>(
  data: T,
  config: InternalAxiosRequestConfig,
  status = 200,
): AxiosResponse<T> {
  return {
    data,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {},
    config,
    request: {},
  }
}

function setAdapter(adapter: AxiosAdapter): void {
  http.defaults.adapter = adapter
}

describe('http', () => {
  afterEach(() => {
    http.defaults.adapter = undefined
  })

  it('constructs ApiError with optional metadata', () => {
    const error = new ApiError('msg', {
      status: 404,
      code: 404,
      details: { id: 1 },
    })

    expect(error.name).toBe('ApiError')
    expect(error.message).toBe('msg')
    expect(error.status).toBe(404)
    expect(error.code).toBe(404)
    expect(error.details).toEqual({ id: 1 })
  })

  it('unwraps successful unified API responses', async () => {
    setAdapter(async (config) =>
      response({ code: 0, message: 'success', data: { id: 1 } }, config),
    )

    await expect(http.get('/ok')).resolves.toMatchObject({
      data: { id: 1 },
    })
  })

  it('passes through non-unified responses', async () => {
    setAdapter(async (config) => response({ status: 'ok' }, config))

    await expect(http.get('/plain')).resolves.toMatchObject({
      data: { status: 'ok' },
    })
  })

  it('wraps axios errors with response payload', async () => {
    setAdapter(async (config) => {
      throw new AxiosError(
        'Request failed',
        undefined,
        config,
        {},
        response({ code: 404, message: '不存在', details: { id: 1 } }, config, 404),
      )
    })

    await expect(http.get('/missing')).rejects.toMatchObject({
      name: 'ApiError',
      message: '不存在',
      status: 404,
      code: 404,
      details: { id: 1 },
    })
  })

  it('wraps axios network errors without response', async () => {
    setAdapter(async (config) => {
      throw new AxiosError('Network Error', undefined, config)
    })

    await expect(http.get('/offline')).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Network Error',
    })
  })

  it('wraps non-axios errors', async () => {
    setAdapter(async () => {
      throw new Error('boom')
    })

    await expect(http.get('/boom')).rejects.toMatchObject({
      name: 'ApiError',
      message: 'boom',
    })
    expect(axios.isAxiosError(new Error('x'))).toBe(false)
  })
})
