(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CourtVisionShare = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 3;
  const DEFAULT_VIEWER_URL = 'https://courtvision.id/clip.html';

  function createPayload(title, videoId, clips) {
    return {
      version: VERSION,
      title,
      videoId,
      clips: clips.map(clip => ({
        teamName: clip.teamName || 'Unknown',
        categoryName: clip.categoryName || 'Clip',
        tagTime: Number.isFinite(clip.tagTime) ? clip.tagTime : clip.startTime,
        startTime: clip.startTime,
        endTime: clip.endTime,
        notes: clip.notes || '',
        pinned: Boolean(clip.pinned),
        outcome: clip.outcome === 'success' || clip.outcome === 'fail' ? clip.outcome : null
      }))
    };
  }

  function encodePayload(payload) {
    const teams = [];
    const categories = [];
    const teamIndexes = new Map();
    const categoryIndexes = new Map();
    const indexOf = (values, indexes, value) => {
      if (!indexes.has(value)) {
        indexes.set(value, values.length);
        values.push(value);
      }
      return indexes.get(value);
    };
    const clips = payload.clips.map(clip => {
      const teamName = clip.teamName || 'Unknown';
      const categoryName = clip.categoryName || 'Clip';
      const start = Math.max(0, Math.round(Number(clip.startTime) * 10));
      const duration = Math.max(1, Math.round((Number(clip.endTime) - Number(clip.startTime)) * 10));
      const flags = (clip.pinned ? 1 : 0) + (clip.outcome === 'success' ? 2 : clip.outcome === 'fail' ? 4 : 0);
      const compactClip = [
        indexOf(teams, teamIndexes, teamName),
        indexOf(categories, categoryIndexes, categoryName),
        start,
        duration
      ];
      if (clip.notes || flags) compactClip.push(clip.notes || '', flags);
      return compactClip;
    });
    const compact = [VERSION, payload.title, payload.videoId, teams, categories, clips];
    return btoa(unescape(encodeURIComponent(JSON.stringify(compact))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  function createUrl(payload, viewerUrl = DEFAULT_VIEWER_URL) {
    const baseUrl = viewerUrl.replace(/\/clip\.html\/?$/, '').replace(/\/$/, '');
    return `${baseUrl}/c/${encodePayload(payload)}`;
  }

  return { VERSION, DEFAULT_VIEWER_URL, createPayload, encodePayload, createUrl };
});
