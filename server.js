// ============================================================
//  La Raspa - Servidor (Express + Socket.io)
//  Servidor autoritativo: el estado vive acá y cada jugador
//  recibe sólo su propia mano.
// ============================================================
'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Game, MAX_PLAYERS } = require('./game/room');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// Tras terminar una ronda, el servidor avanza solo a la siguiente luego de unos segundos.
const AUTO_ADVANCE_MS = 7000;
const roundTimers = new Map(); // code -> timeout

// --- Límites de seguridad ---
const MAX_ROOMS = 1000;            // tope de salas simultáneas (anti-abuso de memoria)
const ROOM_EXPIRY_MS = 30 * 60 * 1000; // borra salas sin nadie conectado tras 30 min
const EVENTS_PER_SEC = 15;         // eventos por segundo por conexión
const SAY_INTERVAL_MS = 800;       // mínimo entre frases

const ALLOWED_AVATARS = ['a01','a02','a03','a04','a05','a06','a07','a08','a09','a10','a11','a12'];
function cleanName(n) {
  return String(n == null ? '' : n).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 14) || 'Jugador';
}
function cleanAvatar(a) {
  return ALLOWED_AVATARS.includes(a) ? a : 'a01';
}

// code -> Game
const rooms = new Map();
// socket.id -> { code, playerId }
const sockets = new Map();

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += letters[Math.floor(Math.random() * letters.length)];
  } while (rooms.has(code));
  return code;
}

function broadcast(code) {
  const game = rooms.get(code);
  if (!game) return;
  for (const [sid, info] of sockets) {
    if (info.code === code) {
      const s = io.sockets.sockets.get(sid);
      if (s) s.emit('state', game.viewFor(info.playerId));
    }
  }
}

function clearAutoAdvance(code) {
  const t = roundTimers.get(code);
  if (t) { clearTimeout(t); roundTimers.delete(code); }
}

function scheduleAutoAdvance(code) {
  clearAutoAdvance(code);
  const game = rooms.get(code);
  if (!game || game.phase !== 'roundEnd') return;
  const t = setTimeout(() => {
    roundTimers.delete(code);
    const g = rooms.get(code);
    if (g && g.phase === 'roundEnd') {
      g.advanceRound();
      broadcast(code);
      scheduleAutoAdvance(code);
    }
  }, AUTO_ADVANCE_MS);
  roundTimers.set(code, t);
}

function cleanupRoomIfEmpty(code) {
  const game = rooms.get(code);
  if (!game) return;
  const anyConnected = game.players.some((p) => p.connected);
  if (!anyConnected && game.players.length === 0) {
    rooms.delete(code);
  }
}

