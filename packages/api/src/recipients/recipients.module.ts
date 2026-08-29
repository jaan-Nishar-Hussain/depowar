import { Module } from '@nestjs/common';
import { RecipientsController } from './recipients.controller';
import { RecipientsService } from './recipients.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [RecipientsController],
  providers: [RecipientsService],
})
export class RecipientsModule {}