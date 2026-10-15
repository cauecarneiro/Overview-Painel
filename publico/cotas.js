/* Cards de cota por conta: a tela do dashboard de cotas de fbtostadev (cotas/static/, MIT), adaptada ao
   Overview-Painel. Em vez de fetch num backend, lê o bloco "contas" do dados.js (a página abre
   por file://); em vez de ES modules, um script comum. Fora isso, é o mesmo card: barra grossa da
   janela de 5 h e fina da semanal, agora uma cápsula com a faixa do tempo decorrido (pelo relógio da
   máquina) ao lado do uso, e o e-mail com a tarja de privacidade; só os dígitos que mudam animam,
   cantos squircle por SVG, tilt em 3D e anel pulsando enquanto a CLI consulta. O detalhe de uma
   janela não abre em popover (pedido do dono do painel, 08/10/2026): o clique na barra troca a frente
   do card pelo verso, que mostra tempo até reabrir, reset, usada e livre, a outra janela e a origem.
   A troca não vira o card em 3D (segundo pedido, 08/10): o card dá um "pop" curto, escala com leve
   overshoot e um giro de poucos graus no plano, horário ou anti-horário, sorteado de uma lista, que
   volta em mola; os blocos de texto saltam de leve (terceiro pedido, 08/10): o que sai encolhe e
   some, o que entra sobe um pouco e assenta com uma mola curta, quase todos ao mesmo tempo, sem
   cascata longa. Clique no verso, "Voltar" ou Esc voltam à frente. Tudo dentro desta função; só
   window.__painelContas é global. A aritmética da cápsula e as regras da tarja ficam em cartao-apoio.js
   (window.CartaoApoio), que a página carrega antes e que tem testes próprios em testes/js. */
