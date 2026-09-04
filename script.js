const CLIENT_ID = 'z86hx1zqjrt28urcj8mz487fyg5wl76t';
const CLIENT_SECRET = 'd1QAC50V41mR9NAhquGi9l5p12fYqlHS';
const REDIRECT_URI = 'https://bellaortensia.github.io/toeic-official-practice/';
const AUDIO_FOLDER_ID = '409318407954';

const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');

// ---------- 再生中の音声を全体で1つだけ追跡(設問切り替え時に確実に止めるため) ----------
// createAudioPlayerWidget/renderDictation/renderShadowingが新しいAudioを再生する
// たびにここへ登録する。別の設問に切り替わる際、前の設問のAudioオブジェクトは
// DOMから消えても再生し続けてしまう(closure内で参照が残るため)ので、
// updateHeaderNav()から毎回stopAllAudio()を呼んで確実に止める。
const globalAudio = { current: null };
// トップ画面「前回学習した問題」欄のまとめて再生(連続・自動繰り返し)が実行中かどうか。
// 他の場所でstopAllAudio()が呼ばれた場合(設問画面へ移動する等)も確実に止まるよう、
// ここでまとめてリセットする。
let studySequencePlaying = false;
// 「前回学習した問題」欄の再生ボタン(まとめて再生・各行)のうち、現在「■停止」
// 表示になっているものの参照。stopAllAudio()が呼ばれたらここもリセットし、
// 参照先のボタンが今も画面上にあれば表示を元に戻す(activePlayCtrlはこのファイルの
// 後方で宣言されるが、実際に値が入るのはユーザー操作後なのでここでの参照で問題ない)。
let activePlayCtrl = null;
function stopAllAudio() {
  studySequencePlaying = false;
  if (activePlayCtrl) {
    activePlayCtrl.btn.textContent = activePlayCtrl.label;
    activePlayCtrl.btn.classList.remove('is-playing');
    activePlayCtrl = null;
  }
  if (globalAudio.current) {
    try { globalAudio.current.pause(); } catch (e) { /* ignore */ }
    globalAudio.current = null;
  }
}

// ---------- Gemini APIキー(decode-toeicと同じキー名で共有) ----------

const GEMINI_KEY_LS = 'decodeToeic.geminiKey';
const geminiKeyInput = document.getElementById('geminiKey');
const savedGeminiKey = localStorage.getItem(GEMINI_KEY_LS);
if (savedGeminiKey) geminiKeyInput.value = savedGeminiKey;
geminiKeyInput.addEventListener('change', () => localStorage.setItem(GEMINI_KEY_LS, geminiKeyInput.value.trim()));

function getGeminiKey() {
  return localStorage.getItem(GEMINI_KEY_LS) || geminiKeyInput.value.trim();
}

// 有料キー(任意)。無料キーが利用上限(429)に達した瞬間だけ自動でこちらに
// 切り替わる(普段は無料キーのみ使用。有料キーが無ければ無料キーのみで動作する)。
const GEMINI_PAID_KEY_LS = 'decodeToeic.geminiPaidKey';
const geminiPaidKeyInput = document.getElementById('geminiPaidKey');
const savedGeminiPaidKey = localStorage.getItem(GEMINI_PAID_KEY_LS);
if (savedGeminiPaidKey) geminiPaidKeyInput.value = savedGeminiPaidKey;
geminiPaidKeyInput.addEventListener('change', () => localStorage.setItem(GEMINI_PAID_KEY_LS, geminiPaidKeyInput.value.trim()));

function getGeminiPaidKey() {
  return localStorage.getItem(GEMINI_PAID_KEY_LS) || geminiPaidKeyInput.value.trim();
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

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// 無料キーでリクエストし、利用上限(429)に達した場合のみ有料キーへ自動フォールバック
// する(decode-toeicと同じ方式)。両方試して全て失敗した場合は最後のレスポンスを返す。
// また、Gemini APIは「モデルが混雑中です」という503を返すことがあり、Google自身の
// エラーメッセージも「しばらくしてから再試行してください」と案内している。多くの
// 場合は数秒待って再試行すれば成功するため、503のときだけ同じ鍵のまま短い間隔を
// 空けて最大3回まで自動リトライする(503のリトライを使い切ってもまだ失敗する場合は、
// そのままエラーとして返す)。
async function fetchGeminiWithFailover(url, body) {
  const keys = [getGeminiKey(), getGeminiPaidKey()].filter(Boolean);
  if (!keys.length) throw new Error('Gemini APIキーが設定されていません');
  let res = null;
  for (let i = 0; i < keys.length; i++) {
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys[i] },
        body: JSON.stringify(body)
      });
      if (res.ok || res.status !== 503) break;
      if (attempt < 2) await sleep(1200 * (attempt + 1));
    }
    if (res.ok || res.status !== 429 || i === keys.length - 1) return res;
  }
  return res;
}

async function callGemini(systemPrompt, userText, options = {}) {
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
  const res = await fetchGeminiWithFailover(url, body);
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

1行目: ■設問の日本語訳 とだけ書く。
続けて、設問文(何が問われているか)の日本語訳を1〜2行で書く。選択肢だけで設問文にあたる英文が存在しない問題の場合は、この■設問の日本語訳の見出しごと省略してよい。

次の行: ■選択肢の日本語訳 とだけ書く。
続けて、すべての選択肢(A)(B)(C)(D)を1行ずつ、必ず▲から始めて日本語訳のみを書く。「〜という意味」のような語尾や説明的な付け足しは一切付けず、訳文だけを簡潔に書くこと。例:
▲(A) 配送が遅れている
▲(B) 予算が不足している

次の行: ■根拠・解説 とだけ書く。
続けて、必ず最初の文で「正解は(X)です。」と正解の記号を明記すること。入力に「あなたの回答」が含まれ、それが正解と異なる場合は、その回答がなぜ誤りなのかを具体的に説明すること(単に不正解と述べるだけでなく、その選択肢のどこが本文の内容と合わないのかを明記する)。その後、なぜ正解の選択肢が正しいのかを説明する。本文中の根拠となる箇所を引用する際は①②③...の番号を付け、直後に「」で該当箇所を引用すること(例: ①「the delivery will be delayed」)。

重要: 引用符「」で囲む部分は、必ず入力に与えられた文書・会話・トークの原文から一字一句そのまま抜き出すこと。原文にない文言を作り出して引用してはならない。入力に文書・会話・トークの原文(本文)が含まれていない場合は、①②③の番号付き引用は一切使わず、根拠は選択肢や設問文の内容に基づいて言葉で説明すること。

最後の行: ★知らないと解けない要素 に続けて、この問題を解くために知っておく必要がある文法・語彙・表現を1〜2行で書く。

出力は必ず次のJSON形式のみを返し、説明文やコードフェンスは一切含めないこと。
{
  "explainText": "上記ルールに従ったプレーンテキスト。■と★の行は単独の見出し行にし、選択肢の行は必ず▲から始めること。Markdown記号(**など)は使わないこと。",
  "keyPhraseQuotes": ["explainText中の特に重要なTOEIC頻出語・イディオムを、原文の表記のまま(下線を引きたい語句)"]
}`;

const EXPLAIN_PROMPT_READING_VERSION = 'v3';

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
// buildSpeakerBadges()と同じ見た目をHTML文字列として組み立てる版。
// formatRichExplainHtml()は渡した文字列を丸ごとescapeHtmlするため、そちらの
// マークアップに直接<img>を混ぜることはできない。そのため、formatRichExplainHtml
// の出力(文字列)に対して、変換後の見出しテキストをキーに後から文字列置換で
// 挿入する(buildP12ExplainHtml内で使用)。
function speakerBadgesHtml(speakers) {
  const list = (Array.isArray(speakers) ? speakers : [speakers]).filter(s => s && s.nat);
  if (!list.length) return '';
  const parts = list.map(s =>
    `<span class="speaker-badge"><img src="images/flags/${s.nat}.svg" alt="${escapeHtml(s.nat)}" class="speaker-flag"><span class="speaker-gender">${escapeHtml(s.gender || '')}</span></span>`
  );
  return `<span class="speaker-badges">${parts.join('<span class="speaker-arrow">→</span>')}</span>`;
}

function buildP12ExplainHtml(q, isPart1, choiceTexts, jaTexts, letters, selectedLetter) {
  let markup = '';
  // Part2は設問=speakers[0](質問者)、選択肢=speakers[1](応答者)が読み上げる。
  // Part1は選択肢(4つの文)を単一のspeakerが読み上げる。
  let questionFlagsHtml = '';
  let choicesFlagsHtml = '';
  if (!isPart1) {
    if (q.speakers && q.speakers[0]) questionFlagsHtml = speakerBadgesHtml(q.speakers[0]);
    if (q.speakers && q.speakers[1]) choicesFlagsHtml = speakerBadgesHtml(q.speakers[1]);
    markup += `■設問文\n${q.question}\n（${q.questionJa || ''}）\n\n`;
  } else if (q.speaker) {
    choicesFlagsHtml = speakerBadgesHtml(q.speaker);
  }
  markup += '■選択肢\n';
  markup += letters.map(l => `▲(${l}) ${choiceTexts[l] || ''}\n　　${jaTexts[l] || ''}`).join('\n') + '\n\n';
  markup += `■根拠・解説\n正解は(${q.answer})です。\n${q.explanation || ''}`;
  let html = correctBannerHtml(selectedLetter === q.answer) + formatRichExplainHtml(markup, []);
  if (questionFlagsHtml) html = html.replace('<strong>設問文</strong>', `<strong>設問文</strong> ${questionFlagsHtml}`);
  if (choicesFlagsHtml) html = html.replace('<strong>選択肢</strong>', `<strong>選択肢</strong> ${choicesFlagsHtml}`);
  return html;
}

// ---------- Part6/7用の簡易チャンク翻訳(decode-toeicの直訳表示のスコープを絞った版) ----------

const TRANSLATE_PROMPT = `あなたは英語学習者向けの解析エンジンです。与えられた英文全体を解析してください。
1) 最初の1文字から最後の1文字まで省略せず、意味のまとまり(チャンク)ごとに分割し、各チャンクに英語の語順のまま前から順番に理解できる「直訳調」の日本語訳を付けてください(自然な日本語の語順に並べ替えないこと)。1チャンクは必ず英単語3〜8語程度に収めること。8語を超えそうな場合は、接続詞・関係詞・前置詞句の前やカンマの後など意味の区切りで必ずさらに分割すること。どんなに短い文でも、1文をまるごと1つのチャンクにするのは禁止(主語のまとまりと動詞以降のまとまりなど、最低2つ以上に分けること)。
2) 各チャンクの中にTOEIC頻出の単語・熟語・言い回しがあれば、その語句を一字一句原文のまま抜き出し、keyTermsに追加してください(該当が無いチャンクではkeyTermsを空配列にする)。
3) 原文中でそのチャンクの直後に改行(\\n)がある場合(会話の話者交代や段落の変わり目など)は、そのチャンクに "lineBreak": true を付けてください(改行が無ければ省略またはfalseでよい)。
4) 英文全体を文単位(ピリオド・感嘆符・疑問符などの文末記号まで)に区切り、それぞれの原文(en、一字一句そのまま抜粋)と、自然な日本語の語順・言い回しでの意訳(ja)のペアをnaturalSentencesに入れてください。長すぎない限り1文=1要素とすること。原文中でその文の直後に改行がある場合は、segmentsと同様に"lineBreak": trueを付けてください。
出力は必ず次のJSON形式のみを返し、説明文やコードフェンスは一切含めないこと。
{
  "segments": [
    { "en": "原文チャンク(原文から一字一句変えずに抜粋)", "ja": "直訳調の日本語訳チャンク", "keyTerms": [{"term":"抜き出した語句(原文表記のまま)","meaning":"意味(短く)"}], "lineBreak": true }
  ],
  "naturalSentences": [
    { "en": "原文の1文(原文から一字一句変えずに抜粋)", "ja": "その文の自然な日本語訳", "lineBreak": true }
  ]
}
segmentsの"en"を出現順にそのまま連結すると、空白の増減を除いて原文と完全に一致するようにしてください。naturalSentencesの"en"を出現順にそのまま連結した場合も同様に原文と完全に一致させてください。`;

const TRANSLATE_PROMPT_VERSION = 'v6';

// AIが返すlineBreakは「ピリオドの直後」など原文に無い位置でもtrueを付けがちで、
// EN/JA両カラムの改行位置がずれる原因になる。原文中の実際の改行位置とチャンクの
// 出現位置を突き合わせて、lineBreakをこちら側で確定し直す(AIの判断は信用しない)。
// あわせて原文中の文字位置(start/end)も記録する。これは、意訳モードでEN側の
// どのチャンクが今ハイライトされているかから、対応する意訳の文を特定する
// (chunk単位のsegmentsと文単位のnaturalSentencesは別々にAIが分割するため、
// 文字位置を突き合わせないと対応関係が分からない)のに使う。
function reconcileLineBreaks(segments, sourceText) {
  if (!sourceText) return segments.map(seg => ({ ...seg, lineBreak: false, start: 0, end: 0 }));
  let cursor = 0;
  return segments.map(seg => {
    const idx = sourceText.indexOf(seg.en, cursor);
    if (idx === -1) return { ...seg, lineBreak: false, start: cursor, end: cursor };
    const start = idx;
    let i = idx + seg.en.length;
    const end = i;
    cursor = i;
    while (i < sourceText.length && (sourceText[i] === ' ' || sourceText[i] === '\t')) i++;
    return { ...seg, lineBreak: sourceText[i] === '\n', start, end };
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
  const naturalSentences = reconcileLineBreaks(Array.isArray(parsed.naturalSentences) ? parsed.naturalSentences : [], text);
  const result = { segments, naturalSentences };
  try { localStorage.setItem(lsKey, JSON.stringify(result)); } catch (e) { /* 保存容量オーバー等は無視 */ }
  return result;
}

// 解説画面で既に翻訳済みなら、その意訳(naturalSentencesを連結したもの)をシャドーイング
// 画面の日本語訳としてそのまま使い回す(新たにAIを呼ばない)。未翻訳ならnullを返す。
function getCachedNaturalJa(cacheKey) {
  try {
    const raw = localStorage.getItem('toeicTranslate.' + TRANSLATE_PROMPT_VERSION + '.' + cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.naturalSentences) || !parsed.naturalSentences.length) return null;
    return parsed.naturalSentences.map(s => s.ja).join('\n') || null;
  } catch (e) { return null; }
}

// クリックしたチャンクが属する「一文全体」を対象に、文構造がひと目で分かる解説を
// 生成する(decode-toeicの「この文を解説→学習メモ」と同じ発想だが、チャンク単体
// ではなく文全体を解説する)。ノート欄はプレーンテキストで実際の下線は引けないため、
// {{語句|注記}} という専用記法を使い、formatNoteBody()側でこれを下線+右下の小さな
// 注記(何を修飾しているか、接続詞の意味・用法、熟語の意味など)に変換して表示する。
const CLAUSE_EXPLAIN_PROMPT_READING = `あなたはTOEIC満点を何度も取得し、初心者指導歴20年以上の英語講師です。
入力される英文(一文または一節)を、必ず次の形式・見出しどおりに日本語で解説してください。この形式以外の前置き・後書き・装飾やMarkdown記号(**など)は一切使わないこと。

■文の解説
＜全体文＞
(入力された英文を、省略・言い換えせず一字一句そのまま、意味のまとまり(3〜8語程度のチャンク)ごとに改行して書く。)

(1行空けてから、直前のチャンクと同じ順番・同じ行数になるよう、各チャンクを英語の語順のまま前から訳した「直訳調」の日本語訳を1行ずつ書く。自然な日本語の語順に並べ替えたり、行をまとめたりしないこと。)

＜重要単語・熟語・言い回し＞
(その文中にあるTOEIC頻出の単語・熟語・言い回しを「用語 意味」の形で並べ、／で区切る。2〜3行に折り返してよい。該当が無ければこの見出しごと省略する。)

出力例(入力文: "Since enrolling in our comprehensive motor vehicle insurance four years ago, you have saved an average of $510 per year compared to the cost of policies from leading competitors."):
■文の解説
＜全体文＞
Since enrolling in our comprehensive motor vehicle insurance four years ago,
you have saved an average of $510 per year
compared to the cost of policies
from leading competitors.

4年前に当社の総合自動車保険に加入して以来、
あなたは年間平均510ドルを節約してきました
保険契約の費用と比べて。
大手競合他社の

