// ============================================================
//  La Raspa - Gestión de partida (máquina de estados de la sala)
// ============================================================
'use strict';

const E = require('./engine');

const PHASES = {
  LOBBY: 'lobby',
  BETTING: 'betting',
  PLAYING: 'playing',
  ROUND_END: 'roundEnd',
  GAME_OVER: 'gameOver',
};

const MAX_PLAYERS = 10;

// Si un jugador demora más de esto en su turno, los demás pueden votar
// (por unanimidad) que una IA básica juegue por él y quede expulsado.
const SLOW_TURN_MS = 20 * 1000;

function rotationFrom(leaderIndex, n) {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push((leaderIndex + i) % n);
  return arr;
}

class Game {
  constructor(code) {
    this.code = code;
    this.players = []; // { id, name, avatar, connected }
    this.hostId = null;
    this.phase = PHASES.LOBBY;

    this.roundsPlan = [];
    this.roundIndex = 0;
    this.cardsThisRound = 0;
    this.dealerIndex = 0;

    this.hands = {};       // playerId -> [cards]
    this.muestra = null;
    this.bets = {};        // playerId -> number
    this.bettingSeq = [];  // array de índices de jugador (orden de apuesta)
    this.bettingPos = 0;

    this.tricksWon = {};   // playerId -> number
    this.currentTrick = []; // [{ playerId, card }]
    this.playSeq = [];     // índices de jugador para la mano actual
    this.playPos = 0;
    this.trickLeaderIndex = 0;

    this.scores = {};      // playerId -> total
    this.roundHistory = [];
    this.lastTrick = null; // para mostrar la última mano resuelta
    this.messages = [];    // frases lanzadas: { playerId, text, ts }
    this.winnerIds = [];
    this.accusedThisRound = {}; // playerId -> true (una acusación de renuncio por ronda)
    this.lastAccusation = null; // { accuserName, accusedName, correct, ts }
    this.roundTricks = [];      // historial de manos de ESTA ronda: { plays, winnerId, leaderIndex }
    this.trickPause = false;    // pausa de 2s al resolver cada mano (nadie puede jugar)
    this.options = { idaYVuelta: false }; // el anfitrión puede elegir jugar 1..7..1
    this.turnStartedAt = null;  // para detectar jugadores que demoran
    this.replaceVote = null;    // { targetId, votes: {playerId: bool}, startedAt }
    this.lastVoteResult = null; // { targetName, success, ts }
  }

  // El turno cambió: se reinicia el reloj de demora.
  _touchTurn() {
    this.turnStartedAt = Date.now();
  }

  // -------- Jugadores --------

  get order() {
    return this.players.map((p) => p.id);
  }

  getPlayer(id) {
    return this.players.find((p) => p.id === id);
  }

  addPlayer({ id, name, avatar, skin }) {
    const existing = this.getPlayer(id);
    if (existing) {
      if (existing.isBot) return { ok: false, error: 'Ya no estás en esta partida (te reemplazó la IA).' };
      existing.connected = true;
      if (name) existing.name = name;
      if (avatar) existing.avatar = avatar;
      if (skin) existing.skin = skin;
      return { ok: true };
    }
    if (this.phase !== PHASES.LOBBY) return { ok: false, error: 'La partida ya empezó.' };
    if (this.players.length >= MAX_PLAYERS) return { ok: false, error: 'La sala está llena (máx. 10).' };
    this.players.push({ id, name, avatar, skin: skin || 's1', connected: true });
    if (!this.hostId) this.hostId = id;
    if (this.scores[id] === undefined) this.scores[id] = 0;
    return { ok: true };
  }

  setConnected(id, connected) {
    const p = this.getPlayer(id);
    if (p) p.connected = connected;
  }

  removePlayer(id) {
    // Sólo se quita de verdad si estamos en lobby; si la partida está en curso
    // se marca desconectado para no romper el orden.
    if (this.phase === PHASES.LOBBY) {
      this.players = this.players.filter((p) => p.id !== id);
      if (this.hostId === id) this.hostId = this.players[0] ? this.players[0].id : null;
    } else {
      this.setConnected(id, false);
    }
  }

  // -------- Opciones (en el lobby) --------

  setOptions(byId, opts) {
    if (byId !== this.hostId) return { ok: false, error: 'Sólo el anfitrión cambia las opciones.' };
    if (this.phase !== PHASES.LOBBY) return { ok: false, error: 'Sólo se puede cambiar en la sala de espera.' };
    if (opts && typeof opts.idaYVuelta === 'boolean') this.options.idaYVuelta = opts.idaYVuelta;
    return { ok: true };
  }

