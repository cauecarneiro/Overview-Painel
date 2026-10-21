# -*- coding: utf-8 -*-
"""Cota por grupo: quem divide a mesma conta mostra a leitura mais recente do grupo.

O problema: a status line de um terminal só muda quando aquela sessão fala com o servidor. Um
terminal parado guarda o número de quando parou. Dois terminais da mesma conta mostram, então,
números diferentes, e o certo é o de quem falou com o servidor por último.

Como o coletor sabe quem falou por último, sem IA e sem rede:
  - "trabalhando": o terminal estava trabalhando nesta passada;
  - "mudou": o contexto, a cota ou a hora da última resposta mudaram desde a passada anterior;
  - "hora_na_tela": o coletor nunca viu o terminal falar, mas a tela do Claude Code diz a hora
    da última resposta ("done 8:03 PM"). É aproximada: a tela não diz o dia.
Vale sempre a leitura MAIS RECENTE, nunca a maior: quando a janela de 5 horas renova, o número cai.

O estado (estado.json, fora de publico/) guarda, por terminal, a última cota lida e quando ela
era fresca. Assim a leitura sobrevive a um /clear (a tela volta a "--%") e a uma reinicialização
do coletor.

A consulta à CLI (lib/contas.py, a cada 5 minutos no Claude Code e no Codex, 20 no Antigravity)
é mais uma fonte, e a melhor: pergunta o número atual à própria ferramenta, com a hora de renovar,
sem token e sem tocar em terminal nenhum. A sonda de cota (lib/sonda.py), que digita /usage num
terminal parado, ficou como reserva (desligada por padrão). As duas entram na mesma regra, a
leitura mais recente vale, e são as únicas fontes das semanais por modelo (a do Fable), que
nenhuma status line mostra.
"""
import json
from datetime import datetime, timedelta
from pathlib import Path

from comum import gravar_atomico

CAMPOS = ("sessao_5h_pct", "semanal_pct")
PAUSA_MAXIMA = 120      # s. Mudança vista depois de uma pausa maior do coletor não diz quando foi


def estado_vazio():
    return {"versao": 1, "terminais": {}, "sondas": {}}


def carregar(caminho):
    """Estado salvo, ou vazio se não existe ou está estragado (ele se refaz sozinho)."""
    try:
        with open(str(caminho), encoding="utf-8") as f:
            estado = json.load(f)
        if isinstance(estado, dict) and isinstance(estado.get("terminais"), dict):
            return estado
    except (OSError, ValueError):
        pass
    return estado_vazio()


def salvar(estado, caminho):
    gravar_atomico(Path(caminho), json.dumps(estado, ensure_ascii=False, indent=1) + "\n")


def grupo_de(v, lido):
    """O grupo de cota do terminal. Sem grupo no mapa, cada um é o seu próprio grupo.

    No Antigravity a cota é a do grupo do modelo em uso: se a tela mostra um modelo do outro
    grupo (um ajudante rodando Gemini), vale o que a tela mostra.
    """
    grupo = v.get("grupo_cota") or v["nome"]
    if v.get("ferramenta") == "agy" and lido.get("grupo_cota") and " · " in grupo:
        grupo = grupo.rsplit(" · ", 1)[0] + " · " + lido["grupo_cota"]
    return grupo


def _hora_na_tela(texto, agora):
    """'20h03' -> epoch da ocorrência mais recente dessa hora (hoje ou ontem). A tela não diz o dia."""
    try:
        hora, minuto = int(texto[:2]), int(texto[3:5])
        momento = datetime.fromtimestamp(agora).replace(hour=hora, minute=minuto, second=0, microsecond=0)
    except (TypeError, ValueError):
        return None
    if momento.timestamp() > agora + 60:
        momento -= timedelta(days=1)
    return int(min(momento.timestamp(), agora))


def _observar(registro, grupo, lido, agora):
    """Atualiza o registro de um terminal com a leitura desta passada."""
    if registro.get("grupo") != grupo:      # mudou de grupo: a cota guardada era de outra conta
        registro.update(grupo=grupo, cota={}, fresco_em=None, evidencia=None)
    if lido["leitura"] != "ok":
        return
    atual = [lido["contexto_pct"], lido["sessao_5h_pct"], lido["semanal_pct"], lido["ultima_resposta_as"]]
    anterior, visto_em = registro.get("leitura"), registro.get("visto_em")
    registro["leitura"], registro["visto_em"] = atual, int(agora)

    evidencia = None
    if lido["estado"] == "trabalhando":
        evidencia = "trabalhando"
    elif anterior is not None and anterior != atual and visto_em and agora - visto_em <= PAUSA_MAXIMA:
        evidencia = "mudou"

    if all(lido[campo] is None for campo in CAMPOS):
        return      # tela sem cota ("--%" depois de um /clear): a última cota lida continua valendo
    # A cota guardada é sempre a de uma leitura só: campo que esta tela não mostra não é herdado.
    registro["cota"] = {campo: lido[campo] for campo in CAMPOS if lido[campo] is not None}
    if evidencia:
        registro["fresco_em"], registro["evidencia"] = int(agora), evidencia
        return
    # Sem evidência nesta passada. A hora escrita na tela só entra quando o coletor ainda não sabe
    # nada do terminal, ou quando a tela mudou durante uma pausa do coletor e a hora é mais nova
    # do que o que ele sabia. Ela não é reavaliada a cada passada: "20h03" de ontem não vira hoje.
    aproximado = _hora_na_tela(lido["ultima_resposta_as"], agora)
    mudou_na_pausa = anterior is not None and anterior != atual
    if aproximado and (not registro.get("fresco_em") or (mudou_na_pausa and aproximado > registro["fresco_em"])):
        registro["fresco_em"], registro["evidencia"] = aproximado, "hora_na_tela"


