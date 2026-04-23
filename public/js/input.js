// Captures keyboard and mouse input, sends to server
const Input = (() => {
    const keys = {};
    let mouseX = 0;
    let mouseY = 0;
    let myPlayerNum = null;

    // Canvas scale — set by game.js once canvas is sized
    let scaleX = 1;
    let scaleY = 1;
    let canvasOffsetX = 0;
    let canvasOffsetY = 0;

    const GAME_WIDTH = 1600;
    const GAME_HEIGHT = 900;

    // Track previous state to send deltas
    const prevState = {
        left: false, right: false, jump: false,
        mouseX: 0, mouseY: 0,
    };

    // Pending one-shot events (set by event listeners, consumed by send loop or game.js)
    let shootPending = false;
    let placeBlockPending = false;
    let jumpPending = false;
    let eKeyPending = false;
    let qKeyPending = false;
    let shiftPending = false;
    let onShootCallback = null;
    let onRMBCallback = null;

    function setCanvasMetrics(canvas) {
        const rect = canvas.getBoundingClientRect();
        scaleX = GAME_WIDTH / rect.width;
        scaleY = GAME_HEIGHT / rect.height;
        canvasOffsetX = rect.left;
        canvasOffsetY = rect.top;
    }

    function toGameCoords(clientX, clientY) {
        return {
            x: (clientX - canvasOffsetX) * scaleX,
            y: (clientY - canvasOffsetY) * scaleY,
        };
    }

    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        if (key === ' ' || key === 'w') {
            e.preventDefault();
            jumpPending = true;
        }
        if (key === 'e') eKeyPending = true;
        if (key === 'q') qKeyPending = true;
        if (key === 'shift') shiftPending = true;
        keys[key] = true;
    });

    window.addEventListener('keyup', (e) => {
        keys[e.key.toLowerCase()] = false;
    });

    window.addEventListener('mousemove', (e) => {
        const coords = toGameCoords(e.clientX, e.clientY);
        mouseX = coords.x;
        mouseY = coords.y;
    });

    window.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (e.button === 0) {
            shootPending = true;
            if (onShootCallback) onShootCallback();
        }
        if (e.button === 2) {
            placeBlockPending = true;
            if (onRMBCallback) onRMBCallback({ mouseX, mouseY });
        }
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());

    let sendInterval = null;

    function startSending() {
        if (sendInterval) return;

        sendInterval = setInterval(() => {
            const left = !!(keys['a']);
            const right = !!(keys['d']);
            const jump = !!(keys[' '] || keys['w']);

            const delta = {};

            if (left !== prevState.left) {
                delta.left = left;
                prevState.left = left;
            }
            if (right !== prevState.right) {
                delta.right = right;
                prevState.right = right;
            }
            if (jump !== prevState.jump) {
                delta.jump = jump;
                prevState.jump = jump;
            }
            if (jumpPending) {
                delta.jump = true;
                jumpPending = false;
            }
            if (Math.abs(mouseX - prevState.mouseX) > 0.5 || Math.abs(mouseY - prevState.mouseY) > 0.5) {
                delta.mouseX = mouseX;
                delta.mouseY = mouseY;
                prevState.mouseX = mouseX;
                prevState.mouseY = mouseY;
            }
            if (shootPending) {
                delta.shoot = true;
                shootPending = false;
            }
            if (placeBlockPending) {
                delta.placeBlock = true;
                placeBlockPending = false;
            }

            if (Object.keys(delta).length > 0) {
                Network.sendInput(delta);
            }
        }, 1000 / 60);
    }

    function stopSending() {
        if (sendInterval) {
            clearInterval(sendInterval);
            sendInterval = null;
        }
    }

    return {
        setCanvasMetrics,
        startSending,
        stopSending,
        getMouseGameCoords() { return { x: mouseX, y: mouseY }; },
        getCurrentInput() {
            return {
                left: !!(keys['a']),
                right: !!(keys['d']),
                jump: !!(keys[' '] || keys['w']),
            };
        },
        onShoot(fn) { onShootCallback = fn; },
        onRMB(fn) { onRMBCallback = fn; },
        // Called once per frame from game.js to get and clear one-shot special keys
        consumeSpecialKeys() {
            const result = { e: eKeyPending, q: qKeyPending, shift: shiftPending };
            eKeyPending = false;
            qKeyPending = false;
            shiftPending = false;
            return result;
        },
    };
})();
