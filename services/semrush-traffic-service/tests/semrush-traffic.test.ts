import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregatePaymentDestinations } from '../src/aggregate.js';
import {
  buildMonthlyQueryOrder,
  buildReportUrl,
  chooseUsableNodeText,
  isDestinationEmptyStateText,
  isDestinationLoadErrorText,
  isLikelySemrushRateLimitError,
  jitteredPacingDelayMs,
  parseHumanNumber,
  parseRenderedDestinationRow,
  parseTargetTrafficFromTooltip,
  singleMonthFromReportUrl,
} from '../src/browser-provider.js';
import { normalizeTargetDomain } from '../src/domains.js';
import { NoAvailableWorkersError, SemrushDispatcher } from '../src/dispatcher.js';
import { lastCompletedMonthStarts } from '../src/months.js';
import { parseSemrushDestinationsCsv } from '../src/semrush-api-provider.js';
import { normalizeQueryInput, queryPaymentDestinations } from '../src/service.js';
import { parseThreeUeSemrushDailyQuota } from '../src/quota.js';

test('dispatches only to online workers that still accept Semrush queries', async () => {
  let now = Date.parse('2026-09-10T00:00:00.000Z');
  const dispatcher = new SemrushDispatcher({
    heartbeatStaleMs: 90_000,
    jobTimeoutMs: 5_000,
    maxQueued: 3,
    now: () => now,
  });
  dispatcher.heartbeat({
    workerId: 'account-1', busy: false, acceptingQueries: false,
    quota: { status: 'exhausted', usedPercent: 100, remainingPercent: 0 },
  });
  dispatcher.heartbeat({
    workerId: 'account-2', busy: false, acceptingQueries: true,
    quota: { status: 'available', usedPercent: 10, remainingPercent: 90 },
  });

  const resultPromise = dispatcher.submit({ domain: 'tapnow.ai', month: '2026-08' });
  assert.equal(dispatcher.claim({ workerId: 'account-1', busy: false, acceptingQueries: false }), null);
  const claimed = dispatcher.claim({ workerId: 'account-2', busy: false, acceptingQueries: true });
  assert.ok(claimed);
  assert.deepEqual(claimed.request, { domain: 'tapnow.ai', month: '2026-08' });
  dispatcher.complete({
    worker: { workerId: 'account-2', busy: false, acceptingQueries: true },
    jobId: claimed.jobId,
    leaseToken: claimed.leaseToken,
    result: { status: 200, body: { data: { paymentOutboundVisits: 123 } } },
  });
  assert.deepEqual(await resultPromise, { status: 200, body: { data: { paymentOutboundVisits: 123 } } });

  now += 100_000;
  assert.throws(() => dispatcher.submit({ domain: 'example.com' }), NoAvailableWorkersError);
});

test('reassigns a quota-rejected job to a different worker without retrying the exhausted account', async () => {
  const dispatcher = new SemrushDispatcher({ heartbeatStaleMs: 90_000, jobTimeoutMs: 5_000, maxQueued: 3 });
  for (const workerId of ['account-1', 'account-2']) {
    dispatcher.heartbeat({ workerId, busy: false, acceptingQueries: true, quota: { status: 'available' } });
  }
  const resultPromise = dispatcher.submit({ domain: 'tapnow.ai', month: '2026-08' });
  const first = dispatcher.claim({ workerId: 'account-1', busy: false, acceptingQueries: true });
  assert.ok(first);
  const requeue = dispatcher.complete({
    worker: {
      workerId: 'account-1', busy: false, acceptingQueries: false,
      quota: { status: 'exhausted', usedPercent: 100, remainingPercent: 0 },
    },
    jobId: first.jobId,
    leaseToken: first.leaseToken,
    result: { status: 429, body: { code: 'DAILY_QUOTA_EXHAUSTED' } },
  });
  assert.deepEqual(requeue, { accepted: true, requeued: true });
  assert.equal(dispatcher.claim({ workerId: 'account-1', busy: false, acceptingQueries: false }), null);
  const second = dispatcher.claim({ workerId: 'account-2', busy: false, acceptingQueries: true });
  assert.ok(second);
  assert.equal(second.jobId, first.jobId);
  dispatcher.complete({
    worker: { workerId: 'account-2', busy: false, acceptingQueries: true },
    jobId: second.jobId,
    leaseToken: second.leaseToken,
    result: { status: 200, body: { ok: true } },
  });
  assert.deepEqual(await resultPromise, { status: 200, body: { ok: true } });
});

