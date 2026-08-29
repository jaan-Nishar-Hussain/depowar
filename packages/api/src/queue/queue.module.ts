import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { EventService } from './event.service';

@Global()
@Module({
  providers: [QueueService, EventService],
  exports: [QueueService, EventService],
})
export class QueueModule {}