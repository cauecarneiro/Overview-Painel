# -*- coding: utf-8 -*-
"""Sonda de cota: lê o número atual da conta abrindo o painel de limites num terminal parado.

A status line só muda quando a sessão fala com o servidor; o painel de limites busca o número
na hora, sem gastar token:
  - Claude Code: `/usage` abre um painel. Ele mostra primeiro os números velhos com "Refreshing…"
    e, segundos depois, os atuais: sessão, semana (todos os modelos) e semana por modelo
    (Opus). `Esc` fecha;
  - Codex: `/status` escreve um bloco na conversa, com o que RESTA. O primeiro bloco pode trazer
    número velho; o seguinte traz o atual (visto no Agente 05 em 01/10/2026). A sonda manda dois e lê
    sempre o ÚLTIMO bloco da tela. Não há o que fechar.
O Antigravity fica de fora: o `/usage` de uma sessão parada mostra dado velho, e lá cada terminal
é o único do seu grupo de cota. A hora de renovação também não é lida: a única tela de exemplo
(telas-de-exemplo/sonda/agy-usage.txt) está com a cota em 100% e não mostra hora nenhuma.

Segurança:
  - só manda tecla a terminal OCIOSO e com o PROMPT VAZIO, conferido de novo na hora de mandar;
  - se a conta não tem nenhum terminal assim, pula: a leitura anterior continua, com a idade dela;
  - NUNCA manda Enter sem ter conferido a tela. O comando é digitado sem Enter; o Enter só vai
    depois de a tela mostrar o prompt com exatamente o comando e, se o menu de comandos estiver
    aberto, com o comando certo marcado. Em 02/10/2026 à 0h10 o "/status" com o Enter junto, mais
    um Enter às cegas, deixou o Codex do Agente 05 no menu de modelo e de nível de raciocínio: com só
    "/" no prompt, o Enter executa o primeiro comando da lista, que é o `/model`, e o Enter
    seguinte escolhe o modelo marcado;
  - se o que ficou no prompt não é o comando, apaga só o que ela mesma digitou e desiste;
  - se aparecer um menu, sai com Esc (um por nível, conferindo a tela antes de cada um) e não
    tenta de novo naquela rodada. Esc nunca vai a terminal que está trabalhando;
  - depois de ler, fecha (Esc no Claude Code) e confere que a tela voltou ao normal. Se não
    voltou, registra e não manda mais nada àquele terminal até ele voltar ao normal.
"""
import re
import threading
import time

import leitor
from terminais import Tmux

RE_ROTULO_CLAUDE = re.compile(r"^\s*(Current session|Current week \(([^)]+)\))(.*)$")
RE_USADO = re.compile(r"(\d{1,3})% (used|left)")
RE_RENOVA = re.compile(r"Resets (.+?)\s*(?:\([^)]*\))?\s*$")
RE_CODEX_5H = re.compile(r"^\s*5h limit:\s.*?(\d{1,3})% (left|used)(?: \(resets ([^)]*)\))?")
RE_CODEX_SEMANA = re.compile(r"^\s*Weekly limit:\s.*?(\d{1,3})% (left|used)(?: \(resets ([^)]*)\))?")
# O rodapé dos menus do Codex ("enter select · esc back", "enter default · s session · esc back").
# "esc to interrupt" é de quem está trabalhando: ali o Esc interromperia o agente, e não é menu.
RE_MENU = re.compile(r"\besc (?:back|to (?:go back|cancel|close|dismiss))\b", re.IGNORECASE)
RE_INTERROMPER = re.compile(r"\besc to interrupt\b", re.IGNORECASE)


MESES = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10,
         "nov": 11, "dec": 12}
RE_RENOVA_CLAUDE = re.compile(r"^(?:([A-Za-z]{3})[a-z]* (\d{1,2})(?:, \d{4})? at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)$", re.IGNORECASE)
RE_RENOVA_CODEX = re.compile(r"^(\d{1,2}):(\d{2})(?: on (\d{1,2}) ([A-Za-z]{3})[a-z]*)?$")