  // Índice de la ronda "pico" (la de más cartas). Con ida y vuelta, al
  // terminarla se muestra el resultado parcial.
  get peakRoundIndex() {
    if (!this.roundsPlan.length) return -1;
    const max = Math.max(...this.roundsPlan);
    return this.roundsPlan.indexOf(max);
  }

  // -------- Inicio de partida --------

  start(byId) {
    if (byId !== this.hostId) return { ok: false, error: 'Sólo el anfitrión puede empezar.' };
    if (this.players.length < 2) return { ok: false, error: 'Hacen falta al menos 2 jugadores.' };
    if (this.phase !== PHASES.LOBBY) return { ok: false, error: 'La partida ya empezó.' };

    this.roundsPlan = E.roundsPlan(this.players.length, this.options.idaYVuelta);
    this.roundIndex = 0;
    this.dealerIndex = Math.floor(Math.random() * this.players.length); // repartidor al azar
    this.players.forEach((p) => (this.scores[p.id] = 0));
    this.startRound();
    return { ok: true };
  }

  startRound() {
    const ids = this.order;
    this.cardsThisRound = this.roundsPlan[this.roundIndex];
    const { hands, muestra } = E.deal(ids, this.cardsThisRound);
    this.hands = hands;
    this.muestra = muestra;
    this.bets = {};
    this.tricksWon = {};
    ids.forEach((id) => (this.tricksWon[id] = 0));
    this.currentTrick = [];
    this.lastTrick = null;
    this.roundTricks = [];
    this.trickPause = false;
    this.accusedThisRound = {};
    this.lastAccusation = null;

    this.bettingSeq = E.bettingOrder(ids, this.dealerIndex);
    this.bettingPos = 0;
    this.phase = PHASES.BETTING;
    this.replaceVote = null;
    this._touchTurn();
  }

  get trumpSuit() {
    return this.muestra ? this.muestra.suit : null;
  }

  currentTurnId() {
    if (this.phase === PHASES.BETTING) {
      const idx = this.bettingSeq[this.bettingPos];
      return this.order[idx];
    }
    if (this.phase === PHASES.PLAYING) {
      if (this.trickPause) return null; // pausa: se está mostrando quién ganó la mano
      const idx = this.playSeq[this.playPos];
      return this.order[idx];
    }
    return null;
  }

  // -------- Apuestas --------

  placeBet(playerId, bet) {
    if (this.phase !== PHASES.BETTING) return { ok: false, error: 'No es momento de apostar.' };
    if (this.currentTurnId() !== playerId) return { ok: false, error: 'No es tu turno de apostar.' };

    const isDealer = this.bettingPos === this.bettingSeq.length - 1;
    const sumOthers = Object.values(this.bets).reduce((a, b) => a + b, 0);
    if (!E.isValidBet(bet, this.cardsThisRound, sumOthers, isDealer)) {
      return { ok: false, error: 'Apuesta inválida.' };
    }
    // Si estaban votando reemplazarlo por demora y respondió, se cancela la votación.
    this.cancelVoteFor(playerId);
    this.bets[playerId] = bet;
    this.bettingPos++;
    this._touchTurn();

    if (this.bettingPos >= this.bettingSeq.length) {
      // Todos apostaron: arranca el juego, mano = jugador a la derecha del repartidor.
      this.phase = PHASES.PLAYING;
      this.trickLeaderIndex = this.bettingSeq[0];
      this.playSeq = rotationFrom(this.trickLeaderIndex, this.players.length);
      this.playPos = 0;
      this.currentTrick = [];
    }
    return { ok: true };
  }

  forbiddenBetFor(playerId) {
    // Devuelve el número prohibido si este jugador es el repartidor y le toca.
    const isDealer = this.bettingPos === this.bettingSeq.length - 1 &&
      this.currentTurnId() === playerId;
    if (!isDealer) return null;
    const sumOthers = Object.values(this.bets).reduce((a, b) => a + b, 0);
    return E.forbiddenDealerBet(sumOthers, this.cardsThisRound);
  }

  // -------- Juego de cartas --------

