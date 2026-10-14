# -*- coding: utf-8 -*-
"""Cota das contas pela CLI de cada ferramenta, sem token de IA e sem mandar tecla a terminal nenhum.

É o modelo do dashboard de cotas de fbtostadev (pasta cotas/, licença MIT, origem em cotas/ORIGEM.txt).
Em vez de ler a status line das telas ou de digitar /usage num terminal parado (a sonda), o coletor
pergunta à própria CLI, por um comando administrativo que não gera texto e não gasta cota:
  - Codex: `codex app-server` com `account/read` e `account/rateLimits/read`; entre consultas, um
    leitor passivo acompanha os `token_count` das sessões em CODEX_HOME/sessions;
  - Claude Code: `claude auth status --json` e `claude -p /usage --output-format stream-json`, que
    devolve sessão, semanal geral e a semanal por modelo (a do Fable);
  - Antigravity: `agy -p /quota --output-format json`, uma vez por máquina a cada 20 minutos: a CLI
    só consulta a conta ativa no Keychain, e o e-mail que ela registra no log diz de quem é o
    resultado. As outras contas do Antigravity continuam com a leitura das telas.
As contas vêm dos processos dos terminais do canvas (MAESTRI_TERMINAL_ID no ambiente de cada um),
agrupadas por diretório de login e e-mail. Cada conta sabe quais terminais a usam: é por aí que
ela vira os grupos de cota do painel (vingadores.json, grupo_cota).

Este módulo só adapta o original ao painel: liga a descoberta ao canvas do mapa (vingadores.json,
"workspace"), traduz o resultado para as leituras de cota por grupo (lib/cotas.py, o mesmo lugar
em que a sonda entra) e monta os cards da página.
"""
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
if str(RAIZ / "cotas") not in sys.path:
    sys.path.insert(0, str(RAIZ / "cotas"))

import backend      # noqa: E402  (cotas/backend.py, de fbtostadev)
import discovery    # noqa: E402  (cotas/discovery.py)

FERRAMENTA = {"codex": "codex", "claude": "claude", "antigravity": "agy"}       # harness -> ferramenta do mapa
NOME = {"codex": "Codex", "claude": "Claude Code", "antigravity": "Antigravity"}
INTERVALOS = dict(backend.INTERVALS)           # segundos entre consultas, por harness
POOL_DO_SUFIXO = (("Gemini", "gemini"), ("Claude/GPT", "3p"))    # grupo do painel -> pool do Antigravity
JANELA_MIN = {"5h": 300, "semana": 10080}
PROVISORIA_FOLGA_S = 60                        # folga, em segundos, para dizer que o período ainda não começou


# ---------------------------------------------------------------- descoberta

class DescobertaDoCanvas(discovery.MaestriDiscovery):
    """Os terminais do canvas com o nome do mapa, e não o canvas ativo: o dono do painel alterna entre canvases
    (Equipe e Outro), e o painel é de um só. Sem nome, ou nome não encontrado, vale o canvas ativo."""

    def __init__(self, nome_do_canvas, root=None, process_reader=discovery.read_processes):
        super().__init__(root, process_reader)
        self.nome_do_canvas = nome_do_canvas

    def id_do_canvas(self):
        if self.nome_do_canvas:
            for arquivo in sorted((self.root / "workspaces").glob("*/workspace.json")):
                try:
                    payload = json.loads(arquivo.read_text())["payload"]
                except (OSError, ValueError, KeyError, TypeError):
                    continue
                if payload.get("name") == self.nome_do_canvas:
                    return arquivo.parent.name
        return json.loads((self.root / "app-state.json").read_text())["payload"]["activeWorkspaceId"]

    def __call__(self):
        workspace_id = self.id_do_canvas()
        if not isinstance(workspace_id, str) or Path(workspace_id).name != workspace_id or workspace_id in (".", ".."):
            raise ValueError("invalid workspace id")
        payload = json.loads((self.root / "workspaces" / workspace_id / "workspace.json").read_text())["payload"]
        terminais = []
        for node in payload["nodes"]:
            terminal = node.get("content", {}).get("terminal", {}).get("_0")
            if terminal:
                terminais.append(terminal)
        contas = juntar_terminais_da_mesma_casa(discovery.discover_accounts(terminais, self.process_reader()))
        self.workspace = {"id": workspace_id, "name": payload["name"], "path": payload.get("workingDirectory")}
        return contas


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


# ---------------------------------------------------------------- as casas do Antigravity

LANCADOR = "agy.sh"
FILTRO_DO_EMAIL = '/OAuth: authenticated successfully as / { print substr($0, index($0, "OAuth:")) }'


