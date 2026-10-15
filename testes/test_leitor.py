# -*- coding: utf-8 -*-
"""Testes do leitor de tela, um bloco por ferramenta.

Rodar:  python3 -m unittest discover -s testes -v      (na pasta do painel)

As telas de telas-de-exemplo/ são reais, salvas em 01/10/2026 às 21h30. Em testes/telas/, as
`*-trabalhando` e a `codex-com-status-de-outros` são sintéticas: não havia tela real de Claude
Code nem de Antigravity trabalhando. As do comando digitado e dos menus (`codex-so-a-barra`,
`codex-status-digitado-*`, `codex-menu-de-*`, `claude-so-a-barra`, `claude-usage-digitado`) são
reais, do Codex 0.160.0 e do Claude Code 2.1.287, tiradas em 02/10/2026 de um terminal isolado.
"""
import sys
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(RAIZ / "lib"))

import leitor   # noqa: E402

REAIS = RAIZ / "telas-de-exemplo"
SINTETICAS = RAIZ / "testes" / "telas"
BORDA = "─" * 120


def ler(pasta, nome, ferramenta):
    return leitor.ler_tela((pasta / (nome + ".txt")).read_text(encoding="utf-8"), ferramenta)


def tela_claude(status, conversa="⏺ feito\n"):
    return "%s\n%s\n❯ \n%s\n  %s\n  ⏵⏵ bypass permissions on (shift+tab to cycle)\n" % (conversa, BORDA, BORDA, status)


def tela_codex(status, conversa="• Ran git status\n  └ (no output)\n"):
    return "%s\n\n› Ask Codex to do anything\n\n  %s\n  ? for shortcuts\n" % (conversa, status)


def tela_agy(status, conversa="● Bash(git status)\n\n  Pronto.\n"):
    return "%s\n%s\n>\n%s\n%s\n" % (conversa, BORDA, BORDA, status)


class ClaudeCode(unittest.TestCase):
    def test_tela_real_ociosa(self):
        r = ler(REAIS, "agente-02", "claude")
        self.assertEqual((r["leitura"], r["estado"], r["modelo"]), ("ok", "ocioso", "Opus 5.5"))
        self.assertEqual((r["contexto_pct"], r["sessao_5h_pct"], r["semanal_pct"]), (31, 2, 55))
        self.assertEqual(r["ultima_resposta_as"], "20h03")
        self.assertIn("Fico parado, sem pegar nada novo.", r["ultima_fala"])
        self.assertIsNone(r["atividade"])

    def test_tracos_antes_da_primeira_resposta_sao_sem_dado_e_nao_zero(self):
        r = ler(REAIS, "agente-03", "claude")
        self.assertEqual((r["leitura"], r["estado"], r["modelo"]), ("ok", "ocioso", "Opus 5.5"))
        self.assertIsNone(r["contexto_pct"])
        self.assertIsNone(r["sessao_5h_pct"])
        self.assertIsNone(r["semanal_pct"])
        self.assertIsNone(r["ultima_fala"])     # sessão nova: não há fala

    def test_so_o_contexto_com_tracos(self):
        r = leitor.ler_tela(tela_claude("Opus 5.5 · ctx [░░░░░░░░░░] --% · 5h 6% · sem 56% · (main)"), "claude")
        self.assertIsNone(r["contexto_pct"])
        self.assertEqual((r["sessao_5h_pct"], r["semanal_pct"]), (6, 56))

    def test_zero_de_verdade_e_zero(self):
        r = leitor.ler_tela(tela_claude("Opus 5.5 · ctx [░░░░░░░░░░] 0% · 5h 0% · sem 0% · (main)"), "claude")
        self.assertEqual((r["contexto_pct"], r["sessao_5h_pct"], r["semanal_pct"]), (0, 0, 0))

    def test_trabalhando(self):
        r = ler(SINTETICAS, "claude-trabalhando", "claude")
        self.assertEqual(r["estado"], "trabalhando")
        self.assertEqual(r["trabalhando_ha"], "2m 13s")
        self.assertEqual((r["contexto_pct"], r["sessao_5h_pct"], r["semanal_pct"]), (61, 12, 56))
        self.assertTrue(r["atividade"].startswith("Bash(xcodebuild test"), r["atividade"])
        self.assertNotIn("Running", r["atividade"])

    def test_linha_de_fecho_nao_e_trabalho(self):
        tela = tela_claude("Opus 5.5 · ctx [████░░░░░░] 47% · 5h 6% · sem 56% · (main)",
                           "⏺ Pronto.\n\n✻ Cogitated for 1m 46s · done 9:23 PM · 2 shells still running\n")
        r = leitor.ler_tela(tela, "claude")
        self.assertEqual((r["estado"], r["ultima_resposta_as"]), ("ocioso", "21h23"))

    def test_status_line_cortada_nao_vira_numero(self):
        r = leitor.ler_tela(tela_claude("Opus 5.5 · ctx [███░░░░░░░] 31% · 5h 2% · sem 5"), "claude")
        self.assertEqual((r["contexto_pct"], r["sessao_5h_pct"]), (31, 2))
        self.assertIsNone(r["semanal_pct"])

    def test_sem_status_line_e_sem_leitura(self):
        r = leitor.ler_tela("⏺ texto qualquer\n\n❯ \n", "claude")
        self.assertEqual((r["leitura"], r["estado"]), ("sem_leitura", "sem_leitura"))
        self.assertIsNone(r["contexto_pct"])
        self.assertTrue(r["motivo"])

    def test_status_line_de_outro_agente_no_meio_da_tela_nao_vale(self):
        tela = "⏺ Bash(tmux capture-pane -p -t \"Agente 06\")\n  ⎿  Gemini 3.8 Flash (High) · ctx [███████░░░] 71% · idle · 5h 32% · sem 7% · (main)\n" \
               + "\n".join("  linha %d" % i for i in range(12)) + "\n\n  Do you want to proceed?\n  ❯ 1. Yes\n    2. No\n"
        r = leitor.ler_tela(tela, "claude")
        self.assertEqual(r["leitura"], "sem_leitura")
        self.assertIsNone(r["contexto_pct"])

    def test_tela_vazia_e_lixo_nao_derrubam(self):
        for tela in ("", "   \n\n", "\x00\x01\x02 ��", "can't find pane: X"):
            r = leitor.ler_tela(tela, "claude")
            self.assertEqual(r["leitura"], "sem_leitura", repr(tela))


