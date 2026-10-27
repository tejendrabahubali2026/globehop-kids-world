import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || 5173);
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.xml':'application/xml; charset=utf-8','.txt':'text/plain; charset=utf-8'};

async function resolveFile(rel) {
  const candidates = [join(root, rel), join(root, 'public', rel)];
  for (let file of candidates) {
    try {
      const s = await stat(file);
      if (s.isDirectory()) file = join(file, 'index.html');
      await stat(file);
      return file;
    } catch {}
  }
  return null;
}

const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (!rel) rel = 'index.html';
    const file = await resolveFile(rel);
    if (!file) throw new Error('not found');
    let data = await readFile(file);
    if (extname(file) === '.html') {
      data = Buffer.from(data.toString('utf8').replaceAll('__SITE_URL__', `http://127.0.0.1:${port}/`));
    }
    res.writeHead(200, {'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'}); res.end(data);
  } catch {
    try {
      const file = await resolveFile('404.html');
      const data = await readFile(file); res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'}); res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
  }
});
server.listen(port, '0.0.0.0', () => console.log(`GlobeHop: http://0.0.0.0:${port}/ serving ${root}`));
