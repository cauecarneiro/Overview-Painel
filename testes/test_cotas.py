# -*- coding: utf-8 -*-
"""Testes da cota por grupo e da sonda de cota.

Rodar:  python3 -m unittest discover -s testes -v      (na pasta do painel)

As telas de telas-de-exemplo/sonda/ são reais (Agente 02 e Agente 05, 01/10/2026 às 22h10). As do
comando digitado e dos menus, em testes/telas/, também: Codex 0.160.0 e Claude Code 2.1.287,
tiradas em 02/10/2026 de um terminal isolado. A sonda é testada com terminais falsos: nenhum
teste manda tecla a terminal de verdade.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(RAIZ / "lib"))

import comum    # noqa: E402
import cotas    # noqa: E402
import leitor   # noqa: E402
import sonda    # noqa: E402

REAIS = RAIZ / "telas-de-exemplo"
BORDA = "─" * 120
T0 = int(datetime(2026, 10, 1, 21, 0, 0).timestamp())      # um instante qualquer, para os relógios dos testes


def tela(nome):
    return (REAIS / (nome + ".txt")).read_text(encoding="utf-8")


def lido(ferramenta="claude", estado="ocioso", ctx=30, cinco=10, semana=50, resposta=None, grupo=None, leitura="ok"):
    """Uma leitura do leitor, só com o que a cota usa."""
    if leitura != "ok":
        return leitor.sem_leitura(ferramenta, "sem conexão com este terminal")
    r = leitor._resultado_base(ferramenta)
    r.update(estado=estado, contexto_pct=ctx, sessao_5h_pct=cinco, semanal_pct=semana, ultima_resposta_as=resposta,
             grupo_cota=grupo, prompt_vazio=True)
    return r


MAPA = {"agentes": [
    {"nome": "Agente 01", "ferramenta": "claude", "grupo_cota": "Claude Max 5x"},
    {"nome": "Agente 02", "ferramenta": "claude", "grupo_cota": "Claude Max 5x"},
    {"nome": "Agente 03", "ferramenta": "claude", "grupo_cota": "Claude Max 5x", "semanal_do_modelo": "Opus"},
    {"nome": "Agente 06", "ferramenta": "agy", "grupo_cota": "k@example.com · Gemini"},
    {"nome": "Agente 10", "ferramenta": "agy", "grupo_cota": "k@example.com · Claude/GPT"},
]}


def passada(estado, agora, **leituras):
    padrao = {"Agente 01": lido(leitura="x"), "Agente 02": lido(leitura="x"), "Agente 03": lido(leitura="x"),
              "Agente 06": lido(leitura="x"), "Agente 10": lido(leitura="x")}
    nomes = {"agente_01": "Agente 01", "agente_02": "Agente 02", "agente_03": "Agente 03", "agente_06": "Agente 06", "agente_10": "Agente 10"}
    for chave, valor in leituras.items():
        padrao[nomes[chave]] = valor
    return cotas.atualizar(estado, MAPA, padrao, agora)


class Agrupamento(unittest.TestCase):
    def test_o_grupo_mostra_a_leitura_mais_recente(self):
        estado = cotas.estado_vazio()
        # 20h03: o Agente 02 trabalha e para com 2% e 55%. O Agente 01 está parado, com números mais velhos.
        passada(estado, T0, agente_02=lido(estado="trabalhando", cinco=2, semana=55), agente_01=lido(cinco=1, semana=54))
        # Duas horas depois o Agente 01 trabalha: 15% e 58%. A tela do Agente 02 continua em 2% e 55%.
        _, _, grupos = passada(estado, T0 + 7200, agente_02=lido(cinco=2, semana=55),
                               agente_01=lido(estado="trabalhando", cinco=15, semana=58))
        g = grupos["Claude Max 5x"]
        self.assertEqual((g["sessao_5h_pct"], g["semanal_pct"]), (15, 58))
        self.assertEqual((g["origem"], g["fonte"], g["lido_em_epoch"], g["evidencia"]),
                         ("tela", "Agente 01", T0 + 7200, "trabalhando"))
        self.assertEqual(g["membros"], ["Agente 01", "Agente 02", "Agente 03"])
        # O Agente 01 para. Uma hora depois ninguém falou: a leitura continua a dele, com a idade dela.
        _, _, grupos = passada(estado, T0 + 10800, agente_02=lido(cinco=2, semana=55), agente_01=lido(cinco=15, semana=58))
        g = grupos["Claude Max 5x"]
        self.assertEqual((g["sessao_5h_pct"], g["fonte"], g["lido_em_epoch"]), (15, "Agente 01", T0 + 7200))

    def test_depois_da_renovacao_vale_a_mais_nova_e_nao_a_maior(self):
        estado = cotas.estado_vazio()
        passada(estado, T0, agente_02=lido(estado="trabalhando", cinco=92, semana=60))
        # A janela de 5 horas renovou: o Agente 01 fala com o servidor e a sessão dele está em 3%.
        _, _, grupos = passada(estado, T0 + 3600, agente_02=lido(cinco=92, semana=60),
                               agente_01=lido(estado="trabalhando", cinco=3, semana=61))
        g = grupos["Claude Max 5x"]
        self.assertEqual((g["sessao_5h_pct"], g["semanal_pct"], g["fonte"]), (3, 61, "Agente 01"))

    def test_numero_que_muda_na_tela_tambem_e_leitura_nova(self):
        estado = cotas.estado_vazio()
        passada(estado, T0, agente_02=lido(estado="trabalhando", cinco=10), agente_01=lido(cinco=9))
        # O Agente 01 respondeu entre duas passadas: nunca foi visto trabalhando, mas o número mudou.
        _, _, grupos = passada(estado, T0 + 20, agente_02=lido(cinco=10), agente_01=lido(cinco=11))
        g = grupos["Claude Max 5x"]
        self.assertEqual((g["sessao_5h_pct"], g["fonte"], g["evidencia"]), (11, "Agente 01", "mudou"))

    def test_mudanca_vista_depois_de_pausa_longa_do_coletor_nao_ganha_data_de_agora(self):
        estado = cotas.estado_vazio()
        passada(estado, T0, agente_02=lido(estado="trabalhando", cinco=10), agente_01=lido(cinco=9))
        passada(estado, T0 + 20, agente_02=lido(cinco=10), agente_01=lido(cinco=9))
        # O coletor ficou 3 horas parado. A tela do Agente 01 mudou, mas não dá para saber quando.
        _, _, grupos = passada(estado, T0 + 10800, agente_02=lido(estado="trabalhando", cinco=40), agente_01=lido(cinco=30))
        self.assertEqual(grupos["Claude Max 5x"]["fonte"], "Agente 02")

    def test_titular_e_ajudante_do_antigravity_ficam_separados(self):
        estado = cotas.estado_vazio()
        _, _, grupos = passada(estado, T0,
                               agente_06=lido("agy", "trabalhando", cinco=32, semana=7, grupo="Gemini"),
                               agente_10=lido("agy", "trabalhando", cinco=0, semana=0, grupo="Claude/GPT"))
        self.assertEqual(grupos["k@example.com · Gemini"]["membros"], ["Agente 06"])
        self.assertEqual(grupos["k@example.com · Claude/GPT"]["membros"], ["Agente 10"])
        self.assertEqual((grupos["k@example.com · Gemini"]["sessao_5h_pct"], grupos["k@example.com · Gemini"]["semanal_pct"]), (32, 7))
        self.assertEqual((grupos["k@example.com · Claude/GPT"]["sessao_5h_pct"], grupos["k@example.com · Claude/GPT"]["semanal_pct"]), (0, 0))

    def test_ajudante_rodando_gemini_entra_no_grupo_do_titular(self):
        estado = cotas.estado_vazio()
        grupo_do, _, grupos = passada(estado, T0, agente_06=lido("agy", cinco=32, semana=7, grupo="Gemini"),
                                      agente_10=lido("agy", "trabalhando", cinco=40, semana=8, grupo="Gemini"))
        self.assertEqual(grupo_do["Agente 10"], "k@example.com · Gemini")
        self.assertEqual(grupos["k@example.com · Gemini"]["membros"], ["Agente 06", "Agente 10"])
        self.assertEqual(grupos["k@example.com · Gemini"]["sessao_5h_pct"], 40)

    def test_grupo_sem_evidencia_nao_escolhe_ninguem(self):
        estado = cotas.estado_vazio()
        _, _, grupos = passada(estado, T0, agente_06=lido("agy", cinco=32, semana=7, grupo="Gemini"))
        g = grupos["k@example.com · Gemini"]
        self.assertEqual((g["fonte"], g["sessao_5h_pct"], g["lido_em_epoch"]), (None, None, None))

    def test_a_cota_sobrevive_ao_clear_e_a_sem_leitura(self):
        estado = cotas.estado_vazio()
        passada(estado, T0, agente_03=lido(estado="trabalhando", cinco=19, semana=59), agente_02=lido(cinco=2, semana=55))
        # /clear: a tela da Agente 03 volta a "--%". Depois o terminal dela some. A última leitura continua.
        _, _, grupos = passada(estado, T0 + 20, agente_03=lido(ctx=None, cinco=None, semana=None), agente_02=lido(cinco=2, semana=55))
        self.assertEqual((grupos["Claude Max 5x"]["sessao_5h_pct"], grupos["Claude Max 5x"]["fonte"]), (19, "Agente 03"))
        # Sessão nova, primeira mensagem, ainda sem resposta: trabalhando com "--%" não é leitura.
        _, _, grupos = passada(estado, T0 + 40, agente_03=lido(estado="trabalhando", ctx=None, cinco=None, semana=None))
        g = grupos["Claude Max 5x"]
        self.assertEqual((g["sessao_5h_pct"], g["semanal_pct"], g["lido_em_epoch"]), (19, 59, T0))
        _, _, grupos = passada(estado, T0 + 60)
        self.assertEqual(grupos["Claude Max 5x"]["sessao_5h_pct"], 19)

    def test_hora_na_tela_vale_na_partida_e_nao_e_reavaliada(self):
        estado = cotas.estado_vazio()
        agora = int(datetime(2026, 10, 1, 22, 0, 0).timestamp())
        # O coletor acabou de subir e todos estão parados. A tela do Claude Code diz a hora da última resposta.
        _, _, grupos = passada(estado, agora, agente_02=lido(cinco=2, semana=55, resposta="20h03"),
                               agente_01=lido(cinco=15, semana=58, resposta="21h44"))
        g = grupos["Claude Max 5x"]
        self.assertEqual((g["sessao_5h_pct"], g["fonte"], g["evidencia"]), (15, "Agente 01", "hora_na_tela"))
        self.assertEqual(g["lido_em_epoch"], int(datetime(2026, 10, 1, 21, 44, 0).timestamp()))
        # No dia seguinte, às 21h50, a tela ainda diz "21h44": continua sendo a de ontem.
        amanha = int(datetime(2026, 10, 2, 21, 50, 0).timestamp())
        _, _, grupos = passada(estado, amanha, agente_02=lido(cinco=2, semana=55, resposta="20h03"),
                               agente_01=lido(cinco=15, semana=58, resposta="21h44"))
        self.assertEqual(grupos["Claude Max 5x"]["lido_em_epoch"], int(datetime(2026, 10, 1, 21, 44, 0).timestamp()))

    def test_hora_que_ainda_nao_chegou_hoje_e_de_ontem(self):
        agora = int(datetime(2026, 10, 1, 9, 0, 0).timestamp())
        self.assertEqual(cotas._hora_na_tela("20h03", agora), int(datetime(2026, 9, 30, 20, 3, 0).timestamp()))
        self.assertIsNone(cotas._hora_na_tela(None, agora))

    def test_estado_salvo_e_recarregado(self):
        with tempfile.TemporaryDirectory() as pasta:
            caminho = Path(pasta) / "estado.json"
            estado = cotas.carregar(caminho)        # não existe: começa vazio
            passada(estado, T0, agente_01=lido(estado="trabalhando", cinco=15, semana=58))
            cotas.salvar(estado, caminho)
            outro = cotas.carregar(caminho)         # o coletor reiniciou
            _, _, grupos = passada(outro, T0 + 600, agente_01=lido(cinco=15, semana=58), agente_02=lido(cinco=2, semana=55))
            self.assertEqual((grupos["Claude Max 5x"]["sessao_5h_pct"], grupos["Claude Max 5x"]["lido_em_epoch"]), (15, T0))
            caminho.write_text("{ estragado", encoding="utf-8")
            self.assertEqual(cotas.carregar(caminho)["terminais"], {})


class SondaNoAgrupamento(unittest.TestCase):
    def sondado(self, estado, quando):
        estado["sondas"].update({
            "Claude Max 5x": {"sessao_5h_pct": 19, "semanal_pct": 59, "lido_em": quando, "terminal": "Agente 02",
                              "renova_sessao": "00h19", "renova_semanal": "06/10 às 09h59"},
            "Claude Max 5x · Opus": {"sessao_5h_pct": None, "semanal_pct": 5, "lido_em": quando, "terminal": "Agente 02",
                                      "renova_sessao": None, "renova_semanal": "06/10 às 09h59"},
        })

    def test_sonda_mais_recente_vale_para_o_grupo_e_a_semanal_do_opus_e_separada(self):
        estado = cotas.estado_vazio()
        passada(estado, T0, agente_01=lido(estado="trabalhando", cinco=15, semana=58))
        self.sondado(estado, T0 + 300)
        _, grupo_semanal_do, grupos = passada(estado, T0 + 320, agente_01=lido(cinco=15, semana=58), agente_02=lido(cinco=2, semana=55))
        g = grupos["Claude Max 5x"]
        self.assertEqual((g["origem"], g["fonte"], g["sessao_5h_pct"], g["semanal_pct"], g["lido_em_epoch"]),
                         ("sonda", "Agente 02", 19, 59, T0 + 300))
        self.assertEqual((g["renova_sessao"], g["renova_semanal"]), ("00h19", "06/10 às 09h59"))
        self.assertEqual(grupo_semanal_do, {"Agente 03": "Claude Max 5x · Opus"})
        opus = grupos["Claude Max 5x · Opus"]
        self.assertEqual((opus["origem"], opus["semanal_pct"], opus["sessao_5h_pct"], opus["membros"]),
                         ("sonda", 5, None, ["Agente 03"]))

    def test_status_line_mais_nova_do_que_a_sonda_vale_para_o_plano_mas_o_opus_continua_da_sonda(self):
        estado = cotas.estado_vazio()
        self.sondado(estado, T0)
        _, _, grupos = passada(estado, T0 + 120, agente_01=lido(estado="trabalhando", cinco=21, semana=59))
        g = grupos["Claude Max 5x"]
        self.assertEqual((g["origem"], g["fonte"], g["sessao_5h_pct"], g["lido_em_epoch"]), ("tela", "Agente 01", 21, T0 + 120))
        self.assertEqual(g["renova_sessao"], "00h19")       # a hora de renovar continua a que a sonda leu
        self.assertEqual((grupos["Claude Max 5x · Opus"]["semanal_pct"], grupos["Claude Max 5x · Opus"]["lido_em_epoch"]), (5, T0))

    def test_sem_leitura_da_sonda_o_opus_fica_vazio(self):
        estado = cotas.estado_vazio()
        _, _, grupos = passada(estado, T0, agente_03=lido(estado="trabalhando", cinco=19, semana=59))
        self.assertIsNone(grupos["Claude Max 5x · Opus"]["fonte"])     # a página cai na semanal geral, com o rótulo "geral"
        self.assertEqual(grupos["Claude Max 5x"]["semanal_pct"], 59)


class Leitores(unittest.TestCase):
    def test_usage_do_claude_tela_real(self):
        r = sonda.ler_usage_claude(tela("sonda/claude-usage"))
        self.assertFalse(r["atualizando"])
        self.assertEqual((r["sessao_5h_pct"], r["semanal_pct"]), (19, 59))
        self.assertEqual(r["modelos"], {"Opus": {"semanal_pct": 5, "renova_semanal": "Oct 6 at 9:59am"}})
        self.assertEqual((r["renova_sessao"], r["renova_semanal"]), ("12:19am", "Oct 6 at 9:59am"))

    def test_usage_do_claude_ainda_atualizando_traz_numero_velho(self):
        r = sonda.ler_usage_claude(tela("sonda/claude-usage-refreshing"))
        self.assertTrue(r["atualizando"])       # 2% e 55% são os velhos: a sonda não usa
        self.assertEqual((r["sessao_5h_pct"], r["semanal_pct"], r["modelos"]), (2, 55, {}))

    def test_usage_do_claude_no_resumo_de_uma_linha_por_limite(self):
        r = sonda.ler_usage_claude(
            "Current session              17% used   Resets 12:20am (America/Sao_Paulo)\n"
            "Current week (all models)    58% used   Resets Oct 6 at 10am (America/Sao_Paulo)\n"
            "Current week (Opus)          5% used   Resets Oct 6 at 10am (America/Sao_Paulo)\n")
        self.assertEqual((r["sessao_5h_pct"], r["semanal_pct"], r["modelos"]["Opus"]["semanal_pct"]), (17, 58, 5))
        self.assertEqual((r["renova_sessao"], r["renova_semanal"]), ("12:20am", "Oct 6 at 10am"))

    def test_tela_comum_nao_e_painel(self):
        self.assertIsNone(sonda.ler_usage_claude(tela("agente-02")))
        self.assertIsNone(sonda.ler_usage_claude(""))
        self.assertIsNone(sonda.ler_status_codex(tela("agente-05")))

    def test_status_do_codex_le_o_ultimo_bloco_e_converte_para_usado(self):
        r = sonda.ler_status_codex(tela("sonda/codex-status"))      # dois blocos: 61%/94% left e, abaixo, 55%/93% left
        self.assertEqual(r["blocos"], 2)
        self.assertEqual((r["sessao_5h_pct"], r["semanal_pct"]), (45, 7))
        self.assertEqual((r["renova_sessao"], r["renova_semanal"]), ("01:24 on 2 Oct", "20:24 on 8 Oct"))

    def test_hora_de_renovar_em_portugues(self):
        casos = {"12:19am": "00h19", "12:20pm": "12h20", "9am": "09h00", "Oct 6 at 9:59am": "06/10 às 09h59",
                 "Oct 6 at 10am": "06/10 às 10h00", "01:24 on 2 Oct": "02/10 às 01h24", "20:24": "20h24",
                 "algum formato novo": "algum formato novo", None: None}
        for entrada, saida in casos.items():
            self.assertEqual(sonda.renova_pt(entrada), saida, entrada)

    def test_fecho_e_aviso_do_codex_nao_sao_fala(self):
        # Visto no Agente 04 em 01/10: a "última fala" saía "Worked for 1h 4m 5s • 22:22 ⚠ 5h limit: …".
        codex = ("• Entreguei o PR 47 e fico parado.\n\nWorked for 1h 4m 5s • 22:22\n"
                 "⚠ 5h limit: 49% left · resets at 01:24 on 2 Oct · /status\n\n› Ask Codex to do anything\n\n"
                 "  GPT-6.1-Sol high · Context 44% used · 5h 49% left · weekly 92% left · Ready · ~/x\n")
        r = leitor.ler_tela(codex, "codex")
        self.assertEqual((r["estado"], r["ultima_fala"]), ("ocioso", "Entreguei o PR 47 e fico parado."))

    def test_prompt_vazio(self):
        for nome, ferramenta in (("agente-02", "claude"), ("agente-03", "claude"), ("agente-05", "codex"),
                                 ("agente-04", "codex"), ("agente-06", "agy"), ("agente-10", "agy"), ("sonda/codex-status", "codex")):
            self.assertIs(leitor.ler_tela(tela(nome), ferramenta)["prompt_vazio"], True, nome)
        com_texto = "⏺ feito\n\n%s\n❯ rode os testes de novo\n%s\n  Opus 5.5 · ctx [███░░░░░░░] 31%% · 5h 2%% · sem 55%% · (main)\n" % (BORDA, BORDA)
        self.assertIs(leitor.ler_tela(com_texto, "claude")["prompt_vazio"], False)
        codex = "• Ran x\n\n› rode os testes\n\n  GPT-6.1-Sol high · Context 42% used · 5h 83% left · weekly 97% left · Ready · ~/x\n"
        self.assertIs(leitor.ler_tela(codex, "codex")["prompt_vazio"], False)
        sem_prompt = "⏺ feito\n\n  Do you want to proceed?\n  1. Yes\n  Opus 5.5 · ctx [███░░░░░░░] 31% · 5h 2% · sem 55% · (main)\n"
        self.assertIsNone(leitor.ler_tela(sem_prompt, "claude")["prompt_vazio"])


# ---------------------------------------------------------------- a sonda, com terminais falsos

class Relogio:
    def __init__(self):
        self.t = float(T0)

    def agora(self):
        return self.t

    def dormir(self, segundos):
        self.t += segundos


def tela_de_teste(nome):
    return (RAIZ / "testes" / "telas" / (nome + ".txt")).read_text(encoding="utf-8")


def _apagados(bruto):
    """Quantos Backspaces há numa tecla que é só Backspace; None se for outra coisa."""
    return bruto.count("\\x7f") if bruto and not bruto.replace("\\x7f", "") else None


class ClaudeFalso:
    """Um terminal do Claude Code: o /usage digitado fica no prompt, Enter abre o painel, que
    atualiza depois de umas olhadas, e Esc fecha. As telas do comando digitado são do Claude
    Code 2.1.287 (02/10/2026)."""

    def __init__(self, normal=None, olhadas_atualizando=2, abre=True, fecha=True, chega="/usage"):
        self.normal = normal or tela("agente-02")
        self.olhadas_atualizando, self.abre, self.fecha = olhadas_atualizando, abre, fecha
        self.chega = chega      # o que de fato aparece no prompt quando a sonda digita "/usage"
        self.painel, self.olhadas, self.digitado = False, 0, ""
        self.comando_errado = False     # um Enter com só "/" no prompt executaria o primeiro da lista

    def tecla(self, bruto):
        if self.painel:
            if bruto == "\\e" and self.fecha:
                self.painel = False
        elif bruto == "/usage":
            self.digitado += self.chega
        elif _apagados(bruto):
            self.digitado = self.digitado[:-_apagados(bruto)]
        elif bruto == "\\n" and self.digitado == "/usage" and self.abre:
            self.painel, self.olhadas, self.digitado = True, 0, ""
        elif bruto == "\\n" and self.digitado == "/":
            self.comando_errado = True

    def tela(self):
        if self.painel:
            self.olhadas += 1
            return tela("sonda/claude-usage-refreshing" if self.olhadas <= self.olhadas_atualizando else "sonda/claude-usage")
        if self.digitado == "/usage":
            return tela_de_teste("claude-usage-digitado")
        if self.digitado == "/":
            return tela_de_teste("claude-so-a-barra")
        return self.normal


class CodexFalso:
    """Um terminal do Codex, com a tela real de cada estado. O que cada tecla faz foi visto no
    Codex 0.160.0 em 02/10/2026: com o menu de comandos aberto, Enter executa o comando marcado;
    com só "/" no prompt o marcado é o /model; no menu de modelo, Enter abre o de nível de
    raciocínio, e ali Enter troca o modelo. Esc volta um nível de menu por vez."""

    def __init__(self, normal=None, chega="/status", engole=0, abre_menu=None, esc_fecha=True):
        self.normal = normal or tela("agente-05")
        self.chega = chega          # o que de fato aparece no prompt quando a sonda digita "/status"
        self.engole = engole        # quantos Enters o Codex engole antes de executar o comando
        self.abre_menu = abre_menu  # o menu que aparece no lugar do bloco do /status
        self.esc_fecha = esc_fecha
        self.digitado, self.blocos, self.menu, self.trocou_o_modelo = "", 0, None, False

    def tecla(self, bruto):
        if self.menu:
            if bruto == "\\e" and self.esc_fecha:
                self.menu = "modelo" if self.menu == "raciocinio" else None
            elif bruto == "\\n":
                self.trocou_o_modelo = self.trocou_o_modelo or self.menu == "raciocinio"
                self.menu = "raciocinio" if self.menu == "modelo" else None
        elif bruto == "/status":
            self.digitado += self.chega
        elif _apagados(bruto):
            self.digitado = self.digitado[:-_apagados(bruto)]
        elif bruto == "\\n" and self.digitado == "/":
            self.digitado, self.menu = "", "modelo"
        elif bruto == "\\n" and self.digitado == "/status":
            if self.engole:
                self.engole -= 1
            elif self.abre_menu:
                self.digitado, self.menu = "", self.abre_menu
            else:
                self.digitado, self.blocos = "", self.blocos + 1

    def tela(self):
        if self.menu:
            return tela_de_teste("codex-menu-de-modelo" if self.menu == "modelo" else "codex-menu-de-raciocinio")
        if self.digitado == "/status":
            return tela_de_teste("codex-status-digitado-com-menu")
        if self.digitado == "/":
            return tela_de_teste("codex-so-a-barra")
        if self.blocos >= 2:
            return tela("sonda/codex-status")       # dois blocos: o de baixo é o atual
        if self.blocos == 1:        # só o primeiro bloco, o do número velho
            texto = tela("sonda/codex-status")
            return texto.replace("55% left", "61% left").replace("93% left", "94% left")
        return self.normal


class TerminaisFalso:
    def __init__(self, **terminais):
        self.terminais = terminais
        self.enviado = []

    def ver(self, nome):
        return self.terminais[nome].tela() if nome in self.terminais else None

    def teclar(self, nome, bruto):
        self.enviado.append((nome, bruto))
        self.terminais[nome].tecla(bruto)
        return True


MAPA_SONDA = {
    "agentes": [{"nome": "Agente 01", "ferramenta": "claude"}, {"nome": "Agente 02", "ferramenta": "claude"},
                   {"nome": "Agente 03", "ferramenta": "claude"}, {"nome": "Agente 05", "ferramenta": "codex"}],
    "sondas": [{"grupo": "Claude Max 5x", "ferramenta": "claude", "terminais": ["Agente 02", "Agente 03"]},
               {"grupo": "Codex Plus", "ferramenta": "codex", "terminais": ["Agente 05"]}],
}
TRABALHANDO = (RAIZ / "testes" / "telas" / "claude-trabalhando.txt").read_text(encoding="utf-8")
# A tela do Agente 02 com um rascunho digitado no prompt (a última linha que começa com a seta).
_linhas = tela("agente-02").split("\n")
_i = max(i for i, linha in enumerate(_linhas) if linha.startswith("❯"))
PROMPT_OCUPADO = "\n".join(_linhas[:_i] + ["❯ rascunho do dono do painel"] + _linhas[_i + 1:])


class SondaComTerminaisFalsos(unittest.TestCase):
    def montar(self, **terminais):
        self.relogio = Relogio()
        self.registro = []
        self.terminais = TerminaisFalso(**terminais)
        self.sonda = sonda.Sonda(MAPA_SONDA, terminais=self.terminais, registrar=self.registro.append,
                                 dormir=self.relogio.dormir, agora=self.relogio.agora)
        return self.sonda

    def test_claude_espera_o_refreshing_le_e_fecha(self):
        s = self.montar(**{"Agente 02": ClaudeFalso(), "Agente 03": ClaudeFalso()})
        resultado = s.sondar(MAPA_SONDA["sondas"][0])
        # O comando vai sem Enter; o Enter só depois de a tela mostrar "/usage" no prompt.
        self.assertEqual(self.terminais.enviado, [("Agente 02", "/usage"), ("Agente 02", "\\n"), ("Agente 02", "\\e")])
        g = resultado["Claude Max 5x"]
        self.assertEqual((g["sessao_5h_pct"], g["semanal_pct"], g["terminal"]), (19, 59, "Agente 02"))     # e não 2% e 55%
        self.assertEqual((g["renova_sessao"], g["renova_semanal"]), ("00h19", "06/10 às 09h59"))
        self.assertEqual(resultado["Claude Max 5x · Opus"]["semanal_pct"], 5)
        self.assertIsNone(resultado["Claude Max 5x · Opus"]["sessao_5h_pct"])
        leituras, situacao, bloqueados, em_sonda = s.foto()
        self.assertEqual(situacao["Claude Max 5x"]["situacao"], "ok")
        self.assertEqual((bloqueados, em_sonda), ({}, set()))
        self.assertFalse(self.terminais.terminais["Agente 02"].painel)       # o painel fechou

    def test_nada_e_enviado_a_quem_trabalha_ou_tem_o_prompt_ocupado(self):
        s = self.montar(**{"Agente 02": ClaudeFalso(normal=TRABALHANDO), "Agente 03": ClaudeFalso(normal=PROMPT_OCUPADO)})
        self.assertIsNone(s.sondar(MAPA_SONDA["sondas"][0]))
        self.assertEqual(self.terminais.enviado, [])
        situacao = s.foto()[1]["Claude Max 5x"]
        self.assertEqual(situacao["situacao"], "pulou")
        self.assertIn("Agente 02 trabalhando", situacao["detalhe"])
        self.assertIn("Agente 03 com o prompt ocupado", situacao["detalhe"])

    def test_agente_02_ocupado_passa_para_o_03_e_nunca_para_o_01(self):
        s = self.montar(**{"Agente 01": ClaudeFalso(), "Agente 02": ClaudeFalso(normal=TRABALHANDO), "Agente 03": ClaudeFalso()})
        resultado = s.sondar(MAPA_SONDA["sondas"][0])
        self.assertEqual(resultado["Claude Max 5x"]["terminal"], "Agente 03")
        self.assertEqual({nome for nome, _ in self.terminais.enviado}, {"Agente 03"})

    def test_terminal_sem_conexao_e_pulado(self):
        s = self.montar(**{"Agente 03": ClaudeFalso(normal=TRABALHANDO)})     # o Agente 02 nem existe nos terminais falsos
        self.assertIsNone(s.sondar(MAPA_SONDA["sondas"][0]))
        self.assertEqual(self.terminais.enviado, [])
        self.assertIn("Agente 02 sem leitura", s.foto()[1]["Claude Max 5x"]["detalhe"])

    def test_painel_que_nao_fecha_bloqueia_o_terminal(self):
        s = self.montar(**{"Agente 02": ClaudeFalso(fecha=False), "Agente 03": ClaudeFalso(normal=TRABALHANDO)})
        resultado = s.sondar(MAPA_SONDA["sondas"][0])
        self.assertEqual(resultado["Claude Max 5x"]["sessao_5h_pct"], 19)   # leu, mas a tela não voltou ao normal
        self.assertIn("Agente 02", s.foto()[2])
        self.assertTrue(any("NÃO voltou ao normal" in linha for linha in self.registro))
        enviados = list(self.terminais.enviado)
        self.assertEqual(enviados, [("Agente 02", "/usage"), ("Agente 02", "\\n"), ("Agente 02", "\\e")])    # um Esc só
        # Na rodada seguinte nada mais vai para o Agente 02, mesmo que ele pareça livre.
        self.terminais.terminais["Agente 02"].painel = False
        self.assertIsNone(s.sondar(MAPA_SONDA["sondas"][0]))
        self.assertEqual(self.terminais.enviado, enviados)
        self.assertIn("Agente 02 bloqueado", s.foto()[1]["Claude Max 5x"]["detalhe"])
        # Quando uma leitura comum do coletor o vê normal, ele volta a ser sondado.
        s.liberar_quem_voltou({"Agente 02": leitor.ler_tela(tela("agente-02"), "claude")})
        self.assertEqual(s.foto()[2], {})
        self.terminais.terminais["Agente 02"].fecha = True
        self.assertEqual(s.sondar(MAPA_SONDA["sondas"][0])["Claude Max 5x"]["terminal"], "Agente 02")

    def test_prompt_que_nao_ficou_com_o_comando_nao_recebe_enter_nem_esc_e_bloqueia(self):
        # No prompt apareceu o texto de outra pessoa, e não o comando: Enter mandaria esse texto,
        # Esc poderia interromper um agente, e apagar tiraria o que não é da sonda. Não manda nada.
        terminal = ClaudeFalso()
        s = self.montar(**{"Agente 02": terminal, "Agente 03": ClaudeFalso(normal=TRABALHANDO)})
        terminal.tecla = lambda bruto: setattr(terminal, "normal", PROMPT_OCUPADO)
        self.assertIsNone(s.sondar(MAPA_SONDA["sondas"][0]))
        self.assertEqual(self.terminais.enviado, [("Agente 02", "/usage")])
        self.assertEqual(s.foto()[1]["Claude Max 5x"]["situacao"], "falhou")
        self.assertIn("Agente 02", s.foto()[2])

    def test_claude_so_a_barra_no_prompt_nunca_recebe_enter(self):
        # Só "/" chegou ao prompt: o Enter executaria o primeiro comando da lista (/exemplo).
        terminal = ClaudeFalso(chega="/")
        s = self.montar(**{"Agente 02": terminal, "Agente 03": ClaudeFalso(normal=TRABALHANDO)})
        self.assertIsNone(s.sondar(MAPA_SONDA["sondas"][0]))
        self.assertEqual(self.terminais.enviado, [("Agente 02", "/usage"), ("Agente 02", "\\x7f")])   # apaga só o que digitou
        self.assertFalse(terminal.comando_errado)
        self.assertEqual(terminal.digitado, "")
        self.assertEqual(s.foto()[1]["Claude Max 5x"]["situacao"], "falhou")
        self.assertEqual(s.foto()[2], {})       # voltou ao normal: não fica bloqueado

    def test_painel_que_nao_abre_tem_o_comando_apagado_e_nao_recebe_esc(self):
        terminal = ClaudeFalso(abre=False)
        s = self.montar(**{"Agente 02": terminal, "Agente 03": ClaudeFalso(normal=TRABALHANDO)})
        self.assertIsNone(s.sondar(MAPA_SONDA["sondas"][0]))
        self.assertEqual(self.terminais.enviado, [("Agente 02", "/usage"), ("Agente 02", "\\n"), ("Agente 02", "\\x7f" * 6)])
        self.assertEqual(terminal.digitado, "")
        self.assertEqual(s.foto()[2], {})

    def test_painel_que_nunca_sai_do_refreshing_nao_da_numero(self):
        s = self.montar(**{"Agente 02": ClaudeFalso(olhadas_atualizando=10 ** 6), "Agente 03": ClaudeFalso(normal=TRABALHANDO)})
        self.assertIsNone(s.sondar(MAPA_SONDA["sondas"][0]))       # os números velhos não viram leitura
        self.assertEqual(self.terminais.enviado[-1], ("Agente 02", "\\e"))   # mas o painel é fechado
        self.assertEqual(s.foto()[0], {})
        self.assertEqual(s.foto()[2], {})

    def enters(self, nome="Agente 05"):
        return [bruto for quem, bruto in self.terminais.enviado if quem == nome and bruto == "\\n"]

    def test_codex_digita_confere_e_so_entao_manda_o_enter(self):
        s = self.montar(**{"Agente 05": CodexFalso()})
        resultado = s.sondar(MAPA_SONDA["sondas"][1])
        self.assertEqual(self.terminais.enviado, [("Agente 05", "/status"), ("Agente 05", "\\n"), ("Agente 05", "/status"), ("Agente 05", "\\n")])
        g = resultado["Codex Plus"]
        self.assertEqual((g["sessao_5h_pct"], g["semanal_pct"], g["terminal"]), (45, 7, "Agente 05"))    # o último bloco: 55% e 93% left
        self.assertEqual((g["renova_sessao"], g["renova_semanal"]), ("02/10 às 01h24", "08/10 às 20h24"))
        self.assertEqual(s.foto()[2], {})

    def test_codex_enter_engolido_recebe_outro_so_com_o_comando_ainda_no_prompt(self):
        s = self.montar(**{"Agente 05": CodexFalso(engole=1)})
        resultado = s.sondar(MAPA_SONDA["sondas"][1])
        self.assertEqual(self.terminais.enviado, [("Agente 05", "/status"), ("Agente 05", "\\n"), ("Agente 05", "\\n"),
                                                ("Agente 05", "/status"), ("Agente 05", "\\n")])
        self.assertEqual(resultado["Codex Plus"]["sessao_5h_pct"], 45)

    def test_codex_que_engole_todos_os_enters_tem_o_comando_apagado(self):
        terminal = CodexFalso(engole=10)
        s = self.montar(**{"Agente 05": terminal})
        self.assertIsNone(s.sondar(MAPA_SONDA["sondas"][1]))
        self.assertEqual(len(self.enters()), 2)     # no máximo dois, cada um com a tela conferida
        self.assertEqual(self.terminais.enviado[-1], ("Agente 05", "\\x7f" * 7))
        self.assertEqual(terminal.digitado, "")
        self.assertEqual(s.foto()[2], {})

    def test_codex_so_a_barra_no_prompt_nunca_recebe_enter(self):
        # O que prendeu o Agente 05 em 02/10/2026: com só "/" no prompt, o Enter abre o /model, e o
        # Enter seguinte escolhe o modelo marcado e abre o menu de nível de raciocínio.
        terminal = CodexFalso(chega="/")
        s = self.montar(**{"Agente 05": terminal})
        self.assertIsNone(s.sondar(MAPA_SONDA["sondas"][1]))
        self.assertEqual(self.terminais.enviado, [("Agente 05", "/status"), ("Agente 05", "\\x7f")])    # apaga só o que digitou
        self.assertEqual((terminal.menu, terminal.trocou_o_modelo, terminal.digitado), (None, False, ""))
        situacao = s.foto()[1]["Codex Plus"]
        self.assertEqual(situacao["situacao"], "falhou")
        self.assertIn("não ficou digitado", situacao["detalhe"])
        self.assertEqual(s.foto()[2], {})       # voltou ao normal: não fica bloqueado

    def test_codex_menu_no_lugar_do_status_sai_com_esc_e_nao_tenta_de_novo(self):
        terminal = CodexFalso(abre_menu="modelo")
        s = self.montar(**{"Agente 05": terminal})
        self.assertIsNone(s.sondar(MAPA_SONDA["sondas"][1]))
        self.assertEqual(self.terminais.enviado, [("Agente 05", "/status"), ("Agente 05", "\\n"), ("Agente 05", "\\e")])
        self.assertEqual((terminal.menu, terminal.trocou_o_modelo), (None, False))
        self.assertIn("menu", s.foto()[1]["Codex Plus"]["detalhe"])
        self.assertEqual(s.foto()[2], {})

    def test_codex_menu_de_dois_niveis_recebe_um_esc_por_nivel_e_nenhum_enter(self):
        terminal = CodexFalso(abre_menu="raciocinio")
        s = self.montar(**{"Agente 05": terminal})
        self.assertIsNone(s.sondar(MAPA_SONDA["sondas"][1]))
        self.assertEqual(self.terminais.enviado, [("Agente 05", "/status"), ("Agente 05", "\\n"), ("Agente 05", "\\e"), ("Agente 05", "\\e")])
        self.assertEqual((terminal.menu, terminal.trocou_o_modelo), (None, False))
        self.assertEqual(s.foto()[2], {})

    def test_codex_menu_que_nao_fecha_bloqueia_e_nunca_recebe_enter(self):
        terminal = CodexFalso(abre_menu="raciocinio", esc_fecha=False)
        s = self.montar(**{"Agente 05": terminal})
        self.assertIsNone(s.sondar(MAPA_SONDA["sondas"][1]))
        self.assertEqual(self.terminais.enviado, [("Agente 05", "/status"), ("Agente 05", "\\n")] + [("Agente 05", "\\e")] * 3)
        self.assertFalse(terminal.trocou_o_modelo)
        self.assertIn("Agente 05", s.foto()[2])
        # Bloqueado: na rodada seguinte nada vai para ele.
        enviados = list(self.terminais.enviado)
        self.assertIsNone(s.sondar(MAPA_SONDA["sondas"][1]))
        self.assertEqual(self.terminais.enviado, enviados)

    def test_codex_menu_aberto_pela_propria_digitacao_tambem_e_fechado(self):
        # Se a tecla digitada chegasse com um Enter junto, o menu abriria antes de qualquer conferência.
        terminal = CodexFalso(chega="/")
        original = terminal.tecla

        def com_enter_junto(bruto):
            original(bruto)
            if bruto == "/status":
                original("\\n")
        terminal.tecla = com_enter_junto
        s = self.montar(**{"Agente 05": terminal})
        self.assertIsNone(s.sondar(MAPA_SONDA["sondas"][1]))
        self.assertEqual(self.terminais.enviado, [("Agente 05", "/status"), ("Agente 05", "\\e")])
        self.assertEqual((terminal.menu, terminal.trocou_o_modelo), (None, False))
        self.assertEqual(s.foto()[2], {})

    def test_esc_so_vai_a_menu_e_nunca_a_quem_trabalha(self):
        self.assertTrue(sonda.e_menu(tela_de_teste("codex-menu-de-modelo")))
        self.assertTrue(sonda.e_menu(tela_de_teste("codex-menu-de-raciocinio")))
        for nome in ("agente-05", "agente-04", "sonda/codex-status"):      # normal, trabalhando ("esc to interrupt"), com blocos
            self.assertFalse(sonda.e_menu(tela(nome)), nome)
        for nome in ("codex-so-a-barra", "codex-status-digitado-com-menu", "codex-status-digitado-sem-menu"):
            self.assertFalse(sonda.e_menu(tela_de_teste(nome)), nome)
        self.assertFalse(sonda.e_menu(""))

    def test_bloco_do_status_no_fim_da_conversa(self):
        self.assertTrue(sonda.ler_status_codex(tela("sonda/codex-status"))["no_fim"])
        # Com alguma fala depois do bloco, ele não é mais a última coisa da conversa.
        linhas = tela("sonda/codex-status").split("\n")
        i = max(i for i, linha in enumerate(linhas) if linha.lstrip().startswith("Weekly limit:"))
        com_fala = "\n".join(linhas[:i + 1] + ["", "• Pronto, terminei."] + linhas[i + 1:])
        self.assertFalse(sonda.ler_status_codex(com_fala)["no_fim"])

    def test_codex_trabalhando_nao_recebe_nada(self):
        s = self.montar(**{"Agente 05": CodexFalso(normal=tela("agente-04"))})
        self.assertIsNone(s.sondar(MAPA_SONDA["sondas"][1]))
        self.assertEqual(self.terminais.enviado, [])

    def test_rodar_faz_todas_as_contas_e_guarda_as_leituras(self):
        s = self.montar(**{"Agente 02": ClaudeFalso(), "Agente 03": ClaudeFalso(), "Agente 05": CodexFalso()})
        s.rodar()
        leituras = s.foto()[0]
        self.assertEqual(sorted(leituras), ["Claude Max 5x", "Claude Max 5x · Opus", "Codex Plus"])
        self.assertEqual({nome for nome, _ in self.terminais.enviado}, {"Agente 02", "Agente 05"})


class NoColetor(unittest.TestCase):
    def test_tres_do_claude_mostram_a_mesma_cota_e_a_leitura_crua_continua(self):
        with tempfile.TemporaryDirectory() as pasta:
            pasta = Path(pasta)
            telas = pasta / "telas"
            shutil.copytree(str(REAIS), str(telas), ignore=shutil.ignore_patterns("sonda"))
            # O Agente 01 trabalhando agora, com 15% e 58%; o Agente 02 parado desde as 20h03, com 2% e 55%.
            (telas / "agente-01.txt").write_text(
                TRABALHANDO.replace("ctx [██████░░░░] 61% · 5h 12% · sem 56%", "ctx [█████░░░░░] 50% · 5h 15% · sem 58%"),
                encoding="utf-8")
            ambiente = dict(os.environ, PAINEL_QUADRO=str(pasta / "quadro.json"))
            p = subprocess.run([sys.executable, str(RAIZ / "coletor"), "--uma-vez", "--sem-gh", "--telas", str(telas),
                                "--saida", str(pasta / "publico"), "--estado", str(pasta / "estado.json")],
                               env=ambiente, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            self.assertEqual(p.returncode, 0, p.stderr.decode("utf-8"))
            dados = json.loads((pasta / "publico" / "dados.json").read_text(encoding="utf-8"))
            por_nome = {v["nome"]: v for v in dados["agentes"]}
            for nome in ("Agente 01", "Agente 02", "Agente 03"):
                self.assertEqual(por_nome[nome]["grupo_cota"], "Claude Max 5x")
            g = dados["cotas"]["Claude Max 5x"]
            self.assertEqual((g["sessao_5h_pct"], g["semanal_pct"], g["fonte"], g["origem"]), (15, 58, "Agente 01", "tela"))
            self.assertEqual((por_nome["Agente 02"]["sessao_5h_pct"], por_nome["Agente 02"]["semanal_pct"]), (2, 55))    # a crua
            self.assertEqual((por_nome["Agente 03"]["grupo_semanal"], por_nome["Agente 03"]["rotulo_semanal"]),
                             ("Claude Max 5x · Opus", "Opus"))
            self.assertEqual(dados["cotas"]["Codex Plus"]["fonte"], "Agente 04")
            self.assertEqual(por_nome["Agente 06"]["grupo_cota"], "conta-a@example.com · Gemini")
            self.assertEqual(por_nome["Agente 10"]["grupo_cota"], "conta-a@example.com · Claude/GPT")
            self.assertFalse(dados["sonda"]["ligada"])      # telas de arquivo e passada única: a sonda nunca roda
            self.assertTrue((pasta / "estado.json").exists())
            self.assertFalse((RAIZ / "publico" / "estado.json").exists())      # o estado nunca vai para a pasta pública

    def test_o_mapa_de_verdade(self):
        mapa = comum.carregar_mapa()
        grupos = {}
        for v in mapa["agentes"]:
            grupos.setdefault(v["grupo_cota"], []).append(v["nome"])
        self.assertEqual(grupos["Claude Max 5x"], ["Agente 01", "Agente 02", "Agente 03"])
        self.assertEqual(grupos["Codex Plus"], ["Agente 04", "Agente 05"])
        self.assertEqual(len(grupos), 10)       # os 8 do Antigravity, cada um no seu grupo
        sondados = [nome for s in mapa["sondas"] for nome in s["terminais"]]
        self.assertEqual(sondados, ["Agente 02", "Agente 03", "Agente 05"])     # nunca o Agente 01, nunca o Antigravity


if __name__ == "__main__":
    unittest.main()
