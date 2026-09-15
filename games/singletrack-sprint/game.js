(() => {
  "use strict";

  // ---- Brand palette (matches src/App.jsx) ----
  const COLORS = {
    ink: "#14171A",
    teal: "#1B8A82",
    tealDk: "#0F5F59",
    orange: "#E8792B",
    paper: "#F4F3EF",
    red: "#E24B4A",
    card: "#161616",
    border: "#2b2b2b",
    grey: "#B9BDB8",
    dim: "#868A85",
    black: "#000000",
  };

  const SKILL_BADGES = [
    "Bunny Hop", "Manual", "Cornering", "Braking", "Trail Reading",
    "Pumping", "Wheelie", "Balance", "Look Ahead", "Body Position",
  ];

  const TIPS = [
    "Look ahead down the trail, not at your front wheel — your bike goes where your eyes go.",
    "Two fingers on the brakes is plenty. Squeeze, don't grab.",
    "Stand up on bumpy sections and let your knees and elbows soak up the shock.",
    "A quick 'ABC' check before every ride: Air, Brakes, Chain.",
    "Say hello and give way to walkers — they've usually got less room to move than you.",
    "Keep pedals level through corners so the inside one doesn't clip the ground.",
    "Lower gears make climbs easier on your legs — shift down before the hill, not on it.",
  ];

  const STORAGE_KEY = "sts_singletrack_sprint_best_m";

  // ---- Canvas / DOM ----
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const GROUND_Y = 260;

  const hud = document.getElementById("hud");
  const hudDistance = document.getElementById("hud-distance");
  const hudBadges = document.getElementById("hud-badges");
  const toastEl = document.getElementById("toast");
  const startScreen = document.getElementById("start-screen");
  const endScreen = document.getElementById("end-screen");
  const btnStart = document.getElementById("btn-start");
  const btnAgain = document.getElementById("btn-again");
  const bestLine = document.getElementById("best-line");
  const endDistance = document.getElementById("end-distance");
  const endBadges = document.getElementById("end-badges");
  const endBest = document.getElementById("end-best");
  const endTip = document.getElementById("end-tip");

  const mascotImg = new Image();
  mascotImg.src = "assets/header-mark.png";

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
  const sfxJump = () => blip(320, 520, 0.12, "square", 0.06);
  const sfxBadge = () => blip(700, 1100, 0.15, "sine", 0.07);
  const sfxCrash = () => blip(160, 60, 0.25, "sawtooth", 0.08);

  // ---- Game state ----
  let state = "start"; // start | playing | over
  let speed = 5.5;
  const SPEED_MAX = 12;
  let distancePx = 0;
  let badgeCount = 0;
  let elapsed = 0;
  let spawnTimer = 0;
  let nextSpawnAt = 1400;
  let badgeTimer = 0;
  let nextBadgeAt = 1400;

  const player = {
    x: 90,
    y: GROUND_Y - 50,
    w: 46,
    h: 50,
    vy: 0,
    onGround: true,
    ducking: false,
  };
  const GRAVITY = 0.62;
  const JUMP_VY = -16;
  const DUCK_H = 28;
  const HIT_MARGIN_X = 7;
  const HIT_MARGIN_TOP = 6;

  let obstacles = [];
  let badges = [];
  let particles = [];

  let toastTimer = null;

  function reset() {
    speed = 5.5;
    distancePx = 0;
    badgeCount = 0;
    elapsed = 0;
    spawnTimer = 0;
    nextSpawnAt = 1400;
    badgeTimer = 0;
    nextBadgeAt = 1400;
    obstacles = [];
    badges = [];
    particles = [];
    player.y = GROUND_Y - player.h;
    player.h = 50;
    player.vy = 0;
    player.onGround = true;
    player.ducking = false;
  }

  function getBest() {
    const v = parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10);
    return Number.isFinite(v) ? v : 0;
  }
  function setBest(m) {
    localStorage.setItem(STORAGE_KEY, String(m));
  }

  function metersNow() {
    return Math.floor(distancePx / 12);
  }

  // ---- Input ----
  function tryJump() {
    if (state !== "playing") return;
    if (player.onGround && !player.ducking) {
      player.vy = JUMP_VY;
      player.onGround = false;
      sfxJump();
    }
  }
  function setDuck(on) {
    if (state !== "playing") return;
    if (!player.onGround) return; // no mid-air duck
    player.ducking = on;
    player.h = on ? DUCK_H : 50;
    player.y = GROUND_Y - player.h;
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "ArrowUp") {
      e.preventDefault();
      if (state === "start") startGame();
      else if (state === "over") startGame();
      else tryJump();
    } else if (e.code === "ArrowDown") {
      e.preventDefault();
      setDuck(true);
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowDown") setDuck(false);
  });

  function canvasPointToLogical(clientY) {
    const rect = canvas.getBoundingClientRect();
    const ratio = H / rect.height;
    return (clientY - rect.top) * ratio;
  }

  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    const y = canvasPointToLogical(t.clientY);
    if (y < H / 2) tryJump();
    else setDuck(true);
  }, { passive: false });
  canvas.addEventListener("touchend", (e) => {
    e.preventDefault();
    setDuck(false);
  }, { passive: false });

  canvas.addEventListener("mousedown", (e) => {
    const y = canvasPointToLogical(e.clientY);
    if (y < H / 2) tryJump();
    else setDuck(true);
  });
  canvas.addEventListener("mouseup", () => setDuck(false));

  btnStart.addEventListener("click", () => { ensureAudio(); startGame(); });
  btnAgain.addEventListener("click", () => { ensureAudio(); startGame(); });

  // ---- Spawning ----
  function spawnObstacle() {
    const roll = Math.random();
    let type;
    if (roll < 0.4) type = "root";
    else if (roll < 0.7) type = "puddle";
    else type = "branch";

    if (type === "root") {
      obstacles.push({ type, x: W + 20, w: 20, h: 34 });
    } else if (type === "puddle") {
      obstacles.push({ type, x: W + 20, w: 50, h: 14 });
    } else {
      // spans from above the visible frame down to head height — cannot be jumped, only ducked under
      obstacles.push({ type, x: W + 20, w: 26, h: 226, topY: 0 });
    }
  }

  function spawnBadge() {
    const nearObstacle = obstacles.some((o) => Math.abs(o.x - W) < 140);
    if (nearObstacle) { nextBadgeAt = badgeTimer + 250; return; }
    badges.push({ x: W + 20, y: 226, w: 18, h: 18, name: SKILL_BADGES[Math.floor(Math.random() * SKILL_BADGES.length)] });
  }

  // ---- Collision ----
  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // ---- Toast ----
  function showToast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    toastEl.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("show");
    }, 900);
  }

  // ---- Screens ----
  function startGame() {
    reset();
    state = "playing";
    startScreen.hidden = true;
    endScreen.hidden = true;
    hud.hidden = false;
    lastTime = performance.now();
    requestAnimationFrame(loop);
  }

  function endGame() {
    state = "over";
    sfxCrash();
    hud.hidden = true;
    const m = metersNow();
    const best = getBest();
    const newBest = m > best;
    if (newBest) setBest(m);

    endDistance.textContent = `${m} m`;
    endBadges.textContent = `${badgeCount} badge${badgeCount === 1 ? "" : "s"}`;
    endBest.textContent = newBest ? `New best distance! 🎉` : `Best distance: ${Math.max(m, best)} m`;
    endTip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    endScreen.hidden = false;
  }

  function showStartScreen() {
    const best = getBest();
    if (best > 0) {
      bestLine.hidden = false;
      bestLine.textContent = `Best distance: ${best} m`;
    }
  }

  // ---- Update / Draw ----
  let lastTime = 0;
  let groundScroll = 0;
  let treeScroll = 0;

  function update(dt) {
    elapsed += dt;
    speed = Math.min(SPEED_MAX, 5.5 + elapsed / 7000);

    const move = speed * (dt / 16.67);
    distancePx += move;
    groundScroll = (groundScroll + move) % 40;
    treeScroll = (treeScroll + move * 0.4) % 220;

    // physics
    if (!player.onGround) {
      player.vy += GRAVITY * (dt / 16.67);
      player.y += player.vy * (dt / 16.67);
      if (player.y >= GROUND_Y - player.h) {
        player.y = GROUND_Y - player.h;
        player.vy = 0;
        player.onGround = true;
      }
    }

    // spawn timers
    spawnTimer += dt;
    if (spawnTimer >= nextSpawnAt) {
      spawnTimer = 0;
      nextSpawnAt = Math.max(520, 1000 - elapsed / 90) + Math.random() * 400;
      spawnObstacle();
    }
    badgeTimer += dt;
    if (badgeTimer >= nextBadgeAt) {
      badgeTimer = 0;
      nextBadgeAt = 1300 + Math.random() * 900;
      spawnBadge();
    }

    // move + collide obstacles — hitbox is a little smaller than the sprite so
    // near-misses read as fair (forgiving on the sides and overhead, not underfoot)
    const playerRect = {
      x: player.x + HIT_MARGIN_X,
      y: player.y + HIT_MARGIN_TOP,
      w: player.w - HIT_MARGIN_X * 2,
      h: player.h - HIT_MARGIN_TOP,
    };
    for (const o of obstacles) {
      o.x -= move;
      const rect = o.type === "branch"
        ? { x: o.x, y: o.topY, w: o.w, h: o.h }
        : { x: o.x, y: GROUND_Y - o.h, w: o.w, h: o.h };
      if (rectsOverlap(playerRect, rect)) {
        endGame();
        return;
      }
    }
    obstacles = obstacles.filter((o) => o.x + o.w > -10);

    // move + collide badges
    for (const b of badges) {
      b.x -= move;
      if (!b.collected && rectsOverlap(playerRect, b)) {
        b.collected = true;
        badgeCount += 1;
        sfxBadge();
        showToast(`🏅 ${b.name}!`);
        particles.push({ x: b.x, y: b.y, life: 400, text: "+1" });
      }
    }
    badges = badges.filter((b) => !b.collected && b.x + b.w > -10);

    particles.forEach((p) => { p.y -= 0.5 * (dt / 16.67); p.life -= dt; });
    particles = particles.filter((p) => p.life > 0);

    hudDistance.textContent = `${metersNow()} m`;
    hudBadges.textContent = `🏅 ${badgeCount}`;
  }

  function drawBackground() {
    ctx.fillStyle = COLORS.black;
    ctx.fillRect(0, 0, W, H);

    // faint trees (parallax)
    ctx.fillStyle = "#123a36";
    for (let i = -1; i < 6; i++) {
      const x = i * 220 - treeScroll;
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y - 10);
      ctx.lineTo(x + 30, GROUND_Y - 90);
      ctx.lineTo(x + 60, GROUND_Y - 10);
      ctx.closePath();
      ctx.fill();
    }

    // ground strip
    ctx.fillStyle = COLORS.card;
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.strokeStyle = COLORS.border;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.lineTo(W, GROUND_Y);
    ctx.stroke();

    // dashed trail line
    ctx.strokeStyle = COLORS.teal;
    ctx.lineWidth = 3;
    ctx.setLineDash([18, 14]);
    ctx.lineDashOffset = -groundScroll;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 22);
    ctx.lineTo(W, GROUND_Y + 22);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawObstacles() {
    for (const o of obstacles) {
      if (o.type === "root") {
        ctx.fillStyle = "#6b4a2b";
        ctx.fillRect(o.x, GROUND_Y - o.h, o.w, o.h);
        ctx.fillStyle = COLORS.tealDk;
        ctx.fillRect(o.x, GROUND_Y - o.h, o.w, 4);
      } else if (o.type === "puddle") {
        ctx.fillStyle = "#1c5b8a";
        ctx.beginPath();
        ctx.ellipse(o.x + o.w / 2, GROUND_Y - o.h / 2, o.w / 2, o.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // collision box spans the full height (unjumpable); only draw the lower
        // stretch so it reads as a branch hanging down from off-screen, not a wall
        const bottom = o.topY + o.h;
        ctx.strokeStyle = "#6b4a2b";
        ctx.lineWidth = 8;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(o.x - 6, bottom - 95);
        ctx.lineTo(o.x + o.w - 4, bottom);
        ctx.stroke();
        ctx.fillStyle = "#1e4a3f";
        ctx.beginPath();
        ctx.arc(o.x + o.w - 6, bottom - 6, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = COLORS.orange;
        ctx.fillRect(o.x, bottom - 5, o.w, 5);
      }
    }
  }

  function drawBadges() {
    for (const b of badges) {
      ctx.fillStyle = COLORS.orange;
      ctx.beginPath();
      ctx.arc(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLORS.paper;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / 400);
      ctx.fillStyle = COLORS.paper;
      ctx.font = "600 13px 'Oswald', sans-serif";
      ctx.fillText(p.text, p.x, p.y);
      ctx.globalAlpha = 1;
    }
  }

  function drawPlayer() {
    const cx = player.x + player.w / 2;
    const cy = player.y + player.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    if (!player.onGround) {
      const tilt = Math.max(-0.12, Math.min(0.12, player.vy / 100));
      ctx.rotate(tilt);
    }
    const size = player.ducking ? player.h * 1.5 : player.h;
    if (mascotImg.complete && mascotImg.naturalWidth) {
      ctx.drawImage(mascotImg, -size / 2, -size / 2, size, size);
    } else {
      ctx.fillStyle = COLORS.teal;
      ctx.fillRect(-player.w / 2, -player.h / 2, player.w, player.h);
    }
    ctx.restore();
  }

  function draw() {
    drawBackground();
    drawObstacles();
    drawBadges();
    drawPlayer();
  }

  function loop(now) {
    if (state !== "playing") return;
    const dt = Math.min(48, now - lastTime);
    lastTime = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // ---- Boot ----
  showStartScreen();
  drawBackground();
})();
