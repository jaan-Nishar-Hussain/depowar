import { getQuote, type GetQuoteDeps } from './getQuote';
import type { ProviderTelemetry } from './adapters/types';
import type { Quote, QuoteRequest, ScoreWeights } from './types';

export interface RouteHandlerOptions {
  dependencies: GetQuoteDeps;
  telemetry?: Record<string, ProviderTelemetry>;
  weights?: ScoreWeights;
}

export class ProviderTelemetryStore {
  private readonly stats = new Map<string, ProviderTelemetry>();
  private readonly samples = new Map<string, number>();

  snapshot(): Record<string, ProviderTelemetry> {
    return Object.fromEntries(this.stats.entries());
  }

  record(providerId: string, result: { success: boolean; latencyMs?: number; slippageBps?: number }): void {
    const current = this.stats.get(providerId) ?? { reliability: 0.9 };
    const previousSamples = this.samples.get(providerId) ?? 0;
    const nextReliability = current.reliability === undefined
      ? (result.success ? 1 : 0)
      : current.reliability * 0.9 + (result.success ? 0.1 : 0);
    this.stats.set(providerId, {
      ...current,
      reliability: nextReliability,
      averageLatencyMs: result.latencyMs === undefined
        ? current.averageLatencyMs
        : ((current.averageLatencyMs ?? 0) * previousSamples + result.latencyMs) / (previousSamples + 1),
      averageSlippageBps: result.slippageBps === undefined ? current.averageSlippageBps : result.slippageBps,
    });
    this.samples.set(providerId, previousSamples + 1);
  }
}

/**
 * Provider-independent routing facade. Providers only describe what they can
 * execute; this handler owns route selection and returns the best complete
 * path plus alternatives.
 */
export class RouteHandler {
  constructor(private readonly options: RouteHandlerOptions) {}

  async findBestRoute(request: QuoteRequest): Promise<{ best: Quote; alternates: Quote[] }> {
    const result = await getQuote(request, {
      ...this.options.dependencies,
      telemetry: this.options.telemetry,
      weights: this.options.weights,
    });
    return { best: result.best, alternates: result.alternates };
  }
}
