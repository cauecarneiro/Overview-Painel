export function quotaTiming(window, nowSeconds) {
  const reset = window?.resets_at;
  const duration = window?.window_minutes * 60;
  const validTime = Number.isFinite(reset) && Number.isFinite(window?.window_minutes) && Number.isFinite(duration) && duration > 0
    && Number.isFinite(nowSeconds);
  const cursor = validTime ? Math.min(100, Math.max(0, 100 * (nowSeconds - reset + duration) / duration)) : null;
  const used = window?.used_percent;
  const validUsage = Number.isFinite(used) && used >= 0;
  const abovePace = validUsage && cursor !== null && used > cursor + 5;
  return { cursor_percent: cursor, above_pace: abovePace,
           alert: validUsage && (abovePace || used > 90),
           expired: validTime && nowSeconds >= reset };
}
export function quotaExplanation(account) {
  return account.harness === 'antigravity' && account.keychain_limited
    ? 'A CLI só consulta a conta ativa no Keychain' : '';
}

export function formatModel(harness, model) {
  const capitalize = word => word[0].toUpperCase() + word.slice(1);
  if (harness === 'codex' && /^gpt-\d+(?:\.\d+)*(?:-[a-z]+)*$/.test(model)) {
    return `GPT ${model.slice(4).split('-').map(capitalize).join(' ')}`;
  }
  const claude = harness === 'claude' && /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(model);
  if (claude) return `${capitalize(claude[1])} ${claude[2]}.${claude[3]}`;
  return model;
}

export function cardPresentation(account) {
  const harnessNames = { codex: 'Codex', claude: 'Claude Code', antigravity: 'Antigravity' };
  const model = account.model && formatModel(account.harness, account.model);
  const effort = account.effort && account.effort[0].toUpperCase() + account.effort.slice(1);
  const harness = harnessNames[account.harness] || account.harness;
  const customTitle = account.email && account.title;
  return {
    title: customTitle || harness,
    eyebrow: customTitle ? harness : '',
    accountLabel: account.email ? `${account.email}${account.plan ? ` · ${account.plan}` : ''}` : 'conta não identificada',
    tag: model ? [model, effort].filter(Boolean).join(' · ') : '',
  };
}

export const DEFAULT_POPOVER = Object.freeze({ dwell: 600, warm: 500, entryDuration: 180, entryScale: 0.94, bounce: 0.3 });

export function createPopoverState({ settings = DEFAULT_POPOVER, timers = {
  now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id),
}, onChange }) {
  let current = null, pending = null, anchor = null, dwellTimer = null, closeTimer = null, pinned = false;
  let lastClosed = -Infinity, lastId = null;
  const cancelDwell = () => { timers.clearTimeout(dwellTimer); dwellTimer = null; pending = null; };
  const cancelClose = () => { timers.clearTimeout(closeTimer); closeTimer = null; };
  function close() {
    cancelDwell();
    cancelClose();
    pinned = false;
    if (current !== null) {
      const id = current;
      current = null;
      lastClosed = timers.now();
      lastId = id;
      onChange(id, false, false);
    }
  }
  function open(id, immediate, pin = false) {
    cancelDwell();
    cancelClose();
    if (current !== id) {
      close();
      current = id;
      onChange(id, true, immediate);
    }
    pinned = pin;
  }
  function wait(id, x, y) {
    cancelDwell();
    anchor = { x, y };
    pending = id;
    dwellTimer = timers.setTimeout(() => open(id, false), settings.dwell);
  }
  return {
    enter(id, x, y) {
      cancelClose();
      if (current === id) return;
      if (current !== null) close();
      if (lastId !== id && timers.now() - lastClosed < settings.warm) open(id, true);
      else wait(id, x, y);
    },
    move(id, x, y) {
      if (pending === id && Math.hypot(x - anchor.x, y - anchor.y) > 4) wait(id, x, y);
    },
    leave(id) {
      if (pending === id) cancelDwell();
      if (current === id && !pinned) {
        cancelClose();
        closeTimer = timers.setTimeout(close, 100);
      }
    },
    hold(id) { if (current === id) cancelClose(); },
    focus(id) { open(id, true, true); },
    blur(id) { if (current === id) { pinned = false; this.leave(id); } },
    touch(id) { if (current === id) close(); else open(id, true, true); },
    dismiss: close,
    escape: close,
    remove(id) { if (current === id || pending === id) close(); },
  };
}

