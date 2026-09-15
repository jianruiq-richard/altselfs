import assert from 'node:assert/strict';
import test from 'node:test';

import { reviewPricePoints } from '../scripts/lib/pricing-semantic-review.mjs';

function point(amount: number, context: string, overrides: Record<string, unknown> = {}) {
  return {
    planName: null,
    amount,
    currency: 'USD',
    billingInterval: 'month',
    normalizedMonthlyAmount: amount,
    role: 'list_price',
    rawPrice: `$${amount.toLocaleString('en-US')}`,
    context,
    evidenceUrl: 'https://example.com/pricing',
    ...overrides,
  };
}

test('keeps real Lety plans and rejects agency revenue examples', () => {
  const review = reviewPricePoints([
    point(12_400, 'Your agency LIVE This month $12,400 /mo + $5,200 this month Clients Kalma Health'),
    point(16_400, 'Revenue calculator Model your agency MRR. Projected MRR $16,400 /mo Stacked revenue'),
    point(196_800, 'Token markup $900 Annual run-rate $196,800 Revenue per client / yr $19,680', { billingInterval: 'year', normalizedMonthlyAmount: 16_400 }),
    point(97, 'The Starter plan is $97/month with up to 2 client subaccounts', { planName: 'Starter' }),
    point(297, 'Starter is $97/month, Standard is $297/month with up to 10 client subaccounts'),
    point(497, 'Standard is $297/month, and Unlimited is $497/month with unlimited subaccounts'),
  ]);

  assert.deepEqual(review.acceptedPricePoints.map((item) => item.amount), [97, 297, 497]);
  assert.ok(review.acceptedPricePoints.every((item) => item.semanticReview.reasons.includes('direct-plan-price')));
  assert.equal(review.counts.accepted, 3);
  assert.equal(review.counts.rejected, 3);
});

test('accepts a conventional pricing-page list price', () => {
  const review = reviewPricePoints([
    point(29, 'Choose your plan Pro $29/month Billed monthly'),
  ]);
  assert.equal(review.acceptedPricePoints.length, 1);
  assert.equal(review.acceptedPricePoints[0].amount, 29);
});

test('keeps ambiguous pricing-page amounts out of ARPPU and fixes immediate one-time terms', () => {
  const review = reviewPricePoints([
    point(250_000, 'Average balance $200,000 Monthly money out $250,000 Who are you?'),
    point(49_999, 'Self-Hosted Enterprise $49,999 once Maximum scale', { billingInterval: 'month' }),
  ]);
  assert.equal(review.acceptedPricePoints.length, 1);
  assert.equal(review.acceptedPricePoints[0].billingInterval, 'one_time');
  assert.equal(review.acceptedPricePoints[0].normalizedMonthlyAmount, null);
});

test('rejects pass-through costs and comparison prices', () => {
  const review = reviewPricePoints([
    point(180, 'Pass-through usage LLM + WhatsApp at vendor cost $180 per month'),
    point(49, 'Compare our plan with competitor Pro $49/month', { role: 'comparison' }),
  ]);
  assert.equal(review.counts.accepted, 0);
  assert.equal(review.counts.rejected, 2);
});

test('rejects volume thresholds, supplier demos, dashboard rows, and cloud-cost examples', () => {
  const review = reviewPricePoints([
    point(250_000, 'Custom Let us talk From $250,000 a month. Our best rates live here. Negotiated rates built around corridors and volume'),
    point(48_000, 'Aptive Solutions 73 Price: $48,000/yr Lead time: 2 weeks', { billingInterval: 'year' }),
    point(21_000, 'Harborline Starter $24,500 +14% Driftmark Starter $21,000 -8% Build me a dashboard for revenue', { billingInterval: 'year' }),
    point(4_500, 'Compute $0.73 real monthly cost $4,500+/mo with crunr — invoice / your cloud — what you actually pay'),
  ]);

  assert.equal(review.counts.accepted, 0);
  assert.equal(review.counts.rejected, 4);
});
