/**
 * CourtVision Popup - Full Clips Manager
 * v3.0.0 - Trial System + Polar Payment Integration
 */

const STORAGE_KEY = 'courtvision_clips';
const CONFIG_KEY = 'courtvision_config';
const LICENSE_KEY = 'courtvision_license';
const TRIAL_KEY = 'courtvision_trial';
const TRIAL_DAYS = 7;
const LICENSE_CACHE_KEY = 'courtvision_license_cache';
const LICENSE_CACHE_DURATION = 6 * 60 * 60 * 1000;  // 6 jam — re-validasi ke Polar setiap 6 jam
const OFFLINE_GRACE_PERIOD = 24 * 60 * 60 * 1000;   // 24 jam — grace period jika offline

// Polar checkout URLs
const POLAR_MONTHLY_URL = 'https://buy.polar.sh/polar_cl_PXQUrbSaI7Igt0uyaRINQxhVbtHv534hFWoJd0G6n54';
const POLAR_YEARLY_URL = 'https://buy.polar.sh/polar_cl_JwHM9741Il0vsxoMgWhKJnRBb3k9lwozlbZiX0hjbJo';

let allClips = [];
let config = {
  teams: [
    { id: 'team-1', name: 'My Team', color: '#1E3A5F' },
    { id: 'team-2', name: 'Opponent', color: '#DC2626' }
  ],
  categories: []
};
let filterVideo = 'all';
let filterTeam = 'all';
let isPro = false;
let trialStatus = null; // { status: 'trial'|'expired', daysLeft: N }

