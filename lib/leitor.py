# -*- coding: utf-8 -*-
"""Leitor de tela dos Vingadores: tira da tela de um terminal o estado, o contexto, as cotas,
o modelo e o que o agente está fazendo. Função pura: recebe o texto e a ferramenta.

Formatos (fonte: .workers/vigia/statusline.sh e VINGADORES.md):
  Claude Code   "Opus 5.5 · ctx [███░░░░░░░] 31% · 5h 2% · sem 55% · (main)"         cotas USADAS
  Antigravity   "Gemini 3.8 Flash (High) · ctx [██░░░░░░░░] 21% · idle · 5h 32% · sem 7% · (main)"
  Codex         "GPT-6.1-Sol high · Context 42% used · 5h 83% left · weekly 97% left · Working · ~/…"
                                                                              cotas RESTANTES

Regras que não podem quebrar:
  - o painel mostra tudo como USADO: no Codex, "83% left" vira 17;
  - "--%" (Claude Code antes da primeira resposta) é "sem dado" (None), nunca zero;
  - só vale a status line do próprio terminal, que fica nas últimas linhas da tela. A tela pode
    trazer, no meio, a status line de outro agente (lida com `maestri check`): ela é ignorada;
  - no Codex só vale a linha "Context NN% used|left";
  - o que não foi lido fica None. Nada é estimado.
"""
import re

LINHAS_DA_STATUS = 6    # a status line própria está entre as últimas linhas não vazias
LINHAS_FINAIS = 25      # trecho acima da status line onde fica o indicador de trabalho
MAX_ATIVIDADE = 160
MAX_FALA = 200

MARCADOR = {"claude": "⏺", "codex": "•", "agy": "●"}
AGY_TRABALHANDO = {"thinking", "working", "tool_use", "initializing", "confirmacao", "fila", "reviewing"}
ESFORCOS = {"minimal", "low", "medium", "high", "xhigh"}

RE_CTX = re.compile(r"^\s*(?P<modelo>\S.*?) · ctx \[[^\]]*\] (?P<ctx>\d{1,3}|--)%(?P<resto>.*)$")
RE_CODEX = re.compile(r"Context \d{1,3}% (?:used|left)")
RE_BORDA = re.compile(r"^\s*[─━═]{20,}")
RE_SEPARADOR = re.compile(r"^\s*[─━═_\-]{3,}\s*$")
GIRO = "·✢✳✶✻✽*"
RE_GIRO_CLAUDE = re.compile(r"^\s*[%s]\s+(?P<verbo>[^(]*…)\s*(?:\((?P<info>[^)]*)\)?)?\s*$" % re.escape(GIRO))
RE_INTERROMPER = re.compile(r"esc to (?:interrupt|cancel)")
RE_FEITO_CLAUDE = re.compile(r"^\s*[%s]\s+.* · done (\d{1,2}):(\d{2}) (AM|PM)" % re.escape(GIRO))
RE_RUIDO_CLAUDE = re.compile(r"^\s*[%s]\s" % re.escape(GIRO))
RE_CODEX_TRABALHANDO = re.compile(r"^\s*• (?:Working|Thinking)\s*\((?P<dur>[^•)]*?)\s*(?:•|\))")
RE_ITEM_DE_LISTA = re.compile(r"^\s*(?:[•◦▪\-*]|\d+[.)])\s+")
RE_AVISO_DE_LIMITE = re.compile(r"^\s*⚠\s+(.*\blimit\b.*)$", re.IGNORECASE)
RE_DURACAO = re.compile(r"^\d+\s*[smh](?:\s+\d+\s*[sm])*$")
# Trabalho em segundo plano com o agente ocioso (regra do dono do painel, 03/10/2026: esperando CI, build ou
# teste conta como trabalhando). Antigravity: "● [18:38:33] <comando> ... running"; Claude Code:
# "· 1 shell" no rodapé, abaixo da status line.
RE_AGY_SEGUNDO_PLANO = re.compile(r"^\s*[●○]\s*\[\d{1,2}:\d{2}:\d{2}\]\s+(?P<cmd>.*?)\s*(?:\.{3}|…)?\s*running\s*$")
RE_CLAUDE_SEGUNDO_PLANO = re.compile(r"·\s*(?P<n>\d+)\s+(?:shells?|background tasks?)\b")

