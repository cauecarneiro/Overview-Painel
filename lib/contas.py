# -*- coding: utf-8 -*-
"""Cota das contas pela CLI de cada ferramenta, sem token de IA e sem mandar tecla a terminal nenhum.

É o modelo do dashboard de cotas de fbtostadev (pasta cotas/, licença MIT, origem em cotas/ORIGEM.txt).
Em vez de ler a status line das telas ou de digitar /usage num terminal parado (a sonda), o coletor
pergunta à própria CLI, por um comando administrativo que não gera texto e não gasta cota:
  - Codex: `codex app-server` com `account/read` e `account/rateLimits/read`; entre consultas, um
    leitor passivo acompanha os `token_count` das sessões em CODEX_HOME/sessions;
  - Claude Code: `claude auth status --json` e `claude -p /usage --output-format stream-json`, que
    devolve sessão, semanal geral e a semanal por modelo;
  - Antigravity: `agy -p /quota --output-format json`, uma vez por máquina a cada 20 minutos: a CLI
    só consulta a conta ativa, e o e-mail que ela registra no log diz de quem é o resultado.
As contas vêm dos processos que rodam dentro dos terminais do tmux (TMUX_PANE no ambiente de cada
um), agrupadas por diretório de login e e-mail. Cada conta sabe quais agentes a usam: é por aí que
ela vira os grupos de cota do painel (agentes.json, grupo_cota).

Este módulo só adapta o original ao painel: liga a descoberta aos terminais do mapa (agentes.json),
traduz o resultado para as leituras de cota por grupo (lib/cotas.py, o mesmo lugar em que a sonda
entra) e monta os cards da página.
"""
import json
import sys
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
if str(RAIZ / "cotas") not in sys.path:
    sys.path.insert(0, str(RAIZ / "cotas"))

import backend      # noqa: E402  (cotas/backend.py, de fbtostadev)
import discovery    # noqa: E402  (cotas/discovery.py)
from terminais import Tmux   # noqa: E402

FERRAMENTA = {"codex": "codex", "claude": "claude", "antigravity": "agy"}       # harness -> ferramenta do mapa
NOME = {"codex": "Codex", "claude": "Claude Code", "antigravity": "Antigravity"}
INTERVALOS = dict(backend.INTERVALS)           # segundos entre consultas, por harness
POOL_DO_SUFIXO = (("Gemini", "gemini"), ("Claude/GPT", "3p"))    # grupo do painel -> pool do Antigravity
JANELA_MIN = {"5h": 300, "semana": 10080}


# ---------------------------------------------------------------- descoberta

class DescobertaDoTmux(discovery.TmuxDiscovery):
    """Os terminais do tmux apontados pelo mapa (campo "terminal" de cada agente, ou o próprio nome)."""

    def __init__(self, mapa, terminais=None, process_reader=discovery.read_processes):
        self.terminais = terminais or Tmux(mapa)
        self.mapa = mapa
        super().__init__(self.terminais_do_mapa, process_reader)

    def terminais_do_mapa(self):
        encontrados = []
        for agente in self.mapa.get("agentes", []):
            painel = self.terminais.painel(agente["nome"])
            if painel:
                encontrados.append({"id": painel, "name": agente["nome"], "status": "running"})
        return encontrados

    def __call__(self):
        return juntar_terminais_da_mesma_casa(super().__call__())


def juntar_terminais_da_mesma_casa(contas):
    """Uma casa do Antigravity (HOME) é um login só. A descoberta lê o e-mail do log de autenticação que o
    processo tem aberto; o agy reaberto sem novo login não tem esse log, saía sem e-mail e virava um segundo
    card da mesma conta ("sem dados"). Ele entra no card do irmão da mesma casa que provou o e-mail, desde que
    a casa tenha um e-mail só. Sem irmão que prove, continua como está (a descoberta não adivinha)."""
    provadas = {}
    for c in contas:
        if c.harness == "antigravity" and c.account_dir and c.email:
            provadas.setdefault(c.account_dir, []).append(c)
    resultado = []
    for c in contas:
        if c.harness == "antigravity" and c.account_dir and not c.email:
            irmaos = provadas.get(c.account_dir, [])
            if len({i.email for i in irmaos}) == 1:
                irmaos[0].terminals = sorted(set(irmaos[0].terminals) | set(c.terminals))
                continue
        resultado.append(c)
    return resultado


class Contas:
    """O painel de cotas de fbtostadev, rodando dentro do coletor. `atualizar` dispara as consultas que
    estão na hora (em segundo plano, uma por conta por vez) e `foto` devolve o estado, sem HTTP."""

    def __init__(self, mapa, coletor=None, leitor_de_processos=None, terminais=None):
        self.mapa = mapa
        self.descoberta = DescobertaDoTmux(mapa, terminais, leitor_de_processos or discovery.read_processes)
        self.painel = backend.Dashboard(self.descoberta.workspace, self.descoberta,
                                        collector=coletor or backend.collect,
                                        preferences_path=RAIZ / "cotas" / "preferences.json")

    def atualizar(self, esperar=False):
        self.painel.refresh(wait=esperar)

    def foto(self):
        return self.painel.state()

    def fechar(self):
        self.painel.close()


