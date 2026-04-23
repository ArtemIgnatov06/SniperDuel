// Handles socket.io connection and server communication
const Network = (() => {
    const socket = io();
    let _onJoined = null;
    let _onGameStart = null;
    let _onSnapshot = null;
    let _onTracer = null;
    let _onPlayerDied = null;
    let _onBlockPlaced = null;
    let _onBlockDestroyed = null;
    let _onRoundReset = null;
    let _onOpponentDisconnected = null;
    let _onRoomFull = null;

    const roomId = new URLSearchParams(window.location.search).get('room');

    socket.on('connect', () => {
        if (roomId) {
            socket.emit('joinRoom', { roomId });
        }
    });

    socket.on('joined', (data) => { if (_onJoined) _onJoined(data); });
    socket.on('gameStart', (data) => { if (_onGameStart) _onGameStart(data); });
    socket.on('snapshot', (data) => { if (_onSnapshot) _onSnapshot(data); });
    socket.on('tracer', (data) => { if (_onTracer) _onTracer(data); });
    socket.on('playerDied', (data) => { if (_onPlayerDied) _onPlayerDied(data); });
    socket.on('blockPlaced', (data) => { if (_onBlockPlaced) _onBlockPlaced(data); });
    socket.on('blockDestroyed', (data) => { if (_onBlockDestroyed) _onBlockDestroyed(data); });
    socket.on('roundReset', (data) => { if (_onRoundReset) _onRoundReset(data); });
    socket.on('opponentDisconnected', () => { if (_onOpponentDisconnected) _onOpponentDisconnected(); });
    socket.on('roomFull', () => { if (_onRoomFull) _onRoomFull(); });

    function sendInput(data) {
        socket.emit('input', data);
    }

    return {
        roomId,
        sendInput,
        onJoined(fn) { _onJoined = fn; },
        onGameStart(fn) { _onGameStart = fn; },
        onSnapshot(fn) { _onSnapshot = fn; },
        onTracer(fn) { _onTracer = fn; },
        onPlayerDied(fn) { _onPlayerDied = fn; },
        onBlockPlaced(fn) { _onBlockPlaced = fn; },
        onBlockDestroyed(fn) { _onBlockDestroyed = fn; },
        onRoundReset(fn) { _onRoundReset = fn; },
        onOpponentDisconnected(fn) { _onOpponentDisconnected = fn; },
        onRoomFull(fn) { _onRoomFull = fn; },
    };
})();
