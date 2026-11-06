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

import { check, section, setFetchImpl, useFixtures } from "./harness.mjs";
import { T } from "./load.mjs";

export default async function run() {
	section("时区口径（外显=本机时区换算 / 悬停=源站墙钟原文）");
	const { fmtWindow, sourceInstant, buildEventHover, buildPoolHover, localWin, localWinText, localDatesOf, scheduleDateHover, scheduleNormalize, tickerItemsOf } = T;

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

	// ── ⑤ 新面板**日期格**悬停（原待办第 9 项，2026-10-28 已完成）：失败 / 沿用旧值 / 无数据 / 正常 ────────────
	// 与名称格（hoverTextOf）同口径：失败复用 sideFailText 的文案；正常态**不补任何提示**。
	// 全部用固定 now 与相对 _okAt，不依赖运行环境时区。
	{
		const now5 = new Date(Date.UTC(2026, 9, 21, 4, 0));
		const base = "09-28 07:00 ~ 10-21 12:59";                  // 源站墙钟原文（悬停用）
		const it = (g, extra) => ({ g, isG: true, side: "gacha", rawSrc: base, raw: base, ...extra });

		const normal = scheduleDateHover(it({}), now5);
		check("日期格·正常：只有源站原文，不补「（）」结论（反向断言：没有失败/沿用/无数据字样）",
			normal === base && !normal.includes("（") && !/失败|沿用|上次成功|无数据/.test(normal), JSON.stringify(normal));

		const failed = scheduleDateHover(it({ gachaFail: { kind: "down", reason: "网络不通" }, gachaStale: true, _okAt: now5.getTime() - 3 * 864e5 }), now5);
		check("日期格·本轮卡池抓取失败 + 沿用旧值：逐字「卡池失败：网络不通，日期为沿用旧值」+「数据来自上次成功抓取 3 天前」",
			failed === base + "\n（卡池失败：网络不通，日期为沿用旧值；数据来自上次成功抓取 3 天前）", JSON.stringify(failed));

		const stale = scheduleDateHover(it({ gachaStale: true, _okAt: now5.getTime() - 2 * 3600e3 }), now5);
		check("日期格·仅沿用旧值（本轮无报错）：说明「数据来自上次成功抓取 2 小时前」",
			stale === base + "\n（数据来自上次成功抓取 2 小时前）", JSON.stringify(stale));

		const ev = scheduleDateHover({ g: { eventFail: { kind: "down", reason: "超时" } }, isG: false, side: "event", rawSrc: base }, now5);
		check("日期格·活动侧失败用活动文案（「活动失败：超时」，不串成卡池）",
			ev === base + "\n（活动失败：超时）", JSON.stringify(ev));

		const nomatch = scheduleDateHover(it({ gachaFail: { kind: "nomatch" }, gachaStale: true, _okAt: now5.getTime() - 4 * 864e5 }), now5);
		check("日期格·未命中 + 沿用旧值：复用「新卡池未公布」，仍标明日期是旧值",
			nomatch === base + "\n（新卡池未公布，日期为沿用旧值；数据来自上次成功抓取 4 天前）", JSON.stringify(nomatch));

		check("日期格·该侧根本没有数据：说明「无数据」",
			scheduleDateHover(null, now5) === "（无数据）" && scheduleDateHover(void 0, now5) === "（无数据）");
	}

	// ── ⑥ 外显文本 `show` 的口径（2026-11-01）：表格格子 / 「近期」/ 留白卡必须**同文** ────────────
	// 表格格子里外显的是 scheduleNormalize 的 `show`（卡池侧有 roles ⇒ 去修饰的角色名，否则池名；
	// 活动侧 = 活动名）；`title` 是**源站原文**（卡池侧 = 池名），只给悬停用。
	// 「近期」与留白卡原来读 `title` ⇒ 同一口卡池"表格显角色名、近期显池名"（用户 2026-11-01 指出）。
	// 这里把 `show` 的语义本体钉住，三处入口（+ 侧栏轮播）才有共同的基准。
	{
		const now6 = new Date(Date.UTC(2026, 9, 21, 4, 0));      // +09 10-21 13:00 / UTC 10-21 04:00
		const g = {
			id: "genshin", name: "原神", tz: "Asia/Tokyo",
			banner: "「轰隆雷鸣波·伊涅芙」",
			roles: "「轰隆雷鸣波·伊涅芙」（风）",
			bannerDates: "10-21 09:00 ~ 10-22 09:00",                // 源站（+09）墙钟 ⇒ 20 小时后结束
			bannerDatesRaw: "2026-10-21 09:00 ~ 2026-10-22 09:00"    // 悬停用的原始原文（带年份）
		};
		const pool = scheduleNormalize(g, "gacha", now6);
		check("卡池侧有 roles：show = 去修饰的角色名（表格格子的外显），title 仍是源站池名",
			pool.show === "伊涅芙" && pool.title === g.banner, JSON.stringify([pool.show, pool.title]));
		check("这条数据确实是「两套文本」（show ≠ title，上一条断言才有意义）", pool.show !== pool.title);
		check("卡池侧无 roles：show 退回 title（池名），不外显空串",
			scheduleNormalize({ ...g, roles: "" }, "gacha", now6).show === g.banner);
		const ev = scheduleNormalize({ id: "genshin", tz: "Asia/Tokyo", event: "「绮星盛会」", eventDates: g.bannerDates }, "event", now6);
		check("活动侧：show = title = 活动名（活动侧没有角色名这一层）",
			ev.show === "「绮星盛会」" && ev.title === "「绮星盛会」");

		// 活动侧「只给显示」的事项名（2026-11-06）：明日方舟兑换期 ⇒「<去重后的活动名> 兑换截止」。
		// `eventShow` 只换 `show` —— `title`（= 活动名）仍是源站原文，提醒标题 / 侧栏轮播 / 搜索读的是它。
		const evClaim = scheduleNormalize({
			id: "arknights", tz: "Asia/Shanghai", event: "支线故事：墟",
			eventDates: "11-07 03:59 ~ 11-10 03:59", eventShow: "支线故事：墟 兑换截止"
		}, "event", now6);
		check("活动侧有 `eventShow`（兑换期）：show = eventShow，title 仍是活动名",
			evClaim.show === "支线故事：墟 兑换截止" && evClaim.title === "支线故事：墟",
			JSON.stringify([evClaim.show, evClaim.title]));
		check("活动侧没有 `eventShow`（活动期 / 没有兑换期）：show 逐字退回活动名",
			scheduleNormalize({ id: "arknights", event: "支线故事：墟", eventDates: "10-24 16:00 ~ 11-07 03:59" }, "event", now6).show === "支线故事：墟");
		check("卡池侧不受 `eventShow` 影响：有 roles 仍显去修饰的角色名（活动字段串不到卡池列）",
			scheduleNormalize({ ...g, eventShow: "支线故事：墟 兑换截止" }, "gacha", now6).show === "伊涅芙",
			JSON.stringify(scheduleNormalize({ ...g, eventShow: "支线故事：墟 兑换截止" }, "gacha", now6).show));

		// 悬停侧**不受牵连**：orig 仍是「源站标题 + 源站墙钟原文」，rawSrc 仍是源站原文（外显才走本机时区）
		check("悬停文本仍是源站原文：orig = 池名 + bannerDatesRaw（没被 show 波及）",
			pool.orig === g.banner + "\n" + g.bannerDatesRaw, JSON.stringify(pool.orig));
		check("rawSrc 仍是源站墙钟原文；raw（外显档期）才是本机时区换算值",
			pool.rawSrc === g.bannerDates && pool.raw === localDatesOf(g, true, now6) && pool.raw !== pool.rawSrc,
			JSON.stringify([pool.rawSrc, pool.raw, localDatesOf(g, true, now6)]));

		// 侧栏轮播那一行的事项名（tickerItemsOf 的 `title` 字段）本来就按同一公式算 —— 钉住它，
		// 免得将来只改一处、表格与轮播又分叉（轮播读不到 show，字段名叫 title 但装的是外显文本）。
		const tick = tickerItemsOf([g], now6, 24);
		check("轮播那一行的事项名与表格同口径（tickerItemsOf.title === scheduleNormalize.show）",
			tick.length === 1 && tick[0].title === pool.show && tick[0].title !== g.banner,
			JSON.stringify(tick.map((x) => [x.key, x.title])));
	}

	// ── ⑦ 源站墙钟原文（`*Raw`）跨时区逐字相同（2026-11-07 修：`range2` / `fmtWindow` 漏传 tz）──────
	//
	// 为什么单独一条：这类字段的期望值**必须是字面量**，不能跟着当前进程的 Date 现算 ——
	// 本文件在 `TZ=UTC` 与 `TZ=Asia/Shanghai` 两道门禁下都会跑，"同一串字面量在两边都过"
	// 才是"跨时区相等"的真正含义（用本机 Date 现算的期望值会把 bug 一起算进去，永远绿）。
	//
	//   ① 明日方舟（PRTS 一览）：起点取自**文本列**（源站墙钟），终点只有 `data-time` 的 Unix 秒。
	//      修复前终点按**本机时区**渲染 ⇒ UTC 门禁下 `11-15 03:59` 变成 `11-14 19:59`（早 8 小时）。
	//   ② 重返未来 1999（前置有并列征集池）：正文 `M/D HH:MM` 是源站墙钟，解析与 `eventDatesRaw`
	//      的渲染都必须按源站 tz（Asia/Shanghai）；修复前两者都吃本机时区。
	section("源站墙钟原文（*Raw）跨时区逐字相同 —— 明日方舟 / 重返未来 1999");
	{
		const TZ_CN = "Asia/Shanghai";

		// ① 明日方舟：一行 PRTS 一览（表头含「时间」+ 三列 + data-time="开始秒,结束秒"）
		const END_TS = Date.UTC(2026, 10, 14, 19, 59);            // = 2026-11-15 03:59 +08
		const html = "<table><tr><th>活动开始时间</th><th>名称</th><th>分类</th></tr>"
			+ "<tr><td>2026-11-01 12:00</td>"
			+ "<td><a href=\"/w/%E6%B5%8B%E8%AF%95%E6%B4%BB%E5%8A%A8\">测试活动</a></td>"
			+ "<td><a title=\"分类:支线故事\">支线故事</a></td>"
			+ `<td data-time="${Date.UTC(2026, 9, 31, 16, 0) / 1000},${END_TS / 1000}"></td></tr></table>`;
		const ark = T.parsers["arknights"].collectPrtsEvents(html, TZ_CN);
		check("明日方舟：一览 raw =「11-01 12:00 ~ 11-15 03:59」（两端都是源站墙钟；TZ=UTC 与 +08 同串）",
			ark.length === 1 && ark[0].raw === "11-01 12:00 ~ 11-15 03:59",
			JSON.stringify(ark.map((x) => x.raw)));
		check("明日方舟：endTs 仍是正确绝对时刻（源站墙钟 +08 换算，渲染口径的修复没动时刻本身）",
			ark.length === 1 && ark[0].endTs === END_TS, String(ark[0] && ark[0].endTs));

		// ② 重返未来 1999：官方游戏内公告（noticecp）—— 两个并列征集池（同窗口）+ 一条活动 + 一条独立轮换池
		// ⚠️ 接口正文是"块数组"，`r99NoticeLines` 每块 stripping 后得**一行**（块内换行会被 `stripTags`
		//    压成空格）⇒ 段落标题必须**单独一块**，否则 `^「名称」类型$` 的段头判据匹配不到。
		const blocks = [
			{ content: "「夜歌与黎明」限定征集" },
			{ content: "6★角色「露西」" },
			{ content: "5★角色「米兰妮」" },
			{ content: "【征集时间】10/08 14:00 - 10/22 13:59" },
			{ content: "「夜歌与黎明」活动征集" },
			{ content: "6★角色「卡卡尼亚」" },
			{ content: "【征集时间】10/08 14:00 - 10/22 13:59" },
			{ content: "「夜歌与黎明」活动正篇" },
			{ content: "【活动时间】10/08 14:00 - 10/30 04:59" },
			{ content: "【商店兑换时间】10/08 14:00 - 11/02 04:59" }
		];
		const NOW_R99 = Date.UTC(2026, 9, 15, 4, 0);             // 2026-10-15 12:00 +08：两池与活动都覆盖
		const payload = {
			data: [
				{ beginTime: Date.UTC(2026, 9, 8, 6, 0), contentMap: { "zh-CN": { title: "2.0「夜歌与黎明」版本活动一览", content: JSON.stringify(blocks) } } },
				{ beginTime: Date.UTC(2026, 9, 14, 21, 0), endTime: Date.UTC(2026, 9, 28, 21, 0), contentMap: { "zh-CN": { title: "「星辉轮换」轮换征集开启！", content: "[]" } } }
			]
		};
		const prevImpl = useFixtures();
		// 代理通道的约定：transport.fetchViaProxy 期望 `{ status, body }` 包体（harness 会先 JSON.parse 再拆 body）。
		const proxyText = JSON.stringify({ status: 200, body: JSON.stringify(payload) });
		setFetchImpl(async () => ({ ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => proxyText, json: async () => JSON.parse(proxyText) }));
		T.setCoreEnv({ now: () => NOW_R99 });
		let r99 = null, r99err = null;
		try { r99 = await T.GACHA_FETCHERS["r1999"]("https://noticecp.example/api/notice", undefined, TZ_CN); }
		catch (e) { r99err = String((e && e.message) || e); }
		finally { setFetchImpl(prevImpl); T.setCoreEnv({ now: () => Date.now() }); }

		check("重返未来 1999：抓取器没抛（夹具载荷可解析）", r99err === null, String(r99err));
		check("1999 并列池：bannerDates = 源站墙钟「10-08 14:00 ~ 10-22 13:59」（TZ=UTC 与 +08 同串）",
			!!r99 && r99.bannerDates === "10-08 14:00 ~ 10-22 13:59", JSON.stringify(r99 && r99.bannerDates));
		check("1999 并列池：bannerDatesRaw 保留正文原文（`10/08 14:00 - 10/22 13:59`，不被重排）",
			!!r99 && r99.bannerDatesRaw === "10/08 14:00 - 10/22 13:59", JSON.stringify(r99 && r99.bannerDatesRaw));
		check("1999 活动：eventDates = eventDatesRaw = 源站墙钟「10-08 14:00 ~ 11-02 04:59」（跨 TZ 同串）",
			!!r99 && r99.eventDates === "10-08 14:00 ~ 11-02 04:59"
			&& r99.eventDatesRaw === "10-08 14:00 ~ 11-02 04:59",
			JSON.stringify(r99 && [r99.eventDates, r99.eventDatesRaw]));
		// 独立轮换池（正文只有图，`display` 是唯一档期文本，也是 `bannerDatesRaw` 的来源）也按源站 tz 渲染
		check("1999 独立轮换池：悬停里的档期 =「10-15 05:00 ~ 10-29 04:59」（源站 tz）",
			!!r99 && typeof r99.bannerHover === "string" && r99.bannerHover.includes("10-15 05:00 ~ 10-29 04:59"),
			JSON.stringify(r99 && r99.bannerHover));
		check("1999 并列池：悬停里两个征集池都在（同一窗口各自一行）",
			!!r99 && typeof r99.bannerHover === "string"
			&& r99.bannerHover.includes("「夜歌与黎明」限定征集") && r99.bannerHover.includes("「夜歌与黎明」活动征集"),
			JSON.stringify(r99 && r99.bannerHover));
	}
}
