import axios from 'axios'

interface ErrorResponse {
  code?: number
  message?: string
  details?: unknown
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const response = value as Record<string, unknown>

  return (
    typeof response.code === 'number' &&
    typeof response.message === 'string' &&
    'data' in response
  )
}

interface ApiErrorOptions {
  status?: number
  code?: number
  details?: unknown
}

export class ApiError extends Error {
  readonly status?: number
  readonly code?: number
  readonly details?: unknown

  constructor(message: string, options: ApiErrorOptions = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = options.status
    this.code = options.code
    this.details = options.details
  }
}

const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
})

http.interceptors.response.use(
  (response) => {
    if (isApiResponse(response.data)) {
      response.data = response.data.data
    }

    return response
  },
  (error: unknown) => {
    if (axios.isAxiosError<ErrorResponse>(error)) {
      const status = error.response?.status
      const payload = error.response?.data
      const message =
        typeof payload?.message === 'string' && payload.message.length > 0
          ? payload.message
          : error.message

      throw new ApiError(message || '请求失败', {
        status,
        code: payload?.code,
        details: payload?.details,
      })
    }

    if (error instanceof Error) {
      throw new ApiError(error.message)
    }

    throw new ApiError('请求失败')
  },
)

export default http
