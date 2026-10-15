# -*- coding: utf-8 -*-
"""Testes da cota pela CLI (lib/contas.py): a tradução do estado do dashboard de fbtostadev para os
grupos de cota do painel e para os cards da página. Nenhum teste roda CLI nem lê processo: o
estado das contas é montado à mão, no formato de GET /api/state do original (cotas/README-original.md).

Rodar:  python3 -m unittest discover -s testes -v      (na pasta do painel)
"""
import sys
import time
import unittest
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(RAIZ / "lib"))

import contas   # noqa: E402
import cotas    # noqa: E402

AGORA = int(datetime(2026, 10, 8, 16, 30, 0).timestamp())      # qui 08/10/2026 16h30, hora local
MAPA = {"agentes": [
    {"nome": "Agente 01", "ferramenta": "claude", "conta": "Claude Max 5x", "grupo_cota": "Claude Max 5x"},
    {"nome": "Agente 02", "ferramenta": "claude", "conta": "Claude Max 5x", "grupo_cota": "Claude Max 5x"},
    {"nome": "Agente 03", "ferramenta": "claude", "conta": "Claude Max 5x · Opus", "grupo_cota": "Claude Max 5x",
     "semanal_do_modelo": "Opus"},
    {"nome": "Agente 04", "ferramenta": "codex", "conta": "Codex Plus", "grupo_cota": "Codex Plus"},
    {"nome": "Agente 06", "ferramenta": "agy", "conta": "k@example.com · Gemini", "grupo_cota": "k@example.com · Gemini"},
    {"nome": "Agente 10", "ferramenta": "agy", "conta": "k@example.com · Claude/GPT", "grupo_cota": "k@example.com · Claude/GPT"},
    {"nome": "Agente 07", "ferramenta": "agy", "conta": "f@example.com · Gemini", "grupo_cota": "f@example.com · Gemini"},
]}


def janela(usado, renova_em_s, minutos):
    return {"used_percent": usado, "remaining_percent": 100 - usado, "resets_at": AGORA + renova_em_s, "window_minutes": minutos}


def conta(harness, terminais, pools, email="x@y.com", observado=AGORA - 60, **extra):
    base = {"id": harness + ":" + email, "harness": harness, "email": email, "plan": None, "title": None,
            "account": email, "account_dirs": [], "terminals": terminais, "model": None, "effort": None,
            "status": "ok" if observado else "sem dados", "age_seconds": None, "pools": pools, "querying": False,
            "observed_at": observado, "source": "active" if observado else None, "error": None, "error_detail": None,
            "next_refresh_at": AGORA + 240}
    base.update(extra)
    return base


CLAUDE = conta("claude", ["Agente 01", "Agente 02", "Agente 03", "Jarvis temporário"], [
    {"id": "main", "five_hour": janela(17, 50 * 60, 300), "weekly": janela(53, 5 * 86400, 10080),
     "scoped": {"Opus": janela(38, 5 * 86400, 10080)}}], email="c@example.com", plan="max", model="claude-opus-5-5", effort="high")
CODEX = conta("codex", ["Agente 04", "Agente 05"], [
    {"id": "codex", "five_hour": janela(0, 4 * 3600, 300), "weekly": janela(45, 6 * 86400, 10080)}], email="a@example.com", plan="plus")
AGY_LIDA = conta("antigravity", ["Agente 07", "Agente 11"], [
    {"id": "gemini", "five_hour": janela(0, 4 * 3600, 300), "weekly": janela(38.4, 4 * 86400, 10080)},
    {"id": "3p", "five_hour": janela(0, 4 * 3600, 300), "weekly": janela(98.4, 2 * 86400, 10080)}], email="f@example.com")
AGY_SEM = conta("antigravity", ["Agente 06", "Agente 10"], [], email="k@example.com", observado=None, keychain_limited=True)
FOTO = {"workspace": {"name": "tmux"}, "updated_at": AGORA, "discovery_error": None,
        "accounts": [AGY_SEM, AGY_LIDA, CLAUDE, CODEX]}