def consultar_casa(casa, espera=40):
    """A cota da conta de uma casa do Antigravity, pelo lançador dela (`<casa>/agy.sh -p /quota`).

    Cada conta do Antigravity roda numa casa própria (HOME e Keychain separados); o lançador da casa
    abre o Keychain dela. O coletor original chama o `agy` sem trocar de casa e por isso só enxerga
    uma conta. Aqui a consulta é a mesma (`/quota`, administrativa: `parse_cli_output` recusa a
    resposta se houver qualquer token gasto), só que feita de dentro de cada casa.
    Devolve {"email", "pools"}; sem lançador, None.
    """
    lancador = Path(casa) / LANCADOR
    if not (lancador.is_file() and os.access(str(lancador), os.X_OK)):
        return None
    limpar_rastro_das_consultas(Path(casa) / LOGS_DA_CASA)
    with tempfile.TemporaryDirectory(prefix="quota-agy-") as temporario:
        registro = Path(temporario) / "query.log"
        comando = [str(lancador), "-p", "/quota", "--output-format", "json", "--print-timeout", "25s",
                   "--log-file", str(registro)]
        saida = backend.run_cli(comando, os.environ.copy(), time.monotonic() + espera)
        try:
            email = backend.parse_antigravity_email(backend.filtered_log(registro, FILTRO_DO_EMAIL))
        except (OSError, subprocess.SubprocessError):
            email = None
        return {"email": email, "pools": backend.parse_cli_output("antigravity", saida)}


# O `--log-file` só desvia o log da CLI: o servidor de linguagem que o agy sobe para responder o
# /quota grava um log próprio (~20 KB) em <casa>/.gemini/antigravity-cli/log, e só o fecha alguns
# segundos depois de o agy sair. A cada 20 minutos, por casa, são ~70 arquivos por dia que ninguém
# lê. Antes de consultar, a casa é varrida: sai o log que é de uma consulta /quota em modo print
# (as duas marcas abaixo; o log de uma sessão de Vingador não tem a primeira), já parado há um
# minuto e que ninguém tem aberto. O log de uma sessão viva fica aberto pelo agy, e por isso nunca sai.
LOGS_DA_CASA = Path(".gemini") / "antigravity-cli" / "log"
MARCAS_DE_CONSULTA = (b"Print mode: starting (promptLength=6", b"doRefreshQuota: starting reload (force=true)")
IDADE_MINIMA_S = 60
TAMANHO_MAXIMO = 200_000


def _logs_da_casa(pasta):
    try:
        return sorted(p for p in pasta.iterdir() if p.is_file() and p.name.startswith("cli-") and p.suffix == ".log")
    except OSError:
        return []


def _abertos(caminhos):
    """Quais desses arquivos algum processo tem aberto. Uma chamada ao lsof para todos; só se ela
    acusar alguém é que se pergunta arquivo por arquivo. Na dúvida (lsof falhou), todos contam
    como abertos: não se apaga."""
    def lsof(args):
        r = subprocess.run(["/usr/sbin/lsof", "-t", *args], stdout=subprocess.PIPE,
                           stderr=subprocess.DEVNULL, timeout=20)
        return bool(r.stdout.strip())
    caminhos = list(caminhos)
    try:
        if not caminhos or not lsof([str(c) for c in caminhos]):
            return set()
        return {c for c in caminhos if lsof([str(c)])}
    except (OSError, subprocess.SubprocessError):
        return set(caminhos)


def _log_de_consulta(caminho, agora=None):
    """Arquivo que só pode ser o rastro de um /quota: pequeno, parado há um minuto, com as duas marcas."""
    try:
        st = caminho.stat()
        if st.st_size > TAMANHO_MAXIMO or (agora or time.time()) - st.st_mtime < IDADE_MINIMA_S:
            return False
        with open(caminho, "rb") as f:
            conteudo = f.read(TAMANHO_MAXIMO)
        return all(marca in conteudo for marca in MARCAS_DE_CONSULTA)
    except OSError:
        return False


def limpar_rastro_das_consultas(pasta, agora=None, abertos=_abertos):
    """Apaga, em `pasta`, os logs que são rastro de consulta e ninguém tem aberto. Devolve-os."""
    candidatos = [p for p in _logs_da_casa(pasta) if _log_de_consulta(p, agora)]
    presos = abertos(candidatos) if candidatos else set()
    apagados = []
    for p in candidatos:
        if p in presos:
            continue
        try:
            p.unlink()
            apagados.append(p)
        except OSError:
            pass
    return apagados


def coletor_do_painel(account):
    """O `collector` do Dashboard original. Antigravity: de dentro da casa da conta (account_dir é o
    HOME da casa), pelo lançador; sem lançador, como no original. Claude e Codex: como no original.
    Sem isto o original rodava o `agy` do PATH com o HOME do coletor, uma consulta a mais e inútil."""
    if account.harness == "antigravity" and account.account_dir:
        resultado = consultar_casa(account.account_dir)
        if resultado is not None:
            return {"pools": resultado["pools"], "email": resultado["email"], "plan": None}
    return backend.collect(account)