# ---------------------------------------------------------------- tradução para o painel

def renova_pt(epoch, agora):
    """epoch -> '16h19' (hoje) ou '13/10 às 09h59', o formato que a sonda já usava."""
    if epoch is None:
        return None
    try:
        momento = datetime.fromtimestamp(float(epoch)).astimezone()
        hoje = datetime.fromtimestamp(float(agora)).astimezone()
    except (TypeError, ValueError, OverflowError, OSError):
        return None
    hora = "%02dh%02d" % (momento.hour, momento.minute)
    return hora if momento.date() == hoje.date() else "%02d/%02d às %s" % (momento.day, momento.month, hora)


def pct(janela):
    if not isinstance(janela, dict) or not isinstance(janela.get("used_percent"), (int, float)):
        return None
    return max(0, min(100, int(round(janela["used_percent"]))))


def base_do_grupo(grupo):
    """'k@example.com · Gemini' -> 'k@example.com'; 'Claude Max 5x' fica como está."""
    return grupo.rsplit(" · ", 1)[0] if " · " in grupo else grupo


def agentes_da_conta(conta, mapa):
    """Os Agentes do mapa cujo terminal está nesta conta, na ordem do mapa."""
    nomes = set(conta.get("terminals") or [])
    ferramenta = FERRAMENTA.get(conta.get("harness"))
    return [v for v in mapa["agentes"] if v["nome"] in nomes and v.get("ferramenta") == ferramenta]


def janelas_da_conta(conta, mapa):
    """As janelas de cota desta conta, por grupo do painel, na ordem dos cards.

    {grupo: {"rotulo": sufixo ou None, "5h": janela|None, "semana": janela|None, "so_semana": bool}}
    A janela é a do pool da CLI ({used_percent, remaining_percent, resets_at, window_minutes}) ou
    None quando a CLI não trouxe. No Antigravity, cada conta tem dois grupos (Gemini e Claude/GPT);
    no Claude, a semanal por modelo (Opus) vira um grupo só de semanal.
    """
    vs = agentes_da_conta(conta, mapa)
    pools = {p.get("id"): p for p in (conta.get("pools") or []) if isinstance(p, dict)}
    grupos = {}
    if conta.get("harness") == "antigravity":
        bases = []
        for v in vs:
            base = base_do_grupo(v["grupo_cota"])
            if base not in bases:
                bases.append(base)
        if not bases:
            bases = [conta.get("email") or NOME["antigravity"]]
        for base in bases:
            for sufixo, pool in POOL_DO_SUFIXO:
                p = pools.get(pool) or {}
                grupos["%s · %s" % (base, sufixo)] = {"rotulo": sufixo, "5h": p.get("five_hour"),
                                                       "semana": p.get("weekly"), "so_semana": False}
        return grupos
    principal = next(iter(conta.get("pools") or []), None) or {}
    chaves = []
    for v in vs:
        if v["grupo_cota"] not in chaves:
            chaves.append(v["grupo_cota"])
    if not chaves:
        chaves = [NOME.get(conta.get("harness"), "conta")]
    for grupo in chaves:
        grupos[grupo] = {"rotulo": None, "5h": principal.get("five_hour"), "semana": principal.get("weekly"),
                         "so_semana": False}
    escopos = principal.get("scoped") if isinstance(principal.get("scoped"), dict) else {}
    for v in vs:
        modelo = v.get("semanal_do_modelo")
        if modelo:
            grupo = "%s · %s" % (v["grupo_cota"], modelo)
            if grupo not in grupos:
                grupos[grupo] = {"rotulo": modelo, "5h": None, "semana": escopos.get(modelo), "so_semana": True}
    return grupos


def leituras_para_cotas(foto, mapa, agora):
    """{grupo: leitura} no formato das leituras da sonda (estado["sondas"]), só com o que a CLI observou.

    Entra em lib/cotas.py pela mesma regra da sonda: vale a leitura mais recente do grupo.
    """
    leituras = {}
    for conta in (foto or {}).get("accounts") or []:
        observado = conta.get("observed_at")
        if not isinstance(observado, (int, float)):
            continue
        for grupo, j in janelas_da_conta(conta, mapa).items():
            cinco, semana = j["5h"], j["semana"]
            if cinco is None and semana is None:
                continue
            leituras[grupo] = {
                "lido_em": int(observado),
                "origem": "cli",
                "terminal": NOME.get(conta.get("harness"), "CLI"),      # a "fonte" que a página mostra
                "sessao_5h_pct": pct(cinco),
                "semanal_pct": pct(semana),
                "renova_sessao": renova_pt((cinco or {}).get("resets_at"), agora),
                "renova_semanal": renova_pt((semana or {}).get("resets_at"), agora),
                "renova_sessao_epoch": (cinco or {}).get("resets_at"),
                "renova_semanal_epoch": (semana or {}).get("resets_at"),
            }
    return leituras


def _posicao(conta, mapa):
    nomes = [v["nome"] for v in mapa["agentes"]]
    posicoes = [nomes.index(v["nome"]) for v in agentes_da_conta(conta, mapa)]
    return (min(posicoes) if posicoes else len(nomes), conta.get("harness") or "", conta.get("id") or "")


