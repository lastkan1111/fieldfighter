const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const BASIC_ATTACK_COOL_BASE = 1000; // 기본공격 쿨타임 1000ms (1초)
let butterflyProjectiles = [];
// ★ 서버.js 제일 위쪽(전역) 추가 ★
let nextArrowId = 1;
function makeArrowId() {
  return nextArrowId++;
}


const BUTTERFLY_KEEP_DIST = 30;      // 유지 거리
const BUTTERFLY_SHOOT_COOL = 50;      // 침 발사 쿨타임(50프레임≈1.5초)
const BUTTERFLY_PROJECTILE_SPEED = 9; // 침 속도
const BUTTERFLY_PROJECTILE_DAMAGE = 5; // ★ 맞으면 데미지 5!





function getPlayerStats(level) {
  return {
    hp: 50,    // 레벨이 올라가도 고정!
    mp: 10,
    atk: 7,
    def: 0,
    range: 1,
    regen: 2
  };
}


function expToNextLevel(level) {
  if (level <= 50) return 30 + (level-1)*8;
  else return 422 + Math.round(Math.pow(level-50, 2.2)*2.7);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);
let arrows = [];

const PORT = 3000;
const MAP_SIZE = 50000;
const TREE_COUNT = 500;

let playerSkillCooldowns = {};

let trees = [];
let players = {}; // { socket.id: {x, y, dir, state, frame} }
// server.js 상단
const ORB_COUNT = 0;
let orbs = [];

// 나비 몬스터 시트 사용 (이동 0~3, 공격 4~7, 사망 7행 1프레임)
const BUTTERFLY_COUNT = 500;
const BUTTERFLY_SIZE = 63; // 나비 스프라이트 사이즈
let butterflies = [];


// 예시로 나비 한 마리 추가
butterflies.push({
  id: 1,
  x: 100,
  y: 200,
  hp: 30,
  state: "alive",
  hitbox: { type: "circle", radius: 22 } // ★ 중심 기준, 반지름 22픽셀!
  // ...기타필드
});





function spawnButterflies() {
  butterflies = [];
  for (let i = 0; i < BUTTERFLY_COUNT; i++) {
    butterflies.push({
      id: i,
      x: Math.random() * MAP_SIZE,
      y: Math.random() * MAP_SIZE,
      state: "move",    // move, attack, dead
      dir: Math.floor(Math.random() * 4), // 0~3: 아래,왼,오,위
      frame: 0,         // 애니프레임 0~3
      deadTimer: 0,
      evade: 10,        // ★ 기본 회피율 10%
      hp: 15,           // ★ 체력 15로 고정!
      maxHp: 15         // ★ 최대 체력도 15로 고정!
    });
  }
}

spawnButterflies();


// 경험치 구슬 랜덤 생성
function initOrbs() {
  orbs = [];
  for (let i = 0; i < ORB_COUNT; i++) {
    orbs.push({
      id: i,
      x: Math.random() * MAP_SIZE,
      y: Math.random() * MAP_SIZE,
      value: Math.floor(Math.random() * 6) + 5 // 5~10 경험치
    });
  }
}
initOrbs();

function getOrbsNear(x, y, range=1500) {
  return orbs.filter(o =>
    Math.abs(o.x - x) < range && Math.abs(o.y - y) < range
  );
}


function calcStatGrowth(base, perPoint, level) {
  let remain = level;
  let value = 0;
  let first = Math.min(remain, 30); value += first * perPoint * 1.0; remain -= first;
  let second = Math.min(remain, 40); value += second * perPoint * 0.8; remain -= second;
  let third = Math.min(remain, 30); value += third * perPoint * 0.6; remain -= third;
  let fourth = Math.min(remain, 100); value += fourth * perPoint * 0.4; remain -= fourth;
  value += remain * perPoint * 0.2;
  return Math.floor(base + value);
}

