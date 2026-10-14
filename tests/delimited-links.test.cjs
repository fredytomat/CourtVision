const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const share = require('../extension/share-format.js');
const viewer = require('../viewer-core.js');
const original = 'WzMsIkluZG9uZXNpYSB2cyBTaW5nYXBvcmUgfCBGdWxsIEJhc2tldGJhbGwuLi4iLCJORXJhdHBDQ28wSSIsWyJNeSBUZWFtIl0sWyJUcmFuc2l0aW9uIiwiU2V0IFBsYXkiLCJEZWZlbnNlIiwiWm9uZSBPZmYiXSxbWzAsMCwyMTQxNiwxMzBdLFswLDAsMjk5OTksMTMwXSxbMCwxLDM3MzQ4LDEzMF0sWzAsMiwzNzc3NywxMzBdLFswLDMsNTI1ODcsMTMwXSxbMCwyLDU5NDM5LDEzMF0sWzAsMyw3MDYzMywxMzBdXV0';
const read = url => viewer.parseShareUrl(url.search, url.hash, url.pathname);
test('reported seven-clip link retains every field across old and delimited formats', () => {
  const old = read(new URL('https://courtvision.id/c/' + original));
  assert.equal(old.clips.length, 7);
  const updated = new URL('https://courtvision.id/clip.html#cv3=' + original.match(/.{1,120}/g).join('.'));
  assert.deepEqual(read(updated), old);
  assert.deepEqual(read(new URL('https://courtvision.id/clip.html?d=' + original)), old);
  assert.deepEqual(read(new URL('https://courtvision.id/clip.html#cv2=' + original)), old);
});
for (const count of [1, 7, 14, 50, 120, 500, 1000]) {
  test(`${count} clips preserve normalized data, notes, flags and ordering in one URL`, () => {
    const payload = share.createPayload('Uji 🏀 日本', 'NEratpCCo0I', Array.from({length: count}, (_, i) => ({
      teamName: i % 2 ? 'Lawan' : 'My Team', categoryName: ['Transition','Set Play','Defense'][i % 3],
      startTime: 10 + i * 20, endTime: 23 + i * 20,
      notes: i === 0 ? 'Gerak → kanan & kiri 🏀' : '', pinned: i % 7 === 0,
      outcome: i % 2 ? 'success' : 'fail'
    })));
    const url = new URL(share.createUrl(payload));
    assert.equal(url.pathname, '/clip.html');
    assert.equal(url.search, '');
    assert.ok(url.hash.startsWith('#cv3='));
    assert.ok(url.hash.slice(5).split('.').every(chunk => chunk.length <= 120));
    assert.equal(read(url).clips.length, count);
    assert.deepEqual(read(url), read(new URL('https://courtvision.id/c/' + share.encodePayload(payload))));
  });
}
test('malformed and oversized tokens fail closed', () => {
  for (const token of ['', '.abc', 'abc.', 'abc..abc', 'abc!def', 'a'.repeat(121), Array(1600).fill('a'.repeat(120)).join('.')]) {
    assert.throws(() => viewer.parseShareUrl('', '#cv3=' + token, '/clip.html'));
  }
});
test('both HTML readers match core and their actual UI initialization recognizes cv3', () => {
  const core = fs.readFileSync(require.resolve('../viewer-core.js'), 'utf8').trim();
  for (const name of ['clip.html', '404.html']) {
    const html = fs.readFileSync(require.resolve('../' + name), 'utf8');
    assert.ok(html.includes(core));
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    const url = new URL('https://courtvision.id/clip.html#cv3=' + original.match(/.{1,120}/g).join('.'));
    const sandbox = { URLSearchParams, atob, console, window: { location: url }, document: { getElementById: () => ({}) } };
    vm.createContext(sandbox);
    vm.runInContext(scripts[0], sandbox);
    vm.runInContext(scripts[1].split('    const mainContent =')[0], sandbox);
    assert.equal(vm.runInContext('allClips.length', sandbox), 7);
    assert.equal(vm.runInContext('videoId', sandbox), 'NEratpCCo0I');
  }
});

test('popup and YouTube panel export the complete WhatsApp summary with exactly one readable link', () => {
  const compact = JSON.parse(Buffer.from(original, 'base64url'));
  const categories = ['Transition', 'Set Play', 'Zone Off', 'Defense'];
  const clips = compact[5].map(row => ({
    videoId: compact[2], videoTitle: compact[1], teamId: 'home', teamName: 'My Team',
    category: compact[4][row[1]], categoryName: compact[4][row[1]],
    startTime: row[2] / 10, endTime: (row[2] + row[3]) / 10
  }));
  for (const file of ['popup.js', 'content.js']) {
    const source = fs.readFileSync(require.resolve('../extension/' + file), 'utf8');
    const start = source.indexOf('function generateWhatsAppSummary(clips)');
    const end = source.indexOf('return text;', start) + 'return text;'.length;
    assert.ok(start >= 0 && end > start);
    const sandbox = {
      CourtVisionShare: share, clips,
      config: { teams: [{id: 'home'}], categories: categories.map(id => ({id})) }
    };
    vm.createContext(sandbox);
    const text = vm.runInContext(source.slice(start, end) + '\n}\ngenerateWhatsAppSummary(clips)', sandbox);
    for (const expected of ['*GAME ANALYSIS*', '*MY TEAM*', '• Transition: 2', '• Set Play: 1', '• Zone Off: 2', '• Defense: 2', '*TOTAL: 7 clips*', 'Klik untuk lihat semua clips:', '_CourtVision_']) {
      assert.ok(text.includes(expected), `${file} must include ${expected}`);
    }
    const urls = text.match(/https:\/\/\S+/g);
    assert.equal(urls.length, 1);
    assert.ok(urls[0].startsWith('https://courtvision.id/clip.html#cv3='));
    assert.equal(read(new URL(urls[0])).clips.length, 7);
  }
});