(function () {
"use strict";
if (!window.ResizeObserver || !window.WeakMap || !window.Intl || !window.CartaoApoio) return;
var Apoio = window.CartaoApoio;

var ESTILO = `
#contas { --c-sup: var(--sup); --c-tinta: var(--tinta); --c-apagado: var(--apagado); --c-trilho: var(--sup2);
          --c-cheio: var(--barra); --c-alerta: #b86a24; --c-critico: var(--critico); --c-fio: var(--fio); --c-fio-forte: var(--fio-forte);
          --c-etiqueta: var(--sup2); --c-borda: #8c8c86; --c-decorrido: #d0d0c9; --c-agulha: #55554f; --c-marca: rgba(0,0,0,.48);
          --c-pilula: rgba(255,255,255,.74); --c-pulso: rgba(85,85,79,.6);
          --sombra-sm: 0px 2px 3px -1px rgba(0,0,0,0.1), 0px 1px 0px 0px rgba(25,28,33,0.02), 0px 0px 0px 1px rgba(25,28,33,0.08);
          --sombra-md: 0px 0px 0px 1px rgba(0,0,0,0.06), 0px 1px 1px -0.5px rgba(0,0,0,0.06), 0px 3px 3px -1.5px rgba(0,0,0,0.06), 0px 6px 6px -3px rgba(0,0,0,0.06), 0px 12px 12px -6px rgba(0,0,0,0.06), 0px 24px 24px -12px rgba(0,0,0,0.06); }
/* No escuro, a cápsula ganha contorno, decorrido, agulha, marcas e pílula próprios. */
@media (prefers-color-scheme: dark) { html:not([data-tema="claro"]) #contas { --c-borda: #6a6a65; --c-decorrido: #6e6e68; --c-agulha: #f7f7f3; --c-marca: rgba(255,255,255,.52); --c-pilula: rgba(40,40,38,.74); --c-pulso: rgba(202,202,195,.55); } }
html[data-tema="escuro"] #contas { --c-borda: #6a6a65; --c-decorrido: #6e6e68; --c-agulha: #f7f7f3; --c-marca: rgba(255,255,255,.52); --c-pilula: rgba(40,40,38,.74); --c-pulso: rgba(202,202,195,.55); }
@media (prefers-color-scheme: dark) { html:not([data-tema="claro"]) #contas { --c-sup: #242423; --c-fio: #34342f; --c-etiqueta: #2e2e2c; } }
html[data-tema="escuro"] #contas { --c-sup: #242423; --c-fio: #34342f; --c-etiqueta: #2e2e2c; }
@media (prefers-color-scheme: dark) { html:not([data-tema="claro"]) #contas { --c-alerta: #c98a52; } }
html[data-tema="escuro"] #contas { --c-alerta: #c98a52; }
#contas .aviso-contas { padding: 0 16px 12px; color: var(--apagado); font-size: 11px; }
#contas .aviso-contas[hidden] { display: none; }
#contas .aviso-contas .erro { color: var(--critico-tinta); }
.contas-grade { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; align-items: stretch; margin: 0; padding: 0 2px; }
#contas.cartao { background: none; border-radius: 0; }
#contas .aviso-contas { padding-left: 4px; padding-right: 4px; }
.contas-grade[hidden] { display: none; }
@media (max-width: 1100px) { .contas-grade { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 700px) { .contas-grade { grid-template-columns: 1fr; } }
html[data-layout="minimo"] #contas { display: none; }

.card-slot { position: relative; display: grid; min-width: 0; }
.card-slot:hover, .card-slot:focus-within { z-index: 1; }
/* Frente e verso no mesmo lugar: a frente é o card de sempre (superfície, sombra, tilt); o verso é
   só conteúdo, absoluto por cima, sem fundo próprio. A troca é um "pop" do conjunto e a transição
   vertical dos blocos; nada gira nem se desloca. */
.card-cena { position: relative; display: grid; min-width: 0; }
.card-pilha { position: relative; display: grid; min-width: 0; will-change: transform; cursor: pointer; }
/* O pop: escala com overshoot e um giro no plano (--giro, sorteado pelo JS a cada clique) que volta
   em mola: passa do zero para o outro lado, bem menos, e assenta. */
.card-cena.pop { animation: pop-do-card 400ms cubic-bezier(.3, .6, .3, 1) both; transform-origin: 50% 50%; }
@keyframes pop-do-card {
  0% { transform: rotate(0deg) scale(1); }
  30% { transform: rotate(var(--giro, 0deg)) scale(1.008); }
  65% { transform: rotate(calc(var(--giro, 0deg) * -0.08)) scale(1); }
  85% { transform: rotate(calc(var(--giro, 0deg) * 0.02)) scale(1); }
  100% { transform: rotate(0deg) scale(1); }
}
.card { --radius: 20px; --padding: 18px; --accent: #6d7782; position: relative; isolation: isolate; border-radius: var(--radius);
  padding: var(--padding); min-width: 0; color: var(--c-tinta);
  box-shadow: 0px 2px 3px -1px rgba(0,0,0,0.1), 0px 1px 0px 0px rgba(25,28,33,0.02), 0px 0px 0px 1px var(--c-fio); }
.card-verso { --radius: 20px; --padding: 18px; --accent: #6d7782; position: absolute; inset: 0; z-index: 1; padding: var(--padding); min-width: 0;
  color: var(--c-tinta); cursor: pointer; display: flex; flex-direction: column; visibility: hidden; }
.verso-corpo { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; display: flex; flex-direction: column; margin: 0 calc(-1 * var(--padding)); padding: 0 var(--padding); }
.card-cena.virado .card { pointer-events: none; }
.card-cena:not(.virado) .card-verso { pointer-events: none; }
.card-cena.mostra-verso .card-verso { visibility: visible; }
/* Os blocos de texto saltam: o que sai encolhe um pouco e some em 100 ms; o que entra vem 5 px de
   baixo, um pouco menor, e assenta com uma mola curta (overshoot da curva), 10 ms depois do bloco
   anterior (--i), o bastante para não parecer um corte, pouco para não virar cascata. */
.card .bloco, .card-verso .bloco { transition: transform 190ms cubic-bezier(.2, .9, .3, 1.18), opacity 110ms ease-out; transition-delay: calc(50ms + var(--i, 0) * 10ms); }
.card-cena.virado .card .bloco { transform: translateY(-3px) scale(.975); opacity: 0; transition: transform 100ms ease-in, opacity 80ms ease-in; transition-delay: calc(var(--i, 0) * 6ms); }
.card-cena:not(.virado) .card-verso .bloco { transform: translateY(5px) scale(.965); opacity: 0; transition: transform 100ms ease-in, opacity 80ms ease-in; transition-delay: calc(var(--i, 0) * 6ms); }
.card-surface { position: absolute; inset: 0; width: 100%; height: 100%; z-index: -1; overflow: visible; pointer-events: none; fill: var(--c-sup); }
.card::before { content: ""; position: absolute; inset: 0; z-index: -1; border-radius: var(--radius); pointer-events: none; opacity: 0; transition: opacity 200ms;
  box-shadow: 0px 1px 1px -0.5px rgba(0,0,0,0.06), 0px 3px 3px -1.5px rgba(0,0,0,0.06), 0px 6px 6px -3px rgba(0,0,0,0.06), 0px 12px 12px -6px rgba(0,0,0,0.06), 0px 24px 24px -12px rgba(0,0,0,0.06); }
.card-slot:hover .card::before, .card-slot:focus-within .card::before { opacity: 1; }
/* O brilho sob o cursor: uma luz difusa (gradiente largo, com queda suave) e, por cima, um grão fino
   (ruído fractal em SVG, misturado em soft-light), os dois presos ao mesmo ponto. --brilho e --grao
   são as intensidades; o JS só liga, desliga e move. */
.card-spotlight { --brilho: .04; --grao: .14; position: absolute; inset: 0; border-radius: var(--radius); overflow: hidden;
  -webkit-clip-path: inset(0 round var(--radius)); clip-path: inset(0 round var(--radius)); pointer-events: none; opacity: 0; transition: opacity 260ms; }
@media (prefers-color-scheme: dark) { html:not([data-tema="claro"]) .card-spotlight { --brilho: .035; --grao: .16; } }
html[data-tema="escuro"] .card-spotlight { --brilho: .035; --grao: .16; }
/* No escuro, trilho e preenchimento das barras ganham contraste próprio, para a luz do hover não
   apagar uma barra vazia ou quase vazia contra o fundo. */
@media (prefers-color-scheme: dark) { html:not([data-tema="claro"]) #contas { --c-trilho: #35352f; --c-cheio: #8f8f86; } }
html[data-tema="escuro"] #contas { --c-trilho: #35352f; --c-cheio: #8f8f86; }
.card-spotlight::before, .card-spotlight::after { content: ""; position: absolute; left: -380px; top: -380px; width: 760px; height: 760px;
  transform: translate3d(var(--spot-x, 0px), var(--spot-y, 0px), 0); }
.card-spotlight::before { opacity: var(--brilho); background: radial-gradient(closest-side, rgba(255,255,255,1) 0%, rgba(255,255,255,.5) 28%, rgba(255,255,255,.16) 58%, rgba(255,255,255,0) 100%); }
.card-spotlight::after { opacity: var(--grao); mix-blend-mode: soft-light;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .9 0'/></filter><rect width='100%25' height='100%25' filter='url(%23g)'/></svg>");
  background-size: 180px 180px; -webkit-mask-image: radial-gradient(closest-side, #000 0%, rgba(0,0,0,.5) 45%, transparent 100%); mask-image: radial-gradient(closest-side, #000 0%, rgba(0,0,0,.5) 45%, transparent 100%); }
/* A cor de cada ferramenta: o laranja do Claude, o azul do Codex, o verde-água do Antigravity.
   Vale para o ponto do título e para as barras (a de 5 h cheia; a semanal, mais contida). */
.card[data-ferramenta="claude"], .card-verso[data-ferramenta="claude"] { --accent: #d4683a; }
.card[data-ferramenta="codex"], .card-verso[data-ferramenta="codex"] { --accent: #2fa08e; }
.card[data-ferramenta="agy"], .card-verso[data-ferramenta="agy"] { --accent: #7f6ae0; }
@media (prefers-color-scheme: dark) { html:not([data-tema="claro"]) .card[data-ferramenta="claude"], html:not([data-tema="claro"]) .card-verso[data-ferramenta="claude"] { --accent: #e07c52; }
  html:not([data-tema="claro"]) .card[data-ferramenta="codex"], html:not([data-tema="claro"]) .card-verso[data-ferramenta="codex"] { --accent: #47b8a5; }
  html:not([data-tema="claro"]) .card[data-ferramenta="agy"], html:not([data-tema="claro"]) .card-verso[data-ferramenta="agy"] { --accent: #a08df0; } }
html[data-tema="escuro"] .card[data-ferramenta="claude"], html[data-tema="escuro"] .card-verso[data-ferramenta="claude"] { --accent: #e07c52; }
html[data-tema="escuro"] .card[data-ferramenta="codex"], html[data-tema="escuro"] .card-verso[data-ferramenta="codex"] { --accent: #47b8a5; }
html[data-tema="escuro"] .card[data-ferramenta="agy"], html[data-tema="escuro"] .card-verso[data-ferramenta="agy"] { --accent: #a08df0; }
/* A tarja do e-mail: uma tira de quadros sorteados (--tira, --quadros), um por ângulo de inclinação do card. O quadro do meio é o repouso;
   --angulo (-1 a 1, escrita pela inclinação do card, com transição) mistura dois quadros vizinhos, então os pixels variam aos poucos. */
@property --angulo { syntax: "<number>"; inherits: true; initial-value: 0; }
.email-pixelado { position: relative; display: inline-block; vertical-align: baseline; margin: 0 1px; }
.email-pixelado::before, .email-pixelado::after { content: ""; position: absolute; inset: 0; background-image: var(--tira); background-size: calc(var(--quadros) * 100%) 100%; background-repeat: no-repeat;
  image-rendering: pixelated; image-rendering: crisp-edges; background-position: 50% 0; }
.email-pixelado::after { display: none; }
@supports (width: round(down, 1px, 1px)) {
  .email-pixelado { --q: calc((clamp(-1, var(--angulo), 1) * .5 + .5) * (var(--quadros) - 1)); --i0: round(down, var(--q), 1); }
  .email-pixelado::before { background-position: calc(var(--i0) / (var(--quadros) - 1) * 100%) 0; opacity: calc(1 - (var(--q) - var(--i0))); }
  .email-pixelado::after { display: block; background-position: calc(min(var(--i0) + 1, var(--quadros) - 1) / (var(--quadros) - 1) * 100%) 0; opacity: calc(var(--q) - var(--i0)); }
}
.card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.card .identity { min-width: 0; flex: 1; }
.card-eyebrow { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .8px; color: var(--c-apagado); margin: 0 0 4px; }
.card-title { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 17px; font-weight: 650; letter-spacing: -.3px; line-height: 1.25; margin: 0 0 3px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card-title::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: var(--accent); flex: none; }
.card .account-label, .card .quem-usa { margin: 0; color: var(--c-apagado); font-size: 11px; line-height: 1.45; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card .quem-usa { color: var(--tinta2); }
.model-tag { color: var(--tinta2); background: var(--c-etiqueta); border: 1px solid var(--c-fio); border-radius: 999px; padding: 3px 9px; font-size: 10px; line-height: 1.35;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: none; max-width: 50%; }
.quota { position: relative; }
.quota + .quota { margin-top: 11px; }
.quota.weekly + .quota.primary { margin-top: 14px; padding-top: 11px; border-top: 1px solid var(--c-fio); }
.quota-heading { display: flex; align-items: baseline; gap: 10px; margin-bottom: 7px; font-variant-numeric: tabular-nums; }
.quota-label { margin-right: auto; font-size: 12.5px; font-weight: 590; }
.quota .used { font-size: 18px; font-weight: 680; letter-spacing: -.4px; line-height: 1.15; }
.lift-number { display: inline-flex; position: relative; font-variant-numeric: tabular-nums; }
.lift-place { display: inline-grid; position: relative; white-space: pre; }
.lift-digit { width: 1ch; }
.lift-layer { grid-area: 1 / 1; transform: translateY(var(--lift-y, 0%)); opacity: var(--lift-opacity, 1);
  transition: transform 220ms cubic-bezier(0.23, 1, 0.32, 1), opacity 220ms cubic-bezier(0.23, 1, 0.32, 1); }
.lift-removed { position: absolute; top: 0; pointer-events: none; }
.quota .reopens { font-size: 11px; color: var(--c-apagado); white-space: nowrap; }
.weekly .quota-heading { margin-bottom: 6px; }
.weekly .quota-label, .weekly .used { font-size: 12px; font-weight: 570; letter-spacing: 0; }
/* A cápsula: o uso (a barra na cor da ferramenta) e o tempo (uma faixa fina e neutra, preenchida até a agulha), separados por
   um fio, dentro de um contorno de altura fixa. O uso fica em cima; quando o decorrido passa do usado (.tempo-acima), só as duas
   faixas, o fio e o rótulo "Tempo" trocam de lugar. No realce (mouse com espera, foco do teclado) a faixa cresce, aparecem a hora
   ou o dia de cada corte e a pílula do tempo decorrido; os textos seguintes descem com a mesma transição. */
.quota .quota-heading { margin-bottom: 4px; }
.weekly .quota-heading { margin-bottom: 3px; }
.visual { --slots: 5; --barra: 8px; --faixa-c: 4px; --faixa-d: 18px; --faixa: var(--faixa-c); --pilula: 16px; --meia-pilula: 66px; --meia-compacta: 31px; --folga-pilula: 2px;
  --cap-d: calc(var(--barra) + 1px + var(--faixa-d) + 2px); --x: calc(48px + 1px + (100% - 48px - 2px) * var(--t, 0) / 100);
  position: relative; z-index: 1; margin: 0 0 -1px; height: calc(var(--barra) + 1px + var(--faixa) + 2px + 6px);
  transition: height 220ms cubic-bezier(.23, 1, .32, 1); }
.weekly .visual { --slots: 7; --barra: 5px; --faixa-d: 16px; --meia-pilula: 84px; --meia-compacta: 46px; }
.visual::before { content: ""; position: absolute; left: 0; right: 0; top: -3px; bottom: -3px; }
.visual.sem-regua { height: calc(var(--barra) + 2px + 6px); }
@property --slot-gap { syntax: "<length>"; inherits: true; initial-value: 1px; }
.cap { --slot-gap: 1px; position: absolute; left: 48px; right: 0; top: 3px; box-sizing: border-box; overflow: hidden;
  height: calc(var(--barra) + 1px + var(--faixa) + 2px); border: 1px solid var(--c-borda); border-radius: 8px;
  transition: --slot-gap 220ms cubic-bezier(.23, 1, .32, 1), height 200ms cubic-bezier(.23, 1, .32, 1), background-color 160ms ease-out, border-color 160ms ease-out, box-shadow 200ms ease-out; }
.cap-uso { position: absolute; left: 0; right: 0; top: 0; height: var(--barra); background: var(--c-trilho); transition: top 240ms cubic-bezier(.23, 1, .32, 1); }
.regua { position: absolute; left: 0; right: 0; top: calc(var(--barra) + 1px); height: var(--faixa);
  transition: top 240ms cubic-bezier(.23, 1, .32, 1), height 200ms cubic-bezier(.23, 1, .32, 1); }
/* O fio entre as faixas acompanha a troca; a agulha (z-index 1) o atravessa sem quebrar. */
.cap::after { content: ""; position: absolute; left: 0; right: 0; top: var(--barra); height: 1px; background: var(--c-fio-forte); transition: top 240ms cubic-bezier(.23, 1, .32, 1); }
.tempo-acima .cap-uso { top: calc(var(--faixa) + 1px); }
.tempo-acima .regua { top: 0; }
.tempo-acima .cap::after { top: var(--faixa); }
/* Só a faixa de tempo recebe cortes; consumo, contorno e agulha permanecem contínuos. */
.fundo-tempo {
  -webkit-mask-image: repeating-linear-gradient(to right, #000 0, #000 calc(100% / var(--slots) - var(--slot-gap)), transparent calc(100% / var(--slots) - var(--slot-gap)), transparent calc(100% / var(--slots)));
  mask-image: repeating-linear-gradient(to right, #000 0, #000 calc(100% / var(--slots) - var(--slot-gap)), transparent calc(100% / var(--slots) - var(--slot-gap)), transparent calc(100% / var(--slots)));
}
.cap-uso .fill { border-radius: 0 2px 2px 0; }
/* Sem tempo comprovado: só a barra de uso, com o contorno dela. */
.visual.sem-regua .cap { overflow: visible; height: auto; border: 0; }
.visual.sem-regua .cap::after { display: none; }
.visual.sem-regua .cap-uso { position: static; border: 1px solid var(--c-borda); border-radius: 3px; }
.visual.sem-regua .fill { border-radius: 2px; }
.fundo-tempo { position: absolute; inset: 0; background: var(--c-trilho); }
.regua[hidden] { display: none; }
.decorrido { position: absolute; left: 0; top: 0; bottom: 0; width: calc(var(--t, 0) * 1%); background: var(--c-decorrido); }
/* Os segmentos da régua, só no realce: 5 nas 5 horas e 7 na Semana. O elemento cobre 4/5 ou 6/7 da faixa e cada ladrilho acaba numa marca. */
.marcas { position: absolute; left: 0; top: 0; bottom: 0; width: 80%; opacity: 0; transition: opacity 160ms ease-out;
  background: linear-gradient(to right, transparent calc(100% - 1px), var(--c-marca) calc(100% - 1px)) left top / 25% 100% repeat-x; }
.weekly .marcas { width: calc(100% * 6 / 7); background-size: calc(100% / 6) 100%; }
/* Os dias nos cortes (só no realce): no centro de cada slot da faixa de tempo, o dia da semana ou a hora em que o corte começa.
   No corte da agulha o centro vem de cotas.js (--centro) e o rótulo some (.some) quando não há lugar. */
.dias { position: absolute; inset: 0; display: grid; grid-template-columns: repeat(var(--slots), 1fr); pointer-events: none; }
.corte { position: relative; min-width: 0; }
.corte-rotulo { position: absolute; left: var(--centro, 50%); top: 50%; transform: translate(-50%, -50%); font-size: 10px; line-height: 1; color: var(--c-tinta);
  font-variant-numeric: tabular-nums; white-space: nowrap; opacity: 0; transition: opacity 90ms ease-out; }
.realce .corte-rotulo { opacity: 1; transition: opacity 180ms ease-out 120ms; }
.corte.some .corte-rotulo { opacity: 0; }
.realce .corte.some .corte-rotulo { transition-delay: 0s; }
/* "Tempo" fica centralizado na faixa de tempo: embaixo do consumo por padrão, no topo quando a ordem troca (.tempo-acima). */
.tempo-nome { position: absolute; left: 0; top: calc(3px + var(--barra) + 1px + var(--faixa) / 2 - 7.5px); font-size: 12px; line-height: 15px; color: var(--tinta2);
  transition: top 240ms cubic-bezier(.23, 1, .32, 1); }
.tempo-acima .tempo-nome { top: calc(3px + var(--faixa) / 2 - 7.5px); }
.tempo-nome[hidden] { display: none; }
/* A agulha: fina em repouso, com um pulso de brilho de 2 s no começo de cada minuto (só opacidade e escala, sem escrever nada no DOM);
   no realce engrossa, enche a faixa e o pulso para. */
.agulha { position: absolute; z-index: 1; top: -2px; height: calc(100% + 4px); width: 1px; margin-left: -.5px; background: var(--c-agulha);
  left: clamp(1px, calc(var(--t, 0) * 1%), calc(100% - 1px)); transition: top 200ms cubic-bezier(.23, 1, .32, 1), height 200ms cubic-bezier(.23, 1, .32, 1), width 160ms ease-out, margin-left 160ms ease-out; }
.agulha::after { content: ""; position: absolute; left: -5px; right: -5px; top: -3px; bottom: -3px; opacity: 0; pointer-events: none;
  background: radial-gradient(closest-side, var(--c-pulso), transparent);
  animation: pulso 60s ease-out infinite; animation-delay: calc(var(--fase, 0) * -1s); }
@keyframes pulso { 0% { opacity: 0; transform: scale(.5); } 1.2% { opacity: 1; transform: scale(1.1); } 3.4% { opacity: 0; transform: scale(1.7); } 100% { opacity: 0; } }
/* O conector sai da agulha e atravessa só o intervalo entre a cápsula e a pílula. */
.conector { position: absolute; z-index: 2; left: var(--x); top: calc(3px + var(--cap-d)); width: 1px; height: 3px; background: var(--c-tinta);
  opacity: 0; visibility: hidden; transition: opacity 120ms ease-out, visibility 0s 120ms; }
/* A pílula do tempo decorrido fica abaixo da .cap: translúcida, com sombra suave. O centro acompanha a agulha; nas bordas, a meia
   largura aberta ou compacta preserva a folga interna da barra. */
.relogio { position: absolute; z-index: 3; left: clamp(calc(48px + var(--meia-pilula) + var(--folga-pilula)), var(--x), calc(100% - var(--meia-pilula) - var(--folga-pilula)));
  display: inline-flex; align-items: center; height: var(--pilula); padding: 0 8px;
  top: calc(3px + var(--cap-d) + 3px); border-radius: 999px; box-shadow: var(--sombra-sm);
  background: var(--c-pilula); -webkit-backdrop-filter: blur(8px) saturate(1.3); backdrop-filter: blur(8px) saturate(1.3); color: var(--c-tinta);
  font-size: 12px; line-height: 16px; font-variant-numeric: tabular-nums; white-space: nowrap; pointer-events: none;
  opacity: 0; visibility: hidden; transform: translate(-50%, -4px); transition: opacity 140ms ease-out, transform 200ms cubic-bezier(.23, 1, .32, 1), visibility 0s 140ms; }
/* "Decorrido" nasce inteiro. Depois de 1.300 ms, sua própria caixa encolhe pela esquerda; o fim da palavra permanece junto ao timer
   e o recorte impede que o texto passe por trás do número. */
@property --dissipacao-rotulo { syntax: "<length>"; inherits: false; initial-value: 0px; }
.r-rotulo { display: flex; justify-content: flex-end; max-width: 10ch; overflow: hidden; opacity: 1;
  -webkit-mask-image: linear-gradient(to right, transparent, #000 var(--dissipacao-rotulo), #000 calc(100% - var(--dissipacao-rotulo)), transparent);
  mask-image: linear-gradient(to right, transparent, #000 var(--dissipacao-rotulo), #000 calc(100% - var(--dissipacao-rotulo)), transparent); }
.r-rotulo > span { flex: none; width: max-content; white-space: pre; }
@keyframes recolher-rotulo {
  from { max-width: 10ch; opacity: 1; --dissipacao-rotulo: 0px; }
  60% { opacity: 1; }
  to { max-width: 0; opacity: 0; --dissipacao-rotulo: 6px; }
}
@keyframes desaparecer-rotulo {
  from { filter: blur(0); }
  25% { filter: blur(.2px); }
  50% { filter: blur(.8px); }
  75% { filter: blur(1.4px); }
  to { filter: blur(2px); }
}
@keyframes seguir-agulha {
  from { left: clamp(calc(48px + var(--meia-pilula) + var(--folga-pilula)), var(--x), calc(100% - var(--meia-pilula) - var(--folga-pilula))); }
  to { left: clamp(calc(48px + var(--meia-compacta) + var(--folga-pilula)), var(--x), calc(100% - var(--meia-compacta) - var(--folga-pilula))); }
}
/* Realce */
.realce .visual { --faixa: var(--faixa-d); height: calc(3px + var(--cap-d) + 3px + var(--pilula)); }
.realce .cap { --slot-gap: 0px; background: color-mix(in srgb, var(--c-sup) 72%, transparent);
  -webkit-backdrop-filter: blur(10px) saturate(1.25); backdrop-filter: blur(10px) saturate(1.25); border-color: var(--c-tinta); box-shadow: var(--sombra-md); }
.realce .marcas { opacity: 1; }
.realce .agulha { top: 0; height: 100%; width: 2px; margin-left: -1px; background: var(--c-tinta); }
.realce .agulha::after { animation: none; }
.realce .conector { opacity: 1; visibility: visible; transition-delay: 0s; }
.realce .relogio { opacity: 1; visibility: visible; transform: translateX(-50%); transition-delay: 0s;
  animation: seguir-agulha 520ms cubic-bezier(.25, .1, .25, 1) 1300ms forwards; }
.realce .r-rotulo { animation: recolher-rotulo 520ms cubic-bezier(.25, .1, .25, 1) 1300ms forwards; }
.realce .r-rotulo > span { animation: desaparecer-rotulo 520ms linear 1300ms forwards; }
/* O pontilhado em sete dias da barra do verso (a do card agora é a cápsula, com os cortes na faixa de tempo). */
.tip-meter.is-weekly::after { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: repeating-linear-gradient(90deg, transparent 0, transparent calc(100% / 7 - 1.5px), var(--c-sup, var(--sup)) calc(100% / 7 - 1.5px), var(--c-sup, var(--sup)) calc(100% / 7)); }
.quota .fill { display: block; height: 100%; width: 0; background: var(--accent); border-radius: inherit; }
/* A barra tem sempre a cor da ferramenta (a mesma do ponto ao lado do título), na de 5 h e na
   semanal. Nenhum estado troca a cor da barra (regra do dono do painel, 08/10): nem "acima do ritmo" (o âmbar se
   confundia com o laranja do Claude) nem "resta menos de 10%". Quem mostra o ritmo é a faixa de tempo
   da cápsula (e a ordem das faixas); o aviso de menos de 10% fica só no número, em vermelho, e no verso. */
.quota.is-critical .used { color: var(--critico-tinta); }
.quota.is-missing .cap-uso { background: var(--c-trilho); opacity: .6; }
.quota.is-missing .reopens { display: none; }
.quota.is-missing .used { font-size: 12px; font-weight: 500; letter-spacing: 0; color: var(--c-apagado); }
.quota-hit { position: absolute; inset: 0; padding: 0; border: 0; background: transparent; cursor: pointer; width: 100%; border-radius: 4px; }
.quota-hit:focus-visible { outline: 2px solid var(--foco); outline-offset: 5px; }
.card-status { margin: 10px 0 0; font-size: 11px; color: var(--c-apagado); font-variant-numeric: tabular-nums; display: flex; align-items: center; gap: 8px; min-height: 14px; }
.card-status[hidden] { display: none; }
/* Três pontos numa órbita vista de lado: na frente, maiores e cheios; atrás, menores e apagados. */
.orbita { position: relative; width: 20px; height: 12px; flex: none; }
.orbita[hidden] { display: none; }
.orbita i { position: absolute; left: 50%; top: 50%; width: 4px; height: 4px; margin: -2px 0 0 -2px; border-radius: 50%; background: var(--c-apagado);
  animation: orbita 3.6s linear infinite; }
.orbita i:nth-child(2) { animation-delay: -1.2s; }
.orbita i:nth-child(3) { animation-delay: -2.4s; }
@keyframes orbita {
  0% { transform: translate(8px, 0) scale(.85); opacity: .7; }
  25% { transform: translate(0, 3.5px) scale(1.15); opacity: 1; }
  50% { transform: translate(-8px, 0) scale(.85); opacity: .7; }
  75% { transform: translate(0, -3.5px) scale(.6); opacity: .35; }
  100% { transform: translate(8px, 0) scale(.85); opacity: .7; }
}
.query-ring { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity 200ms ease-out; }
.query-ring > span { position: absolute; inset: 0; animation: consultando 1.6s ease-in-out infinite; animation-play-state: paused; }
.query-ring svg { width: 100%; height: 100%; overflow: visible; fill: none; stroke: var(--c-apagado); stroke-width: 1; }
.card[aria-busy="true"] .query-ring { opacity: 1; }
.card[aria-busy="true"] .query-ring > span { animation-play-state: running; }
@keyframes consultando { 0%, 100% { opacity: .18; } 50% { opacity: .55; } }

.verso-cabeca { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex: none; }
.verso-cabeca .card-eyebrow { margin: 0 0 2px; }
.verso-cabeca .identity { flex: 1; min-width: 0; }
.verso-titulo { margin: 0; font-size: 15px; font-weight: 650; letter-spacing: -.2px; line-height: 1.25; display: flex; align-items: center; gap: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.verso-titulo::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: var(--accent); flex: none; }
.voltar { flex: none; font: inherit; font-size: 11px; color: var(--tinta2); background: var(--c-etiqueta); border: 1px solid var(--c-fio); border-radius: 999px; padding: 3px 10px; cursor: pointer; }
.voltar:hover { color: var(--c-tinta); border-color: var(--c-fio-forte); }
.voltar:focus-visible { outline: 2px solid var(--foco); outline-offset: 2px; }
.card-verso h3 { margin: 0; font-size: 11px; font-weight: 650; color: var(--apagado); letter-spacing: .7px; display: block; }
.card-verso footer { margin-top: auto; font-size: 10.5px; line-height: 1.35; }
.card-verso .tip-main .tip-window-heading { display: none; }   /* o título do verso já diz a janela */
.card-verso .tip-main .tip-time { margin-top: 2px; }
.card-verso .tip-main .tip-time strong { font-size: 24px; }
.card-verso .tip-main .tip-meter { margin: 8px 0; }
.card-verso .tip-main .tip-quota { margin-top: 6px; }
.card-verso .tip-main + .tip-window { margin-top: 6px; padding-top: 6px; }
.tip-window-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.tip-reset { font-size: 11px; color: var(--apagado); font-variant-numeric: tabular-nums; }
.tip-time { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-top: 8px; font-size: 11px; color: var(--apagado); }
.tip-time strong { font-variant-numeric: tabular-nums; font-weight: 590; color: var(--tinta); }
.tip-main .tip-time { display: grid; grid-template-columns: 1fr auto; margin-top: 12px; }
.tip-main .tip-time > span:first-child { grid-column: 1 / -1; }
.tip-main .tip-time strong { font-size: 26px; line-height: 1.2; font-weight: 680; letter-spacing: -.8px; }
.tip-main .tip-window-heading .tip-reset { display: none; }
.tip-main .tip-time .tip-reset { display: block; align-self: end; padding-bottom: 5px; letter-spacing: 0; }
.tip-meter { position: relative; height: 5px; background: var(--sup2); border-radius: 999px; margin: 10px 0; overflow: hidden; }
.tip-meter.is-weekly { overflow: visible; }
.tip-fill { display: block; height: 100%; background: var(--accent, var(--barra)); border-radius: inherit; }
.tip-cursor { position: absolute; top: -3px; height: 11px; width: 1px; background: var(--tinta); transform: translateX(-50%); }
.tip-cursor[hidden] { display: none; }
.card-verso dl { margin: 0; font-variant-numeric: tabular-nums; }
.card-verso dl > div { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
.card-verso dt { color: var(--apagado); }
.card-verso dd { margin: 0; text-align: right; }
.card-verso dl[hidden] { display: none; }
.tip-main .tip-quota { margin-top: 12px; }
.tip-main dd { font-weight: 650; }
.tip-window { font-size: 11px; line-height: 14px; }
.tip-window[hidden] { display: none; }
.tip-window .tip-window-heading { flex-wrap: nowrap; }
.tip-reset-row { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.tip-duration { font-weight: 590; }
.tip-duration::after { content: " ·"; font-weight: 400; color: var(--apagado); }
.tip-compact-usage { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
.tip-compact-usage .tip-meter { flex: 1; min-width: 40px; margin: 0; }
.tip-summary { white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--apagado); }
.tip-pace { font-size: 11px; padding-top: 6px; }
.tip-main + .tip-window, .card-verso footer { border-top: 1px solid var(--fio); margin-top: 8px; padding-top: 8px; }
.card-verso footer { color: var(--apagado); font-size: 11px; }
.card-verso footer p { margin: 0 0 6px; }
.card-verso footer p[hidden] { display: none; }
.tip-error { margin-bottom: 6px; }
.tip-error dd { color: var(--critico-tinta); }
.tip-observation { display: flex; justify-content: space-between; gap: 12px; font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) {
  .query-ring > span { animation: none; opacity: .25; }
  .orbita i { animation: none; }
  .orbita i:nth-child(1) { transform: translate(8px, 0); } .orbita i:nth-child(2) { transform: translate(0, 3.5px); } .orbita i:nth-child(3) { transform: translate(-8px, 0); opacity: .6; }
  .lift-layer { transform: none; transition: opacity 120ms ease-out; }
  .card { transform: none !important; transition: none !important; }
  .card-spotlight { display: none; }
  .card-cena.pop { animation: none; }
  .card .bloco, .card-verso .bloco { transition: opacity 120ms ease-out; transform: none !important; }
  .visual, .cap, .cap-uso, .regua, .cap::after, .tempo-nome, .agulha, .marcas, .conector, .relogio, .r-rotulo { transition: opacity 120ms ease-out, background-color 120ms ease-out, border-color 120ms ease-out; }
  .agulha::after { animation: none; }
  .realce .relogio { animation: none; left: clamp(calc(48px + var(--meia-compacta) + var(--folga-pilula)), var(--x), calc(100% - var(--meia-compacta) - var(--folga-pilula))); }
  .realce .r-rotulo, .realce .r-rotulo > span { animation: none; }
  .realce .r-rotulo { max-width: 0; opacity: 0; }
}
`;
var folha = document.createElement("style");
folha.textContent = ESTILO;
document.head.appendChild(folha);

/* ---------- utilidades ---------- */
var NUMERO = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
var FORMATO_DATA = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
var INTERVALO_PADRAO = { claude: 300, codex: 300, agy: 1200 };
var NOME_DA_ORIGEM = { cli: "consulta à CLI", tela: "status line", sonda: "sonda de cota" };
var COMO_SOUBE = { trabalhando: "o terminal estava trabalhando", mudou: "os números da tela mudaram", hora_na_tela: "pela hora escrita na tela; aproximada" };

function numero(v) { return typeof v === "number" && isFinite(v); }
function pct(v) { return numero(v) ? NUMERO.format(v) + "%" : "sem dados"; }
function texto(no, t) { if (no.textContent !== t) no.textContent = t; }
function oculto(no, sim) { if (no.hidden !== sim) no.hidden = sim; }
function atributo(no, nome, valor) { if (no.getAttribute(nome) !== valor) no.setAttribute(nome, valor); }
function variavel(no, nome, valor) { if (no.style.getPropertyValue(nome) !== valor) no.style.setProperty(nome, valor); }
function reduzido() { return matchMedia("(prefers-reduced-motion: reduce)").matches; }
function capitalizar(p) { return p ? p.charAt(0).toUpperCase() + p.slice(1) : p; }

/* O cursor "agora" vem do relógio da máquina: (agora − início da janela) / duração. O alerta é
   usado > cursor + 5 pontos, ou usado > 90%. Sem hora de renovar, não inventa posição. */
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
function dataDoReset(epoch) {
  if (!numero(epoch)) return "sem dados";
  var p = {};
  FORMATO_DATA.formatToParts(new Date(epoch * 1000)).forEach(function (x) { p[x.type] = x.value; });
  return (p.weekday || "").replace(".", "") + " " + p.day + "/" + p.month + " " + p.hour + ":" + p.minute;
}
function reabre(b, agoraS) {
  if (!b || !numero(b.renova_epoch)) return "reabertura sem dados";
  var d = duracao(b.renova_epoch - agoraS);
  return d === "a confirmar" ? "reabertura a confirmar" : "reabre em " + d;
}
function modeloLegivel(ferramenta, modelo) {
  if (!modelo) return "";
  if (ferramenta === "codex" && /^gpt-\d+(?:\.\d+)*(?:-[a-z]+)*$/.test(modelo)) {
    return "GPT " + modelo.slice(4).split("-").map(capitalizar).join(" ");
  }
  var c = ferramenta === "claude" && /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(modelo);
  if (c) return capitalizar(c[1]) + " " + c[2] + "." + c[3];
  if (ferramenta === "agy") return String(modelo).replace(/\s*\([^)]*\)\s*$/, "");   /* "Gemini 3.8 Flash (High)" -> "Gemini 3.8 Flash" */
  return modelo;
}
function idade(segundos) {
  var m = Math.floor(Math.max(0, segundos) / 60);
  if (m < 60) return "há " + m + " min";
  var h = Math.floor(m / 60);
  if (h < 48) return "há " + h + " h";
  return "há " + Math.floor(h / 24) + " dias";
}

/* ---------- só os dígitos que mudaram animam ---------- */
/* Chaves estáveis por casa (unidade, dezena, decimal) deixam uma transição em curso ser redirecionada. */
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
        if (m.mudou) void entrando.offsetWidth;    /* fixa a posição inicial antes da transição */
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
/* Cada card cuida de si: entrou, acompanha; saiu, descansa. Não há "card ativo" único nem área
   congelada (a versão anterior parava sobre as barras e, depois de uma virada, só voltava a reagir
   quando o ponteiro saía e entrava de novo). A inclinação vale para a pilha inteira, frente e verso. */
var TILT = { angulo: 6, escala: 1.02, perspectiva: 1200, duracao: 200 };   /* a intensidade do brilho está no CSS (--brilho, --grao) */
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
    t.alvo.style.setProperty("--angulo", String(Math.round(Apoio.intensidadeDoAngulo(xRot, yRot, TILT.angulo) * 1000) / 1000));
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
    t.alvo.style.removeProperty("--angulo");
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
  return { ligar: ligar, descansar: function (slot) { var t = porSlot.get(slot); if (t) descansar(t); } };
})();

