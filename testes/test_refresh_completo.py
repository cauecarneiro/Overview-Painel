# -*- coding: utf-8 -*-
"""Testes do script refresh-completo (reconciliação do quadro.json)."""
from datetime import datetime, timedelta
import importlib.util
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "lib"))
import comum  # noqa: E402

from importlib.machinery import SourceFileLoader
refresh_completo = SourceFileLoader("refresh_completo", str(comum.RAIZ / "refresh-completo")).load_module()


class TestReconciliacao(unittest.TestCase):
    def setUp(self):
        self.mapa = {
            "repos": [
                {"nome": "meu-app", "gh": "acme/meu-app"},
                {"nome": "meu-site", "gh": "acme/meu-site"}
            ],
            "agentes": [
                {"nome": "Agente 06"},
                {"nome": "Agente 08"},
                {"nome": "Agente 01"}
            ]
        }
        self.agora = datetime(2026, 10, 12, 14, 30, 0).astimezone()

    def test_trabalhando_sem_evidencia_ha_mais_de_5min_vira_parado(self):
        quadro = {
            "missoes": {
                "Agente 08": {
                    "missao": "Tarefa antiga que parou",
                    "situacao": "trabalhando",
                    "editado_em": "2026-10-12T14:10:00-03:00"
                }
            },
            "pendencias": []
        }
        terminais = {
            "Agente 08": {
                "evidencia": "mudou",
                "fresco_em": int(self.agora.timestamp()) - 1200
            }
        }
        with patch.object(Path, "exists", return_value=True), \
             patch("builtins.open", unittest.mock.mock_open(read_data=json.dumps({"terminais": terminais}))):
            mudancas = refresh_completo.reconciliar_dados(quadro, self.mapa, self.agora, simular=False)

        self.assertEqual(len(mudancas), 1)
        self.assertEqual(quadro["missoes"]["Agente 08"]["situacao"], "parado")
        self.assertEqual(quadro["missoes"]["Agente 08"]["missao"], "Tarefa antiga que parou")

    def test_trabalhando_com_evidencia_ativa_nao_muda(self):
        quadro = {
            "missoes": {
                "Agente 06": {
                    "missao": "Refresh do painel",
                    "situacao": "trabalhando",
                    "editado_em": "2026-10-12T14:25:00-03:00"
                }
            },
            "pendencias": []
        }
        terminais = {
            "Agente 06": {
                "evidencia": "trabalhando",
                "fresco_em": int(self.agora.timestamp()) - 30
            }
        }
        with patch.object(Path, "exists", return_value=True), \
             patch("builtins.open", unittest.mock.mock_open(read_data=json.dumps({"terminais": terminais}))):
            mudancas = refresh_completo.reconciliar_dados(quadro, self.mapa, self.agora, simular=False)

        self.assertEqual(len(mudancas), 0)
        self.assertEqual(quadro["missoes"]["Agente 06"]["situacao"], "trabalhando")

    def test_trabalhando_em_carencia_menor_que_5min_nao_vira_parado(self):
        quadro = {
            "missoes": {
                "Agente 06": {
                    "missao": "Recém iniciada",
                    "situacao": "trabalhando",
                    "editado_em": (self.agora - timedelta(minutes=2)).isoformat()
                }
            },
            "pendencias": []
        }
        terminais = {
            "Agente 06": {
                "evidencia": "mudou",
                "fresco_em": int(self.agora.timestamp()) - 120
            }
        }
        with patch.object(Path, "exists", return_value=True), \
             patch("builtins.open", unittest.mock.mock_open(read_data=json.dumps({"terminais": terminais}))):
            mudancas = refresh_completo.reconciliar_dados(quadro, self.mapa, self.agora, simular=False)

        self.assertEqual(len(mudancas), 0)
        self.assertEqual(quadro["missoes"]["Agente 06"]["situacao"], "trabalhando")

    def test_situacao_esperando_nao_mexe(self):
        quadro = {
            "missoes": {
                "Agente 01": {
                    "missao": "Aguardando aprovação",
                    "situacao": "esperando",
                    "esperando": "o dono do painel",
                    "editado_em": "2026-10-12T14:00:00-03:00"
                }
            },
            "pendencias": []
        }
        terminais = {
            "Agente 01": {
                "evidencia": "mudou",
                "fresco_em": int(self.agora.timestamp()) - 1800
            }
        }
        with patch.object(Path, "exists", return_value=True), \
             patch("builtins.open", unittest.mock.mock_open(read_data=json.dumps({"terminais": terminais}))):
            mudancas = refresh_completo.reconciliar_dados(quadro, self.mapa, self.agora, simular=False)

        self.assertEqual(len(mudancas), 0)
        self.assertEqual(quadro["missoes"]["Agente 01"]["situacao"], "esperando")
        self.assertEqual(quadro["missoes"]["Agente 01"]["esperando"], "o dono do painel")

    def test_previsao_vencida_some(self):
        quadro = {
            "missoes": {
                "Agente 06": {
                    "missao": "Em curso",
                    "situacao": "trabalhando",
                    "previsao": "14h00",
                    "previsao_em": "2026-10-12T14:00:00-03:00",
                    "editado_em": self.agora.isoformat()
                }
            },
            "pendencias": []
        }
        terminais = {
            "Agente 06": {
                "evidencia": "trabalhando",
                "fresco_em": int(self.agora.timestamp()) - 10
            }
        }
        with patch.object(Path, "exists", return_value=True), \
             patch("builtins.open", unittest.mock.mock_open(read_data=json.dumps({"terminais": terminais}))):
            mudancas = refresh_completo.reconciliar_dados(quadro, self.mapa, self.agora, simular=False)

        self.assertEqual(len(mudancas), 1)
        self.assertNotIn("previsao", quadro["missoes"]["Agente 06"])
        self.assertNotIn("previsao_em", quadro["missoes"]["Agente 06"])
        self.assertEqual(quadro["missoes"]["Agente 06"]["missao"], "Em curso")
        self.assertEqual(quadro["missoes"]["Agente 06"]["situacao"], "trabalhando")

    def test_previsao_futura_fica(self):
        quadro = {
            "missoes": {
                "Agente 06": {
                    "missao": "Em curso",
                    "situacao": "trabalhando",
                    "previsao": "15h30",
                    "previsao_em": "2026-10-12T15:30:00-03:00",
                    "editado_em": self.agora.isoformat()
                }
            },
            "pendencias": []
        }
        terminais = {
            "Agente 06": {
                "evidencia": "trabalhando",
                "fresco_em": int(self.agora.timestamp()) - 10
            }
        }
        with patch.object(Path, "exists", return_value=True), \
             patch("builtins.open", unittest.mock.mock_open(read_data=json.dumps({"terminais": terminais}))):
            mudancas = refresh_completo.reconciliar_dados(quadro, self.mapa, self.agora, simular=False)

        self.assertEqual(len(mudancas), 0)
        self.assertEqual(quadro["missoes"]["Agente 06"]["previsao"], "15h30")

    def test_pr_mesclado_ou_fechado_sai_e_pr_aberto_fica(self):
        quadro = {
            "missoes": {
                "Agente 06": {
                    "missao": "Em curso",
                    "situacao": "trabalhando",
                    "prs": [
                        {"repo": "meu-app", "numero": 70},  # MERGED
                        {"repo": "meu-app", "numero": 80},  # OPEN
                        {"repo": "meu-site", "numero": 12}          # CLOSED
                    ],
                    "editado_em": self.agora.isoformat()
                }
            },
            "pendencias": []
        }
        terminais = {
            "Agente 06": {
                "evidencia": "trabalhando",
                "fresco_em": int(self.agora.timestamp()) - 10
            }
        }

        def fake_consultar(repo, numero):
            if numero == 70:
                return "MERGED"
            if numero == 12:
                return "CLOSED"
            if numero == 80:
                return "OPEN"
            return None

        with patch.object(Path, "exists", return_value=True), \
             patch("builtins.open", unittest.mock.mock_open(read_data=json.dumps({"terminais": terminais}))), \
             patch.object(refresh_completo, "consultar_estado_pr", side_effect=fake_consultar):
            mudancas = refresh_completo.reconciliar_dados(quadro, self.mapa, self.agora, simular=False)

        self.assertEqual(len(mudancas), 1)
        self.assertEqual(quadro["missoes"]["Agente 06"]["prs"], [{"repo": "meu-app", "numero": 80}])

    def test_simular_nao_altera_o_quadro(self):
        quadro = {
            "missoes": {
                "Agente 06": {
                    "missao": "Em curso",
                    "situacao": "trabalhando",
                    "previsao": "14h00",
                    "previsao_em": "2026-10-12T14:00:00-03:00",
                    "editado_em": "2026-10-12T13:00:00-03:00"
                }
            },
            "pendencias": [{"texto": "Pendência importante", "id": "123"}]
        }
        terminais = {
            "Agente 06": {
                "evidencia": "mudou",
                "fresco_em": int(self.agora.timestamp()) - 600
            }
        }
        with patch.object(Path, "exists", return_value=True), \
             patch("builtins.open", unittest.mock.mock_open(read_data=json.dumps({"terminais": terminais}))):
            mudancas = refresh_completo.reconciliar_dados(quadro, self.mapa, self.agora, simular=True)

        self.assertEqual(len(mudancas), 2)
        # O quadro não foi modificado
        self.assertEqual(quadro["missoes"]["Agente 06"]["situacao"], "trabalhando")
        self.assertEqual(quadro["missoes"]["Agente 06"]["previsao"], "14h00")
        self.assertEqual(len(quadro["pendencias"]), 1)


if __name__ == "__main__":
    unittest.main()