const popoverNumber = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const popoverDates = new Map();
export function popoverDate(seconds, timeZone) {
  if (!Number.isFinite(seconds)) return 'sem dados';
  const key = timeZone || 'local';
  if (!popoverDates.has(key)) popoverDates.set(key, new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }));
  const parts = Object.fromEntries(popoverDates.get(key).formatToParts(new Date(seconds * 1000)).map(p => [p.type, p.value]));
  return `${parts.weekday.replace('.', '')} ${parts.day}/${parts.month} ${parts.hour}:${parts.minute}`;
}

export function formatDuration(seconds, { seconds: showSeconds = false } = {}) {
  if (!Number.isFinite(seconds)) return 'sem dados';
  if (seconds <= 0) return 'a confirmar';
  if (showSeconds) {
    const total = Math.max(1, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    if (seconds >= 86400) return `${Math.floor(hours / 24)}d${hours % 24 ? ` ${hours % 24}h` : ''}`;
    const minutes = Math.floor(total / 60) % 60;
    return `${hours ? `${hours}h ` : ''}${hours || minutes ? `${minutes}m ` : ''}${total % 60}s`;
  }
  const minutes = Math.ceil(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d${hours % 24 ? ` ${hours % 24}h` : ''}`;
}

// Stable place keys let a running transition retarget the existing digit layers.
export function liftDigits(previous, value) {
  function places(text) {
    const match = /^(\d+)(?:,(\d+))?(%)?$/.exec(text || '');
    if (!match) return [...(text || '')].map((value, i) => ({ key: `text${i}`, value }));
    const digits = [...match[1]].map((value, i) => ({ key: `i${match[1].length - i - 1}`, value }));
    if (match[2]) digits.push({ key: 'comma', value: ',' },
      ...[...match[2]].map((value, i) => ({ key: `f${i}`, value })));
    if (match[3]) digits.push({ key: 'percent', value: '%' });
    return digits;
  }
  const old = new Map(places(previous).map(d => [d.key, d.value]));
  const next = places(value), keys = new Set(next.map(d => d.key));
  const result = next.map(d => ({ ...d, previous: old.get(d.key) ?? null,
    changed: previous !== null && /^[if]\d+$/.test(d.key) && old.get(d.key) !== d.value }));
  for (const [key, previous] of old) {
    if (!keys.has(key)) result.push({ key, previous, value: null, changed: /^[if]\d+$/.test(key) });
  }
  return result;
}

export function popoverContent(account, key, now, timeZone) {
  const pools = account.pools || [];
  const pool = account.harness === 'antigravity' ? pools.find(p => p.id === 'gemini') : pools[0];
  const third = pools.find(p => p.id === '3p');
  const percent = value => Number.isFinite(value) ? `${popoverNumber.format(value)}%` : 'sem dados';
  function windowContent(window, label) {
    const duration = formatDuration(Number.isFinite(window?.resets_at) ? window.resets_at - now : null);
    const timing = quotaTiming(window, now);
    return { label, time: { label: 'Tempo', value: duration }, reset: popoverDate(window?.resets_at, timeZone),
      rows: [['Cota usada', percent(window?.used_percent)], ['Cota livre', percent(window?.remaining_percent)]],
      used: Number.isFinite(window?.used_percent) ? window.used_percent : null,
      cursor: timing.cursor_percent === null ? null : Math.round(timing.cursor_percent * 100) / 100,
      alert: timing.alert,
      pace: timing.above_pace ? 'Acima do ritmo da janela' : window?.used_percent > 90 ? 'Mais de 90% usada' : '',
    };
  }
  const suffix = account.harness === 'antigravity' ? ' · Gemini' : '';
  const otherKey = key === 'five_hour' ? 'weekly' : 'five_hour';
  return {
    main: windowContent(pool?.[key], `${key === 'five_hour' ? '5h' : 'Semana'}${suffix}`),
    other: windowContent(pool?.[otherKey], `${otherKey === 'five_hour' ? '5h' : 'Semana'}${suffix}`),
    third: account.harness === 'antigravity' ? { label: 'Pool 3p', windows: [
      windowContent(third?.five_hour, '5h'), windowContent(third?.weekly, 'Semana'),
    ] } : null,
    observation: Number.isFinite(account.observed_at) ? `há ${Math.floor(Math.max(0, now - account.observed_at) / 60)} min` : 'sem dados',
    explanation: quotaExplanation(account),
    error: account.error ? account.error_detail || 'query' : '',
  };
}
