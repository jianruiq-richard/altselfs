export function publicBillingActivity(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.items)) return value;
  return {
    ...value,
    items: value.items.map((item) => {
      if (!isRecord(item) || !Array.isArray(item.components)) return item;
      return {
        ...item,
        pricingVersion: typeof item.pricingVersion === 'string' ? 'Recorded Minaco rate' : item.pricingVersion,
        components: item.components.map((component) =>
          isRecord(component) ? {
            ...component,
            provider: 'Minaco',
            ...(typeof component.version === 'string' ? { version: 'current' } : {}),
          } : component),
      };
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
