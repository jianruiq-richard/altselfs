export type ArtifactDeliveryMode = 'preview' | 'download';

export function isHtmlArtifact(name: string, mimeType?: string | null) {
  const normalizedType = mimeType?.trim().toLowerCase() || '';
  const lowerName = name.trim().toLowerCase();
  return normalizedType.startsWith('text/html') || lowerName.endsWith('.html') || lowerName.endsWith('.htm');
}

export function artifactDeliveryPath(path: string, mode: ArtifactDeliveryMode) {
  if (!path.startsWith('/api/investor/artifacts/download/')) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}mode=${mode}`;
}

export function artifactContentDisposition(mode: ArtifactDeliveryMode, name: string) {
  const fallbackName = name
    .replace(/[\r\n"\\/]+/g, '_')
    .trim() || 'report.html';
  const asciiName = fallbackName.replace(/[^\x20-\x7E]/g, '_');
  const encodedName = encodeURIComponent(fallbackName).replace(/['()*]/g, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ));
  return `${mode === 'preview' ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}

export const GENERATED_HTML_PREVIEW_CSP = [
  "sandbox allow-scripts allow-popups",
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
  "style-src 'unsafe-inline'",
  "img-src data: blob: https:",
  "font-src data: https:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');
