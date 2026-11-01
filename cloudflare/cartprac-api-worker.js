const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "vary": "Origin",
};

const SUPABASE_URL = "https://zznivmazwvyswwosekjj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_mOgN10sQ2KJ_WWvabbHrTw__qIlqSGX";
const DEFAULT_ORIGINS = [
  "https://masiharashidi588-max.github.io",
  "https://cartprac-account.masiharashidi588.workers.dev",
];
const AVATAR_PRESETS = new Set(["tnt", "redstone", "minecart", "blaze"]);
const AVATAR_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

function allowedOrigins(env) {
  return [...new Set([
    ...DEFAULT_ORIGINS,
    ...String(env.ALLOWED_ORIGIN || "").split(",").map((value) => value.trim()).filter(Boolean),
  ])];
}

function response(request, env, data, status = 200, extraHeaders = {}) {
  const headers = { ...JSON_HEADERS, ...extraHeaders };
  const origin = request.headers.get("Origin");
  if (origin && allowedOrigins(env).includes(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = "GET, POST, DELETE, OPTIONS";
    headers["access-control-allow-headers"] = "Content-Type, Authorization";
    headers["access-control-max-age"] = "86400";
  }
  return new Response(status === 204 ? null : JSON.stringify(data), { status, headers });
}

function fail(request, env, status, message) {
  return response(request, env, { ok: false, error: message }, status);
}

function binaryResponse(request, env, upstream, cache = "private, max-age=60") {
  const headers = new Headers({
    "content-type": upstream.headers.get("content-type") || "application/octet-stream",
    "cache-control": cache,
    "x-content-type-options": "nosniff",
    "vary": "Origin",
  });
  const origin = request.headers.get("Origin");
  if (origin && allowedOrigins(env).includes(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
    headers.set("access-control-allow-headers", "Content-Type, Authorization");
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function pluginAuthorized(request, env) {
  const token = env.PLUGIN_TOKEN;
  return Boolean(token) && request.headers.get("Authorization") === `Bearer ${token}`;
}

function cleanString(value, maxLength = 40) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validInteger(value, min = 0, max = 1000000) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cartpracId(id) {
  return `CP-${String(id).padStart(6, "0")}`;
}

function avatarKeyUrl(username) {
  return `/api/public/avatar?username=${encodeURIComponent(username)}`;
}

function mapProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    cartpracId: cartpracId(row.id),
    username: row.username,
    role: row.role,
    profileVisibility: row.profile_visibility,
    leaderboardVisibility: Boolean(row.leaderboard_visibility),
    avatarPreset: AVATAR_PRESETS.has(row.avatar_preset) ? row.avatar_preset : "tnt",
    hasUploadedAvatar: Boolean(row.avatar_key),
    usernameChangedAt: row.username_changed_at,
    createdAt: row.created_at,
  };
}

async function supabaseUser(request) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  if (token.length < 30 || token.length > 8192) return null;
  const result = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!result.ok) return null;
  const user = await result.json().catch(() => null);
  if (!user?.id || !user?.email) return null;
  return { id: user.id, email: user.email, token };
}

async function getProfile(env, userId) {
  return env.DB.prepare("SELECT * FROM account_profiles WHERE user_id = ?").bind(userId).first();
}

async function requireProfile(request, env, user) {
  const profile = await getProfile(env, user.id);
  return profile || null;
}

async function hasStaffRole(env, userId) {
  const row = await env.DB.prepare("SELECT role FROM account_profiles WHERE user_id = ?").bind(userId).first();
  return row?.role === "admin" || row?.role === "moderator";
}

async function requireRole(request, env, user, roles) {
  const row = await getProfile(env, user.id);
  return row && roles.includes(row.role) ? row : null;
}