/* ---------- privacidade: o miolo do e-mail vira bloco pixelado ---------- */
var TRANSLUCIDEZ = 0.82;
var privado = true;
try { privado = localStorage.getItem("painel-privacidade") !== "0"; } catch (e) { /* sem armazenamento: fica ligada */ }
function mascarar(t) { return privado ? Apoio.mascararEmails(t) : t; }
/* Pixels sólidos, sem suavização: cada célula é um quadrado de lado ~fonte/3, a altura é a das maiúsculas e o fundo do bloco assenta
   na linha de base, então ele cabe na linha do texto. A largura é a de "n" repetido, medida na própria fonte. Os pixels são sorteados,
   nunca derivados do e-mail. */
function blocoPixelado(estilo, quantidade) {
  var tamanho = parseFloat(estilo.fontSize) || 11, lado = Math.max(2, Math.round(tamanho / 3));
  var medida = document.createElement("canvas").getContext("2d");
  medida.font = estilo.fontStyle + " " + estilo.fontWeight + " " + tamanho + "px " + estilo.fontFamily;
  var colunas = Math.max(2, Math.round(medida.measureText(new Array(quantidade + 1).join("n")).width / lado));
  var linhas = Math.max(2, Math.round(tamanho * 0.72 / lado));
  /* A tira de quadros (um por ângulo de inclinação, o do meio é o repouso) lado a lado num só canvas. */
  var quadros = Apoio.QUADROS, tira = Apoio.tiraDePixels(colunas, linhas, quadros, Math.random);
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
  /* Imagem de fundo, não <canvas>: o canvas ganha camada própria e podia esmaecer e se mover fora de sincronia com o texto ao lado.
     O CSS escolhe dois quadros da tira pelo ângulo do card (--angulo, de -1 a 1). */
  var no = document.createElement("span");
  no.className = "email-pixelado";
  no.setAttribute("aria-hidden", "true");
  no.style.width = colunas * lado + "px"; no.style.height = linhas * lado + "px";
  no.style.setProperty("--tira", "url(" + canvas.toDataURL() + ")");
  no.style.setProperty("--quadros", String(quadros));
  return no;
}
/* Escreve um texto que pode ter um e-mail: com a privacidade ligada, o miolo do e-mail vira a tarja. Só reescreve quando algo muda
   (texto, privacidade ou a cor e a fonte em que o bloco é desenhado). */
