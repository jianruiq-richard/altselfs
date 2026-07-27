import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStripeUpgradePortalFeatures } from '../src/stripe-billing.js';

test('Stripe plan upgrades require hosted confirmation for a new full billing period', () => {
  const features = buildStripeUpgradePortalFeatures([
    { productId: 'prod_membership', priceId: 'price_starter' },
    { productId: 'prod_membership', priceId: 'price_pro' },
    { productId: 'prod_ultra', priceId: 'price_ultra' },
  ]);

  assert.deepEqual(features.subscription_update, {
    enabled: true,
    default_allowed_updates: ['price'],
    products: [
      {
        product: 'prod_membership',
        prices: ['price_starter', 'price_pro'],
      },
      {
        product: 'prod_ultra',
        prices: ['price_ultra'],
      },
    ],
    billing_cycle_anchor: 'now',
    proration_behavior: 'none',
  });
  assert.equal(features.payment_method_update?.enabled, true);
});