# Segredos nunca vão para o dados.json. Na dúvida, mascara: é melhor perder um trecho da tela.
SEGREDOS = [
    re.compile(r"\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}"),
    re.compile(r"\bsk-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"\bsb[p]?_(?:secret_|publishable_)?[A-Za-z0-9_\-]{16,}"),
    re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}(?:\.[A-Za-z0-9_\-]+)?"),
    re.compile(r"\bAIza[0-9A-Za-z_\-]{30,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bxox[baprs]-[A-Za-z0-9\-]{10,}"),
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/\-]{12,}=*"),
    re.compile(r"(?i)(?<=[\s\"'(])(?:[\w.\-]*(?:senha|password|passwd|secret|segredo|token|api[_\-]?key|service_role)[\w.\-]*)"
               r"\s*[:=]\s*[\"']?[^\s\"']{4,}"),
    re.compile(r"\b[A-Fa-f0-9]{32,}\b"),
    re.compile(r"(?=[A-Za-z0-9+_=\-]*[0-9])(?=[A-Za-z0-9+_=\-]*[a-z])(?=[A-Za-z0-9+_=\-]*[A-Z])[A-Za-z0-9+_=\-]{40,}"),
]
OCULTO = "[oculto]"


def mascarar(texto):
    """Troca por [oculto] qualquer coisa com cara de token, chave ou senha."""
    if not texto:
        return texto
    texto = " " + texto     # o padrão chave=valor pede um separador antes da chave
    for padrao in SEGREDOS:
        texto = padrao.sub(OCULTO, texto)
    return texto[1:]


def _pct(texto):
    """'31' -> 31; '--' -> None; fora de 0 a 100 -> None."""
    if texto is None or not texto.isdigit():
        return None
    n = int(texto)
    return n if 0 <= n <= 100 else None


def _cortar_inicio(texto, maximo):
    return texto if len(texto) <= maximo else texto[: maximo - 1].rstrip() + "…"


def _fim_da_fala(texto, maximo):
    """As últimas frases que cabem em `maximo`: o fim da fala é o que diz como o agente parou."""
    frases = re.split(r"(?<=[.!?])\s+", texto.strip())
    escolhidas = []
    total = 0
    for frase in reversed(frases):
        if escolhidas and total + len(frase) + 1 > maximo:
            break
        escolhidas.insert(0, frase)
        total += len(frase) + 1
    resultado = " ".join(escolhidas)
    if len(resultado) > maximo:
        resultado = "…" + resultado[-(maximo - 1):].lstrip()
    elif len(escolhidas) < len(frases):
        resultado = "… " + resultado
    return resultado


def _linha_da_status(linhas, padrao):
    """Índice da status line própria: a última que casa, entre as últimas linhas não vazias."""
    nao_vazias = [i for i, linha in enumerate(linhas) if linha.strip()]
    for i in reversed(nao_vazias[-LINHAS_DA_STATUS:]):
        if padrao.search(linhas[i]):
            return i
    return None


def _conteudo(linhas, i_status, ferramenta):
    """As linhas da conversa: tudo o que vem antes da caixa do prompt."""
    fim = i_status
    inicio = max(0, i_status - 12)
    if ferramenta == "codex":
        for i in range(i_status - 1, inicio - 1, -1):
            if linhas[i].lstrip().startswith("›"):
                fim = i
                break
    else:
        bordas = [i for i in range(inicio, i_status) if RE_BORDA.match(linhas[i])]
        if bordas:
            fim = bordas[-2] if len(bordas) >= 2 else bordas[-1]
    return linhas[:fim]


