import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOpenRouterParsedTextMetadataPatch } from '../src/tools/pdf-parser.js';

test('OpenRouter PDF parser metadata patch promotes the full parsed text and preserves local fallback', () => {
  const previousModel = process.env.OPENROUTER_FILE_PARSER_MODEL;
  process.env.OPENROUTER_FILE_PARSER_MODEL = 'deepseek/deepseek-v3.2';

  try {
    const patch = buildOpenRouterParsedTextMetadataPatch({
      existingMetadata: {
        parser: 'local_pdf_poppler',
        parsedTextPath: '/workspace/artifacts/parsed/local.md',
        parsedTextRelativePath: 'artifacts/parsed/local.md',
      },
      parsedTextPath: '/workspace/artifacts/parsed/full.openrouter.md',
      parsedTextRelativePath: 'artifacts/parsed/full.openrouter.md',
      parsedAt: '2026-07-29T09:18:06.341Z',
      engine: 'mistral-ocr',
      annotationHash: 'annotation-hash',
      generationId: 'gen-test',
      outputBytes: 71384,
    });

    assert.equal(patch.parser, 'openrouter_file_parser');
    assert.equal(patch.bestParsedTextSource, 'openrouter_file_parser');
    assert.equal(patch.parsedTextPath, '/workspace/artifacts/parsed/full.openrouter.md');
    assert.equal(patch.parsedTextRelativePath, 'artifacts/parsed/full.openrouter.md');
    assert.equal(patch.openRouterParsedTextPath, '/workspace/artifacts/parsed/full.openrouter.md');
    assert.equal(patch.openRouterParsedTextRelativePath, 'artifacts/parsed/full.openrouter.md');
    assert.equal(patch.openRouterPdfEngine, 'mistral-ocr');
    assert.equal(patch.openRouterFileParserModel, 'deepseek/deepseek-v3.2');
    assert.equal(patch.annotationHash, 'annotation-hash');
    assert.equal(patch.openRouterGenerationId, 'gen-test');
    assert.equal(patch.openRouterOutputBytes, 71384);
    assert.equal(patch.localParser, 'local_pdf_poppler');
    assert.equal(patch.localParsedTextPath, '/workspace/artifacts/parsed/local.md');
    assert.equal(patch.localParsedTextRelativePath, 'artifacts/parsed/local.md');
  } finally {
    if (previousModel === undefined) {
      delete process.env.OPENROUTER_FILE_PARSER_MODEL;
    } else {
      process.env.OPENROUTER_FILE_PARSER_MODEL = previousModel;
    }
  }
});
