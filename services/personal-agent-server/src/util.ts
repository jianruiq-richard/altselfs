import { randomUUID } from 'node:crypto';

export function nowIso() {
  return new Date().toISOString();
}

export function id(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

export function safeJson(value: unknown) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value)) as Record<string, unknown>;
}

export function truncate(value: string, max = 12000) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n... [truncated ${value.length - max} chars]`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

