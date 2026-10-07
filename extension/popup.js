/**
 * CourtVision Popup - Full Clips Manager
 * v3.4.0 - Production account and Duitku activation
 */

const STORAGE_KEY = 'courtvision_clips';
const CONFIG_KEY = 'courtvision_config';

let allClips = [];
let config = {
  teams: [
    { id: 'team-1', name: 'My Team', color: '#C9DF57' },
    { id: 'team-2', name: 'Opponent', color: '#A890ED' }
  ],
  categories: []
};
let filterVideo = 'all';
let filterTeam = 'all';
let isPro = false;
let trialStatus = { status: 'signed-out' };
let licenseAccount = null;

function sendLicenseMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { error: 'Server tidak merespons' });
    });
  });
}

function userStatusFromEntitlement(entitlement) {
  if (!entitlement) return { status: 'expired' };
  if (entitlement.status === 'pro') {
    return { status: 'pro', validUntil: entitlement.validUntil || null };
  }
  if (entitlement.status === 'trial') {
    const seconds = Math.max(0, (entitlement.trialEndsAt || 0) - Math.floor(Date.now() / 1000));
    return {
      status: 'trial',
      daysLeft: Math.max(1, Math.ceil(seconds / 86400)),
      validUntil: entitlement.trialEndsAt || null
    };
  }
  return { status: 'expired' };
}

async function loadLicenseAccount() {
  const accountName = document.getElementById('account-name');
  const accountDetail = document.getElementById('account-detail');
  const signIn = document.getElementById('btn-google-signin');
  const signOut = document.getElementById('btn-google-logout');
  const result = await sendLicenseMessage({ action: 'licenseServerStatus' });
  licenseAccount = result.signedIn ? result : null;
  if (!licenseAccount) {
    accountName.textContent = 'Belum masuk';
    accountDetail.textContent = result.error || 'Masuk sekali untuk memulai trial dan menghubungkan akses ke laptop ini.';
    signIn.classList.remove('hidden');
    signOut.classList.add('hidden');
    trialStatus = result.error
      ? { status: 'error', message: result.error }
      : { status: 'signed-out' };
    isPro = false;
    updateLicenseUI(trialStatus);
    updateExportButtons();
    return;
  }

  accountName.textContent = licenseAccount.user?.name || licenseAccount.user?.email || 'Akun CourtVision';
  const activeDevices = licenseAccount.devices?.length || 1;
  const deviceLimit = licenseAccount.maxActiveDevices || 1;
  accountDetail.textContent = `${activeDevices} dari ${deviceLimit} laptop aktif`;
  signIn.classList.add('hidden');
  signOut.classList.remove('hidden');
  const serverStatus = userStatusFromEntitlement(licenseAccount.entitlement);
  trialStatus = serverStatus;
  isPro = serverStatus.status === 'pro';
  updateLicenseUI(serverStatus);
  updateExportButtons();
}

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

  const clipData = CourtVisionShare.createPayload(shortTitle, videoId, clips);
  const clipViewerUrl = CourtVisionShare.createUrl(clipData);

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
// PRODUCTION ACCOUNT STATUS
// ============================================

function formatAccessDate(timestamp) {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric'
  }).format(new Date(timestamp * 1000));
}