＜重要単語・熟語・言い回し＞
Since ～ing ～して以来 ／enrolling in～ ～に加入すること ／comprehensive 総合的な、補償範囲の広い
／average of ～ ～の平均 ／compared to ～ ～と比較して`;

async function getClauseExplanation(clauseText) {
  return await callGemini(CLAUSE_EXPLAIN_PROMPT_READING, clauseText, { maxOutputTokens: 800 });
}

// 単語ポップアップから「用語を解説」した際に呼ぶ。単語1つの場合だけコアイメージ
// (語源的な核となるイメージ)を説明し、熟語・言い回し(複数語)の場合はコアイメージの
// 行を省略して、なぜその単語の組み合わせでその意味になるかの由来・成り立ちだけを書く
// (単語か熟語かはAIの判断に任せず、語句のスペースの有無で機械的に判定する)。
const TERM_EXPLAIN_PROMPT_WORD = `あなたはTOEIC満点を何度も取得し、初心者指導歴20年以上の英語講師です。
入力される「語句」(単語1つ)と、それが使われている「文脈」の英文について、日本語で解説してください。
必ず次の構成で、装飾やMarkdown記号(**など)は使わず、プレーンテキストで簡潔に(全体で4〜6行程度)出力してください。

1行目: ■ に続けて、入力された語句をそのまま書く(他には何も書かない)。
2行目: 語句：に続けて、この文脈での意味を書く。
3行目: コアイメージ：に続けて、この語が持つ語源的な核となるイメージ・語感を短く説明する。

出力例(入力語句: "consolidate"):
■consolidate
語句：合併する、強化する
コアイメージ：「固い(solid)ものを一つにする(com-)」が核で、バラバラだった組織や要素をしっかりと一つにまとめ上げて強力にすることを表します。`;

const TERM_EXPLAIN_PROMPT_PHRASE = `あなたはTOEIC満点を何度も取得し、初心者指導歴20年以上の英語講師です。
入力される「語句」(熟語・イディオム・言い回し)と、それが使われている「文脈」の英文について、日本語で解説してください。
必ず次の構成で、装飾やMarkdown記号(**など)は使わず、プレーンテキストで簡潔に(全体で3〜5行程度)出力してください。コアイメージの行は不要(単語1つの場合のみ使う項目のため)。

