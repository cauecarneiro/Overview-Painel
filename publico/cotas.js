/* Cards de cota por conta: a tela do dashboard de cotas de fbtostadev (cotas/static/, MIT), adaptada ao
   painel dos Vingadores. Em vez de fetch num backend, lê o bloco "contas" do dados.js (a página abre
   por file://); em vez de ES modules, um script comum. Fora isso, é o mesmo card: barra grossa da
   janela de 5 h e fina da semanal, cursor "agora" pelo relógio da máquina, só os dígitos que mudam
   animam, cantos squircle por SVG, tilt em 3D e anel pulsando enquanto a CLI consulta. O detalhe
   de uma janela não abre em popover (pedido do dono do painel, 08/10/2026): o clique na barra troca a frente
   do card pelo verso, que mostra tempo até reabrir, reset, usada e livre, a outra janela e a origem.
   A troca não vira o card em 3D (segundo pedido, 08/10): o card dá um "pop" curto, escala com leve
   overshoot e um giro de poucos graus no plano, horário ou anti-horário, sorteado de uma lista, que
   volta em mola; os blocos de texto saltam de leve (terceiro pedido, 08/10): o que sai encolhe e
   some, o que entra sobe um pouco e assenta com uma mola curta, quase todos ao mesmo tempo, sem
   cascata longa. Clique no verso, "Voltar" ou Esc voltam à frente. Tudo dentro desta função; só
   window.__painelContas é global. */
