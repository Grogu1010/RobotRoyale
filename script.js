const LANES = 5;
const COLS = 16;
const HALF = 8;
const PLAYER_WALL_COL = 0;
const AI_WALL_COL = COLS - 1;
const MAX_WALL_HP = 2500;
const BOLT_CAP = 600;
const ECON_TICK = 4;
const ECON_GAIN = 50;

const UNIT_DEFS = {
  walker: {
    cost: 100,
    hp: 750,
    speed: 0.5,
    damage: 150,
    attackRate: 1,
    moving: true,
    letter: "W",
    color: "#67d17a",
    role: "Frontline breaker",
    unlock: "Default",
    description: "Walkers march forward and smash whatever blocks the lane. Best for finishing games once a wall falls.",
  },
  miniWalker: {
    cost: 50,
    hp: 150,
    speed: 1,
    damage: 75,
    attackRate: 4,
    moving: true,
    letter: "MW",
    color: "#90ffa0",
    role: "Hyper rush",
    unlock: "1 win",
    description: "Mini Walkers swarm fast. They hit four times as quickly at half Walker damage, move twice as fast, and trade durability for speed.",
  },
  ranger: {
    cost: 125,
    hp: 1500,
    damage: 75,
    attackRate: 0.5,
    moving: false,
    letter: "R",
    color: "#73a8ff",
    role: "Lane control",
    description: "Rangers lock down their lane from range and steadily chip units and walls.",
  },
  marker: {
    cost: 125,
    hp: 300,
    moving: false,
    letter: "M",
    color: "#f0a255",
    laserDps: 250,
    deathExplosion: 300,
    role: "Cross-lane disruptor",
    description: "Markers burn enemies in adjacent lanes, then explode on death to punish clustered pushes.",
  },
  teleZoom: {
    cost: 100,
    hp: 200,
    speed: 2 / 3,
    damage: 0,
    attackRate: 0,
    moving: true,
    letter: "TZ",
    color: "#a784ff",
    teleportDelay: 1,
    teleportBlast: 400,
    role: "Win-condition infiltrator",
    description: "Tele-Zoom idles for 1 second, teleports to 3 tiles from the enemy wall, blasts a 3x3 area for 400 damage once, then advances 1 tile every 1.5s.",
  },
};

const UNIT_ART = {
  walker: {
    player: "assets/robots/walker.svg",
    ai: "assets/robots/walker-enemy.svg",
    width: 240,
    height: 240,
  },
  miniWalker: {
    player: "assets/robots/mini-walker.svg",
    ai: "assets/robots/mini-walker-enemy.svg",
    width: 220,
    height: 220,
  },
  ranger: {
    player: "assets/robots/ranger.svg",
    ai: "assets/robots/ranger-enemy.svg",
    width: 240,
    height: 240,
  },
  marker: {
    player: "assets/robots/marker.svg",
    ai: "assets/robots/marker-enemy.svg",
    width: 180,
    height: 260,
  },
  teleZoom: {
    player: "assets/robots/tele-zoom.svg",
    ai: "assets/robots/tele-zoom-enemy.svg",
    width: 220,
    height: 220,
  },
};

const unitArtImages = Object.fromEntries(
  Object.entries(UNIT_ART).map(([key, art]) => {
    const playerImg = new Image();
    playerImg.src = art.player;
    const aiImg = new Image();
    aiImg.src = art.ai;
    return [key, { player: playerImg, ai: aiImg }];
  })
);

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const playerBoltsEl = document.getElementById("player-bolts");
const playerWallHpEl = document.getElementById("player-wall-hp");
const aiWallHpEl = document.getElementById("ai-wall-hp");
const playerWallBar = document.getElementById("player-wall-bar");
const aiWallBar = document.getElementById("ai-wall-bar");

const menuScreen = document.getElementById("menu-screen");
const gameScreen = document.getElementById("game-screen");
const botBookScreen = document.getElementById("bot-book-screen");
const updateLogScreen = document.getElementById("update-log-screen");
const botListEl = document.getElementById("bot-list");
const botDetailsEl = document.getElementById("bot-details");