function applyStatsToPlayer(player) {
  // statLevels = {hp,mp,str,int,...}
  const s = player.statLevels || {};
  player.maxHp = calcStatGrowth(50, 10, s.hp || 0);
  player.maxMp = calcStatGrowth(10, 5, s.mp || 0);
  player.atk   = calcStatGrowth(7, 3, s.str || 0);
  player.acc = 50 + Math.min((s.acc || 0), 100) * 0.5;

  player.def   = calcStatGrowth(0, 1, s.vit || 0);
  player.regenDelay = 8.0 - (s.int || 0)*0.1;  // 회복지연
  player.regenDelay = Math.max(2.0, player.regenDelay); // 최소 2초
  player.evade = 3 + (s.agi || 0)*0.1; // %
  player.crit = Math.min(40, (s.luk || 0) * 0.4); // 운 100이면 40%
  player.acc   = 50 + (s.acc || 0)*0.25; // %
  player.aspd  = 1.0 + (s.aspd || 0)*0.01; // 0.1%씩
  player.mspd  = 2.0 + (s.mspd || 0)*0.1;
}



function initTrees() {
  trees = [];
  for (let i = 0; i < TREE_COUNT; i++) {
    trees.push({
      x: Math.floor(Math.random() * MAP_SIZE),
      y: Math.floor(Math.random() * MAP_SIZE)
    });
  }
}
initTrees();

// 방향(0:아래, 1:왼쪽, 2:오른쪽, 3:위)
function getButterflyDir(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 2 : 1;
  } else {
    return dy > 0 ? 0 : 3;
  }
}


app.use(express.static("."));



