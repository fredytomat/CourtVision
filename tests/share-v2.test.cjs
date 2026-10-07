const assert = require('node:assert/strict');
const test = require('node:test');

global.btoa ||= value => Buffer.from(value, 'binary').toString('base64');
global.unescape ||= value => value.replace(/%([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

const share = require('../extension/share-format.js');
const viewer = require('../viewer-core.js');

global.atob ||= value => Buffer.from(value, 'base64').toString('binary');

test('extension emits compact CourtVision Link v3 that the universal viewer reads', () => {
  const payload = share.createPayload('USA 🇺🇸 vs Serbia 🇷🇸', 'gdtetu4nnZc', [{
    teamName: 'My Team',
    categoryName: 'Defense',
    tagTime: 33,
    startTime: 26,
    endTime: 50,
    notes: 'defense malas sekali',
    pinned: true,
    outcome: 'success'
  }]);
  const url = new URL(share.createUrl(payload));
  const parsed = viewer.parseShareUrl(url.search, url.hash, url.pathname);

  assert.equal(payload.version, 3);
  assert.match(share.createUrl(payload), /^https:\/\/courtvision\.id\/c\/[A-Za-z0-9_-]+$/);
  assert.doesNotMatch(url.pathname.slice('/c/'.length), /[+\/=&#.]/);
  assert.equal(parsed.version, 3);
  assert.equal(parsed.videoId, 'gdtetu4nnZc');
  assert.equal(parsed.title, 'USA 🇺🇸 vs Serbia 🇷🇸');
  assert.equal(parsed.clips[0].notes, 'defense malas sekali');
  assert.equal(parsed.clips[0].pinned, true);
  assert.equal(parsed.clips[0].outcome, 'success');
});

test('mobile and extension produce byte-identical opaque WhatsApp-safe links', () => {
  const mobile = require('../../courtvision-mobile/artifacts/courtvision-mobile/lib/share.ts');
  const payload = share.createPayload('USA 🇺🇸 vs Serbia 🇷🇸', 'A-sDFZgc-vc', [
    {teamName:'My Team',categoryName:'Defense',tagTime:33.25,startTime:26.25,endTime:39.25,notes:'Catatan & emoji 🏀',pinned:true}
  ]);
  const extensionUrl = share.createUrl(payload);
  assert.equal(mobile.createShareUrl(payload), extensionUrl);
  const url = new URL(extensionUrl);
  const parsed = viewer.parseShareUrl(url.search, url.hash, url.pathname);
  assert.equal(parsed.videoId, payload.videoId);
  assert.equal(parsed.clips[0].notes, payload.clips[0].notes);
  assert.equal(mobile.readSharePayload(url.search, url.hash, url.pathname).clips[0].notes, payload.clips[0].notes);
});

test('six-clip WhatsApp link stays safely below the observed linkification limit', () => {
  const clips = [
    ['Set Play', 30.958215, 22.958215, 35.958215],
    ['Transition', 49.807133, 41.807133, 54.807133],
    ['Set Play', 68.331672, 60.331672, 73.331672],
    ['Transition', 85.837574, 77.837574, 90.837574],
    ['Set Play', 103.448804, 95.448804, 108.448804],
    ['Transition', 121.319076, 113.319076, 126.319076]
  ].map(([categoryName, tagTime, startTime, endTime]) => ({
    teamName: 'My Team', categoryName, tagTime, startTime, endTime, notes: ''
  }));
  const payload = share.createPayload('FENERBAHCE TAKES THIRD! | Fenerbahce Tar...', 'WPpXqOUWUfY', clips);
  const url = share.createUrl(payload);
  assert.ok(url.length < 450, `URL must remain short enough for WhatsApp, got ${url.length}`);
  assert.equal(viewer.parseShareUrl('', '', new URL(url).pathname).clips.length, 6);
});