let selectedUnit = "walker";
let selectedBot = "walker";
let lastTs = performance.now();
let isGameActive = false;

const ANIM_DURATIONS = {
  slam: 0.25,
  shot: 0.25,
  hit: 0.2,
  teleport: 0.6,
};

const state = {
  over: false,
  winner: null,
  units: [],
  nextId: 1,
  playerBolts: 200,
  aiBolts: 200,
  econTimer: 0,
  aiThinkTimer: 0,
  walls: {
    player: { hp: MAX_WALL_HP, alive: true, col: PLAYER_WALL_COL },
    ai: { hp: MAX_WALL_HP, alive: true, col: AI_WALL_COL },
  },
};

function showScreen(name) {
  menuScreen.classList.toggle("active", name === "menu");
  gameScreen.classList.toggle("active", name === "game");
  botBookScreen.classList.toggle("active", name === "book");
  updateLogScreen.classList.toggle("active", name === "log");
  isGameActive = name === "game";
  if (isGameActive) render();
}

function reset() {
  state.over = false;
  state.winner = null;
  state.units = [];
  state.nextId = 1;
  state.playerBolts = 200;
  state.aiBolts = 200;
  state.econTimer = 0;
  state.aiThinkTimer = 0;
  state.walls.player = { hp: MAX_WALL_HP, alive: true, col: PLAYER_WALL_COL };
  state.walls.ai = { hp: MAX_WALL_HP, alive: true, col: AI_WALL_COL };
  setStatus("Destroy enemy wall, then cross with a Walker.");
}

function setStatus(text) {
  statusEl.textContent = text;
}

function makeUnit(type, side, lane, col) {
  const def = UNIT_DEFS[type];
  return {
    id: state.nextId++,
    type,
    side,
    lane,
    x: col,
    hp: def.hp,
    maxHp: def.hp,
    cooldown: 0,
    alive: true,
    age: 0,
    hasTeleported: false,
    prevX: col,
    isMoving: false,
    anim: {
      slam: 0,
      shot: 0,
      hit: 0,
      teleport: 0,
    },
    shotTargetX: null,
  };
}

function canPlace(side, lane, col) {
  if (lane < 0 || lane >= LANES || col < 0 || col >= COLS) return false;
  const inSide = side === "player" ? col < HALF : col >= HALF;
  if (!inSide) return false;
  return !state.units.some((u) => u.alive && u.lane === lane && Math.abs(u.x - col) < 0.7);
}

function placeUnit(side, type, lane, col) {
  const def = UNIT_DEFS[type];
  if (!def || !canPlace(side, lane, col)) return false;
  if (side === "player") {
    if (state.playerBolts < def.cost) return false;
    state.playerBolts -= def.cost;
  } else {
    if (state.aiBolts < def.cost) return false;
    state.aiBolts -= def.cost;
  }
  state.units.push(makeUnit(type, side, lane, col));
  return true;
}

function enemySide(side) {
  return side === "player" ? "ai" : "player";
}

function update(dt) {
  if (!isGameActive || state.over) return;
  state.econTimer += dt;
  state.aiThinkTimer += dt;

  if (state.econTimer >= ECON_TICK) {
    state.econTimer -= ECON_TICK;
    state.playerBolts = Math.min(BOLT_CAP, state.playerBolts + ECON_GAIN);
    state.aiBolts = Math.min(BOLT_CAP, state.aiBolts + ECON_GAIN);
  }

  if (state.aiThinkTimer >= 1.8) {
    state.aiThinkTimer = 0;
    aiAct();
  }

  for (const u of state.units) {
    if (!u.alive) continue;
    const def = UNIT_DEFS[u.type];
    const prevHp = u.hp;
    const prevX = u.x;
    u.age += dt;
    u.cooldown = Math.max(0, u.cooldown - dt);

    if (u.type === "walker" || u.type === "miniWalker") updateWalker(u, def, dt);
    else if (u.type === "ranger") updateRanger(u, def);
    else if (u.type === "marker") updateMarker(u, def, dt);
    else if (u.type === "teleZoom") updateTeleZoom(u, def, dt);

    if (u.hp < prevHp) {
      u.anim.hit = ANIM_DURATIONS.hit;
    }
    u.prevX = prevX;
    u.isMoving = Math.abs(u.x - prevX) > 0.001;
    u.anim.slam = Math.max(0, u.anim.slam - dt);
    u.anim.shot = Math.max(0, u.anim.shot - dt);
    u.anim.hit = Math.max(0, u.anim.hit - dt);
    u.anim.teleport = Math.max(0, u.anim.teleport - dt);
  }

  resolveDeaths();
  checkWin();
  render();
  syncHud();
}

