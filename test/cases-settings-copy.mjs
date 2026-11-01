// test/cases-settings-copy.mjs —— 设置页 8 处 `title` 文案定稿守卫（2026-11-01 用户逐条指令）
//
// ── 这文件守什么 ──
// 用户当轮逐条点名改了 `src/client/84-settings-page.js` 里的 8 个 `title`（**只这 8 处**）：
//
//   ① 通知身份「启用/移除」按钮   ：…会在开始菜单建一条无害的快捷方式（可随时移除）
//                                  → …**需要在开始菜单新建快捷方式**
//   ② 「发送测试通知」按钮        ：**整条 title 删掉**（按钮文案已自解释）
//   ③ 「名称」输入框的 label      ：…应用名（最多 40 字；文件名非法字符会被去掉）→ **应用名称**
//   ④ 「当前：…」状态 span        ：…当前显示的应用名 → …当前应用名称
//   ⑤ 「按钮轮播」那一行 div      ：有卡池或活动在 **N 小时内结束或开始时** → **即将结束时**
//   ⑥ 「搜游戏名」输入框          ：**整条 title 删掉**（`aria-label="按游戏名搜索"` 保留）
//   ⑦ 版本号 span                 ：**整条 title 删掉**（`.gacha-cal-version` 只显示 vX.Y.Z）
//   ⑧ 「上次自检 X 前」span       ：三元两个分支都去掉括号里那句「（与面板刷新的时间无关）」
//
// 为什么单独成段：这 8 条文案散在「通知身份 / 轮播 / 搜索 / 版本号 / 健康」五个特性里，
// 但它们是**同一份产品文案合同**；改回去、或者删 title 时手一抖留下 `title: ""`，都该在这里红。
//
// 三条铁律：
//   ① **反向守卫**：8 条旧字符串在**生产代码**（`src/` 全部 .js）与**产物**（`lib/client.js`）里都不许再出现；
//   ② **正向守卫**：5 条新字符串**逐字**存在，而且确实挂在**对应的那个控件**上（只查"文件里有这句话"太弱）；
//   ③ **删除型守卫**：②⑥⑦ 的 title 是从**该控件附近的源码切片**里消失的 —— 不是从别处挪走的。
//
// ⚠️ 段数守卫：本文件是 `test/all.mjs` 的第 26 段（README_Dev.md / test/README.md 的「N 段」跟着它走）。

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { check, section } from "./harness.mjs";
import { REPO, readComponentsSource } from "./load.mjs";

const LIB_CLIENT = path.join(REPO, "lib", "client.js");

/** 递归收集 src/ 下的全部 .js（生产代码 = 源的唯一真源；样式/夹具不在其中）。 */
function collectSourceFiles(dir, acc) {
	for (const name of readdirSync(dir)) {
		const full = path.join(dir, name);
		if (statSync(full).isDirectory()) collectSourceFiles(full, acc);
		else if (name.endsWith(".js")) acc.push([path.relative(REPO, full), readFileSync(full, "utf8")]);
	}
	return acc;
}

// ── 8 条**旧**文案（改前逐字；反向守卫用）────────────────────────────────────
const OLD_COPY = [
	["① 通知身份按钮", "更改系统通知的发送者：会在开始菜单建一条无害的快捷方式（可随时移除）"],
	["② 发送测试通知按钮", "立刻弹一条系统通知，确认通知链路通不通"],
	["③ 名称输入框", "通知横幅顶部的应用名（最多 40 字；文件名非法字符会被去掉）"],
	["④ 当前状态 span", "系统通知横幅顶部当前显示的应用名"],
	["⑤ 按钮轮播行", "有卡池或活动在 N 小时内结束或开始时，侧栏按钮轮播显示"],
	["⑥ 搜游戏名输入框", "按游戏名过滤（大小写 / 全半角不敏感；空格分隔 = 每个词都要命中）"],
	["⑦ 版本号 span", "插件版本（与 package.json 的 version 一致）"],
	["⑧ 上次自检 span", "上次「立即检查」的时间（与面板刷新的时间无关）"]
];

