# dsh-quote-reply

Select text in any conversation message → a small toolbar floats above the selection → **Quote** opens a popover for your reply, **Copy** puts the selection on the clipboard as **Markdown**.

| Button | What it does |
| --- | --- |
| **Quote** | Opens the reply popover (see the two actions below) |
| **Copy** | Copies the selection to the clipboard **as Markdown source** — headings, lists, tables, links, bold/italic and fenced code blocks are rebuilt from the rendered DOM instead of being flattened to plain text |
| **Add to composer** | Writes `> quoted text` + blank line + your reply into the composer, **without sending** (appends to an existing draft) |
| **Send now** | Sends that same block immediately as a message |
| Cancel / `Esc` / click away | Dismisses |

`⌘/Ctrl + ↵` is the same as **Send now**.

## Install

**DSH Desktop:** open **Settings → Plugins**, search `dsh-quote-reply`, install through the app's own plugin manager, then restart the app and reload the page.

**Plain `dsh web`:** install into the profile that `dsh web` actually uses, then restart it:

```sh
dsh plugin --profile <profile> add dsh-quote-reply
```

Straight from GitHub, before (or instead of) the npm release:

```sh
dsh plugin --profile <profile> add github:talongao/dsh-quote-reply
```

The browser half ships with the boot manifest, so **a restart is required** — reloading the page alone will not pick it up.

## 中文说明

选中对话里的任意文本 → 选区上方浮出小工具条 → 「引用」打开回复弹窗，「复制」把选区以 **Markdown 格式**放进剪贴板。

| 按钮 | 行为 |
| --- | --- |
| **引用** | 打开回复弹窗（下面两个动作） |
| **复制** | 把选区**以 Markdown 源码**复制到剪贴板 —— 标题、列表、表格、链接、粗斜体、围栏代码块都是从渲染后的 DOM 反推出来的，不是压平的纯文本 |
| **添加到对话框** | 把 `> 原文` + 空行 + 你的回复写进输入框，**不发送**（已有草稿时接在后面） |
| **直接发送** | 把同一段文本立刻作为消息发出去 |
| 取消 / `Esc` / 点空白 | 收起 |

`⌘/Ctrl + ↵` 等价于「直接发送」。

## 生成的文本

```
> 被选中的原文第一行
> 第二行（多行选区每行都带 >）

你的回复
```

只选中不写回复时，插入的只有引用块本身。

## 交互细节

- 选区必须落在对话正文里（`[data-conversation-content]`）；输入框、侧栏、代码块输入区、`iframe`、终端不会触发。
- 会话身份从选区所在的 `[data-conversation-session]` 读取，多面板/多会话并排时各自正确。
- 浮层挂在 `document.body` 上的独立 React root，`position: fixed`，不受宿主的 `overflow`/`transform` 裁切。
- **按钮悬在选区上方、水平居中于选区**，绝不压住选中文字，也绝不掉到下一行。上方空间不够（选区贴视口顶）才落到下方；popover 与按钮同侧展开。
- 滚动时按钮跟随选区；选区消失即收起。
- 「复制」用的是实时 `Range`，不受引用 4000 字上限影响（但超过 200000 字会截断保护剪贴板）。
  复制走 `navigator.clipboard`，失败退回隐藏 `textarea` + `execCommand`，且**兜底后会把用户选区原样还回去**。
- 中文环境显示中文，其余显示英文。

## 样式约束（改 CSS 前必读）

浮层直接压在正文上，所以有一条硬性约束：**它必须永远是不透明的。**

- 底色一律「硬编码实色 `background-color` + 令牌走 `background-image` 叠在上面」。
  这样即使宿主没定义某个令牌（解析成 `transparent`），实色底也能顶住。
- `:hover` / `:active` 等状态规则**绝不可以**声明 `background` / `background-color` /
  `opacity` / `filter` / `backdrop-filter` —— 只改 `border-color` 和 `box-shadow`。
- 只允许使用宿主主题真实提供的 14 个令牌（见 `test/smoke.mjs` 里的 `HOST_TOKENS`）。

这三条都有测试钉死（`①c CSS 不变量`）。当年「按钮浮于文字下方」的观感问题，真因就是
`:hover` 用了宿主不存在的 `--dsw-alias-interactive-bg-hover`，`background` 简写把实心
背景整体替换成 82% 透明的灰，鼠标一移上去正文就透出来。

还有第四条：**按钮的底色与文字色必须自己成对硬编码，不能各自去取主题令牌。**
`--dsw-alias-brand-primary` 在某些主题里是近白色，而文字色 `--dsw-alias-label-primary`
同样近白 —— 两个令牌各自都没问题，配在一起就是白底白字，按钮变成一块看不见字的白板
（`.dqr-btn-primary` 曾栽在这上面，用户看到的是一块纯白矩形）。所以主按钮固定
`background: #2f6fed` + `color: #ffffff`，测试会算 WCAG 对比度，低于 4.5:1 直接失败。

## 结构

```
package.json         dsh.bundle.patch + dsh.client 声明
cordis.patch.yml     一行 insert，行名 = 包名
lib/index.js         host 半侧（空插件，只为让 bundle 行可解析）
lib/client.js        浏览器半侧：选区监听 + 浮层 + 引用/发送 + Markdown 复制
test/smoke.mjs       node 冒烟测试（纯函数 + 定位 + CSS 不变量 + Markdown 序列化 + 剪贴板 + 模块工厂 + apply/dispose）
test/dom.mjs         可选的真 DOM 测试（jsdom；HTML 结构照抄宿主渲染输出）
```

## 开发

```bash
node test/smoke.mjs          # 冒烟测试，不需要浏览器
node --check lib/client.js   # 语法

# 可选：用真 DOM 再验一遍 Markdown 序列化（宿主那套 HTML 结构）
npm i --no-save jsdom && node test/dom.mjs
```

安装（本地 bundle 目录，开发时用）：

```
plugin_manager action=install_bundle target=<绝对路径>
```

安装后需要**重启 DSH 桌面端**（浏览器半侧在启动时随 boot manifest 下发），
再刷新 GUI 页面即可看到效果。

## 依赖的宿主契约

| 用途 | 契约 |
| --- | --- |
| 定位会话 | `ctx.sessions.scope(sessionId)` → `scope.get('conversation')` |
| 写输入框 | `conversation.input.for(scope).setDraft(text)` / `.focus()` |
| 读现有草稿 | `input.state.getSnapshot().draft` |
| 直接发送 | `conversation.send(text)` |
| 复制为 Markdown | `Range.cloneContents()` + 按标签还原（`strong`→`**`、`pre`→围栏、`table`→GFM 表格、`div.md-code-block`→带语言围栏） |
| 会话 DOM | `[data-conversation-content]` / `[data-conversation-session]` / `[data-conversation-region="composer"]` |