function updateWalker(u, def, dt) {
  const dir = u.side === "player" ? 1 : -1;
  const enemies = state.units.filter((e) => e.alive && e.side !== u.side && e.lane === u.lane);
  let frontEnemy = null;
  let minDist = Infinity;

  for (const e of enemies) {
    const d = (e.x - u.x) * dir;
    if (d > 0 && d <= 1.0 && d < minDist) {
      minDist = d;
      frontEnemy = e;
    }
  }

  if (frontEnemy) {
    if (u.cooldown <= 0) {
      frontEnemy.hp -= def.damage;
      u.cooldown = 1 / def.attackRate;
      u.anim.slam = ANIM_DURATIONS.slam;
    }
    return;
  }

  const foeWall = state.walls[enemySide(u.side)];
  const wallDist = (foeWall.col - u.x) * dir;
  if (foeWall.alive && wallDist > 0 && wallDist <= 1.0) {
    if (u.cooldown <= 0) {
      foeWall.hp -= def.damage;
      u.cooldown = 1 / def.attackRate;
      u.anim.slam = ANIM_DURATIONS.slam;
      if (foeWall.hp <= 0) {
        foeWall.hp = 0;
        foeWall.alive = false;
      }
    }
    return;
  }

  if (foeWall.alive) {
    if ((u.side === "player" && u.x < foeWall.col - 1) || (u.side === "ai" && u.x > foeWall.col + 1)) {
      u.x += dir * def.speed * dt;
    }
  } else {
    u.x += dir * def.speed * dt;
  }
}


function updateTeleZoom(u, def, dt) {
  const dir = u.side === "player" ? 1 : -1;

  if (!u.hasTeleported) {
    if (u.age < def.teleportDelay) return;
    u.hasTeleported = true;
    u.x = u.side === "player" ? AI_WALL_COL - 3 : PLAYER_WALL_COL + 3;
    u.anim.teleport = ANIM_DURATIONS.teleport;
    for (const e of state.units) {
      if (!e.alive || e.side === u.side) continue;
      if (Math.abs(e.lane - u.lane) <= 1 && Math.abs(e.x - u.x) <= 1) {
        e.hp -= def.teleportBlast;
      }
    }
  }

  u.x += dir * def.speed * dt;
}

function updateRanger(u, def) {
  if (u.cooldown > 0) return;
  const enemies = state.units
    .filter((e) => e.alive && e.side !== u.side && e.lane === u.lane)
    .sort((a, b) => Math.abs(a.x - u.x) - Math.abs(b.x - u.x));

  if (enemies.length > 0) {
    enemies[0].hp -= def.damage;
    u.cooldown = 1 / def.attackRate;
    u.anim.shot = ANIM_DURATIONS.shot;
    u.shotTargetX = enemies[0].x;
    return;
  }

  const foeWall = state.walls[enemySide(u.side)];
  if (foeWall.alive) {
    foeWall.hp -= def.damage;
    u.cooldown = 1 / def.attackRate;
    u.anim.shot = ANIM_DURATIONS.shot;
    u.shotTargetX = foeWall.col;
    if (foeWall.hp <= 0) {
      foeWall.hp = 0;
      foeWall.alive = false;
    }
  }
}

function updateMarker(u, def, dt) {
  const targets = state.units.filter(
    (e) => e.alive && e.side !== u.side && e.lane !== u.lane && Math.abs(e.x - u.x) <= 0.45
  );
  if (targets.length > 0) {
    u.anim.shot = ANIM_DURATIONS.shot;
  }
  for (const t of targets) t.hp -= def.laserDps * dt;
}

