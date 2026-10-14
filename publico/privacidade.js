/* Regras de privacidade da página, sem DOM: quanto do e-mail fica visível, como a pasta é abreviada, a grade de pixels da tarja e a
   tira de quadros que a faz variar com a inclinação do card.
   Carregado como script comum pelo navegador (window.Privacidade) e por require() nos testes. */
(function (raiz) {
"use strict";

/* O que aparece de um e-mail: um começo curto, o miolo oculto e o domínio inteiro. O comprimento do
   miolo não vem do e-mail real, para a largura do bloco não entregar o tamanho do nome. */
var MIOLO_OCULTO = 6;
function partesDoEmail(email) {
  var texto = String(email || "");
  var arroba = texto.lastIndexOf("@");
  var local = arroba > 0 ? texto.slice(0, arroba) : texto;
  var visiveis = local.length >= 6 ? 2 : local.length >= 3 ? 1 : 0;
  return { antes: local.slice(0, visiveis), ocultos: MIOLO_OCULTO, depois: arroba > 0 ? texto.slice(arroba) : "" };
}

/* A pasta da conta cabe no card e não mostra o usuário: "~" no lugar da pasta pessoal e só os dois
   últimos trechos quando há mais que isso. */
function abreviarCaminho(pasta) {
  var texto = String(pasta || "").replace(/^\/(?:Users|home)\/[^/]+/, "~");
  var trechos = texto.split("/");
  if (trechos.length - 1 <= 2) return texto;
  return trechos[0] + "/…/" + trechos.slice(-2).join("/");
}

/* Os pixels do miolo oculto: 0 vazio e 1 a 3 do mais forte ao mais fraco, sorteados célula a célula.
   As duas colunas das pontas nunca ficam vazias, para a tarja encostar nas letras dos dois lados.
   Nada aqui depende do e-mail, então a grade não guarda informação dele. */
function gradeDePixels(colunas, linhas, sorteio) {
  var grade = [];
  for (var i = 0; i < colunas * linhas; i++) {
    var r = sorteio(), ponta = i % colunas === 0 || i % colunas === colunas - 1;
    grade.push(r < 0.15 && !ponta ? 0 : r < 0.55 ? 1 : r < 0.85 ? 2 : 3);
  }
  return grade;
}

/* A tarja varia com a inclinação do card: uma tira de QUADROS quadros, um por ângulo de -1 a 1. Cada pixel segue uma onda própria
   (fase e velocidade sorteadas) em torno do tom da grade, e o quadro do meio, ângulo 0, é exatamente a grade em repouso. As
   pontas nunca ficam abaixo do tom mais fraco. Os valores são a força do pixel, de 0 a 1; nada vem do e-mail. */
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

/* A inclinação do card (rotateX e rotateY, em graus, com módulo máximo `maximo`) vira um número de -1 a 1: positivo com o ponteiro
   à direita e embaixo, 0 em repouso. Os dois eixos contam, o horizontal um pouco mais. */
var PESO_Y = Math.cos(35 * Math.PI / 180), PESO_X = Math.sin(35 * Math.PI / 180);
function intensidadeDoAngulo(xRot, yRot, maximo) {
  if (!(maximo > 0)) return 0;
  var v = (-yRot * PESO_Y + xRot * PESO_X) / (maximo * (PESO_Y + PESO_X));
  return Math.min(1, Math.max(-1, v));
}

var api = { partesDoEmail: partesDoEmail, abreviarCaminho: abreviarCaminho, gradeDePixels: gradeDePixels, tiraDePixels: tiraDePixels, intensidadeDoAngulo: intensidadeDoAngulo, QUADROS: QUADROS };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else raiz.Privacidade = api;
})(typeof window !== "undefined" ? window : this);
