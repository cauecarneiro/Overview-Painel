'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { Board, discoverAccounts } = require('../lib/board');

const NOW = 1791500000;

test('descoberta: só as CLIs no PATH, na pasta padrão; opções adicionam pastas', () => {
  const which = (name) => (name === 'codex' ? null : '/usr/local/bin/' + name);
  const env = { PATH: '/usr/local/bin' };
  const padrao = discoverAccounts({}, env, which);
  assert.deepEqual(padrao.map((a) => a.harness), ['claude', 'antigravity']);
  assert.equal(padrao[0].dir, path.join(os.homedir(), '.claude'));
  assert.equal(padrao[1].dir, os.homedir());
  const extra = discoverAccounts({ antigravity: ['/casas/a', '/casas/b'] }, env, which);
  assert.deepEqual(extra.filter((a) => a.harness === 'antigravity').map((a) => a.dir), ['/casas/a', '/casas/b']);
  assert.notEqual(extra[1].id, extra[2].id);
});

function fakeCollector(responses) {
  return async (account) => {
    const r = responses[account.harness];
    if (r instanceof Error) throw r;
    return r;
  };
}

test('o quadro consulta na hora certa, guarda o resultado e monta um card por conta', async () => {
  let now = NOW;
  const board = new Board([{ id: 'claude:1', harness: 'claude', dir: '/c' }, { id: 'antigravity:1', harness: 'antigravity', dir: '/a' }], {
    now: () => now,
    collector: fakeCollector({
      claude: { email: 'pessoa@example.com', plan: 'max', pools: [{ id: 'main',
        five_hour: { used_percent: 20, remaining_percent: 80, resets_at: NOW + 3600, window_minutes: 300 },
        weekly: { used_percent: 50, remaining_percent: 50, resets_at: NOW + 86400, window_minutes: 10080 },
        scoped: { 'Modelo X': { used_percent: 10, remaining_percent: 90, resets_at: NOW + 86400, window_minutes: 10080 } } }] },
      antigravity: { email: 'outra@example.com', plan: null, pools: [
        { id: 'gemini', five_hour: { used_percent: 0, remaining_percent: 100, resets_at: NOW + 100, window_minutes: 300 }, weekly: { used_percent: 38, remaining_percent: 62, resets_at: NOW + 500, window_minutes: 10080 } },
        { id: '3p', five_hour: null, weekly: { used_percent: 98, remaining_percent: 2, resets_at: NOW + 500, window_minutes: 10080 } }] },
    }),
  });
  await board.refresh();
  const estado = board.state();
  assert.equal(estado.lista.length, 2);
  const claude = estado.lista[0];
  assert.equal(claude.titulo, 'Claude Code · Max');
  assert.equal(claude.ferramenta, 'claude');
  assert.equal(claude.email, 'pessoa@example.com');
  assert.deepEqual(claude.barras.map((b) => b.rotulo), ['5h', 'Semana', 'Semana · Modelo X']);
  assert.equal(claude.barras[2].usado_pct, 10);
  assert.equal(claude.situacao, 'ok');
  const agy = estado.lista[1];
  assert.equal(agy.ferramenta, 'agy');
  assert.deepEqual(agy.barras.map((b) => b.rotulo), ['5h · Gemini', 'Semana · Gemini', '5h · Claude/GPT', 'Semana · Claude/GPT']);
  assert.equal(agy.barras[2].usado_pct, null);
  assert.equal(agy.situacao, 'parcial');
  // Antes do intervalo, nada é consultado de novo; depois, é.
  now += 100;
  assert.equal((await board.refresh()).length, 0);
  now += 1300;
  assert.equal((await board.refresh()).length, 2);
});

test('falha mantém a última leitura e dobra a espera, até 1 h', async () => {
  let now = NOW;
  const respostas = { codex: { email: null, plan: 'plus', pools: [{ id: 'codex', five_hour: { used_percent: 1, remaining_percent: 99, resets_at: NOW + 10, window_minutes: 300 }, weekly: null }] } };
  const board = new Board([{ id: 'codex:1', harness: 'codex', dir: '/x' }], { now: () => now, collector: fakeCollector(respostas) });
  await board.refresh();
  respostas.codex = Object.assign(new Error('query timeout'), { code: 'timeout' });
  now += 400; await board.refresh();
  let c = board.state().lista[0];
  assert.equal(c.erro, 'timeout');
  assert.equal(c.barras[0].usado_pct, 1);
  assert.equal(c.proxima_consulta_epoch, now + 600);
  for (let i = 0; i < 5; i++) { now = c.proxima_consulta_epoch; await board.refresh(); c = board.state().lista[0]; }
  assert.equal(c.proxima_consulta_epoch - now, 3600);
});
