// ============================================================
//  La Raspa - Cliente
// ============================================================
'use strict';

const socket = io();

function uid() { return 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
let playerId = localStorage.getItem('raspa_pid');
if (!playerId) { playerId = uid(); localStorage.setItem('raspa_pid', playerId); }

const AVATARS = ['a01','a02','a03','a04','a05','a06','a07','a08','a09','a10','a11','a12'];
let selectedAvatar = localStorage.getItem('raspa_avatar') || 'a01';
let myName = localStorage.getItem('raspa_name') || '';
let currentCode = null;
let lastState = null;
let seenMsgTs = 0;
let seenAccusationTs = 0;
let phrases = [];
let wasMyTurn = false;
let lastPhase = null;
const ROUND_COUNTDOWN = 7; // segundos (coincide con AUTO_ADVANCE_MS del servidor)

const $ = (id) => document.getElementById(id);
const screens = ['home','lobby','game','gameover'];
function show(screen) { screens.forEach((s) => $(s).classList.toggle('active', s === screen)); }
function cardSrc(card) { return 'cards/' + card.rank + '-' + card.suit + '.svg'; }
function avatarSrc(a) { return 'avatars/' + a + '.svg'; }
function suitName(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

fetch('phrases.json').then((r) => r.json()).then((d) => { phrases = d.frases || []; })
  .catch(() => { phrases = ['¡Vamos!','Esa era mía']; });

// ---------- Sonido ----------
let audioCtx = null;
let soundOn = localStorage.getItem('raspa_sound') !== 'off';
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* sin audio */ }
}
function beep(freq, start, dur) {
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.connect(g); g.connect(audioCtx.destination);
  o.type = 'sine'; o.frequency.value = freq;
  const t = audioCtx.currentTime + start;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur + 0.02);
}
function playTurnSound() {
  if (!soundOn || !audioCtx) return;
  beep(880, 0, 0.18);
  beep(1175, 0.16, 0.22);
}
function updateSoundBtn() { $('soundToggle').textContent = soundOn ? '🔊' : '🔇'; }
$('soundToggle').onclick = () => {
  soundOn = !soundOn;
  localStorage.setItem('raspa_sound', soundOn ? 'on' : 'off');
  updateSoundBtn();
  unlockAudio();
  if (soundOn) playTurnSound();
};
updateSoundBtn();

// ---------- Inicio ----------
function initHome() {
  $('nameInput').value = myName;
  const picker = $('avatarPicker');
  picker.innerHTML = '';
  AVATARS.forEach((a) => {
    const img = document.createElement('img');
    img.src = avatarSrc(a);
    img.className = a === selectedAvatar ? 'selected' : '';
    img.onclick = () => {
      selectedAvatar = a;
      localStorage.setItem('raspa_avatar', a);
      [...picker.children].forEach((c) => c.classList.remove('selected'));
      img.classList.add('selected');
    };
    picker.appendChild(img);
  });
}

function getNameOrWarn() {
  const name = $('nameInput').value.trim();
  if (!name) { $('homeError').textContent = 'Escribí tu nombre.'; return null; }
  myName = name;
  localStorage.setItem('raspa_name', name);
  return name;
}

$('createBtn').onclick = () => {
  unlockAudio();
  const name = getNameOrWarn(); if (!name) return;
  socket.emit('create', { name, avatar: selectedAvatar, playerId }, (res) => {
    if (!res.ok) { $('homeError').textContent = res.error; return; }
    currentCode = res.code;
    localStorage.setItem('raspa_code', res.code);
  });
};

$('joinBtn').onclick = () => {
  unlockAudio();
  const name = getNameOrWarn(); if (!name) return;
  const code = $('codeInput').value.trim().toUpperCase();
  if (!code) { $('homeError').textContent = 'Escribí el código de la sala.'; return; }
  socket.emit('join', { code, name, avatar: selectedAvatar, playerId }, (res) => {
    if (!res.ok) { $('homeError').textContent = res.error; return; }
    currentCode = res.code;
    localStorage.setItem('raspa_code', res.code);
  });
};

