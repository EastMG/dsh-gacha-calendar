// test/ui/cases-overflow.mjs —— F 组：通用溢出扫描（子元素是否越出容器边界）
//
// 这是"取证用"的一组：它不针对某个已知 bug，而是对每个被测容器做一次**通用**扫描 ——
// 任何子元素的外接框越出容器边界超过 1px 就点名。历史 bug 里"横向滚动条"「图标压到边框上」
// 「文字顶出卡片」都是这一类；以后新增布局时它也会先叫。
//
// 容差 1px：亚像素布局（DPR 吸附）会让边界差出 0.5px 左右，那是正常的。
//
// 选择器：五个容器各扫一遍（侧栏槽位 ×2 / 设置页搜索框 / 面板底栏 / 近期列表）

import { detail, rectBrief } from "./report.mjs";

const CONTAINERS = [
	["sidebarSlot2", "两个入口的侧栏槽位", '[data-slot="sidebar.footer.action"]（两个入口）'],
	["sidebarSlot3", "三个入口的侧栏槽位", '[data-slot="sidebar.footer.action"]（三个入口）'],
	["settingsRow", "设置页搜索框外壳", ".gacha-cal-set-find"],
	["panelFoot", "面板底栏", ".gacha-cal-sched-foot"],
	["recentList", "近期列表", ".gacha-cal-sched-nearpg"]
];

export default function runOverflow(ctx) {
	const { m, check } = ctx;
	for (const [key, label, selector] of CONTAINERS) {
		const hit = m.overflow[key];
		if (!hit || hit.missing) {
			check(`F ${label}：容器在页面上（扫描有意义）`, false, detail("F", "找到容器", "missing", selector, null));
			continue;
		}
		const bad = hit.offenders || [];
		const list = bad
			.slice(0, 6)
			.map((o) => `${o.sel} → 越界 L${Math.round(o.over.left * 100) / 100} R${Math.round(o.over.right * 100) / 100} T${Math.round(o.over.top * 100) / 100} B${Math.round(o.over.bottom * 100) / 100}`)
			.join("\n");
		check(
			`F ${label}：没有子元素越出容器边界（容差 1px）`,
			bad.length === 0,
			detail("F", "越界子元素 0 个", bad.length ? `${bad.length} 个：\n${list}` : "ok", selector,
				`容器 ${rectBrief(hit.rect)}`)
		);
	}
}
