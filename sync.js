// ── связь с облаком: вход по почте, синхронизация, работа без сети
const SUPA_URL = 'https://wbvftguatzdwarlnfcdx.supabase.co';
const SUPA_KEY = 'sb_publishable_bocQCd7kqZ0wDCGrwjntAg_h9DZyy4I';

let sb = null, user = null, syncing = false;
function inDemo(){ return typeof demoMode !== 'undefined' && demoMode; }

function uid(){
  return (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random()*16|0; return (c==='x'?r:(r&0x3|0x8)).toString(16); }));
}

const winRow = w => ({ id: w.id || uid(), user_id: user.id, text: w.t, cat: w.s || 'другое',
                       is_super: !!w.super, happened_at: w.d, habit_id: w.h || null });
const winFrom = r => ({ id: r.id, t: r.text, s: r.cat, super: r.is_super, d: r.happened_at,
                        h: r.habit_id || undefined, synced: true });
const habitRow = h => ({ id: h.id, user_id: user.id, name: h.n, cat: h.s || 'другое',
                         archived: !!h.archived, created_at: h.created || new Date().toISOString() });
const habitFrom = r => ({ id: r.id, n: r.name, s: r.cat, archived: r.archived, created: r.created_at, synced: true });

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

// первый вход: заливаем локальное, забираем облачное. Привычки раньше побед — на них ссылаются отметки
async function firstSync(){
  if (inDemo() || !sb || !user || syncing) return;
  syncing = true; paintAuth();
  try {
    const lh = habits.filter(h => !h.synced);
    if (lh.length) await sb.from('habits').upsert(lh.map(habitRow), { onConflict: 'id' });
    const lw = wins.filter(w => !w.synced);
    if (lw.length) await sb.from('wins').upsert(lw.map(winRow), { onConflict: 'id' });
    await pullAll();
    subscribeLive();
  } catch(e) { console.warn('синхронизация:', e); }
  syncing = false; paintAuth(); render();
}

async function pullAll(){
  const hr = await sb.from('habits').select('*').order('created_at', { ascending: true });
  if (!hr.error && hr.data) {
    const pending = habits.filter(h => !h.synced && !hr.data.some(r => r.id === h.id));
    habits = hr.data.map(habitFrom).concat(pending);
    saveHabits();
  }
  const wr = await sb.from('wins').select('*').order('happened_at', { ascending: true });
  if (!wr.error && wr.data) {
    const pending = wins.filter(w => !w.synced && !wr.data.some(r => r.id === w.id));
    wins = wr.data.map(winFrom).concat(pending);
    save();
  }
}

function subscribeLive(){
  if (inDemo() || !sb || !user) return;
  const f = `user_id=eq.${user.id}`;
  sb.channel('pobedy-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'wins',   filter: f }, () => pullQuiet())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'habits', filter: f }, () => pullQuiet())
    .subscribe();
}

async function pullQuiet(){
  if (inDemo() || !sb || !user) return;
  await pullAll();
  render();
}

// отправка одной записи; не вышло — останется помеченной и уйдёт позже
async function pushWin(w){
  if (inDemo() || !sb || !user) return;
  if (w.h) {
    const h = habits.find(x => x.id === w.h);
    if (h && !h.synced) await pushHabit(h);
  }
  const { error } = await sb.from('wins').upsert(winRow(w), { onConflict: 'id' });
  if (!error) { w.synced = true; save(); paintAuth(); }
}

async function pushHabit(h){
  if (inDemo() || !sb || !user) return;
  const { error } = await sb.from('habits').upsert(habitRow(h), { onConflict: 'id' });
  if (!error) { h.synced = true; saveHabits(); paintAuth(); }
}

async function deleteWin(id){
  if (inDemo() || !sb || !user) return;
  await sb.from('wins').delete().eq('id', id);
}

async function pushPending(){
  if (inDemo() || !sb || !user) return;
  for (const h of habits.filter(x => !x.synced)) await pushHabit(h);
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
async function verifyCode(email, code){
  if (!sb) return { error: { message: 'облако недоступно' } };
  return sb.auth.verifyOtp({ email, token: code, type: 'email' });
}
async function signOut(){ if (sb) await sb.auth.signOut(); }