test('reads the active Semrush used quota and ignores an expired Similarweb card', () => {
  const quota = parseThreeUeSemrushDailyQuota([
    {
      text: 'API 今日配额 100% 节点1 BUSINESS 地区数据库 TW KR 打开',
      buttonTexts: ['节点1 BUSINESS 地区数据库 TW KR ✅', '中文', '打开'],
      progressText: '100%',
    },
    {
      text: 'API 今日配额 0% 节点1 PRO 全球版 续订',
      buttonTexts: ['节点1 PRO 全球版', '简体中文', '续订'],
      progressText: '0%',
    },
  ], 100, '2026-09-10T00:00:00.000Z');

  assert.deepEqual(quota, {
    status: 'exhausted',
    usedPercent: 100,
    remainingPercent: 0,
    acceptingQueries: false,
    observedAt: '2026-09-10T00:00:00.000Z',
    source: '3ue-dashboard',
    stopAtUsedPercent: 100,
  });
});

test('keeps a Semrush worker available below its configured used-quota threshold', () => {
  const quota = parseThreeUeSemrushDailyQuota([{
    text: 'API 今日配额 37.5%',
    buttonTexts: ['节点12 GURU 地区数据库 MY TW ✅', '中文', '打开'],
    progressText: '37.5%',
  }], 100, '2026-09-10T00:00:00.000Z');

  assert.equal(quota?.status, 'available');
  assert.equal(quota?.usedPercent, 37.5);
  assert.equal(quota?.remainingPercent, 62.5);
  assert.equal(quota?.acceptingQueries, true);
});

test('lastCompletedMonthStarts excludes the current partial month', () => {
  assert.deepEqual(
    lastCompletedMonthStarts(new Date('2026-08-30T12:00:00Z'), 3),
    ['2026-05-01', '2026-06-01', '2026-07-01'],
  );
  assert.deepEqual(
    lastCompletedMonthStarts(new Date('2026-08-30T12:00:00Z'), 6),
    ['2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01'],
  );
});

test('returns monthly values and rolling six, three, and one month totals', () => {
  const displayDates = ['2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01'];
  const result = aggregatePaymentDestinations(
    { domain: 'tapnow.ai', months: 6 },
    displayDates,
    {
      provider: 'semrush-browser-ui',
      granularity: 'month',
      warnings: [],
      observations: displayDates.map((displayDate, index) => ({
        displayDate,
        destination: 'alipay.com',
        traffic: (index + 1) * 100,
        trafficShare: null,
        categories: ['Payments'],
      })),
    },
  );
  assert.deepEqual(result.data.monthly.map((month) => month.paymentOutboundVisits), [100, 200, 300, 400, 500, 600]);
  assert.equal(result.data.last6MonthsPaymentOutboundVisits, 2_100);
  assert.equal(result.data.last3MonthsPaymentOutboundVisits, 1_500);
  assert.equal(result.data.last1MonthPaymentOutboundVisits, 600);
});

test('returns successful zero totals when all six monthly destination tables are empty', () => {
  const displayDates = ['2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01'];
  const result = aggregatePaymentDestinations(
    { domain: 'az8.art', months: 6 },
    displayDates,
    {
      provider: 'semrush-browser-ui',
      granularity: 'month',
      warnings: ['All requested monthly destination tables returned an explicit empty state.'],
      observations: [],
    },
  );
  assert.deepEqual(result.data.monthly?.map((month) => month.paymentOutboundVisits), [0, 0, 0, 0, 0, 0]);
  assert.equal(result.data.last6MonthsPaymentOutboundVisits, 0);
  assert.equal(result.data.last3MonthsPaymentOutboundVisits, 0);
  assert.equal(result.data.last1MonthPaymentOutboundVisits, 0);
});

