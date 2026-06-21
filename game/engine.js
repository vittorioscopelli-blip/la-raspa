// ============================================================
//  La Raspa - Motor de reglas (lógica pura, sin red ni UI)
// ============================================================
'use strict';

const SUITS = ['oros', 'copas', 'espadas', 'bastos'];
const RANKS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];

// De más fuerte a más débil: 1 > 3 > Rey > Caballo > Sota > 7 > 6 > 5 > 4 > 2
const STRENGTH_ORDER = [1, 3, 12, 11, 10, 7, 6, 5, 4, 2];
const STRENGTH = {};
STRENGTH_ORDER.forEach((rank, i) => { STRENGTH[rank] = STRENGTH_ORDER.length - i; });

const RANK_NAME = { 1: 'As', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 10: 'Sota', 11: 'Caballo', 12: 'Rey' };

function cardId(card) { return card.rank + '-' + card.suit; }
function cardStrength(rank) { return STRENGTH[rank]; }
function cardLabel(card) { return RANK_NAME[card.rank] + ' de ' + card.suit; }

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ suit, rank });
  return deck;
}

function shuffle(deck, rng = Math.random) {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// jugadores * cartas + 1 (muestra) <= 40, tope 7
function maxCardsPerRound(numPlayers) {
  return Math.max(1, Math.min(7, Math.floor((40 - 1) / numPlayers)));
}

function roundsPlan(numPlayers) {
  const max = maxCardsPerRound(numPlayers);
  const plan = [];
  for (let i = 1; i <= max; i++) plan.push(i);
  return plan;
}

function deal(playerIds, cardsPerPlayer, rng = Math.random) {
  const deck = shuffle(buildDeck(), rng);
  const hands = {};
  playerIds.forEach((id) => (hands[id] = []));
  let k = 0;
  for (let c = 0; c < cardsPerPlayer; c++) {
    for (const id of playerIds) hands[id].push(deck[k++]);
  }
  const muestra = deck[k++];
  return { hands, muestra };
}

// Empieza el jugador a la derecha del repartidor; el repartidor apuesta último.
function bettingOrder(playerIds, dealerIndex) {
  const n = playerIds.length;
  const order = [];
  for (let i = 1; i <= n; i++) order.push((dealerIndex + i) % n);
  return order;
}

function forbiddenDealerBet(sumOfOtherBets, cardsThisRound) {
  const forbidden = cardsThisRound - sumOfOtherBets;
  if (forbidden >= 0 && forbidden <= cardsThisRound) return forbidden;
  return null;
}

function isValidBet(bet, cardsThisRound, sumOfOtherBets, isDealer) {
  if (!Number.isInteger(bet) || bet < 0 || bet > cardsThisRound) return false;
  if (isDealer) {
    const forbidden = forbiddenDealerBet(sumOfOtherBets, cardsThisRound);
    if (forbidden !== null && bet === forbidden) return false;
  }
  return true;
}

function legalCards(hand, trick, trumpSuit) {
  if (!trick || trick.length === 0) return hand.slice();
  const ledSuit = trick[0].card.suit;
  const best = trick[trickWinnerIndex(trick, trumpSuit)].card; // la carta que va ganando
  const ledCards = hand.filter((c) => c.suit === ledSuit);
  if (ledCards.length > 0) {
    // Hay que seguir el palo de salida; si podés ganarla con una carta más
    // grande del mismo palo, estás OBLIGADO a jugar una que gane (no podés tirar más baja).
    const winning = ledCards.filter((c) => beats(c, best, ledSuit, trumpSuit));
    return winning.length > 0 ? winning : ledCards;
  }
  // No tenés el palo de salida: si podés ganar con muestra, estás obligado a hacerlo.
  const trumps = hand.filter((c) => c.suit === trumpSuit);
  const winningTrumps = trumps.filter((c) => beats(c, best, ledSuit, trumpSuit));
  if (winningTrumps.length > 0) return winningTrumps;
  // No podés ganar (sin muestra, o muestra más chica que la que cortó): cualquier carta.
  return hand.slice();
}

function isLegalPlay(hand, trick, trumpSuit, card) {
  return legalCards(hand, trick, trumpSuit).some((c) => c.suit === card.suit && c.rank === card.rank);
}

function trickWinnerIndex(trick, trumpSuit) {
  const ledSuit = trick[0].card.suit;
  let bestIdx = 0, best = trick[0].card;
  for (let i = 1; i < trick.length; i++) {
    if (beats(trick[i].card, best, ledSuit, trumpSuit)) { best = trick[i].card; bestIdx = i; }
  }
  return bestIdx;
}

function beats(challenger, current, ledSuit, trumpSuit) {
  const cTrump = challenger.suit === trumpSuit;
  const curTrump = current.suit === trumpSuit;
  if (cTrump && !curTrump) return true;
  if (!cTrump && curTrump) return false;
  if (cTrump && curTrump) return cardStrength(challenger.rank) > cardStrength(current.rank);
  if (challenger.suit !== ledSuit) return false;
  if (current.suit !== ledSuit) return true;
  return cardStrength(challenger.rank) > cardStrength(current.rank);
}

// 1 punto por cada mano ganada SIEMPRE; +5 de bonus si cumple la apuesta exacta.
function roundPoints(bet, tricksWon) {
  return tricksWon + (bet === tricksWon ? 5 : 0);
}

module.exports = {
  SUITS, RANKS, STRENGTH_ORDER, RANK_NAME,
  cardId, cardLabel, cardStrength,
  buildDeck, shuffle, maxCardsPerRound, roundsPlan, deal,
  bettingOrder, forbiddenDealerBet, isValidBet,
  legalCards, isLegalPlay, trickWinnerIndex, beats, roundPoints,
};
