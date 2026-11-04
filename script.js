/* =====================================================================
   NEBULA DEFENDER — script.js
   Jogo completo em JavaScript puro (Canvas 2D + Web Audio).
   Único arquivo de lógica: física, ondas, inimigos, chefes, partículas,
   som, HUD e integração com o HTML (pontuação, botões, status).
   ===================================================================== */
(() => {
  "use strict";
  const W = 480;
  const H = 720;
  const STORAGE_KEY = "nebula-defender-highscore";
  // ---------------------------------------------------------------- DOM
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const $ = (id) => document.getElementById(id);
  const ui = {
    score: $("score"),
    highscore: $("highscore"),
    wave: $("wave"),
    lives: $("lives"),
    status: $("status"),
    btnPrimary: $("btn-primary"),
    btnPause: $("btn-pause"),
    btnMute: $("btn-mute"),
  };
  // ---------------------------------------------------------------- utils
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const fmt = (n) => n.toLocaleString("pt-BR");
  // ---------------------------------------------------------------- áudio
  class Sfx {
    constructor() {
      this.ctx = null;
      this.muted = false;
    }
    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    }
    tone({ freq = 440, end = freq, type = "square", dur = 0.1, vol = 0.08, delay = 0 }) {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime + delay;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, end), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
    shoot() { this.tone({ freq: 880, end: 220, dur: 0.08, vol: 0.04 }); }
    enemyShoot() { this.tone({ freq: 300, end: 120, type: "sawtooth", dur: 0.12, vol: 0.03 }); }
    hit() { this.tone({ freq: 200, end: 60, type: "triangle", dur: 0.08, vol: 0.05 }); }
    explode(big = false) {
      this.tone({ freq: big ? 120 : 180, end: 30, type: "sawtooth", dur: big ? 0.5 : 0.25, vol: big ? 0.12 : 0.07 });
      this.tone({ freq: 900, end: 100, type: "square", dur: 0.15, vol: 0.03 });
    }
    power() {
      [523, 659, 784, 1046].forEach((f, i) =>
        this.tone({ freq: f, end: f, type: "triangle", dur: 0.12, vol: 0.06, delay: i * 0.07 }),
      );
    }
    hurt() { this.tone({ freq: 150, end: 40, type: "sawtooth", dur: 0.35, vol: 0.12 }); }
    wave() {
      [392, 523, 659].forEach((f, i) => this.tone({ freq: f, end: f, type: "square", dur: 0.15, vol: 0.05, delay: i * 0.1 }));
    }
    gameover() {
      [440, 370, 311, 220].forEach((f, i) =>
        this.tone({ freq: f, end: f * 0.8, type: "triangle", dur: 0.35, vol: 0.08, delay: i * 0.25 }),
      );
    }
  }
  const sfx = new Sfx();
  // ---------------------------------------------------------------- dados
  const ENEMY_TYPES = {
    drone: { hp: 1, r: 14, speed: 90, score: 100, color: "#f97316" },
    zigzag: { hp: 2, r: 15, speed: 110, score: 150, color: "#a855f7" },
    tank: { hp: 6, r: 22, speed: 45, score: 300, color: "#22c55e" },
    shooter: { hp: 3, r: 16, speed: 60, score: 250, color: "#ef4444" },
    kamikaze: { hp: 1, r: 12, speed: 180, score: 200, color: "#facc15" },
  };
  const POWER_TYPES = ["triple", "rapid", "shield", "heal", "bomb"];
  const POWER_COLORS = { triple: "#38bdf8", rapid: "#f472b6", shield: "#34d399", heal: "#f87171", bomb: "#fbbf24" };
  const POWER_LABELS = { triple: "TIRO TRIPLO", rapid: "TIRO RÁPIDO", shield: "ESCUDO", heal: "+1 VIDA", bomb: "BOMBA" };
  const STATUS_LABEL = { menu: "No menu", playing: "Jogando", paused: "Pausado", gameover: "Fim de jogo" };
  // ---------------------------------------------------------------- estado
  let state = "menu"; // menu | playing | paused | gameover
  let last = 0;
  let time = 0;
  let shake = 0;
  let flash = 0;
  let highScore = Number(localStorage.getItem(STORAGE_KEY) || 0);
  const keys = new Set();
  const touch = { active: false, x: 0, y: 0 };
  let player, bullets, enemyBullets, enemies, particles, powerups, stars, texts;
  let score, wave, combo, comboTimer, waveTimer, spawnQueue, spawnTimer, waveBanner;
  // ---------------------------------------------------------------- UI (HTML)
  function updateUI() {
    ui.score.textContent = fmt(score);
    ui.highscore.textContent = fmt(highScore);
    ui.wave.textContent = wave ? String(wave) : "—";
    ui.lives.textContent = player && player.lives > 0 ? "♥".repeat(player.lives) : "—";
    ui.status.textContent = STATUS_LABEL[state];
    ui.status.dataset.state = state;
    ui.btnPause.disabled = state === "menu" || state === "gameover";
    ui.btnPause.textContent = state === "paused" ? "▶ Continuar" : "⏸ Pausar";
    ui.btnMute.textContent = sfx.muted ? "🔇 Som off" : "🔊 Som on";
    ui.btnPrimary.classList.toggle("hidden", state === "playing");
    ui.btnPrimary.textContent =
      state === "paused" ? "Continuar" : state === "gameover" ? "Jogar de novo" : "Começar";
  }
  // ---------------------------------------------------------------- setup
  function makeStars() {
    stars = [];
    for (let i = 0; i < 120; i++) stars.push({ x: rand(0, W), y: rand(0, H), z: rand(0.2, 1), s: rand(0.5, 2) });
  }
  function reset() {
    player = { x: W / 2, y: H - 90, r: 14, speed: 320, lives: 3, fireCd: 0, inv: 0, triple: 0, rapid: 0, shield: 0 };
    bullets = [];
    enemyBullets = [];
    enemies = [];
    particles = [];
    powerups = [];
    texts = [];
    score = 0;
    wave = 0;
    combo = 1;
    comboTimer = 0;
    waveTimer = 0;
    spawnQueue = [];
    spawnTimer = 0;
    waveBanner = 0;
    shake = 0;
    flash = 0;
    nextWave();
  }
  // ---------------------------------------------------------------- ondas
  function nextWave() {
    wave++;
    waveBanner = 2.2;
    spawnQueue = [];
    if (wave % 5 === 0) {
      spawnQueue.push({ type: "boss", delay: 1.5 });
      for (let i = 0; i < Math.floor(wave / 2); i++) spawnQueue.push({ type: "drone", delay: 2.5 + i * 1.2 });
    } else {
      const pool = ["drone"];
      if (wave >= 2) pool.push("zigzag");
      if (wave >= 3) pool.push("shooter");
      if (wave >= 4) pool.push("tank");
      if (wave >= 6) pool.push("kamikaze");
      const n = 6 + wave * 2;
      let t = 1.2;
      for (let i = 0; i < n; i++) {
        spawnQueue.push({ type: pick(pool), delay: t });
        t += Math.max(0.25, 0.9 - wave * 0.05);
      }
    }
    spawnTimer = 0;
    if (wave > 1) sfx.wave();
    updateUI();
  }
  function spawnEnemy(type) {
    if (type === "boss") {
      const hp = 60 + wave * 12;
      enemies.push({
        type: "boss", x: W / 2, y: -60, r: 46, hp, maxHp: hp, speed: 40,
        score: 3000 + wave * 200, color: "#e11d48", t: 0, fireCd: 1.5, phase: 0,
      });
      return;
    }
    const base = ENEMY_TYPES[type];
    const scale = 1 + (wave - 1) * 0.08;
    const hp = Math.ceil(base.hp * (1 + (wave - 1) * 0.15));
    enemies.push({
      type, x: rand(30, W - 30), y: -30, r: base.r, hp, maxHp: hp,
      speed: base.speed * scale, score: base.score, color: base.color, t: rand(0, 6.28), fireCd: rand(1, 2.5),
    });
  }
  // ---------------------------------------------------------------- efeitos
  function burst(x, y, color, n = 14, speed = 220, life = 0.6) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const v = rand(speed * 0.3, speed);
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color, r: rand(1.5, 4) });
    }
  }
  function floatText(x, y, str, color = "#fff", size = 14) {
    texts.push({ x, y, str, color, size, life: 1 });
  }
  function addScore(v, x, y) {
    const gained = Math.round(v * combo);
    score += gained;
    comboTimer = 2.5;
    if (combo < 8) combo = Math.min(8, +(combo + 0.5).toFixed(1));
    floatText(x, y, `+${gained}`, combo > 1 ? "#fde047" : "#fff", combo > 3 ? 18 : 14);
    if (score > highScore) {
      highScore = score;
      localStorage.setItem(STORAGE_KEY, String(highScore));
    }
    updateUI();
  }
  function dropPower(x, y) {
    if (Math.random() < 0.14) powerups.push({ x, y, type: pick(POWER_TYPES), vy: 70, t: 0 });
  }
  function damagePlayer() {
    if (player.inv > 0) return;
    if (player.shield > 0) {
      player.shield = 0;
      burst(player.x, player.y, "#34d399", 20, 200);
      floatText(player.x, player.y - 30, "ESCUDO QUEBROU", "#34d399");
      player.inv = 1;
      sfx.hit();
      return;
    }
    player.lives--;
    player.inv = 2;
    combo = 1;
    shake = 14;
    flash = 0.35;
    burst(player.x, player.y, "#38bdf8", 30, 260, 0.9);
    sfx.hurt();
    if (player.lives <= 0) {
      player.lives = 0;
      gameOver();
    }
    updateUI();
  }
  function killEnemy(e) {
    const boss = e.type === "boss";
    burst(e.x, e.y, e.color, boss ? 70 : 16, boss ? 380 : 220, boss ? 1.3 : 0.6);
    addScore(e.score, e.x, e.y);
    sfx.explode(boss || e.type === "tank");
    if (boss) {
      shake = 24;
      flash = 0.4;
      for (let i = 0; i < 3; i++) powerups.push({ x: e.x + rand(-40, 40), y: e.y, type: pick(POWER_TYPES), vy: 70, t: 0 });
    } else {
      dropPower(e.x, e.y);
    }
  }
  function applyPower(p) {
    sfx.power();
    floatText(player.x, player.y - 36, POWER_LABELS[p.type], POWER_COLORS[p.type], 16);
    burst(p.x, p.y, POWER_COLORS[p.type], 12, 150, 0.5);
    switch (p.type) {
      case "triple": player.triple = 10; break;
      case "rapid": player.rapid = 10; break;
      case "shield": player.shield = 1; break;
      case "heal": player.lives = Math.min(5, player.lives + 1); updateUI(); break;
      case "bomb":
        shake = 18;
        flash = 0.5;
        enemyBullets = [];
        enemies.forEach((e) => {
          if (e.type === "boss") { e.hp -= 15; burst(e.x, e.y, e.color, 10); }
          else e.hp = 0;
        });
        break;
    }
  }
  function gameOver() {
    state = "gameover";
    sfx.gameover();
    updateUI();
  }
  // ---------------------------------------------------------------- update
  function update(dt) {
    time += dt;
    for (const s of stars) {
      s.y += (40 + 120 * s.z) * dt * (state === "playing" ? 1 : 0.4);
      if (s.y > H) { s.y = -2; s.x = rand(0, W); }
    }
    if (state !== "playing") return;
    // jogador: movimento
    let dx = 0, dy = 0;
    if (keys.has("ArrowLeft") || keys.has("KeyA")) dx -= 1;
    if (keys.has("ArrowRight") || keys.has("KeyD")) dx += 1;
    if (keys.has("ArrowUp") || keys.has("KeyW")) dy -= 1;
    if (keys.has("ArrowDown") || keys.has("KeyS")) dy += 1;
    if (touch.active) {
      const tx = touch.x - player.x;
      const ty = touch.y - 60 - player.y;
      const d = Math.hypot(tx, ty);
      if (d > 4) { dx = tx / d; dy = ty / d; }
    }
    const len = Math.hypot(dx, dy) || 1;
    player.x = clamp(player.x + (dx / len) * player.speed * dt, player.r, W - player.r);
    player.y = clamp(player.y + (dy / len) * player.speed * dt, H * 0.35, H - player.r - 10);
    // jogador: tiro
    player.fireCd -= dt;
    const firing = keys.has("Space") || keys.has("KeyJ") || touch.active;
    if (firing && player.fireCd <= 0) {
      player.fireCd = player.rapid > 0 ? 0.09 : 0.18;
      const spd = 620;
      if (player.triple > 0) {
        bullets.push({ x: player.x, y: player.y - 14, vx: 0, vy: -spd });
        bullets.push({ x: player.x - 8, y: player.y - 8, vx: -140, vy: -spd });
        bullets.push({ x: player.x + 8, y: player.y - 8, vx: 140, vy: -spd });
      } else {
        bullets.push({ x: player.x - 6, y: player.y - 10, vx: 0, vy: -spd });
        bullets.push({ x: player.x + 6, y: player.y - 10, vx: 0, vy: -spd });
      }
      sfx.shoot();
    }
    player.inv = Math.max(0, player.inv - dt);
    player.triple = Math.max(0, player.triple - dt);
    player.rapid = Math.max(0, player.rapid - dt);
    // combo
    if (comboTimer > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) combo = 1;
    }
    // spawn
    spawnTimer += dt;
    while (spawnQueue.length && spawnQueue[0].delay <= spawnTimer) spawnEnemy(spawnQueue.shift().type);
    if (!spawnQueue.length && enemies.length === 0) {
      waveTimer += dt;
      if (waveTimer > 1.5) { waveTimer = 0; nextWave(); }
    }
    waveBanner = Math.max(0, waveBanner - dt);
    // projéteis
    for (const b of bullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
    bullets = bullets.filter((b) => b.y > -20 && b.x > -20 && b.x < W + 20);
    for (const b of enemyBullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
    enemyBullets = enemyBullets.filter((b) => b.y < H + 20 && b.y > -20 && b.x > -20 && b.x < W + 20);
    // inimigos
    for (const e of enemies) {
      e.t += dt;
      switch (e.type) {
        case "drone":
        case "tank":
          e.y += e.speed * dt;
          break;
        case "zigzag":
          e.y += e.speed * dt;
          e.x += Math.sin(e.t * 4) * 160 * dt;
          break;
        case "shooter":
          e.y += (e.y < 160 ? e.speed : e.speed * 0.25) * dt;
          e.x += Math.sin(e.t * 1.5) * 60 * dt;
          e.fireCd -= dt;
          if (e.fireCd <= 0 && e.y > 0) {
            e.fireCd = rand(1.4, 2.4) / (1 + wave * 0.05);
            const a = Math.atan2(player.y - e.y, player.x - e.x);
            const s = 220 + wave * 8;
            enemyBullets.push({ x: e.x, y: e.y + 10, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: 5 });
            sfx.enemyShoot();
          }
          break;
        case "kamikaze": {
          const a = Math.atan2(player.y - e.y, player.x - e.x);
          e.x += Math.cos(a) * e.speed * dt;
          e.y += Math.sin(a) * e.speed * dt;
          break;
        }
        case "boss": {
          if (e.y < 110) e.y += e.speed * dt;
          else e.x = W / 2 + Math.sin(e.t * 0.8) * (W / 2 - 70);
          e.fireCd -= dt;
          if (e.fireCd <= 0 && e.y > 60) {
            e.phase = (e.phase + 1) % 3;
            e.fireCd = Math.max(0.6, 1.6 - wave * 0.05);
            sfx.enemyShoot();
            if (e.phase === 0) {
              for (let i = -3; i <= 3; i++) {
                const a = Math.PI / 2 + i * 0.22;
                enemyBullets.push({ x: e.x, y: e.y + 30, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200, r: 6 });
              }
            } else if (e.phase === 1) {
              const a = Math.atan2(player.y - e.y, player.x - e.x);
              for (let i = 0; i < 3; i++) {
                const s = 260 + i * 60;
                enemyBullets.push({ x: e.x, y: e.y + 30, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: 5 });
              }
            } else {
              for (let i = 0; i < 12; i++) {
                const a = (i / 12) * Math.PI * 2 + e.t;
                enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150, r: 5 });
              }
            }
          }
          break;
        }
      }
      e.x = clamp(e.x, e.r, W - e.r);
    }
    // colisões: tiros x inimigos
    for (const b of bullets) {
      for (const e of enemies) {
        if (e.hp <= 0) continue;
        if (dist2(b.x, b.y, e.x, e.y) < (e.r + 3) ** 2) {
          e.hp -= 1;
          b.dead = true;
          particles.push({ x: b.x, y: b.y, vx: rand(-60, 60), vy: rand(-80, 20), life: 0.25, max: 0.25, color: "#fff", r: 2 });
          if (e.hp <= 0) killEnemy(e);
          else sfx.hit();
          break;
        }
      }
    }
    bullets = bullets.filter((b) => !b.dead);
    // inimigos x jogador / saída da tela
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      if (e.y > H + 40) { e.hp = 0; continue; }
      if (dist2(e.x, e.y, player.x, player.y) < (e.r + player.r - 4) ** 2) {
        damagePlayer();
        if (e.type !== "boss") { e.hp = 0; burst(e.x, e.y, e.color, 10); }
      }
    }
    enemies = enemies.filter((e) => e.hp > 0);
    // tiros inimigos x jogador
    for (const b of enemyBullets) {
      if (dist2(b.x, b.y, player.x, player.y) < (b.r + player.r - 5) ** 2) {
        b.dead = true;
        damagePlayer();
      }
    }
    enemyBullets = enemyBullets.filter((b) => !b.dead);
    // power-ups
    for (const p of powerups) {
      p.y += p.vy * dt;
      p.t += dt;
      if (dist2(p.x, p.y, player.x, player.y) < (16 + player.r) ** 2) { p.dead = true; applyPower(p); }
    }
    powerups = powerups.filter((p) => !p.dead && p.y < H + 20);
    // partículas e textos
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; p.life -= dt; }
    particles = particles.filter((p) => p.life > 0);
    for (const t of texts) { t.y -= 40 * dt; t.life -= dt * 0.9; }
    texts = texts.filter((t) => t.life > 0);
    // propulsor
    if (Math.random() < 0.7) {
      particles.push({
        x: player.x + rand(-4, 4), y: player.y + 14, vx: rand(-20, 20), vy: rand(120, 220),
        life: 0.3, max: 0.3, color: Math.random() < 0.5 ? "#38bdf8" : "#f8fafc", r: rand(1.5, 3),
      });
    }
    shake = Math.max(0, shake - dt * 40);
    flash = Math.max(0, flash - dt);
  }
  // ---------------------------------------------------------------- desenho
  function drawShip(x, y, r, color, inv) {
    ctx.save();
    ctx.translate(x, y);
    if (inv > 0 && Math.floor(time * 12) % 2 === 0) ctx.globalAlpha = 0.35;
    ctx.shadowBlur = 16;
    ctx.shadowColor = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -r - 6);
    ctx.lineTo(r * 0.85, r);
    ctx.lineTo(0, r * 0.5);
    ctx.lineTo(-r * 0.85, r);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#e0f2fe";
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(4, 2);
    ctx.lineTo(-4, 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  function drawEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.shadowBlur = 14;
    ctx.shadowColor = e.color;
    ctx.fillStyle = e.color;
    ctx.beginPath();
    if (e.type === "boss") {
      ctx.rotate(Math.sin(e.t) * 0.1);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const rr = i % 2 === 0 ? e.r : e.r * 0.65;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fecdd3";
      ctx.beginPath();
      ctx.arc(0, 0, e.r * 0.3 + Math.sin(e.t * 6) * 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.type === "tank") {
      ctx.rect(-e.r, -e.r * 0.7, e.r * 2, e.r * 1.4);
      ctx.fill();
      ctx.fillStyle = "#bbf7d0";
      ctx.fillRect(-e.r * 0.4, -e.r * 0.3, e.r * 0.8, e.r * 0.6);
    } else if (e.type === "zigzag") {
      ctx.moveTo(0, -e.r); ctx.lineTo(e.r, 0); ctx.lineTo(0, e.r); ctx.lineTo(-e.r, 0);
      ctx.closePath();
      ctx.fill();
    } else if (e.type === "shooter") {
      ctx.moveTo(0, e.r); ctx.lineTo(e.r, -e.r * 0.6); ctx.lineTo(-e.r, -e.r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fee2e2";
      ctx.beginPath();
      ctx.arc(0, -2, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.type === "kamikaze") {
      ctx.rotate(e.t * 8);
      ctx.moveTo(0, -e.r); ctx.lineTo(e.r * 0.6, e.r); ctx.lineTo(-e.r * 0.6, e.r);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.arc(0, 0, e.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffedd5";
      ctx.beginPath();
      ctx.arc(0, 0, e.r * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    if (e.maxHp > 1 && e.type !== "boss") {
      const w = e.r * 2;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(e.x - w / 2, e.y - e.r - 10, w, 4);
      ctx.fillStyle = e.color;
      ctx.fillRect(e.x - w / 2, e.y - e.r - 10, (w * e.hp) / e.maxHp, 4);
    }
  }
  function drawHud() {
    ctx.save();
    ctx.font = "bold 20px ui-monospace, monospace";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#fff";
    ctx.shadowBlur = 8;
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.textAlign = "left";
    ctx.fillText(String(score).padStart(7, "0"), 14, 12);
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(`RECORDE ${highScore}`, 14, 36);
    ctx.textAlign = "right";
    ctx.font = "bold 16px ui-monospace, monospace";
    ctx.fillStyle = "#c4b5fd";
    ctx.fillText(`ONDA ${wave}`, W - 14, 12);
    for (let i = 0; i < player.lives; i++) drawShip(W - 24 - i * 22, 46, 7, "#38bdf8", 0);
    if (combo > 1) {
      ctx.textAlign = "center";
      ctx.font = "bold 18px ui-monospace, monospace";
      ctx.fillStyle = "#fde047";
      ctx.fillText(`x${combo} COMBO`, W / 2, 12);
      ctx.fillStyle = "rgba(253,224,71,0.3)";
      ctx.fillRect(W / 2 - 50, 34, 100, 3);
      ctx.fillStyle = "#fde047";
      ctx.fillRect(W / 2 - 50, 34, (100 * comboTimer) / 2.5, 3);
    }
    let py = H - 24;
    const bar = (label, val, max, color) => {
      ctx.textAlign = "left";
      ctx.font = "bold 11px ui-monospace, monospace";
      ctx.fillStyle = color;
      ctx.fillText(label, 14, py - 1);
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(110, py + 2, 100, 6);
      ctx.fillStyle = color;
      ctx.fillRect(110, py + 2, (100 * val) / max, 6);
      py -= 16;
    };
    if (player.rapid > 0) bar("TIRO RÁPIDO", player.rapid, 10, POWER_COLORS.rapid);
    if (player.triple > 0) bar("TIRO TRIPLO", player.triple, 10, POWER_COLORS.triple);
    if (player.shield > 0) bar("ESCUDO", 1, 1, POWER_COLORS.shield);
    const boss = enemies.find((e) => e.type === "boss");
    if (boss) {
      ctx.textAlign = "center";
      ctx.font = "bold 12px ui-monospace, monospace";
      ctx.fillStyle = "#fb7185";
      ctx.fillText("CHEFE", W / 2, 58);
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(60, 74, W - 120, 8);
      ctx.fillStyle = "#e11d48";
      ctx.fillRect(60, 74, ((W - 120) * Math.max(0, boss.hp)) / boss.maxHp, 8);
    }
    if (waveBanner > 0) {
      ctx.textAlign = "center";
      ctx.globalAlpha = Math.min(1, waveBanner);
      ctx.font = "bold 36px ui-monospace, monospace";
      ctx.fillStyle = wave % 5 === 0 ? "#fb7185" : "#fff";
      ctx.shadowBlur = 20;
      ctx.shadowColor = wave % 5 === 0 ? "#e11d48" : "#6366f1";
      ctx.fillText(wave % 5 === 0 ? "⚠ CHEFE ⚠" : `ONDA ${wave}`, W / 2, H / 2 - 40);
    }
    ctx.restore();
  }
  function drawOverlay(title, lines, accent) {
    ctx.save();
    ctx.fillStyle = "rgba(2,6,23,0.72)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowBlur = 30;
    ctx.shadowColor = accent;
    ctx.fillStyle = accent;
    ctx.font = "bold 44px ui-monospace, monospace";
    ctx.fillText(title, W / 2, H / 2 - 120);
    ctx.shadowBlur = 0;
    ctx.font = "15px ui-monospace, monospace";
    lines.forEach((l, i) => {
      ctx.fillStyle = l.startsWith("!") ? "#fde047" : "#cbd5e1";
      ctx.fillText(l.replace(/^!/, ""), W / 2, H / 2 - 50 + i * 26);
    });
    if (Math.floor(time * 2) % 2 === 0) {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 16px ui-monospace, monospace";
      ctx.fillText("PRESSIONE ENTER OU TOQUE", W / 2, H / 2 + 150);
    }
    ctx.restore();
  }
  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate(rand(-shake, shake) * 0.5, rand(-shake, shake) * 0.5);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0b1026");
    g.addColorStop(1, "#020617");
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.globalAlpha = 0.12;
    const nb = ctx.createRadialGradient(W * 0.3, H * 0.3 + Math.sin(time * 0.2) * 30, 10, W * 0.3, H * 0.3, 260);
    nb.addColorStop(0, "#6366f1");
    nb.addColorStop(1, "transparent");
    ctx.fillStyle = nb;
    ctx.fillRect(0, 0, W, H);
    const nb2 = ctx.createRadialGradient(W * 0.75, H * 0.7, 10, W * 0.75, H * 0.7, 240);
    nb2.addColorStop(0, "#db2777");
    nb2.addColorStop(1, "transparent");
    ctx.fillStyle = nb2;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    for (const s of stars) {
      ctx.globalAlpha = 0.3 + s.z * 0.7;
      ctx.fillStyle = "#fff";
      ctx.fillRect(s.x, s.y, s.s, s.s * (1 + s.z * 2));
    }
    ctx.globalAlpha = 1;
    for (const p of powerups) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.t * 2);
      ctx.shadowBlur = 16;
      ctx.shadowColor = POWER_COLORS[p.type];
      ctx.fillStyle = POWER_COLORS[p.type];
      ctx.fillRect(-11, -11, 22, 22);
      ctx.restore();
      ctx.save();
      ctx.fillStyle = "#020617";
      ctx.font = "bold 12px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.type[0].toUpperCase(), p.x, p.y + 1);
      ctx.restore();
    }
    ctx.save();
    ctx.shadowBlur = 10;
    ctx.shadowColor = "#38bdf8";
    ctx.fillStyle = "#e0f2fe";
    for (const b of bullets) ctx.fillRect(b.x - 2, b.y - 8, 4, 14);
    ctx.restore();
    ctx.save();
    ctx.shadowBlur = 12;
    ctx.shadowColor = "#f43f5e";
    ctx.fillStyle = "#fecdd3";
    for (const b of enemyBullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    for (const e of enemies) drawEnemy(e);
    if (state !== "gameover") {
      drawShip(player.x, player.y, player.r, "#38bdf8", player.inv);
      if (player.shield > 0) {
        ctx.save();
        ctx.strokeStyle = "rgba(52,211,153,0.9)";
        ctx.lineWidth = 2;
        ctx.shadowBlur = 14;
        ctx.shadowColor = "#34d399";
        ctx.beginPath();
        ctx.arc(player.x, player.y, player.r + 10 + Math.sin(time * 6) * 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const t of texts) {
      ctx.globalAlpha = Math.max(0, t.life);
      ctx.font = `bold ${t.size}px ui-monospace, monospace`;
      ctx.fillStyle = t.color;
      ctx.shadowBlur = 6;
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.restore();
    if (state !== "menu") drawHud();
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash * 0.5})`;
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
    ctx.restore();
    if (state === "menu") {
      drawOverlay("NEBULA", [], "#38bdf8");
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowBlur = 30;
      ctx.shadowColor = "#a855f7";
      ctx.fillStyle = "#c4b5fd";
      ctx.font = "bold 44px ui-monospace, monospace";
      ctx.fillText("DEFENDER", W / 2, H / 2 - 72);
      ctx.shadowBlur = 0;
      ctx.font = "14px ui-monospace, monospace";
      const lines = [
        "WASD / SETAS  →  mover",
        "ESPAÇO  →  atirar",
        "P / ESC  →  pausar      M  →  som",
        "",
        "Toque e arraste no celular",
        "",
        `RECORDE: ${highScore}`,
      ];
      lines.forEach((l, i) => {
        ctx.fillStyle = i === lines.length - 1 ? "#fde047" : "#cbd5e1";
        ctx.fillText(l, W / 2, H / 2 - 10 + i * 24);
      });
      ctx.restore();
    } else if (state === "paused") {
      drawOverlay("PAUSADO", ["Pressione P ou ESC para continuar", "", `Pontuação: ${score}`, `Onda: ${wave}`], "#fde047");
    } else if (state === "gameover") {
      const isRecord = score >= highScore && score > 0;
      drawOverlay(
        "FIM DE JOGO",
        [`Pontuação: ${score}`, `Onda alcançada: ${wave}`, "", isRecord ? "!★ NOVO RECORDE! ★" : `Recorde: ${highScore}`],
        "#fb7185",
      );
    }
  }
  // ---------------------------------------------------------------- loop
  function frame(ts) {
    if (!last) last = ts;
    const dt = Math.min(0.033, (ts - last) / 1000);
    last = ts;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  // ---------------------------------------------------------------- controles
  function start() {
    sfx.ensure();
    reset();
    state = "playing";
    updateUI();
  }
  function togglePause() {
    if (state === "playing") state = "paused";
    else if (state === "paused") state = "playing";
    updateUI();
  }
  function primaryAction() {
    sfx.ensure();
    canvas.focus({ preventScroll: true });
    if (state === "menu" || state === "gameover") start();
    else if (state === "paused") togglePause();
  }
  function toggleMute() {
    sfx.ensure();
    sfx.muted = !sfx.muted;
    updateUI();
  }
  window.addEventListener("keydown", (e) => {
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === "Enter") primaryAction();
    if (e.code === "Space" && state !== "playing") primaryAction();
    if (e.code === "KeyP" || e.code === "Escape") togglePause();
    if (e.code === "KeyM") toggleMute();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => {
    if (state === "playing") { state = "paused"; updateUI(); }
    keys.clear();
    touch.active = false;
  });
  const toCanvas = (clientX, clientY) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * W, y: ((clientY - r.top) / r.height) * H };
  };
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    canvas.focus({ preventScroll: true });
    if (state !== "playing") { primaryAction(); return; }
    const p = toCanvas(e.clientX, e.clientY);
    touch.active = true;
    touch.x = p.x;
    touch.y = p.y;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!touch.active) return;
    const p = toCanvas(e.clientX, e.clientY);
    touch.x = p.x;
    touch.y = p.y;
  });
  const stopTouch = () => { touch.active = false; };
  canvas.addEventListener("pointerup", stopTouch);
  canvas.addEventListener("pointercancel", stopTouch);
  ui.btnPrimary.addEventListener("click", primaryAction);
  ui.btnPause.addEventListener("click", () => { togglePause(); canvas.focus({ preventScroll: true }); });
  ui.btnMute.addEventListener("click", toggleMute);
  // ---------------------------------------------------------------- início
  makeStars();
  reset();
  state = "menu";
  updateUI();
  requestAnimationFrame(frame);
})();
