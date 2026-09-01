import { Controller, Get, Inject, Query } from '@nestjs/common';
import { getDestinationChainIds, getTokens, listChains } from '@paymesh/config';
import { ENV } from '../common/tokens';
import type { AppEnv } from '@paymesh/config';
import { Scopes } from '../auth/decorators';

@Controller()
export class ChainsTokensController {
  constructor(@Inject(ENV) private readonly env: AppEnv) {}

  @Get('chains')
  @Scopes('quote')
  chains() {
    return listChains();
  }

  @Get('destination-chains')
  @Scopes('quote')
  destinationChains() {
    const enabled = new Set(getDestinationChainIds(this.env));
    return listChains().filter((chain) => enabled.has(chain.id));
  }

  @Get('tokens')
  @Scopes('quote')
  tokens(@Query('chainId') chainId?: string) {
    const id = chainId ? Number(chainId) : 80002;
    return getTokens(id);
  }
}