def _grupo_novo():
    return {"membros": [], "origem": None, "fonte": None, "sessao_5h_pct": None, "semanal_pct": None,
            "lido_em_epoch": None, "evidencia": None, "renova_sessao": None, "renova_semanal": None,
            "renova_sessao_epoch": None, "renova_semanal_epoch": None}


RENOVACOES = ("renova_sessao", "renova_semanal", "renova_sessao_epoch", "renova_semanal_epoch")


def juntar_leituras(estado, novas):
    """Entra no estado a leitura de cada grupo, se for mais recente do que a guardada.

    `novas`: {grupo: {lido_em, terminal, sessao_5h_pct, semanal_pct, renova_*, origem?}}, da sonda
    (sem "origem") ou da CLI ("origem": "cli"). Quem leu por último vale, venha de onde vier.
    """
    guardadas = estado.setdefault("sondas", {})
    for grupo, nova in novas.items():
        if not (isinstance(nova, dict) and nova.get("lido_em")):
            continue
        velha = guardadas.get(grupo)
        if not (isinstance(velha, dict) and velha.get("lido_em")) or nova["lido_em"] >= velha["lido_em"]:
            guardadas[grupo] = dict(nova)


def atualizar(estado, mapa, leituras, agora):
    """Observa a passada e resolve os grupos.

    `leituras`: {nome: resultado do leitor}. Muda `estado` no lugar. As leituras da sonda e da CLI
    vêm de estado["sondas"]: {grupo: {sessao_5h_pct, semanal_pct, lido_em, terminal, renova_*, origem?}}.
    Devolve ({nome: grupo}, {nome: grupo da semanal por modelo}, {grupo: {membros, origem, fonte,
    sessao_5h_pct, semanal_pct, lido_em_epoch, evidencia, renova_sessao, renova_semanal, renova_*_epoch}}).
    "origem" é "tela" (status line do terminal "fonte"), "sonda" (feita no terminal "fonte") ou
    "cli" (consulta à CLI; "fonte" é o nome da ferramenta).
    Grupo sem nenhuma leitura datada fica com fonte None: a página mostra a leitura crua de cada um.
    """
    terminais = estado.setdefault("terminais", {})
    sondas = estado.setdefault("sondas", {})
    grupo_do = {}
    grupo_semanal_do = {}
    grupos = {}
    na_tela = set()
    for v in mapa["vingadores"]:
        nome = v["nome"]
        lido = leituras[nome]
        grupo = grupo_de(v, lido)
        grupo_do[nome] = grupo
        _observar(terminais.setdefault(nome, {}), grupo, lido, agora)
        grupos.setdefault(grupo, _grupo_novo())["membros"].append(nome)
        na_tela.add(grupo)
        if v.get("semanal_do_modelo"):      # a semanal própria do modelo: só a sonda lê
            proprio = "%s · %s" % (grupo, v["semanal_do_modelo"])
            grupo_semanal_do[nome] = proprio
            grupos.setdefault(proprio, _grupo_novo())["membros"].append(nome)

    for grupo, g in grupos.items():
        melhor = None
        for nome in (g["membros"] if grupo in na_tela else []):
            registro = terminais[nome]
            if registro.get("fresco_em") and registro.get("cota") and (
                    melhor is None or registro["fresco_em"] > terminais[melhor]["fresco_em"]):
                melhor = nome
        sonda = sondas.get(grupo)
        if not (isinstance(sonda, dict) and sonda.get("lido_em")):
            sonda = None
        if sonda and (melhor is None or sonda["lido_em"] >= terminais[melhor]["fresco_em"]):
            origem = sonda.get("origem") or "sonda"
            g.update(origem=origem, fonte=sonda.get("terminal"), lido_em_epoch=sonda["lido_em"], evidencia=origem)
            g.update({campo: sonda.get(campo) for campo in RENOVACOES})
            for campo in CAMPOS:
                g[campo] = sonda.get(campo)
        elif melhor:
            registro = terminais[melhor]
            g.update(origem="tela", fonte=melhor, lido_em_epoch=registro["fresco_em"], evidencia=registro["evidencia"])
            for campo in CAMPOS:
                g[campo] = registro["cota"].get(campo)
            if sonda:   # a hora de renovar só a sonda e a CLI sabem; continua valendo como informação
                g.update({campo: sonda.get(campo) for campo in RENOVACOES})
    return grupo_do, grupo_semanal_do, grupos
