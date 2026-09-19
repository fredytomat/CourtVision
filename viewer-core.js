(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CourtVisionViewer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_DATA_LENGTH = 180000;
  const MAX_CLIPS = 1000;

  function decodeBase64Utf8(value) {
    if (typeof value !== 'string' || !value || value.length > MAX_DATA_LENGTH) {
      throw new Error('Data clip kosong atau terlalu besar.');
    }
    // URLSearchParams decodes a literal "+" as a space. Older CourtVision
    // share links used standard Base64, so restore those spaces before
    // normalizing newer Base64URL links.
    let normalized = value.replace(/\s/g, '+').replace(/-/g, '+').replace(/_/g, '/');
    normalized += '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(normalized);
    return decodeURIComponent(Array.from(binary, char => '%' + char.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
  }

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function safeText(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : fallback;
  }

  function normalizeClip(raw, context) {
    let start;
    let end;
    let notes = '';
    let pinned = false;
    let tagTime = null;
    let outcome = null;

    if (Array.isArray(raw)) {
      start = finiteNumber(raw[0]);
      end = finiteNumber(raw[1]);
      notes = safeText(raw[2], '');
      pinned = raw[3] === 1 || raw[3] === true;
      outcome = raw[4] === 'success' || raw[4] === 'fail' ? raw[4] : null;
    } else if (raw && typeof raw === 'object') {
      start = finiteNumber(raw.startTime ?? raw.start);
      end = finiteNumber(raw.endTime ?? raw.end);
      tagTime = finiteNumber(raw.tagTime);
      notes = safeText(raw.notes, '');
      pinned = raw.pinned === true || raw.pinned === 1;
      outcome = raw.outcome === 'success' || raw.outcome === 'fail' ? raw.outcome : null;
    }

    if (start === null || end === null || start < 0 || end <= start) return null;
    return {
      teamName: safeText(context.teamName, 'Team'),
      categoryName: safeText(context.categoryName, 'Clip'),
      start: Math.floor(start),
      end: Math.ceil(end),
      tagTime,
      notes,
      pinned,
      outcome
    };
  }

  function normalizePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Format data clip tidak dikenal.');
    }
    const payloadVersion = payload.version ?? payload.v;
    if (payloadVersion !== undefined && payloadVersion !== 2) {
      throw new Error('Versi link CourtVision tidak didukung.');
    }

    const clips = [];
    if (Array.isArray(payload.c)) {
      payload.c.forEach(raw => {
        if (!Array.isArray(raw)) return;
        const clip = normalizeClip({
          tagTime: raw[2],
          startTime: raw[3],
          endTime: raw[4],
          notes: raw[5],
          pinned: raw[6],
          outcome: raw[7]
        }, {
          teamName: raw[0],
          categoryName: raw[1]
        });
        if (clip) clips.push(clip);
      });
    } else if (Array.isArray(payload.teams)) {
      payload.teams.forEach(team => {
        if (!team || !Array.isArray(team.categories)) return;
        team.categories.forEach(category => {
          if (!category || !Array.isArray(category.clips)) return;
          category.clips.forEach(raw => {
            const clip = normalizeClip(raw, {
              teamName: team.name,
              categoryName: category.name
            });
            if (clip) clips.push(clip);
          });
        });
      });
    } else if (Array.isArray(payload.clips)) {
      payload.clips.forEach(raw => {
        const clip = normalizeClip(raw, {
          teamName: raw && raw.teamName,
          categoryName: raw && raw.categoryName
        });
        if (clip) clips.push(clip);
      });
    }

    if (!clips.length) throw new Error('Tidak ada clip valid di dalam link.');
    if (clips.length > MAX_CLIPS) throw new Error('Jumlah clip melebihi batas.');

    return {
      version: payloadVersion === 2 ? 2 : 1,
      title: safeText(payload.title ?? payload.t, 'Game Analysis'),
      videoId: safeText(payload.videoId ?? payload.y, ''),
      clips
    };
  }

  function parseShareUrl(search, hash) {
    const params = new URLSearchParams(search || '');
    const fragment = new URLSearchParams((hash || '').replace(/^#/, ''));
    const rawSearch = (search || '').replace(/^\?/, '');
    const queryVideoId = safeText(params.get('v'), '');
    const data = rawSearch.startsWith('cv2.') ? rawSearch.slice(4) : fragment.get('cv2') || params.get('d');
    let normalized;

    if (data) {
      normalized = normalizePayload(JSON.parse(decodeBase64Utf8(data)));
    } else {
      const start = finiteNumber(params.get('start'));
      const end = finiteNumber(params.get('end'));
      if (start === null || end === null || start < 0 || end <= start) {
        throw new Error('Parameter video tidak lengkap atau tidak valid.');
      }
      normalized = normalizePayload({
        title: 'CourtVision Clip',
        clips: [{ teamName: 'Clip', categoryName: 'Video', startTime: start, endTime: end }]
      });
    }

    const videoId = queryVideoId || normalized.videoId;
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) throw new Error('ID video tidak valid.');
    normalized.videoId = videoId;
    return normalized;
  }

  return { decodeBase64Utf8, normalizePayload, parseShareUrl };
});
