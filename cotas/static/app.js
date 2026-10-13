import { quotaTiming, cardPresentation, DEFAULT_POPOVER, createPopoverState, popoverContent, popoverDate, formatDuration, liftDigits } from './quota.mjs';
import { setupTilt } from './tilt.mjs';

const intervals = { codex: 300, claude: 300, antigravity: 1200 };
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const container = document.querySelector('#accounts');
const connection = document.querySelector('#connection-status');
const cards = new Map();
const tips = new WeakMap();
const shapes = new WeakMap();
let keyboardFocus = true;
let editingCard = null;
let titleRevision = 0;
let openQuota = null;
let countdownTimer = null;
const digits = new WeakMap();
const popoverSettings = { ...DEFAULT_POPOVER };
const popovers = createPopoverState({ settings: popoverSettings, onChange: showPopover });
const tilt = setupTilt(document, location.search, settings => {
  for (const key of Object.keys(DEFAULT_POPOVER)) popoverSettings[key] = settings[key];
  setVar(document.documentElement, '--popover-entry', `${popoverSettings.entryDuration}ms`);
  setVar(document.documentElement, '--popover-scale', String(popoverSettings.entryScale));
  setVar(document.documentElement, '--popover-curve', `cubic-bezier(0.34, ${1 + popoverSettings.bounce}, 0.64, 1)`);
});
const tipObserver = new ResizeObserver(entries => {
  for (const entry of entries) {
    if (entry.target.classList.contains('is-open')) positionPopover(tips.get(entry.target));
  }
});
const shapeObserver = new ResizeObserver(entries => {
  for (const entry of entries) {
    const shape = shapes.get(entry.target);
    const { offsetWidth: width, offsetHeight: height } = entry.target;
    const radius = Math.min(parseFloat(getComputedStyle(entry.target).getPropertyValue('--radius')), width / 2, height / 2);
    const s = 1 - Math.pow(2, -0.25);
    const controls = [[1 - 4 * s, 0], [1 - 2 * s, 0], [1 - s, s], [1, 2 * s], [1, 4 * s], [1, 1]];
    // Two cubics per corner: tangent and curvature stay continuous at the joins.
    const corners = [
      { start: [width - radius, 0], point: (x, y) => [width - radius + x * radius, y * radius] },
      { start: [width, height - radius], point: (x, y) => [width - y * radius, height - radius + x * radius] },
      { start: [radius, height], point: (x, y) => [radius - x * radius, height - y * radius] },
      { start: [0, radius], point: (x, y) => [y * radius, radius - x * radius] },
    ];
    let path = `M ${radius} 0`;
    for (const corner of corners) {
      path += ` L ${corner.start.join(' ')} C ${controls.slice(0, 3).map(p => corner.point(...p).join(' ')).join(' ')} C ${controls.slice(3).map(p => corner.point(...p).join(' ')).join(' ')}`;
    }
    for (const svg of [shape, entry.target.querySelector('.query-ring svg')]) {
      setAttribute(svg, 'viewBox', `0 0 ${width} ${height}`);
      setAttribute(svg.querySelector('path'), 'd', path + ' Z');
    }
  }
});

// The 250 ms clock rewrites every field; writing only on change keeps steady state free of layout and repaint.
function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

function setHidden(element, hidden) {
  if (element.hidden !== hidden) element.hidden = hidden;
}