test('recognizes Semrush explicit empty states and starts monthly scans from the latest month', () => {
  assert.equal(isDestinationEmptyStateText('Nothing found\nTry changing your filters.'), true);
  assert.equal(isDestinationEmptyStateText('暂无数据'), true);
  assert.equal(isDestinationEmptyStateText('stripe.com Payments 123'), false);
  assert.deepEqual(
    buildMonthlyQueryOrder(['2026-02-01', '2026-03-01', '2026-04-01']),
    ['2026-04-01', '2026-03-01', '2026-02-01'],
  );
});

test('recognizes transient destination load failures without treating them as empty data', () => {
  assert.equal(isDestinationLoadErrorText('Something went wrong'), true);
  assert.equal(isDestinationLoadErrorText('Something went wrong. Please try again.'), true);
  assert.equal(isDestinationLoadErrorText('加载失败，请重试'), true);
  assert.equal(isDestinationLoadErrorText('No data'), false);
});

test('adds bounded pacing jitter and recognizes errors that require a longer cooldown', () => {
  assert.equal(jitteredPacingDelayMs(1_000, 0), 800);
  assert.equal(jitteredPacingDelayMs(1_000, 0.5), 1_000);
  assert.equal(jitteredPacingDelayMs(1_000, 1), 1_200);
  assert.equal(jitteredPacingDelayMs(0, 0.5), 0);
  assert.equal(isLikelySemrushRateLimitError(new Error('Something went wrong. Please try again.')), true);
  assert.equal(isLikelySemrushRateLimitError('网页监控提示：操作频率过快，请稍后重试'), true);
  assert.equal(isLikelySemrushRateLimitError(new Error('Destination table did not refresh')), false);
  assert.equal(isLikelySemrushRateLimitError(new Error('Semrush month 2026-08-01 is unavailable')), false);
});

test('marks failed monthly coverage unavailable instead of zero while retaining older months', () => {
  const displayDates = ['2026-06-01', '2026-07-01', '2026-08-01'];
  const result = aggregatePaymentDestinations(
    { domain: 'tapnow.ai', months: 3 },
    displayDates,
    {
      provider: 'semrush-browser-ui',
      granularity: 'month',
      warnings: ['2026-08-01 failed and was skipped.'],
      failedDisplayDates: ['2026-08-01'],
      observations: [
        { displayDate: '2026-06-01', destination: 'stripe.com', traffic: 100, trafficShare: null, categories: ['Payments'] },
      ],
    },
  );

  assert.deepEqual(result.data.monthly.map((month) => month.paymentOutboundVisits), [100, 0, null]);
  assert.deepEqual(result.data.monthly.map((month) => month.status), ['available', 'available', 'failed']);
  assert.equal(result.data.paymentOutboundVisits, null);
  assert.equal(result.data.successfulMonthsPaymentOutboundVisits, 100);
  assert.equal(result.data.averageMonthlyPaymentOutboundVisits, null);
  assert.equal(result.data.last3MonthsPaymentOutboundVisits, null);
  assert.equal(result.data.last1MonthPaymentOutboundVisits, null);
  assert.deepEqual(result.data.coverage, {
    complete: false,
    requestedMonths: displayDates,
    successfulMonths: ['2026-06-01', '2026-07-01'],
    failedMonths: ['2026-08-01'],
  });
});

test('normalizes a caller URL into a Semrush target domain', () => {
  assert.equal(normalizeTargetDomain('https://www.TapNow.ai/path?q=1'), 'tapnow.ai');
});

