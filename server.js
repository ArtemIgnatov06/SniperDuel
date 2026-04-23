const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/game', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

// --- Constants ---
const GAME_WIDTH = 1600;
const GAME_HEIGHT = 900;
const PLAYER_WIDTH = 20;
const PLAYER_HEIGHT = 28;
const BLOCK_SIZE = 32;
const GRAVITY = 1400;
const MAX_FALL_SPEED = 900;
const MOVE_SPEED = 260;
const JUMP_FORCE = 560;
const COYOTE_TIME = 0.1;
const SHOOT_COOLDOWN = 1.0;
const MAX_BLOCKS = 10;
const BLOCK_REGEN_TIME = 7.0;
const BLOCK_PLACE_RADIUS = 150;
const FLOOR_Y = GAME_HEIGHT - BLOCK_SIZE;
const DASH_SPEED = 700;
const DASH_DURATION = 0.15;
const DASH_COOLDOWN_TIME = 5.0;
const PHYSICS_TICK = 1 / 60;
const SNAPSHOT_RATE = 1 / 60;
const ROUND_END_PAUSE = 3.0;

// --- Map generation ---
function generateMap() {
    const blocks = [];
    const grid = new Set();
    const gridCols = Math.floor(GAME_WIDTH / BLOCK_SIZE);
    const gridRows = Math.floor(GAME_HEIGHT / BLOCK_SIZE);
    const floorRow = gridRows - 1;
    const midCol = Math.floor(gridCols / 2);

    // Floor
    for (let col = 0; col < gridCols; col++) {
        blocks.push({ x: col * BLOCK_SIZE, y: floorRow * BLOCK_SIZE, id: `floor_${col}` });
        grid.add(`${col},${floorRow}`);
    }

    // Left wall
    for (let row = 0; row < gridRows; row++) {
        blocks.push({ x: 0, y: row * BLOCK_SIZE, id: `wall_l_${row}` });
        grid.add(`0,${row}`);
    }

    // Right wall
    for (let row = 0; row < gridRows; row++) {
        blocks.push({ x: (gridCols - 1) * BLOCK_SIZE, y: row * BLOCK_SIZE, id: `wall_r_${row}` });
        grid.add(`${gridCols - 1},${row}`);
    }

    // Spawn clear zones: player1 at col~3, player2 at col~47 (mirrored)
    const spawn1Col = Math.floor(100 / BLOCK_SIZE);
    const spawn2Col = gridCols - 1 - spawn1Col;
    const spawnClearRadius = Math.ceil(80 / BLOCK_SIZE);

    function isNearSpawn(col, row) {
        const clearRows = [floorRow - 1, floorRow - 2];
        if (Math.abs(col - spawn1Col) <= spawnClearRadius && clearRows.includes(row)) return true;
        if (Math.abs(col - spawn2Col) <= spawnClearRadius && clearRows.includes(row)) return true;
        return false;
    }

    // Generate left half platforms, then mirror
    // Column range: 1 to midCol-1 (skip wall at 0)
    const leftCols = [];
    for (let col = 2; col < midCol; col++) {
        leftCols.push(col);
    }

    // Ground pillars: random columns get a pillar from floor up 1-3 blocks
    const pillarCount = 3 + Math.floor(Math.random() * 3);
    const shuffled = [...leftCols].sort(() => Math.random() - 0.5);

    for (let i = 0; i < Math.min(pillarCount, shuffled.length); i++) {
        const col = shuffled[i];
        const height = 1 + Math.floor(Math.random() * 3);
        for (let h = 1; h <= height; h++) {
            const row = floorRow - h;
            if (!isNearSpawn(col, row) && !grid.has(`${col},${row}`)) {
                const id = `gen_${col}_${row}`;
                blocks.push({ x: col * BLOCK_SIZE, y: row * BLOCK_SIZE, id });
                grid.add(`${col},${row}`);
                // Mirror
                const mirrorCol = gridCols - 1 - col;
                const mirrorId = `gen_${mirrorCol}_${row}`;
                if (!grid.has(`${mirrorCol},${row}`)) {
                    blocks.push({ x: mirrorCol * BLOCK_SIZE, y: row * BLOCK_SIZE, id: mirrorId });
                    grid.add(`${mirrorCol},${row}`);
                }
            }
        }
    }

    // Floating platforms: 4-6 platforms of 2-4 blocks wide at various heights
    const platformCount = 4 + Math.floor(Math.random() * 3);
    const usedCols = new Set();

    for (let p = 0; p < platformCount; p++) {
        const width = 2 + Math.floor(Math.random() * 3);
        const row = 4 + Math.floor(Math.random() * (floorRow - 6));
        // Pick start col in left half, not too close to wall
        let startCol = 2 + Math.floor(Math.random() * (midCol - width - 2));

        // Avoid overlapping with already placed platforms in same row
        let conflict = false;
        for (let w = 0; w < width; w++) {
            if (usedCols.has(`${startCol + w},${row}`)) {
                conflict = true;
                break;
            }
        }
        if (conflict) continue;

        let placed = false;
        for (let w = 0; w < width; w++) {
            const col = startCol + w;
            if (col >= midCol) break;
            if (isNearSpawn(col, row)) break;
            if (grid.has(`${col},${row}`)) break;

            const id = `plat_${col}_${row}`;
            blocks.push({ x: col * BLOCK_SIZE, y: row * BLOCK_SIZE, id });
            grid.add(`${col},${row}`);
            usedCols.add(`${col},${row}`);
            placed = true;

            // Mirror
            const mirrorCol = gridCols - 1 - col;
            const mirrorId = `plat_${mirrorCol}_${row}`;
            if (!grid.has(`${mirrorCol},${row}`)) {
                blocks.push({ x: mirrorCol * BLOCK_SIZE, y: row * BLOCK_SIZE, id: mirrorId });
                grid.add(`${mirrorCol},${row}`);
            }
        }
    }

    return blocks;
}

