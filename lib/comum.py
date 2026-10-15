# -*- coding: utf-8 -*-
"""Peças comuns do Overview-Painel: caminhos, o mapa, gravação atômica e o quadro.json.

Só biblioteca padrão. Funciona no Python 3.9 do macOS e nos mais novos.
"""
import fcntl
import json
import os
import re
import secrets
import tempfile
import unicodedata
from datetime import datetime, timedelta
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ARQ_AGENTES = RAIZ / "agentes.json"
ARQ_AGENTES_EXEMPLO = RAIZ / "agentes.exemplo.json"     # vale enquanto não existir o agentes.json
PASTA_PUBLICA = RAIZ / "publico"

MAX_MISSAO = 120      # uma frase objetiva: o que o Agente está fazendo
MAX_MISSAO_LIDA = 280  # missão mais longa, já gravada no quadro, ainda é lida inteira
MAX_FRENTE = 60
MAX_QUEM = 40
MAX_PENDENCIA = 280
MAX_PENDENCIAS = 30

# O passo a passo de uma ação do dono do painel (arquivo de passos; veja ler_passos).
MAX_PASSOS = 12
MAX_PASSO = 400
MAX_DESTRAVA = MAX_PENDENCIA
MAX_TEMPO = 20
MAX_FONTE = 200
MAX_FONTES = 8
CAMPOS_DE_PASSOS = ("passos", "destrava", "tempo", "fontes")

SITUACOES = ("trabalhando", "parado", "esperando")


class ErroDeEntrada(ValueError):
    """Entrada inválida num comando do painel. A mensagem vai para quem chamou."""


def arquivo_do_quadro():
    return Path(os.environ.get("PAINEL_QUADRO") or RAIZ / "quadro.json")


# ---------------------------------------------------------------- tempo

def agora():
    return datetime.now().astimezone()


def iso(momento):
    return momento.isoformat(timespec="seconds")


# ---------------------------------------------------------------- nomes

def sem_acento(texto):
    decomposto = unicodedata.normalize("NFD", texto)
    return "".join(c for c in decomposto if unicodedata.category(c) != "Mn")


def slug(nome):
    """'Agente 03' -> 'agente-03'. É o nome do arquivo de tela no modo --telas."""
    return re.sub(r"[^a-z0-9]+", "-", sem_acento(nome).lower()).strip("-")


def carregar_mapa(caminho=None):
    """O mapa dos agentes (agentes.json), na ordem em que estão no arquivo."""
    if caminho is None:
        caminho = ARQ_AGENTES if ARQ_AGENTES.exists() else ARQ_AGENTES_EXEMPLO
    with open(caminho, encoding="utf-8") as f:
        mapa = json.load(f)
    for v in mapa["agentes"]:
        v["nome"] = unicodedata.normalize("NFC", v["nome"])
    return mapa


def achar_agente(nome, mapa):
    """Acha o Agente sem depender de acento, maiúscula ou hífen: 'agente 02' serve."""
    chave = slug(unicodedata.normalize("NFC", nome or ""))
    for v in mapa["agentes"]:
        if slug(v["nome"]) == chave:
            return v["nome"]
    nomes = ", ".join(v["nome"] for v in mapa["agentes"])
    raise ErroDeEntrada('Agente desconhecido: "%s". Os nomes são: %s.' % (nome, nomes))


# ---------------------------------------------------------------- arquivos

def gravar_atomico(caminho, texto):
    """Grava num temporário da mesma pasta e troca com rename: ninguém lê arquivo pela metade."""
    caminho = Path(caminho)
    caminho.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="." + caminho.name + ".", suffix=".tmp", dir=str(caminho.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(texto)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o644)
        os.replace(tmp, str(caminho))
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------- validação

