const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('public purchase pages describe the product and active payment flow accurately', () => {
  const index = read('index.html');
  const checkout = read('checkout.html');
  const privacy = read('privacy.html');
  const terms = read('terms.html');

  assert.match(index, /CourtVision Chrome desktop extension/);
  assert.match(index, /CourtVision Mobile is not included/);
  assert.match(index, /QRIS/);
  assert.match(checkout, /CourtVision Chrome Extension/);
  assert.match(checkout, /QRIS/);
  assert.match(checkout, /emailInput\.readOnly = true/);
  assert.doesNotMatch([index, checkout, privacy, terms].join('\n'), /Polar/);
  assert.doesNotMatch([index, checkout].join('\n'), /sandbox/i);
});

test('payment result waits for Duitku confirmation and gives a clear next action', () => {
  const result = read('payment-result.html');
  assert.match(result, /data\.status === 'pending'/);
  assert.match(result, /setTimeout\(show, 3000\)/);
  assert.match(result, /Kembali ke YouTube/);
  assert.match(result, /jangan melakukan pembayaran kedua/i);
});

test('release version is consistent in user-facing extension files', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  const files = [
    read('extension/background.js'),
    read('extension/content.js'),
    read('extension/popup.js'),
    read('extension/popup.html'),
  ];
  assert.equal(manifest.version, '3.4.1');
  for (const source of files) assert.match(source, /3\.4\.1/);
});