// --- Player factory ---
function createPlayer(id, playerNum) {
    return {
        id,
        playerNum,
        x: playerNum === 1 ? 100 : GAME_WIDTH - 100 - PLAYER_WIDTH,
        y: FLOOR_Y - PLAYER_HEIGHT,
        vx: 0,
        vy: 0,
        isOnGround: false,
        coyoteTimer: 0,
        aimAngle: 0,
        facingRight: playerNum === 1,
        shootCooldown: 0,
        blockCount: MAX_BLOCKS,
        blockRegenTimer: 0,
        alive: true,
        dashCooldown: 0,
        dashTimer: 0,
        dashDirection: 1,
        input: {
            left: false,
            right: false,
            jump: false,
            jumpPressed: false,
            mouseX: 0,
            mouseY: 0,
            shoot: false,
            placeBlock: false,
            placeBlockAt: null,
            dash: false,
        }
    };
}

// --- Room management ---
const rooms = new Map();

function generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 6; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
}

function getOrCreateRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            id: roomId,
            players: {},
            blocks: generateMap(),
            playerBlocks: [],
            state: 'waiting',
            scores: { 1: 0, 2: 0 },
            roundEndTimer: 0,
            roundWinner: null,
            physicsAccum: 0,
            snapshotAccum: 0,
            lastTime: Date.now(),
        });
    }
    return rooms.get(roomId);
}

// --- AABB collision helpers ---
function rectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function getPlayerBlocking(room) {
    // Returns all solid rects: static blocks + player-placed blocks
    const all = [];
    for (const block of room.blocks) {
        all.push({ x: block.x, y: block.y, w: BLOCK_SIZE, h: BLOCK_SIZE, id: block.id, destructible: false });
    }
    for (const block of room.playerBlocks) {
        all.push({ x: block.x, y: block.y, w: BLOCK_SIZE, h: BLOCK_SIZE, id: block.id, destructible: true });
    }
    return all;
}

function movePlayerWithCollision(player, dx, dy, solids) {
    // Move X
    player.x += dx;
    for (const solid of solids) {
        if (rectOverlap(player.x, player.y, PLAYER_WIDTH, PLAYER_HEIGHT, solid.x, solid.y, solid.w, solid.h)) {
            if (dx > 0) {
                player.x = solid.x - PLAYER_WIDTH;
            } else if (dx < 0) {
                player.x = solid.x + solid.w;
            }
            player.vx = 0;
        }
    }

    // Move Y
    player.y += dy;
    player.isOnGround = false;
    for (const solid of solids) {
        if (rectOverlap(player.x, player.y, PLAYER_WIDTH, PLAYER_HEIGHT, solid.x, solid.y, solid.w, solid.h)) {
            if (dy > 0) {
                player.y = solid.y - PLAYER_HEIGHT;
                player.isOnGround = true;
            } else if (dy < 0) {
                player.y = solid.y + solid.h;
            }
            player.vy = 0;
        }
    }
}