class Janelas(unittest.TestCase):
    def test_claude_tem_o_grupo_do_plano_e_o_da_semanal_do_opus(self):
        j = contas.janelas_da_conta(CLAUDE, MAPA)
        self.assertEqual(list(j), ["Claude Max 5x", "Claude Max 5x · Opus"])
        self.assertEqual(j["Claude Max 5x"]["5h"]["used_percent"], 17)
        self.assertEqual(j["Claude Max 5x · Opus"]["semana"]["used_percent"], 38)
        self.assertIsNone(j["Claude Max 5x · Opus"]["5h"])
        self.assertTrue(j["Claude Max 5x · Opus"]["so_semana"])

    def test_antigravity_tem_gemini_e_claude_gpt_pela_base_do_grupo(self):
        j = contas.janelas_da_conta(AGY_LIDA, MAPA)
        self.assertEqual(list(j), ["f@example.com · Gemini", "f@example.com · Claude/GPT"])
        self.assertEqual(j["f@example.com · Claude/GPT"]["semana"]["used_percent"], 98.4)
        # sem pool da CLI (conta fora do Keychain), os grupos existem com janelas vazias
        j = contas.janelas_da_conta(AGY_SEM, MAPA)
        self.assertEqual(list(j), ["k@example.com · Gemini", "k@example.com · Claude/GPT"])
        self.assertIsNone(j["k@example.com · Gemini"]["semana"])

    def test_conta_sem_agente_no_mapa_vale_pelo_nome_da_ferramenta(self):
        j = contas.janelas_da_conta(conta("codex", ["Jarvis"], CODEX["pools"]), MAPA)
        self.assertEqual(list(j), ["Codex"])

    def test_agentes_da_conta_ignora_terminal_de_outra_ferramenta(self):
        self.assertEqual([v["nome"] for v in contas.agentes_da_conta(CLAUDE, MAPA)], ["Agente 01", "Agente 02", "Agente 03"])
        self.assertEqual([v["nome"] for v in contas.agentes_da_conta(conta("codex", ["Agente 01"], []), MAPA)], [])


class Leituras(unittest.TestCase):
    def test_leituras_por_grupo_no_formato_da_sonda(self):
        leituras = contas.leituras_para_cotas(FOTO, MAPA, AGORA)
        self.assertEqual(set(leituras), {"Claude Max 5x", "Claude Max 5x · Opus", "Codex Plus",
                                         "f@example.com · Gemini", "f@example.com · Claude/GPT"})
        claude = leituras["Claude Max 5x"]
        self.assertEqual((claude["sessao_5h_pct"], claude["semanal_pct"], claude["origem"], claude["terminal"]),
                         (17, 53, "cli", "Claude Code"))
        self.assertEqual(claude["lido_em"], AGORA - 60)
        self.assertEqual(claude["renova_sessao"], "17h20")                 # hoje: só a hora
        self.assertEqual(claude["renova_semanal"], "13/10 às 16h30")      # outro dia: com a data
        self.assertEqual(claude["renova_sessao_epoch"], AGORA + 50 * 60)
        opus = leituras["Claude Max 5x · Opus"]
        self.assertEqual((opus["sessao_5h_pct"], opus["semanal_pct"], opus["renova_sessao"]), (None, 38, None))
        self.assertEqual(leituras["f@example.com · Gemini"]["semanal_pct"], 38)     # arredonda
        self.assertEqual(leituras["f@example.com · Claude/GPT"]["semanal_pct"], 98)

    def test_conta_sem_observacao_nao_vira_leitura(self):
        leituras = contas.leituras_para_cotas({"accounts": [AGY_SEM]}, MAPA, AGORA)
        self.assertEqual(leituras, {})

    def test_entra_no_estado_pela_regra_da_mais_recente(self):
        estado = cotas.estado_vazio()
        estado["sondas"]["Claude Max 5x"] = {"lido_em": AGORA - 30, "terminal": "Agente 02", "sessao_5h_pct": 20, "semanal_pct": 50}
        estado["sondas"]["Codex Plus"] = {"lido_em": AGORA - 3600, "terminal": "Agente 05", "sessao_5h_pct": 9, "semanal_pct": 40}
        cotas.juntar_leituras(estado, contas.leituras_para_cotas(FOTO, MAPA, AGORA))
        self.assertEqual(estado["sondas"]["Claude Max 5x"]["terminal"], "Agente 02")     # a sonda era mais nova
        self.assertEqual(estado["sondas"]["Codex Plus"]["origem"], "cli")                 # a CLI é mais nova
        self.assertEqual(estado["sondas"]["Codex Plus"]["semanal_pct"], 45)

    def test_grupo_resolvido_traz_origem_cli_e_hora_de_renovar(self):
        estado = cotas.estado_vazio()
        cotas.juntar_leituras(estado, contas.leituras_para_cotas(FOTO, MAPA, AGORA))
        import leitor
        leituras = {v["nome"]: leitor.sem_leitura(v["ferramenta"], "sem conexão com este terminal") for v in MAPA["agentes"]}
        _, _, grupos = cotas.atualizar(estado, MAPA, leituras, AGORA)
        g = grupos["Claude Max 5x"]
        self.assertEqual((g["origem"], g["fonte"], g["evidencia"], g["sessao_5h_pct"], g["semanal_pct"]),
                         ("cli", "Claude Code", "cli", 17, 53))
        self.assertEqual(g["renova_sessao"], "17h20")
        self.assertEqual(g["renova_semanal_epoch"], AGORA + 5 * 86400)
        self.assertEqual(grupos["Claude Max 5x · Opus"]["semanal_pct"], 38)
        self.assertIsNone(grupos["k@example.com · Gemini"]["fonte"])     # a CLI não tem essa conta


