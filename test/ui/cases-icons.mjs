// test/ui/cases-icons.mjs —— D 组：图标规格（"同规格"必须是量出来的，不是注释里写的）
//
// 覆盖的历史 bug（2026-11-01）：「新面板的刷新按钮感觉稍微有一点大」—— 刷新 20×20/16px 与
// 齿轮的 18×18/14px 不一致，两者挨着站 ⇒ 一眼就看出大小差。静态守卫（cases-settings-jump）
// 只能比对 CSS 里写的数字，改一边忘另一边它抓得到；但"渲染出来是否真的一样"只有这里能证明。
//
// 判定方式两级：
//   ① **渲染尺寸**（getBoundingClientRect）必须逐像素相等 —— 这一条是硬约束；
//   ② **绘制范围**（getBBox 换算成渲染像素）允许 1px 容差 —— 两枚 glyph 形状不同
//      （环形箭头 vs 齿轮），墨迹外接框本来就不会完全相等；要抓的是"某个图标换成了别的规格"
//      （viewBox / 尺寸 / strokeWidth 变了会让墨迹范围一次跳好几像素）。
//
// 选择器：`.gacha-cal-sched-btn svg`（刷新）/ `.gacha-cal-sched-gear svg`（齿轮）
//         `.gacha-cal-set-find-ic`（设置页放大镜）/ `.gacha-cal-sched-find-ic`（面板底栏放大镜）

import { detail, rectBrief } from "./report.mjs";

const r2 = (v) => Math.round(v * 100) / 100;

function sameRect(a, b) {
	return a && b && Math.abs(a.w - b.w) <= 0.5 && Math.abs(a.h - b.h) <= 0.5;
}
function brief(svg) {
	if (!svg) return "null";
	const b = svg.bbox;
	return `${rectBrief(svg.rect)}${b ? ` | bbox=${r2(b.pxW)}×${r2(b.pxH)}` : ""}`;
}

export default function runIcons(ctx) {
	const { m, check } = ctx;
	const { refresh, gear } = m.panel;
	const { settings: magSet, panel: magPanel } = m.magnifiers;

	// ── 刷新 vs 齿轮（底栏两枚按钮图标）───────────────────────────────────────
	check(
		`D1 刷新与齿轮 svg 渲染尺寸相等（刷新 ${r2(refresh.rect.w)}×${r2(refresh.rect.h)} / 齿轮 ${r2(gear.rect.w)}×${r2(gear.rect.h)}）`,
		sameRect(refresh.rect, gear.rect),
		detail("D1", "两者 w/h 相等", `刷新 ${r2(refresh.rect.w)}×${r2(refresh.rect.h)} vs 齿轮 ${r2(gear.rect.w)}×${r2(gear.rect.h)}`, ".gacha-cal-sched-btn svg / .gacha-cal-sched-gear svg",
			`刷新 ${brief(refresh)} | 齿轮 ${brief(gear)}`)
	);
	check(
		`D2 刷新与齿轮都是 14×14（实测 ${r2(refresh.rect.w)}×${r2(refresh.rect.h)} / ${r2(gear.rect.w)}×${r2(gear.rect.h)}）`,
		Math.abs(refresh.rect.w - 14) <= 0.5 && Math.abs(refresh.rect.h - 14) <= 0.5 &&
			Math.abs(gear.rect.w - 14) <= 0.5 && Math.abs(gear.rect.h - 14) <= 0.5,
		detail("D2", "14×14", `${r2(refresh.rect.w)}×${r2(refresh.rect.h)} / ${r2(gear.rect.w)}×${r2(gear.rect.h)}`, ".gacha-cal-sched-btn svg / .gacha-cal-sched-gear svg",
			`刷新 ${brief(refresh)} | 齿轮 ${brief(gear)}`)
	);
	check(
		"D3 刷新与齿轮的 svg 属性一致（viewBox / stroke-width / width / height）",
		refresh.viewBox === gear.viewBox && refresh.strokeWidth === gear.strokeWidth &&
			refresh.attrWidth === gear.attrWidth && refresh.attrHeight === gear.attrHeight,
		detail("D3", "四个属性逐字相同",
			`viewBox ${refresh.viewBox} vs ${gear.viewBox}；stroke-width ${refresh.strokeWidth} vs ${gear.strokeWidth}；width ${refresh.attrWidth} vs ${gear.attrWidth}；height ${refresh.attrHeight} vs ${gear.attrHeight}`,
			".gacha-cal-sched-btn svg / .gacha-cal-sched-gear svg", null)
	);
	{
		const dw = refresh.bbox && gear.bbox ? r2(Math.abs(refresh.bbox.pxW - gear.bbox.pxW)) : null;
		const dh = refresh.bbox && gear.bbox ? r2(Math.abs(refresh.bbox.pxH - gear.bbox.pxH)) : null;
		check(
			`D4 刷新与齿轮的墨迹范围相当（差 ${dw}×${dh}px，容差 1）`,
			dw != null && dh != null && dw <= 1 && dh <= 1,
			detail("D4", "两轴差 ≤ 1px", dw == null ? "getBBox 失败" : `${dw} × ${dh}px`, ".gacha-cal-sched-btn svg / .gacha-cal-sched-gear svg",
				`刷新 ${brief(refresh)} | 齿轮 ${brief(gear)}`)
		);
	}

	// ── 两处放大镜（设置页 vs 面板底栏）──────────────────────────────────────
	check(
		`D5 两处放大镜渲染尺寸相等且 = 12×12（设置页 ${r2(magSet.rect.w)}×${r2(magSet.rect.h)} / 底栏 ${r2(magPanel.rect.w)}×${r2(magPanel.rect.h)}）`,
		sameRect(magSet.rect, magPanel.rect) &&
			Math.abs(magSet.rect.w - 12) <= 0.5 && Math.abs(magPanel.rect.w - 12) <= 0.5,
		detail("D5", "12×12 且两者相等", `${r2(magSet.rect.w)}×${r2(magSet.rect.h)} / ${r2(magPanel.rect.w)}×${r2(magPanel.rect.h)}`,
			".gacha-cal-set-find-ic / .gacha-cal-sched-find-ic", `设置页 ${brief(magSet)} | 底栏 ${brief(magPanel)}`)
	);
	check(
		"D6 两处放大镜是同一个 glyph（viewBox / stroke-width 相同）",
		magSet.viewBox === magPanel.viewBox && magSet.strokeWidth === magPanel.strokeWidth,
		detail("D6", "viewBox 与 stroke-width 相同", `viewBox ${magSet.viewBox} vs ${magPanel.viewBox}；stroke-width ${magSet.strokeWidth} vs ${magPanel.strokeWidth}`,
			".gacha-cal-set-find-ic / .gacha-cal-sched-find-ic", null)
	);
	{
		const dw = magSet.bbox && magPanel.bbox ? r2(Math.abs(magSet.bbox.pxW - magPanel.bbox.pxW)) : null;
		const dh = magSet.bbox && magPanel.bbox ? r2(Math.abs(magSet.bbox.pxH - magPanel.bbox.pxH)) : null;
		check(
			`D7 两处放大镜的墨迹范围一致（差 ${dw}×${dh}px，容差 0.5）`,
			dw != null && dh != null && dw <= 0.5 && dh <= 0.5,
			detail("D7", "两轴差 ≤ 0.5px", dw == null ? "getBBox 失败" : `${dw} × ${dh}px`, ".gacha-cal-set-find-ic / .gacha-cal-sched-find-ic",
				`设置页 ${brief(magSet)} | 底栏 ${brief(magPanel)}`)
		);
	}
}
