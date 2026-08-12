import assert from 'node:assert/strict';
import test from 'node:test';
import {
  artifactContentDisposition,
  artifactDeliveryPath,
  GENERATED_HTML_PREVIEW_CSP,
  isHtmlArtifact,
} from './artifact-delivery.js';

test('HTML artifacts are recognized even when old metadata says octet-stream', () => {
  assert.equal(isHtmlArtifact('report.html', 'application/octet-stream'), true);
  assert.equal(isHtmlArtifact('report.bin', 'text/html; charset=utf-8'), true);
  assert.equal(isHtmlArtifact('report.pdf', 'application/pdf'), false);
});

test('artifact delivery mode preserves existing query parameters', () => {
  assert.equal(
    artifactDeliveryPath('/api/investor/artifacts/download/art_1?threadId=thread_1', 'preview'),
    '/api/investor/artifacts/download/art_1?threadId=thread_1&mode=preview'
  );
  assert.equal(artifactDeliveryPath('https://example.com/report.html', 'preview'), 'https://example.com/report.html');
});

test('content disposition is safe and distinguishes preview from download', () => {
  assert.match(artifactContentDisposition('preview', '报告.html'), /^inline;/);
  assert.match(artifactContentDisposition('download', 'report.html'), /^attachment;/);
  assert.doesNotMatch(artifactContentDisposition('download', 'bad\r\nname.html'), /[\r\n]/);
});

test('generated HTML preview uses an origin-isolating CSP sandbox', () => {
  assert.match(GENERATED_HTML_PREVIEW_CSP, /sandbox allow-scripts/);
  assert.doesNotMatch(GENERATED_HTML_PREVIEW_CSP, /allow-same-origin/);
  assert.match(GENERATED_HTML_PREVIEW_CSP, /form-action 'none'/);
});
