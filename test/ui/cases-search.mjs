// test/ui/cases-search.mjs —— C 组：搜索框（设置页 + 面板底栏）
//
// 覆盖的历史 bug（2026-11-01 真机）：
//   设置页搜索框上挂着行内 `{ ...inputStyle, fontSize: 11 }`，而 inputStyle 自带
//   `padding:"2px 6px"` ⇒ 行内压过类规则里的 padding-left:20px，放大镜与占位文字**重叠 11.33px**。
//   静态守卫当时只 grep 到了"类规则里写了 padding-left:20px"，于是全绿 —— 这正是这套 harness 的理由。
//
// 这里量的是**渲染事实**：放大镜的右边界 vs 输入框文字真正的起点 x（内容盒左缘 = 左缘 + 边框 + 内边距）。
// 间隙 > 0 才算不重叠。同一个断言在**干净宿主**与**宿主强制 input padding** 两种场景各跑一遍
// （场景由 harness 控制：两遍都必须过）。
//
// 选择器：设置页 `.gacha-cal-set-find` / `.gacha-cal-set-find-ic` / `.gacha-cal-set-find-in`
//         面板底栏 `.gacha-cal-sched-find` / `.gacha-cal-sched-find-ic` / `.gacha-cal-sched-find input`

import { detail, rectBrief } from "./report.mjs";

const SET_SHELL = ".gacha-cal-set-find";
const SET_ICON = ".gacha-cal-set-find-ic";
const SET_INPUT = ".gacha-cal-set-find-in";
const FIND = ".gacha-cal-sched-find";
const FIND_ICON = ".gacha-cal-sched-find-ic";
const FIND_INPUT = ".gacha-cal-sched-find input";

const r2 = (v) => Math.round(v * 100) / 100;

export default function runSearch(ctx) {
	const { m, check } = ctx;
	const s = m.settings;
	const p = m.panel;

	// ── 设置页 ───────────────────────────────────────────────────────────────
	{
		const gap = r2(s.textStartX - s.icon.right);
		check(
			`C1 设置页：放大镜右边界 < 文字起点（间隙 ${gap}px > 0）`,
			gap > 0,
			detail("C1", "间隙 > 0", `间隙=${gap}px（图标右=${r2(s.icon.right)} 文字起点=${r2(s.textStartX)}）`, `${SET_SHELL} > ${SET_ICON}`,
				`icon=${rectBrief(s.icon)} | input=${rectBrief(s.input)} | input padding-left=${s.inputStyle.paddingLeft} 边框=${s.inputStyle.borderLeftWidth}`)
		);
		check(
			`C2 设置页：外壳高度 = 20（实测 ${r2(s.shell.h)}）`,
			Math.abs(s.shell.h - 20) <= 0.5,
			detail("C2", "20", r2(s.shell.h), SET_SHELL, rectBrief(s.shell))
		);
		// input 不许溢出外壳：右缘 ≤ 外壳内容盒右缘、上下都在外壳内（容差 1px）
		const overflowX = r2(s.input.right - s.shellContentRight);
		const overflowY = r2(s.input.bottom - s.shellContentBottom);
		check(
			"C3 设置页：输入框不溢出外壳（右侧 / 底部都不越界）",
			overflowX <= 1 && overflowY <= 1 && s.input.top >= s.shell.top - 1,
			detail("C3", "右/下越界 ≤ 1px", `右越界=${overflowX}px 下越界=${overflowY}px`, `${SET_SHELL} > ${SET_INPUT}`,
				`shell=${rectBrief(s.shell)} | input=${rectBrief(s.input)}`)
		);
		check(
			"C4 设置页：搜索框这一行无横向滚动",
			s.shellScroll.scrollWidth <= s.shellScroll.clientWidth + 0.5,
			detail("C4", "scrollWidth ≤ clientWidth", `scrollWidth=${s.shellScroll.scrollWidth} clientWidth=${s.shellScroll.clientWidth}`, SET_SHELL, rectBrief(s.shell))
		);
	}

	// ── 面板底栏 ─────────────────────────────────────────────────────────────
	{
		const gap = r2(p.textStartX - p.icon.right);
		check(
			`C5 面板底栏：放大镜右边界 < 文字起点（间隙 ${gap}px > 0）`,
			gap > 0,
			detail("C5", "间隙 > 0", `间隙=${gap}px（图标右=${r2(p.icon.right)} 文字起点=${r2(p.textStartX)}）`, `${FIND} > ${FIND_ICON}`,
				`icon=${rectBrief(p.icon)} | input=${rectBrief(p.input)} | input padding-left=${p.inputStyle.paddingLeft} 边框=${p.inputStyle.borderLeftWidth}`)
		);
		check(
			`C6 面板底栏：输入框高度 = 20（实测 ${r2(p.input.h)}）`,
			Math.abs(p.input.h - 20) <= 0.5,
			detail("C6", "20", r2(p.input.h), FIND_INPUT, rectBrief(p.input))
		);
		check(
			`C7 面板底栏：搜索框外壳高度 = 20（实测 ${r2(p.find.h)}）`,
			Math.abs(p.find.h - 20) <= 0.5,
			detail("C7", "20", r2(p.find.h), FIND, rectBrief(p.find))
		);
		// 134px 是 2026-11-01 定的固定宽（占位文字要放得下）；缩水会把占位文字切掉。
		check(
			`C8 面板底栏：输入框宽度 = 134（实测 ${r2(p.input.w)}）`,
			Math.abs(p.input.w - 134) <= 0.5,
			detail("C8", "134", r2(p.input.w), FIND_INPUT, rectBrief(p.input))
		);
		const overflowX = r2(p.input.right - p.findContentRight);
		check(
			"C9 面板底栏：输入框不溢出搜索框外壳",
			overflowX <= 1,
			detail("C9", "右越界 ≤ 1px", `${overflowX}px`, `${FIND} > input`, `find=${rectBrief(p.find)} | input=${rectBrief(p.input)}`)
		);
		check(
			"C10 面板底栏：搜索框外壳无横向滚动",
			p.findScroll.scrollWidth <= p.findScroll.clientWidth + 0.5,
			detail("C10", "scrollWidth ≤ clientWidth", `scrollWidth=${p.findScroll.scrollWidth} clientWidth=${p.findScroll.clientWidth}`, FIND, rectBrief(p.find))
		);
		// 底栏整体：`.gacha-cal-sched-foot` 是常驻面板下端的一行，溢出会顶出横向滚动条
		check(
			"C11 面板底栏整行无横向滚动",
			p.footScroll.scrollWidth <= p.footScroll.clientWidth + 0.5,
			detail("C11", "scrollWidth ≤ clientWidth", `scrollWidth=${p.footScroll.scrollWidth} clientWidth=${p.footScroll.clientWidth}`, ".gacha-cal-sched-foot", rectBrief(p.foot))
		);
	}
}
