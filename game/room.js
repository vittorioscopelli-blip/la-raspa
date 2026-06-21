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
  }

  // -------- Jugadores --------

  get order() {
    return this.players.map((p) => p.id);
  }

  getPlayer(id) {
    return this.players.find((p) => p.id === id);
  }

  addPlayer({ id, name, avatar }) {
    const existing = this.getPlayer(id);
    if (existing) {
      existing.connected = true;
      if (name) existing.name = name;
      if (avatar) existing.avatar = avatar;
      return { ok: true };
    }
    if (this.phase !== PHASES.LOBBY) return { ok: false, error: 'La partida ya empezó.' };
    if (this.players.length >= MAX_PLAYERS) return { ok: false, error: 'La sala está llena (máx. 10).' };
    this.players.push({ id, name, avatar, connected: true });
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

  // -------- Inicio de partida --------

  start(byId) {
    if (byId !== this.hostId) return { ok: false, error: 'Sólo el anfitrión puede empezar.' };
    if (this.players.length < 2) return { ok: false, error: 'Hacen falta al menos 2 jugadores.' };
    if (this.phase !== PHASES.LOBBY) return { ok: false, error: 'La partida ya empezó.' };

    this.roundsPlan = E.roundsPlan(this.players.length);
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
    this.accusedThisRound = {};
    this.lastAccusation = null;

    this.bettingSeq = E.bettingOrder(ids, this.dealerIndex);
    this.bettingPos = 0;
    this.phase = PHASES.BETTING;
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
    this.bets[playerId] = bet;
    this.bettingPos++;

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
    if (this.currentTurnId() !== playerId) return { ok: false, error: 'No es tu turno.' };

    const hand = this.hands[playerId] || [];
    // Se PERMITE jugar cualquier carta, aunque viole las reglas. Guardamos si fue
    // legal para poder resolver una eventual acusación de "renuncio".
    const legal = E.isLegalPlay(hand, this.currentTrick, this.trumpSuit, card);

    const idx = hand.findIndex((c) => c.suit === card.suit && c.rank === card.rank);
    if (idx === -1) return { ok: false, error: 'No tenés esa carta.' };
    const played = hand.splice(idx, 1)[0];
    this.currentTrick.push({ playerId, card: played, legal });
    this.playPos++;

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
    this.currentTrick = [];

    // ¿Quedan cartas?
    const anyCardsLeft = this.order.some((id) => (this.hands[id] || []).length > 0);
    if (!anyCardsLeft) {
      this.endRound();
      return;
    }
    // La próxima mano la abre quien ganó.
    this.trickLeaderIndex = this.order.indexOf(winnerId);
    this.playSeq = rotationFrom(this.trickLeaderIndex, this.players.length);
    this.playPos = 0;
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
    this.roundsPlan = E.roundsPlan(this.players.length);
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

    // La "mano en cuestión": la que se está jugando, o la última si ya se resolvió
    // y todavía no se jugó ninguna carta de la siguiente.
    let plays, leaderIndex, fromLast;
    if (this.currentTrick.length > 0) {
      plays = this.currentTrick; leaderIndex = this.trickLeaderIndex; fromLast = false;
    } else if (this.lastTrick) {
      plays = this.lastTrick.plays; leaderIndex = this.lastTrick.leaderIndex; fromLast = true;
    } else {
      return { ok: false, error: 'No hay ninguna mano para revisar todavía.' };
    }

    this.accusedThisRound[accuserId] = true; // se consume, haya acertado o no
    const accuserName = this.getPlayer(accuserId).name;
    const accusedName = this.getPlayer(accusedId).name;
    const offended = plays.some((p) => p.playerId === accusedId && p.legal === false);

    if (!offended) {
      this.lastAccusation = { accuserName, accusedName, correct: false, ts: Date.now() };
      return { ok: true };
    }

    // Acusación correcta: -5 al infractor y se repite la mano.
    this.scores[accusedId] = (this.scores[accusedId] || 0) - 5;
    this._returnCardsToHands(plays);
    if (fromLast) {
      const w = this.lastTrick.winnerId;
      this.tricksWon[w] = Math.max(0, (this.tricksWon[w] || 0) - 1);
    }
    this.currentTrick = [];
    this.lastTrick = null;
    this.trickLeaderIndex = leaderIndex;
    this.playSeq = rotationFrom(leaderIndex, this.players.length);
    this.playPos = 0;
    this.phase = PHASES.PLAYING;
    this.lastAccusation = { accuserName, accusedName, correct: true, ts: Date.now() };
    return { ok: true };
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

module.exports = { Game, PHASES, MAX_PLAYERS };
