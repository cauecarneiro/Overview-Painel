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
MAPA = {"workspace": "Equipe", "vingadores": [
    {"nome": "Nick Fury", "ferramenta": "claude", "conta": "Claude Max 5x", "grupo_cota": "Claude Max 5x"},
    {"nome": "Tony Stark", "ferramenta": "claude", "conta": "Claude Max 5x", "grupo_cota": "Claude Max 5x"},
    {"nome": "Capitã Marvel", "ferramenta": "claude", "conta": "Claude Max 5x · Fable", "grupo_cota": "Claude Max 5x",
     "semanal_do_modelo": "Fable"},
    {"nome": "Homem-Aranha", "ferramenta": "codex", "conta": "Codex Plus", "grupo_cota": "Codex Plus"},
    {"nome": "Thor", "ferramenta": "agy", "conta": "k@example.com · Gemini", "grupo_cota": "k@example.com · Gemini"},
    {"nome": "Bucky", "ferramenta": "agy", "conta": "k@example.com · Claude/GPT", "grupo_cota": "k@example.com · Claude/GPT"},
    {"nome": "Loki", "ferramenta": "agy", "conta": "f@example.com · Gemini", "grupo_cota": "f@example.com · Gemini"},
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


CLAUDE = conta("claude", ["Nick Fury", "Tony Stark", "Capitã Marvel", "Jarvis temporário"], [
    {"id": "main", "five_hour": janela(17, 50 * 60, 300), "weekly": janela(53, 5 * 86400, 10080),
     "scoped": {"Fable": janela(38, 5 * 86400, 10080)}}], email="c@example.com", plan="max", model="claude-fable-5-1", effort="high")
CODEX = conta("codex", ["Homem-Aranha", "Hulk"], [
    {"id": "codex", "five_hour": janela(0, 4 * 3600, 300), "weekly": janela(45, 6 * 86400, 10080)}], email="a@example.com", plan="plus")
AGY_LIDA = conta("antigravity", ["Loki", "Gavião Arqueiro"], [
    {"id": "gemini", "five_hour": janela(0, 4 * 3600, 300), "weekly": janela(38.4, 4 * 86400, 10080)},
    {"id": "3p", "five_hour": janela(0, 4 * 3600, 300), "weekly": janela(98.4, 2 * 86400, 10080)}], email="f@example.com")
AGY_SEM = conta("antigravity", ["Thor", "Bucky"], [], email="k@example.com", observado=None, keychain_limited=True)
FOTO = {"workspace": {"name": "Equipe"}, "updated_at": AGORA, "discovery_error": None,
        "accounts": [AGY_SEM, AGY_LIDA, CLAUDE, CODEX]}


class Janelas(unittest.TestCase):
    def test_claude_tem_o_grupo_do_plano_e_o_da_semanal_do_fable(self):
        j = contas.janelas_da_conta(CLAUDE, MAPA)
        self.assertEqual(list(j), ["Claude Max 5x", "Claude Max 5x · Fable"])
        self.assertEqual(j["Claude Max 5x"]["5h"]["used_percent"], 17)
        self.assertEqual(j["Claude Max 5x · Fable"]["semana"]["used_percent"], 38)
        self.assertIsNone(j["Claude Max 5x · Fable"]["5h"])
        self.assertTrue(j["Claude Max 5x · Fable"]["so_semana"])

    def test_antigravity_tem_gemini_e_claude_gpt_pela_base_do_grupo(self):
        j = contas.janelas_da_conta(AGY_LIDA, MAPA)
        self.assertEqual(list(j), ["f@example.com · Gemini", "f@example.com · Claude/GPT"])
        self.assertEqual(j["f@example.com · Claude/GPT"]["semana"]["used_percent"], 98.4)
        # sem pool da CLI (conta fora do Keychain), os grupos existem com janelas vazias
        j = contas.janelas_da_conta(AGY_SEM, MAPA)
        self.assertEqual(list(j), ["k@example.com · Gemini", "k@example.com · Claude/GPT"])
        self.assertIsNone(j["k@example.com · Gemini"]["semana"])

    def test_conta_sem_vingador_no_mapa_vale_pelo_nome_da_ferramenta(self):
        j = contas.janelas_da_conta(conta("codex", ["Jarvis"], CODEX["pools"]), MAPA)
        self.assertEqual(list(j), ["Codex"])

    def test_vingadores_da_conta_ignora_terminal_de_outra_ferramenta(self):
        self.assertEqual([v["nome"] for v in contas.vingadores_da_conta(CLAUDE, MAPA)], ["Nick Fury", "Tony Stark", "Capitã Marvel"])
        self.assertEqual([v["nome"] for v in contas.vingadores_da_conta(conta("codex", ["Nick Fury"], []), MAPA)], [])


class Leituras(unittest.TestCase):
    def test_leituras_por_grupo_no_formato_da_sonda(self):
        leituras = contas.leituras_para_cotas(FOTO, MAPA, AGORA)
        self.assertEqual(set(leituras), {"Claude Max 5x", "Claude Max 5x · Fable", "Codex Plus",
                                         "f@example.com · Gemini", "f@example.com · Claude/GPT"})
        claude = leituras["Claude Max 5x"]
        self.assertEqual((claude["sessao_5h_pct"], claude["semanal_pct"], claude["origem"], claude["terminal"]),
                         (17, 53, "cli", "Claude Code"))
        self.assertEqual(claude["lido_em"], AGORA - 60)
        self.assertEqual(claude["renova_sessao"], "17h20")                 # hoje: só a hora
        self.assertEqual(claude["renova_semanal"], "13/10 às 16h30")      # outro dia: com a data
        self.assertEqual(claude["renova_sessao_epoch"], AGORA + 50 * 60)
        fable = leituras["Claude Max 5x · Fable"]
        self.assertEqual((fable["sessao_5h_pct"], fable["semanal_pct"], fable["renova_sessao"]), (None, 38, None))
        self.assertEqual(leituras["f@example.com · Gemini"]["semanal_pct"], 38)     # arredonda
        self.assertEqual(leituras["f@example.com · Claude/GPT"]["semanal_pct"], 98)

    def test_conta_sem_observacao_nao_vira_leitura(self):
        leituras = contas.leituras_para_cotas({"accounts": [AGY_SEM]}, MAPA, AGORA)
        self.assertEqual(leituras, {})

    def test_entra_no_estado_pela_regra_da_mais_recente(self):
        estado = cotas.estado_vazio()
        estado["sondas"]["Claude Max 5x"] = {"lido_em": AGORA - 30, "terminal": "Tony Stark", "sessao_5h_pct": 20, "semanal_pct": 50}
        estado["sondas"]["Codex Plus"] = {"lido_em": AGORA - 3600, "terminal": "Hulk", "sessao_5h_pct": 9, "semanal_pct": 40}
        cotas.juntar_leituras(estado, contas.leituras_para_cotas(FOTO, MAPA, AGORA))
        self.assertEqual(estado["sondas"]["Claude Max 5x"]["terminal"], "Tony Stark")     # a sonda era mais nova
        self.assertEqual(estado["sondas"]["Codex Plus"]["origem"], "cli")                 # a CLI é mais nova
        self.assertEqual(estado["sondas"]["Codex Plus"]["semanal_pct"], 45)

    def test_grupo_resolvido_traz_origem_cli_e_hora_de_renovar(self):
        estado = cotas.estado_vazio()
        cotas.juntar_leituras(estado, contas.leituras_para_cotas(FOTO, MAPA, AGORA))
        import leitor
        leituras = {v["nome"]: leitor.sem_leitura(v["ferramenta"], "sem conexão com este terminal") for v in MAPA["vingadores"]}
        _, _, grupos = cotas.atualizar(estado, MAPA, leituras, AGORA)
        g = grupos["Claude Max 5x"]
        self.assertEqual((g["origem"], g["fonte"], g["evidencia"], g["sessao_5h_pct"], g["semanal_pct"]),
                         ("cli", "Claude Code", "cli", 17, 53))
        self.assertEqual(g["renova_sessao"], "17h20")
        self.assertEqual(g["renova_semanal_epoch"], AGORA + 5 * 86400)
        self.assertEqual(grupos["Claude Max 5x · Fable"]["semanal_pct"], 38)
        self.assertIsNone(grupos["k@example.com · Gemini"]["fonte"])     # a CLI não tem essa conta


class Cards(unittest.TestCase):
    def grupos(self):
        """Os grupos do painel como lib/cotas.py resolve: a CLI onde ela leu, a tela onde não."""
        g = {}
        for grupo, l in contas.leituras_para_cotas(FOTO, MAPA, AGORA).items():
            g[grupo] = dict(cotas._grupo_novo(), membros=["alguém"], origem="cli", fonte=l["terminal"], evidencia="cli",
                            sessao_5h_pct=l["sessao_5h_pct"], semanal_pct=l["semanal_pct"], lido_em_epoch=l["lido_em"],
                            renova_sessao_epoch=l["renova_sessao_epoch"], renova_semanal_epoch=l["renova_semanal_epoch"])
        g["k@example.com · Gemini"] = dict(cotas._grupo_novo(), membros=["Thor"], origem="tela", fonte="Thor", evidencia="mudou",
                                         sessao_5h_pct=0, semanal_pct=95, lido_em_epoch=AGORA - 7200)
        g["k@example.com · Claude/GPT"] = dict(cotas._grupo_novo(), membros=["Bucky"])      # ninguém leu
        return g

    def test_ordem_e_titulos_dos_cards_seguem_o_mapa(self):
        cards = contas.cartoes(FOTO, MAPA, self.grupos(), AGORA)
        self.assertEqual([c["titulo"] for c in cards], ["Claude Max 5x", "Codex Plus", "k@example.com", "f@example.com"])
        self.assertEqual(cards[0]["vingadores"], ["Nick Fury", "Tony Stark", "Capitã Marvel"])
        self.assertEqual((cards[0]["ferramenta"], cards[0]["ferramenta_nome"], cards[0]["email"], cards[0]["plano"]),
                         ("claude", "Claude Code", "c@example.com", "max"))
        self.assertEqual((cards[0]["modelo"], cards[0]["esforco"]), ("claude-fable-5-1", "high"))

    def test_barras_do_claude_incluem_a_semanal_do_fable(self):
        card = contas.cartoes(FOTO, MAPA, self.grupos(), AGORA)[0]
        self.assertEqual([(b["rotulo"], b["tipo"], b["usado_pct"], b["origem"]) for b in card["barras"]],
                         [("5h", "5h", 17, "cli"), ("Semana", "semana", 53, "cli"), ("Semana · Fable", "semana", 38, "cli")])
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
                         (95, "tela", "Thor", AGORA - 7200, None))
        vazia = card["barras"][3]
        self.assertEqual((vazia["usado_pct"], vazia["origem"], vazia["membros"]), (None, None, ["Bucky"]))

    def test_o_numero_do_card_e_o_do_grupo_resolvido_e_a_hora_vem_da_cli(self):
        grupos = self.grupos()
        grupos["Codex Plus"].update(origem="tela", fonte="Homem-Aranha", evidencia="trabalhando", sessao_5h_pct=7, lido_em_epoch=AGORA)
        card = contas.cartoes(FOTO, MAPA, grupos, AGORA)[1]
        cinco = card["barras"][0]
        self.assertEqual((cinco["usado_pct"], cinco["origem"], cinco["fonte"]), (7, "tela", "Homem-Aranha"))
        self.assertEqual(cinco["renova_epoch"], AGORA + 4 * 3600)

    def test_bloco_da_pagina(self):
        bloco = contas.para_a_pagina(FOTO, MAPA, self.grupos(), AGORA)
        self.assertEqual((bloco["consultadas"], bloco["erro"], bloco["canvas"], len(bloco["lista"])), (True, None, "Equipe", 4))
        self.assertEqual(bloco["intervalos_s"]["claude"], 300)
        desligado = contas.para_a_pagina(None, MAPA, {}, AGORA, consultadas=False)
        self.assertEqual((desligado["consultadas"], desligado["lista"]), (False, []))
        falha = contas.para_a_pagina(dict(FOTO, discovery_error="discovery_failed"), MAPA, self.grupos(), AGORA)
        self.assertIn("terminais do canvas", falha["erro"])


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
    def test_acha_o_canvas_pelo_nome_e_cai_no_ativo_sem_ele(self):
        import json
        import tempfile
        with tempfile.TemporaryDirectory() as pasta:
            raiz = Path(pasta)
            (raiz / "workspaces" / "A").mkdir(parents=True)
            (raiz / "workspaces" / "B").mkdir(parents=True)
            (raiz / "workspaces" / "A" / "workspace.json").write_text(json.dumps({"payload": {"name": "Outro", "workingDirectory": "/r", "nodes": []}}))
            (raiz / "workspaces" / "B" / "workspace.json").write_text(json.dumps({"payload": {"name": "Equipe", "workingDirectory": "/f", "nodes": [
                {"content": {"terminal": {"_0": {"id": "t1", "name": "Thor", "status": "running", "agentType": "antigravity_cli"}}}}]}}))
            (raiz / "app-state.json").write_text(json.dumps({"payload": {"activeWorkspaceId": "A"}}))
            d = contas.DescobertaDoCanvas("Equipe", raiz, process_reader=lambda: [])
            self.assertEqual(d.id_do_canvas(), "B")
            lista = d()
            self.assertEqual(d.workspace["name"], "Equipe")
            self.assertEqual([(a.harness, a.terminals, a.account_dir) for a in lista], [("antigravity", ["Thor"], None)])
            self.assertEqual(contas.DescobertaDoCanvas("Inexistente", raiz, process_reader=lambda: []).id_do_canvas(), "A")
            self.assertEqual(contas.DescobertaDoCanvas(None, raiz, process_reader=lambda: []).id_do_canvas(), "A")


class MesmaCasa(unittest.TestCase):
    """Agy reaberto sem novo login não tem o log de autenticação aberto: sai sem e-mail, e a mesma casa
    (HOME) virava dois cards. O terminal sem e-mail entra no irmão da casa que provou o e-mail."""

    def test_terminal_sem_email_entra_no_card_da_mesma_casa(self):
        A = contas.discovery.Account
        lista = [A("antigravity", "/h/agyhome-newsole", ["Doutor Estranho"], "n@example.com"),
                 A("antigravity", "/h/agyhome-newsole", ["Falcão"]),
                 A("antigravity", "/h/agyhome-k", ["Thor"], "k@example.com")]
        saida = contas.juntar_terminais_da_mesma_casa(lista)
        self.assertEqual([(a.account_dir, a.email, a.terminals) for a in saida],
                         [("/h/agyhome-newsole", "n@example.com", ["Doutor Estranho", "Falcão"]),
                          ("/h/agyhome-k", "k@example.com", ["Thor"])])

    def test_casa_sem_irmao_com_email_continua_separada(self):
        A = contas.discovery.Account
        lista = [A("antigravity", "/h/a", ["Loki"]), A("antigravity", "/h/b", ["Thor"], "k@example.com")]
        self.assertEqual(len(contas.juntar_terminais_da_mesma_casa(lista)), 2)

    def test_casa_com_dois_emails_nao_adivinha(self):
        A = contas.discovery.Account
        lista = [A("antigravity", "/h/a", ["Loki"], "a@example.com"), A("antigravity", "/h/a", ["Thor"], "b@example.com"),
                 A("antigravity", "/h/a", ["Falcão"])]
        self.assertEqual(len(contas.juntar_terminais_da_mesma_casa(lista)), 3)

    def test_outras_ferramentas_nao_sao_tocadas(self):
        A = contas.discovery.Account
        lista = [A("claude", "/h/c", ["Tony Stark"], "c@example.com"), A("claude", "/h/c", ["Capitã Marvel"])]
        self.assertEqual(len(contas.juntar_terminais_da_mesma_casa(lista)), 2)


class Casas(unittest.TestCase):
    """A consulta por casa do Antigravity, com um consultor falso: nenhum teste roda o agy."""

    POOLS = [{"id": "gemini", "five_hour": janela(0, 4 * 3600, 300), "weekly": janela(12, 6 * 86400, 10080)},
             {"id": "3p", "five_hour": janela(0, 4 * 3600, 300), "weekly": janela(100, 2 * 86400, 10080)}]

    def conta_da_descoberta(self, casa="/casas/k", email="k@example.com"):
        from discovery import Account
        c = Account("antigravity", None, ["Thor", "Bucky"], email)
        c.account_dir = casa
        return c

    def foto(self):
        return {"accounts": [conta("antigravity", ["Thor", "Bucky"], [], email="k@example.com", observado=None,
                                   keychain_limited=True, account_dirs=["/casas/k"])]}

    def test_leitura_da_casa_entra_na_conta_e_tira_o_limite_do_keychain(self):
        casas = contas.CasasDoAntigravity(consultar=lambda casa: {"email": "K@example.com", "pools": self.POOLS})
        casas.atualizar([self.conta_da_descoberta()], esperar=True)
        c = casas.aplicar(self.foto(), AGORA)["accounts"][0]
        self.assertEqual((c["status"], c["source"], c["keychain_limited"], c["error"]), ("ok", "active", False, None))
        self.assertEqual(c["pools"][0]["weekly"]["used_percent"], 12)
        self.assertIsNotNone(c["observed_at"])
        leituras = contas.leituras_para_cotas({"accounts": [c]}, MAPA, AGORA)
        self.assertEqual(leituras["k@example.com · Gemini"]["semanal_pct"], 12)
        self.assertEqual(leituras["k@example.com · Claude/GPT"]["renova_semanal_epoch"], AGORA + 2 * 86400)

    def test_casa_com_outra_conta_logada_nao_empresta_numero(self):
        casas = contas.CasasDoAntigravity(consultar=lambda casa: {"email": "outra@example.com", "pools": self.POOLS})
        casas.atualizar([self.conta_da_descoberta()], esperar=True)
        c = casas.aplicar(self.foto())["accounts"][0]
        self.assertEqual((c["pools"], c["observed_at"], c["error_detail"]), ([], None, "conta diferente"))

    def test_falha_mantem_a_leitura_boa_e_dobra_a_espera(self):
        respostas = [{"email": "k@example.com", "pools": self.POOLS}]
        def consultar(casa):
            if respostas:
                return respostas.pop()
            raise TimeoutError("query timeout")
        casas = contas.CasasDoAntigravity(consultar=consultar, intervalo=1200)
        conta_k = self.conta_da_descoberta()
        casas.atualizar([conta_k], esperar=True)
        primeira = casas.estado["/casas/k"]["proxima"]
        casas.atualizar([conta_k], esperar=True)                      # ainda não é hora: não consulta
        self.assertEqual(casas.estado["/casas/k"]["proxima"], primeira)
        casas.atualizar([conta_k], esperar=True, agora=primeira + 1)  # é hora, e falha
        e = casas.estado["/casas/k"]
        self.assertEqual((e["erro"], e["falhas"]), ("timeout", 1))
        self.assertGreaterEqual(e["proxima"] - primeira, 1200)
        c = casas.aplicar(self.foto())["accounts"][0]
        self.assertEqual((c["pools"][0]["weekly"]["used_percent"], c["error_detail"]), (12, "timeout"))

    def test_casa_sem_lancador_nao_e_consultada(self):
        import tempfile
        with tempfile.TemporaryDirectory() as pasta:
            self.assertIsNone(contas.consultar_casa(pasta))

    def test_leitura_mais_nova_do_original_nao_e_trocada(self):
        casas = contas.CasasDoAntigravity(consultar=lambda casa: {"email": "k@example.com", "pools": self.POOLS})
        casas.atualizar([self.conta_da_descoberta()], esperar=True)
        foto = self.foto()
        foto["accounts"][0].update(observed_at=casas.estado["/casas/k"]["lido_em"] + 60, pools=[{"id": "gemini", "five_hour": None, "weekly": janela(77, 86400, 10080)}])
        c = casas.aplicar(foto)["accounts"][0]
        self.assertEqual(c["pools"][0]["weekly"]["used_percent"], 77)


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


class RastroDaConsulta(unittest.TestCase):
    """A consulta /quota apaga o log que o servidor de linguagem do agy deixou na casa: só o que tem
    as marcas de uma consulta em modo print, está parado há um minuto e ninguém tem aberto."""

    def setUp(self):
        import os, tempfile
        self.pasta = Path(tempfile.mkdtemp(prefix="logs-casa-"))
        self.agora = time.time()
        marcas = b"\n".join(contas.MARCAS_DE_CONSULTA)
        self.consulta = self.escrever("cli-20261008_191309.log", b"I1008 19:13:09 server.go\n" + marcas + b"\nfim\n", 120)
        self.sessao = self.escrever("cli-20261008_140018.log", b"sessao\n" + contas.MARCAS_DE_CONSULTA[1] + b"\n", 7200)
        self.recente = self.escrever("cli-20261008_192356.log", marcas, 5)

    def escrever(self, nome, conteudo, idade):
        import os
        p = self.pasta / nome
        p.write_bytes(conteudo)
        os.utime(p, (self.agora - idade, self.agora - idade))
        return p

    def tearDown(self):
        import shutil
        shutil.rmtree(self.pasta, ignore_errors=True)

    def test_apaga_so_o_log_de_consulta_parado_e_fechado(self):
        apagados = contas.limpar_rastro_das_consultas(self.pasta, self.agora, abertos=lambda c: set())
        self.assertEqual(apagados, [self.consulta])
        self.assertTrue(self.sessao.exists() and self.recente.exists() and not self.consulta.exists())

    def test_log_aberto_por_alguem_fica(self):
        apagados = contas.limpar_rastro_das_consultas(self.pasta, self.agora, abertos=lambda c: set(c))
        self.assertEqual(apagados, [])
        self.assertTrue(self.consulta.exists())

    def test_log_grande_fica(self):
        self.escrever(self.consulta.name, b"x" * (contas.TAMANHO_MAXIMO + 1) + b"\n".join(contas.MARCAS_DE_CONSULTA), 120)
        self.assertEqual(contas.limpar_rastro_das_consultas(self.pasta, self.agora, abertos=lambda c: set()), [])

    def test_pasta_inexistente_nao_quebra(self):
        self.assertEqual(contas.limpar_rastro_das_consultas(self.pasta / "nada", self.agora), [])


class ColetorDoPainel(unittest.TestCase):
    """O collector do Dashboard: Antigravity de dentro da casa; o resto como no original."""

    class Conta:
        def __init__(self, harness, account_dir):
            self.harness, self.account_dir = harness, account_dir

    def test_antigravity_vai_pela_casa(self):
        chamadas = []
        original = contas.consultar_casa
        contas.consultar_casa = lambda casa: chamadas.append(casa) or {"email": "k@example.com", "pools": [{"id": "gemini"}]}
        try:
            r = contas.coletor_do_painel(self.Conta("antigravity", "/casa/k"))
        finally:
            contas.consultar_casa = original
        self.assertEqual(chamadas, ["/casa/k"])
        self.assertEqual(r, {"pools": [{"id": "gemini"}], "email": "k@example.com", "plan": None})

    def test_sem_lancador_e_outras_ferramentas_vao_pelo_original(self):
        chamadas = []
        original_casa, original_collect = contas.consultar_casa, contas.backend.collect
        contas.consultar_casa = lambda casa: None
        contas.backend.collect = lambda account: chamadas.append(account.harness) or {"pools": []}
        try:
            contas.coletor_do_painel(self.Conta("antigravity", "/casa/sem-lancador"))
            contas.coletor_do_painel(self.Conta("claude", "/Users/x/.claude"))
        finally:
            contas.consultar_casa, contas.backend.collect = original_casa, original_collect
        self.assertEqual(chamadas, ["antigravity", "claude"])


if __name__ == "__main__":
    unittest.main()