function updateLicenseUI(userStatus) {
  const statusEl = document.getElementById('license-status');
  const infoEl = document.getElementById('license-info');
  const upgradeBtn = document.getElementById('btn-upgrade');
  const trialBanner = document.getElementById('trial-banner');
  const badge = document.getElementById('account-badge');
  if (trialBanner) trialBanner.classList.remove('error');

  if (userStatus.status === 'pro') {
    statusEl.innerHTML = '<span class="license-icon">✓</span><span class="license-text">CourtVision PRO aktif</span>';
    statusEl.className = 'license-status pro';
    infoEl.textContent = userStatus.validUntil
      ? `Akses aktif sampai ${formatAccessDate(userStatus.validUntil)}`
      : 'Akses PRO aktif pada akun ini.';
    infoEl.className = 'license-info success';
    if (upgradeBtn) upgradeBtn.classList.add('hidden');
    if (trialBanner) trialBanner.style.display = 'none';
    if (badge) badge.textContent = 'PRO';

  } else if (userStatus.status === 'trial') {
    statusEl.innerHTML = `<span class="license-icon">◷</span><span class="license-text">Trial aktif · ${userStatus.daysLeft} hari tersisa</span>`;
    statusEl.className = 'license-status trial';
    infoEl.textContent = userStatus.validUntil
      ? `Trial berakhir ${formatAccessDate(userStatus.validUntil)}`
      : 'Nikmati semua fitur selama masa trial.';
    infoEl.className = 'license-info';
    if (upgradeBtn) upgradeBtn.classList.remove('hidden');
    if (trialBanner) {
      trialBanner.style.display = 'block';
      trialBanner.textContent = `Trial · ${userStatus.daysLeft} hari tersisa`;
    }
    if (badge) badge.textContent = `TRIAL · ${userStatus.daysLeft}H`;

  } else if (userStatus.status === 'error') {
    statusEl.innerHTML = '<span class="license-icon">!</span><span class="license-text">Status belum dapat diperiksa</span>';
    statusEl.className = 'license-status expired';
    infoEl.textContent = userStatus.message || 'Periksa koneksi lalu tekan tombol refresh.';
    infoEl.className = 'license-info error';
    if (upgradeBtn) upgradeBtn.classList.add('hidden');
    if (trialBanner) {
      trialBanner.style.display = 'block';
      trialBanner.textContent = 'Koneksi bermasalah · tekan refresh untuk mencoba lagi';
      trialBanner.classList.add('error');
    }
    if (badge) badge.textContent = 'OFFLINE';

  } else if (userStatus.status === 'signed-out') {
    statusEl.innerHTML = '<span class="license-icon">●</span><span class="license-text">Belum masuk</span>';
    statusEl.className = 'license-status expired';
    infoEl.textContent = 'Masuk dengan Google untuk memulai trial gratis selama tujuh hari.';
    infoEl.className = 'license-info';
    if (upgradeBtn) upgradeBtn.classList.add('hidden');
    if (trialBanner) {
      trialBanner.style.display = 'block';
      trialBanner.textContent = 'Masuk dengan Google untuk memulai trial';
    }
    if (badge) badge.textContent = 'BELUM MASUK';

  } else {
    statusEl.innerHTML = '<span class="license-icon">!</span><span class="license-text">Masa akses berakhir</span>';
    statusEl.className = 'license-status expired';
    infoEl.textContent = 'Aktifkan PRO untuk kembali menggunakan fitur ekspor.';
    infoEl.className = 'license-info error';
    if (upgradeBtn) upgradeBtn.classList.remove('hidden');
    if (trialBanner) {
      trialBanner.style.display = 'block';
      trialBanner.textContent = 'Masa trial berakhir · aktifkan PRO untuk melanjutkan';
      trialBanner.classList.add('error');
    }
    if (badge) badge.textContent = 'AKSES BERAKHIR';
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
      background: #111813;
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
      <a href="https://chromewebstore.google.com/detail/oklbkdldkcchgihmadhbgojnamadihig"
         target="_blank"
         style="
           display: block;
           background: #C9DF57;
           color: #16211B;
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
  await loadLicenseAccount();
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
  document.getElementById('btn-refresh').onclick = async () => {
    await loadLicenseAccount();
    await loadClips();
  };
  
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
  
  document.getElementById('btn-google-signin').onclick = async () => {
    const button = document.getElementById('btn-google-signin');
    const detail = document.getElementById('account-detail');
    button.disabled = true;
    button.textContent = 'Menghubungkan…';
    const result = await sendLicenseMessage({ action: 'licenseServerSignIn' });
    button.disabled = false;
    button.textContent = 'Masuk Google';
    if (result.error) {
      detail.textContent = result.error;
      return;
    }
    await loadLicenseAccount();
  };

  document.getElementById('btn-google-logout').onclick = async () => {
    await sendLicenseMessage({ action: 'licenseServerLogout' });
    await loadLicenseAccount();
  };

  async function startCheckout(plan, button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    const result = await sendLicenseMessage({ action: 'openCheckout', plan });
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (result.error) {
      document.getElementById('license-info').textContent = result.error;
      document.getElementById('license-info').className = 'license-info error';
    }
  }

  const monthlyButton = document.getElementById('btn-upgrade-monthly');
  const yearlyButton = document.getElementById('btn-upgrade-yearly');
  monthlyButton.onclick = () => startCheckout('monthly', monthlyButton);
  yearlyButton.onclick = () => startCheckout('yearly', yearlyButton);
  
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
      btn.style.background = '#AFC63F';
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

  // Restore a local backup without deleting clips created after the backup.
  const importInput = document.getElementById('import-json-file');
  document.getElementById('btn-import-json').onclick = () => {
    importInput.value = '';
    importInput.click();
  };
  importInput.onchange = async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const imported = Array.isArray(parsed) ? parsed : parsed?.clips;
      if (!Array.isArray(imported) || imported.some(clip => !clip || typeof clip !== 'object')) {
        throw new Error('invalid_backup');
      }

      const clipKey = clip => clip.id || [
        clip.videoId,
        clip.startTime,
        clip.endTime,
        clip.teamId || clip.teamName,
        clip.categoryId || clip.categoryName,
        clip.createdAt
      ].join('|');
      const merged = new Map(allClips.map(clip => [clipKey(clip), clip]));
      imported.forEach(clip => merged.set(clipKey(clip), clip));
      const restored = [...merged.values()];
      await chrome.storage.local.set({ [STORAGE_KEY]: restored });
      await loadClips();
      alert(`${imported.length} klip dibaca. Sekarang tersimpan ${restored.length} klip tanpa menghapus klip yang sudah ada.`);
    } catch (error) {
      console.error('Import backup failed:', error);
      alert('File cadangan tidak valid. Pilih file JSON yang dibuat oleh CourtVision.');
    }
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
