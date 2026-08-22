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
続けて、必ず最初の文で「正解は(X)です。」と正解の記号を明記すること。入力に「あなたの回答」が含まれ、それが正解と異なる場合は、その回答がなぜ誤りなのかを具体的に説明すること(単に不正解と述べるだけでなく、その選択肢のどこが本文の内容と合わないのかを明記する)。その後、なぜ正解の選択肢が正しいのかを説明する。本文中の根拠となる箇所を引用する際は①②③...の番号を付け、直後に「」で該当箇所を引用すること(例: ①「the delivery will be delayed」)。

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

const TRANSLATE_PROMPT = `あなたは英語学習者向けの解析エンジンです。与えられた英文全体を解析してください。
1) 最初の1文字から最後の1文字まで省略せず、意味のまとまり(チャンク)ごとに分割し、各チャンクに英語の語順のまま前から順番に理解できる「直訳調」の日本語訳を付けてください(自然な日本語の語順に並べ替えないこと)。1チャンクの目安は英単語3〜8語程度です(1文をまるごと1つのチャンクにしないこと)。
2) 各チャンクの中にTOEIC頻出の単語・熟語・言い回しがあれば、その語句を一字一句原文のまま抜き出し、keyTermsに追加してください(該当が無いチャンクではkeyTermsを空配列にする)。
3) 英文全体の、自然な日本語の語順・言い回しでの意訳(naturalJa)も作成してください。
出力は必ず次のJSON形式のみを返し、説明文やコードフェンスは一切含めないこと。
{
  "segments": [
    { "en": "原文チャンク(原文から一字一句変えずに抜粋)", "ja": "直訳調の日本語訳チャンク", "keyTerms": [{"term":"抜き出した語句(原文表記のまま)","meaning":"意味(短く)"}] }
  ],
  "naturalJa": "英文全体の自然な日本語訳"
}
segmentsの"en"を出現順にそのまま連結すると、空白の増減を除いて原文と完全に一致するようにしてください。`;

const TRANSLATE_PROMPT_VERSION = 'v2';
async function getTranslationChunks(cacheKey, text) {
  const lsKey = 'toeicTranslate.' + TRANSLATE_PROMPT_VERSION + '.' + cacheKey;
  const cached = localStorage.getItem(lsKey);
  if (cached) return JSON.parse(cached);
  const outText = await callGemini(TRANSLATE_PROMPT, text, { responseMimeType: 'application/json', maxOutputTokens: 4096 });
  let parsed;
  try { parsed = JSON.parse(outText); } catch (e) { throw new Error('翻訳結果の解析に失敗しました'); }
  const result = { segments: Array.isArray(parsed.segments) ? parsed.segments : [], naturalJa: parsed.naturalJa || '' };
  try { localStorage.setItem(lsKey, JSON.stringify(result)); } catch (e) { /* 保存容量オーバー等は無視 */ }
  return result;
}

// クリックしたチャンクを1文として、TOEIC講師視点の文法・語彙解説を生成する
// (decode-toeicの「この文を解説→学習メモ」と同じ発想。単語の意味だけでなく文単位の解説)。
const CLAUSE_EXPLAIN_PROMPT_READING = `あなたはTOEIC満点を何度も取得し、初心者指導歴20年以上の英語講師です。
まず1行目に、入力された英文をそのまま「■」に続けて書くこと。次の行に、その日本語訳を（）で囲んで書くこと。
その次の行から、この文に含まれる、TOEICで狙われやすい、あるいは「これを知っておかないと絶対正しく読めない」であろう文法・語彙・構文・表現の知識について、簡潔に日本語で解説してください。
装飾やMarkdown記号(**など)は使わず、プレーンテキストのみで出力してください。`;

async function getClauseExplanation(clauseText) {
  return await callGemini(CLAUSE_EXPLAIN_PROMPT_READING, clauseText, { maxOutputTokens: 800 });
}

function appendToNotes(notesArea, enText, explanation) {
  const block = document.createElement('div');
  block.className = 'notes-entry';
  const quote = document.createElement('div');
  quote.className = 'notes-entry-quote';
  quote.textContent = enText;
  const body = document.createElement('div');
  body.className = 'notes-entry-body';
  body.textContent = explanation;
  block.appendChild(quote);
  block.appendChild(body);
  notesArea.appendChild(block);
  notesArea.scrollTop = notesArea.scrollHeight;
}