def renova_pt(texto):
    """'12:19am' -> '00h19'; 'Oct 6 at 9:59am' -> '06/10 às 09h59'; '01:24 on 2 Oct' -> '02/10 às 01h24'.

    Formato desconhecido volta como veio: a hora de renovar é informação, não conta.
    """
    if not texto:
        return None
    texto = texto.strip()
    dia = mes = None
    m = RE_RENOVA_CLAUDE.match(texto)
    if m:
        hora = int(m.group(3)) % 12 + (12 if m.group(5).lower() == "pm" else 0)
        minuto = int(m.group(4) or 0)
        if m.group(1):
            mes, dia = MESES.get(m.group(1).lower()), int(m.group(2))
    else:
        m = RE_RENOVA_CODEX.match(texto)
        if not m:
            return texto
        hora, minuto = int(m.group(1)), int(m.group(2))
        if m.group(3):
            dia, mes = int(m.group(3)), MESES.get(m.group(4).lower())
    if hora > 23 or minuto > 59 or (dia and not mes):
        return texto
    hora_pt = "%02dh%02d" % (hora, minuto)
    return "%02d/%02d às %s" % (dia, mes, hora_pt) if dia else hora_pt


def _usado(numero, tipo):
    n = int(numero)
    if not 0 <= n <= 100:
        return None
    return 100 - n if tipo == "left" else n


def ler_usage_claude(texto):
    """A tela do `/usage` do Claude Code.

    Devolve None se o painel não está na tela. Senão:
      {"atualizando": bool, "sessao_5h_pct", "renova_sessao", "semanal_pct", "renova_semanal",
       "modelos": {"Opus": {"semanal_pct", "renova_semanal"}}}
    Com "atualizando" os números ainda são os velhos: não use.
    """
    linhas = (texto or "").replace("\r", "").split("\n")
    blocos = {}
    i = 0
    while i < len(linhas):
        m = RE_ROTULO_CLAUDE.match(linhas[i])
        if not m:
            i += 1
            continue
        chave = "sessao" if m.group(1) == "Current session" else m.group(2).strip()
        trecho = [m.group(3)]       # o número pode vir na linha do rótulo ou nas seguintes
        i += 1
        while i < len(linhas) and len(trecho) < 4 and not RE_ROTULO_CLAUDE.match(linhas[i]):
            trecho.append(linhas[i])
            i += 1
        bloco = {}
        for linha in trecho:
            usado = RE_USADO.search(linha)
            if usado and "pct" not in bloco:
                bloco["pct"] = _usado(*usado.groups())
            renova = RE_RENOVA.search(linha)
            if renova and "renova" not in bloco:
                bloco["renova"] = renova.group(1).strip()
        if bloco.get("pct") is not None:
            blocos[chave] = bloco
    if "sessao" not in blocos and not any("Current session" in linha for linha in linhas):
        return None
    resultado = {
        "atualizando": any(linha.strip().startswith("Refreshing") for linha in linhas),
        "sessao_5h_pct": blocos.get("sessao", {}).get("pct"),
        "renova_sessao": blocos.get("sessao", {}).get("renova"),
        "semanal_pct": blocos.get("all models", {}).get("pct"),
        "renova_semanal": blocos.get("all models", {}).get("renova"),
        "modelos": {},
    }
    for chave, bloco in blocos.items():
        if chave not in ("sessao", "all models"):
            resultado["modelos"][chave] = {"semanal_pct": bloco["pct"], "renova_semanal": bloco.get("renova")}
    return resultado


def ler_status_codex(texto):
    """O ÚLTIMO bloco de `/status` da tela do Codex, convertido de "resta" para usado.

    Devolve None se não há bloco. Senão {"blocos": quantos há na tela, "no_fim": se o bloco é a
    última coisa da conversa, "sessao_5h_pct", "renova_sessao", "semanal_pct", "renova_semanal"}.
    Logo depois de um `/status` o bloco está no fim: é assim que a sonda sabe que foi ele que rodou.
    """
    linhas = (texto or "").replace("\r", "").split("\n")
    achados = [i for i, linha in enumerate(linhas) if RE_CODEX_5H.match(linha)]
    if not achados:
        return None
    i = achados[-1]
    cinco = RE_CODEX_5H.match(linhas[i])
    resultado = {"blocos": len(achados), "no_fim": False, "sessao_5h_pct": _usado(cinco.group(1), cinco.group(2)),
                 "renova_sessao": cinco.group(3), "semanal_pct": None, "renova_semanal": None}
    fim = i
    for j in range(i + 1, min(i + 4, len(linhas))):
        semana = RE_CODEX_SEMANA.match(linhas[j])
        if semana:
            resultado["semanal_pct"] = _usado(semana.group(1), semana.group(2))
            resultado["renova_semanal"] = semana.group(3)
            fim = j
            break
    depois = [linha for linha in linhas[fim + 1:] if linha.strip()]
    resultado["no_fim"] = bool(depois) and depois[0].lstrip().startswith("›")
    return resultado