function resolveDeaths() {
  for (const u of state.units) {
    if (u.alive && u.hp <= 0) {
      u.alive = false;
      if (u.type === "marker") {
        for (const e of state.units) {
          if (!e.alive || e.side === u.side) continue;
          if (Math.abs(e.lane - u.lane) <= 1 && Math.abs(e.x - u.x) <= 1) {
            e.hp -= UNIT_DEFS.marker.deathExplosion;
          }
        }
      }
    }
  }
}

function checkWin() {
  for (const u of state.units) {
    if (!u.alive || (u.type !== "walker" && u.type !== "miniWalker" && u.type !== "teleZoom")) continue;
    if (u.side === "player" && !state.walls.ai.alive && u.x >= COLS - 0.05) {
      state.over = true;
      state.winner = "player";
    }
    if (u.side === "ai" && !state.walls.player.alive && u.x <= -0.05) {
      state.over = true;
      state.winner = "ai";
    }
  }
  if (state.over) setStatus(state.winner === "player" ? "You win by crossing!" : "AI wins by crossing!");
}

function aiAct() {
  if (state.over) return;
  const threats = new Array(LANES).fill(0);
  for (const u of state.units) {
    if (!u.alive || u.side !== "player" || (u.type !== "walker" && u.type !== "miniWalker" && u.type !== "teleZoom")) continue;
    threats[u.lane] += 1;
  }
  const dangerLane = threats.indexOf(Math.max(...threats));

  if (threats[dangerLane] > 0 && state.aiBolts >= 125) {
    const unit = Math.random() < 0.55 ? "ranger" : "marker";
    const col = Math.random() < 0.5 ? 11 : 12;
    if (canPlace("ai", dangerLane, col, unit)) {
      placeUnit("ai", unit, dangerLane, col);
      return;
    }
  }

  if (state.aiBolts >= 50) {
    const lane = Math.floor(Math.random() * LANES);
    const col = 14;
    const useMiniWalker = state.aiBolts >= UNIT_DEFS.walker.cost ? Math.random() < 0.35 : true;
    placeUnit("ai", useMiniWalker ? "miniWalker" : "walker", lane, col);
  }
}

function syncHud() {
  playerBoltsEl.textContent = Math.floor(state.playerBolts);
  playerWallHpEl.textContent = `${Math.ceil(state.walls.player.hp)} / ${MAX_WALL_HP}`;
  aiWallHpEl.textContent = `${Math.ceil(state.walls.ai.hp)} / ${MAX_WALL_HP}`;
  playerWallBar.style.width = `${(state.walls.player.hp / MAX_WALL_HP) * 100}%`;
  aiWallBar.style.width = `${(state.walls.ai.hp / MAX_WALL_HP) * 100}%`;
}

