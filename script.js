const CLIENT_ID = 'z86hx1zqjrt28urcj8mz487fyg5wl76t';
const CLIENT_SECRET = 'd1QAC50V41mR9NAhquGi9l5p12fYqlHS';
const REDIRECT_URI = 'https://bellaortensia.github.io/toeic-official-practice/';
const AUDIO_FOLDER_ID = '409318407954';

const loginBtn = document.getElementById('login-btn');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');

function base64UrlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  let result = '';
  for (let i = 0; i < length; i++) result += chars[values[i] % chars.length];
  return result;
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(digest);
}

function saveTokens(data) {
  localStorage.setItem('box_access_token', data.access_token);
  localStorage.setItem('box_refresh_token', data.refresh_token);
  localStorage.setItem('box_token_expires_at', String(Date.now() + data.expires_in * 1000));
}

function isLoggedIn() {
  return !!localStorage.getItem('box_access_token');
}

async function startLogin() {
  const verifier = randomString(64);
  const state = randomString(16);
  localStorage.setItem('box_pkce_verifier', verifier);
  localStorage.setItem('box_oauth_state', state);
  const challenge = await generateCodeChallenge(verifier);

  const authUrl = new URL('https://account.box.com/api/oauth2/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  window.location.href = authUrl.toString();
}

async function exchangeCodeForToken(code) {
  const verifier = localStorage.getItem('box_pkce_verifier');
  const res = await fetch('https://api.box.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI
    })
  });
  if (!res.ok) throw new Error('トークン取得に失敗しました: ' + (await res.text()));
  saveTokens(await res.json());
}

async function refreshToken() {
  const refresh_token = localStorage.getItem('box_refresh_token');
  if (!refresh_token) return false;
  const res = await fetch('https://api.box.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    })
  });
  if (!res.ok) return false;
  saveTokens(await res.json());
  return true;
}

async function getValidAccessToken() {
  const expiresAt = Number(localStorage.getItem('box_token_expires_at') || 0);
  if (Date.now() > expiresAt - 60000) {
    const ok = await refreshToken();
    if (!ok) return null;
  }
  return localStorage.getItem('box_access_token');
}

function updateButtons() {
  if (isLoggedIn()) {
    loginBtn.style.display = 'none';
    document.getElementById('nav-test').style.display = 'block';
  } else {
    loginBtn.style.display = 'inline-block';
    document.getElementById('nav-test').style.display = 'none';
    document.getElementById('nav-part').style.display = 'none';
    document.getElementById('practice').style.display = 'none';
  }
}

function updateStatus() {
  statusEl.textContent = isLoggedIn() ? 'Boxにログイン済みです。' : '未ログインです。';
  updateButtons();
}

async function handleRedirect() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  if (code) {
    const savedState = localStorage.getItem('box_oauth_state');
    window.history.replaceState({}, document.title, REDIRECT_URI);
    if (state !== savedState) {
      statusEl.textContent = 'ログイン処理でエラーが発生しました(state不一致)。もう一度お試しください。';
      updateButtons();
      return;
    }
    try {
      await exchangeCodeForToken(code);
      statusEl.textContent = 'ログインに成功しました！';
    } catch (e) {
      statusEl.textContent = 'ログイン失敗: ' + e.message;
    }
    updateButtons();
    return;
  }
  updateStatus();
}

// ---------- 音声再生(Box) ----------

let audioIndexCache = null;
async function getAudioIndex() {
  if (audioIndexCache) return audioIndexCache;
  const token = await getValidAccessToken();
  const map = {};
  let offset = 0;
  for (;;) {
    const res = await fetch(
      `https://api.box.com/2.0/folders/${AUDIO_FOLDER_ID}/items?fields=name&limit=200&offset=${offset}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    if (!data.entries || data.entries.length === 0) break;
    data.entries.forEach(e => { map[e.name] = e.id; });
    offset += data.entries.length;
    if (offset >= data.total_count) break;
  }
  audioIndexCache = map;
  return map;
}

const audioUrlCache = {};
async function getAudioUrl(filename) {
  if (audioUrlCache[filename]) return audioUrlCache[filename];
  const index = await getAudioIndex();
  const id = index[filename];
  if (!id) return null;
  const token = await getValidAccessToken();
  const res = await fetch(`https://api.box.com/2.0/files/${id}/content`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  audioUrlCache[filename] = url;
  return url;
}

function createAudioButton(filename, label) {
  const wrap = document.createElement('div');
  const btn = document.createElement('button');
  btn.textContent = '▶ ' + label;
  btn.className = 'audio-btn';
  const player = document.createElement('audio');
  player.controls = true;
  player.style.display = 'none';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '読み込み中...';
    const url = await getAudioUrl(filename);
    btn.disabled = false;
    if (!url) {
      btn.textContent = '音声が見つかりませんでした: ' + filename;
      return;
    }
    btn.style.display = 'none';
    player.style.display = 'block';
    player.src = url;
    player.play();
  });
  wrap.appendChild(btn);
  wrap.appendChild(player);
  return wrap;
}