async function syncAvatarVisibility(user, isPublic) {
  const result = await fetch(`${SUPABASE_URL}/rest/v1/account_avatar_visibility?on_conflict=user_id`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${user.token}`,
      "content-type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ user_id: user.id, is_public: Boolean(isPublic), updated_at: new Date().toISOString() }),
  });
  if (!result.ok) {
    console.error("Avatar visibility sync failed:", result.status, await result.text().catch(() => ""));
    return false;
  }
  return true;
}

async function allowRate(env, key, limit, windowSeconds, now) {
  await env.DB.prepare(
    `INSERT INTO api_rate_limits (key, count, window_start) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN ? - window_start >= ? THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN ? - window_start >= ? THEN ? ELSE window_start END`
  ).bind(key, now, now, windowSeconds, now, windowSeconds, now).run();
  const row = await env.DB.prepare("SELECT count FROM api_rate_limits WHERE key = ?").bind(key).first();
  return (row?.count || 0) <= limit;
}

async function loadLeaderboard(env, limit = 10) {
  const result = await env.DB.prepare(
    `SELECT ps.player_uuid AS uuid, ps.player_name AS name, ps.wins, ps.losses, ps.kills, ps.deaths
     FROM player_stats ps
     JOIN minecraft_links ml ON ml.player_uuid = ps.player_uuid
     JOIN account_profiles ap ON ap.user_id = ml.user_id
     WHERE ap.leaderboard_visibility = 1
     ORDER BY ps.wins DESC, ps.kills DESC, ps.losses ASC LIMIT ?`
  ).bind(limit).all();
  return result.results || [];
}

function validatePlayerStats(body) {
  const uuid = cleanString(body?.uuid, 36).toLowerCase();
  const name = cleanString(body?.name, 16);
  const wins = body?.wins;
  const losses = body?.losses;
  const kills = body?.kills ?? 0;
  const deaths = body?.deaths ?? 0;
  if (!uuid || !/^[a-f0-9-]{32,36}$/.test(uuid) || !name ||
      !validInteger(wins, 0, 100000000) || !validInteger(losses, 0, 100000000) ||
      !validInteger(kills, 0, 100000000) || !validInteger(deaths, 0, 100000000)) return null;
  return { uuid, name, wins, losses, kills, deaths };
}

async function upsertPlayerStats(env, player, now) {
  await env.DB.prepare(
    `INSERT INTO player_stats (player_uuid, player_name, wins, losses, kills, deaths, elo, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1000, ?)
     ON CONFLICT(player_uuid) DO UPDATE SET player_name=excluded.player_name, wins=excluded.wins,
       losses=excluded.losses, kills=excluded.kills, deaths=excluded.deaths, updated_at=excluded.updated_at`
  ).bind(player.uuid, player.name, player.wins, player.losses, player.kills, player.deaths, now).run();
}

async function getWebSession(request, env, now) {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (token.length < 30 || token.length > 200) return null;
  const tokenHash = await sha256(token);
  return await env.DB.prepare(
    "SELECT player_uuid, player_name, expires_at FROM web_sessions WHERE token_hash = ? AND expires_at > ?"
  ).bind(tokenHash, now).first();
}

function validUsername(value) {
  return typeof value === "string" && /^[A-Za-z0-9_]{3,16}$/.test(value.trim());
}

function slugify(value) {
  const slug = value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
  return slug || `announcement-${Date.now()}`;
}

async function updateAvatarVisibility(user, profile) {
  await syncAvatarVisibility(user, profile.profile_visibility === "public" && Boolean(profile.avatar_key));
}

async function handleAccountMe(request, env, user, now) {
  const profile = await getProfile(env, user.id);
  const minecraft = await env.DB.prepare(
    "SELECT player_uuid, player_name, linked_at FROM minecraft_links WHERE user_id = ?"
  ).bind(user.id).first();
  let stats = null;
  if (minecraft) {
    stats = await env.DB.prepare(
      "SELECT wins, losses, kills, deaths FROM player_stats WHERE player_uuid = ?"
    ).bind(minecraft.player_uuid).first();
  }
  return response(request, env, {
    ok: true,
    email: user.email,
    profile: mapProfile(profile),
    minecraft: minecraft ? { player_uuid: minecraft.player_uuid, player_name: minecraft.player_name, linked_at: minecraft.linked_at } : null,
    stats: stats || null,
    achievements: [],
  });
}

async function handleSaveProfile(request, env, user, now) {
  const body = await readJson(request);
  if (!body || !validUsername(body.username)) return fail(request, env, 400, "Username must be 3–16 characters and use only letters, numbers or underscores.");
  const username = body.username.trim();
  const visibility = body.profileVisibility === "public" ? "public" : "private";
  const leaderboardVisibility = body.leaderboardVisibility === true ? 1 : 0;
  const avatarPreset = AVATAR_PRESETS.has(body.avatarPreset) ? body.avatarPreset : null;
  const existing = await getProfile(env, user.id);
  if (!(await allowRate(env, `profile-save:${user.id}`, 12, 60, now))) {
    return fail(request, env, 429, "Too many profile changes. Try again in a minute.");
  }
  // Revoke direct public Storage reads before committing a privacy change.
  const removesPublicAvatar = Boolean(existing?.avatar_key) && existing.profile_visibility === "public" &&
    (visibility === "private" || Boolean(avatarPreset));
  if (removesPublicAvatar && !(await syncAvatarVisibility(user, false))) {
    return fail(request, env, 503, "Your privacy change could not be synchronized. Nothing was changed; please retry.");
  }
  if (!existing) {
    try {
      await env.DB.prepare(
        `INSERT INTO account_profiles
          (user_id, username, profile_visibility, leaderboard_visibility, avatar_preset, avatar_key, created_at, updated_at, username_changed_at)
         VALUES (?, ?, 'private', 0, ?, NULL, ?, ?, ?)`
      ).bind(user.id, username, avatarPreset || "tnt", now, now, now).run();
    } catch (error) {
      if (/UNIQUE|constraint/i.test(String(error?.message))) return fail(request, env, 409, "That username is already taken.");
      throw error;
    }
  } else {
    const changed = existing.username.toLowerCase() !== username.toLowerCase();
    if (changed && now - Number(existing.username_changed_at || 0) < 30 * 24 * 60 * 60) {
      const next = Number(existing.username_changed_at || 0) + 30 * 24 * 60 * 60;
      return fail(request, env, 429, `You can change your username again after ${new Date(next * 1000).toLocaleDateString("en-US", { timeZone: "UTC" })}.`);
    }
    try {
      await env.DB.prepare(
        `UPDATE account_profiles SET username = ?, profile_visibility = ?, leaderboard_visibility = ?,
           avatar_preset = CASE WHEN ? IS NULL THEN avatar_preset ELSE ? END,
           avatar_key = CASE WHEN ? IS NULL THEN avatar_key ELSE NULL END,
           username_changed_at = CASE WHEN ? = 1 THEN ? ELSE username_changed_at END,
           updated_at = ? WHERE user_id = ?`
      ).bind(username, visibility, leaderboardVisibility, avatarPreset, avatarPreset, avatarPreset, changed ? 1 : 0, now, now, user.id).run();
    } catch (error) {
      if (/UNIQUE|constraint/i.test(String(error?.message))) return fail(request, env, 409, "That username is already taken.");
      throw error;
    }
  }
  const saved = await getProfile(env, user.id);
  if (!(await updateAvatarVisibility(user, saved))) {
    return fail(request, env, 503, "Your profile was saved, but avatar visibility could not be synchronized. The uploaded avatar remains private until this is resolved.");
  }
  if (existing?.avatar_key && avatarPreset) {
    fetch(`${SUPABASE_URL}/storage/v1/object/avatars/${existing.avatar_key.split("/").map(encodeURIComponent).join("/")}`, {
      method: "DELETE",
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${user.token}` },
    }).catch(() => {});
  }
  return response(request, env, { ok: true, profile: mapProfile(saved) });
}