class Codex(unittest.TestCase):
    def test_tela_real_trabalhando_converte_resta_em_usado(self):
        r = ler(REAIS, "agente-04", "codex")
        self.assertEqual((r["leitura"], r["estado"]), ("ok", "trabalhando"))
        self.assertEqual((r["modelo"], r["esforco"]), ("GPT-6.1-Sol", "high"))
        self.assertEqual(r["contexto_pct"], 42)             # "Context 42% used"
        self.assertEqual(r["sessao_5h_pct"], 17)            # "5h 83% left"
        self.assertEqual(r["semanal_pct"], 3)               # "weekly 97% left"
        self.assertEqual(r["trabalhando_ha"], "3m 26s")
        self.assertTrue(r["atividade"].startswith("O origin/main já foi incorporado"), r["atividade"])

    def test_tela_real_ociosa_com_aviso_de_limite(self):
        r = ler(REAIS, "agente-05", "codex")
        self.assertEqual((r["estado"], r["modelo"]), ("ocioso", "GPT-6-Astra"))
        self.assertEqual((r["contexto_pct"], r["sessao_5h_pct"], r["semanal_pct"]), (0, 17, 3))
        self.assertIn("less than 10% of your weekly limit", r["aviso"])
        self.assertIsNone(r["ultima_fala"])

    def test_conversao_nos_extremos(self):
        casos = {"5h 100% left · weekly 0% left": (0, 100), "5h 0% left · weekly 100% left": (100, 0),
                 "5h 1% left · weekly 99% left": (99, 1)}
        for trecho, (cinco, semana) in casos.items():
            r = leitor.ler_tela(tela_codex("GPT-6.1-Sol high · Context 10% used · " + trecho + " · Ready · ~/x"), "codex")
            self.assertEqual((r["sessao_5h_pct"], r["semanal_pct"]), (cinco, semana), trecho)

    def test_cota_que_ja_vem_usada_nao_e_convertida(self):
        r = leitor.ler_tela(tela_codex("GPT-6.1-Sol high · Context 10% used · 5h 30% used · weekly 40% used · Ready"), "codex")
        self.assertEqual((r["sessao_5h_pct"], r["semanal_pct"]), (30, 40))

    def test_contexto_que_vem_como_resta(self):
        r = leitor.ler_tela(tela_codex("GPT-6.1-Sol high · Context 30% left · 5h 83% left · Ready"), "codex")
        self.assertEqual(r["contexto_pct"], 70)
        self.assertIsNone(r["semanal_pct"])

    def test_status_line_de_outros_agentes_no_meio_da_tela(self):
        r = ler(SINTETICAS, "codex-com-status-de-outros", "codex")
        self.assertEqual(r["contexto_pct"], 42)     # nem os 71% do Claude Code nem os 88% do outro Codex
        self.assertEqual((r["sessao_5h_pct"], r["semanal_pct"]), (17, 3))
        self.assertEqual((r["estado"], r["modelo"]), ("ocioso", "GPT-6.1-Sol"))

    def test_so_a_linha_context_vale(self):
        # Só a status line de outro agente na tela, e nenhuma "Context NN% used": sem leitura.
        tela = tela_codex("  Opus 5.5 · ctx [███████░░░] 71% · 5h 40% · sem 80% · (main)")
        r = leitor.ler_tela(tela, "codex")
        self.assertEqual(r["leitura"], "sem_leitura")
        self.assertIsNone(r["contexto_pct"])

    def test_sem_estado_na_linha_e_indeterminado(self):
        r = leitor.ler_tela(tela_codex("GPT-6.1-Sol high · Context 42% used · 5h 83% le…"), "codex")
        self.assertEqual(r["estado"], "indeterminado")
        self.assertEqual(r["contexto_pct"], 42)
        self.assertIsNone(r["sessao_5h_pct"])

    def test_comando_ja_terminado_nao_e_trabalho(self):
        # Já foi um erro real de leitura: "└ python3 - <<'PY'…" na tela com o Codex em Ready.
        r = leitor.ler_tela(tela_codex("GPT-6.1-Sol high · Context 42% used · 5h 83% left · weekly 97% left · Ready · ~/x",
                                       "• Ran python3 - <<'PY' …\n  └ (no output)\n"), "codex")
        self.assertEqual(r["estado"], "ocioso")


