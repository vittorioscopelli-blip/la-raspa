// Tests del motor de La Raspa. Correr: node test/engine.test.js
'use strict';
const E = require('../game/engine');
const { Game } = require('../game/room');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  x ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' (esperado ' + JSON.stringify(b) + ', dio ' + JSON.stringify(a) + ')'); }
const C = (rank, suit) => ({ rank, suit });

// Mazo
const deck = E.buildDeck();
eq(deck.length, 40, 'mazo tiene 40 cartas');
ok(!deck.some((c) => c.rank === 8 || c.rank === 9), 'no hay 8 ni 9');

// Orden de fuerza
ok(E.cardStrength(1) > E.cardStrength(3), '1 > 3');
ok(E.cardStrength(3) > E.cardStrength(12), '3 > Rey');
ok(E.cardStrength(12) > E.cardStrength(11), 'Rey > Caballo');
ok(E.cardStrength(11) > E.cardStrength(10), 'Caballo > Sota');
ok(E.cardStrength(10) > E.cardStrength(7), 'Sota > 7');
ok(E.cardStrength(7) > E.cardStrength(2), '7 > 2');
ok(E.cardStrength(2) === Math.min.apply(null, E.RANKS.map(E.cardStrength)), '2 es la mas debil');

// Ganador sin triunfo: sigue el palo de salida
let trick = [
  { playerId: 'a', card: C(7, 'espadas') },
  { playerId: 'b', card: C(3, 'espadas') },
  { playerId: 'c', card: C(1, 'copas') },
];
eq(E.trickWinnerIndex(trick, 'oros'), 1, 'gana el 3 de espadas, no el 1 de copas');

// Triunfo gana a cualquier palo
trick = [
  { playerId: 'a', card: C(1, 'espadas') },
  { playerId: 'b', card: C(2, 'oros') },
];
eq(E.trickWinnerIndex(trick, 'oros'), 1, 'el 2 de oros (triunfo) gana al As de espadas');

// Entre triunfos gana el mas fuerte
trick = [
  { playerId: 'a', card: C(3, 'oros') },
  { playerId: 'b', card: C(1, 'oros') },
  { playerId: 'c', card: C(12, 'oros') },
];
eq(E.trickWinnerIndex(trick, 'oros'), 1, 'entre triunfos gana el As');

// Seguir el palo
let hand = [C(1, 'espadas'), C(7, 'oros'), C(5, 'copas')];
let cur = [{ playerId: 'x', card: C(3, 'espadas') }];
eq(E.legalCards(hand, cur, 'oros').map(E.cardId), ['1-espadas'], 'debe seguir espadas');

// Sin el palo: debe tirar muestra
hand = [C(7, 'oros'), C(5, 'copas')];
cur = [{ playerId: 'x', card: C(3, 'espadas') }];
eq(E.legalCards(hand, cur, 'oros').map(E.cardId), ['7-oros'], 'sin espadas, debe tirar muestra');

// Cortada con muestra: debe superar si puede
hand = [C(1, 'oros'), C(5, 'copas')];
cur = [{ playerId: 'x', card: C(7, 'espadas') }, { playerId: 'y', card: C(2, 'oros') }];
eq(E.legalCards(hand, cur, 'oros').map(E.cardId), ['1-oros'], 'debe superar la muestra');

// Cortada y solo muestra mas chica: cualquier carta
hand = [C(2, 'oros'), C(5, 'copas')];
cur = [{ playerId: 'x', card: C(7, 'espadas') }, { playerId: 'y', card: C(1, 'oros') }];
eq(E.legalCards(hand, cur, 'oros').map(E.cardId).sort(), ['2-oros', '5-copas'], 'con muestra mas chica, cualquier carta');

// Sin muestra y cortada: cualquier carta
hand = [C(5, 'copas'), C(7, 'bastos')];
cur = [{ playerId: 'x', card: C(7, 'espadas') }, { playerId: 'y', card: C(1, 'oros') }];
eq(E.legalCards(hand, cur, 'oros').map(E.cardId).sort(), ['5-copas', '7-bastos'], 'sin muestra y cortada, cualquier carta');

// Plan de rondas (ida y vuelta)
eq(E.roundsPlan(2), [1, 2, 3, 4, 5, 6, 7], 'plan normal 2 jugadores: 1..7');
eq(E.roundsPlan(2, true), [1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1], 'ida y vuelta 2 jugadores: 1..7..1');
eq(E.roundsPlan(10), [1, 2, 3], 'plan normal 10 jugadores: 1..3');
eq(E.roundsPlan(10, true), [1, 2, 3, 2, 1], 'ida y vuelta 10 jugadores: 1..3..1');

// Apuesta del repartidor
eq(E.forbiddenDealerBet(1, 2), 1, 'prohibido = cartas - suma otros');
ok(!E.isValidBet(1, 2, 1, true), 'repartidor no puede apostar el prohibido');
ok(E.isValidBet(0, 2, 1, true), 'repartidor si puede apostar otro');
ok(E.isValidBet(1, 2, 1, false), 'jugador normal si puede apostar 1');
eq(E.forbiddenDealerBet(5, 2), null, 'sin prohibido alcanzable');

