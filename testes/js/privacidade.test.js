'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { partesDoEmail, abreviarCaminho, gradeDePixels, tiraDePixels, intensidadeDoAngulo, QUADROS } = require('../../publico/privacidade.js');
const fs = require('node:fs');
const path = require('node:path');
const publico = (nome) => fs.readFileSync(path.join(__dirname, '..', '..', 'publico', nome), 'utf8');

test('e-mail: começo curto, miolo oculto de tamanho fixo e domínio inteiro', () => {
  assert.deepEqual(partesDoEmail('maria.silva@example.com'), { antes: 'ma', ocultos: 6, depois: '@example.com' });
  assert.deepEqual(partesDoEmail('al@example.com'), { antes: '', ocultos: 6, depois: '@example.com' });
  assert.deepEqual(partesDoEmail('abc@example.com'), { antes: 'a', ocultos: 6, depois: '@example.com' });
});

test('o miolo oculto não revela o tamanho do nome', () => {
  assert.equal(partesDoEmail('abcdefgh@example.com').ocultos, partesDoEmail('abcdefghijklmnopqrstuvwxyz@example.com').ocultos);
});

test('texto sem @ some por inteiro', () => {
  assert.deepEqual(partesDoEmail('conta-sem-arroba'), { antes: 'co', ocultos: 6, depois: '' });
  assert.deepEqual(partesDoEmail(null), { antes: '', ocultos: 6, depois: '' });
});

test('pasta: "~" no lugar da pasta pessoal e só os dois últimos trechos', () => {
  assert.equal(abreviarCaminho('/Users/pessoa/orquestra/state/codex-homes/codex-1'), '~/…/codex-homes/codex-1');
  assert.equal(abreviarCaminho('/home/pessoa/.codex'), '~/.codex');
  assert.equal(abreviarCaminho('/Users/pessoa/.config/claude'), '~/.config/claude');
  assert.equal(abreviarCaminho('/opt/ferramentas/contas/conta-2'), '/…/contas/conta-2');
  assert.equal(abreviarCaminho(''), '');
});

test('grade de pixels: tamanho pedido, só quatro valores e sem relação com o e-mail', () => {
  const grade = gradeDePixels(20, 4, Math.random);
  assert.equal(grade.length, 80);
  assert.ok(grade.every((tom) => [0, 1, 2, 3].includes(tom)));
  assert.ok(grade.some((tom) => tom > 0), 'a grade não pode sair vazia');
  assert.deepEqual(gradeDePixels(3, 2, () => 0), [1, 0, 1, 1, 0, 1], 'só as pontas não podem ficar vazias');
  assert.deepEqual(gradeDePixels(3, 2, () => 0.99), [3, 3, 3, 3, 3, 3]);
});

test('o plano vem depois do e-mail só com um espaço, sem ponto separador', () => {
  const app = publico('cotas.js');
  const identidade = app.slice(app.indexOf('function identidade(card)'), app.indexOf('var ICONES_COPIAR'));
  assert.doesNotMatch(identidade, /\\u00b7|·/, 'sem o ponto entre o e-mail e o plano');
  assert.match(identidade, /plano \? "\\u2002" \+ plano/, 'um espaço largo separa o e-mail do plano');
});

/* ---- a tarja varia com a inclinação do card ---- */
function sorteador(semente) { let x = semente; return () => { x = (x * 16807) % 2147483647; return x / 2147483647; }; }

test('tira de quadros: 25 quadros do tamanho da grade, tudo em [0, 1], e o quadro do meio é o desenho em repouso', () => {
  assert.equal(QUADROS, 25);
  const tira = tiraDePixels(20, 4, QUADROS, sorteador(7));
  assert.equal(tira.length, QUADROS);
  assert.ok(tira.every((q) => q.length === 80 && q.every((v) => v >= 0 && v <= 1)));
  const repouso = tira[(QUADROS - 1) / 2];
  const base = gradeDePixels(20, 4, sorteador(7));
  assert.deepEqual(repouso, base.map((tom) => [0, 1, 0.6, 0.32][tom]), 'o quadro central é a grade de hoje, nos mesmos três tons');
});

