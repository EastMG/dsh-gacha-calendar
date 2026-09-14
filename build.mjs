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

// 拼接顺序（= 原产物的 //#region 顺序，改了这里就等于改了产物结构）
const ORDER = [
  "00-head.js",        // DSH 模块加载壳 + react require
  "10-config.js",      // 配置常量
  "20-sources.js",     // SOURCES 来源注册表（11 款游戏 / 25 个来源）
  "30-parsers.js",     // 全部解析器（纯函数）
  "40-fetchers.js",    // 抓取器 + 两个来源注册表（GACHA_FETCHERS / EVENT_FETCHERS）
  "50-refresh.js",     // 刷新编排、失败沿用旧值、提示归类
  "60-helpers.js",     // 格式化 / 悬停 / 排序等 helpers
  "70-styles.js",      // 样式
  "80-components.js",  // React 组件（面板 + 设置页）
  "90-plugin.js",      // apply(ctx)：slots / settingsScope / 悬停 marquee
  "99-tail.js"         // exports.apply / exports.inject / return
];

const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const read = (p) => fs.readFileSync(p, "utf8");

function fail(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

// —— 前置校验：src/client 的文件集合必须与 ORDER 完全一致（防止加了文件忘了排序）——
const present = fs.readdirSync(SRC_CLIENT).filter((f) => f.endsWith(".js")).sort();
const missing = ORDER.filter((f) => !present.includes(f));
const extra = present.filter((f) => !ORDER.includes(f));
if (missing.length) fail(`src/client 缺少文件：${missing.join("、")}`);
if (extra.length) fail(`src/client 有多余文件（未列入 ORDER）：${extra.join("、")}`);

// —— 逐段读取并校验编码/换行（历史教训：BOM 会让 DSH 启动直接失败）——
// 源文件约定：每个文件以"恰好一个换行"结尾、文件内不留尾部空行；**段与段之间的空行由本脚本插入**
// （`pieces.join("\n")`）——这样源文件干净（git diff --check 不会有 "new blank line at EOF"），
// 产物又与迁移前逐字节一致。段的来源见上面 ORDER 的注释。
const pieces = [];
for (const name of ORDER) {
  const p = path.join(SRC_CLIENT, name);
  const text = read(p);
  if (text.charCodeAt(0) === 0xfeff) fail(`${name} 带 UTF-8 BOM（必须无 BOM）`);
  if (text.includes("\r")) fail(`${name} 含 CR（必须 LF 换行）`);
  if (!text.endsWith("\n")) fail(`${name} 末尾缺少换行`);
  if (text.endsWith("\n\n")) fail(`${name} 末尾有多余空行（段间空行由 build.mjs 插入，源文件不要留）`);
  pieces.push(text);
}
const clientBuilt = pieces.join("\n");
const hostBuilt = read(SRC_HOST);

const checkOnly = process.argv.includes("--check");
const same = (a, b) => a === b;

if (checkOnly) {
  const curClient = read(OUT_CLIENT);
  const curHost = read(OUT_HOST);
  const okClient = same(clientBuilt, curClient);
  const okHost = same(hostBuilt, curHost);
  console.log(`lib/client.js  ${okClient ? "一致" : "不一致"}  ${sha(clientBuilt).slice(0, 16)}`);
  console.log(`lib/index.js   ${okHost ? "一致" : "不一致"}  ${sha(hostBuilt).slice(0, 16)}`);
  if (!okClient || !okHost) {
    console.error("\n✗ src/ 与 lib/ 产物不一致 —— 要么忘了跑 build，要么有人直接改了 lib/（请改 src/ 后重新 build）");
    process.exit(1);
  }
  console.log("\n✓ src/ 与 lib/ 产物一致");
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUT_CLIENT), { recursive: true });
fs.writeFileSync(OUT_CLIENT, clientBuilt, "utf8");
fs.writeFileSync(OUT_HOST, hostBuilt, "utf8");
console.log(`写出 lib/client.js  ${clientBuilt.length} 字符  sha256=${sha(clientBuilt).slice(0, 16)}`);
console.log(`写出 lib/index.js   ${hostBuilt.length} 字符  sha256=${sha(hostBuilt).slice(0, 16)}`);
