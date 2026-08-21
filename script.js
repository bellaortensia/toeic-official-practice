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

async function callGemini(systemPrompt, userText, options = {}) {
  const key = getGeminiKey();
  if (!key) throw new Error('Gemini APIキーが設定されていません');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: options.maxOutputTokens || 1024,
      ...(options.responseMimeType ? { responseMimeType: options.responseMimeType } : {})
    }
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

// ---------- Part6/7用の装飾付き解説(選択肢の全訳+太字/下線/赤字/青字) ----------

const EXPLAIN_PROMPT_READING = `あなたはTOEIC対策の講師です。以下のTOEIC Part6/7形式の設問について、日本語で解説してください。
必ず次の構成・記号ルールに従ってください。

1行目: ■選択肢の日本語訳 とだけ書く。
続けて、すべての選択肢(A)(B)(C)(D)を1行ずつ、必ず▲から始めて日本語訳を書く。例:
▲(A) ~という意味
▲(B) ~という意味

次の行: ■根拠・解説 とだけ書く。
続けて、なぜその選択肢が正解で、他の選択肢がなぜ誤りなのかを説明する。本文中の根拠となる箇所を引用する際は①②③...の番号を付け、直後に「」で該当箇所を引用すること(例: ①「the delivery will be delayed」)。

最後の行: ★知らないと解けない要素 に続けて、この問題を解くために知っておく必要がある文法・語彙・表現を1〜2行で書く。

出力は必ず次のJSON形式のみを返し、説明文やコードフェンスは一切含めないこと。
{
  "explainText": "上記ルールに従ったプレーンテキスト。■と★の行は単独の見出し行にし、選択肢の行は必ず▲から始めること。Markdown記号(**など)は使わないこと。",
  "keyPhraseQuotes": ["explainText中の特に重要なTOEIC頻出語・イディオムを、原文の表記のまま(下線を引きたい語句)"]
}`;

const EXPLAIN_PROMPT_READING_VERSION = 'v1';
async function getRichExplanation(cacheKey, questionText) {
  const lsKey = 'toeicRichExplain.' + EXPLAIN_PROMPT_READING_VERSION + '.' + cacheKey;
  const cached = localStorage.getItem(lsKey);
  if (cached) return cached;
  const outText = await callGemini(EXPLAIN_PROMPT_READING, questionText, { responseMimeType: 'application/json', maxOutputTokens: 2048 });
  let parsed;
  try { parsed = JSON.parse(outText); } catch (e) { parsed = { explainText: outText, keyPhraseQuotes: [] }; }
  const html = formatRichExplainHtml(parsed.explainText || outText, parsed.keyPhraseQuotes || []);
  try { localStorage.setItem(lsKey, html); } catch (e) { /* 保存容量オーバー等は無視 */ }
  return html;
}

// ■=太字、★=赤字太字、▲=青字(選択肢全訳)、①②③...直後の「引用」=赤字+下線、
// keyPhraseQuotesに含まれる語句=下線、というプレーンテキストの記号ルールをHTMLへ変換する。
function formatRichExplainHtml(text, keyPhrases) {
  const lines = (text || '').split('\n');
  return lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return '<div><br></div>';

    let content = trimmed;
    let prefix = '';
    if (content.startsWith('■')) { prefix = 'bold'; content = content.slice(1); }
    else if (content.startsWith('★')) { prefix = 'red-bold'; content = content.slice(1); }
    else if (content.startsWith('▲')) { prefix = 'blue'; content = content.slice(1); }

    const marks = [];
    const circleRe = /[①②③④⑤⑥⑦⑧⑨⑩]/g;
    let cm;
    while ((cm = circleRe.exec(content))) {
      const start = cm.index;
      const rest = content.slice(start + cm[0].length);
      const qm = rest.match(/^「[^」]*」/);
      const end = qm ? start + cm[0].length + qm[0].length : start + cm[0].length;
      marks.push({ start, end });
    }
    let escaped = '';
    let cursor = 0;
    marks.forEach(mark => {
      escaped += escapeHtml(content.slice(cursor, mark.start));
      escaped += `<strong style="color:#c1503f;text-decoration:underline">${escapeHtml(content.slice(mark.start, mark.end))}</strong>`;
      cursor = mark.end;
    });
    escaped += escapeHtml(content.slice(cursor));

    (keyPhrases || []).forEach(phrase => {
      if (!phrase) return;
      const escPhrase = escapeHtml(phrase);
      if (escaped.includes(escPhrase)) {
        escaped = escaped.split(escPhrase).join(`<span style="text-decoration:underline">${escPhrase}</span>`);
      }
    });

    let inner = escaped;
    if (prefix === 'bold') inner = `<strong>${escaped}</strong>`;
    else if (prefix === 'red-bold') inner = `<strong style="color:#c1503f">${escaped}</strong>`;
    else if (prefix === 'blue') inner = `<span style="color:#2f5fa8;font-weight:600">${escaped}</span>`;
    return `<div>${inner}</div>`;
  }).join('');
}