const chunkPopupEl = document.createElement('div');
chunkPopupEl.className = 'chunk-popup';
document.body.appendChild(chunkPopupEl);
document.addEventListener('click', e => {
  if (!chunkPopupEl.contains(e.target) && !e.target.closest('.chunk-seg')) {
    chunkPopupEl.classList.remove('show');
  }
});

function showChunkPopup(seg, anchorEl, notesArea) {
  const terms = seg.keyTerms || [];
  const termsHtml = terms.map((t, i) =>
    `<div class="chunk-popup-item chunk-popup-term" data-action="term" data-term-idx="${i}"><strong>${escapeHtml(t.term || '')}</strong><div>${escapeHtml(t.meaning || '')}</div></div>`
  ).join('');
  chunkPopupEl.innerHTML = termsHtml + '<div class="chunk-popup-item chunk-popup-explain" data-action="explain"><strong>この文を解説→ノートへ</strong></div>';
  chunkPopupEl.onclick = async e => {
    const termTrigger = e.target.closest('[data-action="term"]');
    if (termTrigger) {
      const t = terms[Number(termTrigger.dataset.termIdx)];
      if (t) appendToNotes(notesArea, t.term, t.meaning);
      termTrigger.classList.add('added');
      return;
    }
    const trigger = e.target.closest('[data-action="explain"]');
    if (!trigger || trigger.dataset.loading === '1') return;
    trigger.dataset.loading = '1';
    trigger.querySelector('strong').textContent = '解説中...';
    try {
      const explanation = await getClauseExplanation(seg.en);
      appendToNotes(notesArea, seg.en, explanation);
      trigger.querySelector('strong').textContent = 'ノートに追記しました';
    } catch (err) {
      trigger.querySelector('strong').textContent = '解説の生成に失敗しました: ' + err.message;
      trigger.dataset.loading = '0';
    }
  };
  const rect = anchorEl.getBoundingClientRect();
  chunkPopupEl.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 268)) + 'px';
  chunkPopupEl.style.top = (rect.bottom + window.scrollY + 6) + 'px';
  chunkPopupEl.classList.add('show');
}

function renderTranslationChunks(container, segments, notesArea) {
  container.innerHTML = '';
  const wideWrap = document.createElement('div');
  wideWrap.className = 'translate-wide';
  const enCol = document.createElement('div');
  enCol.className = 'translate-col';
  const jaCol = document.createElement('div');
  jaCol.className = 'translate-col';
  segments.forEach(seg => {
    const enSpan = document.createElement('span');
    enSpan.className = 'chunk-seg';
    enSpan.textContent = seg.en + ' ';
    const jaSpan = document.createElement('span');
    jaSpan.className = 'chunk-seg';
    jaSpan.textContent = seg.ja + ' ';
    [[enSpan, jaSpan], [jaSpan, enSpan]].forEach(([self, partner]) => {
      self.addEventListener('mouseenter', () => { self.classList.add('chunk-hover'); partner.classList.add('chunk-hover'); });
      self.addEventListener('mouseleave', () => { self.classList.remove('chunk-hover'); partner.classList.remove('chunk-hover'); });
      self.addEventListener('click', () => showChunkPopup(seg, self, notesArea));
    });
    enCol.appendChild(enSpan);
    jaCol.appendChild(jaSpan);
  });
  wideWrap.appendChild(enCol);
  wideWrap.appendChild(jaCol);
  container.appendChild(wideWrap);
}

