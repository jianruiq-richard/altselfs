import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractPdfTextStats,
  extractFileAnnotation,
} from '../src/artifact-ingestion.js';

test('PDF text stats record extraction facts without a completeness verdict', () => {
  const stats = extractPdfTextStats({
    pageCount: 56,
    textPageCount: 56,
    densePageCount: 0,
    nonWhitespaceChars: 4_000,
  });

  assert.equal(stats.textPageRatio, 1);
  assert.equal(stats.densePageRatio, 0);
  assert.equal('sufficient' in stats, false);
});

test('OpenRouter file annotation wins over the model summary and retains its hash', () => {
  const annotation = extractFileAnnotation({
    id: 'gen-test',
    choices: [{
      message: {
        content: 'Short model summary',
        annotations: [{
          type: 'file',
          file: {
            hash: 'pdf-hash',
            name: 'contract.pdf',
            content: [
              { type: 'text', text: '# Page 1\nFull parsed body' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
            ],
          },
        }],
      },
    }],
  });

  assert.deepEqual(annotation, {
    text: '# Page 1\nFull parsed body',
    hash: 'pdf-hash',
  });
});

test('OpenRouter error metadata annotations remain usable after inference failure', () => {
  const annotation = extractFileAnnotation({
    error: {
      metadata: {
        file_annotations: [{
          type: 'file',
          file: {
            hash: 'reusable-hash',
            content: [{ type: 'text', text: 'OCR completed before provider failure' }],
          },
        }],
      },
    },
  });

  assert.equal(annotation.hash, 'reusable-hash');
  assert.equal(annotation.text, 'OCR completed before provider failure');
});