class Antigravity(unittest.TestCase):
    def test_tela_real_titular_no_grupo_gemini(self):
        r = ler(REAIS, "agente-06", "agy")
        self.assertEqual((r["leitura"], r["estado"], r["modelo"]), ("ok", "ocioso", "Gemini 3.8 Flash (High)"))
        self.assertEqual((r["contexto_pct"], r["sessao_5h_pct"], r["semanal_pct"]), (21, 32, 7))
        self.assertEqual(r["grupo_cota"], "Gemini")
        self.assertEqual(r["ultima_fala"], "Entendido. Fico parado aguardando a próxima missão.")

    def test_tela_real_ajudante_no_grupo_claude_gpt(self):
        r = ler(REAIS, "agente-11", "agy")
        self.assertEqual((r["estado"], r["modelo"]), ("ocioso", "Claude Opus 4.6 (Thinking)"))
        self.assertEqual((r["contexto_pct"], r["sessao_5h_pct"], r["semanal_pct"]), (23, 13, 5))
        self.assertEqual(r["grupo_cota"], "Claude/GPT")

    def test_status_line_no_alto_da_tela_com_o_resto_vazio(self):
        r = ler(REAIS, "agente-10", "agy")      # sessão nova: a linha está na 11ª de 68 linhas
        self.assertEqual((r["leitura"], r["estado"]), ("ok", "ocioso"))
        self.assertEqual((r["contexto_pct"], r["sessao_5h_pct"], r["semanal_pct"]), (0, 0, 0))

    def test_trabalhando(self):
        r = ler(SINTETICAS, "agy-trabalhando", "agy")
        self.assertEqual((r["estado"], r["estado_bruto"]), ("trabalhando", "tool_use"))
        self.assertEqual((r["contexto_pct"], r["sessao_5h_pct"], r["semanal_pct"]), (57, 91, 14))
        self.assertEqual(r["atividade"], "Bash(xcodebuild build -project iOS/App.xcodeproj -scheme App-Local)")

    def test_estados_da_status_line(self):
        esperado = {"idle": "ocioso", "thinking": "trabalhando", "working": "trabalhando", "tool_use": "trabalhando",
                    "initializing": "trabalhando", "confirmacao": "trabalhando", "fila": "trabalhando",
                    "outro_estado": "indeterminado"}
        for bruto, estado in esperado.items():
            r = leitor.ler_tela(tela_agy("Gemini 3.8 Flash (High) · ctx [██░░░░░░░░] 21%% · %s · 5h 32%% · sem 7%% · (main)" % bruto), "agy")
            self.assertEqual(r["estado"], estado, bruto)

    def test_confirmacao_pendente_aparece_na_atividade(self):
        r = leitor.ler_tela(tela_agy("Gemini 3.8 Flash (High) · ctx [██░░░░░░░░] 21% · confirmacao · 5h 32% · sem 7% · (main)",
                                     "● Bash(rm -rf build)\n"), "agy")
        self.assertTrue(r["atividade"].startswith("aguardando confirmação de ferramenta"), r["atividade"])

    def test_sem_estado_na_linha_e_indeterminado(self):
        r = leitor.ler_tela(tela_agy("Gemini 3.8 Flash (High) · ctx [██░░░░░░░░] 21% · 5h 32% · sem 7% · (main)"), "agy")
        self.assertEqual(r["estado"], "indeterminado")
        self.assertEqual(r["contexto_pct"], 21)

    def test_outros_limites_ficam_separados(self):
        r = leitor.ler_tela(tela_agy("Gemini 3.8 Flash (High) · ctx [██░░░░░░░░] 21% · idle · 5h 32% · dia 40% · sem 7% · (main)"), "agy")
        self.assertEqual((r["sessao_5h_pct"], r["semanal_pct"], r["outras_cotas"]), (32, 7, {"dia": 40}))

    def test_todas_as_telas_reais_do_antigravity(self):
        esperado = {"agente-07": (21, 12, 43), "agente-08": (9, 53, 14), "agente-09": (12, 17, 7),
                    "agente-12": (0, 0, 0), "agente-13": (0, 0, 0)}
        for nome, numeros in esperado.items():
            r = ler(REAIS, nome, "agy")
            self.assertEqual((r["contexto_pct"], r["sessao_5h_pct"], r["semanal_pct"]), numeros, nome)
            self.assertEqual(r["estado"], "ocioso", nome)


