(() => {
  'use strict';

  const account = document.getElementById('account');
  const title = document.getElementById('account-title');
  const detail = document.getElementById('account-detail');
  const primary = document.getElementById('primary-action');
  const openYouTube = document.getElementById('open-youtube');
  let signedIn = false;

  function send(action, payload = {}) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ action, ...payload }, response => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { error: 'Server tidak merespons' });
      });
    });
  }

  function showError(message) {
    account.className = 'account error';
    title.textContent = 'Belum dapat melanjutkan';
    detail.textContent = message || 'Periksa koneksi lalu coba lagi.';
    primary.disabled = false;
    primary.textContent = signedIn ? 'Coba lagi' : 'Masuk dengan Google & Mulai Trial';
  }

  function showStatus(status) {
    signedIn = Boolean(status?.signedIn);
    account.className = `account${signedIn ? ' ready' : ''}`;
    if (!signedIn) {
      title.textContent = 'Belum masuk';
      detail.textContent = 'Trial dimulai otomatis setelah Anda masuk.';
      primary.textContent = 'Masuk dengan Google & Mulai Trial';
      primary.disabled = false;
      return;
    }

    const entitlement = status.entitlement || {};
    title.textContent = status.user?.name || status.user?.email || 'Akun CourtVision terhubung';
    if (entitlement.status === 'pro') {
      detail.textContent = 'CourtVision PRO aktif. Anda siap membuat klip.';
    } else if (entitlement.status === 'trial') {
      const seconds = Math.max(0, Number(entitlement.trialEndsAt || 0) - Math.floor(Date.now() / 1000));
      const days = Math.max(1, Math.ceil(seconds / 86400));
      detail.textContent = `Trial aktif · ${days} hari tersisa`;
    } else {
      detail.textContent = 'Masa akses berakhir. Anda tetap dapat membuka video dan mengaktifkan PRO dari panel.';
    }
    primary.textContent = 'Buka video contoh & Buat Klip Pertama';
    primary.disabled = false;
  }

  async function refresh() {
    primary.disabled = true;
    const status = await send('licenseServerStatus');
    if (status.error && !status.signedIn) showError(status.error);
    else showStatus(status);
  }

  primary.addEventListener('click', async () => {
    primary.disabled = true;
    if (!signedIn) {
      primary.textContent = 'Menghubungkan akun…';
      const result = await send('licenseServerSignIn');
      if (result.error) {
        showError(result.error);
        return;
      }
      showStatus(result);
    }
    primary.textContent = 'Membuka video contoh…';
    const opened = await send('openSampleVideo');
    if (opened.error) showError(opened.error);
    else primary.textContent = 'Video contoh dibuka';
  });

  openYouTube.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.youtube.com/' });
  });

  refresh();
})();
