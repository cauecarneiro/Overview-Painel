'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Capsula = require('../../publico/capsula.js');

const publico = (nome) => fs.readFileSync(path.join(__dirname, '..', '..', 'publico', nome), 'utf8');

// Um período de 5 horas (300 min) que termina em RENOVA; o início é RENOVA - 18000 s.
const RENOVA = 1791648000 + 18000;
const INICIO = RENOVA - 18000;
const SEMANA = 10080;

test('o decorrido começa em 0 no início do período e é o mesmo cálculo da posição da agulha', () => {
  assert.equal(Capsula.decorrido(INICIO, RENOVA, 300), 0);
  assert.equal(Capsula.decorrido(INICIO + 7092, RENOVA, 300), 7092);
  assert.equal(Capsula.decorrido(INICIO + 7092.9, RENOVA, 300), 7092, 'só segundos inteiros');
  assert.equal(Capsula.decorrido(INICIO + 9000, RENOVA, 300) / 18000, 0.5);
});

test('o decorrido não passa dos limites do período (0 antes do início, 5 h ou 7 d no fim)', () => {
  assert.equal(Capsula.decorrido(INICIO - 50, RENOVA, 300), 0);
  assert.equal(Capsula.decorrido(RENOVA, RENOVA, 300), 18000);
  assert.equal(Capsula.decorrido(RENOVA + 999, RENOVA, 300), 18000);
  assert.equal(Capsula.decorrido(RENOVA + 999, RENOVA, SEMANA), 604800);
});

test('o formato do decorrido: h:mm:ss nas 5 horas e "d hh:mm:ss" na Semana', () => {
  assert.equal(Capsula.formatarDecorrido(0, 300), '0:00:00');
  assert.equal(Capsula.formatarDecorrido(7092, 300), '1:58:12');
  assert.equal(Capsula.formatarDecorrido(3599, 300), '0:59:59');
  assert.equal(Capsula.formatarDecorrido(18000, 300), '5:00:00');
  assert.equal(Capsula.formatarDecorrido(0, SEMANA), '0 d 00:00:00');
  assert.equal(Capsula.formatarDecorrido(2 * 86400 + 6 * 3600 + 12 * 60 + 40, SEMANA), '2 d 06:12:40');
  assert.equal(Capsula.formatarDecorrido(604800, SEMANA), '7 d 00:00:00');
});

test('a pílula mantém só o contador após o rótulo, sem seletor temporário nem fecho', () => {
  for (const nome of ['cotas.js', 'capsula.js', 'cartao-cota.css']) {
    assert.doesNotMatch(publico(nome), /data-pilula|pilula=b|r-fecho|duracaoDoPeriodo/, nome);
  }
  assert.match(publico('cotas.js'), /class="conector"[^>]*><\/span><div class="relogio"[^>]*><span class="r-rotulo"><span>Decorrido <\/span><\/span><span class="r-timer"><\/span><\/div>/);
});

test('o decorrido não depende do relógio de parede nem do fuso: só aritmética', () => {
  const fonte = publico('capsula.js');
  assert.doesNotMatch(fonte, /Intl|timeZone|new Date|getHours|toLocale/, 'sem hora do dia');
  assert.equal(typeof Capsula.relogio, 'undefined');
});

