import { Module } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController],
  providers: [ApiKeyGuard, AuthService],
  exports: [ApiKeyGuard, AuthService],
})
export class AuthModule {}