test('tira de quadros: as pontas nunca ficam vazias, a variação é contínua e todo pixel varia ao longo da tira', () => {
  const colunas = 20, tira = tiraDePixels(colunas, 4, QUADROS, sorteador(11));
  tira.forEach((q) => q.forEach((v, i) => { if (i % colunas === 0 || i % colunas === colunas - 1) assert.ok(v >= 0.32, 'a tarja encosta nas letras em todo quadro'); }));
  let maior = 0;
  for (let k = 1; k < QUADROS; k++) tira[k].forEach((v, i) => { maior = Math.max(maior, Math.abs(v - tira[k - 1][i])); });
  assert.ok(maior <= 0.4, 'quadros vizinhos diferem pouco: ' + maior);
  const mexe = tira[0].map((_, i) => tira.some((q) => Math.abs(q[i] - tira[12][i]) > 0.05));
  assert.ok(mexe.filter(Boolean).length > 0.7 * 80, 'a maioria dos pixels muda de tom ao longo da inclinação');
});

test('tira de quadros: sorteada, nunca derivada do e-mail (outra semente, outra tira; mesma semente, mesma tira)', () => {
  assert.notDeepEqual(tiraDePixels(20, 4, QUADROS, sorteador(1)), tiraDePixels(20, 4, QUADROS, sorteador(2)));
  assert.deepEqual(tiraDePixels(20, 4, QUADROS, sorteador(3)), tiraDePixels(20, 4, QUADROS, sorteador(3)));
  assert.equal(tiraDePixels.length, 4, 'a função não recebe o e-mail');
});

test('intensidade do ângulo: 0 em repouso, sinal pelo lado, nunca passa de ±1', () => {
  assert.equal(intensidadeDoAngulo(0, 0, 4), 0);
  assert.ok(intensidadeDoAngulo(0, -4, 4) > 0 && intensidadeDoAngulo(0, 4, 4) < 0, 'ponteiro à direita (rotateY negativo) é positivo');
  assert.ok(intensidadeDoAngulo(4, 0, 4) > 0 && intensidadeDoAngulo(-4, 0, 4) < 0, 'ponteiro embaixo (rotateX positivo) é positivo');
  assert.ok(Math.abs(intensidadeDoAngulo(4, -4, 4) - 1) < 1e-9, 'o canto extremo vale 1');
  assert.ok(Math.abs(intensidadeDoAngulo(99, -99, 4)) <= 1);
  assert.equal(intensidadeDoAngulo(1, -1, 0), 0, 'sem ângulo máximo não há variação');
});

test('a tarja no navegador: duas camadas de quadros vizinhos escolhidas por --angulo, com transição na inclinação', () => {
  const css = publico('cartao-cota.css'), app = publico('cotas.js');
  assert.match(css, /@property --angulo\s*\{[^}]*syntax:\s*"<number>"[^}]*inherits:\s*true/, '--angulo registrada e herdada pelo e-mail');
  assert.match(css, /\.email-pixelado::before[^{]*\{[^}]*var\(--tira\)/, 'a camada de baixo usa a tira');
  assert.match(css, /\.email-pixelado::after[^{]*\{[^}]*opacity:\s*calc\(var\(--q\) - var\(--i0\)\)/, 'a de cima entra pela fração do quadro');
  assert.match(css, /@supports \(width:\s*round\(down/, 'sem round() fica o quadro de repouso');
  assert.match(app, /Privacidade\.tiraDePixels\(/);
  assert.match(app, /Privacidade\.intensidadeDoAngulo\(/);
  assert.match(app, /"transform " \+ TILT\.duracao \+ "ms ease-out, --angulo "/, '--angulo desliza na mesma curva da inclinação');
  assert.match(app, /removeProperty\("--angulo"\)/, 'ao sair, a tarja volta ao repouso');
});