def limpar_texto(texto, maximo, campo):
    """Uma linha só, sem caractere de controle, com tamanho limitado."""
    if texto is None:
        raise ErroDeEntrada("%s: faltou o texto." % campo)
    texto = unicodedata.normalize("NFC", str(texto))
    texto = re.sub(r"\s+", " ", texto).strip()
    if not texto:
        raise ErroDeEntrada("%s: o texto está vazio." % campo)
    if any(unicodedata.category(c) in ("Cc", "Cf") for c in texto):
        raise ErroDeEntrada("%s: o texto tem caractere de controle." % campo)
    if len(texto) > maximo:
        raise ErroDeEntrada("%s: %d caracteres, e o máximo é %d." % (campo, len(texto), maximo))
    return texto


def interpretar_situacao(texto):
    """'trabalhando' | 'parado' | 'esperando <quem>' -> (situação, quem ou None)."""
    limpo = limpar_texto(texto, MAX_QUEM + 20, "--situacao")
    palavras = limpo.split(" ", 1)
    chave = sem_acento(palavras[0]).lower()
    if chave in ("trabalhando", "parado"):
        if len(palavras) > 1:
            raise ErroDeEntrada('--situacao: "%s" não leva complemento.' % chave)
        return chave, None
    if chave == "esperando":
        quem = palavras[1].strip() if len(palavras) > 1 else ""
        quem = re.sub(r"^(?:o|a|os|as|pelo|pela)\s+", "", quem, flags=re.IGNORECASE)
        if not quem:
            raise ErroDeEntrada('--situacao: diga quem é esperado, por exemplo "esperando dono do painel".')
        return "esperando", limpar_texto(quem, MAX_QUEM, "--situacao")
    raise ErroDeEntrada('--situacao: use "trabalhando", "parado" ou "esperando <quem>".')


RE_PASSO = re.compile(r"^(\d{1,2})\.\s+(\S.*)$")
RE_CAMPO_DE_PASSOS = re.compile(r"^(destrava|tempo|fonte)\s*:\s*(.*)$", re.IGNORECASE)


def ler_passos(texto):
    """Lê um arquivo de passos e devolve {"passos", "destrava", "tempo", "fontes"}.

    O formato, uma coisa por linha (linha em branco é ignorada; qualquer outra é erro):
        destrava: O que isto libera para o time.        (opcional, uma vez)
        tempo: 15 min                                   (opcional, uma vez)
        1. Primeiro passo.                              (de 1 a MAX_PASSOS, numerados em ordem)
        2. Segundo passo, com `código` entre crases.
        fonte: caminho/ou/link                          (opcional, até MAX_FONTES)
    O erro diz o número da linha. Trecho entre crases vira código na página, por isso as crases
    têm de fechar.
    """
    passos, fontes, campos = [], [], {}
    for n, bruta in enumerate(str(texto).splitlines(), 1):
        linha = unicodedata.normalize("NFC", bruta).strip()
        if not linha:
            continue
        onde = "arquivo de passos, linha %d" % n
        m = RE_PASSO.match(linha)
        if m:
            if int(m.group(1)) != len(passos) + 1:
                raise ErroDeEntrada("%s: o passo está numerado %s, mas o esperado era %d." % (onde, m.group(1), len(passos) + 1))
            if len(passos) >= MAX_PASSOS:
                raise ErroDeEntrada("%s: mais de %d passos." % (onde, MAX_PASSOS))
            passos.append(_texto_do_passo(m.group(2), MAX_PASSO, onde))
            continue
        m = RE_CAMPO_DE_PASSOS.match(linha)
        if not m:
            raise ErroDeEntrada('%s: não entendi "%s". Uma linha é "N. passo", "destrava:", "tempo:" ou "fonte:".'
                                % (onde, linha if len(linha) <= 40 else linha[:39] + "…"))
        campo, valor = m.group(1).lower(), m.group(2)
        if campo == "fonte":
            if len(fontes) >= MAX_FONTES:
                raise ErroDeEntrada("%s: mais de %d fontes." % (onde, MAX_FONTES))
            fontes.append(_texto_do_passo(valor, MAX_FONTE, onde))
        elif campo in campos:
            raise ErroDeEntrada("%s: \"%s:\" repetido." % (onde, campo))
        else:
            campos[campo] = _texto_do_passo(valor, MAX_DESTRAVA if campo == "destrava" else MAX_TEMPO, onde)
    if not passos:
        raise ErroDeEntrada("arquivo de passos: nenhum passo (linha \"1. …\").")
    return {"passos": passos, "destrava": campos.get("destrava"), "tempo": campos.get("tempo"), "fontes": fontes}


