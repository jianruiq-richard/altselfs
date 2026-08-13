import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCodexProvider, resolveCodexModelSelection } from '../src/codex/model-provider.js';

test('explicit APIYi provider overrides the native gpt-5.5 OpenAI default', () => {
  assert.deepEqual(resolveCodexModelSelection('gpt-5.5', 'apiyi'), {
    model: 'gpt-5.5',
    provider: 'apiyi',
  });
});

test('OpenAI remains the native default and can be selected explicitly', () => {
  assert.deepEqual(resolveCodexModelSelection('gpt-5.5'), {
    model: 'gpt-5.5',
    provider: 'openai',
  });
  assert.deepEqual(resolveCodexModelSelection('gpt-5.5', 'openai'), {
    model: 'gpt-5.5',
    provider: 'openai',
  });
});

test('provider names are normalized and unknown providers are rejected', () => {
  assert.equal(normalizeCodexProvider(' APIYi '), 'apiyi');
  assert.equal(normalizeCodexProvider('unknown'), undefined);
});
