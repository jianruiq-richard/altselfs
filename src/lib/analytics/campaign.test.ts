import assert from 'node:assert/strict';
import test from 'node:test';
import { appendCampaignParams } from './campaign.js';

test('campaign parameters survive the signed-in homepage redirect', () => {
  assert.equal(
    appendCampaignParams('/investor/chat/100', {
      utm_source: 'xiaohongshu',
      utm_medium: 'organic social',
      utm_campaign: 'september_launch',
    }),
    '/investor/chat/100?utm_source=xiaohongshu&utm_medium=organic+social&utm_campaign=september_launch',
  );
});

test('only recognized campaign parameters are forwarded', () => {
  assert.equal(
    appendCampaignParams('/investor/chat/100?view=chat', {
      utm_source: ['newsletter', 'partner'],
      prompt: 'untrusted prompt',
      redirect_url: 'https://example.com',
    }),
    '/investor/chat/100?view=chat&utm_source=newsletter&utm_source=partner',
  );
});

test('redirect path is unchanged when no campaign parameters are present', () => {
  assert.equal(
    appendCampaignParams('/investor/chat/100', { prompt: 'hello' }),
    '/investor/chat/100',
  );
});
