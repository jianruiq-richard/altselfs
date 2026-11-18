import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMacDownloadPlatform } from './mac-download-platform';

test('an explicit Mac architecture wins over browser hints', () => {
  assert.equal(resolveMacDownloadPlatform('intel', 'arm'), 'darwin-x64');
  assert.equal(resolveMacDownloadPlatform('apple-silicon', 'x86'), 'darwin-arm64');
});

test('Chromium architecture hints select the matching Mac installer', () => {
  assert.equal(resolveMacDownloadPlatform(null, '"x86"'), 'darwin-x64');
  assert.equal(resolveMacDownloadPlatform(null, '"arm"'), 'darwin-arm64');
});

test('ambiguous browsers retain the established Apple-silicon default', () => {
  assert.equal(resolveMacDownloadPlatform(null, null), 'darwin-arm64');
});
