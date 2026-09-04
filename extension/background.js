/**
 * CourtVision - Background Service Worker v3.2.2
 */

const STORAGE_KEY = 'courtvision_clips';
const POLAR_ORG_ID = '0be66be6-c4e2-4c59-8980-6e0a418fe30f';
const POLAR_VALIDATE_URL = 'https://api.polar.sh/v1/customer-portal/license-keys/validate';

async function polarValidate(key) {
  try {
    const response = await fetch(POLAR_VALIDATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: key.trim(),
        organization_id: POLAR_ORG_ID
      })
    });
    const data = await response.json();
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      return { valid: null };
    }
    if (!response.ok) return { valid: false };
    const status = data.license_key?.status || data.status;
    return { valid: status === 'granted' };
  } catch (err) {
    console.error('[CourtVision] Polar validate error:', err);
    return { valid: null };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'polarValidate') {
    polarValidate(request.key).then(sendResponse);
    return true;
  }
  if (request.action === 'getClips') {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      sendResponse(result[STORAGE_KEY] || []);
    });
    return true;
  }
  if (request.action === 'saveClip') {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const clips = result[STORAGE_KEY] || [];
      clips.push(request.clip);
      chrome.storage.local.set({ [STORAGE_KEY]: clips }, () => {
        sendResponse({ success: true, clips: clips });
      });
    });
    return true;
  }
  if (request.action === 'deleteClip') {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const clips = result[STORAGE_KEY] || [];
      const filtered = clips.filter(c => c.id !== request.clipId);
      chrome.storage.local.set({ [STORAGE_KEY]: filtered }, () => {
        sendResponse({ success: true, clips: filtered });
      });
    });
    return true;
  }
  if (request.action === 'clearAllClips') {
    chrome.storage.local.set({ [STORAGE_KEY]: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({ [STORAGE_KEY]: [] });
  }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes[STORAGE_KEY]) {
    const clips = changes[STORAGE_KEY].newValue || [];
    chrome.action.setBadgeText({ text: clips.length > 0 ? clips.length.toString() : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#3B82F6' });
  }
});