$('startBtn').onclick = () => socket.emit('start', {}, (res) => { if (!res.ok) $('lobbyHint').textContent = res.error; });
$('nextRoundBtn').onclick = () => socket.emit('nextRound', {}, (res) => { if (!res.ok) $('roundEndHint').textContent = res.error; });
$('playAgainBtn').onclick = () => socket.emit('playAgain', {}, (res) => { if (!res.ok) $('gameoverHint').textContent = res.error; });

function leave() {
  socket.emit('leave', {}, () => {});
  currentCode = null;
  localStorage.removeItem('raspa_code');
  show('home');
}
$('leaveBtn').onclick = leave;
$('leaveBtn2').onclick = leave;

$('rulesBtn').onclick = () => $('rulesPanel').classList.remove('hidden');
$('closeRules').onclick = () => $('rulesPanel').classList.add('hidden');
$('scoreToggle').onclick = () => { renderScorePanel(); $('scorePanel').classList.remove('hidden'); };
$('closeScore').onclick = () => $('scorePanel').classList.add('hidden');

// ---------- Frases ----------
$('phraseToggle').onclick = (e) => {
  e.stopPropagation();
  const menu = $('phraseMenu');
  if (menu.classList.contains('hidden')) {
    menu.innerHTML = '';
    phrases.forEach((p) => {
      const b = document.createElement('button');
      b.textContent = p;
      b.onclick = () => { socket.emit('say', { text: p }, () => {}); menu.classList.add('hidden'); };
      menu.appendChild(b);
    });
    menu.classList.remove('hidden');
  } else {
    menu.classList.add('hidden');
  }
};

// ---------- Renunció (acusación) ----------
$('accuseToggle').onclick = (e) => {
  e.stopPropagation();
  const menu = $('accuseMenu');
  if (!menu.classList.contains('hidden')) { menu.classList.add('hidden'); return; }
  const s = lastState; if (!s) return;
  menu.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'menu-title';
  title.textContent = 'Acusar de renunció a:';
  menu.appendChild(title);
  s.players.filter((p) => p.id !== s.myId).forEach((p) => {
    const b = document.createElement('button');
    b.textContent = p.name;
    b.onclick = () => {
      socket.emit('accuse', { accusedId: p.id }, (res) => { if (!res.ok) flashStatus(res.error); });
      menu.classList.add('hidden');
    };
    menu.appendChild(b);
  });
  menu.classList.remove('hidden');
};

document.addEventListener('click', (e) => {
  if (!e.target.closest('.phrase-bar')) $('phraseMenu').classList.add('hidden');
  if (!e.target.closest('.accuse-bar')) $('accuseMenu').classList.add('hidden');
});

// ---------- Reconexión ----------
socket.on('connect', () => {
  const code = localStorage.getItem('raspa_code');
  if (code) {
    socket.emit('rejoin', { code, playerId }, (res) => { if (res && res.ok) currentCode = code; });
  }
});

// ---------- Estado del servidor ----------
socket.on('state', (state) => {
  lastState = state;
  currentCode = state.code;
  render(state);

  // Sonido cuando pasa a ser mi turno
  const myTurn = state.turnId === state.myId && (state.phase === 'betting' || state.phase === 'playing');
  if (myTurn && !wasMyTurn) playTurnSound();
  wasMyTurn = myTurn;

  // Aviso de acusación (renunció)
  if (state.lastAccusation && state.lastAccusation.ts > seenAccusationTs) {
    seenAccusationTs = state.lastAccusation.ts;
    showAccuseBubble(state.lastAccusation);
  }

  // Cuenta regresiva de fin de ronda
  if (state.phase === 'roundEnd') {
    if (lastPhase !== 'roundEnd') startRoundCountdown();
  } else {
    stopRoundCountdown();
  }
  lastPhase = state.phase;
});

