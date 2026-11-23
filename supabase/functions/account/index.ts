// DIAL IN accounts without email: a username and a 6-digit PIN.
// The PIN is checked in the database (bcrypt, with a lockout after 5 wrong tries), never by Supabase Auth.
// Each account signs in to Supabase Auth with an internal address (u-<id>@accounts.playdialin.com, which never
// receives mail) and a long password derived here from a secret pepper, so players never see or need either.
// Saving an account keeps the same player ID, so every score, save, league and purchase stays attached.
// Actions: create, login, recover, change_pin, new_code, device_code, device_use, purge (daily job, after the cut-off).
const BASE = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
const DOMAIN = "accounts.playdialin.com";
// Every address the game is reachable at: the site (with or without www, http or https), Cloudflare's own
// workers.dev address, and local testing. A page at any other address can't use the account function.
const ORIGINS = [/^https?:\/\/(www\.)?playdialin\.com$/, /^https:\/\/dial-in\.charliehiltonwest\.workers\.dev$/, /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/];
const RESERVED = new Set(["admin", "administrator", "dialin", "dial_in", "support", "help", "moderator", "mod", "staff", "official", "system", "root", "null", "undefined", "player", "guest", "playdialin"]);
const enc = new TextEncoder();

function cors(req: Request) {
  const o = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.some((r) => r.test(o)) ? o : "https://playdialin.com",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
class Fail extends Error { constructor(public code: string, msg: string, public status = 400, public extra: Record<string, unknown> = {}) { super(msg); } }
const internalEmail = (uid: string) => `u-${uid}@${DOMAIN}`;

let pepperCache = "", secretCache = "", cutoffCache = "";
async function config() {
  if (pepperCache) return { pepper: pepperCache, secret: secretCache, cutoff: cutoffCache };
  const r = await fetch(`${BASE}/rest/v1/acct_config?id=eq.1&select=pepper,cron_secret,email_cutoff`, { headers: H });
  const [c] = r.ok ? await r.json() : [];
  if (!c) throw new Fail("config", "Accounts aren't set up yet.", 503);
  pepperCache = c.pepper; secretCache = c.cron_secret; cutoffCache = c.email_cutoff;
  return { pepper: pepperCache, secret: secretCache, cutoff: cutoffCache };
}
async function derivedPassword(uid: string) {
  const { pepper } = await config();
  const key = await crypto.subtle.importKey("raw", enc.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode("dialin-account|" + uid)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function rpc(fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${BASE}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(args) });
  const t = await r.text();
  if (!r.ok) throw new Fail("db", t, 500);
  return t ? JSON.parse(t) : null;
}
async function rate(ip: string, kind: string, max: number, window: string) {
  if (!(await rpc("acct_rate", { p_ip: ip, p_kind: kind, p_max: max, p_window: window }))) {
    throw new Fail("rate", "Too many tries from this connection. Wait a while, then try again.", 429);
  }
}
async function userFrom(req: Request) {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok) throw new Fail("auth", "Not signed in.", 401);
  const r = await fetch(`${BASE}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${tok}` } });
  const u = r.ok ? await r.json() : null;
  if (!u || !u.id) throw new Fail("auth", "Your session has expired. Reload the game and try again.", 401);
  return u as { id: string; email?: string; is_anonymous?: boolean };
}
async function account(uid: string) {
  const r = await fetch(`${BASE}/rest/v1/pin_accounts?user_id=eq.${uid}&select=username`, { headers: H });
  const [a] = r.ok ? await r.json() : [];
  return a as { username: string } | undefined;
}
// Setting the password signs the profile out everywhere else (Supabase does that on a password change), so the
// email removal on the cut-off day only swaps the email: players who haven't moved over stay signed in where they are.
async function setLogin(uid: string, withPassword = true) {
  const attrs: Record<string, unknown> = { email: internalEmail(uid), email_confirm: true };
  if (withPassword) attrs.password = await derivedPassword(uid);
  const r = await fetch(`${BASE}/auth/v1/admin/users/${uid}`, { method: "PUT", headers: H, body: JSON.stringify(attrs) });
  if (!r.ok) throw new Fail("auth", "Couldn't save the account: " + (await r.text()).slice(0, 200), 500);
}
async function session(uid: string) {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: internalEmail(uid), password: await derivedPassword(uid) }),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d?.access_token) throw new Fail("auth", "Couldn't sign in just now. Try again in a moment.", 500);
  return { access_token: d.access_token, refresh_token: d.refresh_token, expires_in: d.expires_in, user: { id: d.user?.id } };
}
function checkPin(pin: unknown) {
  const p = String(pin ?? "");
  if (!/^\d{6}$/.test(p)) throw new Fail("pin", "Your PIN must be exactly 6 digits.");
  const asc = "0123456789012345", desc = "9876543210987654";
  if (/^(\d)\1{5}$/.test(p) || asc.includes(p) || desc.includes(p) || /^(\d\d)\1\1$/.test(p) || /^(\d{3})\1$/.test(p)) {
    throw new Fail("pin", "That PIN is too easy to guess. Pick 6 digits that aren't a pattern.");
  }
  return p;
}
async function checked(username: string, secret: string, kind: "pin" | "code") {
  const [row] = await rpc("acct_check", { p_username: username, p_secret: secret, p_kind: kind }) ?? [];
  if (row?.status === "ok") return row.user_id as string;
  if (row?.status === "locked") {
    const m = Math.max(1, Math.ceil((row.wait_seconds || 60) / 60));
    throw new Fail("locked", `Too many wrong tries. This account is locked for ${m >= 60 ? Math.ceil(m / 60) + " hour" + (m >= 120 ? "s" : "") : m + " minute" + (m === 1 ? "" : "s")}.`, 423, { wait: row.wait_seconds });
  }
  throw new Fail("wrong", kind === "code" ? "That username or recovery code isn't right." : "That username or PIN isn't right.", 401);
}

