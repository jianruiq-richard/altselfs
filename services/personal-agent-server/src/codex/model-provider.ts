export type CodexModelProvider = 'openai' | 'openrouter' | 'apiyi';

export type CodexModelSelection = {
  model?: string;
  provider?: CodexModelProvider;
};

export function normalizeCodexProvider(provider?: string): CodexModelProvider | undefined {
  const value = provider?.trim().toLowerCase();
  if (value === 'openai' || value === 'openrouter' || value === 'apiyi') return value;
  return undefined;
}

export function resolveCodexModelSelection(model?: string, configuredProvider?: string): CodexModelSelection {
  const provider = normalizeCodexProvider(configuredProvider);
  if (provider) return { model, provider };
  if (model === 'gpt-5.5') return { model, provider: 'openai' };
  if (model === 'deepseek/deepseek-v3.2') return { model, provider: 'openrouter' };
  return {
    model,
    provider: model ? 'openrouter' : undefined,
  };
}