# Texto que as ferramentas mostram no prompt vazio (os mesmos do vigia).
TEXTOS_DE_PROMPT_VAZIO = ("Ask Codex to do anything", "Ask a follow-up question")


def _texto_do_prompt(linha):
    """A linha do prompt sem a seta, as bordas e os espaços."""
    linha = linha.replace("\u00a0", " ")
    linha = re.sub(r"[─━═│┃╭╮╰╯…]", "", linha).strip()
    return re.sub(r"^[❯›>]\s*", "", linha).strip()


def _prompt(linhas, i_status, ferramenta):
    """(texto do prompt, índice da linha onde ele começa), ou (None, None) se não foi achado.

    O texto de prompt vazio de cada ferramenta ("Ask Codex to do anything") vem como "".
    """
    inicio = max(0, i_status - 12)
    if ferramenta == "codex":
        for i in range(i_status - 1, inicio - 1, -1):
            if linhas[i].lstrip().startswith("›"):
                texto = _texto_do_prompt(linhas[i])
                return ("" if texto in TEXTOS_DE_PROMPT_VAZIO else texto), i
        return None, None
    bordas = [i for i in range(inicio, i_status) if RE_BORDA.match(linhas[i])]
    if len(bordas) < 2:
        return None, None
    dentro = [linha for linha in linhas[bordas[-2] + 1:bordas[-1]] if linha.strip()]
    if not dentro or dentro[0].lstrip()[:1] not in ("❯", ">"):
        return None, None
    texto = " ".join(_texto_do_prompt(linha) for linha in dentro).strip()
    return ("" if texto in TEXTOS_DE_PROMPT_VAZIO else texto), bordas[-2]


def _prompt_vazio(linhas, i_status, ferramenta):
    """True se o prompt está vazio, False se tem texto, None se o prompt não foi achado.

    Quem manda tecla a um terminal (a sonda de cota) só pode fazer isso com True.
    """
    texto, _ = _prompt(linhas, i_status, ferramenta)
    return None if texto is None else texto == ""


RE_COMANDO_DO_MENU = re.compile(r"^(/\S+)(?:\s|$)")


def prompt_e_comando(texto, ferramenta):
    """O que está digitado no prompt e o comando que o Enter executaria: (digitado, destacado).

    `digitado`: "" com o prompt vazio, None se o prompt não foi achado (menu aberto, tela de
    outra coisa). `destacado`: com o menu de comandos na tela (ele abre ao digitar "/"), o
    comando marcado: no Codex, a linha com "›" acima do prompt; no Claude Code, a primeira da
    lista. None se não há menu de comandos.

    É o que a sonda de cota confere antes de mandar Enter: com só "/" no prompt, o Enter
    executaria o primeiro comando da lista (`/model` no Codex), e não o que ela quis digitar.
    """
    if ferramenta not in MARCADOR or not texto or not texto.strip():
        return None, None
    linhas = [linha.rstrip() for linha in texto.replace("\r", "").split("\n")]
    i_status = _linha_da_status(linhas, RE_CODEX if ferramenta == "codex" else RE_CTX)
    if i_status is None:
        return None, None
    digitado, i_prompt = _prompt(linhas, i_status, ferramenta)
    if digitado is None:
        return None, None
    destacado = None
    acima = range(i_prompt - 1, max(-1, i_prompt - 14), -1)
    if ferramenta == "codex":
        # O menu fica logo acima do prompt, separado dele por uma linha vazia.
        vazias = 0
        for i in acima:
            linha = linhas[i]
            if not linha.strip():
                vazias += 1
                if vazias > 1:
                    break
                continue
            if linha.lstrip().startswith("›"):
                m = RE_COMANDO_DO_MENU.match(_texto_do_prompt(linha))
                destacado = m.group(1) if m else None
                break
            if not linha.lstrip().startswith("/"):
                break
    else:
        # A lista fica colada na borda de cima do prompt; a descrição pode continuar na linha de baixo.
        for i in acima:
            linha = linhas[i]
            if not linha.strip():
                break
            m = RE_COMANDO_DO_MENU.match(linha.strip())
            if m and len(linha) - len(linha.lstrip()) <= 4:
                destacado = m.group(1)
            elif len(linha) - len(linha.lstrip()) < 20:
                destacado = None    # texto da conversa, e não a lista de comandos
                break
    return digitado, destacado


