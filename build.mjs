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

// 拼接顺序（= 原产物的 //#region 顺序，改了这里就等于改了产物结构）
const ORDER = [
  "00-head.js",        // DSH 模块加载壳 + react require
  "10-config.js",      // 配置常量
  "15-env.js",         // core 环境注入缝（transport / now / 计时器）
  "20-sources.js",     // SOURCES 来源注册表（11 款游戏 / 25 个来源）
  "30-parsers.js",     // 全部解析器（纯函数）
  "40-fetchers.js",    // 抓取器 + 两个来源注册表（GACHA_FETCHERS / EVENT_FETCHERS）
  "50-refresh.js",     // 刷新编排、失败沿用旧值
  "60-helpers.js",     // 共用纯函数：状态归一 / 提示文案 / 格式化 / 悬停 / 排序
  "engine-head.js",    // core 引擎外壳：createEngine（面板只通过它拿 Result JSON）
  "engine-api.js",     // 引擎 API：refresh() / 测试出口 / return
  "70-styles.js",      // 样式
  "80-components.js",  // React 组件（面板 + 设置页）
  "90-plugin.js",      // apply(ctx)：slots / settingsScope / 悬停 marquee
  "92-dsh-env.js",     // DSH 环境适配：注入 transport（直连 + 宿主代理）
  "99-tail.js"         // exports.apply / exports.inject / return
];

// 第二个产物：dist/core.mjs —— 独立、零依赖的 ESM 模块，供浏览器扩展 / Windows / 原生平台 import。
// 组装方式：共用部分（配置 / 来源表 / helpers）放模块顶层；core 主体（15/30/40/50 + 引擎外壳）
// 包进 `export function createEngine(env) { … }` —— 同一个函数体，与 DSH 产物同源。
// 注：engine-head.js 里那一行 `function createEngine(env) {` 会被加上 `export ` 前缀（见下）。
const CORE_ORDER = [
  "10-config.js",      // 默认配置（DEFAULT_SETTINGS / REFRESH_OPTIONS）
  "20-sources.js",     // SOURCES 来源注册表
  "60-helpers.js",     // 共用纯函数（core 与 UI 都要用）
  "engine-head.js",    // createEngine 外壳：storage 读写 / listGames / getCached
  "15-env.js",         // core 环境注入缝
  "30-parsers.js",     // 解析器
  "40-fetchers.js",    // 抓取器 + 来源注册表
  "50-refresh.js",     // 刷新编排
  "engine-api.js"      // 注入 env + refresh() + 测试出口 + return
];

const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const read = (p) => fs.readFileSync(p, "utf8");

function fail(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

// —— 前置校验：src/client 的每个文件都必须被某个产物用到（防止加了文件忘了接线）——
const present = fs.readdirSync(SRC_CLIENT).filter((f) => f.endsWith(".js")).sort();
const used = new Set([...ORDER, ...CORE_ORDER]);
const missing = [...used].filter((f) => !present.includes(f));
const unused = present.filter((f) => !used.has(f));
if (missing.length) fail(`src/client 缺少文件：${missing.join("、")}`);
if (unused.length) fail(`src/client 有文件未被任何产物使用（请加入 ORDER 或 CORE_ORDER）：${unused.join("、")}`);

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
    const p = path.join(SRC_CLIENT, name);
    const text = read(p);
    validateText(name, text);
    out.push(text);
  }
  return out;
}
const clientBuilt = readChunks(ORDER).join("\n");
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
const coreBuilt = coreChunks.join("\n");
// core 包的 package.json：**由本脚本生成**，版本号跟随根包，避免两处手改漂移。
// （packages/core/README.md 是手写的，不在此生成；包名刻意中立，不含 dsh —— 扩展/原生平台要用它。）
const rootPkg = JSON.parse(read(path.join(ROOT, "package.json")));
const corePkgBuilt = JSON.stringify({
  name: "gacha-calendar-core",
  version: rootPkg.version,
  description: "二游活动/卡池排期抓取核心：11 款游戏的来源注册表 + 解析器 + 刷新编排 + 缓存降级。" +
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

if (checkOnly) {
  const curClient = read(OUT_CLIENT);
  const curHost = read(OUT_HOST);
  const okClient = same(clientBuilt, curClient);
  const okHost = same(hostBuilt, curHost);
  console.log(`lib/client.js              ${okClient ? "一致" : "不一致"}  ${sha(clientBuilt).slice(0, 16)}`);
  console.log(`lib/index.js               ${okHost ? "一致" : "不一致"}  ${sha(hostBuilt).slice(0, 16)}`);
  // core 包两个文件由本脚本生成；**缺失即失败**（旧实现只打印"不存在"仍 exit 0 → 删掉产物也能过守卫）
  let okCore = true;
  for (const [label, p, built] of [["packages/core/core.mjs", OUT_CORE, coreBuilt], ["packages/core/package.json", OUT_CORE_PKG, corePkgBuilt]]) {
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
  for (const rel of ["lib/client.js", "lib/index.js", "packages/core/core.mjs"]) {
    const exists = fs.existsSync(path.join(ROOT, rel));
    const ok = exists && syntaxOk(path.join(ROOT, rel));
    okSyntax = okSyntax && ok;
    console.log(`${(rel + " 语法").padEnd(26)} ${ok ? "✓" : "✗ 语法检查失败"}`);
  }
  if (!okClient || !okHost || !okCore || !okTypes || !okSyntax) {
    console.error("\n✗ 产物校验未通过 —— 要么忘了跑 build，要么有人直接改了产物（请改 src/ 后重新 build）");
    process.exit(1);
  }
  console.log("\n✓ src/ 与产物一致（含语法与类型声明）");
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUT_CLIENT), { recursive: true });
fs.writeFileSync(OUT_CLIENT, clientBuilt, "utf8");
fs.writeFileSync(OUT_HOST, hostBuilt, "utf8");
fs.mkdirSync(path.dirname(OUT_CORE), { recursive: true });
fs.writeFileSync(OUT_CORE, coreBuilt, "utf8");
fs.writeFileSync(OUT_CORE_PKG, corePkgBuilt, "utf8");
console.log(`写出 lib/client.js               ${clientBuilt.length} 字符  sha256=${sha(clientBuilt).slice(0, 16)}`);
console.log(`写出 lib/index.js                ${hostBuilt.length} 字符  sha256=${sha(hostBuilt).slice(0, 16)}`);
console.log(`写出 packages/core/core.mjs      ${coreBuilt.length} 字符  sha256=${sha(coreBuilt).slice(0, 16)}`);
console.log(`写出 packages/core/package.json  ${corePkgBuilt.length} 字符  (gacha-calendar-core@${rootPkg.version})`);
