/* DIAL IN hosting settings. Fill these in to switch on online mode (see README.md → "Going live").
   Everything here is safe to publish: the Supabase anon key is designed to be public.
   NEVER put a Supabase service_role key or a Stripe secret key in this file. */
window.DIAL_IN_CONFIG = {
  // Supabase project URL and anon (public) key: Supabase dashboard → Project Settings → API.
  // With these set you get global leaderboards, daily rankings ("you beat 96 players"),
  // Battles between phones, cloud saves and friend codes.
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',

  // Optional. A Stripe Payment Link for the Unlimited unlock, e.g. 'https://buy.stripe.com/abc123'.
  // Leave '' and Unlimited is free for everyone.
  STRIPE_PAYMENT_LINK: '',
  PRICE_LABEL: '£2.99',

  // Optional. SHA-256 hash of a passcode that opens the developer sandbox on the live site.
  // Make one in the browser console with: await DialIn.devHash('your passcode')
  DEV_PASS_HASH: ''
};
