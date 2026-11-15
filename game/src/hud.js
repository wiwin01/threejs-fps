// The HUD: every DOM readout and panel. main.js calls these setters as state changes; the HUD
// itself holds no game state. Layout mirrors the brief: health and money bottom-left, weapon and
// ammo bottom-right, timer and round score top-centre, kill feed top-right.
export function createHud() {
  const el = (id) => document.getElementById(id);
  const healthNum = el('health-num');
  const healthFill = el('health-fill');
  const armourTag = el('armour-tag');
  const ammoMag = el('ammo-mag');
  const ammoReserve = el('ammo-reserve');
  const ammoBox = el('ammo');
  const weaponName = el('weapon-name');
  const grenadeCount = el('grenade-count');
  const moneyEl = el('money');
  const timerEl = el('timer');
  const scoreW = el('score-w');
  const scoreB = el('score-b');
  const roundLabel = el('round-label');
  const feed = el('killfeed');
  const bannerEl = el('banner');
  const bannerTitle = el('banner-title');
  const bannerSub = el('banner-sub');
  const progressBox = el('progress');
  const progressFill = el('progress-fill');
  const progressLabel = el('progress-label');
  const hitEl = el('hitmarker');
  const damageEl = el('damage');
  const scopeEl = el('scope');
  const crosshair = el('crosshair');
  const buyEl = el('buy');
  const buyItems = el('buy-items');
  const buyMoney = el('buy-money');
  const overlay = el('overlay');
  const overlayTitle = el('overlay-title');
  const overlayCopy = el('overlay-copy');
  const playBtn = el('play');
  let bannerTimer = 0;
  let hitTimer = 0;

  return {
    onPlay(cb) { playBtn.addEventListener('click', cb); },
    setHealth(hp, armour) {
      healthNum.textContent = String(Math.max(0, Math.ceil(hp)));
      healthFill.style.width = `${Math.max(0, hp)}%`;
      healthFill.style.background = hp > 50 ? 'var(--ok)' : hp > 25 ? 'var(--accent)' : 'var(--danger)';
      armourTag.hidden = !armour;
    },
    setAmmo(mag, reserve, reloading) {
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = reloading ? 'RELOADING' : `/ ${reserve}`;
      ammoBox.classList.toggle('empty', mag === 0 && !reloading);
    },
    setWeapon(name) { weaponName.textContent = name; },
    setGrenades(n) { grenadeCount.textContent = n > 0 ? `Shard × ${n} (G)` : ''; },
    setMoney(m) { moneyEl.textContent = `$${m}`; },
    setTimer(seconds, urgent) {
      const s = Math.max(0, Math.ceil(seconds));
      timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      timerEl.classList.toggle('urgent', !!urgent);
    },
    setScores(w, b, round) {
      scoreW.textContent = String(w);
      scoreB.textContent = String(b);
      roundLabel.textContent = `ROUND ${round}`;
    },
    kill(text, mine) {
      const row = document.createElement('div');
      row.className = mine ? 'feed-row mine' : 'feed-row';
      row.textContent = text;
      feed.prepend(row);
      while (feed.children.length > 5) feed.lastChild.remove();
      setTimeout(() => row.remove(), 4200);
    },
    banner(title, sub = '', ms = 2600) {
      bannerTitle.textContent = title;
      bannerSub.textContent = sub;
      bannerEl.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { bannerEl.hidden = true; }, ms);
    },
    hideBanner() { bannerEl.hidden = true; },
    progress(frac, label) {
      if (frac === null) {
        progressBox.hidden = true;
        return;
      }
      progressBox.hidden = false;
      progressFill.style.width = `${Math.round(frac * 100)}%`;
      progressLabel.textContent = label;
    },
    hitMarker(kill) {
      hitEl.classList.toggle('kill', kill);
      hitEl.classList.add('on');
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitEl.classList.remove('on'), kill ? 260 : 110);
    },
    damageFlash() {
      damageEl.classList.remove('flash');
      void damageEl.offsetWidth; // restart the CSS animation
      damageEl.classList.add('flash');
    },
    setScope(on) {
      scopeEl.hidden = !on;
      crosshair.style.opacity = on ? '0' : '1';
    },
    setSpread(px) {
      crosshair.style.setProperty('--gap', `${Math.round(px)}px`);
    },
    // Buy menu: items = [{key, label, price, state: 'owned'|'buy'|'poor'}]
    showBuy(items, money) {
      buyMoney.textContent = `$${money}`;
      buyItems.innerHTML = '';
      for (const item of items) {
        const row = document.createElement('div');
        row.className = `buy-row ${item.state}`;
        row.innerHTML = `<kbd>${item.key}</kbd><span class="buy-label"></span><span class="buy-price"></span>`;
        row.querySelector('.buy-label').textContent = item.label;
        row.querySelector('.buy-price').textContent = item.state === 'owned' ? 'OWNED' : `$${item.price}`;
        buyItems.appendChild(row);
      }
      buyEl.hidden = false;
    },
    hideBuy() { buyEl.hidden = true; },
    showOverlay(kind, data = {}) {
      overlay.hidden = false;
      if (kind === 'start') {
        overlayTitle.textContent = 'KESTREL YARD';
        overlayCopy.textContent = 'Defend the crane pad. Breakers are coming to plant a breach charge: stop them, or defuse it. First to 7 rounds.';
        playBtn.textContent = 'Click to play';
      } else if (kind === 'paused') {
        overlayTitle.textContent = 'Paused';
        overlayCopy.textContent = 'The round waits for no one — but this menu does. Click to jump back in.';
        playBtn.textContent = 'Back in';
      } else if (kind === 'matchEnd') {
        overlayTitle.textContent = data.won ? 'YARD HELD' : 'YARD LOST';
        overlayCopy.textContent = `Final score — Wardens ${data.w} : ${data.b} Breakers. Click to play another match.`;
        playBtn.textContent = 'Play again';
      }
    },
    hideOverlay() { overlay.hidden = true; },
  };
}
