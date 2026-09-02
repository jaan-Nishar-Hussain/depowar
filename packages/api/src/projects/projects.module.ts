import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { RecipientsModule } from '../recipients/recipients.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({ imports: [AuthModule, ApiKeysModule, RecipientsModule], controllers: [ProjectsController], providers: [ProjectsService] })
export class ProjectsModule {}
