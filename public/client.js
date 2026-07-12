// ============================================================
//  La Raspa - Cliente
// ============================================================
'use strict';

const socket = io();

function uid() { return 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
let playerId = localStorage.getItem('raspa_pid');
if (!playerId) { playerId = uid(); localStorage.setItem('raspa_pid', playerId); }

const AVATARS = ['a01','a02','a03','a04','a05','a06','a07','a08','a09','a10','a11','a12'];

// Tonos de piel elegibles. Los SVG de los avatares usan alguno de los colores
// "base"; al mostrarlos se reemplaza por el tono elegido por cada jugador.
const SKINS = { s1: '#ffe0bd', s2: '#f1c79b', s3: '#e0ac69', s4: '#c68642', s5: '#8d5524', s6: '#5c3a21' };
const SKIN_BASES = ['#ffd9a0', '#ffe0bd', '#f1c79b', '#e8b48a'];

let selectedAvatar = localStorage.getItem('raspa_avatar') || 'a01';
let selectedSkin = localStorage.getItem('raspa_skin') || 's1';
if (!SKINS[selectedSkin]) selectedSkin = 's1';
let myName = localStorage.getItem('raspa_name') || '';
let currentCode = null;
let lastState = null;
let seenMsgTs = 0;
let seenAccusationTs = 0;
let phrases = [];
let wasMyTurn = false;
let lastPhase = null;
let stateReceivedAt = 0;   // cuándo llegó el último estado (para el reloj de demora)
let seenVoteResultTs = 0;
const ROUND_COUNTDOWN = 7; // segundos (coincide con AUTO_ADVANCE_MS del servidor)

const $ = (id) => document.getElementById(id);
const screens = ['home','lobby','game','gameover'];
function show(screen) { screens.forEach((s) => $(s).classList.toggle('active', s === screen)); }
function cardSrc(card) { return 'cards/' + card.rank + '-' + card.suit + '.png'; }
function suitName(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

// ---------- Avatares con color de piel ----------
// Se precargan los SVG y se recolorea la piel con el tono de cada jugador.
const avatarSvgCache = {};   // 'a01' -> texto del svg
const avatarUriCache = {};   // 'a01|s3' -> data URI
AVATARS.forEach((a) => {
  fetch('avatars/' + a + '.svg').then((r) => r.text()).then((txt) => {
    avatarSvgCache[a] = txt;
    if (lastState) render(lastState); else initHome();
  }).catch(() => {});
});
function avatarSrc(a, skin) {
  skin = SKINS[skin] ? skin : 's1';
  const key = a + '|' + skin;
  if (avatarUriCache[key]) return avatarUriCache[key];
  const svg = avatarSvgCache[a];
  if (!svg) return 'avatars/' + a + '.svg'; // todavía no cargó: se ve con la piel original
  let txt = svg;
  SKIN_BASES.forEach((b) => { txt = txt.split(b).join(SKINS[skin]); });
  const uri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(txt)));
  avatarUriCache[key] = uri;
  return uri;
}

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

  const skins = $('skinPicker');
  skins.innerHTML = '';
  Object.keys(SKINS).forEach((sk) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'skin-dot' + (sk === selectedSkin ? ' selected' : '');
    dot.style.background = SKINS[sk];
    dot.title = 'Tono de piel';
    dot.onclick = () => {
      selectedSkin = sk;
      localStorage.setItem('raspa_skin', sk);
      initHome(); // repinta avatares con el nuevo tono
    };
    skins.appendChild(dot);
  });

  const picker = $('avatarPicker');
  picker.innerHTML = '';
  AVATARS.forEach((a) => {
    const img = document.createElement('img');
    img.src = avatarSrc(a, selectedSkin);
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
  socket.emit('create', { name, avatar: selectedAvatar, skin: selectedSkin, playerId }, (res) => {
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
  socket.emit('join', { code, name, avatar: selectedAvatar, skin: selectedSkin, playerId }, (res) => {
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
// Mientras el menú de frases está abierto se oculta el botón de Renunció
// (en celulares en vertical se pisaban y las frases quedaban cortadas).
function setPhrasesOpen(open) {
  $('topbarActions').classList.toggle('phrases-open', open);
}
$('phraseToggle').onclick = (e) => {
  e.stopPropagation();
  const menu = $('phraseMenu');
  if (menu.classList.contains('hidden')) {
    menu.innerHTML = '';
    phrases.forEach((p) => {
      const b = document.createElement('button');
      b.textContent = p;
      b.onclick = () => { socket.emit('say', { text: p }, () => {}); menu.classList.add('hidden'); setPhrasesOpen(false); };
      menu.appendChild(b);
    });
    menu.classList.remove('hidden');
    $('accuseMenu').classList.add('hidden');
    setPhrasesOpen(true);
  } else {
    menu.classList.add('hidden');
    setPhrasesOpen(false);
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
  if (!e.target.closest('.phrase-bar')) { $('phraseMenu').classList.add('hidden'); setPhrasesOpen(false); }
  if (!e.target.closest('.accuse-bar')) $('accuseMenu').classList.add('hidden');
});

// ---------- Jugador lento: votación de reemplazo por IA ----------
// El botón aparece cuando el jugador de turno lleva más de 20s sin responder.
function slowElapsed(s) {
  return (s.turnElapsed || 0) + (Date.now() - stateReceivedAt);
}
function updateSlowButton() {
  const s = lastState;
  const btn = $('slowVoteBtn');
  if (!s) { btn.classList.add('hidden'); return; }
  const turnP = s.players.find((p) => p.isTurn);
  const show = (s.phase === 'betting' || s.phase === 'playing') &&
    turnP && turnP.id !== s.myId && !turnP.isBot &&
    !s.replaceVote && !s.trickPause &&
    slowElapsed(s) >= (s.slowTurnMs || 20000);
  btn.classList.toggle('hidden', !show);
  if (show) btn.textContent = '🐌 ' + turnP.name + ' demora... ¿que juegue la IA por él?';
}
setInterval(updateSlowButton, 1000);

$('slowVoteBtn').onclick = () => {
  const s = lastState; if (!s) return;
  const turnP = s.players.find((p) => p.isTurn);
  if (!turnP) return;
  socket.emit('startReplaceVote', { targetId: turnP.id }, (res) => { if (!res.ok) flashStatus(res.error); });
};

function renderVotePanel(s) {
  const panel = $('votePanel');
  if (!s.replaceVote || (s.phase !== 'betting' && s.phase !== 'playing')) {
    panel.classList.add('hidden');
    return;
  }
  const rv = s.replaceVote;
  panel.classList.remove('hidden');
  if (rv.youAreTarget) {
    panel.innerHTML = '<b>⚠️ Están votando que la IA juegue por vos.</b> ¡Jugá ya para cancelar la votación!';
    return;
  }
  let html = '<b>🗳️ ¿La IA reemplaza a ' + escapeHtml(rv.targetName) + '?</b> ' +
    '<span class="vote-count">(' + rv.yes + '/' + rv.needed + ' a favor, tiene que ser unánime)</span>';
  if (rv.canVote) {
    html += '<div class="vote-actions">' +
      '<button id="voteYes" class="btn small danger">Sí, que juegue la IA</button>' +
      '<button id="voteNo" class="btn small">No, esperemos</button></div>';
  } else {
    html += '<div class="vote-wait">Esperando el resto de los votos...</div>';
  }
  panel.innerHTML = html;
  const yes = $('voteYes'), no = $('voteNo');
  if (yes) yes.onclick = () => socket.emit('voteReplace', { yes: true }, (r) => { if (!r.ok) flashStatus(r.error); });
  if (no) no.onclick = () => socket.emit('voteReplace', { yes: false }, (r) => { if (!r.ok) flashStatus(r.error); });
}

// ---------- Abandonar la partida ----------
$('abandonToggle').onclick = () => $('abandonPanel').classList.remove('hidden');
$('abandonCancel').onclick = () => $('abandonPanel').classList.add('hidden');
$('abandonConfirm').onclick = () => {
  socket.emit('abandon', {}, () => {});
  $('abandonPanel').classList.add('hidden');
  leaveLocal('Abandonaste la partida. Podés crear o unirte a otra cuando quieras.');
};

// Vuelve a la pantalla de inicio y desvincula esta partida.
function leaveLocal(msg) {
  currentCode = null;
  lastState = null;
  localStorage.removeItem('raspa_code');
  stopFireworks();
  show('home');
  if (msg) $('homeError').textContent = msg;
}

// El servidor te desvincula (te reemplazó la IA por votación).
socket.on('expelled', () => {
  leaveLocal('Fuiste reemplazado por la IA en la partida anterior (votación de los demás jugadores).');
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
  stateReceivedAt = Date.now();
  render(state);
  updateSlowButton();

  // Resultado de la votación de reemplazo
  if (state.lastVoteResult && state.lastVoteResult.ts > seenVoteResultTs) {
    seenVoteResultTs = state.lastVoteResult.ts;
    showBubble('', state.lastVoteResult.success
      ? '🤖 ' + state.lastVoteResult.targetName + ' fue reemplazado por la IA (votación unánime).'
      : '🗳️ La votación para reemplazar a ' + state.lastVoteResult.targetName + ' no fue unánime: sigue jugando.');
  }

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
    div.innerHTML = '<img src="' + avatarSrc(p.avatar, p.skin) + '"><div class="pname">' + escapeHtml(p.name) + '</div>' +
      (p.id === s.hostId ? '<span class="host-tag">anfitrión</span>' : '');
    cont.appendChild(div);
  });
  const startBtn = $('startBtn');
  startBtn.classList.toggle('hidden', !s.youAreHost);
  startBtn.disabled = s.players.length < 2;

  // Opción "ida y vuelta": el anfitrión la cambia, el resto la ve.
  const chk = $('idaVueltaChk');
  chk.checked = !!(s.options && s.options.idaYVuelta);
  chk.disabled = !s.youAreHost;
  chk.onchange = () => socket.emit('setOptions', { idaYVuelta: chk.checked }, () => {});

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
    div.className = 'seat' + (p.isTurn ? ' turn' : '') + (p.connected || p.isBot ? '' : ' disconnected') + (p.isBot ? ' bot' : '');
    div.dataset.pid = p.id;
    const betTxt = p.hasBet ? ('apostó ' + p.bet) : 'pensando...';
    const statLine = (s.phase === 'playing' || s.phase === 'roundEnd') ? ('manos: ' + p.tricksWon) : betTxt;
    div.innerHTML =
      (p.isDealer ? '<span class="badge dealer-badge">reparte</span>' : '') +
      (p.hasBet ? '<span class="badge bet-badge">' + p.bet + '</span>' : '') +
      '<img class="av" src="' + avatarSrc(p.avatar, p.skin) + '">' +
      '<div class="sname">' + (p.isBot ? '🤖 ' : '') + escapeHtml(p.name) + '</div>' +
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
    const isTrumpAce = play.card.rank === 1 && play.card.suit === s.trumpSuit;
    const div = document.createElement('div');
    div.className = 'played' + (play.playerId === winnerId ? ' winner' : '') + (isTrumpAce ? ' trump-ace' : '');
    div.innerHTML = '<img src="' + cardSrc(play.card) + '"><div class="who">' + (pl ? escapeHtml(pl.name) : '') + '</div>';
    trick.appendChild(div);
  });

  const status = $('statusMsg');
  const turnP = s.players.find((p) => p.isTurn);
  if (s.phase === 'betting') {
    status.textContent = turnP ? (turnP.id === s.myId ? 'Es tu turno de apostar' : 'Apostando: ' + turnP.name) : '';
  } else if (s.phase === 'playing') {
    if (s.trickPause && s.lastTrick) {
      const w = s.players.find((p) => p.id === s.lastTrick.winnerId);
      status.textContent = w ? ('Mano para ' + w.name + ' 🏅') : '';
    } else {
      status.textContent = turnP ? (turnP.id === s.myId ? '¡Tu turno! Tirá una carta' : 'Juega: ' + turnP.name) : '';
    }
  } else { status.textContent = ''; }

  renderHand(s);
  renderBetPanel(s);
  renderVotePanel(s);
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

  // Fin de la "ida" (modo ida y vuelta): resultado parcial con las posiciones.
  if (s.isHalfway) {
    const half = document.createElement('div');
    half.className = 'halfway-box';
    let html = '<div class="halfway-title">📊 Resultado parcial — fin de la ida</div>';
    [...s.players].sort((a, b) => b.score - a.score).forEach((p, i) => {
      html += '<div class="round-end-row"><span>' + (i + 1) + 'º ' + escapeHtml(p.name) + '</span><span><b>' + p.score + '</b> pts</span></div>';
    });
    half.innerHTML = html + '<div class="halfway-note">Ahora se vuelve bajando: ' + s.cardsThisRound + ' → 1</div>';
    cont.appendChild(half);
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
    row.innerHTML = '<img src="' + avatarSrc(p.avatar, p.skin) + '"><span>' + escapeHtml(p.name) + '</span><span class="pts">' + p.score + '</span>';
    cont.appendChild(row);
  });
  $('playAgainBtn').classList.toggle('hidden', !s.youAreHost);
  $('gameoverHint').textContent = s.youAreHost ? '' : 'Esperando al anfitrión...';

  // Festejo: el/los ganadores saltan con corona, cuerpo y su nombre en grande.
  const cel = $('celebration');
  cel.innerHTML = '';
  winners.forEach((w, i) => {
    const fig = document.createElement('div');
    fig.className = 'celebrate-figure';
    fig.style.animationDelay = (i * 0.15) + 's';
    fig.innerHTML =
      '<div class="celebrate-name">' + escapeHtml(w.name) + '</div>' +
      '<div class="celebrate-crown">👑</div>' +
      '<img class="celebrate-avatar" src="' + avatarSrc(w.avatar, w.skin) + '">' +
      celebrateBodySvg(SKINS[w.skin] || SKINS.s1);
    cel.appendChild(fig);
  });

  // Botón de cuetes: sólo lo ve el ganador. Cada toque tira más cuetes
  // y los ven todos los jugadores. No hay fuegos automáticos.
  $('cuetesBtn').classList.toggle('hidden', !s.winnerIds.includes(s.myId));
  startFireworks(); // arranca sólo el lienzo/animación, sin cuetes
}

// Cuerpo festejando (brazos arriba) con las manos del color de piel elegido.
function celebrateBodySvg(skinHex) {
  return '<svg class="celebrate-body" viewBox="0 0 120 92" width="120" height="92" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M32,44 Q18,26 13,10" stroke="' + skinHex + '" stroke-width="9" fill="none" stroke-linecap="round"/>' +
    '<path d="M88,44 Q102,26 107,10" stroke="' + skinHex + '" stroke-width="9" fill="none" stroke-linecap="round"/>' +
    '<circle cx="13" cy="9" r="7" fill="' + skinHex + '"/>' +
    '<circle cx="107" cy="9" r="7" fill="' + skinHex + '"/>' +
    '<path d="M38,36 h44 l7,40 a9,9 0 0 1 -9,9 h-40 a9,9 0 0 1 -9,-9 Z" fill="#c0392b" stroke="#7b1113" stroke-width="2.5"/>' +
    '<path d="M60,36 v49" stroke="#7b1113" stroke-width="2.5"/>' +
    '<circle cx="60" cy="50" r="2.4" fill="#e8c46a"/>' +
    '<circle cx="60" cy="62" r="2.4" fill="#e8c46a"/>' +
    '<circle cx="60" cy="74" r="2.4" fill="#e8c46a"/>' +
    '</svg>';
}

// ---------- Fuegos artificiales ----------
// No hay cuetes automáticos: sólo salen cuando el GANADOR toca el botón
// 🎆 (evento 'fireworks' del servidor, lo ven todos). Cuanto más toca, más cuetes.
let fwAnim = null;
let fwParts = [];
function fwBurst() {
  const canvas = $('fireworks');
  if (!canvas) return;
  const colors = ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#f78c6b', '#fff'];
  const x = canvas.width * (0.1 + Math.random() * 0.8);
  const y = canvas.height * (0.08 + Math.random() * 0.5);
  const color = colors[Math.floor(Math.random() * colors.length)];
  const n = 40 + Math.floor(Math.random() * 30);
  for (let i = 0; i < n; i++) {
    const ang = (Math.PI * 2 * i) / n + Math.random() * 0.2;
    const sp = 1.5 + Math.random() * 3.5;
    fwParts.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1, color });
  }
}

