/* O texto do botão "Copiar": a cota de uma conta, compacta, em texto puro (uma linha de identidade e uma por
   período). Sem DOM; quem chama passa o formatador de porcentagem da página, o e-mail já mascarado ou não e,
   se a leitura da conta está velha, `velha`. Os estados e o "termina em" vêm de prazo.js. Carregado como script
   comum no navegador (window.Resumo) e por require() nos testes. */
(function (raiz) {
"use strict";
var Prazo = typeof require === "function" ? require("./prazo.js") : raiz.Prazo;

function resumoDaConta(conta, agoraS, o) {
  var plano = conta.plano ? " " + conta.plano.charAt(0).toUpperCase() + conta.plano.slice(1) : "";
  var linhas = [conta.ferramenta_nome + plano + (o.email ? " " + o.email : "")];
  (conta.barras || []).forEach(function (b) {
    var nome = (b.grupo_rotulo ? b.grupo_rotulo + " " : "") + (b.tipo === "5h" ? "5 horas" : "Semana");
    var d = Prazo.descrever(b, agoraS, { velha: o.velha });
    if (d.usado === null) { linhas.push(nome + " sem dados"); return; }
    var detalhe = d.estado === "em-curso" ? " (período termina em " + Prazo.duracao((b.renova_epoch - agoraS) / 60) + ")"
                : d.estado === "sem-periodo" ? " (ainda sem uso)" : "";
    linhas.push(nome + " " + o.pct(d.usado) + d.sufixo + detalhe);
  });
  return linhas.join("\n");
}

var api = { resumoDaConta: resumoDaConta };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else raiz.Resumo = api;
})(typeof window !== "undefined" ? window : this);
