'use strict';
/* O quadro: quais contas existem nesta máquina, quando consultar cada uma e o estado pronto para a
   página (um card por conta, uma barra por janela de cota). Nenhuma IA participa. */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cli = require('./cli');

const TOOL = { claude: 'claude', codex: 'codex', antigravity: 'agy' };            // chave usada pela página (cor)
const TOOL_NAME = { claude: 'Claude Code', codex: 'Codex', antigravity: 'Antigravity' };
const POOL_LABEL = { gemini: 'Gemini', '3p': 'Claude/GPT' };
const WINDOW_MIN = { '5h': 300, semana: 10080 };

function whichSync(name, env = process.env) {
  const dirs = String(env.PATH || '').split(path.delimiter).filter(Boolean);
  const extra = [path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  for (const dir of [...dirs, ...extra]) {
    const candidate = path.join(dir, name);
    try { fs.accessSync(candidate, fs.constants.X_OK); if (fs.statSync(candidate).isFile()) return candidate; } catch (_) { /* próximo */ }
  }
  return null;
}

function expand(p) { return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : path.resolve(p); }

/* As contas: uma por pasta de configuração. Sem opção, a pasta padrão de cada CLI que estiver no PATH.
   options = { claude: [dirs], codex: [dirs], antigravity: [homes] }. */
function discoverAccounts(options = {}, env = process.env, which = whichSync) {
  const accounts = [];
  const home = os.homedir();
  const defaults = {
    claude: [env.CLAUDE_CONFIG_DIR || path.join(home, '.claude')],
    codex: [env.CODEX_HOME || path.join(home, '.codex')],
    antigravity: [home],
  };
  for (const harness of ['claude', 'codex', 'antigravity']) {
    const executable = which(cli.EXECUTABLES[harness], env);
    const requested = Array.isArray(options[harness]) && options[harness].length ? options[harness].map(expand) : null;
    if (!executable && !requested) continue;
    for (const dir of requested || defaults[harness]) {
      const id = harness + ':' + crypto.createHash('sha256').update(dir).digest('hex').slice(0, 12);
      accounts.push({ id, harness, dir, executable });
    }
  }
  return accounts;
}

class Board {
  constructor(accounts, { collector = cli.collect, intervals = cli.INTERVALS, now = () => Date.now() / 1000 } = {}) {
    this.collector = collector;
    this.intervals = intervals;
    this.now = now;
    this.rows = new Map();
    for (const account of accounts) {
      this.rows.set(account.id, { account, pools: [], email: null, plan: null, observed_at: null, error: null, error_detail: null,
                                  failures: 0, next_refresh_at: 0, querying: false });
    }
  }

  get accounts() { return [...this.rows.values()].map((r) => r.account); }

  /* Dispara as consultas que estão na hora. Devolve uma promessa que termina quando todas acabarem. */
  refresh({ force = false } = {}) {
    const current = this.now();
    const jobs = [];
    for (const row of this.rows.values()) {
      if (row.querying) continue;
      if (!force && current < row.next_refresh_at) continue;
      row.querying = true;
      jobs.push(this.query(row));
    }
    return Promise.all(jobs);
  }

  async query(row) {
    let error = null, detail = null, result = null;
    try {
      result = await this.collector(row.account);
      if (!Array.isArray(result.pools)) throw Object.assign(new Error('invalid quota pools'), { code: 'parse' });
    } catch (e) {
      error = e && e.code === 'timeout' ? 'timeout' : 'query_failed';
      detail = (e && e.code) || (e instanceof SyntaxError ? 'parse' : 'query');
    }
    const finished = this.now();
    if (!error) {
      Object.assign(row, { pools: result.pools, email: result.email || row.email, plan: result.plan || row.plan, observed_at: finished, failures: 0 });
    } else {
      row.failures = Math.min(12, row.failures + 1);
    }
    const base = this.intervals[row.account.harness] || 300;
    const interval = error ? Math.min(base * 2 ** row.failures, 3600) : base;
    Object.assign(row, { querying: false, error, error_detail: detail, next_refresh_at: finished + interval });
  }

  state() {
    const current = this.now();
    const list = [...this.rows.values()].map((row) => card(row, current, this.intervals));
    return { generated_at: current, intervals_s: this.intervals, consultadas: true, erro: null, lista: list };
  }
}

/* As janelas de uma conta, por grupo (título do card, mais " · modelo" ou " · Gemini"). */
function groupsOf(row) {
  const title = cardTitle(row);
  const groups = [];
  for (const pool of row.pools) {
    if (row.account.harness === 'antigravity') {
      groups.push({ grupo: title + ' · ' + (POOL_LABEL[pool.id] || pool.id), rotulo: POOL_LABEL[pool.id] || pool.id, five: pool.five_hour, weekly: pool.weekly });
      continue;
    }
    groups.push({ grupo: title, rotulo: '', five: pool.five_hour, weekly: pool.weekly });
    for (const [model, win] of Object.entries(pool.scoped || {})) {
      groups.push({ grupo: title + ' · ' + model, rotulo: model, five: null, weekly: win, soSemana: true });
    }
  }
  return groups;
}

function cardTitle(row) {
  const plan = row.plan ? ' · ' + row.plan.charAt(0).toUpperCase() + row.plan.slice(1) : '';
  return TOOL_NAME[row.account.harness] + plan;
}

function card(row, current, intervals) {
  const observed = row.observed_at;
  const bars = [];
  for (const g of groupsOf(row)) {
    for (const [tipo, win] of [['5h', g.five], ['semana', g.weekly]]) {
      if (tipo === '5h' && g.soSemana) continue;
      bars.push({
        grupo: g.grupo, tipo, rotulo: (tipo === '5h' ? '5h' : 'Semana') + (g.rotulo ? ' · ' + g.rotulo : ''),
        usado_pct: win ? win.used_percent : null, renova_epoch: win ? win.resets_at : null,
        janela_min: WINDOW_MIN[tipo], lido_em_epoch: win && observed !== null ? Math.floor(observed) : null,
      });
    }
  }
  const windows = bars.map((b) => b.usado_pct);
  const expired = bars.some((b) => typeof b.renova_epoch === 'number' && b.renova_epoch <= current);
  const age = observed === null ? null : Math.max(0, current - observed);
  let status;
  if (!windows.some((w) => w !== null)) status = 'sem dados';
  else if (expired || age >= (intervals[row.account.harness] || 300)) status = 'desatualizado';
  else if (windows.some((w) => w === null)) status = 'parcial';
  else status = 'ok';
  return {
    id: row.account.id, ferramenta: TOOL[row.account.harness], ferramenta_nome: TOOL_NAME[row.account.harness],
    titulo: cardTitle(row), email: row.email, plano: row.plan, pasta: row.account.dir,
    consultando: row.querying, erro: row.error, erro_detalhe: row.error_detail, situacao: status,
    lido_em_epoch: observed === null ? null : Math.floor(observed), proxima_consulta_epoch: row.next_refresh_at,
    intervalo_s: intervals[row.account.harness] || 300, barras: bars,
  };
}

module.exports = { Board, discoverAccounts, whichSync, card, cardTitle, TOOL, TOOL_NAME };