// Puntaje: 1 por mano siempre, +5 si cumple exacto
eq(E.roundPoints(2, 2), 7, 'cumple 2: 5 + 2 = 7');
eq(E.roundPoints(0, 0), 5, 'cumple 0 sin manos: 5');
eq(E.roundPoints(0, 1), 1, 'aposto 0 e hizo 1: 1 punto');
eq(E.roundPoints(2, 1), 1, 'no cumple pero hizo 1: 1 punto');
eq(E.roundPoints(1, 3), 3, 'hizo 3 sin cumplir: 3 puntos');
eq(E.roundPoints(3, 3), 8, 'cumple 3: 5 + 3 = 8');

// ---- Nueva regla: obligación de ganar con una carta mayor del mismo palo ----
// Tengo 3 y 2 de espadas; va ganando el 7 de espadas. Debo tirar el 3 (gana), no el 2.
let h2 = [C(3, 'espadas'), C(2, 'espadas'), C(5, 'copas')];
let t2 = [{ playerId: 'x', card: C(7, 'espadas') }];
eq(E.legalCards(h2, t2, 'oros').map(E.cardId), ['3-espadas'], 'obligado a ganar con el 3, no tirar el 2');

// Si no puedo ganar (va ganando el 3, sólo tengo 2 y 5 de espadas), puedo tirar cualquiera del palo.
h2 = [C(2, 'espadas'), C(5, 'espadas')];
t2 = [{ playerId: 'x', card: C(3, 'espadas') }];
eq(E.legalCards(h2, t2, 'oros').map(E.cardId).sort(), ['2-espadas', '5-espadas'], 'no puedo ganar: cualquier carta del palo');

// Palo de salida = muestra: también obligado a superar.
h2 = [C(1, 'oros'), C(2, 'oros')];
t2 = [{ playerId: 'x', card: C(3, 'oros') }];
eq(E.legalCards(h2, t2, 'oros').map(E.cardId), ['1-oros'], 'con muestra de salida, obligado a superar con el As');

// ============================================================
//  Renuncio (acusación de jugada ilegal)
// ============================================================
function makePlayingGame() {
  const g = new Game('T');
  g.addPlayer({ id: 'A', name: 'Ana', avatar: 'a01' });
  g.addPlayer({ id: 'B', name: 'Beto', avatar: 'a01' });
  g.phase = 'playing';
  g.roundsPlan = [1, 2]; g.roundIndex = 1; g.cardsThisRound = 2;
  g.muestra = C(5, 'oros'); // triunfo: oros
  g.bets = { A: 0, B: 0 }; g.tricksWon = { A: 0, B: 0 }; g.scores = { A: 0, B: 0 };
  g.hands = { A: [C(1, 'espadas'), C(2, 'espadas')], B: [C(3, 'espadas'), C(7, 'oros')] };
  g.currentTrick = []; g.trickLeaderIndex = 0; g.playSeq = [0, 1]; g.playPos = 0;
  g.accusedThisRound = {};
  return g;
}

// Se permite jugar una carta ILEGAL.
let g2 = makePlayingGame();
ok(g2.playCard('A', C(1, 'espadas')).ok, 'A abre con espadas (legal)');
ok(g2.playCard('B', C(7, 'oros')).ok, 'B puede jugar 7 de oros aunque sea ilegal (no tenía que cortar, tenía espadas)');
ok(g2.lastTrick && g2.lastTrick.plays.some((x) => x.playerId === 'B' && x.legal === false), 'la jugada de B quedó marcada como ilegal');
ok(g2.tricksWon['B'] === 1, 'B ganó la mano con la muestra (antes de acusar)');

// Pausa de fin de mano: nadie puede jugar hasta que el servidor la cierre.
ok(g2.trickPause === true, 'al resolver la mano arranca la pausa');
ok(!g2.playCard('B', C(3, 'espadas')).ok, 'no se puede jugar durante la pausa');
ok(g2.currentTurnId() === null, 'durante la pausa no hay turno');

// Acusación CORRECTA: -5 y se repite la mano.
let acc = g2.accuse('A', 'B');
ok(acc.ok, 'acusación procesada');
ok(g2.lastAccusation.correct === true, 'la acusación es correcta');
eq(g2.scores['B'], -5, 'B pierde 5 puntos');
eq(g2.tricksWon['B'], 0, 'se le quita la mano ganada a B');
ok(g2.hands['A'].some((c) => E.cardId(c) === '1-espadas'), 'a A le vuelve su carta');
ok(g2.hands['B'].some((c) => E.cardId(c) === '7-oros'), 'a B le vuelve su carta');
ok(g2.currentTrick.length === 0 && g2.phase === 'playing', 'la mano se reinicia');
ok(!g2.accuse('A', 'B').ok, 'A no puede acusar de nuevo esta ronda');