// ---------- Part6/7用の簡易チャンク翻訳(decode-toeicの直訳表示のスコープを絞った版) ----------

const TRANSLATE_PROMPT = `あなたは英語学習者向けの解析エンジンです。与えられた英文全体を、最初の1文字から最後の1文字まで省略せず、意味のまとまり(チャンク)ごとに分割してください。
各チャンクには、英語の語順のまま前から順番に理解できる「直訳調」の日本語訳を付けてください(自然な日本語の語順に並べ替えないこと)。
1チャンクの目安は英単語3〜8語程度です(1文をまるごと1つのチャンクにしないこと)。
さらに、各チャンクの中にTOEIC頻出の単語・熟語・言い回しがあれば、その語句を一字一句原文のまま抜き出し、keyTermsに追加してください(該当が無いチャンクではkeyTermsを空配列にする)。
出力は必ず次のJSON形式のみを返し、説明文やコードフェンスは一切含めないこと。
{
  "segments": [
    { "en": "原文チャンク(原文から一字一句変えずに抜粋)", "ja": "直訳調の日本語訳チャンク", "keyTerms": [{"term":"抜き出した語句(原文表記のまま)","meaning":"意味(短く)"}] }
  ]
}
segmentsの"en"を出現順にそのまま連結すると、空白の増減を除いて原文と完全に一致するようにしてください。`;

const TRANSLATE_PROMPT_VERSION = 'v1';
async function getTranslationChunks(cacheKey, text) {
  const lsKey = 'toeicTranslate.' + TRANSLATE_PROMPT_VERSION + '.' + cacheKey;
  const cached = localStorage.getItem(lsKey);
  if (cached) return JSON.parse(cached);
  const outText = await callGemini(TRANSLATE_PROMPT, text, { responseMimeType: 'application/json', maxOutputTokens: 4096 });
  let parsed;
  try { parsed = JSON.parse(outText); } catch (e) { throw new Error('翻訳結果の解析に失敗しました'); }
  const segments = Array.isArray(parsed.segments) ? parsed.segments : [];
  try { localStorage.setItem(lsKey, JSON.stringify(segments)); } catch (e) { /* 保存容量オーバー等は無視 */ }
  return segments;
}

const chunkPopupEl = document.createElement('div');
chunkPopupEl.className = 'chunk-popup';
document.body.appendChild(chunkPopupEl);
document.addEventListener('click', e => {
  if (!chunkPopupEl.contains(e.target) && !e.target.closest('.chunk-seg')) {
    chunkPopupEl.classList.remove('show');
  }
});

function showChunkPopup(seg, anchorEl) {
  if (!seg.keyTerms || !seg.keyTerms.length) {
    chunkPopupEl.classList.remove('show');
    return;
  }
  chunkPopupEl.innerHTML = seg.keyTerms.map(t =>
    `<div class="chunk-popup-item"><strong>${escapeHtml(t.term || '')}</strong><div>${escapeHtml(t.meaning || '')}</div></div>`
  ).join('');
  const rect = anchorEl.getBoundingClientRect();
  chunkPopupEl.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 268)) + 'px';
  chunkPopupEl.style.top = (rect.bottom + window.scrollY + 6) + 'px';
  chunkPopupEl.classList.add('show');
}

