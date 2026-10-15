'use strict';
/* O contrato do card de cota (publico/cotas.js e index.html): o que a cápsula e a tarja prometem e que só se vê no navegador.
   São asserções sobre o texto dos arquivos, porque a página abre por file:// e não tem build; a aritmética está em cartao-apoio.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ler = (nome) => fs.readFileSync(path.join(__dirname, '..', '..', 'publico', nome), 'utf8');
const cotas = ler('cotas.js');
const html = ler('index.html');

test('o card só desenha com o apoio carregado, e a página carrega o apoio antes do cotas.js', () => {
  assert.match(cotas, /!window\.CartaoApoio\) return;/);
  assert.match(html, /puxar\("cartao-apoio\.js", function \(\) \{ puxar\("cotas\.js"\); \}\)/);
});

test('a barra é a cápsula: consumo e faixa de tempo no mesmo contorno, e o botão da barra continua abrindo o verso', () => {
  assert.match(cotas, /class="visual"><span class="tempo-nome" hidden>Tempo<\/span><div class="cap"><div class="cap-uso"><span class="fill"><\/span><\/div>/);
  assert.match(cotas, /<button class="quota-hit" type="button" aria-expanded="false"><\/button>/);
  assert.match(cotas, /classList\.toggle\("tempo-acima", comTempo && temUso && Apoio\.tempoAcima\(t\.cursor, b\.usado_pct\)\)/, 'a classe vem só da função pura');
  assert.doesNotMatch(cotas, /class="track"|class="cursor"|ligarGomos|diaDoGomo/, 'a barra grossa com cursor e a dica do gomo saíram');
});

test('só a ordem das faixas muda: contorno, altura, pílula e conector ficam; o rótulo Tempo acompanha a faixa de tempo', () => {
  assert.match(cotas, /\.weekly \.visual \{[^}]*--barra: 5px/);
  assert.match(cotas, /\.visual \{[^}]*--barra: 8px[^}]*--faixa-c: 4px/);
  assert.doesNotMatch(cotas, /\.tempo-acima[^{}]*\.cap\s*\{/, 'a ordem nunca muda o contorno');
  assert.doesNotMatch(cotas, /\.tempo-acima[^{}]*\.(relogio|conector)\s*\{/, 'a ordem nunca move pílula nem conector');
  assert.match(cotas, /\.tempo-acima \.cap-uso \{ top: calc\(var\(--faixa\) \+ 1px\); \}/);
  assert.match(cotas, /\.tempo-acima \.regua \{ top: 0; \}/);
  assert.match(cotas, /\.tempo-acima \.tempo-nome \{ top: calc\(3px \+ var\(--faixa\) \/ 2/, 'Tempo sobe junto com a faixa');
  assert.match(cotas, /\.tempo-nome \{[^}]*top: calc\(3px \+ var\(--barra\) \+ 1px \+ var\(--faixa\) \/ 2/, 'Tempo fica no centro da faixa, que cresce no realce');
  for (const alvo of ['\\.cap-uso', '\\.regua', '\\.cap::after', '\\.tempo-nome']) {
    assert.match(cotas, new RegExp(alvo + ' \\{[^}]*transition:[^;]*top 240ms'), alvo + ' troca em 240 ms');
  }
});

test('o realce vem do mouse (com espera), do foco do teclado e de nada mais; o toque só vira o card', () => {
  assert.match(cotas, /pointerenter[^\n]*agendarMouse\(true\)/);
  assert.match(cotas, /pointerleave[^\n]*agendarMouse\(false\)/);
  assert.match(cotas, /Apoio\.atrasoDoRealce\(entrada\)/);
  assert.match(cotas, /addEventListener\("focus"[\s\S]*matches\(":focus-visible"\)[\s\S]*realcar\(barra\)/);
  assert.doesNotMatch(cotas, /barra\.toque/, 'sem realce por toque: tocar vira o card e o verso traz o tempo');
  assert.match(cotas, /if \(ev\.key === "Escape"\) \{ encerrarRealces\(\); desvirarTodos\(\); \}/, 'Esc encerra o realce');
});

test('nada essencial fica só no hover: o tempo decorrido também vai no nome acessível da barra', () => {
  assert.match(cotas, /% do período decorrido\./);
});

test('movimento reduzido: sem troca animada, sem pulso, sem a pílula que se desloca', () => {
  const reduzido = cotas.slice(cotas.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduzido, /\.agulha::after \{ animation: none; \}/);
  assert.match(reduzido, /\.realce \.relogio \{ animation: none;/);
  assert.match(reduzido, /\.realce \.r-rotulo, \.realce \.r-rotulo > span \{ animation: none; \}/);
  assert.match(reduzido, /\.visual, \.cap, \.cap-uso, \.regua[^{]*\{ transition: opacity 120ms/);
});

test('a tarja: duas camadas de quadros vizinhos escolhidas por --angulo, com transição na inclinação do card', () => {
  assert.match(cotas, /@property --angulo \{ syntax: "<number>"; inherits: true; initial-value: 0; \}/);
  assert.match(cotas, /\.email-pixelado::before, \.email-pixelado::after \{[^}]*var\(--tira\)/);
  assert.match(cotas, /\.email-pixelado::after \{ display: block;[^}]*opacity: calc\(var\(--q\) - var\(--i0\)\)/);
  assert.match(cotas, /@supports \(width: round\(down, 1px, 1px\)\)/, 'sem round() fica o quadro de repouso');
  assert.match(cotas, /Apoio\.tiraDePixels\(/);
  assert.match(cotas, /Apoio\.intensidadeDoAngulo\(xRot, yRot, TILT\.angulo\)/);
  assert.match(cotas, /"transform " \+ TILT\.duracao \+ "ms ease-out, --angulo " \+ TILT\.duracao \+ "ms ease-out"/, '--angulo desliza na mesma curva da inclinação');
  assert.match(cotas, /removeProperty\("--angulo"\)/, 'ao sair, a tarja volta ao repouso');
});

test('a privacidade: ligada por padrão, guardada no navegador e sem e-mail na dica nativa nem no verso', () => {
  assert.match(cotas, /var privado = true;\ntry \{ privado = localStorage\.getItem\("painel-privacidade"\) !== "0"; \}/);
  assert.match(cotas, /if \(privado\) card\.rotuloConta\.removeAttribute\("title"\)/);
  assert.match(cotas, /atributo\(card\.tituloNo, "title", mascarar\(c\.titulo \|\| ""\)\)/);
  assert.match(cotas, /texto\(v\.eyebrow, mascarar\(/);
  assert.match(cotas, /mascarar\(conta\.erro_detalhe/);
  assert.doesNotMatch(cotas, /texto\(card\.rotuloConta|texto\(card\.titulo/, 'o e-mail só é escrito por escreverComEmail');
  assert.match(cotas, /new MutationObserver\(aplicarPrivacidade\)\.observe\(document\.documentElement, \{ attributes: true, attributeFilter: \["data-tema"\] \}\)/, 'trocar o tema redesenha a tarja');
  assert.match(html, /<button id="privacidade" type="button"/);
});
