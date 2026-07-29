import { randomUUID } from 'node:crypto';

type TimingMetric = {
  name: string;
  durationMs: number;
  description?: string;
};

function sanitizeToken(value: string) {
  const token = value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 48);
  return token || 'operation';
}

function sanitizeDescription(value: string) {
  return value.replace(/["\\\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 96);
}

export class ServerTiming {
  readonly traceId = randomUUID();
  private readonly startedAt = performance.now();
  private readonly metrics: TimingMetric[] = [];
  private finished = false;

  constructor(private readonly scope: string) {}

  async time<T>(
    name: string,
    operation: () => Promise<T>,
    description?: string,
  ): Promise<T> {
    const startedAt = performance.now();
    try {
      return await operation();
    } finally {
      this.metrics.push({
        name: sanitizeToken(name),
        durationMs: performance.now() - startedAt,
        description,
      });
    }
  }

  finish<T extends Response>(response: T): T {
    if (this.finished) return response;
    this.finished = true;
    this.metrics.push({
      name: 'total',
      durationMs: performance.now() - this.startedAt,
      description: this.scope,
    });

    const serializedMetrics = this.metrics
      .map((metric) => {
        const description = metric.description
          ? `;desc="${sanitizeDescription(metric.description)}"`
          : '';
        return `${metric.name};dur=${metric.durationMs.toFixed(1)}${description}`;
      })
      .join(', ');
    response.headers.set('Server-Timing', serializedMetrics);
    // Vercel may consume the standard Server-Timing header at its proxy layer.
    // Keep a namespaced mirror so production diagnostics retain the breakdown.
    response.headers.set('X-Astromar-Server-Timing', serializedMetrics);
    response.headers.set('X-Trace-Id', this.traceId);

    console.info('[server-timing]', {
      traceId: this.traceId,
      scope: this.scope,
      status: response.status,
      metrics: this.metrics.map((metric) => ({
        name: metric.name,
        durationMs: Number(metric.durationMs.toFixed(1)),
      })),
    });
    return response;
  }
}
