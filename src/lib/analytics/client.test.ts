import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPageViewParams } from './client.js';

test('page view keeps the complete campaign URL and a normalized route path', () => {
  const params = buildPageViewParams(
    '/',
    'https://minaco.ai/?utm_source=xiaohongshu&utm_medium=organic_social&utm_campaign=launch',
    'Minaco | Your AI cofounder',
  );

  assert.equal(
    params.page_location,
    'https://minaco.ai/?utm_source=xiaohongshu&utm_medium=organic_social&utm_campaign=launch',
  );
  assert.equal(params.page_path, '/');
  assert.equal(params.route_name, 'landing');
  assert.equal(params.app_area, 'marketing');
});