class PromptEComando(unittest.TestCase):
    """O que a sonda de cota confere antes de mandar Enter."""

    def ver(self, pasta, nome, ferramenta):
        return leitor.prompt_e_comando((pasta / (nome + ".txt")).read_text(encoding="utf-8"), ferramenta)

    def test_prompt_vazio_das_telas_reais(self):
        for nome, ferramenta in (("agente-05", "codex"), ("agente-04", "codex"), ("agente-02", "claude"), ("agente-03", "claude")):
            self.assertEqual(self.ver(REAIS, nome, ferramenta), ("", None), nome)

    def test_codex_com_o_comando_digitado_e_o_menu_de_comandos(self):
        self.assertEqual(self.ver(SINTETICAS, "codex-status-digitado-com-menu", "codex"), ("/status", "/status"))
        self.assertEqual(self.ver(SINTETICAS, "codex-status-digitado-sem-menu", "codex"), ("/status", None))

    def test_codex_com_so_a_barra_o_enter_executaria_o_model(self):
        self.assertEqual(self.ver(SINTETICAS, "codex-so-a-barra", "codex"), ("/", "/model"))

    def test_claude_com_o_comando_digitado_e_com_so_a_barra(self):
        self.assertEqual(self.ver(SINTETICAS, "claude-usage-digitado", "claude"), ("/usage", "/usage"))
        self.assertEqual(self.ver(SINTETICAS, "claude-so-a-barra", "claude"), ("/", "/deploy"))

    def test_menu_aberto_ou_painel_na_tela_nao_tem_prompt(self):
        for nome in ("codex-menu-de-modelo", "codex-menu-de-raciocinio"):
            self.assertEqual(self.ver(SINTETICAS, nome, "codex"), (None, None), nome)
        self.assertEqual(self.ver(REAIS / "sonda", "claude-usage", "claude"), (None, None))
        self.assertEqual(leitor.prompt_e_comando("", "codex"), (None, None))

    def test_texto_de_outra_pessoa_no_prompt_vem_como_esta(self):
        self.assertEqual(leitor.prompt_e_comando(tela_codex("GPT-6.1-Sol high · Context 3% used · 5h 90% left · weekly 97% left · Ready · ~/x")
                                                 .replace("Ask Codex to do anything", "rascunho do dono do painel"), "codex"),
                         ("rascunho do dono do painel", None))
        self.assertEqual(leitor.prompt_e_comando(tela_claude("Opus 5.5 · ctx [███░░░░░░░] 31% · 5h 2% · sem 55% · (main)")
                                                 .replace("❯ \n", "❯ rascunho do dono do painel\n"), "claude"),
                         ("rascunho do dono do painel", None))