// Format time helper
function formatTime(s) {
  if (isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
}

// Load config from storage
async function loadConfig() {
  try {
    const result = await chrome.storage.local.get([CONFIG_KEY]);
    if (result[CONFIG_KEY]) {
      config = result[CONFIG_KEY];
    }
    updateTeamFilter();
  } catch (err) {
    console.error('Error loading config:', err);
  }
}

// Load clips from storage
async function loadClips() {
  try {
    await loadConfig();
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    allClips = result[STORAGE_KEY] || [];
    updateStats();
    updateVideoFilter();
    renderClips();
  } catch (err) {
    console.error('Error loading clips:', err);
  }
}

// Update stats display
function updateStats() {
  const total = allClips.length;
  const success = allClips.filter(c => c.outcome === 'success').length;
  const fail = allClips.filter(c => c.outcome === 'fail').length;
  
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-success').textContent = success;
  document.getElementById('stat-fail').textContent = fail;
}

// Update video filter dropdown
function updateVideoFilter() {
  const select = document.getElementById('filter-video');
  const videos = [...new Set(allClips.map(c => c.videoId))];
  
  select.innerHTML = '<option value="all">All Videos</option>';
  
  allClips.forEach(c => {
    if (!select.querySelector(`option[value="${c.videoId}"]`)) {
      const opt = document.createElement('option');
      opt.value = c.videoId;
      const title = c.videoTitle || 'Video';
      opt.textContent = title.length > 30 ? title.substring(0, 30) + '...' : title;
      select.appendChild(opt);
    }
  });
}

// Update team filter dropdown with dynamic teams
function updateTeamFilter() {
  const select = document.getElementById('filter-team');
  select.innerHTML = '<option value="all">All Teams</option>';
  
  config.teams.forEach(team => {
    const opt = document.createElement('option');
    opt.value = team.id;
    opt.textContent = team.name;
    select.appendChild(opt);
  });
}

// Render clips list
function renderClips() {
  const container = document.getElementById('clips-list');
  const emptyState = document.getElementById('empty-state');
  
  // Filter clips
  let filtered = allClips;
  
  if (filterVideo !== 'all') {
    filtered = filtered.filter(c => c.videoId === filterVideo);
  }
  
  if (filterTeam !== 'all') {
    filtered = filtered.filter(c => c.teamId === filterTeam);
  }
  
  // Sort by date (newest first)
  filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  if (filtered.length === 0) {
    emptyState.classList.remove('hidden');
    container.innerHTML = '';
    return;
  }
  
  emptyState.classList.add('hidden');
  
  // Group by video
  const groups = {};
  filtered.forEach(c => {
    const key = c.videoId;
    if (!groups[key]) {
      groups[key] = {
        title: c.videoTitle || 'Video',
        videoId: c.videoId,
        clips: []
      };
    }
    groups[key].clips.push(c);
  });
  
  // Render
  container.innerHTML = Object.values(groups).map(group => `
    <div class="video-group">
      <div class="video-title">${group.title}</div>
      ${group.clips.map(c => clipCardHTML(c)).join('')}
    </div>
  `).join('');
  
  // Attach listeners
  attachClipListeners();
}

// Generate clip card HTML
function clipCardHTML(c) {
  const outcomeClass = c.outcome === 'success' ? 'success' : c.outcome === 'fail' ? 'fail' : '';
  const outcomeText = c.outcome === 'success' ? 'OK' : c.outcome === 'fail' ? 'X' : '-';
  
  return `
    <div class="clip-card ${outcomeClass}" data-id="${c.id}">
      <div class="clip-header">
        <span class="clip-team" style="background: ${c.teamColor || '#3B82F6'}">${c.teamName || 'Tim'}</span>
        <span class="clip-cat">${c.categoryName || 'Category'}</span>
        <span class="clip-outcome ${outcomeClass}">${outcomeText}</span>
      </div>
      <div class="clip-time">${formatTime(c.startTime)} - ${formatTime(c.endTime)} <span class="clip-dur">${Math.round(c.endTime - c.startTime)}s</span></div>
      <div class="clip-adjust">
        <div class="adjust-row">
          <button class="adj-btn" data-id="${c.id}" data-type="start" data-dir="-1">-1s</button>
          <button class="adj-btn" data-id="${c.id}" data-type="start" data-dir="1">+1s</button>
          <span class="adjust-label">Start</span>
        </div>
        <div class="adjust-row">
          <button class="adj-btn" data-id="${c.id}" data-type="end" data-dir="-1">-1s</button>
          <button class="adj-btn" data-id="${c.id}" data-type="end" data-dir="1">+1s</button>
          <span class="adjust-label">End</span>
        </div>
      </div>
      <div class="clip-actions">
        <button class="clip-btn open" data-vid="${c.videoId}" data-start="${c.startTime}">Open in YouTube</button>
        <button class="clip-btn delete" data-id="${c.id}">X</button>
      </div>
    </div>
  `;
}

// Attach clip action listeners
function attachClipListeners() {
  // Open buttons
  document.querySelectorAll('.clip-btn.open').forEach(btn => {
    btn.onclick = () => {
      const vid = btn.dataset.vid;
      const start = Math.floor(parseFloat(btn.dataset.start));
      chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${vid}&t=${start}s` });
    };
  });
  
  // Delete buttons
  document.querySelectorAll('.clip-btn.delete').forEach(btn => {
    btn.onclick = async () => {
      if (confirm('Delete this clip?')) {
        const id = btn.dataset.id;
        allClips = allClips.filter(c => c.id !== id);
        await chrome.storage.local.set({ [STORAGE_KEY]: allClips });
        loadClips();
      }
    };
  });

  // Adjust duration buttons
  document.querySelectorAll('.adj-btn').forEach(btn => {
    btn.onclick = async () => {
      const clipId = btn.dataset.id;
      const type = btn.dataset.type; // 'start' or 'end'
      const dir = parseInt(btn.dataset.dir); // -1 or 1
      
      const clip = allClips.find(c => c.id === clipId);
      
      if (clip) {
        if (type === 'start') {
          const newStart = clip.startTime + dir;
          if (newStart >= 0 && newStart < clip.endTime - 1) {
            clip.startTime = newStart;
          }
        } else if (type === 'end') {
          const newEnd = clip.endTime + dir;
          if (newEnd > clip.startTime + 1) {
            clip.endTime = newEnd;
          }
        }
        
        await chrome.storage.local.set({ [STORAGE_KEY]: allClips });
        renderClips();
      }
    };
  });
}

// Generate WhatsApp summary - SINGLE LINK WITH ALL CLIPS
function generateWhatsAppSummary(clips) {
  if (clips.length === 0) return '';
  
  const videoId = clips[0]?.videoId;
  const videoTitle = clips[0]?.videoTitle || 'Video';
  const shortTitle = videoTitle.length > 40 ? videoTitle.substring(0, 40) + '...' : videoTitle;
  
  // Build category order map from config (for consistent sorting)
  const categoryOrder = {};
  config.categories.forEach((cat, idx) => {
    categoryOrder[cat.id] = idx;
  });
  
  // Build team order map from config
  const teamOrder = {};
  config.teams.forEach((team, idx) => {
    teamOrder[team.id] = idx;
  });
  
  // Group by team
  const teams = {};
  clips.forEach(c => {
    const teamKey = c.teamId || 'unknown';
    if (!teams[teamKey]) {
      teams[teamKey] = { 
        id: teamKey,
        name: c.teamName || 'Unknown', 
        order: teamOrder[teamKey] !== undefined ? teamOrder[teamKey] : 999,
        categories: {}, 
        clips: [] 
      };
    }
    const catKey = c.category;
    if (!teams[teamKey].categories[catKey]) {
      teams[teamKey].categories[catKey] = { 
        id: catKey,
        name: c.categoryName, 
        order: categoryOrder[catKey] !== undefined ? categoryOrder[catKey] : 999,
        total: 0, 
        success: 0, 
        fail: 0, 
        clipData: [] 
      };
    }
    teams[teamKey].categories[catKey].total++;
    if (c.outcome === 'success') teams[teamKey].categories[catKey].success++;
    if (c.outcome === 'fail') teams[teamKey].categories[catKey].fail++;
    teams[teamKey].categories[catKey].clipData.push([Math.floor(c.startTime), Math.floor(c.endTime)]);
    teams[teamKey].clips.push(c);
  });

  // Sort teams and categories by config order
  const sortedTeams = Object.values(teams).sort((a, b) => a.order - b.order);
  sortedTeams.forEach(team => {
    team.sortedCategories = Object.values(team.categories).sort((a, b) => a.order - b.order);
  });

  // Build data structure for URL encoding
  const clipData = {
    title: shortTitle,
    teams: sortedTeams.map(team => ({
      name: team.name,
      categories: team.sortedCategories.map(cat => ({
        name: cat.name,
        clips: cat.clipData.sort((a, b) => a[0] - b[0])
      }))
    }))
  };
  
  // Encode data to base64
  const encodedData = btoa(unescape(encodeURIComponent(JSON.stringify(clipData))));
  
  // Generate single URL with all clips
  const clipViewerUrl = `https://courtvision.id/clip?v=${videoId}&d=${encodedData}`;

  // Build WhatsApp text
  let text = `*GAME ANALYSIS*\n`;
  text += `${shortTitle}\n`;
  text += `${new Date().toLocaleDateString()}\n`;
  text += `━━━━━━━━━━━━━━━━\n\n`;

  sortedTeams.forEach(team => {
    text += `*${team.name.toUpperCase()}*\n`;
    team.sortedCategories.forEach(cat => {
      let line = `• ${cat.name}: ${cat.total}`;
      if (cat.success > 0 || cat.fail > 0) {
        const parts = [];
        if (cat.success > 0) parts.push(`${cat.success} ✓`);
        if (cat.fail > 0) parts.push(`${cat.fail} ✗`);
        line += ` (${parts.join(', ')})`;
      }
      text += line + '\n';
    });
    text += '\n';
  });

  const total = clips.length;
  const success = clips.filter(c => c.outcome === 'success').length;
  const fail = clips.filter(c => c.outcome === 'fail').length;
  
  text += `━━━━━━━━━━━━━━━━\n`;
  text += `*TOTAL: ${total} clips*\n`;
  if (success > 0) text += `✓ Made: ${success}\n`;
  if (fail > 0) text += `✗ Missed: ${fail}\n`;
  text += `━━━━━━━━━━━━━━━━\n\n`;
  
  // Single link to view all clips
  text += `📱 *Klik untuk lihat semua clips:*\n`;
  text += `${clipViewerUrl}\n\n`;
  text += `_Auto-play & auto-stop tiap clip!_\n`;
  text += `_CourtVision_`;
  
  return text;
}

// ============================================
// TRIAL & LICENSE SYSTEM (v3.0.0)
// ============================================

// Check user status: 'pro' | 'trial' | 'expired'
// v3.1.0: Validates license with Polar API on every open (with 6-hour cache)
async function checkUserStatus() {
  try {
    const licenseResult = await chrome.storage.local.get([LICENSE_KEY]);
    const licenseKey = licenseResult[LICENSE_KEY];

    if (licenseKey && validateLicenseFormat(licenseKey)) {
      const now = Date.now();
      const cacheResult = await chrome.storage.local.get([LICENSE_CACHE_KEY]);
      const cache = cacheResult[LICENSE_CACHE_KEY];

      // Cache masih segar (< 6 jam) dan key sama — pakai cache
      if (cache && cache.key === licenseKey && cache.valid && (now - cache.timestamp) < LICENSE_CACHE_DURATION) {
        return { status: 'pro', license: licenseKey };
      }

      // Cache expired atau tidak ada — validasi ke Polar API
      const isValid = await validateLicenseWithPolar(licenseKey);

      if (isValid === true) {
        // Update cache dengan timestamp baru
        await chrome.storage.local.set({
          [LICENSE_CACHE_KEY]: { key: licenseKey, valid: true, timestamp: now }
        });
        return { status: 'pro', license: licenseKey };
      }

      // isValid === null = network error, isValid === false = benar-benar invalid
      // Cek grace period offline (24 jam dari last valid cache)
      if (isValid === null && cache && cache.key === licenseKey && cache.valid && (now - cache.timestamp) < OFFLINE_GRACE_PERIOD) {
        console.warn('CourtVision: Polar unreachable, using offline grace period');
        return { status: 'pro', license: licenseKey };
      }

      // Keep the key during outages, without extending Pro access beyond grace.
      if (isValid === null) {
        return { status: 'error', message: 'Tidak dapat memverifikasi lisensi. Coba lagi saat koneksi tersedia.' };
      }

      // License benar-benar tidak valid — hapus dari storage
      await chrome.storage.local.remove([LICENSE_KEY, LICENSE_CACHE_KEY]);
      // Lanjut ke pengecekan trial di bawah
    }

    // Cek trial
    const trialResult = await chrome.storage.local.get([TRIAL_KEY]);
    let trial = trialResult[TRIAL_KEY];

    if (!trial) {
      // Install pertama — mulai trial
      const now = new Date();
      const expires = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
      trial = {
        installDate: now.toISOString(),
        expiresAt: expires.toISOString()
      };
      await chrome.storage.local.set({ [TRIAL_KEY]: trial });
      return { status: 'trial', daysLeft: TRIAL_DAYS };
    }

    const expiresAt = new Date(trial.expiresAt);
    const now = new Date();
    if (now < expiresAt) {
      const daysLeft = Math.max(1, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)));
      return { status: 'trial', daysLeft };
    }

    return { status: 'expired' };
  } catch (err) {
    console.error('Error checking user status:', err);
    return { status: 'error', message: 'Tidak dapat memverifikasi status. Cek koneksi internet.' };
  }
}

// ============================================
// TRIAL & LICENSE SYSTEM (v3.0.0)
// ============================================

const POLAR_ORG_ID = '0be66be6-c4e2-4c59-8980-6e0a418fe30f';
const POLAR_ACTIVATE_URL = 'https://api.polar.sh/v1/customer-portal/license-keys/activate';
const POLAR_VALIDATE_URL = 'https://api.polar.sh/v1/customer-portal/license-keys/validate';

// Polar API calls di-route ke background service worker
async function validateLicenseWithPolar(key) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: 'polarValidate', key: key.trim() },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        if (!response) resolve(null);
        else if (response.valid === null) resolve(null);
        else resolve(response.valid === true ? true : false);
      }
    );
  });
}

