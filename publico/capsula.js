/* Suporte da cápsula de uso e tempo, sem DOM e sem relógio de parede: só aritmética sobre o "agora" em segundos
   que quem chama passa. O contador da pílula é o tempo decorrido do período (agora - início), nunca a hora do dia.
   decorrido          segundos desde o início do período (início = renova_epoch - janela_min * 60), entre 0 e a duração
   formatarDecorrido  "1:58:12" nas 5 horas; "2 d 06:12:40" na Semana
   timerDaPilula      o texto do contador: vazio sem pílula visível ou sem tempo comprovado
   atrasoDoRealce     dwell de entrada e tolerância de saída do mouse, em milissegundos
   fasePulso          segundos do minuto: o pulso da agulha cai no começo de cada minuto
   tempoAcima         true quando o % decorrido passa do % usado (faixa de tempo em cima); empate, ausência de um dos dois e NaN: false */
(function (raiz) {
"use strict";
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
function tempoAcima(tempo, usado) { return Number.isFinite(tempo) && Number.isFinite(usado) && tempo > usado; }
var api = { decorrido: decorrido, formatarDecorrido: formatarDecorrido, timerDaPilula: timerDaPilula, atrasoDoRealce: atrasoDoRealce, fasePulso: fasePulso, tempoAcima: tempoAcima };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else raiz.Capsula = api;
})(typeof window !== "undefined" ? window : this);