(function () {
"use strict";
if (!window.ResizeObserver || !window.WeakMap || !window.Intl) return;

var ESTILO = `
#contas { --c-sup: var(--sup); --c-tinta: var(--tinta); --c-apagado: var(--apagado); --c-trilho: var(--sup2);
          --c-cheio: var(--barra); --c-alerta: #b86a24; --c-critico: var(--critico); --c-fio: var(--fio); --c-fio-forte: var(--fio-forte);
          --c-etiqueta: var(--sup2); }
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
.quota { position: relative; --bar-height: 10px; }
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
.weekly { --bar-height: 5px; }
.weekly .quota-label, .weekly .used { font-size: 12px; font-weight: 570; letter-spacing: 0; }
.quota .track { width: 100%; height: 10px; background: var(--c-trilho); border-radius: 999px; position: relative; box-shadow: inset 0 0 0 1px rgba(127,127,127,.12); }
.weekly .track { height: 5px; }
/* A semanal em sete dias: seis cortes finos na barra, na cor do card, dividem a janela em segmentos
   iguais. Com o cursor "agora", dá para ver de relance se o gasto está adiantado ou atrasado. */
/* Ao passar o mouse num gomo da semanal: realce leve no gomo e, ao lado do percentual, o dia dele. */
.dia-do-gomo { font-size: 11px; color: var(--c-apagado); white-space: nowrap; opacity: 0; transition: opacity 120ms ease-out; }
.dia-do-gomo.visivel { opacity: 1; }
.gomo-realce { position: absolute; top: -3px; bottom: -3px; left: calc(var(--gomo, 0) * 100% / 7); width: calc(100% / 7); border-radius: 2px;
  background: color-mix(in srgb, var(--c-tinta) 18%, transparent); pointer-events: none; opacity: 0; transition: opacity 120ms ease-out; }
.gomo-realce.visivel { opacity: 1; }
.weekly .track::after, .tip-meter.is-weekly::after { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: repeating-linear-gradient(90deg, transparent 0, transparent calc(100% / 7 - 1.5px), var(--c-sup, var(--sup)) calc(100% / 7 - 1.5px), var(--c-sup, var(--sup)) calc(100% / 7)); }
.weekly .track::after { background-size: calc(100% + 1.5px) 100%; }
.quota .fill { display: block; height: 100%; width: 0; background: var(--accent); border-radius: inherit; }
/* A barra tem sempre a cor da ferramenta (a mesma do ponto ao lado do título), na de 5 h e na
   semanal. Nenhum estado troca a cor da barra (regra do dono do painel, 08/10): nem "acima do ritmo" (o âmbar se
   confundia com o laranja do Claude) nem "resta menos de 10%". Quem mostra o ritmo é o cursor
   "agora" sobre os gomos; o aviso de menos de 10% fica só no número, em vermelho, e no verso. */
.quota.is-critical .used { color: var(--critico-tinta); }
.quota.is-missing .track { background: var(--c-trilho); opacity: .6; }
.quota.is-missing .reopens { display: none; }
.quota.is-missing .used { font-size: 12px; font-weight: 500; letter-spacing: 0; color: var(--c-apagado); }
.quota .cursor { position: absolute; left: var(--cursor, 0%); top: -4px; height: calc(100% + 8px); width: 2px; background: var(--c-tinta); transform: translateX(-50%); }
.quota .cursor[hidden] { display: none; }
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
function dataCurta(epoch) {         /* "ter 06/10" */
  var p = {};
  FORMATO_DATA.formatToParts(new Date(epoch * 1000)).forEach(function (x) { p[x.type] = x.value; });
  return (p.weekday || "").replace(".", "") + " " + p.day + "/" + p.month;
}
/* O dia de um gomo da semanal (0 a 6). A janela tem 7 fatias de 24 h a partir da última renovação:
   a fatia em que "agora" cai é hoje; as vizinhas, ontem, anteontem e amanhã; a primeira é o dia em
   que a cota renovou e a última, o dia em que renova. Sem hora de renovar, não há o que dizer. */
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
  return { ligar: ligar, descansar: function (slot) { var t = porSlot.get(slot); if (t) descansar(t); } };
})();

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
  texto(v.eyebrow, (conta.titulo || "") + (b.membros && b.membros.length ? " · " + b.membros.join(", ") : ""));
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
  var erro = conta.erro ? (conta.erro_detalhe || "falhou") : "";
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
/* O ponteiro sobre a barra semanal (com 10 px de folga acima e abaixo, que a barra é fina) escolhe o gomo. */
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
      texto(card.titulo, c.titulo || c.ferramenta_nome || "conta");
      atributo(card.tituloNo, "title", c.titulo || "");
      var rotulo = c.email ? c.email + (c.plano ? " · " + c.plano : "") : "conta não identificada";
      texto(card.rotuloConta, rotulo); atributo(card.rotuloConta, "title", rotulo);
      var quem = (c.vingadores && c.vingadores.length ? c.vingadores : c.terminais || []).join(" · ");
      texto(card.quemUsa, quem); atributo(card.quemUsa, "title", quem);
      var modelo = modeloLegivel(c.ferramenta, c.modelo), etiqueta = modelo ? [modelo, c.esforco ? capitalizar(c.esforco) : ""].filter(Boolean).join(" · ") : "";
      oculto(card.etiqueta, !etiqueta); texto(card.etiqueta, etiqueta); atributo(card.etiqueta, "title", etiqueta ? "Modelo da sessão mais recente desta conta: " + etiqueta : "");
      sincronizarBarras(card, Array.isArray(c.barras) ? c.barras : []);
    });
    Object.keys(cards).forEach(function (id) { if (!presentes[id]) { removerCard(cards[id]); delete cards[id]; } });
    var mensagem = "";
    if (!contas.consultadas) mensagem = "A consulta às CLIs está desligada (coletor --sem-contas): as cotas vêm só das status lines.";
    else if (!lista.length) mensagem = "Nenhuma conta em execução no canvas" + (contas.canvas ? " " + contas.canvas : "") + ".";
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
      var cursor = t.cursor === null ? null : Math.round(t.cursor * 100) / 100;     /* 0,01% ≈ 0,05 px: mais fino só gasta layout */
      oculto(barra.cursor, cursor === null);
      variavel(barra.no, "--cursor", (cursor === null ? 0 : cursor) + "%");
      atributo(barra.alvo, "aria-label", (b ? b.rotulo : "") + ": " + pct(temUso ? b.usado_pct : null) + " usado. " +
        (barra.tipo === "5h" ? barra.reabre.textContent : "Reset " + dataDoReset(b && b.renova_epoch)) + "." + (t.alerta ? " Consumo em alerta." : "") + " Clique para ver o detalhe.");
    });
    if (card.barraVirada) encherVerso(card, agoraS);
  });
}

document.addEventListener("pointerdown", function () { focoPorTeclado = false; });
document.addEventListener("keydown", function (ev) { focoPorTeclado = true; if (ev.key === "Escape") desvirarTodos(); });
setInterval(function () { tique(); }, 250);


window.__painelContas = { desenhar: desenhar };
})();
