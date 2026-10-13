# -*- coding: utf-8 -*-
"""Testes do coletor, dos comandos do quadro e da distribuição dos PRs.

Rodar:  python3 -m unittest discover -s testes -v      (na pasta do painel)

Nada aqui toca o quadro.json nem o publico/ de verdade: tudo vai para uma pasta temporária.
Nenhum teste usa rede: o coletor roda com --sem-gh.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(RAIZ / "lib"))

import comum    # noqa: E402
import prs      # noqa: E402

# O que está escrito em cada tela de telas-de-exemplo/ (conferido à mão, linha da status line):
# nome: (estado, modelo, contexto usado, 5 h usado, semanal usado)
TABELA = {
    "Tony Stark": ("ocioso", "Opus 5.5", 31, 2, 55),
    "Capitã Marvel": ("ocioso", "Fable 5.1", None, None, None),
    "Homem-Aranha": ("trabalhando", "GPT-6.1-Sol", 42, 17, 3),
    "Hulk": ("ocioso", "GPT-6-Astra", 0, 17, 3),
    "Thor": ("ocioso", "Gemini 3.8 Flash (High)", 21, 32, 7),
    "Loki": ("ocioso", "Gemini 3.8 Flash (High)", 21, 12, 43),
    "Steve Rogers": ("ocioso", "Gemini 3.8 Flash (High)", 9, 53, 14),
    "Doutor Estranho": ("ocioso", "Gemini 3.8 Flash (High)", 12, 17, 7),
    "Bucky": ("ocioso", "Claude Opus 4.6 (Thinking)", 0, 0, 0),
    "Gavião Arqueiro": ("ocioso", "Claude Opus 4.6 (Thinking)", 23, 13, 5),
    "Viúva Negra": ("ocioso", "Claude Opus 4.6 (Thinking)", 0, 0, 0),
    "Falcão": ("ocioso", "Claude Opus 4.6 (Thinking)", 0, 0, 0),
}
ORDEM = ["Nick Fury", "Tony Stark", "Capitã Marvel", "Homem-Aranha", "Hulk", "Thor", "Loki", "Steve Rogers",
         "Doutor Estranho", "Bucky", "Gavião Arqueiro", "Viúva Negra", "Falcão"]


class ComPastaTemporaria(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.pasta = Path(self._tmp.name)
        self.quadro = self.pasta / "quadro.json"
        self.ambiente = dict(os.environ, PAINEL_QUADRO=str(self.quadro))

    def tearDown(self):
        self._tmp.cleanup()

    def rodar(self, comando, *args):
        p = subprocess.run([sys.executable, str(RAIZ / comando)] + list(args), env=self.ambiente,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return p.returncode, p.stdout.decode("utf-8"), p.stderr.decode("utf-8")

    def ler_quadro(self):
        return json.loads(self.quadro.read_text(encoding="utf-8"))

    def coletar(self, *args):
        saida = self.pasta / "publico"
        codigo, out, err = self.rodar("coletor", "--uma-vez", "--sem-gh", "--saida", str(saida), *args)
        self.assertEqual(codigo, 0, err)
        return json.loads((saida / "dados.json").read_text(encoding="utf-8")), saida


class Coletor(ComPastaTemporaria):
    def test_telas_de_exemplo_batem_com_o_que_esta_escrito_nelas(self):
        dados, _ = self.coletar("--telas", str(RAIZ / "telas-de-exemplo"))
        self.assertEqual([v["nome"] for v in dados["vingadores"]], ORDEM)   # os 13, na ordem do mapa
        por_nome = {v["nome"]: v for v in dados["vingadores"]}
        for nome, (estado, modelo, ctx, cinco, semana) in TABELA.items():
            v = por_nome[nome]
            self.assertEqual(v["leitura"], "ok", nome)
            self.assertEqual((v["estado"], v["modelo"], v["contexto_pct"], v["sessao_5h_pct"], v["semanal_pct"]),
                             (estado, modelo, ctx, cinco, semana), nome)

    def test_sem_arquivo_de_tela_vira_sem_leitura_sem_numero(self):
        dados, _ = self.coletar("--telas", str(RAIZ / "telas-de-exemplo"))
        fury = dados["vingadores"][0]
        self.assertEqual((fury["nome"], fury["leitura"], fury["estado"]), ("Nick Fury", "sem_leitura", "sem_leitura"))
        self.assertIn("nick-fury.txt", fury["motivo"])
        for campo in ("contexto_pct", "sessao_5h_pct", "semanal_pct", "atividade"):
            self.assertIsNone(fury[campo], campo)
        self.assertEqual(fury["modelo"], "Opus 5.5")    # o modelo do mapa continua aparecendo
        self.assertFalse(fury["modelo_lido_da_tela"])

    def test_pasta_de_telas_vazia_nao_derruba(self):
        vazia = self.pasta / "vazia"
        vazia.mkdir()
        dados, _ = self.coletar("--telas", str(vazia))
        self.assertTrue(all(v["leitura"] == "sem_leitura" for v in dados["vingadores"]))

    def test_dados_js_tem_o_mesmo_conteudo_e_nao_sobra_temporario(self):
        dados, saida = self.coletar("--telas", str(RAIZ / "telas-de-exemplo"))
        js = (saida / "dados.js").read_text(encoding="utf-8")
        prefixo = "window.__painelDados && window.__painelDados("
        self.assertTrue(js.startswith(prefixo) and js.rstrip().endswith(");"))
        self.assertEqual(json.loads(js[len(prefixo):js.rstrip().rfind(");")]), dados)
        self.assertTrue(js.isascii())       # acento vai como \uXXXX: não depende de codificação
        self.assertEqual(sorted(p.name for p in saida.iterdir()), ["dados.js", "dados.json"])

    def test_quadro_entra_nos_dados_com_nomes_acentuados(self):
        self.rodar("painel-missao", "viuva negra", "--missao", "Revisão do catálogo — ação já!", "--situacao",
                   "esperando Ana", "--previsao", "23h50", "--frente", "#243 textos")
        self.rodar("painel-missao", "GAVIÃO ARQUEIRO", "--situacao", "trabalhando", "--frente", "#243 textos")
        self.rodar("painel-pendencia", "--adicionar", "Aprovar o orçamento da Capitã Marvel")
        dados, _ = self.coletar("--telas", str(RAIZ / "telas-de-exemplo"))
        viuva = next(v for v in dados["vingadores"] if v["nome"] == "Viúva Negra")
        self.assertEqual(viuva["missao"]["texto"], "Revisão do catálogo — ação já!")
        self.assertEqual((viuva["missao"]["situacao"], viuva["missao"]["esperando"]), ("esperando", "Ana"))
        self.assertEqual(viuva["missao"]["previsao"], "23h50")
        self.assertEqual([p["texto"] for p in dados["quadro"]["pendencias"]], ["Aprovar o orçamento da Capitã Marvel"])
        frente = dados["frentes"][0]
        self.assertEqual(frente["nome"], "#243 textos")
        self.assertEqual([m["nome"] for m in frente["membros"]], ["Gavião Arqueiro", "Viúva Negra"])
        self.assertEqual(frente["previsao"], "23h50")
        self.assertTrue(dados["quadro"]["editado_em"])

    def test_quadro_estragado_nao_derruba_e_avisa(self):
        self.quadro.write_text("{ isto não é json", encoding="utf-8")
        dados, _ = self.coletar("--telas", str(RAIZ / "telas-de-exemplo"))
        self.assertIn("ilegível", dados["quadro"]["erro"])
        self.assertEqual(len(dados["vingadores"]), 13)


class Comandos(ComPastaTemporaria):
    def test_missao_muda_so_o_que_foi_passado(self):
        codigo, out, _ = self.rodar("painel-missao", "Thor", "--missao", "Fluxo do contratante.", "--situacao",
                                    "trabalhando", "--previsao", "22h40")
        self.assertEqual(codigo, 0)
        self.assertIn("Thor:", out)
        self.rodar("painel-missao", "thor", "--situacao", "esperando Homem-Aranha")
        item = self.ler_quadro()["missoes"]["Thor"]
        self.assertEqual(item["missao"], "Fluxo do contratante.")
        self.assertEqual((item["situacao"], item["esperando"], item["previsao"]), ("esperando", "Homem-Aranha", "22h40"))
        self.rodar("painel-missao", "Thor", "--situacao", "parado", "--previsao", "")
        item = self.ler_quadro()["missoes"]["Thor"]
        self.assertEqual(item["situacao"], "parado")
        self.assertNotIn("esperando", item)
        self.assertNotIn("previsao", item)

    def test_limpar_apaga_a_linha(self):
        self.rodar("painel-missao", "Falcão", "--missao", "x")
        self.assertIn("Falcão", self.ler_quadro()["missoes"])
        codigo, _, _ = self.rodar("painel-missao", "falcao", "--limpar")
        self.assertEqual(codigo, 0)
        self.assertNotIn("Falcão", self.ler_quadro()["missoes"])

    def test_entrada_invalida_nao_muda_o_quadro(self):
        self.rodar("painel-missao", "Thor", "--missao", "original")
        antes = self.quadro.read_text(encoding="utf-8")
        ruins = [
            ("Batman", "--missao", "x"),
            ("Thor", "--situacao", "dormindo"),
            ("Thor", "--situacao", "esperando"),
            ("Thor", "--situacao", "parado ali"),
            ("Thor", "--previsao", "25h00"),
            ("Thor", "--previsao", "logo"),
            ("Thor", "--previsao", "31/02 10h00"),
            ("Thor", "--missao", "   "),
            ("Thor", "--missao", "x" * 281),
            ("Thor", "--pr", "abc"),
            ("Thor", "--pr", "outro-repo#3"),
            ("Thor", "--limpar", "--missao", "x"),
            ("Thor",),
            ("--missao", "sem vingador"),
        ]
        for args in ruins:
            codigo, _, err = self.rodar("painel-missao", *args)
            self.assertEqual(codigo, 2, args)
            self.assertTrue(err.startswith("painel-missao: "), args)
            self.assertEqual(self.quadro.read_text(encoding="utf-8"), antes, args)

    def test_pr_marcado_a_mao(self):
        self.rodar("painel-missao", "Hulk", "--pr", "41, app-web#2, #45, app-frontend 41")
        self.assertEqual(self.ler_quadro()["missoes"]["Hulk"]["prs"], [
            {"repo": "app-frontend", "numero": 41}, {"repo": "app-web", "numero": 2}, {"repo": "app-frontend", "numero": 45}])

    def test_pendencias(self):
        self.assertEqual(self.rodar("painel-pendencia", "--listar")[1].strip(), "Nenhuma pendência para o dono do painel.")
        self.rodar("painel-pendencia", "--adicionar", "Primeira:  com   espaços\na mais")
        self.rodar("painel-pendencia", "--adicionar", "Segunda")
        self.assertEqual(self.rodar("painel-pendencia", "--listar")[1].splitlines(),
                         ["1. Primeira: com espaços a mais [sem passos]", "2. Segunda [sem passos]"])
        codigo, out, _ = self.rodar("painel-pendencia", "--remover", "1")
        self.assertEqual(codigo, 0)
        self.assertIn("Primeira", out)
        self.assertEqual([p["texto"] for p in self.ler_quadro()["pendencias"]], ["Segunda"])
        for args in (("--remover", "5"), ("--remover", "0"), ("--remover", "x"), ("--adicionar", ""),
                     ("--adicionar", "Segunda"), ("--adicionar", "y" * 281), ()):
            codigo, _, err = self.rodar("painel-pendencia", *args)
            self.assertEqual(codigo, 2, args)
            self.assertTrue(err.startswith("painel-pendencia: "), args)
        self.assertEqual([p["texto"] for p in self.ler_quadro()["pendencias"]], ["Segunda"])

    def test_edicoes_simultaneas_nao_se_perdem(self):
        processos = [subprocess.Popen([sys.executable, str(RAIZ / "painel-pendencia"), "--adicionar", "item %d" % i],
                                      env=self.ambiente, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                     for i in range(12)]
        for p in processos:
            self.assertEqual(p.wait(), 0)
        self.assertEqual(sorted(p["texto"] for p in self.ler_quadro()["pendencias"]),
                         sorted("item %d" % i for i in range(12)))


ARQUIVO_DE_PASSOS = """destrava: O envio ao TestFlight pela CI (build 0.4, 20/10).
tempo: 15 min