Deno.serve(async (req: Request) => {
  const c = cors(req);
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...c, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: c });
  if (req.method !== "POST") return json({ error: "method", message: "Method not allowed" }, 405);
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "create") {
      const u = await userFrom(req);
      if (await account(u.id)) throw new Fail("exists", "This profile already has an account.");
      const username = String(body.username || "").trim().toLowerCase();
      if (!/^[a-z0-9_]{3,16}$/.test(username)) throw new Fail("username", "Usernames are 3 to 16 letters, numbers or underscores.");
      if (RESERVED.has(username)) throw new Fail("taken", "That username is taken. Try another.");
      const pin = checkPin(body.pin);
      await rate(ip, "create", 5, "1 day");
      let code: string;
      try { code = await rpc("acct_create", { p_user: u.id, p_username: username, p_pin: pin }); }
      catch (e) {
        const m = String((e as Error).message);
        if (/pin_accounts_username|duplicate key.*username/i.test(m)) throw new Fail("taken", "That username is taken. Try another.");
        if (/pin_accounts_pkey/i.test(m)) throw new Fail("exists", "This profile already has an account.");
        if (/name_not_allowed/i.test(m)) throw new Fail("username", "That username isn't allowed. Try another.");
        throw e;
      }
      try { await setLogin(u.id); }
      catch (e) { await fetch(`${BASE}/rest/v1/pin_accounts?user_id=eq.${u.id}`, { method: "DELETE", headers: H }); throw e; }
      await rpc("acct_scrub", { p_user: u.id }).catch(() => {});   // any unconfirmed email change or unused email code
      return json({ ok: true, username, code, session: await session(u.id) });
    }

    if (action === "login") {
      await rate(ip, "login", 30, "1 hour");
      const uid = await checked(String(body.username || ""), String(body.pin || ""), "pin");
      return json({ ok: true, session: await session(uid) });
    }

    if (action === "recover") {
      await rate(ip, "login", 30, "1 hour");
      const pin = checkPin(body.pin);
      const uid = await checked(String(body.username || ""), String(body.code || ""), "code");
      const code = await rpc("acct_set_pin", { p_user: uid, p_pin: pin, p_new_code: true });
      return json({ ok: true, code, session: await session(uid) });
    }

    if (action === "change_pin" || action === "new_code") {
      const u = await userFrom(req), a = await account(u.id);
      if (!a) throw new Fail("none", "Save your account first.");
      await rate(ip, "login", 30, "1 hour");
      await checked(a.username, String(body.pin_old ?? body.pin ?? ""), "pin");
      if (action === "new_code") return json({ ok: true, code: await rpc("acct_new_recovery", { p_user: u.id }) });
      await rpc("acct_set_pin", { p_user: u.id, p_pin: checkPin(body.pin_new), p_new_code: false });
      return json({ ok: true });
    }

    if (action === "device_code") {
      const u = await userFrom(req);
      if (!(await account(u.id))) throw new Fail("none", "Save your account first.");
      await rate(ip, "device_code", 20, "1 hour");
      return json({ ok: true, code: await rpc("acct_device_code", { p_user: u.id }), minutes: 10 });
    }

    if (action === "device_use") {
      await rate(ip, "device_use", 20, "1 hour");
      const uid = await rpc("acct_use_device_code", { p_code: String(body.code || "") });
      if (!uid) throw new Fail("wrong", "That code isn't right or has expired. Make a new one on your other device.", 401);
      return json({ ok: true, session: await session(uid) });
    }

    if (action === "purge") {
      const { secret, cutoff } = await config();
      const got = req.headers.get("x-cron-secret") || "";
      if (got.length !== secret.length || [...got].reduce((d, ch, i) => d | (ch.charCodeAt(0) ^ secret.charCodeAt(i)), 0) !== 0) throw new Fail("auth", "Unauthorised", 401);
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
      if (today < cutoff && !body.force) return json({ skipped: true, today, cutoff });
      let page = 1, removed = 0, failed = 0;
      for (;;) {
        const r = await fetch(`${BASE}/auth/v1/admin/users?page=${page}&per_page=500`, { headers: H });
        const d = r.ok ? await r.json() : { users: [] };
        const users: { id: string; email?: string }[] = d.users || [];
        for (const u of users) {
          if (!u.email || u.email.endsWith("@" + DOMAIN)) continue;
          if (body.only && body.only !== u.id) continue;
          try { await setLogin(u.id, false); removed++; } catch { failed++; }
        }
        if (users.length < 500) break;
        page++;
      }
      const leftovers = body.only ? 0 : await rpc("acct_scrub", { p_user: null }).catch(() => 0);
      return json({ ok: true, removed, failed, leftovers });
    }

    throw new Fail("action", "Unknown action.");
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.code, message: e.message, ...e.extra }, e.status);
    console.error(e);
    return json({ error: "server", message: "Something went wrong. Try again in a moment." }, 500);
  }
});
