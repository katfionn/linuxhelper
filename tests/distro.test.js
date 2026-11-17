// SPDX-License-Identifier: MPL-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOsRelease, familyFromId } = require('../src/main/lib/distro');

test('parseOsRelease 解析带引号、注释与空行的 os-release', () => {
  const info = parseOsRelease([
    '# comment',
    'NAME="Ubuntu"',
    "ID='ubuntu'",
    'ID_LIKE="debian"',
    'VERSION_ID=24.04',
    '',
    'PRETTY_NAME="Ubuntu 24.04 LTS"'
  ].join('\n'));

  assert.equal(info.NAME, 'Ubuntu');
  assert.equal(info.ID, 'ubuntu');
  assert.equal(info.ID_LIKE, 'debian');
  assert.equal(info.VERSION_ID, '24.04');
  assert.equal(info.PRETTY_NAME, 'Ubuntu 24.04 LTS');
  assert.equal(info.COMMENT, undefined);
});

test('familyFromId 识别常见发行版家族与 ID_LIKE', () => {
  assert.equal(familyFromId('ubuntu', 'debian'), 'apt');
  assert.equal(familyFromId('debian'), 'apt');
  assert.equal(familyFromId('arch'), 'pacman');
  assert.equal(familyFromId('manjaro', 'arch'), 'pacman');
  assert.equal(familyFromId('fedora'), 'dnf');
  assert.equal(familyFromId('centos', 'rhel fedora'), 'dnf');
  assert.equal(familyFromId('opensuse-leap', 'suse'), 'zypper');
  assert.equal(familyFromId('alpine'), 'apk');
  assert.equal(familyFromId('gentoo', ''), 'unknown');
  assert.equal(familyFromId('', ''), 'unknown');
});

test('familyFromId 忽略大小写与多余空白', () => {
  assert.equal(familyFromId('UBUNTU', '  Debian  '), 'apt');
  assert.equal(familyFromId('Arch', ' Arch  '), 'pacman');
});