class Cards(unittest.TestCase):
    def grupos(self):
        """Os grupos do painel como lib/cotas.py resolve: a CLI onde ela leu, a tela onde não."""
        g = {}
        for grupo, l in contas.leituras_para_cotas(FOTO, MAPA, AGORA).items():
            g[grupo] = dict(cotas._grupo_novo(), membros=["alguém"], origem="cli", fonte=l["terminal"], evidencia="cli",
                            sessao_5h_pct=l["sessao_5h_pct"], semanal_pct=l["semanal_pct"], lido_em_epoch=l["lido_em"],
                            renova_sessao_epoch=l["renova_sessao_epoch"], renova_semanal_epoch=l["renova_semanal_epoch"])
        g["k@example.com · Gemini"] = dict(cotas._grupo_novo(), membros=["Agente 06"], origem="tela", fonte="Agente 06", evidencia="mudou",
                                         sessao_5h_pct=0, semanal_pct=95, lido_em_epoch=AGORA - 7200)
        g["k@example.com · Claude/GPT"] = dict(cotas._grupo_novo(), membros=["Agente 10"])      # ninguém leu
        return g

    def test_ordem_e_titulos_dos_cards_seguem_o_mapa(self):
        cards = contas.cartoes(FOTO, MAPA, self.grupos(), AGORA)
        self.assertEqual([c["titulo"] for c in cards], ["Claude Max 5x", "Codex Plus", "k@example.com", "f@example.com"])
        self.assertEqual(cards[0]["agentes"], ["Agente 01", "Agente 02", "Agente 03"])
        self.assertEqual((cards[0]["ferramenta"], cards[0]["ferramenta_nome"], cards[0]["email"], cards[0]["plano"]),
                         ("claude", "Claude Code", "c@example.com", "max"))
        self.assertEqual((cards[0]["modelo"], cards[0]["esforco"]), ("claude-opus-5-5", "high"))

    def test_barras_do_claude_incluem_a_semanal_do_opus(self):
        card = contas.cartoes(FOTO, MAPA, self.grupos(), AGORA)[0]
        self.assertEqual([(b["rotulo"], b["tipo"], b["usado_pct"], b["origem"]) for b in card["barras"]],
                         [("5h", "5h", 17, "cli"), ("Semana", "semana", 53, "cli"), ("Semana · Opus", "semana", 38, "cli")])
        self.assertEqual(card["barras"][0]["renova_epoch"], AGORA + 50 * 60)
        self.assertEqual(card["barras"][0]["janela_min"], 300)
        self.assertEqual(card["barras"][2]["janela_min"], 10080)

    def test_antigravity_fora_do_keychain_usa_a_leitura_da_tela(self):
        card = contas.cartoes(FOTO, MAPA, self.grupos(), AGORA)[2]
        self.assertTrue(card["keychain_limitado"])
        self.assertIsNone(card["lido_em_epoch"])
        rotulos = [b["rotulo"] for b in card["barras"]]
        self.assertEqual(rotulos, ["5h · Gemini", "Semana · Gemini", "5h · Claude/GPT", "Semana · Claude/GPT"])
        gemini = card["barras"][1]
        self.assertEqual((gemini["usado_pct"], gemini["origem"], gemini["fonte"], gemini["lido_em_epoch"], gemini["renova_epoch"]),
                         (95, "tela", "Agente 06", AGORA - 7200, None))
        vazia = card["barras"][3]
        self.assertEqual((vazia["usado_pct"], vazia["origem"], vazia["membros"]), (None, None, ["Agente 10"]))

    def test_o_numero_do_card_e_o_do_grupo_resolvido_e_a_hora_vem_da_cli(self):
        grupos = self.grupos()
        grupos["Codex Plus"].update(origem="tela", fonte="Agente 04", evidencia="trabalhando", sessao_5h_pct=7, lido_em_epoch=AGORA)
        card = contas.cartoes(FOTO, MAPA, grupos, AGORA)[1]
        cinco = card["barras"][0]
        self.assertEqual((cinco["usado_pct"], cinco["origem"], cinco["fonte"]), (7, "tela", "Agente 04"))
        self.assertEqual(cinco["renova_epoch"], AGORA + 4 * 3600)

    def test_bloco_da_pagina(self):
        bloco = contas.para_a_pagina(FOTO, MAPA, self.grupos(), AGORA)
        self.assertEqual((bloco["consultadas"], bloco["erro"], len(bloco["lista"])), (True, None, 4))
        self.assertEqual(bloco["intervalos_s"]["claude"], 300)
        desligado = contas.para_a_pagina(None, MAPA, {}, AGORA, consultadas=False)
        self.assertEqual((desligado["consultadas"], desligado["lista"]), (False, []))
        falha = contas.para_a_pagina(dict(FOTO, discovery_error="discovery_failed"), MAPA, self.grupos(), AGORA)
        self.assertIn("terminais do tmux", falha["erro"])