function render(s) {
  if (s.phase === 'lobby') { show('lobby'); renderLobby(s); return; }
  if (s.phase === 'gameOver') { show('gameover'); renderGame(s); renderGameOver(s); return; }
  show('game');
  renderGame(s);
}

function renderLobby(s) {
  $('lobbyCode').textContent = s.code;
  const cont = $('lobbyPlayers');
  cont.innerHTML = '';
  s.players.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'lobby-player' + (p.id === s.hostId ? ' host' : '');
    div.innerHTML = '<img src="' + avatarSrc(p.avatar) + '"><div class="pname">' + escapeHtml(p.name) + '</div>' +
      (p.id === s.hostId ? '<span class="host-tag">anfitrión</span>' : '');
    cont.appendChild(div);
  });
  const startBtn = $('startBtn');
  startBtn.classList.toggle('hidden', !s.youAreHost);
  startBtn.disabled = s.players.length < 2;
  $('lobbyHint').textContent = s.youAreHost
    ? (s.players.length < 2 ? 'Esperando al menos un primo más...' : 'Listo para empezar.')
    : 'Esperando que el anfitrión empiece...';
}

function renderGame(s) {
  $('roundLabel').textContent = 'Ronda ' + (s.roundIndex + 1) + '/' + s.totalRounds + ' · ' + s.cardsThisRound + ' carta(s)';
  $('trumpInfo').textContent = s.trumpSuit ? 'Muestra (triunfo): ' + suitName(s.trumpSuit) : '';
  $('muestraCard').innerHTML = s.muestra ? '<img src="' + cardSrc(s.muestra) + '">' : '';

  // Botón Renunció: visible al jugar; deshabilitado si ya lo usaste esta ronda.
  const accuseBtn = $('accuseToggle');
  const showAccuse = s.phase === 'playing';
  accuseBtn.classList.toggle('hidden', !showAccuse);
  accuseBtn.disabled = !s.canAccuse;
  accuseBtn.title = s.canAccuse ? 'Acusar a alguien de jugar mal (una vez por ronda)' : 'Ya usaste tu acusación esta ronda';
  if (!showAccuse) $('accuseMenu').classList.add('hidden');

  const seats = $('seats');
  seats.innerHTML = '';
  s.players.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'seat' + (p.isTurn ? ' turn' : '') + (p.connected ? '' : ' disconnected');
    div.dataset.pid = p.id;
    const betTxt = p.hasBet ? ('apostó ' + p.bet) : 'pensando...';
    const statLine = (s.phase === 'playing' || s.phase === 'roundEnd') ? ('manos: ' + p.tricksWon) : betTxt;
    div.innerHTML =
      (p.isDealer ? '<span class="badge dealer-badge">reparte</span>' : '') +
      (p.hasBet ? '<span class="badge bet-badge">' + p.bet + '</span>' : '') +
      '<img class="av" src="' + avatarSrc(p.avatar) + '">' +
      '<div class="sname">' + escapeHtml(p.name) + '</div>' +
      '<div class="sstats">' + statLine + '</div>' +
      '<span class="score-badge">' + p.score + '</span>';
    seats.appendChild(div);
  });

  const trick = $('trick');
  trick.innerHTML = '';
  const showTrick = (s.currentTrick && s.currentTrick.length) ? s.currentTrick : (s.lastTrick ? s.lastTrick.plays : []);
  const winnerId = (!s.currentTrick || !s.currentTrick.length) && s.lastTrick ? s.lastTrick.winnerId : null;
  showTrick.forEach((play) => {
    const pl = s.players.find((x) => x.id === play.playerId);
    const div = document.createElement('div');
    div.className = 'played' + (play.playerId === winnerId ? ' winner' : '');
    div.innerHTML = '<img src="' + cardSrc(play.card) + '"><div class="who">' + (pl ? escapeHtml(pl.name) : '') + '</div>';
    trick.appendChild(div);
  });

  const status = $('statusMsg');
  const turnP = s.players.find((p) => p.isTurn);
  if (s.phase === 'betting') {
    status.textContent = turnP ? (turnP.id === s.myId ? 'Es tu turno de apostar' : 'Apostando: ' + turnP.name) : '';
  } else if (s.phase === 'playing') {
    status.textContent = turnP ? (turnP.id === s.myId ? '¡Tu turno! Tirá una carta' : 'Juega: ' + turnP.name) : '';
  } else { status.textContent = ''; }

  renderHand(s);
  renderBetPanel(s);
  $('roundEndPanel').classList.toggle('hidden', s.phase !== 'roundEnd');
  if (s.phase === 'roundEnd') renderRoundEnd(s);
  renderBubbles(s);
}

