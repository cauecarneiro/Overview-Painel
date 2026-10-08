'use strict';
/* As consultas às CLIs. Cada uma é um comando administrativo que a própria CLI responde sem passar
   por modelo: nenhum token é gasto. Se a resposta trouxer qualquer token contado, ela é recusada.
   Portado do cotas-dashboard (fbtostadev, MIT). */
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXECUTABLES = { claude: 'claude', codex: 'codex', antigravity: 'agy' };
const INTERVALS = { claude: 300, codex: 300, antigravity: 1200 };     // segundos entre consultas
const QUERY_TIMEOUT_MS = 40000;

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  value = value.trim().toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) ? value : null;
}

function timestamp(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) throw new Error('invalid timestamp');
    return ms / 1000;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error('invalid timestamp');
}

function makeWindow(used, reset, minutes) {
  if (typeof used !== 'number' || !Number.isFinite(used) || used < 0) throw new Error('invalid utilization');
  return { used_percent: used, remaining_percent: Math.max(0, 100 - used), resets_at: timestamp(reset), window_minutes: minutes };
}

/* O formato comum: uma lista de "pools", cada um com a janela de 5 h e a semanal. */
function normalize(harness, data) {
  if (harness === 'codex') {
    const limits = data && data.rateLimits;
    if (!limits || typeof limits !== 'object') throw new Error('missing rate limits');
    const pool = { id: limits.limitId || 'codex', five_hour: null, weekly: null };
    for (const item of [limits.primary, limits.secondary]) {
      if (item == null) continue;
      const minutes = item.windowDurationMins;
      const key = { 300: 'five_hour', 10080: 'weekly' }[minutes];
      if (!key || pool[key] !== null) throw new Error('unexpected quota window');
      pool[key] = makeWindow(item.usedPercent, item.resetsAt, minutes);
    }
    return [pool];
  }
  if (harness === 'claude') {
    const limits = data && data.rate_limits;
    const pool = { id: 'main', five_hour: null, weekly: null };
    if (!limits) return [pool];
    for (const item of limits.limits || []) {
      const key = { session: 'five_hour', weekly_all: 'weekly' }[item.kind];
      if (key) {
        if (pool[key] !== null) throw new Error('duplicate quota window');
        pool[key] = makeWindow(item.percent, item.resets_at, key === 'five_hour' ? 300 : 10080);
      } else if (item.kind === 'weekly_scoped') {
        // A semanal própria de um modelo, quando a conta tem uma.
        const model = item.scope && item.scope.model && item.scope.model.display_name;
        if (typeof model === 'string' && model.trim()) {
          pool.scoped = pool.scoped || {};
          pool.scoped[model.trim()] = makeWindow(item.percent, item.resets_at, 10080);
        }
      }
    }
    return [pool];
  }
  if (harness === 'antigravity') {
    const groups = data && data.command && data.command.data && data.command.data.groups;
    if (!Array.isArray(groups)) throw new Error('missing quota groups');
    const pools = {};
    for (const group of groups) {
      for (const bucket of group.buckets || []) {
        const identity = String(bucket.id || '');
        const cut = identity.lastIndexOf('-');
        if (cut < 0) continue;
        const family = identity.slice(0, cut), span = identity.slice(cut + 1);
        if (!['gemini', '3p'].includes(family) || !['5h', 'weekly'].includes(span)) continue;
        const fraction = bucket.remaining_fraction;
        if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) throw new Error('invalid remaining fraction');
        const pool = pools[family] || (pools[family] = { id: family, five_hour: null, weekly: null });
        const key = span === '5h' ? 'five_hour' : 'weekly';
        if (pool[key] !== null) throw new Error('duplicate quota window');
        pool[key] = makeWindow(100 * (1 - fraction), bucket.reset_time, key === 'five_hour' ? 300 : 10080);
      }
    }
    if (!Object.keys(pools).length) throw new Error('no recognized quota');
    return ['gemini', '3p'].filter((k) => pools[k]).map((k) => pools[k]);
  }
  throw new Error('unknown harness');
}

/* A saída crua da CLI vira pools; resposta com token gasto é recusada. */
function parseCliOutput(harness, output) {
  if (harness === 'claude') {
    let report = null, result = null;
    for (const line of String(output).split('\n')) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message && 'usage_report' in message) report = message.usage_report;
      if (message && message.type === 'result') result = message;
    }
    if (!report || !result || result.is_error || (result.num_turns || 0) !== 0) throw new Error('missing usage report');
    const usage = result.usage || {};
    if (['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'].some((k) => usage[k])) throw new Error('unexpected inference');
    return normalize(harness, report);
  }
  const data = JSON.parse(String(output));
  const usage = (data && data.usage) || {};
  if (!data || data.error || ['input_tokens', 'output_tokens', 'thinking_tokens', 'total_tokens'].some((k) => usage[k])) throw new Error('invalid quota response');
  return normalize(harness, data);
}

function parseAntigravityEmail(logText) {
  const emails = new Set();
  for (const line of String(logText).split('\n')) {
    const match = /OAuth: authenticated successfully as (\S+)\s*$/.exec(line);
    if (match) { const email = normalizeEmail(match[1]); if (email) emails.add(email); }
  }
  return emails.size === 1 ? [...emails][0] : null;
}

