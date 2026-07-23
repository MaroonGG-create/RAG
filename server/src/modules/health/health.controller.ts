import { Controller, Get } from '@nestjs/common';

import { HealthResult, HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth(): Promise<HealthResult> {
    return this.healthService.getHealth();
  }
}
