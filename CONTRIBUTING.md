# 参与贡献

欢迎提交 issue 和 pull request。

## 开发环境

- 改**互动逻辑 / 动画**：不需要 Android 环境。直接编辑
  `app/src/main/assets/` 下的 `brain.js` / `pet.js` / `pet.css` / `pet.html`，
  然后用浏览器打开 `WhalePet-demo.html` 看效果
  （或在工程根目录跑 `node tools/serve.mjs .` 起个静态服务）
- 改**原生部分**：需要 Android 环境。两条构建路线见
  [docs/BUILD.md](docs/BUILD.md)

## 提交前请跑

```bash
node --test tests/brain.test.cjs          # 状态机测试，必须全过
node --check app/src/main/assets/pet.js   # JS 语法
node --check app/src/main/assets/brain.js
```

改了 `brain.js` 的状态机行为，**请同时补测试** —— 冷静期、数值边界、存档
兼容性这几块尤其容易出隐蔽 bug。

## 几条约定

- **角色设定**：她**喜欢吃白米饭**。别改成点心或鱼。
- **动作素材不是等分行高**：上排 `y=0..482`，下排 `y=483..886`，
  帧坐标在 `pet.js` 的 `frames` 数组里。**不要按 4×2 平均切图**，也不要随意重采样。
- **权限从紧**：新增系统权限请在 PR 里说明为什么必须要。
  悬浮窗、前台服务、通知是核心；网络权限目前只服务于聊天。
- **网络边界**：明文 HTTP 只允许到 `127.0.0.1`（见
  `res/xml/network_security_config.xml`）。要放开别的域名请在 PR 里单独讨论。
- **不要放开 WebView 的安全设置**：`setBlockNetworkLoads(true)`、
  禁文件访问这几项是「不聊天时完全不联网」的实现基础。需要联网请走 Java 层
  再回调网页，`PetService.Bridge` 里有现成的例子。

## 代码风格

- Java：跟现有文件保持一致（紧凑写法、少空行）
- JS：现有代码是无分号风格、两空格缩进，请保持一致
- 注释写**为什么**，不写**是什么** —— 尤其是那些看起来奇怪但必要的写法
  （比如清单补丁、`FLAG_NOT_FOCUSABLE` 的处理）

## 美术资源

角色形象与动作素材的版权归原作者所有，**不在 MIT 授权范围内**。
提 PR 时请不要引入来源不明的美术资源。