/* Ambiente limpo: a consulta não deve herdar a sessão de um Claude Code aberto. */
function baseEnv(env) {
  const copy = { ...env };
  for (const key of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME']) delete copy[key];
  return copy;
}

function run(command, args, env, timeoutMs = QUERY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'ignore'] });   // sem stdin: a CLI não fica esperando entrada
    } catch (e) {
      return reject(Object.assign(new Error('CLI unavailable'), { code: 'unavailable' }));
    }
    const chunks = [];
    let size = 0, done = false;
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(Object.assign(new Error('query timeout'), { code: 'timeout' })); }, timeoutMs);
    child.on('error', (e) => finish(Object.assign(new Error(e.code === 'ENOENT' ? 'CLI unavailable' : String(e.message)), { code: e.code === 'ENOENT' ? 'unavailable' : 'query' })));
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) { child.kill('SIGKILL'); return finish(Object.assign(new Error('response too large'), { code: 'parse' })); }
      chunks.push(chunk);
    });
    child.on('close', (code) => {
      if (code !== 0) return finish(Object.assign(new Error('exit ' + code), { code: 'exit ' + code }));
      finish(null, Buffer.concat(chunks).toString('utf8'));
    });
  });
}

/* Codex: o app-server responde por JSON-RPC na entrada/saída padrão. */
function codexQuery(executable, env, timeoutMs = QUERY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['app-server', '--stdio'], { env, stdio: ['pipe', 'pipe', 'ignore'] });
    const pending = new Map();
    let buffer = '', done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { child.stdin.end(); } catch (_) { /* já fechado */ }
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) { /* já saiu */ } }, 2000).unref();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(Object.assign(new Error('query timeout'), { code: 'timeout' })), timeoutMs);
    child.on('error', (e) => finish(Object.assign(new Error(e.code === 'ENOENT' ? 'CLI unavailable' : String(e.message)), { code: e.code === 'ENOENT' ? 'unavailable' : 'query' })));
    child.on('exit', () => { if (!done) finish(Object.assign(new Error('RPC stream closed'), { code: 'query' })); });
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (buffer.length > 8 * 1024 * 1024) return finish(Object.assign(new Error('RPC response too large'), { code: 'parse' }));
      let cut;
      while ((cut = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, cut); buffer = buffer.slice(cut + 1);
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch (_) { continue; }
        const waiter = pending.get(message.id);
        if (!waiter) continue;
        pending.delete(message.id);
        'error' in message ? waiter.reject(new Error('RPC query failed')) : waiter.resolve(message.result);
      }
    });
    const send = (message) => child.stdin.write(JSON.stringify(message) + '\n');
    const call = (id, method, params) => new Promise((res, rej) => { pending.set(id, { resolve: res, reject: rej }); send({ id, method, params }); });
    (async () => {
      await call(1, 'initialize', { clientInfo: { name: 'quota_board', version: '0.1' }, capabilities: { experimentalApi: true } });
      send({ method: 'initialized', params: {} });
      let identity = {};
      try { identity = (await call(2, 'account/read', { refreshToken: false })).account || {}; } catch (_) { identity = {}; }
      const limits = await call(3, 'account/rateLimits/read', {});
      return { pools: normalize('codex', limits), email: normalizeEmail(identity.email), plan: identity.planType || null };
    })().then((v) => finish(null, v), (e) => finish(Object.assign(e, { code: e.code || 'parse' })));
  });
}

/* Uma consulta: devolve { pools, email, plan }. `account` = { harness, dir }. */
async function collect(account, options = {}) {
  const env = baseEnv(options.env || process.env);
  const executable = options.executable || EXECUTABLES[account.harness];
  if (account.harness === 'codex') {
    if (account.dir) env.CODEX_HOME = account.dir;
    return codexQuery(executable, env);
  }
  if (account.harness === 'claude') {
    // A pasta padrão fica sem CLAUDE_CONFIG_DIR: com a variável apontando para ela, a CLI não acha a sessão.
    if (account.dir && path.resolve(account.dir) !== path.join(os.homedir(), '.claude')) env.CLAUDE_CONFIG_DIR = account.dir;
    let identity = {};
    try { identity = JSON.parse(await run(executable, ['auth', 'status', '--json'], env)); } catch (_) { identity = {}; }
    const output = await run(executable, ['--safe-mode', '--no-session-persistence', '-p', '/usage', '--output-format', 'stream-json', '--verbose'], env);
    return { pools: parseCliOutput('claude', output), email: normalizeEmail(identity.email), plan: identity.subscriptionType || null };
  }
  if (account.harness === 'antigravity') {
    if (account.dir) env.HOME = account.dir;
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-board-'));
    const log = path.join(temporary, 'query.log');
    try {
      const output = await run(executable, ['-p', '/quota', '--output-format', 'json', '--print-timeout', '25s', '--log-file', log], env);
      let email = null;
      try { email = parseAntigravityEmail(fs.readFileSync(log, 'utf8')); } catch (_) { email = null; }
      return { pools: parseCliOutput('antigravity', output), email, plan: null };
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
  throw new Error('unknown harness');
}

module.exports = { EXECUTABLES, INTERVALS, normalizeEmail, timestamp, makeWindow, normalize, parseCliOutput, parseAntigravityEmail, baseEnv, collect, codexQuery };