async function handleAvatar(request, env, user, now) {
  const profile = await getProfile(env, user.id);
  if (!profile) return fail(request, env, 409, "Create your CartPrac profile before uploading an avatar.");
  if (request.method === "GET") {
    if (!profile.avatar_key) return fail(request, env, 404, "No uploaded avatar is set.");
    const upstream = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/avatars/${profile.avatar_key.split("/").map(encodeURIComponent).join("/")}`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${user.token}` },
    });
    if (!upstream.ok) return fail(request, env, upstream.status === 404 ? 404 : 502, "Could not load your uploaded avatar.");
    return binaryResponse(request, env, upstream);
  }
  if (request.method !== "POST") return fail(request, env, 405, "Method not allowed.");
  const contentType = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  const extension = AVATAR_TYPES.get(contentType);
  if (!extension) return fail(request, env, 415, "Use a PNG, JPEG or WebP image.");
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > 1024 * 1024) return fail(request, env, 413, "Avatar images must be 1 MB or smaller.");
  const data = await request.arrayBuffer();
  if (!data.byteLength || data.byteLength > 1024 * 1024) return fail(request, env, 413, "Avatar images must be between 1 byte and 1 MB.");
  const bytes = new Uint8Array(data);
  const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
    bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp = bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!(contentType === "image/png" && isPng) &&
      !(contentType === "image/jpeg" && isJpeg) &&
      !(contentType === "image/webp" && isWebp)) {
    return fail(request, env, 415, "The file contents do not match the selected image format.");
  }
  const dailyKey = `avatar:${user.id}:${new Date(now * 1000).toISOString().slice(0, 10)}`;
  if (!(await allowRate(env, dailyKey, 5, 24 * 60 * 60, now))) return fail(request, env, 429, "Avatar upload limit reached. You can upload up to 5 images per day.");
  const key = `${user.id}/${crypto.randomUUID()}.${extension}`;
  const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/avatars/${key.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${user.token}`,
      "Content-Type": contentType,
      "x-upsert": "false",
    },
    body: data,
  });
  if (!upload.ok) {
    console.error("Avatar storage upload failed:", upload.status, await upload.text().catch(() => ""));
    return fail(request, env, upload.status === 400 || upload.status === 403 ? 403 : 502, "Avatar upload was rejected by storage permissions.");
  }
  const oldKey = profile.avatar_key;
  await env.DB.prepare("UPDATE account_profiles SET avatar_key = ?, updated_at = ? WHERE user_id = ?")
    .bind(key, now, user.id).run();
  const saved = await getProfile(env, user.id);
  await updateAvatarVisibility(user, saved);
  if (oldKey) {
    fetch(`${SUPABASE_URL}/storage/v1/object/avatars/${oldKey.split("/").map(encodeURIComponent).join("/")}`, {
      method: "DELETE",
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${user.token}` },
    }).catch(() => {});
  }
  return response(request, env, { ok: true, avatarKey: key });
}