  playCard(playerId, card) {
    if (this.phase !== PHASES.PLAYING) return { ok: false, error: 'No es momento de jugar.' };
    if (this.trickPause) return { ok: false, error: 'Esperá, se está mostrando quién ganó la mano.' };
    if (this.currentTurnId() !== playerId) return { ok: false, error: 'No es tu turno.' };

    const hand = this.hands[playerId] || [];
    // Se PERMITE jugar cualquier carta, aunque viole las reglas. Guardamos si fue
    // legal para poder resolver una eventual acusación de "renuncio".
    const legal = E.isLegalPlay(hand, this.currentTrick, this.trumpSuit, card);

    const idx = hand.findIndex((c) => c.suit === card.suit && c.rank === card.rank);
    if (idx === -1) return { ok: false, error: 'No tenés esa carta.' };
    // Si estaban votando reemplazarlo por demora y respondió, se cancela la votación.
    this.cancelVoteFor(playerId);
    const played = hand.splice(idx, 1)[0];
    this.currentTrick.push({ playerId, card: played, legal });
    this.playPos++;
    this._touchTurn();

    if (this.currentTrick.length >= this.players.length) {
      this.resolveTrick();
    }
    return { ok: true };
  }

  resolveTrick() {
    const wi = E.trickWinnerIndex(this.currentTrick, this.trumpSuit);
    const winnerId = this.currentTrick[wi].playerId;
    this.tricksWon[winnerId] = (this.tricksWon[winnerId] || 0) + 1;
    this.lastTrick = {
      plays: this.currentTrick.map((p) => ({ playerId: p.playerId, card: p.card, legal: p.legal })),
      winnerId,
      leaderIndex: this.trickLeaderIndex,
    };
    this.roundTricks.push(this.lastTrick);
    this.currentTrick = [];

    // Pausa de 2s: la mesa muestra la carta ganadora resaltada y nadie puede
    // jugar. El servidor llama a finishTrick() cuando pasa el tiempo.
    this.trickPause = true;
  }

  // Cierra la pausa de fin de mano: pasa a la siguiente mano o termina la ronda.
  finishTrick() {
    if (!this.trickPause) return { ok: false };
    this.trickPause = false;
    const winnerId = this.lastTrick ? this.lastTrick.winnerId : null;

    // ¿Quedan cartas?
    const anyCardsLeft = this.order.some((id) => (this.hands[id] || []).length > 0);
    if (!anyCardsLeft) {
      this.endRound();
      return { ok: true };
    }
    // La próxima mano la abre quien ganó.
    this.trickLeaderIndex = this.order.indexOf(winnerId);
    this.playSeq = rotationFrom(this.trickLeaderIndex, this.players.length);
    this.playPos = 0;
    this._touchTurn();
    return { ok: true };
  }

  endRound() {
    const results = {};
    this.order.forEach((id) => {
      const bet = this.bets[id] || 0;
      const won = this.tricksWon[id] || 0;
      const pts = E.roundPoints(bet, won);
      results[id] = { bet, won, pts, fulfilled: bet === won };
      this.scores[id] += pts;
    });
    this.roundHistory.push({
      round: this.roundIndex + 1,
      cards: this.cardsThisRound,
      muestra: this.muestra,
      dealerId: this.order[this.dealerIndex],
      results,
    });

    // Con ida y vuelta, al terminar la ronda más grande (fin de la "ida")
    // se muestra el resultado parcial.
    this.halfwayJustEnded = this.options.idaYVuelta && this.roundIndex === this.peakRoundIndex;

    if (this.roundIndex + 1 >= this.roundsPlan.length) {
      this.phase = PHASES.GAME_OVER;
      const max = Math.max(...this.order.map((id) => this.scores[id]));
      this.winnerIds = this.order.filter((id) => this.scores[id] === max);
    } else {
      this.phase = PHASES.ROUND_END;
    }
  }

  // Avanza de ronda (rota el repartidor). Uso interno, sin chequeo de anfitrión.
  advanceRound() {
    if (this.phase !== PHASES.ROUND_END) return { ok: false };
    this.roundIndex++;
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length; // rota el repartidor
    this.startRound();
    return { ok: true };
  }

  nextRound(byId) {
    if (byId !== this.hostId) return { ok: false, error: 'Sólo el anfitrión avanza de ronda.' };
    if (this.phase !== PHASES.ROUND_END) return { ok: false, error: 'No corresponde avanzar ahora.' };
    return this.advanceRound();
  }

