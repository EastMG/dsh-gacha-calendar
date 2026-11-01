// test/ui/fixtures.mjs —— 渲染夹具：被测组件的真实 DOM 片段
//
// 原则：夹具**照抄组件的渲染结果**（类名 / 属性 / 嵌套顺序 / 行内 style 都照写），
// 唯一的不同是数据：用固定文案代替引擎数据，用 GameIcon 的**无图兜底分支**（真机加载失败时
// 走的就是那条）代替真实图片 —— setContent 的页面没有网络，`<img>` 会裂成 0×0，量出来的是假几何。
//
// ⚠️ 夹具改了，断言大概率要跟着改：每个片段上面都标了它对应源码的哪一段。

import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO, HOST_BASE_CSS } from "./css.mjs";

// ── 图标（与组件逐字同一套 glyph）────────────────────────────────────────────
// 放大镜：82-schedule-view.js 的搜索框 leading icon 与 84-settings-page.js 的设置页图标**同一个 glyph**。
export const MAGNIFIER = (cls) =>
	`<svg class="${cls}" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="4.5"></circle><path d="M10.4 10.4 13.5 13.5"></path></svg>`;

// 刷新：底栏按钮里那枚环形箭头（14×14 / viewBox 0 0 16 16 / strokeWidth 1.5）。
const REFRESH = (cls) =>
	`<svg${cls ? ` class="${cls}"` : ""} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 8a6 6 0 1 1-1.76-4.24L14 5.333"></path><polyline points="14 2 14 5.333 10.667 5.333"></polyline></svg>`;

// 齿轮：路径太长，且**必须**与组件一致（否则 D 组测的就不是产品那枚图标了）⇒ 从源码抽。
function gearPaths() {
	const src = readFileSync(path.join(REPO, "src", "client", "82-schedule-view.js"), "utf8");
	const at = src.indexOf('className: "gacha-cal-sched-gear"');
	if (at < 0) throw new Error("82-schedule-view.js 里找不到 `className: \"gacha-cal-sched-gear\"` —— 齿轮改成别的写法了？夹具需要同步（test/ui/fixtures.mjs）");
	// 齿轮的 svg 紧跟在这个按钮后面；取这一小段里的所有 `d: "…"`。
	const block = src.slice(at, at + 6000);
	const ds = [...block.matchAll(/d: "([^"]*)"/g)].map((m) => m[1]).filter((d) => d.length > 40);
	if (ds.length !== 2) throw new Error(`从 82-schedule-view.js 抽齿轮路径失败（期望 2 条，实得 ${ds.length} 条）—— 夹具需要同步（test/ui/fixtures.mjs）`);
	return ds;
}
const GEAR = () =>
	`<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${gearPaths()
		.map((d) => `<path d="${d}"></path>`)
		.join("")}</svg>`;

// 侧栏按钮的日历图标（16×16，见 styles/ticker.css 的 `.gacha-cal-btn svg`）。
const CAL_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="2" y="3.2" width="12" height="10.8" rx="2"></rect><path d="M2 6.4h12M5.6 1.9v2.6M10.4 1.9v2.6"></path></svg>`;

// GameIcon 的**无图兜底分支**（80-shared-ui.js）：外层 span + 行内 style，尺寸由 size 参数决定。
const GAME_ICON = (size, glyph) =>
	`<span style="width:${size}px;height:${size}px;border-radius:5px;flex:none;display:inline-flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-l2, rgba(127,127,127,.2));color:var(--dsw-alias-text-l2, inherit);font-size:${Math.round(size * 0.55)}px;font-weight:600;line-height:1;user-select:none;overflow:hidden">${glyph}</span>`;

// ── A/B：侧栏底栏槽位（styles/sidebar-footer.css）─────────────────────────────
// 对应真机：`.footerActions`（宿主 flex 容器）> `[data-slot="sidebar.footer.action"]`
// （宿主渲染的槽位锚点，我们的样式就是改它）> 每个入口一个直系子项。
// 单个入口 ⇒ 槽位里只有一个子项 ⇒ `:has(> * + *)` 不匹配 ⇒ 我们的规则整段不生效。
export function sidebarFixture(id, entries) {
	const kids = entries === 1
		? [`<button type="button" class="gacha-cal-btn">${CAL_ICON}<span class="gacha-cal-btn-txt"><span class="gacha-cal-btn-line"><span class="gacha-cal-btn-lbl">二游日历</span><span class="gacha-cal-btn-st"> · 还剩 3 小时</span></span></span></button>`]
		: [
			// 第 1 行 = 我们这个入口（.gacha-cal-btn 自带 margin:4px 0）
			`<button type="button" class="gacha-cal-btn">${CAL_ICON}<span class="gacha-cal-btn-txt"><span class="gacha-cal-btn-line"><span class="gacha-cal-btn-lbl">二游日历</span></span></span></button>`,
			// 第 2/3 行 = 宿主里**别的插件**的入口（.host-entry，自带 margin:4px 0）
			`<button type="button" class="host-entry">远程控制</button>`,
			`<button type="button" class="host-entry">账号</button>`
		].slice(0, entries).join("");
	return `<div class="host-footer-actions" id="${id}-parent"><div data-slot="sidebar.footer.action" id="${id}">${kids}</div></div>`;
}

// ── C（设置页）：84-settings-page.js 的「游戏列表」标题行 ─────────────────────
// 外壳与图标并排（2026-11-01 真机修版）：图标、input 都是外壳的 flex 子项 —— 物理上不可能重叠。
// 外层那行 flex（含 flexWrap:wrap）是组件里的行内 style，照抄。
export function settingsFixture() {
	return `<div class="fx-wrap" style="width:720px"><div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:4px">
  <div style="display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap">
    <span style="font-weight:600">游戏列表</span>
    <span class="gacha-cal-set-find" id="fx-set-find">${MAGNIFIER("gacha-cal-set-find-ic")}<input class="gacha-cal-set-find-in" id="fx-set-input" type="text" placeholder="搜游戏名" aria-label="按游戏名搜索"></span>
    <label style="display:flex;align-items:center;gap:4px;flex:none;font-size:11px;cursor:pointer"><input type="checkbox"><span>只看已启用</span></label>
  </div>
  <div style="display:flex;gap:6px"><button type="button" class="gacha-cal-sort-btn">导出 .ics</button></div>
