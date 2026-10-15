'use strict';
/* Testes do apoio do card de cota (publico/cartao-apoio.js): a aritmética da cápsula de uso e tempo e as regras da tarja
   de privacidade. Rodar:  node --test testes/js/*.test.js   (ou, junto com o resto, python3 -m unittest discover -s testes) */
const test = require('node:test');
const assert = require('node:assert/strict');
const Apoio = require('../../publico/cartao-apoio.js');

// Um período de 5 horas (300 min) que termina em RENOVA; o início é RENOVA - 18000 s.
const INICIO = Date.UTC(2026, 9, 11, 12, 0, 0) / 1000;      // 11/10/2026 12:00 UTC
const RENOVA = INICIO + 18000;
const SEMANA = 10080;

test('o decorrido começa em 0 no início do período e só conta segundos inteiros', () => {
  assert.equal(Apoio.decorrido(INICIO, RENOVA, 300), 0);
  assert.equal(Apoio.decorrido(INICIO + 7092, RENOVA, 300), 7092);
  assert.equal(Apoio.decorrido(INICIO + 7092.9, RENOVA, 300), 7092);
  assert.equal(Apoio.decorrido(INICIO + 9000, RENOVA, 300) / 18000, 0.5);
});

test('o decorrido não passa dos limites do período (0 antes do início, 5 h ou 7 d no fim)', () => {
  assert.equal(Apoio.decorrido(INICIO - 50, RENOVA, 300), 0);
  assert.equal(Apoio.decorrido(RENOVA, RENOVA, 300), 18000);
  assert.equal(Apoio.decorrido(RENOVA + 999, RENOVA, 300), 18000);
  assert.equal(Apoio.decorrido(RENOVA + 999, RENOVA, SEMANA), 604800);
});

test('o formato do decorrido: h:mm:ss nas 5 horas e "d hh:mm:ss" na Semana', () => {
  assert.equal(Apoio.formatarDecorrido(0, 300), '0:00:00');
  assert.equal(Apoio.formatarDecorrido(7092, 300), '1:58:12');
  assert.equal(Apoio.formatarDecorrido(18000, 300), '5:00:00');
  assert.equal(Apoio.formatarDecorrido(0, SEMANA), '0 d 00:00:00');
  assert.equal(Apoio.formatarDecorrido(2 * 86400 + 6 * 3600 + 12 * 60 + 40, SEMANA), '2 d 06:12:40');
  assert.equal(Apoio.formatarDecorrido(604800, SEMANA), '7 d 00:00:00');
});

test('a pílula só tem texto com o realce ligado e com tempo comprovado', () => {
  assert.equal(Apoio.timerDaPilula(true, true, INICIO + 7092, RENOVA, 300), '1:58:12');
  assert.equal(Apoio.timerDaPilula(false, true, INICIO + 7092, RENOVA, 300), '');
  assert.equal(Apoio.timerDaPilula(true, false, INICIO + 7092, RENOVA, 300), '');
});

test('o mouse espera 300 ms para abrir o realce e tolera 100 ms ao sair', () => {
  assert.equal(Apoio.atrasoDoRealce(true), 300);
  assert.equal(Apoio.atrasoDoRealce(false), 100);
});

test('o pulso da agulha cai no começo de cada minuto', () => {
  assert.equal(Apoio.fasePulso(120), 0);
  assert.equal(Apoio.fasePulso(179.9), 59);
  assert.equal(Apoio.fasePulso(181), 1);
});

test('a faixa de tempo sobe só quando o decorrido passa do usado', () => {
  assert.equal(Apoio.tempoAcima(60, 30), true);
  assert.equal(Apoio.tempoAcima(30, 60), false);
  assert.equal(Apoio.tempoAcima(40, 40), false, 'empate não troca');
  assert.equal(Apoio.tempoAcima(null, 30), false);
  assert.equal(Apoio.tempoAcima(30, null), false);
  assert.equal(Apoio.tempoAcima(NaN, 30), false);
  assert.equal(Apoio.tempoAcima(0, 0), false);
});

test('cortes das 5 horas: cinco horas cheias a partir do início do período', () => {
  const c = Apoio.cortes({ tipo: '5h', janela_min: 300, renova_epoch: RENOVA }, 'UTC');
  assert.deepEqual(c.map((x) => x.rotulo), ['12:00', '13:00', '14:00', '15:00', '16:00']);
  assert.equal(c[0].inicio, INICIO);
  assert.equal(c[4].inicio, INICIO + 4 * 3600);
});

