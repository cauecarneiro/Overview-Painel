'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resumoDaConta } = require('../../publico/resumo.js');

const NOW = 1_000_000;
const formato = { pct: (v) => `${String(v).replace('.', ',')}%` };
const barra = (grupo_rotulo, rotulo, usado_pct, renova_epoch, extra = {}) =>
  ({ grupo_rotulo, rotulo, tipo: rotulo === '5h' ? '5h' : 'semana', janela_min: rotulo === '5h' ? 300 : 10080, usado_pct, renova_epoch, ...extra });

test('uma linha de identidade e uma por período, com o grupo antes do rótulo e "período termina em"', () => {
  const conta = {
    ferramenta_nome: 'Antigravity', plano: null,
    barras: [barra('Gemini', '5h', 56.5, NOW + 6000), barra('Gemini', 'Semana', 9.4, NOW + 600),
             barra('Claude/GPT', '5h', 73.9, NOW + 12600)],
  };
  assert.equal(resumoDaConta(conta, NOW, { ...formato, email: 'fb••••••@example.com' }), [
    'Antigravity fb••••••@example.com',
    'Gemini 5 horas 56,5% usado (período termina em 1 h 40 min)',
    'Gemini Semana 9,4% usado (período termina em 10 min)',
    'Claude/GPT 5 horas 73,9% usado (período termina em 3 h 30 min)',
  ].join('\n'));
});

test('o plano entra com a inicial maiúscula e o grupo vazio não deixa espaço sobrando', () => {
  const conta = { ferramenta_nome: 'Claude Code', plano: 'pro', barras: [barra('', '5h', 71, NOW + 120)] };
  assert.equal(resumoDaConta(conta, NOW, { ...formato, email: '' }), 'Claude Code Pro\n5 horas 71% usado (período termina em 2 min)');
});

test('sem dado, leitura anterior e uso zero com prazo provisório não inventam prazo', () => {
  const conta = {
    ferramenta_nome: 'Codex', plano: 'plus',
    barras: [barra('', '5h', null, null), barra('', 'Semana', 33, NOW - 5), barra('', 'Semana', 12, null),
             barra('', '5h', 0, NOW + 18000, { provisorio: true })],
  };
  assert.equal(resumoDaConta(conta, NOW, { ...formato, email: '' }), [
    'Codex Plus', '5 horas sem dados', 'Semana 33% usado antes', 'Semana 12% usado antes', '5 horas 0% usado (ainda sem uso)',
  ].join('\n'));
});

test('leitura velha vira "usado antes" mesmo com o período em curso', () => {
  const conta = { ferramenta_nome: 'Codex', plano: null, barras: [barra('', '5h', 38, NOW + 3600)] };
  assert.equal(resumoDaConta(conta, NOW, { ...formato, email: '', velha: true }), 'Codex\n5 horas 38% usado antes');
});

test('todas as fixtures usam o vocabulário neutro também na cópia', () => {
  const estado = require('./fixtures/h1.json');
  for (const conta of estado.lista) {
    const texto = resumoDaConta(conta, estado.generated_at, { ...formato, email: 'conta@example.com', velha: false });
    assert.doesNotMatch(texto, /acaba|esgota|expira|janela|projeção|p\.p\.|pontos|restante|bloque|renova|!/i);
    for (const b of conta.barras) {
      const nome = b.tipo === '5h' ? '5 horas' : 'Semana';
      assert.ok(texto.includes(nome));
    }
  }
});