function startFireworks() {
  const canvas = $('fireworks');
  if (!canvas || fwAnim) return;
  const ctx = canvas.getContext('2d');
  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);

  function frame() {
    if (!document.getElementById('gameover').classList.contains('active')) {
      stopFireworks();
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    fwParts.forEach((p) => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.035; p.life -= 0.012;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    fwParts = fwParts.filter((p) => p.life > 0);
    fwAnim = requestAnimationFrame(frame);
  }
  fwAnim = requestAnimationFrame(frame);
}
function stopFireworks() {
  if (fwAnim) { cancelAnimationFrame(fwAnim); fwAnim = null; }
  fwParts = [];
  const canvas = $('fireworks');
  if (canvas) { const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); }
}

// El ganador tira cuetes; el servidor se los muestra a todos.
$('cuetesBtn').onclick = () => socket.emit('fireworks', {}, () => {});
socket.on('fireworks', () => {
  if (!document.getElementById('gameover').classList.contains('active')) return;
  startFireworks();
  const n = 2 + Math.floor(Math.random() * 2); // cada toque, 2-3 cuetes
  for (let i = 0; i < n; i++) setTimeout(fwBurst, i * 130);
});

// ---------- Fondo de mesa elegible ----------
const BGS = [
  { id: 'verde', name: 'Paño verde' },
  { id: 'azul', name: 'Paño azul' },
  { id: 'bordo', name: 'Paño bordó' },
  { id: 'noche', name: 'Mesa nocturna' },
];
let bgIdx = Math.max(0, BGS.findIndex((b) => b.id === (localStorage.getItem('raspa_bg') || 'verde')));
function applyBg() {
  BGS.forEach((b) => document.body.classList.remove('bg-' + b.id));
  const bg = BGS[bgIdx];
  if (bg.id !== 'verde') document.body.classList.add('bg-' + bg.id);
  localStorage.setItem('raspa_bg', bg.id);
}
$('bgToggle').onclick = () => {
  bgIdx = (bgIdx + 1) % BGS.length;
  applyBg();
  showBubble('', '🎨 Fondo: ' + BGS[bgIdx].name);
};
applyBg();

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