  playAgain(byId) {
    if (byId !== this.hostId) return { ok: false, error: 'Sólo el anfitrión reinicia.' };
    if (this.phase !== PHASES.GAME_OVER) return { ok: false, error: 'La partida no terminó.' };
    this.roundsPlan = E.roundsPlan(this.players.length, this.options.idaYVuelta);
    this.roundIndex = 0;
    this.dealerIndex = Math.floor(Math.random() * this.players.length);
    this.players.forEach((p) => (this.scores[p.id] = 0));
    this.roundHistory = [];
    this.winnerIds = [];
    this.startRound();
    return { ok: true };
  }

  // -------- Renuncio (acusación de jugada ilegal) --------

  _returnCardsToHands(plays) {
    plays.forEach((p) => {
      const h = this.hands[p.playerId];
      if (h) h.push(p.card);
    });
  }

  accuse(accuserId, accusedId) {
    if (this.phase !== PHASES.PLAYING) return { ok: false, error: 'Solo podés acusar durante el juego.' };
    if (!this.getPlayer(accusedId)) return { ok: false, error: 'Ese jugador no existe.' };
    if (accuserId === accusedId) return { ok: false, error: 'No podés acusarte a vos mismo.' };
    if (this.accusedThisRound[accuserId]) return { ok: false, error: 'Ya usaste tu acusación esta ronda.' };
    if (!this.roundTricks.length && !this.currentTrick.length) {
      return { ok: false, error: 'No hay ninguna jugada para revisar todavía.' };
    }

    this.accusedThisRound[accuserId] = true; // se consume, haya acertado o no
    const accuserName = this.getPlayer(accuserId).name;
    const accusedName = this.getPlayer(accusedId).name;

    // La acusación revisa TODAS las jugadas hechas hasta este momento en la
    // ronda (manos ya resueltas + la mano en curso). Buscamos la PRIMERA
    // infracción del acusado.
    let badTrickIdx = -1; // índice en roundTricks
    for (let k = 0; k < this.roundTricks.length; k++) {
      if (this.roundTricks[k].plays.some((p) => p.playerId === accusedId && p.legal === false)) {
        badTrickIdx = k;
        break;
      }
    }
    const badInCurrent = badTrickIdx === -1 &&
      this.currentTrick.some((p) => p.playerId === accusedId && p.legal === false);

    if (badTrickIdx === -1 && !badInCurrent) {
      this.lastAccusation = { accuserName, accusedName, correct: false, ts: Date.now() };
      return { ok: true };
    }

    // Acusación correcta: -5 al infractor y se repite desde la mano de la
    // infracción (las manos posteriores de esta ronda quedan anuladas).
    this.scores[accusedId] = (this.scores[accusedId] || 0) - 5;

    let leaderIndex;
    if (badInCurrent) {
      // La infracción está en la mano en curso: se devuelven esas cartas.
      this._returnCardsToHands(this.currentTrick);
      leaderIndex = this.trickLeaderIndex;
    } else {
      // Se anulan la mano infractora y todas las posteriores (manos ganadas
      // incluidas), y también la mano en curso.
      for (let j = badTrickIdx; j < this.roundTricks.length; j++) {
        const t = this.roundTricks[j];
        this.tricksWon[t.winnerId] = Math.max(0, (this.tricksWon[t.winnerId] || 0) - 1);
        this._returnCardsToHands(t.plays);
      }
      this._returnCardsToHands(this.currentTrick);
      leaderIndex = this.roundTricks[badTrickIdx].leaderIndex;
      this.roundTricks = this.roundTricks.slice(0, badTrickIdx);
    }

    this.currentTrick = [];
    this.lastTrick = this.roundTricks.length ? this.roundTricks[this.roundTricks.length - 1] : null;
    this.trickPause = false; // si había pausa de fin de mano, se corta
    this.trickLeaderIndex = leaderIndex;
    this.playSeq = rotationFrom(leaderIndex, this.players.length);
    this.playPos = 0;
    this.phase = PHASES.PLAYING;
    this._touchTurn();
    this.lastAccusation = { accuserName, accusedName, correct: true, ts: Date.now() };
    return { ok: true };
  }

  // -------- Jugadores lentos: votación de reemplazo por IA --------

  // Jugadores habilitados a votar: todos menos el acusado, los bots y los desconectados.
  eligibleVoters(targetId) {
    return this.players
      .filter((p) => p.id !== targetId && !p.isBot && p.connected)
      .map((p) => p.id);
  }

  turnElapsedMs() {
    return this.turnStartedAt ? Date.now() - this.turnStartedAt : 0;
  }

