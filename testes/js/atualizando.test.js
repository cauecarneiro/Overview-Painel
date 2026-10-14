'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publico = (nome) => fs.readFileSync(path.join(__dirname, '..', '..', 'publico', nome), 'utf8');

test('só a linha "Atualizando leitura" ganha o brilho: a classe vem de a conta estar consultando', () => {
  const app = publico('cotas.js');
  assert.match(app, /escreverIdade\(card, textoDaIdade\([^)]*\), !!card\.conta\.consultando\)/, 'o estado de consulta vira booleano antes de chegar à linha');
  assert.match(app, /classList\.toggle\("atualizando",\s*card\.idadeAtualizando\)/, 'a classe segue o estado aplicado');
  assert.match(app, /if \(card\.conta\.consultando\) return "Atualizando leitura"/, 'o texto continua o mesmo');
});

test('o brilho percorre o texto da esquerda para a direita em ciclo contínuo de 1,4 s', () => {
  const css = publico('cartao-cota.css');
  assert.match(css, /\.age\.atualizando\s*\{[^}]*background-clip:\s*text[^}]*animation:\s*brilho-do-texto 1\.4s linear infinite/, 'ciclo contínuo de 1,4 s');
  assert.match(css, /\.age\.atualizando\s*\{\s*width:\s*fit-content/, 'o brilho percorre só a largura do texto, não a linha inteira');
  assert.match(css, /@supports[^{]*background-clip:\s*text\)\s*\{\s*\.age\.atualizando/, 'sem suporte a background-clip o texto segue sólido');
  assert.match(css, /@keyframes brilho-do-texto\s*\{\s*from\s*\{\s*background-position:\s*100% 0;?\s*\}\s*to\s*\{\s*background-position:\s*0% 0;?\s*\}\s*\}/, 'da esquerda para a direita');
  assert.match(css, /\.age\.atualizando\s*\{[^}]*var\(--apagado\)[^}]*var\(--c-tinta\)/, 'o brilho sai do cinza do texto para a cor de tinta');
});

test('com movimento reduzido ou cores forçadas o texto fica parado e legível', () => {
  const css = publico('cartao-cota.css');
  const reduzido = css.slice(css.lastIndexOf('prefers-reduced-motion'));
  assert.match(reduzido, /\.age\.atualizando\s*\{[^}]*animation:\s*none[^}]*color:\s*var\(--tinta2\)[^}]*background:\s*none/, 'sem animação, cor sólida');
  assert.match(css, /@media \(forced-colors: active\)\s*\{\s*\.age\.atualizando\s*\{[^}]*color:\s*CanvasText/, 'cores forçadas usam o texto do sistema');
});

test('depois de "Atualizando leitura" a linha vira a idade da leitura, em vez de sumir', () => {
  const app = publico('cotas.js');
  const corpo = app.slice(app.indexOf('function textoDaIdade'), app.indexOf('/* A linha de baixo troca'));
  assert.match(corpo, /if \(card\.conta\.consultando\) return "Atualizando leitura"/);
  assert.match(corpo, /return Prazo\.rotuloDaLeitura\(agoraS - observado\);\s*\}\s*$/, 'sem aviso nem atraso, a linha mostra a idade');
  assert.doesNotMatch(corpo, /return "";/, 'a linha nunca fica vazia depois de uma leitura');
  assert.doesNotMatch(app, /function idade\(/, 'a formatação da idade mora em prazo.js, testada');
  assert.match(corpo, /!velho[^;]*erro[^;]*Última consulta não concluída|erro\) return "Última consulta não concluída"/, 'o aviso de consulta não concluída continua');
});

test('a troca entre "Atualizando leitura" e a idade sai em 250 ms e entra em 350 ms, só quando o estado muda', () => {
  const app = publico('cotas.js');
  assert.match(app, /duration:\s*250/, 'saída de 250 ms');
  assert.match(app, /duration:\s*350/, 'entrada de 350 ms');
  assert.match(app, /blur\(\.5px\)[\s\S]*translateY\(-1\.5px\)/, 'a saída desfoca e sobe um pouco');
  assert.match(app, /blur\(1\.5px\)[\s\S]*translateY\(1\.5px\)/, 'a entrada nasce desfocada e abaixo');
  assert.match(app, /atualizando !== card\.idadeAtualizando/, 'só o estado de consulta dispara a troca, não o avanço dos minutos');
  assert.match(app, /reduzido\(\)\)\s*\{[^}]*aplicarIdade\(card\)/, 'movimento reduzido troca na hora');
  assert.match(app, /sai\.onfinish|\.onfinish/, 'a entrada começa quando a saída termina');
});
