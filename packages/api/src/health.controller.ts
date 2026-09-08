import { Controller, Get, Inject, Optional } from '@nestjs/common';
import { Public } from './auth/decorators';
import { getEnv, cctpTokenMessenger, cctpMessageTransmitter, mainnetUniswap } from '@paymesh/config';
import { getSharedTelemetryStore } from '@paymesh/routing-engine';
import type { RoutingMetricsService } from './metrics/routing-metrics.service';

/** Live status of each federated routing provider (dashboard provider strip). */
@Controller('health')
export class HealthController {
  constructor(@Optional() private readonly routingMetrics?: RoutingMetricsService) {}

  @Get()
  @Public()
  health() {
    return { status: 'ok', service: 'depowar-api', time: new Date().toISOString() };
  }

  @Get('providers')
  @Public()
  async providers() {
    const env = getEnv();
    const dest = env.PAYMESH_DEST_CHAIN_IDS.split(',').map(Number).filter(Boolean);

    const probe = async (url: string): Promise<{ ok: boolean; latencyMs?: number; status?: number }> => {
      const started = Date.now();
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6_000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        return { ok: res.ok, status: res.status, latencyMs: Date.now() - started };
      } catch {
        return { ok: false, latencyMs: Date.now() - started };
      }
    };

    const [lifi, across] = await Promise.all([
      probe('https://li.quest/v1/chains'),
      probe('https://api.across.to/supported/chains'),
    ]);

    const cctpConfigured = dest.some((chainId) => cctpTokenMessenger(chainId)) && dest.some((chainId) => cctpMessageTransmitter(chainId));
    const uniswapChains = [1, 8453, 137, 42161, 10].filter((id) => mainnetUniswap(id).router);

    return {
      generatedAt: new Date().toISOString(),
      providers: {
        lifi: {
          enabled: env.LIFI_ENABLED,
          healthy: lifi.ok,
          status: lifi.status,
          latencyMs: lifi.latencyMs,
          telemetry: getSharedTelemetryStore().snapshot().lifi,
        },
        across: {
          enabled: env.ACROSS_ENABLED,
          healthy: across.ok,
          status: across.status,
          latencyMs: across.latencyMs,
          telemetry: getSharedTelemetryStore().snapshot().across,
        },
        cctp: {
          enabled: env.CCTP_ENABLED,
          configured: cctpConfigured,
          healthy: env.CCTP_ENABLED && cctpConfigured,
          networks: dest,
        },
        oneInch: { enabled: env.ONEINCH_ENABLED && !!env.ONEINCH_API_KEY },
        ccip: { enabled: env.CCIP_ENABLED, configured: env.CCIP_ROUTERS.length > 0 },
        uniswap: { enabled: uniswapChains.length > 0, networks: uniswapChains },
      },
      routing: this.routingMetrics ? JSON.parse(JSON.stringify(this.routingMetrics.snapshot().counters)) : {},
    };
  }
}