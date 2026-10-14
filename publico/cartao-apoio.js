/* Apoio do card de cota, sem DOM e sem relógio de parede: só aritmética e regras sobre o "agora" em segundos que quem
   chama passa. É a parte testável da cápsula de uso e tempo e da tarja de privacidade; o desenho fica em cotas.js.
   Script comum no navegador (window.CartaoApoio, a página abre por file://) e require() nos testes (testes/js).

   Cápsula
     decorrido          segundos desde o início do período (início = renova_epoch - janela_min * 60), entre 0 e a duração
     formatarDecorrido  "1:58:12" nas 5 horas; "2 d 06:12:40" na Semana
     timerDaPilula      o texto do contador da pílula: vazio sem pílula visível ou sem tempo comprovado
     atrasoDoRealce     espera de entrada e tolerância de saída do mouse, em milissegundos
     fasePulso          segundos do minuto: o pulso da agulha cai no começo de cada minuto
     tempoAcima         true quando o % decorrido passa do % usado (a faixa de tempo sobe); empate, ausência de um e NaN: false
     cortes             os cortes da faixa de tempo: 5 de 1 h nas 5 horas, 7 de 24 h na Semana, com o rótulo de cada um
     corteAtual         em qual corte a agulha está (0 a n - 1), ou -1 sem tempo
   Privacidade
     partesDoEmail      o que aparece de um e-mail: começo curto, miolo oculto e o domínio inteiro
     mascararEmails     o mesmo para texto corrido (dica nativa, verso): o miolo vira pontos
     gradeDePixels, tiraDePixels, intensidadeDoAngulo   a tarja de pixels e a tira de quadros que a faz variar com a inclinação */