class Renovacao(unittest.TestCase):
    def test_formato(self):
        self.assertEqual(contas.renova_pt(AGORA + 600, AGORA), "16h40")
        self.assertEqual(contas.renova_pt(AGORA + 86400, AGORA), "09/10 às 16h30")
        self.assertIsNone(contas.renova_pt(None, AGORA))
        self.assertIsNone(contas.renova_pt("x", AGORA))

    def test_pct(self):
        self.assertEqual(contas.pct({"used_percent": 38.447}), 38)
        self.assertEqual(contas.pct({"used_percent": 101}), 100)
        self.assertIsNone(contas.pct(None))
        self.assertIsNone(contas.pct({"used_percent": "x"}))


class Descoberta(unittest.TestCase):
    def test_terminais_vem_do_mapa_e_casam_pelo_painel_do_tmux(self):
        class TmuxFalso:
            def painel(self, nome):
                return {"Agente 06": "%7", "Agente 04": "%2"}.get(nome)
        processos = [
            {"pid": 10, "harness": "antigravity", "env": {"TMUX_PANE": "%7", "HOME": "/casas/k"}, "email": "k@example.com"},
            {"pid": 11, "harness": "codex", "env": {"TMUX_PANE": "%2", "CODEX_HOME": "/casas/c/.codex"}},
            {"pid": 12, "harness": "codex", "env": {"TMUX_PANE": "%99", "CODEX_HOME": "/casas/outra/.codex"}},
        ]
        d = contas.DescobertaDoTmux(MAPA, TmuxFalso(), process_reader=lambda: processos)
        lista = d()
        self.assertEqual(sorted((a.harness, a.terminals, a.email) for a in lista),
                         [("antigravity", ["Agente 06"], "k@example.com"), ("codex", ["Agente 04"], None)])

    def test_sem_tmux_nenhuma_conta(self):
        class SemTmux:
            def painel(self, nome):
                return None
        self.assertEqual(contas.DescobertaDoTmux(MAPA, SemTmux(), process_reader=lambda: [])(), [])


