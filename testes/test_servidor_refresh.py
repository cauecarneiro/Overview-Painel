# -*- coding: utf-8 -*-
"""Testes do servidor HTTP do coletor (gatilho /refresh)."""
import importlib.util
import os
import socket
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "lib"))
import comum  # noqa: E402

from importlib.machinery import SourceFileLoader
coletor = SourceFileLoader("coletor", str(comum.RAIZ / "coletor")).load_module()


class TestServidorRefresh(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Acha uma porta livre para o teste
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(("127.0.0.1", 0))
        cls.porta = s.getsockname()[1]
        s.close()

        cls.evento = threading.Event()
        cls.servidor = coletor.ServidorRefresh(("127.0.0.1", cls.porta), coletor.HandlerRefresh)
        cls.servidor.evento_passada = cls.evento
        cls.servidor.estado_prs = None
        cls.servidor.ultimo_refresh = 0.0
        cls.servidor.trava_trigger = threading.Lock()
        cls.fio = threading.Thread(target=cls.servidor.serve_forever, daemon=True)
        cls.fio.start()

    @classmethod
    def tearDownClass(cls):
        cls.servidor.shutdown()
        cls.servidor.server_close()

    def test_post_refresh_retorna_204(self):
        url = "http://127.0.0.1:%d/refresh" % self.porta
        req = urllib.request.Request(url, data=b"", method="POST")
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 204)
        self.assertTrue(self.evento.is_set())
        self.evento.clear()

    def test_get_refresh_retorna_405(self):
        url = "http://127.0.0.1:%d/refresh" % self.porta
        req = urllib.request.Request(url, method="GET")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 405)

    def test_caminho_inexistente_retorna_404(self):
        url = "http://127.0.0.1:%d/outro" % self.porta
        req = urllib.request.Request(url, method="GET")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 404)

        req_post = urllib.request.Request(url, data=b"", method="POST")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req_post)
        self.assertEqual(ctx.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
