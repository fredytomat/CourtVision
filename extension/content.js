/**
 * CourtVision - Professional Basketball Video Analysis
 * Version: 2.6.0 (Custom Teams & Categories)
 */
(function() {
  'use strict';

  // ============================================
  // DEFAULT CONFIGURATION
  // ============================================
  
  const DEFAULT_TEAMS = [
    { id: 'team-1', name: 'My Team', color: '#1E3A5F' },
    { id: 'team-2', name: 'Opponent', color: '#DC2626' }
  ];

  const DEFAULT_CATEGORIES = [
    { id: 'cat-1', name: 'Transition', color: '#F59E0B' },
    { id: 'cat-2', name: 'Set Play', color: '#10B981' },
    { id: 'cat-3', name: 'Zone Off', color: '#3B82F6' },
    { id: 'cat-4', name: 'Defense', color: '#8B5CF6' },
    { id: 'cat-5', name: 'Zone Def', color: '#EC4899' },
    { id: 'cat-6', name: 'Press', color: '#F43F5E' },
    { id: 'cat-7', name: 'BLOB', color: '#14B8A6' },
    { id: 'cat-8', name: 'SLOB', color: '#0EA5E9' }
  ];

  const STORAGE_KEYS = {
    CLIPS: 'courtvision_clips',
    POSITION: 'courtvision_pos',
    SETTINGS: 'courtvision_settings',
    CONFIG: 'courtvision_config'
  };

  // Dynamic config (loaded from storage)
  let config = {
    teams: [...DEFAULT_TEAMS],
    categories: [...DEFAULT_CATEGORIES]
  };

  let settings = { clipBefore: 7, clipAfter: 17 };
  let currentFilter = 'current';
  let currentCategory = 'all';
  let currentTeamFilter = 'all';
  let selectedTeam = 'team-1';
  let isPanelVisible = true;
  let isMinimized = false;
  let settingsTab = 'clip'; // 'clip', 'teams', 'categories'
  let draggedCatIndex = null;

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================

  function formatTime(s) {
    if (isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }

  function getVideoId() {
    return new URLSearchParams(window.location.search).get('v');
  }

  function getVideoTitle() {
    const el = document.querySelector('h1.ytd-video-primary-info-renderer, h1.ytd-watch-metadata, #title h1');
    return el ? el.textContent.trim() : 'Video';
  }

  function getPlayer() {
    return document.querySelector('video.html5-main-video');
  }

  function getCurrentTime() {
    const p = getPlayer();
    return p ? p.currentTime : 0;
  }

  function getDuration() {
    const p = getPlayer();
    return p ? p.duration : 0;
  }

  function generateId() {
    return 'id-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  // ============================================
  // CONFIG & SETTINGS STORAGE
  // ============================================

  async function loadConfig() {
    return new Promise(r => {
      chrome.storage.local.get([STORAGE_KEYS.CONFIG], res => {
        if (res[STORAGE_KEYS.CONFIG]) {
          config = res[STORAGE_KEYS.CONFIG];
          // Ensure arrays exist
          if (!config.teams) config.teams = [...DEFAULT_TEAMS];
          if (!config.categories) config.categories = [...DEFAULT_CATEGORIES];
        }
        r();
      });
    });
  }

  async function saveConfig() {
    return new Promise(r => {
      chrome.storage.local.set({ [STORAGE_KEYS.CONFIG]: config }, () => r());
    });
  }

  function loadSettings() {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (saved) settings = JSON.parse(saved);
    } catch(e) {}
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  }

  function loadPosition() {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.POSITION);
      return saved ? JSON.parse(saved) : null;
    } catch(e) { return null; }
  }

  function savePosition(x, y) {
    localStorage.setItem(STORAGE_KEYS.POSITION, JSON.stringify({x, y}));
  }

  // ============================================
  // CLIPS STORAGE
  // ============================================

  async function loadClips() {
    return new Promise(r => {
      chrome.storage.local.get([STORAGE_KEYS.CLIPS], res => r(res[STORAGE_KEYS.CLIPS] || []));
    });
  }

  async function saveClip(clip) {
    const clips = await loadClips();
    clips.push(clip);
    return new Promise(r => {
      chrome.storage.local.set({ [STORAGE_KEYS.CLIPS]: clips }, () => r());
    });
  }

  async function deleteClip(id) {
    const clips = await loadClips();
    const filtered = clips.filter(c => c.id !== id);
    return new Promise(r => {
      chrome.storage.local.set({ [STORAGE_KEYS.CLIPS]: filtered }, () => r());
    });
  }

  // ============================================
  // CLIP CREATION & OUTCOME
  // ============================================

  async function createClip(cat) {
    const t = getCurrentTime();
    const d = getDuration();
    const vid = getVideoId();
    if (!vid) return;

    const team = config.teams.find(tm => tm.id === selectedTeam) || config.teams[0];

    const clip = {
      id: 'cv_' + Date.now(),
      videoId: vid,
      videoTitle: getVideoTitle(),
      teamId: team.id,
      teamName: team.name,
      teamColor: team.color,
      category: cat.id,
      categoryName: cat.name,
      categoryColor: cat.color,
      tagTime: t,
      startTime: Math.max(0, t - settings.clipBefore),
      endTime: Math.min(d, t + settings.clipAfter),
      outcome: null,
      pinned: false,
      notes: '',
      createdAt: new Date().toISOString()
    };

    await saveClip(clip);
    showOutcomePrompt(clip.id, team, cat, t);
    updateUI();
  }

  function showOutcomePrompt(clipId, team, cat, time) {
    const n = document.getElementById('cv-notif');
    if (!n) return;
    
    n.innerHTML = `
      <div class="cv-outcome-prompt">
        <div class="cv-outcome-info">
          <span class="cv-outcome-team" style="background: ${team.color}">${team.name}</span>
          <span class="cv-outcome-cat">${cat.name}</span>
          <span class="cv-outcome-time">${formatTime(time)}</span>
        </div>
        <div class="cv-outcome-btns">
          <button class="cv-obtn success" data-id="${clipId}" data-outcome="success">Made</button>
          <button class="cv-obtn fail" data-id="${clipId}" data-outcome="fail">Missed</button>
          <button class="cv-obtn skip" data-id="${clipId}" data-outcome="skip">Skip</button>
        </div>
      </div>
    `;
    n.classList.add('show', 'prompt');
    
    n.querySelectorAll('.cv-obtn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const outcome = btn.dataset.outcome;
        if (outcome !== 'skip') {
          await updateClipOutcome(btn.dataset.id, outcome);
        }
        n.classList.remove('show', 'prompt');
        n.innerHTML = '';
        updateUI();
      };
    });

    setTimeout(() => {
      if (n.classList.contains('prompt')) {
        n.classList.remove('show', 'prompt');
        n.innerHTML = '';
      }
    }, 8000);
  }

  async function updateClipOutcome(clipId, outcome) {
    const clips = await loadClips();
    const clip = clips.find(c => c.id === clipId);
    if (clip) {
      clip.outcome = outcome;
      await new Promise(r => {
        chrome.storage.local.set({ [STORAGE_KEYS.CLIPS]: clips }, () => r());
      });
    }
  }

  // ============================================
  // AUTO-STOP PLAYBACK SYSTEM
  // ============================================
  
  window.cvClipEndTime = null;
  window.cvRAFId = null;

  function stopAutoStop() {
    if (window.cvRAFId) {
      cancelAnimationFrame(window.cvRAFId);
      window.cvRAFId = null;
    }
  }

  function playClip(startTime, endTime, videoId) {
    const currentVid = getVideoId();
    
    if (videoId !== currentVid) {
      window.location.href = `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(startTime)}s`;
      return;
    }

    stopAutoStop();

    const player = getPlayer();
    if (!player) {
      showNotif('Player not found', 'error');
      return;
    }

    player.currentTime = startTime;
    window.cvClipEndTime = endTime;
    
    player.play();
    showNotif(`Playing: ${formatTime(startTime)} - ${formatTime(endTime)}`, 'info');

    function checkTime() {
      const p = getPlayer();
      if (!p) {
        stopAutoStop();
        return;
      }
      
      const ct = p.currentTime;
      
      if (ct >= endTime - 0.3) {
        p.pause();
        window.cvClipEndTime = null;
        stopAutoStop();
        showNotif('Clip ended', 'success');
        return;
      }
      
      window.cvRAFId = requestAnimationFrame(checkTime);
    }
    
    window.cvRAFId = requestAnimationFrame(checkTime);
  }

  // ============================================
  // NOTIFICATION
  // ============================================

  function showNotif(msg, type = 'info') {
    const n = document.getElementById('cv-notif');
    if (!n || n.classList.contains('prompt')) return;
    
    n.innerHTML = `<span class="cv-notif-text">${msg}</span>`;
    n.className = 'cv-notif show ' + type;
    
    setTimeout(() => {
      n.classList.remove('show');
    }, 2500);
  }

  // ============================================
  // TRIAL SYSTEM - Content Panel
  // ============================================

  const TRIAL_KEY = 'courtvision_trial';
  const TRIAL_DAYS = 7;
  const POLAR_MONTHLY = 'https://buy.polar.sh/polar_cl_PXQUrbSaI7Igt0uyaRINQxhVbtHv534hFWoJd0G6n54';
  const POLAR_YEARLY = 'https://buy.polar.sh/polar_cl_JwHM9741Il0vsxoMgWhKJnRBb3k9lwozlbZiX0hjbJo';

  // Show upgrade modal with Monthly + Yearly options
  function showUpgradeModal() {
    // Remove existing modal if any
    const existing = document.getElementById('cv-upgrade-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'cv-upgrade-modal';
    modal.className = 'cv-upgrade-modal';
    modal.innerHTML = `
      <div class="cv-upgrade-overlay" id="cv-upgrade-overlay"></div>
      <div class="cv-upgrade-box">
        <div class="cv-upgrade-header">
          <span>Upgrade to Pro</span>
          <button class="cv-upgrade-close" id="cv-upgrade-close">✕</button>
        </div>
        <div class="cv-upgrade-body">
          <p class="cv-upgrade-subtitle">Choose your plan:</p>

          <a href="${POLAR_MONTHLY}" target="_blank" class="cv-upgrade-plan monthly">
            <div class="cv-plan-info">
              <span class="cv-plan-name">Pro Monthly</span>
              <span class="cv-plan-trial">7-day free trial</span>
            </div>
            <span class="cv-plan-price">$8<span class="cv-plan-period">/mo</span></span>
          </a>

          <a href="${POLAR_YEARLY}" target="_blank" class="cv-upgrade-plan yearly">
            <div class="cv-plan-info">
              <span class="cv-plan-name">Pro Yearly</span>
              <span class="cv-plan-save">Save 33%</span>
            </div>
            <span class="cv-plan-price">$64<span class="cv-plan-period">/yr</span></span>
          </a>

          <p class="cv-upgrade-note">Cancel anytime · Secure payment by Polar</p>

          <div class="cv-upgrade-features">
            <p>✓ Unlimited clip tagging</p>
            <p>✓ WhatsApp export</p>
            <p>✓ CSV, JSON & XML export</p>
            <p>✓ Hudl Sportscode compatible</p>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close on overlay click
    document.getElementById('cv-upgrade-overlay').onclick = () => modal.remove();
    document.getElementById('cv-upgrade-close').onclick = () => modal.remove();
  }

  async function getTrialStatus() {
    try {
      const result = await chrome.storage.local.get(['courtvision_license', TRIAL_KEY]);
      
      // Check license first
      if (result['courtvision_license']) {
        const polarPattern = /^[A-Z0-9]{8}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{12}$/;
        const cvUuidPattern = /^CV-[A-Z0-9]{8}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{12}$/;
        const cvShortPattern = /^CV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
        if (polarPattern.test(result['courtvision_license'].toUpperCase()) || cvUuidPattern.test(result['courtvision_license'].toUpperCase()) || cvShortPattern.test(result['courtvision_license'].toUpperCase())) {
          return { status: 'pro' };
        }
      }

      // Check trial
      let trial = result[TRIAL_KEY];
      if (!trial) {
        const now = new Date();
        const expires = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
        trial = { installDate: now.toISOString(), expiresAt: expires.toISOString() };
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
      return { status: 'trial', daysLeft: TRIAL_DAYS };
    }
  }

  async function updateTrialBanner() {
    const banner = document.getElementById('cv-trial-banner');
    if (!banner) return;

    const status = await getTrialStatus();

    if (status.status === 'pro') {
      banner.style.display = 'none';

    } else if (status.status === 'trial') {
      banner.style.display = 'flex';
      banner.className = 'cv-trial-banner trial';
      banner.innerHTML = `
        <span>🎁 Free Trial: <strong>${status.daysLeft} day${status.daysLeft !== 1 ? 's' : ''} left</strong></span>
        <button class="cv-trial-upgrade" id="cv-trial-btn">Upgrade</button>
      `;
      document.getElementById('cv-trial-btn').onclick = showUpgradeModal;

    } else {
      banner.style.display = 'flex';
      banner.className = 'cv-trial-banner expired';
      banner.innerHTML = `
        <span>⚠️ Trial expired</span>
        <button class="cv-trial-upgrade" id="cv-trial-btn">Get Pro</button>
      `;
      document.getElementById('cv-trial-btn').onclick = showUpgradeModal;
    }
  }

  // ============================================
  // UI UPDATE
  // ============================================

  async function updateUI() {
    const clips = await loadClips();
    const vid = getVideoId();
    const myClips = clips.filter(c => c.videoId === vid);
    
    const total = myClips.length;
    const success = myClips.filter(c => c.outcome === 'success').length;
    const fail = myClips.filter(c => c.outcome === 'fail').length;
    
    const statsEl = document.getElementById('cv-stats');
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="cv-stat"><span class="cv-stat-val">${total}</span><span class="cv-stat-lbl">TOTAL</span></div>
        <div class="cv-stat success"><span class="cv-stat-val">${success}</span><span class="cv-stat-lbl">MADE</span></div>
        <div class="cv-stat fail"><span class="cv-stat-val">${fail}</span><span class="cv-stat-lbl">MISSED</span></div>
      `;
    }

    // Update trial banner
    updateTrialBanner();
    
    const countEl = document.getElementById('cv-tab-count');
    if (countEl) countEl.textContent = myClips.length;
    
    // Update tagging button counts
    config.categories.forEach(cat => {
      const countEl = document.querySelector(`[data-count-for="${cat.id}"]`);
      if (countEl) {
        const count = myClips.filter(c => c.category === cat.id).length;
        countEl.textContent = `${count} ${count === 1 ? 'clip' : 'clips'}`;
      }
    });
    
    updateCatTabs(clips);
    updateClipsList();
  }

  function updateCatTabs(clips) {
    const vid = getVideoId();
    const tabsEl = document.getElementById('cv-cat-tabs');
    if (!tabsEl) return;

    let filtered = currentFilter === 'current' 
      ? clips.filter(c => c.videoId === vid)
      : clips;

    if (currentTeamFilter !== 'all') {
      filtered = filtered.filter(c => c.teamId === currentTeamFilter);
    }

    const counts = { all: filtered.length };
    config.categories.forEach(cat => {
      counts[cat.id] = filtered.filter(c => c.category === cat.id).length;
    });

    tabsEl.innerHTML = `
      <button class="cv-cat-tab ${currentCategory === 'all' ? 'active' : ''}" data-cat="all">
        All <span>${counts.all}</span>
      </button>
      ${config.categories.filter(cat => counts[cat.id] > 0).map(cat => `
        <button class="cv-cat-tab ${currentCategory === cat.id ? 'active' : ''}" data-cat="${cat.id}" style="--c:${cat.color}">
          ${cat.name} <span>${counts[cat.id]}</span>
        </button>
      `).join('')}
    `;

    tabsEl.querySelectorAll('.cv-cat-tab').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        currentCategory = btn.dataset.cat;
        tabsEl.querySelectorAll('.cv-cat-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateClipsList();
      };
    });
  }

  async function updateClipsList() {
    const clips = await loadClips();
    const vid = getVideoId();
    const list = document.getElementById('cv-clips-list');
    if (!list) return;

    let filtered = currentFilter === 'current'
      ? clips.filter(c => c.videoId === vid)
      : clips;

    if (currentTeamFilter !== 'all') {
      filtered = filtered.filter(c => c.teamId === currentTeamFilter);
    }

    if (currentCategory !== 'all') {
      filtered = filtered.filter(c => c.category === currentCategory);
    }
    
    filtered.sort((a, b) => a.startTime - b.startTime);

    if (filtered.length === 0) {
      list.innerHTML = '<div class="cv-empty">No clips yet</div>';
      return;
    }

    // Group by team then category
    const teamGroups = {};
    filtered.forEach(c => {
      const teamKey = c.teamId || 'unknown';
      if (!teamGroups[teamKey]) {
        teamGroups[teamKey] = {
          teamId: c.teamId,
          teamName: c.teamName || 'Unknown',
          teamColor: c.teamColor || '#888',
          categories: {}
        };
      }
      
      if (!teamGroups[teamKey].categories[c.category]) {
        const cat = config.categories.find(x => x.id === c.category) || {};
        teamGroups[teamKey].categories[c.category] = {
          name: cat.name || c.categoryName || c.category,
          color: cat.color || c.categoryColor || '#3B82F6',
          clips: []
        };
      }
      teamGroups[teamKey].categories[c.category].clips.push(c);
    });

    list.innerHTML = Object.values(teamGroups).map(team => `
      <div class="cv-team-group">
        <div class="cv-team-header" style="background: ${team.teamColor}15; border-left: 3px solid ${team.teamColor}">
          ${team.teamName}
        </div>
        ${Object.entries(team.categories).map(([catId, cat]) => `
          <div class="cv-cat-group">
            <div class="cv-cat-header" style="border-left-color: ${cat.color}">
              ${cat.name} <span>(${cat.clips.length})</span>
            </div>
            ${[...cat.clips].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)).map(c => clipHTML(c)).join('')}
          </div>
        `).join('')}
      </div>
    `).join('');

    attachClipListeners();
  }

  function clipHTML(c) {
    const isCurrent = c.videoId === getVideoId();
    const outcomeText = c.outcome === 'success' ? 'OK' : c.outcome === 'fail' ? 'X' : '-';
    const outcomeClass = c.outcome === 'success' ? 'success' : c.outcome === 'fail' ? 'fail' : '';
    const isPinned = c.pinned === true;
    
    return `
      <div class="cv-clip ${outcomeClass} ${isPinned ? 'cv-pinned' : ''}" data-id="${c.id}">
        <div class="cv-clip-top">
          <span class="cv-clip-range">${formatTime(c.startTime)} - ${formatTime(c.endTime)}</span>
          <span class="cv-clip-dur">${Math.round(c.endTime - c.startTime)}s</span>
          <span class="cv-clip-outcome ${outcomeClass}">${outcomeText}</span>
        </div>
        <div class="cv-clip-btns">
          ${isCurrent ? `
            <button class="cv-btn-play" data-start="${c.startTime}" data-end="${c.endTime}" data-vid="${c.videoId}">Play</button>
          ` : `
            <button class="cv-btn-open" data-start="${c.startTime}" data-vid="${c.videoId}">Open</button>
          `}
          <button class="cv-btn-pin ${isPinned ? 'active' : ''}" data-id="${c.id}" title="${isPinned ? 'Unpin' : 'Pin klip ini'}">${isPinned ? 'PIN' : 'pin'}</button>
          <button class="cv-btn-del" data-id="${c.id}">X</button>
        </div>
        <div class="cv-clip-notes">
          <input type="text" class="cv-notes-input" data-id="${c.id}" 
            placeholder="Catatan singkat..." 
            value="${(c.notes || '').replace(/"/g, '&quot;')}"
            maxlength="80">
        </div>
        <div class="cv-clip-adjust">
          <div class="cv-adjust-row">
            <button class="cv-btn-adj" data-id="${c.id}" data-type="start" data-dir="-1">-1s</button>
            <button class="cv-btn-adj" data-id="${c.id}" data-type="start" data-dir="1">+1s</button>
            <span class="cv-adjust-label">Start</span>
          </div>
          <div class="cv-adjust-row">
            <button class="cv-btn-adj" data-id="${c.id}" data-type="end" data-dir="-1">-1s</button>
            <button class="cv-btn-adj" data-id="${c.id}" data-type="end" data-dir="1">+1s</button>
            <span class="cv-adjust-label">End</span>
          </div>
        </div>
      </div>
    `;
  }

  function attachClipListeners() {
    const list = document.getElementById('cv-clips-list');
    if (!list) return;
    
    list.addEventListener('change', async function(e) {
      if (e.target.classList.contains('cv-notes-input')) {
        const clipId = e.target.dataset.id;
        const notes = e.target.value.trim();
        const clips = await loadClips();
        const clip = clips.find(c => c.id === clipId);
        if (clip) {
          clip.notes = notes;
          await new Promise(r => {
            chrome.storage.local.set({ [STORAGE_KEYS.CLIPS]: clips }, () => r());
          });
        }
      }
    });

    list.onclick = async function(e) {
      const target = e.target;
      
      if (target.classList.contains('cv-btn-play')) {
        e.stopPropagation();
        const start = parseFloat(target.dataset.start);
        const end = parseFloat(target.dataset.end);
        const vid = target.dataset.vid;
        playClip(start, end, vid);
        return;
      }
      
      if (target.classList.contains('cv-btn-open')) {
        e.stopPropagation();
        const start = parseFloat(target.dataset.start);
        const vid = target.dataset.vid;
        window.location.href = `https://www.youtube.com/watch?v=${vid}&t=${Math.floor(start)}s`;
        return;
      }
      
      if (target.classList.contains('cv-btn-del')) {
        e.stopPropagation();
        if (confirm('Delete clip?')) {
          await deleteClip(target.dataset.id);
          updateUI();
        }
        return;
      }
      
      if (target.classList.contains('cv-btn-pin')) {
        e.stopPropagation();
        const clipId = target.dataset.id;
        const clips = await loadClips();
        const clip = clips.find(c => c.id === clipId);
        if (clip) {
          clip.pinned = !clip.pinned;
          await new Promise(r => {
            chrome.storage.local.set({ [STORAGE_KEYS.CLIPS]: clips }, () => r());
          });
          updateUI();
        }
        return;
      }

      if (target.classList.contains('cv-btn-adj')) {
        e.stopPropagation();
        const clipId = target.dataset.id;
        const type = target.dataset.type;
        const dir = parseInt(target.dataset.dir);
        
        const clips = await loadClips();
        const clip = clips.find(c => c.id === clipId);
        
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
          
          await new Promise(r => {
            chrome.storage.local.set({ [STORAGE_KEYS.CLIPS]: clips }, () => r());
          });
          updateUI();
        }
        return;
      }
    };
  }

  // ============================================
  // WHATSAPP SUMMARY GENERATOR
  // ============================================
  
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
      teams[teamKey].categories[catKey].clipData.push([
        Math.floor(c.startTime),
        Math.floor(c.endTime),
        c.notes || '',
        c.pinned ? 1 : 0
      ]);
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
          clips: cat.clipData.sort((a, b) => (b[3] || 0) - (a[3] || 0) || a[0] - b[0])
        }))
      }))
    };
    
    // Encode data to base64
    const encodedData = btoa(unescape(encodeURIComponent(JSON.stringify(clipData))));
    
    // Generate single URL with all clips
    const clipViewerUrl = `https://courtvision.id/clip.html?v=${videoId}&d=${encodedData}`;

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

  async function copyWhatsAppSummary() {
    const clips = await loadClips();
    const vid = getVideoId();
    const videoClips = clips.filter(c => c.videoId === vid);
    
    if (videoClips.length === 0) {
      showNotif('No clips for this video', 'error');
      return;
    }

    const text = generateWhatsAppSummary(videoClips);
    
    try {
      await navigator.clipboard.writeText(text);
      showNotif('Copied to clipboard!', 'success');
    } catch(e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showNotif('Copied to clipboard!', 'success');
    }
  }

  // ============================================
  // RENDER SETTINGS PANEL CONTENT
  // ============================================

  function renderSettingsContent() {
    const container = document.getElementById('cv-settings-content');
    if (!container) return;

    if (settingsTab === 'clip') {
      container.innerHTML = `
        <div class="cv-settings-section">
          <div class="cv-settings-row">
            <label>Before tag:</label>
            <input type="number" id="cv-clip-before" value="${settings.clipBefore}" min="0" max="60"> sec
          </div>
          <div class="cv-settings-row">
            <label>After tag:</label>
            <input type="number" id="cv-clip-after" value="${settings.clipAfter}" min="0" max="120"> sec
          </div>
          <button class="cv-settings-save" id="cv-save-clip-settings">Save</button>
        </div>
      `;
      
      document.getElementById('cv-save-clip-settings').onclick = e => {
        e.stopPropagation();
        settings.clipBefore = parseInt(document.getElementById('cv-clip-before').value) || 7;
        settings.clipAfter = parseInt(document.getElementById('cv-clip-after').value) || 17;
        saveSettings();
        showNotif('Settings saved', 'success');
      };
    } 
    else if (settingsTab === 'teams') {
      container.innerHTML = `
        <div class="cv-settings-section">
          ${config.teams.map((team, i) => `
            <div class="cv-team-edit">
              <input type="text" class="cv-team-name-input" data-index="${i}" value="${team.name}" placeholder="Team name">
              <input type="color" class="cv-team-color-input" data-index="${i}" value="${team.color}">
            </div>
          `).join('')}
          <button class="cv-settings-save" id="cv-save-teams">Save Teams</button>
        </div>
      `;
      
      document.getElementById('cv-save-teams').onclick = async e => {
        e.stopPropagation();
        document.querySelectorAll('.cv-team-name-input').forEach(input => {
          const i = parseInt(input.dataset.index);
          config.teams[i].name = input.value || `Team ${i + 1}`;
        });
        document.querySelectorAll('.cv-team-color-input').forEach(input => {
          const i = parseInt(input.dataset.index);
          config.teams[i].color = input.value;
        });
        await saveConfig();
        showNotif('Teams saved', 'success');
        refreshTagUI();
      };
    }
    else if (settingsTab === 'categories') {
      container.innerHTML = `
        <div class="cv-settings-section">
          <div class="cv-cat-list" id="cv-cat-list">
            ${config.categories.map((cat, i) => `
              <div class="cv-cat-edit" draggable="true" data-index="${i}">
                <span class="cv-cat-drag">☰</span>
                <input type="color" class="cv-cat-color-input" data-index="${i}" value="${cat.color}">
                <input type="text" class="cv-cat-name-input" data-index="${i}" value="${cat.name}" placeholder="Category name">
                <button class="cv-cat-del-btn" data-index="${i}">✕</button>
              </div>
            `).join('')}
          </div>
          <div class="cv-cat-add-row">
            <input type="text" id="cv-new-cat-name" placeholder="New category name">
            <input type="color" id="cv-new-cat-color" value="#6366F1">
            <button class="cv-cat-add-btn" id="cv-add-cat">+</button>
          </div>
          <button class="cv-settings-save" id="cv-save-cats">Save Categories</button>
        </div>
      `;
      
      setupCategoryDragDrop();
      
      // Delete category
      document.querySelectorAll('.cv-cat-del-btn').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation();
          const i = parseInt(btn.dataset.index);
          if (config.categories.length <= 1) {
            showNotif('Need at least 1 category', 'error');
            return;
          }
          config.categories.splice(i, 1);
          renderSettingsContent();
        };
      });
      
      // Add category
      document.getElementById('cv-add-cat').onclick = e => {
        e.stopPropagation();
        const nameInput = document.getElementById('cv-new-cat-name');
        const colorInput = document.getElementById('cv-new-cat-color');
        const name = nameInput.value.trim();
        if (!name) {
          showNotif('Enter category name', 'error');
          return;
        }
        config.categories.push({
          id: generateId(),
          name: name,
          color: colorInput.value
        });
        nameInput.value = '';
        renderSettingsContent();
      };
      
      // Save categories
      document.getElementById('cv-save-cats').onclick = async e => {
        e.stopPropagation();
        document.querySelectorAll('.cv-cat-name-input').forEach(input => {
          const i = parseInt(input.dataset.index);
          if (config.categories[i]) {
            config.categories[i].name = input.value || `Category ${i + 1}`;
          }
        });
        document.querySelectorAll('.cv-cat-color-input').forEach(input => {
          const i = parseInt(input.dataset.index);
          if (config.categories[i]) {
            config.categories[i].color = input.value;
          }
        });
        await saveConfig();
        showNotif('Categories saved', 'success');
        refreshTagUI();
      };
    }
  }

  function setupCategoryDragDrop() {
    const list = document.getElementById('cv-cat-list');
    if (!list) return;
    
    const items = list.querySelectorAll('.cv-cat-edit');
    
    items.forEach(item => {
      item.addEventListener('dragstart', e => {
        draggedCatIndex = parseInt(item.dataset.index);
        item.classList.add('dragging');
      });
      
      item.addEventListener('dragend', e => {
        item.classList.remove('dragging');
        draggedCatIndex = null;
      });
      
      item.addEventListener('dragover', e => {
        e.preventDefault();
        const targetIndex = parseInt(item.dataset.index);
        if (draggedCatIndex !== null && draggedCatIndex !== targetIndex) {
          item.classList.add('drag-over');
        }
      });
      
      item.addEventListener('dragleave', e => {
        item.classList.remove('drag-over');
      });
      
      item.addEventListener('drop', e => {
        e.preventDefault();
        item.classList.remove('drag-over');
        const targetIndex = parseInt(item.dataset.index);
        
        if (draggedCatIndex !== null && draggedCatIndex !== targetIndex) {
          const draggedCat = config.categories[draggedCatIndex];
          config.categories.splice(draggedCatIndex, 1);
          config.categories.splice(targetIndex, 0, draggedCat);
          renderSettingsContent();
        }
      });
    });
  }

  function refreshTagUI() {
    const teamSelector = document.querySelector('.cv-team-selector');
    if (teamSelector) {
      teamSelector.innerHTML = config.teams.map(team => `
        <button class="cv-team-btn ${team.id === selectedTeam ? 'active' : ''}" data-team="${team.id}" style="--team-color: ${team.color}">
          ${team.name}
        </button>
      `).join('');
      
      teamSelector.querySelectorAll('.cv-team-btn').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation();
          selectedTeam = btn.dataset.team;
          document.querySelectorAll('.cv-team-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        };
      });
    }
    
    const catsEl = document.querySelector('.cv-cats');
    if (catsEl) {
      catsEl.innerHTML = config.categories.map((c, i) => `
        <button class="cv-cat" data-c="${c.id}" style="--c:${c.color}">
          <span class="cv-cat-name">${c.name}</span>
          <span class="cv-cat-key" data-count-for="${c.id}">0 clips</span>
        </button>
      `).join('');
      
      catsEl.querySelectorAll('.cv-cat').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation();
          const cat = config.categories.find(c => c.id === btn.dataset.c);
          if (cat) createClip(cat);
        };
      });
    }
    
    // Update team filter
    const teamFilter = document.querySelector('.cv-team-filter');
    if (teamFilter) {
      teamFilter.innerHTML = `
        <button class="cv-team-filter-btn active" data-team="all">All</button>
        ${config.teams.map(team => `
          <button class="cv-team-filter-btn" data-team="${team.id}" style="--team-color: ${team.color}">
            ${team.name.charAt(0)}
          </button>
        `).join('')}
      `;
      
      teamFilter.querySelectorAll('.cv-team-filter-btn').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation();
          currentTeamFilter = btn.dataset.team;
          teamFilter.querySelectorAll('.cv-team-filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          updateUI();
        };
      });
    }
  }

  // ============================================
  // CREATE UI
  // ============================================

  function createUI() {
    const old = document.getElementById('courtvision-app');
    if (old) old.remove();

    loadSettings();

    const div = document.createElement('div');
    div.id = 'courtvision-app';
    div.innerHTML = `
      <button class="cv-fab" id="cv-fab" title="CourtVision">CV</button>

      <div class="cv-panel ${isPanelVisible ? '' : 'hidden'}" id="cv-panel">
        <div class="cv-header" id="cv-header">
          <span class="cv-title">CourtVision <span class="cv-pro">PRO</span></span>
          <div class="cv-header-right">
            <span class="cv-time" id="cv-time">0:00</span>
            <button class="cv-hbtn" id="cv-settings-btn" title="Settings">S</button>
            <button class="cv-hbtn" id="cv-min" title="Minimize">−</button>
            <button class="cv-hbtn" id="cv-close" title="Close">✕</button>
          </div>
        </div>
        
        <div class="cv-body" id="cv-body">
          <!-- Stats -->
          <div class="cv-stats" id="cv-stats"></div>
          
          <!-- Trial Banner -->
          <div class="cv-trial-banner" id="cv-trial-banner" style="display:none"></div>
          
          <!-- WhatsApp Button -->
          <div class="cv-wa-container">
            <button class="cv-wa-btn" id="cv-wa-btn">Copy for WhatsApp</button>
          </div>
          
          <!-- Settings Panel (Expanded) -->
          <div class="cv-settings hidden" id="cv-settings">
            <div class="cv-settings-tabs">
              <button class="cv-settings-tab active" data-tab="clip">Duration</button>
              <button class="cv-settings-tab" data-tab="teams">Teams</button>
              <button class="cv-settings-tab" data-tab="categories">Categories</button>
            </div>
            <div class="cv-settings-content" id="cv-settings-content"></div>
          </div>

          <!-- Main Tabs -->
          <div class="cv-tabs">
            <button class="cv-tab active" data-t="tag">Tag</button>
            <button class="cv-tab" data-t="clips">Clips <span id="cv-tab-count">0</span></button>
          </div>
          
          <!-- Tag Content -->
          <div class="cv-content" id="cv-content-tag">
            <!-- Team Selector -->
            <div class="cv-team-selector">
              ${config.teams.map(team => `
                <button class="cv-team-btn ${team.id === selectedTeam ? 'active' : ''}" data-team="${team.id}" style="--team-color: ${team.color}">
                  ${team.name}
                </button>
              `).join('')}
            </div>
            
            <!-- Category Buttons -->
            <div class="cv-cats">
              ${config.categories.map((c, i) => `
                <button class="cv-cat" data-c="${c.id}" style="--c:${c.color}">
                  <span class="cv-cat-name">${c.name}</span>
                  <span class="cv-cat-key" data-count-for="${c.id}">0 clips</span>
                </button>
              `).join('')}
            </div>
          </div>
          
          <!-- Clips Content -->
          <div class="cv-content hidden" id="cv-content-clips">
            <div class="cv-filters">
              <button class="cv-filter active" data-f="current">This Video</button>
              <button class="cv-filter" data-f="all">All</button>
            </div>
            
            <div class="cv-team-filter">
              <button class="cv-team-filter-btn active" data-team="all">All</button>
              ${config.teams.map(team => `
                <button class="cv-team-filter-btn" data-team="${team.id}" style="--team-color: ${team.color}">
                  ${team.name.charAt(0)}
                </button>
              `).join('')}
            </div>
            
            <div class="cv-cat-tabs" id="cv-cat-tabs"></div>
            <div class="cv-clips-list" id="cv-clips-list"></div>
            
            <div class="cv-export-row">
              <button class="cv-export-btn" id="cv-json">JSON</button>
              <button class="cv-export-btn" id="cv-csv">CSV</button>
            </div>
          </div>
        </div>
      </div>
      <div class="cv-notif" id="cv-notif"></div>
    `;

    document.body.appendChild(div);
    
    const panel = document.getElementById('cv-panel');
    const saved = loadPosition();
    if (saved) {
      panel.style.left = saved.x + 'px';
      panel.style.top = saved.y + 'px';
    } else {
      panel.style.right = '20px';
      panel.style.top = '80px';
    }
    
    setupDrag();
    setupListeners();
    updateUI();
    
    setInterval(() => {
      const el = document.getElementById('cv-time');
      if (el) el.textContent = formatTime(getCurrentTime());
    }, 500);
  }

  function setupDrag() {
    const panel = document.getElementById('cv-panel');
    const header = document.getElementById('cv-header');
    let dragging = false, offX = 0, offY = 0;

    header.addEventListener('mousedown', e => {
      if (e.target.closest('button')) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      offX = e.clientX - rect.left;
      offY = e.clientY - rect.top;
      panel.style.transition = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      let x = e.clientX - offX;
      let y = e.clientY - offY;
      x = Math.max(0, Math.min(x, window.innerWidth - panel.offsetWidth));
      y = Math.max(0, Math.min(y, window.innerHeight - panel.offsetHeight));
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
      panel.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        panel.style.transition = '';
        savePosition(parseInt(panel.style.left), parseInt(panel.style.top));
      }
    });
  }

  function setupListeners() {
    // FAB Button
    document.getElementById('cv-fab').onclick = e => {
      e.stopPropagation();
      isPanelVisible = !isPanelVisible;
      document.getElementById('cv-panel').classList.toggle('hidden', !isPanelVisible);
      if (isPanelVisible) updateUI();
    };

    // Close button
    document.getElementById('cv-close').onclick = e => {
      e.stopPropagation();
      isPanelVisible = false;
      document.getElementById('cv-panel').classList.add('hidden');
    };

    // Minimize
    document.getElementById('cv-min').onclick = e => {
      e.stopPropagation();
      isMinimized = !isMinimized;
      document.getElementById('cv-body').style.display = isMinimized ? 'none' : '';
      e.target.textContent = isMinimized ? '+' : '−';
    };

    // Settings toggle
    document.getElementById('cv-settings-btn').onclick = e => {
      e.stopPropagation();
      const settingsEl = document.getElementById('cv-settings');
      settingsEl.classList.toggle('hidden');
      if (!settingsEl.classList.contains('hidden')) {
        renderSettingsContent();
      }
    };

    // Settings tabs
    document.querySelectorAll('.cv-settings-tab').forEach(tab => {
      tab.onclick = e => {
        e.stopPropagation();
        settingsTab = tab.dataset.tab;
        document.querySelectorAll('.cv-settings-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        renderSettingsContent();
      };
    });

    // WhatsApp button
    document.getElementById('cv-wa-btn').onclick = e => {
      e.stopPropagation();
      copyWhatsAppSummary();
    };

    // Categories
    document.querySelectorAll('.cv-cat').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        const cat = config.categories.find(c => c.id === btn.dataset.c);
        if (cat) createClip(cat);
      };
    });

    // Team Selector
    document.querySelectorAll('.cv-team-btn').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        selectedTeam = btn.dataset.team;
        document.querySelectorAll('.cv-team-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      };
    });

    // Main Tabs
    document.querySelectorAll('.cv-tab').forEach(tab => {
      tab.onclick = e => {
        e.stopPropagation();
        const target = tab.dataset.t;
        document.querySelectorAll('.cv-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('cv-content-tag').classList.toggle('hidden', target !== 'tag');
        document.getElementById('cv-content-clips').classList.toggle('hidden', target !== 'clips');
      };
    });

    // Filters
    document.querySelectorAll('.cv-filter').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        currentFilter = btn.dataset.f;
        document.querySelectorAll('.cv-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateUI();
      };
    });

    // Team Filter
    document.querySelectorAll('.cv-team-filter-btn').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        currentTeamFilter = btn.dataset.team;
        document.querySelectorAll('.cv-team-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateUI();
      };
    });

    // Export JSON
    document.getElementById('cv-json').onclick = async e => {
      e.stopPropagation();
      const clips = await loadClips();
      const json = JSON.stringify(clips, null, 2);
      const blob = new Blob([json], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'courtvision_clips.json';
      a.click();
      URL.revokeObjectURL(url);
    };

    // Export CSV
    document.getElementById('cv-csv').onclick = async e => {
      e.stopPropagation();
      const clips = await loadClips();
      let csv = 'Video Title,Team,Category,Outcome,Tag Time,Start Time,End Time,Video URL\n';
      clips.forEach(c => {
        const outcomeText = c.outcome === 'success' ? 'Made' : c.outcome === 'fail' ? 'Missed' : '-';
        const url = `https://youtube.com/watch?v=${c.videoId}&t=${Math.floor(c.startTime)}s`;
        csv += `"${c.videoTitle}","${c.teamName}","${c.categoryName}","${outcomeText}",${formatTime(c.tagTime)},${formatTime(c.startTime)},${formatTime(c.endTime)},"${url}"\n`;
      });
      const blob = new Blob([csv], {type: 'text/csv'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'courtvision_clips.csv';
      a.click();
      URL.revokeObjectURL(url);
    };

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      
      if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (idx < config.categories.length) {
          createClip(config.categories[idx]);
        }
      }
    });
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  async function init() {
    await loadConfig();
    
    // Set default selected team
    if (config.teams.length > 0) {
      selectedTeam = config.teams[0].id;
    }
    
    createUI();
  }

  // Handle YouTube navigation
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (location.pathname === '/watch') {
        setTimeout(init, 1000);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

  if (location.pathname === '/watch') {
    setTimeout(init, 1000);
  }
})();