def _ultimo_bloco(conteudo, ferramenta):
    """O último parágrafo da conversa, sem as linhas de enfeite de cada ferramenta."""
    limpas = []
    pular = False
    for linha in conteudo:
        s = linha.strip()
        ruido = False
        if pular:
            ruido, pular = True, False
        elif not s or RE_SEPARADOR.match(linha) or s.startswith("⚠"):
            ruido = True        # aviso da ferramenta ("⚠ 5h limit: 49% left") não é fala do agente
        elif ferramenta == "claude":
            # giro ("✻ Cogitating… (12s)"), fecho ("✻ Worked for 54s · done 8:03 PM") e as dicas
            # alinhadas à direita ("new task? /clear to save 308.7k tokens")
            ruido = bool(RE_RUIDO_CLAUDE.match(linha)) or len(linha) - len(linha.lstrip()) >= 30
        elif ferramenta == "codex":
            # "Worked for 1h 4m 5s • 22:22" é o fecho da rodada do Codex, não fala
            ruido = bool(RE_CODEX_TRABALHANDO.match(linha)) or s.startswith("└ Tip:") or bool(re.match(r"Worked for \d", s))
        elif ferramenta == "agy" and s.startswith("▸ Thought for"):
            ruido, pular = True, True       # a linha seguinte é o resumo do raciocínio, cortado
        limpas.append("" if ruido else linha)
    while limpas and not limpas[-1]:
        limpas.pop()
    bloco = []
    for linha in reversed(limpas):
        if not linha:
            break
        bloco.insert(0, linha)
    return bloco


def _texto_do_bloco(bloco, ferramenta, com_itens):
    """Do último marcador da ferramenta (ou item de lista) até o fim do bloco, numa linha só."""
    if not bloco:
        return None
    if bloco[0].lstrip()[:1] in ("❯", "›", ">"):
        return None     # é a mensagem de quem pediu, não a atividade do agente
    marcador = MARCADOR[ferramenta]
    inicio = 0
    for i, linha in enumerate(bloco):
        if linha.lstrip().startswith(marcador + " ") or (com_itens and RE_ITEM_DE_LISTA.match(linha)):
            inicio = i
    partes = []
    for i, linha in enumerate(bloco[inicio:]):
        s = linha.strip()
        if i > 0 and (s.startswith("└") or s.startswith("⎿") or s.startswith("+ ")):
            break       # saída do comando: não é atividade
        partes.append(s)
    texto = " ".join(partes)
    texto = re.sub(r"^(?:[⏺•●◦▪\-*]|\d+[.)])\s+", "", texto)
    texto = re.sub(r"\s*\(ctrl\+[a-z] to expand\)", "", texto)
    texto = re.sub(r"\s+", " ", texto).strip()
    return texto or None


