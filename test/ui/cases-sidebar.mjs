// test/ui/cases-sidebar.mjs —— A 组（槽位排布）+ B 组（间距均匀）
//
// 覆盖的两个历史 bug（2026-10-30 真机）：
//   1. 侧栏底栏的三个入口被宿主排成一行、互相挤压，还出现横向滚动条；
//   2. 我们的槽位补了一条 `gap:6px` ⇒ 第一段间距 4+4+6 = 14px、第二段 4+4 = 8px，
//      三行间距不匀（用户原话「间距不匀」）。
// 静态守卫抓不到这两条：它们只在**布局算完之后**才出现，所以必须量 getBoundingClientRect。
//
// 选择器：`[data-slot="sidebar.footer.action"]`（宿主渲染的槽位锚点）
//         `.host-footer-actions`（宿主 .footerActions，横向滚动该由它暴露）

import { detail, rectBrief } from "./report.mjs";

const SLOT = '[data-slot="sidebar.footer.action"]';

export default function runSidebar(ctx) {
	const { m, check } = ctx;
	const { one, two, three } = m.slots;

	// ── A 组：两个入口 ⇒ 竖排、不重叠、不横向滚动 ─────────────────────────────
	check(
		"A1 两个入口 ⇒ 槽位 flex-direction = column（宿主原来是一行）",
		two.dir === "column",
		detail("A1", "column", two.dir, SLOT, rectBrief(two.rect))
	);
	check(
		"A2 两个入口 ⇒ 槽位 display = flex（我们的规则确实接管了槽位）",
		two.display === "flex",
		detail("A2", "flex", two.display, SLOT, rectBrief(two.rect))
	);
	{
		// 子项 y 互不重叠：按 y 排序后，后一个的 top 不许早于前一个的 bottom（容差 0.5px 抗亚像素）
		const kids = [...two.children].sort((a, b) => a.rect.y - b.rect.y);
		const bad = [];
		for (let i = 1; i < kids.length; i++) {
			const gap = kids[i].rect.y - kids[i - 1].rect.bottom;
			if (gap < -0.5) bad.push(`${kids[i - 1].cls} → ${kids[i].cls}: 重叠 ${Math.round(-gap * 100) / 100}px`);
		}
		check(
			"A3 两个入口 ⇒ 子项 y 互不重叠",
			bad.length === 0,
			detail("A3", "每个子项的 y ≥ 前一个的 bottom", bad.join("；") || "ok", SLOT + " > *",
				kids.map((k) => `${k.cls}: ${rectBrief(k.rect)}`).join(" | "))
		);
	}
	check(
		"A4 两个入口 ⇒ 槽位无横向滚动（scrollWidth ≤ clientWidth）",
		two.scroll.scrollWidth <= two.scroll.clientWidth + 0.5,
		detail("A4", "scrollWidth ≤ clientWidth", `scrollWidth=${two.scroll.scrollWidth} clientWidth=${two.scroll.clientWidth}`, SLOT, rectBrief(two.rect))
	);
	check(
		"A5 两个入口 ⇒ 宿主 .footerActions 也没有横向滚动",
		two.parentScroll && two.parentScroll.scrollWidth <= two.parentScroll.clientWidth + 0.5,
		detail("A5", "scrollWidth ≤ clientWidth", two.parentScroll ? `scrollWidth=${two.parentScroll.scrollWidth} clientWidth=${two.parentScroll.clientWidth}` : "missing", ".host-footer-actions", rectBrief(two.rect))
	);
	// 单入口：`:has(> * + *)` 不匹配 ⇒ 整段规则不生效（不碰宿主的方向、也不碰几何）
	check(
		"A6 单入口 ⇒ 我们的规则不生效（flex-direction 仍是 row）",
		one.dir === "row",
		detail("A6", "row", one.dir, SLOT, rectBrief(one.rect))
	);
	check(
		"A7 单入口 ⇒ 槽位没有被我们改成 flex 容器（display ≠ flex）",
		one.display !== "flex",
		detail("A7", "display ≠ flex", one.display, SLOT, rectBrief(one.rect))
	);

	// ── B 组：三个入口 ⇒ 相邻垂直间隙两两相等 ────────────────────────────────
	// 三个入口才是"间距不匀"能暴露出来的形状（只有两个入口时只有一段间距，无从比较）。
	const kids = [...three.children].sort((a, b) => a.rect.y - b.rect.y);
	const gaps = [];
	for (let i = 1; i < kids.length; i++) gaps.push(Math.round((kids[i].rect.y - kids[i - 1].rect.bottom) * 100) / 100);
	const gapText = gaps.map((g) => g + "px").join(" / ");
	const rowText = kids.map((k) => `${k.cls}: ${rectBrief(k.rect)}`).join(" | ");

	check(
		"B0 三个入口 ⇒ 槽位 flex-direction = column（B 组的前提）",
		three.dir === "column",
		detail("B0", "column", three.dir, SLOT, rectBrief(three.rect))
	);
	check(
		`B1 三个入口 ⇒ 相邻垂直间隙两两相等（实测 ${gapText}）`,
		gaps.length === 2 && Math.abs(gaps[0] - gaps[1]) <= 1,
		detail("B1", "两段间隙相差 ≤ 1px", gapText || "（不足两段）", SLOT + " > *", rowText)
	);
	// 宿主每个入口自带 margin:4px ⇒ 相邻两行应当正好 8px；槽位再叠 gap 就会变成 4+4+gap。
	// 钉住 8px 是为了让「有人又加了一条 gap」在报告里直接读出"14 vs 8"这种数字，而不是只看到"不相等"。
	check(
		`B2 三个入口 ⇒ 每段间隙 = 8px（宿主 4+4，槽位不许再加 gap；实测 ${gapText}）`,
		gaps.length === 2 && gaps.every((g) => Math.abs(g - 8) <= 1),
		detail("B2", "8px（每段）", gapText || "（不足两段）", SLOT + " > *", rowText)
	);
}