function renderTranslationChunks(container, segments) {
  container.innerHTML = '';
  const wideWrap = document.createElement('div');
  wideWrap.className = 'translate-wide';
  const enCol = document.createElement('div');
  enCol.className = 'translate-col';
  const jaCol = document.createElement('div');
  jaCol.className = 'translate-col';
  segments.forEach((seg, i) => {
    const enSpan = document.createElement('span');
    enSpan.className = 'chunk-seg';
    enSpan.textContent = seg.en + ' ';
    const jaSpan = document.createElement('span');
    jaSpan.className = 'chunk-seg';
    jaSpan.textContent = seg.ja + ' ';
    [[enSpan, jaSpan], [jaSpan, enSpan]].forEach(([self, partner]) => {
      self.addEventListener('mouseenter', () => { self.classList.add('chunk-hover'); partner.classList.add('chunk-hover'); });
      self.addEventListener('mouseleave', () => { self.classList.remove('chunk-hover'); partner.classList.remove('chunk-hover'); });
      self.addEventListener('click', () => showChunkPopup(seg, self));
    });
    enCol.appendChild(enSpan);
    jaCol.appendChild(jaSpan);
  });
  wideWrap.appendChild(enCol);
  wideWrap.appendChild(jaCol);
  container.appendChild(wideWrap);
}