test('o mouse espera 300 ms para abrir e tolera 100 ms ao sair; teclado e toque não usam o atraso', () => {
  assert.equal(Capsula.atrasoDoRealce(true), 300);
  assert.equal(Capsula.atrasoDoRealce(false), 100);
  const app = publico('cotas.js');
  assert.match(app, /function agendarMouse\(entrada\)[\s\S]*atrasoDoRealce\(entrada\)/, 'o agendamento usa os tempos do contrato');
  assert.match(app, /pointerenter[^\n]*agendarMouse\(true\)/, 'entrada do mouse usa dwell');
  assert.match(app, /pointerleave[^\n]*agendarMouse\(false\)/, 'saída do mouse usa tolerância');
  assert.match(app, /pointerdown[\s\S]*barra\.toque = !barra\.toque; realcar\(barra\)/, 'toque continua imediato');
  assert.match(app, /addEventListener\("focus"[\s\S]*realcar\(barra\)/, 'foco continua imediato');
});

test('o texto da pílula: o decorrido só com a pílula visível e com tempo comprovado', () => {
  const agora = INICIO + 7092;
  assert.equal(Capsula.timerDaPilula(true, true, agora, RENOVA, 300), '1:58:12');
  assert.equal(Capsula.timerDaPilula(false, true, agora, RENOVA, 300), '');
  assert.equal(Capsula.timerDaPilula(true, false, agora, RENOVA, 300), '');
  const renovaSemana = INICIO + 604800;
  assert.equal(Capsula.timerDaPilula(true, true, renovaSemana - 604800 + 2 * 86400 + 6 * 3600 + 12 * 60 + 40, renovaSemana, SEMANA), '2 d 06:12:40');
});

test('o pulso da agulha cai no começo de cada minuto: a fase vem dos segundos do minuto', () => {
  assert.equal(Capsula.fasePulso(1791648000), 0);
  assert.equal(Capsula.fasePulso(1791648007.9), 7);
  assert.equal(Capsula.fasePulso(1791648059), 59);
  assert.equal(Capsula.fasePulso(1791648060), 0);
});

test('a cápsula V3 é o desenho padrão: não sobra variante nenhuma na página', () => {
  for (const nome of ['cotas.js', 'capsula.js', 'index.html', 'cartao-cota.css']) {
    assert.doesNotMatch(publico(nome), /variante|VARIANTE|data-variante/i, nome);
  }
  assert.equal(Capsula.variante, undefined);
});

test('a cápsula padrão tem a régua de marcas, a agulha fina e o realce sem movimento no modo reduzido', () => {
  const css = publico('cartao-cota.css');
  assert.match(css, /\.marcas\s*\{[^}]*repeat-x/, 'segmentos da régua, só no realce');
  assert.match(css, /\.agulha\s*\{[^}]*width:\s*1px/, 'agulha de 1 px em repouso');
  assert.match(css, /\.realce \.agulha\s*\{[^}]*width:\s*2px/, 'agulha engrossa no realce');
  const reduzido = css.slice(css.lastIndexOf('prefers-reduced-motion'));
  assert.match(reduzido, /\.realce \.agulha\s*\{[^}]*width:\s*1px/, 'sem mudança de tamanho com movimento reduzido');
  assert.match(reduzido, /\.r-rotulo, \.realce \.r-rotulo\s*\{[^}]*max-width:\s*10ch[^}]*opacity:\s*1[^}]*animation:\s*none/, 'Decorrido permanece sem a animação que o contextualiza');
  });

test('slots compactos se unem no realce sem recortar a agulha', () => {
  const css = publico('cartao-cota.css');
  const app = publico('cotas.js');
  assert.match(css, /--slots:\s*5/);
  assert.match(css, /\.weekly \.visual\s*\{[^}]*--slots:\s*7/);
  assert.match(css, /@property --slot-gap\s*\{[^}]*inherits:\s*true/);
  assert.match(css, /\.cap\s*\{[^}]*--slot-gap:\s*1px/, 'divisores compactos têm peso de fio');
  assert.match(css, /\.realce \.cap\s*\{[^}]*--slot-gap:\s*0px/);
  assert.match(css, /\.fundo-tempo\s*\{[^}]*mask-image:/);
  assert.doesNotMatch(css, /\.track[^{}]*\{[^}]*mask-image:/, 'consumo sem cortes');
  assert.match(css, /\.cap\s*\{[^}]*border:\s*1px solid var\(--c-borda\)/, 'contorno externo contínuo');
  assert.match(css, /\.cap::after\s*\{[^}]*height:\s*1px[^}]*var\(--c-fio-forte\)/, 'fio entre as faixas contínuo');
  assert.doesNotMatch(css, /\.agulha\s*\{[^}]*mask/);
  assert.match(app, /class="fundo-tempo" aria-hidden="true"><span class="decorrido"/);
});

test('a pílula nasce larga e só depois recolhe o rótulo dentro do próprio recorte', () => {
  const css = publico('cartao-cota.css');
  assert.match(css, /\.r-rotulo\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*flex-end[^}]*max-width:\s*10ch[^}]*overflow:\s*hidden/, 'o rótulo começa aberto, ancorado no timer e com seu próprio recorte');
  assert.match(css, /\.r-rotulo > span\s*\{[^}]*flex:\s*none[^}]*width:\s*max-content/, 'o texto conserva a largura durante o recolhimento');
  assert.match(css, /\.realce \.r-rotulo\s*\{[^}]*animation:\s*recolher-rotulo\s+520ms[^;]*1300ms[^;]*forwards/, 'o recolhimento acompanha os 520 ms de deslocamento após esperar 1.300 ms');
  assert.match(css, /@keyframes recolher-rotulo\s*\{[\s\S]*?from\s*\{[^}]*max-width:\s*10ch[\s\S]*?to\s*\{[^}]*max-width:\s*0/, 'a pill compacta de largura completa a zero');
  assert.doesNotMatch(css, /@keyframes recolher-texto/, 'o texto não atravessa o timer com um transform próprio');
  assert.doesNotMatch(css, /\.realce \.r-rotulo\s*\{[^}]*transform:/, 'o container do rótulo não atravessa o timer');
});