def _texto_do_passo(texto, maximo, onde):
    limpo = limpar_texto(texto, maximo, onde)
    if limpo.count("`") % 2:
        raise ErroDeEntrada("%s: crase sem par." % onde)
    return limpo


def novo_id():
    """Identificador estável de uma pendência, dado na criação: a página lembra por ele qual está aberta."""
    return secrets.token_hex(4)


RE_PREVISAO = re.compile(r"^(?:(\d{1,2})/(\d{1,2})\s+)?(\d{1,2})(?:[hH:](\d{2})?)$")


def interpretar_previsao(texto, referencia=None):
    """'22h40', '22:40', '22h' ou '02/10 09h00' -> ('22h40', momento com fuso).

    Sem data, vale o próximo horário coerente: hoje, ou amanhã se a hora já passou há mais de
    12 horas (previsão "01h30" dada às 23h é de amanhã; "21h00" dada às 21h30 é de hoje, atrasada).
    """
    referencia = referencia or agora()
    m = RE_PREVISAO.match(re.sub(r"\s+", " ", str(texto)).strip())
    if not m:
        raise ErroDeEntrada('--previsao: use a hora, como "22h40", ou dia e hora, como "02/10 09h00".')
    dia, mes, hora, minuto = m.group(1), m.group(2), int(m.group(3)), int(m.group(4) or 0)
    if hora > 23 or minuto > 59:
        raise ErroDeEntrada("--previsao: hora inválida.")
    try:
        if dia:
            momento = referencia.replace(month=int(mes), day=int(dia), hour=hora, minute=minuto,
                                         second=0, microsecond=0)
            if momento < referencia - timedelta(days=180):
                momento = momento.replace(year=momento.year + 1)
        else:
            momento = referencia.replace(hour=hora, minute=minuto, second=0, microsecond=0)
            if momento < referencia - timedelta(hours=12):
                momento += timedelta(days=1)
    except ValueError:
        raise ErroDeEntrada("--previsao: data inválida.")
    return "%02dh%02d" % (hora, minuto), momento


# ---------------------------------------------------------------- quadro.json

def quadro_vazio():
    return {"versao": 1, "editado_em": None, "missoes": {}, "pendencias": []}


def carregar_quadro(caminho=None):
    """Lê o quadro. Arquivo ausente é quadro vazio; arquivo estragado levanta ValueError."""
    caminho = Path(caminho or arquivo_do_quadro())
    if not caminho.exists():
        return quadro_vazio()
    with open(caminho, encoding="utf-8") as f:
        quadro = json.load(f)
    if not isinstance(quadro, dict) or not isinstance(quadro.get("missoes", {}), dict) \
            or not isinstance(quadro.get("pendencias", []), list):
        raise ValueError("formato inesperado")
    base = quadro_vazio()
    base.update(quadro)
    return base


def editar_quadro(funcao, caminho=None):
    """Lê, aplica `funcao(quadro)` e grava de forma atômica, com trava contra edição simultânea.

    Devolve o que `funcao` devolver. Se ela levantar ErroDeEntrada, nada é gravado.
    """
    caminho = Path(caminho or arquivo_do_quadro())
    caminho.parent.mkdir(parents=True, exist_ok=True)
    with open(str(caminho) + ".trava", "w") as trava:
        fcntl.flock(trava, fcntl.LOCK_EX)
        try:
            quadro = carregar_quadro(caminho)
        except ValueError as erro:
            raise ErroDeEntrada("%s está ilegível (%s). Conserte ou apague o arquivo." % (caminho, erro))
        resultado = funcao(quadro)
        quadro["editado_em"] = iso(agora())
        gravar_atomico(caminho, json.dumps(quadro, ensure_ascii=False, indent=1) + "\n")
        return resultado