// --- Hitscan ---
function performHitscan(room, shooter, targetPlayer) {
    const gunOffsetX = shooter.facingRight ? 14 : -14;
    const gunOffsetY = -10;
    const originX = shooter.x + PLAYER_WIDTH / 2 + gunOffsetX;
    const originY = shooter.y + PLAYER_HEIGHT / 2 + gunOffsetY;

    const dx = Math.cos(shooter.aimAngle);
    const dy = Math.sin(shooter.aimAngle);

    // Check all solids and the target player along the ray
    let closestT = Infinity;
    let hitType = null;
    let hitBlockId = null;

    const solids = getPlayerBlocking(room);

    // Check target player
    const targetCenterX = targetPlayer.x + PLAYER_WIDTH / 2;
    const targetCenterY = targetPlayer.y + PLAYER_HEIGHT / 2;
    const tPlayer = rayVsRect(originX, originY, dx, dy, targetPlayer.x, targetPlayer.y, PLAYER_WIDTH, PLAYER_HEIGHT);
    if (tPlayer !== null && tPlayer < closestT) {
        closestT = tPlayer;
        hitType = 'player';
    }

    // Check blocks
    for (const solid of solids) {
        const t = rayVsRect(originX, originY, dx, dy, solid.x, solid.y, solid.w, solid.h);
        if (t !== null && t < closestT) {
            closestT = t;
            hitType = 'block';
            hitBlockId = solid.id;
        }
    }

    const hitX = originX + dx * (closestT === Infinity ? GAME_WIDTH * 2 : closestT);
    const hitY = originY + dy * (closestT === Infinity ? GAME_WIDTH * 2 : closestT);

    return { hitType, hitBlockId, originX, originY, hitX, hitY };
}

function rayVsRect(ox, oy, dx, dy, rx, ry, rw, rh) {
    // Slab method
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
    if (t < 0) return null;
    return t;
}

// --- Round reset ---
function resetRound(room) {
    room.blocks = generateMap();
    room.playerBlocks = [];
    room.roundEndTimer = 0;
    room.roundWinner = null;
    room.state = 'playing';

    for (const socketId in room.players) {
        const player = room.players[socketId];
        player.x = player.playerNum === 1 ? 100 : GAME_WIDTH - 100 - PLAYER_WIDTH;
        player.y = FLOOR_Y - PLAYER_HEIGHT;
        player.vx = 0;
        player.vy = 0;
        player.isOnGround = false;
        player.coyoteTimer = 0;
        player.shootCooldown = 0;
        player.blockCount = MAX_BLOCKS;
        player.blockRegenTimer = 0;
        player.alive = true;
        player.facingRight = player.playerNum === 1;
        player.dashCooldown = 0;
        player.dashTimer = 0;
        player.dashDirection = 1;
    }
}

// --- Physics tick ---
function tickPhysics(room, dt) {
    const solids = getPlayerBlocking(room);

    for (const socketId in room.players) {
        const player = room.players[socketId];
        if (!player.alive) continue;

        const input = player.input;

        // Aim angle
        const dx = input.mouseX - (player.x + PLAYER_WIDTH / 2);
        const dy = input.mouseY - (player.y + PLAYER_HEIGHT / 2);
        player.aimAngle = Math.atan2(dy, dx);

        // Facing direction
        player.facingRight = input.mouseX >= player.x + PLAYER_WIDTH / 2;

        // Horizontal movement
        player.vx = 0;
        if (input.left) player.vx = -MOVE_SPEED;
        if (input.right) player.vx = MOVE_SPEED;

        // Gravity
        player.vy += GRAVITY * dt;
        if (player.vy > MAX_FALL_SPEED) player.vy = MAX_FALL_SPEED;

        // Coyote time
        if (player.isOnGround) {
            player.coyoteTimer = COYOTE_TIME;
        } else {
            player.coyoteTimer -= dt;
            if (player.coyoteTimer < 0) player.coyoteTimer = 0;
        }

        // Jump
        if (input.jumpPressed && player.coyoteTimer > 0) {
            player.vy = -JUMP_FORCE;
            player.coyoteTimer = 0;
        }
        input.jumpPressed = false;

        // Dash overrides horizontal velocity during active dash
        if (player.dashTimer > 0) {
            player.dashTimer -= dt;
            if (player.dashTimer < 0) player.dashTimer = 0;
            player.vx = player.dashDirection * DASH_SPEED;
        }
        if (player.dashCooldown > 0) {
            player.dashCooldown -= dt;
            if (player.dashCooldown < 0) player.dashCooldown = 0;
        }

        // Move with collision
        movePlayerWithCollision(player, player.vx * dt, player.vy * dt, solids);

        // Block regen
        if (player.blockCount < MAX_BLOCKS) {
            player.blockRegenTimer += dt;
            if (player.blockRegenTimer >= BLOCK_REGEN_TIME) {
                player.blockCount++;
                player.blockRegenTimer = 0;
            }
        } else {
            player.blockRegenTimer = 0;
        }

        // Shoot cooldown
        if (player.shootCooldown > 0) {
            player.shootCooldown -= dt;
            if (player.shootCooldown < 0) player.shootCooldown = 0;
        }
    }
}

