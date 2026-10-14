/* O prazo de uma janela de cota (5 horas ou semana), sem DOM: em que estado ela está, quanto do período já
   passou e as frases do card ("O período de 5 horas termina em…", "Deve durar até perto de…"). Quem chama
   passa a barra do /api/state e o "agora" em segundos (e, para os rótulos dos cortes da faixa de tempo, só a barra); o relógio e o fuso são os da máquina (o fuso só é
   passado nos testes). Carregado como script comum no navegador (window.Prazo) e por require() nos testes. */
(function (raiz) {
"use strict";

var CINCO_MIN = 300;                 // o horário de "Deve durar até perto de" é arredondado a 5 minutos
var MINIMO_PARA_ESTIMAR = 10;        // com menos de 10% do período decorrido, é cedo para estimar

function numero(v) { return typeof v === "number" && isFinite(v); }

/* "menos de 1 min", "40 min", "3 h 30 min", "4 d 21 h". */
function duracao(minutos) {
  if (minutos > 0 && minutos < 1) return "menos de 1 min";
  var n = Math.max(0, Math.round(minutos));
  if (n >= 1440) { var h = Math.floor(n % 1440 / 60); return Math.floor(n / 1440) + " d" + (h ? " " + h + " h" : ""); }
  if (n >= 60) return Math.floor(n / 60) + " h" + (n % 60 ? " " + n % 60 + " min" : "");
  return n + " min";
}

var formatos = {};
function formato(chave, opcoes) { return formatos[chave] || (formatos[chave] = new Intl.DateTimeFormat("pt-BR", opcoes)); }
function dia(epoch, fuso) { return formato("dia|" + fuso, { timeZone: fuso, year: "numeric", month: "numeric", day: "numeric" }).format(new Date(epoch * 1000)); }
/* "15:25", ou "ter, 23:15" com o dia da semana. */
function horario(epoch, comDia, fuso) {
  var f = comDia ? formato("dia-hora|" + fuso, { timeZone: fuso, weekday: "short", hour: "2-digit", minute: "2-digit" })
                 : formato("hora|" + fuso, { timeZone: fuso, hour: "2-digit", minute: "2-digit" });
  return f.format(new Date(epoch * 1000)).replace(".", "");
}

function diaDaSemana(epoch, fuso) { return formato("semana|" + fuso, { timeZone: fuso, weekday: "short" }).format(new Date(epoch * 1000)).replace(".", ""); }

/* O que o card diz de uma janela. `b` é uma barra do /api/state; `o.velha` marca a leitura velha e `o.fuso`
   fixa o fuso (só os testes). Devolve:
     estado   "sem-dado" | "anterior" | "sem-periodo" (uso zero, prazo provisório) | "em-curso"
     usado    % usado ou null;   sufixo " usado" ou " usado antes"
     tempo    % do período já decorrido (só "em-curso"), senão null
     termina  a frase do término ("" quando não há);   prazo  a frase de até quando dura */
function descrever(b, agoraS, o) {
  o = o || {};
  var cinco = b.tipo === "5h", usado = numero(b.usado_pct) ? b.usado_pct : null;
  var r = { estado: "em-curso", usado: usado, sufixo: " usado", tempo: null, termina: "", prazo: "" };
  var duracaoS = b.janela_min * 60;
  if (usado === null) {
    r.estado = "sem-dado";
    r[cinco ? "termina" : "prazo"] = "Sem dados por enquanto";
    return r;
  }
  if (o.velha || !numero(b.renova_epoch) || !(duracaoS > 0) || b.renova_epoch <= agoraS) {
    r.estado = "anterior"; r.sufixo = " usado antes";
    r.prazo = "Ainda não sabemos até quando dura";
    if (cinco) r.termina = "Sem leitura atual deste período";
    return r;
  }
  if (usado === 0 && b.provisorio) { r.estado = "sem-periodo"; r.prazo = "Ainda sem uso"; return r; }

  var inicio = b.renova_epoch - duracaoS;
  var t = Math.min(100, Math.max(0, 100 * (agoraS - inicio) / duracaoS));
  r.tempo = t;
  var restante = duracao((b.renova_epoch - agoraS) / 60);
  r.termina = cinco ? "O período de 5 horas termina em " + restante : "Termina em " + restante;
  if (usado === 0) r.prazo = "Sem uso para estimar a duração";
  else if (t < MINIMO_PARA_ESTIMAR) r.prazo = "É cedo para dizer até quando dura";
  else {
    var fim = t >= usado ? b.renova_epoch : inicio + duracaoS * (t / usado);
    fim = Math.round(fim / CINCO_MIN) * CINCO_MIN;
    var outroDia = dia(fim, o.fuso) !== dia(agoraS, o.fuso);
    r.prazo = "Deve durar até perto de " + horario(fim, !cinco || outroDia, o.fuso);
  }
  return r;
}

/* Os cortes da faixa de tempo: 5 de 1 h nas 5 horas, 7 de 24 h na Semana, contados desde o início do período (não são
   dias do calendário). O rótulo diz em que dia (Semana, "ter") ou a que hora (5 horas, "14:25") o corte começa. Vazio sem
   período comprovado. `o.fuso` fixa o fuso (só os testes). */
function cortes(b, o) {
  o = o || {};
  var cinco = b.tipo === "5h", n = cinco ? 5 : 7, duracaoS = b.janela_min * 60;
  if (!numero(b.renova_epoch) || !(duracaoS > 0)) return [];
  var inicio = b.renova_epoch - duracaoS, passo = duracaoS / n, lista = [];
  for (var i = 0; i < n; i++) {
    var e = inicio + i * passo;
    lista.push({ rotulo: cinco ? horario(e, false, o.fuso) : diaDaSemana(e, o.fuso), inicio: e });
  }
  return lista;
}
/* Em qual corte a agulha está (0 a n - 1), ou -1 sem tempo. */
function corteAtual(tempo, n) { return numero(tempo) ? Math.min(n - 1, Math.floor(tempo / 100 * n)) : -1; }

/* Há quanto tempo a leitura foi feita: minutos, depois horas, depois dias. */
function idade(segundos) {
  var m = Math.floor(Math.max(0, segundos) / 60);
  if (m < 60) return "há " + m + " min";
  var h = Math.floor(m / 60);
  if (h < 48) return "há " + h + " h";
  return "há " + Math.floor(h / 24) + " dias";
}
/* A linha de baixo do card quando a leitura está em dia: "agora" no primeiro minuto, depois a idade. */
function rotuloDaLeitura(segundos) { return segundos < 60 ? "Leitura agora" : "Leitura " + idade(segundos); }

var api = { descrever: descrever, cortes: cortes, corteAtual: corteAtual, duracao: duracao, idade: idade, rotuloDaLeitura: rotuloDaLeitura };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else raiz.Prazo = api;
})(typeof window !== "undefined" ? window : this);