// ── 5 条**新**文案（改后逐字；②⑥⑦ 是"整条删掉"，没有新文案）────────────────
const NEW_COPY = [
	["① 通知身份按钮", "更改系统通知的发送者：需要在开始菜单新建快捷方式"],
	["③ 名称输入框", "通知横幅顶部的应用名称"],
	["④ 当前状态 span", "系统通知横幅顶部当前应用名称"],
	["⑤ 按钮轮播行", "有卡池或活动在即将结束时，侧栏按钮轮播显示"],
	["⑧ 上次自检 span", "上次「立即检查」的时间"]
];

/** `title:` 属性（含 JSX 里写成 `title: "…"` 的形态）。 */
const TITLE_PROP = /\btitle\s*:/;

export default function runSettingsCopy() {
	section("设置页 title 文案（8 处定稿：5 条改写 + 3 条删除）");

	const comp = readComponentsSource();
	const lib = readFileSync(LIB_CLIENT, "utf8");
	const sources = collectSourceFiles(path.join(REPO, "src"), []);

	// ── 0) 切片锚点先定位，否则后面的"附近没有 title"会假绿 ──────────────────────
	// 三个**删除型**控件（②⑥⑦）各截一段对象字面量的源码切片；一处找不到就说明控件被重写了。
	const SLICES = {
		testBtn: /\(0, react_jsx_runtime\.jsx\)\("button", \{[\s\S]{0,600}?onClick: sendTestNotify,[\s\S]{0,200}?children: notifyTestBusy \? "发送中…" : "发送测试通知"/.exec(comp),
		searchInput: /className: "gacha-cal-set-find-in",[\s\S]{0,600}?onKeyDown: \(e\) => \{ if \(e\.key === "Escape"\)/.exec(comp),
		versionSpan: /\(0, react_jsx_runtime\.jsx\)\("span", \{ className: "gacha-cal-version",[^}]*\}/.exec(comp)
	};
	const missingAnchor = Object.keys(SLICES).filter((k) => !SLICES[k]);
	check("三个删除型控件都能定位到源码切片（守卫自身没瞎）", missingAnchor.length === 0,
		"没定位到：" + missingAnchor.join(", "));

	// ── 1) 反向：8 条旧字符串在 src/ 与 lib/client.js 里都不许再出现 ─────────────
	// 为什么连 src/ 全量扫：文案可能被顺手"抄"到别的段（比如宿主侧说明），只查设置页会漏。
	for (const [label, old] of OLD_COPY) {
		const inSrc = sources.filter(([, text]) => text.includes(old)).map(([f]) => f);
		const inLib = lib.includes(old);
		check(`${label}：旧文案不在生产代码里（src/ 与 lib/client.js）`,
			inSrc.length === 0 && !inLib,
			JSON.stringify({ src: inSrc, lib: inLib }));
	}

	// ── 2) 正向：5 条新字符串逐字存在（src + 产物都要，否则就是忘了 build）────────
	for (const [label, next] of NEW_COPY) {
		check(`${label}：新文案逐字存在（生产代码 + 产物）`,
			comp.includes(next) && lib.includes(next));
	}
	// ⑧ 是三元：两个分支都要在（前一支去掉括号里那句、后一支原样保留）
	check("⑧ 三元两个分支都在：`上次「立即检查」的时间` / `还没有跑过「立即检查」`",
		/title: healthCheckedAt > 0 \? "上次「立即检查」的时间" : "还没有跑过「立即检查」"/.test(comp)
		&& /title: healthCheckedAt > 0 \? "上次「立即检查」的时间" : "还没有跑过「立即检查」"/.test(lib));

	// ── 3) 正向（上下文）：新文案确实挂在**那个控件**上，不是随便哪儿的一句 ────────
	// 判据：以该文案为中心取一段源码，那段里必须同时出现该控件的**专属**标识。
	const AROUND = (needle, before, after) => {
		const at = comp.indexOf(needle);
		return at < 0 ? "" : comp.slice(Math.max(0, at - before), at + needle.length + after);
	};
	{
		const s = AROUND("title: \"更改系统通知的发送者：需要在开始菜单新建快捷方式\"", 400, 400);
		check("① 新 title 挂在通知身份「启用/移除」按钮上（同一段里有 toggleNotifyIdentity + 启用/移除文案）",
			s.includes("toggleNotifyIdentity") && s.includes('? "移除" : "启用"'));
	}
	{
		const s = AROUND("title: \"通知横幅顶部的应用名称\"", 200, 700);
		check("③ 新 title 挂在「名称」那个 label 上（同一段里有「名称」+ aria-label=通知身份名称）",
			s.includes('children: "名称"') && s.includes('"aria-label": "通知身份名称"'));
	}
	{
		const s = AROUND("title: \"系统通知横幅顶部当前应用名称\"", 300, 700);
		check("④ 新 title 挂在「当前：…」状态 span 上（同一段里有「当前：」+ PowerShell（默认）兜底）",
			s.includes('children: "当前："') && s.includes("PowerShell（默认）"));
	}
	{
		const s = AROUND("title: \"有卡池或活动在即将结束时，侧栏按钮轮播显示\"", 500, 900);
		check("⑤ 新 title 挂在「按钮轮播」那一行（同一段里有 tickerOn + 轮播范围 + tickerHours）",
			s.includes("tickerOn") && s.includes("轮播范围") && s.includes('commit("tickerHours"'));
	}
	{
		const s = AROUND("title: healthCheckedAt > 0 ? \"上次「立即检查」的时间\"", 400, 400);
		check("⑧ 新 title 挂在 .gacha-cal-health-checked 那个 span 上（同一段里有 healthCheckedText）",
			s.includes('className: "gacha-cal-health-checked"') && s.includes("children: healthCheckedText"));
	}

	// ── 4) 删除型：②⑥⑦ 那三个控件的切片里**没有 title**，且各自的要件还在 ────────
	{
		const slice = SLICES.testBtn ? SLICES.testBtn[0] : "";
		check("②「发送测试通知」按钮的 title 整条删掉（按钮对象切片里没有 title:）",
			slice.length > 0 && !TITLE_PROP.test(slice), slice.slice(0, 120));
		check("②「发送测试通知」按钮本身没被改坏（仍是 sendTestNotify + 「发送测试通知」文案）",
			slice.includes("disabled: notifyTestBusy") && slice.includes('"发送测试通知"'));
	}
	{
		const slice = SLICES.searchInput ? SLICES.searchInput[0] : "";
		check("⑥「搜游戏名」输入框的 title 整条删掉（input 对象切片里没有 title:）",
			slice.length > 0 && !TITLE_PROP.test(slice), slice.slice(0, 120));
		check("⑥ aria-label=\"按游戏名搜索\" 保留、placeholder/筛选行为不变",
			slice.includes('"aria-label": "按游戏名搜索"') && slice.includes('placeholder: "搜游戏名"')
			&& slice.includes("setGameQuery(e.target.value)"));
	}
	{
		const slice = SLICES.versionSpan ? SLICES.versionSpan[0] : "";
		check("⑦ 版本号 span 的 title 整条删掉（span 对象切片里没有 title:）",
			slice.length > 0 && !TITLE_PROP.test(slice), slice.slice(0, 120));
		check("⑦ 版本号仍然由 PLUGIN_VERSION 拼（`children: \"v\" + PLUGIN_VERSION`）",
			slice.includes('className: "gacha-cal-version"') && slice.includes('children: "v" + PLUGIN_VERSION'));
	}

	// ── 5) 格式守卫：删属性不许留下空壳 / 连续逗号，产物必须还能解析 ──────────────
	check("删 title 后没有残留空属性（`title: \"\"` / `title: ,` / `title: }`）",
		!/\btitle\s*:\s*(?:""|'')?\s*[,}]/.test(comp));
	check("删 title 后没有残留连续逗号（`, ,` / `,\\n\\s*,`）",
		!/,\s*,/.test(comp));
	{
		let ok = true;
		try { new Function(lib); } catch (e) { ok = false; }
		check("产物 lib/client.js 仍是可解析的合法 JS（删 JSX 属性没把对象字面量搞坏）", ok);
	}
}
