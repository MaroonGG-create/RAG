export interface HealthResult {
  status: string
  db: 'up' | 'down'
  uptime: number
}