1行目: ■ に続けて、入力された語句をそのまま書く(他には何も書かない)。
2行目: 語句：に続けて、この文脈での意味を書く。
3行目以降: なぜその単語の組み合わせでその意味になるのか、由来や成り立ちを1〜2行で説明する。`;

async function getTermExplanation(term, meaning, contextSentence) {
  const input = `語句: ${term}\n簡易な意味: ${meaning || '(不明)'}\n文脈: ${contextSentence || ''}`;
  const isPhrase = term.trim().split(/\s+/).length > 1;
  const prompt = isPhrase ? TERM_EXPLAIN_PROMPT_PHRASE : TERM_EXPLAIN_PROMPT_WORD;
  return await callGemini(prompt, input, { maxOutputTokens: 600 });
}

// {{語句|注記}} 記法(現在はどのプロンプトも出力しないが、下位互換のため残す)を、
// 下線+右下の小さな注記(Part5解説のS[...]/V[...]等と同じ、下線+subラベルの見た目)
// に変換する。まずescapeHtmlでエスケープしてから変換するので、{{}}を使わない
// 普通の解説文をそのまま渡しても安全にそのまま表示される(該当する記法が無ければ
// 何も変換されない)。
function formatNoteBody(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/\{\{([^|{}]+)\|([^{}]*)\}\}/g, (m, phrase, note) => {
    const noteHtml = note
      ? `<sub style="color:#2f5fa8;font-weight:700;font-size:9.5px;">${note}</sub>`
      : '';
    return `<span style="text-decoration:underline;text-decoration-color:#2f5fa8;text-underline-offset:3px;">${phrase}</span>${noteHtml}`;
  });
}

// enTextがある場合だけ引用行を作る。「この文を解説」「用語を解説」の出力は、
// AI自身が1行目に■付きで英文/語句を書く形式になっているため、ここで別途enTextを
// 引用すると同じ英文が二重に表示されてしまう。そのため、それらの呼び出しでは
// enTextにnullを渡す(直訳クイック追加のようにAI出力に英文が含まれない場合だけ
// enTextを渡して引用行を作る)。
function appendToNotes(notesArea, enText, explanation) {
  const block = document.createElement('div');
  block.className = 'notes-entry';
  if (enText) {
    const quote = document.createElement('div');
    quote.className = 'notes-entry-quote';
    quote.textContent = `■${enText}`;
    block.appendChild(quote);
  }
  const body = document.createElement('div');
  body.className = 'notes-entry-body';
  body.innerHTML = formatNoteBody(explanation);
  block.appendChild(body);
  notesArea.appendChild(block);
  // 区切り線は.notes-entryのborder-bottom(実線、CSS側)だけで表現する。ここで
  // 別途<hr>(点線、CSS側)も足すと実線+点線の二重線になってしまうため追加しない。
  notesArea.scrollTop = notesArea.scrollHeight;
}

// ヘッダーの「保存」ボタン用: ノート欄は(翻訳結果・解説と違ってAIキャッシュの対象外なので)
// 明示的に保存しないと消えてしまう。保存時点で画面上に存在するノート欄をすべて
// cacheKeyごとにlocalStorageへ書き出し、Apps Script URLが設定されていればスプレッドシートへも
// 同期する(decode-toeicと同じApps Script Web Appブリッジ方式)。次にその問題/パッセージを
// 開いたときは、まずスプレッドシート側のキャッシュ→無ければlocalStorageの順に復元する。
const NOTES_LS_PREFIX = 'toeicOfficialPractice.notes.';

// スプレッドシートへの接続状況('unknown'|'no-url'|'ok'|'error')。URL未設定なのか
// 接続自体に失敗しているのかを画面に表示するため(updateSheetConnectionBanner参照)。
// sheetConnectionErrorには、失敗時の具体的な理由(HTTPステータスや応答の中身の
// 先頭部分)を入れる。「JSONでない応答」の場合はApps Scriptの公開設定(アクセス権
// 「全員」になっているか等)が原因のことが多いので、そのまま画面に出して原因
// 切り分けに使えるようにする。
let sheetConnectionStatus = 'unknown';
let sheetConnectionError = '';
let sheetNotesCachePromise = null;
function getSheetNotesCache() {
  if (!sheetNotesCachePromise) {
    const url = getSheetUrl();
    if (!url) {
      sheetConnectionStatus = 'no-url';
      sheetNotesCachePromise = Promise.resolve({});
    } else {
      // 以前はCORS対策として<script>タグ経由のJSONPを使っていたが、これが逆に
      // 一部の環境のセキュリティソフトに「外部コードの読み込み・実行」として
      // 警戒され、ブロックされる原因になっていた(姉妹アプリdecode-toeicは同じ
      // Apps Script方式でも素のfetch()を使っており、そちらは問題なく通ることが
      // 確認できたため、fetch()に統一した)。
      sheetNotesCachePromise = fetch(`${url}?action=getNotes`)
        .then(async r => {
          const bodyText = await r.text();
          if (!r.ok) throw new Error(`HTTP ${r.status}: ${bodyText.slice(0, 300)}`);
          try { return JSON.parse(bodyText); }
          catch (e) { throw new Error(`JSON以外の応答が返ってきました: ${bodyText.slice(0, 300)}`); }
        })
        .then(d => {
          sheetConnectionStatus = 'ok'; sheetConnectionError = '';
          const notes = (d && d.notes) || {};
          // 個別の設問を開かなくても回答履歴のポップアップ等でノートの有無が
          // すぐ分かるよう、取得したノートを一括でこの端末のlocalStorageにも
          // 書き込んでおく(以前は個別に開いたノートしかlocalStorageに残らず、
          // 一度も開いたことのない端末では「解説を見る」リンクが出なかった)。
          Object.keys(notes).forEach(k => {
            try { localStorage.setItem(NOTES_LS_PREFIX + k, notes[k]); } catch (e) { /* 保存容量オーバー等は無視 */ }
          });
          return notes;
        })
        .catch(e => { sheetConnectionStatus = 'error'; sheetConnectionError = e.message; return {}; });
    }
  }
  return sheetNotesCachePromise;
}

// ページ表示時に一度だけスプレッドシートへの接続を試み、結果に応じて画面上部に
// 分かりやすいメッセージを出す(URL未設定なのか、接続自体に失敗しているのかで
// 会社PC等での原因切り分けができるように)。
async function updateSheetConnectionBanner() {
  const el = document.getElementById('sheetConnectionStatus');
  if (!el) return;
  await getSheetNotesCache();
  if (sheetConnectionStatus === 'no-url') {
    el.textContent = '⚠ ノート保存用スプレッドシートが未設定です(この端末では「Initial Setup」→「③ ノート保存用スプレッドシート」にURLが入力されていません)。ノートはこの端末のブラウザ内にのみ保存されます。';
    el.style.display = 'block';
  } else if (sheetConnectionStatus === 'error') {
    el.textContent = `⚠ ノート保存用スプレッドシートへの接続に失敗しました。「Initial Setup」→「③ノート保存用スプレッドシート」のコードが最新版か確認し、古い場合は貼り替えて再デプロイしてください。ノートはこの端末のブラウザ内にのみ保存されます。(詳細: ${sheetConnectionError || '不明なエラー'})`;
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
  // ノートが一括でlocalStorageに書き込まれた後なので、回答履歴欄の
  // 「解説を見る」リンクの表示可否(ノートの有無判定)を最新化する。
  renderHistorySidebar();
}

// この端末に今まで個別に保存されてきたノート(まだ一度もスプレッドシートへ
// アップロードされていない可能性があるもの)を、まとめてアップロードする。
// 安全のため、スプレッドシート側に既に何か値が入っているキーは上書きしない
// (他の端末で書かれた内容を誤って消してしまわないようにするため)。
// ページ表示のたびに呼んでも、2回目以降はアップロード済みのキーが除外されて
// 対象が無くなるだけなので害はない。
async function migrateLocalNotesToSheet() {
  const url = getSheetUrl();
  if (!url) return;
  const remoteNotes = await getSheetNotesCache();
  const toUpload = {};
  for (let i = 0; i < localStorage.length; i++) {
    const lsKey = localStorage.key(i);
    if (!lsKey || lsKey.indexOf(NOTES_LS_PREFIX) !== 0) continue;
    const noteKey = lsKey.slice(NOTES_LS_PREFIX.length);
    if (remoteNotes[noteKey]) continue;
    const html = localStorage.getItem(lsKey);
    if (html && html.trim()) toUpload[noteKey] = html;
  }
  if (!Object.keys(toUpload).length) return;
  try {
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'saveNotes', notes: toUpload })
    });
    Object.assign(remoteNotes, toUpload);
  } catch (e) { /* オフライン等は無視 */ }
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
      // mode:'no-cors'で送る: Apps ScriptのレスポンスはCORSヘッダーが無く読み取れない
      // ことがあるが、no-corsなら読み取れなくてもリクエスト自体は送信され、Apps Script
      // 側では正常に保存処理が実行される(応答の中身を見る必要が無い保存処理なので
      // これで問題ない)。
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'saveNotes', notes: notesMap })
      });
      const cache = await getSheetNotesCache();
      Object.assign(cache, notesMap);
    } catch (e) { /* オフライン等は無視。localStorageには保存済み */ }
    // ノートと同じタイミングで、回答履歴・学習時間などの進捗データも一緒に
    // スプレッドシートへ書き出す(画面遷移を待たせないよう結果は待たない)。
    saveProgressToSheet();
  }
  return count;
}

// シャドーイング画面・各Partの解説画面で共通に使う、自由記述のノート欄。
// noteKeyが同じであれば同じ内容を共有する(例: シャドーイングと解説画面で同じノート)。
// 全ノート欄共通の書式設定ツールバー(赤字・青字・太字・下線・区切り線)。
// document.execCommandは、直前にフォーカス・選択範囲があったcontentEditable要素に
// 適用されるため、ボタンのmousedownでpreventDefaultしてノート欄側の選択範囲を
// クリック後も保持させておく(ボタン自体にフォーカスを奪わせない)。
function buildNotesToolbar(notesArea) {
  const bar = document.createElement('div');
  bar.className = 'notes-toolbar';
  const buttons = [
    { label: '赤字', run: () => document.execCommand('foreColor', false, '#c1503f') },
    { label: '青字', run: () => document.execCommand('foreColor', false, '#2f5fa8') },
    { label: '太字', run: () => document.execCommand('bold') },
    { label: '下線', run: () => document.execCommand('underline') },
    { label: '区切り線', run: () => document.execCommand('insertHorizontalRule') }
  ];
  buttons.forEach(({ label, run }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'notes-toolbar-btn';
    btn.textContent = label;
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => { notesArea.focus(); run(); });
    bar.appendChild(btn);
  });
  return bar;
}

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
  wrap.appendChild(buildNotesToolbar(area));
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
// (getRichExplanationに渡しているquestionTextと同じもので良い)。noteKeyを渡すと、
// 質問・回答の履歴を(その設問のノートと同じ仕組みで)localStorage/スプレッドシートに
// 保存し、次回開いたときに復元する。履歴は連続して積み上げ、消さない。
function buildAskAiWidget(questionContext, noteKey) {
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
  answerArea.className = 'ask-ai-answer notes-area';
  answerArea.style.display = 'none';
  wrap.appendChild(answerArea);

  if (noteKey) {
    restoreNotesIfSaved(answerArea, `${noteKey}-ai`).then(() => {
      if (answerArea.innerHTML.trim()) answerArea.style.display = 'block';
    });
  }

  function appendEntry(question, answerText) {
    const qDiv = document.createElement('div');
    const strong = document.createElement('strong');
    strong.style.color = '#c1503f';
    strong.textContent = 'Q. ' + question;
    qDiv.appendChild(strong);
    answerArea.appendChild(qDiv);
    const aDiv = document.createElement('div');
    aDiv.className = 'ask-ai-answer-entry';
    aDiv.textContent = answerText;
    answerArea.appendChild(aDiv);
    return aDiv;
  }

  async function ask() {
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    btn.disabled = true;
    btn.textContent = '質問中...';
    answerArea.style.display = 'block';
    const aDiv = appendEntry(q, '回答を生成中...');
    try {
      aDiv.textContent = await askAiAboutQuestion(questionContext, q);
    } catch (e) {
      aDiv.textContent = '回答の取得に失敗しました: ' + e.message;
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
  if (!chunkPopupEl.contains(e.target) && !e.target.closest('.chunk-seg') && !e.target.closest('.translate-col-ja') && !e.target.closest('.translate-col-en')) {
    chunkPopupEl.classList.remove('show');
  }
});

function showChunkPopup(seg, anchorEl, notesArea, sentenceText, clauseText) {
  const terms = seg.keyTerms || [];
  const literalHtml = seg.ja
    ? `<div class="chunk-popup-item chunk-popup-literal" data-action="literal"><strong>${escapeHtml(seg.ja)}</strong></div>`
    : '';
  const termsHtml = terms.map((t, i) =>
    `<div class="chunk-popup-item chunk-popup-term" data-action="term" data-term-idx="${i}"><strong>${escapeHtml(t.term || '')}</strong><div>${escapeHtml(t.meaning || '')}</div></div>`
  ).join('');
  chunkPopupEl.innerHTML = literalHtml + termsHtml +
    '<div class="chunk-popup-item chunk-popup-explain" data-action="explain"><strong>この文を解説→ノートへ</strong></div>' +
    '<div class="chunk-popup-item chunk-popup-explain" data-action="explain-full"><strong>この文全体を解説→ノートへ</strong></div>';
  chunkPopupEl.onclick = async e => {
    const literalTrigger = e.target.closest('[data-action="literal"]');
    if (literalTrigger) {
      if (literalTrigger.dataset.added === '1') return;
      appendToNotes(notesArea, seg.en, seg.ja);
      literalTrigger.classList.add('added');
      literalTrigger.dataset.added = '1';
      return;
    }
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
        appendToNotes(notesArea, null, explanation);
        strongEl.textContent = originalLabel;
        termTrigger.classList.add('added');
      } catch (err) {
        strongEl.textContent = originalLabel + '(解説の取得に失敗しました)';
        termTrigger.dataset.loading = '0';
      }
      return;
    }
    // 「この文を解説」: カンマ区切りの節(clauseText)だけを対象に解説する。
    // 「この文全体を解説」: チャンクが属する一文全体(sentenceText)を対象にする。
    const trigger = e.target.closest('[data-action="explain"]') || e.target.closest('[data-action="explain-full"]');
    if (!trigger || trigger.dataset.loading === '1') return;
    const isFull = trigger.dataset.action === 'explain-full';
    const target = isFull ? (sentenceText || seg.en) : (clauseText || seg.en);
    trigger.dataset.loading = '1';
    trigger.querySelector('strong').textContent = '解説中...';
    try {
      const explanation = await getClauseExplanation(target);
      appendToNotes(notesArea, null, explanation);
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

// EN列は直訳・意訳どちらのモードでも常にチャンク単位で表示する(スラッシュ区切り、
// マウスホイールの上下でハイライト位置(curSeg)を送り、クリックでポップアップ。
// 実際のカーソル位置とは無関係)。JA列はモードで表示を切り替える:
// ・直訳: チャンク単位。現在位置でもクリックされるまで背景=文字色で塗りつぶして
//   読めなくし(単語帳の答え隠し)、クリックするとEN側と同じアクセント色にめくれる。
// ・意訳: 文単位、常時表示。チャンク単位で正確に対応する箇所をハイライトするのは
//   難しいため背景ハイライトはしないが、今EN側でハイライトされているチャンクが
//   含まれる文だけに下線を引き、ホイール操作と連動させる(常時全文下線にはしない)。
function renderTranslateColumns(container, data, mode, notesArea, slash) {
  container.innerHTML = '';
  const segments = data.segments || [];
  let curSeg = -1;

  const wideWrap = document.createElement('div');
  wideWrap.className = 'translate-wide';
  const enCol = document.createElement('div');
  enCol.className = 'translate-col translate-col-en';
  const jaCol = document.createElement('div');
  jaCol.className = 'translate-col translate-col-ja';

  const enSpans = [];
  const jaSpans = []; // 直訳モードのみ使用
  segments.forEach((seg, i) => {
    const enSpan = document.createElement('span');
    enSpan.className = 'chunk-seg';
    enSpan.dataset.seg = i;
    // スラッシュモードがONのときだけ、改行の直前を除いて毎回「/」を明示的に挟む
    // (スラッシュリーディング表示用)。OFFのときはスペース区切りのみにする。
    enSpan.textContent = seg.en + (seg.lineBreak ? ' ' : (slash ? ' / ' : ' '));
    enCol.appendChild(enSpan);
    enSpans.push(enSpan);
    if (mode === 'literal') {
      const jaSpan = document.createElement('span');
      jaSpan.className = 'chunk-seg';
      jaSpan.dataset.seg = i;
      jaSpan.textContent = seg.ja + ' ';
      jaCol.appendChild(jaSpan);
      jaSpans.push(jaSpan);
    }
    if (seg.lineBreak) {
      enCol.appendChild(document.createElement('br'));
      if (mode === 'literal') jaCol.appendChild(document.createElement('br'));
    }
  });

  // 文単位のデータ(naturalSentences)は、意訳モードのJA表示だけでなく、直訳モード
  // でも「この文を解説」機能(クリックしたチャンクが属する文全体を解説する)のために
  // 必要なので、モードに関わらず常に対応表(segToSentenceIdx)を作っておく。
  // segments/naturalSentencesはAIが別々に分割するため、原文中の文字位置(start/end)
  // を突き合わせないと対応関係が分からない。
  const sentences = data.naturalSentences || [];
  const segToSentenceIdx = segments.map(seg => {
    if (!sentences.length) return -1;
    let idx = sentences.findIndex(s => seg.start >= s.start && seg.start < s.end);
    if (idx === -1) idx = sentences.findIndex(s => seg.start < s.end);
    if (idx === -1) idx = sentences.length - 1;
    return idx;
  });

  const naturalJaSpans = [];
  if (mode === 'natural') {
    jaCol.classList.add('natural-mode');
    if (!sentences.length) {
      jaCol.innerHTML = '<p class="translate-error">意訳データがありません。「翻訳を再取得」をお試しください。</p>';
    } else {
      sentences.forEach((s, i) => {
        const jaSpan = document.createElement('span');
        jaSpan.className = 'natural-seg';
        jaSpan.dataset.seg = i;
        jaSpan.textContent = s.ja + ' ';
        jaCol.appendChild(jaSpan);
        naturalJaSpans.push(jaSpan);
        if (s.lineBreak) jaCol.appendChild(document.createElement('br'));
      });
    }
  }

  // 開いているポップアップが今どのチャンク向けかを覚えておき、同じチャンクを
  // もう一度クリックしたら閉じる(モードに関わらず共通の挙動)。
  let popupOpenSeg = -1;

  function closePopup() {
    if (mode === 'literal' && curSeg >= 0) {
      wideWrap.querySelectorAll(`.chunk-seg[data-seg="${curSeg}"]`).forEach(n => n.classList.remove('seg-revealed'));
    }
    chunkPopupEl.classList.remove('show');
    popupOpenSeg = -1;
  }

  function setSeg(i) {
    i = Math.max(0, Math.min(segments.length - 1, i));
    if (i === curSeg) return;
    const wasInit = curSeg < 0;
    wideWrap.querySelectorAll('.chunk-seg.seg-hover').forEach(n => n.classList.remove('seg-hover'));
    if (mode === 'literal') wideWrap.querySelectorAll('.chunk-seg.seg-revealed').forEach(n => n.classList.remove('seg-revealed'));
    curSeg = i;
    const hovered = wideWrap.querySelectorAll(`.chunk-seg[data-seg="${i}"]`);
    hovered.forEach(n => n.classList.add('seg-hover'));
    if (hovered[0] && !wasInit) hovered[0].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (naturalJaSpans.length) {
      naturalJaSpans.forEach(n => n.classList.remove('seg-active'));
      const sentIdx = segToSentenceIdx[i];
      if (sentIdx != null && sentIdx >= 0 && naturalJaSpans[sentIdx]) naturalJaSpans[sentIdx].classList.add('seg-active');
    }
    // 別のチャンクに移動したら、開いていたポップアップは(内容が古いチャンクの
    // ままになってしまうので)閉じる。
    if (popupOpenSeg !== -1 && popupOpenSeg !== i) closePopup();
  }

  function revealCurrent() {
    if (curSeg < 0) return;
    // popupOpenSegだけでなく実際にポップアップが表示中かも見る(外側クリックなど
    // で閉じられていた場合、popupOpenSegの値だけでは古い状態のままになるため)。
    if (popupOpenSeg === curSeg && chunkPopupEl.classList.contains('show')) {
      // 同じチャンクをもう一度クリック: ポップアップを閉じる
      closePopup();
      return;
    }
    if (mode === 'literal') {
      wideWrap.querySelectorAll(`.chunk-seg[data-seg="${curSeg}"]`).forEach(n => n.classList.add('seg-revealed'));
    }
    const seg = segments[curSeg];
    const sentIdx = segToSentenceIdx[curSeg];
    const sentenceObj = sentIdx != null && sentIdx >= 0 ? sentences[sentIdx] : null;
    const sentenceText = sentenceObj ? sentenceObj.en : null;
    // 「この文を解説」用: チャンクが属する一文全体ではなく、直前・直後のカンマで
    // 区切られた節(カンマが無ければ文の先頭/末尾まで)だけを対象にする。
    let clauseText = seg.en;
    if (sentenceObj) {
      const relStart = seg.start - sentenceObj.start;
      const relEnd = seg.end - sentenceObj.start;
      if (relStart >= 0 && relEnd <= sentenceObj.en.length) {
        let cs = sentenceObj.en.lastIndexOf(',', Math.max(0, relStart - 1));
        cs = cs === -1 ? 0 : cs + 1;
        let ce = sentenceObj.en.indexOf(',', relEnd);
        ce = ce === -1 ? sentenceObj.en.length : ce + 1;
        const extracted = sentenceObj.en.slice(cs, ce).trim();
        if (extracted) clauseText = extracted;
      }
    }
    showChunkPopup(seg, enSpans[curSeg], notesArea, sentenceText, clauseText);
    popupOpenSeg = curSeg;
  }

  wideWrap.addEventListener('wheel', e => {
    e.preventDefault();
    setSeg((curSeg < 0 ? 0 : curSeg) + (e.deltaY > 0 ? 1 : -1));
  }, { passive: false });
  // ノート欄の上でホイールを回したときも、EN/JA欄の上と同じくハイライトが
  // 切り替わるようにする(ノートを見ながらでもチャンクを送れるように)。
  if (notesArea) {
    notesArea.addEventListener('wheel', e => {
      e.preventDefault();
      setSeg((curSeg < 0 ? 0 : curSeg) + (e.deltaY > 0 ? 1 : -1));
    }, { passive: false });
  }
  // JA欄・EN欄どちらでクリックしても現在位置のポップアップが開閉する
  // (意訳モードでもJA側クリックで反応させる。ポップアップ自体は常にEN側に表示)。
  // スマホ等のタッチ端末はマウスホイールが発生せずチャンク送りができないため、
  // タップされたチャンクへ直接ハイライトを移動させてから開閉する(タップした
  // その場のチャンクをそのまま選べるようにする)。意訳モードのJA側(.natural-seg、
  // 文単位で別の対応表を使う)は対象外で、今まで通りEN側の現在位置のまま開閉する。
  function handleColClick(e) {
    const segEl = e.target.closest('.chunk-seg');
    if (segEl && segEl.dataset.seg != null) {
      const idx = Number(segEl.dataset.seg);
      if (!Number.isNaN(idx)) setSeg(idx);
    }
    revealCurrent();
  }
  enCol.addEventListener('click', handleColClick);
  jaCol.addEventListener('click', handleColClick);

  wideWrap.appendChild(enCol);
  wideWrap.appendChild(jaCol);
  container.appendChild(wideWrap);
  setSeg(0);
}

// 解説画面用の翻訳ウィジェット: 表示された時点で自動的に翻訳を取得し、最初から
// ワイド・トールモード/意訳表示済みの状態で見せる(「翻訳」ボタンを押す手間や、
// 原文だけの状態に戻す操作は不要)。意訳⇄直訳の切り替え、ワイド/トールモード、
// クリックしたチャンク・文の解説をノートへ書き写す機能を持つ。
function buildTranslatableBlock(text, cacheKey) {
  const wrap = document.createElement('div');
  wrap.className = 'translate-block';

  // 常設の操作バー: 翻訳を再取得 / ワイドモード / トールモード / 意訳⇄直訳切り替え。
  // データ取得が終わるまでは再取得・表示切り替え系のボタンを無効化しておく。
  const controls = document.createElement('div');
  controls.className = 'translate-controls';

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

  const modeBtn = document.createElement('button');
  modeBtn.className = 'mode-toggle-btn';
  modeBtn.disabled = true;
  controls.appendChild(modeBtn);

  const slashBtn = document.createElement('button');
  slashBtn.className = 'mode-toggle-btn';
  slashBtn.disabled = true;
  controls.appendChild(slashBtn);

  wrap.appendChild(controls);

  const box = document.createElement('div');
  box.className = 'doc-box translate-box';
  box.textContent = '翻訳を準備中...';
  wrap.appendChild(box);

  let data = null;
  let mode = 'natural'; // 'literal' | 'natural'(デフォルトは意訳)
  let wide = true; // デフォルトでワイドモード
  let tall = false; // デフォルトではトールモードは解除された状態
  let slash = false; // デフォルトではスラッシュ非表示(押して初めてチャンク間に/が入る)

  function refreshModeUI() {
    wideBtn.textContent = wide ? '⛶ ワイド解除' : '⛶ ワイドモード';
    tallBtn.textContent = tall ? '⬍ トール解除' : '⬍ トールモード';
    modeBtn.textContent = mode === 'literal' ? '意訳に変更' : '直訳に変更';
    slashBtn.textContent = slash ? 'スラッシュ解除' : 'スラッシュモード';
  }
  refreshModeUI();

  function setControlsEnabled(enabled) {
    [refetchBtn, wideBtn, tallBtn, modeBtn, slashBtn].forEach(b => b.disabled = !enabled);
  }

  function renderChunkView() {
    box.innerHTML = '';
    box.classList.toggle('wide-mode', wide);
    box.classList.toggle('tall-mode', tall);

    const contentContainer = document.createElement('div');
    box.appendChild(contentContainer);

    const notesWrap = document.createElement('div');
    notesWrap.className = 'notes-wrap';
    const notesLabel = document.createElement('div');
    notesLabel.className = 'notes-label';
    notesLabel.textContent = 'ノート(単語や文をクリックすると意味・解説が書き写されます。自由に編集もできます)';
    const notesArea = document.createElement('div');
    notesArea.className = 'notes-area';
    notesArea.contentEditable = 'true';
    notesWrap.appendChild(notesLabel);
    notesWrap.appendChild(buildNotesToolbar(notesArea));
    notesWrap.appendChild(notesArea);
    box.appendChild(notesWrap);
    // 注意: この翻訳ウィジェット専用のノート欄は、同じ設問/パッセージの一般ノート欄
    // (buildNotesWidget、こちらはcacheKeyそのままをキーに使う)と同じキーにしないこと。
    // 以前は同じキーを共有しており、画面上に両方のノート欄が同時に存在する状態で
    // saveAllVisibleNotes()が呼ばれると、後からDOM順で保存された方がもう一方を
    // 上書きしてしまい、一般ノート欄に書いた内容が消えてしまうバグがあった。
    restoreNotesIfSaved(notesArea, cacheKey + '-translate-notes');

    function renderCurrentMode() {
      renderTranslateColumns(contentContainer, data, mode, notesArea, slash);
    }

    modeBtn.onclick = () => { mode = mode === 'literal' ? 'natural' : 'literal'; refreshModeUI(); renderCurrentMode(); };
    wideBtn.onclick = () => { wide = !wide; box.classList.toggle('wide-mode', wide); refreshModeUI(); };
    tallBtn.onclick = () => { tall = !tall; box.classList.toggle('tall-mode', tall); refreshModeUI(); };
    slashBtn.onclick = () => { slash = !slash; refreshModeUI(); renderCurrentMode(); };

    renderCurrentMode();
  }

  async function doTranslate(forceRefresh) {
    setControlsEnabled(false);
    refetchBtn.textContent = forceRefresh ? '再取得中...' : '翻訳を再取得';
    if (!data) box.textContent = '翻訳を準備中...';
    try {
      data = await getTranslationChunks(cacheKey, text, forceRefresh);
    } catch (e) {
      box.innerHTML = `<p class="translate-error">翻訳に失敗しました: ${escapeHtml(e.message)}</p>`;
      refetchBtn.disabled = false;
      refetchBtn.textContent = '翻訳を再取得';
      return false;
    }
    refetchBtn.textContent = '翻訳を再取得';
    setControlsEnabled(true);
    return true;
  }

  // ウィジェットが作られた(=解説が表示された)時点で自動的に翻訳を取得し、
  // そのまま最初からワイド・トールモード/意訳表示で見せる。
  doTranslate(false).then(ok => { if (ok) renderChunkView(); });

  refetchBtn.addEventListener('click', async () => {
    if (await doTranslate(true)) renderChunkView();
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
  if (logoutBtn) logoutBtn.style.display = isLoggedIn() ? 'inline-block' : 'none';
}

// この端末に保存されているBoxのトークンだけを消す(box.com側のブラウザセッションは
// 別物なので、こちらは消えない)。複数のBoxアカウントを使い分けている場合に、
// 別アカウントでログインし直すために使う。
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('box_access_token');
    localStorage.removeItem('box_refresh_token');
    localStorage.removeItem('box_token_expires_at');
    audioIndexCache = null;
    statusEl.textContent = 'ログアウトしました。「Boxにログイン」から別のアカウントでログインし直せます(box.com側に前のアカウントのログインが残っている場合、そちらも別タブでログアウトしてからだと確実です)。';
    updateButtons();
  });
}

// 「ログイン済み」の判定はアプリが保存しているトークンの有無で行っているため、
// ブラウザのbox.com側のログイン状態(Cookie)とは無関係。複数のBoxアカウントを
// 使い分けている場合に「実際どのアカウントに繋がっているか」が分かるよう、
// ログイン中は/users/meで現在のアカウントのメールアドレスも取得して表示する。
async function updateStatus() {
  if (!isLoggedIn()) {
    statusEl.textContent = '未ログインです。';
    updateButtons();
    return;
  }
  statusEl.textContent = 'Boxにログイン済みです。(アカウント確認中...)';
  updateButtons();
  try {
    const token = await getValidAccessToken();
    const res = await fetch('https://api.box.com/2.0/users/me?fields=name,login', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const me = await res.json();
      statusEl.textContent = `Boxにログイン済みです。(アカウント: ${me.login || me.name || '不明'})`;
    } else {
      statusEl.textContent = 'Boxにログイン済みです。(アカウント情報の取得に失敗しました)';
    }
  } catch (e) {
    statusEl.textContent = 'Boxにログイン済みです。(アカウント情報の取得に失敗しました)';
  }
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
  let guard = 0;
  for (;;) {
    guard++;
    // 何らかの理由でtotal_countが正しく取得できずループが終わらない場合の保険。
    if (guard > 50) throw new Error('音声ファイル一覧の取得回数が上限を超えました');
    const res = await fetch(
      `https://api.box.com/2.0/folders/${AUDIO_FOLDER_ID}/items?fields=name&limit=200&offset=${offset}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new Error(`音声ファイル一覧の取得に失敗しました(フォルダID:${AUDIO_FOLDER_ID} / HTTP ${res.status}) ${bodyText.slice(0, 500)}`);
    }
    const data = await res.json();
    if (!data.entries || data.entries.length === 0) break;
    data.entries.forEach(e => { map[e.name] = e.id; });
    offset += data.entries.length;
    if (offset >= data.total_count) break;
  }
  // 一覧が0件のまま終わった場合、個々のファイルを「見つかりません」と曖昧に
  // 表示するより、この時点でまとめてエラーにした方が原因が分かりやすい
  // (Boxフォルダへのアクセス権が無い、フォルダIDが違う等の可能性が高いため)。
  if (Object.keys(map).length === 0) {
    throw new Error('音声ファイル一覧が0件でした(Box側のフォルダへのアクセス権をご確認ください)');
  }
  audioIndexCache = map;
  return map;
}