  startReplaceVote(byId, targetId) {
    if (this.phase !== PHASES.BETTING && this.phase !== PHASES.PLAYING) {
      return { ok: false, error: 'No es momento de votar.' };
    }
    if (this.replaceVote) return { ok: false, error: 'Ya hay una votación en curso.' };
    const target = this.getPlayer(targetId);
    const voter = this.getPlayer(byId);
    if (!target || target.isBot) return { ok: false, error: 'Ese jugador no se puede reemplazar.' };
    if (!voter || voter.isBot) return { ok: false, error: 'No podés iniciar la votación.' };
    if (byId === targetId) return { ok: false, error: 'No podés votarte a vos mismo.' };
    if (this.currentTurnId() !== targetId) return { ok: false, error: 'Sólo se puede votar al jugador que está demorando su turno.' };
    if (this.turnElapsedMs() < SLOW_TURN_MS) return { ok: false, error: 'Todavía no pasaron los 20 segundos.' };
    this.replaceVote = { targetId, votes: { [byId]: true }, startedAt: Date.now() };
    return this._checkVote();
  }

  voteReplace(byId, yes) {
    if (!this.replaceVote) return { ok: false, error: 'No hay ninguna votación en curso.' };
    const voter = this.getPlayer(byId);
    if (!voter || voter.isBot) return { ok: false, error: 'No podés votar.' };
    if (byId === this.replaceVote.targetId) return { ok: false, error: 'El acusado no vota.' };
    this.replaceVote.votes[byId] = !!yes;
    return this._checkVote();
  }

  // Evalúa la votación: UN voto en contra la cancela; se aprueba sólo si
  // TODOS los habilitados votaron que sí (unanimidad).
  _checkVote() {
    const rv = this.replaceVote;
    if (!rv) return { ok: true };
    const target = this.getPlayer(rv.targetId);
    const targetName = target ? target.name : '?';
    if (Object.values(rv.votes).some((v) => v === false)) {
      this.replaceVote = null;
      this.lastVoteResult = { targetName, success: false, ts: Date.now() };
      return { ok: true };
    }
    const voters = this.eligibleVoters(rv.targetId);
    const allYes = voters.length > 0 && voters.every((id) => rv.votes[id] === true);
    if (allYes) {
      this._makeBot(rv.targetId);
      this.replaceVote = null;
      this.lastVoteResult = { targetName, success: true, ts: Date.now() };
    }
    return { ok: true };
  }

  cancelVoteFor(playerId) {
    if (this.replaceVote && this.replaceVote.targetId === playerId) this.replaceVote = null;
  }

  // Convierte a un jugador en bot (IA básica): queda fuera de la partida
  // pero sus cartas las sigue jugando el servidor.
  _makeBot(playerId) {
    const p = this.getPlayer(playerId);
    if (!p) return;
    p.isBot = true;
    p.connected = false;
    if (this.hostId === playerId) {
      const h = this.players.find((q) => !q.isBot);
      this.hostId = h ? h.id : null;
    }
    if (this.replaceVote) {
      // Si era el acusado, la votación muere; si era un votante, se recuenta.
      if (this.replaceVote.targetId === playerId) this.replaceVote = null;
      else { delete this.replaceVote.votes[playerId]; this._checkVote(); }
    }
  }

  // -------- Abandono voluntario --------

  abandon(playerId) {
    const p = this.getPlayer(playerId);
    if (!p) return { ok: false, error: 'No estás en la partida.' };
    if (this.phase === PHASES.LOBBY || this.phase === PHASES.GAME_OVER) {
      // Sin partida en curso: se lo quita del todo.
      this.players = this.players.filter((q) => q.id !== playerId);
      if (this.hostId === playerId) {
        const h = this.players.find((q) => !q.isBot);
        this.hostId = h ? h.id : null;
      }
      return { ok: true };
    }
    // Partida en curso: la IA básica sigue jugando por él.
    this._makeBot(playerId);
    return { ok: true };
  }

  // -------- IA básica --------

