// dsh-gacha-calendar 构建脚本
//
// 为什么是自己写的拼接脚本，而不是 package.json 里原来声明的 `tsc && tsdown`：
//   1) 本仓库历史上只提交了打包产物（lib/client.js），没有 src/、没有 tsconfig、
//      没有 devDependencies —— 那条命令从来没有真正跑起来过；
//   2) lib/client.js 的形态是"单作用域里顺序拼接的各段代码"（DSH 的 __ModuleLoader__ 工厂），
//      按段拼接可以做到**与产物逐字节一致**，这是比"重新用打包器生成一份差不多的文件"
//      强得多的验证：src/ 是唯一真源，build 结果可被 --check 精确校验；
//   3) 少一个打包器依赖 = 少一处版本漂移与格式噪声。
//
// 用法：
//   node build.mjs           写出 lib/client.js 与 lib/index.js
//   node build.mjs --check   只校验（不写盘）：src/ 拼出来的结果是否与 lib/ 现有产物一致
//
// 约定：src/ 下所有文件均为 LF 换行、UTF-8 无 BOM、Tab 缩进（与产物一致）。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC_CLIENT = path.join(ROOT, "src", "client");
const OUT_CLIENT = path.join(ROOT, "lib", "client.js");
const SRC_HOST = path.join(ROOT, "src", "index.js");
const OUT_HOST = path.join(ROOT, "lib", "index.js");
// core 包（中立名，供浏览器扩展 / Windows / 原生平台 import）；版本号跟随根 package.json
const OUT_CORE = path.join(ROOT, "packages", "core", "core.mjs");
const OUT_CORE_PKG = path.join(ROOT, "packages", "core", "package.json");
// 第三个产物：lib/remind-core.mjs —— **宿主半边**（src/index.js）唯一能复用的 core 代码。
// 为什么单独产出一份，而不是让宿主 import packages/core/core.mjs：
//   ① 发布包（package.json 的 files）只带 lib/，packages/core 是**另一个 npm 包**的目录，不该混进插件包里；
//   ② core.mjs 是 createEngine 的载体（28 个解析器全在里面），宿主只需要提醒判定那两百行 ——
//      为了一个纯函数拉进整份 core 既慢又放大故障面；
//   ③ 这里拼的是**同一个源文件**（src/client/65-remind.js）的原始文本，一字不改，只在尾部加 export
//      ⇒ 「判定只有一处实现」这条不变量仍然成立，且 --check 能逐字节校验。
const OUT_REMIND = path.join(ROOT, "lib", "remind-core.mjs");
const REMIND_CHUNK = "65-remind.js";
const REMIND_EXPORTS = [
  "REMIND_HOUR_MS",
  "REMIND_DEFAULT_END_NODES",
  "REMIND_DEFAULT_START_NODES",
  "REMIND_TZ_BY_ID",
  "remindOnOf",
  "remindIdentityOf",
  // 探测「开始菜单里哪条 .lnk 是我们的」的纯判定：按 AUMID 挑，不按文件名（改名失败时文件名是旧的）。
  "notifyShortcutPickOf",
  // 通知身份状态缓存（identity.json）的判定：给定文件内容 + now + 最大年龄 + 期望 AUMID
  // ⇒ { useCached, shouldRefresh, state }。GET / 每轮提醒都先读文件（毫秒级），没有 / 太旧才探测；
  // 宿主与 core 共用这一处（见 cases-remind.mjs ⑮）。
  "NOTIFY_IDENTITY_MAX_AGE_MS",
  "notifyIdentityCacheOf",
  // 没有 identity.json 时 GET **立刻**回的保守值（{ enabled:false, name:<配置名>, aumid, shortcutPath:"" }）：
  // GET 不许等探测 ⇒ 先回它、后台探测写回文件，下一次 GET 才是准确值（见 cases-remind.mjs ⑯）。
  "notifyIdentityFallbackOf",
  // 通知身份名（`notifyName`）的清洗：宿主要用它给快捷方式起名 / 写 DisplayName，
  // core 与设置页也用同一个（同一个字面量只有一个实现，见 65-remind.js）。
  "notifyNameOf",
  "remindNodesOf",
  "remindNodesToggleOf",
  "remindConfigOf",
  "remindKeyOf",
  "remindStateOf",
  "remindTestToastOf",
  "remindWindowOf",
  "remindItemsOf",
  "remindTickOf",
  "remindToastOf"
];

// 样式段的名字（2026-10-28：**它已经不是磁盘上的文件了**）。
// 真正的 CSS 真源搬到了 src/client/styles/*.css（按段落注释一组一文件），由本脚本按 CSS_ORDER
// 拼成下面这段，与搬迁前**逐字节相同**：
//     //#region styles
//     const STYLE = `…`;
//     //#endregion
// ORDER 里保留这个名字，是为了让"样式段夹在 engine-api.js 与 80-components.js 之间"这个产物结构
// 继续一眼可见；readChunks 见到它就走生成分支（见 styleChunk）。
const STYLE_CHUNK = "70-styles.js";