function setAttribute(element, name, value) {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function setVar(element, name, value) {
  if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
}

function percent(value) {
  return Number.isFinite(value) ? `${number.format(value)}%` : 'sem dados';
}

function setDigits(element, value) {
  let state = digits.get(element);
  if (state?.value === value) return;
  if (!state) {
    state = { value: null, slots: new Map() };
    digits.set(element, state);
    element.classList.add('lift-number');
  }
  const changes = liftDigits(state.value, value);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Capture removed places before rearranging the surviving ones.
  for (const change of changes.filter(d => d.value === null)) {
    const slot = state.slots.get(change.key);
    if (!change.changed) { state.slots.delete(change.key); slot.remove(); continue; }
    setVar(slot, 'left', `${slot.offsetLeft}px`);
    slot.classList.add('lift-removed');
    for (const layer of slot.children) {
      setVar(layer, '--lift-y', reduced ? '0%' : '-40%');
      setVar(layer, '--lift-opacity', '0');
    }
    slot.cleanup = setTimeout(() => { slot.remove(); state.slots.delete(change.key); }, reduced ? 140 : 240);
  }
  let reference = [...element.children].find(slot => !slot.classList.contains('lift-removed')) || null;
  for (const change of changes.filter(d => d.value !== null)) {
    let slot = state.slots.get(change.key);
    if (!slot) {
      slot = document.createElement('span');
      slot.className = /^[if]\d+$/.test(change.key) ? 'lift-place lift-digit' : 'lift-place';
      setAttribute(slot, 'aria-hidden', 'true');
      state.slots.set(change.key, slot);
    }
    clearTimeout(slot.cleanup);
    slot.classList.remove('lift-removed');
    setVar(slot, 'left', '');
    if (slot !== reference) element.insertBefore(slot, reference);
    reference = slot.nextElementSibling;
    while (reference?.classList.contains('lift-removed')) reference = reference.nextElementSibling;
    if (change.changed || !slot.children.length) {
      let incoming = [...slot.children].find(layer => layer.textContent === change.value);
      for (const layer of slot.children) {
        clearTimeout(layer.cleanup);
        if (layer === incoming) continue;
        setVar(layer, '--lift-y', reduced ? '0%' : '-40%');
        setVar(layer, '--lift-opacity', '0');
        layer.cleanup = setTimeout(() => layer.remove(), reduced ? 140 : 240);
      }
      if (!incoming) {
        incoming = document.createElement('span');
        incoming.className = 'lift-layer';
        setText(incoming, change.value);
        setVar(incoming, '--lift-y', change.changed && !reduced ? '40%' : '0%');
        setVar(incoming, '--lift-opacity', change.changed ? '0' : '1');
        slot.append(incoming);
        if (change.changed) void incoming.offsetWidth;
      }
      // Reused layers keep their in-flight computed position: CSS retargets from it.
      clearTimeout(incoming.cleanup);
      setVar(incoming, '--lift-y', '0%');
      setVar(incoming, '--lift-opacity', '1');
    }
  }
  state.value = value;
  setAttribute(element, 'aria-label', value);
}

function updateContour(quota, now) {
  const timing = quotaTiming(quota.window, now);
  setHidden(quota.contour, openQuota !== quota || timing.expired || timing.cursor_percent === null
    || timing.cursor_percent >= 100);
}

function updateCountdown() {
  if (!openQuota) return;
  const now = Date.now() / 1000;
  const reset = openQuota.window?.resets_at;
  setText(openQuota.main.time, formatDuration(Number.isFinite(reset) ? reset - now : null, { seconds: true }));
  updateContour(openQuota, now);
}

function resetTime(window) {
  return popoverDate(window?.resets_at);
}

function reopens(window, now) {
  if (!Number.isFinite(window?.resets_at)) return 'reabertura sem dados';
  const duration = formatDuration(window.resets_at - now);
  return duration === 'a confirmar' ? 'reabertura a confirmar' : `reabre em ${duration}`;
}

function makeTipWindow(dominant = false) {
  const element = document.createElement('section');
  element.className = dominant ? 'tip-main' : 'tip-window';
  const meter = '<div class="tip-meter" aria-hidden="true"><span class="tip-fill"></span><span class="tip-cursor"></span></div>';
  element.innerHTML = dominant ? `<div class="tip-window-heading"><h3></h3><span class="tip-reset"></span></div>
    <div class="tip-time"><span>Tempo</span><strong></strong></div>
    ${meter}
    <dl class="tip-quota"><div><dt>Cota usada</dt><dd class="tip-used"></dd></div><div><dt>Cota livre</dt><dd class="tip-free"></dd></div></dl>
    <dl class="tip-pace"><div><dt>Ritmo</dt><dd></dd></div></dl>`
    : `<div class="tip-window-heading"><h3></h3><span class="tip-reset-row"><strong class="tip-duration"></strong><span class="tip-reset"></span></span></div>
      <div class="tip-compact-usage">${meter}<span class="tip-summary">usada <span class="tip-used"></span> · livre <span class="tip-free"></span></span></div>`;
  const reset = element.querySelector('.tip-reset');
  if (dominant) element.querySelector('.tip-time').append(reset);
  return { element, label: element.querySelector('h3'), reset,
    time: element.querySelector(dominant ? '.tip-time strong' : '.tip-duration'), used: element.querySelector('.tip-used'),
    free: element.querySelector('.tip-free'), fill: element.querySelector('.tip-fill'),
    cursor: element.querySelector('.tip-cursor'), pace: element.querySelector('.tip-pace'),
    paceValue: element.querySelector('.tip-pace dd') };
}

function updateTipWindow(block, data, updateTime = true) {
  setText(block.label, data.label);
  setText(block.reset, data.reset);
  if (updateTime) setText(block.time, data.time.value);
  setText(block.used, data.rows[0][1]);
  setText(block.free, data.rows[1][1]);
  setVar(block.fill, 'width', `${Math.min(100, Math.max(0, data.used ?? 0))}%`);
  setVar(block.cursor, 'left', `${data.cursor ?? 0}%`);
  setHidden(block.cursor, data.cursor === null);
  block.element.classList.toggle('is-alert', data.alert);
  if (block.pace) {
    setText(block.paceValue, data.pace);
    setHidden(block.pace, !data.pace);
  }
}

function updatePopover(quota, account, now) {
  const data = popoverContent(account, quota.key, now);
  updateTipWindow(quota.main, data.main, openQuota !== quota);
  updateTipWindow(quota.other, data.other);
  setHidden(quota.third, !data.third);
  if (data.third) data.third.windows.forEach((window, i) =>
    updateTipWindow(quota.thirdWindows[i], { ...window, label: `${data.third.label} · ${window.label}` }));
  const secondary = [data.other, ...(data.third?.windows || [])];
  quota.secondaryPace.forEach((row, i) => {
    const window = secondary[i];
    setHidden(row.element, !window?.pace);
    if (window?.pace) {
      setText(row.label, `${i ? '3p · ' : ''}${window.label} · Ritmo`);
      setText(row.value, window.pace);
    }
  });
  setText(quota.observation, data.observation);
  setText(quota.explanation, data.explanation);
  setHidden(quota.explanation, !data.explanation);
  setText(quota.error, data.error);
  setHidden(quota.errorRow, !data.error);
}

// Popovers live outside the transformed card, so viewport limits remain real limits.
function positionPopover(quota) {
  const tip = quota.tooltip;
  const anchor = quota.track.getBoundingClientRect();
  const cursor = parseFloat(quota.element.style.getPropertyValue('--cursor')) / 100;
  const x = anchor.left + anchor.width * (quota.cursor.hidden ? 0.5 : cursor);
  const y = anchor.top + anchor.height / 2;
  const margin = 12, gap = 12;
  const width = Math.min(382, innerWidth - margin * 2);
  setVar(tip, 'width', `${width}px`);
  const side = innerWidth > 760 && anchor.right + gap + width <= innerWidth - margin;
  let left, top, placement, height;
  if (side) {
    setVar(tip, 'max-height', `${innerHeight - margin * 2}px`);
    height = tip.offsetHeight;
    left = anchor.right + gap;
    top = Math.max(margin, Math.min(innerHeight - height - margin, y - height / 2));
    placement = 'side';
  } else {
    left = Math.max(margin, Math.min(innerWidth - width - margin, x - width / 2));
    const aboveSpace = anchor.top - gap - margin;
    const belowSpace = innerHeight - margin - anchor.bottom - gap;
    const naturalHeight = tip.scrollHeight + 2;
    const above = aboveSpace >= naturalHeight || (belowSpace < naturalHeight && aboveSpace > belowSpace);
    placement = above ? 'above' : 'below';
    setVar(tip, 'max-height', `${Math.max(80, Math.min(innerHeight - margin * 2, above ? aboveSpace : belowSpace))}px`);
    height = tip.offsetHeight;
    top = above ? anchor.top - gap - height : anchor.bottom + gap;
    top = Math.max(margin, Math.min(innerHeight - height - margin, top));
  }
  setVar(tip, 'left', `${Math.round(left)}px`);
  setVar(tip, 'top', `${Math.round(top)}px`);
  setAttribute(tip, 'data-placement', placement);
  const arrowX = Math.max(16, Math.min(width - 16, x - left));
  setVar(tip, '--anchor-x', `${Math.round(x - left)}px`);
  setVar(tip, '--anchor-y', `${Math.round(y - top)}px`);
  setHidden(quota.bridge, false);
  setAttribute(quota.bridge, 'data-placement', placement);
  if (side) {
    setVar(quota.bridge, 'left', `${Math.round(x)}px`);
    setVar(quota.bridge, 'top', `${Math.round(y - 9)}px`);
    setVar(quota.bridge, 'width', `${Math.round(left - x)}px`);
    setVar(quota.bridge, 'height', '18px');
  } else {
    setVar(quota.bridge, 'left', `${Math.round(left + arrowX - 5)}px`);
    setVar(quota.bridge, 'top', `${Math.round(placement === 'above' ? top + height - 5 : top - 5)}px`);
    setVar(quota.bridge, 'width', '10px');
    setVar(quota.bridge, 'height', '10px');
  }
}

function showPopover(quota, open, immediate) {
  clearTimeout(quota.hideTimer);
  clearInterval(countdownTimer);
  countdownTimer = null;
  if (open) {
    openQuota = quota;
    updateCountdown();
    countdownTimer = setInterval(updateCountdown, 1000);
    setHidden(quota.tooltip, false);
    quota.tooltip.classList.remove('is-closing');
    quota.tooltip.classList.toggle('is-instant', immediate);
    positionPopover(quota);
    // Commit the initial scale before starting an interruptible CSS transition.
    if (!immediate) void quota.tooltip.offsetWidth;
    quota.tooltip.classList.add('is-open');
    setAttribute(quota.tooltip, 'aria-hidden', 'false');
  } else {
    openQuota = null;
    setHidden(quota.contour, true);
    quota.tooltip.classList.remove('is-open', 'is-instant');
    quota.tooltip.classList.add('is-closing');
    setHidden(quota.bridge, true);
    setAttribute(quota.tooltip, 'aria-hidden', 'true');
    quota.hideTimer = setTimeout(() => setHidden(quota.tooltip, true),
      matchMedia('(prefers-reduced-motion: reduce)').matches ? 120 : 110);
  }
  setAttribute(quota.hit, 'aria-expanded', String(open));
}

function makeQuota(key, label, id) {
  const element = document.createElement('div');
  element.className = `quota ${key === 'weekly' ? 'weekly' : 'primary'}`;
  element.innerHTML = `<div class="quota-heading"><span class="quota-label"></span><span class="used"></span><span class="reopens"></span></div>
    <div class="track"><span class="fill"></span><span class="remaining-contour" aria-hidden="true" hidden></span><span class="cursor" aria-hidden="true"></span></div>
    <button class="quota-hit" type="button" aria-expanded="false"></button>`;
  element.querySelector('.quota-label').textContent = label;
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.id = `${id}-${key}-detail`;
  tooltip.hidden = true;
  tooltip.setAttribute('role', 'tooltip');
  tooltip.setAttribute('aria-hidden', 'true');
  const main = makeTipWindow(true), other = makeTipWindow();
  const third = document.createElement('section');
  third.className = 'tip-third';
  const thirdWindows = [makeTipWindow(), makeTipWindow()];
  third.append(...thirdWindows.map(w => w.element));
  const footer = document.createElement('footer');
  footer.innerHTML = `<p class="tip-explanation"></p><dl class="tip-error"><div><dt>Última consulta não concluída</dt><dd></dd></div></dl>
    <div class="tip-observation"><span>Observação</span><span></span></div>`;
  const secondaryPace = Array.from({ length: 3 }, () => {
    const element = document.createElement('dl');
    element.className = 'tip-pace';
    element.innerHTML = '<div><dt></dt><dd></dd></div>';
    footer.insertBefore(element, footer.querySelector('.tip-explanation'));
    return { element, label: element.querySelector('dt'), value: element.querySelector('dd') };
  });
  tooltip.append(main.element, other.element, third, footer);
  const bridge = document.createElement('div');
  bridge.className = 'tooltip-bridge';
  bridge.hidden = true;
  bridge.setAttribute('aria-hidden', 'true');
  document.body.append(bridge, tooltip);
  const quota = { element, key, label, track: element.querySelector('.track'),
    contour: element.querySelector('.remaining-contour'),
    fill: element.querySelector('.fill'), cursor: element.querySelector('.cursor'),
    used: element.querySelector('.used'), reopens: element.querySelector('.reopens'),
    hit: element.querySelector('.quota-hit'), tooltip, bridge, main, other, third, thirdWindows, secondaryPace,
    observation: footer.querySelector('.tip-observation span:last-child'), explanation: footer.querySelector('.tip-explanation'),
    errorRow: footer.querySelector('.tip-error'), error: footer.querySelector('.tip-error dd') };
  quota.hit.setAttribute('aria-describedby', tooltip.id);
  quota.hit.addEventListener('pointerenter', event => {
    if (!editingCard && event.pointerType !== 'touch') popovers.enter(quota, event.clientX, event.clientY);
  });
  quota.hit.addEventListener('pointermove', event => {
    if (event.pointerType !== 'touch') popovers.move(quota, event.clientX, event.clientY);
  });
  quota.hit.addEventListener('pointerleave', () => popovers.leave(quota));
  for (const region of [tooltip, bridge]) {
    region.addEventListener('pointerenter', () => popovers.hold(quota));
    region.addEventListener('pointerleave', () => popovers.leave(quota));
  }
  quota.hit.addEventListener('focus', () => {
    if (!editingCard && (keyboardFocus || quota.hit.matches(':focus-visible'))) popovers.focus(quota);
  });
  quota.hit.addEventListener('blur', () => popovers.blur(quota));
  quota.hit.addEventListener('click', event => {
    if (editingCard) return;
    if (event.detail === 0 && keyboardFocus) popovers.focus(quota);
    else popovers.touch(quota);
  });
  tips.set(tooltip, quota);
  tipObserver.observe(tooltip);
  return quota;
}

function updateIdentity(card) {
  const presentation = cardPresentation({ ...card.account,
    title: card.saving ? card.pendingTitle : card.account.title });
  setText(card.titleText, presentation.title);
  setAttribute(card.title, 'title', presentation.title);
  setText(card.eyebrow, presentation.eyebrow);
  setHidden(card.eyebrow, !presentation.eyebrow);
  setHidden(card.rename, !card.account.email);
  card.rename.disabled = Boolean(card.saving);
}

function beginTitleEdit(card) {
  if (!card.account.email || card.saving || card.editing) return;
  if (editingCard) finishTitleEdit(editingCard, false);
  popovers.dismiss();
  editingCard = card;
  card.editing = true;
  card.slot.classList.add('is-editing');
  tilt.setEditing(card.slot, true);
  setHidden(card.titleError, true);
  card.editInitialTitle = cardPresentation(card.account).title;
  card.input.value = card.editInitialTitle;
  setHidden(card.title, true);
  setHidden(card.input, false);
  card.input.focus();
  card.input.select();
}

async function finishTitleEdit(card, save) {
  if (!card.editing) return;
  const title = card.input.value.trim();
  const previous = card.account.title || null;
  card.editing = false;
  editingCard = null;
  card.slot.classList.remove('is-editing');
  tilt.setEditing(card.slot, false);
  setHidden(card.input, true);
  setHidden(card.title, false);
  if (!save || title === card.editInitialTitle || (title || null) === previous) return;
  card.saving = true;
  card.pendingTitle = title || null;
  titleRevision++;
  updateIdentity(card);
  try {
    const response = await fetch('/api/preferences/title', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ harness: card.account.harness, email: card.account.email, title }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('title unavailable');
    const result = await response.json();
    card.account = { ...card.account, title: result.title };
  } catch {
    card.account = { ...card.account, title: previous };
    setText(card.titleError, 'Não foi possível salvar o nome.');
    setHidden(card.titleError, false);
  } finally {
    titleRevision++;
    card.saving = false;
    updateIdentity(card);
  }
}

function makeCard(account) {
  const element = document.createElement('article');
  element.className = 'card';
  element.innerHTML = `<svg class="card-surface" aria-hidden="true" focusable="false"><path></path></svg><span class="query-ring" aria-hidden="true"><span><svg focusable="false"><path></path></svg></span></span><span class="card-spotlight" aria-hidden="true"></span><header class="card-header"><div class="identity"><p class="card-eyebrow" hidden></p>
    <div class="title-row"><h2 class="card-title" tabindex="0"><span class="title-text"></span></h2>
      <input class="title-input" type="text" maxlength="40" aria-label="Título do card" autocomplete="off" hidden>
      <button class="rename-card" type="button" aria-label="Renomear card"><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5L9 20l-6 1 1-6Z M14 5l5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></button></div>
    <p class="account-label"></p><p class="title-error" role="status" hidden></p></div>
    <span class="model-tag" hidden></span></header><p class="card-status"></p>`;
  const quotas = [makeQuota('five_hour', '5h', account.id), makeQuota('weekly', 'Semana', account.id)];
  const status = element.querySelector('.card-status');
  for (const quota of quotas) element.insertBefore(quota.element, status);
  shapes.set(element, element.querySelector('.card-surface'));
  shapeObserver.observe(element);
  const slot = document.createElement('div');
  slot.className = 'card-slot';
  slot.append(element);
  const card = { element, slot, quotas, account, status, detachTilt: tilt.attach(slot, element),
    title: element.querySelector('.card-title'), titleText: element.querySelector('.title-text'),
    eyebrow: element.querySelector('.card-eyebrow'), rename: element.querySelector('.rename-card'),
    input: element.querySelector('.title-input'), titleError: element.querySelector('.title-error') };
  card.rename.addEventListener('click', () => beginTitleEdit(card));
  card.input.addEventListener('blur', () => finishTitleEdit(card, true));
  card.input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      finishTitleEdit(card, event.key === 'Enter');
      card.title.focus();
    }
  });
  return card;
}