  // Actúa por el jugador de turno si es un bot. La usa el servidor con un
  // pequeño delay para que se sienta natural.
  botAct() {
    const turnId = this.currentTurnId();
    if (!turnId) return { ok: false };
    const p = this.getPlayer(turnId);
    if (!p || !p.isBot) return { ok: false };

    if (this.phase === PHASES.BETTING) {
      // Estimación simple: cuenta muestras y cartas fuertes (1 y 3).
      const hand = this.hands[turnId] || [];
      let est = hand.filter((c) => c.suit === this.trumpSuit || c.rank === 1 || c.rank === 3).length;
      est = Math.max(0, Math.min(this.cardsThisRound, est));
      const isDealer = this.bettingPos === this.bettingSeq.length - 1;
      const sumOthers = Object.values(this.bets).reduce((a, b) => a + b, 0);
      let bet = null;
      for (let d = 0; d <= this.cardsThisRound && bet === null; d++) {
        for (const cand of [est - d, est + d]) {
          if (cand >= 0 && cand <= this.cardsThisRound && E.isValidBet(cand, this.cardsThisRound, sumOthers, isDealer)) {
            bet = cand; break;
          }
        }
      }
      return this.placeBet(turnId, bet == null ? 0 : bet);
    }

    if (this.phase === PHASES.PLAYING && !this.trickPause) {
      const legal = E.legalCards(this.hands[turnId] || [], this.currentTrick, this.trumpSuit);
      if (!legal.length) return { ok: false };
      // Juega la carta legal más barata (evita gastar muestra si puede).
      const cost = (c) => (c.suit === this.trumpSuit ? 100 : 0) + E.cardStrength(c.rank);
      legal.sort((a, b) => cost(a) - cost(b));
      return this.playCard(turnId, legal[0]);
    }
    return { ok: false };
  }

  addMessage(playerId, text) {
    const msg = { playerId, text: String(text).slice(0, 120), ts: Date.now() };
    this.messages.push(msg);
    if (this.messages.length > 50) this.messages.shift();
    return msg;
  }

  // -------- Vista para un jugador (sólo ve sus cartas) --------

  viewFor(viewerId) {
    const turnId = this.currentTurnId();
    const myLegal = (this.phase === PHASES.PLAYING && turnId === viewerId)
      ? E.legalCards(this.hands[viewerId] || [], this.currentTrick, this.trumpSuit).map(E.cardId)
      : null;

    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      youAreHost: viewerId === this.hostId,
      players: this.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        skin: p.skin || 's1',
        isBot: !!p.isBot,
        connected: p.connected,
        seat: i,
        isDealer: i === this.dealerIndex && this.phase !== PHASES.LOBBY,
        score: this.scores[p.id] || 0,
        bet: this.bets[p.id] != null ? this.bets[p.id] : null,
        hasBet: this.bets[p.id] != null,
        tricksWon: this.tricksWon[p.id] || 0,
        cardCount: (this.hands[p.id] || []).length,
        isTurn: p.id === turnId,
      })),
      roundIndex: this.roundIndex,
      totalRounds: this.roundsPlan.length,
      cardsThisRound: this.cardsThisRound,
      options: this.options,
      trickPause: this.trickPause,
      isHalfway: this.phase === PHASES.ROUND_END && !!this.halfwayJustEnded,
      turnElapsed: turnId ? this.turnElapsedMs() : 0,
      slowTurnMs: SLOW_TURN_MS,
      replaceVote: this.replaceVote ? (() => {
        const rv = this.replaceVote;
        const t = this.getPlayer(rv.targetId);
        const voters = this.eligibleVoters(rv.targetId);
        return {
          targetId: rv.targetId,
          targetName: t ? t.name : '?',
          yes: voters.filter((id) => rv.votes[id] === true).length,
          needed: voters.length,
          youAreTarget: viewerId === rv.targetId,
          yourVote: rv.votes[viewerId] != null ? rv.votes[viewerId] : null,
          canVote: viewerId !== rv.targetId && voters.includes(viewerId) && rv.votes[viewerId] == null,
        };
      })() : null,
      lastVoteResult: this.lastVoteResult,
      muestra: this.muestra,
      trumpSuit: this.trumpSuit,
      currentTrick: this.currentTrick.map((p) => ({ playerId: p.playerId, card: p.card })),
      lastTrick: this.lastTrick
        ? { plays: this.lastTrick.plays.map((p) => ({ playerId: p.playerId, card: p.card })), winnerId: this.lastTrick.winnerId }
        : null,
      canAccuse: this.phase === PHASES.PLAYING && !this.accusedThisRound[viewerId],
      lastAccusation: this.lastAccusation,
      turnId,
      myId: viewerId,
      myHand: this.hands[viewerId] || [],
      myLegal,
      forbiddenBet: this.forbiddenBetFor(viewerId),
      roundHistory: this.roundHistory,
      winnerIds: this.winnerIds,
      messages: this.messages.slice(-12),
    };
  }
}

module.exports = { Game, PHASES, MAX_PLAYERS, SLOW_TURN_MS };
