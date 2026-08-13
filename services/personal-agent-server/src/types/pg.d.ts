declare module 'pg' {
  export class Client {
    constructor(options: { connectionString: string });
    connect(): Promise<void>;
    query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
    end(): Promise<void>;
  }

  export type PoolClient = {
    query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
    release(): void;
  };

  export class Pool {
    constructor(options: { connectionString: string });
    query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
    connect(): Promise<PoolClient>;
  }
}