</div></div>`;
}

// ── C/D/E：新面板（styles/schedule.css + schedule-foot.css）────────────────────
// 「近期」一行（82-schedule-view.js 的 recentRow）：图标 / 游戏名 / 类型 / 事项名 / 时间结论。
// 底栏（同一文件的 footer）：搜索框（含 leading 放大镜）+「上次更新」+ 刷新 + 齿轮。
const recentRow = (i) => `<div class="gacha-cal-sched-u" data-u="1" id="fx-row-${i}">
  <span class="gacha-cal-sched-uic">${GAME_ICON(24, "字")}</span>
  <span class="gacha-cal-sched-who"><span class="gacha-cal-inner">明日方舟</span></span>
  <span class="gacha-cal-sched-kind" data-t="gacha"><svg class="gacha-cal-sched-tic" viewBox="0 0 12 12" aria-hidden="true" focusable="false" fill="currentColor"><path d="M6 .9 8.1 3.9 11.1 6 8.1 8.1 6 11.1 3.9 8.1 .9 6 3.9 3.9z"></path></svg><span>卡池</span></span>
  <span class="gacha-cal-sched-what" title="某角色的卡池"><span class="gacha-cal-inner">某角色</span></span>
  <span class="gacha-cal-sched-when gacha-cal-sched-num">还剩 <span>3<small>天</small></span></span>
</div>`;

export function panelFixture() {
	return `<div class="fx-wrap"><div class="gacha-cal-sched" id="fx-panel" style="width:690px">
  <div class="gacha-cal-sched-body" id="fx-panel-body">
    <div class="gacha-cal-sched-head"><div class="gacha-cal-sched-glance">24 小时内 <b>2</b> 条 · 7 天内 <b>5</b> 条</div><span class="gacha-cal-sched-sp"><span class="gacha-cal-sched-pill gacha-cal-sched-pill--live">11-01 周日</span></span></div>
    <div class="gacha-cal-sched-recent">
      <div class="gacha-cal-sched-urgent"><div class="gacha-cal-sched-nearpg" id="fx-nearpg">${recentRow(1)}${recentRow(2)}${recentRow(3)}</div></div>
      <div class="gacha-cal-sched-slot"><div class="gacha-cal-slot-gn">明日方舟</div></div>
    </div>
  </div>
  <div class="gacha-cal-sched-foot" id="fx-panel-foot">
    <div class="gacha-cal-sched-find" id="fx-find">${MAGNIFIER("gacha-cal-sched-find-ic")}<input id="fx-find-input" type="text" placeholder="搜卡池/角色/活动" aria-label="搜索游戏名、卡池名、角色名或活动名"></div>
    <span class="gacha-cal-sched-scrape">刷新完成 · 3 源</span>
    <span class="gacha-cal-sched-when">上次更新 3 分钟前</span>
    <button type="button" class="gacha-cal-sched-btn" id="fx-refresh" title="刷新" aria-label="刷新">${REFRESH()}</button>
    <button type="button" class="gacha-cal-sched-gear" id="fx-gear" title="设置" aria-label="设置">${GEAR()}</button>
  </div>
</div></div>`;
}

/** 整页 HTML：真实产物 CSS + 宿主基础样式（+ 可选的压力样式） + 全部夹具。 */
export function buildPageHtml({ productCss, pressureCss }) {
	return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style id="fx-product-css">${productCss}</style>
<style id="fx-host-base">${HOST_BASE_CSS}</style>
${pressureCss ? `<style id="fx-host-pressure">${pressureCss}</style>` : ""}
</head><body>
<div class="fx-title">A/B 侧栏底栏槽位（单入口）</div>
${sidebarFixture("fx-slot-1", 1)}
<div class="fx-title">A 侧栏底栏槽位（两个入口）</div>
${sidebarFixture("fx-slot-2", 2)}
<div class="fx-title">B 侧栏底栏槽位（三个入口 = 我们 + 两个宿主入口）</div>
${sidebarFixture("fx-slot-3", 3)}
<div class="fx-title">C 设置页搜索框</div>
${settingsFixture()}
<div class="fx-title">C/D/E 新面板</div>
${panelFixture()}
</body></html>`;
}
