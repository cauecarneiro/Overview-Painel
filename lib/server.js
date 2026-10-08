'use strict';
/* Servidor local, só em 127.0.0.1: a página e o estado em JSON. Nada sai da máquina. */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function createServer(board) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/state') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(board.state()));
    }
    if (url.pathname === '/api/refresh' && req.method === 'POST') {
      board.refresh({ force: true }).catch(() => {});
      res.writeHead(202, { 'content-type': 'application/json; charset=utf-8' });
      return res.end('{"ok":true}');
    }
    const file = url.pathname === '/' ? 'index.html' : path.basename(url.pathname);
    const target = path.join(PUBLIC, file);
    const type = TYPES[path.extname(file)];
    if (!type || !target.startsWith(PUBLIC) || !fs.existsSync(target)) { res.writeHead(404); return res.end('não encontrado'); }
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    fs.createReadStream(target).pipe(res);
  });
}

module.exports = { createServer };
