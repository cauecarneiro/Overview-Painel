/* Os cards de cota: a tela do cotas-dashboard (fbtostadev, MIT), adaptada. Barra grossa da janela de
   5 h e fina da semanal (em sete gomos), cursor "agora" pelo relógio da máquina, só os dígitos que
   mudam animam, cantos squircle por SVG, tilt sob o ponteiro e anel pulsando enquanto a CLI consulta.
   Clique no card troca a frente pelo verso (tempo até reabrir, reset, usada e livre, a outra janela
   e a origem); clique no verso, "Voltar" ou Esc voltam. O estado vem de /api/state a cada 5 s. */
(function () {
"use strict";
if (!window.ResizeObserver || !window.WeakMap || !window.Intl) return;

/* ---------- utilidades ---------- */
var NUMERO = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
var FORMATO_DATA = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
var INTERVALO_PADRAO = { claude: 300, codex: 300, agy: 1200 };

function numero(v) { return typeof v === "number" && isFinite(v); }
function pct(v) { return numero(v) ? NUMERO.format(v) + "%" : "sem dados"; }
function texto(no, t) { if (no.textContent !== t) no.textContent = t; }
function oculto(no, sim) { if (no.hidden !== sim) no.hidden = sim; }
function atributo(no, nome, valor) { if (no.getAttribute(nome) !== valor) no.setAttribute(nome, valor); }
function variavel(no, nome, valor) { if (no.style.getPropertyValue(nome) !== valor) no.style.setProperty(nome, valor); }
function reduzido() { return matchMedia("(prefers-reduced-motion: reduce)").matches; }

/* O cursor "agora": (agora − início da janela) / duração. Alerta: usado > cursor + 5 pontos, ou > 90%. */
function tempoDaJanela(b, agoraS) {
  var reset = b ? b.renova_epoch : null, dur = b && numero(b.janela_min) ? b.janela_min * 60 : 0;
  var temTempo = numero(reset) && dur > 0 && numero(agoraS);
  var cursor = temTempo ? Math.min(100, Math.max(0, 100 * (agoraS - reset + dur) / dur)) : null;
  var usado = b ? b.usado_pct : null, temUso = numero(usado) && usado >= 0;
  var acima = temUso && cursor !== null && usado > cursor + 5;
  return { cursor: cursor, acima: acima, alerta: temUso && (acima || usado > 90), critico: temUso && usado >= 90, vencida: temTempo && agoraS >= reset };
}
function duracao(segundos, comSegundos) {
  if (!numero(segundos)) return "sem dados";
  if (segundos <= 0) return "a confirmar";
  if (comSegundos) {
    var total = Math.max(1, Math.floor(segundos)), horas = Math.floor(total / 3600);
    if (segundos >= 86400) return Math.floor(horas / 24) + "d" + (horas % 24 ? " " + horas % 24 + "h" : "");
    var minutos = Math.floor(total / 60) % 60;
    return (horas ? horas + "h " : "") + (horas || minutos ? minutos + "m " : "") + (total % 60) + "s";
  }
  var m = Math.ceil(segundos / 60), h = Math.floor(m / 60);
  if (m < 60) return m + "m";
  if (m < 1440) return h + "h " + (m % 60) + "m";
  var d = Math.floor(h / 24);
  return d + "d" + (h % 24 ? " " + h % 24 + "h" : "");
}
function partes(epoch) { var p = {}; FORMATO_DATA.formatToParts(new Date(epoch * 1000)).forEach(function (x) { p[x.type] = x.value; }); return p; }
function dataDoReset(epoch) {
  if (!numero(epoch)) return "sem dados";
  var p = partes(epoch);
  return (p.weekday || "").replace(".", "") + " " + p.day + "/" + p.month + " " + p.hour + ":" + p.minute;
}
function dataCurta(epoch) { var p = partes(epoch); return (p.weekday || "").replace(".", "") + " " + p.day + "/" + p.month; }
/* O dia de um gomo da semanal (0 a 6): sete fatias de 24 h desde a última renovação. */
var DIA_RELATIVO = { "0": "hoje", "-1": "ontem", "-2": "anteontem", "1": "amanhã" };
function diaDoGomo(b, i, agoraS) {
  if (!b || !numero(b.renova_epoch) || !numero(b.janela_min)) return "";
  var dur = b.janela_min * 60, inicio = b.renova_epoch - dur;
  if (agoraS < inicio || agoraS >= b.renova_epoch) return "";
  var hoje = Math.min(6, Math.floor(7 * (agoraS - inicio) / dur));
  var ehHoje = i === hoje ? "hoje · " : "";
  if (i === 0) return ehHoje + "renovou " + dataCurta(inicio);
  if (i === 6) return ehHoje + "renova " + dataCurta(b.renova_epoch);
  return DIA_RELATIVO[String(i - hoje)] || dataCurta(agoraS + (i - hoje) * 86400);
}
function reabre(b, agoraS) {
  if (!b || !numero(b.renova_epoch)) return "reabertura sem dados";
  var d = duracao(b.renova_epoch - agoraS);
  return d === "a confirmar" ? "reabertura a confirmar" : "reabre em " + d;
}
function idade(segundos) {
  var m = Math.floor(Math.max(0, segundos) / 60);
  if (m < 60) return "há " + m + " min";
  var h = Math.floor(m / 60);
  if (h < 48) return "há " + h + " h";
  return "há " + Math.floor(h / 24) + " dias";
}

/* ---------- só os dígitos que mudaram animam ---------- */
function casas(t) {
  var m = /^(\d+)(?:,(\d+))?(%)?$/.exec(t || "");
  if (!m) return Array.prototype.map.call(t || "", function (v, i) { return { chave: "t" + i, valor: v }; });
  var r = m[1].split("").map(function (v, i) { return { chave: "i" + (m[1].length - i - 1), valor: v }; });
  if (m[2]) { r.push({ chave: "virgula", valor: "," }); m[2].split("").forEach(function (v, i) { r.push({ chave: "f" + i, valor: v }); }); }
  if (m[3]) r.push({ chave: "pct", valor: "%" });
  return r;
}
function mudancasDeDigitos(anterior, valor) {
  var velho = {}; casas(anterior).forEach(function (d) { velho[d.chave] = d.valor; });
  var novo = casas(valor), chaves = {};
  var r = novo.map(function (d) {
    chaves[d.chave] = 1;
    return { chave: d.chave, valor: d.valor, anterior: velho[d.chave] != null ? velho[d.chave] : null,
             mudou: anterior !== null && /^[if]\d+$/.test(d.chave) && velho[d.chave] !== d.valor };
  });
  Object.keys(velho).forEach(function (k) { if (!chaves[k]) r.push({ chave: k, anterior: velho[k], valor: null, mudou: /^[if]\d+$/.test(k) }); });
  return r;
}
var digitos = new WeakMap();
function porDigitos(no, valor) {
  var estado = digitos.get(no);
  if (estado && estado.valor === valor) return;
  if (!estado) { estado = { valor: null, casas: {} }; digitos.set(no, estado); no.classList.add("lift-number"); }
  var mudancas = mudancasDeDigitos(estado.valor, valor), menos = reduzido();
  mudancas.filter(function (d) { return d.valor === null; }).forEach(function (m) {
    var casa = estado.casas[m.chave];
    if (!casa) return;
    if (!m.mudou) { delete estado.casas[m.chave]; casa.remove(); return; }
    variavel(casa, "left", casa.offsetLeft + "px");
    casa.classList.add("lift-removed");
    Array.prototype.forEach.call(casa.children, function (camada) { variavel(camada, "--lift-y", menos ? "0%" : "-40%"); variavel(camada, "--lift-opacity", "0"); });
    casa._limpeza = setTimeout(function () { casa.remove(); delete estado.casas[m.chave]; }, menos ? 140 : 240);
  });
  var ref = null;
  Array.prototype.some.call(no.children, function (c) { if (!c.classList.contains("lift-removed")) { ref = c; return true; } return false; });
  mudancas.filter(function (d) { return d.valor !== null; }).forEach(function (m) {
    var casa = estado.casas[m.chave];
    if (!casa) {
      casa = document.createElement("span");
      casa.className = /^[if]\d+$/.test(m.chave) ? "lift-place lift-digit" : "lift-place";
      casa.setAttribute("aria-hidden", "true");
      estado.casas[m.chave] = casa;
    }
    clearTimeout(casa._limpeza);
    casa.classList.remove("lift-removed");
    variavel(casa, "left", "");
    if (casa !== ref) no.insertBefore(casa, ref);
    ref = casa.nextElementSibling;
    while (ref && ref.classList.contains("lift-removed")) ref = ref.nextElementSibling;
    if (m.mudou || !casa.children.length) {
      var entrando = null;
      Array.prototype.forEach.call(casa.children, function (camada) { if (camada.textContent === m.valor) entrando = camada; });
      Array.prototype.slice.call(casa.children).forEach(function (camada) {
        clearTimeout(camada._limpeza);
        if (camada === entrando) return;
        variavel(camada, "--lift-y", menos ? "0%" : "-40%"); variavel(camada, "--lift-opacity", "0");
        camada._limpeza = setTimeout(function () { camada.remove(); }, menos ? 140 : 240);
      });
      if (!entrando) {
        entrando = document.createElement("span");
        entrando.className = "lift-layer";
        texto(entrando, m.valor);
        variavel(entrando, "--lift-y", m.mudou && !menos ? "40%" : "0%");
        variavel(entrando, "--lift-opacity", m.mudou ? "0" : "1");
        casa.appendChild(entrando);
        if (m.mudou) void entrando.offsetWidth;
      }
      clearTimeout(entrando._limpeza);
      variavel(entrando, "--lift-y", "0%"); variavel(entrando, "--lift-opacity", "1");
    }
  });
  estado.valor = valor;
  atributo(no, "aria-label", valor);
}

/* ---------- cantos squircle: duas cúbicas por canto, desenhadas por SVG ---------- */
var formas = new WeakMap();
var observadorDeForma = new ResizeObserver(function (entradas) {
  entradas.forEach(function (e) {
    var forma = formas.get(e.target), largura = e.target.offsetWidth, altura = e.target.offsetHeight;
    if (!forma || !largura || !altura) return;
    var raio = Math.min(parseFloat(getComputedStyle(e.target).getPropertyValue("--radius")) || 20, largura / 2, altura / 2);
    var s = 1 - Math.pow(2, -0.25);
    var controles = [[1 - 4 * s, 0], [1 - 2 * s, 0], [1 - s, s], [1, 2 * s], [1, 4 * s], [1, 1]];
    var cantos = [
      { inicio: [largura - raio, 0], ponto: function (x, y) { return [largura - raio + x * raio, y * raio]; } },
      { inicio: [largura, altura - raio], ponto: function (x, y) { return [largura - y * raio, altura - raio + x * raio]; } },
      { inicio: [raio, altura], ponto: function (x, y) { return [raio - x * raio, altura - y * raio]; } },
      { inicio: [0, raio], ponto: function (x, y) { return [y * raio, raio - x * raio]; } }
    ];
    var caminho = "M " + raio + " 0";
    cantos.forEach(function (c) {
      var p = controles.map(function (q) { return c.ponto(q[0], q[1]).join(" "); });
      caminho += " L " + c.inicio.join(" ") + " C " + p.slice(0, 3).join(" ") + " C " + p.slice(3).join(" ");
    });
    [forma, e.target.querySelector(".query-ring svg")].forEach(function (svg) {
      if (!svg) return;
      atributo(svg, "viewBox", "0 0 " + largura + " " + altura);
      atributo(svg.querySelector("path"), "d", caminho + " Z");
    });
  });
});

/* ---------- tilt do card: inclina sob o ponteiro ---------- */
var TILT = { angulo: 6, escala: 1.02, perspectiva: 1200, duracao: 200 };
var tilt = (function () {
  var reduzir = matchMedia("(prefers-reduced-motion: reduce)"), mouse = matchMedia("(hover: hover) and (pointer: fine)");
  var porSlot = new WeakMap();
  function pode() { return !reduzir.matches && mouse.matches; }
  function deslizar(t) { t.alvo.style.transition = "transform " + TILT.duracao + "ms ease-out"; }
  function pintar(t) {
    t.quadro = 0;
    if (!t.dentro || !pode()) return;
    var r = t.slot.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var px = Math.min(1, Math.max(0, (t.x - r.left) / r.width)), py = Math.min(1, Math.max(0, (t.y - r.top) / r.height));
    var xRot = (py - 0.5) * TILT.angulo * 2, yRot = -(px - 0.5) * TILT.angulo * 2;
    t.alvo.style.transform = "perspective(" + TILT.perspectiva + "px) rotateX(" + xRot + "deg) rotateY(" + yRot + "deg) scale3d(" + TILT.escala + ", " + TILT.escala + ", " + TILT.escala + ")";
    t.brilho.style.setProperty("--spot-x", px * r.width + "px");
    t.brilho.style.setProperty("--spot-y", py * r.height + "px");
    t.brilho.style.opacity = "1";
  }
  function agendar(t) { if (!t.quadro) t.quadro = requestAnimationFrame(function () { pintar(t); }); }
  function descansar(t) {
    t.dentro = false;
    cancelAnimationFrame(t.quadro); t.quadro = 0;
    deslizar(t);
    t.alvo.style.transform = "";
    t.brilho.style.opacity = "0";
  }
  function ligar(slot, alvo, brilho) {
    var t = { slot: slot, alvo: alvo, brilho: brilho, x: 0, y: 0, quadro: 0, dentro: false };
    porSlot.set(slot, t);
    function seguir(ev) {
      if (ev.pointerType === "touch" || !pode()) return;
      if (!t.dentro) { t.dentro = true; deslizar(t); }
      t.x = ev.clientX; t.y = ev.clientY;
      agendar(t);
    }
    function aoSair() { descansar(t); }
    function fimDaTransicao(ev) { if (ev.target === alvo && ev.propertyName === "transform") alvo.style.transition = ""; }
    slot.addEventListener("pointerenter", seguir);
    slot.addEventListener("pointermove", seguir);
    slot.addEventListener("pointerleave", aoSair);
    slot.addEventListener("pointercancel", aoSair);
    alvo.addEventListener("transitionend", fimDaTransicao);
    return function () {
      slot.removeEventListener("pointerenter", seguir); slot.removeEventListener("pointermove", seguir);
      slot.removeEventListener("pointerleave", aoSair); slot.removeEventListener("pointercancel", aoSair);
      alvo.removeEventListener("transitionend", fimDaTransicao);
      descansar(t);
    };
  }
  function seMudou() { if (!pode()) Object.keys(cards).forEach(function (id) { var t = porSlot.get(cards[id].slot); if (t) descansar(t); }); }
  reduzir.addEventListener("change", seMudou); mouse.addEventListener("change", seMudou);
  return { ligar: ligar };
})();

/* ---------- barras, verso e cards ---------- */
var cards = {};
var focoPorTeclado = true;
var ultimoToque = { x: 0, y: 0 };
document.addEventListener("pointerdown", function (ev) { ultimoToque = { x: ev.clientX, y: ev.clientY }; }, true);
function arrastou(ev) { return ev.detail !== 0 && Math.hypot(ev.clientX - ultimoToque.x, ev.clientY - ultimoToque.y) > 5; }

function janelaDoVerso(principal) {
  var no = document.createElement("section");
  no.className = principal ? "tip-main" : "tip-window";
  var medidor = '<div class="tip-meter" aria-hidden="true"><span class="tip-fill"></span><span class="tip-cursor"></span></div>';
  no.innerHTML = principal
    ? '<div class="tip-window-heading"><h3></h3><span class="tip-reset"></span></div><div class="tip-time"><span>Tempo até reabrir</span><strong></strong></div>' + medidor +
      '<dl class="tip-quota"><div><dt>Cota usada</dt><dd class="tip-used"></dd></div><div><dt>Cota livre</dt><dd class="tip-free"></dd></div></dl><dl class="tip-pace"><div><dt>Ritmo</dt><dd></dd></div></dl>'
    : '<div class="tip-window-heading"><h3></h3><span class="tip-reset-row"><strong class="tip-duration"></strong><span class="tip-reset"></span></span></div>' +
      '<div class="tip-compact-usage">' + medidor + '<span class="tip-summary">usada <span class="tip-used"></span> · livre <span class="tip-free"></span></span></div>';
  var reset = no.querySelector(".tip-reset");
  if (principal) no.querySelector(".tip-time").appendChild(reset);
  return { no: no, rotulo: no.querySelector("h3"), reset: reset, tempo: no.querySelector(principal ? ".tip-time strong" : ".tip-duration"),
           usada: no.querySelector(".tip-used"), livre: no.querySelector(".tip-free"), cheio: no.querySelector(".tip-fill"),
           cursor: no.querySelector(".tip-cursor"), ritmo: no.querySelector(".tip-pace"), ritmoValor: no.querySelector(".tip-pace dd") };
}
function encherJanela(bloco, b, agoraS, comSegundos) {
  var t = tempoDaJanela(b, agoraS), usado = b ? b.usado_pct : null;
  bloco.cheio.parentNode.classList.toggle("is-weekly", !!b && b.tipo === "semana");
  texto(bloco.rotulo, b ? b.rotulo : "");
  texto(bloco.reset, dataDoReset(b && b.renova_epoch));
  texto(bloco.tempo, duracao(b && numero(b.renova_epoch) ? b.renova_epoch - agoraS : null, comSegundos));
  texto(bloco.usada, pct(usado));
  texto(bloco.livre, numero(usado) ? pct(Math.max(0, 100 - usado)) : "sem dados");
  variavel(bloco.cheio, "width", Math.min(100, Math.max(0, numero(usado) ? usado : 0)) + "%");
  variavel(bloco.cursor, "left", (t.cursor === null ? 0 : Math.round(t.cursor * 100) / 100) + "%");
  oculto(bloco.cursor, t.cursor === null);
  bloco.no.classList.toggle("is-alert", t.alerta);
  bloco.no.classList.toggle("is-critical", t.critico);
  var ritmo = t.critico ? "Resta menos de 10%" + (t.acima ? ", acima do ritmo da janela" : "") : (t.acima ? "Acima do ritmo da janela" : "");
  if (bloco.ritmo) { texto(bloco.ritmoValor, ritmo); oculto(bloco.ritmo, !ritmo); }
  return ritmo;
}
function encherVerso(card, agoraS) {
  var barra = card.barraVirada, v = card.verso;
  if (!barra) return;
  var b = barra.dados || {}, conta = card.conta;
  texto(v.eyebrow, (conta.titulo || "") + (conta.email ? " · " + conta.email : ""));
  texto(v.titulo, b.rotulo || "");
  encherJanela(v.principal, b, agoraS, true);
  var outra = null;
  card.barras.forEach(function (x) { if (x !== barra && x.dados && x.dados.grupo === b.grupo) outra = x.dados; });
  oculto(v.outra.no, !outra);
  var ritmoOutra = outra ? encherJanela(v.outra, outra, agoraS, false) : "";
  oculto(v.ritmoOutra, !ritmoOutra);
  if (ritmoOutra) { texto(v.ritmoOutra.querySelector("dt"), (outra ? outra.rotulo : "") + " · Ritmo"); texto(v.ritmoOutra.querySelector("dd"), ritmoOutra); }
  var erro = conta.erro ? (conta.erro_detalhe || "falhou") : "";
  texto(v.erro, erro); oculto(v.erroLinha, !erro);
  texto(v.pasta, conta.pasta || "");
  texto(v.observacao, numero(b.lido_em_epoch) ? idade(agoraS - b.lido_em_epoch) + " · consulta à CLI (" + (conta.ferramenta_nome || "") + "), sem token" : "sem observação");
}
var SAIDA_DO_VERSO = 220;
var GIROS = [-0.8, -0.55, -0.35, 0.35, 0.55, 0.8];
var ultimoGiro = null;
function pop(card) {
  if (reduzido()) return;
  var giro;
  do { giro = GIROS[Math.floor(Math.random() * GIROS.length)]; } while (giro === ultimoGiro && GIROS.length > 1);
  ultimoGiro = giro;
  card.cena.style.setProperty("--giro", giro + "deg");
  card.cena.classList.remove("pop");
  void card.cena.offsetWidth;
  card.cena.classList.add("pop");
}
function virar(card, barra) {
  if (card.barraVirada === barra) return;
  var jaVirado = !!card.barraVirada;
  card.barraVirada = barra;
  card.barras.forEach(function (x) { atributo(x.alvo, "aria-expanded", x === barra ? "true" : "false"); });
  encherVerso(card, Date.now() / 1000);
  if (jaVirado) return;
  clearTimeout(card.timerDoGiro);
  card.slot.classList.add("virado");
  card.cena.classList.add("mostra-verso");
  void card.cena.offsetWidth;
  card.cena.classList.add("virado");
  pop(card);
  atributo(card.verso.no, "aria-hidden", "false");
  if (focoPorTeclado) card.verso.voltar.focus({ preventScroll: true });
}
function desvirar(card, devolverFoco) {
  var barra = card.barraVirada;
  if (!barra) return;
  card.barraVirada = null;
  card.slot.classList.remove("virado");
  card.cena.classList.remove("virado");
  pop(card);
  atributo(barra.alvo, "aria-expanded", "false");
  var tinhaFoco = card.verso.no.contains(document.activeElement);
  clearTimeout(card.timerDoGiro);
  card.timerDoGiro = setTimeout(function () {
    if (card.barraVirada) return;
    card.cena.classList.remove("mostra-verso");
    atributo(card.verso.no, "aria-hidden", "true");
  }, reduzido() ? 0 : SAIDA_DO_VERSO);
  if (devolverFoco && tinhaFoco) barra.alvo.focus({ preventScroll: true });
}
function desvirarTodos() { Object.keys(cards).forEach(function (id) { desvirar(cards[id], true); }); }

var criadas = 0;
function criarBarra(card, chave, tipo) {
  var no = document.createElement("div");
  no.className = "quota bloco " + (tipo === "semana" ? "weekly" : "primary");
  no.innerHTML = '<div class="quota-heading"><span class="quota-label"></span><span class="used"></span><span class="reopens"></span></div>' +
    '<div class="track"><span class="fill"></span><span class="cursor" aria-hidden="true"></span></div>' +
    '<button class="quota-hit" type="button" aria-expanded="false"></button>';
  var barra = { card: card, chave: chave, tipo: tipo, no: no, dados: null, trilho: no.querySelector(".track"),
    cheio: no.querySelector(".fill"), cursor: no.querySelector(".cursor"), rotulo: no.querySelector(".quota-label"),
    usado: no.querySelector(".used"), reabre: no.querySelector(".reopens"), alvo: no.querySelector(".quota-hit") };
  barra.alvo.setAttribute("aria-controls", card.verso.no.id);
  if (tipo === "semana") ligarGomos(barra);
  return barra;
}
function ligarGomos(barra) {
  var dia = document.createElement("span");
  dia.className = "dia-do-gomo";
  dia.setAttribute("aria-hidden", "true");
  barra.no.querySelector(".quota-heading").insertBefore(dia, barra.usado);
  var realce = document.createElement("span");
  realce.className = "gomo-realce";
  realce.setAttribute("aria-hidden", "true");
  barra.trilho.insertBefore(realce, barra.trilho.firstChild);
  function limpar() { dia.classList.remove("visivel"); realce.classList.remove("visivel"); }
  barra.no.addEventListener("pointermove", function (ev) {
    if (ev.pointerType === "touch") return;
    var r = barra.trilho.getBoundingClientRect();
    if (!r.width || ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top - 10 || ev.clientY > r.bottom + 10) { limpar(); return; }
    var i = Math.min(6, Math.max(0, Math.floor(7 * (ev.clientX - r.left) / r.width)));
    var t = diaDoGomo(barra.dados, i, Date.now() / 1000);
    if (!t) { limpar(); return; }
    texto(dia, t);
    variavel(realce, "--gomo", String(i));
    dia.classList.add("visivel"); realce.classList.add("visivel");
  });
  barra.no.addEventListener("pointerleave", limpar);
}
function removerBarra(barra) {
  if (barra.card.barraVirada === barra) desvirar(barra.card, false);
  barra.no.remove();
}
function criarVerso() {
  var no = document.createElement("div");
  no.className = "card-verso";
  no.id = "conta-verso-" + (++criadas);
  no.setAttribute("role", "group");
  no.setAttribute("aria-hidden", "true");
  no.innerHTML = '<header class="verso-cabeca bloco" style="--i:0"><div class="identity"><p class="card-eyebrow"></p><h4 class="verso-titulo"></h4></div>' +
    '<button class="voltar" type="button" aria-label="Voltar para a frente do card">Voltar</button></header>';
  var principal = janelaDoVerso(true), outra = janelaDoVerso(false);
  principal.no.classList.add("bloco"); principal.no.style.setProperty("--i", "1");
  outra.no.classList.add("bloco"); outra.no.style.setProperty("--i", "2");
  var rodape = document.createElement("footer");
  rodape.className = "bloco"; rodape.style.setProperty("--i", "3");
  rodape.innerHTML = '<dl class="tip-pace tip-ritmo-outra" hidden><div><dt></dt><dd></dd></div></dl>' +
    '<dl class="tip-error" hidden><div><dt>Última consulta não concluída</dt><dd></dd></div></dl>' +
    '<div class="tip-observation"><span>Pasta</span><span class="tip-pasta"></span></div><div class="tip-observation"><span>Observação</span><span class="tip-obs"></span></div>';
  var corpo = document.createElement("div");
  corpo.className = "verso-corpo";
  corpo.appendChild(principal.no); corpo.appendChild(outra.no); corpo.appendChild(rodape);
  no.appendChild(corpo);
  return { no: no, eyebrow: no.querySelector(".card-eyebrow"), titulo: no.querySelector(".verso-titulo"), voltar: no.querySelector(".voltar"),
           principal: principal, outra: outra, ritmoOutra: rodape.querySelector(".tip-ritmo-outra"),
           erroLinha: rodape.querySelector(".tip-error"), erro: rodape.querySelector(".tip-error dd"), pasta: rodape.querySelector(".tip-pasta"), observacao: rodape.querySelector(".tip-obs") };
}
function criarCard(conta) {
  var no = document.createElement("article");
  no.className = "card";
  no.innerHTML = '<svg class="card-surface" aria-hidden="true" focusable="false"><path></path></svg>' +
    '<span class="query-ring" aria-hidden="true"><span><svg focusable="false"><path></path></svg></span></span><span class="card-spotlight" aria-hidden="true"></span>' +
    '<header class="card-header bloco" style="--i:0"><div class="identity"><p class="card-eyebrow"></p><h3 class="card-title"><span class="title-text"></span></h3>' +
    '<p class="account-label"></p><p class="pasta" hidden></p></div></header>' +
    '<p class="card-status bloco" hidden><span class="orbita" aria-hidden="true" hidden><i></i><i></i><i></i></span><span class="texto"></span></p>';
  formas.set(no, no.querySelector(".card-surface"));
  observadorDeForma.observe(no);
  var verso = criarVerso();
  var pilha = document.createElement("div");
  pilha.className = "card-pilha";
  pilha.appendChild(no); pilha.appendChild(verso.no);
  var cena = document.createElement("div");
  cena.className = "card-cena";
  cena.appendChild(pilha);
  var slot = document.createElement("div");
  slot.className = "card-slot";
  slot.appendChild(cena);
  var card = { no: no, slot: slot, cena: cena, pilha: pilha, verso: verso, conta: conta, barras: [], barraVirada: null, estado: no.querySelector(".card-status"),
               orbita: no.querySelector(".card-status .orbita"), estadoTexto: no.querySelector(".card-status .texto"),
               desligarTilt: tilt.ligar(slot, pilha, no.querySelector(".card-spotlight")), eyebrow: no.querySelector(".card-eyebrow"), titulo: no.querySelector(".title-text"),
               tituloNo: no.querySelector(".card-title"), rotuloConta: no.querySelector(".account-label"), pasta: no.querySelector(".pasta") };
  cena.addEventListener("animationend", function (ev) { if (ev.target === cena) cena.classList.remove("pop"); });
  no.addEventListener("click", function (ev) {
    if (card.barraVirada || arrastou(ev)) return;
    var alvo = ev.target.closest ? ev.target.closest(".quota") : null, barra = null;
    card.barras.forEach(function (b) { if (b.no === alvo) barra = b; });
    barra = barra || card.barras[0];
    if (barra) virar(card, barra);
  });
  verso.voltar.addEventListener("click", function (ev) { ev.stopPropagation(); desvirar(card, true); });
  verso.no.addEventListener("click", function (ev) { if (!arrastou(ev)) desvirar(card, true); });
  return card;
}
function removerCard(card) {
  clearTimeout(card.timerDoGiro);
  card.barras.forEach(removerBarra);
  observadorDeForma.unobserve(card.no);
  card.desligarTilt();
  card.slot.remove();
}
function sincronizarBarras(card, lista) {
  var chaves = lista.map(function (b) { return b.grupo + "|" + b.tipo; });
  var iguais = card.barras.length === chaves.length && card.barras.every(function (b, i) { return b.chave === chaves[i]; });
  if (!iguais) {
    card.barras.forEach(removerBarra);
    card.barras = lista.map(function (b) {
      var barra = criarBarra(card, b.grupo + "|" + b.tipo, b.tipo);
      card.no.insertBefore(barra.no, card.estado);
      return barra;
    });
  }
  card.barras.forEach(function (barra, i) { barra.dados = lista[i]; barra.no.style.setProperty("--i", String(i + 1)); });
  card.estado.style.setProperty("--i", String(card.barras.length + 1));
}

/* ---------- desenho ---------- */
var grade = null, ultimoJson = null;
function desenhar(contas, agoraS) {
  var secao = document.getElementById("contas");
  if (!secao) return;
  grade = grade || secao.querySelector(".contas-grade");
  var aviso = secao.querySelector(".aviso-contas");
  contas = contas || { lista: [] };
  var lista = Array.isArray(contas.lista) ? contas.lista : [];
  var json = JSON.stringify(contas);
  if (json !== ultimoJson) {
    ultimoJson = json;
    var presentes = {}, porFerramenta = {};
    lista.forEach(function (c) { porFerramenta[c.ferramenta] = (porFerramenta[c.ferramenta] || 0) + 1; });
    lista.forEach(function (c, i) {
      var id = c.id || c.titulo;
      presentes[id] = 1;
      var card = cards[id];
      if (!card) { card = cards[id] = criarCard(c); }
      card.conta = c;
      if (grade.children[i] !== card.slot) grade.insertBefore(card.slot, grade.children[i] || null);
      atributo(card.no, "data-ferramenta", c.ferramenta || "");
      atributo(card.verso.no, "data-ferramenta", c.ferramenta || "");
      atributo(card.no, "aria-busy", c.consultando ? "true" : "false");
      texto(card.eyebrow, c.ferramenta_nome || "");
      texto(card.titulo, c.titulo || c.ferramenta_nome || "conta");
      atributo(card.tituloNo, "title", c.titulo || "");
      var rotulo = c.email ? c.email : "conta não identificada";
      texto(card.rotuloConta, rotulo); atributo(card.rotuloConta, "title", rotulo);
      /* A pasta só aparece quando há mais de uma conta da mesma ferramenta: é o que as distingue. */
      var mostrarPasta = porFerramenta[c.ferramenta] > 1 && c.pasta;
      oculto(card.pasta, !mostrarPasta); texto(card.pasta, mostrarPasta ? c.pasta : ""); atributo(card.pasta, "title", c.pasta || "");
      sincronizarBarras(card, Array.isArray(c.barras) ? c.barras : []);
    });
    Object.keys(cards).forEach(function (id) { if (!presentes[id]) { removerCard(cards[id]); delete cards[id]; } });
    var mensagem = "";
    if (!lista.length) mensagem = "Nenhuma CLI encontrada no PATH (claude, codex, agy). Instale uma delas, ou aponte as pastas com --claude-config-dir, --codex-home ou --antigravity-home.";
    if (contas.erro) mensagem = '<span class="erro">▲ ' + String(contas.erro).replace(/[&<>]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]; }) + "</span>" + (mensagem ? " " + mensagem : "");
    if (aviso) { if (aviso.innerHTML !== mensagem) aviso.innerHTML = mensagem; oculto(aviso, !mensagem); }
  }
  tique(agoraS);
}
function tique(agoraS) {
  agoraS = agoraS || Date.now() / 1000;
  Object.keys(cards).forEach(function (id) {
    var card = cards[id], c = card.conta;
    var observado = numero(c.lido_em_epoch) ? c.lido_em_epoch : null;
    var limite = 2 * (c.intervalo_s || INTERVALO_PADRAO[c.ferramenta] || 300);
    var velho = observado !== null && agoraS - observado >= limite;
    card.no.classList.toggle("is-stale", velho);
    var aviso = velho ? "inativo " + idade(agoraS - observado) : (c.erro ? "última consulta não concluída (" + (c.erro_detalhe || "falhou") + ")" : "");
    oculto(card.orbita, !velho);
    texto(card.estadoTexto, aviso);
    oculto(card.estado, !aviso);
    card.barras.forEach(function (barra) {
      var b = barra.dados, t = tempoDaJanela(b, agoraS), temUso = b && numero(b.usado_pct);
      texto(barra.rotulo, b ? b.rotulo : "");
      barra.no.classList.toggle("is-missing", !temUso);
      barra.no.classList.toggle("is-alert", t.alerta);
      barra.no.classList.toggle("is-critical", t.critico);
      porDigitos(barra.usado, pct(temUso ? b.usado_pct : null));
      oculto(barra.reabre, barra.tipo !== "5h");
      texto(barra.reabre, reabre(b, agoraS));
      variavel(barra.cheio, "width", temUso ? Math.min(100, Math.max(0, b.usado_pct)) + "%" : "0%");
      var cursor = t.cursor === null ? null : Math.round(t.cursor * 100) / 100;
      oculto(barra.cursor, cursor === null);
      variavel(barra.no, "--cursor", (cursor === null ? 0 : cursor) + "%");
      atributo(barra.alvo, "aria-label", (b ? b.rotulo : "") + ": " + pct(temUso ? b.usado_pct : null) + " usado. " +
        (barra.tipo === "5h" ? barra.reabre.textContent : "Reset " + dataDoReset(b && b.renova_epoch)) + "." + (t.alerta ? " Consumo em alerta." : "") + " Clique para ver o detalhe.");
    });
    if (card.barraVirada) encherVerso(card, agoraS);
  });
}

