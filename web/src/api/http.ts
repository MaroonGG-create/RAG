import axios from 'axios'

interface ErrorResponse {
  message?: string
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
      throw new Error(error.response?.data.message ?? error.message)
    }

    if (error instanceof Error) {
      throw new Error(error.message)
    }

    throw new Error('请求失败')
  },
)

export default http
