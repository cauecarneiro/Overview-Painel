/* Os cards de cota: o card H1 do quota-board (Node), no painel dos Vingadores. É o mesmo componente (identidade, abas por grupo,
   período de 5 horas e da Semana com a cápsula de uso e tempo, frases do prazo, tarja de privacidade, cópia da cota, inclinação
   sob o ponteiro, cantos squircle e a linha de leitura), com o que ficava por trás trocado: em vez de buscar /api/state, a
   página chama window.__painelContas.desenhar(contas, agoraS) a cada segundo com o bloco "contas" do dados.js (a página abre
   por file://), e o cabeçalho, o tema e o botão de atualizar são os da página. O verso (ASCII) e o painel Efeito não vieram:
   estão desligados no original (FLIP_ATIVO). O relógio é o da máquina, independente do polling, e só escreve no DOM o que
   mudou. Os módulos puros (prazo.js, capsula.js, privacidade.js, resumo.js) são os do original e têm testes em testes/js. */
(function () {
"use strict";
if (!window.ResizeObserver || !window.WeakMap || !window.Intl || !window.Prazo || !window.Capsula || !window.Privacidade || !window.Resumo) return;

/* ---------- utilidades ---------- */
var NUMERO = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
var INTERVALO_PADRAO = { claude: 300, codex: 300, agy: 1200 };

function numero(v) { return typeof v === "number" && isFinite(v); }
function pct(v) { return numero(v) ? NUMERO.format(v) + "%" : "sem dados"; }
function texto(no, t) { if (no.textContent !== t) no.textContent = t; }
function oculto(no, sim) { if (no.hidden !== sim) no.hidden = sim; }
function atributo(no, nome, valor) { if (no.getAttribute(nome) !== valor) no.setAttribute(nome, valor); }
function variavel(no, nome, valor) { if (no.style.getPropertyValue(nome) !== valor) no.style.setProperty(nome, valor); }
/* ?agora=<epoch> congela o relógio da página (capturas e testes visuais); sem ele, o relógio da máquina. */
var CONGELADO = (function () { var m = /[?&]agora=(\d+)/.exec(location.search); return m ? Number(m[1]) : null; })();
function agora() { return CONGELADO !== null ? CONGELADO : Date.now() / 1000; }
function reduzido() { return matchMedia("(prefers-reduced-motion: reduce)").matches; }


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
/* Fundo, borda, sombra, anel e recorte do brilho usam este mesmo caminho: nenhuma camada tem canto
   circular de CSS, então nada aparece por trás da curva. */
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
    Array.prototype.forEach.call(e.target.querySelectorAll(".card-surface, .card-sombra"), function (svg) {
      atributo(svg, "viewBox", "0 0 " + largura + " " + altura);
      atributo(svg.querySelector("path"), "d", caminho + " Z");
    });
    variavel(e.target, "--forma", "path('" + caminho + " Z')");
  });
});