test('ao compactar, a pílula acompanha a agulha sem ultrapassar a margem interna da barra', () => {
  const css = publico('cartao-cota.css');
  assert.match(css, /\.visual\s*\{[^}]*--folga-pilula:\s*2px/, 'a pílula preserva uma pequena folga dentro do trilho');
  assert.match(css, /\.visual\s*\{[^}]*--meia-compacta:\s*31px/, 'o timer de 5 horas usa seu próprio limite compacto');
  assert.match(css, /\.weekly \.visual\s*\{[^}]*--meia-compacta:\s*46px/, 'o timer semanal reserva a largura medida do formato com dias');
  assert.match(css, /@keyframes seguir-agulha\s*\{[\s\S]*?from\s*\{[^}]*--meia-pilula[\s\S]*?to\s*\{[^}]*--meia-compacta/, 'o centro avança do limite aberto ao compacto');
  assert.match(css, /\.realce \.relogio\s*\{[^}]*animation:\s*seguir-agulha\s+520ms[^;]*1300ms[^;]*forwards/, 'o deslocamento desacelera em um único percurso sincronizado com o recolhimento');
  const reduzido = css.slice(css.lastIndexOf('prefers-reduced-motion'));
  assert.match(reduzido, /\.relogio, \.realce \.relogio\s*\{[^}]*animation:\s*none/, 'movimento reduzido mantém a pill aberta e imóvel');
});

test('a pílula abre uma faixa abaixo da régua e se liga à agulha sem ocupar a cápsula', () => {
  const css = publico('cartao-cota.css');
  assert.match(css, /\.realce \.visual\s*\{[^}]*height:/, 'o bloco abre espaço no fluxo');
  assert.match(css, /\.relogio\s*\{[^}]*top:\s*calc\([^;]*--cap-d/, 'a pílula fica depois da faixa detalhada');
  assert.match(css, /\.conector\s*\{[^}]*left:\s*var\(--x\)/, 'o conector nasce na posição da agulha');
  assert.doesNotMatch(publico('cotas.js'), /data-lado|Capsula\.lado/, 'não sobra posicionamento lateral antigo');
  assert.equal(Capsula.lado, undefined);
});

test('o contorno da cápsula em repouso mantém 3:1 contra o card (no claro, 2,8:1 no card escurecido, por decisão da pessoa)', () => {
  const css = publico('cartao-cota.css');
  const luz = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
    .reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i], 0);
  const razao = (a, b) => (Math.max(luz(a), luz(b)) + 0.05) / (Math.min(luz(a), luz(b)) + 0.05);
  const contornos = [...css.matchAll(/--c-borda:\s*(#[0-9a-f]{6})/g)].map((m) => m[1]);
  assert.equal(contornos.length, 3, 'um valor claro e dois escuros (sistema e escolhido)');
  const [claro, ...escuros] = contornos;
  assert.ok(razao(claro, '#ffffff') >= 3, 'claro sobre o card');
  assert.ok(razao(claro, '#ebebe7') >= 2.8, 'claro sobre o card escurecido (a pessoa aceitou 2,83:1)');
  for (const e of escuros) for (const fundo of ['#1a1a19', '#101010']) assert.ok(razao(e, fundo) >= 3, 'escuro sobre ' + fundo);
});

test('no tema escuro o trecho decorrido é claro sem competir com consumo e mantém a agulha nítida', () => {
  const css = publico('cartao-cota.css');
  const luz = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
    .reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i], 0);
  const razao = (a, b) => (Math.max(luz(a), luz(b)) + 0.05) / (Math.min(luz(a), luz(b)) + 0.05);
  const decorrido = [...css.matchAll(/--c-decorrido:\s*(#[0-9a-f]{6})/g)].map((m) => m[1]).slice(1);
  const trilho = [...css.matchAll(/--c-trilho:\s*(#[0-9a-f]{6})/g)].map((m) => m[1]);
  assert.deepEqual(decorrido, ['#6e6e68', '#6e6e68'], 'mesmo valor no tema do sistema e no tema escolhido');
  assert.deepEqual(trilho, ['#40403d', '#40403d'], 'mesmo trilho no tema do sistema e no tema escolhido');
  for (const cor of decorrido) {
    assert.ok(razao(cor, trilho[0]) >= 2, 'trecho decorrido claramente separado do restante da faixa');
    assert.ok(razao(cor, trilho[0]) < 3, 'faixa de tempo continua subordinada à barra colorida de consumo');
    assert.ok(razao('#f7f7f3', cor) >= 4, 'agulha continua nítida sobre o trecho decorrido');
  }
});

test('a faixa do tempo é preenchida, o pulso é só por animação CSS e some com movimento reduzido', () => {
  const css = publico('cartao-cota.css');
  assert.match(css, /@keyframes pulso/, 'pulso por CSS (sem escrita no DOM)');
  assert.match(css, /\.agulha::after\s*\{[^}]*animation:[^;]*60s/, 'um pulso por minuto');
  const reduzido = css.slice(css.lastIndexOf('prefers-reduced-motion'));
  assert.match(reduzido, /\.agulha::after\s*\{[^}]*animation:\s*none/, 'sem pulso com movimento reduzido');
  assert.match(css, /\.decorrido\s*\{[^}]*width:\s*calc\(var\(--t/, 'a faixa se preenche até a agulha');
});

test('a pílula é translúcida e usa as sombras da skill beautiful-shadows, sem o fundo sólido invertido', () => {
  const css = publico('cartao-cota.css');
  assert.match(css, /\.relogio\s*\{[^}]*backdrop-filter/, 'translúcida com desfoque');
  assert.match(css, /0px 2px 3px -1px rgba\(0,0,0,0\.1\)/, 'Beautiful sm na pílula');
  assert.match(css, /0px 24px 24px -12px rgba\(0,0,0,0\.06\)/, 'Beautiful md na cápsula realçada');
  assert.doesNotMatch(css, /\.realce \.relogio\s*\{[^}]*background:\s*var\(--c-tinta\)/, 'sem a pílula escura sólida');
});

test('o swap B: o tempo fica acima só quando o decorrido passa do usado, sem margem, nos dois sentidos', () => {
  assert.equal(Capsula.tempoAcima(60, 40), true, 'decorrido maior: tempo em cima');
  assert.equal(Capsula.tempoAcima(40, 60), false, 'decorrido menor: uso em cima');
  assert.equal(Capsula.tempoAcima(50, 50), false, 'empate: uso em cima');
  assert.equal(Capsula.tempoAcima(50.1, 50), true, 'sem margem de troca');
  assert.equal(Capsula.tempoAcima(49.9, 50), false, 'cruzando de volta, sem histerese');
  assert.equal(Capsula.tempoAcima(1, 0), true, 'uso zerado e período em curso');
});

test('o swap B não inventa posição: sem tempo comprovado ou sem uso a ordem padrão fica', () => {
  assert.equal(Capsula.tempoAcima(null, 40), false);
  assert.equal(Capsula.tempoAcima(60, null), false);
  assert.equal(Capsula.tempoAcima(null, null), false);
  assert.equal(Capsula.tempoAcima(undefined, 10), false);
  assert.equal(Capsula.tempoAcima(NaN, 10), false);
  const app = publico('cotas.js');
  assert.match(app, /classList\.toggle\("tempo-acima",\s*Capsula\.tempoAcima\(d\.tempo,\s*d\.usado\)\)/, 'a classe vem só da função pura');
});

test('o swap B troca só as faixas internas e o fio; contorno, altura e rótulo não mudam', () => {
  const css = publico('cartao-cota.css');
  assert.match(css, /\.weekly \.visual\s*\{[^}]*--barra:\s*5px/, 'a Semana mantém a barra de 5 px');
  assert.match(css, /\.visual\s*\{[^}]*--barra:\s*8px[^}]*--faixa-c:\s*4px/, 'repouso: consumo de 8 px e tempo de 4 px');
  assert.match(css, /\.cap\s*\{[^}]*height:\s*calc\(var\(--barra\)\s*\+\s*1px\s*\+\s*var\(--faixa\)\s*\+\s*2px\)/, 'contorno de 15 px nas 5 horas');
  assert.doesNotMatch(css, /\.tempo-acima[^{}]*\.cap\s*\{/, 'a ordem nunca muda o contorno');
  assert.doesNotMatch(css, /\.tempo-acima[^{}]*\.(relogio|conector)\s*\{/, 'a ordem nunca move pílula nem conector');
  assert.match(css, /\.tempo-acima \.tempo-nome\s*\{[^}]*top:\s*calc\(3px\s*\+\s*var\(--faixa\)\s*\/\s*2/, 'o rótulo Tempo acompanha a faixa de tempo quando ela sobe');
  assert.match(css, /\.tempo-nome\s*\{[^}]*transition:[^;]*top 240ms/, 'o rótulo Tempo anda junto com a troca');
  assert.match(css, /\.track\s*\{[^}]*position:\s*absolute[^}]*top:\s*0/, 'uso em cima por padrão');
  assert.match(css, /\.regua\s*\{[^}]*position:\s*absolute[^}]*top:\s*calc\(var\(--barra\)\s*\+\s*1px\)/, 'tempo embaixo por padrão');
  assert.match(css, /\.tempo-acima \.track\s*\{[^}]*top:\s*calc\(var\(--faixa\)\s*\+\s*1px\)/, 'uso desce abaixo do tempo');
  assert.match(css, /\.tempo-acima \.regua\s*\{[^}]*top:\s*0/, 'tempo sobe para o topo');
  assert.match(css, /\.tempo-acima \.cap::after\s*\{[^}]*top:\s*var\(--faixa\)/, 'o fio acompanha as faixas');
  for (const alvo of ['\\.track', '\\.regua', '\\.cap::after']) {
    assert.match(css, new RegExp(alvo + '\\s*\\{[^}]*transition:[^;]*top 240ms'), alvo + ' troca em 240 ms');
  }
  assert.match(css, /\.regua\s*\{[^}]*height:\s*var\(--faixa\)/, 'a faixa de tempo tem a altura da variável');
  assert.match(css, /\.realce \.visual\s*\{[^}]*--faixa:\s*var\(--faixa-d\)/, 'no realce a faixa de tempo cresce');
});

test('o swap B no movimento reduzido é imediato e a agulha continua legível na faixa de 4 px', () => {
  const css = publico('cartao-cota.css');
  const reduzido = css.slice(css.lastIndexOf('prefers-reduced-motion'));
  assert.match(reduzido, /\.track, \.regua, \.cap::after\s*\{[^}]*transition:\s*none/, 'sem transição de posição');
  assert.match(css, /\.agulha\s*\{[^}]*top:\s*-2px[^}]*height:\s*calc\(100% \+ 4px\)/, 'a agulha avança 2 px em cada lado da faixa fina');
  assert.match(css, /\.realce \.agulha\s*\{[^}]*top:\s*0[^}]*height:\s*100%/, 'no realce a agulha enche a faixa');
});

test('os dias nos cortes: só no realce, centralizados, sem interação própria e sem passar por baixo da agulha', () => {
  const css = publico('cartao-cota.css');
  const app = publico('cotas.js');
  assert.match(app, /class="dias" aria-hidden="true"/, 'decorativo: o dado já está nas frases e no nome acessível');
  assert.match(app, /Prazo\.cortes\(/);
  assert.match(app, /Prazo\.corteAtual\(/);
  assert.match(app, /chaveCortes/, 'só recalcula o texto quando o período muda');
  assert.match(css, /\.dias\s*\{[^}]*grid-template-columns:\s*repeat\(var\(--slots\),\s*1fr\)[^}]*pointer-events:\s*none/, 'um corte por slot da cápsula, sem ponteiro');
  assert.match(css, /\.corte-rotulo\s*\{[^}]*left:\s*var\(--centro,\s*50%\)[^}]*translate\(-50%,\s*-50%\)[^}]*opacity:\s*0/, 'centralizado e invisível em repouso');
  assert.match(css, /\.realce \.corte-rotulo\s*\{[^}]*opacity:\s*1/, 'aparece no realce');
  assert.match(css, /\.corte\.some \.corte-rotulo\s*\{[^}]*opacity:\s*0/, 'some quando não há lugar ao lado da agulha');
  assert.doesNotMatch(css, /\.corte[^{}]*:hover|corte-hora|--i\)/, 'sem hover por corte, sem hora trocada e sem escalonado');
  assert.doesNotMatch(css, /\.dias[^{}]*mask-image/, 'os rótulos não herdam os cortes da máscara');
  const reduzido = css.slice(css.lastIndexOf('prefers-reduced-motion'));
  assert.match(reduzido, /\.corte-rotulo[^{}]*\{[^}]*transition:\s*opacity 120ms/, 'só um fade curto com movimento reduzido');
});
