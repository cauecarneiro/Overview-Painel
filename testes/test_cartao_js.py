# -*- coding: utf-8 -*-
"""Testes do card de cota no navegador (publico/cartao-apoio.js e publico/cotas.js), escritos em JavaScript.

Rodar:  python3 -m unittest discover -s testes -v      (na pasta do painel)

Os testes de verdade estão em testes/js/ (node:test); este arquivo só os executa junto com os de Python. Sem o
Node instalado, o teste é pulado: o painel em si não precisa dele.
"""
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.dont_write_bytecode = True


class CartaoJs(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "o Node não está instalado; os testes do card (testes/js) ficam para depois")
    def test_testes_do_card_em_javascript(self):
        arquivos = sorted(str(a) for a in (RAIZ / "testes" / "js").glob("*.test.js"))
        self.assertTrue(arquivos, "nenhum teste em testes/js")
        r = subprocess.run(["node", "--test", *arquivos], capture_output=True, text=True, cwd=RAIZ, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout[-3000:] + r.stderr[-1500:])


if __name__ == "__main__":
    unittest.main()
