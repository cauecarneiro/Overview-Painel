'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('../lib/cli');

const CLAUDE_STREAM = [
  JSON.stringify({ type: 'system', subtype: 'init' }),
  JSON.stringify({ type: 'assistant', usage_report: { rate_limits: { limits: [
    { kind: 'session', percent: 17, resets_at: '2026-10-08T20:20:00Z' },
    { kind: 'weekly_all', percent: 53, resets_at: '2026-10-13T12:59:00Z' },
    { kind: 'weekly_scoped', percent: 38, resets_at: '2026-10-13T12:59:00Z', scope: { model: { display_name: 'Modelo X' } } },
  ] } } }),
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 0, usage: { input_tokens: 0, output_tokens: 0 } }),
].join('\n');

test('claude: /usage vira uma janela de 5 h, uma semanal e a semanal do modelo', () => {
  const pools = cli.parseCliOutput('claude', CLAUDE_STREAM);
  assert.equal(pools.length, 1);
  assert.equal(pools[0].five_hour.used_percent, 17);
  assert.equal(pools[0].weekly.used_percent, 53);
  assert.equal(pools[0].weekly.resets_at, Date.parse('2026-10-13T12:59:00Z') / 1000);
  assert.equal(pools[0].scoped['Modelo X'].used_percent, 38);
});

test('claude: resposta com token gasto ou com turno é recusada', () => {
  const comToken = CLAUDE_STREAM.replace('"input_tokens":0', '"input_tokens":12');
  assert.throws(() => cli.parseCliOutput('claude', comToken), /unexpected inference/);
  const comTurno = CLAUDE_STREAM.replace('"num_turns":0', '"num_turns":1');
  assert.throws(() => cli.parseCliOutput('claude', comTurno), /missing usage report/);
});

test('codex: rateLimits primário e secundário viram 5 h e semanal', () => {
  const pools = cli.normalize('codex', { rateLimits: { limitId: 'codex',
    primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 1791515868 },
    secondary: { usedPercent: 45, windowDurationMins: 10080, resetsAt: 1792001547 } } });
  assert.deepEqual(pools[0].weekly, { used_percent: 45, remaining_percent: 55, resets_at: 1792001547, window_minutes: 10080 });
  assert.throws(() => cli.normalize('codex', {}), /missing rate limits/);
});

const AGY = { status: 'SUCCESS', command: { data: { groups: [{ buckets: [
  { id: 'gemini-5h', remaining_fraction: 1, reset_time: '2026-10-09T03:26:28Z' },
  { id: 'gemini-weekly', remaining_fraction: 0.6155, reset_time: '2026-10-12T23:08:10Z' },
  { id: '3p-5h', remaining_fraction: 1, reset_time: '2026-10-09T03:26:28Z' },
  { id: '3p-weekly', remaining_fraction: 0.016, reset_time: '2026-10-10T14:53:00Z' },
] }] } } };

test('antigravity: os buckets viram os pools gemini e 3p, com o usado em porcento', () => {
  const pools = cli.parseCliOutput('antigravity', JSON.stringify(AGY));
  assert.deepEqual(pools.map((p) => p.id), ['gemini', '3p']);
  assert.equal(Math.round(pools[0].weekly.used_percent * 100) / 100, 38.45);
  assert.equal(pools[1].five_hour.used_percent, 0);
});

test('antigravity: resposta com erro ou com token é recusada', () => {
  assert.throws(() => cli.parseCliOutput('antigravity', JSON.stringify({ error: 'x' })), /invalid quota response/);
  assert.throws(() => cli.parseCliOutput('antigravity', JSON.stringify({ ...AGY, usage: { total_tokens: 3 } })), /invalid quota response/);
});

test('antigravity: o e-mail vem do log, só quando há exatamente um', () => {
  assert.equal(cli.parseAntigravityEmail('x\nI1008 OAuth: authenticated successfully as Pessoa@Example.com\n'), 'pessoa@example.com');
  assert.equal(cli.parseAntigravityEmail('OAuth: authenticated successfully as a@example.com\nOAuth: authenticated successfully as b@example.com'), null);
  assert.equal(cli.parseAntigravityEmail(''), null);
});

test('o ambiente da consulta não herda a sessão de um Claude Code aberto', () => {
  const env = cli.baseEnv({ PATH: '/bin', CLAUDECODE: '1', CLAUDE_CONFIG_DIR: '/x', CODEX_HOME: '/y' });
  assert.deepEqual(env, { PATH: '/bin' });
});