// Activate = validate (key tidak support activations per Polar response)
async function activateLicenseWithPolar(key) {
  const result = await validateLicenseWithPolar(key);
  if (result === true) return { success: true };
  if (result === null) return { success: false, networkError: true };
  return { success: false };
}

// Validate license key format (Polar format: XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX)
function validateLicenseFormat(key) {
  if (!key) return false;
  const trimmed = key.trim().toUpperCase();
  // Format 1: Pure UUID — XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
  const polarPattern = /^[A-Z0-9]{8}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{12}$/;
  // Format 2: CV-prefixed UUID — CV-XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
  const cvUuidPattern = /^CV-[A-Z0-9]{8}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{12}$/;
  // Format 3: Old short CV format — CV-XXXX-XXXX-XXXX
  const cvShortPattern = /^CV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
  return polarPattern.test(trimmed) || cvUuidPattern.test(trimmed) || cvShortPattern.test(trimmed);
}

// Load license from storage
async function loadLicense() {
  try {
    const userStatus = await checkUserStatus();
    trialStatus = userStatus;

    if (userStatus.status === 'pro') {
      isPro = true;
    } else {
      isPro = false;
    }

    updateLicenseUI(userStatus);
    updateExportButtons();
  } catch (err) {
    console.error('Error loading license:', err);
    isPro = false;
  }
}