// テキストブロック(Part6の本文、Part7の各文書)を、「翻訳」ボタン1つで
// 原文表示 <-> チャンク訳のワイド表示に切り替えられるウィジェットとして返す。
function buildTranslatableBlock(text, cacheKey) {
  const wrap = document.createElement('div');
  const btn = document.createElement('button');
  btn.className = 'audio-btn';
  btn.textContent = '訳 翻訳';
  wrap.appendChild(btn);

  const doc = document.createElement('div');
  doc.className = 'doc-box';
  doc.textContent = text;
  wrap.appendChild(doc);

  const translateContainer = document.createElement('div');
  translateContainer.style.display = 'none';
  wrap.appendChild(translateContainer);

  let loaded = false;
  let showing = false;
  btn.addEventListener('click', async () => {
    if (!showing) {
      if (!loaded) {
        btn.disabled = true;
        btn.textContent = '翻訳中...';
        try {
          const segments = await getTranslationChunks(cacheKey, text);
          renderTranslationChunks(translateContainer, segments);
        } catch (e) {
          translateContainer.innerHTML = `<p class="translate-error">翻訳に失敗しました: ${escapeHtml(e.message)}</p>`;
        }
        loaded = true;
        btn.disabled = false;
      }
      doc.style.display = 'none';
      translateContainer.style.display = 'block';
      btn.textContent = '訳 原文表示に戻す';
      showing = true;
    } else {
      doc.style.display = 'block';
      translateContainer.style.display = 'none';
      btn.textContent = '訳 翻訳';
      showing = false;
    }
  });

  return wrap;
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
  loginBtn.style.display = isLoggedIn() ? 'none' : 'inline-block';
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
const appModeSelectEl = document.getElementById('appModeSelect');

// ---------- 他アプリへの切り替え(decode-toeicと共通のメニュー) ----------

appModeSelectEl.addEventListener('change', () => {
  const mode = appModeSelectEl.value;
  if (mode === 'toeicOfficial') return;
  const url = new URL('https://bellaortensia.github.io/decode-toeic/');
  url.searchParams.set('mode', mode);
  window.location.href = url.toString();
});

// ---------- 挑戦回数トラッキング ----------

const ATTEMPTS_LS = 'toeicOfficialPractice.attempts';
function getAttemptsStore() {
  try { return JSON.parse(localStorage.getItem(ATTEMPTS_LS) || '{}'); } catch (e) { return {}; }
}
function getAttemptCount(key) {
  return getAttemptsStore()[key] || 0;
}
function incrementAttempt(key) {
  const store = getAttemptsStore();
  store[key] = (store[key] || 0) + 1;
  localStorage.setItem(ATTEMPTS_LS, JSON.stringify(store));
}

// ---------- ランディングナビ(TEST → Part → 問題単位、挑戦回数バッジ付き) ----------

const PART_LABELS = {
  1: 'Part1 写真描写', 2: 'Part2 応答問題', 3: 'Part3 会話問題', 4: 'Part4 説明文問題',
  5: 'Part5 短文穴埋め', 6: 'Part6 長文穴埋め', 7: 'Part7 読解問題'
};

function buildUnitList(test, part, data) {
  if (part === 1 || part === 2) {
    return data.questions.map((q, i) => ({ key: `${test}-${part}-${q.number}`, label: `Q${q.number}`, unitIndex: i }));
  }
  if (part === 3 || part === 4) {
    return data.groups.map((g, i) => ({
      key: `${test}-${part}-${g.questions[0]}`,
      label: `Q${g.questions[0]}-${g.questions[g.questions.length - 1]}`,
      unitIndex: i
    }));
  }
  if (part === 5) {
    return chunk(data.questions, 5).map((b, i) => ({
      key: `${test}-5-${b[0].number}`,
      label: `Q${b[0].number}-${b[b.length - 1].number}`,
      unitIndex: i
    }));
  }
  return data.passages.map((p, i) => ({
    key: `${test}-${part}-${p.questions[0]}`,
    label: `Q${p.questions[0]}-${p.questions[p.questions.length - 1]}${p.topic ? ' (' + p.topic + ')' : ''}`,
    unitIndex: i
  }));
}

async function jumpToUnit(test, part, unitIndex) {
  state.test = test;
  state.part = part;
  state.index = 0;
  p12 = null;
  p34 = null;
  p67 = null;
  emptyStateEl.style.display = 'none';
  practiceEl.style.display = 'block';
  practiceBodyEl.innerHTML = '読み込み中...';
  document.getElementById('setupDetails').removeAttribute('open');
  state.data = await loadPartData(test, part);
  if (part === 1 || part === 2) {
    const groupStart = Math.floor(unitIndex / 3) * 3;
    p12 = { groupStart, qIdx: unitIndex - groupStart, phase: 'question', selected: null, explanations: {} };
  } else if (part === 3 || part === 4) {
    p34 = { groupIdx: unitIndex, phase: 'question', selections: {}, explanations: {} };
  } else if (part === 5) {
    state.index = unitIndex;
  } else {
    p67 = { idx: unitIndex, phase: 'question', selections: {}, explanations: {} };
  }
  renderPractice();
}

function buildLandingNav() {
  const container = document.getElementById('landingNav');
  if (!container) return;
  ['T1', 'T2'].forEach((test, gi) => {
    const testDetails = document.createElement('details');
    testDetails.className = 'landing-test';
    if (gi === 0) testDetails.open = true;
    const testSummary = document.createElement('summary');
    testSummary.textContent = test === 'T1' ? 'TEST 1' : 'TEST 2';
    testDetails.appendChild(testSummary);

    const partsDiv = document.createElement('div');
    partsDiv.className = 'landing-parts';
    for (let part = 1; part <= 7; part++) {
      const partDetails = document.createElement('details');
      partDetails.className = 'landing-part';
      const partSummary = document.createElement('summary');
      partSummary.textContent = PART_LABELS[part];
      partDetails.appendChild(partSummary);

      const unitsDiv = document.createElement('div');
      unitsDiv.className = 'landing-units';
      unitsDiv.style.display = 'none';
      const loadingEl = document.createElement('div');
      loadingEl.className = 'loading';
      loadingEl.textContent = '読み込み中...';
      unitsDiv.appendChild(loadingEl);
      partDetails.appendChild(unitsDiv);

      partDetails.addEventListener('toggle', async () => {
        if (!partDetails.open) return;
        // loadPartData caches by test+part, so re-fetching on every open is
        // effectively free and keeps attempt-count badges up to date.
        const data = await loadPartData(test, part);
        const units = buildUnitList(test, part, data);
        unitsDiv.innerHTML = '';
        units.forEach(u => {
          const a = document.createElement('a');
          a.href = '#';
          const count = getAttemptCount(u.key);
          const badge = document.createElement('span');
          badge.className = 'attempt-badge' + (count > 0 ? ' has-attempts' : '');
          badge.textContent = String(count);
          a.appendChild(document.createTextNode(u.label + ' '));
          a.appendChild(badge);
          a.addEventListener('click', e => {
            e.preventDefault();
            jumpToUnit(test, part, u.unitIndex);
          });
          unitsDiv.appendChild(a);
        });
        unitsDiv.style.display = 'flex';
      });

      partsDiv.appendChild(partDetails);
    }
    testDetails.appendChild(partsDiv);
    container.appendChild(testDetails);
  });
}
buildLandingNav();

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

// ---------- 上部の「前の問題/次の問題」ナビ(全Part共通) ----------

function getCurrentUnitIndex() {
  if (state.part === 1 || state.part === 2) return p12 ? p12.groupStart + p12.qIdx : 0;
  if (state.part === 3 || state.part === 4) return p34 ? p34.groupIdx : 0;
  if (state.part === 5) return state.index;
  return p67 ? p67.idx : 0;
}

// jumpToUnitと違い、既存のp12/p34/p67をその場で書き換えるだけの軽量な移動。
// 各問題ごとに蓄積されたexplanations等は保持したまま、選択状態と表示フェーズだけ
// リセットする(jumpToUnitはランディングナビからの遠距離ジャンプ用に全リセットする)。
function goToAdjacentUnit(delta) {
  if (!state.data) return;
  const idx = getCurrentUnitIndex() + delta;
  if (idx < 0 || idx >= getItemCount()) return;
  if (state.part === 1 || state.part === 2) {
    if (!p12) return;
    p12.groupStart = Math.floor(idx / 3) * 3;
    p12.qIdx = idx - p12.groupStart;
    p12.phase = 'question';
    p12.selected = null;
  } else if (state.part === 3 || state.part === 4) {
    if (!p34) return;
    p34.groupIdx = idx;
    p34.phase = 'question';
    p34.selections = {};
  } else if (state.part === 5) {
    state.index = idx;
  } else {
    if (!p67) return;
    p67.idx = idx;
    p67.phase = 'question';
    p67.selections = {};
  }
  renderPractice();
}

const headerPrevBtn = document.getElementById('header-prev-btn');
const headerNextBtn = document.getElementById('header-next-btn');
headerPrevBtn.addEventListener('click', () => goToAdjacentUnit(-1));
headerNextBtn.addEventListener('click', () => goToAdjacentUnit(1));

// renderPart1or2/3or4/6/7は途中のフェーズ遷移(次の問題へ、シャドーイングへ、など)で
// renderPractice()を経由せず自分自身を再帰的に呼び出すため、進捗表示とボタンの
// 有効/無効はrenderPractice()側ではなく、各renderPartX()の先頭で毎回更新する。
function updateHeaderNav() {
  const unitIdx = getCurrentUnitIndex();
  const unitCount = getItemCount();
  progressLabelEl.textContent = `${unitIdx + 1} / ${unitCount}`;
  headerPrevBtn.disabled = unitIdx <= 0;
  headerNextBtn.disabled = unitIdx >= unitCount - 1;
}

// ---------- Part別レンダリング ----------

function renderPractice() {
  practiceBodyEl.innerHTML = '';
  if (state.part === 1 || state.part === 2) renderPart1or2();
  else if (state.part === 3 || state.part === 4) renderPart3or4();
  else if (state.part === 5) renderPart5();
  else if (state.part === 6) renderPart6();
  else if (state.part === 7) renderPart7();
}

// ---------- ディクテーション/シャドーイング(共通コンポーネント) ----------

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// items: [{ label, text, audio }]
function renderDictation(items, onComplete) {
  let idx = 0;
  let buffer = '';
  let currentAudio = null;
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

  function stopAudio() {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  }

  async function playCurrent() {
    stopAudio();
    playBtn.disabled = true;
    playBtn.textContent = '読み込み中...';
    const url = await getAudioUrl(items[idx].audio);
    playBtn.disabled = false;
    playBtn.textContent = '▶ 音声を再生 (Spaceキーでも再生できます)';
    if (url) { currentAudio = new Audio(url); currentAudio.play(); }
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
    stopAudio();
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

// items: [{ label, text, audio, explanation }]
function renderShadowing(items, onComplete) {
  let idx = 0;
  let currentAudio = null;
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

  const explainEl = document.createElement('div');
  explainEl.className = 'explain-box';
  explainEl.style.display = 'none';
  wrap.appendChild(explainEl);

  const nextBtn = document.createElement('button');
  nextBtn.textContent = '次へ';
  nextBtn.style.marginTop = '12px';
  wrap.appendChild(nextBtn);

  function stopAudio() {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  }

  async function playCurrent() {
    if (!items[idx].audio) return;
    stopAudio();
    playBtn.disabled = true;
    playBtn.textContent = '読み込み中...';
    const url = await getAudioUrl(items[idx].audio);
    playBtn.disabled = false;
    playBtn.textContent = '▶ 音声を再生 (Spaceキーでも再生できます)';
    if (url) { currentAudio = new Audio(url); currentAudio.play(); }
  }
  playBtn.addEventListener('click', playCurrent);

  function render() {
    const item = items[idx];
    title.textContent = `シャドーイング (${idx + 1}/${items.length}) ${item.label || ''}`;
    if (item.audio) {
      playBtn.style.display = '';
      playBtn.textContent = '▶ 音声を再生 (Spaceキーでも再生できます)';
    } else {
      playBtn.style.display = 'none';
    }
    textEl.textContent = item.text;
    if (item.explanation) {
      explainEl.textContent = item.explanation;
      explainEl.style.display = 'block';
    } else {
      explainEl.style.display = 'none';
    }
  }

  function keyHandler(e) {
    if (e.code === 'Space') { e.preventDefault(); playCurrent(); }
  }
  nextBtn.addEventListener('click', () => {
    stopAudio();
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
  if (!p12) p12 = { groupStart: 0, qIdx: 0, phase: 'question', selected: null, explanations: {} };
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
    return { label: `Q${q.number}`, text, audio: q.audio, explanation: p12.explanations[q.number] };
  });
}

function renderPart1or2() {
  initP12IfNeeded();
  updateHeaderNav();
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
      p12.explanations[q.number] = text;
      incrementAttempt(`${state.test}-${state.part}-${q.number}`);
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

let p34 = null; // { groupIdx, phase, selections, explanations }

function initP34IfNeeded() {
  if (!p34) p34 = { groupIdx: 0, phase: 'question', selections: {}, explanations: {} };
}

function p34BuildShadowingItems(g) {
  const text = g.items.map(item => `${item.number}. ${item.text}`).join('\n');
  const explanation = g.items.map(item => `【${item.number}】\n${p34.explanations[item.number] || ''}`).join('\n\n');
  return [{ label: `Q${g.questions[0]}-${g.questions[g.questions.length - 1]}`, text, audio: g.audioQuestions, explanation }];
}

function renderPart3or4() {
  initP34IfNeeded();
  updateHeaderNav();
  const g = state.data.groups[p34.groupIdx];

  if (p34.phase === 'shadowing') {
    renderShadowing(p34BuildShadowingItems(g), () => {
      p34.groupIdx++;
      p34.phase = 'question';
      p34.selections = {};
      if (p34.groupIdx >= state.data.groups.length) {
        practiceBodyEl.innerHTML = '<p>このPartは終了です。上のプルダウンから次のPartを選んでください。</p>';
      } else {
        renderPart3or4();
      }
    });
    return;
  }

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

  const blocks = {};
  g.items.forEach(item => {
    const block = document.createElement('div');
    block.className = 'q-block';
    const t = document.createElement('div');
    t.className = 'q-text';
    t.textContent = `${item.number}. ${item.text}`;
    block.appendChild(t);

    const choicesDiv = document.createElement('div');
    const letters = Object.keys(item.choices);
    letters.forEach(letter => {
      const btn = document.createElement('button');
      btn.className = 'choice';
      btn.textContent = `(${letter}) ${item.choices[letter]}`;
      btn.addEventListener('click', () => {
        choicesDiv.querySelectorAll('.choice').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        p34.selections[item.number] = letter;
        nextBtn.disabled = Object.keys(p34.selections).length < g.items.length;
      });
      choicesDiv.appendChild(btn);
    });
    block.appendChild(choicesDiv);

    const explainDiv = document.createElement('div');
    explainDiv.className = 'explain-box';
    explainDiv.style.display = 'none';
    block.appendChild(explainDiv);

    blocks[item.number] = { choicesDiv, explainDiv, letters };
    wrap.appendChild(block);
  });

  const nextBtn = document.createElement('button');
  nextBtn.textContent = '次へ';
  nextBtn.className = 'grade-btn';
  nextBtn.disabled = true;
  const revealed = { done: false };
  nextBtn.addEventListener('click', async () => {
    if (!revealed.done) {
      revealed.done = true;
      nextBtn.disabled = true;
      nextBtn.textContent = '採点中...';
      g.items.forEach(item => {
        const { choicesDiv, explainDiv, letters } = blocks[item.number];
        const isCorrect = p34.selections[item.number] === item.answer;
        const buttons = choicesDiv.querySelectorAll('.choice');
        buttons.forEach((b, i) => {
          b.disabled = true;
          if (letters[i] === item.answer) b.classList.add('correct');
          else if (letters[i] === p34.selections[item.number]) b.classList.add('wrong');
        });
        explainDiv.style.display = 'block';
        explainDiv.textContent = (isCorrect ? '正解です!\n\n' : '不正解です。\n\n') + '解説を生成中...';
      });
      for (const item of g.items) {
        const { explainDiv } = blocks[item.number];
        const isCorrect = p34.selections[item.number] === item.answer;
        const prefix = isCorrect ? '正解です!\n\n' : '不正解です。\n\n';
        let text;
        try {
          const questionText = `${item.number}. ${item.text}\n選択肢: ${Object.entries(item.choices).map(([l, txt]) => `(${l}) ${txt}`).join(' ')}\n正解: (${item.answer}) ${item.choices[item.answer]}`;
          text = prefix + await getExplanation(`${state.test}-${state.part}-${item.number}`, questionText);
        } catch (e) {
          text = prefix + '解説の取得に失敗しました: ' + e.message;
        }
        explainDiv.textContent = text;
        p34.explanations[item.number] = text;
      }
      incrementAttempt(`${state.test}-${state.part}-${g.questions[0]}`);
      nextBtn.disabled = false;
      nextBtn.textContent = 'シャドーイングへ';
    } else {
      p34.phase = 'shadowing';
      renderPart3or4();
    }
  });
  wrap.appendChild(nextBtn);

  practiceBodyEl.innerHTML = '';
  practiceBodyEl.appendChild(wrap);
}

function renderPart5() {
  updateHeaderNav();
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
    incrementAttempt(`${state.test}-5-${batch[0].number}`);
  });
  wrap.appendChild(gradeBtn);

  practiceBodyEl.appendChild(wrap);
}

// ---------- Part6/7 共通(1セット解答→まとめて解説→シャドーイング) ----------

let p67 = null; // { idx, phase, selections, explanations }

function initP67IfNeeded() {
  if (!p67) p67 = { idx: 0, phase: 'question', selections: {}, explanations: {} };
}

function p67AdvancePassage(renderFn) {
  p67.idx++;
  p67.phase = 'question';
  p67.selections = {};
  p67.explanations = {};
  if (p67.idx >= state.data.passages.length) {
    practiceBodyEl.innerHTML = '<p>このPartは終了です。上のプルダウンから次のPartを選んでください。</p>';
  } else {
    renderFn();
  }
}

function p67RenderQuestionBlocks(wrap, items, getBlockLabel) {
  const blocks = {};
  items.forEach(item => {
    const block = document.createElement('div');
    block.className = 'q-block';
    const t = document.createElement('div');
    t.className = 'q-text';
    t.textContent = getBlockLabel(item);
    block.appendChild(t);

    const choicesDiv = document.createElement('div');
    const letters = Object.keys(item.choices);
    letters.forEach(letter => {
      const btn = document.createElement('button');
      btn.className = 'choice';
      btn.textContent = `(${letter}) ${item.choices[letter]}`;
      btn.addEventListener('click', () => {
        choicesDiv.querySelectorAll('.choice').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        p67.selections[item.number] = letter;
        nextBtnRef.disabled = Object.keys(p67.selections).length < items.length;
      });
      choicesDiv.appendChild(btn);
    });
    block.appendChild(choicesDiv);

    const explainDiv = document.createElement('div');
    explainDiv.className = 'explain-box';
    explainDiv.style.display = 'none';
    block.appendChild(explainDiv);

    blocks[item.number] = { choicesDiv, explainDiv, letters };
    wrap.appendChild(block);
  });

  const nextBtnRef = document.createElement('button');
  nextBtnRef.textContent = '次へ';
  nextBtnRef.className = 'grade-btn';
  nextBtnRef.disabled = true;
  wrap.appendChild(nextBtnRef);
  return { blocks, nextBtn: nextBtnRef };
}

async function p67RevealAndExplain(items, blocks, nextBtn, questionTextBuilder, cacheKeyBuilder, attemptKey) {
  nextBtn.disabled = true;
  nextBtn.textContent = '採点中...';
  items.forEach(item => {
    const { choicesDiv, explainDiv, letters } = blocks[item.number];
    const isCorrect = p67.selections[item.number] === item.answer;
    const buttons = choicesDiv.querySelectorAll('.choice');
    buttons.forEach((b, i) => {
      b.disabled = true;
      if (letters[i] === item.answer) b.classList.add('correct');
      else if (letters[i] === p67.selections[item.number]) b.classList.add('wrong');
    });
    explainDiv.style.display = 'block';
    explainDiv.textContent = (isCorrect ? '正解です!\n\n' : '不正解です。\n\n') + '解説を生成中...';
  });
  for (const item of items) {
    const { explainDiv } = blocks[item.number];
    const isCorrect = p67.selections[item.number] === item.answer;
    const prefixHtml = isCorrect
      ? '<div><strong style="color:#2f9e4f">正解です!</strong></div><div><br></div>'
      : '<div><strong style="color:#c1503f">不正解です。</strong></div><div><br></div>';
    let html;
    try {
      html = prefixHtml + await getRichExplanation(cacheKeyBuilder(item), questionTextBuilder(item));
    } catch (e) {
      html = prefixHtml + `<div>解説の取得に失敗しました: ${escapeHtml(e.message)}</div>`;
    }
    explainDiv.innerHTML = html;
    p67.explanations[item.number] = html;
  }
  incrementAttempt(attemptKey);
  nextBtn.disabled = false;
  nextBtn.textContent = 'シャドーイングへ';
}

function renderPart6() {
  initP67IfNeeded();
  updateHeaderNav();
  const p = state.data.passages[p67.idx];

  if (p67.phase === 'shadowing') {
    const items = [{ label: '本文', text: p.text, audio: p.audio || null }];
    renderShadowing(items, () => p67AdvancePassage(renderPart6));
    return;
  }

  const wrap = document.createElement('div');
  const label = document.createElement('div');
  label.className = 'passage-topic';
  label.textContent = p.topic || '';
  wrap.appendChild(label);
  wrap.appendChild(buildTranslatableBlock(p.text, `${state.test}-6-${p.questions[0]}`));

  const { blocks, nextBtn } = p67RenderQuestionBlocks(wrap, p.items, item => `(${item.number})`);
  const revealed = { done: false };
  nextBtn.addEventListener('click', async () => {
    if (!revealed.done) {
      revealed.done = true;
      await p67RevealAndExplain(
        p.items, blocks, nextBtn,
        item => `文章:\n${p.text}\n\n設問(${item.number}): 空欄(${item.number})に入る最も適切な語句を選ぶ。\n選択肢: ${Object.entries(item.choices).map(([l, txt]) => `(${l}) ${txt}`).join(' ')}\n正解: (${item.answer}) ${item.choices[item.answer]}`,
        item => `${state.test}-6-${item.number}`,
        `${state.test}-6-${p.questions[0]}`
      );
    } else {
      p67.phase = 'shadowing';
      renderPart6();
    }
  });

  practiceBodyEl.innerHTML = '';
  practiceBodyEl.appendChild(wrap);
}

function renderPart7() {
  initP67IfNeeded();
  updateHeaderNav();
  const p = state.data.passages[p67.idx];

  if (p67.phase === 'shadowing') {
    const audios = Array.isArray(p.audio) ? p.audio : (p.audio ? [p.audio] : []);
    const items = p.documents.map((doc, di) => ({
      label: doc.label || `文書${di + 1}`,
      text: doc.text,
      audio: audios[di] || audios[0] || null
    }));
    renderShadowing(items, () => p67AdvancePassage(renderPart7));
    return;
  }

  const wrap = document.createElement('div');
  const label = document.createElement('div');
  label.className = 'passage-topic';
  label.textContent = p.topic || '';
  wrap.appendChild(label);
  p.documents.forEach((doc, di) => {
    const docWrap = buildTranslatableBlock(doc.text, `${state.test}-7-${p.questions[0]}-doc${di}`);
    const lbl = document.createElement('div');
    lbl.className = 'doc-label';
    docWrap.insertBefore(lbl, docWrap.firstChild);
    lbl.textContent = doc.label;
    wrap.appendChild(docWrap);
  });

  const { blocks, nextBtn } = p67RenderQuestionBlocks(wrap, p.items, item => `${item.number}. ${item.text}`);
  const revealed = { done: false };
  nextBtn.addEventListener('click', async () => {
    if (!revealed.done) {
      revealed.done = true;
      const passageContext = p.documents.map(d => `【${d.label}】\n${d.text}`).join('\n\n');
      await p67RevealAndExplain(
        p.items, blocks, nextBtn,
        item => `文書:\n${passageContext}\n\n設問${item.number}: ${item.text}\n選択肢: ${Object.entries(item.choices).map(([l, txt]) => `(${l}) ${txt}`).join(' ')}\n正解: (${item.answer}) ${item.choices[item.answer]}`,
        item => `${state.test}-7-${item.number}`,
        `${state.test}-7-${p.questions[0]}`
      );
    } else {
      p67.phase = 'shadowing';
      renderPart7();
    }
  });

  practiceBodyEl.innerHTML = '';
  practiceBodyEl.appendChild(wrap);
}

loginBtn.addEventListener('click', startLogin);
handleRedirect();