// === server.js 상단(플레이어, 몬스터 등 전역 선언 이후, io.on("connection", ...) 바깥에 ===
setInterval(() => {
    
 for (let i = arrows.length - 1; i >= 0; i--) {
  let a = arrows[i];
  a.x += a.vx;
  a.y += a.vy;
  a.life -= Math.sqrt(a.vx * a.vx + a.vy * a.vy);

  // 1. === 플레이어 충돌 판정 ===
  let playerHit = false;
  for (let pid in players) {
    if (pid === a.shooterId) continue; // 본인은 안 맞음
    let p = players[pid];
    if (!p || p.state === "dead") continue;
    let dx = p.x - a.x, dy = p.y - a.y;
    if (dx * dx + dy * dy < 45 * 45) { // 충돌 판정(45픽셀)
      let attacker = players[a.shooterId];
      let acc = attacker?.acc ?? 50; // 공격자 명중률
      let evade = p.evade ?? 0;      // 피격자 회피율
      let hitChance = Math.max(5, Math.min(95, acc - evade)); // 5~95%

      if (Math.random() * 100 > hitChance) {
        // 빗나감(MISS!)
        io.emit("hitEffect", { x: p.x, y: p.y, id: pid, damage: 0, arrowId: a.id, miss: true });
        arrows.splice(i, 1);
        playerHit = true;
        break;
      }

      // ↓ 여기서부턴 기존 데미지 계산·사망 처리 그대로!
      let atk = attacker?.atk ?? 10;
      let def = p.def ?? 0;
      let ratio = 0.99 + Math.random() * 0.02;
      let damage = Math.max(1, Math.round((atk - def) * ratio));
      p.hp -= damage;

      // === 넉백 효과 ===
    let bx = p.x - a.x;
    let by = p.y - a.y;
    let dist = Math.sqrt(bx * bx + by * by) || 1;
    let knockback = 16;
    p.x += (bx / dist) * knockback;
    p.y += (by / dist) * knockback;

      if (p.hp <= 0) {
        p.hp = 0;
        p.state = "dead";
        p.frame = 0;
        p.animTimer = 0;
        let killerName = attacker?.name || ("ID_" + (a.shooterId?.slice?.(0, 8) || "???"));
        let victimName = p?.name || ("ID_" + (pid?.slice?.(0, 8) || "???"));
        io.emit("killMsg", {
          killer: killerName,
          victim: victimName,
        });
      }

      io.emit("hitEffect", { x: p.x, y: p.y, id: pid, damage, arrowId: a.id });
      arrows.splice(i, 1);
      playerHit = true;
      break;
    }
  }
  if (playerHit) continue;

  // 2. === 나비 몬스터 충돌 판정 ===
  let butterflyHit = false;
  for (let j = butterflies.length - 1; j >= 0; j--) {
    let b = butterflies[j];
    if (b.state === "dead" || b.hp <= 0) continue;
    let dx = b.x - a.x, dy = b.y - a.y;
    if (dx * dx + dy * dy < 45 * 45) {
      let attacker = players[a.shooterId];
      let acc = attacker?.acc ?? 50;
      let evade = b.evade ?? 0;
      let hitChance = Math.max(5, Math.min(95, acc - evade));
      if (Math.random() * 100 > hitChance) {
        io.emit("hitEffect", { x: b.x, y: b.y, id: "butterfly_" + b.id, damage: 0, arrowId: a.id, shooterId: a.shooterId, miss: true });
        arrows.splice(i, 1);
        butterflyHit = true;
        break;
      }

      // 명중!
let atk = attacker?.atk ?? 10;
let def = 0;
let ratio = 0.99 + Math.random() * 0.02;
let damage = Math.max(1, Math.round((atk - def) * ratio));

// === 크리티컬 판정 추가 ===
let isCrit = false;
let crit = attacker?.crit ?? 0;
if (Math.random() * 100 < crit) {
  isCrit = true;
  damage = Math.round(damage * 1.5);
}

b.hp -= damage;

// === [여기에 이 코드 넣으세요!] ===
let bx = b.x - a.x;
let by = b.y - a.y;
let dist = Math.sqrt(bx * bx + by * by) || 1;
let knockback = 16;
b.x += (bx / dist) * knockback;
b.y += (by / dist) * knockback;

// ====== emit에 crit: isCrit만 추가 ======
io.emit("hitEffect", { x: b.x, y: b.y, id: "butterfly_" + b.id, damage, arrowId: a.id, crit: isCrit });


         // 🟢 여기!
    if (b.hp <= 0 && b.state !== "dead") {
  b.hp = 0;
  b.state = "dead";
  b.frame = 0;
  b.deadTimer = 0;
  // 경험치 10 획득!
  if (attacker) {
    attacker.exp = (attacker.exp || 0) + 10;

    // 🟢 [추가] 레벨업 처리!
    let leveledUp = false;
   while (attacker.exp >= attacker.maxExp) {
  attacker.exp -= attacker.maxExp;
  attacker.level++;
  attacker.maxExp = expToNextLevel(attacker.level);
  // 항상 1포인트만 증가
  attacker.statPoints = (attacker.statPoints || 0) + 1;
  leveledUp = true;
}



    if (leveledUp) {
      io.to(attacker.id || a.shooterId).emit("playerStats", attacker);
    }
  }
}



      io.emit("butterflies", butterflies);
      arrows.splice(i, 1);
      butterflyHit = true;
      break;
    }
  }



  if (butterflyHit) continue;

  // 3. === 맵 밖/수명 다하면 삭제 ===
  if (a.x < 0 || a.x > MAP_SIZE || a.y < 0 || a.y > MAP_SIZE || a.life < 0) {
    arrows.splice(i, 1);
    continue;
  }
}



for (let b of butterflies) {
  if (b.state === "dead") continue;

  // 가장 가까운 플레이어 추적
  let minDist = Infinity, target = null;
  for (const id in players) {
    let p = players[id];
    if (!p || p.state === "dead") continue;
    let dx = p.x - b.x, dy = p.y - b.y;
    let dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < minDist) { minDist = dist; target = p; }
  }
  if (target && minDist < 99999) {
    let dx = target.x - b.x, dy = target.y - b.y;
    let dist = Math.sqrt(dx*dx + dy*dy);
    let speed = 1.1;
    // ▶ 유지거리보다 멀면 이동
    if (dist > BUTTERFLY_KEEP_DIST) {
      b.x += dx / dist * speed;
      b.y += dy / dist * speed;
      if (Math.abs(dx) > Math.abs(dy)) b.dir = dx > 0 ? 2 : 1;
      else b.dir = dy > 0 ? 0 : 3;
      b.state = "move";
    } else {
      b.state = "attack";
      // ▶ 발사체 쿨타임
      b.shootCooldown = (b.shootCooldown || 0) - 1;
      if (b.shootCooldown <= 0) {
        butterflyProjectiles.push({
          x: b.x,
          y: b.y,
          vx: dx / dist * BUTTERFLY_PROJECTILE_SPEED,
          vy: dy / dist * BUTTERFLY_PROJECTILE_SPEED,
          life: 30 // 수명
        });
        b.shootCooldown = BUTTERFLY_SHOOT_COOL;
      }
    }
    // === 여기만 바꿔주면 됨! ===
    b.animTimer = (b.animTimer || 0) + 1;
    if (b.animTimer >= 6) {   // 숫자가 커질수록 더 느림 (6~10 추천)
      b.animTimer = 0;
      b.frame = (b.frame + 1) % 4;
    }
  }
}


// === 나비 침(발사체) 이동 & 플레이어와 충돌 체크 ===
for (let i = butterflyProjectiles.length - 1; i >= 0; i--) {
  let proj = butterflyProjectiles[i];
  proj.x += proj.vx;
  proj.y += proj.vy;
  proj.life--;
  // 플레이어와 충돌
  for (const id in players) {
    let p = players[id];
    if (!p || p.state === "dead") continue;
    let dx = p.x - proj.x, dy = p.y - proj.y;
    if (dx*dx + dy*dy < 28*28) {

       // 🟡 회피 판정 추가!
    if (Math.random() * 100 < (p.evade || 0)) {
      // 회피 성공! 데미지 0, 파티클만 띄움
      io.to(id).emit("hitEffect", { x: p.x, y: p.y, damage: 0 });
      butterflyProjectiles.splice(i, 1);
      break;
    }

      // 변경 (방어력 반영)
      let damage = Math.max(1, BUTTERFLY_PROJECTILE_DAMAGE - (p.def || 0));
      p.hp -= damage;
      // ★ 죽으면 즉시 상태 dead, 5초 뒤 랜덤 부활 예약
      if (p.hp <= 0 && p.state !== "dead") {
        p.state = "dead";
        p.frame = 0;
        p.animTimer = 0;
        p.respawnTime = Date.now() + 5000;
      }
      
      butterflyProjectiles.splice(i, 1);
      io.to(id).emit("hitEffect", { x: p.x, y: p.y, damage }); // 실제로 입은 damage!

    }
  }
  if (proj.life <= 0) butterflyProjectiles.splice(i, 1);
}





      const now = Date.now();
for (const id in players) {
  const p = players[id];
  if (!p) continue;

  // 사망 상태 & 아직 respawnTime이 없으면 5초 후로 예약
  if (p.state === "dead" && !p.respawnTime) {
    p.respawnTime = now + 5000;
  }

  // 죽은 상태이고 respawnTime이 지나면 부활 처리
  if (p.state === "dead" && p.respawnTime && now >= p.respawnTime) {
    p.x = Math.random() * MAP_SIZE;
    p.y = Math.random() * MAP_SIZE;
    p.hp = p.maxHp;
    p.mp = p.maxMp;
    p.state = "idle";
    p.frame = 0;
    p.animTimer = 0;
    delete p.respawnTime;
  }
}

// === 몬스터 리스폰 타이머 ===
setInterval(() => {
  for (let b of butterflies) {
    if (b.state === "dead") {
      // 죽은지 5초 경과했다면 부활!
      if (!b.respawnTime) {
        b.respawnTime = Date.now() + 5000;
      }
      if (Date.now() >= b.respawnTime) {
        b.state = "move";
        b.hp = b.maxHp;
        b.frame = 0;
        b.animTimer = 0;
        // 위치 랜덤 (혹은 원래 위치로 복귀도 가능)
        b.x = Math.random() * MAP_SIZE;
        b.y = Math.random() * MAP_SIZE;
        delete b.respawnTime;
      }
    }
  }
}, 1000); // 1초마다 체크 (실제 리스폰은 5초 경과 시)


  for (const id in players) {
    const player = players[id];
    if (!player) continue;

    // 공격 모션 상태라면 프레임 진행
    if (player.state === "attack") {
      player.animTimer = (player.animTimer || 0) + 1;
      if (player.animTimer >= 1) {
        player.animTimer = 0;
        if (player.frame < 7) player.frame++;
        else {
          // 공격 끝, idle로 복귀!
          player.state = "idle";
          player.frame = 0;
        }
      }
    }
    // (사망 등 다른 상태도 이 구조로 확장 가능)
     if (player.state === "dead") {
    player.animTimer = (player.animTimer || 0) + 1;
    if (player.animTimer >= 5) {  // 5틱마다 프레임 진행 (조정 가능)
      player.animTimer = 0;
      // 죽은 시트가 0~7까지라면
      if (player.frame < 7) player.frame++;
      // 만약 사망 애니 끝나면 그대로 멈추고(더 진행 안 함)
    }
  }
    


  }

  // === 동기화 ===
io.emit("butterflies", butterflies);
io.emit("butterflyProjectiles", butterflyProjectiles);
io.emit("players", players); // hp 반영
  // 전체에게 상태 동기화
  io.emit("players", players);
}, 30); // 20~50ms 추천


