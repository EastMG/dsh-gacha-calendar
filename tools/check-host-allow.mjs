// tools/check-host-allow.mjs —— 「来源域名 vs 代理白名单」守卫（**受版本控制**的正式副本）
//
// ── 为什么需要它 ──
// 真实事故（2026-10-03 发现）：面板上 **女神异闻录：夜幕魅影 / 少女前线2：追放 / Fate/Grand Order**
// 长期空白，失败原因写 `HTTP 403`。根因是它们用的域名
//     p5x.wanmei.com / gf2-web-preregister-api.sunborngame.com / fgo.wiki
// **从未登记**进宿主 `PROXY_ALLOW_HOSTS` → 代理直接回
//     `403 { error: "cross-site-not-allowed" }`
// 源站本身完全正常（服务端实测 200）。`bestdori.com`（BanG Dream 备选源）同病 ——
// 不登记的话，用户在设置里一切到它就 403，属于"选项看着能用、实际不能用"。
//
// ── 为什么能瞒这么久 ──
//   · 离线夹具测试走 `useFixtures` 注入的 fetch，**完全绕过宿主代理**；
//   · 手工"直连源站"的验证同样绕过代理；
//   · 于是"解析器对、域名没登记"这个组合可以长期静默，只有真人在面板上才看得出来。
//
// ── 本脚本做什么 ──
// 遍历**全部真实抓取目标**（`url` / `eventUrl` / `altSources[].url` / `eventAltSources[].url`），
// 与 `src/index.js` 的 `PROXY_ALLOW_HOSTS` 逐一比对。新增来源忘了登记域名 → 这里立刻红。
//
// 例外：直连源（`mode="direct"`，实测有 ACAO，浏览器可直连）不需要白名单，见 DIRECT_HOSTS。
//      新增 direct 源时必须同步更新该清单，否则会被本脚本误报。
//
// 用法：node tools/check-host-allow.mjs        （退出码 0 = 全绿）

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let pass = 0, fail = 0;
function check(name, ok, detail) {
	if (ok) { pass++; console.log(`  \u2713 ${name}`); }
	else { fail++; console.log(`  \u2717 ${name}${detail ? "  -> " + detail : ""}`); }
}

// ── 载入插件 client，取 SOURCES ──
const clientPath = path.join(ROOT, "lib", "client.js");
const src = fs.readFileSync(clientPath, "utf8");
const instrumented = src.replace(
	"\t\texports.apply = apply;",
	"\t\texports.__test = { SOURCES };\n\t\texports.apply = apply;"
);
if (instrumented === src) {
	console.log("  ✗ 插桩失败：lib/client.js 里找不到 `exports.apply = apply;`（构建产物结构变了？）");
	process.exit(1);
}
let factory = null;
globalThis.window = {
	__ModuleLoader__: { load: (m) => { factory = m.factory; } },
	setTimeout, clearTimeout, setInterval, clearInterval,
	location: { origin: "http://dsh.local" },
	localStorage: { getItem: () => null, setItem: () => {} },
	matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
};
globalThis.document = {
	head: { appendChild: () => {} },
	body: { appendChild: () => {} },
	createElement: () => ({ style: {}, appendChild: () => {} }),
	addEventListener: () => {}, removeEventListener: () => {},
	querySelector: () => null, querySelectorAll: () => []
};
new Function("module", "exports", "window", "document", instrumented)(
	{ exports: {} }, {}, globalThis.window, globalThis.document
);
const { SOURCES } = factory(() => ({})).__test;