def _sem_fantasmas(contas):
    """Terminal cuja conta a descoberta não conseguiu provar (processo sumiu no meio da leitura,
    ou dois processos com identidades diferentes no mesmo terminal) vira, no painel original, uma
    conta à parte sem e-mail, sem pasta e sem dado: um card vazio que pisca. Aqui ele não vira card.
    No Claude Code, que só tem uma conta nesta máquina, o terminal entra no card dessa conta."""
    provadas = [c for c in contas if c.get("account_dirs") or c.get("email")]
    fantasmas = [c for c in contas if not (c.get("account_dirs") or c.get("email"))]
    for f in fantasmas:
        donos = [c for c in provadas if c.get("harness") == f.get("harness")]
        if f.get("harness") == "claude" and len(donos) == 1:
            donos[0]["terminals"] = sorted(set(donos[0].get("terminals") or []) | set(f.get("terminals") or []))
    return provadas


def cartoes(foto, mapa, grupos_do_painel, agora):
    """Um card por conta, com uma barra por janela de cota, pronto para a página.

    O número de cada barra é o do grupo resolvido pelo painel (lib/cotas.py): a leitura mais recente
    do grupo, venha da CLI ou da tela. Assim o card e a tabela nunca discordam. A hora de renovar
    vem da CLI quando ela tem a conta; senão, da última leitura que a trouxe.
    """
    lista = []
    for conta in sorted(_sem_fantasmas((foto or {}).get("accounts") or []), key=lambda c: _posicao(c, mapa)):
        harness = conta.get("harness")
        vs = agentes_da_conta(conta, mapa)
        janelas = janelas_da_conta(conta, mapa)
        observado = conta.get("observed_at") if isinstance(conta.get("observed_at"), (int, float)) else None
        barras = []
        for grupo, j in janelas.items():
            g = grupos_do_painel.get(grupo) if isinstance(grupos_do_painel, dict) else None
            g = g if isinstance(g, dict) else {}
            for tipo in ("5h", "semana"):
                if tipo == "5h" and j.get("so_semana"):
                    continue
                janela = j.get(tipo)
                campo = "sessao_5h_pct" if tipo == "5h" else "semanal_pct"
                barra = {"grupo": grupo, "tipo": tipo,
                         "rotulo": ("5h" if tipo == "5h" else "Semana") + (" · " + j["rotulo"] if j["rotulo"] else ""),
                         "usado_pct": None, "renova_epoch": None, "janela_min": JANELA_MIN[tipo],
                         "origem": None, "evidencia": None, "lido_em_epoch": None, "fonte": None,
                         "membros": list(g.get("membros") or [v["nome"] for v in vs])}
                if g.get("fonte") and g.get(campo) is not None:
                    barra.update(usado_pct=g[campo], origem=g.get("origem"), evidencia=g.get("evidencia"),
                                 lido_em_epoch=g.get("lido_em_epoch"), fonte=g.get("fonte"))
                elif janela is not None and observado is not None:
                    barra.update(usado_pct=pct(janela), origem="cli", evidencia="cli",
                                 lido_em_epoch=int(observado), fonte=NOME.get(harness))
                renova = janela.get("resets_at") if (janela is not None and observado is not None) else None
                if renova is None:
                    renova = g.get("renova_sessao_epoch" if tipo == "5h" else "renova_semanal_epoch")
                barra["renova_epoch"] = renova if isinstance(renova, (int, float)) else None
                barras.append(barra)
        titulo = base_do_grupo(next(iter(janelas))) if janelas else NOME.get(harness, "conta")
        lista.append({
            "id": conta.get("id"),
            "ferramenta": FERRAMENTA.get(harness, harness),
            "ferramenta_nome": NOME.get(harness, harness),
            "titulo": titulo,
            "email": conta.get("email"),
            "plano": conta.get("plan"),
            "agentes": [v["nome"] for v in vs],
            "terminais": list(conta.get("terminals") or []),
            "modelo": conta.get("model"),
            "esforco": conta.get("effort"),
            "consultando": bool(conta.get("querying")),
            "erro": conta.get("error"),
            "erro_detalhe": conta.get("error_detail"),
            "situacao": conta.get("status"),
            "lido_em_epoch": int(observado) if observado is not None else None,
            "proxima_consulta_epoch": conta.get("next_refresh_at"),
            "keychain_limitado": bool(conta.get("keychain_limited")),
            "barras": barras,
        })
    return lista


def para_a_pagina(foto, mapa, grupos_do_painel, agora, consultadas=True):
    """O bloco "contas" do dados.json."""
    if not consultadas or foto is None:
        return {"consultadas": False, "erro": None, "intervalos_s": INTERVALOS, "lista": []}
    erro = foto.get("discovery_error")
    return {
        "consultadas": True,
        "erro": "não foi possível ler os terminais do tmux; última lista mantida" if erro else None,
        "intervalos_s": INTERVALOS,
        "lista": cartoes(foto, mapa, grupos_do_painel, agora),
    }
