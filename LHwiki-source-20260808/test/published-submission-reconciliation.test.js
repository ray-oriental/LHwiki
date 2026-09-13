import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hasUnlistedApprovedSubmission } from '../public/published-submission-reconciliation.js';

const listedArticle = {
  section_slug: 'life',
  title: '潞河第五食堂',
  summary: '用餐小 tips',
  author_label: '咩咩同学'
};

test('approved submissions missing from a cached public directory request one reconciliation refresh', () => {
  assert.equal(hasUnlistedApprovedSubmission([], [{ ...listedArticle, status: 'approved' }]), true);
  assert.equal(hasUnlistedApprovedSubmission([listedArticle], [{ ...listedArticle, status: 'approved' }]), false);
  assert.equal(hasUnlistedApprovedSubmission([{ ...listedArticle, summary: '管理员校订后的摘要' }], [{ ...listedArticle, status: 'approved' }]), false);
  assert.equal(hasUnlistedApprovedSubmission([], [{ ...listedArticle, status: 'pending' }]), false);
});

test('personal workspace wires an unlisted approved submission to one forced bootstrap refresh', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /hasUnlistedApprovedSubmission\(state\.articles, state\.submissions\)\) await refreshBootstrap\(\)/);
});