test('allows one-month diagnostic range queries without changing the normal tool contract', () => {
  assert.deepEqual(normalizeQueryInput({ domain: 'tapnow.ai', months: 1, rangeMode: true }), {
    domain: 'tapnow.ai',
    months: 1,
    rangeMode: true,
    country: undefined,
    paymentDomains: undefined,
  });
  assert.throws(
    () => normalizeQueryInput({ domain: 'tapnow.ai', months: 1 }),
    /months must be either 3 or 6/,
  );
});

test('normalizes an exact calendar month without diagnostic range mode', () => {
  assert.deepEqual(normalizeQueryInput({ domain: 'tapnow.ai', month: '2026-05' }), {
    domain: 'tapnow.ai',
    months: 1,
    month: '2026-05',
    rangeMode: false,
    country: undefined,
    paymentDomains: undefined,
  });
  assert.throws(
    () => normalizeQueryInput({ domain: 'tapnow.ai', month: '2026-13' }),
    /month must use YYYY-MM format/,
  );
  assert.throws(
    () => normalizeQueryInput({ domain: 'tapnow.ai', month: '2026-05', months: 6 }),
    /month cannot be combined with months/,
  );
  assert.throws(
    () => normalizeQueryInput({ domain: 'tapnow.ai', month: '2026-05', rangeMode: true }),
    /month cannot be combined with diagnostic range mode/,
  );
});

test('queries and aggregates only the explicitly requested calendar month', async () => {
  let receivedDisplayDates: string[] = [];
  let receivedMonth: string | undefined;
  const result = await queryPaymentDestinations({
    async query(input, displayDates) {
      receivedMonth = input.month;
      receivedDisplayDates = displayDates;
      return {
        provider: 'semrush-browser-ui' as const,
        granularity: 'month' as const,
        warnings: [],
        observations: [{
          displayDate: displayDates[0],
          destination: 'stripe.com',
          traffic: 1_234,
          trafficShare: null,
          categories: ['Payments'],
        }],
      };
    },
  }, { domain: 'tapnow.ai', month: '2026-05' });

  assert.equal(receivedMonth, '2026-05');
  assert.deepEqual(receivedDisplayDates, ['2026-05-01']);
  assert.equal(result.input.month, '2026-05');
  assert.equal(result.data.paymentOutboundVisits, 1_234);
  assert.deepEqual(result.data.monthly?.map((entry) => entry.displayDate), ['2026-05-01']);
  assert.equal(result.data.last6MonthsPaymentOutboundVisits, null);
  assert.equal(result.data.last3MonthsPaymentOutboundVisits, null);
  assert.equal(result.data.last1MonthPaymentOutboundVisits, null);
  assert.equal(result.definition.currentMonthExcluded, false);
});

test('parses Semrush Traffic Destinations CSV', () => {
  const rows = parseSemrushDestinationsCsv([
    'target;display_date;country;device_type;to_target;traffic_share;traffic;categories',
    'tapnow.ai;2026-07-01;GLOBAL;desktop;checkout.stripe.com;0.021;1234;Financial Services > Payments',
    'tapnow.ai;2026-07-01;GLOBAL;desktop;paypal.com;0.01;500;Financial Services > Payments',
  ].join('\n'));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    displayDate: '2026-07-01',
    destination: 'checkout.stripe.com',
    traffic: 1234,
    trafficShare: 0.021,
    categories: ['Financial Services', 'Payments'],
  });
});

test('aggregates payment domains across three completed months', () => {
  const result = aggregatePaymentDestinations(
    { domain: 'tapnow.ai', months: 3 },
    ['2026-05-01', '2026-06-01', '2026-07-01'],
    {
      provider: 'semrush-trends-api',
      granularity: 'month',
      warnings: [],
      observations: [
        { displayDate: '2026-05-01', destination: 'checkout.stripe.com', traffic: 100, trafficShare: 0.01, categories: ['Payments'] },
        { displayDate: '2026-06-01', destination: 'paypal.com', traffic: 220, trafficShare: 0.02, categories: ['Payments'] },
        { displayDate: '2026-07-01', destination: 'google.com', traffic: 9999, trafficShare: 0.4, categories: ['Search'] },
        { displayDate: '2026-07-01', destination: 'checkout.stripe.com', traffic: 300, trafficShare: 0.03, categories: ['Payments'] },
      ],
    },
  );
  assert.equal(result.data.paymentOutboundVisits, 620);
  assert.equal(result.data.paymentDestinations.length, 2);
  assert.deepEqual(result.data.monthly.map((month) => month.paymentOutboundVisits), [100, 220, 300]);
});

