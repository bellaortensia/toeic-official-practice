const CLIENT_ID = 'z86hx1zqjrt28urcj8mz487fyg5wl76t';
const CLIENT_SECRET = 'd1QAC50V41mR9NAhquGi9l5p12fYqlHS';
const REDIRECT_URI = 'https://bellaortensia.github.io/toeic-official-practice/';
const AUDIO_FOLDER_ID = '409318407954';

const loginBtn = document.getElementById('login-btn');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');

// ---------- Gemini APIキー(decode-toeicと同じキー名で共有) ----------

const GEMINI_KEY_LS = 'decodeToeic.geminiKey';
const geminiKeyInput = document.getElementById('geminiKey');
const savedGeminiKey = localStorage.getItem(GEMINI_KEY_LS);
if (savedGeminiKey) geminiKeyInput.value = savedGeminiKey;
geminiKeyInput.addEventListener('change', () => localStorage.setItem(GEMINI_KEY_LS, geminiKeyInput.value.trim()));

function getGeminiKey() {
  return localStorage.getItem(GEMINI_KEY_LS) || geminiKeyInput.value.trim();
}

const GEMINI_MODEL = 'gemini-3.5-flash-lite';

async function callGemini(systemPrompt, userText) {
  const key = getGeminiKey();
  if (!key) throw new Error('Gemini APIキーが設定されていません');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 1024 }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Gemini APIエラー (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  const text = (parts || []).filter(p => !p.thought).map(p => p.text || '').join('').trim();
  if (!text) throw new Error('空の応答でした');
  return text;
}

const EXPLAIN_PROMPT = `あなたはTOEIC対策の講師です。以下のTOEICの問題について、日本語で解説してください。
必ず次の4つの見出しを、この順番で出力してください。

【日本語訳】
正解の選択肢を入れた完成文の日本語訳を書く。

【文構造(SVOC)】
完成文の主語(S)・動詞(V)・目的語(O)・補語(C)などの構造を、S/V/O/Cのラベルを付けて短く分解して示す。

【必要な知識】
この問題を解くために知っておく必要がある文法事項・語彙・イディオムなどを1〜2行で明記する。

【解説】
なぜその選択肢が正解で、他の選択肢がなぜ誤りなのかを短く説明する。

各見出しは簡潔に、しかし分かりやすく。装飾やMarkdown記号(**など)は使わず、プレーンテキストで出力してください。`;

