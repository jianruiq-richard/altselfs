import { domainToASCII } from 'node:url';

export function normalizeTargetDomain(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('domain is required');
  const raw = value.trim().toLowerCase();
  let hostname = raw;
  try {
    hostname = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname;
  } catch {
    throw new Error('domain must be a valid hostname');
  }
  const ascii = domainToASCII(hostname).replace(/^www\./, '').replace(/\.$/, '');
  if (!ascii || ascii.length > 253 || !ascii.includes('.')) throw new Error('domain must be a valid hostname');
  const labels = ascii.split('.');
  if (labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    throw new Error('domain must be a valid hostname');
  }
  return ascii;
}

export function domainMatchesRoot(domain: string, root: string) {
  return domain === root || domain.endsWith(`.${root}`);
}
