/** Only the authenticated Desktop API may supply the app-owned loopback callback. */
export function desktopCallback(value: unknown, cancelled = false): string {
  if (typeof value !== 'string') throw new Error('Invalid desktop callback.');
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
      !url.port || url.pathname !== '/callback' || url.username || url.password || url.hash ||
      (cancelled ? url.searchParams.get('error') !== 'access_denied' : !url.searchParams.get('code')) ||
      !url.searchParams.get('state')) throw new Error('Invalid desktop callback.');
  return url.toString();
}
