export const PRICING_SEMANTIC_REVIEW_VERSION = 'pricing-semantic-review-v1';

const PLAN_NAMES = '(?:free|personal|hobby|starter|standard|basic|plus|premium|pro|professional|growth|creator|team|business|enterprise|unlimited|individual|solo|launch|scale|advanced|essentials?|ultimate|core|flex)';
const RECURRING_INTERVALS = new Set(['month', 'year', 'per_seat_month', 'per_seat_year']);

function normalizedText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function priceWindow(point, beforeLength = 95, afterLength = 115) {
  const context = normalizedText(point?.context);
  const rawPrice = normalizedText(point?.rawPrice);
  const index = rawPrice ? context.indexOf(rawPrice) : -1;
  if (index < 0) return context;
  return context.slice(Math.max(0, index - beforeLength), Math.min(context.length, index + rawPrice.length + afterLength));
}

function priceSides(point, context = normalizedText(point?.context)) {
  const rawPrice = normalizedText(point?.rawPrice);
  const index = rawPrice ? context.indexOf(rawPrice) : -1;
  return {
    before: index >= 0 ? context.slice(0, index) : context,
    after: index >= 0 ? context.slice(index + rawPrice.length) : '',
  };
}

function effectiveBillingInterval(point, localContext) {
  const { after } = priceSides(point, localContext);
  if (/^\s*(?:once\b|one[- ]time\b|single payment\b)/i.test(after)) return 'one_time';
  if (/^\s*(?:\/\s*|per\s+|a\s+)(?:year|yr|annum)\b|^\s*billed\s+(?:yearly|annually)\b/i.test(after)) {
    return String(point?.billingInterval || '').startsWith('per_seat') ? 'per_seat_year' : 'year';
  }
  if (/^\s*(?:\/\s*|per\s+|a\s+)(?:month|mo)\b|^\s*billed\s+monthly\b/i.test(after)) {
    return String(point?.billingInterval || '').startsWith('per_seat') ? 'per_seat_month' : 'month';
  }
  return point?.billingInterval || 'unspecified';
}

function normalizedMonthlyAmount(amount, interval) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  if (interval === 'year' || interval === 'per_seat_year') return Number((value / 12).toFixed(4));
  if (interval === 'month' || interval === 'per_seat_month') return value;
  return null;
}

function hasDirectPlanStatement(point, localContext) {
  const rawPrice = normalizedText(point?.rawPrice);
  const index = rawPrice ? localContext.indexOf(rawPrice) : -1;
  const before = index >= 0 ? localContext.slice(Math.max(0, index - 80), index) : localContext;
  const namedPlanBeforePrice = new RegExp(`\\b(?:the\\s+)?${PLAN_NAMES}(?:\\s+(?:plan|tier|package))?\\s*(?:is|costs?|starts?(?:\\s+at)?|from|[:·–—-])?\\s*$`, 'i');
  const explicitStartPrice = /\b(?:plans?|pricing|subscriptions?)\s+(?:start|starts|starting)\s+(?:at|from)\s*$/i;
  return namedPlanBeforePrice.test(before)
    || explicitStartPrice.test(before);
}

function hasDirectCommercialStatement(point, localContext) {
  const { before, after } = priceSides(point, localContext);
  const labelledPrice = /\b(?:from|starting\s+(?:at|from)|starts?\s+(?:at|from)|cost(?:\s+per\s+(?:month|year))?|price(?:\s+per\s+(?:month|year))?|monthly\s+(?:price|fee)|annual\s+(?:price|fee)|flat\s+(?:monthly\s+)?fee|monthly\s+recurring\s+fee)\s*[:·–—-]?\s*$/i.test(before);
  const explicitInterval = /^\s*(?:\/\s*|per\s+|a\s+)(?:month|mo|year|yr|annum)\b/i.test(after);
  const commercialCta = /\b(?:choose (?:a )?plan|select plan|get started|subscribe|buy now|start (?:a )?(?:trial|plan)|request (?:a )?demo|book (?:a )?demo|talk to sales|contact sales|everything in)\b/i.test(localContext);
  const namedPlanNearby = new RegExp(`\\b${PLAN_NAMES}\\b`, 'i').test(before.slice(-100));
  return labelledPrice || (explicitInterval && commercialCta && namedPlanNearby);
}

