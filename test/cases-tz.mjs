// test/cases-tz.mjs —— 时区口径（2026-10-21 用户定）
//
//   外显（面板上看得见的时间文本） = 按**用户本机时区**换算后的时间
//   悬停（tooltip / 探头展开行）   = **源站墙钟原文**（游戏内公告那串时间）
//
// 为什么单独一个用例文件：这两条口径**只在海外机器上才看得出错**（CI 跑 UTC、开发机跑 +08），
// 而且错了不报错、只是钟点差几小时 —— 靠人眼在面板上看不出来。所以：
//   · 悬停侧：断言 `buildEventHover / buildPoolHover` 的输出**只由传入的 tz 决定**，
//     对同一份 ts 用 tz=Asia/Tokyo 与 tz=UTC 必须得到两串**各自精确**的文本
//     （若实现里漏了 tz、退回运行环境本机时区，这两条断言在两种机器上至少有一条会红）；
//   · 外显侧：`localWin / localWinText / localDatesOf` 是纯函数，直接用固定 ts 断言，
//     并与"不传 tz 的 fmtWindow（= 本机时区）"对齐 —— 不写死本机偏移，因此 +08 与 UTC 都可跑。
//
// 三类断言都**不依赖运行环境时区**：本文件在 `$env:TZ=UTC` 与默认 +08 下都必须全绿。

import { check, section } from "./harness.mjs";
import { T } from "./load.mjs";

