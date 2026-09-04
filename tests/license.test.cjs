const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..', 'extension');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const quiet = { log() {}, warn() {}, error() {} };
const key = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
for (const code of [408, 429, 500, 502, 503]) {
  test(`HTTP ${code} is an outage, not an invalid key`, async () => {
    const context = vm.createContext({console: quiet, fetch: async () => ({ok:false,status:code,json:async()=>({})})});
    vm.runInContext(background.slice(0, background.indexOf('chrome.runtime.onMessage')), context);
    assert.equal((await vm.runInContext(`polarValidate('${key}')`, context)).valid, null);
  });
}
test('granted and revoked responses remain distinct', async () => {
  for (const status of ['granted', 'revoked']) {
    const context = vm.createContext({console: quiet, fetch: async () => ({ok:true,status:200,json:async()=>({status})})});
    vm.runInContext(background.slice(0, background.indexOf('chrome.runtime.onMessage')), context);
    assert.equal((await vm.runInContext(`polarValidate('${key}')`, context)).valid, status === 'granted');
  }
});
for (const [label, valid, age, expected, removed] of [
  ['fresh cache', null, 1, 'pro', false],
  ['offline grace', null, 8, 'pro', false],
  ['outage after grace', null, 25, 'error', false],
  ['valid old key', true, 25, 'pro', false],
  ['revoked key', false, 25, 'expired', true],
]) {
  test(label, async () => {
    const data = {courtvision_license:key, courtvision_license_cache:{key,valid:true,timestamp:Date.now()-age*3600000},courtvision_trial:{expiresAt:'2020-01-01'}};
    const context = vm.createContext({console:quiet, chrome:{storage:{local:{get:async()=>data,set:async values=>Object.assign(data,values),remove:async keys=>keys.forEach(k=>delete data[k])}}}, validateLicenseFormat:()=>true,validateLicenseWithPolar:async()=>valid});
    const constants = popup.slice(popup.indexOf('const LICENSE_KEY'), popup.indexOf('// Polar checkout URLs'));
    const fn = popup.slice(popup.indexOf('async function checkUserStatus()'), popup.indexOf('// ============================================', popup.indexOf('async function checkUserStatus()')));
    vm.runInContext(constants + fn,context);
    assert.equal((await vm.runInContext('checkUserStatus()',context)).status,expected);
    assert.equal(data.courtvision_license === undefined,removed);
  });
}
test('successful activation stores the existing key and cache', async () => {
  const elements = {};
  const document = {getElementById:id=>elements[id] ||= {value:key,style:{}}};
  let saved;
  const context = vm.createContext({document, chrome:{storage:{local:{set:async value=>saved=value}}},validateLicenseFormat:()=>true,activateLicenseWithPolar:async()=>({success:true}),updateLicenseUI(){},updateExportButtons(){}});
  const start = popup.indexOf("document.getElementById('btn-activate').onclick");
  const end = popup.indexOf('// Copy WhatsApp',start);
  vm.runInContext("const LICENSE_KEY='courtvision_license';const LICENSE_CACHE_KEY='courtvision_license_cache';let isPro=false;let trialStatus=null;"+popup.slice(start,end),context);
  await elements['btn-activate'].onclick();
  assert.equal(saved.courtvision_license,key);
  assert.equal(saved.courtvision_license_cache.valid,true);
});
