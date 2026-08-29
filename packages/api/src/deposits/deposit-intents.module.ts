import { Module } from '@nestjs/common';
import { DepositIntentsController } from './deposit-intents.controller';
import { DepositIntentsService } from './deposit-intents.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [DepositIntentsController],
  providers: [DepositIntentsService],
})
export class DepositIntentsModule {}