// 直近のgetAudioUrl()失敗理由(画面にエラーメッセージを出すために呼び出し元が
// nullを受け取った直後に読む)。会社のネットワークでBoxからのファイルダウンロード
// だけがブロックされている、といったケースを利用者自身が気づけるようにするため。
let lastAudioError = '';
const audioUrlCache = {};
async function getAudioUrl(filename) {
  lastAudioError = '';
  if (audioUrlCache[filename]) return audioUrlCache[filename];
  try {
    const index = await getAudioIndex();
    const id = index[filename];
    if (!id) { lastAudioError = `音声ファイルが見つかりませんでした(${filename})。(一覧の総数: ${Object.keys(index).length}件)`; return null; }
    const token = await getValidAccessToken();
    const res = await fetch(`https://api.box.com/2.0/files/${id}/content`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      lastAudioError = `音声のダウンロードに失敗しました(HTTP ${res.status})。会社のネットワークがBoxからのファイルダウンロードをブロックしている可能性があります。`;
      return null;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    audioUrlCache[filename] = url;
    return url;
  } catch (e) {
    lastAudioError = `音声の取得中にエラーが発生しました(${e.message})。ネットワーク環境をご確認ください。`;
    return null;
  }
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

// 話者の国籍(小さい国旗画像)+性別(M/W)のバッジを作る。speakersは単一の
// {nat,gender}、または複数(質問者→応答者など)の配列を渡せる。国旗は画像4種類
// (images/flags/gb,us,ca,au.svg)のみを使い回すので、表示コストはごく小さい。
function buildSpeakerBadges(speakers) {
  const list = Array.isArray(speakers) ? speakers : [speakers];
  const wrap = document.createElement('span');
  wrap.className = 'speaker-badges';
  list.forEach((s, i) => {
    if (!s || !s.nat) return;
    if (i > 0) {
      const arrow = document.createElement('span');
      arrow.className = 'speaker-arrow';
      arrow.textContent = '→';
      wrap.appendChild(arrow);
    }
    const badge = document.createElement('span');
    badge.className = 'speaker-badge';
    const img = document.createElement('img');
    img.src = `images/flags/${s.nat}.svg`;
    img.alt = s.nat;
    img.className = 'speaker-flag';
    const gender = document.createElement('span');
    gender.className = 'speaker-gender';
    gender.textContent = s.gender || '';
    badge.appendChild(img);
    badge.appendChild(gender);
    wrap.appendChild(badge);
  });
  return wrap;
}

// Part1/2/3/4の問題画面用の常設プレーヤー(シャドーイングと同じ▶/❚❚+進捗バー表示)。
// 「音声を再生」ボタンを押して初めてプレーヤーが現れる、という中間ステップを無くし、
// 最初からこの表示のままにする。filenamesは複数渡すと連続再生する(Part3/4の会話→設問)。
function createAudioPlayerWidget(filenames, { autoplay = false, sticky = false } = {}) {
  const list = (Array.isArray(filenames) ? filenames : [filenames]).filter(Boolean);
  let currentAudio = null;

  const player = document.createElement('div');
  player.className = 'audio-player' + (sticky ? ' audio-player-sticky' : '');
  const restartBtn = document.createElement('button');
  restartBtn.className = 'player-restart';
  restartBtn.textContent = '⏮';
  restartBtn.title = '初めから再生';
  const back5Btn = document.createElement('button');
  back5Btn.className = 'player-back5';
  back5Btn.textContent = '-5s';
  back5Btn.title = '5秒戻る';
  back5Btn.addEventListener('click', () => {
    if (currentAudio) currentAudio.currentTime = Math.max(0, currentAudio.currentTime - 5);
  });
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'player-toggle';
  toggleBtn.textContent = '▶';
  // 問題文(先頭トラック)だけを繰り返し再生するボタン。設問トラックがある場合は
  // そちらへは進んだ後ループしない(問題文のみ繰り返す)。
  let loopFirst = false;
  const loopBtn = document.createElement('button');
  loopBtn.className = 'player-loop';
  loopBtn.textContent = '↻';
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

  // ---- 再生速度(0.6〜2.0倍、0.1刻み) ----
  let playbackRate = 1.0;
  const rateWrap = document.createElement('span');
  rateWrap.className = 'player-rate';
  const rateDownBtn = document.createElement('button');
  rateDownBtn.type = 'button';
  rateDownBtn.className = 'player-rate-btn';
  rateDownBtn.textContent = '◀';
  rateDownBtn.title = '再生速度を下げる';
  const rateLabel = document.createElement('span');
  rateLabel.className = 'player-rate-label';
  const rateUpBtn = document.createElement('button');
  rateUpBtn.type = 'button';
  rateUpBtn.className = 'player-rate-btn';
  rateUpBtn.textContent = '▶';
  rateUpBtn.title = '再生速度を上げる';
  function applyRate() {
    rateLabel.textContent = playbackRate.toFixed(1);
    if (currentAudio) currentAudio.playbackRate = playbackRate;
    rateDownBtn.disabled = playbackRate <= 0.6;
    rateUpBtn.disabled = playbackRate >= 2.0;
  }
  rateDownBtn.addEventListener('click', () => {
    playbackRate = Math.max(0.6, Math.round((playbackRate - 0.1) * 10) / 10);
    applyRate();
  });
  rateUpBtn.addEventListener('click', () => {
    playbackRate = Math.min(2.0, Math.round((playbackRate + 0.1) * 10) / 10);
    applyRate();
  });
  rateWrap.appendChild(rateDownBtn);
  rateWrap.appendChild(rateLabel);
  rateWrap.appendChild(rateUpBtn);
  applyRate();

  // 現在時刻+シークバー+合計時間をまとめておく(スマホ幅では.player-track-rowごと
  // 折り返して1行まるごと使い、シークバーを操作しやすい太さで表示するため)。
  const trackRow = document.createElement('div');
  trackRow.className = 'player-track-row';
  trackRow.appendChild(curTimeEl);
  trackRow.appendChild(trackEl);
  trackRow.appendChild(totalTimeEl);

  player.appendChild(restartBtn);
  player.appendChild(back5Btn);
  player.appendChild(toggleBtn);
  player.appendChild(loopBtn);
  player.appendChild(trackRow);
  player.appendChild(rateWrap);

  // 再生に失敗した場合、無言で止まる代わりに理由を表示する(会社のネットワークで
  // ダウンロードだけブロックされている、といった状況に利用者自身が気づけるように)。
  const errorEl = document.createElement('div');
  errorEl.className = 'audio-player-error';
  errorEl.style.display = 'none';
  const outerWrap = document.createElement('div');
  outerWrap.appendChild(player);
  outerWrap.appendChild(errorEl);

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

  // iOS(iPad/iPhone。Chromeで開いても中身はSafariと同じエンジン)は、タップ操作から
  // 間に通信(await)を挟んでからplay()を呼ぶと「ユーザー操作に紐付いていない」と
  // みなして再生をブロックすることがある。この音声プレーヤーは再生前に毎回Box側へ
  // 音声取得の通信を挟むため、この制限に引っかかりやすい。対策として、タップした
  // その場でまず空のAudio要素に対してplay()を一度呼んでおき(primedAudio)、通信完了後は
  // 新しいAudio要素を作らずこの同じ要素にsrcを設定してplay()し直す(iOSはタップ済みの
  // 同じ要素であれば、後から遅れてのplay()も許可する)。
  async function playIndex(i, primedAudio) {
    if (i >= list.length) { currentAudio = null; resetUI(); return; }
    toggleBtn.disabled = true;
    errorEl.style.display = 'none';
    const url = await getAudioUrl(list[i]);
    toggleBtn.disabled = false;
    if (!url) {
      errorEl.textContent = '⚠ ' + (lastAudioError || '音声の読み込みに失敗しました。');
      errorEl.style.display = 'block';
      resetUI();
      return;
    }
    currentAudio = primedAudio || new Audio();
    currentAudio.src = url;
    currentAudio.playbackRate = playbackRate;
    globalAudio.current = currentAudio;
    attachEvents(currentAudio);
    currentAudio.addEventListener('ended', () => {
      if (i === 0 && loopFirst) playIndex(0);
      else playIndex(i + 1);
    });
    currentAudio.play().then(() => {
      toggleBtn.textContent = '❚❚';
    }).catch(() => {
      errorEl.textContent = '⚠ 音声の再生がブロックされました。もう一度▶ボタンを押してください。';
      errorEl.style.display = 'block';
      resetUI();
    });
  }

  function playFromStart() {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    resetUI();
    const primed = new Audio();
    primed.play().catch(() => {});
    playIndex(0, primed);
  }

  toggleBtn.addEventListener('click', () => {
    if (currentAudio && !currentAudio.paused) {
      currentAudio.pause();
      toggleBtn.textContent = '▶';
    } else if (currentAudio) {
      currentAudio.play().then(() => { toggleBtn.textContent = '❚❚'; }).catch(() => {});
    } else {
      playFromStart();
    }
  });
  restartBtn.addEventListener('click', () => playFromStart());

  if (autoplay && list.length) playFromStart();

  return outerWrap;
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

// ---------- 公式PDF(解答・解説p.123以降)の該当ページ画像を表示するボタン ----------
// data/test1(2)/pdfExplain.jsonは、設問番号→その解説が載っているページ画像(前後1ページ
// ずつを含む最大3ページ)へのマッピング。ページ単位の画像なので、同じページに他の設問の
// 解説が写り込むことがある(設問1問だけを厳密に切り出した画像ではない点に注意)。
const pdfExplainMapCache = {};
async function loadPdfExplainMap(test) {
  if (pdfExplainMapCache[test]) return pdfExplainMapCache[test];
  try {
    const res = await fetch(`data/${test === 'T1' ? 'test1' : 'test2'}/pdfExplain.json`);
    if (!res.ok) return null;
    const json = await res.json();
    pdfExplainMapCache[test] = json;
    return json;
  } catch (e) { return null; }
}

function buildPdfExplainWidget(test, questionNumber) {
  const wrap = document.createElement('div');
  wrap.className = 'pdf-explain-wrap';
  const btn = document.createElement('button');
  btn.className = 'mode-toggle-btn';
  btn.textContent = 'PDF解説文へ';
  wrap.appendChild(btn);

  const imgsWrap = document.createElement('div');
  imgsWrap.className = 'pdf-explain-images';
  imgsWrap.style.display = 'none';
  wrap.appendChild(imgsWrap);

  let shown = false;
  btn.addEventListener('click', async () => {
    if (shown) {
      imgsWrap.style.display = 'none';
      btn.textContent = 'PDF解説文へ';
      shown = false;
      return;
    }
    if (!imgsWrap.dataset.loaded) {
      btn.disabled = true;
      const map = await loadPdfExplainMap(test);
      btn.disabled = false;
      const files = map && map[String(questionNumber)];
      imgsWrap.innerHTML = '';
      if (files && files.length) {
        files.forEach(src => {
          const img = document.createElement('img');
          img.src = src;
          img.className = 'pdf-explain-img';
          imgsWrap.appendChild(img);
        });
      } else {
        const p = document.createElement('p');
        p.className = 'hint';
        p.textContent = 'このテストのPDF解説はまだ用意されていません。';
        imgsWrap.appendChild(p);
      }
      imgsWrap.dataset.loaded = '1';
    }
    imgsWrap.style.display = 'block';
    btn.textContent = 'PDF解説文を閉じる';
    shown = true;
  });

  return wrap;
}

// ---------- ナビゲーション状態 ----------

const state = { test: null, part: null, data: null, index: 0 };

// 回答履歴の「解説を見る」から飛んできた場合にtrueにする。各Partのrender関数が
// これを見て、正解の選択肢を自動でクリック→採点まで自動で進め、解説をすぐ
// 表示する(素の問題画面だけでは意味が無いため)。一度使ったら必ずfalseに戻す。
let pendingAutoReveal = false;

const practiceEl = document.getElementById('practice');
const emptyStateEl = document.getElementById('empty-state');
const practiceBodyEl = document.getElementById('practice-body');
const partOverviewEl = document.getElementById('part-overview');
const partOverviewBodyEl = document.getElementById('partOverviewBody');
const progressLabelEl = document.getElementById('progress-label');
const appModeSelectEl = document.getElementById('appModeSelect');

// ---------- 上部固定ヘッダーの高さをCSS変数に反映(Part2/3/4の音声プレーヤーを
// その直下にstickyで貼り付けるため、実際の高さを都度measureする) ----------

const stickyTopEl = document.querySelector('.sticky-top');
function updateStickyTopHeight() {
  if (!stickyTopEl) return;
  document.documentElement.style.setProperty('--sticky-top-h', stickyTopEl.offsetHeight + 'px');
}
updateStickyTopHeight();
window.addEventListener('resize', updateStickyTopHeight);

// ---------- ストップウォッチ(問題画面の上部ナビ行の右端。設問が変わるたびリセットして自動計測開始) ----------

const stopwatchTimeEl = document.getElementById('stopwatchTime');
const stopwatchToggleBtn = document.getElementById('stopwatchToggleBtn');
let stopwatchSeconds = 0;
let stopwatchInterval = null;
let stopwatchPaused = false;

function formatStopwatch(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function resetAndStartStopwatch() {
  clearInterval(stopwatchInterval);
  stopwatchSeconds = 0;
  stopwatchPaused = false;
  stopwatchTimeEl.textContent = '0:00';
  stopwatchToggleBtn.textContent = '⏸';
  stopwatchInterval = setInterval(() => {
    stopwatchSeconds++;
    stopwatchTimeEl.textContent = formatStopwatch(stopwatchSeconds);
  }, 1000);
}

stopwatchToggleBtn.addEventListener('click', () => {
  stopwatchPaused = !stopwatchPaused;
  if (stopwatchPaused) {
    clearInterval(stopwatchInterval);
    stopwatchInterval = null;
    stopwatchToggleBtn.textContent = '▶';
  } else {
    stopwatchInterval = setInterval(() => {
      stopwatchSeconds++;
      stopwatchTimeEl.textContent = formatStopwatch(stopwatchSeconds);
    }, 1000);
    stopwatchToggleBtn.textContent = '⏸';
  }
});

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
// 各キーは {count, lastCorrect, lastAt} で保持する(以前はcountだけの数値だったので、
// 古い数値形式が残っていても壊れないように読み替える。lastAtは回答履歴欄の並び順用に
// 後から追加したフィールドなので、それ以前の記録には無い=0として扱う)。
function normalizeAttemptRaw(raw) {
  if (raw == null) return { count: 0, lastCorrect: null, lastAt: 0, noteKey: null };
  if (typeof raw === 'number') return { count: raw, lastCorrect: null, lastAt: 0, noteKey: null };
  return { count: raw.count || 0, lastCorrect: raw.lastCorrect == null ? null : !!raw.lastCorrect, lastAt: raw.lastAt || 0, noteKey: raw.noteKey || null };
}
function getAttemptEntry(key) {
  return normalizeAttemptRaw(getAttemptsStore()[key]);
}
function getAttemptCount(key) {
  return getAttemptEntry(key).count;
}
// noteKeyは、Part3/4/6/7のようにグループ(パッセージ)単位で1つのノートを共有する
// Partで、そのグループのノートが保存されているキー(buildNotesWidgetに渡している
// ものと同じ)を渡す。省略時(Part1/2/5の単独設問)はkeyと同じとみなす。
function incrementAttempt(key, isCorrect, noteKey) {
  const store = getAttemptsStore();
  const prev = getAttemptEntry(key);
  store[key] = { count: Math.min(99, prev.count + 1), lastCorrect: isCorrect == null ? prev.lastCorrect : !!isCorrect, lastAt: Date.now(), noteKey: noteKey || prev.noteKey || null };
  localStorage.setItem(ATTEMPTS_LS, JSON.stringify(store));
  recordStudyActivity();
  recordDailyQuestion(key, isCorrect);
}
function setAttemptCount(key, value) {
  const store = getAttemptsStore();
  const prev = getAttemptEntry(key);
  store[key] = { count: Math.max(0, Math.min(99, value)), lastCorrect: prev.lastCorrect, lastAt: prev.lastAt, noteKey: prev.noteKey };
  localStorage.setItem(ATTEMPTS_LS, JSON.stringify(store));
}
// Part6/7では挑戦回数(count)はパッセージ単位で共有するが、正誤の色分けは設問
// ごとに分けたいので、countには触れずlastCorrectだけを別キーに記録する。
function recordCorrectness(key, isCorrect, noteKey) {
  const store = getAttemptsStore();
  const prev = getAttemptEntry(key);
  store[key] = { count: prev.count, lastCorrect: !!isCorrect, lastAt: Date.now(), noteKey: noteKey || prev.noteKey || null };
  localStorage.setItem(ATTEMPTS_LS, JSON.stringify(store));
}

// ---------- 回答履歴欄(トップ画面右カラム。解いた設問を、解いた順(直近が上)に一覧) ----------
// キーの形式は2種類:
//  - "T1-3-45" のような素のキー: Part1〜5は設問ごとの直接記録。Part6/7では
//    パッセージ単位(先頭設問番号)の挑戦回数カウンタなので、ここでは対象外にする。
//  - "T1-6-45-correct" のように末尾に-correctが付くキー: Part6/7の設問ごとの正誤記録。
function parseAttemptKey(key) {
  const correctMatch = key.match(/^(T[12])-(\d)-(\d+)-correct$/);
  if (correctMatch) return { test: correctMatch[1], part: Number(correctMatch[2]), number: Number(correctMatch[3]), perQuestion: true };
  const plainMatch = key.match(/^(T[12])-(\d)-(\d+)$/);
  if (plainMatch) return { test: plainMatch[1], part: Number(plainMatch[2]), number: Number(plainMatch[3]), perQuestion: Number(plainMatch[2]) <= 5 };
  return null;
}

function buildAnswerHistoryList() {
  const store = getAttemptsStore();
  const items = [];
  Object.keys(store).forEach(key => {
    const parsed = parseAttemptKey(key);
    if (!parsed || !parsed.perQuestion) return;
    const entry = normalizeAttemptRaw(store[key]);
    items.push({
      key,
      test: parsed.test, part: parsed.part, number: parsed.number,
      lastCorrect: entry.lastCorrect, lastAt: entry.lastAt,
      noteKey: entry.noteKey || `${parsed.test}-${parsed.part}-${parsed.number}`
    });
  });
  // lastAtが新しい順(降順)。lastAtを持たない古い記録(0)同士は、記録日時が
  // 分からないぶんTest→Part→問題番号の降順に揃えて並べる(全体として常に降順に見えるように)。
  items.sort((a, b) => {
    if (b.lastAt !== a.lastAt) return b.lastAt - a.lastAt;
    if (a.test !== b.test) return b.test.localeCompare(a.test);
    if (a.part !== b.part) return b.part - a.part;
    return b.number - a.number;
  });
  return items;
}

const JP_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
function formatHistoryDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}${JP_WEEKDAYS[d.getDay()]}`;
}

// ---------- 解説画面(設問コーナー)用の、そのグループ内設問だけの回答履歴欄 ----------
// トップ画面の履歴欄と違い、削除・ノートポップアップは無く、問題番号・前回の日時・
// 前回○×だけを表示する簡易版。Part3/4/6/7の解説画面で、翻訳欄の下・設問コーナーの
// 右に添える。

function buildGroupHistorySidebar(test, questionNumbers) {
  const items = buildAnswerHistoryList()
    .filter(it => it.test === test && questionNumbers.includes(it.number))
    .sort((a, b) => a.number - b.number);

  const box = document.createElement('div');
  box.className = 'group-history-sidebar';
  const title = document.createElement('div');
  title.className = 'group-history-sidebar-title';
  title.textContent = '解答履歴';
  box.appendChild(title);

  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'group-history-sidebar-empty';
    empty.textContent = 'まだ記録がありません。';
    box.appendChild(empty);
    return box;
  }
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'group-history-sidebar-row';
    const num = document.createElement('span');
    num.className = 'group-history-sidebar-num';
    num.textContent = `Q${item.number}`;
    const date = document.createElement('span');
    date.className = 'group-history-sidebar-date';
    date.textContent = formatHistoryDate(item.lastAt);
    const badge = document.createElement('span');
    badge.className = 'group-history-sidebar-badge ' + (item.lastCorrect === true ? 'correct' : item.lastCorrect === false ? 'wrong' : 'unknown');
    badge.textContent = item.lastCorrect === true ? '○' : item.lastCorrect === false ? '×' : '-';
    row.appendChild(num);
    row.appendChild(date);
    row.appendChild(badge);
    box.appendChild(row);
  });
  return box;
}

// blocksContainer(設問コーナー本体)の右にbuildGroupHistorySidebar()を並べた
// 2カラムのラッパーを作って返す。呼び出し側は、今までwrapへ直接ブロックを
// appendしていた代わりに、この関数が返す要素をwrapへappendする。
function wrapWithGroupHistorySidebar(blocksContainer, test, questionNumbers) {
  const row = document.createElement('div');
  row.className = 'question-corner-layout';
  blocksContainer.classList.add('question-corner-main');
  row.appendChild(blocksContainer);
  row.appendChild(buildGroupHistorySidebar(test, questionNumbers));
  return row;
}

// 履歴欄の項目にマウスオーバーしたとき、その設問(が属するパッセージ)のノートが
// あれば大きめのポップアップで表示する。chunk-popupとは別の専用ポップアップを使う。
// マウスオーバーだけだと少し動いただけで消えてしまうため、左クリックで「固定」でき、
// 固定中はマウスが離れても消えず、もう一度クリックする(または他をクリックする)まで残る。
const historyNotePopupEl = document.createElement('div');
historyNotePopupEl.className = 'history-note-popup';
document.body.appendChild(historyNotePopupEl);
let historyPopupPinnedRow = null;

// 任意のCSS色文字列(hex/rgb/色名など何でも)を実際のRGB値に変換する。ブラウザの
// 色解決機構(getComputedStyle)にそのまま任せるのが最も確実。
function parseCssColorToRgb(colorStr) {
  const probe = document.createElement('span');
  probe.style.color = colorStr;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color; // "rgb(r, g, b)" 等
  document.body.removeChild(probe);
  const m = computed.match(/\d+/g);
  return m ? m.slice(0, 3).map(Number) : null;
}

// 色を白寄りに混ぜて明るくする(amount=0で元の色のまま、1で真っ白)。色相(赤・青・
// 緑といった色の種類)は保ったまま明るさだけ上げる。
function lightenTowardWhite([r, g, b], amount) {
  return [r, g, b].map(c => Math.round(c + (255 - c) * amount));
}

// ノート欄(明るい背景が前提)で書いた文字色を、そのまま暗い背景のポップアップに
// 持ってくると、黒や赤字・青字ツールバーの赤・青、ノートの引用文の緑なども背景に
// 沈んで見えにくくなる。ポップアップに表示する直前に、暗い背景での輝度が十分でない
// 指定色(inline style/font color属性どちらも)を、色相を保ったまま白寄りに明るく
// 変換する(黒に近いほど強く明るくする)。既に十分明るい色はそのまま残す。
function sanitizeNoteHtmlForDarkPopup(html) {
  const container = document.createElement('div');
  container.innerHTML = html;
  container.querySelectorAll('[style*="color"], font[color]').forEach(el => {
    const raw = el.style.color || el.getAttribute('color');
    if (!raw) return;
    const rgb = parseCssColorToRgb(raw);
    if (!rgb) return;
    const [r, g, b] = rgb;
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const targetLuminance = 0.72;
    if (luminance < targetLuminance) {
      // 暗いほど強く白を混ぜ、明るいほど混ぜる量を控えめにする。
      const amount = Math.min(0.75, Math.max(0.35, (targetLuminance - luminance) / targetLuminance));
      const [lr, lg, lb] = lightenTowardWhite([r, g, b], amount);
      el.style.color = `rgb(${lr}, ${lg}, ${lb})`;
      el.removeAttribute('color');
    }
  });
  return container.innerHTML;
}

function showHistoryNotePopup(anchorEl, noteHtml, onViewExplain) {
  historyNotePopupEl.innerHTML = sanitizeNoteHtmlForDarkPopup(noteHtml);
  if (onViewExplain) {
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'history-note-popup-link';
    link.textContent = '解説を見る →';
    link.addEventListener('click', e => {
      e.stopPropagation();
      hideHistoryNotePopup();
      onViewExplain();
    });
    historyNotePopupEl.appendChild(link);
  }
  const rect = anchorEl.getBoundingClientRect();
  // 右カラム(履歴欄)のすぐ左側に、右端をそろえて表示する(ポップアップ自体の
  // 幅が大きいので、アンカーからの左オフセット固定ではなく画面右端基準で置く)。
  historyNotePopupEl.style.left = 'auto';
  historyNotePopupEl.style.right = Math.max(8, window.innerWidth - rect.left + 12) + 'px';
  historyNotePopupEl.style.top = Math.max(8, rect.top + window.scrollY - 8) + 'px';
  historyNotePopupEl.classList.add('show');
}
function hideHistoryNotePopup() {
  historyPopupPinnedRow = null;
  historyNotePopupEl.classList.remove('show');
}
document.addEventListener('click', e => {
  if (historyPopupPinnedRow && !historyNotePopupEl.contains(e.target) && !e.target.closest('.history-item')) {
    hideHistoryNotePopup();
  }
});

// 履歴欄の右端の×から呼ぶ削除確認ポップアップ。挑戦記録(ATTEMPTS_LS内のそのキー)
// だけを消し、ノート本文には触れない(ノートは残す)。
const historyDeleteConfirmEl = document.createElement('div');
historyDeleteConfirmEl.className = 'history-delete-confirm';
document.body.appendChild(historyDeleteConfirmEl);

function hideDeleteConfirm() {
  historyDeleteConfirmEl.classList.remove('show');
}
function showDeleteConfirm(anchorEl, onConfirm) {
  historyDeleteConfirmEl.innerHTML = '';
  const text = document.createElement('div');
  text.className = 'history-delete-confirm-text';
  text.textContent = 'この回答記録を削除しますか?';
  const actions = document.createElement('div');
  actions.className = 'history-delete-confirm-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'history-delete-confirm-cancel';
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.addEventListener('click', hideDeleteConfirm);
  const okBtn = document.createElement('button');
  okBtn.type = 'button';
  okBtn.className = 'history-delete-confirm-ok';
  okBtn.textContent = '消去';
  okBtn.addEventListener('click', () => { hideDeleteConfirm(); onConfirm(); });
  actions.appendChild(cancelBtn);
  actions.appendChild(okBtn);
  historyDeleteConfirmEl.appendChild(text);
  historyDeleteConfirmEl.appendChild(actions);
  const rect = anchorEl.getBoundingClientRect();
  historyDeleteConfirmEl.style.left = Math.max(8, rect.left - 150) + 'px';
  historyDeleteConfirmEl.style.top = (rect.bottom + window.scrollY + 6) + 'px';
  historyDeleteConfirmEl.classList.add('show');
}
document.addEventListener('click', e => {
  if (!historyDeleteConfirmEl.contains(e.target) && !e.target.closest('.history-item-delete')) {
    hideDeleteConfirm();
  }
});

function deleteAttemptEntry(key) {
  const store = getAttemptsStore();
  delete store[key];
  localStorage.setItem(ATTEMPTS_LS, JSON.stringify(store));
}

function renderHistorySidebar() {
  const listEl = document.getElementById('historySidebarList');
  if (!listEl) return;
  const items = buildAnswerHistoryList();
  listEl.innerHTML = '';
  historyPopupPinnedRow = null;
  hideHistoryNotePopup();
  hideDeleteConfirm();
  if (!items.length) {
    listEl.innerHTML = '<p class="history-sidebar-empty">まだ解いた問題がありません。</p>';
    return;
  }
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'history-item';
    const label = document.createElement('span');
    label.className = 'history-item-label';
    label.textContent = `${item.test} P${item.part} Q${item.number}`;
    const dateEl = document.createElement('span');
    dateEl.className = 'history-item-date';
    dateEl.textContent = formatHistoryDate(item.lastAt);
    const badge = document.createElement('span');
    badge.className = 'history-item-badge ' + (item.lastCorrect === true ? 'correct' : item.lastCorrect === false ? 'wrong' : 'unknown');
    badge.textContent = item.lastCorrect === true ? '○' : item.lastCorrect === false ? '×' : '-';
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'history-item-delete';
    deleteBtn.title = 'この記録を削除';
    deleteBtn.textContent = '×';
    deleteBtn.addEventListener('click', e => {
      e.stopPropagation();
      showDeleteConfirm(deleteBtn, () => {
        deleteAttemptEntry(item.key);
        renderHistorySidebar();
      });
    });
    row.appendChild(label);
    row.appendChild(dateEl);
    row.appendChild(badge);
    row.appendChild(deleteBtn);
    // 一般ノート欄・翻訳ウィジェット内の専用ノート欄・「AIに質問する」欄の3つを
    // チェックし、あるものだけラベル付きでまとめて表示する。「AIに質問する」欄は
    // Part3/4/6/7でもグループ単位ではなく設問ごとの個別キー(noteKeyとは別)で
    // 保存されているので、test-part-numberから組み立てる。Part7は1パッセージに
    // 複数文書(最大3つ)あり、それぞれ翻訳ウィジェットのキーに-doc0/-doc1/-doc2の
    // 接尾辞が付くので、接尾辞なし・あり(0〜2)を全部チェックしてまとめる。
    const generalNote = localStorage.getItem(NOTES_LS_PREFIX + item.noteKey);
    const translateNote = ['', '-doc0', '-doc1', '-doc2']
      .map(suffix => localStorage.getItem(NOTES_LS_PREFIX + item.noteKey + suffix + '-translate-notes'))
      .filter(h => h && h.trim())
      .join('<hr>');
    const aiNote = localStorage.getItem(NOTES_LS_PREFIX + `${item.test}-${item.part}-${item.number}-ai`);
    const noteSections = [
      { label: 'ノート', html: generalNote },
      { label: '翻訳ウィジェットのノート', html: translateNote },
      { label: 'AIへの質問', html: aiNote }
    ].filter(s => s.html && s.html.trim());
    const noteHtml = noteSections
      .map(s => `<div class="history-note-popup-label">${s.label}</div>${s.html}`)
      .join('<hr>');
    if (noteHtml) {
      const onViewExplain = () => jumpToQuestionNumber(item.test, item.part, item.number, true);
      row.classList.add('has-note');
      row.addEventListener('mouseenter', () => {
        if (!historyPopupPinnedRow) showHistoryNotePopup(row, noteHtml, onViewExplain);
      });
      row.addEventListener('mouseleave', () => {
        if (historyPopupPinnedRow !== row) hideHistoryNotePopup();
      });
      row.addEventListener('click', () => {
        if (historyPopupPinnedRow === row) {
          hideHistoryNotePopup();
        } else {
          historyPopupPinnedRow = row;
          showHistoryNotePopup(row, noteHtml, onViewExplain);
        }
      });
    }
    listEl.appendChild(row);
  });
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

// ---------- 日別の学習内容ログ(コーチメッセージ用) ----------
// 「前日」に固定すると勉強しない日があるとヒットしなくなるため、記録がある日付の
// うち今日より前で一番新しい日を対象にする(dayCounts/daySecondsとは別に、
// どの問題に取り組んだかをこちらに記録する)。

const DAILY_QUESTIONS_LS = 'toeicOfficialPractice.dailyQuestions';

function getDailyQuestionsLog() {
  try { return JSON.parse(localStorage.getItem(DAILY_QUESTIONS_LS) || '{}'); }
  catch (e) { return {}; }
}

function recordDailyQuestion(key, isCorrect) {
  const log = getDailyQuestionsLog();
  const dateKey = localDateKey();
  if (!log[dateKey]) log[dateKey] = {};
  log[dateKey][key] = isCorrect == null ? null : !!isCorrect;
  try { localStorage.setItem(DAILY_QUESTIONS_LS, JSON.stringify(log)); } catch (e) { /* 保存容量オーバー等は無視 */ }
}

function getMostRecentStudyDateKey() {
  const log = getDailyQuestionsLog();
  const today = localDateKey();
  const dates = Object.keys(log).filter(d => d < today && Object.keys(log[d]).length > 0).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

function stripHtmlToText(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  return (div.textContent || '').replace(/\s+/g, ' ').trim();
}

// ---------- AIコーチメッセージ(1日1回、その日初めてトップを開いた時に自動生成) ----------

const COACH_HISTORY_LS = 'toeicOfficialPractice.coachHistory';

function getCoachHistory() {
  try { return JSON.parse(localStorage.getItem(COACH_HISTORY_LS) || '{}'); }
  catch (e) { return {}; }
}

function saveCoachHistoryEntry(generatedDateKey, entry) {
  const history = getCoachHistory();
  history[generatedDateKey] = entry;
  try { localStorage.setItem(COACH_HISTORY_LS, JSON.stringify(history)); } catch (e) { /* 保存容量オーバー等は無視 */ }
}

// ---------- 進捗データ(回答履歴・学習時間・連続日数・コーチ履歴)の端末間同期 ----------
// ノート同様、Apps Script経由でスプレッドシートの「Progress」タブに保存し、他の
// 端末を開いたときにそこから読み込んでマージする。複数端末で同時に更新される
// 可能性があるため、単純な上書きではなく「より新しい/より大きい方を残す」形で
// マージする(同期のたびに数値が二重に増えていく事故を避けるため、学習時間・
// 学習回数は加算ではなく日付ごとの最大値を採用する)。

function collectLocalProgress() {
  return {
    attempts: getAttemptsStore(),
    dailyQuestions: getDailyQuestionsLog(),
    studyLog: getStudyLog(),
    coachHistory: getCoachHistory()
  };
}

// key(設問/パッセージ単位)ごとにlastAtがより新しい方を残す。
function mergeAttempts(remote) {
  const local = getAttemptsStore();
  const merged = { ...local };
  Object.keys(remote || {}).forEach(key => {
    const r = normalizeAttemptRaw(remote[key]);
    const l = local[key] ? normalizeAttemptRaw(local[key]) : null;
    if (!l || r.lastAt > l.lastAt) merged[key] = remote[key];
  });
  try { localStorage.setItem(ATTEMPTS_LS, JSON.stringify(merged)); } catch (e) { /* ignore */ }
}

// 日付ごとに、その日取り組んだ設問キーの集合を和集合にする(値が食い違う場合は
// ローカル側を優先する。今の端末で今まさに書いた記録の方を信頼する)。
function mergeDailyQuestions(remote) {
  const local = getDailyQuestionsLog();
  const merged = {};
  const dates = new Set([...Object.keys(remote || {}), ...Object.keys(local)]);
  dates.forEach(d => { merged[d] = { ...(remote || {})[d], ...local[d] }; });
  try { localStorage.setItem(DAILY_QUESTIONS_LS, JSON.stringify(merged)); } catch (e) { /* ignore */ }
}

// daySeconds/dayCountsは日付ごとに大きい方(加算ではない。同期のたびに膨らむ事故を
// 避けるため)。totalSecondsはマージ後のdaySecondsから再計算する。
function mergeStudyLog(remote) {
  const local = getStudyLog();
  const r = remote || {};
  const daySeconds = {};
  new Set([...Object.keys(r.daySeconds || {}), ...Object.keys(local.daySeconds)]).forEach(d => {
    daySeconds[d] = Math.max((r.daySeconds || {})[d] || 0, local.daySeconds[d] || 0);
  });
  const dayCounts = {};
  new Set([...Object.keys(r.dayCounts || {}), ...Object.keys(local.dayCounts)]).forEach(d => {
    dayCounts[d] = Math.max((r.dayCounts || {})[d] || 0, local.dayCounts[d] || 0);
  });
  const totalSeconds = Object.values(daySeconds).reduce((a, b) => a + b, 0);
  const lastActivity = Math.max(r.lastActivity || 0, local.lastActivity || 0);
  try { localStorage.setItem(STUDY_LOG_LS, JSON.stringify({ daySeconds, dayCounts, totalSeconds, lastActivity })); } catch (e) { /* ignore */ }
}

// 日付ごとのコーチメッセージは、無ければ補完する程度で良い(ローカル優先)。
function mergeCoachHistory(remote) {
  const local = getCoachHistory();
  const merged = { ...(remote || {}), ...local };
  try { localStorage.setItem(COACH_HISTORY_LS, JSON.stringify(merged)); } catch (e) { /* ignore */ }
}

async function saveProgressToSheet() {
  const url = getSheetUrl();
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'saveProgress', progress: collectLocalProgress() })
    });
  } catch (e) { /* オフライン等は無視。ローカルには保存済み */ }
}

// ページ表示時に一度だけ、スプレッドシート上の進捗データを取得してローカルへ
// マージする(この端末だけの記録で終わらせず、他の端末の記録も取り込むため)。
// マージ後はローカルの状態をそのままスプレッドシートへ書き戻し、他の端末が
// 古いままにならないようにする。
async function syncProgressFromSheet() {
  const url = getSheetUrl();
  if (!url) return;
  try {
    const res = await fetch(`${url}?action=getProgress`);
    const data = await res.json();
    const remote = (data && data.progress) || {};
    mergeAttempts(remote.attempts);
    mergeDailyQuestions(remote.dailyQuestions);
    mergeStudyLog(remote.studyLog);
    mergeCoachHistory(remote.coachHistory);
    renderStatsDashboard(statsWeekOffset);
    renderHistorySidebar();
    await saveProgressToSheet();
  } catch (e) { /* ignore, ローカルのみで継続 */ }
}

const COACH_PROMPT = `あなたは、TOEIC800点を目指して勉強を続けている学習者専属のコーチです。現在の自己ベストは700点です。
以下に、学習者が直近に勉強した日の記録(取り組んだ問題数・正誤・書いたノート・AIへの質問)を渡します。これを踏まえて日本語でメッセージを書いてください。

必ず守ること:
- このメッセージは、学習者がその日の勉強を「これから始める」タイミングで読む(前回勉強した内容の振り返り)。「今日もお疲れ様でした」のような、その日の勉強が終わったことを労うトーン・締めくくりの表現は使わないこと。これから始める・取り組む学習者を送り出す・後押しするトーンにすること。
- 冒頭は必ず励ましの言葉から始めること。努力を続けていることを労い、モチベーションを支える一言にすること。
- その後、渡された記録の内容(語彙・文法・問題の話題など)に具体的に触れながら、学習者が「おそらく身についた・理解できたであろう内容」と「おそらくまだ曖昧・知らなかったであろう内容」をリマインドすること。抽象的な精神論だけで終わらせないこと。
- 説教くさくならず、専属コーチとして自然に語りかける文体にすること。
- 学習者の年齢・性別・勉強を始めてからの年数など、記録に含まれていない個人属性には一切触れないこと。
- 全体で日本語400〜500字程度に収めること。
- Markdown記号(**など)や見出し記号、箇条書き記号は使わず、プレーンテキストの文章のみを書くこと。`;

const COACH_PROMPT_NO_DATA = `あなたは、TOEIC800点を目指して勉強を続けている学習者専属のコーチです。現在の自己ベストは700点です。
今回はまだ学習記録が見当たりません(これから勉強を始める、または記録がリセットされた状態です)。このメッセージは学習者がこれから勉強を始めるタイミングで読むので、「今日もお疲れ様でした」のような締めくくりの表現は使わず、励ましの言葉から始め、今日はどんなことに取り組むと良いか軽く後押しするメッセージを、日本語300字程度で書いてください。
学習者の年齢・性別・勉強を始めてからの年数など、個人属性には一切触れないこと。
Markdown記号や見出し記号、箇条書き記号は使わず、プレーンテキストの文章のみを書くこと。`;

function buildCoachContext(studyDateKey) {
  const log = getDailyQuestionsLog();
  const dayLog = log[studyDateKey] || {};
  const keys = Object.keys(dayLog);
  const correctCount = keys.filter(k => dayLog[k] === true).length;
  const incorrectKeys = keys.filter(k => dayLog[k] === false);

  const noteLines = [];
  keys.forEach(k => {
    const note = stripHtmlToText(localStorage.getItem(NOTES_LS_PREFIX + k));
    if (note) noteLines.push(`[${k}] ${note.slice(0, 300)}`);
    const aiNote = stripHtmlToText(localStorage.getItem(NOTES_LS_PREFIX + k + '-ai'));
    if (aiNote) noteLines.push(`[${k}のAI質問履歴] ${aiNote.slice(0, 300)}`);
  });

  let text = `学習日: ${studyDateKey}\n取り組んだ問題数: ${keys.length}問(正解 ${correctCount} / 不正解 ${incorrectKeys.length})\n`;
  if (incorrectKeys.length) text += `不正解だった問題番号: ${incorrectKeys.join(', ')}\n`;
  if (noteLines.length) text += `\n書いたノート・AIへの質問:\n${noteLines.slice(0, 20).join('\n')}`;
  return text;
}

async function generateCoachMessage() {
  const studyDateKey = getMostRecentStudyDateKey();
  if (!studyDateKey) return await callGemini(COACH_PROMPT_NO_DATA, 'まだ記録がありません。', { maxOutputTokens: 500 });
  const context = buildCoachContext(studyDateKey);
  return await callGemini(COACH_PROMPT, context, { maxOutputTokens: 700 });
}

let coachGenerationInFlight = null;

async function loadOrGenerateCoachMessage(textareaEl, statusEl) {
  const todayKey = localDateKey();
  const history = getCoachHistory();
  if (history[todayKey]) {
    textareaEl.value = history[todayKey].text;
    return;
  }
  if (!getGeminiKey() && !getGeminiPaidKey()) {
    textareaEl.value = '';
    textareaEl.placeholder = 'AIコーチを使うには、上の「設定」からGemini APIキーを入力してください。';
    return;
  }
  if (!coachGenerationInFlight) {
    statusEl.textContent = 'コーチメッセージを準備中...';
    coachGenerationInFlight = generateCoachMessage()
      .then(text => {
        saveCoachHistoryEntry(todayKey, { studiedDate: getMostRecentStudyDateKey(), text });
        return text;
      })
      .catch(e => `コーチメッセージの取得に失敗しました: ${e.message}`)
      .finally(() => { coachGenerationInFlight = null; });
  }
  const text = await coachGenerationInFlight;
  textareaEl.value = text;
  statusEl.textContent = '';
}

function buildCoachBox() {
  const box = document.createElement('div');
  box.className = 'coach-box';

  const label = document.createElement('div');
  label.className = 'coach-label';
  label.textContent = '🎯 専属コーチからのメッセージ';

  const status = document.createElement('span');
  status.className = 'coach-status';

  const labelRow = document.createElement('div');
  labelRow.className = 'coach-label-row';
  labelRow.appendChild(label);
  labelRow.appendChild(status);

  const textarea = document.createElement('textarea');
  textarea.className = 'coach-textarea';
  textarea.readOnly = true;
  textarea.rows = 6;

  // ---- 前のメッセージ/次のメッセージで過去のコーチメッセージを閲覧 ----
  const navRow = document.createElement('div');
  navRow.className = 'coach-nav';
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'coach-nav-btn coach-nav-prev';
  prevBtn.textContent = '← 前のメッセージ';
  const dateLabel = document.createElement('span');
  dateLabel.className = 'coach-nav-date';
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'coach-nav-btn coach-nav-next';
  nextBtn.textContent = '次のメッセージ →';
  navRow.appendChild(prevBtn);
  navRow.appendChild(dateLabel);
  navRow.appendChild(nextBtn);

  box.appendChild(labelRow);
  box.appendChild(textarea);
  box.appendChild(navRow);

  const todayKey = localDateKey();
  const dates = Object.keys(getCoachHistory()).sort(); // 昇順(古い→新しい)
  if (!dates.includes(todayKey)) dates.push(todayKey);
  let viewIdx = dates.length - 1; // 初期表示は最新(今日)

  function showAt(idx) {
    viewIdx = idx;
    const dateKey = dates[viewIdx];
    dateLabel.textContent = dateKey;
    prevBtn.disabled = viewIdx <= 0;
    nextBtn.disabled = viewIdx >= dates.length - 1;
    if (dateKey === todayKey) {
      loadOrGenerateCoachMessage(textarea, status);
      return;
    }
    const entry = getCoachHistory()[dateKey];
    textarea.value = entry ? entry.text : '';
    status.textContent = '';
  }

  prevBtn.addEventListener('click', () => { if (viewIdx > 0) showAt(viewIdx - 1); });
  nextBtn.addEventListener('click', () => { if (viewIdx < dates.length - 1) showAt(viewIdx + 1); });

  showAt(viewIdx);

  return box;
}

// トップ画面「学習状況」の週送り状態。0=今週、-1=先週…。ページ再読み込みで0に戻る。
let statsWeekOffset = 0;

function renderStatsDashboard(weekOffset = 0) {
  const container = document.getElementById('statsDashboard');
  if (!container) return;
  statsWeekOffset = weekOffset;
  const log = getStudyLog();
  const totalCount = Object.values(log.dayCounts).reduce((sum, c) => sum + c, 0);
  const streak = computeStreakDays(log);
  const bestStreak = computeBestStreak(log);
  const weekReference = new Date();
  weekReference.setDate(weekReference.getDate() + weekOffset * 7);
  const { dates: weekDates, dow } = getWeekDates(weekReference);
  const isCurrentWeek = weekOffset === 0;
  const todayDow = isCurrentWeek ? dow : -1;
  const daySecondsThisWeek = weekDates.map(d => log.daySeconds[localDateKey(d)] || 0);
  const weekSeconds = daySecondsThisWeek.reduce((a, b) => a + b, 0);
  const bestDaySeconds = Math.max(0, ...Object.values(log.daySeconds));
  const goalMinutes = getStudyGoalMinutes();
  const goalSeconds = goalMinutes * 60;
  const progress = Math.min(1, weekSeconds / goalSeconds);
  const fmtMD = d => `${d.getMonth() + 1}/${d.getDate()}`;
  const weekRangeLabel = `${fmtMD(weekDates[0])}〜${fmtMD(weekDates[6])}`;

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
  ringLegend.innerHTML = `<span class="legend-dot"></span>${isCurrentWeek ? '今週' : weekRangeLabel}の学習時間 <span class="legend-goal">(目標: ${escapeHtml(formatStudyTime(goalSeconds))})</span>`;
  const goalBtn = document.createElement('button');
  goalBtn.type = 'button';
  goalBtn.className = 'reveal-btn ring-goal-btn';
  goalBtn.textContent = '⚙ 目標設定';
  goalBtn.addEventListener('click', () => {
    const cur = getStudyGoalMinutes();
    const input = window.prompt(`今週の学習目標を分単位で入力してください(現在: ${formatStudyTime(cur * 60)})`, String(cur));
    if (input === null) return;
    const mins = parseInt(input, 10);
    if (!isNaN(mins) && mins > 0) {
      setStudyGoalMinutes(mins);
      renderStatsDashboard(statsWeekOffset);
    }
  });
  const ringBox = document.createElement('div');
  ringBox.className = 'week-ring-box';
  ringBox.appendChild(ringWrap);
  ringBox.appendChild(ringLegend);
  ringBox.appendChild(goalBtn);
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
      <div class="week-day-label${i === todayDow ? ' today' : ''}">${dayLabels[i]}</div>
    </div>`).join('');
  const weekCard = document.createElement('div');
  weekCard.className = 'stat-card';
  weekCard.innerHTML = `<div class="stat-card-title">📊 ${escapeHtml(isCurrentWeek ? '今週の学習状況' : `${weekRangeLabel}の学習状況`)}</div>` +
    `<div class="week-chart">${weekBarsHtml}</div><div class="stat-card-best">自己ベスト ${escapeHtml(formatStudyTime(bestDaySeconds))}</div>`;
  // ---- 週送りナビ(左:前週 / 右:次週) ----
  const weekNav = document.createElement('div');
  weekNav.className = 'week-nav';
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'week-nav-btn week-nav-prev';
  prevBtn.textContent = '← 前週';
  prevBtn.addEventListener('click', () => renderStatsDashboard(weekOffset - 1));
  const rangeLabel = document.createElement('span');
  rangeLabel.className = 'week-nav-label';
  rangeLabel.textContent = weekRangeLabel;
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'week-nav-btn week-nav-next';
  nextBtn.textContent = '次週 →';
  nextBtn.disabled = isCurrentWeek;
  nextBtn.addEventListener('click', () => { if (weekOffset < 0) renderStatsDashboard(weekOffset + 1); });
  weekNav.appendChild(prevBtn);
  weekNav.appendChild(rangeLabel);
  weekNav.appendChild(nextBtn);
  weekCard.appendChild(weekNav);
  grid.appendChild(weekCard);

  grid.appendChild(makeCard('🔥', '連続学習日数',
    `<div class="stat-card-value">${streak}日</div><div class="stat-card-best">自己ベスト ${bestStreak}日</div>`));

  top.appendChild(grid);
  container.appendChild(top);

  container.appendChild(buildCoachBox());
  container.appendChild(buildPreviousStudySection());
}

// ---------- 「前回学習した問題」欄(専属コーチメッセージの下) ----------
// 前回学習日(今日より前で一番新しい記録日)に取り組んだ設問を、パッセージ/会話単位で
// 重複排除しつつ一覧にする。Part3/4/6/7は個々の設問ではなく会話・トーク・パッセージ
// 単位で音声が1本にまとまっているため、そのグループの先頭設問番号を代表として使う。
async function resolvePreviousStudyItems() {
  const studyDateKey = getMostRecentStudyDateKey();
  if (!studyDateKey) return [];
  const log = getDailyQuestionsLog();
  const dayLog = log[studyDateKey] || {};
  const keys = Object.keys(dayLog);
  const seen = new Set();
  const items = [];
  for (const key of keys) {
    const parsed = parseAttemptKey(key);
    if (!parsed) continue;
    const { test, part, number } = parsed;
    let data;
    try { data = await loadPartData(test, part); } catch (e) { continue; }
    if (part === 1 || part === 2) {
      const q = (data.questions || []).find(x => x.number === number);
      if (!q || !q.audio) continue;
      const dedupeKey = `${test}-${part}-${number}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const text = part === 2 ? (q.question || '') : Object.values(q.statements || {}).join(' / ');
      items.push({ label: `${test} P${part} Q${number}`, text, audio: [q.audio] });
    } else if (part === 5) {
      const q = (data.questions || []).find(x => x.number === number);
      if (!q || !q.audio) continue;
      const dedupeKey = `${test}-5-${number}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      items.push({ label: `${test} P5 Q${number}`, text: q.sentence || '', audio: [q.audio] });
    } else if (part === 3 || part === 4) {
      const g = (data.groups || []).find(x => x.questions.includes(number));
      if (!g) continue;
      const audio = g.audioConversation || g.audioTalk;
      if (!audio) continue;
      const dedupeKey = `${test}-${part}-${g.questions[0]}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const text = g.conversationText || g.talkText || '';
      items.push({ label: `${test} P${part} Q${g.questions[0]}`, text, audio: [audio] });
    } else if (part === 6 || part === 7) {
      const p = (data.passages || []).find(x => x.questions.includes(number));
      if (!p || !p.audio) continue;
      const dedupeKey = `${test}-${part}-${p.questions[0]}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const text = p.text || (p.documents ? p.documents.map(d => d.text).join(' ') : '');
      items.push({ label: `${test} P${part} Q${p.questions[0]}`, text, audio: Array.isArray(p.audio) ? p.audio : [p.audio] });
    }
  }
  return items;
}

// filenamesを順番に再生する。loop=trueの場合、最後まで再生したら自動で先頭に戻って
// 繰り返す(手動で止めるか、他のstopAllAudio()呼び出しで止まるまで継続)。
// loop=falseで最後まで自然に再生し終えた場合はonEndを呼ぶ(呼び出し元でボタン表示を
// 元に戻すために使う。手動で停止した場合や他の再生に割り込まれた場合は呼ばない)。
// onErrorは1トラックでも取得に失敗した場合に理由付きで呼ばれる(無言で次へスキップ
// せず、利用者が気づけるようにするため)。
async function playStudySequence(filenames, loop, onEnd, onError) {
  stopAllAudio();
  studySequencePlaying = true;
  let idx = 0;
  async function next() {
    if (!studySequencePlaying) return;
    if (idx >= filenames.length) {
      if (!loop) { studySequencePlaying = false; if (onEnd) onEnd(); return; }
      idx = 0;
    }
    const url = await getAudioUrl(filenames[idx]);
    if (!studySequencePlaying) return;
    if (!url) {
      if (onError) onError(lastAudioError || '音声の読み込みに失敗しました。');
      idx++; next(); return;
    }
    const audio = new Audio(url);
    globalAudio.current = audio;
    audio.addEventListener('ended', () => { idx++; next(); });
    audio.play().catch(() => {});
  }
  next();
}

// 「前回学習した問題」欄: まとめて再生ボタン・各行の再生ボタンは、どれか1つを
// 押すと他は自動で止まり、押したボタン自身は再生中「■停止」表示に変わる仕組みを
// 共有する(同時に再生されるのは常に1つだけ)。activePlayCtrl本体・リセット処理は
// stopAllAudio()側(ファイル先頭)にある。
function togglePlayback(btn, filenames, loop, label, stopLabel, onError) {
  if (activePlayCtrl && activePlayCtrl.btn === btn) {
    stopAllAudio();
    return;
  }
  stopAllAudio();
  playStudySequence(filenames, loop, () => {
    if (activePlayCtrl && activePlayCtrl.btn === btn) {
      btn.textContent = label;
      btn.classList.remove('is-playing');
      activePlayCtrl = null;
    }
  }, onError);
  btn.textContent = stopLabel;
  btn.classList.add('is-playing');
  activePlayCtrl = { btn, label };
}

// 「前回学習した問題」の各行にマウスオーバー(またはクリックで固定)すると出る、
// 問題文全文のポップアップ。
const prevStudyPopupEl = document.createElement('div');
prevStudyPopupEl.className = 'prev-study-popup';
document.body.appendChild(prevStudyPopupEl);
let prevStudyPinnedEl = null;
function hidePrevStudyPopup() {
  prevStudyPopupEl.classList.remove('show');
  prevStudyPinnedEl = null;
}
function showPrevStudyPopup(anchorEl, text) {
  prevStudyPopupEl.textContent = text;
  const rect = anchorEl.getBoundingClientRect();
  prevStudyPopupEl.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 570)) + 'px';
  prevStudyPopupEl.style.top = (rect.bottom + window.scrollY + 6) + 'px';
  prevStudyPopupEl.classList.add('show');
}
document.addEventListener('click', e => {
  if (!prevStudyPopupEl.contains(e.target) && !e.target.closest('.prev-study-text')) hidePrevStudyPopup();
});