function render() {
  if (!gameScreen.classList.contains("active")) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = rect.width;
  const h = rect.height;
  const cellW = w / COLS;
  const cellH = h / LANES;

  ctx.fillStyle = "#081224";
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "#0e1d39";
  ctx.fillRect(0, 0, w / 2, h);
  ctx.fillStyle = "#1f1528";
  ctx.fillRect(w / 2, 0, w / 2, h);

  ctx.strokeStyle = "#3b4d77";
  ctx.lineWidth = 1;
  for (let c = 0; c <= COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * cellW, 0);
    ctx.lineTo(c * cellW, h);
    ctx.stroke();
  }
  for (let r = 0; r <= LANES; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * cellH);
    ctx.lineTo(w, r * cellH);
    ctx.stroke();
  }

  ctx.strokeStyle = "#7ee2ff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(HALF * cellW, 0);
  ctx.lineTo(HALF * cellW, h);
  ctx.stroke();

  drawWall("player", cellW, h);
  drawWall("ai", cellW, h);

  for (const u of state.units) {
    if (!u.alive) continue;
    const def = UNIT_DEFS[u.type];
    const x = (u.x + 0.5) * cellW;
    const y = (u.lane + 0.5) * cellH;
    drawUnitEffects(u, x, y, cellW, cellH);
    if (!drawUnitArt(u, x, y, Math.min(cellW, cellH) * 0.9)) {
      ctx.fillStyle = u.side === "player" ? def.color : "#ff7c7c";
      ctx.beginPath();
      ctx.arc(x, y, Math.min(cellW, cellH) * 0.28, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#001022";
      ctx.font = `${Math.floor(cellH * 0.24)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(def.letter, x, y);
    }

    const hpW = cellW * 0.62;
    const hpH = 5;
    ctx.fillStyle = "#000";
    ctx.fillRect(x - hpW / 2, y - cellH * 0.32, hpW, hpH);
    ctx.fillStyle = "#69d47f";
    ctx.fillRect(x - hpW / 2, y - cellH * 0.32, hpW * Math.max(0, u.hp / u.maxHp), hpH);
  }
}

function drawWall(side, cellW, h) {
  const wall = state.walls[side];
  const x = side === "player" ? wall.col * cellW : (wall.col + 1) * cellW;
  ctx.fillStyle = side === "player" ? "#3c8f45" : "#9a4444";
  const width = 8;
  if (wall.alive) ctx.fillRect(x - width / 2, 0, width, h);
}

function drawUnitEffects(unit, x, y, cellW, cellH) {
  if (unit.anim.hit > 0) {
    const hitT = unit.anim.hit / ANIM_DURATIONS.hit;
    ctx.save();
    ctx.globalAlpha = 0.6 * hitT;
    ctx.strokeStyle = unit.side === "player" ? "#9dffb0" : "#ff9aa6";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, cellW * 0.25 + 10 * (1 - hitT), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (unit.anim.teleport > 0) {
    const tpT = unit.anim.teleport / ANIM_DURATIONS.teleport;
    ctx.save();
    ctx.globalAlpha = 0.5 * tpT;
    ctx.strokeStyle = "#b58dff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, cellW * 0.28 + 30 * (1 - tpT), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (unit.anim.shot > 0 && unit.type === "ranger" && unit.shotTargetX !== null) {
    const shotT = unit.anim.shot / ANIM_DURATIONS.shot;
    const targetX = (unit.shotTargetX + 0.5) * cellW;
    ctx.save();
    ctx.globalAlpha = 0.8 * shotT;
    ctx.strokeStyle = unit.side === "player" ? "#9cc7ff" : "#ff9aa6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(targetX, y);
    ctx.stroke();
    ctx.restore();
  }

  if (unit.anim.shot > 0 && unit.type === "marker") {
    const beamT = unit.anim.shot / ANIM_DURATIONS.shot;
    ctx.save();
    ctx.globalAlpha = 0.6 * beamT;
    ctx.strokeStyle = "#f7b676";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y - cellH * 0.35);
    ctx.lineTo(x, y + cellH * 0.35);
    ctx.stroke();
    ctx.restore();
  }
}

function drawUnitArt(unit, x, y, size) {
  const art = UNIT_ART[unit.type];
  if (!art) return false;
  const image = unitArtImages[unit.type]?.[unit.side];
  if (!image || !image.complete || image.naturalWidth === 0) return false;
  const scale = size / Math.max(art.width, art.height);
  const drawW = art.width * scale;
  const drawH = art.height * scale;
  const bob = Math.sin(unit.age * 6 + unit.lane) * (unit.isMoving ? 4 : 1.6);
  const slamT = unit.anim.slam > 0 ? unit.anim.slam / ANIM_DURATIONS.slam : 0;
  const shotT = unit.anim.shot > 0 ? unit.anim.shot / ANIM_DURATIONS.shot : 0;
  const slamKick = slamT > 0 ? Math.sin(slamT * Math.PI) : 0;
  const shotKick = shotT > 0 ? Math.sin(shotT * Math.PI) : 0;
  const recoilDir = unit.side === "player" ? -1 : 1;
  const recoil = (slamKick * 6 + shotKick * 4) * recoilDir;
  const scaleKick = 1 + slamKick * 0.05 + shotKick * 0.03;
  ctx.save();
  ctx.translate(x + recoil, y + bob);
  if (unit.side === "ai") ctx.scale(-1, 1);
  ctx.scale(scaleKick, scaleKick);
  ctx.drawImage(image, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
  return true;
}

function renderBotBook() {
  botListEl.innerHTML = "";
  for (const [key, def] of Object.entries(UNIT_DEFS)) {
    const entry = document.createElement("button");
    entry.className = `bot-entry ${selectedBot === key ? "active" : ""}`;
    entry.innerHTML = `<strong>${capitalize(key)}</strong><p>${def.role}</p>`;
    entry.addEventListener("pointerdown", () => {
      selectedBot = key;
      renderBotBook();
    });
    botListEl.appendChild(entry);
  }

  const def = UNIT_DEFS[selectedBot];
  const art = UNIT_ART[selectedBot];
  const statItems = [
    ["Cost", def.cost],
    ["HP", def.hp],
    ["Damage", def.damage ?? "-"] ,
    ["Attack Rate", def.attackRate ? `${def.attackRate}/s` : "-"],
    ["Speed", def.speed ?? "-"],
    ["Unlock", def.unlock ?? "Default"],
    ["Laser DPS", def.laserDps ?? "-"],
    ["Death Blast", def.deathExplosion ?? "-"],
    ["Teleport Delay", def.teleportDelay ? `${def.teleportDelay}s` : "-"],
    ["Teleport Blast", def.teleportBlast ?? "-"],
  ];

  botDetailsEl.innerHTML = `
    <h3>${capitalize(selectedBot)}</h3>
    <p>${def.description}</p>
    ${
      art
        ? `<div class="bot-art">
      <figure>
        <img src="${art.player}" alt="${capitalize(selectedBot)} player art" loading="lazy" />
        <figcaption>Player</figcaption>
      </figure>
      <figure>
        <img src="${art.ai}" alt="${capitalize(selectedBot)} enemy art" loading="lazy" />
        <figcaption>Enemy</figcaption>
      </figure>
    </div>`
        : ""
    }
    <div class="bot-stats">
      ${statItems.map(([label, val]) => `<div class="bot-stat"><strong>${label}:</strong> ${val}</div>`).join("")}
    </div>
  `;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function handlePlace(ev) {
  if (!isGameActive || state.over) return;
  const rect = canvas.getBoundingClientRect();
  const px = ev.clientX - rect.left;
  const py = ev.clientY - rect.top;
  const col = Math.floor((px / rect.width) * COLS);
  const lane = Math.floor((py / rect.height) * LANES);
  if (placeUnit("player", selectedUnit, lane, col)) {
    setStatus(`Placed ${selectedUnit} at lane ${lane + 1}, col ${col + 1}.`);
  }
}

canvas.addEventListener("pointerdown", handlePlace);

document.querySelectorAll(".unit-buttons button").forEach((btn) => {
  btn.addEventListener("pointerdown", () => {
    selectedUnit = btn.dataset.unit;
    document.querySelectorAll(".unit-buttons button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

document.querySelector('.unit-buttons button[data-unit="walker"]').classList.add("active");
document.getElementById("restart").addEventListener("pointerdown", reset);

document.getElementById("fight-btn").addEventListener("pointerdown", () => {
  reset();
  syncHud();
  showScreen("game");
});

document.getElementById("bot-book-btn").addEventListener("pointerdown", () => {
  renderBotBook();
  showScreen("book");
});

document.getElementById("update-log-btn").addEventListener("pointerdown", () => showScreen("log"));
document.getElementById("book-back").addEventListener("pointerdown", () => showScreen("menu"));
document.getElementById("log-back").addEventListener("pointerdown", () => showScreen("menu"));
document.getElementById("menu-from-game").addEventListener("pointerdown", () => showScreen("menu"));

window.addEventListener("resize", render);

reset();
syncHud();
showScreen("menu");

function frame(ts) {
  const dt = Math.min(0.1, (ts - lastTs) / 1000);
  lastTs = ts;
  update(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
