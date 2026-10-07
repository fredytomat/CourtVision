/**
 * CourtVision - Background Service Worker v3.4.0
 */

const STORAGE_KEY = 'courtvision_clips';
const LICENSE_API_URL = 'https://courtvision-license-api.fredy-xau.workers.dev';
const CHECKOUT_URL = 'https://courtvision.id/checkout.html';
const SAMPLE_VIDEO_URL = 'https://www.youtube.com/watch?v=x-VDI8nVVjo';
const LICENSE_AUTH_KEY = 'courtvision_license_auth';
const INSTALLATION_ID_KEY = 'courtvision_installation_id';

async function getOrCreateInstallationId() {
  const stored = await chrome.storage.local.get([INSTALLATION_ID_KEY]);
  if (stored[INSTALLATION_ID_KEY]) return stored[INSTALLATION_ID_KEY];
  const installationId = crypto.randomUUID();
  await chrome.storage.local.set({ [INSTALLATION_ID_KEY]: installationId });
  return installationId;
}

function getGoogleAccessToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || 'Google sign-in was cancelled'));
        return;
      }
      resolve(token);
    });
  });
}

async function publicApi(path, body) {
  const response = await fetch(`${LICENSE_API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'CourtVision server rejected the request');
  return data;
}

async function refreshCourtVisionSession(auth) {
  if (!auth?.tokens?.refreshToken) throw new Error('Sign in required');
  const data = await publicApi('/v1/auth/refresh', { refreshToken: auth.tokens.refreshToken });
  const next = { ...auth, tokens: data.tokens };
  await chrome.storage.local.set({ [LICENSE_AUTH_KEY]: next });
  return next;
}

async function authenticatedApi(path, init = {}, retry = true) {
  const stored = await chrome.storage.local.get([LICENSE_AUTH_KEY]);
  let auth = stored[LICENSE_AUTH_KEY];
  if (!auth?.tokens?.accessToken) throw new Error('Sign in required');
  if (auth.tokens.accessTokenExpiresAt * 1000 <= Date.now() + 30_000) {
    auth = await refreshCourtVisionSession(auth);
  }
  const response = await fetch(`${LICENSE_API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${auth.tokens.accessToken}`,
      'Content-Type': 'application/json'
    }
  });
  if (response.status === 401 && retry) {
    await refreshCourtVisionSession(auth);
    return authenticatedApi(path, init, false);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'CourtVision server rejected the request');
  return data;
}

async function licenseServerSignIn() {
  const accessToken = await getGoogleAccessToken(true);
  const data = await publicApi('/v1/auth/google', {
    accessToken,
    installationId: await getOrCreateInstallationId(),
    deviceLabel: `Chrome on ${navigator.platform || 'computer'}`,
    platform: 'extension'
  });
  const auth = { user: data.user, device: data.device, tokens: data.tokens };
  await chrome.storage.local.set({ [LICENSE_AUTH_KEY]: auth });
  return {
    signedIn: true,
    user: data.user,
    entitlement: data.entitlement,
    devices: [data.device],
    maxActiveDevices: data.maxActiveDevices || 1
  };
}

async function licenseServerStatus() {
  const stored = await chrome.storage.local.get([LICENSE_AUTH_KEY]);
  if (!stored[LICENSE_AUTH_KEY]) return { signedIn: false };
  try {
    return { signedIn: true, ...(await authenticatedApi('/v1/me')) };
  } catch (error) {
    return { signedIn: false, error: error.message };
  }
}

async function licenseServerLogout() {
  const stored = await chrome.storage.local.get([LICENSE_AUTH_KEY]);
  const auth = stored[LICENSE_AUTH_KEY];
  if (auth?.tokens?.accessToken) {
    await authenticatedApi('/v1/auth/logout', { method: 'POST', body: '{}' }).catch(() => {});
  }
  await chrome.storage.local.remove([LICENSE_AUTH_KEY]);
  return { success: true };
}

async function openCheckout(plan = 'monthly') {
  if (!['monthly', 'yearly'].includes(plan)) throw new Error('Paket tidak valid');
  const status = await licenseServerStatus();
  if (!status.signedIn || !status.user?.email) {
    throw new Error('Masuk dengan Google terlebih dahulu');
  }
  const url = new URL(CHECKOUT_URL);
  url.searchParams.set('plan', plan);
  url.searchParams.set('email', status.user.email);
  if (status.user.name) url.searchParams.set('name', status.user.name);
  await chrome.tabs.create({ url: url.toString() });
  return { success: true };
}

async function openSampleVideo() {
  await chrome.tabs.create({ url: SAMPLE_VIDEO_URL });
  return { success: true };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'licenseServerSignIn') {
    licenseServerSignIn().then(sendResponse).catch(error => sendResponse({ error: error.message }));
    return true;
  }
  if (request.action === 'licenseServerStatus') {
    licenseServerStatus().then(sendResponse).catch(error => sendResponse({ signedIn: false, error: error.message }));
    return true;
  }
  if (request.action === 'licenseServerLogout') {
    licenseServerLogout().then(sendResponse).catch(error => sendResponse({ error: error.message }));
    return true;
  }
  if (request.action === 'openCheckout') {
    openCheckout(request.plan).then(sendResponse).catch(error => sendResponse({ error: error.message }));
    return true;
  }
  if (request.action === 'openSampleVideo') {
    openSampleVideo().then(sendResponse).catch(error => sendResponse({ error: error.message }));
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
    // Never overwrite existing local clips. This also protects data when Chrome
    // restores extension storage during a reinstall.
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      if (!Array.isArray(result[STORAGE_KEY])) {
        chrome.storage.local.set({ [STORAGE_KEY]: [] });
      }
    });
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes[STORAGE_KEY]) {
    const clips = changes[STORAGE_KEY].newValue || [];
    chrome.action.setBadgeText({ text: clips.length > 0 ? clips.length.toString() : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#3B82F6' });
  }
});
