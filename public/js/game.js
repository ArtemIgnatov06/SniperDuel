// Main game client: state management, client-side prediction, interpolation, render loop
const GAME_WIDTH = 1600;
const GAME_HEIGHT = 900;
const PLAYER_WIDTH = 20;
const PLAYER_HEIGHT = 28;
const BLOCK_SIZE = 32;

// Physics constants mirroring server
const GRAVITY_C = 1400;
const MAX_FALL_SPEED_C = 900;
const MOVE_SPEED_C = 260;
const JUMP_FORCE_C = 560;
const COYOTE_TIME_C = 0.1;
const SHOOT_COOLDOWN_C = 1.0;
const BLOCK_REGEN_TIME_C = 7.0;
const MAX_BLOCKS_C = 10;
const DASH_SPEED_C = 700;
const DASH_DURATION_C = 0.15;
const DASH_COOLDOWN_C = 5.0;

// Opponent interpolation delay — small buffer to smooth opponent movement
const INTERP_DELAY_MS = 50;

// Spawn Y must match server's floor block position exactly
const SPAWN_Y = Math.floor(GAME_HEIGHT / BLOCK_SIZE) * BLOCK_SIZE - BLOCK_SIZE - PLAYER_HEIGHT;

// Canvas setup
const canvas = document.getElementById('game-canvas');
const overlay = document.getElementById('overlay');
const overlayText = document.getElementById('overlay-text');
const newGameBtn = document.getElementById('new-game-btn');