// ---------- データ読み込み ----------

const dataCache = {};
async function loadPartData(test, part) {
  const key = test + '-' + part;
  if (dataCache[key]) return dataCache[key];
  const res = await fetch(`data/${test === 'T1' ? 'test1' : 'test2'}/part${part}.json`);
  const json = await res.json();
  dataCache[key] = json;
  return json;
}

// ---------- ナビゲーション状態 ----------

const state = { test: null, part: null, data: null, index: 0 };

const navTestEl = document.getElementById('nav-test');
const navPartEl = document.getElementById('nav-part');
const practiceEl = document.getElementById('practice');
const practiceBodyEl = document.getElementById('practice-body');
const progressLabelEl = document.getElementById('progress-label');
const currentTestLabelEl = document.getElementById('current-test-label');

document.querySelectorAll('.test-select').forEach(btn => {
  btn.addEventListener('click', () => {
    state.test = btn.dataset.test;
    currentTestLabelEl.textContent = state.test === 'T1' ? 'TEST 1' : 'TEST 2';
    navTestEl.style.display = 'none';
    navPartEl.style.display = 'block';
    practiceEl.style.display = 'none';
  });
});

document.getElementById('back-to-test').addEventListener('click', () => {
  navPartEl.style.display = 'none';
  navTestEl.style.display = 'block';
});

document.querySelectorAll('.part-select').forEach(btn => {
  btn.addEventListener('click', async () => {
    state.part = Number(btn.dataset.part);
    state.index = 0;
    navPartEl.style.display = 'none';
    practiceEl.style.display = 'block';
    practiceBodyEl.innerHTML = '読み込み中...';
    state.data = await loadPartData(state.test, state.part);
    renderPractice();
  });
});

document.getElementById('back-to-part').addEventListener('click', () => {
  practiceEl.style.display = 'none';
  navPartEl.style.display = 'block';
});

document.getElementById('prev-btn').addEventListener('click', () => {
  if (state.index > 0) { state.index--; renderPractice(); }
});
document.getElementById('next-btn').addEventListener('click', () => {
  if (state.index < getItemCount() - 1) { state.index++; renderPractice(); }
});

function getItemList() {
  if (state.part === 1 || state.part === 2) return state.data.questions;
  if (state.part === 5) return state.data.questions;
  if (state.part === 3 || state.part === 4) return state.data.groups;
  return state.data.passages; // 6, 7
}

function getItemCount() {
  return getItemList().length;
}

// ---------- 選択肢ボタン(共通) ----------

function renderChoices(container, choices, answer) {
  const letters = Object.keys(choices);
  letters.forEach(letter => {
    const btn = document.createElement('button');
    btn.className = 'choice';
    btn.textContent = `(${letter}) ${choices[letter]}`;
    btn.addEventListener('click', () => {
      const buttons = container.querySelectorAll('.choice');
      buttons.forEach(b => b.disabled = true);
      buttons.forEach((b, i) => {
        if (letters[i] === answer) b.classList.add('correct');
        else if (letters[i] === letter && letter !== answer) b.classList.add('wrong');
      });
    });
    container.appendChild(btn);
  });
}

function createRevealButton(onReveal) {
  const btn = document.createElement('button');
  btn.className = 'reveal-btn';
  btn.textContent = '正解を見る';
  btn.addEventListener('click', () => {
    onReveal();
    btn.remove();
  });
  return btn;
}

// ---------- Part別レンダリング ----------

function renderPractice() {
  progressLabelEl.textContent = `${state.index + 1} / ${getItemCount()}`;
  practiceBodyEl.innerHTML = '';
  if (state.part === 1 || state.part === 2) renderPart1or2();
  else if (state.part === 3 || state.part === 4) renderPart3or4();
  else if (state.part === 5) renderPart5();
  else if (state.part === 6) renderPart6();
  else if (state.part === 7) renderPart7();

  document.getElementById('prev-btn').disabled = state.index === 0;
  document.getElementById('next-btn').disabled = state.index === getItemCount() - 1;
}