async function handlePublicAvatar(request, env, username) {
  if (!username) return fail(request, env, 400, "Username is required.");
  const profile = await env.DB.prepare(
    "SELECT username, avatar_key FROM account_profiles WHERE username = ? COLLATE NOCASE AND profile_visibility = 'public'"
  ).bind(username).first();
  if (!profile?.avatar_key) return fail(request, env, 404, "Public uploaded avatar not found.");
  const key = profile.avatar_key.split("/").map(encodeURIComponent).join("/");
  const upstream = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/avatars/${key}`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
  });
  if (!upstream.ok) return fail(request, env, upstream.status === 404 ? 404 : 502, "Public avatar could not be loaded.");
  return binaryResponse(request, env, upstream, "private, no-store");
}

async function handleMinecraftLink(request, env, user, now) {
  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM minecraft_links WHERE user_id = ?").bind(user.id).run();
    return response(request, env, { ok: true });
  }
  if (!(await allowRate(env, `minecraft-link:${user.id}`, 6, 300, now))) {
    return fail(request, env, 429, "Too many Minecraft linking attempts. Try again in five minutes.");
  }
  const body = await readJson(request);
  const code = cleanString(body?.code, 8).toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(code)) return fail(request, env, 400, "Enter the 8-character code from Minecraft.");
  const current = await env.DB.prepare("SELECT player_uuid, player_name FROM minecraft_links WHERE user_id = ?").bind(user.id).first();
  if (current) return fail(request, env, 409, "A Minecraft account is already linked. Unlink it first.");
  const pairing = await env.DB.prepare(
    "SELECT code, player_uuid, player_name, expires_at FROM pairing_codes WHERE code = ? AND expires_at > ?"
  ).bind(code, now).first();
  if (!pairing) return fail(request, env, 400, "Code is invalid or expired. Generate a new one in Minecraft.");
  const deleted = await env.DB.prepare("DELETE FROM pairing_codes WHERE code = ? AND expires_at > ?").bind(code, now).run();
  if ((deleted.meta?.changes || 0) === 0) return fail(request, env, 409, "That code has already been used.");
  try {
    await env.DB.prepare(
      "INSERT INTO minecraft_links (user_id, player_uuid, player_name, linked_at) VALUES (?, ?, ?, ?)"
    ).bind(user.id, pairing.player_uuid, pairing.player_name, now).run();
  } catch (error) {
    if (/UNIQUE|constraint/i.test(String(error?.message))) return fail(request, env, 409, "That Minecraft account is already linked to another CartPrac account.");
    throw error;
  }
  return response(request, env, { ok: true, playerName: pairing.player_name });
}

async function handlePublicProfile(request, env, username) {
  if (!username) return fail(request, env, 400, "Username is required.");
  const profile = await env.DB.prepare(
    `SELECT id, user_id, username, role, profile_visibility, leaderboard_visibility, avatar_preset, avatar_key
     FROM account_profiles WHERE username = ? COLLATE NOCASE AND profile_visibility = 'public'`
  ).bind(username).first();
  if (!profile) return fail(request, env, 404, "This profile does not exist or is private.");
  const minecraft = await env.DB.prepare("SELECT player_uuid FROM minecraft_links WHERE user_id = ?").bind(profile.user_id).first();
  let stats = null;
  if (minecraft) stats = await env.DB.prepare(
    "SELECT wins, losses, kills, deaths FROM player_stats WHERE player_uuid = ?"
  ).bind(minecraft.player_uuid).first();
  return response(request, env, {
    ok: true,
    profile: {
      username: profile.username,
      cartpracId: cartpracId(profile.id),
      avatarPreset: AVATAR_PRESETS.has(profile.avatar_preset) ? profile.avatar_preset : "tnt",
      avatarUrl: profile.avatar_key ? avatarKeyUrl(profile.username) : null,
      stats: stats || null,
    },
  });
}

async function handleLeaderboard(request, env, url) {
  const category = url.searchParams.get("category") || "wins";
  if (!["wins", "kills", "kd", "winrate"].includes(category)) return fail(request, env, 400, "Unknown leaderboard category.");
  const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "50", 10) || 50));
  const metric = category === "wins" ? "ps.wins" : category === "kills" ? "ps.kills" :
    category === "kd" ? "CASE WHEN ps.deaths = 0 THEN CAST(ps.kills AS REAL) ELSE CAST(ps.kills AS REAL) / ps.deaths END" :
    "CASE WHEN ps.wins + ps.losses = 0 THEN 0 ELSE 100.0 * ps.wins / (ps.wins + ps.losses) END";
  const minMatches = category === "kd" || category === "winrate" ? "AND ps.wins + ps.losses >= 10" : "";
  const order = category === "wins" ? "ps.wins DESC, ps.kills DESC, ps.losses ASC" :
    category === "kills" ? "ps.kills DESC, ps.wins DESC" :
    category === "kd" ? "metric DESC, ps.kills DESC, ps.deaths ASC" : "metric DESC, ps.wins DESC";
  const sql = `SELECT ap.id, ap.username, ap.user_id, ml.player_uuid, ps.wins, ps.losses, ps.kills, ps.deaths, (${metric}) AS metric
    FROM account_profiles ap JOIN minecraft_links ml ON ml.user_id = ap.user_id
    JOIN player_stats ps ON ps.player_uuid = ml.player_uuid
    WHERE ap.leaderboard_visibility = 1 ${minMatches}
    ORDER BY ${order} LIMIT ?`;
  const result = await env.DB.prepare(sql).bind(limit).all();
  const players = (result.results || []).map((row, index) => ({
    rank: index + 1,
    username: row.username,
    cartpracId: cartpracId(row.id),
    wins: row.wins,
    losses: row.losses,
    kills: row.kills,
    deaths: row.deaths,
    kd: row.deaths === 0 ? row.kills : Math.round((row.kills / row.deaths) * 100) / 100,
    winRate: row.wins + row.losses === 0 ? 0 : Math.round((row.wins / (row.wins + row.losses)) * 10000) / 100,
  }));
  const note = category === "kd" || category === "winrate"
    ? "K/D and win rate rankings include players with at least 10 completed matches. Only synchronized player statistics are included."
    : "Rankings include players who opted in to public leaderboard visibility and whose statistics are synchronized.";
  return response(request, env, { ok: true, players, note });
}

async function handleNews(request, env, path) {
  if (path === "/api/news") {
    const result = await env.DB.prepare(
      "SELECT slug, title, summary, category, published_at FROM news_posts WHERE published = 1 ORDER BY published_at DESC, id DESC LIMIT 50"
    ).all();
    return response(request, env, { posts: result.results || [] });
  }
  const slug = decodeURIComponent(path.slice("/api/news/".length));
  const post = await env.DB.prepare(
    "SELECT slug, title, summary, body, category, author_name, published_at FROM news_posts WHERE slug = ? AND published = 1"
  ).bind(slug).first();
  if (!post) return fail(request, env, 404, "Announcement not found.");
  return response(request, env, { post });
}

async function handleForumCategories(request, env) {
  const result = await env.DB.prepare("SELECT slug, name, description, sort_order FROM forum_categories ORDER BY sort_order, id").all();
  return response(request, env, { categories: result.results || [] });
}

async function handleForumThreads(request, env, user, url, now) {
  const body = await readJson(request);
  const category = cleanString(body?.category, 60);
  const title = cleanString(body?.title, 100);
  const content = typeof body?.body === "string" ? body.body.trim().slice(0, 6000) : "";
  if (!category || !title || title.length < 3 || content.length < 2) return fail(request, env, 400, "Choose a category and enter a title and message.");
  const profile = await getProfile(env, user.id);
  if (!profile) return fail(request, env, 409, "Create your CartPrac profile before posting.");
  if (!(await allowRate(env, `thread:${user.id}`, 5, 60, now))) return fail(request, env, 429, "You are posting too quickly. Try again in a minute.");
  const cat = await env.DB.prepare("SELECT id FROM forum_categories WHERE slug = ?").bind(category).first();
  if (!cat) return fail(request, env, 400, "Choose a valid forum category.");
  const created = await env.DB.prepare(
    "INSERT INTO forum_threads (category_id, user_id, title, body, status, created_at, updated_at, replies_count) VALUES (?, ?, ?, ?, 'open', ?, ?, 0)"
  ).bind(cat.id, user.id, title, content, now, now).run();
  return response(request, env, { ok: true, id: created.meta?.last_row_id });
}

async function handleForumThread(request, env, user, path, now) {
  const match = path.match(/^\/api\/forums\/threads\/(\d+)(?:\/replies)?$/);
  if (!match) return fail(request, env, 404, "Discussion not found.");
  const id = Number(match[1]);
  if (path.endsWith("/replies") && request.method === "POST") {
    const body = await readJson(request);
    const content = typeof body?.body === "string" ? body.body.trim().slice(0, 5000) : "";
    if (content.length < 2) return fail(request, env, 400, "Write a longer reply.");
    const profile = await getProfile(env, user.id);
    if (!profile) return fail(request, env, 409, "Create your CartPrac profile before replying.");
    if (!(await allowRate(env, `reply:${user.id}`, 12, 60, now))) return fail(request, env, 429, "You are replying too quickly. Try again in a minute.");
    const thread = await env.DB.prepare("SELECT status FROM forum_threads WHERE id = ?").bind(id).first();
    if (!thread) return fail(request, env, 404, "Discussion not found.");
    if (thread.status !== "open") return fail(request, env, 409, "This discussion is locked.");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO forum_replies (thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?)").bind(id, user.id, content, now),
      env.DB.prepare("UPDATE forum_threads SET replies_count = replies_count + 1, updated_at = ? WHERE id = ?").bind(now, id),
    ]);
    return response(request, env, { ok: true });
  }
  const thread = await env.DB.prepare(
    `SELECT t.id, t.title, t.body, t.status, t.created_at, t.updated_at, t.replies_count,
            c.name AS category, ap.username AS author
     FROM forum_threads t JOIN forum_categories c ON c.id = t.category_id
     LEFT JOIN account_profiles ap ON ap.user_id = t.user_id WHERE t.id = ?`
  ).bind(id).first();
  if (!thread) return fail(request, env, 404, "Discussion not found.");
  const replies = await env.DB.prepare(
    `SELECT r.id, r.body, r.created_at, COALESCE(ap.username, 'Former member') AS author
     FROM forum_replies r LEFT JOIN account_profiles ap ON ap.user_id = r.user_id
     WHERE r.thread_id = ? ORDER BY r.created_at, r.id`
  ).bind(id).all();
  return response(request, env, { thread, replies: replies.results || [] });
}

async function handleSupport(request, env, user, path, now) {
  const profile = await getProfile(env, user.id);
  if (!profile) return fail(request, env, 409, "Create your CartPrac profile before using support.");
  const isStaff = profile.role === "admin" || profile.role === "moderator";
  if (path === "/api/support/tickets" && request.method === "POST") {
    const body = await readJson(request);
    const subject = cleanString(body?.subject, 100);
    const category = cleanString(body?.category, 40) || "General";
    const message = typeof body?.message === "string" ? body.message.trim().slice(0, 5000) : "";
    if (subject.length < 3 || message.length < 2) return fail(request, env, 400, "Enter a subject and describe the issue.");
    if (!(await allowRate(env, `ticket:${user.id}`, 5, 3600, now))) return fail(request, env, 429, "You have opened several tickets recently. Try again later.");
    const inserted = await env.DB.prepare(
      "INSERT INTO support_tickets (user_id, subject, category, status, created_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?)"
    ).bind(user.id, subject, category, now, now).run();
    const id = inserted.meta?.last_row_id;
    await env.DB.prepare("INSERT INTO support_messages (ticket_id, sender_user_id, body, created_at) VALUES (?, ?, ?, ?)")
      .bind(id, user.id, message, now).run();
    return response(request, env, { ok: true, id });
  }
  if (path === "/api/support/tickets" && request.method === "GET") {
    const result = await env.DB.prepare(
      `SELECT id, subject, category, status, created_at, updated_at FROM support_tickets
       ${isStaff ? "" : "WHERE user_id = ?"} ORDER BY updated_at DESC LIMIT 100`
    ).bind(...(isStaff ? [] : [user.id])).all();
    return response(request, env, { tickets: result.results || [] });
  }
  const match = path.match(/^\/api\/support\/tickets\/(\d+)(?:\/messages)?$/);
  if (!match) return fail(request, env, 404, "Support ticket not found.");
  const id = Number(match[1]);
  const ticket = await env.DB.prepare("SELECT * FROM support_tickets WHERE id = ?").bind(id).first();
  if (!ticket || (!isStaff && ticket.user_id !== user.id)) return fail(request, env, 404, "Support ticket not found.");
  if (path.endsWith("/messages") && request.method === "POST") {
    const body = await readJson(request);
    const content = typeof body?.body === "string" ? body.body.trim().slice(0, 5000) : "";
    if (content.length < 2) return fail(request, env, 400, "Write a longer reply.");
    if (ticket.status === "closed") return fail(request, env, 409, "This ticket is closed.");
    if (!(await allowRate(env, `ticket-reply:${user.id}`, 15, 60, now))) return fail(request, env, 429, "You are sending replies too quickly.");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO support_messages (ticket_id, sender_user_id, body, created_at) VALUES (?, ?, ?, ?)").bind(id, user.id, content, now),
      env.DB.prepare("UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?").bind(isStaff ? "open" : "waiting", now, id),
    ]);
    return response(request, env, { ok: true });
  }
  const messages = await env.DB.prepare(
    `SELECT m.id, m.body, m.created_at, COALESCE(ap.username, 'CartPrac staff') AS sender
     FROM support_messages m LEFT JOIN account_profiles ap ON ap.user_id = m.sender_user_id
     WHERE m.ticket_id = ? ORDER BY m.created_at, m.id`
  ).bind(id).all();
  return response(request, env, { ticket, messages: messages.results || [] });
}

async function handleAdmin(request, env, user, path, now) {
  if (path === "/api/admin/overview" && request.method === "GET") {
    const profile = await requireRole(request, env, user, ["admin", "moderator"]);
    if (!profile) return fail(request, env, 403, "Staff access required.");
    const queries = await Promise.all([
      ["profiles", "SELECT COUNT(*) AS n FROM account_profiles"],
      ["public_profiles", "SELECT COUNT(*) AS n FROM account_profiles WHERE profile_visibility = 'public'"],
      ["linked_minecraft_accounts", "SELECT COUNT(*) AS n FROM minecraft_links"],
      ["forum_threads", "SELECT COUNT(*) AS n FROM forum_threads"],
      ["support_tickets", "SELECT COUNT(*) AS n FROM support_tickets"],
      ["open_support_tickets", "SELECT COUNT(*) AS n FROM support_tickets WHERE status != 'closed'"],
      ["published_news", "SELECT COUNT(*) AS n FROM news_posts WHERE published = 1"],
    ].map(async ([key, sql]) => [key, (await env.DB.prepare(sql).first())?.n || 0]));
    return response(request, env, { counts: Object.fromEntries(queries), role: profile.role });
  }
  if (path === "/api/admin/news" && request.method === "POST") {
    const profile = await requireRole(request, env, user, ["admin"]);
    if (!profile) return fail(request, env, 403, "Only administrators can publish announcements.");
    const body = await readJson(request);
    const title = cleanString(body?.title, 100);
    const summary = cleanString(body?.summary, 220);
    const category = cleanString(body?.category, 40) || "Network";
    const content = typeof body?.body === "string" ? body.body.trim().slice(0, 12000) : "";
    if (title.length < 3 || summary.length < 5 || content.length < 5) return fail(request, env, 400, "Complete the title, summary and article before publishing.");
    let slug = slugify(title);
    const exists = await env.DB.prepare("SELECT id FROM news_posts WHERE slug = ?").bind(slug).first();
    if (exists) slug = `${slug}-${now}`;
    await env.DB.prepare(
      `INSERT INTO news_posts (slug, title, summary, body, category, author_user_id, author_name, published, created_at, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).bind(slug, title, summary, content, category, user.id, profile.username, now, now).run();
    return response(request, env, { ok: true, slug });
  }
  return fail(request, env, 404, "Unknown admin route.");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const now = Math.floor(Date.now() / 1000);
    const origin = request.headers.get("Origin");
    const origins = allowedOrigins(env);

    if (request.method === "OPTIONS") {
      if (origin && !origins.includes(origin)) return fail(request, env, 403, "Origin not allowed");
      return response(request, env, { ok: true }, 204);
    }
    if (origin && !origins.includes(origin) && request.method !== "GET") {
      return fail(request, env, 403, "Origin not allowed");
    }

    try {
      if (request.method === "GET" && path === "/api/health") {
        return response(request, env, {
          ok: true,
          service: "cartprac-api",
          database: Boolean(env.DB),
          pluginTokenConfigured: Boolean(env.PLUGIN_TOKEN),
          accountApi: true,
        });
      }

      if (request.method === "GET" && path === "/api/stats") {
        const row = await env.DB.prepare(
          "SELECT online_players, max_players, queue_count, active_matches, available_kits_json, updated_at FROM server_status WHERE id = 1"
        ).first();
        const updatedAt = row?.updated_at || 0;
        const online = updatedAt > 0 && (now - updatedAt) <= 45;
        const leaderboard = await loadLeaderboard(env, 10);
        return response(request, env, {
          online,
          playersOnline: online ? row.online_players : 0,
          maxPlayers: row?.max_players || 0,
          queueSize: online ? row.queue_count : 0,
          activeMatches: online ? row.active_matches : 0,
          availableKits: online ? parseJsonArray(row.available_kits_json) : [],
          leaderboard,
          updatedAt,
        });
      }

      if (request.method === "GET" && path === "/api/kits") {
        const row = await env.DB.prepare("SELECT available_kits_json, updated_at FROM server_status WHERE id = 1").first();
        const online = Boolean(row?.updated_at) && now - row.updated_at <= 45;
        return response(request, env, { online, kits: online ? parseJsonArray(row.available_kits_json) : [] });
      }

      if (request.method === "GET" && path === "/api/leaderboard") {
        return handleLeaderboard(request, env, url);
      }

      if (request.method === "GET" && path === "/api/news" || request.method === "GET" && path.startsWith("/api/news/")) {
        return handleNews(request, env, path);
      }

      if (request.method === "GET" && path === "/api/forums/categories") {
        return handleForumCategories(request, env);
      }

      if (request.method === "GET" && path === "/api/forums/threads") {
        const category = url.searchParams.get("category");
        if (!category) return fail(request, env, 400, "Choose a forum category.");
        const rows = await env.DB.prepare(
          `SELECT t.id, t.title, t.body, t.status, t.created_at, t.updated_at, t.replies_count,
                  COALESCE(ap.username, 'Former member') AS author
           FROM forum_threads t JOIN forum_categories c ON c.id = t.category_id
           LEFT JOIN account_profiles ap ON ap.user_id = t.user_id
           WHERE c.slug = ? ORDER BY t.updated_at DESC, t.id DESC LIMIT 50`
        ).bind(category).all();
        return response(request, env, { threads: rows.results || [] });
      }

      if (request.method === "GET" && path.startsWith("/api/forums/threads/")) {
        return handleForumThread(request, env, null, path, now);
      }

      if (request.method === "GET" && path === "/api/public/profile") {
        return handlePublicProfile(request, env, url.searchParams.get("username"));
      }
      if (request.method === "GET" && path === "/api/public/avatar") {
        return handlePublicAvatar(request, env, url.searchParams.get("username"));
      }

      if (path.startsWith("/api/plugin/") && !pluginAuthorized(request, env)) {
        return fail(request, env, 401, "Plugin authentication required");
      }

      if (path.startsWith("/api/account/") || path.startsWith("/api/support/") || path.startsWith("/api/admin/") ||
          path === "/api/forums/threads" && request.method === "POST" ||
          /^\/api\/forums\/threads\/\d+\/replies$/.test(path) && request.method === "POST") {
        const user = await supabaseUser(request);
        if (!user) return fail(request, env, 401, "Sign in to your CartPrac account first.");

        if (path === "/api/account/me" && request.method === "GET") return handleAccountMe(request, env, user, now);
        if (path === "/api/account/profile" && request.method === "POST") return handleSaveProfile(request, env, user, now);
        if (path === "/api/account/avatar") return handleAvatar(request, env, user, now);
        if (path === "/api/account/minecraft/link" && ["POST", "DELETE"].includes(request.method)) return handleMinecraftLink(request, env, user, now);
        if (path === "/api/forums/threads" && request.method === "POST") return handleForumThreads(request, env, user, url, now);
        if (path.startsWith("/api/forums/threads/") && path.endsWith("/replies") && request.method === "POST") return handleForumThread(request, env, user, path, now);
        if (path.startsWith("/api/support/")) return handleSupport(request, env, user, path, now);
        if (path.startsWith("/api/admin/")) return handleAdmin(request, env, user, path, now);
      }

      if (request.method === "POST" && path === "/api/plugin/heartbeat") {
        const body = await readJson(request);
        const availableKits = Array.isArray(body?.availableKits)
          ? [...new Set(body.availableKits.map((kit) => cleanString(kit, 40)).filter(Boolean))].slice(0, 100)
          : [];
        if (!body || !validInteger(body.onlinePlayers, 0, 10000) || !validInteger(body.maxPlayers, 0, 10000) ||
            !validInteger(body.queueCount, 0, 100000) || !validInteger(body.activeMatches, 0, 100000)) {
          return fail(request, env, 400, "Invalid heartbeat payload");
        }
        await env.DB.prepare(
          `INSERT INTO server_status (id, online_players, max_players, queue_count, active_matches, available_kits_json, updated_at)
           VALUES (1, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET online_players=excluded.online_players, max_players=excluded.max_players,
             queue_count=excluded.queue_count, active_matches=excluded.active_matches,
             available_kits_json=excluded.available_kits_json, updated_at=excluded.updated_at`
        ).bind(body.onlinePlayers, body.maxPlayers, body.queueCount, body.activeMatches, JSON.stringify(availableKits), now).run();
        return response(request, env, { ok: true, updatedAt: now });
      }

      if (request.method === "POST" && path === "/api/plugin/player-stats") {
        const body = await readJson(request);
        const normalized = validatePlayerStats(body);
        if (!normalized) return fail(request, env, 400, "Invalid player stats payload");
        await upsertPlayerStats(env, normalized, now);
        return response(request, env, { ok: true });
      }

      if (request.method === "POST" && path === "/api/plugin/player-stats/batch") {
        const body = await readJson(request);
        if (!Array.isArray(body?.players) || body.players.length > 40) {
          return fail(request, env, 400, "players must be an array with at most 40 entries");
        }
        const players = [];
        for (const value of body.players) {
          const normalized = validatePlayerStats(value);
          if (!normalized) return fail(request, env, 400, "One or more player stats entries are invalid");
          players.push(normalized);
        }
        const statements = players.map((player) => env.DB.prepare(
          `INSERT INTO player_stats (player_uuid, player_name, wins, losses, kills, deaths, elo, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1000, ?)
           ON CONFLICT(player_uuid) DO UPDATE SET player_name=excluded.player_name, wins=excluded.wins,
             losses=excluded.losses, kills=excluded.kills, deaths=excluded.deaths, updated_at=excluded.updated_at`
        ).bind(player.uuid, player.name, player.wins, player.losses, player.kills, player.deaths, now));
        if (statements.length) await env.DB.batch(statements);
        return response(request, env, { ok: true, updated: players.length });
      }

      if (request.method === "POST" && path === "/api/plugin/pair-code") {
        const body = await readJson(request);
        const uuid = cleanString(body?.uuid, 36);
        const name = cleanString(body?.name, 16);
        const code = cleanString(body?.code, 8).toUpperCase();
        if (!uuid || !/^[a-fA-F0-9-]{32,36}$/.test(uuid) || !name || !/^[A-Z0-9]{8}$/.test(code)) {
          return fail(request, env, 400, "Invalid pairing payload");
        }
        await env.DB.prepare(
          "INSERT OR REPLACE INTO pairing_codes (code, player_uuid, player_name, expires_at) VALUES (?, ?, ?, ?)"
        ).bind(code, uuid.toLowerCase(), name, now + 300).run();
        return response(request, env, { ok: true, expiresAt: now + 300 });
      }

      if (request.method === "GET" && path === "/api/plugin/commands") {
        const pending = await env.DB.prepare(
          "SELECT id, player_uuid, player_name, action, payload_json FROM web_commands WHERE status = 'pending' AND lease_until < ? ORDER BY id LIMIT 10"
        ).bind(now).all();
        const claimed = [];
        for (const command of (pending.results || [])) {
          const claim = await env.DB.prepare(
            "UPDATE web_commands SET lease_until = ? WHERE id = ? AND status = 'pending' AND lease_until < ?"
          ).bind(now + 30, command.id, now).run();
          if ((claim.meta?.changes || 0) > 0) claimed.push({
            id: command.id,
            player_uuid: command.player_uuid,
            player_name: command.player_name,
            action: command.action,
            payload: parseJsonObject(command.payload_json),
          });
        }
        return response(request, env, { commands: claimed });
      }

      const ackMatch = path.match(/^\/api\/plugin\/commands\/(\d+)\/ack$/);
      if (request.method === "POST" && ackMatch) {
        const body = await readJson(request);
        const status = body?.status === "failed" ? "failed" : "done";
        const message = cleanString(body?.message, 200);
        const result = await env.DB.prepare(
          "UPDATE web_commands SET status = ?, result = ?, completed_at = ? WHERE id = ? AND status = 'pending'"
        ).bind(status, message, now, Number(ackMatch[1])).run();
        if ((result.meta?.changes || 0) === 0) return fail(request, env, 404, "Command not found or already completed");
        return response(request, env, { ok: true });
      }

      // Legacy session routes remain readable, but the website can no longer enqueue gameplay commands.
      if (request.method === "POST" && path === "/api/web/link") {
        const body = await readJson(request);
        const code = cleanString(body?.code, 8).toUpperCase();
        if (!/^[A-Z0-9]{8}$/.test(code)) return fail(request, env, 400, "Enter the 8-character code from Minecraft");
        const pairing = await env.DB.prepare(
          "SELECT code, player_uuid, player_name, expires_at FROM pairing_codes WHERE code = ? AND expires_at > ?"
        ).bind(code, now).first();
        if (!pairing) return fail(request, env, 400, "Code is invalid or expired. Generate a new one in Minecraft.");
        const deleted = await env.DB.prepare("DELETE FROM pairing_codes WHERE code = ? AND expires_at > ?").bind(code, now).run();
        if ((deleted.meta?.changes || 0) === 0) return fail(request, env, 409, "That code has already been used");
        const token = randomToken();
        const tokenHash = await sha256(token);
        const expiresAt = now + 30 * 24 * 60 * 60;
        await env.DB.prepare(
          "INSERT INTO web_sessions (token_hash, player_uuid, player_name, expires_at) VALUES (?, ?, ?, ?)"
        ).bind(tokenHash, pairing.player_uuid, pairing.player_name, expiresAt).run();
        return response(request, env, { ok: true, token, playerUuid: pairing.player_uuid, playerName: pairing.player_name, expiresAt });
      }

      if (request.method === "GET" && path === "/api/web/me") {
        const session = await getWebSession(request, env, now);
        if (!session) return fail(request, env, 401, "Link your Minecraft account first");
        return response(request, env, { ok: true, playerUuid: session.player_uuid, playerName: session.player_name, expiresAt: session.expires_at });
      }

      const webStatusMatch = path.match(/^\/api\/web\/commands\/(\d+)$/);
      if (request.method === "GET" && webStatusMatch) {
        const session = await getWebSession(request, env, now);
        if (!session) return fail(request, env, 401, "Your website session expired. Link again.");
        const command = await env.DB.prepare(
          "SELECT id, action, status, result, created_at, completed_at FROM web_commands WHERE id = ? AND player_uuid = ?"
        ).bind(Number(webStatusMatch[1]), session.player_uuid).first();
        if (!command) return fail(request, env, 404, "Action not found");
        return response(request, env, { ok: true, ...command });
      }

      if (request.method === "POST" && path === "/api/web/commands") {
        return fail(request, env, 410, "Website gameplay commands are disabled. Join queues in Minecraft.");
      }

      return fail(request, env, 404, "Unknown API route");
    } catch (error) {
      console.error("CartPrac API error:", error?.stack || error?.message || error);
      return fail(request, env, 500, "Internal server error");
    }
  },
};