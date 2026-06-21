declare module 'pg' {
  export class Pool {
    constructor(options: { connectionString: string });
    query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
    connect(): Promise<{
      query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
      release(): void;
    }>;
  }
}
