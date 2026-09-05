import { buildPaymentPlatformRegistry, matchPaymentPlatform } from './payment-platforms.js';
import type { DestinationProviderResult, QueryInput } from './types.js';

export function aggregatePaymentDestinations(
  input: QueryInput,
  displayDates: string[],
  providerResult: DestinationProviderResult,
) {
  const registry = buildPaymentPlatformRegistry(input.paymentDomains);
  const failedDisplayDates = new Set(
    providerResult.granularity === 'month'
      ? (providerResult.failedDisplayDates || []).filter((displayDate) => displayDates.includes(displayDate))
      : [],
  );
  const monthly = new Map(displayDates.map((displayDate) => [displayDate, {
    displayDate,
    paymentOutboundVisits: 0,
    matchedRows: 0,
  }]));
  const destinations = new Map<string, {
    destination: string;
    platform: string;
    matchedBy: string;
    visits: number;
    trafficShareSamples: number[];
    categories: Set<string>;
    months: Set<string>;
  }>();

  for (const observation of providerResult.observations) {
    let match;
    try {
      match = matchPaymentPlatform(observation.destination, registry);
    } catch {
      continue;
    }
    if (!match) continue;
    const month = providerResult.granularity === 'month'
      ? monthly.get(observation.displayDate)
      : undefined;
    if (month) {
      month.paymentOutboundVisits += observation.traffic;
      month.matchedRows += 1;
    }
    const aggregate = destinations.get(observation.destination) || {
      destination: observation.destination,
      platform: match.platform,
      matchedBy: match.matchedBy,
      visits: 0,
      trafficShareSamples: [],
      categories: new Set<string>(),
      months: new Set<string>(),
    };
    aggregate.visits += observation.traffic;
    if (observation.trafficShare !== null) aggregate.trafficShareSamples.push(observation.trafficShare);
    for (const category of observation.categories) aggregate.categories.add(category);
    if (providerResult.granularity === 'month') aggregate.months.add(observation.displayDate);
    destinations.set(observation.destination, aggregate);
  }

  const paymentDestinations = Array.from(destinations.values())
    .map((entry) => ({
      destination: entry.destination,
      platform: entry.platform,
      matchedBy: entry.matchedBy,
      visits: Math.round(entry.visits),
      averageReportedTrafficShare: entry.trafficShareSamples.length
        ? entry.trafficShareSamples.reduce((sum, value) => sum + value, 0) / entry.trafficShareSamples.length
        : null,
      categories: Array.from(entry.categories).sort(),
      observedMonths: providerResult.granularity === 'month'
        ? Array.from(entry.months).sort()
        : displayDates,
    }))
    .sort((a, b) => b.visits - a.visits);
  const observedPaymentOutboundVisits = paymentDestinations.reduce((sum, item) => sum + item.visits, 0);
  const monthlyValues = Array.from(monthly.values()).map((entry) => failedDisplayDates.has(entry.displayDate)
    ? {
      displayDate: entry.displayDate,
      paymentOutboundVisits: null,
      matchedRows: null,
      status: 'failed' as const,
    }
    : {
      ...entry,
      paymentOutboundVisits: Math.round(entry.paymentOutboundVisits),
      status: 'available' as const,
    });
  const monthlyWindowTotal = (count: number) => {
    const window = monthlyValues.slice(-count);
    return window.some((entry) => entry.paymentOutboundVisits === null)
      ? null
      : window.reduce((sum, entry) => sum + (entry.paymentOutboundVisits ?? 0), 0);
  };
  const successfulDisplayDates = displayDates.filter((displayDate) => !failedDisplayDates.has(displayDate));
  const hasPartialMonthlyCoverage = providerResult.granularity === 'month' && failedDisplayDates.size > 0;
  const periodTotals = input.month
    ? {
      last6MonthsPaymentOutboundVisits: null,
      last3MonthsPaymentOutboundVisits: null,
      last1MonthPaymentOutboundVisits: null,
    }
    : providerResult.granularity === 'month'
    ? {
      last6MonthsPaymentOutboundVisits: displayDates.length >= 6 ? monthlyWindowTotal(6) : null,
      last3MonthsPaymentOutboundVisits: monthlyWindowTotal(3),
      last1MonthPaymentOutboundVisits: monthlyWindowTotal(1),
    }
    : {
      last6MonthsPaymentOutboundVisits: null,
      last3MonthsPaymentOutboundVisits: input.months === 3 ? observedPaymentOutboundVisits : null,
      last1MonthPaymentOutboundVisits: null,
    };

  return {
    source: providerResult.provider,
    fetchedAt: new Date().toISOString(),
    input: {
      domain: input.domain,
      months: input.months,
      ...(input.month ? { month: input.month } : {}),
      country: input.country || 'GLOBAL',
      displayDates,
    },
    data: {
      paymentOutboundVisits: hasPartialMonthlyCoverage ? null : observedPaymentOutboundVisits,
      ...(hasPartialMonthlyCoverage ? { successfulMonthsPaymentOutboundVisits: observedPaymentOutboundVisits } : {}),
      averageMonthlyPaymentOutboundVisits: hasPartialMonthlyCoverage
        ? null
        : Math.round(observedPaymentOutboundVisits / displayDates.length),
      ...periodTotals,
      paymentDestinations,
      monthly: providerResult.granularity === 'month'
        ? monthlyValues
        : null,
      coverage: providerResult.granularity === 'month'
        ? {
          complete: failedDisplayDates.size === 0,
          requestedMonths: displayDates,
          successfulMonths: successfulDisplayDates,
          failedMonths: Array.from(failedDisplayDates),
        }
        : null,
    },
    confidence: providerResult.provider === 'semrush-trends-api' ? 'high' : 'medium',
    definition: {
      metric: providerResult.granularity === 'month'
        ? hasPartialMonthlyCoverage
          ? 'Partial sum of Semrush destination traffic for matched payment-platform domains across successfully queried completed months; failed months are unavailable, not zero.'
          : input.month
            ? `Semrush destination traffic for matched payment-platform domains during ${input.month}.`
            : 'Sum of Semrush destination traffic for matched payment-platform domains across the last completed months.'
        : 'Semrush destination traffic for matched payment-platform domains over the selected completed-month range.',
      granularity: providerResult.granularity,
      paymentDomainRoots: registry.map((entry) => entry.rootDomain),
      currentMonthExcluded: !input.month,
    },
    warnings: providerResult.warnings,
    ...(providerResult.diagnostics ? { diagnostics: providerResult.diagnostics } : {}),
  };
}
