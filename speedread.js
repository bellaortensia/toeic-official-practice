// Part7 速読モード
// 問題(設問・選択肢)は出さず、Part7の本文だけをひたすら読むモード。本文は画像
// (クリックでテキスト表示に切り替え)+音声+翻訳ウィジェット(ワイド/トール/意訳/
// 直訳/ハイライト移動/ノート/AIに質問)。翻訳ウィジェット・ノートは「解説・ノート
// モード」のものをそのまま使うので、翻訳もノートも解説モードと共有される。
// script.jsの後に読み込む(TESTS, loadPartData, buildTranslatableBlock 等を使う)。
(function () {
  'use strict';

  const SR_GOAL = 20; // カウンターのバーが満タンになる回数(DECODE TOEICのREAD_GOALと同じ)
  const COUNT_AFTER_MS = 15 * 1000; // 1つの本文を15秒以上表示していたら「1回読んだ」とする
  let sr = null; // { test, passages, idx, countTimer }
  let saveDebounce = null;
  let historyWeekOffsetSr = 0;

  function $root() { return document.getElementById('speedread'); }
  function mk(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function keyOf(test, p) { return `${test}-7-${p.questions[0]}`; }
  function rangeLabel(p) {
    const q = p.questions;
    return q.length > 1 ? `Q${q[0]}-${q[q.length - 1]}` : `Q${q[0]}`;
  }
  function countOf(key) {
    const c = getSpeedReadCounts()[key];
    return c ? c.count || 0 : 0;
  }
  function scheduleProgressSave() {
    clearTimeout(saveDebounce);
    saveDebounce = setTimeout(() => { if (typeof saveProgressToSheet === 'function') saveProgressToSheet(); }, 4000);
  }

  function showPanel() {
    emptyStateEl.style.display = 'none';
    partOverviewEl.style.display = 'none';
    practiceEl.style.display = 'none';
    const exam = document.getElementById('exam');
    if (exam) exam.style.display = 'none';
    $root().style.display = 'block';
  }

  // ---------- 開始 ----------
  async function speedReadStart(test, mode, index) {
    stopAllAudio();
    showPanel();
    $root().innerHTML = '';
    $root().appendChild(mk('div', 'sr-loading', '読み込み中...'));
    let data;
    try { data = await loadPartData(test, 7); }
    catch (e) { $root().innerHTML = ''; $root().appendChild(mk('div', 'sr-loading', '問題データの読み込みに失敗しました: ' + e.message)); return; }
    const passages = data.passages || [];
    if (!passages.length) { $root().innerHTML = ''; $root().appendChild(mk('div', 'sr-loading', 'Part7のデータがありません。')); return; }
    let idx = 0;
    if (mode === 'random') idx = Math.floor(Math.random() * passages.length);
    else if (mode === 'index') idx = Math.max(0, Math.min(passages.length - 1, index || 0));
    document.getElementById('setupDetails').removeAttribute('open');
    sr = { test, passages, idx, countTimer: null };
    render();
  }

  function goTo(idx) {
    if (!sr) return;
    saveAllVisibleNotes();
    sr.idx = Math.max(0, Math.min(sr.passages.length - 1, idx));
    render();
    window.scrollTo({ top: 0 });
  }
  function goRandom() {
    if (!sr || sr.passages.length < 2) return;
    let i;
    do { i = Math.floor(Math.random() * sr.passages.length); } while (i === sr.idx);
    goTo(i);
  }
  function leave() {
    clearTimeout(sr && sr.countTimer);
    stopAllAudio();
    saveAllVisibleNotes().finally(() => { location.href = location.pathname; });
  }

  // ---------- 画面 ----------
  function buildNav() {
    const nav = mk('div', 'sr-nav');
    const prev = mk('button', 'nav-btn', '◀');
    prev.type = 'button';
    prev.disabled = sr.idx <= 0;
    prev.addEventListener('click', () => goTo(sr.idx - 1));
    const lab = mk('span', 'progress-label', `${sr.idx + 1}/${sr.passages.length}`);
    const next = mk('button', 'nav-btn', '▶');
    next.type = 'button';
    next.disabled = sr.idx >= sr.passages.length - 1;
    next.addEventListener('click', () => goTo(sr.idx + 1));
    nav.appendChild(prev);
    nav.appendChild(lab);
    nav.appendChild(next);
    return nav;
  }

  function render() {
    stopAllAudio();
    clearTimeout(sr.countTimer);
    const test = sr.test;
    state.test = test; // 音声プレーヤーがstate.testから音声フォルダを決めるため
    const p = sr.passages[sr.idx];
    const key = keyOf(test, p);
    const root = $root();
    root.innerHTML = '';

    // ---- ヘッダー(上に張り付く) ----
    const header = mk('div', 'sr-header');
    const headLeft = mk('div', 'sr-head-left');
    const topBtn = mk('button', 'sr-top-btn', '← トップへ');
    topBtn.type = 'button';
    topBtn.addEventListener('click', leave);
    headLeft.appendChild(topBtn);

    const sel = mk('select', 'part-jump-select sr-select');
    sr.passages.forEach((pp, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      const c = countOf(keyOf(test, pp));
      o.textContent = `${rangeLabel(pp)} ${pp.topic || ''}${c ? `(速読${c}回)` : ''}`;
      if (i === sr.idx) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => goTo(Number(sel.value)));
    headLeft.appendChild(sel);
    header.appendChild(headLeft);

    // ◀ 3/15 ▶ と 速読シャッフル は、ヘッダーの中央に置く。
    const headCenter = mk('div', 'sr-head-center');
    headCenter.appendChild(buildNav());
    const rnd = mk('button', 'sr-random-btn', '🔀 速読シャッフル');
    rnd.type = 'button';
    rnd.addEventListener('click', goRandom);
    headCenter.appendChild(rnd);
    header.appendChild(headCenter);

    // 速読カウンター(DECODE TOEICのREAD COUNTと同じデザイン。−/＋で手動調整もできる)
    const counter = mk('div', 'sr-rc');
    const num = mk('span', 'sr-rc-number', '0');
    const minus = mk('button', 'sr-rc-btn', '−');
    minus.type = 'button';
    const track = mk('div', 'sr-rc-track');
    const fill = mk('div', 'sr-rc-fill');
    track.appendChild(fill);
    const plus = mk('button', 'sr-rc-btn', '＋');
    plus.type = 'button';
    const refreshCounter = () => {
      const c = countOf(key);
      num.textContent = String(c);
      fill.style.width = Math.min(100, Math.round(c / SR_GOAL * 100)) + '%';
    };
    refreshCounter();
    minus.addEventListener('click', () => { setSpeedReadCount(key, countOf(key) - 1, false); refreshCounter(); scheduleProgressSave(); });
    plus.addEventListener('click', () => { setSpeedReadCount(key, countOf(key) + 1, true); refreshCounter(); scheduleProgressSave(); });
    counter.appendChild(num);
    counter.appendChild(mk('span', 'sr-rc-label', 'READ COUNT'));
    counter.appendChild(minus);
    counter.appendChild(track);
    counter.appendChild(plus);
    header.appendChild(counter);
    root.appendChild(header);
    syncStickyOffset(header);

    // ---- 本文 ----
    const main = mk('div', 'sr-body');
    if (p.topic) main.appendChild(mk('div', 'passage-topic', p.topic));
    // 複数文書のとき、画像と翻訳が交互にならないよう、先に全文書の画像を並べる。
    p.documents.forEach(doc => {
      const docDiv = mk('div', 'doc-box');
      // ラベルと「閉じる」ボタンの行(画像・原文を畳んで、翻訳だけ読みたいとき用)
      const headRow = mk('div', 'doc-header-row');
      headRow.appendChild(mk('div', 'doc-label', doc.label || ''));
      // 速読モードでは、画像(原文)は最初から閉じておく(必要なときだけ「開く」)。
      const collapseBtn = mk('button', 'doc-collapse-btn reveal-btn', '▶ 開く');
      collapseBtn.type = 'button';
      headRow.appendChild(collapseBtn);
      docDiv.appendChild(headRow);
      const content = mk('div');
      content.style.display = 'none';
      if (doc.image) {
        docDiv.classList.add('has-photo');
        content.appendChild(buildPassageImageWithTextToggle(doc.image, doc.label || '文書', doc.text));
      } else {
        content.appendChild(mk('div', '', doc.text));
      }
      docDiv.appendChild(content);
      collapseBtn.addEventListener('click', () => {
        const collapsed = content.style.display === 'none';
        content.style.display = collapsed ? '' : 'none';
        collapseBtn.textContent = collapsed ? '▼ 閉じる' : '▶ 開く';
      });
      main.appendChild(docDiv);
    });

    if (p.audio) {
      const audioSlot = mk('div', 'audio-slot-sticky');
      audioSlot.appendChild(createAudioPlayerWidget(p.audio, { sticky: true }));
      main.appendChild(audioSlot);
    }

    p.documents.forEach((doc, di) => {
      const slot = mk('div');
      // 解説・ノートモードと同じキー(翻訳キャッシュ・ノート・AIへの質問)を使う。
      slot.appendChild(buildTranslatableBlock(doc.text, `${key}-doc${di}`, null, 'Readingボトルネック', false, null, 'literal'));
      main.appendChild(slot);
    });

    // 下にも前へ/次へ
    const bottom = mk('div', 'sr-bottom');
    bottom.appendChild(buildNav());
    const rnd2 = mk('button', 'sr-random-btn', '🔀 速読シャッフル');
    rnd2.type = 'button';
    rnd2.addEventListener('click', goRandom);
    bottom.appendChild(rnd2);
    main.appendChild(bottom);
    root.appendChild(main);

    // 15秒以上表示していたら「1回速読した」としてカウントする。
    sr.countTimer = setTimeout(() => {
      if (!sr || sr.passages[sr.idx] !== p) return;
      setSpeedReadCount(key, countOf(key) + 1, true);
      refreshCounter();
      if (typeof recordStudyActivity === 'function') recordStudyActivity();
      scheduleProgressSave();
    }, COUNT_AFTER_MS);
  }

  // 音声プレーヤーが画面上部のヘッダーの下に張り付くよう、sticky位置の基準(CSS変数)を
  // この画面のヘッダー高さに合わせる。
  function syncStickyOffset(header) {
    const apply = () => {
      const topEl = document.querySelector('.sticky-top');
      const topH = topEl ? topEl.offsetHeight : 0;
      document.documentElement.style.setProperty('--audio-sticky-top-h', (topH + header.offsetHeight) + 'px');
    };
    apply();
    if (window.ResizeObserver) new ResizeObserver(apply).observe(header);
  }

  // 学習時間(速読画面を開いている間も加算する)
  setInterval(() => {
    const el = $root();
    if (document.visibilityState === 'visible' && el && el.style.display !== 'none' && typeof recordStudyTime === 'function') recordStudyTime();
  }, 60000);

  // ---------- 右カラムの「速読履歴」 ----------
  async function openFromHistory(test, q0) {
    let data;
    try { data = await loadPartData(test, 7); } catch (e) { return; }
    const i = (data.passages || []).findIndex(pp => pp.questions[0] === q0);
    speedReadStart(test, 'index', i < 0 ? 0 : i);
  }
  function parseKey(key) {
    const m = /^(T\d+)-7-(\d+)$/.exec(key);
    return m ? { test: m[1], q0: Number(m[2]) } : null;
  }

  function renderSpeedReadHistory(weekOffset) {
    if (typeof weekOffset === 'number') historyWeekOffsetSr = weekOffset;
    const off = historyWeekOffsetSr;
    const listEl = document.getElementById('speedReadHistoryList');
    if (!listEl) return;
    listEl.innerHTML = '';
    const counts = getSpeedReadCounts();
    const items = Object.keys(counts)
      .map(k => ({ key: k, parsed: parseKey(k), count: counts[k].count || 0, lastAt: counts[k].lastAt || 0 }))
      .filter(it => it.parsed && it.lastAt)
      .sort((a, b) => b.lastAt - a.lastAt);
    if (!items.length) {
      listEl.appendChild(mk('p', 'history-sidebar-empty', 'まだ速読した問題がありません。'));
      return;
    }
    const ref = new Date();
    ref.setDate(ref.getDate() + off * 7);
    const { dates } = getWeekDates(ref);
    const start = new Date(dates[0]); start.setHours(0, 0, 0, 0);
    const end = new Date(dates[6]); end.setHours(23, 59, 59, 999);
    const weekItems = items.filter(it => it.lastAt >= start.getTime() && it.lastAt <= end.getTime());
    const fmt = d => `${d.getMonth() + 1}/${d.getDate()}`;
    const rangeText = `${fmt(dates[0])}〜${fmt(dates[6])}`;
    if (!weekItems.length) {
      listEl.appendChild(mk('p', 'history-sidebar-empty', `${rangeText}の記録はありません。`));
    } else {
      weekItems.forEach(it => {
        const row = mk('div', 'history-item has-note');
        row.appendChild(mk('span', 'history-item-label', `${getTestConfig(it.parsed.test).shortLabel} P7 Q${it.parsed.q0}`));
        row.appendChild(mk('span', 'history-item-date', formatHistoryDate(it.lastAt)));
        row.appendChild(mk('span', 'history-item-badge sr-history-count', `${it.count}回`));
        row.addEventListener('click', () => openFromHistory(it.parsed.test, it.parsed.q0));
        listEl.appendChild(row);
      });
    }
    const nav = mk('div', 'history-week-nav');
    const prev = mk('button', 'history-week-nav-btn', '前◀');
    prev.type = 'button';
    prev.addEventListener('click', () => renderSpeedReadHistory(off - 1));
    const next = mk('button', 'history-week-nav-btn', '▶次');
    next.type = 'button';
    next.disabled = off >= 0;
    next.addEventListener('click', () => { if (off < 0) renderSpeedReadHistory(off + 1); });
    nav.appendChild(prev);
    nav.appendChild(mk('span', 'history-week-nav-label', rangeText));
    nav.appendChild(next);
    listEl.appendChild(nav);
  }

  // ---------- 「前回速読した問題」欄(前回学習した問題の下) ----------
  async function resolvePreviousSpeedReadItems() {
    const log = getSpeedReadLog();
    const today = localDateKey();
    const dates = Object.keys(log).filter(d => d < today && Object.keys(log[d]).length > 0).sort();
    if (!dates.length) return [];
    const dayLog = log[dates[dates.length - 1]];
    const keys = Object.keys(dayLog).sort((a, b) => dayLog[a] - dayLog[b]);
    const items = [];
    for (const key of keys) {
      const parsed = parseKey(key);
      if (!parsed) continue;
      let data;
      try { data = await loadPartData(parsed.test, 7); } catch (e) { continue; }
      const p = (data.passages || []).find(x => x.questions[0] === parsed.q0);
      if (!p || !p.audio) continue;
      const cfg = getTestConfig(parsed.test);
      items.push({
        label: `${cfg.shortLabel} P7 Q${parsed.q0}`,
        text: p.documents ? p.documents.map(d => d.text).join('\n\n') : '',
        audio: Array.isArray(p.audio) ? p.audio : [p.audio],
        audioFolderId: cfg.audioFolderId,
        cacheKeyBase: key
      });
    }
    return items;
  }

  function buildPreviousSpeedReadSection() {
    const box = mk('div', 'prev-study-box');
    const header = mk('div', 'prev-study-header');
    header.appendChild(mk('div', 'prev-study-label', '⚡ 前回速読した問題'));
    const allBtn = mk('button', 'prev-study-playall', '▶ まとめて再生');
    allBtn.type = 'button';
    allBtn.disabled = true;
    header.appendChild(allBtn);
    header.appendChild(mk('div'));
    box.appendChild(header);

    const listEl = mk('div', 'prev-study-list');
    listEl.innerHTML = '<p class="prev-study-empty">読み込み中...</p>';
    box.appendChild(listEl);
    const errorEl = mk('div', 'prev-study-error');
    errorEl.style.display = 'none';
    box.appendChild(errorEl);
    const showErr = msg => { errorEl.textContent = '⚠ ' + msg; errorEl.style.display = 'block'; };

    resolvePreviousSpeedReadItems().then(items => {
      listEl.innerHTML = '';
      if (!items.length) {
        listEl.innerHTML = '<p class="prev-study-empty">前回速読分の音声データがありません。</p>';
        return;
      }
      const allTracks = items.flatMap(it => it.audio.map(f => ({ file: f, audioFolderId: it.audioFolderId })));
      allBtn.disabled = false;
      allBtn.addEventListener('click', () => {
        errorEl.style.display = 'none';
        togglePlayback(allBtn, allTracks, true, '▶ まとめて再生', '■ 停止', showErr);
      });
      items.forEach(item => {
        const row = mk('div', 'prev-study-row');
        const playBtn = mk('button', 'prev-study-play', '▶');
        playBtn.type = 'button';
        playBtn.addEventListener('click', () => {
          errorEl.style.display = 'none';
          const tracks = item.audio.map(f => ({ file: f, audioFolderId: item.audioFolderId }));
          togglePlayback(playBtn, tracks, false, '▶', '■', showErr);
        });
        const text = mk('span', 'prev-study-text');
        const flat = (item.text || '').replace(/\s+/g, ' ').trim();
        text.textContent = `${item.label} ${flat}`;
        const highlighted = getPassageBodyHtmlForHistory(item.cacheKeyBase);
        const multiline = (item.text || '').split('\n').map(l => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
        const popupHtml = `${escapeHtml(item.label)}<br><br>${highlighted || escapeHtml(multiline)}`;
        text.addEventListener('mouseenter', () => {
          if (prevStudyPinnedEl && prevStudyPinnedEl !== text) return;
          showPrevStudyPopup(text, popupHtml);
        });
        text.addEventListener('mouseleave', () => { if (prevStudyPinnedEl !== text) hidePrevStudyPopup(); });
        text.addEventListener('click', e => {
          e.stopPropagation();
          if (prevStudyPinnedEl === text) { hidePrevStudyPopup(); return; }
          prevStudyPinnedEl = text;
          showPrevStudyPopup(text, popupHtml);
        });
        row.appendChild(playBtn);
        row.appendChild(text);
        listEl.appendChild(row);
      });
    });
    return box;
  }

  // Part7一覧の各グループ見出しの右側に出す「速読モード」ボタンとREAD COUNT。
  function buildSpeedReadGroupControls(test, q0, unitIndex) {
    const key = `${test}-7-${q0}`;
    const wrap = mk('div', 'sr-group-controls');
    const go = mk('button', 'speedread-entry-btn sr-group-btn', '⚡ 速読モード');
    go.type = 'button';
    go.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); speedReadStart(test, 'index', unitIndex); });
    wrap.appendChild(go);
    const rc = mk('div', 'sr-mini-rc');
    const num = mk('span', 'sr-rc-number', '0');
    const minus = mk('button', 'sr-rc-btn', '−');
    minus.type = 'button';
    const plus = mk('button', 'sr-rc-btn', '＋');
    plus.type = 'button';
    const refresh = () => { num.textContent = String(countOf(key)); };
    refresh();
    minus.addEventListener('click', () => { setSpeedReadCount(key, countOf(key) - 1, false); refresh(); scheduleProgressSave(); if (typeof renderSpeedReadHistory === 'function') renderSpeedReadHistory(); });
    plus.addEventListener('click', () => { setSpeedReadCount(key, countOf(key) + 1, true); refresh(); scheduleProgressSave(); if (typeof renderSpeedReadHistory === 'function') renderSpeedReadHistory(); });
    rc.appendChild(num);
    rc.appendChild(mk('span', 'sr-rc-label', 'READ COUNT'));
    rc.appendChild(minus);
    rc.appendChild(plus);
    wrap.appendChild(rc);
    return wrap;
  }

  window.buildSpeedReadGroupControls = buildSpeedReadGroupControls;
  window.speedReadStart = speedReadStart;
  window.renderSpeedReadHistory = renderSpeedReadHistory;
  window.buildPreviousSpeedReadSection = buildPreviousSpeedReadSection;
  renderSpeedReadHistory();
  // script.js側の「前回学習した問題」欄は、このファイルの読み込み前に描画済みなので、
  // 速読の欄だけ後から差し込む。
  const dash = document.getElementById('statsDashboard');
  if (dash && !dash.querySelector('.prev-study-box ~ .prev-study-box')) dash.appendChild(buildPreviousSpeedReadSection());
})();
