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

// ---------- ノート保存用スプレッドシート(decode-toeicと同じApps Script Web Appブリッジ方式) ----------

const SHEET_URL_LS = 'toeicOfficialPractice.sheetUrl';
const sheetUrlInput = document.getElementById('sheetUrl');
const savedSheetUrl = localStorage.getItem(SHEET_URL_LS);
if (savedSheetUrl) sheetUrlInput.value = savedSheetUrl;
sheetUrlInput.addEventListener('change', () => localStorage.setItem(SHEET_URL_LS, sheetUrlInput.value.trim()));

function getSheetUrl() {
  return localStorage.getItem(SHEET_URL_LS) || sheetUrlInput.value.trim();
}

const copyGasBtn = document.getElementById('copyGasBtn');
if (copyGasBtn) {
  copyGasBtn.addEventListener('click', () => {
    const code = document.getElementById('gasCode').textContent;
    navigator.clipboard.writeText(code).then(() => {
      const orig = copyGasBtn.textContent;
      copyGasBtn.textContent = 'コピーしました';
      setTimeout(() => { copyGasBtn.textContent = orig; }, 1500);
    });
  });
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

// ---------- 装飾付き解説(選択肢の全訳+太字/下線/赤字/青字)。全Partで共通利用 ----------

const EXPLAIN_PROMPT_READING = `あなたはTOEIC対策の講師です。以下のTOEICの設問について、日本語で解説してください。
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

// Part5(短文穴埋め)専用: 全文の直訳ではなく、①完成文そのもの→②SVOC分解(下線付き)→
// ③スラッシュ区切りの意訳、という順で示す。
const EXPLAIN_PROMPT_PART5 = `あなたはTOEIC対策の講師です。以下のTOEIC Part5(短文穴埋め問題)について、日本語で解説してください。
必ず次の構成・記号ルールに従ってください。

1行目: ■英文 とだけ書く。
次の行: 空所に正解の選択肢を入れた完成文を、そのまま英語で書く。

次の行: ■SVOC とだけ書く。
次の行: 直前の完成文をそのまま書き写しながら、主語(S)には単語や句の前後を「S[...]」、動詞(V)には「V[...]」、目的語(O)には「O[...]」、補語(C)には「C[...]」で囲むこと。該当しない語(冠詞・前置詞・接続詞・修飾語など)はそのまま前後に書く。1つの文にS・V・O・Cが複数ある場合はすべて囲むこと。

次の行: ■意訳 とだけ書く。
次の行: 完成文の自然な日本語訳(直訳ではなく意味の通った訳)を、意味のまとまりごとに「/」で区切って書く。

次の行: ■選択肢 とだけ書く。
続けて、すべての選択肢(A)(B)(C)(D)を1行ずつ、必ず▲から始めて日本語訳を書く。

次の行: ■根拠・解説 とだけ書く。
続けて、必ず最初の文で「正解は(X)です。」と正解の記号を明記し、なぜ正解が正しく他の選択肢が誤りなのかを文法・語彙の観点から説明する。

最後の行: ★知らないと解けない要素 に続けて、この問題を解くために知っておく必要がある文法・語彙・表現を1〜2行で書く。

出力は必ず次のJSON形式のみを返し、説明文やコードフェンスは一切含めないこと。
{
  "explainText": "上記ルールに従ったプレーンテキスト。■と★の行は単独の見出し行にし、選択肢の行は必ず▲から始めること。SVOCの行はS[...]/V[...]/O[...]/C[...]の記法をそのまま使うこと。Markdown記号(**など)は使わないこと。",
  "keyPhraseQuotes": []
}`;
const EXPLAIN_PROMPT_PART5_VERSION = 'v2';

async function getRichExplanation(cacheKey, questionText, promptOverride, versionOverride) {
  const prompt = promptOverride || EXPLAIN_PROMPT_READING;
  const version = versionOverride || EXPLAIN_PROMPT_READING_VERSION;
  const lsKey = 'toeicRichExplain.' + version + '.' + cacheKey;
  const cached = localStorage.getItem(lsKey);
  if (cached) return cached;
  const outText = await callGemini(prompt, questionText, { responseMimeType: 'application/json', maxOutputTokens: 2048 });
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

    // Part5のSVOC行: S[...]/V[...]/O[...]/C[...] という記法を、下線+右下に
    // S/V/O/Cラベルを添えた表示に変換する。
    escaped = escaped.replace(/([SVOC])\[([^\]]+)\]/g, (m, label, word) =>
      `<span style="text-decoration:underline;text-decoration-color:#2f5fa8;text-underline-offset:3px;">${word}</span><sub style="color:#2f5fa8;font-weight:700;font-size:9px;">${label}</sub>`
    );

    let inner = escaped;
    if (prefix === 'bold') inner = `<strong>${escaped}</strong>`;
    else if (prefix === 'red-bold') inner = `<strong style="color:#c1503f">${escaped}</strong>`;
    else if (prefix === 'blue') inner = `<span style="color:#2f5fa8;font-weight:600">${escaped}</span>`;
    return `<div>${inner}</div>`;
  }).join('');
}

function correctBannerHtml(isCorrect) {
  return isCorrect
    ? '<div><strong style="color:#2f9e4f">正解です!</strong></div><div><br></div>'
    : '<div><strong style="color:#c1503f">不正解です。</strong></div><div><br></div>';
}

// Part1/2はAIを呼ばず、あらかじめ用意された正解・和訳データからその場で
// formatRichExplainHtml用のマークアップ文字列を組み立てて装飾する(選択肢の和訳を▲青字、
// 見出しを■太字、正解/不正解バナーを別途付与)。
function buildP12ExplainHtml(q, isPart1, choiceTexts, jaTexts, letters, selectedLetter) {
  let markup = '';
  if (!isPart1) {
    markup += `■設問文\n${q.question}\n（${q.questionJa || ''}）\n\n`;
  }
  markup += '■選択肢\n';
  markup += letters.map(l => `▲(${l}) ${choiceTexts[l] || ''}\n　　${jaTexts[l] || ''}`).join('\n') + '\n\n';
  markup += `■根拠・解説\n正解は(${q.answer})です。\n${q.explanation || ''}`;
  return correctBannerHtml(selectedLetter === q.answer) + formatRichExplainHtml(markup, []);
}

// ---------- Part6/7用の簡易チャンク翻訳(decode-toeicの直訳表示のスコープを絞った版) ----------

const TRANSLATE_PROMPT = `あなたは英語学習者向けの解析エンジンです。与えられた英文全体を解析してください。
1) 最初の1文字から最後の1文字まで省略せず、意味のまとまり(チャンク)ごとに分割し、各チャンクに英語の語順のまま前から順番に理解できる「直訳調」の日本語訳を付けてください(自然な日本語の語順に並べ替えないこと)。1チャンクの目安は英単語3〜8語程度です(1文をまるごと1つのチャンクにしないこと)。
2) 各チャンクの中にTOEIC頻出の単語・熟語・言い回しがあれば、その語句を一字一句原文のまま抜き出し、keyTermsに追加してください(該当が無いチャンクではkeyTermsを空配列にする)。
3) 原文中でそのチャンクの直後に改行(\\n)がある場合(会話の話者交代や段落の変わり目など)は、そのチャンクに "lineBreak": true を付けてください(改行が無ければ省略またはfalseでよい)。
4) 英文全体の、自然な日本語の語順・言い回しでの意訳(naturalJa)も作成してください。原文の改行位置に対応する箇所には、必ず\\nを入れて改行を再現すること。
出力は必ず次のJSON形式のみを返し、説明文やコードフェンスは一切含めないこと。
{
  "segments": [
    { "en": "原文チャンク(原文から一字一句変えずに抜粋)", "ja": "直訳調の日本語訳チャンク", "keyTerms": [{"term":"抜き出した語句(原文表記のまま)","meaning":"意味(短く)"}], "lineBreak": true }
  ],
  "naturalJa": "英文全体の自然な日本語訳(改行を\\nで保持する)"
}
segmentsの"en"を出現順にそのまま連結すると、空白の増減を除いて原文と完全に一致するようにしてください。`;

const TRANSLATE_PROMPT_VERSION = 'v4';

// AIが返すlineBreakは「ピリオドの直後」など原文に無い位置でもtrueを付けがちで、
// EN/JA両カラムの改行位置がずれる原因になる。原文中の実際の改行位置とチャンクの
// 出現位置を突き合わせて、lineBreakをこちら側で確定し直す(AIの判断は信用しない)。
function reconcileLineBreaks(segments, sourceText) {
  if (!sourceText) return segments;
  let cursor = 0;
  return segments.map(seg => {
    const idx = sourceText.indexOf(seg.en, cursor);
    if (idx === -1) return { ...seg, lineBreak: false };
    let i = idx + seg.en.length;
    cursor = i;
    while (i < sourceText.length && (sourceText[i] === ' ' || sourceText[i] === '\t')) i++;
    return { ...seg, lineBreak: sourceText[i] === '\n' };
  });
}

async function getTranslationChunks(cacheKey, text, forceRefresh) {
  const lsKey = 'toeicTranslate.' + TRANSLATE_PROMPT_VERSION + '.' + cacheKey;
  const cached = !forceRefresh && localStorage.getItem(lsKey);
  if (cached) return JSON.parse(cached);
  const outText = await callGemini(TRANSLATE_PROMPT, text, { responseMimeType: 'application/json', maxOutputTokens: 4096 });
  let parsed;
  try { parsed = JSON.parse(outText); } catch (e) { throw new Error('翻訳結果の解析に失敗しました'); }
  const segments = reconcileLineBreaks(Array.isArray(parsed.segments) ? parsed.segments : [], text);
  const result = { segments, naturalJa: parsed.naturalJa || '' };
  try { localStorage.setItem(lsKey, JSON.stringify(result)); } catch (e) { /* 保存容量オーバー等は無視 */ }
  return result;
}

// 解説画面で既に「翻訳」を押していれば、その意訳(naturalJa)をシャドーイング画面の
// 日本語訳としてそのまま使い回す(新たにAIを呼ばない)。未翻訳ならnullを返す。
function getCachedNaturalJa(cacheKey) {
  try {
    const raw = localStorage.getItem('toeicTranslate.' + TRANSLATE_PROMPT_VERSION + '.' + cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed.naturalJa || null;
  } catch (e) { return null; }
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

// 単語ポップアップから「用語を解説」した際に呼ぶ。意味だけでなく、その語(または熟語)の
// コアイメージと、熟語・言い回しなら由来・成り立ちまで踏み込んで解説する。
const TERM_EXPLAIN_PROMPT = `あなたはTOEIC満点を何度も取得し、初心者指導歴20年以上の英語講師です。
入力される「語句」(単語または熟語・言い回し)と、それが使われている「文脈」の英文について、日本語で解説してください。
必ず次の構成で、装飾やMarkdown記号(**など)は使わず、プレーンテキストで簡潔に(全体で4〜6行程度)出力してください。