(function (raiz) {
"use strict";

function numero(v) { return typeof v === "number" && isFinite(v); }

/* ---------- cápsula ---------- */
function decorrido(agoraS, renovaEpoch, janelaMin) {
  var duracaoS = janelaMin * 60;
  return Math.floor(Math.min(duracaoS, Math.max(0, agoraS - (renovaEpoch - duracaoS))));
}
function dois(n) { return (n < 10 ? "0" : "") + n; }
function formatarDecorrido(segundos, janelaMin) {
  var d = Math.floor(segundos / 86400), h = Math.floor(segundos % 86400 / 3600), m = Math.floor(segundos % 3600 / 60), s = segundos % 60;
  if (janelaMin >= 1440) return d + " d " + dois(h) + ":" + dois(m) + ":" + dois(s);
  return Math.floor(segundos / 3600) + ":" + dois(m) + ":" + dois(s);
}
function timerDaPilula(ativa, temTempo, agoraS, renovaEpoch, janelaMin) {
  if (!ativa || !temTempo) return "";
  return formatarDecorrido(decorrido(agoraS, renovaEpoch, janelaMin), janelaMin);
}
function atrasoDoRealce(entrada) { return entrada ? 300 : 100; }
function fasePulso(agoraS) { return Math.floor(agoraS) % 60; }
function tempoAcima(tempo, usado) { return numero(tempo) && numero(usado) && tempo > usado; }

var formatos = {};
function formato(chave, opcoes) { return formatos[chave] || (formatos[chave] = new Intl.DateTimeFormat("pt-BR", opcoes)); }
function horaDoCorte(epoch, fuso) { return formato("hora|" + fuso, { timeZone: fuso, hour: "2-digit", minute: "2-digit" }).format(new Date(epoch * 1000)); }
function diaDoCorte(epoch, fuso) { return formato("dia|" + fuso, { timeZone: fuso, weekday: "short" }).format(new Date(epoch * 1000)).replace(".", ""); }
/* Os cortes contam desde o início do período, não são dias do calendário. O rótulo diz em que dia (Semana, "ter") ou a que
   hora (5 horas, "14:25") o corte começa. `b` é uma barra do painel (tipo, janela_min, renova_epoch); vazio sem período
   comprovado. `fuso` fixa o fuso (só os testes). */
function cortes(b, fuso) {
  var cinco = b.tipo === "5h", n = cinco ? 5 : 7, duracaoS = b.janela_min * 60;
  if (!numero(b.renova_epoch) || !(duracaoS > 0)) return [];
  var inicio = b.renova_epoch - duracaoS, passo = duracaoS / n, lista = [];
  for (var i = 0; i < n; i++) {
    var e = inicio + i * passo;
    lista.push({ rotulo: cinco ? horaDoCorte(e, fuso) : diaDoCorte(e, fuso), inicio: e });
  }
  return lista;
}
function corteAtual(tempo, n) { return numero(tempo) ? Math.min(n - 1, Math.floor(tempo / 100 * n)) : -1; }

/* ---------- privacidade ---------- */
/* O comprimento do miolo não vem do e-mail real, para a largura do bloco não entregar o tamanho do nome. */
var MIOLO_OCULTO = 6;
function partesDoEmail(email) {
  var texto = String(email || "");
  var arroba = texto.lastIndexOf("@");
  var local = arroba > 0 ? texto.slice(0, arroba) : texto;
  var visiveis = local.length >= 6 ? 2 : local.length >= 3 ? 1 : 0;
  return { antes: local.slice(0, visiveis), ocultos: MIOLO_OCULTO, depois: arroba > 0 ? texto.slice(arroba) : "" };
}
var PADRAO_DE_EMAIL = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+/;
/* Troca cada e-mail de um texto corrido por começo + pontos + domínio. Sem e-mail, o texto sai igual. */
function mascararEmails(texto) {
  return String(texto == null ? "" : texto).replace(new RegExp(PADRAO_DE_EMAIL.source, "g"), function (email) {
    var p = partesDoEmail(email);
    return p.antes + new Array(p.ocultos + 1).join("•") + p.depois;
  });
}
/* Parte um texto no primeiro e-mail: { antes, email, depois }. Sem e-mail, email é "". */
function separarEmail(texto) {
  var s = String(texto == null ? "" : texto), m = PADRAO_DE_EMAIL.exec(s);
  if (!m) return { antes: s, email: "", depois: "" };
  return { antes: s.slice(0, m.index), email: m[0], depois: s.slice(m.index + m[0].length) };
}

/* Os pixels do miolo oculto: 0 vazio e 1 a 3 do mais forte ao mais fraco, sorteados célula a célula. As duas colunas das
   pontas nunca ficam vazias, para a tarja encostar nas letras dos dois lados. Nada aqui depende do e-mail. */
function gradeDePixels(colunas, linhas, sorteio) {
  var grade = [];
  for (var i = 0; i < colunas * linhas; i++) {
    var r = sorteio(), ponta = i % colunas === 0 || i % colunas === colunas - 1;
    grade.push(r < 0.15 && !ponta ? 0 : r < 0.55 ? 1 : r < 0.85 ? 2 : 3);
  }
  return grade;
}

/* A tarja varia com a inclinação do card: uma tira de QUADROS quadros, um por ângulo de -1 a 1. Cada pixel segue uma onda
   própria (fase e velocidade sorteadas) em torno do tom da grade, e o quadro do meio, ângulo 0, é exatamente a grade em
   repouso. As pontas nunca ficam abaixo do tom mais fraco. Os valores são a força do pixel, de 0 a 1. */
var QUADROS = 25, FORCA_DO_TOM = [0, 1, 0.6, 0.32], AMPLITUDE = 0.5;
function tiraDePixels(colunas, linhas, quadros, sorteio) {
  var grade = gradeDePixels(colunas, linhas, sorteio);
  var celulas = grade.map(function (tom, i) {
    var ponta = i % colunas === 0 || i % colunas === colunas - 1;
    return { base: FORCA_DO_TOM[tom], piso: ponta ? FORCA_DO_TOM[3] : 0, fase: sorteio() * 2 * Math.PI, ciclos: 0.5 + sorteio() * 0.9 };
  });
  var meio = (quadros - 1) / 2, tira = [];
  for (var k = 0; k < quadros; k++) {
    var angulo = (k - meio) / meio;
    tira.push(celulas.map(function (c) {
      var v = c.base + AMPLITUDE * (Math.sin(2 * Math.PI * c.ciclos * angulo + c.fase) - Math.sin(c.fase));
      return Math.min(1, Math.max(c.piso, v));
    }));
  }
  return tira;
}

/* A inclinação do card (rotateX e rotateY, em graus, com módulo máximo `maximo`) vira um número de -1 a 1: positivo com o
   ponteiro à direita e embaixo, 0 em repouso. Os dois eixos contam, o horizontal um pouco mais. */
var PESO_Y = Math.cos(35 * Math.PI / 180), PESO_X = Math.sin(35 * Math.PI / 180);
function intensidadeDoAngulo(xRot, yRot, maximo) {
  if (!(maximo > 0)) return 0;
  var v = (-yRot * PESO_Y + xRot * PESO_X) / (maximo * (PESO_Y + PESO_X));
  return Math.min(1, Math.max(-1, v));
}

var api = {
  decorrido: decorrido, formatarDecorrido: formatarDecorrido, timerDaPilula: timerDaPilula, atrasoDoRealce: atrasoDoRealce, fasePulso: fasePulso,
  tempoAcima: tempoAcima, cortes: cortes, corteAtual: corteAtual,
  partesDoEmail: partesDoEmail, mascararEmails: mascararEmails, separarEmail: separarEmail,
  gradeDePixels: gradeDePixels, tiraDePixels: tiraDePixels, intensidadeDoAngulo: intensidadeDoAngulo, QUADROS: QUADROS
};
if (typeof module !== "undefined" && module.exports) module.exports = api;
else raiz.CartaoApoio = api;
})(typeof window !== "undefined" ? window : this);
