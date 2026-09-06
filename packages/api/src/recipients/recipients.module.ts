import { Module } from '@nestjs/common';
import { RecipientsController } from './recipients.controller';
import { ReceiverController } from './receiver.controller';
import { RecipientsService } from './recipients.service';
import { AuditModule } from '../audit/audit.module';
import { EnvModule } from '../env/env.module';
import { ScreeningModule } from '../screening/screening.module';

@Module({
  imports: [AuditModule, EnvModule, ScreeningModule],
  controllers: [RecipientsController, ReceiverController],
  providers: [RecipientsService],
  exports: [RecipientsService],
})
export class RecipientsModule {}