1行目: ■語句 に続けて、この文脈での意味を書く。
次の行: ▲コアイメージ に続けて、この語・表現が持つ中心的なイメージ・語感を短く説明する。単語1つの場合でも、その語源的な核となるイメージを書くこと。
次の行以降: 熟語・イディオム・言い回しの場合は、なぜその単語の組み合わせでその意味になるのか、由来や成り立ちを1〜2行で説明する。単純な基本単語の場合はこの行を省略してよい。`;

async function getTermExplanation(term, meaning, contextSentence) {
  const input = `語句: ${term}\n簡易な意味: ${meaning || '(不明)'}\n文脈: ${contextSentence || ''}`;
  return await callGemini(TERM_EXPLAIN_PROMPT, input, { maxOutputTokens: 600 });
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

// ヘッダーの「保存」ボタン用: ノート欄は(翻訳結果・解説と違ってAIキャッシュの対象外なので)
// 明示的に保存しないと消えてしまう。保存時点で画面上に存在するノート欄をすべて
// cacheKeyごとにlocalStorageへ書き出し、Apps Script URLが設定されていればスプレッドシートへも
// 同期する(decode-toeicと同じApps Script Web Appブリッジ方式)。次にその問題/パッセージを
// 開いたときは、まずスプレッドシート側のキャッシュ→無ければlocalStorageの順に復元する。
const NOTES_LS_PREFIX = 'toeicOfficialPractice.notes.';

let sheetNotesCachePromise = null;
function getSheetNotesCache() {
  if (!sheetNotesCachePromise) {
    const url = getSheetUrl();
    sheetNotesCachePromise = !url
      ? Promise.resolve({})
      : fetch(`${url}?action=getNotes`).then(r => r.json()).then(d => d.notes || {}).catch(() => ({}));
  }
  return sheetNotesCachePromise;
}

async function restoreNotesIfSaved(notesArea, cacheKey) {
  notesArea.dataset.notesKey = cacheKey;
  try {
    const sheetNotes = await getSheetNotesCache();
    if (sheetNotes[cacheKey]) { notesArea.innerHTML = sheetNotes[cacheKey]; return; }
  } catch (e) { /* ignore */ }
  try {
    const saved = localStorage.getItem(NOTES_LS_PREFIX + cacheKey);
    if (saved) notesArea.innerHTML = saved;
  } catch (e) { /* ignore */ }
}

async function saveAllVisibleNotes() {
  const areas = document.querySelectorAll('.notes-area[data-notes-key]');
  const notesMap = {};
  areas.forEach(area => {
    notesMap[area.dataset.notesKey] = area.innerHTML;
    try { localStorage.setItem(NOTES_LS_PREFIX + area.dataset.notesKey, area.innerHTML); } catch (e) { /* 保存容量オーバー等は無視 */ }
  });
  const count = areas.length;
  const url = getSheetUrl();
  if (url && count > 0) {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'saveNotes', notes: notesMap })
      });
      const cache = await getSheetNotesCache();
      Object.assign(cache, notesMap);
    } catch (e) { /* オフライン等は無視。localStorageには保存済み */ }
  }
  return count;
}

// シャドーイング画面・各Partの解説画面で共通に使う、自由記述のノート欄。
// noteKeyが同じであれば同じ内容を共有する(例: シャドーイングと解説画面で同じノート)。
function buildNotesWidget(noteKey, label) {
  const wrap = document.createElement('div');
  wrap.className = 'notes-wrap';
  const lbl = document.createElement('div');
  lbl.className = 'notes-label';
  lbl.textContent = label || 'ノート(自由に書き込めます)';
  const area = document.createElement('div');
  area.className = 'notes-area';
  area.contentEditable = 'true';
  wrap.appendChild(lbl);
  wrap.appendChild(area);
  restoreNotesIfSaved(area, noteKey);
  return wrap;
}

// ---------- 解説画面の「AIに質問する」欄 ----------

const ASK_AI_PROMPT = `あなたはTOEIC対策の講師です。以下の問題とその解説を踏まえて、学習者からの追加の質問に日本語で分かりやすく答えてください。
装飾やMarkdown記号(**など)は使わず、プレーンテキストで簡潔に答えてください。`;

async function askAiAboutQuestion(questionContext, userQuestion) {
  const input = `【問題】\n${questionContext}\n\n【学習者からの質問】\n${userQuestion}`;
  return await callGemini(ASK_AI_PROMPT, input, { maxOutputTokens: 800 });
}

// questionContextは、その設問の問題文・選択肢・正解などを含むプレーンテキスト
// (getRichExplanationに渡しているquestionTextと同じもので良い)。
function buildAskAiWidget(questionContext) {
  const wrap = document.createElement('div');
  wrap.className = 'ask-ai-wrap';
  const label = document.createElement('div');
  label.className = 'notes-label';
  label.textContent = 'AIに質問する';
  wrap.appendChild(label);

  const row = document.createElement('div');
  row.className = 'ask-ai-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'ask-ai-input';
  input.placeholder = '例: なぜBは不正解なんですか？';
  const btn = document.createElement('button');
  btn.className = 'mode-toggle-btn';
  btn.textContent = '質問する';
  row.appendChild(input);
  row.appendChild(btn);
  wrap.appendChild(row);

  const answerArea = document.createElement('div');
  answerArea.className = 'ask-ai-answer';
  answerArea.style.display = 'none';
  wrap.appendChild(answerArea);

  async function ask() {
    const q = input.value.trim();
    if (!q) return;
    btn.disabled = true;
    btn.textContent = '質問中...';
    answerArea.style.display = 'block';
    answerArea.textContent = '回答を生成中...';
    try {
      answerArea.textContent = await askAiAboutQuestion(questionContext, q);
    } catch (e) {
      answerArea.textContent = '回答の取得に失敗しました: ' + e.message;
    }
    btn.disabled = false;
    btn.textContent = '質問する';
  }
  btn.addEventListener('click', ask);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') ask(); });

  return wrap;
}

const chunkPopupEl = document.createElement('div');
chunkPopupEl.className = 'chunk-popup';
document.body.appendChild(chunkPopupEl);
document.addEventListener('click', e => {
  if (!chunkPopupEl.contains(e.target) && !e.target.closest('.chunk-seg') && !e.target.closest('.translate-col-ja')) {
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
      if (!t || termTrigger.dataset.loading === '1') return;
      termTrigger.dataset.loading = '1';
      const strongEl = termTrigger.querySelector('strong');
      const originalLabel = strongEl.textContent;
      strongEl.textContent = originalLabel + '(解説中...)';
      try {
        const explanation = await getTermExplanation(t.term, t.meaning, seg.en);
        appendToNotes(notesArea, t.term, explanation);
        strongEl.textContent = originalLabel;
        termTrigger.classList.add('added');
      } catch (err) {
        strongEl.textContent = originalLabel + '(解説の取得に失敗しました)';
        termTrigger.dataset.loading = '0';
      }
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

// decode-toeicと同じ操作方式: マウスホイールの上下でハイライト位置(curSeg)が
// EN/JA両カラム同時に動く(実際のカーソル位置とは無関係)。直訳(JA)側は現在位置でも
// クリックされるまで背景色=文字色(var(--text))で塗りつぶして読めなくし、クリックで
// EN側と同じアクセント色にめくれて読めるようになる(単語帳・自己テスト的な体験)。
function renderTranslationChunks(container, segments, notesArea) {
  container.innerHTML = '';
  let curSeg = -1;

  const wideWrap = document.createElement('div');
  wideWrap.className = 'translate-wide';
  const enCol = document.createElement('div');
  enCol.className = 'translate-col translate-col-en';
  const jaCol = document.createElement('div');
  jaCol.className = 'translate-col translate-col-ja';

  const jaSpans = [];
  segments.forEach((seg, i) => {
    const enSpan = document.createElement('span');
    enSpan.className = 'chunk-seg';
    enSpan.dataset.seg = i;
    enSpan.textContent = seg.en + ' ';
    const jaSpan = document.createElement('span');
    jaSpan.className = 'chunk-seg';
    jaSpan.dataset.seg = i;
    jaSpan.textContent = seg.ja + ' ';
    enCol.appendChild(enSpan);
    jaCol.appendChild(jaSpan);
    jaSpans.push(jaSpan);
    if (seg.lineBreak) {
      enCol.appendChild(document.createElement('br'));
      jaCol.appendChild(document.createElement('br'));
    }
  });

  function setSeg(i) {
    i = Math.max(0, Math.min(segments.length - 1, i));
    if (i === curSeg) return;
    const wasInit = curSeg < 0;
    wideWrap.querySelectorAll('.chunk-seg.seg-hover').forEach(n => n.classList.remove('seg-hover'));
    wideWrap.querySelectorAll('.chunk-seg.seg-revealed').forEach(n => n.classList.remove('seg-revealed'));
    curSeg = i;
    const hovered = wideWrap.querySelectorAll(`.chunk-seg[data-seg="${i}"]`);
    hovered.forEach(n => n.classList.add('seg-hover'));
    if (hovered[0] && !wasInit) hovered[0].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function revealCurrent() {
    if (curSeg < 0) return;
    if (jaSpans[curSeg].classList.contains('seg-revealed')) {
      // もう一度クリック: ポップアップを閉じ、ハイライトも黒塗りに戻す
      wideWrap.querySelectorAll(`.chunk-seg[data-seg="${curSeg}"]`).forEach(n => n.classList.remove('seg-revealed'));
      chunkPopupEl.classList.remove('show');
      return;
    }
    wideWrap.querySelectorAll(`.chunk-seg[data-seg="${curSeg}"]`).forEach(n => n.classList.add('seg-revealed'));
    showChunkPopup(segments[curSeg], jaSpans[curSeg], notesArea);
  }

  wideWrap.addEventListener('wheel', e => {
    e.preventDefault();
    setSeg((curSeg < 0 ? 0 : curSeg) + (e.deltaY > 0 ? 1 : -1));
  }, { passive: false });
  jaCol.addEventListener('click', revealCurrent);

  wideWrap.appendChild(enCol);
  wideWrap.appendChild(jaCol);
  container.appendChild(wideWrap);
  setSeg(0);
}

// 解説画面用の翻訳ウィジェット:「翻訳」ボタンで開き、直訳(チャンク表示)⇄意訳の
// 切り替え、ワイド/トールモード、クリックしたチャンクの解説をノートへ書き写す機能を持つ。
// 問題文の原文表示そのものを、decode-toeicの英文貼り付け欄のように
// 「翻訳」ボタン1つでチャンク訳のワイド表示に置き換えるウィジェット。
function buildTranslatableBlock(text, cacheKey) {
  const wrap = document.createElement('div');
  wrap.className = 'translate-block';

  // 常設の操作バー: 翻訳⇄原文表示に戻す / 翻訳を再取得 / ワイドモード / トールモード / ◀ 直訳・意訳 ▶
  // を1列に並べる。翻訳前は再取得・表示切り替え系のボタンは無効化しておく。
  const controls = document.createElement('div');
  controls.className = 'translate-controls';

  const btn = document.createElement('button');
  btn.className = 'audio-btn';
  btn.textContent = '翻訳';
  controls.appendChild(btn);

  const refetchBtn = document.createElement('button');
  refetchBtn.className = 'mode-toggle-btn';
  refetchBtn.textContent = '翻訳を再取得';
  refetchBtn.disabled = true;
  controls.appendChild(refetchBtn);

  const wideBtn = document.createElement('button');
  wideBtn.className = 'mode-toggle-btn';
  wideBtn.disabled = true;
  controls.appendChild(wideBtn);

  const tallBtn = document.createElement('button');
  tallBtn.className = 'mode-toggle-btn';
  tallBtn.disabled = true;
  controls.appendChild(tallBtn);

  const modeLeftBtn = document.createElement('button');
  modeLeftBtn.className = 'mode-toggle-btn edge-nav-btn';
  modeLeftBtn.textContent = '◀';
  modeLeftBtn.disabled = true;
  controls.appendChild(modeLeftBtn);

  const modeLabel = document.createElement('span');
  modeLabel.className = 'translate-mode-label';
  controls.appendChild(modeLabel);

  const modeRightBtn = document.createElement('button');
  modeRightBtn.className = 'mode-toggle-btn edge-nav-btn';
  modeRightBtn.textContent = '▶';
  modeRightBtn.disabled = true;
  controls.appendChild(modeRightBtn);

  wrap.appendChild(controls);

  const box = document.createElement('div');
  box.className = 'doc-box translate-box';
  box.textContent = text;
  wrap.appendChild(box);

  let loaded = false;
  let showing = false;
  let data = null;
  let mode = 'literal'; // 'literal' | 'natural'
  let wide = false; // デフォルトで通常モード
  let tall = false;

  function refreshModeUI() {
    wideBtn.textContent = wide ? '⛶ ワイド解除' : '⛶ ワイドモード';
    tallBtn.textContent = tall ? '⬍ トール解除' : '⬍ トールモード';
    modeLabel.textContent = mode === 'literal' ? '直訳' : '意訳';
  }
  refreshModeUI();

  function setControlsEnabled(enabled) {
    [refetchBtn, wideBtn, tallBtn, modeLeftBtn, modeRightBtn].forEach(b => b.disabled = !enabled);
  }

  function renderChunkView() {
    box.innerHTML = '';
    box.classList.toggle('wide-mode', wide);
    box.classList.toggle('tall-mode', tall);

    const chunkContainer = document.createElement('div');
    box.appendChild(chunkContainer);

    const naturalContainer = document.createElement('div');
    naturalContainer.className = 'natural-ja-box';
    box.appendChild(naturalContainer);

    const notesWrap = document.createElement('div');
    notesWrap.className = 'notes-wrap';
    const notesLabel = document.createElement('div');
    notesLabel.className = 'notes-label';
    notesLabel.textContent = 'ノート(単語や文をクリックすると意味・解説が書き写されます。自由に編集もできます)';
    const notesArea = document.createElement('div');
    notesArea.className = 'notes-area';
    notesArea.contentEditable = 'true';
    notesWrap.appendChild(notesLabel);
    notesWrap.appendChild(notesArea);
    box.appendChild(notesWrap);
    restoreNotesIfSaved(notesArea, cacheKey);

    function updateModeDisplay() {
      chunkContainer.style.display = mode === 'literal' ? 'block' : 'none';
      naturalContainer.style.display = mode === 'natural' ? 'block' : 'none';
    }

    modeLeftBtn.onclick = () => { mode = mode === 'literal' ? 'natural' : 'literal'; refreshModeUI(); updateModeDisplay(); };
    modeRightBtn.onclick = () => { mode = mode === 'literal' ? 'natural' : 'literal'; refreshModeUI(); updateModeDisplay(); };
    wideBtn.onclick = () => { wide = !wide; box.classList.toggle('wide-mode', wide); refreshModeUI(); };
    tallBtn.onclick = () => { tall = !tall; box.classList.toggle('tall-mode', tall); refreshModeUI(); };

    renderTranslationChunks(chunkContainer, data.segments, notesArea);
    naturalContainer.textContent = data.naturalJa || '';
    updateModeDisplay();
  }

  function renderPlain() {
    box.className = 'doc-box translate-box';
    box.innerHTML = '';
    box.textContent = text;
  }

  async function doTranslate(forceRefresh) {
    btn.disabled = true;
    btn.textContent = forceRefresh ? '再取得中...' : '翻訳中...';
    try {
      data = await getTranslationChunks(cacheKey, text, forceRefresh);
      loaded = true;
    } catch (e) {
      btn.disabled = false;
      btn.textContent = showing ? '原文表示に戻す' : '翻訳';
      box.innerHTML = `<p class="translate-error">翻訳に失敗しました: ${escapeHtml(e.message)}</p>`;
      return false;
    }
    btn.disabled = false;
    return true;
  }

  btn.addEventListener('click', async () => {
    if (!showing) {
      if (!loaded && !(await doTranslate(false))) return;
      renderChunkView();
      btn.textContent = '原文表示に戻す';
      showing = true;
      setControlsEnabled(true);
    } else {
      renderPlain();
      btn.textContent = '翻訳';
      showing = false;
      setControlsEnabled(false);
    }
  });

  refetchBtn.addEventListener('click', async () => {
    if (!(await doTranslate(true))) return;
    if (showing) renderChunkView();
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

// トラックのクリック/ドラッグでシーク移動できるようにする。getAudio()は現在の
// Audioインスタンス(未再生ならnull)を返す関数。
function attachSeekable(trackEl, getAudio) {
  function seekToClientX(clientX) {
    const audio = getAudio();
    if (!audio || !audio.duration) return;
    const rect = trackEl.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
  }
  let dragging = false;
  trackEl.addEventListener('mousedown', e => { dragging = true; seekToClientX(e.clientX); });
  window.addEventListener('mousemove', e => { if (dragging) seekToClientX(e.clientX); });
  window.addEventListener('mouseup', () => { dragging = false; });
}

// Part1/2/3/4の問題画面用の常設プレーヤー(シャドーイングと同じ▶/❚❚+進捗バー表示)。
// 「音声を再生」ボタンを押して初めてプレーヤーが現れる、という中間ステップを無くし、
// 最初からこの表示のままにする。filenamesは複数渡すと連続再生する(Part3/4の会話→設問)。
function createAudioPlayerWidget(filenames, { autoplay = false } = {}) {
  const list = (Array.isArray(filenames) ? filenames : [filenames]).filter(Boolean);
  let currentAudio = null;

  const player = document.createElement('div');
  player.className = 'audio-player';
  const restartBtn = document.createElement('button');
  restartBtn.className = 'player-restart';
  restartBtn.textContent = '⏮';
  restartBtn.title = '初めから再生';
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'player-toggle';
  toggleBtn.textContent = '▶';
  // 複数トラック(問題文→設問)の場合のみ、問題文だけを繰り返し再生するボタンを出す。
  let loopFirst = false;
  const loopBtn = document.createElement('button');
  loopBtn.className = 'player-loop';
  loopBtn.textContent = '🔁';
  loopBtn.title = '問題文を繰り返し再生';
  loopBtn.addEventListener('click', () => {
    loopFirst = !loopFirst;
    loopBtn.classList.toggle('active', loopFirst);
  });
  const curTimeEl = document.createElement('span');
  curTimeEl.className = 'player-time';
  curTimeEl.textContent = '0:00';
  const trackEl = document.createElement('div');
  trackEl.className = 'player-track';
  const fillEl = document.createElement('div');
  fillEl.className = 'player-fill';
  trackEl.appendChild(fillEl);
  const totalTimeEl = document.createElement('span');
  totalTimeEl.className = 'player-time';
  totalTimeEl.textContent = '0:00';
  player.appendChild(restartBtn);
  player.appendChild(toggleBtn);
  if (list.length > 1) player.appendChild(loopBtn);
  player.appendChild(curTimeEl);
  player.appendChild(trackEl);
  player.appendChild(totalTimeEl);
  if (!list.length) player.style.display = 'none';
  attachSeekable(trackEl, () => currentAudio);

  function resetUI() {
    toggleBtn.textContent = '▶';
    fillEl.style.width = '0%';
    curTimeEl.textContent = '0:00';
  }

  function attachEvents(audio) {
    audio.addEventListener('loadedmetadata', () => { totalTimeEl.textContent = formatPlayerTime(audio.duration); });
    audio.addEventListener('timeupdate', () => {
      curTimeEl.textContent = formatPlayerTime(audio.currentTime);
      if (audio.duration) fillEl.style.width = Math.min(100, (audio.currentTime / audio.duration) * 100) + '%';
    });
  }

  async function playIndex(i) {
    if (i >= list.length) { currentAudio = null; resetUI(); return; }
    toggleBtn.disabled = true;
    const url = await getAudioUrl(list[i]);
    toggleBtn.disabled = false;
    if (!url) return;
    currentAudio = new Audio(url);
    attachEvents(currentAudio);
    currentAudio.addEventListener('ended', () => {
      if (i === 0 && loopFirst) playIndex(0);
      else playIndex(i + 1);
    });
    currentAudio.play();
    toggleBtn.textContent = '❚❚';
  }

  function playFromStart() {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    resetUI();
    playIndex(0);
  }

  toggleBtn.addEventListener('click', () => {
    if (currentAudio && !currentAudio.paused) {
      currentAudio.pause();
      toggleBtn.textContent = '▶';
    } else if (currentAudio) {
      currentAudio.play();
      toggleBtn.textContent = '❚❚';
    } else {
      playFromStart();
    }
  });
  restartBtn.addEventListener('click', () => playFromStart());

  if (autoplay && list.length) playFromStart();

  return player;
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
// 各キーは {count, lastCorrect} で保持する(以前はcountだけの数値だったので、
// 古い数値形式が残っていても壊れないように読み替える)。
function getAttemptEntry(key) {
  const raw = getAttemptsStore()[key];
  if (raw == null) return { count: 0, lastCorrect: null };
  if (typeof raw === 'number') return { count: raw, lastCorrect: null };
  return { count: raw.count || 0, lastCorrect: raw.lastCorrect == null ? null : !!raw.lastCorrect };
}
function getAttemptCount(key) {
  return getAttemptEntry(key).count;
}
function incrementAttempt(key, isCorrect) {
  const store = getAttemptsStore();
  const prev = getAttemptEntry(key);
  store[key] = { count: Math.min(99, prev.count + 1), lastCorrect: isCorrect == null ? prev.lastCorrect : !!isCorrect };
  localStorage.setItem(ATTEMPTS_LS, JSON.stringify(store));
  recordStudyActivity();
}
function setAttemptCount(key, value) {
  const store = getAttemptsStore();
  const prev = getAttemptEntry(key);
  store[key] = { count: Math.max(0, Math.min(99, value)), lastCorrect: prev.lastCorrect };
  localStorage.setItem(ATTEMPTS_LS, JSON.stringify(store));
}
// Part6/7では挑戦回数(count)はパッセージ単位で共有するが、正誤の色分けは設問
// ごとに分けたいので、countには触れずlastCorrectだけを別キーに記録する。
function recordCorrectness(key, isCorrect) {
  const store = getAttemptsStore();
  const prev = getAttemptEntry(key);
  store[key] = { count: prev.count, lastCorrect: !!isCorrect };
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

// 経過時間だけを加算する(採点回数=dayCountsは増やさない)。解説を読んでいる間などの
// 受動的な時間も学習時間に含めるための定期ハートビートから呼ばれる。
function recordStudyTime() {
  const log = getStudyLog();
  const now = Date.now();
  const dateKey = localDateKey();
  if (log.lastActivity && (now - log.lastActivity) < STUDY_GAP_MS) {
    const elapsed = Math.round((now - log.lastActivity) / 1000);
    log.totalSeconds += elapsed;
    log.daySeconds[dateKey] = (log.daySeconds[dateKey] || 0) + elapsed;
  }
  log.lastActivity = now;
  localStorage.setItem(STUDY_LOG_LS, JSON.stringify(log));
  return log;
}

function recordStudyActivity() {
  const log = recordStudyTime();
  const dateKey = localDateKey();
  log.dayCounts[dateKey] = (log.dayCounts[dateKey] || 0) + 1;
  localStorage.setItem(STUDY_LOG_LS, JSON.stringify(log));
}

// 解説を読んでいるだけの時間も学習時間に含めるため、練習画面が表示されている間は
// 1分おきに経過時間を加算する(採点イベントの間隔だけに頼らない)。
setInterval(() => {
  if (document.visibilityState === 'visible' && practiceEl && practiceEl.style.display !== 'none') {
    recordStudyTime();
  }
}, 60000);

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

// Part1/2/6/7は1ユニット=1行(単一のkey)。Part3/4/5は複数問題が1ユニットにまとまって
// 採点されるが、挑戦回数メーターは問題ごとに個別表示したいので、questions配列を持つ
// 「グループユニット」として返す(buildGroupedUnitRowで括弧付きの個別行として描画する)。
function buildUnitList(test, part, data) {
  if (part === 1 || part === 2) {
    return data.questions.map((q, i) => ({ key: `${test}-${part}-${q.number}`, label: `Q${q.number}`, unitIndex: i }));
  }
  if (part === 3 || part === 4) {
    return data.groups.map((g, i) => ({
      unitIndex: i,
      questions: g.questions.map(qn => ({ number: qn, key: `${test}-${part}-${qn}` }))
    }));
  }
  if (part === 5) {
    return chunk(data.questions, 5).map((b, i) => ({
      unitIndex: i,
      questions: b.map(q => ({ number: q.number, key: `${test}-5-${q.number}` }))
    }));
  }
  // Part6/7は採点(挑戦回数の記録)がパッセージ単位でまとめて行われるため、
  // 個々の設問番号を括弧内に個別表示しつつ、挑戦回数の数字はパッセージ単位の
  // 共有キーを使う。一方、正誤の色分けだけは設問ごとに分けたいので、色用に
  // 別キー(colorKey)を持たせ、buildMeterElで数字と色を別々のキーから読む。
  return data.passages.map((p, i) => ({
    unitIndex: i,
    label: p.topic || '',
    questions: p.questions.map(qn => ({
      number: qn,
      key: `${test}-${part}-${p.questions[0]}`,
      colorKey: `${test}-${part}-${qn}-correct`
    }))
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
    p12 = { groupStart, qIdx: unitIndex - groupStart, phase: 'question', selected: null };
  } else if (part === 3 || part === 4) {
    p34 = { groupIdx: unitIndex, phase: 'question', selections: {} };
  } else if (part === 5) {
    state.index = unitIndex;
  } else {
    p67 = { idx: unitIndex, phase: 'question', selections: {} };
  }
  renderPractice();
}

// 現在のPartが終わったときの「次のPartへ」導線。ランディングのプルダウンはもう
// 存在しないので、メッセージだけでなく直接ジャンプできるボタンを添える。
async function jumpToNextPart() {
  let nextPart = state.part + 1;
  let nextTest = state.test;
  if (nextPart > 7) { nextPart = 1; nextTest = state.test === 'T1' ? 'T2' : null; }
  if (!nextTest) {
    practiceBodyEl.innerHTML = '<p>お疲れ様でした。すべてのPartが終了しました。</p>';
    return;
  }
  await jumpToUnit(nextTest, nextPart, 0);
}

function showPartComplete() {
  const wrap = document.createElement('div');
  const p = document.createElement('p');
  p.textContent = 'このPartは終了です。';
  wrap.appendChild(p);
  const btn = document.createElement('button');
  btn.className = 'grade-btn';
  btn.textContent = '次のPartへ';
  btn.addEventListener('click', () => jumpToNextPart());
  wrap.appendChild(btn);
  practiceBodyEl.innerHTML = '';
  practiceBodyEl.appendChild(wrap);
}

// 挑戦回数メーター(最大10段階の四角+数字+-/+ボタン)。直近の採点が正解なら緑、
// 不正解なら赤で塗る。Part1/2/6/7の単一行にも、Part3/4/5の個別問題行にも使う。
function buildMeterEl(key, colorKey) {
  if (colorKey === undefined) colorKey = key;
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

  const MAX_DOTS = 5;
  function refreshMeter() {
    const { count } = getAttemptEntry(key);
    const { lastCorrect } = getAttemptEntry(colorKey);
    dotsWrap.innerHTML = '';
    const colorClass = lastCorrect === false ? ' wrong' : ' correct';
    for (let i = 0; i < MAX_DOTS; i++) {
      const dot = document.createElement('span');
      dot.className = 'meter-dot' + (i < Math.min(count, MAX_DOTS) ? ' filled' + colorClass : '');
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
    setAttemptCount(key, getAttemptCount(key) - 1);
    refreshMeter();
  });
  plusBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    setAttemptCount(key, getAttemptCount(key) + 1);
    refreshMeter();
  });

  meter.appendChild(minusBtn);
  meter.appendChild(dotsWrap);
  meter.appendChild(countEl);
  meter.appendChild(plusBtn);
  return meter;
}

// 1行1ユニット: リンク(ジャンプ)+挑戦回数メーター。
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
  row.appendChild(buildMeterEl(u.key));

  container.appendChild(row);
}

// Part3/4/5用: 1ユニット(まとめて採点される複数問題)を、括弧でグループ化しつつ
// 問題番号ごとの個別行(個別メーター)として描画する。どの問題番号をクリックしても
// 同じユニット(セット全体)にジャンプする。
function buildGroupedUnitRow(container, u, onJump) {
  const group = document.createElement('div');
  group.className = 'unit-group';
  if (u.label) {
    const labelEl = document.createElement('div');
    labelEl.className = 'unit-group-label';
    labelEl.textContent = u.label.toUpperCase();
    group.appendChild(labelEl);
  }
  u.questions.forEach(q => {
    const row = document.createElement('div');
    row.className = 'unit-row';
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'unit-link';
    a.textContent = `Q${q.number}`;
    a.addEventListener('click', e => {
      e.preventDefault();
      onJump();
    });
    row.appendChild(a);
    row.appendChild(buildMeterEl(q.key, q.colorKey));
    group.appendChild(row);
  });
  container.appendChild(group);
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
        const grouped = part === 3 || part === 4 || part === 5 || part === 6 || part === 7;
        // 縦に2列(左列を上から埋めてから右列)で並べるため、ここでJS側で
        // 半分に分割して2つの列コンテナに振り分ける(CSS column-countは
        // display:flex等と組み合わさると列数が崩れるため使わない)。
        const colLeft = document.createElement('div');
        colLeft.className = 'landing-col';
        const colRight = document.createElement('div');
        colRight.className = 'landing-col';
        unitsDiv.appendChild(colLeft);
        unitsDiv.appendChild(colRight);
        const half = Math.ceil(units.length / 2);
        units.forEach((u, i) => {
          const col = i < half ? colLeft : colRight;
          if (grouped) buildGroupedUnitRow(col, u, () => jumpToUnit(test, part, u.unitIndex));
          else buildUnitRow(col, u, () => jumpToUnit(test, part, u.unitIndex));
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
  if (state.part === 1 || state.part === 2) {
    if (!p12) return 0;
    // シャドーイング突入時、qIdxはグループの問題数を超えて進む(次のグループへの
    // 移行トリガーを兼ねているため)。その場合は表示上グループ最後の問題番号に丸める。
    const groupLen = Math.min(3, state.data.questions.length - p12.groupStart);
    const qIdx = p12.phase === 'shadowing' ? groupLen - 1 : p12.qIdx;
    return p12.groupStart + qIdx;
  }
  if (state.part === 3 || state.part === 4) return p34 ? p34.groupIdx : 0;
  if (state.part === 5) return state.index;
  return p67 ? p67.idx : 0;
}

// jumpToUnitと違い、既存のp12/p34/p67をその場で書き換えるだけの軽量な移動
// (jumpToUnitはランディングナビからの遠距離ジャンプ用に全リセットする)。
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
  saveAllVisibleNotes();
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
  const restartBtn = document.createElement('button');
  restartBtn.className = 'player-restart';
  restartBtn.textContent = '⏮';
  restartBtn.title = '初めから再生';
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'player-toggle';
  toggleBtn.textContent = '▶';
  const curTimeEl = document.createElement('span');
  curTimeEl.className = 'player-time';
  const trackEl = document.createElement('div');
  trackEl.className = 'player-track';
  const fillEl = document.createElement('div');
  fillEl.className = 'player-fill';
  trackEl.appendChild(fillEl);
  const totalTimeEl = document.createElement('span');
  totalTimeEl.className = 'player-time';
  player.appendChild(restartBtn);
  player.appendChild(toggleBtn);
  player.appendChild(curTimeEl);
  player.appendChild(trackEl);
  player.appendChild(totalTimeEl);
  wrap.appendChild(player);
  attachSeekable(trackEl, () => currentAudio);

  const hintEl = document.createElement('div');
  hintEl.className = 'training-hint';
  hintEl.textContent = 'Spaceキーで最初から再生できます。';
  wrap.appendChild(hintEl);

  const textEl = document.createElement('div');
  textEl.className = 'shadowing-text';
  wrap.appendChild(textEl);

  const jaEl = document.createElement('div');
  jaEl.className = 'shadowing-text-ja';
  wrap.appendChild(jaEl);

  const notesSlot = document.createElement('div');
  wrap.appendChild(notesSlot);

  const nextBtn = document.createElement('button');
  nextBtn.textContent = '次へ';
  nextBtn.style.marginTop = '12px';
  wrap.appendChild(nextBtn);

  function resetPlayerUI() {
    toggleBtn.textContent = '▶';
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
    audio.addEventListener('ended', () => { toggleBtn.textContent = '▶'; fillEl.style.width = '0%'; curTimeEl.textContent = '0:00'; });
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
    toggleBtn.textContent = '❚❚';
  }

  toggleBtn.addEventListener('click', () => {
    if (currentAudio && !currentAudio.paused) {
      currentAudio.pause();
      toggleBtn.textContent = '▶';
    } else if (currentAudio) {
      currentAudio.play();
      toggleBtn.textContent = '❚❚';
    } else {
      playFromStart();
    }
  });
  restartBtn.addEventListener('click', () => playFromStart());

  function render() {
    const item = items[idx];
    title.textContent = `シャドーイング (${idx + 1}/${items.length}) ${item.label || ''}`;
    player.style.display = item.audio ? 'flex' : 'none';
    hintEl.style.display = item.audio ? 'block' : 'none';
    resetPlayerUI();
    textEl.textContent = item.text;
    jaEl.textContent = item.ja || '';
    jaEl.style.display = item.ja ? 'block' : 'none';
    notesSlot.innerHTML = '';
    if (item.noteKey) notesSlot.appendChild(buildNotesWidget(item.noteKey));
    if (item.audio) playFromStart();
  }

  function keyHandler(e) {
    if (e.code === 'Space') { e.preventDefault(); playFromStart(); }
  }
  nextBtn.addEventListener('click', () => {
    saveAllVisibleNotes();
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
  if (!p12) p12 = { groupStart: 0, qIdx: 0, phase: 'question', selected: null };
}

function p12CurrentGroup() {
  return state.data.questions.slice(p12.groupStart, p12.groupStart + 3);
}

// シャドーイングに正解/不正解の情報は不要なので、原文(と設問文)+日本語訳だけを渡す。
function p12BuildShadowingItems(groupQuestions) {
  const isPart1 = state.part === 1;
  return groupQuestions.map(q => {
    const choiceTexts = isPart1 ? q.statements : q.responses;
    const jaTexts = isPart1 ? q.statementsJa : q.responsesJa;
    const letters = Object.keys(choiceTexts);
    let text = '';
    let ja = '';
    if (!isPart1) { text += `${q.question}\n\n`; ja += `${q.questionJa || ''}\n\n`; }
    text += letters.map(l => `(${l}) ${choiceTexts[l]}`).join('\n');
    ja += letters.map(l => `(${l}) ${jaTexts[l] || ''}`).join('\n');
    return { label: `Q${q.number}`, text, ja, audio: q.audio, noteKey: `${state.test}-${state.part}-${q.number}` };
  });
}

function renderPart1or2() {
  saveAllVisibleNotes();
  initP12IfNeeded();
  updateHeaderNav();
  if (p12.phase === 'shadowing') {
    renderShadowing(p12BuildShadowingItems(p12CurrentGroup()), () => {
      p12.groupStart += 3;
      p12.qIdx = 0;
      p12.phase = 'question';
      p12.selected = null;
      if (p12.groupStart >= state.data.questions.length) {
        showPartComplete();
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

  wrap.appendChild(createAudioPlayerWidget(q.audio, { autoplay: true }));

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

  const notesSlot = document.createElement('div');
  wrap.appendChild(notesSlot);
  const askAiSlot = document.createElement('div');
  wrap.appendChild(askAiSlot);

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
      explainDiv.innerHTML = buildP12ExplainHtml(q, isPart1, choiceTexts, jaTexts, letters, p12.selected);
      explainDiv.style.display = 'block';
      const noteKey = `${state.test}-${state.part}-${q.number}`;
      notesSlot.appendChild(buildNotesWidget(noteKey));
      const questionContext = `Q${q.number}\n` + letters.map(l => `(${l}) ${choiceTexts[l]}`).join('\n') + `\n正解: (${q.answer})`;
      askAiSlot.appendChild(buildAskAiWidget(questionContext));
      incrementAttempt(noteKey, p12.selected === q.answer);
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
}

let p34 = null; // { groupIdx, phase, selections }

function initP34IfNeeded() {
  if (!p34) p34 = { groupIdx: 0, phase: 'question', selections: {} };
}

// シャドーイングに正解/不正解の情報は不要なので、原文だけを渡す。日本語訳は、解説画面で
// 既に翻訳済みならそれを再利用する(未翻訳なら空のまま)。
function p34BuildShadowingItems(g) {
  const text = g.items.map(item => `${item.number}. ${item.text}`).join('\n');
  const noteKey = `${state.test}-${state.part}-${g.questions[0]}`;
  const ja = getCachedNaturalJa(noteKey) || '';
  return [{ label: `Q${g.questions[0]}-${g.questions[g.questions.length - 1]}`, text, ja, audio: g.audioQuestions, noteKey }];
}

function renderPart3or4() {
  saveAllVisibleNotes();
  initP34IfNeeded();
  updateHeaderNav();
  const g = state.data.groups[p34.groupIdx];

  if (p34.phase === 'shadowing') {
    renderShadowing(p34BuildShadowingItems(g), () => {
      p34.groupIdx++;
      p34.phase = 'question';
      p34.selections = {};
      if (p34.groupIdx >= state.data.groups.length) {
        showPartComplete();
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
  wrap.appendChild(createAudioPlayerWidget([g.audioConversation || g.audioTalk, g.audioQuestions], { autoplay: true }));
  if (g.graphicImage) {
    const img = document.createElement('img');
    img.src = g.graphicImage;
    img.alt = '図表';
    img.className = 'question-photo';
    wrap.appendChild(img);
  } else if (g.graphic) {
    const gfx = document.createElement('p');
    gfx.className = 'audio-label';
    gfx.textContent = '図表: ' + g.graphic;
    wrap.appendChild(gfx);
  }

  const translateSlot = document.createElement('div');
  translateSlot.style.display = 'none';
  wrap.appendChild(translateSlot);

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

    const askAiSlot = document.createElement('div');
    block.appendChild(askAiSlot);

    blocks[item.number] = { choicesDiv, explainDiv, letters, askAiSlot };
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
        const { explainDiv, askAiSlot } = blocks[item.number];
        const isCorrect = p34.selections[item.number] === item.answer;
        const prefixHtml = correctBannerHtml(isCorrect);
        const questionText = `${item.number}. ${item.text}\n選択肢: ${Object.entries(item.choices).map(([l, txt]) => `(${l}) ${txt}`).join(' ')}\n正解: (${item.answer}) ${item.choices[item.answer]}\nあなたの回答: (${p34.selections[item.number]}) ${item.choices[p34.selections[item.number]]}`;
        let html;
        try {
          html = prefixHtml + await getRichExplanation(`${state.test}-${state.part}-${item.number}-${p34.selections[item.number]}`, questionText);
        } catch (e) {
          html = prefixHtml + `<div>解説の取得に失敗しました: ${escapeHtml(e.message)}</div>`;
        }
        explainDiv.innerHTML = html;
        askAiSlot.appendChild(buildAskAiWidget(questionText));
      }
      g.items.forEach(item => {
        incrementAttempt(`${state.test}-${state.part}-${item.number}`, p34.selections[item.number] === item.answer);
      });
      const fullText = g.conversationText || g.talkText;
      if (fullText) {
        translateSlot.style.display = 'block';
        translateSlot.appendChild(buildTranslatableBlock(fullText, `${state.test}-${state.part}-${g.questions[0]}`));
      }
      wrap.insertBefore(buildNotesWidget(`${state.test}-${state.part}-${g.questions[0]}`), nextBtn);
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
  saveAllVisibleNotes();
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

    const askAiSlot = document.createElement('div');
    block.appendChild(askAiSlot);

    blocks[q.number] = { choicesDiv, explainDiv, letters, askAiSlot };
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
      const { explainDiv, askAiSlot } = blocks[q.number];
      const isCorrect = selections[q.number] === q.answer;
      const prefixHtml = correctBannerHtml(isCorrect);
      const questionText = `${q.number}. ${q.sentence}\n選択肢: ${Object.entries(q.choices).map(([l, txt]) => `(${l}) ${txt}`).join(' ')}\n正解: (${q.answer}) ${q.choices[q.answer]}\nあなたの回答: (${selections[q.number]}) ${q.choices[selections[q.number]]}`;
      try {
        explainDiv.innerHTML = prefixHtml + await getRichExplanation(`${state.test}-5-${q.number}-${selections[q.number]}`, questionText, EXPLAIN_PROMPT_PART5, EXPLAIN_PROMPT_PART5_VERSION);
      } catch (e) {
        explainDiv.innerHTML = prefixHtml + `<div>解説の取得に失敗しました: ${escapeHtml(e.message)}</div>`;
      }
      askAiSlot.appendChild(buildAskAiWidget(questionText));
    }
    batch.forEach(q => {
      incrementAttempt(`${state.test}-5-${q.number}`, selections[q.number] === q.answer);
    });
    wrap.appendChild(buildNotesWidget(`${state.test}-5-${batch[0].number}`));
  });
  wrap.appendChild(gradeBtn);

  practiceBodyEl.appendChild(wrap);
}

// ---------- Part6/7 共通(1セット解答→まとめて解説→シャドーイング) ----------

let p67 = null; // { idx, phase, selections }

function initP67IfNeeded() {
  if (!p67) p67 = { idx: 0, phase: 'question', selections: {} };
}

function p67AdvancePassage(renderFn) {
  p67.idx++;
  p67.phase = 'question';
  p67.selections = {};
  if (p67.idx >= state.data.passages.length) {
    showPartComplete();
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

    const askAiSlot = document.createElement('div');
    block.appendChild(askAiSlot);

    blocks[item.number] = { choicesDiv, explainDiv, letters, askAiSlot };
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
    const { explainDiv, askAiSlot } = blocks[item.number];
    const isCorrect = p67.selections[item.number] === item.answer;
    const prefixHtml = correctBannerHtml(isCorrect);
    let html;
    try {
      html = prefixHtml + await getRichExplanation(cacheKeyBuilder(item), questionTextBuilder(item));
    } catch (e) {
      html = prefixHtml + `<div>解説の取得に失敗しました: ${escapeHtml(e.message)}</div>`;
    }
    explainDiv.innerHTML = html;
    askAiSlot.appendChild(buildAskAiWidget(questionTextBuilder(item)));
  }
  const allCorrect = items.every(item => p67.selections[item.number] === item.answer);
  incrementAttempt(attemptKey, allCorrect);
  items.forEach(item => {
    recordCorrectness(`${state.test}-${state.part}-${item.number}-correct`, p67.selections[item.number] === item.answer);
  });
  nextBtn.disabled = false;
  nextBtn.textContent = 'シャドーイングへ';
}

function renderPart6() {
  saveAllVisibleNotes();
  initP67IfNeeded();
  updateHeaderNav();
  const p = state.data.passages[p67.idx];

  if (p67.phase === 'shadowing') {
    const noteKey = `${state.test}-6-${p.questions[0]}`;
    const items = [{ label: '本文', text: p.text, ja: getCachedNaturalJa(noteKey) || '', audio: p.audio || null, noteKey }];
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
  if (p.textImage) {
    doc.classList.add('has-photo');
    const img = document.createElement('img');
    img.src = p.textImage;
    img.alt = p.topic || '本文';
    img.className = 'passage-photo';
    doc.appendChild(img);
  } else {
    doc.textContent = p.text;
  }
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
  saveAllVisibleNotes();
  initP67IfNeeded();
  updateHeaderNav();
  const p = state.data.passages[p67.idx];

  if (p67.phase === 'shadowing') {
    const audios = Array.isArray(p.audio) ? p.audio : (p.audio ? [p.audio] : []);
    const items = p.documents.map((doc, di) => {
      const noteKey = `${state.test}-7-${p.questions[0]}-doc${di}`;
      return {
        label: doc.label || `文書${di + 1}`,
        text: doc.text,
        ja: getCachedNaturalJa(noteKey) || '',
        audio: audios[di] || audios[0] || null,
        noteKey
      };
    });
    renderShadowing(items, () => p67AdvancePassage(renderPart7));
    return;
  }

  const wrap = document.createElement('div');
  const label = document.createElement('div');
  label.className = 'passage-topic';
  label.textContent = p.topic || '';
  wrap.appendChild(label);
  // 複数文書のとき、画像と翻訳枠が縦に交互(画像→翻訳→画像→翻訳...)にならないよう、
  // 先に全文書の画像をまとめて並べ、翻訳枠はその後にまとめて並べる。
  p.documents.forEach(doc => {
    const docDiv = document.createElement('div');
    docDiv.className = 'doc-box';
    const lbl = document.createElement('div');
    lbl.className = 'doc-label';
    lbl.textContent = doc.label;
    docDiv.appendChild(lbl);
    if (doc.image) {
      docDiv.classList.add('has-photo');
      const img = document.createElement('img');
      img.src = doc.image;
      img.alt = doc.label || '文書';
      img.className = 'passage-photo';
      docDiv.appendChild(img);
    } else {
      const txt = document.createElement('div');
      txt.textContent = doc.text;
      docDiv.appendChild(txt);
    }
    wrap.appendChild(docDiv);
  });

  const translateSlots = [];
  p.documents.forEach((doc, di) => {
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

const saveNotesBtn = document.getElementById('saveNotesBtn');
const notesSaveStatusEl = document.getElementById('notesSaveStatus');
function setNotesSaveStatus(msg, isErr, isOk) {
  if (!notesSaveStatusEl) return;
  notesSaveStatusEl.textContent = msg || '';
  notesSaveStatusEl.classList.toggle('err', !!isErr);
  notesSaveStatusEl.classList.toggle('ok', !!isOk);
}
if (saveNotesBtn) {
  saveNotesBtn.addEventListener('click', async () => {
    saveNotesBtn.disabled = true;
    setNotesSaveStatus('保存中…');
    try {
      const count = await saveAllVisibleNotes();
      setNotesSaveStatus(count > 0 ? `保存済(${count}件)` : '保存するノートがありません', count === 0, count > 0);
    } catch (e) {
      setNotesSaveStatus('保存エラー: ' + e.message, true);
    }
    saveNotesBtn.disabled = false;
    setTimeout(() => setNotesSaveStatus(''), 3000);
  });
}