// Save license to storage
async function saveLicense(key) {
  try {
    await chrome.storage.local.set({ [LICENSE_KEY]: key.toUpperCase().trim() });
    isPro = true;
    const userStatus = { status: 'pro', license: key.toUpperCase().trim() };
    trialStatus = userStatus;
    updateLicenseUI(userStatus);
    updateExportButtons();
    return true;
  } catch (err) {
    console.error('Error saving license:', err);
    return false;
  }
}

// Update license UI based on user status
function updateLicenseUI(userStatus) {
  const statusEl = document.getElementById('license-status');
  const infoEl = document.getElementById('license-info');
  const inputEl = document.getElementById('license-key');
  const upgradeBtn = document.getElementById('btn-upgrade');
  const trialBanner = document.getElementById('trial-banner');

  if (userStatus.status === 'pro') {
    // PRO USER
    statusEl.innerHTML = '<span class="license-icon">💎</span><span class="license-text">Pro Version Active</span>';
    statusEl.className = 'license-status pro';
    infoEl.textContent = 'License: ' + userStatus.license;
    infoEl.className = 'license-info success';
    if (inputEl) inputEl.value = userStatus.license;
    if (upgradeBtn) upgradeBtn.classList.add('hidden');
    if (trialBanner) trialBanner.style.display = 'none';

  } else if (userStatus.status === 'trial') {
    // TRIAL USER
    statusEl.innerHTML = `<span class="license-icon">🎁</span><span class="license-text">Free Trial — ${userStatus.daysLeft} day${userStatus.daysLeft !== 1 ? 's' : ''} left</span>`;
    statusEl.className = 'license-status trial';
    infoEl.className = 'license-info';
    if (upgradeBtn) upgradeBtn.classList.remove('hidden');
    if (trialBanner) {
      trialBanner.style.display = 'block';
      trialBanner.textContent = `🎁 Free Trial: ${userStatus.daysLeft} day${userStatus.daysLeft !== 1 ? 's' : ''} left`;
    }

  } else if (userStatus.status === 'error') {
    // ERROR — tidak bisa verifikasi status, lock semua fitur
    statusEl.innerHTML = '<span class="license-icon">⚠️</span><span class="license-text">Verifikasi Gagal</span>';
    statusEl.className = 'license-status expired';
    infoEl.textContent = userStatus.message || 'Tidak dapat memverifikasi status. Cek koneksi internet.';
    infoEl.className = 'license-info error';
    if (upgradeBtn) upgradeBtn.classList.add('hidden');
    if (trialBanner) {
      trialBanner.style.display = 'block';
      trialBanner.textContent = '⚠️ Koneksi bermasalah — tutup dan buka ulang CourtVision';
      trialBanner.style.background = '#FEE2E2';
      trialBanner.style.color = '#DC2626';
    }

  } else {
    // EXPIRED USER
    statusEl.innerHTML = '<span class="license-icon">⚠️</span><span class="license-text">Trial Expired</span>';
    statusEl.className = 'license-status expired';
    infoEl.textContent = 'Your trial has ended. Upgrade to continue exporting.';
    infoEl.className = 'license-info error';
    if (upgradeBtn) upgradeBtn.classList.remove('hidden');
    if (trialBanner) {
      trialBanner.style.display = 'block';
      trialBanner.textContent = '⚠️ Trial expired — upgrade to export';
      trialBanner.style.background = '#FEE2E2';
      trialBanner.style.color = '#DC2626';
    }
  }
}

