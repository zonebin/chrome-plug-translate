# YouTube 双语字幕翻译 (AI)

一个 Chrome 扩展：给 YouTube 视频加上**底部双语字幕** —— 原文字幕在上、译文在下，当前播放的句子高亮显示。支持 **经典模式**（经典字幕条）与 **学习模式**（逐句学习 + 控制条）。翻译默认走免费 Google 翻译，也可接 **DeepSeek / OpenAI / 任意 OpenAI 兼容 API**。

## 功能

- **底部双语字幕**：原文字幕在上、译文在下，随播放自动切换；自动隐藏 YouTube 原生字幕。
- **两种模式**（视频标题下方按钮 → 菜单）：
  - **经典模式**：经典底部双语字幕，原文白色、译文金色，当前句高亮。
  - **学习模式**：逐句学习卡片，含 ⏮ 上一句 / ⏯ 播放暂停 / ⏭ 下一句 / 🔁 重复本句，可选句末自动暂停。
- **句子分组**：把 YouTube 逐词的碎片字幕拼成完整句子后再翻译。
- **AI 翻译引擎可选**：默认 Google 免费翻译（无需 Key），也可选 DeepSeek（`deepseek-chat`）、OpenAI（`gpt-4o-mini`）、或任意 OpenAI 兼容接口。
- **X 长文翻译**：打开 X 的英文长文时，自动在每段英文下方显示中文译文，可在设置页关闭。
- **翻译缓存**：按视频持久化缓存，二次观看秒开、不重复计费。
- **自动选字幕轨**：优先人工源字幕，其次自动生成字幕（ASR）。
- **即时开关**：工具栏图标、快捷键 `Alt+Shift+T`、视频下方按钮。

## 字幕获取原理

YouTube 已封锁所有「旁路」字幕请求（静态签名 URL / innertube API 都返回空 body），**只有播放器自己发出的请求**（带 POT token）能拿到字幕。本扩展采用以下方案：

1. **XHR hook**：`page-bridge.js` 注入主世界，hook `XMLHttpRequest.prototype`，拦截并缓存播放器自己拉的 `/api/timedtext?fmt=json3` 响应。
2. **nudge**：调 `CC 按钮` / `player.toggleSubtitles()` 让播放器发起字幕请求（字幕已开则"关→开"强制重拉）。
3. **拦截缓存**：从 hook 缓存的响应里直接解析字幕 cue，绕过所有签名/POT 风控。
4. **四层兜底**（拦截失败时）：refetch HTML → 静态 timedtext → `get_transcript` API → 驱动「显示转录稿」面板抓取。

### 关键：通过 MV3 MAIN world 注入 bridge

YouTube 的 CSP 会拦截扩展页面里的内联脚本，因此这里不再使用 `BRIDGE_SOURCE` 内联注入。当前方案由 `manifest.json` 将 `page-bridge.js` 声明为 `world: "MAIN"`、`run_at: "document_start"` 的 content script，由 Chrome 直接注入主世界：

- `content.js` 运行在 isolated world，负责 UI、字幕分组、翻译调度与缓存。
- `page-bridge.js` 运行在 MAIN world，负责 hook YouTube 播放器发出的 timedtext XHR。
- 两侧通过 `window.postMessage` 通信，不依赖页面内联脚本，也不会触发 CSP 报错。

`inline_bridge.js` 已废弃，仅保留作历史参考；不要再次运行，否则会把被 CSP 拦截的内联注入逻辑写回 `content.js`。


## 文件结构

```
manifest.json       MV3 清单（run_at: document_start，确保 XHR hook 先装）
common.js           共享常量/默认设置 + 引擎模板（DeepSeek/OpenAI/自定义）
background.js       后台翻译服务（统一走 /chat/completions，规避 CORS）
content.js          字幕引擎：XHR拦截→分组→翻译→底部字幕渲染（经典模式/学习模式）
page-bridge.js      注入主世界，hook XHR 拦截播放器字幕请求
overlay.css         底部字幕 + 视频下方按钮/菜单样式
popup.html/css/js    工具栏弹窗：开关 + 快捷设置
options.html/css/js  完整设置页（引擎/密钥/语言/样式 + 测试翻译）
icons/              16/48/128 图标
inline_bridge.js     已废弃；旧的内联注入构建脚本，请勿运行
```

## 安装（开发加载）

1. 打开 Chrome → `chrome://extensions` → 开「开发者模式」。
2. 点「加载已解压的扩展程序」，选择本项目根目录。
3. 固定工具栏图标，点击图标 → 填 API Key → 保存。

## 使用

1. 打开有字幕的 YouTube 视频。
2. 点击扩展图标开启，或按 `Alt+Shift+T`。
3. 点播放器右上角的模式按钮，菜单里选「学习模式」「经典模式」或「关闭翻译」。
4. 经典模式会把页面切成左侧 75% 视频区 + 右侧 25% 字幕上下文；当前句金色高亮并随播放滚动。学习模式沿用同一套视频下方双语字幕，并提供底部控制条。

## X 长文翻译

打开 X 的英文长文后，扩展会自动识别正文中的英文段落，并逐段调用当前翻译引擎。中文译文以浅绿色段落显示在原文下方；关闭设置里的「X 长文自动翻译」后，已有译文会立即移除。

## 配置翻译引擎

**默认使用 Google 翻译（免费、无需 API Key、无速率限制）**，开箱即用。

| 项 | Google（默认） | DeepSeek | OpenAI | 自定义 |
|---|---|---|---|---|
| Base URL | 内置 | `https://api.deepseek.com/v1` | `https://api.openai.com/v1` | 你的兼容地址 |
| Model | — | `deepseek-chat` | `gpt-4o-mini` | 你的模型名 |
| API Key | **不需要** | 需要 | 需要 | 需要 |
| 费用 | 免费 | 按量计费 | 按量计费 | 按量计费 |

**自动降级**：当选择 DeepSeek/OpenAI 等 LLM 但 Key 无效或余额不足（401/402/403/429）时，自动降级到 Google 免费翻译并持久化切换，保证译文始终可见。

设置页里有「测试翻译」按钮，可验证引擎连通性。

## 说明与限制

- 依赖视频已有字幕（人工或自动均可）。视频无字幕时不做语音转写。
- API Key 仅保存在本机 `chrome.storage.local`，不上传第三方。
- 本扩展聚焦 YouTube 双语字幕，不包含划词翻译、网页沉浸式翻译或生词本功能。