function render(state) {
  setText(document.querySelector('#workspace-name'), state.workspace?.name?.trim() || 'Cotas');
  const accounts = state.accounts || [];
  setText(document.querySelector('#account-count'), `${accounts.length} ${accounts.length === 1 ? 'conta em uso' : 'contas em uso'}`);
  const present = new Set();
  for (const account of accounts) {
    present.add(account.id);
    let card = cards.get(account.id);
    if (!card) {
      card = makeCard(account);
      cards.set(account.id, card);
      container.append(card.slot);
    }
    card.account = account;
    setAttribute(card.element, 'data-harness', account.harness);
    setAttribute(card.element, 'aria-busy', String(account.querying));
    const presentation = cardPresentation(account);
    updateIdentity(card);
    const label = card.element.querySelector('.account-label');
    setText(label, presentation.accountLabel);
    setAttribute(label, 'title', presentation.accountLabel);
    const tag = card.element.querySelector('.model-tag');
    setHidden(tag, !presentation.tag);
    setText(tag, presentation.tag);
    setAttribute(tag, 'title', presentation.tag);
  }
  for (const [id, card] of cards) {
    if (!present.has(id)) {
      if (card.editing) finishTitleEdit(card, false);
      for (const quota of card.quotas) {
        tipObserver.unobserve(quota.tooltip);
        popovers.remove(quota);
        clearTimeout(quota.hideTimer);
        quota.tooltip.remove();
        quota.bridge.remove();
      }
      shapeObserver.unobserve(card.element);
      card.detachTilt();
      card.slot.remove();
      cards.delete(id);
    }
  }
  const empty = document.querySelector('#empty-state');
  setHidden(empty, accounts.length > 0);
  setHidden(connection, !state.discovery_error);
  setText(connection, state.discovery_error ? 'Não foi possível localizar os terminais. Últimos dados mantidos.' : '');
  tick();
}

