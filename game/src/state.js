// The match: one object holding every piece of round state — phase, timers, scores, the player's
// money, the charge — plus the rules that move between phases. main.js feeds it kills, plants and
// defuses, reads its event queue for banners and sounds, and renders from it. Nothing here touches
// the DOM or three.js.

export const BUY_TIME = 12;
export const ROUND_TIME = 100;
export const DETONATE_TIME = 40;
export const ROUND_END_TIME = 4.5;
export const ROUNDS_TO_WIN = 7;
export const MAX_ROUNDS = 12;

const ECON = {
  winElim: 1400,
  winObjective: 1900,
  lossBase: 1000,
  lossStreakStep: 200,
  kill: 300,
  plantTeam: 300,
  startMoney: 800,
  moneyCap: 10000,
};

export function createMatch() {
  const match = {
    round: 0,
    phase: 'idle', // buy | live | planted | roundEnd | matchEnd
    phaseLeft: 0,
    scores: { wardens: 0, breakers: 0 },
    lossStreak: { wardens: 0, breakers: 0 },
    playerMoney: ECON.startMoney,
    charge: { planted: false, carrierId: null, x: 0, z: 0 },
    lastRound: null, // {winner, reason}
    matchWinner: null,
    events: [],
  };

  function emit(type, data = {}) {
    match.events.push({ type, ...data });
  }

  function endRound(winner, reason) {
    match.scores[winner] += 1;
    const loser = winner === 'wardens' ? 'breakers' : 'wardens';
    match.lossStreak[winner] = 0;
    match.lossStreak[loser] += 1;
    const objective = reason === 'detonation' || reason === 'defuse';
    const winPay = objective ? ECON.winObjective : ECON.winElim;
    const lossPay = ECON.lossBase + ECON.lossStreakStep * Math.min(4, match.lossStreak[loser] - 1);
    // The player is a Warden: pay them for their own team's result.
    match.playerMoney = Math.min(ECON.moneyCap, match.playerMoney + (winner === 'wardens' ? winPay : lossPay));
    match.lastRound = { winner, reason };
    emit('roundEnd', { winner, reason });
    const decided = match.scores.wardens >= ROUNDS_TO_WIN || match.scores.breakers >= ROUNDS_TO_WIN
      || match.round >= MAX_ROUNDS;
    if (decided) {
      match.phase = 'matchEnd';
      match.matchWinner = match.scores.wardens === match.scores.breakers
        ? (winner) // a drawn scoreline at the cap goes to the last round's winner
        : (match.scores.wardens > match.scores.breakers ? 'wardens' : 'breakers');
      emit('matchEnd', { winner: match.matchWinner });
    } else {
      match.phase = 'roundEnd';
      match.phaseLeft = ROUND_END_TIME;
    }
  }

  return {
    state: match,
    drainEvents() {
      const out = match.events.slice();
      match.events.length = 0;
      return out;
    },
    startMatch() {
      match.round = 0;
      match.scores.wardens = 0;
      match.scores.breakers = 0;
      match.lossStreak.wardens = 0;
      match.lossStreak.breakers = 0;
      match.playerMoney = ECON.startMoney;
      match.matchWinner = null;
      this.startRound();
    },
    startRound() {
      match.round += 1;
      match.phase = 'buy';
      match.phaseLeft = BUY_TIME;
      match.charge.planted = false;
      match.charge.carrierId = null;
      emit('roundStart', { round: match.round });
    },
    // Called every simulation step with the living counts; resolves timers and endings.
    update(dt, alive) {
      if (match.phase === 'buy') {
        match.phaseLeft -= dt;
        if (match.phaseLeft <= 0) {
          match.phase = 'live';
          match.phaseLeft = ROUND_TIME;
          emit('live');
        }
        return;
      }
      if (match.phase === 'roundEnd') {
        match.phaseLeft -= dt;
        if (match.phaseLeft <= 0) this.startRound();
        return;
      }
      if (match.phase !== 'live' && match.phase !== 'planted') return;
      match.phaseLeft -= dt;

      if (match.charge.planted) {
        if (alive.wardens === 0) return endRound('breakers', 'elimination');
        if (match.phaseLeft <= 0) return endRound('breakers', 'detonation');
        return;
      }
      if (alive.breakers === 0) return endRound('wardens', 'elimination');
      if (alive.wardens === 0) return endRound('breakers', 'elimination');
      if (match.phaseLeft <= 0) return endRound('wardens', 'time');
    },
    onKill(killerTeam) {
      if (killerTeam === 'wardens') {
        match.playerMoney = Math.min(ECON.moneyCap, match.playerMoney + ECON.kill);
      }
    },
    onPlanted() {
      match.charge.planted = true;
      match.phase = 'planted';
      match.phaseLeft = DETONATE_TIME;
      emit('planted');
    },
    onDefused() {
      endRound('wardens', 'defuse');
    },
    spend(amount) {
      if (match.playerMoney < amount) return false;
      match.playerMoney -= amount;
      return true;
    },
  };
}

// Bot kits by round: cheap early, rifles once the match warms up. The charge carrier is chosen
// by main.js; this only decides guns.
export function botWeaponFor(team, index, round, random) {
  if (round <= 1) return index === 0 ? 'smg' : 'pistol';
  const roll = random();
  if (team === 'breakers') return roll < 0.55 ? 'rifle' : roll < 0.85 ? 'smg' : 'shotgun';
  return roll < 0.6 ? 'rifle' : roll < 0.9 ? 'smg' : 'shotgun';
}
