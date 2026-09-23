(() => {
  "use strict";

  const STORAGE_PREFIX = "sts_trail_sign_match_best_flips";
  const HINT_SEEN_KEY = "sts_trail_sign_match_hint_seen";

  // ---- Card content: 8 pairs mixing MTB East branding, race facts, and general MTB/safety knowledge ----
  // category: 'brand' (club identity) | 'race' (real League round facts) | 'know' (general riding/safety knowledge)
  const PAIRS = [
    {
      id: "mascot",
      type: "image",
      category: "brand",
      src: "assets/header-mark.png",
      label: "MTB East mascot",
      fact: "MTB East's mascot is a mole — you'll spot them on jerseys, race badges and the website.",
    },
    {
      id: "round1",
      type: "image",
      category: "race",
      src: "assets/round1-potash.png",
      label: "Round 1",
      fact: "Round 1 of the MTB East League races at Potash!",
    },
    {
      id: "round2",
      type: "image",
      category: "race",
      src: "assets/round2-gallows.png",
      label: "Round 2",
      fact: "Round 2 of the MTB East League races at Gallows Green!",
    },
    {
      id: "fox",
      type: "image",
      category: "brand",
      src: "assets/round3-fox.png",
      label: "Fox badge",
      fact: "MTB East keeps a Fox badge ready for a future League round.",
    },
    {
      id: "owl",
      type: "image",
      category: "brand",
      src: "assets/round4-owl.png",
      label: "Owl badge",
      fact: "MTB East keeps an Owl badge ready for a future League round.",
    },
    {
      id: "olympic",
      type: "icon",
      category: "know",
      icon: "olympic",
      label: "Olympic sport",
      fact: "Mountain biking became an Olympic sport at the 1996 Atlanta Games!",
    },
    {
      id: "gary",
      type: "image",
      category: "brand",
      src: "assets/gary-medals.png",
      label: "Gary",
      fact: "That's Gary! Easy to spot in his jester hat, he hands out the medals at the end of every U7, U9 and U12 race.",
    },
    {
      id: "adam",
      type: "image",
      category: "brand",
      src: "assets/adam-march.png",
      label: "Adam",
      fact: "That's Adam March — part of MTB East's comms team, keeping everyone in the loop before and during race day.",
    },
    {
      id: "motto",
      type: "image",
      category: "brand",
      src: "assets/motto-line.png",
      label: "Ride Develop Belong",
      fact: "Ride, Develop, Belong — MTB East's motto, right there on the kit.",
    },
    {
      id: "wordmark",
      type: "image",
      category: "brand",
      src: "assets/wordmark-white.png",
      label: "MTB East",
      fact: "MTB East has been racing in the east since 2014.",
    },
    {
      id: "since2014",
      type: "text",
      category: "brand",
      big: "2014",
      label: "Founded",
      fact: "MTB East has been racing in the east since 2014.",
    },
    {
      id: "lastrace",
      type: "text",
      category: "race",
      big: "162",
      label: "Last race",
      fact: "162 riders took part in the final round of the 2026 season.",
    },
    {
      id: "badge-league",
      type: "image",
      category: "brand",
      src: "assets/badge-league.png",
      label: "League",
      fact: "Seven rounds a season at Potash Woods and Gallows Green — cross-country racing for every age and ability.",
    },
    {
      id: "badge-festival",
      type: "image",
      category: "brand",
      src: "assets/badge-festival.png",
      label: "Festival",
      fact: "A mini-festival at Gallows Green with camping, kids' activities, a gravel race and entertainment.",
    },
    {
      id: "badge-sportive",
      type: "image",
      category: "brand",
      src: "assets/badge-sportive.png",
      label: "Sportive",
      fact: "A planned 50–100km sportive from Gallows Green, part charity fundraiser.",
    },
    {
      id: "badge-coaching",
      type: "image",
      category: "brand",
      src: "assets/badge-coaching.png",
      label: "Coaching",
      fact: "Coaching and the Women's Rookie Race Squad, led by MTB East's own instructors.",
    },
    {
      id: "badge-academy",
      type: "image",
      category: "brand",
      src: "assets/badge-academy.png",
      label: "Academy",
      fact: "Academy is MTB East's newest division.",
    },
    {
      id: "badge-volunteers",
      type: "image",
      category: "brand",
      src: "assets/badge-volunteers.png",
      label: "Volunteers",
      fact: "Marshals, timing, sign-on and race officials — even one session at one race is a huge help.",
    },
    {
      id: "badge-partners",
      type: "image",
      category: "brand",
      src: "assets/badge-partners.png",
      label: "Partners",
      fact: "Sponsors and partners back MTB East all season long.",
    },
  ];

  const CATEGORY_LABEL = { brand: "BRAND", race: "RACE", know: "KNOW-HOW" };

  // Each play draws a different handful of pairs from the whole pool, so there is always something new to find
  // (the pool is now bigger than any one round needs, so a random draw keeps every play fresh).
  const DIFFICULTY = {
    easy: { pairs: () => shuffle(PAIRS).slice(0, 6), mismatchDelay: 1000 },
    standard: { pairs: () => shuffle(PAIRS).slice(0, 8), mismatchDelay: 850 },
    hard: { pairs: () => shuffle(PAIRS).slice(0, 10), mismatchDelay: 550 },
  };
  let difficulty = "standard";
  let activePairs = PAIRS;

  const ICONS = {
    olympic: `<svg viewBox="0 0 64 64" width="58%" height="58%"><circle cx="32" cy="24" r="13" fill="none" stroke="#E8792B" stroke-width="4"/><polygon points="32,35 40,58 24,58" fill="#1B8A82"/></svg>`,
  };

  // ---- DOM ----
  const startScreen = document.getElementById("start-screen");
  const gameScreen = document.getElementById("game-screen");
  const endScreen = document.getElementById("end-screen");
  const btnStart = document.getElementById("btn-start");
  const btnAgain = document.getElementById("btn-again");
  const bestLine = document.getElementById("best-line");
  const diffPicker = document.getElementById("diff-picker");
  const firstHint = document.getElementById("first-hint");
  const gridEl = document.getElementById("grid");
  const hudFlips = document.getElementById("hud-flips");
  const hudFound = document.getElementById("hud-found");
  const factList = document.getElementById("fact-list");
  const endFactList = document.getElementById("end-fact-list");
  const endStats = document.getElementById("end-stats");
  const endBest = document.getElementById("end-best");

  // ---- Audio (synthesized, no asset files) ----
  let actx = null;
  function ensureAudio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    }
    if (actx && actx.state === "suspended") actx.resume();
  }
  function blip(freqStart, freqEnd, duration, type, gain) {
    if (!actx) return;
    const osc = actx.createOscillator();
    const g = actx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, actx.currentTime);
    osc.frequency.linearRampToValueAtTime(freqEnd, actx.currentTime + duration);
    g.gain.setValueAtTime(gain, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + duration);
    osc.connect(g).connect(actx.destination);
    osc.start();
    osc.stop(actx.currentTime + duration);
  }
  const sfxFlip = () => blip(500, 420, 0.08, "square", 0.04);
  const sfxMatch = () => blip(600, 1000, 0.18, "sine", 0.07);
  const sfxNoMatch = () => blip(260, 180, 0.16, "sine", 0.05);
  const sfxWin = () => {
    if (!actx) return;
    [660, 880, 1100].forEach((f, i) => {
      setTimeout(() => blip(f, f, 0.18, "sine", 0.06), i * 130);
    });
  };

  function getBest(diff) {
    const v = parseInt(localStorage.getItem(`${STORAGE_PREFIX}_${diff}`) || "0", 10);
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  function setBest(diff, v) {
    localStorage.setItem(`${STORAGE_PREFIX}_${diff}`, String(v));
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---- Game state ----
  let deck = [];
  let flips = 0;
  let matchedCount = 0;
  let openCards = [];
  let busy = false;

  function buildDeck() {
    const doubled = [];
    activePairs.forEach((p) => {
      doubled.push({ ...p, cardId: p.id + "-a" });
      doubled.push({ ...p, cardId: p.id + "-b" });
    });
    return shuffle(doubled);
  }

  function renderGrid() {
    gridEl.innerHTML = "";
    // 5 columns once there are more than 16 cards (hard mode's 10 pairs), so the extra row of cards eats
    // into height rather than width -- the grid has a fixed height budget (see .grid in the stylesheet),
    // so more rows would otherwise mean thinner cards for no reason.
    gridEl.classList.toggle("grid-wide", deck.length > 16);
    deck.forEach((card) => {
      const el = document.createElement("div");
      el.className = "card";
      el.dataset.cardId = card.cardId;
      el.dataset.pairId = card.id;

      const inner = document.createElement("div");
      inner.className = "card-inner";

      const back = document.createElement("div");
      back.className = "card-face card-back";

      const front = document.createElement("div");
      front.className = "card-face card-front";
      const tag = document.createElement("div");
      tag.className = `card-tag ${card.category}`;
      tag.textContent = CATEGORY_LABEL[card.category] || "";
      front.appendChild(tag);
      if (card.type === "image") {
        const img = document.createElement("img");
        img.src = card.src;
        img.alt = card.label;
        front.appendChild(img);
      } else if (card.type === "text") {
        const big = document.createElement("div");
        big.className = "text-big";
        big.textContent = card.big;
        front.appendChild(big);
      } else {
        const iconWrap = document.createElement("div");
        iconWrap.className = "icon-wrap";
        iconWrap.innerHTML = ICONS[card.icon] || "";
        front.appendChild(iconWrap);
      }
      const label = document.createElement("div");
      label.className = "card-label";
      label.textContent = card.label;
      front.appendChild(label);

      inner.appendChild(back);
      inner.appendChild(front);
      el.appendChild(inner);
      el.addEventListener("click", () => onCardClick(el, card));
      gridEl.appendChild(el);
    });
  }

  function updateHud() {
    hudFlips.textContent = `Flips: ${flips}`;
    hudFound.textContent = `Pairs found: ${matchedCount} / ${activePairs.length}`;
  }

  function addFact(text) {
    [factList, endFactList].forEach((list) => {
      const li = document.createElement("li");
      li.textContent = text;
      list.appendChild(li);
    });
  }

  function onCardClick(el, card) {
    if (busy) return;
    if (el.classList.contains("flipped") || el.classList.contains("matched")) return;
    if (openCards.some((o) => o.el === el)) return;

    ensureAudio();
    sfxFlip();
    el.classList.add("flipped");
    openCards.push({ el, card });
    dismissHint();

    if (openCards.length === 2) {
      flips += 1;
      updateHud();
      busy = true;
      const [a, b] = openCards;
      if (a.card.id === b.card.id) {
        setTimeout(() => {
          a.el.classList.add("matched");
          b.el.classList.add("matched");
          matchedCount += 1;
          sfxMatch();
          addFact(a.card.fact);
          updateHud();
          openCards = [];
          busy = false;
          if (matchedCount === activePairs.length) {
            setTimeout(finishGame, 500);
          }
        }, 400);
      } else {
        setTimeout(() => {
          sfxNoMatch();
          a.el.classList.remove("flipped");
          b.el.classList.remove("flipped");
          openCards = [];
          busy = false;
        }, DIFFICULTY[difficulty].mismatchDelay);
      }
    }
  }

  function dismissHint() {
    if (!firstHint.hidden) {
      firstHint.hidden = true;
      localStorage.setItem(HINT_SEEN_KEY, "1");
    }
  }

  function finishGame() {
    sfxWin();
    const best = getBest(difficulty);
    const isNewBest = best === null || flips < best;
    if (isNewBest) setBest(difficulty, flips);

    endStats.textContent = `${flips} flip${flips === 1 ? "" : "s"} to find all ${activePairs.length} pairs`;
    endBest.textContent = isNewBest
      ? "New best score! 🎉"
      : `Best so far: ${best} flip${best === 1 ? "" : "s"}`;

    gameScreen.hidden = true;
    endScreen.hidden = false;
  }

  function updateBestLine() {
    const best = getBest(difficulty);
    if (best !== null) {
      bestLine.hidden = false;
      bestLine.textContent = `Best on ${difficulty}: ${best} flip${best === 1 ? "" : "s"}`;
    } else {
      bestLine.hidden = true;
    }
  }

  diffPicker.addEventListener("click", (e) => {
    const btn = e.target.closest(".diff-btn");
    if (!btn) return;
    difficulty = btn.dataset.diff;
    diffPicker.querySelectorAll(".diff-btn").forEach((b) => b.classList.toggle("active", b === btn));
    updateBestLine();
  });

  function startGame() {
    ensureAudio();
    activePairs = DIFFICULTY[difficulty].pairs();
    flips = 0;
    matchedCount = 0;
    openCards = [];
    busy = false;
    factList.innerHTML = "";
    endFactList.innerHTML = "";
    deck = buildDeck();
    renderGrid();
    updateHud();

    firstHint.hidden = !!localStorage.getItem(HINT_SEEN_KEY);

    startScreen.hidden = true;
    endScreen.hidden = true;
    gameScreen.hidden = false;
  }

  btnStart.addEventListener("click", startGame);
  btnAgain.addEventListener("click", startGame);

  updateBestLine();
})();