def _resultado_base(ferramenta):
    return {
        "ferramenta": ferramenta,
        "leitura": "ok",
        "motivo": None,
        "estado": "indeterminado",
        "estado_bruto": None,       # o que a ferramenta escreveu: idle, tool_use, Working...
        "modelo": None,
        "esforco": None,
        "contexto_pct": None,       # usado
        "sessao_5h_pct": None,      # usado
        "semanal_pct": None,        # usado
        "outras_cotas": {},         # rótulo -> usado (Antigravity pode trazer outros limites)
        "grupo_cota": None,         # Antigravity: "Gemini" ou "Claude/GPT"
        "branch": None,
        "prompt_vazio": None,       # True: prompt vazio; False: tem texto; None: prompt não achado
        "trabalhando_ha": None,     # "3m 26s", quando a tela diz
        "ultima_resposta_as": None,  # "20h03", só Claude Code
        "atividade": None,          # trabalhando: a última linha de atividade
        "ultima_fala": None,        # ocioso: o fim da última fala
        "aviso": None,              # aviso de limite escrito na tela
    }


def sem_leitura(ferramenta, motivo):
    r = _resultado_base(ferramenta)
    r.update(leitura="sem_leitura", estado="sem_leitura", motivo=motivo)
    return r


def _ler_linha_ctx(linha, r):
    """Claude Code e Antigravity: a linha da nossa statusline.sh."""
    m = RE_CTX.match(linha.rstrip().rstrip("─").rstrip())
    r["modelo"] = m.group("modelo").strip()
    r["contexto_pct"] = _pct(m.group("ctx"))
    for parte in (p.strip() for p in m.group("resto").split(" · ")):
        cota = re.match(r"^(\S+) (\d{1,3}|--)%$", parte)
        if cota:
            rotulo, valor = cota.group(1), _pct(cota.group(2))
            if rotulo == "5h":
                r["sessao_5h_pct"] = valor
            elif rotulo == "sem":
                r["semanal_pct"] = valor
            elif valor is not None:
                r["outras_cotas"][rotulo] = valor
        elif parte.startswith("("):
            r["branch"] = parte.strip("()… ") or None
        elif re.match(r"^[a-z_]+$", parte):
            r["estado_bruto"] = parte


def _ler_linha_codex(linha, r):
    partes = [p.strip() for p in linha.strip().split(" · ")]
    if partes and not partes[0].startswith("Context"):
        palavras = partes[0].split()
        if len(palavras) > 1 and palavras[-1] in ESFORCOS:
            r["esforco"] = palavras.pop()
        r["modelo"] = " ".join(palavras) or None
    for parte in partes:
        m = re.match(r"^(Context|5h|weekly) (\d{1,3})% (used|left)$", parte)
        if m:
            valor = _pct(m.group(2))
            if valor is not None and m.group(3) == "left":
                valor = 100 - valor     # o Codex mostra o que resta; o painel mostra o usado
            campo = {"Context": "contexto_pct", "5h": "sessao_5h_pct", "weekly": "semanal_pct"}[m.group(1)]
            r[campo] = valor
        elif parte in ("Ready", "Working", "Thinking", "Waiting"):
            r["estado_bruto"] = parte


def _hora_24(hora, minuto, periodo):
    hora = int(hora) % 12 + (12 if periodo == "PM" else 0)
    return "%02dh%s" % (hora, minuto)