function buildPreviousStudySection() {
  const box = document.createElement('div');
  box.className = 'prev-study-box';

  // ---- ヘッダー行: 左にラベル、中央に「まとめて再生」ボタン ----
  const header = document.createElement('div');
  header.className = 'prev-study-header';
  const label = document.createElement('div');
  label.className = 'prev-study-label';
  label.textContent = '📖 前回学習した問題';
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'prev-study-playall';
  allBtn.textContent = '▶ まとめて再生';
  allBtn.disabled = true;
  const headerSpacer = document.createElement('div');
  header.appendChild(label);
  header.appendChild(allBtn);
  header.appendChild(headerSpacer);
  box.appendChild(header);

  const listEl = document.createElement('div');
  listEl.className = 'prev-study-list';
  listEl.innerHTML = '<p class="prev-study-empty">読み込み中...</p>';
  box.appendChild(listEl);

  const errorEl = document.createElement('div');
  errorEl.className = 'prev-study-error';
  errorEl.style.display = 'none';
  box.appendChild(errorEl);
  function showPlaybackError(msg) {
    errorEl.textContent = '⚠ ' + msg;
    errorEl.style.display = 'block';
  }

  resolvePreviousStudyItems().then(items => {
    listEl.innerHTML = '';
    if (!items.length) {
      listEl.innerHTML = '<p class="prev-study-empty">前回学習分の音声データがありません。</p>';
      return;
    }
    const allFilenames = items.flatMap(it => it.audio);
    allBtn.disabled = false;
    allBtn.addEventListener('click', () => {
      errorEl.style.display = 'none';
      togglePlayback(allBtn, allFilenames, true, '▶ まとめて再生', '■ 停止', showPlaybackError);
    });

    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'prev-study-row';
      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'prev-study-play';
      playBtn.textContent = '▶';
      playBtn.addEventListener('click', () => {
        errorEl.style.display = 'none';
        togglePlayback(playBtn, item.audio, false, '▶', '■', showPlaybackError);
      });

      const text = document.createElement('span');
      text.className = 'prev-study-text';
      // 行の1行表示用(CSSでさらに省略される)には改行を含む空白を全て1つのスペースに
      // 畳んだものを使い、ポップアップ用には元の改行はそのまま保った上で各行の
      // 前後の余分な空白だけを整えたものを使う(会話文のM:/W:等の改行を保つため)。
      const flat = (item.text || '').replace(/\s+/g, ' ').trim();
      const fullLine = `${item.label} ${flat}`;
      const multiline = (item.text || '').split('\n').map(l => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
      const popupText = `${item.label}\n\n${multiline}`;
      text.textContent = fullLine;
      text.addEventListener('mouseenter', () => {
        if (prevStudyPinnedEl && prevStudyPinnedEl !== text) return;
        showPrevStudyPopup(text, popupText);
      });
      text.addEventListener('mouseleave', () => {
        if (prevStudyPinnedEl !== text) hidePrevStudyPopup();
      });
      text.addEventListener('click', e => {
        e.stopPropagation();
        if (prevStudyPinnedEl === text) { hidePrevStudyPopup(); return; }
        prevStudyPinnedEl = text;
        showPrevStudyPopup(text, popupText);
      });

      row.appendChild(playBtn);
      row.appendChild(text);
      listEl.appendChild(row);
    });
  });

  return box;
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
  partOverviewEl.style.display = 'none';
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

