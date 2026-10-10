// 通しテスト(全問テスト / パート別全問テスト)
// script.jsの後に読み込む。script.js側のグローバル(TESTS, loadPartData, getAudioUrl,
// jumpToQuestionNumber 等)をそのまま使う。AIは一切呼ばない(解説・翻訳は採点後に
// 「解説・ノートモード」で開いたときに作る)。
(function () {
  'use strict';

  const LS_PROGRESS = 'toeicOfficialPractice.examInProgress';
  const LS_RESULTS = 'toeicOfficialPractice.examResults';
  const READING_FULL_MS = 75 * 60 * 1000;
  const PART_Q_COUNT = { 1: 6, 2: 25, 3: 39, 4: 30, 5: 30, 6: 16, 7: 54 };
  const PART_LABELS_EXAM = {
    1: 'Part1 写真描写', 2: 'Part2 応答問題', 3: 'Part3 会話問題', 4: 'Part4 説明文問題',
    5: 'Part5 短文穴埋め', 6: 'Part6 長文穴埋め', 7: 'Part7 読解問題'
  };

  // 参考スコア範囲の換算表(公式問題集11・12のp.7(PDFの131ページ)。TEST1・2共通で、11と12は同じ表)。
  // [素点の下限, 素点の上限, 換算点の下限, 換算点の上限]
  const SCORE_TABLE = {
    L: [[96, 100, 475, 495], [91, 95, 435, 495], [86, 90, 405, 470], [81, 85, 370, 450], [76, 80, 345, 420],
        [71, 75, 320, 390], [66, 70, 290, 360], [61, 65, 265, 335], [56, 60, 240, 310], [51, 55, 215, 280],
        [46, 50, 190, 255], [41, 45, 160, 230], [36, 40, 130, 205], [31, 35, 105, 175], [26, 30, 85, 145],
        [21, 25, 60, 115], [16, 20, 30, 90], [11, 15, 5, 70], [6, 10, 5, 60], [1, 5, 5, 50], [0, 0, 5, 35]],
    R: [[96, 100, 460, 495], [91, 95, 425, 490], [86, 90, 400, 465], [81, 85, 375, 440], [76, 80, 340, 415],
        [71, 75, 310, 390], [66, 70, 285, 370], [61, 65, 255, 340], [56, 60, 230, 310], [51, 55, 200, 275],
        [46, 50, 170, 245], [41, 45, 140, 215], [36, 40, 115, 180], [31, 35, 95, 150], [26, 30, 75, 120],
        [21, 25, 60, 95], [16, 20, 45, 75], [11, 15, 30, 55], [6, 10, 10, 40], [1, 5, 5, 30], [0, 0, 5, 15]]
  };

  // 動作確認用(通常は1)。待ち時間・制限時間を縮める。
  function timeScale() { return window.__EXAM_TIME_SCALE || 1; }

  let exam = null;
  let examEl = null;
  let beforeUnloadSet = false;

  function $(sel, root) { return (root || examEl).querySelector(sel); }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function fmtTime(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function modeTitle(test, mode, part) {
    const label = getTestConfig(test).label;
    return mode === 'full' ? `${label} 全問テスト` : `${label} Part${part} 全問テスト`;
  }

  // ---------- 画面の切り替え ----------
  function showExamPanel() {
    examEl = document.getElementById('exam');
    emptyStateEl.style.display = 'none';
    partOverviewEl.style.display = 'none';
    practiceEl.style.display = 'none';
    examEl.style.display = 'block';
    examEl.innerHTML = '';
    window.scrollTo(0, 0);
  }

  // ---------- 入口: パート選択メニュー ----------
  let partMenuEl = null;
  function closePartMenu() {
    if (partMenuEl) { partMenuEl.remove(); partMenuEl = null; }
  }
  document.addEventListener('click', e => {
    if (partMenuEl && !partMenuEl.contains(e.target) && !e.target.closest('.exam-part-btn')) closePartMenu();
  });
  function showPartMenu(test, anchor) {
    closePartMenu();
    const menu = el('div', 'exam-part-menu');
    for (let part = 1; part <= 7; part++) {
      const b = el('button', 'exam-part-menu-item', `${PART_LABELS_EXAM[part]}(${PART_Q_COUNT[part]}問)`);
      b.type = 'button';
      b.addEventListener('click', e => { e.stopPropagation(); closePartMenu(); openStartScreen(test, 'part', part); });
      menu.appendChild(b);
    }
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = (r.bottom + window.scrollY + 4) + 'px';
    menu.style.left = Math.max(8, Math.min(r.left + window.scrollX, window.innerWidth - 270)) + 'px';
    partMenuEl = menu;
  }

  // ---------- 開始前の確認画面 ----------
  function openStartScreen(test, mode, part) {
    showExamPanel();
    const box = el('div', 'exam-start');
    box.appendChild(el('h2', 'exam-start-title', modeTitle(test, mode, part)));
    const parts = mode === 'full' ? [1, 2, 3, 4, 5, 6, 7] : [part];
    const hasL = parts.some(p => p <= 4);
    const hasR = parts.some(p => p >= 5);
    const qCount = parts.reduce((n, p) => n + PART_Q_COUNT[p], 0);
    const ul = el('ul', 'exam-start-list');
    const items = [`問題数: ${qCount}問`];
    if (hasL) items.push('リスニング: 音声が本番のように自動で進みます(次の問題へも自動で移ります)。音声の一時停止はできません。');
    if (hasR) {
      const minutes = mode === 'full' ? 75 : Math.round(75 * qCount / 100 * 10) / 10;
      items.push(`リーディング: 制限時間${minutes}分(本番は75分。パート別の場合は問題数に応じて配分)。時間切れになると自動で採点します。`);
    }
    if (mode === 'full') items.push('リスニングの音声がすべて終わると、自動でリーディングに進みます。');
    items.push('前の問題に戻って、答えを変えられます(リスニングは、音声がすでに進んだ問題まで)。');
    items.push('テスト中は解説・翻訳・AIは出ません。採点後に、間違えた問題の解説を見られます。');
    items.push('途中でページを閉じたり再読み込みしたりすると、音声の進行は戻せません(それまでの答えは、採点用に残ります)。');
    items.forEach(t => ul.appendChild(el('li', '', t)));
    box.appendChild(ul);

    if (hasL && !isLoggedIn()) {
      box.appendChild(el('div', 'exam-start-warn', '⚠ リスニングの音声はBox連携が必要です。上部の「Initial Setup」→「① Box連携」でログインしてから開始してください。'));
    }
    const row = el('div', 'exam-start-actions');
    const startBtn = el('button', 'exam-primary-btn', 'テストを開始');
    startBtn.type = 'button';
    startBtn.disabled = hasL && !isLoggedIn();
    startBtn.addEventListener('click', () => {
      // 音声の自動再生はユーザー操作に紐付ける必要があるため、通信(await)を挟む前に、
      // このクリックの中で空のAudio要素を一度play()しておき、テスト中はこの要素を使い回す。
      const primed = new Audio();
      primed.play().catch(() => {});
      begin(test, mode, part, primed);
    });
    const backBtn = el('button', 'exam-secondary-btn', '← やめて戻る');
    backBtn.type = 'button';
    backBtn.addEventListener('click', () => { location.href = location.pathname; });
    row.appendChild(startBtn);
    row.appendChild(backBtn);
    box.appendChild(row);
    examEl.appendChild(box);
  }

  // ---------- 問題データの組み立て ----------
  async function buildUnits(test, parts) {
    const units = [];
    for (const part of parts) {
      const data = await loadPartData(test, part);
      if (part === 1 || part === 2) {
        data.questions.forEach(q => units.push({ part, kind: 'single', q, numbers: [q.number], audio: [q.audio].filter(Boolean), pauseMs: 5000 }));
      } else if (part === 3 || part === 4) {
        data.groups.forEach(g => units.push({
          part, kind: 'group', g, items: g.items, numbers: g.questions,
          audio: [g.audioConversation || g.audioTalk, g.audioQuestions].filter(Boolean),
          pauseMs: 8000 * g.items.length
        }));
      } else if (part === 5) {
        data.questions.forEach(q => units.push({ part, kind: 'p5', q, numbers: [q.number] }));
      } else if (part === 6) {
        data.passages.forEach(p => units.push({ part, kind: 'p6', p, items: p.items, numbers: p.questions }));
      } else {
        data.passages.forEach(p => units.push({ part, kind: 'p7', p, items: p.items, numbers: p.questions }));
      }
    }
    return units;
  }
  function indexQuestions(units) {
    const info = {};
    units.forEach((u, ui) => {
      if (u.kind === 'single' || u.kind === 'p5') info[u.q.number] = { part: u.part, answer: u.q.answer, unit: ui };
      else u.items.forEach(it => { info[it.number] = { part: u.part, answer: it.answer, unit: ui }; });
    });
    return info;
  }
  function unitLabel(u) {
    const n = u.numbers;
    return n.length === 1 ? `Q${n[0]}` : `Q${n[0]}-${n[n.length - 1]}`;
  }
  function sectionOf(u) { return u.part <= 4 ? 'listening' : 'reading'; }

  // ---------- 開始 ----------
  async function begin(test, mode, part, primedAudio) {
    stopAllAudio();
    const parts = mode === 'full' ? [1, 2, 3, 4, 5, 6, 7] : [part];
    examEl.innerHTML = '';
    examEl.appendChild(el('div', 'exam-loading', '問題を読み込み中...'));
    let units;
    try { units = await buildUnits(test, parts); }
    catch (e) { examEl.innerHTML = ''; examEl.appendChild(el('div', 'exam-start-warn', '問題データの読み込みに失敗しました: ' + e.message)); return; }

    exam = {
      id: String(Date.now()), test, mode, part, parts, units,
      info: indexQuestions(units), answers: {},
      lUnits: [], rUnits: [],
      phase: null, cur: 0, listenIdx: -1, follow: true,
      token: 0, cancelers: new Set(), audioEl: primedAudio, audioCancel: null,
      startedAt: Date.now(), listenStart: 0, readingDeadline: 0,
      active: true, finishing: false, lastStudyTick: Date.now(), tickTimer: null
    };
    units.forEach((u, i) => (sectionOf(u) === 'listening' ? exam.lUnits : exam.rUnits).push(i));
    if (!beforeUnloadSet) {
      beforeUnloadSet = true;
      window.addEventListener('beforeunload', e => {
        if (exam && exam.active) { e.preventDefault(); e.returnValue = ''; }
      });
    }
    buildShell();
    saveProgress();
    exam.tickTimer = setInterval(tick, 500);
    if (exam.lUnits.length) startListening(); else startReading();
  }

  // ---------- 画面の枠 ----------
  function buildShell() {
    examEl.innerHTML = '';
    const header = el('div', 'exam-header');
    const left = el('div', 'exam-header-left');
    left.appendChild(el('div', 'exam-title', modeTitle(exam.test, exam.mode, exam.part)));
    left.appendChild(el('span', 'exam-section-badge', ''));
    header.appendChild(left);
    header.appendChild(el('div', 'exam-timer', ''));
    const right = el('div', 'exam-header-right');
    right.appendChild(el('span', 'exam-progress', ''));
    const finishBtn = el('button', 'exam-finish-btn', '終了して採点');
    finishBtn.type = 'button';
    finishBtn.addEventListener('click', requestFinish);
    right.appendChild(finishBtn);
    header.appendChild(right);
    examEl.appendChild(header);
    examEl.appendChild(el('div', 'exam-status'));
    examEl.appendChild(el('div', 'exam-follow'));
    examEl.appendChild(el('div', 'exam-body'));
    const nav = el('div', 'exam-nav');
    const prev = el('button', 'exam-nav-btn exam-prev', '◀ 前の問題');
    const next = el('button', 'exam-nav-btn exam-next', '次の問題 ▶');
    prev.type = next.type = 'button';
    prev.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));
    nav.appendChild(prev);
    nav.appendChild(next);
    examEl.appendChild(nav);
    examEl.appendChild(el('div', 'exam-palette'));
  }

  function sectionUnits() { return exam.phase === 'listening' ? exam.lUnits : exam.rUnits; }
  function allowedUnit(ui) {
    if (sectionOf(exam.units[ui]) !== exam.phase) return false;
    return exam.phase === 'reading' || ui <= exam.listenIdx;
  }
  function step(delta) {
    const list = sectionUnits().filter(allowedUnit);
    const pos = list.indexOf(exam.cur);
    const target = list[pos + delta];
    if (target != null) goTo(target, true);
  }
  function goTo(ui, manual) {
    if (!allowedUnit(ui)) return;
    exam.cur = ui;
    if (exam.phase === 'listening') exam.follow = ui === exam.listenIdx;
    renderUnit();
    refreshChrome();
    if (manual) window.scrollTo({ top: 0 });
  }

  // ---------- 問題の表示 ----------
  function choiceBlock(number, labelText, choices, showText) {
    const block = el('div', 'q-block');
    if (labelText) block.appendChild(el('div', 'q-text', labelText));
    const wrap = el('div', 'exam-choices');
    Object.keys(choices).forEach(letter => {
      const b = el('button', 'choice', showText ? `(${letter}) ${choices[letter]}` : `(${letter})`);
      b.type = 'button';
      b.dataset.letter = letter;
      if (exam.answers[number] === letter) b.classList.add('selected');
      b.addEventListener('click', () => {
        if (exam.answers[number] === letter) delete exam.answers[number];
        else exam.answers[number] = letter;
        wrap.querySelectorAll('.choice').forEach(x => x.classList.toggle('selected', x.dataset.letter === exam.answers[number]));
        saveProgress();
        refreshChrome();
      });
      wrap.appendChild(b);
    });
    block.appendChild(wrap);
    return block;
  }

  function docBox(label, image, text) {
    const d = el('div', 'doc-box');
    if (label) d.appendChild(el('div', 'doc-label', label));
    if (image) {
      d.classList.add('has-photo');
      d.appendChild(buildPassageImageWithTextToggle(image, label || '本文', text));
    } else {
      d.appendChild(el('div', '', text || ''));
    }
    return d;
  }

  function renderUnit() {
    const body = $('.exam-body');
    body.innerHTML = '';
    const u = exam.units[exam.cur];
    if (u.kind === 'single') {
      const q = u.q;
      const wrap = el('div', 'exam-single');
      wrap.appendChild(el('div', 'q-text', `Q${q.number}`));
      if (u.part === 1 && q.image) {
        const img = el('img', 'question-photo');
        img.src = q.image;
        img.alt = `Q${q.number}の写真`;
        wrap.appendChild(img);
      }
      wrap.appendChild(choiceBlock(q.number, '', u.part === 1 ? q.statements : q.responses, false));
      body.appendChild(wrap);
    } else if (u.kind === 'group') {
      const g = u.g;
      const wrap = el('div', 'exam-group');
      if (g.graphicImage) {
        const img = el('img', 'question-photo');
        img.src = g.graphicImage;
        img.alt = '図表';
        wrap.appendChild(img);
      } else if (g.graphic) {
        wrap.appendChild(el('p', 'audio-label', '図表: ' + g.graphic));
      }
      g.items.forEach(item => wrap.appendChild(choiceBlock(item.number, `${item.number}. ${item.text}`, item.choices, true)));
      body.appendChild(wrap);
    } else if (u.kind === 'p5') {
      body.appendChild(choiceBlock(u.q.number, `${u.q.number}. ${u.q.sentence}`, u.q.choices, true));
    } else {
      const p = u.p;
      const main = el('div');
      if (p.topic) main.appendChild(el('div', 'passage-topic', p.topic));
      if (u.kind === 'p6') {
        main.appendChild(docBox('', p.textImage, p.text));
      } else {
        p.documents.forEach(d => main.appendChild(docBox(d.label, d.image, d.text)));
      }
      const side = el('div');
      p.items.forEach(item => side.appendChild(choiceBlock(item.number,
        u.kind === 'p6' ? `(${item.number})` : `${item.number}. ${item.text}`, item.choices, true)));
      body.appendChild(buildReadingLayout(main, [side]));
    }
  }

  // ---------- ヘッダー・ナビ・パレットの更新 ----------
  function buildPalette() {
    const pal = $('.exam-palette');
    pal.innerHTML = '';
    let lastPart = null;
    sectionUnits().forEach(ui => {
      const u = exam.units[ui];
      if (u.part !== lastPart) {
        lastPart = u.part;
        pal.appendChild(el('div', 'exam-palette-part', PART_LABELS_EXAM[u.part]));
      }
      u.numbers.forEach(n => {
        const b = el('button', 'exam-pal-btn', String(n));
        b.type = 'button';
        b.dataset.q = n;
        b.dataset.unit = ui;
        b.addEventListener('click', () => goTo(ui, true));
        pal.appendChild(b);
      });
    });
  }
  function refreshChrome() {
    if (!exam || !exam.active) return;
    const phaseNames = { listening: 'リスニング', reading: 'リーディング' };
    $('.exam-section-badge').textContent = phaseNames[exam.phase] || '';
    const qs = sectionUnits().flatMap(ui => exam.units[ui].numbers);
    const answered = qs.filter(n => exam.answers[n]).length;
    $('.exam-progress').textContent = `回答 ${answered}/${qs.length}`;
    const list = sectionUnits().filter(allowedUnit);
    const pos = list.indexOf(exam.cur);
    $('.exam-prev').disabled = pos <= 0;
    $('.exam-next').disabled = pos < 0 || pos >= list.length - 1;
    examEl.querySelectorAll('.exam-pal-btn').forEach(b => {
      const n = Number(b.dataset.q), ui = Number(b.dataset.unit);
      b.classList.toggle('answered', !!exam.answers[n]);
      b.classList.toggle('current', ui === exam.cur);
      b.disabled = !allowedUnit(ui);
    });
    // 音声が先へ進んでいるのに、前の問題を見ているとき。
    const follow = $('.exam-follow');
    follow.innerHTML = '';
    if (exam.phase === 'listening' && !exam.follow && exam.listenIdx >= 0) {
      const u = exam.units[exam.listenIdx];
      follow.appendChild(el('span', '', `音声は Part${u.part} ${unitLabel(u)} に進んでいます。`));
      const b = el('button', 'exam-follow-btn', '今の問題へ');
      b.type = 'button';
      b.addEventListener('click', () => goTo(exam.listenIdx, true));
      follow.appendChild(b);
      follow.style.display = 'flex';
    } else {
      follow.style.display = 'none';
    }
  }
  function setStatus(text, kind) {
    const s = examEl && $('.exam-status');
    if (!s) return;
    s.textContent = text;
    s.className = 'exam-status' + (kind ? ' exam-status-' + kind : '');
  }
  function tick() {
    if (!exam || !exam.active) return;
    const timer = $('.exam-timer');
    if (exam.phase === 'listening') {
      timer.textContent = `経過 ${fmtTime(Date.now() - exam.listenStart)}`;
      timer.classList.remove('exam-timer-warn');
    } else if (exam.phase === 'reading') {
      const remain = exam.readingDeadline - Date.now();
      timer.textContent = `残り ${fmtTime(remain)}`;
      timer.classList.toggle('exam-timer-warn', remain < 5 * 60 * 1000 * timeScale());
      if (remain <= 0) finish('time');
    }
    if (document.visibilityState === 'visible' && Date.now() - exam.lastStudyTick >= 60000) {
      exam.lastStudyTick = Date.now();
      recordStudyTime();
    }
  }

  // ---------- リスニング(音声が自動で進む) ----------
  function sleep(ms, onTick) {
    return new Promise(resolve => {
      const end = Date.now() + ms;
      let iv = null;
      const done = () => { clearInterval(iv); exam.cancelers.delete(done); resolve(); };
      iv = setInterval(() => {
        if (onTick) onTick(Math.max(0, end - Date.now()));
        if (Date.now() >= end) done();
      }, 200);
      exam.cancelers.add(done);
    });
  }
  function playUrl(url) {
    return new Promise(resolve => {
      const a = exam.audioEl;
      const done = () => { a.onended = a.onerror = null; exam.audioCancel = null; resolve(); };
      exam.audioCancel = done;
      a.onended = done;
      a.onerror = done;
      a.src = url;
      a.play().catch(() => {
        setStatus('⚠ 音声の再生がブロックされました(この問題の音声はスキップします)', 'error');
        done();
      });
    });
  }
  function folderId() { return getTestConfig(exam.test).audioFolderId; }
  function prefetch(u) {
    if (!u || !u.audio) return;
    u.audio.forEach(f => { getAudioUrl(f, folderId()).catch(() => {}); });
  }
  // 再生が済んだ音声のobject URLを解放する(200問ぶんを抱え込まないようにする)。
  function releaseAudio(u) {
    (u.audio || []).forEach(f => {
      const key = folderId() + '|' + f;
      if (audioUrlCache[key]) { try { URL.revokeObjectURL(audioUrlCache[key]); } catch (e) { /* ignore */ } delete audioUrlCache[key]; }
    });
  }

  function startListening() {
    exam.phase = 'listening';
    exam.listenStart = Date.now();
    exam.cur = exam.lUnits[0];
    exam.listenIdx = exam.lUnits[0];
    exam.follow = true;
    buildPalette();
    renderUnit();
    refreshChrome();
    runListening(++exam.token);
  }
  function onAudioAdvance() {
    if (exam.follow) { exam.cur = exam.listenIdx; renderUnit(); window.scrollTo({ top: 0 }); }
    refreshChrome();
  }
  async function runListening(token) {
    const idxs = exam.lUnits;
    try {
      for (let k = 0; k < idxs.length; k++) {
        if (exam.token !== token) return;
        const u = exam.units[idxs[k]];
        if (k > 0) { exam.listenIdx = idxs[k]; onAudioAdvance(); }
        if (k + 1 < idxs.length) prefetch(exam.units[idxs[k + 1]]);
        for (const file of u.audio) {
          if (exam.token !== token) return;
          setStatus(`▶ Part${u.part} ${unitLabel(u)} の音声を再生中`, 'play');
          const url = await getAudioUrl(file, folderId());
          if (exam.token !== token) return;
          if (!url) {
            setStatus('⚠ 音声を取得できませんでした: ' + (typeof lastAudioError === 'string' && lastAudioError ? lastAudioError : file) + '(この音声はスキップします)', 'error');
            await sleep(3000 * timeScale());
            continue;
          }
          await playUrl(url);
        }
        if (exam.token !== token) return;
        await sleep(u.pauseMs * timeScale(), ms => setStatus(`⏱ 次の問題まで ${Math.ceil(ms / 1000)}秒(答えを選んでください)`, 'pause'));
        if (exam.token !== token) return;
        releaseAudio(u);
      }
      if (exam.token !== token) return;
      await listeningEnded(token);
    } catch (e) {
      setStatus('⚠ リスニングの進行中にエラーが発生しました: ' + e.message, 'error');
    }
  }
  async function listeningEnded(token) {
    if (!exam.rUnits.length) { finish('end'); return; }
    // 通しテスト: リスニングが終わったら、少し間をおいて自動でリーディングへ。
    for (let s = 5; s > 0; s--) {
      setStatus(`リスニング終了です。${s}秒後にリーディングを開始します(75分)`, 'pause');
      await sleep(1000 * timeScale());
      if (exam.token !== token) return;
    }
    startReading();
  }

  // ---------- リーディング(制限時間つき・自分のペース) ----------
  function startReading() {
    exam.token++;
    exam.phase = 'reading';
    const qCount = exam.rUnits.reduce((n, ui) => n + exam.units[ui].numbers.length, 0);
    const limit = exam.mode === 'full' ? READING_FULL_MS : Math.round(READING_FULL_MS * qCount / 100);
    exam.readingDeadline = Date.now() + limit * timeScale();
    exam.cur = exam.rUnits[0];
    exam.follow = true;
    setStatus(`リーディング開始(制限時間 ${fmtTime(limit)})。時間切れで自動的に採点します。`, 'info');
    buildPalette();
    renderUnit();
    refreshChrome();
    window.scrollTo({ top: 0 });
    saveProgress();
  }

  // ---------- 終了・採点 ----------
  function requestFinish() {
    if (!exam || !exam.active) return;
    const total = exam.units.reduce((n, u) => n + u.numbers.length, 0);
    const answered = Object.keys(exam.answers).length;
    const msg = answered < total
      ? `未回答が${total - answered}問あります(未回答は不正解として採点します)。\nテストを終了して採点しますか?`
      : 'テストを終了して採点しますか?';
    if (window.confirm(msg)) finish('manual');
  }
  function abortTimers() {
    exam.token++;
    exam.cancelers.forEach(f => f());
    exam.cancelers.clear();
    if (exam.audioCancel) exam.audioCancel();
    try { exam.audioEl.pause(); } catch (e) { /* ignore */ }
    clearInterval(exam.tickTimer);
  }
  function finish(reason) {
    if (!exam || exam.finishing) return;
    exam.finishing = true;
    abortTimers();
    exam.active = false;
    const result = computeResult(exam, reason);
    recordHistory(exam);
    saveResult(result);
    localStorage.removeItem(LS_PROGRESS);
    showResult(result);
  }

  function convert(section, raw) {
    const row = SCORE_TABLE[section].find(r => raw >= r[0] && raw <= r[1]);
    return row ? { lo: row[2], hi: row[3], mid: Math.round((row[2] + row[3]) / 2 / 5) * 5 } : null;
  }
  function computeResult(ex, reason) {
    const perPart = {};
    const wrong = [], unanswered = [];
    ex.units.forEach(u => {
      u.numbers.forEach(n => {
        const info = ex.info[n];
        const pp = perPart[info.part] || (perPart[info.part] = { total: 0, correct: 0, unanswered: 0 });
        pp.total++;
        const a = ex.answers[n];
        if (!a) { pp.unanswered++; unanswered.push(n); }
        else if (a === info.answer) pp.correct++;
        else wrong.push(n);
      });
    });
    const sum = (parts) => parts.reduce((o, p) => {
      if (perPart[p]) { o.total += perPart[p].total; o.correct += perPart[p].correct; }
      return o;
    }, { total: 0, correct: 0 });
    const listening = sum([1, 2, 3, 4]);
    const reading = sum([5, 6, 7]);
    let estimate = null;
    if (ex.mode === 'full') {
      const l = convert('L', listening.correct), r = convert('R', reading.correct);
      estimate = { l, r, low: l.lo + r.lo, high: l.hi + r.hi, mid: l.mid + r.mid };
    }
    return {
      id: ex.id, date: new Date().toISOString(), test: ex.test, mode: ex.mode, part: ex.part, reason,
      answers: ex.answers, perPart, listening, reading, estimate, wrong, unanswered,
      qParts: Object.fromEntries(Object.keys(ex.info).map(n => [n, ex.info[n].part])),
      correctAnswers: Object.fromEntries(Object.keys(ex.info).map(n => [n, ex.info[n].answer]))
    };
  }

  // 回答履歴(挑戦回数・正誤)にだけ記録する。「前回学習した問題」(日別ログ)には、
  // 200問がまとめて入ると再生リストが巨大になるため記録しない。
  function recordHistory(ex) {
    const store = getAttemptsStore();
    const now = Date.now();
    const put = (key, isCorrect, noteKey, bumpCount) => {
      const prev = getAttemptEntry(key);
      store[key] = {
        count: bumpCount ? Math.min(99, prev.count + 1) : prev.count,
        lastCorrect: !!isCorrect, lastAt: now, noteKey: noteKey || prev.noteKey || null
      };
    };
    const t = ex.test;
    const p5 = ex.units.filter(u => u.kind === 'p5');
    ex.units.forEach(u => {
      if (u.kind === 'single') {
        const a = ex.answers[u.q.number];
        if (a) put(`${t}-${u.part}-${u.q.number}`, a === u.q.answer, null, true);
      } else if (u.kind === 'p5') {
        const a = ex.answers[u.q.number];
        const batchFirst = p5[Math.floor(p5.indexOf(u) / 5) * 5].q.number;
        if (a) put(`${t}-5-${u.q.number}`, a === u.q.answer, `${t}-5-${batchFirst}`, true);
      } else if (u.kind === 'group') {
        u.items.forEach(it => {
          const a = ex.answers[it.number];
          if (a) put(`${t}-${u.part}-${it.number}`, a === it.answer, `${t}-${u.part}-${u.numbers[0]}`, true);
        });
      } else {
        const answeredAny = u.items.some(it => ex.answers[it.number]);
        if (!answeredAny) return;
        const attemptKey = `${t}-${u.part}-${u.numbers[0]}`;
        put(attemptKey, u.items.every(it => ex.answers[it.number] === it.answer), null, true);
        u.items.forEach(it => {
          const a = ex.answers[it.number];
          if (a) put(`${t}-${u.part}-${it.number}-correct`, a === it.answer, attemptKey, false);
        });
      }
    });
    localStorage.setItem(ATTEMPTS_LS, JSON.stringify(store));
    recordStudyTime();
    recordStudyActivity();
    if (typeof saveProgressToSheet === 'function') saveProgressToSheet();
  }

  function getResults() {
    try { return JSON.parse(localStorage.getItem(LS_RESULTS) || '[]'); } catch (e) { return []; }
  }
  function saveResult(result) {
    const list = getResults().filter(r => r.id !== result.id);
    list.unshift(result);
    try { localStorage.setItem(LS_RESULTS, JSON.stringify(list.slice(0, 30))); } catch (e) { /* 容量超過は無視 */ }
  }
  function saveProgress() {
    if (!exam || !exam.active) return;
    try {
      localStorage.setItem(LS_PROGRESS, JSON.stringify({
        id: exam.id, test: exam.test, mode: exam.mode, part: exam.part, startedAt: exam.startedAt,
        answers: exam.answers, phase: exam.phase
      }));
    } catch (e) { /* ignore */ }
  }

  // ---------- 結果画面 ----------
  function pct(c, t) { return t ? Math.round(c / t * 100) + '%' : '-'; }
  function showResult(result) {
    showExamPanel();
    window.examReturnId = result.id;
    const box = el('div', 'exam-result');
    box.appendChild(el('h2', 'exam-start-title', modeTitle(result.test, result.mode, result.part) + ' の結果'));
    const reasonText = { time: '制限時間が終了したため、自動で採点しました。', end: '音声が最後まで終わったため、自動で採点しました。', manual: '', saved: '中断されたテストを採点しました。' }[result.reason] || '';
    const d = new Date(result.date);
    box.appendChild(el('div', 'exam-result-sub', `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}　${reasonText}`));

    if (result.estimate) {
      const e = result.estimate;
      const card = el('div', 'exam-score-card');
      card.appendChild(el('div', 'exam-score-line', `リスニング ${result.listening.correct}/${result.listening.total}問正解 → 換算点範囲 ${e.l.lo}〜${e.l.hi}(目安 ${e.l.mid})`));
      card.appendChild(el('div', 'exam-score-line', `リーディング ${result.reading.correct}/${result.reading.total}問正解 → 換算点範囲 ${e.r.lo}〜${e.r.hi}(目安 ${e.r.mid})`));
      const total = el('div', 'exam-score-total');
      total.appendChild(el('span', 'exam-score-label', '予想トータルスコア'));
      total.appendChild(el('span', 'exam-score-mid', String(e.mid)));
      total.appendChild(el('span', 'exam-score-range', `(範囲 ${e.low}〜${e.high})`));
      card.appendChild(total);
      card.appendChild(el('div', 'exam-score-note', '公式問題集の「参考スコア範囲の換算表」(p.7)を使った推定です。目安点は各範囲の中央値で、実際のスコアとは異なります。未回答は不正解として数えています。'));
      box.appendChild(card);
    } else {
      const c = Object.values(result.perPart).reduce((o, p) => ({ t: o.t + p.total, c: o.c + p.correct }), { t: 0, c: 0 });
      const card = el('div', 'exam-score-card');
      card.appendChild(el('div', 'exam-score-total', ''));
      card.lastChild.appendChild(el('span', 'exam-score-label', '正解数'));
      card.lastChild.appendChild(el('span', 'exam-score-mid', `${c.c}/${c.t}`));
      card.lastChild.appendChild(el('span', 'exam-score-range', `(正答率 ${pct(c.c, c.t)})`));
      card.appendChild(el('div', 'exam-score-note', 'パート別のテストでは、スコアの換算は行いません(全問テストで換算します)。'));
      box.appendChild(card);
    }

    const table = el('table', 'exam-part-table');
    const thead = el('tr');
    ['パート', '正解', '問題数', '正答率', '未回答'].forEach(h => thead.appendChild(el('th', '', h)));
    table.appendChild(thead);
    Object.keys(result.perPart).sort().forEach(p => {
      const pp = result.perPart[p];
      const tr = el('tr');
      [PART_LABELS_EXAM[p], pp.correct, pp.total, pct(pp.correct, pp.total), pp.unanswered].forEach(v => tr.appendChild(el('td', '', String(v))));
      table.appendChild(tr);
    });
    box.appendChild(table);

    // 間違えた問題・未回答の問題 → 解説・ノートモードで開く。
    const bad = result.wrong.concat(result.unanswered).sort((a, b) => a - b);
    box.appendChild(el('h3', 'exam-result-h3', bad.length ? `間違えた問題・未回答の問題(${bad.length}問)― 押すと解説とノートを見られます` : '全問正解です!'));
    const chips = el('div', 'exam-chips');
    bad.forEach(n => {
      const isBlank = result.unanswered.includes(n);
      const b = el('button', 'exam-chip' + (isBlank ? ' blank' : ''), `Q${n}${isBlank ? '(未)' : ''}`);
      b.type = 'button';
      b.addEventListener('click', () => openExplanation(result, n));
      chips.appendChild(b);
    });
    box.appendChild(chips);

    // 全問の○×一覧
    const allDet = el('details', 'exam-all-details');
    allDet.appendChild(el('summary', '', '全問の結果一覧'));
    const grid = el('div', 'exam-all-grid');
    Object.keys(result.qParts).map(Number).sort((a, b) => a - b).forEach(n => {
      const a = result.answers[n];
      const ok = a && a === result.correctAnswers[n];
      const cell = el('button', 'exam-all-cell ' + (ok ? 'ok' : a ? 'ng' : 'blank'),
        `${n} ${ok ? '○' : a ? '×' : '－'}`);
      cell.type = 'button';
      cell.title = a ? `あなたの回答 ${a} / 正解 ${result.correctAnswers[n]}` : `未回答 / 正解 ${result.correctAnswers[n]}`;
      cell.addEventListener('click', () => openExplanation(result, n));
      grid.appendChild(cell);
    });
    allDet.appendChild(grid);
    box.appendChild(allDet);

    const row = el('div', 'exam-start-actions');
    const top = el('button', 'exam-primary-btn', 'トップへ戻る');
    top.type = 'button';
    top.addEventListener('click', () => { location.href = location.pathname; });
    row.appendChild(top);
    box.appendChild(row);
    examEl.appendChild(box);
    hideBackBtn();
  }

  // ---------- 結果 → 解説・ノートモード → 結果へ戻る ----------
  function ensureBackBtn() {
    let b = document.getElementById('examBackBtn');
    if (!b) {
      b = el('button', 'exam-back-btn', '← 通しテストの結果へ');
      b.id = 'examBackBtn';
      b.type = 'button';
      b.addEventListener('click', backToResult);
      const header = document.querySelector('.practice-header');
      if (header) header.appendChild(b);
    }
    return b;
  }
  function hideBackBtn() {
    const b = document.getElementById('examBackBtn');
    if (b) b.style.display = 'none';
  }
  function openExplanation(result, n) {
    window.examReturnId = result.id;
    examEl.style.display = 'none';
    ensureBackBtn().style.display = 'inline-block';
    jumpToQuestionNumber(result.test, result.qParts[n], n, true);
  }
  function backToResult() {
    const r = getResults().find(x => x.id === window.examReturnId);
    if (!r) return;
    stopAllAudio();
    showResult(r);
  }

  // ---------- 中断されたテストの扱い(ページを再読み込みした場合) ----------
  async function resumeAsResult(saved) {
    showExamPanel();
    examEl.appendChild(el('div', 'exam-loading', '採点中...'));
    const parts = saved.mode === 'full' ? [1, 2, 3, 4, 5, 6, 7] : [saved.part];
    const units = await buildUnits(saved.test, parts);
    const ex = { id: saved.id, test: saved.test, mode: saved.mode, part: saved.part, units, info: indexQuestions(units), answers: saved.answers || {} };
    const result = computeResult(ex, 'saved');
    exam = { active: false, test: saved.test, units, info: ex.info, answers: ex.answers };
    recordHistory(ex);
    saveResult(result);
    localStorage.removeItem(LS_PROGRESS);
    showResult(result);
  }
  function checkUnfinished() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(LS_PROGRESS) || 'null'); } catch (e) { /* ignore */ }
    if (!saved || !saved.test) return;
    const host = document.querySelector('.empty-state-main');
    if (!host) return;
    const answered = Object.keys(saved.answers || {}).length;
    const banner = el('div', 'exam-resume-banner');
    banner.appendChild(el('span', '', `中断された通しテストがあります(${modeTitle(saved.test, saved.mode, saved.part)}・回答${answered}問)。`));
    const b1 = el('button', 'exam-secondary-btn', 'ここまでの答えで採点する');
    b1.type = 'button';
    b1.addEventListener('click', () => { banner.remove(); resumeAsResult(saved); });
    const b2 = el('button', 'exam-secondary-btn', '破棄する');
    b2.type = 'button';
    b2.addEventListener('click', () => { localStorage.removeItem(LS_PROGRESS); banner.remove(); });
    banner.appendChild(b1);
    banner.appendChild(b2);
    host.insertBefore(banner, host.firstChild);
  }

  window.examOpenStartScreen = openStartScreen;
  window.examShowPartMenu = showPartMenu;
  window.__examDebug = () => exam;
  checkUnfinished();
})();
