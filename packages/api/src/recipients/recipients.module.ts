import { Module } from '@nestjs/common';
import { RecipientsController } from './recipients.controller';
import { RecipientsService } from './recipients.service';
import { AuditModule } from '../audit/audit.module';
import { EnvModule } from '../env/env.module';

@Module({
  imports: [AuditModule, EnvModule],
  controllers: [RecipientsController],
  providers: [RecipientsService],
})
export class RecipientsModule {}
