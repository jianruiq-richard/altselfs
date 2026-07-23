import { Pool } from 'pg';
let sharedPool = null;
let sharedUrl = '';
export function getBillingPool(config) {
    const url = config.billingDatabaseUrl;
    if (!url)
        return null;
    if (!sharedPool || sharedUrl !== url) {
        sharedPool = new Pool({ connectionString: url });
        sharedUrl = url;
    }
    return sharedPool;
}
export function getRequiredBillingPool(config) {
    const pool = getBillingPool(config);
    if (!pool)
        throw new BillingUnavailableError('BILLING_DATABASE_URL is not configured.');
    return pool;
}
export async function runSerializableBillingTransaction(config, operation, maxAttempts = 4) {
    const pool = getRequiredBillingPool(config);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const client = await pool.connect();
        try {
            await client.query('begin isolation level serializable');
            const result = await operation(client);
            await client.query('commit');
            return result;
        }
        catch (error) {
            await client.query('rollback').catch(() => null);
            const code = error && typeof error === 'object' && 'code' in error
                ? String(error.code || '')
                : '';
            if (!['40001', '40P01', '23505'].includes(code) || attempt === maxAttempts)
                throw error;
            await new Promise((resolve) => setTimeout(resolve, attempt * 25));
        }
        finally {
            client.release();
        }
    }
    throw new Error('Serializable billing transaction exhausted all retries.');
}
export class BillingUnavailableError extends Error {
    httpStatus = 503;
    code = 'BILLING_UNAVAILABLE';
    constructor(message = 'Billing is temporarily unavailable.') {
        super(message);
        this.name = 'BillingUnavailableError';
    }
}
