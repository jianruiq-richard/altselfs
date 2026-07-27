import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStripeUpgradePortalFeatures } from '../src/stripe-billing.js';

test('Stripe plan upgrades isolate the target price in a hosted confirmation configuration', () => {
  const features = buildStripeUpgradePortalFeatures({
    productId: 'prod_membership',
    priceId: 'price_pro',
  });

  assert.deepEqual(features.subscription_update, {
    enabled: true,
    default_allowed_updates: ['price'],
    products: [
      {
        product: 'prod_membership',
        prices: ['price_pro'],
      },
    ],
    billing_cycle_anchor: 'now',
    proration_behavior: 'none',
  });
  assert.equal(features.payment_method_update?.enabled, true);
});

test('Stripe plans sharing one product and billing interval remain in separate configurations', () => {
  const starter = buildStripeUpgradePortalFeatures({
    productId: 'prod_membership',
    priceId: 'price_starter',
  });
  const pro = buildStripeUpgradePortalFeatures({
    productId: 'prod_membership',
    priceId: 'price_pro',
  });

  assert.deepEqual(starter.subscription_update?.products, [{
    product: 'prod_membership',
    prices: ['price_starter'],
  }]);
  assert.deepEqual(pro.subscription_update?.products, [{
    product: 'prod_membership',
    prices: ['price_pro'],
  }]);
});