// --- Process inputs (shoot/place) ---
function processActions(room) {
    const playerList = Object.values(room.players);
    if (playerList.length < 2) return;

    const [p1, p2] = playerList[0].playerNum === 1
        ? [playerList[0], playerList[1]]
        : [playerList[1], playerList[0]];

    for (const socketId in room.players) {
        const player = room.players[socketId];
        if (!player.alive) continue;

        const input = player.input;
        const opponent = player.playerNum === 1 ? p2 : p1;

        // Dash
        if (input.dash && player.dashCooldown <= 0) {
            player.dashTimer = DASH_DURATION;
            player.dashDirection = player.facingRight ? 1 : -1;
            player.dashCooldown = DASH_COOLDOWN_TIME;
        }
        input.dash = false;

        // Shoot
        if (input.shoot && player.shootCooldown <= 0) {
            player.shootCooldown = SHOOT_COOLDOWN;

            if (opponent && opponent.alive) {
                const result = performHitscan(room, player, opponent);

                io.to(room.id).emit('tracer', {
                    ox: result.originX, oy: result.originY,
                    hx: result.hitX, hy: result.hitY,
                    shooterNum: player.playerNum
                });

                if (result.hitType === 'player') {
                    opponent.alive = false;
                    room.state = 'round_end';
                    room.roundWinner = player.playerNum;
                    room.scores[player.playerNum]++;
                    room.roundEndTimer = ROUND_END_PAUSE;
                    io.to(room.id).emit('playerDied', {
                        playerNum: opponent.playerNum,
                        x: opponent.x, y: opponent.y
                    });
                } else if (result.hitType === 'block') {
                    // Floor and wall blocks are indestructible
                    const indestructible = result.hitBlockId.startsWith('floor_') ||
                                          result.hitBlockId.startsWith('wall_');
                    if (!indestructible) {
                        room.blocks = room.blocks.filter(b => b.id !== result.hitBlockId);
                        room.playerBlocks = room.playerBlocks.filter(b => b.id !== result.hitBlockId);
                        io.to(room.id).emit('blockDestroyed', {
                            id: result.hitBlockId, x: result.hitX, y: result.hitY
                        });
                    }
                }
            }
        }
        input.shoot = false;

        // Place block via mouse (RMB)
        if (input.placeBlock) {
            input.placeBlock = false;
            if (player.blockCount > 0) {
                const mx = input.mouseX;
                const my = input.mouseY;
                const dist = Math.sqrt(
                    (mx - (player.x + PLAYER_WIDTH / 2)) ** 2 +
                    (my - (player.y + PLAYER_HEIGHT / 2)) ** 2
                );
                if (dist <= BLOCK_PLACE_RADIUS) {
                    tryPlaceBlock(room, player, socketId,
                        Math.floor(mx / BLOCK_SIZE) * BLOCK_SIZE,
                        Math.floor(my / BLOCK_SIZE) * BLOCK_SIZE);
                }
            }
        }

        // Place block at specific position (E/Q keys)
        if (input.placeBlockAt) {
            const { x: bx, y: by } = input.placeBlockAt;
            input.placeBlockAt = null;
            if (player.blockCount > 0) {
                tryPlaceBlock(room, player, socketId, bx, by);
            }
        }
    }
}

function tryPlaceBlock(room, player, socketId, bx, by) {
    // Clamp to valid grid inside walls
    if (bx < BLOCK_SIZE || bx >= GAME_WIDTH - BLOCK_SIZE) return;
    if (by < 0 || by >= GAME_HEIGHT) return;

    const occupied = [...room.blocks, ...room.playerBlocks].some(b => b.x === bx && b.y === by);
    if (occupied) return;

    let overlapsPlayer = false;
    for (const sid in room.players) {
        const p = room.players[sid];
        if (rectOverlap(bx, by, BLOCK_SIZE, BLOCK_SIZE, p.x, p.y, PLAYER_WIDTH, PLAYER_HEIGHT)) {
            overlapsPlayer = true;
            break;
        }
    }
    if (overlapsPlayer) return;

    const newBlock = {
        x: bx, y: by,
        id: `pb_${socketId}_${Date.now()}`,
        placedBy: player.playerNum
    };
    room.playerBlocks.push(newBlock);
    player.blockCount--;
    player.blockRegenTimer = 0;
    io.to(room.id).emit('blockPlaced', newBlock);
}

