/**
 * 真 DOM 版序列化测试（可选，需要 jsdom）。
 *
 * `test/smoke.mjs` 用的是手搓的假 DOM；这里用 jsdom 建**真的** DOM，HTML 结构照抄
 * 宿主 `@deepseek-ai/dsh-client-ui-primitives` 的渲染输出（含代码块横幅、GFM 表格、
 * 文件提及按钮、KaTeX 注解），再用真的 `Range` 切片，确认「复制为 Markdown」在
 * 浏览器里会拿到的那些节点上确实成立。
 *
 * 没装 jsdom 时直接跳过（插件本身零依赖，测试也不强制）：
 *   npm i --no-save jsdom && node test/dom.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

let JSDOM
try {
  ({ JSDOM } = await import('jsdom'))
} catch {
  console.log('dom: skipped (jsdom not installed)')
  process.exit(0)
}

const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
const start = source.indexOf('//#region markdown 序列化')
const end = source.indexOf('//#endregion', start)
if (start < 0 || end < start) throw new Error('找不到 markdown 序列化 region')
const region = source.slice(source.indexOf('\n', start) + 1, end)
const { markdownFromRange, mdChildren } = new Function(`${region}; return { markdownFromRange, mdChildren }`)()

const dom = new JSDOM('<!doctype html><body></body>')
const doc = dom.window.document

/** 把一段宿主风格的 HTML 序列化成 markdown（与 markdownFromRange 同一套收尾规则）。 */
const md = (html) => {
  const host = doc.createElement('div')
  host.innerHTML = html
  return mdChildren(host, { pre: false })
    .replace(/\n[ \t]+\n/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const cases = [
  ['段落 + 粗斜体', '<p>a<strong>bold</strong> and <em>ital</em> and <del>gone</del></p>', 'a**bold** and *ital* and ~~gone~~'],
  ['标题', '<h1>One</h1><h3>Three</h3>', '# One\n\n### Three'],
  ['无序列表', '<ul><li>a</li><li>b</li></ul>', '- a\n- b'],
  ['有序列表 start=3', '<ol start="3"><li>c</li><li>d</li></ol>', '3. c\n4. d'],
  ['嵌套列表', '<ul><li>a<ul><li>a1</li></ul></li></ul>', '- a\n  - a1'],
  [
    '任务列表',
    '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" checked disabled> done</li><li class="task-list-item"><input type="checkbox" disabled> todo</li></ul>',
    '- [x] done\n- [ ] todo',
  ],
  ['引用块', '<blockquote><p>q1</p><p>q2</p></blockquote>', '> q1\n>\n> q2'],
  ['链接', '<p><a href="https://x.dev/a" target="_blank" rel="noopener noreferrer">x</a></p>', '[x](https://x.dev/a)'],
  ['行内代码', '<p><code>npm i</code></p>', '`npm i`'],
  [
    '围栏代码块（宿主结构）',
    '<div class="md-code-block"><div class="bannerWrap"><div class="banner" data-code-block-banner><div class="infostring">ts</div><div class="action"><button>Copy</button></div></div></div><div data-code-block-content><pre><code class="language-ts"><span>const a = 1</span></code></pre></div></div>',
    '```ts\nconst a = 1\n```',
  ],
  [
    'GFM 表格',
    '<div class="tableScroll"><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>',
    '| A | B |\n| --- | --- |\n| 1 | 2 |',
  ],
  ['文件提及', '<p><code><button class="fileMention">src/a.ts</button></code></p>', '`src/a.ts`'],
  [
    '行内公式',
    '<p><span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">a^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">a2</span></span></p>',
    '$a^2$',
  ],
  ['分隔线', '<hr>', '---'],
  ['多段之间不留空行噪声', '<p>one</p>\n\n<p>two</p>', 'one\n\ntwo'],
]

let failed = 0
for (const [name, html, want] of cases) {
  const got = md(html)
  if (got !== want) {
    failed++
    console.log(`FAIL ${name}\n  want: ${JSON.stringify(want)}\n  got:  ${JSON.stringify(got)}`)
  }
}

// 真实 Range：从 <strong> 中间切到第二个 <li> 中间，应该还原成引用块之外的最小片段。
const host = doc.createElement('div')
host.innerHTML = '<p>alpha <strong>beta</strong> gamma</p><ul><li>one</li><li>two</li></ul>'
doc.body.appendChild(host)
const range = doc.createRange()
range.setStart(host.querySelector('strong').firstChild, 0)
range.setEnd(host.querySelectorAll('li')[1].firstChild, 3)
const sliced = markdownFromRange(range)
if (sliced !== '**beta** gamma\n\n- one\n- two') {
  failed++
  console.log(`FAIL range slice\n  got: ${JSON.stringify(sliced)}`)
}

if (failed === 0) console.log(`dom: all ${cases.length + 1} real-DOM cases passed`)
else console.log(`dom: ${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
