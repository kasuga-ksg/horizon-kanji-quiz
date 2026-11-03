(() => {
  "use strict";

  // ---------------------------------------------------------
  // Config
  // ---------------------------------------------------------
  const QUESTIONS_PER_GAME = 20;
  const TIME_LIMIT_MS = 15000;
  const BASE_POINTS = 100;
  const HIGHSCORE_KEY = "horizon-kanji-quiz:highscore";

  // ---------------------------------------------------------
  // DOM
  // ---------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const screens = {
    title: $("screen-title"),
    game: $("screen-game"),
    result: $("screen-result"),
  };
  const el = {
    highscore: $("highscore"),
    qCount: $("q-count"),
    combo: $("combo"),
    score: $("score"),
    timerBar: $("timer-bar"),
    card: $("card"),
    artist: $("q-artist"),
    work: $("q-work"),
    ruby: $("q-ruby"),
    kanji: $("q-kanji"),
    hint: $("q-hint"),
    resultPop: $("q-result"),
    form: $("answer-form"),
    input: $("answer-input"),
    submit: $("btn-submit"),
    hintBtn: $("btn-hint"),
    skipBtn: $("btn-skip"),
    finalScore: $("final-score"),
    rank: $("result-rank"),
    newRecord: $("new-record"),
    resultList: $("result-list"),
  };

  // ---------------------------------------------------------
  // State
  // ---------------------------------------------------------
  let mode = "ALL";
  let state = null;

  // ---------------------------------------------------------
  // Answer normalization
  //   ひらがな→カタカナ / 全角→半角 / 大小文字 / ウムラウト / 記号を吸収
  // ---------------------------------------------------------
  function normalize(str) {
    let s = String(str).normalize("NFKC").toLowerCase();
    s = s.replace(/ß/g, "ss");
    // ラテン文字のアクセント記号を除去（ä→a など）。かなの濁点には影響しない
    s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC");
    // ひらがな → カタカナ
    s = s.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
    // 空白・中黒・記号を除去
    s = s.replace(/[\s・･·.,、。!！?？「」『』()（）\-‐―〜~'"]/g, "");
    return s;
  }

  function isCorrect(input, q) {
    const n = normalize(input);
    if (!n) return false;
    return [q.ruby, ...(q.answers || [])].some((a) => normalize(a) === n);
  }

  // ---------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function show(name) {
    Object.entries(screens).forEach(([k, s]) => s.classList.toggle("is-active", k === name));
  }

  function restartAnim(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }

  function getHighscore() {
    return Number(localStorage.getItem(HIGHSCORE_KEY) || 0);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------------------------------------------------------
  // Game flow
  // ---------------------------------------------------------
  function startGame() {
    const pool = (window.QUESTIONS || []).filter((q) => mode === "ALL" || q.artist === mode);
    if (pool.length === 0) {
      alert("このモードの問題がまだありません。js/questions.js に追加してください。");
      return;
    }
    state = {
      list: shuffle(pool).slice(0, QUESTIONS_PER_GAME),
      index: 0,
      score: 0,
      combo: 0,
      maxCombo: 0,
      history: [],
      hintUsed: false,
      locked: false,
      startedAt: 0,
      rafId: 0,
    };
    el.score.textContent = "0";
    el.combo.textContent = "0";
    show("game");
    nextQuestion();
  }

  function nextQuestion() {
    const q = state.list[state.index];
    state.hintUsed = false;
    state.locked = false;

    el.qCount.textContent = `${state.index + 1} / ${state.list.length}`;
    el.artist.textContent = q.artist;
    el.artist.dataset.artist = q.artist;
    el.work.textContent = q.work ? `収録：${q.work}` : "";
    el.kanji.textContent = q.kanji;
    // 長い当て字は文字数に応じて縮小し、折り返しを許可する
    const len = Array.from(q.kanji).length;
    if (len > 4) {
      const rem = Math.max(1.3, Math.min(6.5, 30 / len));
      const vw = Math.max(4.5, 80 / len);
      el.kanji.style.fontSize = `min(${rem}rem, ${vw}vw)`;
      el.kanji.style.wordBreak = len > 8 ? "normal" : "";
    } else {
      el.kanji.style.fontSize = "";
      el.kanji.style.wordBreak = "";
    }
    el.ruby.textContent = "";
    el.ruby.classList.remove("is-shown");
    el.hint.innerHTML = "";
    el.resultPop.className = "result-pop";
    el.input.value = "";
    el.input.disabled = false;
    el.submit.disabled = false;
    el.hintBtn.disabled = false;
    el.skipBtn.disabled = false;
    restartAnim(el.card, "is-enter");
    el.input.focus();

    state.startedAt = performance.now();
    cancelAnimationFrame(state.rafId);
    tick();
  }

  function tick() {
    const elapsed = performance.now() - state.startedAt;
    const ratio = Math.max(0, 1 - elapsed / TIME_LIMIT_MS);
    el.timerBar.style.transform = `scaleX(${ratio})`;
    el.timerBar.style.backgroundPosition = `${(1 - ratio) * 100}% 0`;
    if (ratio <= 0) {
      judge(false, true);
      return;
    }
    state.rafId = requestAnimationFrame(tick);
  }

  function judge(correct, timeout = false) {
    if (state.locked) return;
    state.locked = true;
    cancelAnimationFrame(state.rafId);

    const q = state.list[state.index];
    const elapsed = performance.now() - state.startedAt;
    let gained = 0;

    if (correct) {
      state.combo += 1;
      state.maxCombo = Math.max(state.maxCombo, state.combo);
      const speedBonus = Math.round(Math.max(0, 1 - elapsed / TIME_LIMIT_MS) * 100);
      const comboBonus = Math.min(state.combo - 1, 5) * 20;
      gained = BASE_POINTS + speedBonus + comboBonus;
      if (state.hintUsed) gained = Math.round(gained / 2);
      state.score += gained;
      el.resultPop.textContent = "正解";
      el.resultPop.className = "result-pop is-ok";
      restartAnim(el.card, "is-correct");
      restartAnim(el.combo, "is-bump");
    } else {
      state.combo = 0;
      el.resultPop.textContent = timeout ? "時間切れ" : "残念";
      el.resultPop.className = "result-pop is-ng";
      restartAnim(el.card, "is-wrong");
    }

    el.score.textContent = state.score;
    el.combo.textContent = state.combo;
    el.ruby.textContent = q.ruby;
    el.ruby.classList.add("is-shown");
    el.input.disabled = true;
    el.submit.disabled = true;
    el.hintBtn.disabled = true;
    el.skipBtn.disabled = true;

    state.history.push({ q, correct, gained });

    setTimeout(() => {
      state.index += 1;
      if (state.index < state.list.length) nextQuestion();
      else endGame();
    }, 1800);
  }

  function useHint() {
    if (state.locked || state.hintUsed) return;
    state.hintUsed = true;
    const r = state.list[state.index].ruby;
    const chars = Array.from(r);
    const masked = chars.map((c, i) => (i === 0 ? c : "＿")).join(" ");
    el.hint.innerHTML = `ヒント：<b>${escapeHtml(masked)}</b>（${chars.length}文字）`;
    el.hintBtn.disabled = true;
    el.input.focus();
  }

  function rankFor(ratio) {
    if (ratio >= 1) return "称号：地平線の語り部";
    if (ratio >= 0.8) return "称号：歴戦の詩人";
    if (ratio >= 0.5) return "称号：物語の旅人";
    if (ratio >= 0.2) return "称号：迷える子羊";
    return "称号：まだ見ぬ地平線へ";
  }

  function endGame() {
    const total = state.list.length;
    const correctCount = state.history.filter((h) => h.correct).length;

    el.finalScore.textContent = state.score;
    el.rank.textContent = `${correctCount} / ${total} 問正解 ・ 最大 ${state.maxCombo} コンボ ― ${rankFor(correctCount / total)}`;

    const best = getHighscore();
    const isNew = state.score > best;
    if (isNew) localStorage.setItem(HIGHSCORE_KEY, String(state.score));
    el.newRecord.hidden = !isNew;
    el.highscore.textContent = Math.max(best, state.score);

    el.resultList.innerHTML = state.history
      .map(
        ({ q, correct }) => `
        <li class="${correct ? "ok" : "ng"}">
          <span class="mark">${correct ? "◯" : "✕"}</span>
          <span class="word">
            <ruby>${escapeHtml(q.kanji)}<rt>${escapeHtml(q.ruby)}</rt></ruby>
            <span class="work">${escapeHtml(q.work || "")}</span>
          </span>
        </li>`
      )
      .join("");

    state.lastSummary = `${correctCount}/${total}問正解・${state.score}点`;
    show("result");
  }

  function share() {
    const text = `「地平線でGO！」で${state.lastSummary}！\n${location.href}\n#地平線でGO`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }

  // ---------------------------------------------------------
  // Events
  // ---------------------------------------------------------
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      mode = btn.dataset.mode;
      document.querySelectorAll(".mode-btn").forEach((b) => {
        const sel = b === btn;
        b.classList.toggle("is-selected", sel);
        b.setAttribute("aria-checked", String(sel));
      });
    });
  });

  $("btn-start").addEventListener("click", startGame);
  $("btn-retry").addEventListener("click", startGame);
  $("btn-back").addEventListener("click", () => show("title"));
  $("btn-share").addEventListener("click", share);
  el.hintBtn.addEventListener("click", useHint);
  el.skipBtn.addEventListener("click", () => judge(false));

  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!state || state.locked) return;
    const value = el.input.value;
    if (!value.trim()) return;
    if (isCorrect(value, state.list[state.index])) {
      judge(true);
    } else {
      // 不正解でも時間内なら再挑戦可能
      restartAnim(el.card, "is-wrong");
      el.input.select();
    }
  });

  // IME変換確定のEnterで誤送信しないようにする
  el.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.isComposing || e.keyCode === 229)) e.preventDefault();
  });

  el.highscore.textContent = getHighscore();

  // 問題データのチェック：かな表記の正解がないとひらがなで答えられない
  (window.QUESTIONS || []).forEach((q) => {
    const hasKana = [q.ruby, ...(q.answers || [])].some((a) => /^[\u3041-\u3096\u30a1-\u30fcー]+$/.test(normalize(a)));
    if (!hasKana) {
      console.warn(`[questions.js] 「${q.kanji}」にかな表記の正解がありません。answers に読みをかなで追加してください。`);
    }
  });

  // ---------------------------------------------------------
  // Starfield background
  // ---------------------------------------------------------
  const canvas = $("stars");
  const ctx = canvas.getContext("2d");
  let stars = [];
  function resize() {
    canvas.width = innerWidth * devicePixelRatio;
    canvas.height = innerHeight * devicePixelRatio;
    stars = Array.from({ length: Math.round((innerWidth * innerHeight) / 6000) }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.4 * devicePixelRatio + 0.2,
      p: Math.random() * Math.PI * 2,
      s: 0.5 + Math.random() * 1.5,
    }));
  }
  function draw(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const st of stars) {
      const a = 0.35 + 0.65 * Math.abs(Math.sin(st.p + (t / 1000) * st.s));
      ctx.fillStyle = `hsla(45, 80%, 90%, ${a})`;
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }
  addEventListener("resize", resize);
  resize();
  requestAnimationFrame(draw);
})();