// ── 读白名单 ──
// ⚠️ 必须先剥注释再抽字符串：注释里的 `"..."`（如 `{"response_code":102}`）会被朴素正则
//    当成白名单项 —— 本会话早先就因此**误判**白名单含 `code`/`data`/`total_count` 等垃圾项。
const idxSrc = fs.readFileSync(path.join(ROOT, "src", "index.js"), "utf8");
const m = /const PROXY_ALLOW_HOSTS = \[([\s\S]*?)\n\];/.exec(idxSrc);
if (!m) { console.log("  ✗ 未找到 PROXY_ALLOW_HOSTS"); process.exit(1); }
const stripComments = (s) => s
	.replace(/\/\*[\s\S]*?\*\//g, " ")
	.replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");   // 避开 http:// 里的 //
const ALLOW = [...stripComments(m[1]).matchAll(/"([^"]*)"/g)].map((x) => x[1]).filter(Boolean);
const hostAllowed = (h) => ALLOW.some((a) => h === a || h.endsWith("." + a));

// ── 直连源（不需要白名单；实测 ACAO 放行）──
// 与 next-sources/test/all.mjs 的 direct 模式守卫清单保持一致。
const DIRECT_HOSTS = ["api.umapyoi.net", "sekai-world.github.io", "bang-dream-on.bushimo.jp"];

// ── 收集全部真实抓取目标 ──
const targets = new Map();   // host → Set("条目id:用途")
for (const s of SOURCES) {
	const put = (u, what) => {
		if (!u) return;
		let h; try { h = new URL(u).hostname; } catch { return; }
		if (!targets.has(h)) targets.set(h, new Set());
		targets.get(h).add(`${s.id}:${what}`);
	};
	put(s.url, "主-卡池");
	put(s.eventUrl, "主-活动");
	for (const a of s.altSources || []) put(a.url, "备选-卡池");
	for (const a of s.eventAltSources || []) put(a.url, "备选-活动");
}

console.log(`\n=== 来源域名 vs 代理白名单（${targets.size} 个目标域名 / 白名单 ${ALLOW.length} 项）===`);

const missing = [...targets.keys()]
	.filter((h) => !hostAllowed(h) && !DIRECT_HOSTS.includes(h))
	.sort();
for (const h of missing) {
	check(`域名已登记白名单: ${h}`, false, `用它的条目 → ${[...targets.get(h)].join("  ")}`);
}
check(
	`全部 ${targets.size} 个抓取目标域名都已登记（或属 direct 直连）`,
	missing.length === 0,
	missing.length ? `缺 ${missing.length} 个：${missing.join(", ")}` : ""
);

// ── 反向检查：白名单里对不上任何来源的项（可能是笔误）──
// 历史遗留项（早期来源已改走别的域名）列入 KNOWN_EXTRA，只报告不判失败，避免噪音。
const KNOWN_EXTRA = new Set([
	"endfield.hypergryph.com", "api-cdn.gamekee.com", "game.xiaomi.com",
	"aki-gm-resources-back-huoshan.aki-game.com", "aki-gm-resources.aki-game.com"
]);
const unused = ALLOW.filter((a) =>
	!KNOWN_EXTRA.has(a) && ![...targets.keys()].some((h) => h === a || h.endsWith("." + a)));
check(
	"白名单里没有对不上任何来源的陌生域名（可能是笔误）",
	unused.length === 0,
	unused.length ? `未使用也未在已知清单里：${unused.join(", ")}` : ""
);

// ── 事故回归守卫：这 4 个域名必须一直在（否则 2026-10-03 的空白事故复现）──
for (const h of ["p5x.wanmei.com", "gf2-web-preregister-api.sunborngame.com", "fgo.wiki", "bestdori.com"]) {
	check(`事故回归守卫: ${h} 仍在白名单`, hostAllowed(h));
}

// ── hostAllowed 语义自检（与宿主实现同义）──
check("hostAllowed: 精确匹配", hostAllowed("fgo.wiki"));
check("hostAllowed: 子域匹配", hostAllowed("wiki.biligame.com"));
check("hostAllowed: 不放行无关域", !hostAllowed("evil.example.com"));
check("hostAllowed: 不做后缀拼接误判（notfgo.wiki 不该放行）", !hostAllowed("notfgo.wiki"));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