// Update export buttons based on status
function updateExportButtons() {
  const waBtn = document.getElementById('btn-copy-wa');
  const jsonBtn = document.getElementById('btn-export-json');
  const csvBtn = document.getElementById('btn-export-csv');
  const xmlBtn = document.getElementById('btn-export-xml');

  const canExport = isPro || (trialStatus && trialStatus.status === 'trial');

  if (canExport) {
    [waBtn, jsonBtn, csvBtn, xmlBtn].forEach(btn => {
      if (btn) {
        btn.classList.remove('locked');
        btn.disabled = false;
      }
    });
  } else {
    // EXPIRED — lock export buttons
    [waBtn, jsonBtn, csvBtn, xmlBtn].forEach(btn => {
      if (btn) {
        btn.classList.add('locked');
        btn.disabled = true;
      }
    });
  }
}

// Format license key as user types
// Supports: pure UUID, CV-prefixed UUID, old CV-short format
function formatLicenseInput(input) {
  const raw = input.value.trim().toUpperCase();

  // Format 1: Pure UUID — biarkan apa adanya
  const polarPattern = /^[A-Z0-9]{8}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{12}$/;
  if (polarPattern.test(raw)) {
    input.value = raw;
    return;
  }

  // Format 2: CV-prefixed UUID — biarkan apa adanya
  const cvUuidPattern = /^CV-[A-Z0-9]{8}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{12}$/;
  if (cvUuidPattern.test(raw)) {
    input.value = raw;
    return;
  }

  // Format 3: Old CV-short — auto-format CV-XXXX-XXXX-XXXX
  const value = raw.replace(/[^A-Z0-9]/g, '');
  if (value.startsWith('CV') || value.length === 0) {
    let formatted = '';
    const parts = value.replace('CV', '').match(/.{1,4}/g) || [];
    if (value.startsWith('CV')) {
      formatted = 'CV';
      if (parts.length > 0) formatted += '-' + parts[0];
      if (parts.length > 1) formatted += '-' + parts[1];
      if (parts.length > 2) formatted += '-' + parts[2];
    }
    input.value = formatted;
  }
}


