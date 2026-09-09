const assert = require('node:assert/strict');
const { parseShareUrl } = require('./viewer-core.js');

global.atob ||= value => Buffer.from(value, 'base64').toString('binary');

function encode(value, urlSafe = false) {
  let result = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  if (urlSafe) result = result.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return result;
}

const legacy = { title: 'Final', teams: [{ name: 'Home', categories: [{ name: 'Defense', clips: [[3, 9, 'Good stop', 1]] }] }] };
const parsedLegacy = parseShareUrl(`?v=abcdefghijk&d=${encodeURIComponent(encode(legacy))}`);
assert.equal(parsedLegacy.clips[0].notes, 'Good stop');
assert.equal(parsedLegacy.clips[0].pinned, true);

const mobile = { title: 'Mobile', videoId: 'abcdefghijk', clips: [{ teamName: 'Away', categoryName: 'BLOB', startTime: 12, endTime: 25, notes: '<img src=x onerror=alert(1)>' }] };
const parsedMobile = parseShareUrl(`?d=${encodeURIComponent(encode(mobile, true))}`);
assert.equal(parsedMobile.clips[0].teamName, 'Away');
assert.equal(parsedMobile.clips[0].start, 12);
assert.equal(parsedMobile.clips[0].notes, '<img src=x onerror=alert(1)>');

const single = parseShareUrl('?v=abcdefghijk&start=4&end=8');
assert.equal(single.clips.length, 1);

assert.throws(() => parseShareUrl('?v=bad&start=4&end=8'), /ID video/);
assert.throws(() => parseShareUrl('?v=abcdefghijk&d=not-base64'), /./);
assert.throws(() => parseShareUrl(`?v=abcdefghijk&d=${encode({ clips: [{ startTime: 9, endTime: 2 }] })}`), /Tidak ada clip valid/);

console.log('Universal viewer compatibility tests passed.');

