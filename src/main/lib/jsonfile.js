// SPDX-License-Identifier: MPL-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? base : patch;
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

class JsonFile {
  constructor(file, defaults = {}, options = {}) {
    this.file = file;
    this.defaults = defaults;
    this.mode = options.mode || 0o644;
    this.data = null;
  }

  load() {
    if (this.data) return this.data;
    try {
      this.data = deepMerge(this.defaults, JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      this.data = JSON.parse(JSON.stringify(this.defaults));
    }
    return this.data;
  }

  get() {
    return this.load();
  }

  set(next) {
    this.data = next;
    this.save();
    return this.data;
  }

  update(patch) {
    this.data = deepMerge(this.load(), patch);
    this.save();
    return this.data;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: this.mode });
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { JsonFile, deepMerge };