class MesmaCasa(unittest.TestCase):
    """Agy reaberto sem novo login não tem o log de autenticação aberto: sai sem e-mail, e a mesma casa
    (HOME) virava dois cards. O terminal sem e-mail entra no irmão da casa que provou o e-mail."""

    def test_terminal_sem_email_entra_no_card_da_mesma_casa(self):
        A = contas.discovery.Account
        lista = [A("antigravity", "/h/agyhome-newsole", ["Agente 09"], "n@example.com"),
                 A("antigravity", "/h/agyhome-newsole", ["Agente 13"]),
                 A("antigravity", "/h/agyhome-k", ["Agente 06"], "k@example.com")]
        saida = contas.juntar_terminais_da_mesma_casa(lista)
        self.assertEqual([(a.account_dir, a.email, a.terminals) for a in saida],
                         [("/h/agyhome-newsole", "n@example.com", ["Agente 09", "Agente 13"]),
                          ("/h/agyhome-k", "k@example.com", ["Agente 06"])])

    def test_casa_sem_irmao_com_email_continua_separada(self):
        A = contas.discovery.Account
        lista = [A("antigravity", "/h/a", ["Agente 07"]), A("antigravity", "/h/b", ["Agente 06"], "k@example.com")]
        self.assertEqual(len(contas.juntar_terminais_da_mesma_casa(lista)), 2)

    def test_casa_com_dois_emails_nao_adivinha(self):
        A = contas.discovery.Account
        lista = [A("antigravity", "/h/a", ["Agente 07"], "a@example.com"), A("antigravity", "/h/a", ["Agente 06"], "b@example.com"),
                 A("antigravity", "/h/a", ["Agente 13"])]
        self.assertEqual(len(contas.juntar_terminais_da_mesma_casa(lista)), 3)

    def test_outras_ferramentas_nao_sao_tocadas(self):
        A = contas.discovery.Account
        lista = [A("claude", "/h/c", ["Agente 02"], "c@example.com"), A("claude", "/h/c", ["Agente 03"])]
        self.assertEqual(len(contas.juntar_terminais_da_mesma_casa(lista)), 2)


class Fantasmas(unittest.TestCase):
    """Terminal sem conta provada (processo sumiu no meio da leitura) não vira card vazio."""

    def foto_com_fantasma(self, harness):
        import copy
        foto = copy.deepcopy(FOTO)
        foto["accounts"].append({"id": harness + ":|Fantasma", "harness": harness, "email": None,
                                 "plan": None, "title": None, "account": "conta não identificada",
                                 "account_dirs": [], "terminals": ["Fantasma"], "model": None,
                                 "effort": None, "status": "sem dados", "age_seconds": None, "pools": [],
                                 "observed_at": None, "error": None, "error_detail": None, "querying": False})
        return foto

    def test_terminal_do_claude_sem_identidade_entra_no_card_da_unica_conta(self):
        cards = contas.cartoes(self.foto_com_fantasma("claude"), MAPA, Cards().grupos(), AGORA)
        self.assertEqual([c["titulo"] for c in cards], ["Claude Max 5x", "Codex Plus", "k@example.com", "f@example.com"])
        self.assertIn("Fantasma", cards[0]["terminais"])

    def test_terminal_do_antigravity_sem_identidade_nao_vira_card(self):
        cards = contas.cartoes(self.foto_com_fantasma("antigravity"), MAPA, Cards().grupos(), AGORA)
        self.assertEqual([c["titulo"] for c in cards], ["Claude Max 5x", "Codex Plus", "k@example.com", "f@example.com"])
        self.assertTrue(all("Fantasma" not in c["terminais"] for c in cards))


if __name__ == "__main__":
    unittest.main()
