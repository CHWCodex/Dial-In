// Stripe webhook for DIAL IN: unlocks Unlimited after a successful payment and removes it after a full refund.
// Stripe calls this directly, so it does its own authentication by checking Stripe's signature.
// Secret needed (Supabase dashboard → Edge Functions → Secrets): STRIPE_WEBHOOK_SECRET (starts "whsec_").
const enc = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function validSignature(body: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  let t = "";
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === "t") t = v;
    if (k === "v1") sigs.push(v);
  }
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${body}`)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => {
    if (s.length !== hex.length) return false;
    let diff = 0;
    for (let i = 0; i < hex.length; i++) diff |= s.charCodeAt(i) ^ hex.charCodeAt(i);
    return diff === 0;
  });
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<void> {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`${fn} failed: ${r.status} ${await r.text()}`);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) return new Response("Webhook secret not set", { status: 503 });
  const body = await req.text();
  if (!(await validSignature(body, req.headers.get("stripe-signature"), secret))) {
    return new Response("Bad signature", { status: 400 });
  }
  try {
    const event = JSON.parse(body);
    const o = event.data?.object ?? {};
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const user = o.client_reference_id;
      // "unpaid" means a delayed payment method is still pending: async_payment_succeeded follows if it clears
      if (o.payment_status !== "unpaid" && typeof user === "string" && UUID.test(user)) {
        await rpc("grant_premium", {
          p_user: user, p_session: o.id, p_amount: o.amount_total ?? null, p_currency: o.currency ?? null,
          p_intent: typeof o.payment_intent === "string" ? o.payment_intent : null,
        });
      } else console.warn("checkout ignored", o.id, o.payment_status, user);
    } else if (event.type === "checkout.session.async_payment_failed") {
      console.warn("delayed payment failed, nothing unlocked", o.id);
    } else if (event.type === "charge.refunded") {
      if (o.refunded === true && typeof o.payment_intent === "string") await rpc("revoke_premium", { p_intent: o.payment_intent });
    }
    return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response("Error", { status: 500 });   // Stripe retries on a 500
  }
});
