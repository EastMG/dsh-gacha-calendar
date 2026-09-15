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

// —— 逐段读取并校验编码/换行（历史教训：BOM 会让 DSH 启动直接失败）——
// 源文件约定：每个文件以"恰好一个换行"结尾、文件内不留尾部空行；**段与段之间的空行由本脚本插入**
// （`pieces.join("\n")`）——这样源文件干净（git diff --check 不会有 "new blank line at EOF"）。
function readChunks(order) {
  const out = [];
  for (const name of order) {
    const p = path.join(SRC_CLIENT, name);
    const text = read(p);
    if (text.charCodeAt(0) === 0xfeff) fail(`${name} 带 UTF-8 BOM（必须无 BOM）`);
    if (text.includes("\r")) fail(`${name} 含 CR（必须 LF 换行）`);
    if (!text.endsWith("\n")) fail(`${name} 末尾缺少换行`);
    if (text.endsWith("\n\n")) fail(`${name} 末尾有多余空行（段间空行由 build.mjs 插入，源文件不要留）`);
    out.push(text);
  }
  return out;
}
const clientBuilt = readChunks(ORDER).join("\n");
const hostBuilt = read(SRC_HOST);

// packages/core/core.mjs：把 createEngine 改成 ESM 导出（唯一一处变换，改不到就大声报错）
const ENGINE_DECL = "\t\tfunction createEngine(env) {";
const coreChunks = readChunks(CORE_ORDER).map((text) => {
  if (!text.includes(ENGINE_DECL)) return text;
  return text.replace(ENGINE_DECL, "export function createEngine(env) {");
});
if (!coreChunks.some((t) => t.includes("export function createEngine(env) {"))) {
  fail("未能把 createEngine 改成 ESM 导出（engine-head.js 里的函数声明写法变了？）");
}
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
  license: rootPkg.license,
  repository: { type: "git", url: "git+https://github.com/EastMG/dsh-gacha-calendar.git" },
  homepage: "https://github.com/EastMG/dsh-gacha-calendar",
  keywords: ["gacha", "calendar", "scraper", "anime-game", "dsh-plugin", "browser-extension"]
}, null, 2) + "\n";

const checkOnly = process.argv.includes("--check");
const same = (a, b) => a === b;

if (checkOnly) {
  const curClient = read(OUT_CLIENT);
  const curHost = read(OUT_HOST);
  const okClient = same(clientBuilt, curClient);
  const okHost = same(hostBuilt, curHost);
  console.log(`lib/client.js              ${okClient ? "一致" : "不一致"}  ${sha(clientBuilt).slice(0, 16)}`);
  console.log(`lib/index.js               ${okHost ? "一致" : "不一致"}  ${sha(hostBuilt).slice(0, 16)}`);
  // core 包两个文件由本脚本生成；缺失只提示（新克隆还没 build 时不算错），存在则必须一致
  let okCore = true;
  for (const [label, p, built] of [["packages/core/core.mjs", OUT_CORE, coreBuilt], ["packages/core/package.json", OUT_CORE_PKG, corePkgBuilt]]) {
    if (fs.existsSync(p)) {
      const ok = same(built, read(p));
      okCore = okCore && ok;
      console.log(`${label.padEnd(26)} ${ok ? "一致" : "不一致"}  ${sha(built).slice(0, 16)}`);
    } else {
      console.log(`${label.padEnd(26)} 不存在（可跑 node build.mjs 生成）`);
    }
  }
  if (!okClient || !okHost || !okCore) {
    console.error("\n✗ src/ 与产物不一致 —— 要么忘了跑 build，要么有人直接改了产物（请改 src/ 后重新 build）");
    process.exit(1);
  }
  console.log("\n✓ src/ 与产物一致");
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