test('does not fabricate monthly rows from a range-total browser table', () => {
  const result = aggregatePaymentDestinations(
    { domain: 'tapnow.ai', months: 3 },
    ['2026-05-01', '2026-06-01', '2026-07-01'],
    {
      provider: 'semrush-browser-ui',
      granularity: 'range',
      warnings: [],
      observations: [
        { displayDate: '2026-05-01..2026-07-01', destination: 'paypal.com', traffic: 600, trafficShare: 0.02, categories: ['Payments'] },
      ],
    },
  );
  assert.equal(result.data.paymentOutboundVisits, 600);
  assert.equal(result.data.averageMonthlyPaymentOutboundVisits, 200);
  assert.equal(result.data.monthly, null);
  assert.deepEqual(result.data.paymentDestinations[0]?.observedMonths, [
    '2026-05-01',
    '2026-06-01',
    '2026-07-01',
  ]);
});

test('parses rendered table row fallbacks', () => {
  assert.equal(parseHumanNumber('1.2M'), 1_200_000);
  assert.equal(parseHumanNumber('1.5万'), 15_000);
  assert.equal(parseTargetTrafficFromTooltip(['100%', '1.5万', '0%', '0'], 1), 0);
  assert.deepEqual(parseRenderedDestinationRow('checkout.stripe.com Category: Payments 1.2K 2.5%'), {
    destination: 'checkout.stripe.com',
    traffic: 1200,
    trafficShare: 0.025,
    categories: ['Payments'],
  });
  assert.equal(
    parseRenderedDestinationRow('alipayplus.com Category: Payments 5.37% 1.6万')?.traffic,
    16_000,
  );
});

test('buildReportUrl applies the inclusive three-month range without dropping list id', () => {
  const url = new URL(buildReportUrl(
    'https://sem.3ue.com/analytics/traffic/sources-destinations?lid=987654&__gmitm=expired',
    ['2026-05-01', '2026-06-01', '2026-07-01'],
  ));
  assert.equal(url.searchParams.get('lid'), '987654');
  assert.equal(url.searchParams.has('__gmitm'), false);
  assert.equal(url.searchParams.get('dateRange'), '2026-05-01,2026-07-01');
});

test('recognizes both Semrush single-month URL encodings', () => {
  assert.equal(singleMonthFromReportUrl(
    'https://sem.3ue.com/analytics/traffic/sources-destinations?dateRange=2026-07-01',
  ), '2026-07-01');
  assert.equal(singleMonthFromReportUrl(
    'https://sem.3ue.com/analytics/traffic/sources-destinations?dateRange=2026-07-01%2C2026-07-01',
  ), '2026-07-01');
  assert.equal(singleMonthFromReportUrl(
    'https://sem.3ue.com/analytics/traffic/sources-destinations?dateRange=2026-05-01%2C2026-07-01',
  ), null);
});

test('chooses an available Semrush node that matches the current plan and region when possible', () => {
  assert.equal(chooseUsableNodeText(
    '节点19 倍率 X 1 GURU 地区数据库 VN ZA ❌',
    [
      '节点1 倍率 X 1.5 BUSINESS 地区数据库 TW KR ✅',
      '节点4 倍率 X 1 GURU 地区数据库 NO MY ✅',
      '节点10 倍率 X 1 GURU 地区数据库 ID VN ✅',
      '节点16 倍率 X 1 GURU 地区数据库 AE ZA ✅',
    ],
  ), '节点10 倍率 X 1 GURU 地区数据库 ID VN ✅');
});