function resizeCanvas() {
    const aspect = GAME_WIDTH / GAME_HEIGHT;
    let w = window.innerWidth;
    let h = window.innerHeight;
    if (w / h > aspect) {
        w = h * aspect;
    } else {
        h = w / aspect;
    }
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = GAME_WIDTH;
    canvas.height = GAME_HEIGHT;
    Input.setCanvasMetrics(canvas);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
Renderer.init(canvas);

// Game state
let myPlayerNum = null;
let gameState = 'waiting';
let scores = { 1: 0, 2: 0 };
let roundWinner = null;
let blocks = [];
let playerBlocks = [];

// --- Client-side prediction state (own player) ---
const localPlayer = {
    x: 0, y: 0,
    vx: 0, vy: 0,
    isOnGround: false,
    coyoteTimer: 0,
    facingRight: true,
    aimAngle: 0,
    alive: true,
    shootCooldown: 0,
    blockCount: MAX_BLOCKS_C,
    blockRegenTimer: 0,
    initialized: false,
};
let prevLocalJump = false;
let localDashCooldown = 0;
let localDashTimer = 0;
let localDashDirection = 1;

function clientRectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// Ray vs AABB — returns t of first intersection or null
function clientRayVsRect(ox, oy, dx, dy, rx, ry, rw, rh) {
    let tmin = -Infinity;
    let tmax = Infinity;
    if (Math.abs(dx) < 1e-8) {
        if (ox < rx || ox > rx + rw) return null;
    } else {
        const t1 = (rx - ox) / dx;
        const t2 = (rx + rw - ox) / dx;
        tmin = Math.max(tmin, Math.min(t1, t2));
        tmax = Math.min(tmax, Math.max(t1, t2));
    }
    if (Math.abs(dy) < 1e-8) {
        if (oy < ry || oy > ry + rh) return null;
    } else {
        const t1 = (ry - oy) / dy;
        const t2 = (ry + rh - oy) / dy;
        tmin = Math.max(tmin, Math.min(t1, t2));
        tmax = Math.min(tmax, Math.max(t1, t2));
    }
    if (tmax < 0 || tmin > tmax) return null;
    const t = tmin >= 0 ? tmin : tmax;
    return t >= 0 ? t : null;
}

// Show tracer immediately on client — stops at nearest block
function showClientTracer() {
    if (!localPlayer.initialized || !localPlayer.alive) return;
    const ox = localPlayer.x + PLAYER_WIDTH / 2 + (localPlayer.facingRight ? 14 : -14);
    const oy = localPlayer.y + PLAYER_HEIGHT / 2 - 10;
    const dx = Math.cos(localPlayer.aimAngle);
    const dy = Math.sin(localPlayer.aimAngle);

    let closestT = GAME_WIDTH * 2;
    for (const solid of [...blocks, ...playerBlocks]) {
        const t = clientRayVsRect(ox, oy, dx, dy, solid.x, solid.y, BLOCK_SIZE, BLOCK_SIZE);
        if (t !== null && t < closestT) closestT = t;
    }

    Renderer.addTracer(ox, oy, ox + dx * closestT, oy + dy * closestT);
}

// Immediately place local player at their spawn point without waiting for a server snapshot.
// Server snapshot will fine-correct if needed (>24px drift threshold).
function spawnLocalPlayer() {
    if (myPlayerNum === null) return;
    localPlayer.x = myPlayerNum === 1 ? 100 : GAME_WIDTH - 100 - PLAYER_WIDTH;
    localPlayer.y = SPAWN_Y;
    localPlayer.vx = 0;
    localPlayer.vy = 0;
    localPlayer.isOnGround = false;
    localPlayer.coyoteTimer = 0;
    localPlayer.alive = true;
    localPlayer.shootCooldown = 0;
    localPlayer.blockCount = MAX_BLOCKS_C;
    localPlayer.blockRegenTimer = 0;
    localPlayer.dashCooldown = 0;
    localPlayer.facingRight = myPlayerNum === 1;
    localPlayer.initialized = true;
    prevLocalJump = false;
    localDashCooldown = 0;
    localDashTimer = 0;
}

// Place block immediately on the client, send to server for authoritative confirmation.
// Server will send blockPlaced back — we replace the temp block with the real one by position.
let localBlockSeq = 0;
function optimisticPlaceBlock(bx, by) {
    // Same validation as server's tryPlaceBlock
    if (bx < BLOCK_SIZE || bx >= GAME_WIDTH - BLOCK_SIZE) return;
    if (by < 0 || by >= GAME_HEIGHT) return;
    const occupied = blocks.some(b => b.x === bx && b.y === by) ||
                     playerBlocks.some(b => b.x === bx && b.y === by);
    if (occupied) return;

    const tempId = `local_${++localBlockSeq}`;
    const tempBlock = { x: bx, y: by, id: tempId, placedBy: myPlayerNum };
    playerBlocks.push(tempBlock);
    localPlayer.blockCount--;
    Network.sendInput({ placeBlockAt: { x: bx, y: by } });

    // Remove the optimistic block if server doesn't confirm within 400ms (rejected)
    setTimeout(() => {
        const idx = playerBlocks.findIndex(b => b.id === tempId);
        if (idx !== -1) playerBlocks.splice(idx, 1);
    }, 400);
}

function tickLocalPlayer(dt) {
    if (!localPlayer.initialized || !localPlayer.alive || gameState !== 'playing') return;

    const input = Input.getCurrentInput();
    const mouse = Input.getMouseGameCoords();

    // Aim and facing
    const cx = localPlayer.x + PLAYER_WIDTH / 2;
    const cy = localPlayer.y + PLAYER_HEIGHT / 2;
    localPlayer.aimAngle = Math.atan2(mouse.y - cy, mouse.x - cx);
    localPlayer.facingRight = mouse.x >= cx;

    // Horizontal movement
    localPlayer.vx = 0;
    if (input.left) localPlayer.vx = -MOVE_SPEED_C;
    if (input.right) localPlayer.vx = MOVE_SPEED_C;

    // Gravity
    localPlayer.vy += GRAVITY_C * dt;
    if (localPlayer.vy > MAX_FALL_SPEED_C) localPlayer.vy = MAX_FALL_SPEED_C;

    // Coyote time
    if (localPlayer.isOnGround) {
        localPlayer.coyoteTimer = COYOTE_TIME_C;
    } else {
        localPlayer.coyoteTimer -= dt;
        if (localPlayer.coyoteTimer < 0) localPlayer.coyoteTimer = 0;
    }

    // Jump — edge-triggered on key press
    const jumpNow = input.jump;
    if (jumpNow && !prevLocalJump && localPlayer.coyoteTimer > 0) {
        localPlayer.vy = -JUMP_FORCE_C;
        localPlayer.coyoteTimer = 0;
    }
    prevLocalJump = jumpNow;

    // Special key actions (E, Q, Shift) — consumed once per frame
    const special = Input.consumeSpecialKeys();

    // Shift — dash in current facing direction
    if (special.shift && localDashCooldown <= 0) {
        localDashDirection = localPlayer.facingRight ? 1 : -1;
        localDashTimer = DASH_DURATION_C;
        localDashCooldown = DASH_COOLDOWN_C;
        Network.sendInput({ dash: true });
    }
    if (localDashCooldown > 0) {
        localDashCooldown -= dt;
        if (localDashCooldown < 0) localDashCooldown = 0;
    }
    localPlayer.dashCooldown = localDashCooldown;
    if (localDashTimer > 0) {
        localDashTimer -= dt;
        if (localDashTimer < 0) localDashTimer = 0;
        // Dash overrides horizontal velocity
        localPlayer.vx = localDashDirection * DASH_SPEED_C;
    }

    // E — place block directly below player feet.
    // Must use ceil so the block starts at or below player.bottom (no overlap).
    if (special.e && localPlayer.blockCount > 0) {
        const bx = Math.floor((localPlayer.x + PLAYER_WIDTH / 2) / BLOCK_SIZE) * BLOCK_SIZE;
        const by = Math.ceil((localPlayer.y + PLAYER_HEIGHT) / BLOCK_SIZE) * BLOCK_SIZE;
        optimisticPlaceBlock(bx, by);
    }

    // Q — place block in front of player.
    // Must use ceil (right) / floor-minus-one (left) so block is fully outside hitbox.
    if (special.q && localPlayer.blockCount > 0) {
        let bx;
        if (localPlayer.facingRight) {
            bx = Math.ceil((localPlayer.x + PLAYER_WIDTH) / BLOCK_SIZE) * BLOCK_SIZE;
        } else {
            bx = Math.floor(localPlayer.x / BLOCK_SIZE) * BLOCK_SIZE - BLOCK_SIZE;
        }
        const by = Math.floor((localPlayer.y + PLAYER_HEIGHT / 2) / BLOCK_SIZE) * BLOCK_SIZE;
        optimisticPlaceBlock(bx, by);
    }

    // Collision against all blocks
    const allSolids = [...blocks, ...playerBlocks];

    // Move X
    localPlayer.x += localPlayer.vx * dt;
    for (const solid of allSolids) {
        if (clientRectOverlap(localPlayer.x, localPlayer.y, PLAYER_WIDTH, PLAYER_HEIGHT, solid.x, solid.y, BLOCK_SIZE, BLOCK_SIZE)) {
            if (localPlayer.vx > 0) {
                localPlayer.x = solid.x - PLAYER_WIDTH;
            } else if (localPlayer.vx < 0) {
                localPlayer.x = solid.x + BLOCK_SIZE;
            }
            localPlayer.vx = 0;
        }
    }

    // Move Y
    localPlayer.y += localPlayer.vy * dt;
    localPlayer.isOnGround = false;
    for (const solid of allSolids) {
        if (clientRectOverlap(localPlayer.x, localPlayer.y, PLAYER_WIDTH, PLAYER_HEIGHT, solid.x, solid.y, BLOCK_SIZE, BLOCK_SIZE)) {
            if (localPlayer.vy > 0) {
                localPlayer.y = solid.y - PLAYER_HEIGHT;
                localPlayer.isOnGround = true;
            } else if (localPlayer.vy < 0) {
                localPlayer.y = solid.y + BLOCK_SIZE;
            }
            localPlayer.vy = 0;
        }
    }

    // Shoot cooldown
    if (localPlayer.shootCooldown > 0) {
        localPlayer.shootCooldown -= dt;
        if (localPlayer.shootCooldown < 0) localPlayer.shootCooldown = 0;
    }

    // Block regen
    if (localPlayer.blockCount < MAX_BLOCKS_C) {
        localPlayer.blockRegenTimer += dt;
        if (localPlayer.blockRegenTimer >= BLOCK_REGEN_TIME_C) {
            localPlayer.blockCount++;
            localPlayer.blockRegenTimer = 0;
        }
    } else {
        localPlayer.blockRegenTimer = 0;
    }
}

// Sync local player from server snapshot — correct drift, sync non-movement state
function syncLocalPlayerFromServer(sp) {
    if (!localPlayer.initialized) {
        localPlayer.x = sp.x;
        localPlayer.y = sp.y;
        localPlayer.vx = sp.vx || 0;
        localPlayer.vy = sp.vy || 0;
        localPlayer.isOnGround = false;
        localPlayer.coyoteTimer = 0;
        localPlayer.initialized = true;
    } else {
        // Correct position if server says we're somewhere very different
        // (e.g., respawn, or got pushed by something we didn't predict)
        const dx = Math.abs(localPlayer.x - sp.x);
        const dy = Math.abs(localPlayer.y - sp.y);
        if (dx > 24 || dy > 24) {
            localPlayer.x = sp.x;
            localPlayer.y = sp.y;
            localPlayer.vy = sp.vy || 0;
        }
    }

    // Always sync these from server (authoritative)
    localPlayer.alive = sp.alive;
    localPlayer.shootCooldown = sp.shootCooldown;
    localPlayer.blockCount = sp.blockCount;
    localPlayer.blockRegenTimer = sp.blockRegenTimer;
    localDashCooldown = sp.dashCooldown || 0;
    localPlayer.dashCooldown = localDashCooldown;
}

// --- Opponent snapshot buffer for interpolation ---
let snapshots = [];

function getOpponentInterpolated(now, opponentNum) {
    const renderTime = now - INTERP_DELAY_MS;

    let older = null;
    let newer = null;
    for (let i = 0; i < snapshots.length; i++) {
        if (snapshots[i].t <= renderTime) {
            older = snapshots[i];
        } else {
            newer = snapshots[i];
            break;
        }
    }

    if (!older && !newer) return null;
    if (!older) return newer.players ? newer.players[opponentNum] : null;
    if (!newer) return older.players ? older.players[opponentNum] : null;

    const np = newer.players ? newer.players[opponentNum] : null;
    const op = older.players ? older.players[opponentNum] : null;
    if (!np) return op;
    if (!op) return np;

    const totalDt = newer.t - older.t;
    const alpha = totalDt > 0 ? (renderTime - older.t) / totalDt : 1;

    return {
        x: op.x + (np.x - op.x) * alpha,
        y: op.y + (np.y - op.y) * alpha,
        aimAngle: np.aimAngle,
        facingRight: np.facingRight,
        shootCooldown: np.shootCooldown,
        blockCount: np.blockCount,
        blockRegenTimer: np.blockRegenTimer,
        alive: np.alive,
    };
}

function pruneSnapshots(now) {
    const cutoff = now - 1000;
    while (snapshots.length > 4 && snapshots[0].t < cutoff) {
        snapshots.shift();
    }
}

// Shoot: show tracer immediately on client, don't wait for server
Input.onShoot(() => {
    if (localPlayer.shootCooldown <= 0) {
        showClientTracer();
    }
});

// RMB block placement: optimistic like E/Q
Input.onRMB(({ mouseX, mouseY }) => {
    if (!localPlayer.initialized || !localPlayer.alive || localPlayer.blockCount <= 0) return;
    const px = localPlayer.x + PLAYER_WIDTH / 2;
    const py = localPlayer.y + PLAYER_HEIGHT / 2;
    const dist = Math.sqrt((mouseX - px) ** 2 + (mouseY - py) ** 2);
    if (dist > 150) return;
    const bx = Math.floor(mouseX / BLOCK_SIZE) * BLOCK_SIZE;
    const by = Math.floor(mouseY / BLOCK_SIZE) * BLOCK_SIZE;
    optimisticPlaceBlock(bx, by);
});

// --- Network events ---
Network.onJoined((data) => {
    myPlayerNum = data.playerNum;
    blocks = data.blocks;
    playerBlocks = data.playerBlocks;
    scores = data.scores;
    showWaitingMessage();
});

Network.onGameStart((data) => {
    blocks = data.blocks;
    playerBlocks = data.playerBlocks;
    scores = data.scores;
    gameState = 'playing';
    spawnLocalPlayer();
    hideOverlay();
    Input.startSending();
});

Network.onSnapshot((snapshot) => {
    snapshots.push(snapshot);
    pruneSnapshots(Date.now());

    gameState = snapshot.state;
    if (snapshot.scores) scores = snapshot.scores;
    if (snapshot.roundWinner !== undefined) roundWinner = snapshot.roundWinner;

    // Sync own player from server
    if (myPlayerNum && snapshot.players && snapshot.players[myPlayerNum]) {
        syncLocalPlayerFromServer(snapshot.players[myPlayerNum]);
    }
});

Network.onTracer((data) => {
    // Own tracer was already shown client-side — only show server tracer for opponent
    if (data.shooterNum !== myPlayerNum) {
        Renderer.addTracer(data.ox, data.oy, data.hx, data.hy);
    }
});

Network.onPlayerDied((data) => {
    Renderer.addDeathParticles(data.x, data.y, data.playerNum);
    if (data.playerNum === myPlayerNum) {
        localPlayer.alive = false;
    }
});

Network.onBlockPlaced((block) => {
    // Replace any optimistic local block at this position with the server's authoritative one.
    // This ensures the block has the real ID needed for future blockDestroyed lookups.
    const existingIndex = playerBlocks.findIndex(b => b.x === block.x && b.y === block.y);
    if (existingIndex !== -1) {
        playerBlocks[existingIndex] = block;
    } else {
        playerBlocks.push(block);
    }
});

Network.onBlockDestroyed((data) => {
    const bx = Math.floor(data.x / BLOCK_SIZE) * BLOCK_SIZE;
    const by = Math.floor(data.y / BLOCK_SIZE) * BLOCK_SIZE;
    Renderer.addBlockParticles(bx, by);
    blocks = blocks.filter(b => b.id !== data.id);
    playerBlocks = playerBlocks.filter(b => b.id !== data.id);
});

Network.onRoundReset((data) => {
    blocks = data.blocks;
    playerBlocks = data.playerBlocks;
    scores = data.scores;
    gameState = 'playing';
    roundWinner = null;
    snapshots = [];
    spawnLocalPlayer();
    hideOverlay();
});

Network.onOpponentDisconnected(() => {
    gameState = 'disconnected';
    Input.stopSending();
    showDisconnectedMessage();
});

Network.onRoomFull(() => {
    overlay.classList.remove('hidden');
    overlay.classList.add('active');
    overlayText.textContent = 'ROOM IS FULL';
    overlayText.style.color = '#ff5555';
    overlayText.style.fontSize = '18px';
});

// --- Overlay helpers ---
function showWaitingMessage() {
    const roomId = Network.roomId;
    const url = `${window.location.origin}/game.html?room=${roomId}`;
    overlay.classList.remove('hidden');
    overlay.classList.add('active');
    overlayText.style.color = '#aaaaaa';
    overlayText.style.fontSize = '12px';
    overlayText.innerHTML = `WAITING FOR OPPONENT...<br><br><span style="font-size:8px;color:#4af;">${url}</span>`;
    newGameBtn.textContent = 'COPY LINK';
    newGameBtn.style.display = 'block';
    newGameBtn.onclick = () => {
        navigator.clipboard.writeText(url).then(() => {
            newGameBtn.textContent = 'COPIED!';
            setTimeout(() => { newGameBtn.textContent = 'COPY LINK'; }, 2000);
        });
    };
}

function showDisconnectedMessage() {
    overlay.classList.remove('hidden');
    overlay.classList.add('active');
    overlayText.style.color = '#ff5555';
    overlayText.style.fontSize = '14px';
    overlayText.textContent = 'OPPONENT DISCONNECTED';
    newGameBtn.textContent = 'NEW GAME';
    newGameBtn.style.display = 'block';
    newGameBtn.onclick = () => { window.location.href = '/'; };
}

function hideOverlay() {
    overlay.classList.add('hidden');
    overlay.classList.remove('active');
    newGameBtn.style.display = 'none';
}

// --- Settings overlay ---
const settingsOverlay = document.getElementById('settings-overlay');
let settingsOpen = false;
let listeningForAction = null;

const ACTION_LABELS = {
    left:       'MOVE LEFT',
    right:      'MOVE RIGHT',
    jump:       'JUMP',
    placeBelow: 'BLOCK BELOW',
    placeFront: 'BLOCK FRONT',
    dash:       'DASH',
};

function keyDisplayName(key) {
    if (key === ' ')          return 'SPACE';
    if (key === 'shift')      return 'SHIFT';
    if (key === 'control')    return 'CTRL';
    if (key === 'alt')        return 'ALT';
    if (key === 'arrowleft')  return 'LEFT';
    if (key === 'arrowright') return 'RIGHT';
    if (key === 'arrowup')    return 'UP';
    if (key === 'arrowdown')  return 'DOWN';
    return key.toUpperCase();
}

function renderBindings() {
    const grid = document.getElementById('bindings-grid');
    const b = Input.getBindings();
    grid.innerHTML = '';
    for (const [action, label] of Object.entries(ACTION_LABELS)) {
        const row = document.createElement('div');
        row.className = 'binding-row';

        const lbl = document.createElement('span');
        lbl.className = 'binding-label';
        lbl.textContent = label;

        const btn = document.createElement('button');
        btn.className = 'binding-btn';
        if (action === listeningForAction) {
            btn.textContent = '...';
            btn.classList.add('listening');
        } else {
            btn.textContent = keyDisplayName(b[action]);
        }
        btn.addEventListener('click', () => {
            listeningForAction = action;
            renderBindings();
        });

        row.appendChild(lbl);
        row.appendChild(btn);
        grid.appendChild(row);
    }
}

function openSettings() {
    settingsOpen = true;
    listeningForAction = null;
    settingsOverlay.classList.remove('hidden');
    renderBindings();
    Input.stopSending();
}

function closeSettings() {
    settingsOpen = false;
    listeningForAction = null;
    settingsOverlay.classList.add('hidden');
    if (gameState === 'playing') Input.startSending();
}

Input.onEscape(() => {
    if (settingsOpen) {
        closeSettings();
    } else {
        openSettings();
    }
});

// Capture key for rebinding
window.addEventListener('keydown', (e) => {
    if (!settingsOpen || !listeningForAction) return;
    const key = e.key === ' ' ? ' ' : e.key.toLowerCase();
    if (key === 'escape') { closeSettings(); return; }
    e.preventDefault();
    Input.setBinding(listeningForAction, key);
    listeningForAction = null;
    renderBindings();
});

document.getElementById('reset-bindings-btn').addEventListener('click', () => {
    Input.resetBindings();
    listeningForAction = null;
    renderBindings();
});

document.getElementById('close-settings-btn').addEventListener('click', closeSettings);

// Click outside panel to close
settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) closeSettings();
});

