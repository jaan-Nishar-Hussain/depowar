import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { ZodPipe } from '../common/zod.pipe';
import { stringifyBigInts } from '../common/serialize';
import { Project, Scopes, type ProjectContext } from '../auth/decorators';
import { CreateDepositIntentSchema, ListDepositIntentsQuery, type CreateDepositIntentDto, type ListDepositIntentsQueryDto } from './dto';
import { DepositIntentsService } from './deposit-intents.service';

@Controller('deposit-intents')
export class DepositIntentsController {
  constructor(@Inject(DepositIntentsService) private readonly service: DepositIntentsService) {}

  @Post()
  @Scopes('deposits')
  create(@Project() project: ProjectContext, @Body(new ZodPipe(CreateDepositIntentSchema)) dto: CreateDepositIntentDto) {
    return this.service.create(project.id, dto);
  }

  @Get()
  @Scopes('deposits', 'quote')
  async list(@Project() project: ProjectContext, @Query(new ZodPipe(ListDepositIntentsQuery)) query: ListDepositIntentsQueryDto) {
    return stringifyBigInts(await this.service.list(project.id, query));
  }

  @Get(':id')
  @Scopes('deposits')
  async findOne(@Project() project: ProjectContext, @Param('id') id: string) {
    return stringifyBigInts(await this.service.findOne(project.id, id));
  }

  @Get(':id/recovery')
  @Scopes('deposits')
  async getRecovery(@Project() project: ProjectContext, @Param('id') id: string) {
    return stringifyBigInts(await this.service.getRecoveryStatus(project.id, id));
  }

  @Post(':id/retry')
  @Scopes('deposits')
  async retry(@Project() project: ProjectContext, @Param('id') id: string) {
    return stringifyBigInts(await this.service.retry(project.id, id));
  }
}