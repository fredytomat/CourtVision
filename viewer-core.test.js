const assert = require('node:assert/strict');
const fs = require('node:fs');
const { parseShareUrl } = require('./viewer-core.js');

global.atob ||= value => Buffer.from(value, 'base64').toString('binary');

function encode(value, urlSafe = false) {
  let result = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  if (urlSafe) result = result.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return result;
}

const legacy = {
  title: 'Final',
  teams: [{
    name: 'Home',
    categories: [
      { name: 'Set Play', clips: [[24, 37, '', 0], [4, 17, '', 0]] },
      { name: 'Zone Off', clips: [[31, 44, '', 0]] },
      { name: 'Defense', clips: [[3, 9, 'Good stop', 1]] }
    ]
  }]
};
const parsedLegacy = parseShareUrl(`?v=abcdefghijk&d=${encodeURIComponent(encode(legacy))}`);
assert.deepEqual(parsedLegacy.clips.map(clip => clip.categoryName), ['Set Play', 'Set Play', 'Zone Off', 'Defense']);
assert.equal(parsedLegacy.clips[3].notes, 'Good stop');
assert.equal(parsedLegacy.clips[3].pinned, true);

const emojiLegacy = {
  title: 'USA 🇺🇸 vs Serbia 🇷🇸',
  teams: [{ name: 'My Team', categories: [{ name: 'Defense', clips: [[26, 39, 'Good stop', 0]] }] }]
};
const emojiLegacyQuery = `?v=gdtetu4nnZc&d=${encode(emojiLegacy)}`;
assert.match(emojiLegacyQuery, /\+/, 'Fixture must exercise legacy Base64 plus characters');
const parsedEmojiLegacy = parseShareUrl(emojiLegacyQuery);
assert.equal(parsedEmojiLegacy.title, emojiLegacy.title);
assert.equal(parsedEmojiLegacy.clips[0].notes, 'Good stop');

const mobile = { title: 'Mobile', videoId: 'abcdefghijk', clips: [{ teamName: 'Away', categoryName: 'BLOB', startTime: 12, endTime: 25, notes: '<img src=x onerror=alert(1)>' }] };
const parsedMobile = parseShareUrl(`?d=${encodeURIComponent(encode(mobile, true))}`);
assert.equal(parsedMobile.clips[0].teamName, 'Away');
assert.equal(parsedMobile.clips[0].start, 12);
assert.equal(parsedMobile.clips[0].notes, '<img src=x onerror=alert(1)>');

const versionTwo = {
  version: 2,
  title: 'Shared ecosystem',
  videoId: 'abcdefghijk',
  clips: [{ teamName: 'My Team', categoryName: 'Defense', tagTime: 20, startTime: 13, endTime: 37, notes: 'Good stop', pinned: true, outcome: 'success' }]
};
const parsedVersionTwo = parseShareUrl(`?v=abcdefghijk&d=${encode(versionTwo, true)}`);
assert.equal(parsedVersionTwo.version, 2);
assert.equal(parsedVersionTwo.clips[0].pinned, true);
assert.equal(parsedVersionTwo.clips[0].outcome, 'success');
assert.throws(() => parseShareUrl(`?v=abcdefghijk&d=${encode({ ...versionTwo, version: 99 }, true)}`), /Versi link/);

const single = parseShareUrl('?v=abcdefghijk&start=4&end=8');
assert.equal(single.clips.length, 1);

assert.throws(() => parseShareUrl('?v=bad&start=4&end=8'), /ID video/);
assert.throws(() => parseShareUrl('?v=abcdefghijk&d=not-base64'), /./);
assert.throws(() => parseShareUrl(`?v=abcdefghijk&d=${encode({ clips: [{ startTime: 9, endTime: 2 }] })}`), /Tidak ada clip valid/);

const viewerHtml = fs.readFileSync(`${__dirname}/clip.html`, 'utf8');
for (const feature of ['Auto Next', 'progress-fill', 'watched', 'team-section', 'category-section']) {
  assert.match(viewerHtml, new RegExp(feature), `Viewer harus mempertahankan fitur ${feature}`);
}
assert.match(viewerHtml, /escapeHtml\(clipData\.title/);
assert.match(viewerHtml, /escapeHtml\(currentClip\.categoryName/);
assert.ok(viewerHtml.includes(fs.readFileSync(`${__dirname}/viewer-core.js`, 'utf8').trim()), 'Deployed inline reader must match tested parser');

console.log('Universal viewer compatibility tests passed.');
