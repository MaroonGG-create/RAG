import axios from 'axios'

interface ErrorResponse {
  message?: string
}

const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
})

http.interceptors.response.use(
  (response) => response,
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
