'use strict';

/**
 * GET /api/now-playing
 *
 * Returns the currently-playing Spotify track, falling back to the most
 * recently played one. Always responds 200 (except for non-GET methods) so the
 * front-end can degrade gracefully without try/catch gymnastics.
 *
 * Required env vars (Vercel → Project → Settings → Environment Variables):
 *   SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN
 * See SPOTIFY-SETUP.md for how to obtain them.
 */

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const NOW_PLAYING_URL = 'https://api.spotify.com/v1/me/player/currently-playing';
const RECENTLY_PLAYED_URL = 'https://api.spotify.com/v1/me/player/recently-played?limit=1';
const TIMEOUT_MS = 5000;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function fail(res, reason) {
  send(res, 200, { ok: false, isPlaying: false, reason: reason });
}

/** Smallest album image that is at least 200px on its known side, else null. */
function pickAlbumArt(images) {
  if (!Array.isArray(images)) return null;
  const eligible = images
    .filter(function (img) {
      if (!img || typeof img.url !== 'string') return false;
      const size = Math.max(Number(img.width) || 0, Number(img.height) || 0);
      return size >= 200;
    })
    .sort(function (a, b) {
      const sa = Math.max(Number(a.width) || 0, Number(a.height) || 0);
      const sb = Math.max(Number(b.width) || 0, Number(b.height) || 0);
      return sa - sb;
    });
  return eligible.length > 0 ? eligible[0].url : null;
}

function formatTrack(track, isPlaying, playedAt) {
  const artist = Array.isArray(track.artists)
    ? track.artists
        .map(function (a) { return a && a.name; })
        .filter(Boolean)
        .join(', ')
    : null;

  return {
    ok: true,
    isPlaying: isPlaying,
    title: track.name || null,
    artist: artist || null,
    album: (track.album && track.album.name) || null,
    albumArt: pickAlbumArt(track.album && track.album.images),
    url: (track.external_urls && track.external_urls.spotify) || null,
    playedAt: playedAt
  };
}

async function getAccessToken(clientId, clientSecret, refreshToken) {
  const basic = Buffer.from(clientId + ':' + clientSecret).toString('base64');

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + basic,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });

  if (!response.ok) return null;

  const data = await response.json().catch(function () { return null; });
  return data && data.access_token ? data.access_token : null;
}

/** Reads a Spotify response body that may legitimately be empty (204). */
async function readJson(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, {
      ok: false,
      isPlaying: false,
      reason: 'method_not_allowed'
    });
  }

  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return fail(res, 'not_configured');
  }

  try {
    const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);
    if (!accessToken) return fail(res, 'auth_failed');

    const auth = { Authorization: 'Bearer ' + accessToken };

    // 1. Currently playing. 204 / empty body means nothing is playing.
    const nowRes = await fetch(NOW_PLAYING_URL, {
      headers: auth,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    if (nowRes.status === 401) return fail(res, 'auth_failed');
    if (!nowRes.ok && nowRes.status !== 204) return fail(res, 'spotify_error');

    const now = await readJson(nowRes);
    if (now && now.is_playing === true && now.item && now.item.name) {
      return send(res, 200, formatTrack(now.item, true, null));
    }

    // 2. Nothing playing (or a paused / non-track item) -> most recent track.
    const recentRes = await fetch(RECENTLY_PLAYED_URL, {
      headers: auth,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    if (recentRes.status === 401) return fail(res, 'auth_failed');
    if (!recentRes.ok) return fail(res, 'spotify_error');

    const recent = await readJson(recentRes);
    const item = recent && Array.isArray(recent.items) ? recent.items[0] : null;
    if (!item || !item.track || !item.track.name) {
      return fail(res, 'no_recent_tracks');
    }

    return send(res, 200, formatTrack(item.track, false, item.played_at || null));
  } catch (err) {
    return fail(res, 'spotify_error');
  }
};