def e_menu(texto):
    """True se a tela é um menu do Codex (escolha de modelo, de nível de raciocínio): sem a
    status line do terminal e com o rodapé que diz que Esc volta. Só aí a sonda manda Esc ao
    Codex. Não serve para o Claude Code, que tem a sua conferência (o painel do /usage)."""
    linhas = [linha for linha in (texto or "").replace("\r", "").split("\n") if linha.strip()]
    fim = linhas[-4:]
    if not fim or any(RE_INTERROMPER.search(linha) for linha in linhas[-12:]):
        return False
    if leitor.ler_tela(texto, "codex")["leitura"] == "ok":
        return False
    return any(RE_MENU.search(linha) for linha in fim)


class Sonda:
    """Roda as sondas do mapa. Um terminal de cada vez, sem nada em paralelo."""

    ESPERA_PAINEL = 20      # s, no máximo, até o painel do Claude Code mostrar os números atuais
    ESPERA_FECHAR = 6       # s, no máximo, até a tela voltar ao normal depois do Esc
    ESPERA_DIGITAR = 4      # s, no máximo, até o comando digitado aparecer no prompt
    ESPERA_STATUS = 8       # s, no máximo, até o bloco do /status aparecer depois do Enter
    MAX_ENTER = 2           # o Codex pode engolir o primeiro Enter (tratou a digitação como colagem)
    MAX_ESC = 3             # um por nível de menu
    PASSO = 1.0             # s entre duas olhadas na tela

    def __init__(self, mapa, terminais=None, registrar=print, dormir=time.sleep, agora=time.time):
        self.sondas = mapa.get("sondas") or []
        self.ferramenta_de = {v["nome"]: v["ferramenta"] for v in mapa["agentes"]}
        self.terminais = terminais or Tmux(mapa)
        self.registrar = registrar
        self.dormir = dormir
        self.agora = agora
        self.trava = threading.Lock()
        self.em_sonda = set()       # terminais com o painel aberto agora: o coletor não lê a tela deles
        self.bloqueados = {}        # nome -> {"motivo", "desde"}: não voltou ao normal depois da sonda
        self.situacao = {}          # grupo -> {"situacao", "detalhe", "terminal", "em"}
        self.leituras = {}          # grupo -> leitura da sonda, pronta para o estado das cotas

    # ------------------------------------------------------------ leitura do estado

    def foto(self):
        with self.trava:
            return ({g: dict(leitura) for g, leitura in self.leituras.items()},
                    {g: dict(s) for g, s in self.situacao.items()},
                    {n: dict(b) for n, b in self.bloqueados.items()},
                    set(self.em_sonda))

    def _normal(self, nome):
        """A tela do terminal agora: (leitura, pode receber tecla?)."""
        tela = self.terminais.ver(nome)
        if tela is None:
            return None, False
        lido = leitor.ler_tela(tela, self.ferramenta_de[nome])
        return lido, lido["leitura"] == "ok" and lido["estado"] == "ocioso" and lido["prompt_vazio"] is True

    def liberar_quem_voltou(self, leituras):
        """Terminal bloqueado que aparece normal numa leitura comum do coletor volta a ser sondado."""
        with self.trava:
            for nome in list(self.bloqueados):
                lido = leituras.get(nome)
                if lido and lido["leitura"] == "ok" and lido["estado"] == "ocioso" and lido["prompt_vazio"] is True:
                    del self.bloqueados[nome]
                    self.registrar("sonda: %s voltou ao normal e pode ser sondado de novo" % nome)

    # ------------------------------------------------------------ uma conta

    def _marcar(self, grupo, situacao, detalhe, terminal=None):
        with self.trava:
            self.situacao[grupo] = {"situacao": situacao, "detalhe": detalhe, "terminal": terminal,
                                    "em": int(self.agora())}

    def _bloquear(self, nome, motivo):
        with self.trava:
            self.bloqueados[nome] = {"motivo": motivo, "desde": int(self.agora())}
        self.registrar("sonda: %s NÃO voltou ao normal (%s). Nada mais será enviado a ele até voltar." % (nome, motivo))

    def _esperar_normal(self, nome):
        limite = self.agora() + self.ESPERA_FECHAR
        while True:
            self.dormir(self.PASSO)
            _, normal = self._normal(nome)
            if normal:
                return True
            if self.agora() >= limite:
                return False

    def _olhar(self, nome):
        """Uma olhada na tela: (tela, leitura, digitado no prompt, comando marcado no menu)."""
        tela = self.terminais.ver(nome)
        if tela is None:
            return "", None, None, None
        ferramenta = self.ferramenta_de[nome]
        digitado, destacado = leitor.prompt_e_comando(tela, ferramenta)
        return tela, leitor.ler_tela(tela, ferramenta), digitado, destacado

    @staticmethod
    def _pronto_para_o_enter(olhada, comando):
        """A tela olhada mostra o prompt com exatamente `comando`? Com o menu de comandos
        aberto, o comando marcado tem de ser o mesmo: é ele que o Enter executa."""
        _, lido, digitado, destacado = olhada
        return bool(lido and lido["leitura"] == "ok" and lido["estado"] == "ocioso"
                    and digitado == comando and destacado in (None, comando))

    def _apagar(self, nome, comando):
        """Tira do prompt o que a sonda digitou, e só isso: um Backspace por caractere, e só se
        o que está lá agora é o começo do comando. Texto de outra pessoa não é tocado."""
        _, lido, digitado, _ = self._olhar(nome)
        if not (lido and lido["leitura"] == "ok" and lido["estado"] == "ocioso"):
            return
        if digitado and comando.startswith(digitado):
            self.terminais.teclar(nome, "\\x7f" * len(digitado))

    def _digitar(self, nome, comando):
        """Digita `comando` SEM Enter e espera a tela mostrá-lo no prompt. Devolve True se o
        Enter pode ir. Se não ficou como esperado, apaga o que digitou e devolve False."""
        self.terminais.teclar(nome, comando)
        limite = self.agora() + self.ESPERA_DIGITAR
        while True:
            self.dormir(self.PASSO)
            if self._pronto_para_o_enter(self._olhar(nome), comando):
                return True
            if self.agora() >= limite:
                break
        if self.ferramenta_de[nome] == "codex":
            self._sair_do_menu(nome)    # se a digitação abriu um menu, não fica aberto
        self._apagar(nome, comando)
        return False

    def _sair_do_menu(self, nome):
        """Esc enquanto a tela for um menu, um por nível, conferindo a tela antes de cada um."""
        for _ in range(self.MAX_ESC):
            if not e_menu(self.terminais.ver(nome) or ""):
                return
            self.terminais.teclar(nome, "\\e")
            self.dormir(self.PASSO)

    def _sondar_claude(self, nome):
        if not self._digitar(nome, "/usage"):
            return None, self._esperar_normal(nome), "o /usage não ficou digitado no prompt como esperado"
        self.terminais.teclar(nome, "\\n")
        limite = self.agora() + self.ESPERA_PAINEL
        anterior, leitura = None, None
        while self.agora() < limite:
            self.dormir(self.PASSO)
            atual = ler_usage_claude(self.terminais.ver(nome) or "")
            # Vale a leitura sem "Refreshing…" vista duas vezes seguidas, igual: a primeira tela
            # do painel traz os números velhos.
            if atual and not atual["atualizando"] and atual["sessao_5h_pct"] is not None and atual == anterior:
                leitura = atual
                break
            anterior = atual
        # Esc só se o painel ainda está na tela: num terminal trabalhando, Esc interromperia o agente.
        if ler_usage_claude(self.terminais.ver(nome) or "") is not None:
            self.terminais.teclar(nome, "\\e")
        else:
            self._apagar(nome, "/usage")    # o painel não abriu: o comando não fica no prompt
        fechou = self._esperar_normal(nome)
        return leitura, fechou, ("o painel do /usage não mostrou números atuais em %d s" % self.ESPERA_PAINEL)

    def _status_do_codex(self, nome):
        """Um `/status` no Codex. Devolve (leitura do bloco ou None, motivo da falha)."""
        if not self._digitar(nome, "/status"):
            return None, "o /status não ficou digitado no prompt como esperado"
        self.terminais.teclar(nome, "\\n")
        enters, anterior = 1, None
        limite = self.agora() + self.ESPERA_STATUS
        while True:
            self.dormir(self.PASSO)
            olhada = self._olhar(nome)
            tela, lido, digitado, _ = olhada
            if e_menu(tela):
                self._sair_do_menu(nome)
                return None, "apareceu um menu no lugar do /status; saiu com Esc"
            bloco = ler_status_codex(tela)
            normal = bool(lido and lido["leitura"] == "ok" and lido["estado"] == "ocioso" and digitado == "")
            if not (normal and bloco and bloco["no_fim"] and bloco["sessao_5h_pct"] is not None):
                bloco = None
            # Vale o bloco no fim da conversa visto duas vezes seguidas, igual: na primeira olhada
            # o que está no fim ainda pode ser o bloco do /status anterior.
            if bloco and bloco == anterior:
                return bloco, None
            anterior = bloco
            if enters < self.MAX_ENTER and self._pronto_para_o_enter(olhada, "/status"):
                # O Enter foi engolido e o comando continua no prompt, conferido de novo agora.
                self.terminais.teclar(nome, "\\n")
                enters += 1
            elif self.agora() >= limite:
                self._apagar(nome, "/status")
                return None, "o bloco do /status não apareceu na tela"

    def _sondar_codex(self, nome):
        leitura, falha = None, None
        for rodada in range(2):     # o primeiro bloco pode ser velho; o segundo é o atual
            if rodada and not self._normal(nome)[1]:
                leitura, falha = None, "o terminal passou a ser usado no meio da sonda"
                break               # alguém começou a usar o terminal entre um e outro: para aqui
            bloco, falha = self._status_do_codex(nome)
            if not bloco:
                leitura = None      # sem a segunda leitura não há número garantidamente atual
                break
            leitura = bloco if rodada else None
        fechou = self._esperar_normal(nome)
        return leitura, fechou, falha or "o /status não apareceu na tela"

    def sondar(self, config):
        """Sonda uma conta. Devolve a leitura ({grupo: {...}}) ou None."""
        grupo = config["grupo"]
        escolhido = None
        motivos = []
        for nome in config["terminais"]:
            with self.trava:
                bloqueado = nome in self.bloqueados
            if bloqueado:
                motivos.append("%s bloqueado" % nome)
                continue
            lido, normal = self._normal(nome)       # conferido na hora, não com a leitura de 20 s atrás
            if normal:
                escolhido = nome
                break
            if lido is None or lido["leitura"] != "ok":
                motivos.append("%s sem leitura" % nome)
            elif lido["estado"] != "ocioso":
                motivos.append("%s %s" % (nome, lido["estado"]))
            else:
                motivos.append("%s com o prompt ocupado" % nome)
        if not escolhido:
            self._marcar(grupo, "pulou", "; ".join(motivos))
            return None

        with self.trava:
            self.em_sonda.add(escolhido)
        try:
            if config["ferramenta"] == "claude":
                leitura, fechou, falha = self._sondar_claude(escolhido)
            else:
                leitura, fechou, falha = self._sondar_codex(escolhido)
        finally:
            with self.trava:
                self.em_sonda.discard(escolhido)
        if not fechou:
            self._bloquear(escolhido, "a tela não voltou ao normal depois da sonda")
        if not leitura:
            self._marcar(grupo, "falhou", falha, escolhido)
            self.registrar("sonda %s (%s): falhou: %s" % (grupo, escolhido, falha))
            return None

        quando = int(self.agora())
        base = {"lido_em": quando, "terminal": escolhido}
        resultado = {grupo: dict(base, sessao_5h_pct=leitura["sessao_5h_pct"], semanal_pct=leitura["semanal_pct"],
                                 renova_sessao=renova_pt(leitura.get("renova_sessao")),
                                 renova_semanal=renova_pt(leitura.get("renova_semanal")))}
        for modelo, dado in (leitura.get("modelos") or {}).items():
            resultado["%s · %s" % (grupo, modelo)] = dict(base, sessao_5h_pct=None, semanal_pct=dado["semanal_pct"],
                                                          renova_sessao=None,
                                                          renova_semanal=renova_pt(dado.get("renova_semanal")))
        with self.trava:
            self.leituras.update(resultado)
        self._marcar(grupo, "ok", None, escolhido)
        self.registrar("sonda %s (%s): %s" % (grupo, escolhido, " · ".join(
            "%s sessão %s%% semanal %s%%" % (g, r["sessao_5h_pct"], r["semanal_pct"]) if r["sessao_5h_pct"] is not None
            else "%s semanal %s%%" % (g, r["semanal_pct"]) for g, r in resultado.items())))
        return resultado

    def rodar(self):
        for config in self.sondas:
            try:
                self.sondar(config)
            except Exception as erro:   # uma sonda ruim não para as outras nem o coletor
                self._marcar(config.get("grupo", "?"), "falhou", "%s: %s" % (type(erro).__name__, erro))
                self.registrar("sonda %s: ERRO: %s: %s" % (config.get("grupo", "?"), type(erro).__name__, erro))
