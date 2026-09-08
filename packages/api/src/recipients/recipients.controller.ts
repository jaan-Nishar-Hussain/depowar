import { Body, Controller, Get, Inject, Param, Post, Put } from '@nestjs/common';
import { ZodPipe } from '../common/zod.pipe';
import { stringifyBigInts } from '../common/serialize';
import { Project, Scopes, type ProjectContext } from '../auth/decorators';
import { CreateRecipientSchema, SettlementUpdateSchema, type CreateRecipientDto, type SettlementUpdateDto } from './dto';
import { RecipientsService } from './recipients.service';

@Controller('recipients')
export class RecipientsController {
  constructor(@Inject(RecipientsService) private readonly service: RecipientsService) {}

  @Get()
  @Scopes('management')
  async list(@Project() project: ProjectContext) {
    return stringifyBigInts(await this.service.list(project.id));
  }

  @Post()
  @Scopes('management')
  async create(@Project() project: ProjectContext, @Body(new ZodPipe(CreateRecipientSchema)) dto: CreateRecipientDto) {
    return stringifyBigInts(await this.service.create(project.id, dto));
  }

  @Get(':id')
  @Scopes('recipients')
  async get(@Project() project: ProjectContext, @Param('id') id: string) {
    return stringifyBigInts(await this.service.get(project.id, id));
  }

  @Put(':id/settlement')
  @Scopes('recipients')
  async updateSettlement(
    @Project() project: ProjectContext,
    @Param('id') id: string,
    @Body(new ZodPipe(SettlementUpdateSchema)) dto: SettlementUpdateDto,
  ) {
    return stringifyBigInts(await this.service.updateSettlement(project.id, id, dto));
  }
}