// --- Render loop ---
let lastFrameTime = performance.now();
let roundEndOverlayShown = false;

function renderLoop(now) {
    requestAnimationFrame(renderLoop);

    const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
    lastFrameTime = now;

    // Run client-side prediction for own player
    tickLocalPlayer(dt);

    // Update visual effects
    Renderer.updateParticles(dt);
    Renderer.updateTracers(dt);

    // Get opponent state via interpolation
    const opponentNum = myPlayerNum === 1 ? 2 : 1;
    const opponentState = getOpponentInterpolated(now, opponentNum);

    // Round end overlay
    if (gameState === 'round_end' && roundWinner !== null && !roundEndOverlayShown) {
        roundEndOverlayShown = true;
        overlay.classList.remove('hidden');
        overlay.classList.add('active');
        const winnerName = roundWinner === 1 ? 'BLUE' : 'RED';
        const winnerColor = roundWinner === 1 ? '#4499ff' : '#ff5555';
        overlayText.style.color = winnerColor;
        overlayText.style.fontSize = '28px';
        overlayText.textContent = `${winnerName} WINS!`;
        newGameBtn.style.display = 'none';
    }
    if (gameState === 'playing') {
        roundEndOverlayShown = false;
    }

    // Draw
    Renderer.drawBackground();
    Renderer.drawBlocks(blocks, playerBlocks);

    // Own player — rendered from local prediction (zero latency)
    if (localPlayer.initialized) {
        Renderer.drawPlayer(localPlayer.x, localPlayer.y, myPlayerNum, localPlayer.facingRight, localPlayer.aimAngle, localPlayer.alive);
        Renderer.drawCooldownBar(localPlayer, myPlayerNum);
    }

    // Opponent — rendered from interpolated server state
    if (opponentState) {
        Renderer.drawPlayer(opponentState.x, opponentState.y, opponentNum, opponentState.facingRight, opponentState.aimAngle, opponentState.alive);
        Renderer.drawCooldownBar(opponentState, opponentNum);
    }

    Renderer.drawTracers();
    Renderer.drawParticles();

    // HUD
    const myHudState = localPlayer.initialized ? localPlayer : null;
    Renderer.drawHUD(myHudState, opponentState, scores, myPlayerNum);
}

requestAnimationFrame(renderLoop);