function renderHand(s) {
  const hand = $('myHand');
  hand.innerHTML = '';
  const myTurn = s.turnId === s.myId && s.phase === 'playing';
  const legal = s.myLegal || [];
  (s.myHand || []).forEach((card) => {
    const img = document.createElement('img');
    img.src = cardSrc(card);
    const id = card.rank + '-' + card.suit;
    if (myTurn) {
      // Se permite jugar CUALQUIER carta. Las legales se marcan con borde dorado;
      // si tirás una no marcada, podés ser acusado de "renunció".
      img.className = legal.includes(id) ? 'playable' : 'maybe';
      img.onclick = () => socket.emit('play', { card }, (res) => { if (!res.ok) flashStatus(res.error); });
    }
    hand.appendChild(img);
  });
}

function renderBetPanel(s) {
  const panel = $('betPanel');
  const myTurn = s.turnId === s.myId && s.phase === 'betting';
  panel.classList.toggle('hidden', !myTurn);
  if (!myTurn) return;
  const box = $('betButtons');
  box.innerHTML = '';
  for (let i = 0; i <= s.cardsThisRound; i++) {
    const b = document.createElement('button');
    b.textContent = i;
    if (s.forbiddenBet !== null && s.forbiddenBet === i) {
      b.disabled = true;
      b.title = 'No podés apostar este número (sos el repartidor)';
    } else {
      b.onclick = () => socket.emit('bet', { bet: i }, (res) => { if (!res.ok) $('betNote').textContent = res.error; });
    }
    box.appendChild(b);
  }
  $('betNote').textContent = s.forbiddenBet !== null
    ? ('Sos el repartidor: no podés apostar ' + s.forbiddenBet + ' (la suma no puede dar ' + s.cardsThisRound + ').')
    : '';
}

function renderRoundEnd(s) {
  const last = s.roundHistory[s.roundHistory.length - 1];
  const cont = $('roundEndSummary');
  cont.innerHTML = '';
  if (last) {
    s.players.forEach((p) => {
      const r = last.results[p.id];
      if (!r) return;
      const row = document.createElement('div');
      row.className = 'round-end-row';
      const tag = r.fulfilled ? ' ✓' : '';
      row.innerHTML = '<span>' + escapeHtml(p.name) + ' — apostó ' + r.bet + ', hizo ' + r.won + tag + '</span>' +
        '<span class="' + (r.fulfilled ? 'ok' : 'no') + '">+' + r.pts + '</span>';
      cont.appendChild(row);
    });
  }
  $('nextRoundBtn').classList.toggle('hidden', !s.youAreHost);
  $('roundEndHint').textContent = s.youAreHost ? 'O esperá a que empiece sola.' : 'La próxima ronda empieza sola.';
}