// Acusación INCORRECTA: B juega bien, A acusa, se consume sin penalizar.
let g3 = makePlayingGame();
g3.playCard('A', C(1, 'espadas'));
g3.playCard('B', C(3, 'espadas')); // legal: sigue el palo (no puede ganar)
let acc2 = g3.accuse('A', 'B');
ok(acc2.ok && g3.lastAccusation.correct === false, 'acusación incorrecta marcada');
eq(g3.scores['B'], 0, 'B no pierde puntos si jugó bien');
ok(!g3.accuse('A', 'B').ok, 'igual se consumió la acusación de A');

// Acusación RETROACTIVA: la infracción fue en una mano ANTERIOR de la ronda.
// Se anulan esa mano y las posteriores, y se repite desde ahí.
let g4 = makePlayingGame();
g4.playCard('A', C(1, 'espadas'));
g4.playCard('B', C(7, 'oros'));      // ilegal: tenía espadas
ok(g4.finishTrick().ok, 'se cierra la pausa de la mano 1');
eq(g4.tricksWon['B'], 1, 'B se llevó la mano 1');
g4.playCard('B', C(3, 'espadas'));   // arranca la mano 2 (B ganó la anterior)
let acc3 = g4.accuse('A', 'B');      // A se da cuenta recién ahora
ok(acc3.ok && g4.lastAccusation.correct === true, 'acusación retroactiva correcta');
eq(g4.scores['B'], -5, 'B pierde 5 puntos');
eq(g4.tricksWon['B'], 0, 'se anula la mano que B había ganado');
eq(g4.hands['A'].length, 2, 'A recupera todas sus cartas');
eq(g4.hands['B'].length, 2, 'B recupera todas sus cartas (incluida la de la mano en curso)');
eq(g4.roundTricks.length, 0, 'no quedan manos resueltas: se repite desde la infracción');
eq(g4.currentTurnId(), 'A', 'vuelve a abrir A, que era la mano de la jugada anulada');
ok(g4.trickPause === false, 'sin pausa pendiente tras la acusación');

// Acusación durante la pausa de fin de mano también funciona.
let g5 = makePlayingGame();
g5.playCard('A', C(1, 'espadas'));
g5.playCard('B', C(7, 'oros'));      // ilegal
ok(g5.trickPause === true, 'pausa activa');
let acc4 = g5.accuse('A', 'B');
ok(acc4.ok && g5.lastAccusation.correct === true, 'se puede acusar durante la pausa');
eq(g5.tricksWon['B'], 0, 'se anuló la mano de B');
eq(g5.currentTurnId(), 'A', 'se repite la mano desde A');

// Simulacion de partida completa
function simulate(numPlayers, idaYVuelta) {
  const g = new Game('TEST');
  for (let i = 0; i < numPlayers; i++) g.addPlayer({ id: 'P' + i, name: 'J' + i, avatar: 'a01' });
  if (idaYVuelta) g.options.idaYVuelta = true;
  ok(g.start('P0').ok, 'partida de ' + numPlayers + ' arranca');
  let guard = 0;
  while (g.phase !== 'gameOver' && guard++ < 5000) {
    if (g.phase === 'betting') {
      const turn = g.currentTurnId();
      const isDealer = g.bettingPos === g.bettingSeq.length - 1;
      const sumOthers = Object.values(g.bets).reduce((a, b) => a + b, 0);
      let bet = 0;
      for (let b = 0; b <= g.cardsThisRound; b++) { if (E.isValidBet(b, g.cardsThisRound, sumOthers, isDealer)) { bet = b; break; } }
      ok(g.placeBet(turn, bet).ok, 'apuesta aceptada');
    } else if (g.phase === 'playing') {
      if (g.trickPause) { g.finishTrick(); continue; } // simula el timer del servidor
      const turn = g.currentTurnId();
      const legal = E.legalCards(g.hands[turn], g.currentTrick, g.trumpSuit);
      ok(legal.length > 0, 'siempre hay jugada legal');
      ok(g.playCard(turn, legal[0]).ok, 'jugada aceptada');
    } else if (g.phase === 'roundEnd') {
      ok(g.nextRound('P0').ok, 'avanza de ronda');
    }
  }
  ok(g.phase === 'gameOver', 'partida de ' + numPlayers + ' termina en gameOver');
  eq(g.roundHistory.length, E.roundsPlan(numPlayers, !!idaYVuelta).length,
    'se jugaron todas las rondas (' + (idaYVuelta ? 'ida y vuelta' : 'normal') + ')');
  g.roundHistory.forEach((h) => {
    const totalWon = Object.values(h.results).reduce((a, r) => a + r.won, 0);
    eq(totalWon, h.cards, 'ronda ' + h.round + ': manos ganadas suman ' + h.cards);
    // Las manos ganadas deben coincidir con la suma de puntos por manos
    const sumTrickPts = Object.values(h.results).reduce((a, r) => a + r.won, 0);
    eq(sumTrickPts, h.cards, 'consistencia de manos ronda ' + h.round);
  });
  return g;
}
[2, 3, 4, 5, 7, 10].forEach((n) => simulate(n));
[2, 3, 10].forEach((n) => simulate(n, true)); // modo ida y vuelta

console.log('\nResultado: ' + pass + ' ok, ' + fail + ' fallos.');
process.exit(fail ? 1 : 0);