// 拼接顺序（= 原产物的 //#region 顺序，改了这里就等于改了产物结构）
const ORDER = [
  // ⚠️ 00-head.js **必须排第一**：它开出 `window.__ModuleLoader__.load({ factory })` 的工厂闭包，
  //    排在它之前的片段不会进入工厂体，而是落在**经典脚本顶层**（= 全局词法作用域）。
  //    2026-10-17 事故：05-version.js 原本排第一，`const PLUGIN_VERSION` 因此成了全局词法绑定；
  //    DSH 的 client-modules 在插件变更后会 invalidate 该行并**重新执行**整个客户端包
  //    （单资源 URL，见 dsh-client-modules 的 invalidate/reloadTargets），第二段经典脚本
  //    带着同名顶层 const → V8 "Identifier 'PLUGIN_VERSION' has already been declared"，
  //    整段不执行、插件掉线。守卫见下方 ORDER[0] 校验。
  "00-head.js",                // DSH 模块加载壳 + react require（**必须排第一**）
  "05-version.js",             // 插件版本号（占位符，由本脚本用根 package.json 注入）
  "10-config.js",              // 配置常量
  "15-env.js",                 // core 环境注入缝（transport / now / 计时器）
  "20-source-core.js",         // **模块顶层**：SOURCES 容器 + registerSource（44-test-exports 与 60-helpers 都要能看见）
  "21-fetcher-tables.js",      // 两张抓取器表（与游戏文件同层：每引擎一份）
  "22-fetcher-core.js",        // 抓取公共设施（抓取桥接 / 通用载荷 / 备选源解析）——与游戏文件同层
  "25-parser-shared.js",       // 共用判定（当期/长期/年份）+ 悬停排版 + 解码 + 时间 + 选择
  "30-game-hoyoverse.js",
  "30-game-kuro.js",
  "30-game-hypergryph.js",
  "30-game-bluearchive.js",
  "30-game-bandori.js",
  "30-game-bwiki.js",
  "30-game-biligame.js",
  "30-game-cygames.js",
  "30-game-perfectworld.js",
  "30-game-sunborn.js",
  "30-game-aniplex.js",
  "30-game-sega.js",
  "30-game-yostar.js",
  "30-game-bluepoch.js",
  "44-test-exports.js",        // 回归出口：解析器 + env 工具 + 来源表（挂 exports.__regression，测试用）
  "50-refresh.js",             // 刷新编排、失败沿用旧值
  "60-helpers.js",             // 共用纯函数：状态归一 / 提示文案 / 显隐 / 格式化 / 排序 / 启动刷新判定
  "65-remind.js",              // 到期提醒（送达）判定 + 文案（**同时被单独拼成 lib/remind-core.mjs**）
  "engine-head.js",            // core 引擎外壳：createEngine（面板只通过它拿 Result JSON）
  "engine-api.js",             // 引擎 API：refresh() / 测试出口 / return
  STYLE_CHUNK,                 // 样式（不是磁盘文件：src/client/styles/*.css 生成，见 CSS_ORDER）
  "80-components.js",          // React 组件（面板 + 设置页）
  "90-plugin.js",              // apply(ctx)：slots / configForms / 悬停 marquee
  "92-dsh-env.js",             // DSH 环境适配：注入 transport（直连 + 宿主代理）
  "99-tail.js",                // exports.apply / exports.inject / return
];

// 样式文件清单（**独立一份，不混进上面的 ORDER**：ORDER 是 JS 段，这里是 CSS 段）。
// 顺序 = 搬迁前 `70-styles.js` 里自上而下的顺序，**不许随意调换**：它是产物文本的一部分
// （`node build.mjs --check` 比的是"src 拼出来的 vs 磁盘上的 lib"，顺序换了照样自洽，
//  但 lib/client.js 会变 —— 那就不再是纯结构迁移了）。
// 切分依据的是原文件里**已有的段落注释**，没有重新分类：一组注释 + 它带的规则 = 一个文件。
// ⚠️ 文件里保留着原来那三个 Tab 的缩进：那些空白是模板字符串内容的一部分，
//    改了缩进 = 改了产物 CSS 文本，所以别"顺手对齐"。
//    同理 `schedule-foot.css` 里有一行**只有两个 Tab 的空白行**（原文就有），`git diff --check`
//    会把它点成 trailing whitespace —— 别去删，删了 lib/client.js 就不再逐字节相同。
const CSS_ORDER = [
  "ticker.css",            // 侧栏入口按钮 + 单行翻页轮播（.gacha-cal-btn* / keyframes / reduce）
  "panel.css",             // 旧面板：popover 壳 + 表格 + 截断文字 marquee
  "settings.css",          // 设置页控件：排序按钮 / 取色器 / 来源选择器
  "chip.css",              // 设置页「提醒」档位胶囊（.gacha-cal-chip*）
  "settings-header.css",   // 设置页标题行：版本号 / Star 指引 / 关闭 ✕
  "animations.css",        // 启动动画（面板每次打开重挂载 ⇒ 动画只跑一次）+ 删除键
  "schedule.css",          // 新面板：骨架 / 头部 / 近期 / 游戏表 / 探头
  "schedule-motion.css",   // 新面板：迷你条与进度环动画 + reduce
  "schedule-foot.css"      // 新面板：刷新失败条 / 底栏 / 搜索 / 字体规范 / 留白卡
];