function escreverComEmail(no, t) {
  var partes = Apoio.separarEmail(t), estilo = privado && partes.email ? getComputedStyle(no) : null;
  var assinatura = [privado, t, estilo && estilo.color, estilo && estilo.fontSize, estilo && estilo.fontFamily, estilo && estilo.fontWeight].join("|");
  if (no._assinatura === assinatura) return;
  no._assinatura = assinatura;
  no.textContent = "";
  if (!estilo) { no.appendChild(document.createTextNode(t)); return; }
  var p = Apoio.partesDoEmail(partes.email);
  no.appendChild(document.createTextNode(partes.antes + p.antes));
  no.appendChild(blocoPixelado(estilo, p.ocultos));
  no.appendChild(document.createTextNode(p.depois + partes.depois));
}
/* O título (no Antigravity pode ser o e-mail) e a linha da conta. A dica nativa nunca devolve o e-mail com a privacidade ligada. */
function identidade(card) {
  var c = card.conta, titulo = c.titulo || c.ferramenta_nome || "conta";
  escreverComEmail(card.titulo, titulo);
  atributo(card.tituloNo, "title", mascarar(c.titulo || ""));
  var rotulo = c.email ? c.email + (c.plano ? " · " + c.plano : "") : "conta não identificada";
  escreverComEmail(card.rotuloConta, rotulo);
  if (privado) card.rotuloConta.removeAttribute("title"); else atributo(card.rotuloConta, "title", rotulo);
}
var botaoPrivacidade = document.getElementById("privacidade");
function aplicarPrivacidade() {
  if (botaoPrivacidade) texto(botaoPrivacidade, "Privacidade: " + (privado ? "ligada" : "desligada"));
  Object.keys(cards).forEach(function (id) { identidade(cards[id]); });
}
if (botaoPrivacidade) botaoPrivacidade.addEventListener("click", function () {
  privado = !privado;
  try { localStorage.setItem("painel-privacidade", privado ? "1" : "0"); } catch (e) { /* vale só nesta sessão */ }
  aplicarPrivacidade();
});
/* O bloco é desenhado na cor do texto: trocar o tema (pelo botão ou pelo sistema) pede um desenho novo. */
new MutationObserver(aplicarPrivacidade).observe(document.documentElement, { attributes: true, attributeFilter: ["data-tema"] });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", aplicarPrivacidade);

