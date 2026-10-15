import { DEFAULT_POPOVER } from './quota.mjs';

export const DEFAULT_TILT = Object.freeze({
  tiltLimit: 6,
  scale: 1.02,
  perspective: 1200,
  duration: 200,
  intensity: 0.08,
  direction: 'gravitate',
  spotlight: true,
});

const clamp01 = value => Math.min(1, Math.max(0, value));

export function computeTilt(px, py, { tiltLimit, scale, direction }) {
  const dir = direction === 'evade' ? -1 : 1;
  return {
    xRot: ((clamp01(py) - 0.5) * tiltLimit * 2 * dir) || 0,
    yRot: (-(clamp01(px) - 0.5) * tiltLimit * 2 * dir) || 0,
    scale,
  };
}

const controls = [
  ['tiltLimit', 'Ângulo', 0, 20, 0.5, '°'],
  ['scale', 'Escala', 1, 1.1, 0.005, '×'],
  ['perspective', 'Perspectiva', 400, 2000, 50, ' px'],
  ['duration', 'Transição', 0, 600, 10, ' ms'],
  ['intensity', 'Brilho', 0, 0.4, 0.005, ''],
  ['dwell', 'Dwell', 0, 1500, 50, ' ms'],
  ['warm', 'Janela quente', 0, 1500, 50, ' ms'],
  ['entryDuration', 'Entrada do popover', 80, 400, 10, ' ms'],
  ['entryScale', 'Escala inicial', 0.85, 1, 0.01, '×'],
  ['bounce', 'Bounce', 0, 0.6, 0.05, ''],
];

export function mountAdjustmentPanel(doc, search, onChange = () => {}) {
  if (new URLSearchParams(search).get('ajuste') !== '1') return null;
  const panel = doc.createElement('aside');
  panel.className = 'tilt-panel';
  panel.setAttribute('aria-label', 'Ajuste do tilt');
  panel.innerHTML = `<h2>Ajuste do card</h2><div class="tilt-controls"></div>
    <div class="tilt-actions"><button type="button" data-action="reset">Restaurar padrão</button><button type="button" data-action="copy">Copiar valores</button></div>
    <p class="tilt-feedback" role="status"></p>`;
  const defaults = { ...DEFAULT_TILT, ...DEFAULT_POPOVER };
  const values = { ...defaults };
  const inputs = new Map();
  for (const [key, label, min, max, step, unit] of controls) {
    const row = doc.createElement('label');
    row.className = 'tilt-control';
    row.innerHTML = `<span>${label}</span><output></output><input type="range">`;
    const input = row.querySelector('input');
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(values[key]);
    inputs.set(key, { input, output: row.querySelector('output'), unit });
    panel.querySelector('.tilt-controls').append(row);
    input.addEventListener('input', () => {
      values[key] = Number(input.value);
      update();
    });
  }
  for (const [key, label] of [['direction', 'Efeito'], ['spotlight', 'Brilho ativo']]) {
    const row = doc.createElement('div');
    row.className = 'tilt-control';
    row.append(doc.createTextNode(label));
    const toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.setAttribute('role', 'switch');
    row.append(toggle);
    panel.querySelector('.tilt-controls').append(row);
    inputs.set(key, { input: toggle });
    toggle.addEventListener('click', () => {
      values[key] = key === 'spotlight' ? !values[key] : values[key] === 'gravitate' ? 'evade' : 'gravitate';
      update();
    });
  }
  function update() {
    for (const [key, { input, output, unit }] of inputs) {
      if (output) {
        input.value = String(values[key]);
        output.textContent = `${values[key]}${unit}`;
      } else {
        const label = key === 'direction' ? 'Efeito' : 'Brilho ativo';
        const state = key === 'direction' ? (values[key] === 'evade' ? 'Evade' : 'Gravitate') : (values[key] ? 'Ligado' : 'Desligado');
        input.textContent = state;
        input.setAttribute('aria-label', `${label}: ${state}`);
        input.setAttribute('aria-checked', String(key === 'direction' ? values[key] === 'evade' : values[key]));
      }
    }
    onChange({ ...values });
  }
  panel.querySelector('[data-action="reset"]').addEventListener('click', () => {
    Object.assign(values, defaults);
    update();
  });
  panel.querySelector('[data-action="copy"]').addEventListener('click', async () => {
    const feedback = panel.querySelector('.tilt-feedback');
    try {
      await doc.defaultView.navigator.clipboard.writeText(JSON.stringify(values, null, 2));
      feedback.textContent = 'Valores copiados';
    } catch {
      feedback.textContent = 'Não foi possível copiar';
    }
  });
  update();
  doc.body.append(panel);
  return panel;
}

