// All canvas drawing logic
const Renderer = (() => {
    const GAME_WIDTH = 1600;
    const GAME_HEIGHT = 900;
    const BLOCK_SIZE = 32;
    const PLAYER_WIDTH = 20;
    const PLAYER_HEIGHT = 28;
    const MAX_BLOCKS = 10;
    const SHOOT_COOLDOWN = 1.0;
    const BLOCK_REGEN_TIME = 7.0;

    let canvas = null;
    let ctx = null;

    function init(c) {
        canvas = c;
        ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
    }

    // --- Sprite drawing ---

    function drawBlock(x, y, isPlayerPlaced) {
        // Base color
        if (isPlayerPlaced) {
            ctx.fillStyle = '#5a7a9a';
        } else {
            ctx.fillStyle = '#3a4a5a';
        }
        ctx.fillRect(x, y, BLOCK_SIZE, BLOCK_SIZE);

        // Highlight top-left
        ctx.fillStyle = isPlayerPlaced ? '#7aaaca' : '#5a7a9a';
        ctx.fillRect(x, y, BLOCK_SIZE, 2);
        ctx.fillRect(x, y, 2, BLOCK_SIZE);

        // Shadow bottom-right
        ctx.fillStyle = isPlayerPlaced ? '#2a4a6a' : '#1a2a3a';
        ctx.fillRect(x, y + BLOCK_SIZE - 2, BLOCK_SIZE, 2);
        ctx.fillRect(x + BLOCK_SIZE - 2, y, 2, BLOCK_SIZE);

        // Inner grid lines for texture
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(x + 8, y, 1, BLOCK_SIZE);
        ctx.fillRect(x + 16, y, 1, BLOCK_SIZE);
        ctx.fillRect(x + 24, y, 1, BLOCK_SIZE);
        ctx.fillRect(x, y + 8, BLOCK_SIZE, 1);
        ctx.fillRect(x, y + 16, BLOCK_SIZE, 1);
        ctx.fillRect(x, y + 24, BLOCK_SIZE, 1);
    }

    function drawFloorBlock(x, y) {
        ctx.fillStyle = '#2a3a2a';
        ctx.fillRect(x, y, BLOCK_SIZE, BLOCK_SIZE);
        ctx.fillStyle = '#3a5a3a';
        ctx.fillRect(x, y, BLOCK_SIZE, 3);
        ctx.fillStyle = '#1a2a1a';
        ctx.fillRect(x, y + BLOCK_SIZE - 1, BLOCK_SIZE, 1);
        // Dirt pattern
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        for (let i = 0; i < 4; i++) {
            ctx.fillRect(x + i * 8 + 2, y + 6, 3, 3);
            ctx.fillRect(x + i * 8 + 5, y + 14, 2, 2);
        }
    }

    function drawWallBlock(x, y) {
        ctx.fillStyle = '#1a1a2a';
        ctx.fillRect(x, y, BLOCK_SIZE, BLOCK_SIZE);
        ctx.fillStyle = '#2a2a3a';
        ctx.fillRect(x, y, 2, BLOCK_SIZE);
    }

    // Pixel-art Rambo-style player sprite
    // playerNum: 1=blue, 2=red; facingRight: bool; aimAngle: radians
    function drawPlayer(x, y, playerNum, facingRight, aimAngle, alive) {
        if (!alive) return;

        ctx.save();

        const cx = x + PLAYER_WIDTH / 2;
        const cy = y + PLAYER_HEIGHT / 2;

        // Flip horizontally if facing left
        if (!facingRight) {
            ctx.translate(cx, cy);
            ctx.scale(-1, 1);
            ctx.translate(-cx, -cy);
        }

        const bodyColor = playerNum === 1 ? '#2255aa' : '#aa2222';
        const bannerColor = playerNum === 1 ? '#4499ff' : '#ff5555';
        const skinColor = '#c8a87a';
        const pantsColor = playerNum === 1 ? '#113388' : '#881111';
        const bootColor = '#3a2a1a';

        const px = Math.round(x);
        const py = Math.round(y);

        // Boots (bottom)
        ctx.fillStyle = bootColor;
        ctx.fillRect(px + 2, py + 22, 7, 6);
        ctx.fillRect(px + 11, py + 22, 7, 6);

        // Pants
        ctx.fillStyle = pantsColor;
        ctx.fillRect(px + 3, py + 15, 6, 8);
        ctx.fillRect(px + 11, py + 15, 6, 8);

        // Belt
        ctx.fillStyle = '#5a3a1a';
        ctx.fillRect(px + 2, py + 14, 16, 2);

        // Torso
        ctx.fillStyle = bodyColor;
        ctx.fillRect(px + 2, py + 6, 16, 9);

        // Shoulder straps (Rambo)
        ctx.fillStyle = '#5a3a1a';
        ctx.fillRect(px + 6, py + 6, 2, 8);
        ctx.fillRect(px + 12, py + 6, 2, 8);

        // Head
        ctx.fillStyle = skinColor;
        ctx.fillRect(px + 5, py + 1, 10, 7);

        // Bandana
        ctx.fillStyle = bannerColor;
        ctx.fillRect(px + 5, py + 1, 10, 3);
        // Bandana tail
        ctx.fillRect(px + 14, py + 2, 4, 2);

        // Eye
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(px + 12, py + 4, 2, 2);

        // Now draw the rifle, rotated around shoulder
        ctx.restore();
        ctx.save();

        // Rifle pivot: at shoulder, approximately
        const pivotX = facingRight ? x + PLAYER_WIDTH - 2 : x + 2;
        const pivotY = y + 8;

        ctx.translate(pivotX, pivotY);

        // Adjust angle for flipped sprite
        let drawAngle = aimAngle;
        if (!facingRight) {
            // Mirror angle around vertical axis
            drawAngle = Math.PI - aimAngle;
        }

        ctx.rotate(drawAngle);

        // Rifle body: extends forward from pivot
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(0, -2, 22, 3);
        // Barrel
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(14, -1, 10, 2);
        // Stock
        ctx.fillStyle = '#5a3a1a';
        ctx.fillRect(-6, -2, 7, 4);
        // Scope
        ctx.fillStyle = '#3a3a4a';
        ctx.fillRect(6, -4, 8, 2);

        ctx.restore();
    }

    // --- Background ---
    function drawBackground() {
        // Night sky gradient (solid colors for pixel art)
        ctx.fillStyle = '#060612';
        ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

        // Stars
        ctx.fillStyle = '#ffffff';
        const starPositions = [
            [120, 40], [340, 80], [600, 30], [900, 60], [1100, 45],
            [1350, 70], [1480, 25], [200, 110], [750, 90], [1250, 100],
            [50, 150], [450, 130], [820, 20], [1050, 120], [1550, 55],
            [280, 65], [680, 140], [1400, 90], [960, 110], [130, 80],
        ];
        for (const [sx, sy] of starPositions) {
            ctx.fillRect(sx, sy, 1, 1);
            ctx.fillRect(sx + 2, sy + 1, 1, 1);
        }

        // Distant hills silhouette
        ctx.fillStyle = '#0d0d1f';
        ctx.beginPath();
        ctx.moveTo(0, GAME_HEIGHT);
        ctx.lineTo(0, 600);
        ctx.lineTo(150, 520);
        ctx.lineTo(300, 580);
        ctx.lineTo(500, 480);
        ctx.lineTo(700, 540);
        ctx.lineTo(900, 460);
        ctx.lineTo(1100, 530);
        ctx.lineTo(1300, 490);
        ctx.lineTo(1450, 560);
        ctx.lineTo(1600, 510);
        ctx.lineTo(GAME_WIDTH, GAME_HEIGHT);
        ctx.closePath();
        ctx.fill();
    }

    // --- Map blocks ---
    function drawBlocks(blocks, playerBlocks) {
        for (const block of blocks) {
            // Wall blocks (x=0 or far right) and floor
            if (block.id && (block.id.startsWith('wall_') || block.id.startsWith('floor_'))) {
                if (block.id.startsWith('floor_')) {
                    drawFloorBlock(block.x, block.y);
                } else {
                    drawWallBlock(block.x, block.y);
                }
            } else {
                drawBlock(block.x, block.y, false);
            }
        }
        for (const block of playerBlocks) {
            drawBlock(block.x, block.y, true);
        }
    }

    // --- Particles ---
    const particles = [];

    function addDeathParticles(x, y, playerNum) {
        const color = playerNum === 1 ? '#ff4444' : '#ff8844';
        for (let i = 0; i < 16; i++) {
            const angle = (i / 16) * Math.PI * 2;
            const speed = 80 + Math.random() * 160;
            particles.push({
                x: x + 10, y: y + 14,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 60,
                color,
                size: 2 + Math.floor(Math.random() * 3),
                life: 0.5 + Math.random() * 0.3,
                maxLife: 0.5 + Math.random() * 0.3,
            });
        }
    }

    function addBlockParticles(x, y) {
        for (let i = 0; i < 6; i++) {
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI;
            const speed = 60 + Math.random() * 120;
            particles.push({
                x: x + BLOCK_SIZE / 2,
                y: y + BLOCK_SIZE / 2,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                color: '#5a7a9a',
                size: 3 + Math.floor(Math.random() * 4),
                life: 0.4 + Math.random() * 0.2,
                maxLife: 0.4 + Math.random() * 0.2,
            });
        }
    }

    function addLandingDust(x, y) {
        for (let i = 0; i < 4; i++) {
            const dir = i < 2 ? -1 : 1;
            particles.push({
                x: x + PLAYER_WIDTH / 2,
                y: y + PLAYER_HEIGHT,
                vx: dir * (30 + Math.random() * 40),
                vy: -20 - Math.random() * 30,
                color: '#aaaaaa',
                size: 2,
                life: 0.25,
                maxLife: 0.25,
            });
        }
    }

    function updateParticles(dt) {
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 400 * dt;
            p.life -= dt;
            if (p.life <= 0) {
                particles.splice(i, 1);
            }
        }
    }

    function drawParticles() {
        for (const p of particles) {
            const alpha = p.life / p.maxLife;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            ctx.fillRect(Math.round(p.x - p.size / 2), Math.round(p.y - p.size / 2), p.size, p.size);
        }
        ctx.globalAlpha = 1;
    }

    // --- Tracers ---
    const tracers = [];

    function addTracer(ox, oy, hx, hy) {
        tracers.push({ ox, oy, hx, hy, life: 0.15, maxLife: 0.15 });
    }

    function updateTracers(dt) {
        for (let i = tracers.length - 1; i >= 0; i--) {
            tracers[i].life -= dt;
            if (tracers[i].life <= 0) tracers.splice(i, 1);
        }
    }

    function drawTracers() {
        for (const t of tracers) {
            const alpha = t.life / t.maxLife;
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(t.ox, t.oy);
            ctx.lineTo(t.hx, t.hy);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    // --- HUD ---
    function drawHUD(myState, opponentState, scores, myPlayerNum) {
        if (!myState) return;

        // Score top center
        ctx.font = '16px "Press Start 2P"';
        ctx.textAlign = 'center';
        const blueScore = scores[1] !== undefined ? scores[1] : 0;
        const redScore = scores[2] !== undefined ? scores[2] : 0;
        ctx.fillStyle = '#4499ff';
        ctx.fillText(blueScore, GAME_WIDTH / 2 - 40, 30);
        ctx.fillStyle = '#ffffff';
        ctx.fillText('—', GAME_WIDTH / 2, 30);
        ctx.fillStyle = '#ff5555';
        ctx.fillText(redScore, GAME_WIDTH / 2 + 40, 30);

        // Player HUD (bottom corners)
        const isPlayer1 = myPlayerNum === 1;
        const hudX = isPlayer1 ? 16 : GAME_WIDTH - 16 - (MAX_BLOCKS * 14 + 4);

        // Block icons
        for (let i = 0; i < MAX_BLOCKS; i++) {
            const filled = i < myState.blockCount;
            ctx.fillStyle = filled ? '#5a9adf' : '#2a3a4a';
            ctx.fillRect(hudX + i * 14, GAME_HEIGHT - 30, 12, 12);
            if (filled) {
                ctx.fillStyle = '#7abbff';
                ctx.fillRect(hudX + i * 14, GAME_HEIGHT - 30, 12, 2);
                ctx.fillRect(hudX + i * 14, GAME_HEIGHT - 30, 2, 12);
            }
        }

        // Block regen timer bar
        const regenW = MAX_BLOCKS * 14;
        const regenProgress = myState.blockCount < MAX_BLOCKS
            ? myState.blockRegenTimer / BLOCK_REGEN_TIME
            : 0;
        ctx.fillStyle = '#1a2a3a';
        ctx.fillRect(hudX, GAME_HEIGHT - 34, regenW, 3);
        ctx.fillStyle = '#4af';
        ctx.fillRect(hudX, GAME_HEIGHT - 34, Math.round(regenW * regenProgress), 3);

        // Dash cooldown bar
        const dashCooldown = myState.dashCooldown || 0;
        const dashW = regenW;
        const dashProgress = dashCooldown > 0 ? 1 - (dashCooldown / 5.0) : 1;
        ctx.fillStyle = '#1a1a2a';
        ctx.fillRect(hudX, GAME_HEIGHT - 50, dashW, 4);
        if (dashProgress >= 1) {
            ctx.fillStyle = '#ffdd44';
        } else {
            ctx.fillStyle = '#886600';
        }
        ctx.fillRect(hudX, GAME_HEIGHT - 50, Math.round(dashW * dashProgress), 4);

        // Label
        ctx.font = '6px "Press Start 2P"';
        ctx.textAlign = isPlayer1 ? 'left' : 'right';
        ctx.fillStyle = dashProgress >= 1 ? '#ffdd44' : '#555';
        const labelX = isPlayer1 ? hudX : hudX + dashW;
        ctx.fillText('DASH', labelX, GAME_HEIGHT - 53);
        ctx.textAlign = 'center';
    }

    function drawCooldownBar(playerState, myPlayerNum) {
        if (!playerState || !playerState.alive) return;
        const px = Math.round(playerState.x);
        const py = Math.round(playerState.y);
        const barW = 20;
        const progress = 1 - (playerState.shootCooldown / SHOOT_COOLDOWN);

        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(px, py + 30, barW, 3);
        if (progress < 1) {
            ctx.fillStyle = '#ff4444';
            ctx.fillRect(px, py + 30, Math.round(barW * progress), 3);
        } else {
            ctx.fillStyle = '#44ff44';
            ctx.fillRect(px, py + 30, barW, 3);
        }
    }

    // --- Waiting overlay ---
    function drawWaiting() {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        ctx.font = '16px "Press Start 2P"';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#aaaaaa';
        ctx.fillText('WAITING FOR OPPONENT...', GAME_WIDTH / 2, GAME_HEIGHT / 2);
    }

    // --- Round end overlay ---
    function drawRoundEnd(winner) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        ctx.font = '32px "Press Start 2P"';
        ctx.textAlign = 'center';
        ctx.fillStyle = winner === 1 ? '#4499ff' : '#ff5555';
        const name = winner === 1 ? 'BLUE WINS!' : 'RED WINS!';
        ctx.fillText(name, GAME_WIDTH / 2, GAME_HEIGHT / 2);
    }

    return {
        init,
        drawBackground,
        drawBlocks,
        drawPlayer,
        drawHUD,
        drawCooldownBar,
        drawWaiting,
        drawRoundEnd,
        addDeathParticles,
        addBlockParticles,
        addLandingDust,
        addTracer,
        updateParticles,
        drawParticles,
        updateTracers,
        drawTracers,
    };
})();
