// Spotify API utility — OAuth2 auto-refresh via Cloudflare KV
// Same pattern as google-api.js

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

const KV_ACCESS_TOKEN = "spotify_access_token";
const KV_REFRESH_TOKEN = "spotify_refresh_token";
const KV_TOKEN_EXPIRY = "spotify_token_expiry";

/**
 * Get a valid Spotify access token. Auto-refreshes from KV if expired.
 */
export async function getSpotifyToken(context) {
  const kv = context.env.PORTAL_KV;
  if (!kv) throw new Error("KV not available");

  const [accessToken, expiryStr] = await Promise.all([
    kv.get(KV_ACCESS_TOKEN),
    kv.get(KV_TOKEN_EXPIRY),
  ]);

  const expiry = expiryStr ? parseInt(expiryStr, 10) : 0;
  const now = Date.now();

  if (accessToken && expiry > now + REFRESH_BUFFER_MS) {
    return accessToken;
  }

  const refreshToken = await kv.get(KV_REFRESH_TOKEN);
  if (!refreshToken) {
    throw new Error("No Spotify refresh token — run /api/cos-spotify-auth to connect");
  }

  return refreshSpotifyToken(context, refreshToken);
}

async function refreshSpotifyToken(context, refreshToken) {
  const clientId = context.env.SPOTIFY_CLIENT_ID;
  const clientSecret = context.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET");
  }

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[spotify] Token refresh failed: ${response.status} ${errText}`);
    throw new Error("Spotify token refresh failed");
  }

  const data = await response.json();
  const newAccessToken = data.access_token;
  const expiresIn = data.expires_in || 3600;

  if (!newAccessToken) {
    throw new Error("No access_token in Spotify refresh response");
  }

  const kv = context.env.PORTAL_KV;
  const newExpiry = Date.now() + expiresIn * 1000;

  const writes = [
    kv.put(KV_ACCESS_TOKEN, newAccessToken),
    kv.put(KV_TOKEN_EXPIRY, String(newExpiry)),
  ];

  // Spotify may return a new refresh token
  if (data.refresh_token) {
    writes.push(kv.put(KV_REFRESH_TOKEN, data.refresh_token));
  }

  await Promise.all(writes);
  return newAccessToken;
}

/**
 * Authenticated fetch to Spotify API.
 */
async function spotifyFetch(context, endpoint, options = {}) {
  const token = await getSpotifyToken(context);
  const url = endpoint.startsWith("http") ? endpoint : `${SPOTIFY_API_BASE}${endpoint}`;

  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

/**
 * Get current playback state.
 */
export async function getCurrentPlayback(context) {
  try {
    const resp = await spotifyFetch(context, "/me/player");
    if (resp.status === 204) return null; // No active playback
    if (!resp.ok) return null;

    const data = await resp.json();
    if (!data.item) return null;

    return {
      isPlaying: data.is_playing,
      track: data.item.name,
      artist: data.item.artists?.map(a => a.name).join(", ") || "Unknown",
      album: data.item.album?.name || "",
      progress: Math.round((data.progress_ms || 0) / 1000),
      duration: Math.round((data.item.duration_ms || 0) / 1000),
      device: data.device?.name || "Unknown",
      shuffle: data.shuffle_state,
      volume: data.device?.volume_percent,
      context: data.context?.type || null,
      contextName: null, // We'd need another call to get playlist name
    };
  } catch (err) {
    console.error("[spotify] Playback state error:", err.message);
    return null;
  }
}

/**
 * Get user's playlists (cached in KV for 30 min).
 */
export async function getUserPlaylists(context) {
  const kv = context.env.PORTAL_KV;
  const cacheKey = "spotify_playlists_cache";

  // Check cache
  if (kv) {
    const cached = await kv.get(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < 30 * 60 * 1000) {
          return parsed.playlists;
        }
      } catch { /* stale cache */ }
    }
  }

  try {
    const resp = await spotifyFetch(context, "/me/playlists?limit=50");
    if (!resp.ok) return [];

    const data = await resp.json();
    const playlists = (data.items || []).map(p => ({
      id: p.id,
      name: p.name,
      uri: p.uri,
      tracks: p.tracks?.total || 0,
      description: p.description || "",
    }));

    // Cache for 30 min
    if (kv) {
      await kv.put(cacheKey, JSON.stringify({ playlists, timestamp: Date.now() }), {
        expirationTtl: 1800,
      });
    }

    return playlists;
  } catch (err) {
    console.error("[spotify] Playlists error:", err.message);
    return [];
  }
}

/**
 * Search Spotify for tracks, playlists, or albums.
 */
export async function searchSpotify(context, query, types = "track,playlist,album", limit = 5) {
  try {
    const params = new URLSearchParams({ q: query, type: types, limit: String(limit) });
    const resp = await spotifyFetch(context, `/search?${params}`);
    if (!resp.ok) return null;

    const data = await resp.json();
    return {
      tracks: (data.tracks?.items || []).map(t => ({
        name: t.name,
        artist: t.artists?.map(a => a.name).join(", "),
        album: t.album?.name,
        uri: t.uri,
      })),
      playlists: (data.playlists?.items || []).map(p => ({
        name: p.name,
        uri: p.uri,
        tracks: p.tracks?.total,
        owner: p.owner?.display_name,
      })),
      albums: (data.albums?.items || []).map(a => ({
        name: a.name,
        artist: a.artists?.map(ar => ar.name).join(", "),
        uri: a.uri,
      })),
    };
  } catch (err) {
    console.error("[spotify] Search error:", err.message);
    return null;
  }
}

/**
 * Execute a Spotify playback command.
 * Returns { ok: boolean, message: string }
 */
export async function executeSpotifyAction(context, action) {
  try {
    switch (action.action) {
      case "play":
        return await handlePlay(context, action);
      case "pause":
        return await handlePause(context);
      case "resume":
        return await handleResume(context);
      case "skip":
        return await handleSkip(context);
      case "previous":
        return await handlePrevious(context);
      case "volume":
        return await handleVolume(context, action.level);
      case "shuffle":
        return await handleShuffle(context, action.enabled);
      case "create_playlist":
        return await handleCreatePlaylist(context, action);
      case "add_tracks":
        return await handleAddTracks(context, action);
      case "queue":
        return await handleQueue(context, action);
      default:
        return { ok: false, message: `Unknown action: ${action.action}` };
    }
  } catch (err) {
    console.error(`[spotify] Action ${action.action} error:`, err.message);
    return { ok: false, message: err.message };
  }
}

async function handlePlay(context, action) {
  // If a direct URI is provided, use it
  if (action.uri) {
    const body = action.uri.includes(":track:")
      ? { uris: [action.uri] }
      : { context_uri: action.uri };

    const resp = await spotifyFetch(context, "/me/player/play", {
      method: "PUT",
      body: JSON.stringify(body),
    });

    if (resp.status === 404) return { ok: false, message: "No active Spotify device. Open Spotify on your phone first." };
    if (!resp.ok && resp.status !== 204) return { ok: false, message: "Failed to start playback" };
    return { ok: true, message: "Playing" };
  }

  // Search by query
  if (!action.query) return { ok: false, message: "No query or URI provided" };

  // First check user's playlists for a name match
  const playlists = await getUserPlaylists(context);
  const queryLower = action.query.toLowerCase();
  const playlistMatch = playlists.find(p =>
    p.name.toLowerCase().includes(queryLower) || queryLower.includes(p.name.toLowerCase())
  );

  if (playlistMatch) {
    const resp = await spotifyFetch(context, "/me/player/play", {
      method: "PUT",
      body: JSON.stringify({ context_uri: playlistMatch.uri }),
    });
    if (resp.status === 404) return { ok: false, message: "No active Spotify device. Open Spotify on your phone first." };
    if (!resp.ok && resp.status !== 204) return { ok: false, message: "Failed to play playlist" };
    return { ok: true, message: `Playing playlist: ${playlistMatch.name}` };
  }

  // Search Spotify
  const results = await searchSpotify(context, action.query);
  if (!results) return { ok: false, message: "Search failed" };

  // Prefer playlists for genre/mood queries, tracks for specific songs
  const isGenreQuery = /playlist|mix|chill|vibes|mood|genre|jazz|rock|hip.?hop|pop|classical|ambient|lo.?fi|focus|workout|party/i.test(action.query);

  let targetUri;
  let targetName;

  if (isGenreQuery && results.playlists.length > 0) {
    targetUri = results.playlists[0].uri;
    targetName = results.playlists[0].name;
  } else if (results.tracks.length > 0) {
    targetUri = results.tracks[0].uri;
    targetName = `${results.tracks[0].name} by ${results.tracks[0].artist}`;
  } else if (results.playlists.length > 0) {
    targetUri = results.playlists[0].uri;
    targetName = results.playlists[0].name;
  } else if (results.albums.length > 0) {
    targetUri = results.albums[0].uri;
    targetName = results.albums[0].name;
  } else {
    return { ok: false, message: `No results for "${action.query}"` };
  }

  const body = targetUri.includes(":track:")
    ? { uris: [targetUri] }
    : { context_uri: targetUri };

  const resp = await spotifyFetch(context, "/me/player/play", {
    method: "PUT",
    body: JSON.stringify(body),
  });

  if (resp.status === 404) return { ok: false, message: "No active Spotify device. Open Spotify on your phone first." };
  if (!resp.ok && resp.status !== 204) return { ok: false, message: "Failed to play" };
  return { ok: true, message: `Playing: ${targetName}` };
}

async function handlePause(context) {
  const resp = await spotifyFetch(context, "/me/player/pause", { method: "PUT" });
  if (resp.status === 404) return { ok: false, message: "No active device" };
  if (!resp.ok && resp.status !== 204) return { ok: false, message: "Failed to pause" };
  return { ok: true, message: "Paused" };
}

async function handleResume(context) {
  const resp = await spotifyFetch(context, "/me/player/play", { method: "PUT" });
  if (resp.status === 404) return { ok: false, message: "No active device" };
  if (!resp.ok && resp.status !== 204) return { ok: false, message: "Failed to resume" };
  return { ok: true, message: "Resumed" };
}

async function handleSkip(context) {
  const resp = await spotifyFetch(context, "/me/player/next", { method: "POST" });
  if (resp.status === 404) return { ok: false, message: "No active device" };
  if (!resp.ok && resp.status !== 204) return { ok: false, message: "Failed to skip" };
  return { ok: true, message: "Skipped to next track" };
}

async function handlePrevious(context) {
  const resp = await spotifyFetch(context, "/me/player/previous", { method: "POST" });
  if (resp.status === 404) return { ok: false, message: "No active device" };
  if (!resp.ok && resp.status !== 204) return { ok: false, message: "Failed to go back" };
  return { ok: true, message: "Previous track" };
}

async function handleVolume(context, level) {
  const vol = Math.max(0, Math.min(100, Math.round(level)));
  const resp = await spotifyFetch(context, `/me/player/volume?volume_percent=${vol}`, { method: "PUT" });
  if (resp.status === 404) return { ok: false, message: "No active device" };
  if (!resp.ok && resp.status !== 204) return { ok: false, message: "Failed to set volume" };
  return { ok: true, message: `Volume set to ${vol}%` };
}

async function handleShuffle(context, enabled) {
  const state = enabled ? "true" : "false";
  const resp = await spotifyFetch(context, `/me/player/shuffle?state=${state}`, { method: "PUT" });
  if (resp.status === 404) return { ok: false, message: "No active device" };
  if (!resp.ok && resp.status !== 204) return { ok: false, message: "Failed to set shuffle" };
  return { ok: true, message: `Shuffle ${enabled ? "on" : "off"}` };
}

async function handleCreatePlaylist(context, action) {
  // Get user ID
  const meResp = await spotifyFetch(context, "/me");
  if (!meResp.ok) return { ok: false, message: "Failed to get user profile" };
  const me = await meResp.json();

  // Create playlist
  const createResp = await spotifyFetch(context, `/users/${me.id}/playlists`, {
    method: "POST",
    body: JSON.stringify({
      name: action.name || "New Playlist",
      description: action.description || "Created by Chief of Staff",
      public: false,
    }),
  });

  if (!createResp.ok) return { ok: false, message: "Failed to create playlist" };
  const playlist = await createResp.json();

  // Add tracks if search queries provided
  if (action.search_queries && action.search_queries.length > 0) {
    const trackUris = [];
    for (const query of action.search_queries.slice(0, 20)) {
      const results = await searchSpotify(context, query, "track", 1);
      if (results?.tracks?.length > 0) {
        trackUris.push(results.tracks[0].uri);
      }
    }

    if (trackUris.length > 0) {
      await spotifyFetch(context, `/playlists/${playlist.id}/tracks`, {
        method: "POST",
        body: JSON.stringify({ uris: trackUris }),
      });
    }

    // Start playing the new playlist
    await spotifyFetch(context, "/me/player/play", {
      method: "PUT",
      body: JSON.stringify({ context_uri: playlist.uri }),
    });

    // Invalidate playlist cache
    const kv = context.env.PORTAL_KV;
    if (kv) await kv.delete("spotify_playlists_cache");

    return { ok: true, message: `Created "${action.name}" with ${trackUris.length} tracks and started playing` };
  }

  // Invalidate playlist cache
  const kv = context.env.PORTAL_KV;
  if (kv) await kv.delete("spotify_playlists_cache");

  return { ok: true, message: `Created empty playlist "${action.name}"` };
}

async function handleAddTracks(context, action) {
  // Find the playlist by name
  const playlists = await getUserPlaylists(context);
  const match = playlists.find(p =>
    p.name.toLowerCase() === (action.playlist_name || "").toLowerCase()
  );

  if (!match) return { ok: false, message: `Playlist "${action.playlist_name}" not found` };

  const trackUris = [];
  for (const query of (action.search_queries || []).slice(0, 20)) {
    const results = await searchSpotify(context, query, "track", 1);
    if (results?.tracks?.length > 0) {
      trackUris.push(results.tracks[0].uri);
    }
  }

  if (trackUris.length === 0) return { ok: false, message: "No tracks found for the search queries" };

  const resp = await spotifyFetch(context, `/playlists/${match.id}/tracks`, {
    method: "POST",
    body: JSON.stringify({ uris: trackUris }),
  });

  if (!resp.ok) return { ok: false, message: "Failed to add tracks" };

  // Invalidate playlist cache
  const kv = context.env.PORTAL_KV;
  if (kv) await kv.delete("spotify_playlists_cache");

  return { ok: true, message: `Added ${trackUris.length} tracks to "${match.name}"` };
}

async function handleQueue(context, action) {
  if (!action.query && !action.uri) return { ok: false, message: "No track to queue" };

  let uri = action.uri;
  if (!uri) {
    const results = await searchSpotify(context, action.query, "track", 1);
    if (!results?.tracks?.length) return { ok: false, message: `No track found for "${action.query}"` };
    uri = results.tracks[0].uri;
  }

  const resp = await spotifyFetch(context, `/me/player/queue?uri=${encodeURIComponent(uri)}`, {
    method: "POST",
  });

  if (resp.status === 404) return { ok: false, message: "No active device" };
  if (!resp.ok && resp.status !== 204) return { ok: false, message: "Failed to queue track" };
  return { ok: true, message: "Track queued" };
}

/**
 * Check if Spotify is connected (has tokens in KV).
 */
export async function isSpotifyConnected(context) {
  const kv = context.env.PORTAL_KV;
  if (!kv) return false;
  const token = await kv.get(KV_REFRESH_TOKEN);
  return !!token;
}
