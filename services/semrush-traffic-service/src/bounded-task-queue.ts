export type QueueSnapshot = {
  active: number;
  waiting: number;
  maxActive: 1;
  maxWaiting: number;
  capacity: number;
};

type QueueJob<T> = {
  task: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

export class QueueFullError extends Error {
  readonly code = 'QUEUE_FULL';

  constructor(readonly queue: QueueSnapshot) {
    super(`Semrush query queue is full (${queue.active} active, ${queue.waiting} waiting)`);
    this.name = 'QueueFullError';
  }
}

export class BoundedSerialTaskQueue {
  private active = 0;
  private readonly waiting: QueueJob<unknown>[] = [];

  constructor(readonly maxWaiting: number) {
    if (!Number.isInteger(maxWaiting) || maxWaiting < 0) {
      throw new Error('maxWaiting must be a non-negative integer');
    }
  }

  snapshot(): QueueSnapshot {
    return {
      active: this.active,
      waiting: this.waiting.length,
      maxActive: 1,
      maxWaiting: this.maxWaiting,
      capacity: 1 + this.maxWaiting,
    };
  }

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (this.active === 1 && this.waiting.length >= this.maxWaiting) {
      return Promise.reject(new QueueFullError(this.snapshot()));
    }

    return new Promise<T>((resolve, reject) => {
      const job: QueueJob<T> = { task, resolve, reject };
      if (this.active === 0) {
        this.active = 1;
        void this.run(job);
        return;
      }
      this.waiting.push(job as QueueJob<unknown>);
    });
  }

  private async run<T>(job: QueueJob<T>) {
    try {
      job.resolve(await job.task());
    } catch (error) {
      job.reject(error);
    } finally {
      const next = this.waiting.shift();
      if (next) {
        void this.run(next);
      } else {
        this.active = 0;
      }
    }
  }
}