// --- Game loop ---
function gameLoop() {
    const now = Date.now();

    for (const [roomId, room] of rooms) {
        if (room.state === 'waiting') continue;

        const dt = (now - room.lastTime) / 1000;
        room.lastTime = now;

        if (room.state === 'round_end') {
            room.roundEndTimer -= dt;
            if (room.roundEndTimer <= 0) {
                resetRound(room);
                io.to(roomId).emit('roundReset', {
                    blocks: room.blocks,
                    playerBlocks: room.playerBlocks,
                    scores: room.scores,
                });
            }
            // Still send snapshot during round end for death animations
        }

        if (room.state === 'playing') {
            room.physicsAccum += dt;
            while (room.physicsAccum >= PHYSICS_TICK) {
                processActions(room);
                tickPhysics(room, PHYSICS_TICK);
                room.physicsAccum -= PHYSICS_TICK;
            }
        }

        // Snapshots at 30Hz
        room.snapshotAccum += dt;
        if (room.snapshotAccum >= SNAPSHOT_RATE) {
            room.snapshotAccum = 0;

            const snapshot = {
                t: now,
                state: room.state,
                roundWinner: room.roundWinner,
                roundEndTimer: room.roundEndTimer,
                scores: room.scores,
                players: {},
            };

            for (const socketId in room.players) {
                const p = room.players[socketId];
                snapshot.players[p.playerNum] = {
                    x: p.x, y: p.y,
                    vx: p.vx, vy: p.vy,
                    aimAngle: p.aimAngle,
                    facingRight: p.facingRight,
                    shootCooldown: p.shootCooldown,
                    blockCount: p.blockCount,
                    blockRegenTimer: p.blockRegenTimer,
                    dashCooldown: p.dashCooldown,
                    alive: p.alive,
                };
            }

            io.to(roomId).emit('snapshot', snapshot);
        }
    }

}

setInterval(() => {
    const now = Date.now();
    for (const [roomId, room] of rooms) {
        if (room.state === 'waiting') {
            room.lastTime = now;
        }
    }
    gameLoop();
}, 1000 / 60);

// --- Socket.io ---
io.on('connection', (socket) => {
    let currentRoomId = null;
    let playerNum = null;

    socket.on('createRoom', () => {
        let roomId = generateRoomId();
        while (rooms.has(roomId)) roomId = generateRoomId();
        socket.emit('roomCreated', { roomId });
    });

    socket.on('joinRoom', ({ roomId }) => {
        const room = getOrCreateRoom(roomId);

        const playerCount = Object.keys(room.players).length;
        if (playerCount >= 2) {
            socket.emit('roomFull');
            return;
        }

        playerNum = playerCount === 0 ? 1 : 2;
        currentRoomId = roomId;
        room.lastTime = Date.now();

        room.players[socket.id] = createPlayer(socket.id, playerNum);
        socket.join(roomId);

        socket.emit('joined', {
            playerNum,
            roomId,
            blocks: room.blocks,
            playerBlocks: room.playerBlocks,
            scores: room.scores,
        });

        if (Object.keys(room.players).length === 2) {
            room.state = 'playing';
            io.to(roomId).emit('gameStart', {
                blocks: room.blocks,
                playerBlocks: room.playerBlocks,
                scores: room.scores,
            });
        }
    });

    socket.on('input', (data) => {
        if (!currentRoomId) return;
        const room = rooms.get(currentRoomId);
        if (!room) return;
        const player = room.players[socket.id];
        if (!player) return;

        const input = player.input;
        if (data.left !== undefined) input.left = data.left;
        if (data.right !== undefined) input.right = data.right;
        if (data.jump !== undefined) {
            if (data.jump && !input.jump) input.jumpPressed = true;
            input.jump = data.jump;
        }
        if (data.mouseX !== undefined) input.mouseX = data.mouseX;
        if (data.mouseY !== undefined) input.mouseY = data.mouseY;
        if (data.shoot) input.shoot = true;
        if (data.placeBlock) input.placeBlock = true;
        if (data.dash) input.dash = true;
        if (data.placeBlockAt) input.placeBlockAt = data.placeBlockAt;
    });

    socket.on('disconnect', () => {
        if (!currentRoomId) return;
        const room = rooms.get(currentRoomId);
        if (!room) return;

        delete room.players[socket.id];
        io.to(currentRoomId).emit('opponentDisconnected');

        if (Object.keys(room.players).length === 0) {
            rooms.delete(currentRoomId);
        } else {
            room.state = 'waiting';
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sniper Duel server running on http://localhost:${PORT}`);
});
