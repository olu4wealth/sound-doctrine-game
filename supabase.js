// supabase.js — Offline-safe Realtime bridge for the Daily-Quest leaderboard.
//
// A gitignored `supabase.config.js` (loaded in <head> before app.js) sets two
// globals:
//
//   window.__SD_SUPABASE_URL__      e.g. "https://xyzcompany.supabase.co"
//   window.__SD_SUPABASE_ANON_KEY__  the publishable anon key (NEVER hardcoded,
//                                  never committed — see .gitignore)
//
// If either is missing, SUPABASE_READY is false and every export below is a
// zero-cost no-op — the game stays 100% local-first and never touches the network.
// When both are present, the @supabase/supabase-js ESM build is lazily imported
// from the jsDelivr CDN (only then), so a no-key install never fetches anything.

const SUPABASE_URL = (typeof window !== 'undefined' && window.__SD_SUPABASE_URL__) || null;
const SUPABASE_ANON_KEY = (typeof window !== 'undefined' && window.__SD_SUPABASE_ANON_KEY__) || null;
export const SUPABASE_READY = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

let _clientPromise = null; // resolves to the supabase client (or null on failure)

// Lazily create the client. The SDK is fetched only when a key is configured.
function getClient() {
  if (_clientPromise !== null) return _clientPromise;
  if (!SUPABASE_READY) { _clientPromise = Promise.resolve(null); return _clientPromise; }
  _clientPromise = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.48.3/dist/esm/index.js')
    .then((mod) => mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY))
    .catch((e) => {
      console.warn('[supabase] SDK failed to load:', e && e.message ? e.message : e);
      return null;
    });
  return _clientPromise;
}

// Exposed so callers can await one client and drive a Realtime subscription.
export function getSupabaseClient() { return getClient(); }

// Best-effort Daily-Quest score push. Resolves null on any offline/failure path.
export function upsertDailyScore(name, payload) {
  if (!SUPABASE_READY || !name || !payload) return Promise.resolve(null);
  const today = new Date().toISOString().slice(0, 10); // UTC `date`, same key space as dailySeed
  const row = {
    name: String(name),
    date: today,
    score: Math.max(0, payload.score || 0),
    answered: Math.max(0, payload.answered || 0),
    streak: Math.max(0, payload.streak || 0),
    acc: Math.min(1, Math.max(0, payload.acc || 0)),
  };
  return getClient()
    .then((client) => {
      if (!client) return null;
      return client
        .from('daily_scores')
        .upsert(row, { onConflict: 'name,date', defaultTo: false })
        .then(({ error }) => {
          if (error) console.warn('[supabase] upsert failed:', error.message);
          return error ? null : row;
        });
    })
    .catch((e) => {
      console.warn('[supabase] upsert threw:', e && e.message ? e.message : e);
      return null;
    });
}

// range: 'all' (default) | 'day' | 'week' | 'year'. Returns [] when offline.
export function loadDailyLeaderboard(range) {
  if (!SUPABASE_READY) return Promise.resolve([]);
  return getClient()
    .then((client) => {
      if (!client) return [];
      let q = client.from('daily_scores').select();
      if (range === 'day') {
        const today = new Date().toISOString().slice(0, 10);
        q = q.eq('date', today);
      } else if (range === 'week') {
        const d = new Date(); d.setDate(d.getDate() - 7);
        q = q.gte('date', d.toISOString().slice(0, 10));
      } else if (range === 'year') {
        const d = new Date(); d.setFullYear(d.getFullYear() - 1);
        q = q.gte('date', d.toISOString().slice(0, 10));
      }
      return q.order('score', { ascending: false }).limit(60).then(({ data, error }) => {
        if (error) { console.warn('[supabase] load failed:', error.message); return []; }
        return data || [];
      });
    })
    .then((rows) => rows || [])
    .catch((e) => {
      console.warn('[supabase] load threw:', e && e.message ? e.message : e);
      return [];
    });
}

// Subscribe to Realtime inserts/updates on `daily_scores`. Returns an unsubscribe
// fn. `client` must already be awaited via getSupabaseClient() so the channel can
// be created synchronously against the live client.
export function subscribeDailyScore(cb, client) {
  if (!client) return () => {};
  try {
    const channel = client
      .channel('sd:daily_scores:public')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_scores' }, (payload) => {
        try { cb && cb(payload); } catch (e) { /* never let RT sink the app */ }
      })
      .subscribe();
    return () => { try { client.remove(channel); } catch (e) { /* ignore */ } };
  } catch (e) {
    console.warn('[supabase] subscribe failed:', e && e.message ? e.message : e);
    return () => {};
  }
}