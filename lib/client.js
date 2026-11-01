/**
 * dsh-quote-reply — client half (静态 bundle 形态).
 *
 * 选中对话里的任意文本 → 选区旁浮出「引用」按钮 → 点开 popover 输入回复 →
 *   ① 添加到对话框：把 `> 原文` + 空行 + 回复 写进输入框（不发送）
 *   ② 直接发送：把同一段文本作为消息立刻发出去
 *
 * 形态说明：
 * - `window.__ModuleLoader__.load({id, factory})` 只登记工厂，函数体（含样式注入）
 *   在首次 import/require 时才执行。
 * - 依赖的 seed 模块只有 `react` / `react-dom`；不 require 任何宿主内部包。
 * - 不注册 slot：整层 UI 用独立 React root 挂在 document.body 上（与 dsh-genui 的
 *   成就浮层同一做法）。浮动层必须脱离宿主的 flex/overflow 容器，portal 到 body 是
 *   唯一稳的落点，同时避免 root-scope slot 拿不到 session 的问题。
 * - 会话身份从 DOM 读：`[data-conversation-session]` 是宿主自己也在用的锚点。
 */
window.__ModuleLoader__.load({
	id: 'dsh-quote-reply',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		const React = require('react');
		/** react-dom 在 18 里把 createRoot 放在子路径；两处都试，缺了就不挂载（不抛错）。 */
		let ReactDOMClient = null;
		try { ReactDOMClient = require('react-dom/client'); } catch (err) { ReactDOMClient = null; }
		if (ReactDOMClient === null || typeof ReactDOMClient.createRoot !== 'function') {
			try {
				const candidate = require('react-dom');
				if (candidate !== null && typeof candidate.createRoot === 'function') ReactDOMClient = candidate;
			} catch (err) { ReactDOMClient = null; }
		}
		const h = React.createElement;

		//#region 常量
		/** 本插件所有 DOM 的归属标记；事件里用它把自己排除掉。 */
		const OWN = 'data-dsh-quote-reply';
		const ROOT_ATTR = 'data-dsh-quote-reply-root';
		const STYLE_ID = 'dsh-quote-reply';
		/** 引用原文的上限，防止整篇长回答被塞进输入框。 */
		const MAX_QUOTE = 4000;
		/** popover 尺寸估算值，只用于视口内收边。 */
		const POP_W = 340;
		const POP_H = 216;
		const GAP = 6;
		// 浮动工具条的估算尺寸，只用于视口夹取（真实尺寸由 CSS 决定）。
		const BTN_W = 150;
		const BTN_H = 26;
		/** 复制上限：防止误选整篇超长回答时把剪贴板撑爆。 */
		const COPY_LIMIT = 200000;
		//#endregion

		//#region 文案
		const STRINGS = {
			zh: {
				trigger: '引用',
				title: '回复选中内容',
				placeholder: '输入你的回复…',
				insert: '添加到对话框',
				send: '直接发送',
				cancel: '取消',
				empty: '请先输入回复内容',
				inserted: '已插入到输入框',
				noSession: '找不到所属会话',
				failed: '操作失败：',
				quoteLabel: '引用',
				copy: '复制',
				copied: '已复制',
				copyFailed: '复制失败',
				copyTitle: '复制为 Markdown',
			},
			en: {
				trigger: 'Quote',
				title: 'Reply to selection',
				placeholder: 'Type your reply…',
				insert: 'Add to composer',
				send: 'Send now',
				cancel: 'Cancel',
				empty: 'Write a reply first',
				inserted: 'Added to composer',
				noSession: 'Session not found',
				failed: 'Failed: ',
				quoteLabel: 'Quote',
				copy: 'Copy',
				copied: 'Copied',
				copyFailed: 'Copy failed',
				copyTitle: 'Copy as Markdown',
			},
		};
		/** 中文环境优先：document.lang → navigator.languages → navigator.language，任一是 zh* 就用中文。 */
		function pickLang() {
			try {
				const candidates = [];
				try {
					if (document && document.documentElement && document.documentElement.lang) {
						candidates.push(document.documentElement.lang);
					}
				} catch (err) { /* 忽略 */ }
				try {
					if (navigator && Array.isArray(navigator.languages)) {
						for (const tag of navigator.languages) candidates.push(tag);
					}
				} catch (err) { /* 忽略 */ }
				try { if (navigator && navigator.language) candidates.push(navigator.language); } catch (err) { /* 忽略 */ }
				for (const tag of candidates) {
					if (typeof tag === 'string' && tag.toLowerCase().indexOf('zh') === 0) return 'zh';
				}
				return 'en';
			} catch (err) { return 'zh'; }
		}
		/** 把宿主 locale id（zh-CN / en-US …）折成我们支持的两种文案。 */
		function normalizeLang(id) {
			if (typeof id !== 'string' || id.length === 0) return null;
			return id.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
		}
		/**
		 * 取宿主的 locale 服务。插件只把 `sessions` 声明为硬依赖，所以这里走可选访问：
		 * 宿主没提供 locale 时退回浏览器语言，绝不让文案把插件搞挂。
		 */
		function readLocale(ctx) {
			try {
				if (ctx === null || ctx === undefined || typeof ctx.get !== 'function') return null;
				const locale = ctx.get('locale');
				return locale === null || locale === undefined ? null : locale;
			} catch (err) { return null; }
		}
		/** 当前应使用的文案语言：宿主 locale 优先，其次浏览器语言。 */
		function detectLang(ctx) {
			const locale = readLocale(ctx);
			if (locale !== null) {
				try {
					if (typeof locale.getSnapshot === 'function') {
						const snap = locale.getSnapshot();
						const folded = snap === null || snap === undefined ? null : normalizeLang(snap.active);
						if (folded !== null) return folded;
					}
					if (typeof locale.getLocale === 'function') {
						const snap = locale.getLocale();
						const folded = snap === null || snap === undefined ? null : normalizeLang(snap.active);
						if (folded !== null) return folded;
					}
				} catch (err) { /* 落到浏览器语言 */ }
			}
			return pickLang();
		}
		//#endregion

		//#region 样式
		const CSS = `
/* 容器不参与命中测试：只有按钮和 popover 自己能点，绝不挡住宿主界面。 */
[${ROOT_ATTR}] { pointer-events: none; }
[${ROOT_ATTR}] > * { pointer-events: auto; }
.dqr-trigger {
	position: fixed;
	z-index: 2147483000;
	display: inline-flex;
	align-items: center;
	gap: 2px;
	height: 26px;
	padding: 0 3px;
	box-sizing: border-box;
	border-radius: 999px;
	border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.55));
	/* 绝对不透明：先铺硬编码实色（不依赖任何令牌），再把主题令牌当
	   background-image 盖上去。令牌若解析成透明色，实色立刻顶住 ——
	   正文永远不会从按钮里透出来（"按钮跑到文字下面"的观感就是这么来的）。 */
	background-color: #2a2a2e;
	background-image: linear-gradient(var(--dsw-alias-bg-overlay, transparent), var(--dsw-alias-bg-overlay, transparent));
	color: var(--dsw-alias-label-primary, #ededed);
	font-family: inherit;
	font-size: 12px;
	font-weight: 500;
	line-height: 1;
	white-space: nowrap;
	box-shadow: 0 2px 10px rgba(0,0,0,.45), 0 0 0 1px rgba(0,0,0,.22);
	animation: dqr-in .12s ease-out;
}
/* hover 只改边框和阴影，**绝不改背景**：任何半透明背景都会让正文透出来。 */
.dqr-trigger:hover {
	border-color: var(--dsw-alias-brand-primary, #4f8ef7);
	box-shadow: 0 3px 14px rgba(0,0,0,.52), 0 0 0 1px rgba(0,0,0,.22);
}
/* 键盘 Tab 进来时也亮一下边框，同样不碰背景。 */
.dqr-trigger:focus-within {
	border-color: var(--dsw-alias-brand-primary, #4f8ef7);
	box-shadow: 0 2px 10px rgba(0,0,0,.45), 0 0 0 2px rgba(47,111,237,.45);
}
.dqr-trigger-glyph { font-size: 11px; opacity: .8; }
/* 工具条里的每一项。父级已经是实色不透明底，所以这里的半透明悬停色
   只是叠在不透明底上的一层着色，不会让正文透出来。 */
.dqr-trigger-item {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	height: 22px;
	padding: 0 8px;
	box-sizing: border-box;
	border: 0;
	border-radius: 999px;
	background: transparent;
	color: inherit;
	font-family: inherit;
	font-size: 12px;
	font-weight: 500;
	line-height: 1;
	cursor: pointer;
	white-space: nowrap;
}
.dqr-trigger-item:hover { background: rgba(127,127,127,.22); }
.dqr-trigger-item:active { transform: translateY(1px); }
.dqr-trigger-sep {
	width: 1px;
	height: 12px;
	flex: none;
	background: var(--dsw-alias-border-l2, rgba(127,127,127,.45));
}
.dqr-pop {
	position: fixed;
	z-index: 2147483001;
	width: ${POP_W}px;
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 10px;
	border-radius: 12px;
	border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.55));
	/* 同 trigger：硬编码实色垫底 + 令牌盖面，popover 绝不能透出背后的正文。 */
	background-color: #232326;
	background-image: linear-gradient(var(--dsw-alias-bg-layer-1, transparent), var(--dsw-alias-bg-layer-1, transparent));
	color: var(--dsw-alias-label-primary, #ededed);
	font-family: inherit;
	font-size: 13px;
	font-weight: 400;
	line-height: 1.5;
	box-shadow: 0 16px 40px rgba(0,0,0,.36);
	animation: dqr-in .12s ease-out;
}
.dqr-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	font-size: 12px;
	font-weight: 600;
	color: var(--dsw-alias-label-secondary, #b3b3b3);
}
.dqr-close {
	border: 0;
	background: transparent;
	color: var(--dsw-alias-label-secondary, #8a8a8a);
	font-size: 14px;
	line-height: 1;
	cursor: pointer;
	padding: 2px 4px;
	border-radius: 6px;
}
.dqr-close:hover { background: rgba(127,127,127,.18); }
.dqr-quote {
	max-height: 84px;
	overflow: auto;
	padding: 6px 8px;
	border-radius: 8px;
	border-left: 3px solid #2f6fed;
	background: var(--dsw-alias-bg-layer-2, #242424);
	color: var(--dsw-alias-label-secondary, #b3b3b3);
	font-size: 12px;
	line-height: 1.45;
	white-space: pre-wrap;
	word-break: break-word;
}
.dqr-input {
	width: 100%;
	box-sizing: border-box;
	min-height: 64px;
	max-height: 180px;
	resize: vertical;
	padding: 7px 9px;
	border-radius: 8px;
	border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.4));
	background: var(--dsw-alias-bg-layer-1, #141414);
	color: var(--dsw-alias-label-primary, #ededed);
	font-family: inherit;
	font-size: 13px;
	font-weight: 400;
	line-height: 1.5;
	outline: none;
}
.dqr-input:focus { border-color: var(--dsw-alias-brand-primary, #4f8ef7); }
.dqr-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
.dqr-btn {
	height: 28px;
	padding: 0 12px;
	box-sizing: border-box;
	border-radius: 8px;
	border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.4));
	background: transparent;
	color: var(--dsw-alias-label-primary, #ededed);
	font-family: inherit;
	font-size: 12px;
	font-weight: 500;
	line-height: 1;
	cursor: pointer;
	white-space: nowrap;
}
.dqr-btn:hover { background: rgba(127,127,127,.18); }
/* 主按钮**不能用 brand-primary 当底色**：该令牌在部分主题里是近白色，
   而文字色 label-primary 同样是近白色 → 白底白字，按钮看起来是块白板。
   这里硬编码一个饱和蓝 + 纯白字，任何主题下都读得出来。 */
.dqr-btn-primary {
	border-color: transparent;
	background: #2f6fed;
	color: #ffffff;
}
.dqr-btn-primary:hover { background: #3b7bf5; }
.dqr-btn:disabled { opacity: .5; cursor: default; }
.dqr-hint {
	font-size: 11px;
	color: var(--dsw-alias-label-secondary, #8a8a8a);
	margin-right: auto;
}
@keyframes dqr-in { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: none; } }
`;
		/** 注入样式；已存在则直接返回空 disposer（热重载不叠样式）。 */
		function installStyles() {
			if (typeof document === 'undefined' || !document || typeof document.createElement !== 'function' || !document.head) {
				return function () {};
			}
			const existing = document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]');
			if (existing !== null) return function () {};
			const style = document.createElement('style');
			style.dataset.plugin = STYLE_ID;
			style.dataset.pluginCss = STYLE_ID;
			style.textContent = CSS;
			document.head.appendChild(style);
			return function () { style.remove(); };
		}
		//#endregion

		//#region 选区读取
		/** 选区是否落在「可引用的对话正文」里；返回会话 id，否则 undefined。 */
		function selectionSessionId(el) {
			if (!el || typeof el.closest !== 'function') return undefined;
			if (el.closest('[' + OWN + ']') !== null) return undefined;
			if (el.closest('[data-conversation-content]') === null) return undefined;
			if (el.closest('[data-conversation-region="composer"]') !== null) return undefined;
			if (el.closest('[data-composer-seat]') !== null) return undefined;
			if (el.closest('[contenteditable="true"]') !== null) return undefined;
			if (el.closest('textarea, input, select') !== null) return undefined;
			if (el.closest('iframe, .xterm') !== null) return undefined;
			const host = el.closest('[data-conversation-session]');
			const id = host === null ? null : host.getAttribute('data-conversation-session');
			return typeof id === 'string' && id.length > 0 ? id : undefined;
		}
		/** 读当前选区；不可用时返回 null。 */
		function readSelection() {
			if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return null;
			let sel = null;
			try { sel = window.getSelection(); } catch (err) { return null; }
			if (sel === null || sel === undefined || sel.rangeCount === 0 || sel.isCollapsed) return null;
			let text = '';
			try { text = String(sel.toString() || ''); } catch (err) { return null; }
			if (text.trim().length === 0) return null;
			if (text.length > MAX_QUOTE) text = text.slice(0, MAX_QUOTE) + '…';
			let range = null;
			try { range = sel.getRangeAt(0); } catch (err) { return null; }
			const node = range.commonAncestorContainer;
			const el = node === null || node === undefined
				? null
				: node.nodeType === 1 ? node : node.parentElement;
			const sessionId = selectionSessionId(el);
			if (sessionId === undefined) return null;
			const rects = rangeRects(range);
			if (rects === null) return null;
			return { text, sessionId, range, first: toBox(rects.first), last: toBox(rects.last) };
		}
		/** DOMRect → 纯对象：进 React state 的必须是可比较的普通值。 */
		function toBox(rect) {
			return {
				left: rect.left,
				top: rect.top,
				right: rect.right,
				bottom: rect.bottom,
				width: rect.width,
				height: rect.height,
			};
		}
		/**
		 * 选区的首行与末行矩形。**跳过零尺寸矩形**：Chrome 在选区结束于行尾/段落尾时
		 * 会多给一个宽度为 0 的 rect（落在下一行行首），取最后一个会把按钮顶到下一行去。
		 */
		function rangeRects(range) {
			try {
				const list = range.getClientRects();
				let first = null;
				let last = null;
				for (let i = 0; i < list.length; i++) {
					const rect = list[i];
					if (rect === null || rect === undefined) continue;
					if (rect.width <= 0 && rect.height <= 0) continue;
					if (first === null) first = rect;
					last = rect;
				}
				if (first === null || last === null) {
					const single = range.getBoundingClientRect();
					if (single === null || single === undefined) return null;
					if (single.width === 0 && single.height === 0 && single.top === 0 && single.left === 0) return null;
					return { first: single, last: single };
				}
				return { first, last };
			} catch (err) { return null; }
		}
		//#endregion

		//#region 文本拼装
		/** 引用块：每行加 `> `（空行退化为 `>`），与用户给的 markdown 形态一致。 */
		function quoteBlock(text) {
			return String(text)
				.replace(/\r\n?/g, '\n')
				.replace(/[ \t]+$/gm, '')
				.replace(/\n{3,}/g, '\n\n')
				.trim()
				.split('\n')
				.map(function (line) { return line.length > 0 ? '> ' + line : '>'; })
				.join('\n');
		}
		/** `> 原文` + 空行 + 回复。回复为空时只给引用块。 */
		function compose(quote, reply) {
			const quoted = quoteBlock(quote);
			const body = String(reply || '').replace(/\r\n?/g, '\n').trim();
			return body.length === 0 ? quoted : quoted + '\n\n' + body;
		}
		/** 追加到已有草稿：保留原内容，空一行再接引用块。 */
		function appendToDraft(existing, block) {
			const base = String(existing || '').replace(/\s+$/, '');
			return base.length === 0 ? block : base + '\n\n' + block;
		}
		//#endregion

		//#region markdown 序列化
		/*
		 * 宿主不把 markdown 源码暴露到 DOM（渲染后只剩标签），所以「复制为 markdown」
		 * 只能反推：把选区克隆出来的 DOM 片段按标签还原成 markdown 标记。
		 *
		 * 这里刻意只用 Node/Element 的最小属性面（nodeType / nodeValue / tagName /
		 * childNodes / getAttribute），不用 querySelector —— 冒烟测试可以喂假 DOM。
		 */
		/** 深度优先找第一个满足条件的后代元素。 */
		function findFirst(node, test) {
			const kids = node === null || node === undefined ? null : node.childNodes;
			if (kids === null || kids === undefined) return null;
			for (let i = 0; i < kids.length; i++) {
				const child = kids[i];
				if (child === null || child === undefined) continue;
				if (child.nodeType === 1 && test(child)) return child;
				const deeper = findFirst(child, test);
				if (deeper !== null) return deeper;
			}
			return null;
		}
		/** 节点的纯文本（跳过脚本/样式/按钮这类非正文）。 */
		function textOf(node) {
			if (node === null || node === undefined) return '';
			if (node.nodeType === 3) return String(node.nodeValue === null ? '' : node.nodeValue);
			if (node.nodeType !== 1) return '';
			const tag = String(node.tagName || '').toLowerCase();
			if (tag === 'script' || tag === 'style' || tag === 'button') return '';
			let out = '';
			const kids = node.childNodes || [];
			for (let i = 0; i < kids.length; i++) out += textOf(kids[i]);
			return out;
		}
		/**
		 * 连按钮一起取的纯文本。行内代码里的「文件提及」宿主会渲染成
		 * `<code><button class="fileMention">路径</button></code>`，
		 * 用 textOf 会把内容整段丢掉，所以这里单独留一个不过滤按钮的版本。
		 */
		function rawTextOf(node) {
			if (node === null || node === undefined) return '';
			if (node.nodeType === 3) return String(node.nodeValue === null ? '' : node.nodeValue);
			if (node.nodeType !== 1) return '';
			const tag = String(node.tagName || '').toLowerCase();
			if (tag === 'script' || tag === 'style' || tag === 'svg') return '';
			let out = '';
			const kids = node.childNodes || [];
			for (let i = 0; i < kids.length; i++) out += rawTextOf(kids[i]);
			return out;
		}
		/** 数学公式的 TeX 源码：KaTeX 会把原文放在 <annotation encoding="application/x-tex"> 里。 */
		function mathSource(node) {
			const annotation = findFirst(node, function (el) {
				return String(el.tagName || '').toLowerCase() === 'annotation'
					&& String(el.getAttribute('encoding') || '') === 'application/x-tex';
			});
			if (annotation !== null) return rawTextOf(annotation).trim();
			// 解析失败的 katex-error 直接把原文当文本塞在 span 里。
			return rawTextOf(node).trim();
		}
		/** 元素 class 列表（假 DOM 里只有 getAttribute）。 */
		function classList(node) {
			const raw = node !== null && node !== undefined && typeof node.getAttribute === 'function'
				? node.getAttribute('class')
				: null;
			return String(raw === null || raw === undefined ? '' : raw).split(/\s+/);
		}
		/** 代码块的语言标签：优先横幅里的 infostring，其次 `language-xxx`。 */
		function codeLang(node) {
			const banner = findFirst(node, function (el) {
				return el.getAttribute('data-code-block-banner') !== null;
			});
			if (banner !== null && banner.childNodes && banner.childNodes.length > 0) {
				for (let i = 0; i < banner.childNodes.length; i++) {
					const child = banner.childNodes[i];
					if (child !== null && child !== undefined && child.nodeType === 1) {
						const label = textOf(child).trim();
						if (label.length > 0) return label.split(/\s+/)[0];
					}
				}
			}
			const code = findFirst(node, function (el) {
				return String(el.tagName || '').toLowerCase() === 'code';
			});
			if (code !== null) {
				for (const name of classList(code)) {
					const match = /^language-([\w-]+)$/.exec(name);
					if (match !== null) return match[1];
				}
			}
			return '';
		}
		/** 围栏代码块（```）。 */
		function mdCodeFence(text, lang) {
			const body = String(text).replace(/\r\n?/g, '\n').replace(/\n+$/, '');
			const fence = body.indexOf('```') >= 0 ? '````' : '```';
			return fence + String(lang || '') + '\n' + body + '\n' + fence + '\n\n';
		}
		/** GFM 表格。 */
		function mdTable(node, ctx) {
			const rows = [];
			const collect = function (el) {
				const kids = el.childNodes || [];
				for (let i = 0; i < kids.length; i++) {
					const child = kids[i];
					if (child === null || child === undefined || child.nodeType !== 1) continue;
					const tag = String(child.tagName || '').toLowerCase();
					if (tag === 'tr') {
						const cells = [];
						const cellKids = child.childNodes || [];
						for (let j = 0; j < cellKids.length; j++) {
							const cell = cellKids[j];
							if (cell === null || cell === undefined || cell.nodeType !== 1) continue;
							const cellTag = String(cell.tagName || '').toLowerCase();
							if (cellTag !== 'td' && cellTag !== 'th') continue;
							cells.push(mdChildren(cell, ctx).trim().replace(/\n+/g, ' ').replace(/\|/g, '\\|'));
						}
						if (cells.length > 0) rows.push(cells);
					} else {
						collect(child);
					}
				}
			};
			collect(node);
			if (rows.length === 0) return '';
			const width = rows[0].length;
			const line = function (cells) {
				const padded = cells.slice(0, width);
				while (padded.length < width) padded.push('');
				return '| ' + padded.join(' | ') + ' |';
			};
			const out = [line(rows[0]), '| ' + rows[0].map(function () { return '---'; }).join(' | ') + ' |'];
			for (let i = 1; i < rows.length; i++) out.push(line(rows[i]));
			return out.join('\n') + '\n\n';
		}
		/** 列表（含嵌套与任务项）。 */
		function mdList(node, ctx) {
			const ordered = String(node.tagName || '').toLowerCase() === 'ol';
			const startAttr = typeof node.getAttribute === 'function' ? node.getAttribute('start') : null;
			const start = ordered ? (parseInt(startAttr === null ? '1' : startAttr, 10) || 1) : 1;
			const lines = [];
			let index = 0;
			const kids = node.childNodes || [];
			for (let i = 0; i < kids.length; i++) {
				const item = kids[i];
				if (item === null || item === undefined || item.nodeType !== 1) continue;
				if (String(item.tagName || '').toLowerCase() !== 'li') continue;
				const marker = ordered ? (start + index) + '. ' : '- ';
				index += 1;
				let head = '';
				let tail = '';
				const itemKids = item.childNodes || [];
				for (let j = 0; j < itemKids.length; j++) {
					const child = itemKids[j];
					if (child === null || child === undefined) continue;
					const tag = child.nodeType === 1 ? String(child.tagName || '').toLowerCase() : '';
					if (tag === 'ul' || tag === 'ol') {
						tail += mdList(child, ctx).replace(/\n+$/, '') + '\n';
					} else if (tag === 'pre' || tag === 'table' || tag === 'blockquote') {
						// 块级子节点不能并进 head —— head 会被压成一行，代码块就毁了。
						tail += mdSerialize(child, ctx).replace(/\n+$/, '') + '\n';
					} else if (tag === 'p' || tag === 'div') {
						head += mdChildren(child, ctx).trim() + ' ';
					} else {
						head += mdSerialize(child, ctx);
					}
				}
				const text = head.replace(/\s+/g, ' ').trim();
				lines.push(marker + text);
				if (tail.length > 0) {
					for (const extra of tail.replace(/\n+$/, '').split('\n')) {
						lines.push('  ' + extra);
					}
				}
			}
			if (lines.length === 0) return '';
			return lines.join('\n') + '\n\n';
		}
		/** 子节点的 markdown 拼接。 */
		function mdChildren(node, ctx) {
			let out = '';
			const kids = node === null || node === undefined ? null : node.childNodes;
			if (kids === null || kids === undefined) return out;
			for (let i = 0; i < kids.length; i++) out += mdSerialize(kids[i], ctx);
			return out;
		}
		/** 单个节点 → markdown 片段。 */
		function mdSerialize(node, ctx) {
			if (node === null || node === undefined) return '';
			if (node.nodeType === 3) {
				const raw = String(node.nodeValue === null ? '' : node.nodeValue);
				return ctx !== null && ctx !== undefined && ctx.pre === true
					? raw
					: raw.replace(/[ \t]*\r?\n[ \t]*/g, '\n');
			}
			if (node.nodeType !== 1) return '';
			const tag = String(node.tagName || '').toLowerCase();
			const names = classList(node);
			// 代码块整体优先：它内部有横幅、复制按钮、高亮 span，逐个还原会得到垃圾。
			if (names.indexOf('md-code-block') >= 0) {
				const content = findFirst(node, function (el) {
					return el.getAttribute('data-code-block-content') !== null;
				});
				const host = content === null ? node : content;
				const pre = String(host.tagName || '').toLowerCase() === 'pre'
					? host
					: findFirst(host, function (el) { return String(el.tagName || '').toLowerCase() === 'pre'; });
				return mdCodeFence(rawTextOf(pre === null ? host : pre), codeLang(node));
			}
			// 数学公式：KaTeX 的 DOM 里既有 MathML 臂又有视觉臂，逐个还原会得到垃圾，
			// 直接从 <annotation> 里取回原始 TeX。
			if (names.indexOf('katex-display') >= 0) {
				const tex = mathSource(node);
				return tex.length === 0 ? '' : '$$\n' + tex + '\n$$\n\n';
			}
			if (names.indexOf('katex') >= 0) {
				const tex = mathSource(node);
				return tex.length === 0 ? '' : '$' + tex + '$';
			}
			// 宿主把文件提及 / 文件链接渲染成 button：文字是有意义的，别当成操作按钮丢掉。
			if (tag === 'button' && names.indexOf('fileMention') >= 0) return rawTextOf(node);
			switch (tag) {
				case 'script':
				case 'style':
				case 'button':
				case 'svg':
				case 'textarea':
				case 'input': {
					if (tag === 'input' && String(node.getAttribute('type') || '') === 'checkbox') {
						const on = node.checked === true || node.getAttribute('checked') !== null;
						return on ? '[x] ' : '[ ] ';
					}
					return '';
				}
				case 'p':
				case 'div':
				case 'section':
				case 'article':
				case 'header':
				case 'footer':
				case 'figure':
				case 'figcaption':
					return mdChildren(node, ctx).replace(/^\n+/, '').replace(/\s+$/, '') + '\n\n';
				case 'h1':
				case 'h2':
				case 'h3':
				case 'h4':
				case 'h5':
				case 'h6': {
					const depth = parseInt(tag.slice(1), 10) || 1;
					const text = mdChildren(node, ctx).trim();
					return text.length === 0 ? '' : '#'.repeat(depth) + ' ' + text + '\n\n';
				}
				case 'blockquote': {
					const inner = mdChildren(node, ctx).replace(/\n{3,}/g, '\n\n').trim();
					if (inner.length === 0) return '';
					const lines = inner.split('\n').map(function (line) {
						return line.length > 0 ? '> ' + line : '>';
					});
					return lines.join('\n') + '\n\n';
				}
				case 'pre': {
					if (ctx !== null && ctx !== undefined && ctx.pre === true) return textOf(node);
					return mdCodeFence(rawTextOf(node), '');
				}
				case 'code': {
					if (ctx !== null && ctx !== undefined && ctx.pre === true) return textOf(node);
					const value = rawTextOf(node).replace(/\r?\n/g, ' ');
					if (value.length === 0) return '';
					const fence = value.indexOf('`') >= 0 ? '``' : '`';
					return fence + value + fence;
				}
				case 'strong':
				case 'b': {
					const inner = mdChildren(node, ctx);
					return inner.trim().length === 0 ? inner : '**' + inner + '**';
				}
				case 'em':
				case 'i': {
					const inner = mdChildren(node, ctx);
					return inner.trim().length === 0 ? inner : '*' + inner + '*';
				}
				case 'del':
				case 's':
				case 'strike': {
					const inner = mdChildren(node, ctx);
					return inner.trim().length === 0 ? inner : '~~' + inner + '~~';
				}
				case 'a': {
					const href = node.getAttribute('href');
					const text = mdChildren(node, ctx).trim();
					if (href === null || href === undefined || href === '' || href.charAt(0) === '#') return text;
					return '[' + (text.length > 0 ? text : href) + '](' + href + ')';
				}
				case 'img': {
					const src = node.getAttribute('src');
					if (src === null || src === undefined || src === '') return '';
					const alt = node.getAttribute('alt');
					return '![' + String(alt === null || alt === undefined ? '' : alt) + '](' + src + ')';
				}
				case 'br':
					return '\n';
				case 'hr':
					return '\n\n---\n\n';
				case 'ul':
				case 'ol':
					return mdList(node, ctx);
				case 'table':
					return mdTable(node, ctx);
				case 'li':
					return mdChildren(node, ctx);
				case 'tr':
				case 'td':
				case 'th':
				case 'thead':
				case 'tbody':
					return mdChildren(node, ctx);
				default:
					return mdChildren(node, ctx);
			}
		}
		/** 把一段 Range 反推成 markdown。 */
		function markdownFromRange(range) {
			if (range === null || range === undefined || typeof range.cloneContents !== 'function') return '';
			const fragment = range.cloneContents();
			return mdChildren(fragment, { pre: false })
				// 块元素之间的格式化空白会被序列化成「只有空格的行」，清掉它。
				.replace(/\n[ \t]+\n/g, '\n\n')
				.replace(/\n{3,}/g, '\n\n')
				.trim();
		}
		//#endregion

		//#region 剪贴板
		/**
		 * 写剪贴板。`navigator.clipboard` 在页面失焦时会 reject，
		 * 所以再兜一层隐藏 textarea + execCommand('copy')。
		 */
		function writeClipboard(text) {
			try {
				if (typeof navigator !== 'undefined' && navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
					return navigator.clipboard.writeText(text).then(
						function () { return true; },
						function () { return legacyCopy(text); }
					);
				}
			} catch (err) { /* 落到兜底 */ }
			return Promise.resolve(legacyCopy(text));
		}
		/** 老式复制兜底；返回是否成功。 */
		function legacyCopy(text) {
			let saved = [];
			let sel = null;
			try {
				sel = window.getSelection();
				if (sel !== null && sel !== undefined) {
					for (let i = 0; i < sel.rangeCount; i++) saved.push(sel.getRangeAt(i));
				}
			} catch (err) { saved = []; sel = null; }
			let ok = false;
			try {
				if (typeof document === 'undefined' || !document || !document.body) return false;
				const area = document.createElement('textarea');
				area.value = text;
				area.setAttribute('readonly', '');
				area.style.position = 'fixed';
				area.style.top = '-1000px';
				area.style.left = '-1000px';
				area.style.opacity = '0';
				document.body.appendChild(area);
				area.select();
				ok = document.execCommand('copy') === true;
				area.remove();
			} catch (err) { ok = false; }
			// 兜底路径会用隐藏 textarea 抢走选区；必须还回去，否则用户的高亮消失、
			// 浮动工具条也会因为「选区不在正文里」而自己收起来。
			try {
				if (sel !== null && sel !== undefined) {
					sel.removeAllRanges();
					for (const range of saved) sel.addRange(range);
				}
			} catch (err) { /* 忽略 */ }
			return ok;
		}
		//#endregion

		//#region 定位
		/**
		 * 算按钮与 popover 的落点（纯函数，便于测试）。
		 *
		 * 规则（跟阅读器/笔记类应用的选区工具条一致）：
		 *   ① 按钮**悬在选区上方**、水平居中于选区 —— 绝不压住选中文字，也绝不压住下一行；
		 *   ② 上方空间不够（选区贴着视口顶）才落到选区下方；
		 *   ③ 两端都放不下就夹进视口，宁可贴近也不越界。
		 * 最初版本把按钮放在选区右下角 +6px，必然掉到下一行上压住正文 —— 这是要修的 bug。
		 *
		 * @param anchor - `{ first, last }`，选区首行/末行的屏幕矩形。
		 * @param size - `{ btnW, btnH, vw, vh }`。
		 * @returns `{ triggerX, triggerY, popX, popY }`。
		 */
		function layout(anchor, size) {
			const btnW = size.btnW;
			const btnH = size.btnH;
			const vw = size.vw;
			const vh = size.vh;
			const first = anchor.first;
			const last = anchor.last;
			const clampX = function (x) { return Math.min(Math.max(8, x), Math.max(8, vw - btnW - 8)); };
			const clampY = function (y) { return Math.min(Math.max(8, y), Math.max(8, vh - btnH - 8)); };
			// 选区横向包围盒的中点 —— 按钮挂在它正上方，视觉上"属于这段选中内容"。
			const boxLeft = Math.min(first.left, last.left);
			const boxRight = Math.max(first.right, last.right);
			const midX = (boxLeft + boxRight) / 2;
			const above = first.top - GAP - btnH;
			const below = last.bottom + GAP;
			let triggerY;
			if (above >= 8) {
				triggerY = above; // 首选：上方
			} else if (below + btnH <= vh - 8) {
				triggerY = below; // 兜底：上方没地方了才去下方
			} else {
				triggerY = above; // 都挤：夹进视口（clampY 兜住）
			}
			const triggerX = clampX(midX - btnW / 2);
			const finalY = clampY(triggerY);
			// popover 与按钮同侧：按钮在上就向上展开（不盖住选中文字），否则向下。
			const popX = Math.min(Math.max(8, boxLeft), Math.max(8, vw - POP_W - 8));
			const triggerAbove = finalY + btnH <= first.top + 0.5;
			let popY = triggerAbove ? first.top - POP_H - GAP : last.bottom + GAP + 4;
			if (popY < 8) popY = last.bottom + GAP + 4; // 上方装不下整个 popover：改为向下
			if (popY + POP_H > vh - 8) popY = Math.max(8, vh - POP_H - 8);
			return { triggerX, triggerY: finalY, popX, popY };
		}
		//#endregion

		//#region 宿主服务
		/** 会话作用域里的 conversation 服务；会话未保留/服务缺席时返回 null。 */
		function resolveConversation(ctx, sessionId) {
			if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
			let scope = null;
			try { scope = ctx.sessions.scope(sessionId); } catch (err) { scope = null; }
			if (scope === null || scope === undefined) return null;
			let conversation = null;
			try { conversation = scope.get('conversation'); } catch (err) { conversation = null; }
			if (conversation === null || conversation === undefined) return null;
			return { scope, conversation };
		}
		/** 该会话的输入框门面（setDraft / submit / focus / state）。 */
		function resolveInput(resolved) {
			try {
				if (resolved.conversation.input && typeof resolved.conversation.input.for === 'function') {
					return resolved.conversation.input.for(resolved.scope);
				}
			} catch (err) { /* 落到下面的兜底 */ }
			return null;
		}
		/** 读当前草稿文本（拿不到就当空）。 */
		function readDraft(input) {
			try {
				const state = input.state;
				if (state && typeof state.getSnapshot === 'function') {
					const snapshot = state.getSnapshot();
					if (snapshot && typeof snapshot.draft === 'string') return snapshot.draft;
				}
			} catch (err) { /* 读不到就当空 */ }
			return '';
		}
		//#endregion

		//#region 浮层组件
		/**
		 * 浮动层：一个按钮 + 一个 popover，都用 position:fixed 落在 body 上。
		 * @param props.ctx - 插件根上下文（用于 sessions.scope / conversation）。
		 */
		function QuoteReplyLayer(props) {
			const ctx = props.ctx;
			const [lang, setLang] = React.useState(function () { return detectLang(ctx); });
			const [anchor, setAnchor] = React.useState(null); // { first, last, text, sessionId }
			const [open, setOpen] = React.useState(false);
			const [reply, setReply] = React.useState('');
			const [flash, setFlash] = React.useState('');
			const [copyState, setCopyState] = React.useState('idle'); // 'idle' | 'copied' | 'failed'
			const [btnSize, setBtnSize] = React.useState(null); // { w, h } 实测按钮尺寸
			const rangeRef = React.useRef(null);
			const openRef = React.useRef(false);
			const anchorRef = React.useRef(null);
			const inputRef = React.useRef(null);
			const triggerRef = React.useRef(null);
			const draggingRef = React.useRef(false);
			const flashTimer = React.useRef(0);
			const copyTimer = React.useRef(0);

			// 文案跟随宿主语言：用户在设置里切语言时按钮也跟着换，不用刷新页面。
			const L = STRINGS[lang];
			React.useEffect(function () {
				const locale = readLocale(ctx);
				if (locale === null || typeof locale.subscribe !== 'function') return function () {};
				const sync = function () {
					const next = detectLang(ctx);
					setLang(function (prev) { return prev === next ? prev : next; });
				};
				sync();
				let dispose = null;
				try { dispose = locale.subscribe(sync); } catch (err) { return function () {}; }
				return function () {
					try { if (typeof dispose === 'function') dispose(); } catch (err) { /* 忽略 */ }
				};
			}, [ctx]);

			openRef.current = open;
			anchorRef.current = anchor;

			/** 关掉整层（popover 与按钮一起）。 */
			const close = React.useCallback(function () {
				openRef.current = false;
				setOpen(false);
				setReply('');
				setFlash('');
				setCopyState('idle');
				setAnchor(null);
				rangeRef.current = null;
				// 只有在焦点不在输入框里时才清选区：写完草稿会把焦点交回 composer，
				// 这时清 DOM 选区会把 composer 自己的光标一起清掉。
				try {
					const active = document.activeElement;
					if (active instanceof Element && active.closest('[data-composer-seat]') !== null) return;
					const sel = window.getSelection();
					if (sel !== null && sel !== undefined) sel.removeAllRanges();
				} catch (err) { /* 忽略 */ }
			}, []);

			/** 短暂提示，1.6s 后自动消失。 */
			const say = React.useCallback(function (text) {
				setFlash(text);
				try { window.clearTimeout(flashTimer.current); } catch (err) { /* 忽略 */ }
				flashTimer.current = window.setTimeout(function () { setFlash(''); }, 1600);
			}, []);

			/**
			 * 复制结果落定。用定时器把标签复位，而不是在选区变化时复位 ——
			 * 兜底复制路径会短暂动一下选区，那样会把「已复制」瞬间擦掉。
			 */
			const settleCopy = React.useCallback(function (state) {
				setCopyState(state);
				try { window.clearTimeout(copyTimer.current); } catch (err) { /* 忽略 */ }
				copyTimer.current = window.setTimeout(function () { setCopyState('idle'); }, 1400);
			}, []);

			// 文档级选区监听：鼠标抬起 / 选区变化 / Shift+方向键 / 滚动重定位。
			React.useEffect(function () {
				let timer = 0;
				const isOurs = function (target) {
					return target instanceof Element && target.closest('[' + OWN + ']') !== null;
				};
				const refresh = function () {
					if (openRef.current) return;
					if (draggingRef.current) return;
					const next = readSelection();
					if (next === null) {
						rangeRef.current = null;
						setAnchor(null);
						return;
					}
					rangeRef.current = next.range;
					// 只有选区内容真的换了才把「已复制」标签复位。否则复制时兜底路径
					// 会短暂动一下选区（触发 selectionchange），标签会被立刻擦掉。
					const prev = anchorRef.current;
					if (prev === null || prev.text !== next.text || prev.sessionId !== next.sessionId) {
						setCopyState(function (before) { return before === 'idle' ? before : 'idle'; });
					}
					setAnchor({ first: next.first, last: next.last, text: next.text, sessionId: next.sessionId });
				};
				const schedule = function () {
					try { window.clearTimeout(timer); } catch (err) { /* 忽略 */ }
					timer = window.setTimeout(refresh, 60);
				};
				// 拖拽过程中不弹按钮：否则一边拖一边有个胶囊跟着跑，很吵。
				const onMouseDown = function (event) {
					if (isOurs(event.target)) return;
					draggingRef.current = true;
				};
				const onMouseUp = function (event) {
					draggingRef.current = false;
					if (isOurs(event.target)) return;
					schedule();
				};
				const onSelectionChange = function () {
					if (openRef.current) return;
					if (draggingRef.current) return;
					schedule();
				};
				const onKeyUp = function (event) {
					if (isOurs(event.target)) return;
					if (event.key === 'Shift' || event.key.indexOf('Arrow') === 0) schedule();
				};
				const onScroll = function () {
					if (openRef.current) return;
					const range = rangeRef.current;
					if (range === null || range === undefined) return;
					const rects = rangeRects(range);
					if (rects === null) { setAnchor(null); rangeRef.current = null; return; }
					const first = toBox(rects.first);
					const last = toBox(rects.last);
					setAnchor(function (prev) {
						return prev === null ? prev : { first, last, text: prev.text, sessionId: prev.sessionId };
					});
				};
				document.addEventListener('mousedown', onMouseDown, true);
				document.addEventListener('mouseup', onMouseUp, true);
				document.addEventListener('selectionchange', onSelectionChange);
				document.addEventListener('keyup', onKeyUp, true);
				document.addEventListener('scroll', onScroll, true);
				return function () {
					try { window.clearTimeout(timer); } catch (err) { /* 忽略 */ }
					document.removeEventListener('mousedown', onMouseDown, true);
					document.removeEventListener('mouseup', onMouseUp, true);
					document.removeEventListener('selectionchange', onSelectionChange);
					document.removeEventListener('keyup', onKeyUp, true);
					document.removeEventListener('scroll', onScroll, true);
				};
			}, []);

			// popover 打开后把焦点交给输入框。
			React.useEffect(function () {
				if (!open) return;
				const node = inputRef.current;
				if (node !== null && node !== undefined) {
					try { node.focus(); } catch (err) { /* 忽略 */ }
				}
			}, [open]);

			// 实测按钮尺寸：文案长短随语言变化，用估算值做视口夹取会算错。
			React.useLayoutEffect(function () {
				const node = triggerRef.current;
				if (node === null || node === undefined || typeof node.getBoundingClientRect !== 'function') return;
				const box = node.getBoundingClientRect();
				if (box.width <= 0 || box.height <= 0) return;
				setBtnSize(function (prev) {
					if (prev !== null && Math.abs(prev.w - box.width) < 0.5 && Math.abs(prev.h - box.height) < 0.5) return prev;
					return { w: box.width, h: box.height };
				});
			});

			// Esc 全局收起。
			React.useEffect(function () {
				if (!open) return;
				const onKeyDown = function (event) {
					if (event.key === 'Escape') { event.stopPropagation(); close(); }
				};
				document.addEventListener('keydown', onKeyDown, true);
				return function () { document.removeEventListener('keydown', onKeyDown, true); };
			}, [open, close]);

			// 点空白处收起 popover（点自己人不动）。
			React.useEffect(function () {
				if (!open) return;
				const onDown = function (event) {
					const target = event.target;
					if (target instanceof Element && target.closest('[' + OWN + ']') !== null) return;
					close();
				};
				document.addEventListener('mousedown', onDown, true);
				return function () { document.removeEventListener('mousedown', onDown, true); };
			}, [open, close]);

			React.useEffect(function () {
				return function () {
					try { window.clearTimeout(flashTimer.current); } catch (err) { /* 忽略 */ }
					try { window.clearTimeout(copyTimer.current); } catch (err) { /* 忽略 */ }
				};
			}, []);

			const openPopover = React.useCallback(function (event) {
				// 别让浏览器把选区在 mousedown 时清掉，否则用户会看到高亮闪一下。
				if (event !== null && event !== undefined && typeof event.preventDefault === 'function') event.preventDefault();
				if (anchorRef.current === null) return;
				openRef.current = true;
				setReply('');
				setFlash('');
				setOpen(true);
			}, []);

			/** 复制为 markdown：直接用 live range，不受引用长度上限影响。 */
			const doCopy = React.useCallback(function (event) {
				if (event !== null && event !== undefined && typeof event.preventDefault === 'function') event.preventDefault();
				const range = rangeRef.current;
				let text = '';
				try {
					text = markdownFromRange(range);
				} catch (err) {
					text = '';
				}
				if (text.length === 0) { settleCopy('failed'); return; }
				if (text.length > COPY_LIMIT) text = text.slice(0, COPY_LIMIT) + '…';
				writeClipboard(text).then(function (ok) {
					settleCopy(ok ? 'copied' : 'failed');
				});
			}, [settleCopy]);

			const doInsert = React.useCallback(function () {
				const current = anchorRef.current;
				if (current === null) return;
				const resolved = resolveConversation(ctx, current.sessionId);
				if (resolved === null) { say(L.noSession); return; }
				const input = resolveInput(resolved);
				if (input === null || typeof input.setDraft !== 'function') { say(L.failed + 'composer unavailable'); return; }
				const block = compose(current.text, reply);
				const next = appendToDraft(readDraft(input), block);
				try {
					input.setDraft(next);
				} catch (err) {
					say(L.failed + (err instanceof Error ? err.message : String(err)));
					return;
				}
				try { if (typeof input.focus === 'function') input.focus(); } catch (err) { /* 忽略 */ }
				close();
			}, [ctx, reply, say, close, L]);

			const doSend = React.useCallback(function () {
				const current = anchorRef.current;
				if (current === null) return;
				if (String(reply || '').trim().length === 0) { say(L.empty); return; }
				const resolved = resolveConversation(ctx, current.sessionId);
				if (resolved === null) { say(L.noSession); return; }
				const text = compose(current.text, reply);
				try {
					const pending = resolved.conversation.send(text);
					if (pending && typeof pending.catch === 'function') {
						pending.catch(function (err) {
							console.warn('[dsh-quote-reply] send failed:', err);
						});
					}
				} catch (err) {
					say(L.failed + (err instanceof Error ? err.message : String(err)));
					return;
				}
				close();
			}, [ctx, reply, say, close, L]);

			const onTextareaKeyDown = React.useCallback(function (event) {
				if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
					event.preventDefault();
					doSend();
				}
			}, [doSend]);

			if (anchor === null && !open) return null;

			// ---- 位置：交给纯函数 layout()，见上方注释 ----
			const vw = typeof window === 'undefined' ? 1024 : window.innerWidth;
			const vh = typeof window === 'undefined' ? 768 : window.innerHeight;
			const box = anchor === null
				? { triggerX: 8, triggerY: 8, popX: 8, popY: 8 }
				: layout(anchor, {
					btnW: btnSize === null ? BTN_W : btnSize.w,
					btnH: btnSize === null ? BTN_H : btnSize.h,
					vw,
					vh,
				});
			const triggerX = box.triggerX;
			const triggerY = box.triggerY;
			const popX = box.popX;
			const popY = box.popY;

			const nodes = [];
			if (anchor !== null && !open) {
				nodes.push(h('div', {
					key: 'trigger',
					ref: triggerRef,
					className: 'dqr-trigger',
					role: 'toolbar',
					style: { left: triggerX + 'px', top: triggerY + 'px' },
					// 整个工具条都在 mousedown 阶段拦一下：否则点按钮的瞬间选区会被清掉。
					onMouseDown: function (event) { event.preventDefault(); },
				},
					h('button', {
						type: 'button',
						className: 'dqr-trigger-item',
						title: L.title,
						'aria-label': L.title,
						onClick: openPopover,
					},
						h('span', { className: 'dqr-trigger-glyph', 'aria-hidden': 'true' }, '❝'),
						h('span', null, L.trigger)
					),
					h('span', { className: 'dqr-trigger-sep', 'aria-hidden': 'true' }),
					h('button', {
						type: 'button',
						className: 'dqr-trigger-item',
						title: L.copyTitle,
						'aria-label': L.copyTitle,
						onClick: doCopy,
					},
						h('span', { className: 'dqr-trigger-glyph', 'aria-hidden': 'true' }, '⧉'),
						h('span', null, copyState === 'copied' ? L.copied : copyState === 'failed' ? L.copyFailed : L.copy)
					)
				));
			}
			if (open) {
				nodes.push(h('div', {
					key: 'pop',
					className: 'dqr-pop',
					role: 'dialog',
					'aria-label': L.title,
					style: { left: popX + 'px', top: popY + 'px' },
					onMouseDown: function (event) { event.stopPropagation(); },
				},
					h('div', { className: 'dqr-head' },
						h('span', null, L.title),
						h('button', {
							type: 'button',
							className: 'dqr-close',
							'aria-label': L.cancel,
							title: L.cancel,
							onClick: close,
						}, '✕')
					),
					h('div', { className: 'dqr-quote' }, anchor === null ? '' : anchor.text),
					h('textarea', {
						ref: inputRef,
						className: 'dqr-input',
						value: reply,
						placeholder: L.placeholder,
						spellCheck: false,
						onChange: function (event) { setReply(event.target.value); },
						onKeyDown: onTextareaKeyDown,
					}),
					h('div', { className: 'dqr-actions' },
						flash.length > 0
							? h('span', { className: 'dqr-hint' }, flash)
							: h('span', { className: 'dqr-hint' }, '⌘/Ctrl + ↵'),
						h('button', { type: 'button', className: 'dqr-btn', onClick: close }, L.cancel),
						h('button', { type: 'button', className: 'dqr-btn', onClick: doInsert }, L.insert),
						h('button', { type: 'button', className: 'dqr-btn dqr-btn-primary', onClick: doSend }, L.send)
					)
				));
			}
			return h(React.Fragment, null, nodes);
		}
		//#endregion

		//#region 插件
		/** Cordis 插件名。 */
		const name = 'dsh-quote-reply';
		/** 只依赖客户端会话服务（用来定位 conversation 与它的输入框门面）。 */
		const inject = ['sessions'];

		/**
		 * 挂载浮动层。整层 UI 自带 React root，不占用任何 slot：
		 * 浮动元素必须脱离宿主的 overflow/flex 容器，slot 内渲染会被裁切。
		 * @param ctx - 客户端根上下文。
		 * @returns 卸载函数（React 树卸载 + 容器移除）。
		 */
		function apply(ctx) {
			if (typeof document === 'undefined' || !document || !document.body) return function () {};
			const disposers = [];
			/** 统一的清理：任何一步失败都不会留下半个浮层。 */
			const teardown = function () {
				for (const dispose of disposers) {
					try { dispose(); } catch (err) { /* 忽略 */ }
				}
			};
			try {
				const disposeStyles = installStyles();
				disposers.push(disposeStyles);
				if (ReactDOMClient === null || typeof ReactDOMClient.createRoot !== 'function') {
					console.warn('[dsh-quote-reply] react-dom createRoot 不可用，浮层未挂载');
					return teardown;
				}
				// 热重载兜底：先清掉上一轮遗留的容器，避免出现两份浮层。
				for (const stale of Array.from(document.querySelectorAll('[' + ROOT_ATTR + ']'))) stale.remove();
				const container = document.createElement('div');
				container.setAttribute(ROOT_ATTR, '');
				container.setAttribute(OWN, '');
				document.body.appendChild(container);
				const root = ReactDOMClient.createRoot(container);
				disposers.push(function () {
					try { root.unmount(); } catch (err) { /* 忽略 */ }
					container.remove();
				});
				root.render(h(QuoteReplyLayer, { ctx }));
			} catch (err) {
				// 浮层挂不上不能连累整个客户端：记一条日志，把已建的资源收干净。
				console.error('[dsh-quote-reply] 挂载失败：', err);
				teardown();
				return function () {};
			}
			return teardown;
		}
		//#endregion

		module.exports = { apply, inject, name };
		return module.exports;
	},
});
