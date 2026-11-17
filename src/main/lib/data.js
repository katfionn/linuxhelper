// SPDX-License-Identifier: MPL-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');

function load(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
  } catch {
    return fallback;
  }
}

const knowledge = load('knowledge.json', { categories: [], articles: [] });
const tips = load('tips.json', { tips: [] });

function dailyIndex(total) {
  if (!total) return 0;
  const days = Math.floor(Date.now() / 86400000);
  return days % total;
}

function dailyTip() {
  const list = tips.tips || [];
  if (!list.length) return null;
  const index = dailyIndex(list.length);
  return { ...list[index], index, total: list.length, date: new Date().toISOString().slice(0, 10) };
}

function tipByIndex(index) {
  const list = tips.tips || [];
  if (!list.length) return null;
  const i = ((Number(index) % list.length) + list.length) % list.length;
  return { ...list[i], index: i, total: list.length };
}

function searchKnowledge(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return knowledge.articles || [];
  return (knowledge.articles || []).filter((a) =>
    `${a.title} ${a.summary} ${(a.tags || []).join(' ')} ${a.body}`.toLowerCase().includes(q)
  );
}

function knowledgeMeta() {
  return {
    categories: knowledge.categories || [],
    articles: (knowledge.articles || []).map((a) => ({
      id: a.id,
      title: a.title,
      category: a.category,
      summary: a.summary,
      tags: a.tags || [],
      level: a.level || '入门',
      readMinutes: a.readMinutes || 3
    })),
    articleCount: (knowledge.articles || []).length
  };
}

function article(id) {
  return (knowledge.articles || []).find((a) => a.id === id) || null;
}

module.exports = { knowledge, tips, dailyTip, tipByIndex, searchKnowledge, knowledgeMeta, article };