class Segredos(unittest.TestCase):
    def test_mascara_o_que_tem_cara_de_segredo(self):
        segredos = [
            "ghp_" + "a1B2" * 9,
            "github_pat_" + "A1b2C3d4E5" * 3,
            "sk-" + "abcd1234" * 4,
            "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl",
            "AIza" + "Sy0aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0u",
            "0123456789abcdef0123456789abcdef01234567",
            "SUPABASE_SERVICE_ROLE_KEY=valor-secreto-123",
            "senha: hunter2abc",
            "Bearer abcDEF123456ghiJKL",
        ]
        for s in segredos:
            saida = leitor.mascarar("antes %s depois" % s)
            self.assertIn(leitor.OCULTO, saida, s)
            self.assertNotIn(s.split("=")[-1].split(": ")[-1].split(" ")[-1], saida, s)

    def test_nao_estraga_texto_comum(self):
        for texto in ("Bash(git push origin feat/ios-conformidade-binario-96)",
                      "~/projetos/agente-04/meu-app/iOS/Sources/Apresentacao",
                      "id=00000000-0000-0000-0000-000000000000", "Thought for 7s, 219 tokens",
                      "o token em arquivo 600", "Agente 03, Agente 11, Agente 12 e Agente 13"):
            self.assertEqual(leitor.mascarar(texto), texto)

    def test_segredo_na_tela_nao_chega_a_atividade(self):
        token = "ghp_" + "Z9y8" * 9
        r = leitor.ler_tela(tela_agy("Gemini 3.8 Flash (High) · ctx [██░░░░░░░░] 21% · tool_use · 5h 32% · sem 7% · (main)",
                                     "● Bash(curl -H 'Authorization: token %s' https://api.github.com)\n" % token), "agy")
        self.assertEqual(r["estado"], "trabalhando")
        self.assertNotIn(token, r["atividade"])


if __name__ == "__main__":
    unittest.main()


class SegundoPlano(unittest.TestCase):
    """Regra do dono do painel (03/10/2026): esperando CI, build ou teste em segundo plano conta como trabalhando."""

    AGY = (
        "  Iniciada a suíte no simulador. Aguardando conclusão.\n"
        ">\n"
        "  ● [18:38:33] ~/ferramentas/fila.sh \"Agente 06\" -- xcodebuild test -project iOS/App.xcodeproj -s... running\n"
        "Gemini 3.8 Flash (High) · ctx [█░░░░░░░░░] 10% · idle · 5h 30% · sem 66% · (main)\n"
    )
    AGY_PARADO = (
        "  Pronto.\n"
        ">\n"
        "Gemini 3.8 Flash (High) · ctx [█░░░░░░░░░] 10% · idle · 5h 30% · sem 66% · (main)\n"
    )
    CLAUDE = (
        "⏺ Esperando a CI do PR.\n"
        "❯ \n"
        "  Opus 5.5 · ctx [████░░░░░░] 40% · 5h 17% · sem 41% · (main)\n"
        "  ⏵⏵ bypass permissions on · 1 shell · ← 2 agents\n"
    )

    def test_agy_com_comando_rodando_esta_trabalhando(self):
        r = leitor.ler_tela(self.AGY, "agy")
        self.assertEqual(r["estado"], "trabalhando")
        self.assertEqual(r["estado_bruto"], "segundo_plano")
        self.assertIn("xcodebuild", r["atividade"])

    def test_agy_sem_comando_continua_ocioso(self):
        self.assertEqual(leitor.ler_tela(self.AGY_PARADO, "agy")["estado"], "ocioso")

    def test_claude_com_shell_em_segundo_plano_esta_trabalhando(self):
        r = leitor.ler_tela(self.CLAUDE, "claude")
        self.assertEqual(r["estado"], "trabalhando")
        self.assertEqual(r["estado_bruto"], "segundo_plano")

    def test_codex_esperando_terminal_em_segundo_plano_esta_trabalhando(self):
        tela = (
            "• Working (54m 44s • esc to interrupt) · 1 background terminal running · /ps to view\n"
            "› Ask Codex to do anything\n"
            "  GPT-6.1-Sol high · Context 35% used · 5h 68% left · weekly 75% left · Waiting · ~/x\n"
        )
        self.assertEqual(leitor.ler_tela(tela, "codex")["estado"], "trabalhando")
