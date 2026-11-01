/**
 * dsh-quote-reply 冒烟测试（node，无需浏览器）。
 *
 * 覆盖这些事：
 *   ① 纯文本拼装（quoteBlock / compose / appendToDraft）——从源码切片求值，测的就是线上那份实现；
 *   ①b 定位（layout）——按钮必须悬在选区上方，绝不压住选中文字；
 *   ①c CSS 不变量——hover 不得改背景、不得用宿主没有的主题令牌（"按钮变透明"那个 bug）；
 *   ①d markdown 序列化——把渲染后的 DOM 反推回 markdown（复制功能）；
 *   ①e 剪贴板——优先 Clipboard API，兜底 execCommand，且必须还原用户选区；
 *   ①f 结构不变量——浮动工具条必须是「引用 + 复制」两个按钮；
 *   ② 模块工厂能否在最小 DOM 桩上加载并导出 {apply, inject, name}；
 *   ③ apply() 是否挂载容器、卸载时是否清理干净（含热重载去重）。
 *
 * 运行：node test/smoke.mjs
 * 真 DOM 版（需要 jsdom，可选）：node test/dom.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

// ---- ① 纯函数：从源码里切出「文本拼装」region 直接求值 ----
const start = source.indexOf('//#region 文本拼装')
const end = source.indexOf('//#endregion', start)
assert.ok(start > 0 && end > start, '找不到文本拼装 region')
const region = source.slice(source.indexOf('\n', start) + 1, end)
const pure = new Function(`${region}; return { quoteBlock, compose, appendToDraft }`)()
const { quoteBlock, compose, appendToDraft } = pure

assert.equal(quoteBlock('hello'), '> hello')
assert.equal(quoteBlock('a\nb'), '> a\n> b')
assert.equal(quoteBlock('a\n\nb'), '> a\n>\n> b', '空行退化为裸 >')
assert.equal(quoteBlock('  padded  \nnext'), '> padded\n> next', '行尾空白与整块首缩进被裁掉')
assert.equal(quoteBlock('a\r\nb'), '> a\n> b', 'CRLF 归一')
assert.equal(quoteBlock('\n\nonly\n\n\n'), '> only', '首尾空行去掉')

assert.equal(compose('q', ''), '> q', '空回复只给引用块')
assert.equal(compose('q', '   '), '> q', '空白回复只给引用块')
assert.equal(compose('q', 'r'), '> q\n\nr', '引用块 + 空行 + 回复')
assert.equal(compose('a\nb', 'r'), '> a\n> b\n\nr')

assert.equal(appendToDraft('', '> q'), '> q')
assert.equal(appendToDraft('   ', '> q'), '> q', '空白草稿不产生空行')
assert.equal(appendToDraft('draft', '> q'), 'draft\n\n> q')
assert.equal(appendToDraft('draft\n\n', '> q'), 'draft\n\n> q', '草稿尾部空白先裁掉')

// ---- ①b 定位：按钮必须落在选区所在行上，不能掉到下一行 ----
const layoutStart = source.indexOf('//#region 定位')
const layoutEnd = source.indexOf('//#endregion', layoutStart)
assert.ok(layoutStart > 0 && layoutEnd > layoutStart, '找不到定位 region')
const layoutSrc = source.slice(source.indexOf('\n', layoutStart) + 1, layoutEnd)
const { layout } = new Function(
  `const GAP = 6; const POP_W = 340; const POP_H = 216;\n${layoutSrc}; return { layout }`,
)()

const VW = 1200
const VH = 800
const size = { btnW: 72, btnH: 26, vw: VW, vh: VH }
const box = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top })

// 核心回归：按钮必须悬在选区**上方**，不能压住选中文字、更不能掉到下一行。
{
  const first = box(100, 200, 900, 220)
  const last = box(100, 222, 400, 242)
  const out = layout({ first, last }, size)
  assert.equal(out.triggerY + size.btnH, 200 - 6, '按钮底边应在选区首行上方 6px')
  assert.ok(out.triggerY + size.btnH <= first.top, '按钮绝不能压住选中文字（最初的 bug）')
  // 水平居中于选区包围盒 (100..900) → 中心 500，按钮左边 500-36=464。
  assert.equal(out.triggerX, 464, '按钮应水平居中于选区')
}

// 选区贴着视口顶部：上方没空间，落到选区下方，且不越界。
{
  const first = box(100, 0, 900, 20)
  const last = box(100, 22, 400, 42)
  const out = layout({ first, last }, size)
  assert.equal(out.triggerY, 42 + 6, '上方放不下时应落到选区下方')
  assert.ok(out.triggerY >= 8 && out.triggerY + size.btnH <= VH - 8, '按钮不得越出视口')
}

// 选区宽到接近视口边：按钮仍居中且完全留在视口内。
{
  const first = box(10, 300, 1190, 320)
  const last = box(10, 322, 1190, 342)
  const out = layout({ first, last }, size)
  assert.ok(out.triggerX >= 8, '按钮不得越出左边界')
  assert.ok(out.triggerX + size.btnW <= VW - 8, '按钮不得越出右边界')
}

// popover：按钮在上时向上展开，避免盖住选区。
{
  const first = box(100, 300, 900, 320)
  const last = box(100, 322, 400, 342)
  const out = layout({ first, last }, size)
  assert.ok(out.popY + 216 <= first.top + 0.5 || out.popY >= last.bottom, 'popover 不能压在选区上')
}

// 选区贴近视口底部：popover 必须留在视口内。
{
  const first = box(100, VH - 40, 900, VH - 20)
  const last = box(100, VH - 18, 400, VH - 2)
  const out = layout({ first, last }, size)
  assert.ok(out.popY >= 8 && out.popY + 216 <= VH - 8, 'popover 不得越出视口')
}

// ---- ①c CSS 不变量：hover 不得改背景、不得用宿主没有的主题令牌 ----
// 用户报的"按钮浮于文字下方"，真因是 .dqr-trigger:hover 用了一个宿主不存在的
// 令牌 --dsw-alias-interactive-bg-hover，background 简写把实心背景整体替换成
// 82% 透明的灰，鼠标一移上去正文就透出来。下面三条断言把它钉死。
{
  // 宿主主题实际提供的令牌全集（cordis_inspect_query client/Theme listTokens）。
  const HOST_TOKENS = new Set([
    '--dsw-alias-bg-base',
    '--dsw-alias-bg-layer-1',
    '--dsw-alias-bg-layer-2',
    '--dsw-alias-bg-overlay',
    '--dsw-alias-border-l1',
    '--dsw-alias-border-l2',
    '--dsw-alias-brand-primary',
    '--dsw-alias-label-primary',
    '--dsw-alias-label-secondary',
    '--dsw-alias-state-error-primary',
    '--dsw-alias-state-idle-primary',
    '--dsw-alias-state-success-primary',
    '--dsw-alias-state-warn-primary',
    '--dsw-specific-sidebar-fill',
  ])

  // ① 源码里引用的每个 --dsw-* 令牌都必须是宿主真实提供的。
  const used = new Set(source.match(/--dsw-[a-z0-9-]+/g) ?? [])
  for (const token of used) {
    assert.ok(HOST_TOKENS.has(token), `用了宿主没有的主题令牌：${token}`)
  }

  // ② .dqr-trigger 的底色契约，分两半：
  //    · 基类规则：必须有硬编码实色 background-color 兜底（令牌缺失也不会透），
  //      令牌只能走 background-image 叠在实色之上；
  //    · 状态规则（:hover / :active / …）：绝不可以声明 background / background-color /
  //      opacity / backdrop-filter / filter —— 当年就是 :hover 用不存在的令牌改背景，
  //      把实心底整体换成 82% 透明灰，鼠标一移上去正文就透出来。
  //    注意：popover 内部的 .dqr-close / .dqr-btn 可以有半透明 hover —— 它们压在
  //    .dqr-pop 的实心底上，正文不会透过来，所以不在禁令范围内。
  //
  //    解析前必须先剥掉 CSS 注释：注释里出现 '}' 会切断规则，出现普通文字会被
  //    并进选择器，两者都会让下面的检查静默失效（这条测试自己就踩过这个坑）。
  const cssOnly = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const ruleRe = /([^{}]+)\{([^}]*)\}/g
  let sawBase = false
  let sawState = 0
  let m
  while ((m = ruleRe.exec(cssOnly)) !== null) {
    const selector = m[1].trim()
    const body = m[2]
    const parts = selector.split(',').map((s) => s.trim())
    // 只认「选择器整体就是 .dqr-trigger 或 .dqr-trigger:<pseudo>」，排除 .dqr-trigger-glyph。
    const base = parts.some((s) => s === '.dqr-trigger')
    const state = parts.some((s) => /^\.dqr-trigger:[a-z-]+$/.test(s))
    if (!base && !state) continue

    const declarations = body
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => ({
        prop: d.slice(0, d.indexOf(':')).trim().toLowerCase(),
        value: d.slice(d.indexOf(':') + 1).trim(),
      }))

    if (base) {
      sawBase = true
      const bg = declarations.find((d) => d.prop === 'background-color')
      assert.ok(bg, '.dqr-trigger 基类必须有 background-color 实色兜底')
      assert.match(
        bg.value,
        /^#[0-9a-f]{3,8}$/i,
        `基类 background-color 必须是硬编码实色（当前是 ${bg.value}），不能依赖令牌`,
      )
      assert.ok(
        !declarations.some((d) => d.prop === 'background'),
        '.dqr-trigger 基类不得用 background 简写（会把实色底整体替换掉）',
      )
      // 基类同样不许整体降低不透明度 —— 实色底 + opacity < 1 一样会透出正文。
      for (const d of declarations) {
        assert.ok(
          d.prop !== 'opacity' && d.prop !== 'backdrop-filter' && d.prop !== 'filter',
          `.dqr-trigger 基类改了 ${d.prop}，会让正文从按钮里透出来`,
        )
      }
      continue
    }

    sawState += 1
    for (const d of declarations) {
      assert.ok(
        d.prop !== 'background' &&
          d.prop !== 'background-color' &&
          d.prop !== 'opacity' &&
          d.prop !== 'backdrop-filter' &&
          d.prop !== 'filter',
        `${selector} 改了 ${d.prop}，会让正文从按钮里透出来（"按钮变透明"bug 复发）`,
      )
    }
  }
  assert.ok(sawBase, '没找到 .dqr-trigger 基类规则，正则可能失效了')
  assert.ok(sawState >= 2, `只匹配到 ${sawState} 条 .dqr-trigger 状态规则，正则可能失效了`)

  // ③ 浮层底色必须有一层硬编码实色兜底，不能只依赖令牌。
  //    注意：CSS 模板串里有 ${POP_W} 这类插值，里面的 '}' 会骗过朴素的 indexOf，
  //    所以这里按花括号深度找匹配的收尾括号。
  const sliceRule = (cls) => {
    const at = source.indexOf(cls + ' {')
    assert.ok(at > 0, `找不到 ${cls} 的样式块`)
    let depth = 0
    let i = source.indexOf('{', at)
    const bodyStart = i + 1
    for (; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1
      else if (source[i] === '}') {
        depth -= 1
        if (depth === 0) return source.slice(bodyStart, i)
      }
    }
    throw new Error(`${cls} 的样式块没有闭合`)
  }
  for (const cls of ['.dqr-trigger', '.dqr-pop']) {
    const body = sliceRule(cls)
    assert.match(
      body,
      /background-color:\s*#[0-9a-f]{3,8}\b/i,
      `${cls} 必须有硬编码的实色 background-color 兜底，否则令牌缺失时正文会透出`,
    )
  }

  // ④ 主按钮不得用 brand-primary 当底色 —— 它在某些主题里是近白色，
  //    与文字色 label-primary（同样近白）撞成白底白字，按钮变成一块白板。
  const primary = sliceRule('.dqr-btn-primary')
  assert.match(
    primary,
    /background:\s*#[0-9a-f]{3,8}\b/i,
    '.dqr-btn-primary 的底色必须是硬编码实色，不能依赖 brand-primary',
  )
  assert.ok(
    !/--dsw-alias-brand-primary/.test(primary),
    '.dqr-btn-primary 不能用 --dsw-alias-brand-primary 当底色（部分主题下是近白色 → 白底白字）',
  )
  assert.match(
    primary,
    /color:\s*#[0-9a-f]{3,8}\b/i,
    '.dqr-btn-primary 的文字色必须是硬编码实色，不能依赖 label-primary',
  )
  // 底与字的亮度必须拉开，否则就是白底白字
  const hexLum = (hex) => {
    const h = hex.replace('#', '')
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  }
  const bgHex = primary.match(/background:\s*(#[0-9a-f]{3,8})\b/i)[1]
  const fgHex = primary.match(/color:\s*(#[0-9a-f]{3,8})\b/i)[1]
  const [lo, hi] = [hexLum(bgHex), hexLum(fgHex)].sort((a, b) => a - b)
  const contrast = (hi + 0.05) / (lo + 0.05)
  assert.ok(
    contrast >= 4.5,
    `.dqr-btn-primary 底色 ${bgHex} 与文字色 ${fgHex} 对比度只有 ${contrast.toFixed(2)}:1，低于 4.5:1（按钮文字会看不清）`,
  )
}

// ---- ①d markdown 序列化：把渲染后的 DOM 反推回 markdown ----
const mdStart = source.indexOf('//#region markdown 序列化')
const mdEnd = source.indexOf('//#endregion', mdStart)
assert.ok(mdStart > 0 && mdEnd > mdStart, '找不到 markdown 序列化 region')
const mdSrc = source.slice(source.indexOf('\n', mdStart) + 1, mdEnd)
const { markdownFromRange, mdSerialize, mdChildren } = new Function(
  `${mdSrc}; return { markdownFromRange, mdSerialize, mdChildren }`,
)()

// 极简假 DOM：只提供序列化器真正用到的属性面。
const t = (value) => ({ nodeType: 3, nodeValue: value, childNodes: [] })
const el = (tag, attrs = {}, kids = []) => ({
  nodeType: 1,
  tagName: tag.toUpperCase(),
  attributes: attrs,
  childNodes: kids,
  getAttribute: (name) => (name in attrs ? attrs[name] : null),
})
const frag = (kids) => ({ nodeType: 11, childNodes: kids })
const md = (node) => mdChildren(node, { pre: false })

assert.equal(md(frag([t('hello')])), 'hello', '纯文本原样输出')
assert.equal(md(frag([el('p', {}, [t('a'), el('strong', {}, [t('b')]), t('c')])])), 'a**b**c\n\n')
assert.equal(md(frag([el('em', {}, [t('x')])])), '*x*')
assert.equal(md(frag([el('del', {}, [t('x')])])), '~~x~~')
assert.equal(md(frag([el('code', {}, [t('inline')])])), '`inline`', '行内代码')
assert.equal(md(frag([el('code', {}, [t('a`b')])])), '``a`b``', '含反引号的行内代码要加宽围栏')
assert.equal(
  md(frag([el('a', { href: 'https://x.dev' }, [t('link')])])),
  '[link](https://x.dev)',
  '链接',
)
assert.equal(md(frag([el('a', { href: '#anchor' }, [t('jump')])])), 'jump', '页内锚点退化为纯文本')
assert.equal(md(frag([el('h2', {}, [t('Title')])])), '## Title\n\n', '标题层级')
assert.equal(md(frag([el('br')])), '\n')

// 列表：无序 / 有序 / 嵌套
assert.equal(md(frag([el('ul', {}, [el('li', {}, [t('a')]), el('li', {}, [t('b')])])])), '- a\n- b\n\n')
assert.equal(
  md(frag([el('ol', { start: '3' }, [el('li', {}, [t('c')]), el('li', {}, [t('d')])])])),
  '3. c\n4. d\n\n',
  '有序列表要尊重 start',
)
assert.equal(
  md(frag([el('ul', {}, [el('li', {}, [t('a'), el('ul', {}, [el('li', {}, [t('a1')])])])])])),
  '- a\n  - a1\n\n',
  '嵌套列表缩进两个空格',
)

// 引用块
assert.equal(md(frag([el('blockquote', {}, [el('p', {}, [t('q')])])])), '> q\n\n')

// 围栏代码块：宿主渲染成 div.md-code-block > 横幅 + [data-code-block-content] > pre > code
const hostCodeBlock = el('div', { class: 'md-code-block' }, [
  el('div', { 'data-code-block-banner': '' }, [
    el('div', { class: 'infostring' }, [t('ts')]),
    el('div', { class: 'action' }, [el('button', {}, [t('Copy')])]),
  ]),
  el('div', { 'data-code-block-content': '' }, [
    el('pre', {}, [el('code', { class: 'language-ts' }, [t('const a = 1')])]),
  ]),
])
assert.equal(md(frag([hostCodeBlock])), '```ts\nconst a = 1\n```\n\n', '宿主代码块结构 → 围栏代码块')

// 代码块里出现 ``` 时围栏要加宽
assert.equal(md(frag([el('pre', {}, [t('a ``` b')])])), '````\na ``` b\n````\n\n')

// GFM 表格
const table = el('div', { class: 'tableScroll' }, [
  el('table', {}, [
    el('thead', {}, [el('tr', {}, [el('th', {}, [t('A')]), el('th', {}, [t('B')])])]),
    el('tbody', {}, [
      el('tr', {}, [el('td', {}, [t('1')]), el('td', {}, [t('2')])]),
    ]),
  ]),
])
assert.equal(md(frag([table])), '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n', 'GFM 表格')

// 表格单元格里的 | 要转义
assert.equal(
  md(frag([el('table', {}, [el('tr', {}, [el('th', {}, [t('a|b')])])])])),
  '| a\\|b |\n| --- |\n\n',
  '单元格内的竖线要转义',
)

// 任务列表
assert.equal(
  md(frag([el('ul', {}, [el('li', {}, [el('input', { type: 'checkbox', checked: '' }), t(' done')])])])),
  '- [x] done\n\n',
  '任务列表复选框',
)

// 非正文节点必须被跳过（复制按钮的文字不能混进 markdown）
assert.equal(md(frag([el('div', {}, [el('button', {}, [t('复制')]), t('body')])])), 'body\n\n')

// markdownFromRange 走 cloneContents
{
  const range = {
    cloneContents: () => frag([el('p', {}, [t('x'), el('strong', {}, [t('y')])])]),
  }
  assert.equal(markdownFromRange(range), 'x**y**', 'markdownFromRange 应基于 cloneContents 结果')
  assert.equal(markdownFromRange(null), '', '没有 range 时返回空串')
}

// ---- ①e 剪贴板：优先 Clipboard API，失败退回 execCommand，且必须还原选区 ----
{
  const clipStart = source.indexOf('//#region 剪贴板')
  const clipEnd = source.indexOf('//#endregion', clipStart)
  assert.ok(clipStart > 0 && clipEnd > clipStart, '找不到剪贴板 region')
  const clipSrc = source.slice(source.indexOf('\n', clipStart) + 1, clipEnd)

  // 用假的 window/document/navigator 求值，返回 writeClipboard 供下面逐个场景调用。
  const makeClip = ({ clipboard, execOk }) => {
    const ranges = ['r1', 'r2']
    const selection = {
      rangeCount: ranges.length,
      removed: 0,
      readded: [],
      getRangeAt(i) { return ranges[i] },
      removeAllRanges() { this.removed += 1; this.rangeCount = 0 },
      addRange(r) { this.readded.push(r) },
    }
    const area = {
      value: '',
      style: {},
      setAttribute() {},
      select() { this.selected = true },
      remove() { this.removed = true },
    }
    const doc = {
      body: { appendChild() {} },
      activeElement: null,
      createElement: () => area,
      execCommand(cmd) { return cmd === 'copy' ? execOk : false },
    }
    const win = { getSelection: () => selection }
    const nav = clipboard ? { clipboard } : {}
    const fn = new Function('window', 'document', 'navigator', `${clipSrc}; return writeClipboard`)
    return { write: fn(win, doc, nav), selection, area }
  }

  // 1) Clipboard API 正常：直接成功，不碰 execCommand，不动选区。
  {
    const ctx = makeClip({ clipboard: { writeText: async () => {} }, execOk: false })
    assert.equal(await ctx.write('hello'), true, 'Clipboard API 成功时返回 true')
    assert.equal(ctx.selection.removed, 0, '成功路径不应动选区')
  }

  // 2) Clipboard API reject（页面失焦）：退回 execCommand，并且选区必须被还原。
  {
    const ctx = makeClip({ clipboard: { writeText: async () => { throw new Error('denied') } }, execOk: true })
    assert.equal(await ctx.write('hello'), true, '兜底路径成功时返回 true')
    assert.equal(ctx.area.value, 'hello', '兜底路径应把文本放进隐藏 textarea')
    assert.ok(ctx.selection.removed >= 1, '兜底路径会清空选区')
    assert.deepEqual(ctx.selection.readded, ['r1', 'r2'], '兜底路径必须把原选区还回去')
  }

  // 3) 两条路都失败：返回 false（UI 显示「复制失败」）。
  {
    const ctx = makeClip({ clipboard: { writeText: async () => { throw new Error('denied') } }, execOk: false })
    assert.equal(await ctx.write('hello'), false, '全失败时返回 false')
  }
}

// 文件提及（宿主渲染成 <code><button class="fileMention">路径</button></code>）
assert.equal(
  md(frag([el('code', {}, [el('button', { class: 'fileMention' }, [t('src/a.ts')])])])),
  '`src/a.ts`',
  '行内代码里的文件提及不能丢内容',
)

// 数学公式：KaTeX 的 annotation 里藏着原始 TeX
const katexInline = el('span', { class: 'katex' }, [
  el('span', { class: 'katex-mathml' }, [
    el('math', {}, [
      el('semantics', {}, [
        el('annotation', { encoding: 'application/x-tex' }, [t('a^2+b^2')]),
      ]),
    ]),
  ]),
  el('span', { class: 'katex-html', 'aria-hidden': 'true' }, [t('a2+b2')]),
])
assert.equal(md(frag([katexInline])), '$a^2+b^2$', '行内公式取 annotation 里的 TeX')

const katexBlock = el('span', { class: 'katex-display' }, [
  el('span', { class: 'katex' }, [
    el('annotation', { encoding: 'application/x-tex' }, [t('\\int_0^1 x\\,dx')]),
  ]),
])
assert.equal(md(frag([katexBlock])), '$$\n\\int_0^1 x\\,dx\n$$\n\n', '块级公式')

// 普通按钮仍然要被丢掉（复制按钮的文字不能混进来）
assert.equal(md(frag([el('button', { class: 'action' }, [t('Copy')])])), '')

// 列表项里嵌代码块：代码块不能被压进那一行里
assert.equal(
  md(frag([el('ul', {}, [el('li', {}, [t('run'), el('pre', {}, [t('npm i')])])])])),
  '- run\n  ```\n  npm i\n  ```\n\n',
  '列表项里的代码块要换行缩进，不能压成一行',
)

// ---- ①f 结构不变量：浮动工具条必须是「引用 + 复制」两个按钮 ----
{
  const regionStart = source.indexOf("if (anchor !== null && !open) {")
  const regionEnd = source.indexOf('if (open) {', regionStart)
  assert.ok(regionStart > 0 && regionEnd > regionStart, '找不到工具条渲染段')
  const trigger = source.slice(regionStart, regionEnd)
  const items = trigger.match(/className: 'dqr-trigger-item'/g) || []
  assert.equal(items.length, 2, '浮动工具条应当恰好有两个按钮（引用 / 复制）')
  assert.ok(trigger.includes('onClick: openPopover'), '第一个按钮打开回复弹窗')
  assert.ok(trigger.includes('onClick: doCopy'), '第二个按钮执行复制')
  assert.ok(trigger.includes('dqr-trigger-sep'), '两个按钮之间应有分隔线')
  // 复制按钮的文案必须随 copyState 变化，否则用户看不到「已复制」反馈。
  assert.ok(/copyState === 'copied'/.test(trigger), '复制成功后按钮要显示「已复制」')
  assert.ok(/copyState === 'failed'/.test(trigger), '复制失败后按钮要显示「复制失败」')

  // 文案表两套语言都要有这四个键，否则切换语言时会出现 undefined。
  for (const key of ['copy', 'copied', 'copyFailed', 'copyTitle']) {
    const hits = source.match(new RegExp(`\\b${key}:`, 'g')) || []
    assert.ok(hits.length >= 2, `STRINGS 的 ${key} 必须在 zh 与 en 里各有一份`)
  }
}

// ---- ② 模块工厂：最小 DOM / React 桩 ----
function makeElement(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    dataset: {},
    style: {},
    children: [],
    attributes: {},
    textContent: '',
    isConnected: true,
    setAttribute(name, value) { this.attributes[name] = value },
    getAttribute(name) { return this.attributes[name] ?? null },
    appendChild(child) { child.parent = this; this.children.push(child); return child },
    remove() {
      this.removed = true
      if (this.parent) {
        const at = this.parent.children.indexOf(this)
        if (at >= 0) this.parent.children.splice(at, 1)
      }
    },
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    querySelector() { return null },
    querySelectorAll() { return [] },
    closest() { return null },
  }
}

const body = makeElement('body')
const head = makeElement('head')
const created = []
const documentStub = {
  body,
  head,
  createElement(tag) { const el = makeElement(tag); created.push(el); return el },
  querySelector() { return null },
  querySelectorAll(selector) {
    if (selector === '[data-dsh-quote-reply-root]') return body.children.filter((c) => c.attributes['data-dsh-quote-reply-root'] !== undefined)
    return []
  },
  addEventListener() {},
  removeEventListener() {},
}

let captured = null
const windowStub = {
  __ModuleLoader__: { load(entry) { captured = entry } },
  getSelection() { return null },
  setTimeout,
  clearTimeout,
  innerWidth: 1280,
  innerHeight: 800,
  addEventListener() {},
  removeEventListener() {},
}

const rendered = []
const ReactStub = {
  createElement: (type, props, ...kids) => ({ type, props, kids }),
  Fragment: Symbol('Fragment'),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useRef: (value) => ({ current: value }),
  useCallback: (fn) => fn,
}
const createRootCalls = []
const ReactDOMClientStub = {
  createRoot(container) {
    createRootCalls.push(container)
    return { render: (node) => rendered.push(node), unmount: () => rendered.push('UNMOUNT') }
  },
}

const requireStub = (id) => {
  if (id === 'react') return ReactStub
  if (id === 'react-dom/client') return ReactDOMClientStub
  if (id === 'react-dom') return {}
  throw new Error('unexpected require: ' + id)
}

// 求值：把 client.js 当脚本跑，注入 window / document / navigator
const runner = new Function('window', 'document', 'navigator', source)
runner(windowStub, documentStub, { language: 'zh-CN' })

assert.ok(captured !== null, '模块工厂没有被登记')
assert.equal(captured.id, 'dsh-quote-reply')

const plugin = captured.factory(requireStub)
assert.equal(plugin.name, 'dsh-quote-reply')
assert.deepEqual(plugin.inject, ['sessions'])
assert.equal(typeof plugin.apply, 'function')

// ---- ③ apply / dispose ----
const scope = {
  get(service) {
    if (service !== 'conversation') return undefined
    return { send: async () => {}, input: { for: () => null } }
  },
}
const ctx = { sessions: { scope: () => scope } }

const dispose = plugin.apply(ctx)
assert.equal(createRootCalls.length, 1, 'apply 应当只建一个 React root')
assert.equal(body.children.length, 1, 'apply 应当往 body 挂一个容器')
assert.equal(body.children[0].attributes['data-dsh-quote-reply-root'], '')
assert.equal(rendered.length, 1, 'apply 应当 render 一次')
assert.equal(rendered[0].props.ctx, ctx, '组件应当拿到插件上下文')

// 热重载：第二次 apply 不应留下两份容器
const dispose2 = plugin.apply(ctx)
assert.equal(body.children.length, 1, '重复 apply 不能叠加容器')
dispose2()

dispose()
assert.ok(rendered.includes('UNMOUNT'), 'dispose 应当 unmount React 树')

console.log('smoke: all assertions passed')
