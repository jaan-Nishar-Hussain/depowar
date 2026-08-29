import { Job } from 'bullmq';
import { WorkerContext } from './context';

interface ExpiryJobData {
  quoteId: string;
}

/** Marks a quote EXPIRED once its TTL has passed. */
export async function processQuoteExpiry(job: Job<ExpiryJobData>, ctx: WorkerContext): Promise<void> {
  const { quoteId } = job.data;
  const quote = await ctx.prisma.quote.findUnique({ where: { id: quoteId } });
  if (quote && quote.status === 'ACTIVE' && quote.expiresAt < new Date()) {
    await ctx.prisma.quote.update({ where: { id: quoteId }, data: { status: 'EXPIRED' } });
  }
}