function renderPart1or2() {
  const q = state.data.questions[state.index];
  const div = document.createElement('div');
  div.className = 'q-block';
  const title = document.createElement('div');
  title.className = 'q-text';
  title.textContent = `Q${q.number}`;
  div.appendChild(title);
  div.appendChild(createAudioButton(q.audio, '音声を再生'));
  const answerP = document.createElement('p');
  const reveal = createRevealButton(() => { answerP.textContent = '正解: ' + q.answer; });
  div.appendChild(reveal);
  div.appendChild(answerP);
  practiceBodyEl.appendChild(div);
}

function renderPart3or4() {
  const g = state.data.groups[state.index];
  const wrap = document.createElement('div');
  const audioLabel = document.createElement('div');
  audioLabel.className = 'audio-label';
  audioLabel.textContent = `Q${g.questions[0]}-${g.questions[g.questions.length - 1]}`;
  wrap.appendChild(audioLabel);
  wrap.appendChild(createAudioButton(g.audioConversation || g.audioTalk, state.part === 3 ? '会話を再生' : 'トークを再生'));
  wrap.appendChild(createAudioButton(g.audioQuestions, '設問を再生'));
  if (g.graphic) {
    const gfx = document.createElement('p');
    gfx.className = 'audio-label';
    gfx.textContent = '図表: ' + g.graphic;
    wrap.appendChild(gfx);
  }
  g.items.forEach(item => {
    const block = document.createElement('div');
    block.className = 'q-block';
    const t = document.createElement('div');
    t.className = 'q-text';
    t.textContent = `${item.number}. ${item.text}`;
    block.appendChild(t);
    const choicesDiv = document.createElement('div');
    renderChoices(choicesDiv, item.choices, item.answer);
    block.appendChild(choicesDiv);
    wrap.appendChild(block);
  });
  practiceBodyEl.appendChild(wrap);
}

function renderPart5() {
  const q = state.data.questions[state.index];
  const div = document.createElement('div');
  div.className = 'q-block';
  const t = document.createElement('div');
  t.className = 'q-text';
  t.textContent = `${q.number}. ${q.sentence}`;
  div.appendChild(t);
  if (q.audio) div.appendChild(createAudioButton(q.audio, '音声を再生'));
  const choicesDiv = document.createElement('div');
  renderChoices(choicesDiv, q.choices, q.answer);
  div.appendChild(choicesDiv);
  practiceBodyEl.appendChild(div);
}

function renderPart6() {
  const p = state.data.passages[state.index];
  const wrap = document.createElement('div');
  const label = document.createElement('div');
  label.className = 'audio-label';
  label.textContent = p.topic || '';
  wrap.appendChild(label);
  if (p.audio) wrap.appendChild(createAudioButton(p.audio, '音声を再生'));
  const doc = document.createElement('div');
  doc.className = 'doc-box';
  doc.textContent = p.text;
  wrap.appendChild(doc);
  p.items.forEach(item => {
    const block = document.createElement('div');
    block.className = 'q-block';
    const t = document.createElement('div');
    t.className = 'q-text';
    t.textContent = `${item.number}.`;
    block.appendChild(t);
    const choicesDiv = document.createElement('div');
    renderChoices(choicesDiv, item.choices, item.answer);
    block.appendChild(choicesDiv);
    wrap.appendChild(block);
  });
  practiceBodyEl.appendChild(wrap);
}

function renderPart7() {
  const p = state.data.passages[state.index];
  const wrap = document.createElement('div');
  const label = document.createElement('div');
  label.className = 'audio-label';
  label.textContent = p.topic || '';
  wrap.appendChild(label);
  const audios = Array.isArray(p.audio) ? p.audio : (p.audio ? [p.audio] : []);
  audios.forEach((a, i) => wrap.appendChild(createAudioButton(a, `音声${audios.length > 1 ? i + 1 : ''}を再生`)));
  p.documents.forEach(doc => {
    const docDiv = document.createElement('div');
    docDiv.className = 'doc-box';
    const lbl = document.createElement('div');
    lbl.className = 'doc-label';
    lbl.textContent = doc.label;
    docDiv.appendChild(lbl);
    const txt = document.createElement('div');
    txt.textContent = doc.text;
    docDiv.appendChild(txt);
    wrap.appendChild(docDiv);
  });
  p.items.forEach(item => {
    const block = document.createElement('div');
    block.className = 'q-block';
    const t = document.createElement('div');
    t.className = 'q-text';
    t.textContent = `${item.number}. ${item.text}`;
    block.appendChild(t);
    const choicesDiv = document.createElement('div');
    renderChoices(choicesDiv, item.choices, item.answer);
    block.appendChild(choicesDiv);
    wrap.appendChild(block);
  });
  practiceBodyEl.appendChild(wrap);
}

loginBtn.addEventListener('click', startLogin);
handleRedirect();