class CasasDoAntigravity:
    """Consulta a cota de cada casa do Antigravity, uma por vez, em segundo plano, a cada 20 minutos.

    O resultado só vale se o e-mail que a consulta registrou for o da conta que o terminal usa
    (visto na descoberta): casa com login trocado não empresta número a ninguém. Falha dobra a
    espera, até 1 hora, e mantém a última leitura boa.
    """

    def __init__(self, consultar=consultar_casa, intervalo=None):
        self.consultar = consultar
        self.intervalo = intervalo or INTERVALOS["antigravity"]
        self.estado = {}        # casa -> {email, pools, lido_em, erro, falhas, proxima, consultando}
        self.trava = threading.Lock()
        self.fio = None

    def _rodar(self, pendentes):
        for casa, email_esperado in pendentes:
            erro, resultado = None, None
            try:
                resultado = self.consultar(casa)
                if resultado is None:
                    erro = "sem lançador"
                elif backend.normalize_email(resultado.get("email")) != email_esperado:
                    erro, resultado = "conta diferente", None
            except TimeoutError:
                erro = "timeout"
            except subprocess.CalledProcessError as falha:
                erro = "exit %d" % falha.returncode
            except (ValueError, KeyError, TypeError):
                erro = "parse"
            except Exception:       # uma casa com problema não impede as outras
                erro = "query"
            agora = time.time()
            with self.trava:
                e = self.estado.setdefault(casa, {"falhas": 0})
                if resultado is not None:
                    e.update(email=email_esperado, pools=resultado["pools"], lido_em=agora, falhas=0)
                else:
                    e["falhas"] = min(12, e.get("falhas", 0) + 1)
                e.update(erro=erro, consultando=False,
                         proxima=agora + min(self.intervalo * 2 ** e["falhas"], 3600))

    def atualizar(self, contas, esperar=False, agora=None):
        """`contas`: as contas do Antigravity da descoberta (com account_dir e email)."""
        agora = time.time() if agora is None else agora
        if self.fio and self.fio.is_alive():
            if esperar:
                self.fio.join()
            return
        pendentes = []
        with self.trava:
            for conta in contas:
                email = backend.normalize_email(conta.email)
                if not (conta.account_dir and email):
                    continue
                e = self.estado.setdefault(conta.account_dir, {"falhas": 0})
                if agora >= e.get("proxima", 0):
                    e["consultando"] = True
                    pendentes.append((conta.account_dir, email))
        if not pendentes:
            return
        self.fio = threading.Thread(target=self._rodar, args=(pendentes,), daemon=True)
        self.fio.start()
        if esperar:
            self.fio.join()

    def aplicar(self, foto, agora=None):
        """Põe nas contas do Antigravity da foto a leitura da própria casa, se for mais nova."""
        agora = time.time() if agora is None else agora
        with self.trava:
            for conta in (foto or {}).get("accounts") or []:
                if conta.get("harness") != "antigravity":
                    continue
                for casa in conta.get("account_dirs") or []:
                    e = self.estado.get(casa)
                    if not e:
                        continue
                    conta["querying"] = bool(conta.get("querying")) or bool(e.get("consultando"))
                    if e.get("email") != conta.get("email") or not e.get("lido_em"):
                        if e.get("erro") and not conta.get("observed_at"):
                            conta.update(error="query_failed", error_detail=e["erro"])
                        continue
                    if e["lido_em"] > (conta.get("observed_at") or 0):
                        pools = json.loads(json.dumps(e["pools"]))
                        janelas = [p.get(k) for p in pools for k in ("five_hour", "weekly")]
                        idade = max(0, agora - e["lido_em"])
                        vencida = any(j and j.get("resets_at") is not None and j["resets_at"] <= agora for j in janelas)
                        situacao = ("sem dados" if not any(janelas) else
                                    "desatualizado" if vencida or idade >= self.intervalo else
                                    "parcial" if any(j is None for j in janelas) else "ok")
                        conta.update(pools=pools, observed_at=e["lido_em"], age_seconds=idade, source="active",
                                     status=situacao, keychain_limited=False,
                                     error="query_failed" if e.get("erro") else None, error_detail=e.get("erro"),
                                     next_refresh_at=e.get("proxima"))
        return foto