1. Abra a App Store Connect em Usuários e acessos > Integrações > Chaves de API da equipe.
2. Crie uma chave com o papel Admin e baixe o arquivo `.p8` (só dá para baixar uma vez).
3. No GitHub, em app-frontend > Settings > Secrets > Actions, crie `APP_STORE_CONNECT_API_KEY_ID`.
fonte: app-frontend/iOS/Docs/CI.md
fonte: https://github.com/acme/app-frontend/pull/94
"""


class FormatoDePassos(unittest.TestCase):
    def test_arquivo_valido(self):
        lido = comum.ler_passos(ARQUIVO_DE_PASSOS)
        self.assertEqual(lido["destrava"], "O envio ao TestFlight pela CI (build 0.4, 20/10).")
        self.assertEqual(lido["tempo"], "15 min")
        self.assertEqual(len(lido["passos"]), 3)
        self.assertTrue(lido["passos"][0].startswith("Abra a App Store Connect"))
        self.assertIn("`.p8`", lido["passos"][1])
        self.assertEqual(lido["fontes"], ["app-frontend/iOS/Docs/CI.md", "https://github.com/acme/app-frontend/pull/94"])

    def test_so_passos_tambem_vale_e_os_prefixos_nao_dependem_de_maiuscula(self):
        lido = comum.ler_passos("  1.   Um passo   com espaços.\nTEMPO: 2 min\nFonte: a/b.md\n")
        self.assertEqual(lido, {"passos": ["Um passo com espaços."], "destrava": None, "tempo": "2 min", "fontes": ["a/b.md"]})
        self.assertEqual(comum.ler_passos("1. Só isto")["fontes"], [])

    def test_cada_erro_diz_a_linha(self):
        casos = {
            "": "nenhum passo",
            "destrava: x\ntempo: 1 min\n": "nenhum passo",
            "1. a\nisto não é passo\n": "linha 2",
            "1. a\n3. pulou\n": "linha 2",
            "2. começa errado\n": "linha 1",
            "1. a\n1. repetiu\n": "linha 2",
            "".join("%d. passo\n" % i for i in range(1, 14)): "linha 13",
            "1. " + "x" * 401 + "\n": "linha 1",
            "1. crase `sem par\n": "linha 1",
            "destrava: a\ndestrava: b\n1. x\n": "linha 2",
            "tempo: " + "y" * 21 + "\n1. x\n": "linha 1",
            "1. x\n" + "".join("fonte: f%d\n" % i for i in range(9)): "linha 10",
            "1. x\n- item de lista\n": "linha 2",
            "1. com caractere de controle \x07\n": "linha 1",
        }
        for texto, trecho in casos.items():
            with self.assertRaises(comum.ErroDeEntrada, msg=repr(texto)) as ctx:
                comum.ler_passos(texto)
            self.assertIn(trecho, str(ctx.exception), repr(texto))


class Passos(ComPastaTemporaria):
    def arquivo(self, nome, texto):
        caminho = self.pasta / nome
        caminho.write_text(texto, encoding="utf-8")
        return str(caminho)

    def test_passos_numa_acao_e_a_listagem_conta(self):
        self.rodar("painel-pendencia", "--pergunta", "Aprovar o orçamento?", "--recomendacao", "Sim")
        self.rodar("painel-pendencia", "--adicionar", "Criar a chave da App Store Connect")
        self.rodar("painel-pendencia", "--adicionar", "Abrir o Docker Desktop")
        codigo, out, err = self.rodar("painel-pendencia", "--passos", "2", "--arquivo", self.arquivo("p.txt", ARQUIVO_DE_PASSOS))
        self.assertEqual(codigo, 0, err)
        self.assertIn("3 passos", out)
        p = self.ler_quadro()["pendencias"][1]
        self.assertEqual(p["texto"], "Criar a chave da App Store Connect")
        self.assertEqual(len(p["passos"]), 3)
        self.assertEqual((p["destrava"], p["tempo"]), ("O envio ao TestFlight pela CI (build 0.4, 20/10).", "15 min"))
        self.assertEqual(len(p["fontes"]), 2)
        self.assertRegex(p["id"], r"^[0-9a-f]{8}$")
        linhas = self.rodar("painel-pendencia", "--listar")[1].splitlines()
        self.assertEqual(linhas[0], "1. (pergunta) Aprovar o orçamento?")
        self.assertEqual(linhas[2], "2. Criar a chave da App Store Connect [3 passos]")
        self.assertEqual(linhas[3], "3. Abrir o Docker Desktop [sem passos]")

    def test_adicionar_ja_com_passos(self):
        codigo, out, err = self.rodar("painel-pendencia", "--adicionar", "Criar a chave", "--arquivo", self.arquivo("p.txt", ARQUIVO_DE_PASSOS))
        self.assertEqual(codigo, 0, err)
        self.assertIn("com 3 passos", out)
        p = self.ler_quadro()["pendencias"][0]
        self.assertEqual((p["tipo"], len(p["passos"]), p["tempo"]), ("acao", 3, "15 min"))
        self.assertRegex(p["id"], r"^[0-9a-f]{8}$")
        # arquivo ruim: nada é criado
        codigo, _, err = self.rodar("painel-pendencia", "--adicionar", "Outra", "--arquivo", self.arquivo("ruim.txt", "1. a\nxx\n"))
        self.assertEqual(codigo, 2)
        self.assertIn("linha 2", err)
        self.assertEqual(len(self.ler_quadro()["pendencias"]), 1)

    def test_limpar_tira_os_passos_e_guarda_o_id(self):
        self.rodar("painel-pendencia", "--adicionar", "Criar a chave", "--arquivo", self.arquivo("p.txt", ARQUIVO_DE_PASSOS))
        id_antes = self.ler_quadro()["pendencias"][0]["id"]
        codigo, out, err = self.rodar("painel-pendencia", "--passos", "1", "--limpar")
        self.assertEqual(codigo, 0, err)
        self.assertIn("sem passos", out)
        p = self.ler_quadro()["pendencias"][0]
        for campo in ("passos", "destrava", "tempo", "fontes"):
            self.assertNotIn(campo, p)
        self.assertEqual(p["id"], id_antes)
        self.assertIn("[sem passos]", self.rodar("painel-pendencia", "--listar")[1])

    def test_pendencia_antiga_ganha_id_so_quando_recebe_passos(self):
        self.quadro.write_text(json.dumps({"versao": 1, "editado_em": None, "missoes": {}, "pendencias": [
            {"texto": "Antiga, sem tipo nem id", "criada_em": "2026-10-01T21:48:49-03:00"}]}), encoding="utf-8")
        self.assertIn("1. Antiga, sem tipo nem id [sem passos]", self.rodar("painel-pendencia", "--listar")[1])
        codigo, _, err = self.rodar("painel-pendencia", "--passos", "1", "--arquivo", self.arquivo("p.txt", "1. Faça.\n"))
        self.assertEqual(codigo, 0, err)
        p = self.ler_quadro()["pendencias"][0]
        self.assertEqual(p["passos"], ["Faça."])
        self.assertRegex(p["id"], r"^[0-9a-f]{8}$")

    def test_entrada_invalida_nao_muda_o_quadro(self):
        self.rodar("painel-pendencia", "--pergunta", "Aprovar?", "--recomendacao", "Sim")
        self.rodar("painel-pendencia", "--adicionar", "Ação")
        bom = self.arquivo("p.txt", ARQUIVO_DE_PASSOS)
        antes = self.quadro.read_text(encoding="utf-8")
        ruins = [
            ("--passos", "1", "--arquivo", bom),                        # pergunta não tem passos
            ("--passos", "3", "--arquivo", bom),                        # não existe
            ("--passos", "0", "--arquivo", bom),
            ("--passos", "x", "--arquivo", bom),
            ("--passos", "2"),                                          # sem --arquivo nem --limpar
            ("--passos", "2", "--arquivo", bom, "--limpar"),            # os dois
            ("--passos", "2", "--arquivo", str(self.pasta / "nao-existe.txt")),
            ("--passos", "2", "--arquivo", self.arquivo("vazio.txt", "")),
            ("--passos", "2", "--arquivo", self.arquivo("ruim.txt", "1. a\n3. b\n")),
            ("--passos", "2", "--arquivo", self.arquivo("ruim2.txt", "1. a\ndestrava: b\ndestrava: c\n")),
            ("--arquivo", bom),                                         # sem --passos nem --adicionar
            ("--limpar",),
            ("--remover", "1", "--arquivo", bom),
            ("--pergunta", "Outra?", "--recomendacao", "x", "--arquivo", bom),  # pergunta não tem passos
        ]
        for args in ruins:
            codigo, _, err = self.rodar("painel-pendencia", *args)
            self.assertEqual(codigo, 2, args)
            self.assertTrue(err.startswith("painel-pendencia: "), args)
            self.assertEqual(self.quadro.read_text(encoding="utf-8"), antes, args)

    def test_dados_json_leva_os_campos_e_a_pendencia_antiga_sai_sem_eles(self):
        self.rodar("painel-pendencia", "--adicionar", "Criar a chave", "--arquivo", self.arquivo("p.txt", ARQUIVO_DE_PASSOS))
        quadro = self.ler_quadro()
        quadro["pendencias"].append({"texto": "Antiga", "criada_em": "2026-10-01T21:48:49-03:00"})
        self.quadro.write_text(json.dumps(quadro, ensure_ascii=False), encoding="utf-8")
        dados, _ = self.coletar("--telas", str(RAIZ / "telas-de-exemplo"))
        nova, antiga = dados["quadro"]["pendencias"]
        self.assertEqual(nova["texto"], "Criar a chave")
        self.assertRegex(nova["id"], r"^[0-9a-f]{8}$")
        self.assertEqual(len(nova["passos"]), 3)
        self.assertIn("`APP_STORE_CONNECT_API_KEY_ID`", nova["passos"][2])
        self.assertEqual((nova["destrava"], nova["tempo"]), ("O envio ao TestFlight pela CI (build 0.4, 20/10).", "15 min"))
        self.assertEqual(len(nova["fontes"]), 2)
        self.assertEqual(antiga, {"id": None, "texto": "Antiga", "criada_em": "2026-10-01T21:48:49-03:00", "tipo": "acao",
                                  "recomendacao": None, "passos": [], "destrava": None, "tempo": None, "fontes": []})


class Previsao(unittest.TestCase):
    FUSO = timezone(timedelta(hours=-3))

    def previsao(self, texto, agora):
        return comum.interpretar_previsao(texto, datetime(2026, 10, 1, *agora, tzinfo=self.FUSO))

    def test_formatos(self):
        for texto in ("22h40", "22:40", "22H40", " 22h40 "):
            self.assertEqual(self.previsao(texto, (21, 30))[0], "22h40")
        self.assertEqual(self.previsao("9h", (8, 0))[0], "09h00")

    def test_hoje_amanha_e_atrasada(self):
        self.assertEqual(self.previsao("22h40", (21, 30))[1].day, 1)
        self.assertEqual(self.previsao("01h30", (23, 0))[1].day, 2)     # passou há mais de 12 h: é amanhã
        self.assertEqual(self.previsao("21h00", (21, 30))[1].day, 1)    # passou há pouco: é hoje, atrasada
        self.assertEqual(self.previsao("02/10 09h00", (21, 30))[1].strftime("%d/%m %H:%M"), "02/10 09:00")


class Nomes(unittest.TestCase):
    def test_acento_nao_quebra(self):
        mapa = comum.carregar_mapa()
        self.assertEqual([v["nome"] for v in mapa["vingadores"]], ORDEM)
        casos = {"Capitã Marvel": "capita-marvel", "Gavião Arqueiro": "gaviao-arqueiro", "Viúva Negra": "viuva-negra",
                 "Falcão": "falcao", "Homem-Aranha": "homem-aranha"}
        for nome, esperado in casos.items():
            self.assertEqual(comum.slug(nome), esperado)
            self.assertTrue((RAIZ / "telas-de-exemplo" / (esperado + ".txt")).exists())
            for variante in (nome, nome.upper(), esperado.replace("-", " "),
                             __import__("unicodedata").normalize("NFD", nome)):
                self.assertEqual(comum.achar_vingador(variante, mapa), nome, variante)


class Prs(unittest.TestCase):
    def test_resumo_da_ci(self):
        def check(status, conclusao=""):
            return {"__typename": "CheckRun", "status": status, "conclusion": conclusao}
        self.assertEqual(prs.resumir_ci([])["estado"], "sem_ci")
        self.assertEqual(prs.resumir_ci(None)["estado"], "sem_ci")
        self.assertEqual(prs.resumir_ci([check("COMPLETED", "SUCCESS"), check("COMPLETED", "SKIPPED")])["estado"], "passou")
        self.assertEqual(prs.resumir_ci([check("COMPLETED", "SUCCESS"), check("IN_PROGRESS")])["estado"], "rodando")
        self.assertEqual(prs.resumir_ci([check("IN_PROGRESS"), check("COMPLETED", "FAILURE")])["estado"], "falhou")
        self.assertEqual(prs.resumir_ci([check("COMPLETED", "CANCELLED")])["estado"], "falhou")
        self.assertEqual(prs.resumir_ci([{"__typename": "StatusContext", "state": "PENDING"}])["estado"], "rodando")
        self.assertEqual(prs.resumir_ci([{"__typename": "StatusContext", "state": "SUCCESS"}])["estado"], "passou")

    def test_de_quem_e_o_pr(self):
        def pr(numero, branch, sha, repo="app-frontend"):
            return {"repo": repo, "numero": numero, "branch": branch, "sha": sha}
        lista = [pr(41, "test/marcador", "aaa"), pr(45, "fix/textos", "bbb"), pr(2, "ao/app-11", "ccc", "app-web")]
        worktrees = {
            "Thor": {"app-frontend": {"branch": "test/marcador", "sha": "aaa"}},
            "Steve Rogers": {"app-frontend": {"branch": None, "sha": "bbb"}},     # HEAD solto na ponta do PR
            "Loki": {"app-frontend": {"branch": "main", "sha": "zzz"}, "app-web": {"branch": "main", "sha": "yyy"}},
        }
        por_vingador, sem_dono = prs.distribuir(lista, worktrees, {})
        self.assertEqual([p["numero"] for p in por_vingador["Thor"]], [41])
        self.assertEqual([p["numero"] for p in por_vingador["Steve Rogers"]], [45])
        self.assertNotIn("Loki", por_vingador)
        self.assertEqual([p["numero"] for p in sem_dono], [2])
        # A marcação do Nick Fury vale mais do que a branch do worktree.
        marcados = {"Homem-Aranha": [{"repo": "app-frontend", "numero": 41}]}
        por_vingador, _ = prs.distribuir(lista, worktrees, marcados)
        self.assertEqual([p["numero"] for p in por_vingador["Homem-Aranha"]], [41])
        self.assertNotIn("Thor", por_vingador)


if __name__ == "__main__":
    unittest.main()