/* ---------- cabeçalho, tema e a leitura do estado ---------- */
var estadoGeral = document.getElementById("estado-geral"), ultimoEstado = null, ultimaLeitura = 0, semConexao = false;
function cabecalho() {
  if (!estadoGeral) return;
  if (semConexao) { texto(estadoGeral, "sem conexão com o quota-board (ele parou?)"); return; }
  if (!ultimoEstado) { texto(estadoGeral, "consultando…"); return; }
  var lista = ultimoEstado.lista || [], consultando = lista.filter(function (c) { return c.consultando; }).length;
  var maisNova = null;
  lista.forEach(function (c) { if (numero(c.lido_em_epoch) && (maisNova === null || c.lido_em_epoch > maisNova)) maisNova = c.lido_em_epoch; });
  var t = lista.length + (lista.length === 1 ? " conta" : " contas");
  if (maisNova !== null) t += " · leitura mais nova " + idade(Date.now() / 1000 - maisNova);
  if (consultando) t += " · consultando " + consultando;
  texto(estadoGeral, t);
}
function ler() {
  fetch("/api/state", { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (estado) {
    semConexao = false; ultimoEstado = estado; ultimaLeitura = Date.now();
    desenhar(estado, Date.now() / 1000);
    cabecalho();
  }).catch(function () { semConexao = true; cabecalho(); });
}
var botaoAtualizar = document.getElementById("atualizar");
if (botaoAtualizar) botaoAtualizar.addEventListener("click", function () {
  fetch("/api/refresh", { method: "POST" }).then(function () { setTimeout(ler, 800); }).catch(function () {});
});
var botaoTema = document.getElementById("tema");
if (botaoTema) botaoTema.addEventListener("click", function () {
  var raiz = document.documentElement, escuroAgora = raiz.getAttribute("data-tema") === "escuro" || (!raiz.getAttribute("data-tema") && matchMedia("(prefers-color-scheme: dark)").matches);
  raiz.setAttribute("data-tema", escuroAgora ? "claro" : "escuro");
  try { localStorage.setItem("quota-board-tema", raiz.getAttribute("data-tema")); } catch (_) {}
});
try { var temaSalvo = localStorage.getItem("quota-board-tema"); if (temaSalvo) document.documentElement.setAttribute("data-tema", temaSalvo); } catch (_) {}

document.addEventListener("pointerdown", function () { focoPorTeclado = false; });
document.addEventListener("keydown", function (ev) { focoPorTeclado = true; if (ev.key === "Escape") desvirarTodos(); });
setInterval(function () { tique(); cabecalho(); }, 250);
setInterval(ler, 5000);
ler();
})();