function rejectionReasons(point, localContext) {
  const reasons = [];
  const role = String(point?.role || '');
  if (role === 'comparison') reasons.push('comparison-price');
  if (role === 'credit_or_allowance') reasons.push('credit-or-allowance');
  if (role === 'trial') reasons.push('trial-credit');
  if (!Number.isFinite(Number(point?.amount)) || Number(point.amount) <= 0) reasons.push('non-positive-or-invalid-price');

  const patterns = [
    ['revenue-calculator-or-scenario', /\b(?:revenue calculator|live scenario|model your|projected (?:mrr|arr|revenue)|your monthly margin|annual run[- ]rate|revenue per client|active clients|retainer per client|your actual numbers will vary)\b/i],
    ['customer-resale-price', /\b(?:your client invoices?|agency invoices? each client|you price your clients?|what you charge(?: your client)?|market supports|retail \(what you charge|client plan status mrr|margin you keep)\b/i],
    ['reported-or-demo-business-metric', /\b(?:your agency live|subaccounts live|revenue attributed|total margin this month|billed to agencies through|clients? .{0,30}(?:active|mrr))\b/i],
    ['markup-or-setup-example', /\b(?:token markup|mcp markup|setup fees?|stacked revenue|subscription plus usage markup)\b/i],
    ['modelled-business-value', /\b(?:illustrative|hypothetical|planning model|modeled lift|business case|annual savings|monthly savings|saved per (?:month|year)|wasted acquisition|what you pay today|already paying|what you actually pay|real monthly cost|average contract value|current win rate|annual direct costs|monthly money out|average balance)\b/i],
    ['competitor-or-alternative-price', /\b(?:traditional [a-z]+|in-house (?:team|stack)|competitors?|alternatives?|vendr|consultant(?:s| hour)?|what you are already paying vendors|reported annual cost|next to what each of these charges|pricing compares)\b/i],
    ['allowance-threshold-or-volume-example', /\b(?:monthly volume|average order value|annual revenue threshold|revenue or funding|total finances|warranty on qualifying|aggregate in any rolling|list price inference|earn(?:s)? .*? back on all sales|up to \$[\d,]+ usd|ad spend|our best rates|corridors? and volume|negotiated rates built around.{0,40}volume)\b/i],
    ['live-or-accounting-metric', /\b(?:live mrr|monthly recurring revenue|active subscriptions|usage events today|invoices pending|accrued this month|invoice · matched)\b/i],
    ['roi-or-cost-example', /\b(?:estimated cost|costing \$|cost per employee|paid to people|comes back when|lost opportunity cost|full-service agency replacement|agency retainer|at [\d,]+ minutes)\b/i],
    ['demo-dashboard-or-example-record', /\b(?:sales overview|monthly sales by|top revenue accounts|recent upgrades|supplier comparison|suppliers?|proposals? scored|performance at a glance|metric this month last month|current contract|due this year|auto renews|annual loss|turnover reduction|productivity boost|spending .*? this month|build me a dashboard for revenue|alderpoint|harborline|driftmark|sablewood|cloudbridge erp|aptive solutions|vellora systems|401\(k\)|(?:lead )?time:\s*\d+\s*weeks?)\b/i],
    ['market-category-price', /\bmost (?:enterprise |business |consumer )?.{0,45}pricing starts at\b/i],
  ];
  for (const [reason, pattern] of patterns) {
    if (pattern.test(localContext)) reasons.push(reason);
  }
  return [...new Set(reasons)];
}

export function reviewPricePoint(point) {
  const context = normalizedText(point?.context);
  const localContext = priceWindow(point);
  const directPlanStatement = hasDirectPlanStatement(point, localContext);
  const directCommercialStatement = hasDirectCommercialStatement(point, localContext);
  const reasons = rejectionReasons(point, localContext);
  const pricingPage = /\b(?:pricing|plans?|billing|subscriptions?|upgrade)\b/i.test(String(point?.evidenceUrl || ''));
  const passThroughOrCost = /\b(?:pass[- ]through|vendor cost|avg\.? usage per client|usage per client|llm tokens?|whatsapp session fees?)\b/i.test(localContext);
  const { before, after } = priceSides(point, localContext);
  const addOnOrSupport = /\b(?:support|add[- ]on|additional (?:workstream|seat|concurrency)|overage|storage|egress)\s*(?:fee|price|cost)?\s*[:·–—-]?\s*$/i.test(before)
    || /^\s*(?:\/\s*(?:mo|month)|per\s+month)\s+(?:support|add[- ]on|overage)\b/i.test(after);
  const interval = effectiveBillingInterval(point, localContext);
  const recurring = RECURRING_INTERVALS.has(interval);
  const oneTime = interval === 'one_time';
  const usageRate = point?.role === 'usage_rate';
  const actualUsageUnit = /\b(?:per|\/)(?:\s+\d+(?:,\d+)*)?\s*(?:token|credit|request|api call|minute|gb|character|image|generation|seat|user)s?\b/i.test(localContext);

  if (reasons.length > 0) {
    return {
      status: 'rejected',
      confidence: 'high',
      reasons,
      directPlanStatement,
      directCommercialStatement,
      normalizedBillingInterval: interval,
    };
  }

  if (addOnOrSupport) {
    return {
      status: 'rejected',
      confidence: 'high',
      reasons: ['add-on-or-support-price'],
      directPlanStatement,
      directCommercialStatement,
      normalizedBillingInterval: interval,
    };
  }

  if (directPlanStatement && (recurring || oneTime)) {
    return {
      status: 'accepted',
      confidence: 'high',
      reasons: ['direct-plan-price'],
      directPlanStatement: true,
      directCommercialStatement,
      normalizedBillingInterval: interval,
    };
  }

  if (passThroughOrCost) {
    return {
      status: 'rejected',
      confidence: 'high',
      reasons: ['pass-through-or-vendor-cost'],
      directPlanStatement,
      directCommercialStatement,
      normalizedBillingInterval: interval,
    };
  }

  if (directCommercialStatement && (recurring || oneTime)) {
    return {
      status: 'accepted',
      confidence: 'high',
      reasons: ['direct-commercial-price'],
      directPlanStatement: false,
      directCommercialStatement,
      normalizedBillingInterval: interval,
    };
  }

  if (usageRate) {
    return actualUsageUnit
      ? { status: 'accepted', confidence: 'medium', reasons: ['explicit-usage-rate'], directPlanStatement: false, directCommercialStatement, normalizedBillingInterval: interval }
      : { status: 'needs_review', confidence: 'low', reasons: ['ambiguous-usage-amount'], directPlanStatement: false, directCommercialStatement, normalizedBillingInterval: interval };
  }

  if (point?.role === 'list_price' && pricingPage && (recurring || oneTime)) {
    return {
      status: 'needs_review',
      confidence: 'low',
      reasons: ['pricing-page-amount-without-direct-plan-evidence'],
      directPlanStatement: false,
      directCommercialStatement: false,
      normalizedBillingInterval: interval,
    };
  }

  return {
    status: 'needs_review',
    confidence: 'low',
    reasons: [context ? 'insufficient-plan-context' : 'missing-price-context'],
    directPlanStatement: false,
    directCommercialStatement: false,
    normalizedBillingInterval: interval,
  };
}

export function reviewPricePoints(pricePoints) {
  const points = Array.isArray(pricePoints) ? pricePoints : [];
  const decisions = points.map((point, index) => ({ index, ...reviewPricePoint(point) }));
  const acceptedPricePoints = decisions
    .filter((decision) => decision.status === 'accepted')
    .map((decision) => ({
      ...points[decision.index],
      billingInterval: decision.normalizedBillingInterval,
      normalizedMonthlyAmount: normalizedMonthlyAmount(points[decision.index]?.amount, decision.normalizedBillingInterval),
      semanticReview: decision,
    }));
  const reasonCounts = {};
  for (const decision of decisions) {
    for (const reason of decision.reasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }
  return {
    version: PRICING_SEMANTIC_REVIEW_VERSION,
    acceptedPricePoints,
    decisions,
    counts: {
      total: points.length,
      accepted: decisions.filter((decision) => decision.status === 'accepted').length,
      rejected: decisions.filter((decision) => decision.status === 'rejected').length,
      needsReview: decisions.filter((decision) => decision.status === 'needs_review').length,
    },
    reasonCounts,
  };
}
