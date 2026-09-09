// ── связь с облаком: вход по почте, синхронизация, работа без сети
const SUPA_URL = 'https://wbvftguatzdwarlnfcdx.supabase.co';
const SUPA_KEY = 'sb_publishable_bocQCd7kqZ0wDCGrwjntAg_h9DZyy4I';

let sb = null, user = null, syncing = false;

function uid(){
  return (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random()*16|0; return (c==='x'?r:(r&0x3|0x8)).toString(16); }));
}

async function initCloud(){
  if (!window.supabase) return;
  sb = window.supabase.createClient(SUPA_URL, SUPA_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const { data } = await sb.auth.getSession();
  user = data.session ? data.session.user : null;
  paintAuth();

  sb.auth.onAuthStateChange(async (_e, session) => {
    const was = user;
    user = session ? session.user : null;
    paintAuth();
    if (user && !was) { await firstSync(); }
    if (!user && was) { render(); }
  });

  if (user) await firstSync();

  window.addEventListener('online', pushPending);
}

// первый вход: заливаем локальные победы, забираем облачные
async function firstSync(){
  if (!sb || !user || syncing) return;
  syncing = true; paintAuth();
  try {
    const local = wins.filter(w => !w.synced);
    if (local.length) {
      const rows = local.map(w => ({
        id: w.id || uid(), user_id: user.id, text: w.t,
        cat: w.s || 'другое', is_super: !!w.super, happened_at: w.d
      }));
      await sb.from('wins').upsert(rows, { onConflict: 'id' });
    }
    const { data, error } = await sb.from('wins')
      .select('*').order('happened_at', { ascending: true });
    if (!error && data) {
      wins = data.map(r => ({
        id: r.id, t: r.text, s: r.cat, super: r.is_super,
        d: r.happened_at, synced: true
      }));
      save();
    }
    subscribeLive();
  } catch(e) { console.warn('синхронизация:', e); }
  syncing = false; paintAuth(); render();
}

function subscribeLive(){
  if (!sb || !user) return;
  sb.channel('wins-live')
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'wins', filter: `user_id=eq.${user.id}` },
        () => pullQuiet())
    .subscribe();
}

async function pullQuiet(){
  if (!sb || !user) return;
  const { data, error } = await sb.from('wins')
    .select('*').order('happened_at', { ascending: true });
  if (!error && data) {
    wins = data.map(r => ({ id: r.id, t: r.text, s: r.cat,
      super: r.is_super, d: r.happened_at, synced: true }));
    save(); render();
  }
}

// отправка одной записи; не вышло — останется помеченной и уйдёт позже
async function pushWin(w){
  if (!sb || !user) return;
  const { error } = await sb.from('wins').upsert({
    id: w.id, user_id: user.id, text: w.t,
    cat: w.s || 'другое', is_super: !!w.super, happened_at: w.d
  }, { onConflict: 'id' });
  if (!error) { w.synced = true; save(); }
}

async function deleteWin(id){
  if (!sb || !user) return;
  await sb.from('wins').delete().eq('id', id);
}

async function pushPending(){
  if (!sb || !user) return;
  for (const w of wins.filter(x => !x.synced)) await pushWin(w);
  paintAuth();
}

// ── вход
async function signIn(email){
  if (!sb) return { error: { message: 'облако недоступно' } };
  return sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.href.split('#')[0] }
  });
}
async function signOut(){ if (sb) await sb.auth.signOut(); }
