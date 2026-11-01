// test/ui/harness.mjs —— UI 渲染验证 harness（**几何断言**，不是静态 grep）
//
// 为什么要有它
//   最近几个 bug 全是几何 / 视觉的，静态守卫一个都抓不到：
//     · 侧栏底栏三行间距不匀（14px vs 8px）+ 出现横向滚动条
//     · 设置页搜索框的放大镜与占位文字**重叠**（行内 style 的 padding 压过类规则）
//     · 新面板刷新图标偏大 / 字号过大，观感拥挤
//   每次都是「用户截图 → 我们发现 → 修 → 等下一张截图」。这套 harness 把这件事变成一条命令：
//   用**真实产物 CSS**（按 build.mjs 的 CSS_ORDER 拼接）+ 真实 DOM 片段，在真 Chromium 里布局，
//   然后对 getBoundingClientRect / getComputedStyle / getBBox 的结果做断言。
//
// 跑法
//   node test/ui/harness.mjs          # = npm run test:ui
//   需要 Playwright（Chromium）。没装 ⇒ 打印装法 + `结果：0 通过 / 0 失败（已跳过）` + exit 0。
//   **不在默认门禁里**（test/all.mjs 不 import 本文件，CI 也不跑）：CI 是 ubuntu + 无浏览器。
//
// 两个场景（同一批断言各跑一遍，都必须过）
//   ① 干净宿主：只有宿主基础样式；
//   ② 宿主压力：再叠一条 `input{padding:0 14px}` —— 2026-11-01 那次事故就是这个形状
//      （宿主的 padding 压过我们的类规则）。压力场景是否真的"胜出"由诊断行如实说明。
//
// 输出与既有门禁一致：`结果：N 通过 / M 失败` + `失败项：… | …`，失败退出码 = 1。

import { check, section, note, summary, skip, counts } from "./report.mjs";
import { readProductCss, HOST_PRESSURE_CSS } from "./css.mjs";
import { buildPageHtml } from "./fixtures.mjs";
import { measurePage } from "./measure.mjs";
import { resolvePlaywright, launchChromium } from "./browser.mjs";

import runSidebar from "./cases-sidebar.mjs";
import runSearch from "./cases-search.mjs";
import runIcons from "./cases-icons.mjs";
import runRecent from "./cases-recent.mjs";
import runOverflow from "./cases-overflow.mjs";

// 组顺序 = A→B→C→D→E→F。每组拿到的是**同一次测量**的结果（一个场景只布局一次）。
const GROUPS = [
	["A/B 底栏槽位与间距", runSidebar],
	["C 搜索框（设置页 + 面板底栏）", runSearch],
	["D 图标规格", runIcons],
	["E 近期行", runRecent],
	["F 通用溢出扫描", runOverflow]
];

const SCENARIOS = [
	{ key: "clean", label: "干净宿主", css: "" },
	{ key: "pressure", label: "宿主压力", css: HOST_PRESSURE_CSS }
];

const INSTALL_HINT = [
	"这台机器上没有可用的 Playwright / Chromium，UI harness 本次**没有渲染任何页面**。",
	"怎么装（一次性，不进 package.json；node_modules 已被 .gitignore 挡住）：",
	"    npm install --no-save --no-package-lock playwright@1",
	"    npx playwright install chromium",
	"装完再跑： node test/ui/harness.mjs",
	"（它不在默认门禁里，跳过不算失败：本脚本已按 exit 0 退出）"
];

