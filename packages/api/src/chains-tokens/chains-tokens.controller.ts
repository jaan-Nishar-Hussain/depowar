import { Controller, Get, Inject, Query } from '@nestjs/common';
import { coverageSummary, getCoverageMatrix, getDestinationChainIds, getTokens, listChains } from '@paymesh/config';
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

  /**
   * Configuration-level route coverage matrix (Next-Gen Routing PRD
   * §Success Metrics: "Coverage: % of input token/chain combos successfully
   * served"). Reports which (source, destination) pairs currently have a
   * configured adapter path, without making any network calls. Pass
   * `?fromChainId=` to filter to one source chain.
   */
  @Get('coverage')
  @Scopes('quote')
  coverage(@Query('fromChainId') fromChainId?: string) {
    const matrix = getCoverageMatrix(this.env);
    const filtered = fromChainId ? matrix.filter((pair) => pair.fromChainId === Number(fromChainId)) : matrix;
    return { summary: coverageSummary(filtered), pairs: filtered };
  }
}
