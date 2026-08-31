export type DestinationObservation = {
  displayDate: string;
  destination: string;
  traffic: number;
  trafficShare: number | null;
  categories: string[];
};

export type DestinationProviderResult = {
  provider: 'semrush-trends-api' | 'semrush-browser-ui';
  granularity: 'month' | 'range';
  observations: DestinationObservation[];
  warnings: string[];
  diagnostics?: Record<string, unknown>;
};

export type QueryInput = {
  domain: string;
  months: number;
  rangeMode?: boolean;
  country?: string;
  paymentDomains?: string[];
};

export type DestinationProvider = {
  query(input: QueryInput, displayDates: string[]): Promise<DestinationProviderResult>;
};
