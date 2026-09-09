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
    let normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    normalized += '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
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

    if (Array.isArray(raw)) {
      start = finiteNumber(raw[0]);
      end = finiteNumber(raw[1]);
      notes = safeText(raw[2], '');
      pinned = raw[3] === 1 || raw[3] === true;
    } else if (raw && typeof raw === 'object') {
      start = finiteNumber(raw.startTime ?? raw.start);
      end = finiteNumber(raw.endTime ?? raw.end);
      tagTime = finiteNumber(raw.tagTime);
      notes = safeText(raw.notes, '');
      pinned = raw.pinned === true || raw.pinned === 1;
    }

    if (start === null || end === null || start < 0 || end <= start) return null;
    return {
      teamName: safeText(context.teamName, 'Team'),
      categoryName: safeText(context.categoryName, 'Clip'),
      start: Math.floor(start),
      end: Math.ceil(end),
      tagTime,
      notes,
      pinned
    };
  }

  function normalizePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Format data clip tidak dikenal.');
    }

    const clips = [];
    if (Array.isArray(payload.teams)) {
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
      title: safeText(payload.title, 'Game Analysis'),
      videoId: safeText(payload.videoId, ''),
      clips
    };
  }

  function parseShareUrl(search) {
    const params = new URLSearchParams(search || '');
    const queryVideoId = safeText(params.get('v'), '');
    const data = params.get('d');
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