class Contas:
    """O painel de cotas de fbtostadev, rodando dentro do coletor. `atualizar` dispara as consultas que
    estão na hora (em segundo plano, uma por conta por vez) e `foto` devolve o estado, sem HTTP.
    As contas do Antigravity são consultadas também de dentro de cada casa (CasasDoAntigravity)."""

    def __init__(self, mapa, raiz_do_maestri=None, coletor=None, leitor_de_processos=None, casas=None):
        self.mapa = mapa
        self.descoberta = DescobertaDoCanvas(mapa.get("workspace"), raiz_do_maestri,
                                             leitor_de_processos or discovery.read_processes)
        self.painel = backend.Dashboard(self.descoberta.workspace, self.descoberta,
                                        collector=coletor or coletor_do_painel,
                                        preferences_path=RAIZ / "cotas" / "preferences.json")
        self.casas = casas or CasasDoAntigravity()

    def atualizar(self, esperar=False):
        self.painel.refresh(wait=esperar)
        with self.painel.lock:
            do_antigravity = [c for c in self.painel.accounts if c.harness == "antigravity" and c.account_dir]
        self.casas.atualizar(do_antigravity, esperar)

    def foto(self):
        return self.casas.aplicar(self.painel.state())

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


def janela_provisoria(usado_pct, renova_epoch, lido_em_epoch, janela_min):
    """True quando o período ainda não começou: uso zero e hora de renovar colada em "leitura + duração".

    Sem uso, a CLI não tem um período de verdade e só projeta um a partir de agora; o card mostra "Ainda sem uso"
    em vez de um relógio que não existe. É o mesmo critério do quota-board em Node (provisional, em board.js)."""
    if usado_pct != 0 or isinstance(usado_pct, bool):
        return False
    if not isinstance(renova_epoch, (int, float)) or not isinstance(lido_em_epoch, (int, float)):
        return False
    return abs(renova_epoch - (lido_em_epoch + janela_min * 60)) <= PROVISORIA_FOLGA_S


def vingadores_da_conta(conta, mapa):
    """Os Vingadores do mapa cujo terminal está nesta conta, na ordem do mapa."""
    nomes = set(conta.get("terminals") or [])
    ferramenta = FERRAMENTA.get(conta.get("harness"))
    return [v for v in mapa["vingadores"] if v["nome"] in nomes and v.get("ferramenta") == ferramenta]


def janelas_da_conta(conta, mapa):
    """As janelas de cota desta conta, por grupo do painel, na ordem dos cards.

    {grupo: {"rotulo": sufixo ou None, "5h": janela|None, "semana": janela|None, "so_semana": bool}}
    A janela é a do pool da CLI ({used_percent, remaining_percent, resets_at, window_minutes}) ou
    None quando a CLI não trouxe. No Antigravity, cada conta tem dois grupos (Gemini e Claude/GPT);
    no Claude, a semanal por modelo (Fable) vira um grupo só de semanal.
    """
    vs = vingadores_da_conta(conta, mapa)
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
    nomes = [v["nome"] for v in mapa["vingadores"]]
    posicoes = [nomes.index(v["nome"]) for v in vingadores_da_conta(conta, mapa)]
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
        vs = vingadores_da_conta(conta, mapa)
        janelas = janelas_da_conta(conta, mapa)
        observado = conta.get("observed_at") if isinstance(conta.get("observed_at"), (int, float)) else None
        barras = []
        sem_rotulo = [g for g, jj in janelas.items() if not jj["rotulo"]]
        for grupo, j in janelas.items():
            g = grupos_do_painel.get(grupo) if isinstance(grupos_do_painel, dict) else None
            g = g if isinstance(g, dict) else {}
            for tipo in ("5h", "semana"):
                if tipo == "5h" and j.get("so_semana"):
                    continue
                janela = j.get(tipo)
                campo = "sessao_5h_pct" if tipo == "5h" else "semanal_pct"
                barra = {"grupo": grupo, "tipo": tipo,
                         # a aba do card: "Gemini", "Claude/GPT", o modelo da semanal própria; vazio no grupo principal
                         "grupo_rotulo": j["rotulo"] or (grupo if len(sem_rotulo) > 1 else ""),
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
                barra["provisorio"] = janela_provisoria(barra["usado_pct"], barra["renova_epoch"], barra["lido_em_epoch"], barra["janela_min"])
                barras.append(barra)
        titulo = base_do_grupo(next(iter(janelas))) if janelas else NOME.get(harness, "conta")
        lista.append({
            "id": conta.get("id"),
            "ferramenta": FERRAMENTA.get(harness, harness),
            "ferramenta_nome": NOME.get(harness, harness),
            "titulo": titulo,
            "email": conta.get("email"),
            "plano": conta.get("plan"),
            "vingadores": [v["nome"] for v in vs],
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
        return {"consultadas": False, "erro": None, "canvas": None, "intervalos_s": INTERVALOS, "lista": []}
    erro = foto.get("discovery_error")
    return {
        "consultadas": True,
        "erro": "não foi possível ler os terminais do canvas; última lista mantida" if erro else None,
        "canvas": (foto.get("workspace") or {}).get("name"),
        "intervalos_s": INTERVALOS,
        "lista": cartoes(foto, mapa, grupos_do_painel, agora),
    }
