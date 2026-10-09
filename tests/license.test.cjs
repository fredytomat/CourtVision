const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const extensionRoot = path.join(__dirname, '..', 'extension');
const read = (name) => fs.readFileSync(path.join(extensionRoot, name), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const background = read('background.js');
const popup = read('popup.js');
const popupHtml = read('popup.html');
const content = read('content.js');
const welcome = read('welcome.js');

test('release uses the production account service and keeps the published extension identity', () => {
  assert.equal(manifest.version, '3.4.1');
  assert.ok(manifest.permissions.includes('identity'));
  assert.equal(manifest.oauth2.client_id, '593776146486-ereu1ifkfk85hf321rjlu8ik3vig85si.apps.googleusercontent.com');
  const extensionId = [...crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest().subarray(0, 16)]
    .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
    .join('');
  assert.equal(extensionId, 'oklbkdldkcchgihmadhbgojnamadihig');
  assert.ok(manifest.host_permissions.includes('https://courtvision-license-api.fredy-xau.workers.dev/*'));
  assert.ok(!manifest.host_permissions.some(permission => permission.includes('staging')));
  assert.ok(!manifest.host_permissions.some(permission => permission.includes('polar')));
});

test('background opens onboarding after install and routes upgrades through Duitku checkout', () => {
  assert.match(background, /welcome\.html/);
  assert.match(background, /https:\/\/courtvision\.id\/checkout\.html/);
  assert.match(background, /licenseServerSignIn/);
  assert.match(background, /openCheckout/);
  assert.match(background, /openSampleVideo/);
  assert.doesNotMatch(background, /polar/i);
  assert.doesNotMatch(background, /staging/i);
});

test('popup presents one account flow without manual license keys', () => {
  assert.match(popupHtml, /data-tab="account"/);
  assert.match(popupHtml, /btn-google-signin/);
  assert.match(popupHtml, /btn-upgrade-monthly/);
  assert.match(popupHtml, /Duitku/);
  assert.doesNotMatch(popupHtml, /license-key|btn-activate|Polar/i);
  assert.match(popup, /licenseServerStatus/);
  assert.match(popup, /TRIAL ·/);
  assert.doesNotMatch(popup, /courtvision_license['"]|Polar checkout|polarValidate/i);
});

test('YouTube panel trusts only the production entitlement', () => {
  assert.match(content, /licenseServerStatus/);
  assert.match(content, /signed-out/);
  assert.match(content, /AKSES BERAKHIR/);
  assert.doesNotMatch(content, /TRIAL_KEY|TRIAL_DAYS|polarPattern|courtvision_license/);
});

test('welcome page supports sign-in and opening the sample video', () => {
  assert.match(welcome, /licenseServerSignIn/);
  assert.match(welcome, /licenseServerStatus/);
  assert.match(welcome, /openSampleVideo/);
});

test('sign-out clears both the CourtVision session and cached Google token', () => {
  assert.match(background, /removeCachedAuthToken/);
  assert.match(background, /courtvision_license_auth/);
});
