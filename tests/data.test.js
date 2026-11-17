// SPDX-License-Identifier: MPL-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../src/main/lib/data');

test('内置知识库与技巧数据可加载', () => {
  assert.ok(data.knowledge.articles.length > 0, '知识库应至少有一篇文章');
  assert.ok(data.knowledge.categories.length > 0, '知识库应至少有一个分类');
  assert.ok(data.tips.tips.length > 0, '技巧库应至少有一条技巧');
});

test('知识库元信息与文章详情一致', () => {
  const meta = data.knowledgeMeta();
  assert.equal(meta.articleCount, data.knowledge.articles.length);
  assert.equal(meta.articles.length, meta.articleCount);
  const first = meta.articles[0];
  const detail = data.article(first.id);
  assert.ok(detail);
  assert.equal(detail.title, first.title);
  assert.equal(data.article('not-exists'), null);
});

test('搜索空关键词返回全部，关键词可命中标题', () => {
  const all = data.searchKnowledge('');
  assert.equal(all.length, data.knowledge.articles.length);
  const first = data.knowledge.articles[0];
  const hits = data.searchKnowledge(first.title);
  assert.ok(hits.some((a) => a.id === first.id));
  assert.deepEqual(data.searchKnowledge('__no_such_keyword__'), []);
});

test('每日技巧与索引取模稳定', () => {
  const total = data.tips.tips.length;
  const daily = data.dailyTip();
  assert.ok(daily);
  assert.ok(daily.index >= 0 && daily.index < total);
  assert.equal(daily.total, total);
  const normal = data.tipByIndex(2);
  assert.equal(normal.index, 2);
  const wrapped = data.tipByIndex(-1);
  assert.equal(wrapped.index, total - 1);
  const overflow = data.tipByIndex(total + 3);
  assert.equal(overflow.index, 3);
});