// ============================================
// SERVER-SIDE VERSION CHECK (v3.1.6)
// ============================================
const VERSION_CHECK_URL = 'https://courtvision.id/version.json';

function compareVersions(v1, v2) {
  const a = v1.split('.').map(Number);
  const b = v2.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function showForceUpdateScreen() {
  document.body.innerHTML = `
    <div style="
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      background: #1E3A5F;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      text-align: center;
      color: white;
    ">
      <div style="font-size: 48px; margin-bottom: 16px;">🔄</div>
      <div style="font-size: 16px; font-weight: 800; margin-bottom: 8px;">
        Update Diperlukan
      </div>
      <div style="font-size: 13px; color: rgba(255,255,255,0.7); margin-bottom: 24px; line-height: 1.6;">
        Versi CourtVision ini sudah tidak didukung.<br>
        Update gratis tersedia di Chrome Web Store.
      </div>
      <a href="https://chrome.google.com/webstore/detail/oklbkdldkcchgihmadhbgojnamadihig"
         target="_blank"
         style="
           display: block;
           background: #10B981;
           color: white;
           padding: 12px 24px;
           border-radius: 8px;
           text-decoration: none;
           font-size: 14px;
           font-weight: 700;
         ">
        Update Sekarang
      </a>
      <div style="font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 16px;">
        CourtVision · courtvision.id
      </div>
    </div>
  `;
}

async function checkMinVersion() {
  try {
    const res = await fetch(VERSION_CHECK_URL, { cache: 'no-store' });
    const data = await res.json();
    const current = chrome.runtime.getManifest().version;
    if (data.minVersion && compareVersions(current, data.minVersion) < 0) {
      showForceUpdateScreen();
      return false;
    }
    return true;
  } catch {
    // Server tidak bisa dicapai — izinkan tetap jalan
    return true;
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  const versionOk = await checkMinVersion();
  if (!versionOk) return;
  loadLicense();
  loadClips();
  
  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    };
  });
  
  // Refresh button
  document.getElementById('btn-refresh').onclick = loadClips;
  
  // Video filter
  document.getElementById('filter-video').onchange = e => {
    filterVideo = e.target.value;
    renderClips();
  };
  
  // Team filter
  document.getElementById('filter-team').onchange = e => {
    filterTeam = e.target.value;
    renderClips();
  };
  
  // License key input formatting
  document.getElementById('license-key').addEventListener('input', (e) => {
    formatLicenseInput(e.target);
  });
  
  // Activate license button
  document.getElementById('btn-activate').onclick = async () => {
    const input = document.getElementById('license-key');
    const infoEl = document.getElementById('license-info');
    const key = input.value.trim();

    if (!key) {
      infoEl.textContent = 'Please enter a license key';
      infoEl.className = 'license-info error';
      return;
    }

    if (!validateLicenseFormat(key)) {
      infoEl.textContent = 'Invalid key format. Check your email from Polar.';
      infoEl.className = 'license-info error';
      return;
    }

    // Show loading state
    const btn = document.getElementById('btn-activate');
    btn.textContent = 'Validating...';
    btn.disabled = true;
    infoEl.textContent = 'Checking license with Polar...';
    infoEl.className = 'license-info';
    infoEl.style.display = 'block';

    try {
      // Aktivasi ke Polar API (endpoint yang benar untuk client-side)
      const result = await activateLicenseWithPolar(key);

      if (result.success) {
        await chrome.storage.local.set({
          [LICENSE_KEY]: key.toUpperCase().trim(),
          [LICENSE_CACHE_KEY]: { key: key.toUpperCase().trim(), valid: true, timestamp: Date.now() }
        });
        isPro = true;
        const userStatus = { status: 'pro', license: key.toUpperCase().trim() };
        trialStatus = userStatus;
        updateLicenseUI(userStatus);
        updateExportButtons();
      } else if (result.networkError) {
        infoEl.textContent = 'Tidak dapat terhubung ke server. Cek koneksi internet dan coba lagi.';
        infoEl.className = 'license-info error';
      } else {
        infoEl.textContent = 'License key tidak valid atau sudah dipakai di perangkat lain. Cek email dari Polar.';
        infoEl.className = 'license-info error';
      }
    } catch (err) {
      infoEl.textContent = 'Network error. Please check your connection and try again.';
      infoEl.className = 'license-info error';
    } finally {
      btn.textContent = 'Activate';
      btn.disabled = false;
    }
  };
  
  // Copy WhatsApp - reliable clipboard method
  document.getElementById('btn-copy-wa').onclick = async () => {
    let clips = allClips;
    if (filterVideo !== 'all') {
      clips = clips.filter(c => c.videoId === filterVideo);
    }
    
    if (clips.length === 0) {
      alert('No clips available');
      return;
    }
    
    const summary = generateWhatsAppSummary(clips);
    let copySuccess = false;
    
    // Method 1: textarea + execCommand (most reliable in extension popup)
    try {
      const ta = document.createElement('textarea');
      ta.value = summary;
      ta.style.position = 'fixed';
      ta.style.left = '0';
      ta.style.top = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, summary.length);
      copySuccess = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (err) {
      console.error('execCommand failed:', err);
    }
    
    // Method 2: navigator.clipboard as fallback
    if (!copySuccess) {
      try {
        await navigator.clipboard.writeText(summary);
        copySuccess = true;
      } catch (err) {
        console.error('clipboard API failed:', err);
      }
    }
    
    // Show result
    if (copySuccess) {
      const btn = document.getElementById('btn-copy-wa');
      const originalText = btn.textContent;
      btn.textContent = '✓ Copied!';
      btn.style.background = '#10B981';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '';
      }, 2000);
    } else {
      alert('Copy failed. Please try again or use Export buttons.');
    }
  };
  
  // Export JSON
  document.getElementById('btn-export-json').onclick = () => {
    const blob = new Blob([JSON.stringify(allClips, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'courtvision.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  
  // Export CSV
  document.getElementById('btn-export-csv').onclick = () => {
    let csv = 'Team,Category,Outcome,Video,Start,End,Duration,URL\n';
    allClips.forEach(c => {
      const dur = Math.round(c.endTime - c.startTime);
      const url = `https://www.youtube.com/watch?v=${c.videoId}&t=${Math.floor(c.startTime)}s`;
      const outcome = c.outcome === 'success' ? 'Made' : c.outcome === 'fail' ? 'Missed' : '-';
      csv += `"${c.teamName}","${c.categoryName}","${outcome}","${c.videoTitle}","${formatTime(c.startTime)}","${formatTime(c.endTime)}","${dur}s","${url}"\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'courtvision.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  
  // Export XML (Hudl Sportscode format)
  document.getElementById('btn-export-xml').onclick = () => {
    if (allClips.length === 0) {
      alert('No clips to export');
      return;
    }
    
    // Get color codes for categories from config
    const categoryColors = {};
    config.categories.forEach((cat, idx) => {
      categoryColors[cat.id] = idx + 1;
    });
    
    // Sort clips by start time
    const sortedClips = [...allClips].sort((a, b) => a.startTime - b.startTime);
    
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<file>\n`;
    xml += `  <SESSION_INFO>\n`;
    xml += `    <start_time>0</start_time>\n`;
    xml += `  </SESSION_INFO>\n`;
    xml += `  <ALL_INSTANCES>\n`;
    
    sortedClips.forEach((c, index) => {
      const start = Math.floor(c.startTime);
      const end = Math.floor(c.endTime);
      const code = escapeXml(c.categoryName || 'Unknown');
      const team = escapeXml(c.teamName || 'Unknown');
      const outcome = c.outcome === 'success' ? 'Made' : c.outcome === 'fail' ? 'Missed' : '';
      
      xml += `    <instance>\n`;
      xml += `      <ID>${index + 1}</ID>\n`;
      xml += `      <start>${start}</start>\n`;
      xml += `      <end>${end}</end>\n`;
      xml += `      <code>${code}</code>\n`;
      xml += `      <label>\n`;
      xml += `        <group>Team</group>\n`;
      xml += `        <text>${team}</text>\n`;
      xml += `      </label>\n`;
      if (outcome) {
        xml += `      <label>\n`;
        xml += `        <group>Outcome</group>\n`;
        xml += `        <text>${outcome}</text>\n`;
        xml += `      </label>\n`;
      }
      xml += `    </instance>\n`;
    });
    
    xml += `  </ALL_INSTANCES>\n`;
    
    // Add ROWS section (color coding for Sportscode timeline)
    xml += `  <ROWS>\n`;
    config.categories.forEach((cat, idx) => {
      const r = parseInt(cat.color.slice(1, 3), 16) / 255;
      const g = parseInt(cat.color.slice(3, 5), 16) / 255;
      const b = parseInt(cat.color.slice(5, 7), 16) / 255;
      xml += `    <row>\n`;
      xml += `      <code>${escapeXml(cat.name)}</code>\n`;
      xml += `      <R>${r.toFixed(6)}</R>\n`;
      xml += `      <G>${g.toFixed(6)}</G>\n`;
      xml += `      <B>${b.toFixed(6)}</B>\n`;
      xml += `    </row>\n`;
    });
    xml += `  </ROWS>\n`;
    xml += `</file>\n`;
    
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const filename = (allClips[0]?.videoTitle || 'courtvision').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
    a.download = `${filename}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  // Helper for XML escaping
  function escapeXml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
  
  // Clear all
  document.getElementById('btn-clear-all').onclick = async () => {
    if (confirm('Delete ALL clips? This action cannot be undone!')) {
      await chrome.storage.local.set({ [STORAGE_KEY]: [] });
      loadClips();
    }
  };
});