async function main() {
	// ── 1. 真实产物 CSS（顺序 = build.mjs 的 CSS_ORDER）────────────────────
	const css = readProductCss();
	console.log("UI 渲染验证 harness（真实 CSS + 真实 DOM + Chromium 布局）");
	console.log(`  真实产物 CSS：${css.files.length} 个文件 / ${css.chars} 字符（按 build.mjs 的 CSS_ORDER 拼接）`);
	console.log(`  CSS 顺序：${css.files.join(" → ")}`);

	// ── 2. 浏览器 ──────────────────────────────────────────────────────────
	const resolved = await resolvePlaywright();
	if (!resolved) {
		skip("环境检查", ["没有找到 Playwright（已试：node_modules 的 playwright / playwright-core、npx 缓存）。"].concat(INSTALL_HINT));
		return;
	}
	console.log(`  Playwright：${resolved.version || "（版本未知）"}  ← ${resolved.source}`);

	const launched = await launchChromium(resolved);
	if (!launched.browser) {
		skip("环境检查", [
			`找到了 ${resolved.version || "Playwright"}，但**没起来浏览器**。尝试记录：`,
			...launched.attempts.map((a) => "    · " + a)
		].concat(INSTALL_HINT));
		return;
	}
	const browser = launched.browser;
	console.log(`  Chromium：${browser.version()}（${launched.how}）`);

	const page = await browser.newPage();
	// reduce：关掉入场 / 翻页动画。它们只改 opacity/transform，但"动画进行中"会让某些矩形有
	// 亚像素抖动；关掉之后同一个断言在任何机器上量到的都是落定态（与静态守卫的假设一致）。
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.setViewportSize({ width: 1100, height: 900 });

	try {
		for (const sc of SCENARIOS) {
			section(`场景：${sc.label}${sc.css ? "（额外注入宿主 input padding）" : ""}`);
			await page.setContent(buildPageHtml({ productCss: css.text, pressureCss: sc.css }), { waitUntil: "load" });
			const m = await page.evaluate(measurePage);

			// 压力规则**是否真的注入了**：注入失败而断言全绿 = 假绿，这里先把它钉死。
			if (sc.css) {
				check(
					`【${sc.label}】压力样式确实挂到了页面上（<style id="fx-host-pressure"> 存在）`,
					m.hasPressureStyle === true,
					`组=压力注入 期望=true 实测=${m.hasPressureStyle}`
				);
			}

			for (const [label, fn] of GROUPS) {
				const before = counts();
				fn({ m, check: (name, ok, detail) => check(`【${sc.label}】${name}`, ok, detail) });
				const now = counts();
				console.log(`  · ${label}：+${now.pass - before.pass} 通过`);
			}

			// ── 压力场景的"如实交代"：弱压力赢不赢、强压力会不会重叠 ──────────
			if (!sc.css) {
				const diag = await page.evaluate(() => {
					const parse = (v) => parseFloat(v) || 0;
					const box = (el) => el.getBoundingClientRect();
					const gapOf = (inputSel, iconSel) => {
						const input = document.querySelector(inputSel);
						const icon = document.querySelector(iconSel);
						const cs = getComputedStyle(input);
						const textStart = box(input).left + parse(cs.borderLeftWidth) + parse(cs.paddingLeft);
						return Math.round((textStart - box(icon).right) * 100) / 100;
					};
					const out = {
						panelPaddingLeft: getComputedStyle(document.querySelector("#fx-find-input")).paddingLeft,
						setPaddingLeft: getComputedStyle(document.querySelector("#fx-set-input")).paddingLeft,
						panelGapClean: gapOf("#fx-find-input", ".gacha-cal-sched-find-ic"),
						setGapClean: gapOf("#fx-set-input", ".gacha-cal-set-find-ic")
					};
					// 强覆盖（!important）只用来诊断，**不参与计分**：它代表"宿主用最强手段压 padding"。
					const st = document.createElement("style");
					st.textContent = "input{padding:0 14px !important}";
					document.head.appendChild(st);
					out.panelPaddingLeftStrong = getComputedStyle(document.querySelector("#fx-find-input")).paddingLeft;
					out.setPaddingLeftStrong = getComputedStyle(document.querySelector("#fx-set-input")).paddingLeft;
					out.panelGapStrong = gapOf("#fx-find-input", ".gacha-cal-sched-find-ic");
					out.setGapStrong = gapOf("#fx-set-input", ".gacha-cal-set-find-ic");
					st.remove();
					return out;
				});
				note(`压力规则是元素选择器（0,0,1）：我们的类规则（0,1,1 / 0,1,0）在层叠上胜出 ⇒ 压力场景里输入框 padding-left 仍是 ${diag.panelPaddingLeft} / ${diag.setPaddingLeft}（干净场景实测 ${diag.panelGapClean}px / ${diag.setGapClean}px 间隙）。`);
				note(`诊断（不参与计分）：若宿主用 !important 强压 input padding，设置页间隙 ${diag.setGapStrong}px（并排结构，仍不重叠），面板底栏间隙 ${diag.panelGapStrong}px${diag.panelGapStrong < 0 ? " ⇒ **会重叠**" : ""}（底栏放大镜仍靠 input 的左内边距避让，是现存的脆弱点）。`);
			}
		}
	} finally {
		await page.close().catch(() => {});
		await browser.close().catch(() => {});
	}

	summary();
}

main().catch((e) => {
	console.error("\nUI harness 自己崩了（这不是断言失败，是脚本 bug）：");
	console.error(e && e.stack ? e.stack : e);
	process.exit(1);
});
