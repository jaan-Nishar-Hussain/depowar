import { Inject, Injectable } from '@nestjs/common';
import { AppEnv } from '@paymesh/config';
import { ENV } from '../common/tokens';

export interface ScreeningRequest {
  fromAddress?: string;
  toAddress?: string;
  walletAddress?: string;
}

export interface ScreeningResult {
  allowed: boolean;
  reason?: string;
}

export interface ScreeningProvider {
  screen(req: ScreeningRequest): Promise<ScreeningResult>;
}

/**
 * Default pluggable screening hook (PRD §6.7). This implementation uses a
 * deny-list of addresses from env; swap in a Chainalysis/TRM-style provider by
 * registering another ScreeningProvider behind the same token.
 */
@Injectable()
export class BlocklistScreeningProvider implements ScreeningProvider {
  private readonly denyList: Set<string>;

  constructor(@Inject(ENV) env: AppEnv) {
    this.denyList = new Set(
      env.SCREENING_DENY_LIST.split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  async screen(req: ScreeningRequest): Promise<ScreeningResult> {
    const candidates = [req.fromAddress, req.toAddress, req.walletAddress]
      .filter((a): a is string => Boolean(a))
      .map((a) => a.toLowerCase());

    const blocked = candidates.find((a) => this.denyList.has(a));
    if (blocked) {
      return { allowed: false, reason: 'ADDRESS_DENIED' };
    }
    return { allowed: true };
  }
}