// 解説画面用の翻訳ウィジェット:「翻訳」ボタンで開き、直訳(チャンク表示)⇄意訳の
// 切り替え、ワイド/トールモード、クリックしたチャンクの解説をノートへ書き写す機能を持つ。
// 問題文の原文表示そのものを、decode-toeicの英文貼り付け欄のように
// 「翻訳」ボタン1つでチャンク訳のワイド表示に置き換えるウィジェット。
function buildTranslatableBlock(text, cacheKey) {
  const wrap = document.createElement('div');
  wrap.className = 'translate-block';

  const btn = document.createElement('button');
  btn.className = 'audio-btn';
  btn.textContent = '翻訳';
  wrap.appendChild(btn);

  const box = document.createElement('div');
  box.className = 'doc-box translate-box';
  box.textContent = text;
  wrap.appendChild(box);

  let loaded = false;
  let showing = false;
  let data = null;
  let mode = 'literal'; // 'literal' | 'natural'
  let wide = true; // デフォルトでワイドモード
  let tall = false;

  function renderChunkView() {
    box.innerHTML = '';
    box.classList.toggle('wide-mode', wide);
    box.classList.toggle('tall-mode', tall);

    const controls = document.createElement('div');
    controls.className = 'translate-controls';
    const wideBtn = document.createElement('button');
    wideBtn.className = 'mode-toggle-btn';
    const tallBtn = document.createElement('button');
    tallBtn.className = 'mode-toggle-btn';
    const modeLeftBtn = document.createElement('button');
    modeLeftBtn.className = 'mode-toggle-btn edge-nav-btn';
    modeLeftBtn.textContent = '◀';
    const modeLabel = document.createElement('span');
    modeLabel.className = 'translate-mode-label';
    const modeRightBtn = document.createElement('button');
    modeRightBtn.className = 'mode-toggle-btn edge-nav-btn';
    modeRightBtn.textContent = '▶';
    controls.appendChild(wideBtn);
    controls.appendChild(tallBtn);
    controls.appendChild(modeLeftBtn);
    controls.appendChild(modeLabel);
    controls.appendChild(modeRightBtn);
    box.appendChild(controls);

    const chunkContainer = document.createElement('div');
    box.appendChild(chunkContainer);

    const naturalContainer = document.createElement('div');
    naturalContainer.className = 'natural-ja-box';
    box.appendChild(naturalContainer);

    const notesWrap = document.createElement('div');
    notesWrap.className = 'notes-wrap';
    const notesLabel = document.createElement('div');
    notesLabel.className = 'notes-label';
    notesLabel.textContent = 'ノート(単語や文をクリックすると意味・解説が書き写されます)';
    const notesArea = document.createElement('div');
    notesArea.className = 'notes-area';
    notesWrap.appendChild(notesLabel);
    notesWrap.appendChild(notesArea);
    box.appendChild(notesWrap);

    function refreshModeUI() {
      wideBtn.textContent = wide ? '⛶ ワイド解除' : '⛶ ワイドモード';
      tallBtn.textContent = tall ? '⬍ トール解除' : '⬍ トールモード';
      modeLabel.textContent = mode === 'literal' ? '直訳' : '意訳';
      chunkContainer.style.display = mode === 'literal' ? 'block' : 'none';
      naturalContainer.style.display = mode === 'natural' ? 'block' : 'none';
    }
    modeLeftBtn.addEventListener('click', () => { mode = mode === 'literal' ? 'natural' : 'literal'; refreshModeUI(); });
    modeRightBtn.addEventListener('click', () => { mode = mode === 'literal' ? 'natural' : 'literal'; refreshModeUI(); });
    wideBtn.addEventListener('click', () => { wide = !wide; box.classList.toggle('wide-mode', wide); refreshModeUI(); });
    tallBtn.addEventListener('click', () => { tall = !tall; box.classList.toggle('tall-mode', tall); refreshModeUI(); });

    renderTranslationChunks(chunkContainer, data.segments, notesArea);
    naturalContainer.textContent = data.naturalJa || '';
    refreshModeUI();
  }

  function renderPlain() {
    box.className = 'doc-box translate-box';
    box.innerHTML = '';
    box.textContent = text;
  }

  btn.addEventListener('click', async () => {
    if (!showing) {
      if (!loaded) {
        btn.disabled = true;
        btn.textContent = '翻訳中...';
        try {
          data = await getTranslationChunks(cacheKey, text);
          loaded = true;
        } catch (e) {
          btn.disabled = false;
          btn.textContent = '翻訳';
          box.innerHTML = `<p class="translate-error">翻訳に失敗しました: ${escapeHtml(e.message)}</p>`;
          return;
        }
        btn.disabled = false;
      }
      renderChunkView();
      btn.textContent = '原文表示に戻す';
      showing = true;
    } else {
      renderPlain();
      btn.textContent = '翻訳';
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
  store[key] = Math.min(99, (store[key] || 0) + 1);
  localStorage.setItem(ATTEMPTS_LS, JSON.stringify(store));
  recordStudyActivity();
}
function setAttemptCount(key, value) {
  const store = getAttemptsStore();
  store[key] = Math.max(0, Math.min(99, value));
  localStorage.setItem(ATTEMPTS_LS, JSON.stringify(store));
}

// ---------- 学習ログ(総学習時間・今週の学習状況・総学習回数・連続学習日数) ----------
// スタディサプリENGLISHのTOP画面を参考にしたダッシュボード。学習時間は、採点イベント
// 間の間隔が3分以内なら「学習が続いていた」とみなして加算する(バックグラウンドで
// 開きっぱなしのタブの時間を過大計上しないための簡易ヒューリスティック)。

const STUDY_LOG_LS = 'toeicOfficialPractice.studyLog';
const STUDY_GOAL_LS = 'toeicOfficialPractice.studyGoalMinutes';
const STUDY_GAP_MS = 3 * 60 * 1000;
const DEFAULT_GOAL_MINUTES = 280; // 4時間40分

function localDateKey(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getStudyLog() {
  try {
    const log = JSON.parse(localStorage.getItem(STUDY_LOG_LS) || '{}');
    return {
      daySeconds: log.daySeconds || {},
      dayCounts: log.dayCounts || {},
      totalSeconds: log.totalSeconds || 0,
      lastActivity: log.lastActivity || 0
    };
  } catch (e) {
    return { daySeconds: {}, dayCounts: {}, totalSeconds: 0, lastActivity: 0 };
  }
}

function recordStudyActivity() {
  const log = getStudyLog();
  const now = Date.now();
  const dateKey = localDateKey();
  if (log.lastActivity && (now - log.lastActivity) < STUDY_GAP_MS) {
    const elapsed = Math.round((now - log.lastActivity) / 1000);
    log.totalSeconds += elapsed;
    log.daySeconds[dateKey] = (log.daySeconds[dateKey] || 0) + elapsed;
  }
  log.lastActivity = now;
  log.dayCounts[dateKey] = (log.dayCounts[dateKey] || 0) + 1;
  localStorage.setItem(STUDY_LOG_LS, JSON.stringify(log));
}

function computeStreakDays(log) {
  let streak = 0;
  const d = new Date();
  for (;;) {
    const key = localDateKey(d);
    if (!log.dayCounts[key]) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

// 記録がある日付を昇順に並べ、連続する日数の最長記録を求める(現在進行中の
// 連続記録がその時点で最長であれば、この計算にも自然に含まれる)。
function computeBestStreak(log) {
  const dates = Object.keys(log.dayCounts).sort();
  if (!dates.length) return 0;
  let best = 1, cur = 1;
  for (let i = 1; i < dates.length; i++) {
    const diffDays = Math.round((new Date(dates[i]) - new Date(dates[i - 1])) / 86400000);
    cur = diffDays === 1 ? cur + 1 : 1;
    best = Math.max(best, cur);
  }
  return best;
}

function getWeekDates(reference = new Date()) {
  const dow = (reference.getDay() + 6) % 7; // 0=月
  const weekStart = new Date(reference);
  weekStart.setDate(reference.getDate() - dow);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    dates.push(d);
  }
  return { dates, dow };
}

function getStudyGoalMinutes() {
  const v = Number(localStorage.getItem(STUDY_GOAL_LS));
  return v > 0 ? v : DEFAULT_GOAL_MINUTES;
}
function setStudyGoalMinutes(minutes) {
  localStorage.setItem(STUDY_GOAL_LS, String(Math.max(1, Math.round(minutes))));
}

function formatStudyTime(totalSeconds) {
  const totalMinutes = Math.floor(totalSeconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}時間${m}分` : `${m}分`;
}

function formatClock(totalSeconds) {
  const totalMinutes = Math.floor(totalSeconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function renderStatsDashboard() {
  const container = document.getElementById('statsDashboard');
  if (!container) return;
  const log = getStudyLog();
  const totalCount = Object.values(log.dayCounts).reduce((sum, c) => sum + c, 0);
  const streak = computeStreakDays(log);
  const bestStreak = computeBestStreak(log);
  const { dates: weekDates, dow } = getWeekDates();
  const daySecondsThisWeek = weekDates.map(d => log.daySeconds[localDateKey(d)] || 0);
  const weekSeconds = daySecondsThisWeek.reduce((a, b) => a + b, 0);
  const bestDaySeconds = Math.max(0, ...Object.values(log.daySeconds));
  const goalMinutes = getStudyGoalMinutes();
  const goalSeconds = goalMinutes * 60;
  const progress = Math.min(1, weekSeconds / goalSeconds);

  container.innerHTML = '';
  const top = document.createElement('div');
  top.className = 'dashboard-top';

  // ---- 週間リング ----
  const ringWrap = document.createElement('div');
  ringWrap.className = 'week-ring-wrap';
  const circumference = 2 * Math.PI * 52;
  ringWrap.innerHTML = `
    <svg class="week-ring-svg" viewBox="0 0 120 120">
      <circle class="week-ring-track" cx="60" cy="60" r="52" />
      <circle class="week-ring-progress" cx="60" cy="60" r="52"
        style="stroke-dasharray:${circumference};stroke-dashoffset:${circumference * (1 - progress)}" />
    </svg>
    <div class="week-ring-center">
      <div class="week-ring-value">${escapeHtml(formatStudyTime(weekSeconds))}</div>
    </div>`;
  const ringLegend = document.createElement('div');
  ringLegend.className = 'week-ring-legend';
  ringLegend.innerHTML = `<span class="legend-dot"></span>今週の学習時間 <span class="legend-goal">(目標: ${escapeHtml(formatStudyTime(goalSeconds))})</span>`;
  const ringBox = document.createElement('div');
  ringBox.className = 'week-ring-box';
  ringBox.appendChild(ringWrap);
  ringBox.appendChild(ringLegend);
  top.appendChild(ringBox);

  // ---- 統計カード2x2 ----
  const grid = document.createElement('div');
  grid.className = 'stats-grid';

  function makeCard(icon, title, innerHtml) {
    const card = document.createElement('div');
    card.className = 'stat-card';
    card.innerHTML = `<div class="stat-card-title">${icon} ${escapeHtml(title)}</div>${innerHtml}`;
    return card;
  }

  grid.appendChild(makeCard('🕐', '総学習時間', `<div class="stat-card-value">${escapeHtml(formatStudyTime(log.totalSeconds))}</div>`));
  grid.appendChild(makeCard('↻', '総学習回数', `<div class="stat-card-value">${totalCount}回</div>`));

  const dayLabels = ['月', '火', '水', '木', '金', '土', '日'];
  const maxDaySec = Math.max(1, ...daySecondsThisWeek);
  const weekBarsHtml = daySecondsThisWeek.map((sec, i) => `
    <div class="week-day">
      <div class="week-bar-count">${escapeHtml(formatClock(sec))}</div>
      <div class="week-bar-track"><div class="week-bar-fill" style="height:${Math.round((sec / maxDaySec) * 100)}%"></div></div>
      <div class="week-day-label${i === dow ? ' today' : ''}">${dayLabels[i]}</div>
    </div>`).join('');
  grid.appendChild(makeCard('📊', '今週の学習状況',
    `<div class="week-chart">${weekBarsHtml}</div><div class="stat-card-best">自己ベスト ${escapeHtml(formatStudyTime(bestDaySeconds))}</div>`));

  grid.appendChild(makeCard('🔥', '連続学習日数',
    `<div class="stat-card-value">${streak}日</div><div class="stat-card-best">自己ベスト ${bestStreak}日</div>`));

  top.appendChild(grid);
  container.appendChild(top);

  const actions = document.createElement('div');
  actions.className = 'dashboard-actions';
  const goalBtn = document.createElement('button');
  goalBtn.className = 'reveal-btn';
  goalBtn.textContent = '⚙ 目標設定';
  goalBtn.addEventListener('click', () => {
    const cur = getStudyGoalMinutes();
    const input = window.prompt(`今週の学習目標を分単位で入力してください(現在: ${formatStudyTime(cur * 60)})`, String(cur));
    if (input === null) return;
    const mins = parseInt(input, 10);
    if (!isNaN(mins) && mins > 0) {
      setStudyGoalMinutes(mins);
      renderStatsDashboard();
    }
  });
  actions.appendChild(goalBtn);
  container.appendChild(actions);
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

// 1行1ユニット: リンク(ジャンプ)+挑戦回数メーター(5段階ドット+数字+-/+ボタン)。
function buildUnitRow(container, u, onJump) {
  const row = document.createElement('div');
  row.className = 'unit-row';

  const a = document.createElement('a');
  a.href = '#';
  a.className = 'unit-link';
  a.textContent = u.label;
  a.addEventListener('click', e => {
    e.preventDefault();
    onJump();
  });
  row.appendChild(a);

  const meter = document.createElement('div');
  meter.className = 'attempt-meter';
  const minusBtn = document.createElement('button');
  minusBtn.type = 'button';
  minusBtn.className = 'meter-btn';
  minusBtn.textContent = '−';
  const dotsWrap = document.createElement('span');
  dotsWrap.className = 'meter-dots';
  const countEl = document.createElement('span');
  countEl.className = 'meter-count';
  const plusBtn = document.createElement('button');
  plusBtn.type = 'button';
  plusBtn.className = 'meter-btn';
  plusBtn.textContent = '＋';

  function refreshMeter() {
    const count = getAttemptCount(u.key);
    dotsWrap.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const dot = document.createElement('span');
      dot.className = 'meter-dot' + (i < Math.min(count, 5) ? ' filled' : '');
      dotsWrap.appendChild(dot);
    }
    countEl.textContent = String(count);
    minusBtn.disabled = count <= 0;
    plusBtn.disabled = count >= 99;
  }
  refreshMeter();

  minusBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    setAttemptCount(u.key, getAttemptCount(u.key) - 1);
    refreshMeter();
  });
  plusBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    setAttemptCount(u.key, getAttemptCount(u.key) + 1);
    refreshMeter();
  });

  meter.appendChild(minusBtn);
  meter.appendChild(dotsWrap);
  meter.appendChild(countEl);
  meter.appendChild(plusBtn);
  row.appendChild(meter);

  container.appendChild(row);
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
        // effectively free and keeps attempt-count meters up to date.
        const data = await loadPartData(test, part);
        const units = buildUnitList(test, part, data);
        unitsDiv.innerHTML = '';
        units.forEach(u => buildUnitRow(unitsDiv, u, () => jumpToUnit(test, part, u.unitIndex)));
        unitsDiv.style.display = 'flex';
      });

      partsDiv.appendChild(partDetails);
    }
    testDetails.appendChild(partsDiv);
    container.appendChild(testDetails);
  });
}
buildLandingNav();
renderStatsDashboard();

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
function formatPlayerTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function renderShadowing(items, onComplete) {
  let idx = 0;
  let currentAudio = null;
  const wrap = document.createElement('div');
  wrap.className = 'training-wrap';

  const title = document.createElement('div');
  title.className = 'training-title';
  wrap.appendChild(title);

  const player = document.createElement('div');
  player.className = 'audio-player';
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'player-toggle';
  toggleBtn.textContent = '▶️';
  const curTimeEl = document.createElement('span');
  curTimeEl.className = 'player-time';
  const trackEl = document.createElement('div');
  trackEl.className = 'player-track';
  const fillEl = document.createElement('div');
  fillEl.className = 'player-fill';
  trackEl.appendChild(fillEl);
  const totalTimeEl = document.createElement('span');
  totalTimeEl.className = 'player-time';
  player.appendChild(toggleBtn);
  player.appendChild(curTimeEl);
  player.appendChild(trackEl);
  player.appendChild(totalTimeEl);
  wrap.appendChild(player);

  const hintEl = document.createElement('div');
  hintEl.className = 'training-hint';
  hintEl.textContent = 'Spaceキーで最初から再生できます。';
  wrap.appendChild(hintEl);

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

  function resetPlayerUI() {
    toggleBtn.textContent = '▶️';
    fillEl.style.width = '0%';
    curTimeEl.textContent = '0:00';
    totalTimeEl.textContent = '0:00';
  }

  function stopAudio() {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    resetPlayerUI();
  }

  function attachAudioEvents(audio) {
    audio.addEventListener('loadedmetadata', () => { totalTimeEl.textContent = formatPlayerTime(audio.duration); });
    audio.addEventListener('timeupdate', () => {
      curTimeEl.textContent = formatPlayerTime(audio.currentTime);
      if (audio.duration) fillEl.style.width = Math.min(100, (audio.currentTime / audio.duration) * 100) + '%';
    });
    audio.addEventListener('ended', () => { toggleBtn.textContent = '▶️'; fillEl.style.width = '0%'; curTimeEl.textContent = '0:00'; });
  }

  async function playFromStart() {
    if (!items[idx].audio) return;
    stopAudio();
    toggleBtn.disabled = true;
    const url = await getAudioUrl(items[idx].audio);
    toggleBtn.disabled = false;
    if (!url) return;
    currentAudio = new Audio(url);
    attachAudioEvents(currentAudio);
    currentAudio.play();
    toggleBtn.textContent = '⏸️';
  }

  toggleBtn.addEventListener('click', () => {
    if (currentAudio && !currentAudio.paused) {
      currentAudio.pause();
      toggleBtn.textContent = '▶️';
    } else if (currentAudio) {
      currentAudio.play();
      toggleBtn.textContent = '⏸️';
    } else {
      playFromStart();
    }
  });

  function render() {
    const item = items[idx];
    title.textContent = `シャドーイング (${idx + 1}/${items.length}) ${item.label || ''}`;
    player.style.display = item.audio ? 'flex' : 'none';
    hintEl.style.display = item.audio ? 'block' : 'none';
    resetPlayerUI();
    textEl.textContent = item.text;
    if (item.explanation) {
      explainEl.textContent = item.explanation;
      explainEl.style.display = 'block';
    } else {
      explainEl.style.display = 'none';
    }
  }

  function keyHandler(e) {
    if (e.code === 'Space') { e.preventDefault(); playFromStart(); }
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
  const doc = document.createElement('div');
  doc.className = 'doc-box';
  doc.textContent = p.text;
  wrap.appendChild(doc);

  const translateSlot = document.createElement('div');
  translateSlot.style.display = 'none';
  wrap.appendChild(translateSlot);

  const { blocks, nextBtn } = p67RenderQuestionBlocks(wrap, p.items, item => `(${item.number})`);
  const revealed = { done: false };
  nextBtn.addEventListener('click', async () => {
    if (!revealed.done) {
      revealed.done = true;
      await p67RevealAndExplain(
        p.items, blocks, nextBtn,
        item => `文章:\n${p.text}\n\n設問(${item.number}): 空欄(${item.number})に入る最も適切な語句を選ぶ。\n選択肢: ${Object.entries(item.choices).map(([l, txt]) => `(${l}) ${txt}`).join(' ')}\n正解: (${item.answer}) ${item.choices[item.answer]}\nあなたの回答: (${p67.selections[item.number]}) ${item.choices[p67.selections[item.number]]}`,
        item => `${state.test}-6-${item.number}-${p67.selections[item.number]}`,
        `${state.test}-6-${p.questions[0]}`
      );
      translateSlot.style.display = 'block';
      translateSlot.appendChild(buildTranslatableBlock(p.text, `${state.test}-6-${p.questions[0]}`));
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
  const translateSlots = [];
  p.documents.forEach((doc, di) => {
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

    const slot = document.createElement('div');
    slot.style.display = 'none';
    wrap.appendChild(slot);
    translateSlots.push({ slot, doc, di });
  });

  const { blocks, nextBtn } = p67RenderQuestionBlocks(wrap, p.items, item => `${item.number}. ${item.text}`);
  const revealed = { done: false };
  nextBtn.addEventListener('click', async () => {
    if (!revealed.done) {
      revealed.done = true;
      const passageContext = p.documents.map(d => `【${d.label}】\n${d.text}`).join('\n\n');
      await p67RevealAndExplain(
        p.items, blocks, nextBtn,
        item => `文書:\n${passageContext}\n\n設問${item.number}: ${item.text}\n選択肢: ${Object.entries(item.choices).map(([l, txt]) => `(${l}) ${txt}`).join(' ')}\n正解: (${item.answer}) ${item.choices[item.answer]}\nあなたの回答: (${p67.selections[item.number]}) ${item.choices[p67.selections[item.number]]}`,
        item => `${state.test}-7-${item.number}-${p67.selections[item.number]}`,
        `${state.test}-7-${p.questions[0]}`
      );
      translateSlots.forEach(({ slot, doc, di }) => {
        slot.style.display = 'block';
        slot.appendChild(buildTranslatableBlock(doc.text, `${state.test}-7-${p.questions[0]}-doc${di}`));
      });
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
