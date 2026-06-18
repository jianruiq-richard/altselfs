import { randomUUID } from 'node:crypto';
export function nowIso() {
    return new Date().toISOString();
}
export function id(prefix) {
    return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}
export function safeJson(value) {
    return JSON.parse(JSON.stringify(value === undefined ? null : value));
}
export function truncate(value, max = 12000) {
    if (value.length <= max)
        return value;
    return `${value.slice(0, max)}\n... [truncated ${value.length - max} chars]`;
}
export function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
