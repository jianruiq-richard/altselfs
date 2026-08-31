import { domainMatchesRoot, normalizeTargetDomain } from './domains.js';

const DEFAULT_PAYMENT_PLATFORMS: Record<string, string> = {
  '2checkout.com': '2Checkout',
  'adyen.com': 'Adyen',
  'affirm.com': 'Affirm',
  'afterpay.com': 'Afterpay',
  'airwallex.com': 'Airwallex',
  'alipay.com': 'Alipay',
  'alipayplus.com': 'Alipay+',
  'authorize.net': 'Authorize.net',
  'braintreegateway.com': 'Braintree',
  'checkout.com': 'Checkout.com',
  'dlocal.com': 'dLocal',
  'fastspring.com': 'FastSpring',
  'klarna.com': 'Klarna',
  'lemonsqueezy.com': 'Lemon Squeezy',
  'paddle.com': 'Paddle',
  'paypal.com': 'PayPal',
  'payoneer.com': 'Payoneer',
  'payu.com': 'PayU',
  'razorpay.com': 'Razorpay',
  'squareup.com': 'Square',
  'stripe.com': 'Stripe',
  'verifone.com': 'Verifone',
  'worldpay.com': 'Worldpay',
  'xsolla.com': 'Xsolla'
};

export type PaymentPlatformMatch = {
  rootDomain: string;
  platform: string;
  matchedBy: 'domain-registry' | 'caller-domain';
};

export function buildPaymentPlatformRegistry(customDomains?: string[]) {
  const entries: PaymentPlatformMatch[] = Object.entries(DEFAULT_PAYMENT_PLATFORMS).map(([rootDomain, platform]) => ({
    rootDomain,
    platform,
    matchedBy: 'domain-registry' as const,
  }));
  for (const value of customDomains || []) {
    const rootDomain = normalizeTargetDomain(value);
    if (entries.some((entry) => entry.rootDomain === rootDomain)) continue;
    entries.push({ rootDomain, platform: rootDomain, matchedBy: 'caller-domain' });
  }
  return entries;
}

export function matchPaymentPlatform(
  destination: string,
  registry: ReturnType<typeof buildPaymentPlatformRegistry>,
): PaymentPlatformMatch | null {
  const normalized = normalizeTargetDomain(destination);
  return registry.find((entry) => domainMatchesRoot(normalized, entry.rootDomain)) || null;
}