/* ---------- tilt do card: inclina sob o ponteiro ---------- */
var TILT = { angulo: 4, escala: 1.02, perspectiva: 1200, duracao: 200 };
var tilt = (function () {
  var reduzir = matchMedia("(prefers-reduced-motion: reduce)"), mouse = matchMedia("(hover: hover) and (pointer: fine)");
  var porSlot = new WeakMap();
  function pode() { return !reduzir.matches && mouse.matches; }
  function deslizar(t) { t.alvo.style.transition = "transform " + TILT.duracao + "ms ease-out, --angulo " + TILT.duracao + "ms ease-out"; }
  function pintar(t) {
    t.quadro = 0;
    if (!t.dentro || !pode()) return;
    var r = t.slot.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var px = Math.min(1, Math.max(0, (t.x - r.left) / r.width)), py = Math.min(1, Math.max(0, (t.y - r.top) / r.height));
    var xRot = (py - 0.5) * TILT.angulo * 2, yRot = -(px - 0.5) * TILT.angulo * 2;
    t.alvo.style.setProperty("--angulo", String(Math.round(Privacidade.intensidadeDoAngulo(xRot, yRot, TILT.angulo) * 1000) / 1000));
    t.alvo.style.transform = "perspective(" + TILT.perspectiva + "px) rotateX(" + xRot + "deg) rotateY(" + yRot + "deg) scale3d(" + TILT.escala + ", " + TILT.escala + ", " + TILT.escala + ")";
    t.brilhos.forEach(function (b) {
      b.style.setProperty("--spot-x", px * r.width + "px");
      b.style.setProperty("--spot-y", py * r.height + "px");
      b.style.opacity = "1";
    });
  }
  function agendar(t) { if (!t.quadro) t.quadro = requestAnimationFrame(function () { pintar(t); }); }
  function descansar(t) {
    t.dentro = false;
    cancelAnimationFrame(t.quadro); t.quadro = 0;
    deslizar(t);
    t.alvo.style.transform = "";
    t.alvo.style.removeProperty("--angulo");
    t.brilhos.forEach(function (b) { b.style.opacity = "0"; });
  }
  function ligar(slot, alvo, brilhos) {
    var t = { slot: slot, alvo: alvo, brilhos: brilhos, x: 0, y: 0, quadro: 0, dentro: false };
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

/* ---------- privacidade: o miolo do e-mail vira bloco pixelado ---------- */
var TRANSLUCIDEZ = 0.82;
var privado = true;
try { privado = localStorage.getItem("painel-privacidade") !== "0"; } catch (_) {}
/* Pixels sólidos, sem suavização: cada célula é um quadrado de lado ~fonte/3 (poucos pixels, grandes), a altura é a das maiúsculas
   e o fundo do bloco assenta na linha de base, então ele cabe na linha do label. A largura é a de "n"
   repetido, medida na própria fonte. Os pixels são sorteados, nunca derivados do e-mail. */
function bloco(estilo, quantidade) {
  var tamanho = parseFloat(estilo.fontSize) || 11, lado = Math.max(2, Math.round(tamanho / 3));
  var medida = document.createElement("canvas").getContext("2d");
  medida.font = estilo.fontStyle + " " + estilo.fontWeight + " " + tamanho + "px " + estilo.fontFamily;
  var colunas = Math.max(2, Math.round(medida.measureText(new Array(quantidade + 1).join("n")).width / lado));
  var linhas = Math.max(2, Math.round(tamanho * 0.72 / lado));
  /* A tira de quadros (um por ângulo de inclinação, o do meio é o repouso) lado a lado num só canvas. */
  var quadros = Privacidade.QUADROS, tira = Privacidade.tiraDePixels(colunas, linhas, quadros, Math.random);
  var canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
  canvas.width = colunas * quadros; canvas.height = linhas;
  ctx.fillStyle = estilo.color;
  tira.forEach(function (quadro, k) {
    quadro.forEach(function (forca, i) {
      if (forca < 0.01) return;
      ctx.globalAlpha = forca * TRANSLUCIDEZ;
      ctx.fillRect(k * colunas + i % colunas, Math.floor(i / colunas), 1, 1);
    });
  });
  /* Imagem de fundo, não <canvas>: o canvas ganha camada própria e podia esmaecer e se mover
     fora de sincronia com o texto ao lado. Um fundo pinta na mesma camada do texto; o CSS escolhe dois quadros da tira
     pelo ângulo do card (--angulo, de -1 a 1). */
  var no = document.createElement("span");
  no.className = "email-pixelado";
  no.setAttribute("aria-hidden", "true");
  no.style.width = colunas * lado + "px"; no.style.height = linhas * lado + "px";
  no.style.setProperty("--tira", "url(" + canvas.toDataURL() + ")");
  no.style.setProperty("--quadros", String(quadros));
  return no;
}
function escreverEmail(no, email, sufixo) {
  var estilo = privado && email ? getComputedStyle(no) : null;
  var assinatura = [privado, email, sufixo, estilo && estilo.color, estilo && estilo.fontSize, estilo && estilo.fontFamily, estilo && estilo.fontWeight].join("|");
  if (no._assinatura === assinatura) return;
  no._assinatura = assinatura;
  no.textContent = "";
  if (!privado || !email) { no.appendChild(document.createTextNode((email || "") + sufixo)); return; }
  var p = Privacidade.partesDoEmail(email);
  no.appendChild(document.createTextNode(p.antes));
  no.appendChild(bloco(estilo, p.ocultos));
  no.appendChild(document.createTextNode(p.depois + sufixo));
}
/* "e-mail Plano" abaixo do título (sem ponto separador, só um espaço largo); sem e-mail, só o plano (ou "conta não identificada"). */
function identidade(card) {
  var c = card.conta, plano = c.plano ? c.plano.charAt(0).toUpperCase() + c.plano.slice(1) : "";
  if (c.email) escreverEmail(card.rotuloConta, c.email, plano ? "\u2002" + plano : "");
  else { card.rotuloConta._assinatura = null; texto(card.rotuloConta, plano || "conta não identificada"); }
  /* A dica nativa da linha mostra a pasta da conta, abreviada; o e-mail nunca vai para ela. */
  if (c.pasta) atributo(card.rotuloConta, "title", Privacidade.abreviarCaminho(c.pasta)); else card.rotuloConta.removeAttribute("title");
}
var ICONES_COPIAR = '<svg class="i-copia" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 3.5v-.2a1.8 1.8 0 0 0-1.8-1.8H3.3a1.8 1.8 0 0 0-1.8 1.8v5.4a1.8 1.8 0 0 0 1.8 1.8h.2"/></svg>' +
  '<svg class="i-ok" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.2 8.6l3.1 3.1 6.5-7.4"/></svg>' +
  '<svg class="i-erro" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
/* "Copiar": a cota da conta em texto puro. Com a privacidade ligada, o e-mail sai mascarado como na tela. */
function emailCopiavel(email) {
  if (!email || !privado) return email || "";
  var p = Privacidade.partesDoEmail(email);
  return p.antes + new Array(p.ocultos + 1).join("\u2022") + p.depois;
}
function copiarTexto(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
  return new Promise(function (ok, erro) {
    var area = document.createElement("textarea");
    area.value = t; area.setAttribute("readonly", ""); area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(area); area.select();
    var deu = false; try { deu = document.execCommand("copy"); } catch (_) {}
    area.remove(); deu ? ok() : erro();
  });
}
function estadoDaCopia(card, estado, rotulo) {
  atributo(card.copiar, "data-estado", estado); atributo(card.copiar, "aria-label", rotulo); atributo(card.copiar, "title", rotulo);
}
function copiarCota(card) {
  var t = Resumo.resumoDaConta(card.conta, agora(), { pct: pct, email: emailCopiavel(card.conta.email), velha: leituraVelha(card.conta, agora()) });
  clearTimeout(card.timerDoCopiar);
  copiarTexto(t).then(function () { estadoDaCopia(card, "ok", "Copiado"); }, function () { estadoDaCopia(card, "erro", "Não foi possível copiar"); })
    .then(function () { card.timerDoCopiar = setTimeout(function () { estadoDaCopia(card, "", "Copiar a cota desta conta"); }, 1500); });
}
function aplicarPrivacidade() {
  var botao = document.getElementById("privacidade");
  if (botao) texto(botao, "Privacidade: " + (privado ? "ligada" : "desligada"));
  Object.keys(cards).forEach(function (id) { identidade(cards[id]); });
}

/* ---------- barras e cards ---------- */
var cards = {};
/* O pulso da agulha cai no começo de cada minuto: a fase vem dos segundos do minuto, escrita uma vez. */
document.documentElement.style.setProperty("--fase", String(Capsula.fasePulso(agora())));
/* ---------- a cápsula: realce da faixa de tempo ---------- */
/* O realce espera a intenção do mouse; foco do teclado e toque continuam imediatos.
   O relógio por segundo só escreve enquanto há realce (escreverRelogio só mexe no DOM quando o texto muda). */
function realcar(barra) {
  var pode = !barra.no.hidden && !barra.regua.hidden;
  if (!pode) barra.mouse = barra.foco = barra.toque = false;
  var ativa = barra.mouse || barra.foco || barra.toque;
  if (barra.ativa === ativa) return;
  barra.ativa = ativa;
  barra.no.classList.toggle("realce", ativa);
  barra.card.no.classList.toggle("card-realce", barra.card.barras.some(function (b) { return b.ativa; }));
  escreverRelogio(barra, agora());
}
function escreverRelogio(barra, agoraS) {
  var d = barra.dados;
  texto(barra.timer, d ? Capsula.timerDaPilula(barra.ativa, !barra.regua.hidden, agoraS, d.renova_epoch, d.janela_min) : "");
}
function encerrarRealces() {
  Object.keys(cards).forEach(function (id) { cards[id].barras.forEach(function (b) {
    clearTimeout(b.timerMouse); b.timerMouse = null; b.mouse = b.foco = b.toque = false; realcar(b);
  }); });
}
function ligarRealce(barra) {
  var visual = barra.visual;
  function agendarMouse(entrada) {
    clearTimeout(barra.timerMouse);
    barra.timerMouse = setTimeout(function () { barra.mouse = entrada; barra.timerMouse = null; realcar(barra); }, Capsula.atrasoDoRealce(entrada));
  }
  visual.addEventListener("pointerenter", function (ev) { if (ev.pointerType !== "touch") agendarMouse(true); });
  visual.addEventListener("pointerleave", function (ev) { if (ev.pointerType !== "touch") agendarMouse(false); });
  visual.addEventListener("pointerdown", function (ev) { if (ev.pointerType === "touch") { barra.toque = !barra.toque; realcar(barra); } });
  barra.no.addEventListener("focus", function () { clearTimeout(barra.timerMouse); barra.foco = barra.no.matches(":focus-visible"); realcar(barra); });
  barra.no.addEventListener("blur", function () { barra.foco = false; realcar(barra); });
}
document.addEventListener("pointerdown", function (ev) {
  Object.keys(cards).forEach(function (id) { cards[id].barras.forEach(function (b) { if (b.toque && !b.visual.contains(ev.target)) { b.toque = false; realcar(b); } }); });
});
document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") encerrarRealces(); });
/* Os rótulos dos cortes da faixa de tempo (um por slot da cápsula): o dia da semana ou a hora em que cada corte começa.
   São decorativos, o mesmo dado está nas frases do card, e o texto só é escrito quando o período muda. */
var HTML_DIAS = {};
["5h", "semana"].forEach(function (tipo) {
  var html = '<span class="dias" aria-hidden="true">';
  for (var i = 0; i < (tipo === "5h" ? 5 : 7); i++) html += '<span class="corte"><span class="corte-rotulo"></span></span>';
  HTML_DIAS[tipo] = html + "</span>";
});
function escreverCortes(barra, b, tempo) {
  var chave = b.renova_epoch + "|" + b.janela_min;
  if (barra.chaveCortes !== chave) {
    barra.chaveCortes = chave; barra.medida = null;
    var lista = Prazo.cortes(b);
    barra.cortes.forEach(function (c, i) { texto(c.rotulo, lista[i] ? lista[i].rotulo : ""); });
  }
  var n = barra.cortes.length, atual = Prazo.corteAtual(tempo, n);
  if (barra.corteAtual !== atual) {
    var antigo = barra.cortes[barra.corteAtual];
    if (antigo) { antigo.no.classList.remove("some"); antigo.no.style.removeProperty("--centro"); }
    barra.corteAtual = atual; barra.medida = null;
  }
  if (barra.cortes[atual]) posicionarRotulo(barra, tempo / 100 * n - atual);
}
/* Os rótulos ficam no centro do corte. No corte da agulha, ele passa para o centro do lado maior do corte (a agulha nunca
   cruza as letras) e some enquanto nenhum dos lados comporta o texto. A medida (largura do corte e do texto) é lida uma vez
   por texto e por tamanho de janela, nunca por segundo; o centro é escrito em passos de 1% do corte. */
var FOLGA_ROTULO = 8;
function posicionarRotulo(barra, f) {
  var c = barra.cortes[barra.corteAtual];
  if (!barra.medida) {
    var slot = c.no.getBoundingClientRect().width;
    if (!slot) return;
    barra.medida = (c.rotulo.getBoundingClientRect().width + FOLGA_ROTULO) / slot;
  }
  c.no.classList.toggle("some", Math.max(f, 1 - f) < barra.medida);
  variavel(c.no, "--centro", Math.round((f > .5 ? f / 2 : (1 + f) / 2) * 100) + "%");
}
window.addEventListener("resize", function () { Object.keys(cards).forEach(function (id) { cards[id].barras.forEach(function (b) { b.medida = null; }); }); });
function criarBarra(card, chave, tipo) {
  var no = document.createElement("div");
  no.className = "quota " + (tipo === "semana" ? "weekly" : "primary");
  no.tabIndex = 0; no.setAttribute("role", "group");
  no.innerHTML = '<div class="quota-heading"><span class="quota-label"></span><span class="fim-semana"></span><span class="used"><span class="num"></span><span class="suf"></span></span></div>' +
    '<div class="visual"><span class="tempo-nome" hidden>Tempo</span><div class="cap"><div class="track"><span class="fill"></span></div>' +
    '<div class="regua" hidden><span class="fundo-tempo" aria-hidden="true"><span class="decorrido"></span></span><span class="marcas" aria-hidden="true"></span>' + HTML_DIAS[tipo] + '<span class="agulha" aria-hidden="true"></span></div></div>' +
    '<span class="conector" aria-hidden="true"></span><div class="relogio" aria-hidden="true"><span class="r-rotulo"><span>Decorrido </span></span><span class="r-timer"></span></div></div>' +
    '<p class="frases"><span class="termina"></span><span class="prazo"></span></p>';
  var barra = { card: card, chave: chave, tipo: tipo, no: no, dados: null, estado: null, visual: no.querySelector(".visual"), trilho: no.querySelector(".track"),
    cheio: no.querySelector(".fill"), regua: no.querySelector(".regua"), nomeTempo: no.querySelector(".tempo-nome"), timer: no.querySelector(".r-timer"),
    rotulo: no.querySelector(".quota-label"), fim: no.querySelector(".fim-semana"),
    usado: no.querySelector(".num"), sufixo: no.querySelector(".suf"), termina: no.querySelector(".termina"), prazo: no.querySelector(".prazo"),
    mouse: false, foco: false, toque: false, ativa: false, timerMouse: null,
    cortes: Array.prototype.map.call(no.querySelectorAll(".corte"), function (c) { return { no: c, rotulo: c.querySelector(".corte-rotulo") }; }),
    chaveCortes: null, corteAtual: -1, medida: null };
  ligarRealce(barra);
  return barra;
}
function criarCard(conta) {
  var no = document.createElement("article");
  no.className = "card";
  no.innerHTML = '<svg class="card-sombra" aria-hidden="true" focusable="false"><path></path></svg><svg class="card-surface" aria-hidden="true" focusable="false"><path></path></svg>' +
    '<span class="card-spotlight" aria-hidden="true"></span>' +
    '<header class="card-header"><div class="identity"><h3 class="card-title"><span class="title-text"></span></h3>' +
    '<p class="account-label"></p></div><button class="copiar" type="button" title="Copiar a cota desta conta" aria-label="Copiar a cota desta conta">' + ICONES_COPIAR + '</button></header>' +
    '<div class="abas" role="group" aria-label="Modelos" hidden></div><div class="card-corpo"></div>' +
    '<p class="age" role="status"></p>';
  formas.set(no, no.querySelector(".card-surface"));
  observadorDeForma.observe(no);
  var giro = document.createElement("div");
  giro.className = "card-giro";
  giro.appendChild(no);
  var slot = document.createElement("div");
  slot.className = "card-slot";
  slot.appendChild(giro);
  var card = { no: no, slot: slot, conta: conta, barras: [], corpo: no.querySelector(".card-corpo"), idade: no.querySelector(".age"),
               desligarTilt: tilt.ligar(slot, slot, [no.querySelector(".card-spotlight")]), copiar: no.querySelector(".copiar"), abas: no.querySelector(".abas"), grupoAtivo: null, assinaturaDeGrupos: null, titulo: no.querySelector(".title-text"),
               rotuloConta: no.querySelector(".account-label") };
  card.copiar.addEventListener("click", function (ev) { ev.stopPropagation(); copiarCota(card); });
  return card;
}
function removerCard(card) {
  clearTimeout(card.timerDoCopiar);
  card.barras.forEach(function (barra) { barra.no.remove(); });
  observadorDeForma.unobserve(card.no);
  card.desligarTilt();
  card.slot.remove();
}
function sincronizarBarras(card, lista) {
  var chaves = lista.map(function (b) { return b.grupo_rotulo + "|" + b.tipo; });
  var iguais = card.barras.length === chaves.length && card.barras.every(function (b, i) { return b.chave === chaves[i]; });
  if (!iguais) {
    card.barras.forEach(function (barra) { barra.no.remove(); });
    card.barras = lista.map(function (b) {
      var barra = criarBarra(card, b.grupo_rotulo + "|" + b.tipo, b.tipo);
      card.corpo.appendChild(barra.no);
      return barra;
    });
  }
  card.barras.forEach(function (barra, i) {
    barra.dados = lista[i];
    barra.no.style.setProperty("--i", String(i + 1));
  });
  card.idade.style.setProperty("--i", String(card.barras.length + 1));
  sincronizarGrupos(card, lista);
}
/* O card mostra um grupo por vez (o primeiro, por padrão). Com mais de um grupo, abas de texto trocam o que
   aparece sem mudar o tamanho do card; as barras dos outros grupos continuam atualizadas, só escondidas. */
function nomeDoGrupo(g) { return g || "Geral"; }
function sincronizarGrupos(card, lista) {
  var grupos = [];
  lista.forEach(function (b) { if (grupos.indexOf(b.grupo_rotulo) < 0) grupos.push(b.grupo_rotulo); });
  if (grupos.indexOf(card.grupoAtivo) < 0) card.grupoAtivo = grupos[0];
  var assinatura = grupos.join("|");
  if (card.assinaturaDeGrupos !== assinatura) {
    card.assinaturaDeGrupos = assinatura;
    card.abas.textContent = "";
    if (grupos.length > 1) grupos.forEach(function (g) {
      var aba = document.createElement("button");
      aba.type = "button"; aba.className = "aba"; aba.textContent = nomeDoGrupo(g); aba._grupo = g;
      aba.addEventListener("click", function (ev) { ev.stopPropagation(); card.grupoAtivo = g; aplicarGrupo(card); tique(); });
      card.abas.appendChild(aba);
    });
  }
  oculto(card.abas, grupos.length < 2);
  aplicarGrupo(card);
}
function aplicarGrupo(card) {
  Array.prototype.forEach.call(card.abas.children, function (aba) { atributo(aba, "aria-pressed", aba._grupo === card.grupoAtivo ? "true" : "false"); });
  card.barras.forEach(function (barra) { oculto(barra.no, !barra.dados || barra.dados.grupo_rotulo !== card.grupoAtivo); realcar(barra); });
}

/* ---------- desenho ---------- */
var grade = null, ultimoJson = null;
function desenhar(contas, agoraS) {
  var secao = document.getElementById("contas");
  if (!secao) return;
  grade = grade || secao.querySelector(".contas-grade");
  var aviso = secao.querySelector(".aviso-contas");
  contas = contas || { consultadas: false, lista: [] };
  var lista = Array.isArray(contas.lista) ? contas.lista : [];
  var json = JSON.stringify(contas);
  if (json !== ultimoJson) {
    ultimoJson = json;
    var presentes = {};
    lista.forEach(function (c, i) {
      var id = c.id;
      presentes[id] = 1;
      var card = cards[id];
      if (!card) { card = cards[id] = criarCard(c); }
      card.conta = c;
      if (grade.children[i] !== card.slot) grade.insertBefore(card.slot, grade.children[i] || null);
      atributo(card.no, "data-ferramenta", c.ferramenta || "");
      atributo(card.no, "aria-busy", c.consultando ? "true" : "false");
      texto(card.titulo, c.ferramenta_nome || "conta");
      identidade(card);
      sincronizarBarras(card, Array.isArray(c.barras) ? c.barras : []);
    });
    Object.keys(cards).forEach(function (id) { if (!presentes[id]) { removerCard(cards[id]); delete cards[id]; } });
    var mensagem = "";
    if (!contas.consultadas) mensagem = "A consulta às CLIs está desligada (coletor --sem-contas): as cotas vêm só das status lines.";
    else if (!lista.length) mensagem = "Nenhuma conta em execução no canvas" + (contas.canvas ? " " + contas.canvas : "") + ".";
    if (contas.erro) mensagem = '<span class="erro">▲ ' + String(contas.erro).replace(/[&<>]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]; }) + "</span>" + (mensagem ? " " + mensagem : "");
    if (aviso) { if (aviso.innerHTML !== mensagem) aviso.innerHTML = mensagem; oculto(aviso, !mensagem); }
  }
  tique(agoraS);
}
/* Um período do card (5 horas ou Semana). As frases e o estado vêm de prazo.js; aqui só se escreve o que mudou. */
function escreverBarra(card, barra, agoraS, velho) {
  var b = barra.dados, d = Prazo.descrever(b, agoraS, { velha: velho }), cinco = barra.tipo === "5h";
  var nome = (b.grupo_rotulo ? b.grupo_rotulo + ", " : "") + (cinco ? "5 horas" : "Semana");
  barra.estado = d.estado;
  texto(barra.rotulo, cinco ? "5 horas" : "Semana");
  porDigitos(barra.usado, d.usado === null ? "\u2014" : pct(d.usado));
  texto(barra.sufixo, d.usado === null ? "" : d.sufixo);
  variavel(barra.cheio, "width", d.usado === null ? "0%" : Math.min(100, Math.max(0, d.usado)) + "%");
  if (d.usado === null) ["role", "aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-label"].forEach(function (a) { barra.trilho.removeAttribute(a); });
  else {
    atributo(barra.trilho, "role", "meter"); atributo(barra.trilho, "aria-valuemin", "0"); atributo(barra.trilho, "aria-valuemax", "100");
    atributo(barra.trilho, "aria-valuenow", String(d.usado));
    atributo(barra.trilho, "aria-label", card.conta.ferramenta_nome + ": " + nome + ", cota usada" + (d.estado === "anterior" ? ", leitura anterior" : ""));
  }
  oculto(barra.regua, d.tempo === null);
  oculto(barra.nomeTempo, d.tempo === null);
  barra.visual.classList.toggle("sem-regua", d.tempo === null);
  barra.visual.classList.toggle("tempo-acima", Capsula.tempoAcima(d.tempo, d.usado));
  if (d.tempo !== null) { variavel(barra.visual, "--t", String(Math.round(d.tempo * 10) / 10)); escreverCortes(barra, b, d.tempo); }
  realcar(barra); escreverRelogio(barra, agoraS);
  texto(barra.termina, cinco ? d.termina : "");
  texto(barra.fim, cinco ? "" : d.termina);
  texto(barra.prazo, d.prazo);
  var frases = [nome + ": " + (d.usado === null ? "sem dados" : pct(d.usado) + d.sufixo), d.termina, d.prazo].filter(Boolean);
  atributo(barra.no, "aria-label", frases.join(". ") + ".");
}
/* A linha de baixo do card: a consulta em andamento, o aviso, ou a idade da leitura. */
function textoDaIdade(card, observado, velho, agoraS) {
  var ativas = card.barras.filter(function (x) { return x.dados && x.dados.grupo_rotulo === card.grupoAtivo; });
  if (card.conta.consultando) return "Atualizando leitura";
  if (observado === null || ativas.every(function (x) { return x.estado === "sem-dado"; })) return "Sem leitura disponível";
  var atrasada = velho || ativas.some(function (x) { return x.estado === "anterior"; });
  if (!atrasada && card.conta.erro) return "Última consulta não concluída";
  return Prazo.rotuloDaLeitura(agoraS - observado);
}
/* A linha de baixo troca entre "Atualizando leitura" e a idade da leitura em duas etapas seguidas: o texto antigo sai
   (250 ms) e o novo entra (350 ms), desfocado e um pouco abaixo. Só a mudança de estado anima; a idade avançando e o
   movimento reduzido trocam o texto na hora. card.alvoIdade guarda sempre o texto mais recente. */
function aplicarIdade(card) {
  texto(card.idade, card.alvoIdade);
  card.idade.classList.toggle("atualizando", card.idadeAtualizando);
}
function trocarIdade(card) {
  var no = card.idade;
  if (card.trocando) card.trocando.cancel();
  var sai = no.animate([{ opacity: 1, filter: "blur(0)", transform: "translateY(0)" }, { opacity: 0, filter: "blur(.5px)", transform: "translateY(-1.5px)" }],
    { duration: 250, easing: "cubic-bezier(.4, 0, 1, 1)", fill: "forwards" });
  card.trocando = sai;
  sai.onfinish = function () {
    aplicarIdade(card);
    var entra = no.animate([{ opacity: 0, filter: "blur(1.5px)", transform: "translateY(1.5px)" }, { opacity: 1, filter: "blur(0)", transform: "translateY(0)" }],
      { duration: 350, easing: "ease-out" });
    sai.cancel();
    card.trocando = entra;
    entra.onfinish = function () { card.trocando = null; aplicarIdade(card); };
  };
}
function escreverIdade(card, alvo, atualizando) {
  card.alvoIdade = alvo;
  if (card.idadeAtualizando === undefined || reduzido()) { card.idadeAtualizando = atualizando; aplicarIdade(card); return; }
  if (atualizando !== card.idadeAtualizando) { card.idadeAtualizando = atualizando; trocarIdade(card); }
  else if (!card.trocando) aplicarIdade(card);
}
/* A leitura é velha quando passou de duas vezes o intervalo de consulta da conta. */
function leituraVelha(c, agoraS) {
  return numero(c.lido_em_epoch) && agoraS - c.lido_em_epoch >= 2 * (c.intervalo_s || INTERVALO_PADRAO[c.ferramenta] || 300);
}
function tique(agoraS) {
  agoraS = agoraS || agora();
  Object.keys(cards).forEach(function (id) {
    var card = cards[id], c = card.conta;
    var observado = numero(c.lido_em_epoch) ? c.lido_em_epoch : null;
    var velho = leituraVelha(c, agoraS);
    card.barras.forEach(function (barra) { if (barra.dados) escreverBarra(card, barra, agoraS, velho); });
    escreverIdade(card, textoDaIdade(card, observado, velho, agoraS), !!card.conta.consultando);
  });
}

/* ---------- a página ---------- */
/* O botão Privacidade e o Tema são da página. O bloco do e-mail é desenhado na cor do texto: trocar o tema (pelo botão ou pelo
   sistema) pede um desenho novo. */
var botaoPrivacidade = document.getElementById("privacidade");
if (botaoPrivacidade) botaoPrivacidade.addEventListener("click", function () {
  privado = !privado;
  try { localStorage.setItem("painel-privacidade", privado ? "1" : "0"); } catch (_) {}
  aplicarPrivacidade();
});
new MutationObserver(aplicarPrivacidade).observe(document.documentElement, { attributes: true, attributeFilter: ["data-tema"] });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", aplicarPrivacidade);
aplicarPrivacidade();

setInterval(function () { tique(); }, 250);
window.__painelContas = { desenhar: desenhar };
})();