// 回答履歴のポップアップ「解説を見る」から、問題番号だけを頼りにその設問の画面まで
// ジャンプする。jumpToUnitは「何番目のユニットか」で指定するが、ユニット構成
// (Part3/4は会話グループ単位、Part5は5問バッチ単位、Part6/7はパッセージ単位)は
// データを読み込むまで分からないため、先にデータを読み込んでから該当ユニットを探す。
// autoReveal=trueなら、画面が描画された直後に正解の選択肢を自動でクリック→採点まで
// 自動で進め、素の問題画面ではなく解説が出た状態まで一気に見せる。
async function jumpToQuestionNumber(test, part, number, autoReveal) {
  state.test = test;
  state.part = part;
  state.index = 0;
  p12 = null;
  p34 = null;
  p67 = null;
  emptyStateEl.style.display = 'none';
  partOverviewEl.style.display = 'none';
  practiceEl.style.display = 'block';
  practiceBodyEl.innerHTML = '読み込み中...';
  document.getElementById('setupDetails').removeAttribute('open');
  state.data = await loadPartData(test, part);
  let unitIndex = 0;
  if (part === 1 || part === 2) {
    unitIndex = Math.max(0, state.data.questions.findIndex(q => q.number === number));
  } else if (part === 5) {
    // Part5はgetItemList()がchunk(questions,5)を返すため、unitIndexは「5問バッチ」の
    // インデックス(questions配列内の生インデックスではない)。
    const qIdx = Math.max(0, state.data.questions.findIndex(q => q.number === number));
    unitIndex = Math.floor(qIdx / 5);
  } else if (part === 3 || part === 4) {
    unitIndex = Math.max(0, state.data.groups.findIndex(g => g.questions.includes(number)));
  } else {
    unitIndex = Math.max(0, state.data.passages.findIndex(p => p.questions.includes(number)));
  }
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
  if (autoReveal) pendingAutoReveal = true;
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

// ドロップダウンでPartを切り替えたときに表示する「節の問題一覧」画面。
// いきなり1問目を始めず、buildLandingNavと同じ挑戦回数メーター付きの一覧を
// 表示し、そこから個別の問題/セットをクリックしてはじめて実際の練習画面へ進む。
async function showPartOverview(test, part) {
  saveAllVisibleNotes();
  stopAllAudio();
  emptyStateEl.style.display = 'none';
  practiceEl.style.display = 'none';
  partOverviewEl.style.display = 'block';
  partJumpSelectEl.value = `${test}-${part}`;
  partOverviewJumpSelectEl.value = `${test}-${part}`;
  partOverviewStartBtn.onclick = () => jumpToUnit(test, part, 0);
  partOverviewBodyEl.innerHTML = '<div class="loading">読み込み中...</div>';
  const data = await loadPartData(test, part);
  const units = buildUnitList(test, part, data);
  partOverviewBodyEl.innerHTML = '';
  const grouped = part === 3 || part === 4 || part === 5 || part === 6 || part === 7;
  const colLeft = document.createElement('div');
  colLeft.className = 'landing-col';
  const colRight = document.createElement('div');
  colRight.className = 'landing-col';
  partOverviewBodyEl.appendChild(colLeft);
  partOverviewBodyEl.appendChild(colRight);
  const half = Math.ceil(units.length / 2);
  units.forEach((u, i) => {
    const col = i < half ? colLeft : colRight;
    if (grouped) buildGroupedUnitRow(col, u, () => jumpToUnit(test, part, u.unitIndex));
    else buildUnitRow(col, u, () => jumpToUnit(test, part, u.unitIndex));
  });
}

const partOverviewJumpSelectEl = document.getElementById('partOverviewJumpSelect');
populatePartSelect(partOverviewJumpSelectEl);
partOverviewJumpSelectEl.addEventListener('change', () => {
  const [test, partStr] = partOverviewJumpSelectEl.value.split('-');
  showPartOverview(test, Number(partStr));
});
const partOverviewStartBtn = document.getElementById('partOverviewStartBtn');

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
renderHistorySidebar();
updateSheetConnectionBanner();
syncProgressFromSheet();
migrateLocalNotesToSheet();

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

const footerPrevBtn = document.getElementById('footer-prev-btn');
const footerNextBtn = document.getElementById('footer-next-btn');
const progressLabelBottomEl = document.getElementById('progress-label-bottom');
footerPrevBtn.addEventListener('click', () => goToAdjacentUnit(-1));
footerNextBtn.addEventListener('click', () => goToAdjacentUnit(1));

// 画面上部のPart切り替えドロップダウン: test1 part1〜test2 part7を全て列挙し、
// 選ぶといきなり1問目を始めるのではなく、その節の問題一覧(挑戦回数付き)を
// 表示するpart-overview画面へ移動する。
function populatePartSelect(selectEl) {
  ['T1', 'T2'].forEach(test => {
    for (let part = 1; part <= 7; part++) {
      const opt = document.createElement('option');
      opt.value = `${test}-${part}`;
      opt.textContent = `${test === 'T1' ? 'test1' : 'test2'} part${part}`;
      selectEl.appendChild(opt);
    }
  });
}

const partJumpSelectEl = document.getElementById('partJumpSelect');
populatePartSelect(partJumpSelectEl);
partJumpSelectEl.addEventListener('change', () => {
  const [test, partStr] = partJumpSelectEl.value.split('-');
  showPartOverview(test, Number(partStr));
});

// renderPart1or2/3or4/6/7は途中のフェーズ遷移(次の問題へ、シャドーイングへ、など)で
// renderPractice()を経由せず自分自身を再帰的に呼び出すため、進捗表示とボタンの
// 有効/無効はrenderPractice()側ではなく、各renderPartX()の先頭で毎回更新する。
function updateHeaderNav() {
  const unitIdx = getCurrentUnitIndex();
  const unitCount = getItemCount();
  const label = `${unitIdx + 1} / ${unitCount}`;
  progressLabelEl.textContent = label;
  progressLabelBottomEl.textContent = label;
  headerPrevBtn.disabled = unitIdx <= 0;
  headerNextBtn.disabled = unitIdx >= unitCount - 1;
  footerPrevBtn.disabled = unitIdx <= 0;
  footerNextBtn.disabled = unitIdx >= unitCount - 1;
  partJumpSelectEl.value = `${state.test}-${state.part}`;
  stopAllAudio();
  resetAndStartStopwatch();
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
    if (url) { currentAudio = new Audio(url); globalAudio.current = currentAudio; currentAudio.play(); }
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
    globalAudio.current = currentAudio;
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

  // 話者の国旗バッジは、設問文の段階ではまだ出さず、解説が表示された時点で
  // 初めて出す(buildP12ExplainHtml側で■設問文/■選択肢の見出し横に付与している)。
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

  wrap.appendChild(createAudioPlayerWidget(q.audio, { autoplay: true, sticky: true }));

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
  const pdfSlot = document.createElement('div');
  wrap.appendChild(pdfSlot);

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
      askAiSlot.appendChild(buildAskAiWidget(questionContext, noteKey));
      pdfSlot.appendChild(buildPdfExplainWidget(state.test, q.number));
      incrementAttempt(noteKey, p12.selected === q.answer);
      nextBtn.textContent = '次へ';
    } else {
      p12.qIdx++;
      p12.selected = null;
      if (p12.qIdx >= groupQuestions.length) {
        p12.groupStart += 3;
        p12.qIdx = 0;
        if (p12.groupStart >= state.data.questions.length) {
          showPartComplete();
          return;
        }
      }
      renderPart1or2();
    }
  });
  wrap.appendChild(nextBtn);

  practiceBodyEl.innerHTML = '';
  practiceBodyEl.appendChild(wrap);

  if (pendingAutoReveal) {
    pendingAutoReveal = false;
    const correctBtn = Array.from(choicesDiv.querySelectorAll('.choice')).find(b => b.textContent.trim() === `(${q.answer})`);
    if (correctBtn) correctBtn.click();
    nextBtn.click();
  }
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

  // 話者の国旗バッジは設問文の段階ではまだ出さず、解説が表示された時点で
  // 初めて各設問の見出し(t)横に付与する(下の採点処理内を参照)。
  const wrap = document.createElement('div');
  const audioLabel = document.createElement('div');
  audioLabel.className = 'audio-label';
  audioLabel.textContent = `Q${g.questions[0]}-${g.questions[g.questions.length - 1]}`;
  wrap.appendChild(audioLabel);
  wrap.appendChild(createAudioPlayerWidget([g.audioConversation || g.audioTalk, g.audioQuestions], { autoplay: true, sticky: true }));
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
  const blocksContainer = document.createElement('div');
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
    const pdfSlot = document.createElement('div');
    block.appendChild(pdfSlot);

    blocks[item.number] = { t, choicesDiv, explainDiv, letters, askAiSlot, pdfSlot };
    blocksContainer.appendChild(block);
  });
  wrap.appendChild(wrapWithGroupHistorySidebar(blocksContainer, state.test, g.questions));

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
        const { t, choicesDiv, explainDiv, letters } = blocks[item.number];
        const isCorrect = p34.selections[item.number] === item.answer;
        const buttons = choicesDiv.querySelectorAll('.choice');
        buttons.forEach((b, i) => {
          b.disabled = true;
          if (letters[i] === item.answer) b.classList.add('correct');
          else if (letters[i] === p34.selections[item.number]) b.classList.add('wrong');
        });
        // 話者の国旗バッジは、解説が表示されるこのタイミングで初めて付与する。
        if (g.speakers) t.appendChild(buildSpeakerBadges(g.speakers));
        explainDiv.style.display = 'block';
        explainDiv.textContent = (isCorrect ? '正解です!\n\n' : '不正解です。\n\n') + '解説を生成中...';
      });
      const transcriptText = g.conversationText || g.talkText;
      for (const item of g.items) {
        const { explainDiv, askAiSlot, pdfSlot } = blocks[item.number];
        const isCorrect = p34.selections[item.number] === item.answer;
        const prefixHtml = correctBannerHtml(isCorrect);
        const questionText = `${transcriptText ? `会話・トークの原文:\n${transcriptText}\n\n` : ''}${item.number}. ${item.text}\n選択肢: ${Object.entries(item.choices).map(([l, txt]) => `(${l}) ${txt}`).join(' ')}\n正解: (${item.answer}) ${item.choices[item.answer]}\nあなたの回答: (${p34.selections[item.number]}) ${item.choices[p34.selections[item.number]]}`;
        let html;
        try {
          html = prefixHtml + await getRichExplanation(`${state.test}-${state.part}-${item.number}-${p34.selections[item.number]}`, questionText);
        } catch (e) {
          html = prefixHtml + `<div>解説の取得に失敗しました: ${escapeHtml(e.message)}</div>`;
        }
        explainDiv.innerHTML = html;
        askAiSlot.appendChild(buildAskAiWidget(questionText, `${state.test}-${state.part}-${item.number}`));
        pdfSlot.appendChild(buildPdfExplainWidget(state.test, item.number));
      }
      g.items.forEach(item => {
        incrementAttempt(`${state.test}-${state.part}-${item.number}`, p34.selections[item.number] === item.answer, `${state.test}-${state.part}-${g.questions[0]}`);
      });
      const fullText = g.conversationText || g.talkText;
      if (fullText) {
        translateSlot.style.display = 'block';
        translateSlot.appendChild(buildTranslatableBlock(fullText, `${state.test}-${state.part}-${g.questions[0]}`));
      }
      wrap.insertBefore(buildNotesWidget(`${state.test}-${state.part}-${g.questions[0]}`), nextBtn);
      nextBtn.disabled = false;
      nextBtn.textContent = '次へ';
    } else {
      p34.groupIdx++;
      p34.phase = 'question';
      p34.selections = {};
      if (p34.groupIdx >= state.data.groups.length) {
        showPartComplete();
        return;
      }
      renderPart3or4();
    }
  });
  wrap.appendChild(nextBtn);

  practiceBodyEl.innerHTML = '';
  practiceBodyEl.appendChild(wrap);

  if (pendingAutoReveal) {
    pendingAutoReveal = false;
    g.items.forEach(item => {
      const { choicesDiv } = blocks[item.number];
      const correctBtn = Array.from(choicesDiv.querySelectorAll('.choice')).find(b => b.textContent.trim() === `(${item.answer}) ${item.choices[item.answer]}`);
      if (correctBtn) correctBtn.click();
    });
    nextBtn.click();
  }
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
    const pdfSlot = document.createElement('div');
    block.appendChild(pdfSlot);

    blocks[q.number] = { choicesDiv, explainDiv, letters, askAiSlot, pdfSlot };
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
      const { explainDiv, askAiSlot, pdfSlot } = blocks[q.number];
      const isCorrect = selections[q.number] === q.answer;
      const prefixHtml = correctBannerHtml(isCorrect);
      const questionText = `${q.number}. ${q.sentence}\n選択肢: ${Object.entries(q.choices).map(([l, txt]) => `(${l}) ${txt}`).join(' ')}\n正解: (${q.answer}) ${q.choices[q.answer]}\nあなたの回答: (${selections[q.number]}) ${q.choices[selections[q.number]]}`;
      try {
        explainDiv.innerHTML = prefixHtml + await getRichExplanation(`${state.test}-5-${q.number}-${selections[q.number]}`, questionText, EXPLAIN_PROMPT_PART5, EXPLAIN_PROMPT_PART5_VERSION);
      } catch (e) {
        explainDiv.innerHTML = prefixHtml + `<div>解説の取得に失敗しました: ${escapeHtml(e.message)}</div>`;
      }
      askAiSlot.appendChild(buildAskAiWidget(questionText, `${state.test}-5-${q.number}`));
      pdfSlot.appendChild(buildPdfExplainWidget(state.test, q.number));
    }
    batch.forEach(q => {
      incrementAttempt(`${state.test}-5-${q.number}`, selections[q.number] === q.answer, `${state.test}-5-${batch[0].number}`);
    });
    wrap.appendChild(buildNotesWidget(`${state.test}-5-${batch[0].number}`));
  });
  wrap.appendChild(gradeBtn);

  practiceBodyEl.appendChild(wrap);

  if (pendingAutoReveal) {
    pendingAutoReveal = false;
    batch.forEach(q => {
      const { choicesDiv } = blocks[q.number];
      const correctBtn = Array.from(choicesDiv.querySelectorAll('.choice')).find(b => b.textContent.trim() === `(${q.answer}) ${q.choices[q.answer]}`);
      if (correctBtn) correctBtn.click();
    });
    gradeBtn.click();
  }
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

