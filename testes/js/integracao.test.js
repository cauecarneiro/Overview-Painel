'use strict';
/* A costura do card H1 com a página do painel: o que não existe no quota-board em Node (ele busca /api/state e tem página própria)
   e que aqui precisa valer. O resto do card tem os testes do original (prazo, capsula, privacidade, resumo, atualizando). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ler = (nome) => fs.readFileSync(path.join(__dirname, '..', '..', 'publico', nome), 'utf8');
const cotas = ler('cotas.js');
const codigo = cotas.slice(cotas.indexOf('(function () {'));      // sem o comentário de abertura, que cita o que saiu
const css = ler('cartao-cota.css');
const html = ler('index.html');

test('o card só desenha com os módulos do original carregados, e a página os carrega antes do cotas.js', () => {
  assert.match(cotas, /!window\.Prazo \|\| !window\.Capsula \|\| !window\.Privacidade \|\| !window\.Resumo\) return;/);
  assert.match(html, /var fila = \["prazo\.js", "capsula\.js", "privacidade\.js", "resumo\.js", "cotas\.js"\];/);
  assert.match(html, /estilo\.href = "cartao-cota\.css\?t=" \+ Date\.now\(\)/);
  assert.match(html, /s\.onload = proximo/, 'um de cada vez, em ordem');
});

test('a página alimenta o card: nada de rede, e a API é a que o index.html já chama', () => {
  assert.doesNotMatch(codigo, /fetch\(|\/api\/|XMLHttpRequest/, 'o card não busca nada; recebe o bloco "contas" do dados.js');
  assert.match(cotas, /window\.__painelContas = \{ desenhar: desenhar \};/);
  assert.match(html, /window\.__painelContas\.desenhar\(dados\.contas, agoraS\)/);
  assert.match(cotas, /function desenhar\(contas, agoraS\)/);
});

test('as mensagens do bloco "contas" são as da página (coletor --sem-contas e canvas vazio)', () => {
  assert.match(cotas, /A consulta às CLIs está desligada \(coletor --sem-contas\)/);
  assert.match(cotas, /Nenhuma conta em execução no canvas/);
});

test('o verso, o painel Efeito e o giro não vieram: o interruptor está desligado no original', () => {
  assert.doesNotMatch(codigo, /Ascii|virar\(|girar\(|FLIP_ATIVO|efeito:virar|card-verso|verso-efeito/);
  assert.doesNotMatch(css, /\.card-verso|\.verso-efeito|\.card-lustro|\.virado/);
});

test('o Tema e o Atualizar são da página; a Privacidade é do card, com a chave da página e o estado no rótulo', () => {
  assert.doesNotMatch(cotas, /getElementById\("tema"\)|getElementById\("atualizar"\)|quota-board-tema/);
  assert.match(cotas, /localStorage\.getItem\("painel-privacidade"\) !== "0"/);
  assert.match(cotas, /localStorage\.setItem\("painel-privacidade", privado \? "1" : "0"\)/);
  assert.match(cotas, /texto\(botao, "Privacidade: " \+ \(privado \? "ligada" : "desligada"\)\)/);
  assert.match(html, /<button id="privacidade" type="button"/);
});

test('trocar o tema (pelo botão da página ou pelo sistema) redesenha a tarja, que é pintada na cor do texto', () => {
  assert.match(cotas, /new MutationObserver\(aplicarPrivacidade\)\.observe\(document\.documentElement, \{ attributes: true, attributeFilter: \["data-tema"\] \}\)/);
  assert.match(cotas, /matchMedia\("\(prefers-color-scheme: dark\)"\)\.addEventListener\("change", aplicarPrivacidade\)/);
});

test('as cores e a fonte do original valem só dentro da seção #contas, sem mexer nos tokens da página', () => {
  assert.match(css, /^#contas \{ color: var\(--tinta\); font: 13px\/1\.45 -apple-system/m);
  assert.match(css, /^#contas \{ --sup: #ffffff;[^}]*--tinta: #1b1b1a;/m, 'claro');
  assert.match(css, /html\[data-tema="escuro"\] #contas \{ --sup: #161615;[^}]*--tinta: #f7f7f3;/, 'escuro');
  assert.doesNotMatch(css, /^:root|^html \{|^body \{/m, 'nada global');
  assert.match(css, /#contas\.cartao \{ background: none;/);
});

test('o ícone do Codex vai embutido (a máscara não vale por file://); os outros dois ficam como arquivo', () => {
  assert.match(css, /\.card\[data-ferramenta="codex"\] \{ --icone: url\("data:image\/png;base64,/);
  assert.match(css, /\.card\[data-ferramenta="claude"\] \{ --icone: url\(icone-claude\.png\); \}/);
  assert.match(css, /\.card\[data-ferramenta="agy"\] \{ --icone: url\(icone-agy\.png\); \}/);
  for (const arq of ['icone-claude.png', 'icone-codex.png', 'icone-agy.png']) assert.ok(fs.existsSync(path.join(__dirname, '..', '..', 'publico', arq)), arq);
});

test('o card consome o contrato do painel: grupo_rotulo e provisorio vêm de lib/contas.py', () => {
  const py = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'contas.py'), 'utf8');
  assert.match(py, /"grupo_rotulo": j\["rotulo"\]/);
  assert.match(py, /barra\["provisorio"\] = janela_provisoria\(/);
  assert.match(cotas, /grupo_rotulo/);
  assert.match(ler('prazo.js'), /b\.provisorio/);
});