io.on('connection', (socket) => {
  // Límite de eventos por segundo (anti-spam / anti-flood)
  socket.use((packet, next) => {
    const now = Date.now();
    socket.data.times = (socket.data.times || []).filter((t) => now - t < 1000);
    if (socket.data.times.length >= EVENTS_PER_SEC) return; // descarta en silencio
    socket.data.times.push(now);
    next();
  });

  function joinRoom(code, playerId) {
    sockets.set(socket.id, { code, playerId });
    socket.join(code);
  }

  // Crear sala
  socket.on('create', ({ name, avatar, playerId }, cb) => {
    if (rooms.size >= MAX_ROOMS) return cb && cb({ ok: false, error: 'Servidor lleno, probá más tarde.' });
    name = cleanName(name); avatar = cleanAvatar(avatar);
    const code = makeCode();
    const game = new Game(code);
    rooms.set(code, game);
    const res = game.addPlayer({ id: playerId, name, avatar });
    if (!res.ok) return cb && cb(res);
    joinRoom(code, playerId);
    cb && cb({ ok: true, code });
    broadcast(code);
  });

  // Unirse a sala
  socket.on('join', ({ code, name, avatar, playerId }, cb) => {
    code = (code || '').toUpperCase().trim();
    name = cleanName(name); avatar = cleanAvatar(avatar);
    const game = rooms.get(code);
    if (!game) return cb && cb({ ok: false, error: 'No existe una sala con ese código.' });
    const res = game.addPlayer({ id: playerId, name, avatar });
    if (!res.ok) return cb && cb(res);
    joinRoom(code, playerId);
    cb && cb({ ok: true, code });
    broadcast(code);
  });

  // Reconectar (mismo playerId vuelve)
  socket.on('rejoin', ({ code, playerId }, cb) => {
    code = (code || '').toUpperCase().trim();
    const game = rooms.get(code);
    if (!game || !game.getPlayer(playerId)) {
      return cb && cb({ ok: false, error: 'No se pudo reconectar.' });
    }
    game.setConnected(playerId, true);
    joinRoom(code, playerId);
    cb && cb({ ok: true, code });
    broadcast(code);
  });

  function withGame(cb, fn) {
    const info = sockets.get(socket.id);
    if (!info) return cb && cb({ ok: false, error: 'No estás en una sala.' });
    const game = rooms.get(info.code);
    if (!game) return cb && cb({ ok: false, error: 'La sala no existe.' });
    const res = fn(game, info);
    if (res && !res.ok) return cb && cb(res);
    cb && cb({ ok: true });
    broadcast(info.code);
    scheduleAutoAdvance(info.code);
  }

  socket.on('start', (_, cb) => withGame(cb, (g, i) => g.start(i.playerId)));
  socket.on('bet', ({ bet }, cb) => withGame(cb, (g, i) => g.placeBet(i.playerId, bet)));
  socket.on('play', ({ card }, cb) => withGame(cb, (g, i) => g.playCard(i.playerId, card)));
  socket.on('nextRound', (_, cb) => withGame(cb, (g, i) => g.nextRound(i.playerId)));
  socket.on('playAgain', (_, cb) => withGame(cb, (g, i) => g.playAgain(i.playerId)));
  socket.on('accuse', ({ accusedId }, cb) => withGame(cb, (g, i) => g.accuse(i.playerId, accusedId)));

  socket.on('say', ({ text }, cb) => {
    const info = sockets.get(socket.id);
    if (!info) return;
    const game = rooms.get(info.code);
    if (!game) return;
    const now = Date.now();
    if (socket.data.lastSay && now - socket.data.lastSay < SAY_INTERVAL_MS) return; // demasiado seguido
    socket.data.lastSay = now;
    game.addMessage(info.playerId, text);
    cb && cb({ ok: true });
    broadcast(info.code);
  });

  socket.on('leave', (_, cb) => {
    const info = sockets.get(socket.id);
    if (info) {
      const game = rooms.get(info.code);
      if (game) {
        game.removePlayer(info.playerId);
        broadcast(info.code);
        cleanupRoomIfEmpty(info.code);
      }
      socket.leave(info.code);
      sockets.delete(socket.id);
    }
    cb && cb({ ok: true });
  });

  socket.on('disconnect', () => {
    const info = sockets.get(socket.id);
    if (info) {
      const game = rooms.get(info.code);
      if (game) {
        game.setConnected(info.playerId, false);
        broadcast(info.code);
      }
      sockets.delete(socket.id);
    }
  });
});

// Borra salas que quedaron sin nadie conectado por mucho tiempo.
setInterval(() => {
  const now = Date.now();
  for (const [code, game] of rooms) {
    const anyConn = game.players.some((p) => p.connected);
    if (anyConn) { game.emptySince = null; continue; }
    if (!game.emptySince) game.emptySince = now;
    else if (now - game.emptySince > ROOM_EXPIRY_MS) {
      clearAutoAdvance(code);
      rooms.delete(code);
    }
  }
}, 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`\n  🃏  La Raspa corriendo en http://localhost:${PORT}\n`);
});