/* ---------- barras, verso e cards ---------- */
var cards = {};             /* id da conta -> card */
var focoPorTeclado = true;
/* Clique de verdade: o ponteiro não andou mais de 5 px desde o pointerdown (arrasto para selecionar
   texto não vira o card). Não olha a seleção da página: um trecho selecionado noutro canto bloqueava tudo. */
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
function origemDaBarra(b) {
  if (!b || !b.origem) return "";
  if (b.origem === "cli") return "consulta à CLI (" + (b.fonte || "") + "), sem token";
  if (b.origem === "sonda") return "sonda de cota no terminal " + (b.fonte || "");
  return "status line de " + (b.fonte || "") + (COMO_SOUBE[b.evidencia] ? " (" + COMO_SOUBE[b.evidencia] + ")" : "");
}
/* O verso mostra a janela da barra clicada (com segundos no tempo) e, embaixo, a outra janela do
   mesmo grupo, quem divide a conta, de onde veio o número e a última falha de consulta. */
function encherVerso(card, agoraS) {
  var barra = card.barraVirada, v = card.verso;
  if (!barra) return;
  var b = barra.dados || {}, conta = card.conta;
  texto(v.eyebrow, mascarar((conta.titulo || "") + (b.membros && b.membros.length ? " · " + b.membros.join(", ") : "")));
  texto(v.titulo, b.rotulo || "");
  encherJanela(v.principal, b, agoraS, true);
  var outra = null;
  card.barras.forEach(function (x) { if (x !== barra && x.dados && x.dados.grupo === b.grupo) outra = x.dados; });
  oculto(v.outra.no, !outra);
  var ritmoOutra = outra ? encherJanela(v.outra, outra, agoraS, false) : "";
  oculto(v.ritmoOutra, !ritmoOutra);
  if (ritmoOutra) { texto(v.ritmoOutra.querySelector("dt"), (outra ? outra.rotulo : "") + " · Ritmo"); texto(v.ritmoOutra.querySelector("dd"), ritmoOutra); }
  var explicacao = "";
  if (conta.keychain_limitado && b.origem !== "cli") explicacao = "A CLI do Antigravity só consulta a conta ativa no Keychain: este número é o da tela.";
  else if (b.origem && b.origem !== "cli") explicacao = "A CLI ainda não trouxe esta janela: vale a leitura da " + NOME_DA_ORIGEM[b.origem] + ".";
  texto(v.explicacao, explicacao); oculto(v.explicacao, !explicacao);
  var erro = conta.erro ? mascarar(conta.erro_detalhe || "falhou") : "";
  texto(v.erro, erro); oculto(v.erroLinha, !erro);
  texto(v.observacao, numero(b.lido_em_epoch) ? idade(agoraS - b.lido_em_epoch) + (b.origem ? " · " + origemDaBarra(b) : "") : "sem observação");
}
var SAIDA_DO_VERSO = 220;   /* ms: a saída dos blocos do verso ao voltar, com o escalonamento */
var GIROS = [-0.8, -0.55, -0.35, 0.35, 0.55, 0.8];   /* graus do giro no plano, sorteados; sinal = horário ou anti-horário (08/10: reduzido três vezes) */
var ultimoGiro = null;
function pop(card) {
  if (reduzido()) return;
  var giro;
  do { giro = GIROS[Math.floor(Math.random() * GIROS.length)]; } while (giro === ultimoGiro && GIROS.length > 1);
  ultimoGiro = giro;
  card.cena.style.setProperty("--giro", giro + "deg");
  card.cena.classList.remove("pop");
  void card.cena.offsetWidth;       /* reinicia a animação mesmo em cliques seguidos */
  card.cena.classList.add("pop");
}
function virar(card, barra) {
  if (card.barraVirada === barra) return;
  var jaVirado = !!card.barraVirada;
  card.barras.forEach(function (x) { clearTimeout(x.timerMouse); x.mouse = x.foco = false; realcar(x); });
  card.barraVirada = barra;
  card.barras.forEach(function (x) { atributo(x.alvo, "aria-expanded", x === barra ? "true" : "false"); });
  encherVerso(card, Date.now() / 1000);
  if (jaVirado) return;        /* só troca o conteúdo do verso */
  clearTimeout(card.timerDoGiro);
  card.slot.classList.add("virado");
  card.cena.classList.add("mostra-verso");
  void card.cena.offsetWidth;       /* o verso nasce visível na posição de espera; o quadro seguinte faz a transição */
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

/* ---------- a cápsula: realce da faixa de tempo ---------- */
/* O realce espera a intenção do mouse (300 ms para abrir, 100 ms de tolerância ao sair); o foco do teclado é imediato. O toque não
   tem realce próprio: tocar vira o card, e o verso traz o tempo até reabrir. O relógio da pílula só escreve enquanto há realce. */
function realcar(barra) {
  var pode = !barra.no.hidden && !barra.regua.hidden;
  if (!pode) barra.mouse = barra.foco = false;
  var ativa = barra.mouse || barra.foco;
  if (barra.ativa === ativa) return;
  barra.ativa = ativa;
  barra.no.classList.toggle("realce", ativa);
  escreverRelogio(barra, Date.now() / 1000);
}
function escreverRelogio(barra, agoraS) {
  var b = barra.dados;
  texto(barra.timer, b ? Apoio.timerDaPilula(barra.ativa, !barra.regua.hidden, agoraS, b.renova_epoch, b.janela_min) : "");
}
function encerrarRealces() {
  Object.keys(cards).forEach(function (id) { cards[id].barras.forEach(function (b) {
    clearTimeout(b.timerMouse); b.timerMouse = null; b.mouse = b.foco = false; realcar(b);
  }); });
}
function ligarRealce(barra) {
  function agendarMouse(entrada) {
    clearTimeout(barra.timerMouse);
    barra.timerMouse = setTimeout(function () { barra.mouse = entrada; barra.timerMouse = null; realcar(barra); }, Apoio.atrasoDoRealce(entrada));
  }
  barra.visual.addEventListener("pointerenter", function (ev) { if (ev.pointerType !== "touch") agendarMouse(true); });
  barra.visual.addEventListener("pointerleave", function (ev) { if (ev.pointerType !== "touch") agendarMouse(false); });
  barra.alvo.addEventListener("focus", function () { clearTimeout(barra.timerMouse); barra.foco = barra.alvo.matches(":focus-visible"); realcar(barra); });
  barra.alvo.addEventListener("blur", function () { barra.foco = false; realcar(barra); });
}
/* O pulso da agulha cai no começo de cada minuto: a fase vem dos segundos do minuto, escrita uma vez. */
document.documentElement.style.setProperty("--fase", String(Apoio.fasePulso(Date.now() / 1000)));
/* Os rótulos dos cortes da faixa de tempo (um por slot da cápsula): o dia da semana ou a hora em que cada corte começa. São
   decorativos (o mesmo dado está no verso) e o texto só é escrito quando o período muda. */
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
    var lista = Apoio.cortes(b);
    barra.cortes.forEach(function (c, i) { texto(c.rotulo, lista[i] ? lista[i].rotulo : ""); });
  }
  var n = barra.cortes.length, atual = Apoio.corteAtual(tempo, n);
  if (barra.corteAtual !== atual) {
    var antigo = barra.cortes[barra.corteAtual];
    if (antigo) { antigo.no.classList.remove("some"); antigo.no.style.removeProperty("--centro"); }
    barra.corteAtual = atual; barra.medida = null;
  }
  if (barra.cortes[atual]) posicionarRotulo(barra, tempo / 100 * n - atual);
}
/* Os rótulos ficam no centro do corte. No corte da agulha, ele passa para o centro do lado maior do corte (a agulha nunca cruza as
   letras) e some enquanto nenhum dos lados comporta o texto. A medida (largura do corte e do texto) é lida uma vez por texto e por
   tamanho de janela, nunca por tique; o centro é escrito em passos de 1% do corte. */
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

