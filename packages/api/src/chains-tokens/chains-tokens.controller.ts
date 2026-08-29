import { Controller, Get, Query } from '@nestjs/common';
import { getTokens, listChains } from '@paymesh/config';
import { Scopes } from '../auth/decorators';

@Controller()
export class ChainsTokensController {
  @Get('chains')
  @Scopes('quote')
  chains() {
    return listChains();
  }

  @Get('tokens')
  @Scopes('quote')
  tokens(@Query('chainId') chainId?: string) {
    const id = chainId ? Number(chainId) : 31337;
    return getTokens(id);
  }
}