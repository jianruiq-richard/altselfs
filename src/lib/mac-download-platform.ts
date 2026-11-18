export type MacDownloadPlatform = 'darwin-arm64' | 'darwin-x64';

export function resolveMacDownloadPlatform(
  requested: string | null,
  clientHintArchitecture: string | null,
): MacDownloadPlatform {
  const choice = requested?.trim().toLowerCase();
  if (['x64', 'intel', 'darwin-x64'].includes(choice || '')) return 'darwin-x64';
  if (['arm64', 'apple-silicon', 'darwin-arm64'].includes(choice || '')) return 'darwin-arm64';

  const architecture = clientHintArchitecture?.replaceAll('"', '').trim().toLowerCase();
  if (['x86', 'x86_64', 'amd64'].includes(architecture || '')) return 'darwin-x64';
  if (['arm', 'arm64', 'aarch64'].includes(architecture || '')) return 'darwin-arm64';

  // Safari deliberately reports MacIntel on both Mac architectures. Preserve the
  // established Apple-silicon default and let the download page provide both
  // explicit choices instead of guessing from an ambiguous user agent.
  return 'darwin-arm64';
}
