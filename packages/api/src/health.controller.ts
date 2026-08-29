import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorators';

@Controller('health')
export class HealthController {
  @Get()
  @Public()
  health() {
    return { status: 'ok', service: 'paymesh-api', time: new Date().toISOString() };
  }
}