function startRoundCountdown() {
  stopRoundCountdown();
  const el = $('roundCountdown');
  let n = ROUND_COUNTDOWN;
  el.textContent = 'Próxima ronda en ' + n + 's...';
  startRoundCountdown._t = setInterval(() => {
    n--;
    if (n <= 0) { el.textContent = 'Empezando...'; stopRoundCountdown(); return; }
    el.textContent = 'Próxima ronda en ' + n + 's...';
  }, 1000);
}
function stopRoundCountdown() {
  if (startRoundCountdown._t) { clearInterval(startRoundCountdown._t); startRoundCountdown._t = null; }
}

function renderGameOver(s) {
  const winners = s.players.filter((p) => s.winnerIds.includes(p.id));
  $('winnerTitle').textContent = winners.length === 1
    ? ('🏆 ¡Ganó ' + winners[0].name + '!')
    : ('🏆 ¡Empate: ' + winners.map((w) => w.name).join(' y ') + '!');
  const cont = $('finalScores');
  cont.innerHTML = '';
  [...s.players].sort((a, b) => b.score - a.score).forEach((p) => {
    const row = document.createElement('div');
    row.className = 'row' + (s.winnerIds.includes(p.id) ? ' win' : '');
    row.innerHTML = '<img src="' + avatarSrc(p.avatar) + '"><span>' + escapeHtml(p.name) + '</span><span class="pts">' + p.score + '</span>';
    cont.appendChild(row);
  });
  $('playAgainBtn').classList.toggle('hidden', !s.youAreHost);
  $('gameoverHint').textContent = s.youAreHost ? '' : 'Esperando al anfitrión...';
}

function renderScorePanel() {
  const s = lastState; if (!s) return;
  const cont = $('scoreContent');
  let html = '<table class="score-table"><tr><th>Jugador</th>';
  for (let r = 0; r < s.totalRounds; r++) html += '<th>R' + (r + 1) + '</th>';
  html += '<th>Total</th></tr>';
  s.players.forEach((p) => {
    html += '<tr><td>' + escapeHtml(p.name) + '</td>';
    for (let r = 0; r < s.totalRounds; r++) {
      const hr = s.roundHistory[r];
      const cell = hr && hr.results[p.id] ? hr.results[p.id].pts : '';
      html += '<td>' + cell + '</td>';
    }
    html += '<td><b>' + p.score + '</b></td></tr>';
  });
  html += '</table>';
  cont.innerHTML = html;
}

// ---------- Avisos de frases (laterales) ----------
function renderBubbles(s) {
  if (!s.messages) return;
  const fresh = s.messages.filter((m) => m.ts > seenMsgTs);
  if (!fresh.length) return;
  seenMsgTs = Math.max.apply(null, s.messages.map((m) => m.ts));
  fresh.forEach((m) => {
    const p = s.players.find((x) => x.id === m.playerId);
    showBubble(p ? p.name : '', m.text);
  });
}

function showBubble(name, text) {
  const layer = $('bubbleLayer');
  const b = document.createElement('div');
  b.className = 'bubble';
  b.innerHTML = (name ? '<b>' + escapeHtml(name) + ':</b> ' : '') + escapeHtml(text);
  layer.appendChild(b);
  setTimeout(() => b.remove(), 4000);
}

function showAccuseBubble(a) {
  const layer = $('bubbleLayer');
  const b = document.createElement('div');
  b.className = 'bubble accuse' + (a.correct ? ' ok' : '');
  const who = '<b>' + escapeHtml(a.accuserName) + '</b> acusó a <b>' + escapeHtml(a.accusedName) + '</b> de renunció: ';
  b.innerHTML = '⚖️ ' + who + (a.correct ? '¡correcto! −5 puntos y se repite la mano.' : 'incorrecto.');
  layer.appendChild(b);
  setTimeout(() => b.remove(), 6000);
}

function flashStatus(msg) {
  const el = $('statusMsg');
  const prev = el.textContent;
  el.textContent = msg;
  setTimeout(() => { if (el.textContent === msg) el.textContent = prev; }, 1800);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

initHome();
show('home');
