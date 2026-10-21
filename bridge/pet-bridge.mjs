#!/usr/bin/env node
/**
 * pet-bridge.mjs — 小鲸鱼悬浮窗与 DSH 智能体之间的消息桥。
 *
 * 架构：
 *   小鲸鱼(WebView)  --HTTP-->  本服务  --dsh headless-->  DSH 智能体
 *
 * 为什么走 headless：DSH 的会话 API 是 WebSocket + typert RPC，逆向成本高；
 * 而 `dsh headless --session-id <id>` 官方支持续接持久会话，拿到的就是一个
 * 有记忆的真智能体。
 *
 * 速度：profile 默认 reasoningEffort=max，聊天场景用不着。通过 --patch 叠加
 * 成 low，实测推理耗时从 5.9s 降到 2.8s（总耗时 9.7s → 6.8s）。
 *
 * 不无聊：headless 每完成一个阶段就吐一个 --json 事件，而 status/thinking
 * 事件是逐步到达的。把它们收进 progress，宠物轮询 /progress 就能实时显示
 * "她在想什么 / 在干什么"，而不是干等一个转圈。
 *
 * 接口（都带 CORS，方便 WebView 直接 fetch）：
 *   POST /chat     {"text":"..."} → {"reply":"..."}   用户说话
 *   GET  /progress                → {busy,phase,thinking,steps,elapsedMs}
 *   POST /say      {"text":"..."} → {"ok":true}        外部塞给宠物的播报
 *   GET  /say                     → {"items":[...]}    宠物取播报（取走即清空）
 *   GET  /health                  → {ok,sessionId,busy}
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const PORT = Number(process.env.PET_BRIDGE_PORT) || 8901;
const DSH_BIN = "/opt/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js";
const SESSION_FILE = "/root/.pet-chat-session";
const PATCH_FILE = "/root/pet-fast.yml";
const NODE = "/usr/local/bin/node";

// 宠物智能体的权限档位。headless profile 默认 workspace-write，而本机的
// workspace-write 沙箱后端不可用（no sandbox backend is usable on this host），
// 结果宠物一条 shell 都跑不了。这里开到 danger-full-access —— 同时按 profile 里
// permission 的配置，审批策略也会从 'ask' 变成 'never'。
// 想收回权限：把 PET_PERMISSION_MODE 设成 workspace-write 再重启桥。
const PET_PERMISSION_MODE = process.env.PET_PERMISSION_MODE ?? "danger-full-access";

let sessionId = existsSync(SESSION_FILE) ? readFileSync(SESSION_FILE, "utf8").trim() : "";
const pending = [];          // 等待宠物取走的播报
let busy = false;

/** 宠物轮询这个，实时知道她正在干嘛 */
let progress = { phase: "idle", thinking: "", steps: 0, startedAt: 0 };

const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);

/** 把阶段名说成人话 */
function phaseText(e, step) {
  switch (e.phase) {
    case "turn_start": return "正在理解你的话…";
    case "step_start": return step > 1 ? `正在动手（第 ${step} 步）…` : "正在想…";
    case "step_end":   return "这一步完成了，继续…";
    case "turn_end":   return "整理一下说法…";
    default:           return "正在忙…";
  }
}

/**
 * 跑一轮 headless。边跑边把事件写进 progress，最后 resolve 回复文本。
 * 用 spawn 而不是 execFile，就是为了能逐行读事件。
 */
function askAgent(text) {
  return new Promise((resolve, reject) => {
    const args = [DSH_BIN, "--profile", "headless"];
    if (existsSync(PATCH_FILE)) args.push("--patch", PATCH_FILE);
    if (sessionId) args.push("--session-id", sessionId);
    args.push("headless", "--json", text);

    const child = spawn(NODE, args, {
      cwd: "/root",
      env: { ...process.env, DSH_PERMISSION_MODE: PET_PERMISSION_MODE },
    });
    let buf = "", final = "", err = "", settled = false;

    progress = { phase: "starting", thinking: "", steps: 0, startedAt: Date.now() };

    const timer = setTimeout(() => {
      if (!settled) { settled = true; child.kill("SIGKILL"); reject(new Error("超时了")); }
    }, 240000);

    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim().startsWith("{")) continue;
        let e;
        try { e = JSON.parse(line); } catch { continue; }

        if (e.type === "session" && e.sessionId && !sessionId) {
          sessionId = e.sessionId;
          writeFileSync(SESSION_FILE, sessionId);
          log("记住会话 id:", sessionId);
        } else if (e.type === "status") {
          if (e.phase === "step_start") progress.steps++;
          progress.phase = phaseText(e, progress.steps);
        } else if (e.type === "thinking" && e.text) {
          progress.thinking = e.text;          // 思考正文，最后会一次性到达
          progress.phase = "正在组织语言…";
        } else if (e.type === "text" && e.text) {
          progress.phase = "就快好了…";
        } else if (e.type === "final") {
          final = e.text || "";
        }
      }
    });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } });
    child.on("close", (code) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      progress = { phase: "idle", thinking: "", steps: 0, startedAt: 0 };
      if (final) return resolve(final);
      if (code !== 0) return reject(new Error((err || `退出码 ${code}`).slice(0, 300)));
      resolve("(她没有说话)");
    });
  });
}

const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(body);
};

const readBody = (req) => new Promise((resolve) => {
  let buf = "";
  req.on("data", (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
  req.on("end", () => { try { resolve(JSON.parse(buf || "{}")); } catch { resolve({}); } });
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");

  if (req.method === "OPTIONS") return json(res, 204, {});

  if (url.pathname === "/health") {
    return json(res, 200, { ok: true, sessionId: sessionId || null, busy, pending: pending.length });
  }

  if (url.pathname === "/progress") {
    return json(res, 200, {
      busy,
      phase: progress.phase,
      thinking: progress.thinking,
      steps: progress.steps,
      elapsedMs: progress.startedAt ? Date.now() - progress.startedAt : 0,
    });
  }

  if (url.pathname === "/say" && req.method === "GET") {
    return json(res, 200, { items: pending.splice(0, pending.length) });
  }

  if (url.pathname === "/say" && req.method === "POST") {
    const { text } = await readBody(req);
    if (text) { pending.push(String(text)); log("播报入队:", text); }
    return json(res, 200, { ok: true, pending: pending.length });
  }

  if (url.pathname === "/chat" && req.method === "POST") {
    const { text } = await readBody(req);
    if (!text || !String(text).trim()) return json(res, 400, { error: "empty" });
    if (busy) return json(res, 429, { error: "我还在想上一句，稍等一下～" });

    busy = true;
    const q = String(text).trim();
    log("用户:", q);
    const t0 = Date.now();
    try {
      const reply = await askAgent(q);
      log(`回复(${Date.now() - t0}ms):`, reply.slice(0, 60).replace(/\n/g, " "));
      return json(res, 200, { reply, ms: Date.now() - t0 });
    } catch (e) {
      log("出错:", e.message);
      return json(res, 500, { error: "我这边出了点问题：" + e.message });
    } finally {
      busy = false;
    }
  }

  json(res, 404, { error: "not found" });
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`pet-bridge: 端口 ${PORT} 已被占用，退出`);
    process.exit(3);
  }
  throw e;
});

server.listen(PORT, "127.0.0.1", () => {
  log(`pet-bridge 就绪: http://127.0.0.1:${PORT}/  (会话: ${sessionId || "尚未创建"})`);
  log(`加速补丁: ${existsSync(PATCH_FILE) ? PATCH_FILE : "未启用"}`);
  log(`宠物权限档位: ${PET_PERMISSION_MODE}`);
});