export function setupTilt(doc, search, onPopoverChange = () => {}) {
  const view = doc.defaultView;
  const settings = { ...DEFAULT_TILT };
  const reduce = view.matchMedia('(prefers-reduced-motion: reduce)');
  const hover = view.matchMedia('(hover: hover) and (pointer: fine)');
  let active = null;
  let editingSlot = null;

  // Ease into the next position (enter, leave, resume, new settings); transitionend returns to 1:1 tracking.
  function glide(tilt) {
    tilt.card.style.transition = `transform ${settings.duration}ms ease-out`;
  }

  // Runs once per frame: the pointer is measured on the still slot, never on the transformed card.
  function paint(tilt) {
    tilt.frame = 0;
    const rect = tilt.slot.getBoundingClientRect();
    const px = clamp01((tilt.x - rect.left) / rect.width);
    const py = clamp01((tilt.y - rect.top) / rect.height);
    const { xRot, yRot, scale } = computeTilt(px, py, settings);
    tilt.card.style.transform = `perspective(${settings.perspective}px) rotateX(${xRot}deg) rotateY(${yRot}deg) scale3d(${scale}, ${scale}, ${scale})`;
    tilt.spot.style.setProperty('--spot-x', `${px * rect.width}px`);
    tilt.spot.style.setProperty('--spot-y', `${py * rect.height}px`);
    tilt.spot.style.opacity = settings.spotlight ? String(settings.intensity) : '0';
  }

  function schedule(tilt) {
    if (!tilt.frame) tilt.frame = view.requestAnimationFrame(() => paint(tilt));
  }

  function rest(tilt) {
    view.cancelAnimationFrame(tilt.frame);
    tilt.frame = 0;
    glide(tilt);
    tilt.card.style.transform = '';
    tilt.spot.style.opacity = '0';
  }

  function leave(tilt) {
    if (active === tilt) active = null;
    rest(tilt);
  }

  function attach(slot, card) {
    const tilt = { slot, card, spot: card.querySelector('.card-spotlight'), x: 0, y: 0, frame: 0, frozen: false };
    const onEnter = event => {
      if (editingSlot || reduce.matches || !hover.matches || event.pointerType === 'touch') return;
      active = tilt;
      tilt.frozen = false;
      glide(tilt);
    };
    const onMove = event => {
      if (editingSlot || active !== tilt) return;
      if (event.target.closest('.quota')) { // Keep the popover hit area still.
        view.cancelAnimationFrame(tilt.frame);
        tilt.frame = 0;
        tilt.frozen = true;
        return;
      }
      if (tilt.frozen) {
        tilt.frozen = false;
        glide(tilt);
      }
      tilt.x = event.clientX;
      tilt.y = event.clientY;
      schedule(tilt);
    };
    const onLeave = () => { if (editingSlot !== slot) leave(tilt); };
    const onTransitionEnd = event => {
      if (event.target === card && event.propertyName === 'transform') card.style.transition = '';
    };
    slot.addEventListener('pointerenter', onEnter);
    slot.addEventListener('pointermove', onMove);
    slot.addEventListener('pointerleave', onLeave);
    card.addEventListener('transitionend', onTransitionEnd);
    return () => {
      slot.removeEventListener('pointerenter', onEnter);
      slot.removeEventListener('pointermove', onMove);
      slot.removeEventListener('pointerleave', onLeave);
      card.removeEventListener('transitionend', onTransitionEnd);
      if (editingSlot === slot) editingSlot = null;
      leave(tilt);
    };
  }

  function disableIfNeeded() {
    if ((reduce.matches || !hover.matches) && active) leave(active);
  }
  reduce.addEventListener('change', disableIfNeeded);
  hover.addEventListener('change', disableIfNeeded);
  mountAdjustmentPanel(doc, search, next => {
    Object.assign(settings, next);
    onPopoverChange(next);
    if (active && !active.frozen) {
      glide(active);
      schedule(active);
    }
  });
  return { attach, setEditing(slot, editing) {
    if (editing) {
      if (active && active.slot !== slot) leave(active);
      editingSlot = slot;
      const card = slot.querySelector('.card');
      const transform = view.getComputedStyle(card).transform;
      card.style.transition = 'none';
      card.style.transform = transform === 'none' ? '' : transform;
      if (active) {
        view.cancelAnimationFrame(active.frame);
        active.frame = 0;
        active.frozen = true;
      }
    } else if (editingSlot === slot) {
      editingSlot = null;
      if (active) leave(active);
      else {
        const card = slot.querySelector('.card');
        glide({ card });
        card.style.transform = '';
      }
    }
  } };
}
