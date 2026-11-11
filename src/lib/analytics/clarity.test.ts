import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { clarityInitialization, clarityScriptTag } from './clarity';

for (const [choice, analytics, ads] of [['denied','denied','denied'], ['analytics','granted','denied'], ['all','granted','granted']]) {
  test(`Clarity respects stored ${choice} preference before loading and initializes once`, () => {
    const inserted: {src?: string}[] = [];
    const window: any = {};
    const context = vm.createContext({window, localStorage: {getItem: () => choice}, document: {
      createElement: () => ({}), getElementsByTagName: () => [{parentNode: {insertBefore: (s: {}) => inserted.push(s)}}],
    }});
    vm.runInContext(clarityInitialization('abc123'), context);
    vm.runInContext(clarityInitialization('abc123'), context);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].src, 'https://www.clarity.ms/tag/abc123');
    const consent = window.clarity.q[0];
    assert.equal(consent[0], 'consentv2');
    assert.equal(consent[1].analytics_Storage, analytics);
    assert.equal(consent[1].ad_Storage, ads);
  });
}
test('invalid or absent project IDs cannot inject markup or initialize', () => {
  for (const id of [undefined, '', '</script><script>alert(1)</script>', "abc123'", 'abc']) assert.equal(clarityScriptTag(id), '');
});
