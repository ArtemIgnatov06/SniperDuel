// Captures keyboard and mouse input, sends to server
const Input = (() => {
    const keys = {};
    let mouseX = 0;
    let mouseY = 0;

    // Canvas scale
    let scaleX = 1;
    let scaleY = 1;
    let canvasOffsetX = 0;
    let canvasOffsetY = 0;

    const GAME_WIDTH = 1600;
    const GAME_HEIGHT = 900;

    // --- Key bindings ---
    const DEFAULT_BINDINGS = {
        left:        'a',
        right:       'd',
        jump:        ' ',
        placeBelow:  'e',
        placeFront:  'q',
        dash:        'shift',
    };

    function loadBindings() {
        try {
            const saved = localStorage.getItem('sniperDuelBindings');
            if (saved) return { ...DEFAULT_BINDINGS, ...JSON.parse(saved) };
        } catch (e) {}
        return { ...DEFAULT_BINDINGS };
    }

    function saveBindings() {
        localStorage.setItem('sniperDuelBindings', JSON.stringify(bindings));
    }

    let bindings = loadBindings();

    // --- State ---
    const prevState = { left: false, right: false, jump: false, mouseX: 0, mouseY: 0 };

    let shootPending = false;
    let placeBlockPending = false;
    let jumpPending = false;
    let eKeyPending = false;
    let qKeyPending = false;
    let shiftPending = false;

    let onShootCallback = null;
    let onRMBCallback = null;
    let onEscapeCallback = null;

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
        const key = e.key === ' ' ? ' ' : e.key.toLowerCase();

        if (key === 'escape') {
            if (onEscapeCallback) onEscapeCallback();
            return;
        }

        // Prevent scroll/default for game keys
        if (key === ' ' || key === bindings.jump) e.preventDefault();

        keys[key] = true;

        if (key === bindings.jump || key === 'w') {
            jumpPending = true;
        }
        if (key === bindings.placeBelow) eKeyPending = true;
        if (key === bindings.placeFront) qKeyPending = true;
        if (key === bindings.dash) shiftPending = true;
    });

    window.addEventListener('keyup', (e) => {
        const key = e.key === ' ' ? ' ' : e.key.toLowerCase();
        keys[key] = false;
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
            const left = !!(keys[bindings.left]);
            const right = !!(keys[bindings.right]);
            const jump = !!(keys[bindings.jump] || keys['w']);

            const delta = {};

            if (left !== prevState.left) { delta.left = left; prevState.left = left; }
            if (right !== prevState.right) { delta.right = right; prevState.right = right; }
            if (jump !== prevState.jump) { delta.jump = jump; prevState.jump = jump; }
            if (jumpPending) { delta.jump = true; jumpPending = false; }

            if (Math.abs(mouseX - prevState.mouseX) > 0.5 || Math.abs(mouseY - prevState.mouseY) > 0.5) {
                delta.mouseX = mouseX;
                delta.mouseY = mouseY;
                prevState.mouseX = mouseX;
                prevState.mouseY = mouseY;
            }
            if (shootPending) { delta.shoot = true; shootPending = false; }
            if (placeBlockPending) { delta.placeBlock = true; placeBlockPending = false; }

            if (Object.keys(delta).length > 0) Network.sendInput(delta);
        }, 1000 / 60);
    }

    function stopSending() {
        if (sendInterval) { clearInterval(sendInterval); sendInterval = null; }
        // Clear pressed keys so nothing is "stuck" when settings open
        for (const k in keys) keys[k] = false;
    }

    return {
        setCanvasMetrics,
        startSending,
        stopSending,
        getMouseGameCoords() { return { x: mouseX, y: mouseY }; },
        getCurrentInput() {
            return {
                left:  !!(keys[bindings.left]),
                right: !!(keys[bindings.right]),
                jump:  !!(keys[bindings.jump] || keys['w']),
            };
        },
        consumeSpecialKeys() {
            const result = { e: eKeyPending, q: qKeyPending, shift: shiftPending };
            eKeyPending = false; qKeyPending = false; shiftPending = false;
            return result;
        },
        onShoot(fn)   { onShootCallback  = fn; },
        onRMB(fn)     { onRMBCallback    = fn; },
        onEscape(fn)  { onEscapeCallback = fn; },
        getBindings()              { return { ...bindings }; },
        setBinding(action, key)    { bindings[action] = key; saveBindings(); },
        resetBindings()            { bindings = { ...DEFAULT_BINDINGS }; saveBindings(); },
        getDefaultBindings()       { return { ...DEFAULT_BINDINGS }; },
    };
})();