function p67RenderQuestionBlocks(wrap, items, getBlockLabel, questionNumbers) {
  const blocks = {};
  const blocksContainer = document.createElement('div');
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
    const pdfSlot = document.createElement('div');
    block.appendChild(pdfSlot);

    blocks[item.number] = { choicesDiv, explainDiv, letters, askAiSlot, pdfSlot };
    blocksContainer.appendChild(block);
  });
  wrap.appendChild(wrapWithGroupHistorySidebar(blocksContainer, state.test, questionNumbers || items.map(it => it.number)));

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
    const { explainDiv, askAiSlot, pdfSlot } = blocks[item.number];
    const isCorrect = p67.selections[item.number] === item.answer;
    const prefixHtml = correctBannerHtml(isCorrect);
    let html;
    try {
      html = prefixHtml + await getRichExplanation(cacheKeyBuilder(item), questionTextBuilder(item));
    } catch (e) {
      html = prefixHtml + `<div>解説の取得に失敗しました: ${escapeHtml(e.message)}</div>`;
    }
    explainDiv.innerHTML = html;
    askAiSlot.appendChild(buildAskAiWidget(questionTextBuilder(item), `${state.test}-${state.part}-${item.number}`));
    pdfSlot.appendChild(buildPdfExplainWidget(state.test, item.number));
  }
  const allCorrect = items.every(item => p67.selections[item.number] === item.answer);
  incrementAttempt(attemptKey, allCorrect);
  items.forEach(item => {
    recordCorrectness(`${state.test}-${state.part}-${item.number}-correct`, p67.selections[item.number] === item.answer, attemptKey);
  });
  nextBtn.disabled = false;
  nextBtn.textContent = '次へ';
}

