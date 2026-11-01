// test/ui/cases-recent.mjs —— E 组：「近期」每一行的行高与单行约束
//
// 覆盖的历史 bug：行高被内容（图标 26 + 文字行高）或 padding 改动悄悄撑高/压扁，一屏能看的条数
// 就变了；行内文字换行会把整行变成两行，紧凑列表立刻松散。这两类都是**纯几何**，静态守卫看不见。
//
// 常量来自产品 CSS（`styles/schedule.css` 的 `.gacha-cal-sched-uic{width:26px;height:26px}`
// 与 `.gacha-cal-sched-u{padding:6px 8px}`）。这里把它写成**期望值**，一旦 CSS 改了就得同步 ——
// 这正是"预期 26 或代码里的常量"该有的样子：改了要么更新这里，要么看到红灯。
//
// 选择器：`.gacha-cal-sched-nearpg`（近期列表容器）/ `.gacha-cal-sched-u`（一行）
//         `.gacha-cal-sched-uic`（行首游戏图标）/ 行内文字 span

import { detail, rectBrief } from "./report.mjs";

const ROW_ICON = 26; // .gacha-cal-sched-uic 的 width/height
const ROW_PAD_Y = 6; // .gacha-cal-sched-u 的 padding 上下各 6px
const ROW_TEXT_CLASSES = [".gacha-cal-sched-who", ".gacha-cal-sched-what", ".gacha-cal-sched-when"];

const r2 = (v) => Math.round(v * 100) / 100;

export default function runRecent(ctx) {
	const { m, check } = ctx;
	const recent = m.recent;
	const rows = recent.rows;
	const rowText = rows.map((r, i) => `#${i + 1} ${rectBrief(r.rect)}`).join(" | ");

	// ── 行高 ─────────────────────────────────────────────────────────────────
	check(
		`E1 近期行数 = 3（夹具三行都在，能量到东西）`,
		rows.length === 3,
		detail("E1", "3", String(rows.length), ".gacha-cal-sched-nearpg > .gacha-cal-sched-u", rectBrief(recent.page))
	);
	{
		// 行高 = 图标 26 + 上下 padding（6+6） = 38。用 padding 的实际值算，避免写死 38 之后
		// 改 padding 时这条断言变成"另抄了一份 CSS"。
		const expected = rows.map((r) => ROW_ICON + r.padTop + r.padBottom);
		const bad = rows
			.map((r, i) => ({ i, got: r.rect.h, exp: expected[i] }))
			.filter((x) => Math.abs(x.got - x.exp) > 0.5);
		check(
			`E2 近期行高 = 图标 ${ROW_ICON} + 上下 padding（实测 ${rows.map((r) => r2(r.rect.h)).join(" / ")}）`,
			bad.length === 0,
			detail("E2", rows.map((_, i) => expected[i]).join(" / "), bad.map((b) => `#${b.i + 1}=${r2(b.got)}`).join(" ") || "ok",
				".gacha-cal-sched-u", rowText)
		);
	}
	{
		const hs = rows.map((r) => r2(r.rect.h));
		check(
			`E3 三行行高彼此一致（${hs.join(" / ")}）`,
			hs.length > 1 && hs.every((h) => Math.abs(h - hs[0]) <= 1),
			detail("E3", "三行相差 ≤ 1px", hs.join(" / "), ".gacha-cal-sched-u", rowText)
		);
	}
	{
		const bad = rows.filter((r) => Math.abs(r.icon.w - ROW_ICON) > 0.5 || Math.abs(r.icon.h - ROW_ICON) > 0.5);
		check(
			`E4 行首图标 = ${ROW_ICON}×${ROW_ICON}（实测 ${rows.map((r) => `${r2(r.icon.w)}×${r2(r.icon.h)}`).join(" / ")}）`,
			bad.length === 0,
			detail("E4", `${ROW_ICON}×${ROW_ICON}`, rows.map((r) => `${r2(r.icon.w)}×${r2(r.icon.h)}`).join(" / "), ".gacha-cal-sched-uic",
				rows.map((r) => rectBrief(r.icon)).join(" | "))
		);
	}

	// ── 单行 / 不换行 / 不溢出 ────────────────────────────────────────────────
	{
		// 允许行内出现长文案（省略号截断是**允许**的），所以这里查两件事：
		//   ① 会截断的那两段（游戏名 / 事项名）必须是 white-space:nowrap ⇒ 永远不会折成两行；
		//   ② 每个文字块的元素高度必须是一个字那么高（≈ 字号 ×1.6 以内）⇒ 没有偷偷变成两行。
		// ⚠️ 时间结论那段（.gacha-cal-sched-when）CSS 里没写 nowrap —— 它是 flex:0 0 auto 的子项，
		//    靠"不许收缩"保证不折行，所以只对它做 ②（高度），不硬要求 ①。硬要求会假红。
		const NOWRAP_REQUIRED = [".gacha-cal-sched-who", ".gacha-cal-sched-what"];
		const bad = [];
		for (const row of rows) {
			for (const k of row.kids) {
				if (!ROW_TEXT_CLASSES.some((c) => (" " + k.cls + " ").includes(" " + c.slice(1) + " "))) continue;
				const needNowrap = NOWRAP_REQUIRED.some((c) => (" " + k.cls + " ").includes(" " + c.slice(1) + " "));
				if (needNowrap && k.whiteSpace !== "nowrap") bad.push(`${k.cls}: white-space=${k.whiteSpace}（截断类必须 nowrap）`);
				const fs = parseFloat(k.fontSize) || 12;
				if (k.rect.h > fs * 1.6) bad.push(`${k.cls}: 高=${r2(k.rect.h)}px > ${r2(fs * 1.6)}px（像换行了）`);
			}
		}
		check(
			"E5 行内文字单行（截断类 nowrap；每块都只占一行）",
			bad.length === 0,
			detail("E5", "who/what: white-space:nowrap；三块高度都 ≤ 字号×1.6", bad.join("；") || "ok", ROW_TEXT_CLASSES.join(" / "), rowText)
		);
	}
	{
		// 行内每个子元素的右缘都不许超过本行内容盒右缘（容差 1px）
		const bad = [];
		for (const row of rows) {
			const limit = row.rect.right - 1;
			for (const k of row.kids) {
				if (k.rect.right > limit) bad.push(`${k.cls}: right=${r2(k.rect.right)} > ${r2(limit)}`);
			}
		}
		check(
			"E6 行内子元素不溢出本行右缘",
			bad.length === 0,
			detail("E6", "每个子元素右缘 ≤ 行右缘 − 1", bad.join("；") || "ok", ".gacha-cal-sched-u > *", rowText)
		);
	}
	check(
		"E7 近期列表无横向滚动（scrollWidth ≤ clientWidth）",
		recent.scroll.scrollWidth <= recent.scroll.clientWidth + 0.5,
		detail("E7", "scrollWidth ≤ clientWidth", `scrollWidth=${recent.scroll.scrollWidth} clientWidth=${recent.scroll.clientWidth}`, ".gacha-cal-sched-nearpg", rectBrief(recent.page))
	);
	{
		const bad = rows.filter((r) => r.scroll.scrollWidth > r.scroll.clientWidth + 1);
		check(
			"E8 每一行自身也没有横向滚动",
			bad.length === 0,
			detail("E8", "行 scrollWidth ≤ clientWidth + 1", bad.map((r) => `${r.id}: ${r.scroll.scrollWidth}>${r.scroll.clientWidth}`).join(" ") || "ok",
				".gacha-cal-sched-u", rowText)
		);
	}
}
