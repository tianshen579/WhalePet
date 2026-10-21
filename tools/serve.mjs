#!/usr/bin/env node
/**
 * serve.mjs — 极简静态文件服务器（零依赖），把沙箱里的文件伺服给手机浏览器。
 *
 * 用途：沙箱和 Android 共享同一个 network namespace，所以手机浏览器访问
 * 127.0.0.1:<port> 就能拿到这里的文件 —— 这是把沙箱内容呈现给用户最省事的通道。
 *
 * 用法： node serve.mjs <目录> [端口]
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.argv[2] ?? process.cwd();
const port = Number(process.argv[3]) || 8899;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".md": "text/plain; charset=utf-8",
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/WhalePet-demo.html";
    // 防目录穿越
    const file = join(root, normalize(p).replace(/^(\.\.[/\\])+/, ""));
    if (!file.startsWith(root)) { res.writeHead(403).end("forbidden"); return; }
    const s = await stat(file);
    if (s.isDirectory()) { res.writeHead(404).end("not found"); return; }
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": "no-store",
    });
    res.end(body);
    console.log(`  ${new Date().toLocaleTimeString()} ${req.method} ${p} → ${body.length} 字节`);
  } catch (e) {
    res.writeHead(404).end("not found: " + e.message);
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`serve: http://127.0.0.1:${port}/  根目录 ${root}`);
});