// ★ 자동 회복(HP, MP) 루프 추가
// ★ 자동 회복(HP, MP) 루프
setInterval(() => {
  for (const id in players) {
    const p = players[id];
    if (!p || p.state === "dead") continue;

    p._regenTick = (p._regenTick || 0) + 1000; // ms 단위 누적
    if (!p.regenDelay) p.regenDelay = 8.0;
    const interval = Math.max(2000, p.regenDelay * 1000); // 최소 2초

    if (p._regenTick >= interval) {
      p._regenTick = 0;
      // HP 회복(최대치 초과 X)
      if (p.hp < p.maxHp) p.hp = Math.min(p.hp + 10, p.maxHp);
      // MP 회복(필요시)
      if (p.mp < p.maxMp) p.mp = Math.min(p.mp + 4, p.maxMp);

      io.to(id).emit("playerStats", p);
    }
  }
}, 1000); // 1초마다 체크





io.on("connection", (socket) => {
  // 플레이어 초기화(중앙에서 시작)
 players[socket.id] = {
  x: Math.random() * MAP_SIZE,
  y: Math.random() * MAP_SIZE, 
  dir: "right", 
  state: "idle", 
  frame: 0,
  level: 1, exp: 0,
  maxExp: expToNextLevel(1),
  statPoints: 0,
  statLevels: { hp:0, mp:0, str:0, int:0, vit:0, agi:0, luk:0, acc:0, aspd:0, mspd:0 },
  lastAttack: Date.now()
};
// 스탯 적용
applyStatsToPlayer(players[socket.id]);
// **체력/마나 만땅으로**
players[socket.id].hp = players[socket.id].maxHp;
players[socket.id].mp = players[socket.id].maxMp;


  function broadcastOnlineCount() {
  io.emit("onlineNum", Object.keys(players).length);
}

broadcastOnlineCount();

  socket.on("disconnect", () => {
    delete players[socket.id];
    broadcastOnlineCount();
    // ... (기존 코드)
  });

  socket.emit("initTrees", trees);
  const player = players[socket.id];
  
  // 기본공격 쿨타임 저장용
  players[socket.id].lastAttack = 0;


  // === 공격 처리 ===
  socket.on("attack", data => {
    const player = players[socket.id];
    if (!player) return;

    // ★ 쿨타임 체크(예: 0.3초)
    const now = Date.now();
    const BASIC_ATTACK_COOL = 1000; // 1초(300ms) 원하는 쿨로 변경!
    const attackCooldown = BASIC_ATTACK_COOL_BASE / player.aspd;

    if (now - player.lastAttack < attackCooldown) return;
    player.lastAttack = now;

    // ...기존 공격 처리 (화살 생성 등)
  
  if (!player) return;
  

  player.dir = data.dir || player.dir;

  
  // 공격 상태도 서버가 직접 세팅!
  player.state = "attack";
  player.frame = 0;
  player.animTimer = 0;
  
  // 화살을 서버에 등록 (for 판정)
  arrows.push({
  x: player.x,
  y: player.y + 2,
  vx: (data.mouseX - player.x) / Math.sqrt(Math.pow(data.mouseX - player.x, 2) + Math.pow(data.mouseY - (player.y + 2), 2)) * 22,
  vy: (data.mouseY - (player.y + 2)) / Math.sqrt(Math.pow(data.mouseX - player.x, 2) + Math.pow(data.mouseY - (player.y + 2), 2)) * 22,
  shooterId: socket.id,
  id: makeArrowId(),
  life: 700 // 이동 거리
  });


  // ==== 전체에게 브로드캐스트로 변경! ====
  io.emit("attackResult", {
    mouseX: data.mouseX,
    mouseY: data.mouseY,
    x: player.x,
    y: player.y,
    dir: player.dir,
    id: socket.id // 누가 쐈는지 추가
  });

  // 상태 갱신 브로드캐스트
  io.emit("players", players);
  io.to(socket.id).emit("playerStats", player);
});

 // 닉네임 저장 (클라에서 setname 받음)
  socket.on("setname", name => {
    if (!players[socket.id]) players[socket.id] = {};
    players[socket.id].name = name;
    socket.name = name; // socket 객체에도 저장!
    io.emit("players", players); // 닉네임 갱신 즉시 전체 전송
  });


  // io.on("connection", ...) 내부
socket.on("mpDown", amount => {
  const player = players[socket.id];
  if (!player) return;
  player.mp = Math.max(0, player.mp - amount);
  io.to(socket.id).emit("playerStats", player); // 갱신
});

// statLevels, statPoints를 서버에서만 관리!
socket.on("setStats", (newStats) => {
  const player = players[socket.id];
  if (!player) return;
  // 각 스탯 0이상 & 총합 제한
  let newTotal = 0, valid = true;
  for (let k in player.statLevels) {
    if (typeof newStats[k] !== "number" || newStats[k] < 0) valid = false;
    newTotal += newStats[k];
  }
  let oldTotal = 0; for (let k in player.statLevels) oldTotal += player.statLevels[k];
  let diff = newTotal - oldTotal;
  if (!valid || diff > player.statPoints) return; // 초과 분배 방지


   if (newStats.luk > 100) newStats.luk = 100;

  player.statPoints -= diff;
  player.statLevels = { ...newStats };



  applyStatsToPlayer(player); // 스탯 반영

    // === 회복 타이머 리셋! ===
  player._regenTick = 0;

  io.to(socket.id).emit("playerStats", player); // 최종값 내려줌
});


  // 채팅 이벤트
  socket.on("chat", (msg) => {
    const name = socket.name || players[socket.id]?.name || socket.id.slice(0, 8);
    io.emit("chat", { name, msg });
  });

  // 서버 내 전역 쿨타임 저장(플레이어별)
let playerSkillCooldowns = {}; // { [id]: {1:timestamp, 2:timestamp} }

socket.on("castSkill", data => {
  const p = players[socket.id];
  if (!p || p.state === "dead") return;
  if (!playerSkillCooldowns[socket.id]) playerSkillCooldowns[socket.id] = {1:0,2:0};
  const now = Date.now();
    p.dir = data.dir || p.dir;

    const SKILL1_COOL_BASE = 3000; // 7초 기본 쿨타임(ms)
    const SKILL2_COOL_BASE = 3000;


  // === 강격(1) ===
  if (data.skill === 1) {
    if (playerSkillCooldowns[socket.id][1] > now) return;
    playerSkillCooldowns[socket.id][1] = now + SKILL1_COOL_BASE / p.aspd;

    io.to(socket.id).emit("skillCooldown", {
    skill: 1,
    cooldownEnd: playerSkillCooldowns[socket.id][1] // 서버가 계산한 실제 종료 시간
  });

    if (p.mp < 20) return;
    p.mp -= 20;
    
    
     // [추가: 공격모션] =========================
    p.state = "attack";
    p.frame = 0;
    p.animTimer = 0;
    // ========================================

    // 커서 방향 벡터 구하기
    let dx = data.mouseX - p.x;
    let dy = data.mouseY - p.y;
    let baseAngle = Math.atan2(dy, dx);

    // 3연타: 0ms, 90ms, 180ms 후에 순차 발사
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        let vx = Math.cos(baseAngle) * 22;
        let vy = Math.sin(baseAngle) * 22;
        arrows.push({
          x: p.x,
          y: p.y,
          vx: vx,
          vy: vy,
          shooterId: socket.id,
          life: 1000, // 2배
          skill: 1
      
        });
        io.emit("attackResult", {
          mouseX: p.x + vx * 4, mouseY: p.y + vy * 4, // 도착점
          x: p.x, y: p.y, dir: data.dir, id: socket.id, skill: 1
        });
      }, i * 90);
    }
  }



  // === 우뢰샷(2) ===
  if (data.skill === 2) {
    if (playerSkillCooldowns[socket.id][2] > now) return;
    playerSkillCooldowns[socket.id][2] = now + SKILL2_COOL_BASE / p.aspd;

    io.to(socket.id).emit("skillCooldown", {
    skill: 2,
    cooldownEnd: playerSkillCooldowns[socket.id][2]
  });
    if (p.mp < 30) return;
    p.mp -= 30;
    

    // [추가: 공격모션] =========================
    p.state = "attack";
    p.frame = 0;
    p.animTimer = 0;
    // ========================================

    // 커서 방향 벡터
    let dx = data.mouseX - p.x;
    let dy = data.mouseY - p.y;
    let baseAngle = Math.atan2(dy, dx);

    // 부채꼴 3발: -20°, 0°, +20°
   let angles = [-40, -20, 0, 20, 40].map(d => baseAngle + (d * Math.PI) / 180);
    angles.forEach((a) => {
      let vx = Math.cos(a) * 22;
      let vy = Math.sin(a) * 22;
      arrows.push({
        x: p.x,
        y: p.y,
        vx: vx,
        vy: vy,
        shooterId: socket.id,
        life: 1000,
        skill: 2
      });
      io.emit("attackResult", {
        mouseX: p.x + vx * 4, mouseY: p.y + vy * 4, x: p.x, y: p.y, dir: data.dir, id: socket.id, skill: 2
      });
    });
  }
});



  // 유저 상태 동기화 요청
   socket.on("update", data => {
    const player = players[socket.id];
    if (!player) return;

     // === 사망 중엔 위치 갱신 금지! ===
  if (player.state === "dead") return;
  // 위치, 방향 갱신

    // 위치, 방향 갱신
    player.x = data.x;
    player.y = data.y;
    player.dir = data.dir || player.dir;


    // ===== [상태/프레임 전환 로직 추가!] =====
    // 공격 중/사망 중이면 상태/프레임을 건드리지 않음
    if (player.state !== "attack" && player.state !== "dead") {
      // 이동 중 판정
      let moved = data.moved || (Math.abs(data.x - (player._lx ?? data.x)) > 0.2 || Math.abs(data.y - (player._ly ?? data.y)) > 0.2);
      if (moved) {
        if (player.state !== "move") {
          player.state = "move";
          player.frame = 0;
          player.animTimer = 0;
        }
        // 애니메이션 프레임 전환 (이동)
        player.animTimer = (player.animTimer || 0) + 1;
        if (player.animTimer >= 4) {
          player.animTimer = 0;
          player.frame = (player.frame + 1) % 8;
        }
      } else {
        if (player.state !== "idle") {
          player.state = "idle";
          player.frame = 0;
          player.animTimer = 0;
        }
        // 아이들 애니메이션 (느리게)
        player.animTimer = (player.animTimer || 0) + 1;
        if (player.animTimer >= 10) {
          player.animTimer = 0;
          player.frame = (player.frame + 1) % 8;
        }
      }
    }
    // 최근 좌표 저장(다음 moved 판정에 활용)
    player._lx = data.x;
    player._ly = data.y;

    io.emit("players", players); // 전체에게 브로드캐스트
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("players", players);
  });


   // 경험치 구슬 요청 (초기, 이동 시)
  socket.on("requestOrbs", (pos) => {
    // 해당 위치 근처 구슬만 전송 (최대 80개)
    const nearOrbs = getOrbsNear(pos.x, pos.y, 1200).slice(0, 80);
    socket.emit("orbs", nearOrbs);
  });

  // 경험치 구슬 먹기 요청
  socket.on("pickupOrb", (orbId) => {
  const player = players[socket.id];
  const idx = orbs.findIndex(o => o.id === orbId);
  if (!player || idx === -1) return;

  // ★ 경험치 구슬 먹을 때 HP/MP 만땅!
  applyStatsToPlayer(player); // 혹시 스탯 반영 안 돼있을 수도 있으니
  player.hp = player.maxHp;
  player.mp = player.maxMp;

  // ★ 경험치 50 고정 획득
  player.exp = (player.exp || 0) + 50;

  // 렙업 및 만땅 처리(기존 유지)
  while (player.exp >= player.maxExp) {
    player.exp -= player.maxExp;
    player.level++;
    const stats = getPlayerStats(player.level);
    player.maxHp = stats.hp;
    player.maxMp = stats.mp;
    // statLevels 기반으로만 재계산!
    applyStatsToPlayer(player);
    player.hp = player.maxHp;
    player.mp = player.maxMp;
    player.maxExp = expToNextLevel(player.level);
    // atk, def 등 갱신
    player.atk = stats.atk;
    player.def = stats.def;
    player.range = stats.range;
    player.regen = stats.regen;
    player.statPoints = (player.statPoints || 0) + 1; // 기존 1포인트
  }

  // ★ (추가) 원래 구슬 먹을 때 마나 2 회복하던 부분은 삭제 또는 주석 처리
  // if (player.mp < player.maxMp) {
  //   player.mp = Math.min(player.mp + 2, player.maxMp);
  // }

  // 새로운 구슬 리젠(기존 코드 유지)
  orbs.splice(idx, 1);
  orbs.push({
    id: Date.now() + Math.floor(Math.random()*100000),
    x: Math.random() * MAP_SIZE,
    y: Math.random() * MAP_SIZE,
    value: Math.floor(Math.random() * 6) + 5 // value는 이제 안 써도 됨(혹시 다른 용도 있으면 남겨둠)
  });

  // 경험치/스탯 변경된 내 정보만 다시 내려주기!
  io.to(socket.id).emit("playerStats", player);
});



  socket.on("playerStats", (data) => {
  // 내 player 오브젝트에 덮어쓰기
  Object.assign(player, data);
});


  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("players", players);
  });



});



server.listen(PORT, () => {
  console.log("서버 스타트! http://localhost:"+PORT);
});