// 第二个产物：dist/core.mjs —— 独立、零依赖的 ESM 模块，供浏览器扩展 / Windows / 原生平台 import。
// 组装方式：共用部分（配置 / 来源表 / helpers）放模块顶层；core 主体（15/30/40/50 + 引擎外壳）
// 包进 `export function createEngine(env) { … }` —— 同一个函数体，与 DSH 产物同源。
// 注：engine-head.js 里那一行 `function createEngine(env) {` 会被加上 `export ` 前缀（见下）。
//
// ⚠️ 2026-10-03（用户选方案 C2）：把 10 个 `42-parsers-*.js` 也纳入 core，**core 因此从
//   「内置 11 款」变成「全部 28 款」**，`43-sources-register.js` 也并进了 `40-fetchers.js`
//   （它本来就得在两张表声明之后跑）。
//   这带来一条**必须记住的约束**：`20-sources.js`（含 `SOURCES` 数组）在 core 里位于**模块顶层**，
//   而 `40-fetchers.js` 在 **`createEngine` 内** → 后者每建一个引擎就重跑一次。
//   因此 `40` 里对 `SOURCES` 的写操作**必须全部幂等**（现状：按 id 找到就覆盖 / 按 fetcher 去重 /
//   bh3 那处有 `some()` 守卫）。往 `40` 里再加"push 一条来源"时务必同样处理，否则多建几个引擎就会堆叠。
//   回归守卫：`test/cases-core.mjs`（建两次引擎，断言 SOURCES 不增长）。
const CORE_ORDER = [
  "05-version.js",             // 插件版本号（占位符，由本脚本注入）
  "10-config.js",              // 默认配置（DEFAULT_SETTINGS / REFRESH_OPTIONS）
  "20-source-core.js",         // **模块顶层**容器：SOURCES / registerSource
  "60-helpers.js",             // 共用纯函数（core 与 UI 都要用）
  "65-remind.js",              // 到期提醒判定（core 与宿主共用同一份源码 → lib/remind-core.mjs）
  "engine-head.js",            // createEngine 外壳：storage 读写 / listGames / getCached
  "21-fetcher-tables.js",      // **每引擎一份**的两张抓取器表
  "15-env.js",                 // core 环境注入缝
  "22-fetcher-core.js",        // 抓取公共设施
  "25-parser-shared.js",       // 共用判定与工具
  "30-game-hoyoverse.js",
  "30-game-kuro.js",
  "30-game-hypergryph.js",
  "30-game-bluearchive.js",
  "30-game-bandori.js",
  "30-game-bwiki.js",
  "30-game-biligame.js",
  "30-game-cygames.js",
  "30-game-perfectworld.js",
  "30-game-sunborn.js",
  "30-game-aniplex.js",
  "30-game-sega.js",
  "30-game-yostar.js",
  "30-game-bluepoch.js",
  "50-refresh.js",             // 刷新编排
  "engine-api.js",             // 注入 env + refresh() + 测试出口 + return
];

const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const read = (p) => fs.readFileSync(p, "utf8");

