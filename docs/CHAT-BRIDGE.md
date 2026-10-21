# 聊天桥（可选组件）

让小鲸鱼能跟你说话。**不配也能用** —— 只是长按菜单里点「和小鲸鱼说话」会提示连不上。

## 为什么需要它

悬浮窗里跑的是 WebView，而它所在的应用**刻意锁死了网络**：

```java
s.setAllowFileAccess(false);
s.setAllowFileAccessFromFileURLs(false);
s.setAllowUniversalAccessFromFileURLs(false);
s.setBlockNetworkLoads(true);
```

这是为了实现「不聊天时完全不联网」这个承诺。所以聊天**不走放开 WebView 那条路**，
而是由 **Java 层发 HTTP，再把结果回调给网页** —— 安全边界保持不动。

```
┌─────────────────┐   JS 接口    ┌──────────────┐   HTTP    ┌────────────────┐
│  WebView        │ ───────────▶ │  PetService  │ ────────▶ │  pet-bridge    │
│  (pet.html/js)  │ ◀─────────── │  (Java)      │ ◀──────── │  (本机 Node)   │
└─────────────────┘  onReply()   └──────────────┘           └───────┬────────┘
                                                                    │
                                                            任意 LLM 后端
```

## 快速开始

```bash
# 1. 起桥（需要一个 Node 环境，和手机在同一台设备上）
node bridge/pet-bridge.mjs

# 2. 确认活着
curl http://127.0.0.1:8901/health
# {"ok":true,"sessionId":null,"busy":false,"pending":0}
```

桥监听 `127.0.0.1:8901`（可用 `PET_BRIDGE_PORT` 改）。然后在小鲸鱼里长按 →
「和小鲸鱼说话」。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/chat` | 发一句话，返回回复。`{"text":"..."}` → `{"reply":"...","ms":1234}` |
| `GET` | `/progress` | 聊天进行中时轮询，返回 `{busy,phase,thinking,steps,elapsedMs}` |
| `POST` | `/say` | 外部塞一条主动播报，宠物会说出来 |
| `GET` | `/say` | 宠物取走播报（取走即清空） |
| `GET` | `/health` | `{ok,sessionId,busy,pending}` |

所有响应都带 `Access-Control-Allow-Origin: *`。

**为什么有 `/progress`**：一次问答要好几秒，干等很无聊。桥把后端的阶段性事件
（"正在理解…" / "正在动用工具（第 2 步）…"）收进 `progress`，App 每 700ms 轮询一次，
在输入框上方显示实时状态。后端如果吐不出阶段信息，这个接口返回 `busy:true`
和一个通用文案即可，不影响功能。

## 换成你自己的后端

只需要改 `askAgent()` 一个函数。它接收用户文本，返回 `Promise<string>`：

```js
function askAgent(text) {
  return new Promise((resolve, reject) => {
    // 在这里调你的 LLM。把阶段信息写进 progress 就能显示进度。
    progress.phase = "正在想…";
    // ... 拿到结果后
    resolve("回复文本");
  });
}
```

默认实现用的是 [DSH](https://github.com/deepseek-ai) 的 `headless` 模式：

```bash
dsh --profile headless --patch bridge/pet-fast.yml --session-id <id> headless --json "<文本>"
```

选它的原因是 `--session-id` **能续接持久会话** —— 也就是她有记忆。
如果换成无状态的 API，删掉 `SESSION_FILE` 相关逻辑即可。

### 默认实现里的两个调优点

1. **`bridge/pet-fast.yml` 降推理档位**
   profile 默认 `reasoningEffort: max`，聊天场景用不着。降到 `low` 后实测推理耗时
   从 5.9s 降到 2.8s（总耗时 9.7s → 6.8s）。
   `minimal` / `none` 不被 provider 支持；`off` 能用但只快 0.3s，而且会明显削弱
   工具调用能力，不划算。

2. **`--json` 事件流**
   `dsh headless --json` 会逐行吐事件（`session` / `status` / `thinking` / `text` /
   `final`）。`status` 是**逐步到达**的，正是靠它实现实时进度。
   注意 `thinking` 的正文是在推理结束时**一次性**到达的，不是逐字流式 ——
   所以拿它做"打字机效果"是行不通的。

## 权限档位（重要）

桥默认给后端的智能体开 **`danger-full-access`**：

```js
const PET_PERMISSION_MODE = process.env.PET_PERMISSION_MODE ?? "danger-full-access";
```

这样才能让她真的执行手机操作（读电量、查前台应用等）。代价是：

> **审批策略同时从 `ask` 变成 `never`** —— 她不会征求同意就直接执行命令。

只想聊天不想给权限：

```bash
PET_PERMISSION_MODE=workspace-write node bridge/pet-bridge.mjs
```

⚠️ **权限档位记录在会话里**，改环境变量对**已存在的会话无效** —— 必须开新会话
（删掉会话文件）才生效。

## 部署与自愈

桥挂掉的话聊天就断了。仓库里的做法是在沙箱/容器的启动脚本里挂一段守护循环：

```sh
if [ -f "$HOME/pet-bridge.mjs" ]; then
  (
    while true; do
      node "$HOME/pet-bridge.mjs" >>"$HOME/.pet-bridge.log" 2>&1
      echo "桥退出，3 秒后重启" >>"$HOME/.pet-bridge.log"
      sleep 3
    done
  ) &
fi
```

两层保障：**启动时自动拉起**（宿主重启后自己回来），**崩溃时自动续上**（3 秒后重试）。
会话文件独立存储，所以桥重启不会丢记忆。

## 素材与文案约定

角色**喜欢吃白米饭**。改动系统提示或欢迎语时请保留这个设定，
不要写成点心或鱼。
