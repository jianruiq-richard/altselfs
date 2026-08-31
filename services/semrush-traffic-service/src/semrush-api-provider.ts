import type {
  DestinationObservation,
  DestinationProvider,
  DestinationProviderResult,
  QueryInput,
} from './types.js';

type FetchLike = typeof fetch;

export class SemrushApiProvider implements DestinationProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly endpoint = 'https://api.semrush.com/analytics/ta/api/v3/destinations',
  ) {}

  async query(input: QueryInput, displayDates: string[]): Promise<DestinationProviderResult> {
    const observations: DestinationObservation[] = [];
    const warnings: string[] = [];
    for (const displayDate of displayDates) {
      const url = new URL(this.endpoint);
      url.searchParams.set('key', this.apiKey);
      url.searchParams.set('target', input.domain);
      url.searchParams.set('display_date', displayDate);
      url.searchParams.set('device_type', 'desktop');
      url.searchParams.set('display_limit', '1000');
      url.searchParams.set('display_offset', '0');
      url.searchParams.set('sort_order', 'traffic_desc');
      url.searchParams.set(
        'export_columns',
        'target,display_date,country,device_type,to_target,traffic_share,traffic,categories',
      );
      if (input.country) url.searchParams.set('country', input.country.toUpperCase());

      const response = await this.fetchImpl(url, {
        headers: { accept: 'text/csv,text/plain;q=0.9,*/*;q=0.1' },
        signal: AbortSignal.timeout(45_000),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Semrush Traffic Destinations returned HTTP ${response.status}: ${safeError(text)}`);
      }
      const rows = parseSemrushDestinationsCsv(text);
      if (rows.length >= 1000) {
        warnings.push(`${displayDate} returned 1000 rows; lower-ranked destinations may be truncated.`);
      }
      observations.push(...rows);
    }
    return { provider: 'semrush-trends-api', granularity: 'month', observations, warnings };
  }
}

export function parseSemrushDestinationsCsv(text: string): DestinationObservation[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (/^ERROR\s+/i.test(trimmed)) throw new Error(`Semrush API error: ${safeError(trimmed)}`);
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0], ';').map((value) => value.trim().toLowerCase());
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  for (const required of ['display_date', 'to_target', 'traffic']) {
    if (index[required] === undefined) throw new Error(`Semrush API response is missing ${required}`);
  }
  return lines.slice(1).flatMap((line) => {
    const columns = parseCsvLine(line, ';');
    const destination = columns[index.to_target]?.trim().toLowerCase();
    const traffic = Number(columns[index.traffic]);
    if (!destination || !Number.isFinite(traffic)) return [];
    const trafficShareRaw = index.traffic_share === undefined ? '' : columns[index.traffic_share];
    const trafficShare = trafficShareRaw === '' ? null : Number(trafficShareRaw);
    const categoryRaw = index.categories === undefined ? '' : columns[index.categories] || '';
    return [{
      displayDate: columns[index.display_date]?.trim() || '',
      destination,
      traffic,
      trafficShare: trafficShare !== null && Number.isFinite(trafficShare) ? trafficShare : null,
      categories: categoryRaw.split(/[|,>]/).map((value) => value.trim()).filter(Boolean),
    }];
  });
}

function parseCsvLine(line: string, delimiter: string) {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

function safeError(value: string) {
  return value.replace(/[\r\n]+/g, ' ').slice(0, 300);
}