function fail(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

// —— 前置校验：src/client 的每个文件都必须被某个产物用到（防止加了文件忘了接线）——
// STYLE_CHUNK 是**生成段**（见 CSS_ORDER），不占磁盘文件名 ⇒ 从"必须存在"的那一侧去掉；
// 样式文件的缺失/孤儿由 checkStyleFiles 单独守（见下）。
const present = fs.readdirSync(SRC_CLIENT).filter((f) => f.endsWith(".js")).sort();
const used = new Set([...ORDER, ...CORE_ORDER].filter((f) => f !== STYLE_CHUNK));
const missing = [...used].filter((f) => !present.includes(f));
const unused = present.filter((f) => !used.has(f));
if (missing.length) fail(`src/client 缺少文件：${missing.join("、")}`);
if (unused.length) fail(`src/client 有文件未被任何产物使用（请加入 ORDER 或 CORE_ORDER）：${unused.join("、")}`);

// —— 客户端产物结构守卫：ORDER 的第一段必须是模块工厂壳（ORDER[0] === "00-head.js"）——
// 原因见 ORDER 定义处的注释：排在 00-head 之前的片段落在**经典脚本顶层**（全局词法作用域），
// 而 DSH 的 client-modules 会重新执行同一个包（HMR / invalidate 后走单资源 URL），
// 于是顶层 const/let 会被 V8 判为 "Identifier '…' has already been declared"，
// 整段脚本解析失败 ⇒ 插件静默掉线 + 控制台噪音。2026-10-17 实测复现。
if (ORDER[0] !== "00-head.js") {
  fail(`ORDER 的第一段必须是 00-head.js（模块工厂壳），当前是 ${ORDER[0]} —— 排在它之前的片段会落到经典脚本顶层，插件重载时会报 "already been declared"`);
}

// —— 编码/换行校验（历史教训：BOM 会让 DSH 启动直接失败）——
// 源文件约定：每个文件以"恰好一个换行"结尾、文件内不留尾部空行；**段与段之间的空行由本脚本插入**
// （`pieces.join("\n")`）——这样源文件干净（git diff --check 不会有 "new blank line at EOF"）。
function validateText(name, text, { requireTrailingNewline = true, forbidTrailingBlank = true } = {}) {
  if (text.charCodeAt(0) === 0xfeff) fail(`${name} 带 UTF-8 BOM（必须无 BOM）`);
  if (text.includes("\r")) fail(`${name} 含 CR（必须 LF 换行）`);
  if (requireTrailingNewline && !text.endsWith("\n")) fail(`${name} 末尾缺少换行`);
  if (forbidTrailingBlank && text.endsWith("\n\n")) fail(`${name} 末尾有多余空行（段间空行由 build.mjs 插入，源文件不要留）`);
}
function readChunks(order) {
  const out = [];
  for (const name of order) {
    if (name === STYLE_CHUNK) { out.push(styleChunk); continue; }
    const p = path.join(SRC_CLIENT, name);
    const text = read(p);
    validateText(name, text);
    out.push(text);
  }
  return out;
}

// —— 样式段：src/client/styles/*.css 按 CSS_ORDER 拼成原来的那个模板字符串 ——
// 生成结果与搬迁前的 `70-styles.js` **逐字节相同**（这点靠 lib/client.js 的 hash 不变来验收）：
//   "//#region styles\n" + "const STYLE = `" + "\n" + <各文件原文依次拼接> + "\n\n" + "`;\n" + "//#endregion\n"
// 那两行尾巴的来历：搬迁前模板字符串最后三行是「注释行 / 空行 / 空行」，收在最后一个文件之后，
// 所以留成生成侧的字面量（否则最后一个 .css 会以空行结尾，违反"源文件不留尾部空行"的约定）。
const SRC_STYLES = path.join(SRC_CLIENT, "styles");
function checkStyleFiles() {
  // 正向：清单里的每个文件都得在（缺一个 ⇒ 产物少一段 CSS，绝不能静默）
  const presentCss = fs.readdirSync(SRC_STYLES).filter((f) => f.endsWith(".css")).sort();
  const missingCss = CSS_ORDER.filter((f) => !presentCss.includes(f));
  if (missingCss.length) fail(`src/client/styles 缺少样式文件（CSS_ORDER 里有）：${missingCss.join("、")}`);
  // 反向：目录里的每个 .css 都得在清单里（加了文件忘了接线 ⇒ 样式静默不生效，与 JS 的 unused 同等严格）
  const orderSet = new Set(CSS_ORDER);
  const unusedCss = presentCss.filter((f) => !orderSet.has(f));
  if (unusedCss.length) fail(`src/client/styles 有样式文件未被 CSS_ORDER 使用：${unusedCss.join("、")}`);
  if (orderSet.size !== CSS_ORDER.length) fail(`CSS_ORDER 里有重复条目：${CSS_ORDER.join("、")}`);
}
function readStyleFiles() {
  checkStyleFiles();
  const out = [];
  for (const name of CSS_ORDER) {
    const p = path.join(SRC_STYLES, name);
    let text;
    try {
      text = read(p);
    } catch (e) {
      fail(`读取样式文件失败：src/client/styles/${name}（${e && e.code ? e.code : e}）`);
    }
    // 与 JS 段同一套编码约定（BOM / CR / 末尾换行 / 尾部空行）；出错时报上样式文件的相对路径
    validateText(`src/client/styles/${name}`, text);
    out.push(text);
  }
  return out;
}
const styleChunk = [
  "\t\t//#region styles",
  "\t\tconst STYLE = `" + "\n" + readStyleFiles().join("") + "\n\n`;",
  "\t\t//#endregion",
  ""
].join("\n");
const rootPkg = JSON.parse(read(path.join(ROOT, "package.json")));
// 插件版本注入：把 src/client/05-version.js 的占位符替换成根 package.json 的 version。
// 两个产物都注入（lib/client.js 与 packages/core/core.mjs），--check 走同一条路径 → 一致性校验照旧有效。
// 找不到占位符就大声失败：否则"改了 05-version.js 的名字/写法"会静默变成"版本永远是 __PLUGIN_VERSION__"，
// 而那正好会让"更新后自动刷新"每次都触发（或永不触发）。
const VERSION_TOKEN = "__PLUGIN_VERSION__";
if (!/^\d+\.\d+\.\d+/.test(String(rootPkg.version))) fail(`package.json 版本号不像 semver：${rootPkg.version}`);
function injectVersion(text, label) {
  if (!text.includes(VERSION_TOKEN)) fail(`${label} 里找不到版本占位符 ${VERSION_TOKEN}（05-version.js 被改动了？）`);
  return text.split(VERSION_TOKEN).join(rootPkg.version);
}
const clientBuilt = injectVersion(readChunks(ORDER).join("\n"), "lib/client.js");
// 宿主入口 src/index.js 会被逐字节复制成 lib/index.js（发布包的 main）——**同样必须校验编码**：
// 否则一个 BOM/CRLF 会原样进发布包，而 --check 两边一样脏仍报"一致"，什么提示都没有
const hostBuilt = read(SRC_HOST);
validateText("src/index.js", hostBuilt);

// —— core 纯净度守卫：core 产物里不得出现宿主 API ——
// core 要给浏览器扩展 / JavaScriptCore / ArkTS 复用，"零宿主依赖"这条不能只靠人记得
// （第 1 批修的 4 处裸 new Date() 就是这类问题，靠人肉审查才发现）。
// 允许默认实现的文件：15-env.js（coreEnv 的默认时钟/计时器）、engine-api.js（ENGINE_ENV 的默认 timer/now）。
// 先去掉注释再匹配：注释里会写"不得出现 window / 裸 fetch"这类说明文字，不剥会误报。
const CORE_DEFAULT_IMPL_OK = new Set(["15-env.js", "engine-api.js"]);
const CORE_FORBIDDEN = [
  [/\bwindow\s*[.[]/, "window"],
  [/\bdocument\s*[.[]/, "document"],
  [/\blocalStorage\b|\bsessionStorage\b/, "localStorage/sessionStorage"],
  [/(^|[^.\w$])fetch\s*\(/, "裸 fetch("],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bnew Date\(\s*\)/, "裸 new Date()（应走 nowMs()）"]
];
const CORE_FORBIDDEN_EXCEPT_DEFAULTS = [
  [/(^|[^.\w$])setTimeout\s*\(/, "裸 setTimeout(（应走 coreEnv.timer）"],
  [/(^|[^.\w$])clearTimeout\s*\(/, "裸 clearTimeout(（应走 coreEnv.timer）"],
  [/\bDate\.now\s*\(\)/, "裸 Date.now()（应走 nowMs()）"]
];
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/[^\n]*/g, "$1");
function assertCorePurity() {
  CORE_ORDER.forEach((name, i) => {
    const text = stripComments(coreChunks[i]);
    const isDefaultImpl = CORE_DEFAULT_IMPL_OK.has(name);
    for (const [re, label] of CORE_FORBIDDEN) {
      if (re.test(text)) fail(`core 纯净度：${name} 出现 ${label}（core 必须零宿主依赖）`);
    }
    if (isDefaultImpl) return;
    for (const [re, label] of CORE_FORBIDDEN_EXCEPT_DEFAULTS) {
      if (re.test(text)) fail(`core 纯净度：${name} 出现 ${label}（core 必须零宿主依赖）`);
    }
  });
}

// packages/core/core.mjs：把 createEngine 改成 ESM 导出（唯一一处变换，改不到就大声报错）
const ENGINE_DECL = "\t\tfunction createEngine(env) {";
const coreChunks = readChunks(CORE_ORDER).map((text) => {
  if (!text.includes(ENGINE_DECL)) return text;
  return text.replace(ENGINE_DECL, "export function createEngine(env) {");
});
if (!coreChunks.some((t) => t.includes("export function createEngine(env) {"))) {
  fail("未能把 createEngine 改成 ESM 导出（engine-head.js 里的函数声明写法变了？）");
}
assertCorePurity();
const coreBuilt = injectVersion(coreChunks.join("\n"), "packages/core/core.mjs");
// lib/remind-core.mjs：**原样**取 src/client/65-remind.js 的文本 + 尾部 export（见 OUT_REMIND 处说明）。
// 「原样」是关键：宿主 import 到的判定代码与面板/core 用的必须逐字节同一份。
const remindChunk = read(path.join(SRC_CLIENT, REMIND_CHUNK));
const missingRemindExports = REMIND_EXPORTS.filter(
  (name) => !new RegExp("(?:function|const|let)\\s+" + name + "\\b").test(remindChunk)
);
if (missingRemindExports.length) {
  fail(`${REMIND_CHUNK} 里找不到要 export 的符号：${missingRemindExports.join("、")}（改名了？同步 build.mjs 的 REMIND_EXPORTS）`);
}
const remindBuilt = remindChunk + [
  "// ── 出口：上面的代码与 lib/client.js / packages/core/core.mjs 里的是**同一份源码**",
  "// （" + REMIND_CHUNK + "，由 build.mjs 原样拼出，一字未改）。宿主 src/index.js 只 import 这里。",
  "export {",
  ...REMIND_EXPORTS.map((name, i) => "  " + name + (i === REMIND_EXPORTS.length - 1 ? "" : ",")),
  "};",
  ""
].join("\n");
validateText(OUT_REMIND, remindBuilt);
// core 包的 package.json：**由本脚本生成**，版本号跟随根包，避免两处手改漂移。
// （packages/core/README.md 是手写的，不在此生成；包名刻意中立，不含 dsh —— 扩展/原生平台要用它。）
const corePkgBuilt = JSON.stringify({
  name: "gacha-calendar-core",
  version: rootPkg.version,
  description: "二游活动/卡池排期抓取核心：28 款游戏的来源注册表 + 解析器 + 刷新编排 + 缓存降级。" +
    "零依赖、零宿主环境依赖，任何 JS 运行时（浏览器扩展 background / Tauri / JavaScriptCore / ArkTS 嵌入式引擎）都能跑。",
  type: "module",
  main: "./core.mjs",
  exports: {
    ".": "./core.mjs",
    "./package.json": "./package.json"
  },
  files: ["core.mjs", "README.md"],
  // 发布前自动校验产物与源码一致（否则可能发出"手改过/漂移"的包）
  scripts: { prepublishOnly: "node ../../build.mjs --check" },
  license: rootPkg.license,
  repository: { type: "git", url: "git+https://github.com/EastMG/dsh-gacha-calendar.git" },
  homepage: "https://github.com/EastMG/dsh-gacha-calendar",
  keywords: ["gacha", "calendar", "scraper", "anime-game", "dsh-plugin", "browser-extension"]
}, null, 2) + "\n";

const checkOnly = process.argv.includes("--check");
const same = (a, b) => a === b;

// 产物语法自检（免费且能挡住"拼接拼坏了"这类问题）。
// 用 stdio:"ignore" 而不是捕获输出：沙箱/受限环境下子进程管道会 EPERM，而这里只需要退出码。
function syntaxOk(file) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ── 跨文件顶层标识符重名守卫（2026-10-03）────────────────────────────────────
// 背景：`src/client/*.js` 是**按 ORDER 顺序原样拼接**成一个 IIFE 的，所有文件共享同一作用域。
// 因此两个文件声明同名顶层标识符就是**静默覆盖**（后者赢）—— 不一定报错，但行为莫名其妙。
// 历史事故：17 个新增来源解析器之间有 28 处模块级同名（plain / ENT_EXTRA / decodeExtra / cleanTitle /
// byNewestStart / eventsStellasora …）。它们此前靠生成器的 `ns_<域>_` 前缀隔离；2026-10-03 用户要求
// 「把 next-sources 合并进原 source，不留 next-source」压平后，**前缀仍在**（改名会伤及数百调用点），
// 这条不变量就成了新布局下真正需要守的东西 —— 本守卫即为此。
//
// 同一文件内部的重名不算（那是同一段代码的事，交给语法/var 提升语义），只查**跨文件**。
// 字符串与注释先剥掉，避免"名字只出现在文案里"造成误报。
function stripStringsAndComments(src) {
  let out = "", i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === "/" && c2 === "/") { while (i < n && src[i] !== "\n") { out += " "; i++; } continue; }
    if (c === "/" && c2 === "*") {
      out += "  "; i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { out += src[i] === "\n" ? "\n" : " "; i++; }
      if (i < n) { out += "  "; i += 2; }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; out += " "; i++;
      while (i < n) {
        if (src[i] === "\\") { out += "  "; i += 2; continue; }
        if (src[i] === q) { out += " "; i++; break; }
        out += src[i] === "\n" ? "\n" : " "; i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}
// 判定"哪些声明在**共享作用域**"（= 文件自身顶层）。
// ⚠️ 这个守卫改过三版，每版都被"看起来很稳"的静态分析坑过，记在这里免得再犯：
//   v1 用"行首无缩进"当判据 → 什么都查不到：整个插件体都缩进在模块工厂 IIFE 里，
//      所有源文件的顶层声明都是**缩进**的（实测：真存在同名 `pickCurrent` 却报「✓ 无」）。
//   v2 用大括号深度 → 也错：`stripStringsAndComments` 不处理**正则字面量**，
//      而代码里到处是 `/\w{1,8}/` 这类带花括号的正则 → 深度被永久带偏（实测报出 275 处假重名）。
//   v3（当前）用**每个文件自身的"基线缩进"**：一个文件的顶层语句共享同一个缩进量，
//      函数体内只会更深。取该文件所有非空非注释行的**最小缩进**作为基线，缩进恰等于基线的声明即顶层。
//      这对"整个文件都缩进 2 个 Tab"与"顶格"两种形态都成立，也不受正则/模板字面量影响。
const DECL_LINE = /^([ \t]*)(?:async\s+function|function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
function sharedScopeDecls(src) {
  const lines = src.split("\n");
  let base = null;
  for (const l of lines) {
    if (l.trim() === "" || l.trim().startsWith("//")) continue;
    const ind = l.length - l.trimStart().length;
    if (base === null || ind < base) base = ind;
  }
  // ⚠️ 必须返回**多重集**（数组），不能用 Set：同一文件内重名（const + function 同名）
  //    也会让产物直接语法错误，而 Set 会把它去重吃掉（实测踩过：真撞名却报「✓ 无」）。
  const out = [];
  for (const l of lines) {
    const ind = l.length - l.trimStart().length;
    if (ind !== base) continue;
    const m = DECL_LINE.exec(l);
    if (m) out.push(m[2]);
  }
  return out;
}
function topLevelCollisionProblems(order) {
  const seen = new Map();     // 标识符 → 首次出现的文件
  const problems = [];
  for (const file of order) {
    const p = path.join(SRC_CLIENT, file);
    if (!fs.existsSync(p)) continue;
    for (const name of sharedScopeDecls(read(p))) {
      if (seen.has(name)) {
        const prev = seen.get(name);
        problems.push(prev === file
          ? `${name}：${file} **同一文件内**重复声明（const/let 直接语法错误；function/var 会静默覆盖）`
          : `${name}：${prev} 与 ${file} 都在共享作用域声明了（后者会静默覆盖；const/let 还会直接语法错误）`);
      } else seen.set(name, file);
    }
  }
  return problems;
}
if (checkOnly) {
  const curClient = read(OUT_CLIENT);
  const curHost = read(OUT_HOST);
  const okClient = same(clientBuilt, curClient);
  const okHost = same(hostBuilt, curHost);
  console.log(`lib/client.js              ${okClient ? "一致" : "不一致"}  ${sha(clientBuilt).slice(0, 16)}`);
  console.log(`lib/index.js               ${okHost ? "一致" : "不一致"}  ${sha(hostBuilt).slice(0, 16)}`);
  // —— 版本号单列一行（与上面"逐字节一致"重复，但重复是**故意**的）——
  // 上面那两行只报"不一致"，而"不一致"最常见的成因就是**版本号变了但没重新 build**。
  // 版本号是产物里唯一来自文件外部的字面量（package.json → 占位符替换），值得单列。
  // ⚠️ 查的是**盘上的产物**（curClient / 盘上 core.mjs），不是 built 字符串 —— 后者永远正确，
  //    那样这一行就成了"永远 ✓ 的摆设"，测不出"有人手改了产物 / 忘了 build"。
  //   · 盘上产物里必须是 `const PLUGIN_VERSION = "<package.json 的 version>";`；
  //   · 且占位符必须已经被替换掉（残留 = 注入没跑，客户端会显示 "__PLUGIN_VERSION__"）。
  // 不一致 ⇒ 下面的 exit 1 照旧拉红（这条不是"仅供参考"的日志）。
  const versionDecl = 'const PLUGIN_VERSION = "' + rootPkg.version + '";';
  const curCore = fs.existsSync(OUT_CORE) ? read(OUT_CORE) : "";
  const okVersion = curClient.includes(versionDecl) && curCore.includes(versionDecl)
    && !curClient.includes(VERSION_TOKEN) && !curCore.includes(VERSION_TOKEN);
  console.log(`版本号注入                 ${okVersion ? "✓ " + rootPkg.version : "✗ 盘上产物不是 " + rootPkg.version + "（package.json 改了没重新 build？）"}`);
  // core 包两个文件 + 宿主复用模块由本脚本生成；**缺失即失败**
  //（旧实现只打印"不存在"仍 exit 0 → 删掉产物也能过守卫）
  let okCore = true;
  for (const [label, p, built] of [
    ["packages/core/core.mjs", OUT_CORE, coreBuilt],
    ["packages/core/package.json", OUT_CORE_PKG, corePkgBuilt],
    ["lib/remind-core.mjs", OUT_REMIND, remindBuilt]
  ]) {
    if (fs.existsSync(p)) {
      const ok = same(built, read(p));
      okCore = okCore && ok;
      console.log(`${label.padEnd(26)} ${ok ? "一致" : "不一致"}  ${sha(built).slice(0, 16)}`);
    } else {
      okCore = false;
      console.log(`${label.padEnd(26)} 不存在 —— 请跑 node build.mjs 生成`);
    }
  }
  // 类型声明在产物目录里且被 package.json 的 types/exports 指向：缺了就是"包看起来正常但类型引用是坏的"
  let okTypes = true;
  for (const rel of ["lib/types/index.d.ts", "lib/types/client/index.d.ts"]) {
    const exists = fs.existsSync(path.join(ROOT, rel));
    okTypes = okTypes && exists;
    console.log(`${rel.padEnd(26)} ${exists ? "存在" : "缺失（package.json 的 types 指向它）"}`);
  }
  // 语法自检
  let okSyntax = true;
  for (const rel of ["lib/client.js", "lib/index.js", "packages/core/core.mjs", "lib/remind-core.mjs"]) {
    const exists = fs.existsSync(path.join(ROOT, rel));
    const ok = exists && syntaxOk(path.join(ROOT, rel));
    okSyntax = okSyntax && ok;
    console.log(`${(rel + " 语法").padEnd(26)} ${ok ? "✓" : "✗ 语法检查失败"}`);
  }
  // 跨文件重名守卫（见 topLevelCollisionProblems 的说明）
  const nsProblems = topLevelCollisionProblems(ORDER);
  console.log(`跨文件重名${" ".repeat(10)} ${nsProblems.length === 0 ? "✓ 无" : `✗ ${nsProblems.length} 处`}`);
  for (const p of nsProblems.slice(0, 8)) console.log(`  - ${p}`);
  if (!okClient || !okHost || !okCore || !okTypes || !okSyntax || !okVersion || nsProblems.length > 0) {
    console.error("\n✗ 产物校验未通过 —— 要么忘了跑 build，要么有人直接改了产物（请改 src/ 后重新 build）");
    process.exit(1);
  }
  console.log("\n✓ src/ 与产物一致（含语法与类型声明）");
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUT_CLIENT), { recursive: true });
// 写盘前也要过跨文件重名守卫：宁可构建失败，也不让"静默覆盖"的产物落盘。
// （生成器侧已有同样的守卫；这里是第二道，防的是"生成器没重跑 / 有人手改生成物"。）
{
  const nsProblems = topLevelCollisionProblems(ORDER);
  if (nsProblems.length > 0) {
    console.error("✗ src/client 里有跨文件顶层重名（拼接后同一作用域，后者会静默覆盖前者）：");
    for (const p of nsProblems.slice(0, 12)) console.error(`  - ${p}`);
    console.error("  请给其中一个改个唯一名字（新增来源解析器沿用以 `ns_<域>_` 作前缀的约定）。\n");
    process.exit(1);
  }
}

fs.writeFileSync(OUT_CLIENT, clientBuilt, "utf8");
fs.writeFileSync(OUT_HOST, hostBuilt, "utf8");
fs.mkdirSync(path.dirname(OUT_CORE), { recursive: true });
fs.writeFileSync(OUT_CORE, coreBuilt, "utf8");
fs.writeFileSync(OUT_CORE_PKG, corePkgBuilt, "utf8");
fs.writeFileSync(OUT_REMIND, remindBuilt, "utf8");
console.log(`写出 lib/client.js               ${clientBuilt.length} 字符  sha256=${sha(clientBuilt).slice(0, 16)}`);
console.log(`写出 lib/index.js                ${hostBuilt.length} 字符  sha256=${sha(hostBuilt).slice(0, 16)}`);
console.log(`写出 lib/remind-core.mjs         ${remindBuilt.length} 字符  sha256=${sha(remindBuilt).slice(0, 16)}`);
console.log(`写出 packages/core/core.mjs      ${coreBuilt.length} 字符  sha256=${sha(coreBuilt).slice(0, 16)}`);
console.log(`写出 packages/core/package.json  ${corePkgBuilt.length} 字符  (gacha-calendar-core@${rootPkg.version})`);
// 版本号是"从文件外部注入"的唯一字面量（设置页标题行会显示它），写盘时单列一行，便于对账。
console.log(`插件版本                         ${rootPkg.version}（已注入 lib/client.js 与 packages/core/core.mjs）`);
