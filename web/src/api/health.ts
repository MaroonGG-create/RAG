import type { HealthResult } from '../types/health'
import http from './http'

export async function getHealth(): Promise<HealthResult> {
  const response = await http.get<HealthResult>('/health')

  return response.data
}