function tick() {
  const now = Date.now() / 1000;
  for (const card of cards.values()) {
    const account = card.account;
    const observed = Number.isFinite(account.observed_at);
    const age = observed ? Math.max(0, now - account.observed_at) : null;
    const stale = observed && (age >= intervals[account.harness] || account.status === 'desatualizado');
    const ageLabel = observed ? `há ${Math.floor(age / 60)} min` : 'sem observação';
    card.element.classList.toggle('is-stale', stale);
    setText(card.status, stale ? ageLabel : '');
    const pool = account.harness === 'antigravity' ? account.pools.find(p => p.id === 'gemini') : account.pools[0];
    for (const quota of card.quotas) {
      const window = pool?.[quota.key];
      quota.window = window;
      const timing = quotaTiming(window, now);
      const used = Number.isFinite(window?.used_percent);
      quota.element.classList.toggle('is-missing', !used);
      quota.element.classList.toggle('is-alert', timing.alert);
      setDigits(quota.used, percent(window?.used_percent));
      setHidden(quota.reopens, quota.key === 'weekly');
      setText(quota.reopens, reopens(window, now));
      setVar(quota.fill, 'width', used ? `${Math.min(100, Math.max(0, window.used_percent))}%` : '0%');
      // 0.01% is about 0.05 px: finer steps would restyle and relayout the card every tick for nothing visible.
      const cursorPercent = timing.cursor_percent === null ? null : Math.round(timing.cursor_percent * 100) / 100;
      setHidden(quota.cursor, cursorPercent === null);
      setVar(quota.element, '--cursor', `${cursorPercent ?? 0}%`);
      updateContour(quota, now);
      updatePopover(quota, account, now);
      setAttribute(quota.hit, 'aria-label', `${quota.label}: ${percent(window?.used_percent)} usado. ${quota.key === 'five_hour' ? quota.reopens.textContent : `Reset ${resetTime(window, true)}`}.${timing.alert ? ' Consumo em alerta.' : ''}`);
    }
  }
}

document.addEventListener('pointerdown', event => {
  keyboardFocus = false;
  const inside = [...cards.values()].some(card => card.quotas.some(quota =>
    quota.element.contains(event.target) || quota.tooltip.contains(event.target) || quota.bridge.contains(event.target)));
  if (!inside) popovers.dismiss();
});
document.addEventListener('keydown', event => {
  keyboardFocus = true;
  if (event.key === 'Escape') popovers.escape();
});
for (const event of ['resize', 'scroll']) window.addEventListener(event, () => {
  for (const card of cards.values()) for (const quota of card.quotas) {
    if (quota.tooltip.classList.contains('is-open')) positionPopover(quota);
  }
}, { passive: true, capture: true });

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  const revision = titleRevision;
  try {
    const response = await fetch('/api/state', { cache: 'no-store', signal: AbortSignal.timeout(4500) });
    if (!response.ok) throw new Error('state unavailable');
    const state = await response.json();
    if (revision === titleRevision) render(state);
  } catch {
    setHidden(connection, false);
    setText(connection, 'Não foi possível atualizar. Últimos dados mantidos.');
  } finally {
    polling = false;
  }
}

setInterval(tick, 250);
setInterval(poll, 5000);
poll();