var criadas = 0;
function criarBarra(card, chave, tipo) {
  var no = document.createElement("div");
  no.className = "quota bloco " + (tipo === "semana" ? "weekly" : "primary");
  no.innerHTML = '<div class="quota-heading"><span class="quota-label"></span><span class="used"></span><span class="reopens"></span></div>' +
    '<div class="visual"><span class="tempo-nome" hidden>Tempo</span><div class="cap"><div class="cap-uso"><span class="fill"></span></div>' +
    '<div class="regua" hidden><span class="fundo-tempo" aria-hidden="true"><span class="decorrido"></span></span><span class="marcas" aria-hidden="true"></span>' + HTML_DIAS[tipo] + '<span class="agulha" aria-hidden="true"></span></div></div>' +
    '<span class="conector" aria-hidden="true"></span><div class="relogio" aria-hidden="true"><span class="r-rotulo"><span>Decorrido </span></span><span class="r-timer"></span></div></div>' +
    '<button class="quota-hit" type="button" aria-expanded="false"></button>';
  var barra = { card: card, chave: chave, tipo: tipo, no: no, dados: null, visual: no.querySelector(".visual"),
    cheio: no.querySelector(".fill"), regua: no.querySelector(".regua"), nomeTempo: no.querySelector(".tempo-nome"), timer: no.querySelector(".r-timer"),
    rotulo: no.querySelector(".quota-label"), usado: no.querySelector(".used"), reabre: no.querySelector(".reopens"), alvo: no.querySelector(".quota-hit"),
    mouse: false, foco: false, ativa: false, timerMouse: null,
    cortes: Array.prototype.map.call(no.querySelectorAll(".corte"), function (c) { return { no: c, rotulo: c.querySelector(".corte-rotulo") }; }),
    chaveCortes: null, corteAtual: -1, medida: null };
  barra.alvo.setAttribute("aria-controls", card.verso.no.id);
  ligarRealce(barra);
  return barra;
}
function removerBarra(barra) {
  clearTimeout(barra.timerMouse);
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
  rodape.innerHTML = '<dl class="tip-pace tip-ritmo-outra" hidden><div><dt></dt><dd></dd></div></dl><p class="tip-explanation" hidden></p>' +
    '<dl class="tip-error" hidden><div><dt>Última consulta não concluída</dt><dd></dd></div></dl><div class="tip-observation"><span>Observação</span><span></span></div>';
  var corpo = document.createElement("div");
  corpo.className = "verso-corpo";
  corpo.appendChild(principal.no); corpo.appendChild(outra.no); corpo.appendChild(rodape);
  no.appendChild(corpo);
  return { no: no, eyebrow: no.querySelector(".card-eyebrow"), titulo: no.querySelector(".verso-titulo"), voltar: no.querySelector(".voltar"),
           principal: principal, outra: outra, ritmoOutra: rodape.querySelector(".tip-ritmo-outra"), explicacao: rodape.querySelector(".tip-explanation"),
           erroLinha: rodape.querySelector(".tip-error"), erro: rodape.querySelector(".tip-error dd"), observacao: rodape.querySelector(".tip-observation span:last-child") };
}
function criarCard(conta) {
  var no = document.createElement("article");
  no.className = "card";
  no.innerHTML = '<svg class="card-surface" aria-hidden="true" focusable="false"><path></path></svg>' +
    '<span class="query-ring" aria-hidden="true"><span><svg focusable="false"><path></path></svg></span></span><span class="card-spotlight" aria-hidden="true"></span>' +
    '<header class="card-header bloco" style="--i:0"><div class="identity"><p class="card-eyebrow"></p><h3 class="card-title"><span class="title-text"></span></h3>' +
    '<p class="account-label"></p><p class="quem-usa"></p></div><span class="model-tag" hidden></span></header>' +
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
               tituloNo: no.querySelector(".card-title"), rotuloConta: no.querySelector(".account-label"), quemUsa: no.querySelector(".quem-usa"),
               etiqueta: no.querySelector(".model-tag") };
  cena.addEventListener("animationend", function (ev) { if (ev.target === cena) cena.classList.remove("pop"); });
  /* Clique em qualquer ponto da frente vira o card; numa barra, o verso mostra aquela janela;
     fora delas, a primeira. Selecionar texto para copiar não vira. */
  no.addEventListener("click", function (ev) {
    if (card.barraVirada || arrastou(ev)) return;
    var alvo = ev.target.closest ? ev.target.closest(".quota") : null, barra = null;
    card.barras.forEach(function (b) { if (b.no === alvo) barra = b; });
    barra = barra || card.barras[0];
    if (barra) virar(card, barra);
  });
  verso.voltar.addEventListener("click", function (ev) { ev.stopPropagation(); desvirar(card, true); });
  /* Clique em qualquer ponto do verso desvira; selecionar texto para copiar não conta. */
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
  var aviso = secao.querySelector(".aviso-contas"), legenda = secao.querySelector(".contas-legenda"), conta = document.getElementById("contas-conta");
  contas = contas || { consultadas: false, lista: [] };
  var lista = Array.isArray(contas.lista) ? contas.lista : [];
  var json = JSON.stringify(contas);
  if (json !== ultimoJson) {
    ultimoJson = json;
    if (conta) { texto(conta, String(lista.length)); conta.classList.toggle("zero", !lista.length); }
    var presentes = {};
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
      identidade(card);
      var quem = (c.agentes && c.agentes.length ? c.agentes : c.terminais || []).join(" · ");
      texto(card.quemUsa, quem); atributo(card.quemUsa, "title", quem);
      var modelo = modeloLegivel(c.ferramenta, c.modelo), etiqueta = modelo ? [modelo, c.esforco ? capitalizar(c.esforco) : ""].filter(Boolean).join(" · ") : "";
      oculto(card.etiqueta, !etiqueta); texto(card.etiqueta, etiqueta); atributo(card.etiqueta, "title", etiqueta ? "Modelo da sessão mais recente desta conta: " + etiqueta : "");
      sincronizarBarras(card, Array.isArray(c.barras) ? c.barras : []);
    });
    Object.keys(cards).forEach(function (id) { if (!presentes[id]) { removerCard(cards[id]); delete cards[id]; } });
    var mensagem = "";
    if (!contas.consultadas) mensagem = "A consulta às CLIs está desligada (coletor --sem-contas): as cotas vêm só das status lines.";
    else if (!lista.length) mensagem = "Nenhuma conta em execução nos terminais do tmux.";
    if (contas.erro) mensagem = '<span class="erro">▲ ' + String(contas.erro).replace(/[&<>]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]; }) + "</span>" + (mensagem ? " " + mensagem : "");
    if (aviso) { if (aviso.innerHTML !== mensagem) aviso.innerHTML = mensagem; oculto(aviso, !mensagem); }
    if (legenda) oculto(legenda, !lista.length);
  }
  tique(agoraS);
}
function tique(agoraS) {
  agoraS = agoraS || Date.now() / 1000;
  Object.keys(cards).forEach(function (id) {
    var card = cards[id], c = card.conta;
    var observado = null;
    card.barras.forEach(function (b) { if (b.dados && numero(b.dados.lido_em_epoch) && (observado === null || b.dados.lido_em_epoch > observado)) observado = b.dados.lido_em_epoch; });
    /* Inativo: a leitura mais nova passou de duas consultas sem renovar (10 min no Claude e no Codex,
       40 no Antigravity; 5 h para número vindo da tela). Carência de propósito: um atraso de uma
       consulta não vira aviso. Sem cor no card: só a órbita e o texto no pé. */
    var daCli = card.barras.some(function (b) { return b.dados && b.dados.origem === "cli"; });
    var limite = daCli ? 2 * (c.intervalo_s || INTERVALO_PADRAO[c.ferramenta] || 300) : 5 * 3600;
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
      /* A faixa de tempo só existe com o período comprovado e em curso; senão fica só a barra de uso. */
      var comTempo = t.cursor !== null && !t.vencida;
      oculto(barra.regua, !comTempo);
      oculto(barra.nomeTempo, !comTempo);
      barra.visual.classList.toggle("sem-regua", !comTempo);
      barra.visual.classList.toggle("tempo-acima", comTempo && temUso && Apoio.tempoAcima(t.cursor, b.usado_pct));
      if (comTempo) { variavel(barra.visual, "--t", String(Math.round(t.cursor * 10) / 10)); escreverCortes(barra, b, t.cursor); }
      realcar(barra); escreverRelogio(barra, agoraS);
      atributo(barra.alvo, "aria-label", (b ? b.rotulo : "") + ": " + pct(temUso ? b.usado_pct : null) + " usado. " +
        (barra.tipo === "5h" ? barra.reabre.textContent : "Reset " + dataDoReset(b && b.renova_epoch)) + "." + (comTempo ? " " + Math.round(t.cursor) + "% do período decorrido." : "") +
        (t.alerta ? " Consumo em alerta." : "") + " Clique para ver o detalhe.");
    });
    if (card.barraVirada) encherVerso(card, agoraS);
  });
}

document.addEventListener("pointerdown", function () { focoPorTeclado = false; });
document.addEventListener("keydown", function (ev) { focoPorTeclado = true; if (ev.key === "Escape") { encerrarRealces(); desvirarTodos(); } });
setInterval(function () { tique(); }, 250);


aplicarPrivacidade();
window.__painelContas = { desenhar: desenhar };
})();
