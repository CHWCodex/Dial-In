// Daily reminder for DIAL IN: at about 6:30pm UK time, a phone notification to players who turned reminders on
// and haven't finished today's puzzle. Called by a pg_cron job that sends the shared secret from push_config.
// The VAPID signing keys are created here on first run and stored in push_config: they never leave Supabase.
import webpush from "npm:web-push@3.6.7";

const BASE = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const EPOCH = Date.UTC(2026, 9, 26);   // puzzle #1, 26 Oct 2026

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
async function rpc(fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${BASE}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const cr = await fetch(`${BASE}/rest/v1/push_config?id=eq.1&select=*`, { headers: H });
  const [cfg] = cr.ok ? await cr.json() : [];
  if (!cfg || !same(req.headers.get("x-cron-secret") ?? "", cfg.cron_secret)) return json({ error: "Unauthorised" }, 401);

  let pub: string = cfg.vapid_public, priv: string = cfg.vapid_private;
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys(); pub = k.publicKey; priv = k.privateKey;
    const u = await fetch(`${BASE}/rest/v1/push_config?id=eq.1`, { method: "PATCH", headers: H, body: JSON.stringify({ vapid_public: pub, vapid_private: priv }) });
    if (!u.ok) return json({ error: "Couldn't save keys" }, 500);
  }
  const body = await req.json().catch(() => ({}));
  if (body.init) return json({ ok: true, publicKey: pub });

  const now = new Date();
  const ukDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);
  const ukHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(now));
  if (!body.force && ukHour !== 18) return json({ skipped: true, ukHour });   // the job runs at 17:30 and 18:30 UTC; only the 6pm UK one sends

  webpush.setVapidDetails("mailto:hello@playdialin.com", pub, priv);
  const no = Math.round((Date.parse(ukDate + "T00:00:00Z") - EPOCH) / 86400000) + 1;   // whole days since puzzle #1
  const targets: { endpoint: string; p256dh: string; auth: string; streak: boolean }[] = await rpc("push_targets", { p_date: ukDate }) ?? [];
  const sent: string[] = [], gone: string[] = [], failed: string[] = [];
  for (let i = 0; i < targets.length; i += 20) {
    await Promise.all(targets.slice(i, i + 20).map(async (t) => {
      const msg = t.streak
        ? { title: "🔥 Keep your streak alive!", body: `DIAL IN #${no} is waiting: seven number questions, about two minutes.` }
        : { title: `DIAL IN #${no} is live`, body: "Seven new number questions. Can you dial in today?" };
      try {
        await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
          JSON.stringify({ ...msg, url: "/", tag: "daily-" + ukDate }), { TTL: 5 * 3600, urgency: "normal", topic: "daily" });
        sent.push(t.endpoint);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(t.endpoint); else { failed.push(t.endpoint); console.warn("push failed", code); }
      }
    }));
  }
  await rpc("push_mark", { p_sent: sent, p_gone: gone, p_failed: failed, p_date: ukDate });
  return json({ date: ukDate, puzzle: no, targets: targets.length, sent: sent.length, gone: gone.length, failed: failed.length });
});