const EXPLAIN_PROMPT_VERSION = 'v2'; // プロンプトの形式を変えたらここを上げて古いキャッシュを無効化する
const explainCache = {};
async function getExplanation(cacheKey, questionText) {
  const lsKey = 'toeicExplain.' + EXPLAIN_PROMPT_VERSION + '.' + cacheKey;
  const cached = explainCache[cacheKey] || localStorage.getItem(lsKey);
  if (cached) { explainCache[cacheKey] = cached; return cached; }
  const text = await callGemini(EXPLAIN_PROMPT, questionText);
  explainCache[cacheKey] = text;
  try { localStorage.setItem(lsKey, text); } catch (e) { /* 保存容量オーバー等は無視 */ }
  return text;
}

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
  const practiceSelect = document.getElementById('practiceSelect');
  if (isLoggedIn()) {
    loginBtn.style.display = 'none';
    practiceSelect.disabled = false;
  } else {
    loginBtn.style.display = 'inline-block';
    practiceSelect.disabled = true;
    practiceSelect.value = '';
    document.getElementById('practice').style.display = 'none';
    document.getElementById('empty-state').style.display = 'block';
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

const practiceEl = document.getElementById('practice');
const emptyStateEl = document.getElementById('empty-state');
const practiceBodyEl = document.getElementById('practice-body');
const progressLabelEl = document.getElementById('progress-label');
const practiceSelectEl = document.getElementById('practiceSelect');

practiceSelectEl.addEventListener('change', async () => {
  const val = practiceSelectEl.value;
  if (!val) return;
  const [test, part] = val.split('-');
  state.test = test;
  state.part = Number(part);
  state.index = 0;
  p12 = null;
  emptyStateEl.style.display = 'none';
  practiceEl.style.display = 'block';
  practiceBodyEl.innerHTML = '読み込み中...';
  document.getElementById('setupDetails').removeAttribute('open');
  state.data = await loadPartData(state.test, state.part);
  renderPractice();
});

document.getElementById('prev-btn').addEventListener('click', () => {
  if (state.index > 0) { state.index--; renderPractice(); }
});
document.getElementById('next-btn').addEventListener('click', () => {
  if (state.index < getItemCount() - 1) { state.index++; renderPractice(); }
});

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function getItemList() {
  if (state.part === 1 || state.part === 2) return state.data.questions;
  if (state.part === 5) return chunk(state.data.questions, 5);
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
  const footerEl = document.querySelector('.practice-footer');
  practiceBodyEl.innerHTML = '';
  if (state.part === 1 || state.part === 2) {
    footerEl.style.display = 'none';
    progressLabelEl.textContent = '';
    renderPart1or2();
    return;
  }
  footerEl.style.display = 'flex';
  progressLabelEl.textContent = `${state.index + 1} / ${getItemCount()}`;
  if (state.part === 3 || state.part === 4) renderPart3or4();
  else if (state.part === 5) renderPart5();
  else if (state.part === 6) renderPart6();
  else if (state.part === 7) renderPart7();

  document.getElementById('prev-btn').disabled = state.index === 0;
  document.getElementById('next-btn').disabled = state.index === getItemCount() - 1;
}

// ---------- ディクテーション/シャドーイング(共通コンポーネント) ----------

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// items: [{ label, text, audio }]
function renderDictation(items, onComplete) {
  let idx = 0;
  let buffer = '';
  const wrap = document.createElement('div');
  wrap.className = 'training-wrap';

  const title = document.createElement('div');
  title.className = 'training-title';
  wrap.appendChild(title);

  const playBtn = document.createElement('button');
  playBtn.className = 'audio-btn';
  wrap.appendChild(playBtn);

  const displayEl = document.createElement('div');
  displayEl.className = 'dictation-display';
  wrap.appendChild(displayEl);

  const hintEl = document.createElement('div');
  hintEl.className = 'training-hint';
  hintEl.textContent = 'この画面を開いたまま、キーボードでそのまま入力してください(Spaceキー = 音声再生、Backspace = 1文字削除)。';
  wrap.appendChild(hintEl);

  const nextBtn = document.createElement('button');
  nextBtn.textContent = '次の文へ';
  nextBtn.style.display = 'none';
  nextBtn.style.marginTop = '12px';
  wrap.appendChild(nextBtn);

  const skipBtn = document.createElement('button');
  skipBtn.textContent = 'スキップ';
  skipBtn.className = 'reveal-btn';
  skipBtn.style.marginLeft = '8px';
  wrap.appendChild(skipBtn);

  async function playCurrent() {
    playBtn.disabled = true;
    playBtn.textContent = '読み込み中...';
    const url = await getAudioUrl(items[idx].audio);
    playBtn.disabled = false;
    playBtn.textContent = '▶ 音声を再生 (Spaceキーでも再生できます)';
    if (url) new Audio(url).play();
  }
  playBtn.addEventListener('click', playCurrent);

  function render() {
    const item = items[idx];
    title.textContent = `ディクテーション (${idx + 1}/${items.length}) ${item.label || ''}`;
    playBtn.textContent = '▶ 音声を再生 (Spaceキーでも再生できます)';
    const ref = item.text;
    let html = '';
    for (let i = 0; i < ref.length; i++) {
      const ch = ref[i];
      if (i < buffer.length) {
        const ok = buffer[i] === ch;
        html += `<span class="${ok ? 'dict-ok' : 'dict-ng'}">${escapeHtml(ch)}</span>`;
      } else {
        html += `<span class="dict-pending">${escapeHtml(ch)}</span>`;
      }
    }
    displayEl.innerHTML = html;
    nextBtn.style.display = buffer.length >= ref.length ? 'inline-block' : 'none';
  }

  function goNext() {
    idx++;
    buffer = '';
    if (idx >= items.length) {
      document.removeEventListener('keydown', keyHandler);
      onComplete();
    } else {
      render();
    }
  }

  function keyHandler(e) {
    if (e.code === 'Space') { e.preventDefault(); playCurrent(); return; }
    if (e.key === 'Backspace') { e.preventDefault(); buffer = buffer.slice(0, -1); render(); return; }
    if (e.key.length === 1) { e.preventDefault(); buffer += e.key; render(); }
  }
  nextBtn.addEventListener('click', goNext);
  skipBtn.addEventListener('click', goNext);
  document.addEventListener('keydown', keyHandler);

  render();
  practiceBodyEl.innerHTML = '';
  practiceBodyEl.appendChild(wrap);
}

// items: [{ label, text, audio }]
function renderShadowing(items, onComplete) {
  let idx = 0;
  const wrap = document.createElement('div');
  wrap.className = 'training-wrap';

  const title = document.createElement('div');
  title.className = 'training-title';
  wrap.appendChild(title);

  const playBtn = document.createElement('button');
  playBtn.className = 'audio-btn';
  wrap.appendChild(playBtn);

  const textEl = document.createElement('div');
  textEl.className = 'shadowing-text';
  wrap.appendChild(textEl);

  const nextBtn = document.createElement('button');
  nextBtn.textContent = '次へ';
  nextBtn.style.marginTop = '12px';
  wrap.appendChild(nextBtn);

  async function playCurrent() {
    playBtn.disabled = true;
    playBtn.textContent = '読み込み中...';
    const url = await getAudioUrl(items[idx].audio);
    playBtn.disabled = false;
    playBtn.textContent = '▶ 音声を再生 (Spaceキーでも再生できます)';
    if (url) new Audio(url).play();
  }
  playBtn.addEventListener('click', playCurrent);

  function render() {
    const item = items[idx];
    title.textContent = `シャドーイング (${idx + 1}/${items.length}) ${item.label || ''}`;
    playBtn.textContent = '▶ 音声を再生 (Spaceキーでも再生できます)';
    textEl.textContent = item.text;
  }

  function keyHandler(e) {
    if (e.code === 'Space') { e.preventDefault(); playCurrent(); }
  }
  nextBtn.addEventListener('click', () => {
    idx++;
    if (idx >= items.length) {
      document.removeEventListener('keydown', keyHandler);
      onComplete();
    } else {
      render();
    }
  });
  document.addEventListener('keydown', keyHandler);

  render();
  practiceBodyEl.innerHTML = '';
  practiceBodyEl.appendChild(wrap);
}

let p12 = null; // { groupStart, qIdx, phase, selected }

function initP12IfNeeded() {
  if (!p12) p12 = { groupStart: 0, qIdx: 0, phase: 'question', selected: null };
}

function p12CurrentGroup() {
  return state.data.questions.slice(p12.groupStart, p12.groupStart + 3);
}

function p12BuildShadowingItems(groupQuestions) {
  const isPart1 = state.part === 1;
  return groupQuestions.map(q => {
    const choiceTexts = isPart1 ? q.statements : q.responses;
    const letters = Object.keys(choiceTexts);
    let text = '';
    if (!isPart1) text += `${q.question}\n\n`;
    text += letters.map(l => `(${l}) ${choiceTexts[l]}`).join('\n');
    return { label: `Q${q.number}`, text, audio: q.audio };
  });
}

function renderPart1or2() {
  initP12IfNeeded();
  if (p12.phase === 'shadowing') {
    renderShadowing(p12BuildShadowingItems(p12CurrentGroup()), () => {
      p12.groupStart += 3;
      p12.qIdx = 0;
      p12.phase = 'question';
      p12.selected = null;
      if (p12.groupStart >= state.data.questions.length) {
        practiceBodyEl.innerHTML = '<p>このPartは終了です。上のプルダウンから次のPartを選んでください。</p>';
      } else {
        renderPart1or2();
      }
    });
    return;
  }

  const isPart1 = state.part === 1;
  const groupQuestions = p12CurrentGroup();
  const q = groupQuestions[p12.qIdx];
  const wrap = document.createElement('div');
  wrap.className = 'q-block';

  const title = document.createElement('div');
  title.className = 'q-text';
  title.textContent = `Q${q.number}`;
  wrap.appendChild(title);

  if (isPart1 && q.image) {
    const img = document.createElement('img');
    img.src = q.image;
    img.alt = `Q${q.number}の写真`;
    img.className = 'question-photo';
    wrap.appendChild(img);
  }

  const audioWrap = createAudioButton(q.audio, '音声を再生');
  wrap.appendChild(audioWrap);

  const choiceTexts = isPart1 ? q.statements : q.responses;
  const letters = Object.keys(choiceTexts);
  const choicesDiv = document.createElement('div');
  letters.forEach(letter => {
    const btn = document.createElement('button');
    btn.className = 'choice';
    btn.textContent = `(${letter})`;
    btn.addEventListener('click', () => {
      choicesDiv.querySelectorAll('.choice').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      p12.selected = letter;
      nextBtn.disabled = false;
    });
    choicesDiv.appendChild(btn);
  });
  wrap.appendChild(choicesDiv);

  const explainDiv = document.createElement('div');
  explainDiv.className = 'explain-box';
  explainDiv.style.display = 'none';
  wrap.appendChild(explainDiv);

  const nextBtn = document.createElement('button');
  nextBtn.textContent = '次へ';
  nextBtn.style.display = 'block';
  nextBtn.style.marginTop = '14px';
  nextBtn.disabled = true;
  const revealed = { done: false };
  nextBtn.addEventListener('click', () => {
    if (!revealed.done) {
      revealed.done = true;
      const buttons = choicesDiv.querySelectorAll('.choice');
      buttons.forEach((b, i) => {
        b.disabled = true;
        if (letters[i] === q.answer) b.classList.add('correct');
        else if (letters[i] === p12.selected) b.classList.add('wrong');
      });
      const jaTexts = isPart1 ? q.statementsJa : q.responsesJa;
      const isCorrect = p12.selected === q.answer;
      let text = isCorrect ? '正解です！\n\n' : '不正解です。\n\n';
      if (!isPart1) text += `質問: ${q.question}\n(${q.questionJa})\n\n`;
      text += letters.map(l => `(${l}) ${choiceTexts[l]}\n　　${jaTexts[l]}`).join('\n') + '\n\n' + q.explanation;
      explainDiv.textContent = text;
      explainDiv.style.display = 'block';
      const isLast = p12.qIdx >= groupQuestions.length - 1;
      nextBtn.textContent = isLast ? 'シャドーイングへ' : '次の問題へ';
    } else {
      p12.qIdx++;
      p12.selected = null;
      if (p12.qIdx >= groupQuestions.length) {
        p12.phase = 'shadowing';
      }
      renderPart1or2();
    }
  });
  wrap.appendChild(nextBtn);

  practiceBodyEl.innerHTML = '';
  practiceBodyEl.appendChild(wrap);

  const autoPlayBtn = audioWrap.querySelector('button');
  if (autoPlayBtn) autoPlayBtn.click();
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
  const batch = getItemList()[state.index];
  const wrap = document.createElement('div');
  const selections = {};
  const blocks = {};

  batch.forEach(q => {
    const block = document.createElement('div');
    block.className = 'q-block';
    const t = document.createElement('div');
    t.className = 'q-text';
    t.textContent = `${q.number}. ${q.sentence}`;
    block.appendChild(t);
    if (q.audio) block.appendChild(createAudioButton(q.audio, '音声を再生'));

    const choicesDiv = document.createElement('div');
    const letters = Object.keys(q.choices);
    letters.forEach(letter => {
      const btn = document.createElement('button');
      btn.className = 'choice';
      btn.textContent = `(${letter}) ${q.choices[letter]}`;
      btn.addEventListener('click', () => {
        choicesDiv.querySelectorAll('.choice').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selections[q.number] = letter;
        gradeBtn.disabled = Object.keys(selections).length < batch.length;
      });
      choicesDiv.appendChild(btn);
    });
    block.appendChild(choicesDiv);

    const explainDiv = document.createElement('div');
    explainDiv.className = 'explain-box';
    explainDiv.style.display = 'none';
    block.appendChild(explainDiv);

    blocks[q.number] = { choicesDiv, explainDiv, letters };
    wrap.appendChild(block);
  });

  const gradeBtn = document.createElement('button');
  gradeBtn.textContent = `${batch.length}問まとめて採点する`;
  gradeBtn.className = 'grade-btn';
  gradeBtn.disabled = true;
  gradeBtn.addEventListener('click', async () => {
    gradeBtn.disabled = true;
    gradeBtn.textContent = '採点中...';
    batch.forEach(q => {
      const { choicesDiv, explainDiv, letters } = blocks[q.number];
      const buttons = choicesDiv.querySelectorAll('.choice');
      buttons.forEach((b, i) => {
        b.disabled = true;
        if (letters[i] === q.answer) b.classList.add('correct');
        else if (letters[i] === selections[q.number]) b.classList.add('wrong');
      });
      explainDiv.style.display = 'block';
      explainDiv.textContent = '解説を生成中...';
    });
    gradeBtn.remove();
    for (const q of batch) {
      const { explainDiv } = blocks[q.number];
      try {
        const questionText = `${q.number}. ${q.sentence}\n選択肢: ${Object.entries(q.choices).map(([l, txt]) => `(${l}) ${txt}`).join(' ')}\n正解: (${q.answer}) ${q.choices[q.answer]}`;
        explainDiv.textContent = await getExplanation(`${state.test}-5-${q.number}`, questionText);
      } catch (e) {
        explainDiv.textContent = '解説の取得に失敗しました: ' + e.message;
      }
    }
  });
  wrap.appendChild(gradeBtn);

  practiceBodyEl.appendChild(wrap);
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