// Part6/7の本文は基本的に公式PDFのページ画像で表示しているが、スマホ等の
// 狭い画面だと文字が小さすぎて読めない。画像をタップすると、同じデータが
// 持つテキスト版を画面幅いっぱいのテキストとして表示できるようにする
// (もう一度タップすると画像表示に戻る)。
function buildPassageImageWithTextToggle(src, alt, text) {
  const wrap = document.createElement('div');
  wrap.className = 'passage-photo-wrap';

  const img = document.createElement('img');
  img.src = src;
  img.alt = alt || '本文';
  img.className = 'passage-photo';
  img.title = 'タップするとテキスト表示に切り替わります';

  const textBox = document.createElement('div');
  textBox.className = 'passage-text-view';
  textBox.style.display = 'none';
  textBox.textContent = text || '(テキストデータがありません)';
  textBox.title = 'タップすると画像表示に戻ります';

  const hint = document.createElement('div');
  hint.className = 'passage-photo-hint';
  hint.textContent = '👆 タップでテキスト表示に切り替え';

  let showingText = false;
  function toggle() {
    showingText = !showingText;
    img.style.display = showingText ? 'none' : 'block';
    textBox.style.display = showingText ? 'block' : 'none';
    hint.textContent = showingText ? '👆 タップで画像表示に戻る' : '👆 タップでテキスト表示に切り替え';
  }
  img.addEventListener('click', toggle);
  textBox.addEventListener('click', toggle);

  wrap.appendChild(img);
  wrap.appendChild(textBox);
  wrap.appendChild(hint);
  return wrap;
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
    doc.appendChild(buildPassageImageWithTextToggle(p.textImage, p.topic || '本文', p.text));
  } else {
    doc.textContent = p.text;
  }
  wrap.appendChild(doc);

  const audioSlot = document.createElement('div');
  audioSlot.style.display = 'none';
  wrap.appendChild(audioSlot);

  const translateSlot = document.createElement('div');
  translateSlot.style.display = 'none';
  wrap.appendChild(translateSlot);

  const { blocks, nextBtn } = p67RenderQuestionBlocks(wrap, p.items, item => `(${item.number})`, p.questions);
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
      if (p.audio) {
        audioSlot.style.display = 'block';
        audioSlot.appendChild(createAudioPlayerWidget(p.audio, { sticky: true }));
      }
      translateSlot.style.display = 'block';
      translateSlot.appendChild(buildTranslatableBlock(p.text, `${state.test}-6-${p.questions[0]}`));
    } else {
      p67AdvancePassage(renderPart6);
    }
  });

  practiceBodyEl.innerHTML = '';
  practiceBodyEl.appendChild(wrap);

  if (pendingAutoReveal) {
    pendingAutoReveal = false;
    p.items.forEach(item => {
      const { choicesDiv } = blocks[item.number];
      const correctBtn = Array.from(choicesDiv.querySelectorAll('.choice')).find(b => b.textContent.trim() === `(${item.answer}) ${item.choices[item.answer]}`);
      if (correctBtn) correctBtn.click();
    });
    nextBtn.click();
  }
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
      docDiv.appendChild(buildPassageImageWithTextToggle(doc.image, doc.label || '文書', doc.text));
    } else {
      const txt = document.createElement('div');
      txt.textContent = doc.text;
      docDiv.appendChild(txt);
    }
    wrap.appendChild(docDiv);
  });

  const audioSlot = document.createElement('div');
  audioSlot.style.display = 'none';
  wrap.appendChild(audioSlot);

  const translateSlots = [];
  p.documents.forEach((doc, di) => {
    const slot = document.createElement('div');
    slot.style.display = 'none';
    wrap.appendChild(slot);
    translateSlots.push({ slot, doc, di });
  });

  const { blocks, nextBtn } = p67RenderQuestionBlocks(wrap, p.items, item => `${item.number}. ${item.text}`, p.questions);
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
      if (p.audio) {
        audioSlot.style.display = 'block';
        audioSlot.appendChild(createAudioPlayerWidget(p.audio, { sticky: true }));
      }
      translateSlots.forEach(({ slot, doc, di }) => {
        slot.style.display = 'block';
        slot.appendChild(buildTranslatableBlock(doc.text, `${state.test}-7-${p.questions[0]}-doc${di}`));
      });
    } else {
      p67AdvancePassage(renderPart7);
    }
  });

  practiceBodyEl.innerHTML = '';
  practiceBodyEl.appendChild(wrap);

  if (pendingAutoReveal) {
    pendingAutoReveal = false;
    p.items.forEach(item => {
      const { choicesDiv } = blocks[item.number];
      const correctBtn = Array.from(choicesDiv.querySelectorAll('.choice')).find(b => b.textContent.trim() === `(${item.answer}) ${item.choices[item.answer]}`);
      if (correctBtn) correctBtn.click();
    });
    nextBtn.click();
  }
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

// ---------- ノートの自動保存 ----------
// 次の問題/前の問題・Part切り替えドロップダウンは、renderPractice()の先頭で
// saveAllVisibleNotes()を呼んでいるため既に自動保存される。残る抜け穴は、
// ヘッダーのタイトルリンク(トップへ戻る=実質ページの再読み込み)をクリックした
// ときで、これは画面遷移そのものなのでJS側で先回りして保存してから遷移させる。
const headerTitleLink = document.querySelector('.app-header h1 a');
if (headerTitleLink) {
  headerTitleLink.addEventListener('click', e => {
    e.preventDefault();
    const dest = headerTitleLink.href;
    saveAllVisibleNotes().finally(() => { location.href = dest; });
  });
}
// タブを閉じる/リロードするなど、上記のフックを経由しない離脱への保険として、
// 非同期のスプレッドシート同期を待てない代わりにlocalStorageへの同期保存だけ行う。
window.addEventListener('beforeunload', () => {
  document.querySelectorAll('.notes-area[data-notes-key]').forEach(area => {
    try { localStorage.setItem(NOTES_LS_PREFIX + area.dataset.notesKey, area.innerHTML); } catch (e) { /* ignore */ }
  });
});
