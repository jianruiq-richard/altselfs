import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractPdfTextStats,
  extractFileAnnotation,
  inferMimeType,
} from '../src/artifact-ingestion.js';

test('generated HTML artifacts are uploaded with a browser-renderable MIME type', () => {
  assert.equal(inferMimeType('report.html', ''), 'text/html; charset=utf-8');
  assert.equal(inferMimeType('report.HTM', ''), 'text/html; charset=utf-8');
});

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

test('OpenRouter file annotation extractor chooses the largest parsed body across choices and error metadata', () => {
  const annotation = extractFileAnnotation({
    choices: [{
      message: {
        annotations: [{
          type: 'file',
          file: {
            hash: 'small-hash',
            content: [{ type: 'text', text: 'short confirmation' }],
          },
        }],
      },
    }],
    error: {
      metadata: {
        file_annotations: [{
          type: 'file',
          file: {
            hash: 'large-hash',
            name: 'contract.pdf',
            content: [
              { type: 'text', text: '# Page 1\n合同正文' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,ignored' } },
              { type: 'text', text: '# Page 2\n费用和解除条款' },
            ],
          },
        }],
      },
    },
  });

  assert.equal(annotation.hash, 'large-hash');
  assert.equal(annotation.text, '# Page 1\n合同正文\n# Page 2\n费用和解除条款');
});