def ler_tela(texto, ferramenta):
    """Lê a tela de um terminal. `ferramenta`: 'claude', 'codex' ou 'agy'."""
    if ferramenta not in MARCADOR:
        return sem_leitura(ferramenta, "ferramenta desconhecida: %s" % ferramenta)
    if not texto or not texto.strip():
        return sem_leitura(ferramenta, "tela vazia")
    linhas = [linha.rstrip() for linha in texto.replace("\r", "").split("\n")]

    i_status = _linha_da_status(linhas, RE_CODEX if ferramenta == "codex" else RE_CTX)
    if i_status is None:
        return sem_leitura(ferramenta, "status line não encontrada no fim da tela")

    r = _resultado_base(ferramenta)
    if ferramenta == "codex":
        _ler_linha_codex(linhas[i_status], r)
    else:
        _ler_linha_ctx(linhas[i_status], r)

    fim = linhas[max(0, i_status - LINHAS_FINAIS):i_status]
    conteudo = _conteudo(linhas, i_status, ferramenta)
    r["prompt_vazio"] = _prompt_vazio(linhas, i_status, ferramenta)

    if ferramenta == "claude":
        giro = None
        for linha in fim:
            m = RE_GIRO_CLAUDE.match(linha)
            if m:
                giro = m
        if giro or any(RE_INTERROMPER.search(linha) for linha in fim):
            r["estado"] = "trabalhando"
            if giro:
                r["estado_bruto"] = giro.group("verbo").strip()
                primeiro = (giro.group("info") or "").split(" · ")[0].strip()
                if RE_DURACAO.match(primeiro):
                    r["trabalhando_ha"] = primeiro
        else:
            r["estado"] = "ocioso"
        for linha in fim:
            m = RE_FEITO_CLAUDE.match(linha)
            if m:
                r["ultima_resposta_as"] = _hora_24(*m.groups())
    elif ferramenta == "codex":
        # "Waiting": esperando um terminal em segundo plano (build, teste, CI), que conta como trabalho.
        if r["estado_bruto"] in ("Working", "Thinking", "Waiting"):
            r["estado"] = "trabalhando"
        elif r["estado_bruto"] == "Ready":
            r["estado"] = "ocioso"
        for linha in fim:
            m = RE_CODEX_TRABALHANDO.match(linha)
            if m and RE_DURACAO.match(m.group("dur").strip()):
                r["trabalhando_ha"] = m.group("dur").strip()
    else:
        if r["estado_bruto"] in AGY_TRABALHANDO:
            r["estado"] = "trabalhando"
        elif r["estado_bruto"] == "idle":
            r["estado"] = "ocioso"
        r["grupo_cota"] = "Gemini" if "gemini" in (r["modelo"] or "").lower() else "Claude/GPT"

    if r["estado"] == "ocioso":
        segundo_plano = None
        if ferramenta == "agy":
            for linha in linhas[max(0, i_status - LINHAS_FINAIS):i_status]:
                m = RE_AGY_SEGUNDO_PLANO.match(linha)
                if m:
                    segundo_plano = m.group("cmd").strip()
        elif ferramenta == "claude":
            for linha in linhas[i_status:]:
                m = RE_CLAUDE_SEGUNDO_PLANO.search(linha)
                if m and int(m.group("n")) > 0:
                    segundo_plano = "%s tarefa(s) em segundo plano" % m.group("n")
        if segundo_plano:
            r["estado"] = "trabalhando"
            r["estado_bruto"] = "segundo_plano"
            r["atividade"] = _cortar_inicio(mascarar("em segundo plano: " + segundo_plano), MAX_ATIVIDADE)

    bloco = _ultimo_bloco(conteudo, ferramenta)
    if r["estado"] == "trabalhando" and r["estado_bruto"] != "segundo_plano":
        atividade = _texto_do_bloco(bloco, ferramenta, com_itens=False)
        if r["estado_bruto"] == "confirmacao":
            atividade = "aguardando confirmação de ferramenta" + (": " + atividade if atividade else "")
        elif r["estado_bruto"] == "fila":
            atividade = "mensagem na fila" + (": " + atividade if atividade else "")
        if atividade:
            r["atividade"] = _cortar_inicio(mascarar(atividade), MAX_ATIVIDADE)
    else:
        houve_conversa = any(linha.lstrip().startswith(MARCADOR[ferramenta] + " ") for linha in conteudo)
        fala = _texto_do_bloco(bloco, ferramenta, com_itens=True) if houve_conversa else None
        if fala:
            r["ultima_fala"] = _fim_da_fala(mascarar(fala), MAX_FALA)

    for linha in linhas:
        m = RE_AVISO_DE_LIMITE.match(linha)
        if m:
            r["aviso"] = _cortar_inicio(mascarar(m.group(1).strip()), MAX_ATIVIDADE)
    return r