test('cortes da Semana: sete dias contados desde o início do período, não do calendário', () => {
  const c = Apoio.cortes({ tipo: 'semana', janela_min: SEMANA, renova_epoch: INICIO + 7 * 86400 }, 'UTC');
  assert.deepEqual(c.map((x) => x.rotulo), ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']);   // 11/10/2026 é domingo
  assert.equal(c.length, 7);
});

test('sem hora de renovar ou sem duração não há cortes', () => {
  assert.deepEqual(Apoio.cortes({ tipo: '5h', janela_min: 300, renova_epoch: null }), []);
  assert.deepEqual(Apoio.cortes({ tipo: 'semana', janela_min: 0, renova_epoch: RENOVA }), []);
});

test('o corte da agulha: o índice do slot, preso ao último, e -1 sem tempo', () => {
  assert.equal(Apoio.corteAtual(0, 5), 0);
  assert.equal(Apoio.corteAtual(39.9, 5), 1);
  assert.equal(Apoio.corteAtual(40, 5), 2);
  assert.equal(Apoio.corteAtual(100, 5), 4);
  assert.equal(Apoio.corteAtual(100, 7), 6);
  assert.equal(Apoio.corteAtual(null, 5), -1);
});

/* ---- privacidade ---- */
test('e-mail: começo curto, miolo oculto de tamanho fixo e domínio inteiro', () => {
  assert.deepEqual(Apoio.partesDoEmail('maria.silva@example.com'), { antes: 'ma', ocultos: 6, depois: '@example.com' });
  assert.deepEqual(Apoio.partesDoEmail('al@example.com'), { antes: '', ocultos: 6, depois: '@example.com' });
  assert.deepEqual(Apoio.partesDoEmail('abc@example.com'), { antes: 'a', ocultos: 6, depois: '@example.com' });
  assert.equal(Apoio.partesDoEmail('abcdefgh@example.com').ocultos, Apoio.partesDoEmail('abcdefghijklmnopqrstuvwxyz@example.com').ocultos,
    'o miolo não revela o tamanho do nome');
  assert.deepEqual(Apoio.partesDoEmail(null), { antes: '', ocultos: 6, depois: '' });
});

test('texto corrido: cada e-mail vira começo, pontos e domínio; o resto fica como está', () => {
  assert.equal(Apoio.mascararEmails('maria.silva@example.com · max'), 'ma••••••@example.com · max');
  assert.equal(Apoio.mascararEmails('kaue.silva@example.com · Agente 02, joao.pereira@example.org'),
    'ka••••••@example.com · Agente 02, jo••••••@example.org');
  assert.equal(Apoio.mascararEmails('Claude Max 5x'), 'Claude Max 5x');
  assert.equal(Apoio.mascararEmails(null), '');
  assert.ok(!/silva|pereira/.test(Apoio.mascararEmails('maria.silva@example.com joao.pereira@example.org')), 'o miolo nunca sobra');
});

test('o primeiro e-mail de um texto é separado do que vem antes e depois', () => {
  assert.deepEqual(Apoio.separarEmail('a maria.silva@example.com · max'), { antes: 'a ', email: 'maria.silva@example.com', depois: ' · max' });
  assert.deepEqual(Apoio.separarEmail('Claude Max 5x'), { antes: 'Claude Max 5x', email: '', depois: '' });
});

function sorteador(semente) { let x = semente; return () => { x = (x * 16807) % 2147483647; return x / 2147483647; }; }

test('grade de pixels: tamanho pedido, só quatro valores e as pontas nunca vazias', () => {
  const grade = Apoio.gradeDePixels(20, 4, Math.random);
  assert.equal(grade.length, 80);
  assert.ok(grade.every((tom) => [0, 1, 2, 3].includes(tom)));
  assert.deepEqual(Apoio.gradeDePixels(3, 2, () => 0), [1, 0, 1, 1, 0, 1]);
  assert.deepEqual(Apoio.gradeDePixels(3, 2, () => 0.99), [3, 3, 3, 3, 3, 3]);
});

test('tira de quadros: 25 quadros, tudo em [0, 1], e o quadro do meio é a grade em repouso', () => {
  assert.equal(Apoio.QUADROS, 25);
  const tira = Apoio.tiraDePixels(20, 4, Apoio.QUADROS, sorteador(7));
  assert.equal(tira.length, 25);
  assert.ok(tira.every((q) => q.length === 80 && q.every((v) => v >= 0 && v <= 1)));
  const base = Apoio.gradeDePixels(20, 4, sorteador(7));
  assert.deepEqual(tira[12], base.map((tom) => [0, 1, 0.6, 0.32][tom]));
});

test('tira de quadros: as pontas encostam nas letras, a variação é contínua e quase todo pixel varia', () => {
  const colunas = 20, tira = Apoio.tiraDePixels(colunas, 4, Apoio.QUADROS, sorteador(11));
  tira.forEach((q) => q.forEach((v, i) => { if (i % colunas === 0 || i % colunas === colunas - 1) assert.ok(v >= 0.32); }));
  let maior = 0;
  for (let k = 1; k < Apoio.QUADROS; k++) tira[k].forEach((v, i) => { maior = Math.max(maior, Math.abs(v - tira[k - 1][i])); });
  assert.ok(maior <= 0.4, 'quadros vizinhos diferem pouco: ' + maior);
  const mexe = tira[0].map((_, i) => tira.some((q) => Math.abs(q[i] - tira[12][i]) > 0.05));
  assert.ok(mexe.filter(Boolean).length > 0.7 * 80);
});

test('tira de quadros: sorteada, nunca derivada do e-mail', () => {
  assert.notDeepEqual(Apoio.tiraDePixels(20, 4, Apoio.QUADROS, sorteador(1)), Apoio.tiraDePixels(20, 4, Apoio.QUADROS, sorteador(2)));
  assert.deepEqual(Apoio.tiraDePixels(20, 4, Apoio.QUADROS, sorteador(3)), Apoio.tiraDePixels(20, 4, Apoio.QUADROS, sorteador(3)));
  assert.equal(Apoio.tiraDePixels.length, 4, 'a função não recebe o e-mail');
});

test('intensidade do ângulo: 0 em repouso, sinal pelo lado, nunca passa de ±1', () => {
  assert.equal(Apoio.intensidadeDoAngulo(0, 0, 6), 0);
  assert.ok(Apoio.intensidadeDoAngulo(0, -6, 6) > 0 && Apoio.intensidadeDoAngulo(0, 6, 6) < 0);
  assert.ok(Apoio.intensidadeDoAngulo(6, 0, 6) > 0 && Apoio.intensidadeDoAngulo(-6, 0, 6) < 0);
  assert.ok(Math.abs(Apoio.intensidadeDoAngulo(6, -6, 6) - 1) < 1e-9);
  assert.ok(Math.abs(Apoio.intensidadeDoAngulo(99, -99, 6)) <= 1);
  assert.equal(Apoio.intensidadeDoAngulo(1, -1, 0), 0);
});