export default async function run() {
	section("时区口径（外显=本机时区换算 / 悬停=源站墙钟原文）");
	const { fmtWindow, sourceInstant, buildEventHover, buildPoolHover, localWin, localWinText, localDatesOf } = T;

	// 固定绝对时刻：A = 2026-09-27T23:00Z（+08 的 09-28 07:00、+09 的 09-28 08:00）
	const A = Date.UTC(2026, 8, 27, 23, 0);
	const B = Date.UTC(2026, 9, 21, 3, 59);          // +08 10-21 11:59 / +09 10-21 12:59 / UTC 10-21 03:59
	const B2 = Date.UTC(2026, 9, 22, 3, 59);
	const now = new Date(Date.UTC(2026, 9, 21, 4, 0));   // 面板传入的"现在"（本用例只用于推断年份）

	// ── ① 悬停 = 源站墙钟原文：输出只由 tz 决定 ────────────────────────────────
	const items = [
		{ name: "活动甲", startTs: A, endTs: B },
		{ name: "活动乙", startTs: A, endTs: B2 }
	];
	{
		const jst = buildEventHover(items, 0, "Asia/Tokyo");
		check("活动悬停按源站 tz 渲染（Asia/Tokyo → 09-28 08:00 ~ 10-21 12:59）",
			jst === "活动甲   09-28 08:00 ~ 10-21 12:59\n活动乙   09-28 08:00 ~ 10-22 12:59", JSON.stringify(jst));
		const utc = buildEventHover(items, 0, "UTC");
		check("同一个 ts 换成 tz=UTC → 09-27 23:00 ~ 10-21 03:59（悬停不写死 +08，也不看本机时区）",
			utc === "活动甲   09-27 23:00 ~ 10-21 03:59\n活动乙   09-27 23:00 ~ 10-22 03:59", JSON.stringify(utc));
		const cst = buildEventHover(items, 0, "Asia/Shanghai");
		check("同一个 ts 用 tz=Asia/Shanghai → 09-28 07:00 ~ 10-21 11:59",
			cst === "活动甲   09-28 07:00 ~ 10-21 11:59\n活动乙   09-28 07:00 ~ 10-22 11:59", JSON.stringify(cst));
		check("tz 真的生效了（三串互不相同 ≠ 忽略参数退回本机时区）", jst !== utc && utc !== cst && jst !== cst);
	}
	{
		// 窗口完全相同的分支（档期只在末尾写一遍）同样要按 tz 渲染
		const same = buildEventHover([{ name: "甲", startTs: A, endTs: B }, { name: "乙", startTs: A, endTs: B }], 0, "UTC");
		check("同窗口活动：名称各一行、档期只在末尾写一遍（且按 tz 渲染）",
			same === "甲\n乙\n09-27 23:00 ~ 10-21 03:59", JSON.stringify(same));
		// permanentCount 仍是第 2 参（tz 放第 3 参就是为了不让老调用错位）
		check("permanentCount 仍是第 2 参（第 3 参 tz 不影响常驻计数行）",
			buildEventHover([{ name: "唯一", startTs: A, endTs: B }], 2, "UTC") === "以及常驻活动 2 项");
	}
	{
		const pools = [
			{ name: "池甲", label: "池甲：角色", startTs: A, endTs: B },
			{ name: "池乙", label: "池乙：角色", startTs: A, endTs: B2 }
		];
		const jst = buildPoolHover(pools, "Asia/Tokyo");
		check("卡池悬停按源站 tz 渲染（Asia/Tokyo）",
			jst === "池甲：角色\n09-28 08:00 ~ 10-21 12:59\n池乙：角色\n09-28 08:00 ~ 10-22 12:59", JSON.stringify(jst));
		const utc = buildPoolHover(pools, "UTC");
		check("卡池悬停按源站 tz 渲染（UTC）",
			utc === "池甲：角色\n09-27 23:00 ~ 10-21 03:59\n池乙：角色\n09-27 23:00 ~ 10-22 03:59", JSON.stringify(utc));
		const samePools = buildPoolHover([{ name: "甲", startTs: A, endTs: B }, { name: "乙", startTs: A, endTs: B }], "UTC");
		check("同窗口卡池：档期只在末尾写一遍（且按 tz 渲染）",
			samePools === "甲\n乙\n09-27 23:00 ~ 10-21 03:59", JSON.stringify(samePools));
	}

	// ── ② 外显 = 本机时区：localWin 与"不传 tz 的 fmtWindow"必须是同一个结果 ──
	{
		check("localWin(startTs, endTs) == fmtWindow(startTs, endTs)（不传 tz = 本机时区）",
			localWin(A, B) === fmtWindow(A, B), JSON.stringify([localWin(A, B), fmtWindow(A, B)]));
		check("localWin 拿不到绝对档期 → null（调用方据此回落源站原文）",
			localWin(void 0, B) === null && localWin(A, null) === null && localWin(null, null) === null && localWin("x", "y") === null);
	}

	// ── ③ 落盘数据只有文本：localWinText 用「源站墙钟文本 + tz」还原后再按本机渲染 ──
	{
		const src = "09-28 07:00 ~ 10-21 12:59";                 // 源站（+09）墙钟原文
		// 与独立路径交叉验证：sourceInstant（墙钟+tz → 绝对时刻）→ fmtWindow（→ 本机墙钟）
		const expect = fmtWindow(sourceInstant(2026, 9, 28, 7, 0, "Asia/Tokyo"), sourceInstant(2026, 10, 21, 12, 59, "Asia/Tokyo"));
		check("源站文本 + tz → 本机时区文本（与 sourceInstant + fmtWindow 的独立算法一致）",
			localWinText(src, "Asia/Tokyo", now) === expect, JSON.stringify([localWinText(src, "Asia/Tokyo", now), expect]));

		// 源站时区 == 本机时区 → 原文就是结果（不重排、不改格式）。动态取本机时区，因而不锁死 +08。
		const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
		check(`源站 tz == 本机 tz（${localTz}）→ 原文原样返回`,
			localWinText("09-28 07:00 ~ 10-21 11:59", localTz, now) === "09-28 07:00 ~ 10-21 11:59",
			JSON.stringify(localWinText("09-28 07:00 ~ 10-21 11:59", localTz, now)));

		// 换算不了的一律 null（宁可显示源站原文，也不显示一个错的本地钟点）
		check("没有 tz（自定义条目）→ null，回落原文", localWinText("09-28 07:00 ~ 10-21 11:59", null, now) === null);
		check("带年份的跨年文本 → null（解析不了就不换算）", localWinText("2026-12-28 06:00 ~ 2027-01-05 04:59", "Asia/Tokyo", now) === null);
		check("不是区间文本（「版本更新后 ~ …」/「长期」/ 空串）→ null",
			localWinText("版本更新后 ~ 10-21 11:59", "Asia/Tokyo", now) === null
			&& localWinText("长期", "Asia/Tokyo", now) === null
			&& localWinText("", "Asia/Tokyo", now) === null);
	}

	// ── ④ localDatesOf：卡池侧优先绝对档期；活动侧**不**拿卡池的 startTs 冒充 ──
	{
		const g = {
			startTs: A, endTs: B,
			bannerDates: "09-28 07:00 ~ 10-21 12:59",
			eventDates: "10-02 00:00 ~ 10-31 23:59",
			tz: "Asia/Tokyo"
		};
		check("卡池侧：有 startTs/endTs 就用它们（本机时区）",
			localDatesOf(g, true, now) === fmtWindow(A, B), JSON.stringify(localDatesOf(g, true, now)));
		check("活动侧：没有对应 ts 字段，走「eventDates + tz」（不冒用卡池 startTs）",
			localDatesOf(g, false, now) === localWinText(g.eventDates, g.tz, now), JSON.stringify(localDatesOf(g, false, now)));
		const noTs = { bannerDates: "09-28 07:00 ~ 10-21 12:59", tz: "Asia/Tokyo" };
		check("卡池侧没有 ts（落盘数据常态）→ 走「bannerDates + tz」",
			localDatesOf(noTs, true, now) === localWinText(noTs.bannerDates, "Asia/Tokyo", now));
		check("连 tz 都没有 → null（渲染层回落 bannerDates / eventDates 原文）",
			localDatesOf({ bannerDates: "09-28 07:00 ~ 10-21 12:59", tz: null }, true, now) === null
			&& localDatesOf(null, true, now) === null);
	}
}
