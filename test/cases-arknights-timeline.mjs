// test/cases-arknights-timeline.mjs —— 明日方舟「时间旅行」回归：把一整个活动周期钉成常规门禁
//
// ── 这一套护栏为什么存在（2026-11-07 用户原话）──
// 「对明日方舟的修改进行充分的模拟验证，不要出现过了几天又乱成一坨的情况，不要搞一次性代码」。
// 背景：2026-11-01 ~ 11-07 这一周里，明日方舟那套「两阶段（活动 / 奖励领取）」被连着改了 5 次，
// 每次都是真机上"过几天才看出来"的毛病 ——
//   · 活动期好好的，一进兑换期整条活动**消失**（那时恰恰是奖励还没领的时候）；
//   · 兑换期那一行事项名拼成「视相博物馆：视相博物馆：演化」（分类前缀拼了两遍）；
//   · 提示框里同一个区间出现两遍 / 末尾又多出「活动名 ⏎ 只有区间」两行；
//   · 兑换期那条明明更急，却被一条还剩 15 天的活动挤出面板。
// 这些 bug 的共同点：**都不在"某一刻"错，而在"时间走过去"之后才错**。所以只测几个点是不够的
// —— 必须沿整条时间轴逐时刻跑完整链路（真抓取器 → payload → 面板归一 → 悬停 → 提醒 → 持久化），
// 把"任何时刻都不许乱"变成门禁里的常规用例，而不是临时探针。
//
// ── 时刻从哪来 ──
// 用真机 2026-11-07 那三条活动的**真实 SMW 响应**当作夹具（`test/fixtures/arknights-smw-events/`，
// 与 `cases-arknights-claim.mjs` 同一份；活动侧现在只有这一条数据链路：一次 `action=ask`）。
// 三条活动的窗口首尾相接，天然覆盖两阶段的全部边界
// （开场 / 活动结束 / 兑换期 / 兑换结束 / 只剩别的活动），所以 `MOMENTS` 表就是"活动周期"的形状：
//   视相博物馆：演化            10-24 16:00 ~ 11-07 03:59（兑换到 11-10 03:59）
//   登录活动：感谢庆典2026限时签到  11-01 12:00 ~ 11-15 03:59（**没有**兑换期 ⇒ 退化路径）
//   支线故事：时间啊，向前！      11-01 12:00 ~ 11-22 03:59（兑换到 11-29 03:59 ⇒ 兑换期 **7 天**）
// 期望值**不另抄一份手写表**：活动标签 / 分类都从夹具解析结果里取（`SNAPSHOT` / `CATEGORIES` / `CATEGORY_BY_LABEL`），
// 每个时刻只写"这一刻该看到什么"（阶段 / 外显区间 / 悬停逐字 / 提示行）。
//
// ── 每个时刻都查的六条不变量（改这里的任一条前先想清楚）──
//   ① 悬停文本：任意一行不重复、相邻两行不相同、不出现「名称单独一行 ⏎ 只有区间」的两行形态
//      （谓词与断言在 `test/lib-text.mjs`，与 `cases-arknights-claim.mjs` 共用同一份实现）；
//   ② 阶段正确：活动期没有 `eventShow`、`eventDates` = 活动区间；兑换期 `eventShow` = 「<去重后的活动名> 兑换截止」、
//      `eventDates` = 兑换区间；结束后该活动不再作为外显；
//   ③ 名称不重复：`event` / `eventShow` / 悬停行 / 提示行锚点的标签都不许带两层分类前缀
//      （`doubledCategoryPrefixOf` + `labelOf` 幂等两条一起判 —— 只有幂等抓不到"多加了一层"，见 lib-text.mjs 注释）；
//   ④ 提醒：`remindItemsOf` + `remindTickOf` 在「活动结束前 72h」「兑换截止前 72h」各发一次、key 不同、
//      且**同一份 lastData 不刷新**也各发一次；
//   ⑤ 不崩：抓取器任何时刻都不抛；退化路径（无「兑换结束时间」字段 / 批量失败）返回**改造前**那个数据形状；
//   ⑥ 持久化：载荷喂给 `createEngine().getCached()` 归一后，现有字符串字段一个不丢，两个阶段的新字段也能读回。
//
// ── 加新活动来源 / 新字段 / 新阶段时该改哪里 ──
//   1. **只是多一个来源**（别的游戏也要两阶段）⇒ 不要在 `30-game-hypergryph.js` 里加开关，也不要往本文件
//      塞该游戏的夹具；本文件守的是 **arknights 这一条链路**。新材料放到对应来源自己的 `cases-*.mjs`，
//      但悬停结构判定请继续用 `test/lib-text.mjs`（别再写第三份）。
//   2. **payload 新增字段**（如以后的多活动数组 `events`、或第三种阶段）⇒ 同时在四处登记 + 一处加断言：
//      `src/client/50-refresh.js` 的 `EVENT_FIELDS`、`src/client/engine-head.js` 的 `CONTENT_FIELDS`
//      （产物里见 `packages/core/core.mjs`）、`README_Dev.md` 的「时间轴不变量」一节，以及
//      **本文件 §五 的 `PERSIST_FIELDS`**（少了它，测试不会红，只会悄悄少一个字段）。
//   3. **时间轴上新增一种边界**（例如"活动开始前 2 小时"、跨年兑换期）⇒ 往 `MOMENTS` / `PAYLOAD_CASES`
//      表里加一行，**不要**在下面写新的 if 分支；每行只描述"这一刻该看到什么"。
//   4. **悬停排版变了**（例如允许第三行说明）⇒ 改 `test/lib-text.mjs` 的 `assertHoverTextInvariants`
//      与 `test/harness.mjs` 的 `assertHoverConvention`，本文件不用动。
//
// ⚠️ 本文件**不**碰 `src/`：它只读构建产物（`lib/client.js` 的 `__regression`）与夹具。

import { check, section, useFixtures, setFetchImpl, fixtureBody } from "./harness.mjs";
import { T } from "./load.mjs";
import { createEngine } from "../packages/core/core.mjs";
import {
	assertHoverTextInvariants, bareTwoLineFormOf, doubledCategoryPrefixOf,
	dupLinesOf, eventRowsOf, linesOf, noteAnchorsOf, noteRowsOf
} from "./lib-text.mjs";

const TZ_CN = "Asia/Shanghai";
const AT = (iso) => Date.parse(iso);

// 夹具：真机 2026-11-07 那三条活动（真实 SMW 响应子集，与 cases-arknights-claim.mjs 同一份）。
// 活动侧只剩这一条数据链路 ⇒ 走 map.json 的登记，不需要任何 overrides。
const SMW_URL = T.parsers["arknights"].ARKNIGHTS_SMW_URL;
const P = T.parsers["arknights"];

// 夹具解析出来的"事实"（不手抄第二份：条目增删时这里自动跟着走）
const SNAPSHOT = P.parseArknightsSmwEvents(JSON.parse(fixtureBody(SMW_URL)), TZ_CN);
const CATEGORIES = [...new Set(SNAPSHOT.map((x) => x.category))];
const CATEGORY_BY_LABEL = new Map(SNAPSHOT.map((x) => [P.labelOf(x.category, x.name), x.category]));
// 夹具里那条**没有**「兑换结束时间」的活动（退化路径的代表）。
// ⚠️ SMW 给的 `name` 是**页名**（"感谢庆典2026限时签到"），面板标签才带分类前缀
//    （"登录活动：感谢庆典2026限时签到"）—— 两者差一个前缀，别拿标签去查 name。
const NO_CLAIM_NAME = "感谢庆典2026限时签到";
const NO_CLAIM_LABEL = "登录活动：感谢庆典2026限时签到";

const okBody = (body) => ({
	ok: true, status: 200, headers: { get: () => "application/json" },
	text: async () => body, json: async () => JSON.parse(body)
});

// 装一层"记账 + 可失败"的 transport（走夹具），并记录每次真实请求。
// useFixtures() 先装全局 fetch 兜底，保证这一段万一漏网也不会打真网络。
// mode: "ok"（夹具）| "http"（HTTP 503）| "bad"（没有 query 的 JSON）
function installTransport({ mode = "ok" } = {}) {
	const seen = [];
	setFetchImpl(async (url) => {
		const u = String(url);
		seen.push(u);
		if (mode === "http") return { ok: false, status: 503, headers: { get: () => null }, text: async () => "", json: async () => ({}) };
		if (mode === "bad") return okBody(JSON.stringify({ error: { code: "smw-error", info: "query failed" } }));
		if (mode === "empty") return okBody(JSON.stringify({ query: { results: {} } }));
		if (!u.startsWith(SMW_URL)) throw new Error("unexpected-url:" + u);
		return okBody(fixtureBody(SMW_URL));
	});
	return seen;
}

// 固定 now，跑一遍**真实抓取器**；返回 { data, err, seen }（err 非 null = 抓取器抛了 ⇒ ⑤ 不崩那条红）
async function fetchAt(nowIso, { mode = "ok" } = {}) {
	const seen = installTransport({ mode });
	T.setCoreEnv({ now: () => AT(nowIso) });
	let data = null, err = null;
	try {
		data = await T.EVENT_FETCHERS["arknights"].default(SMW_URL, undefined, TZ_CN);
	} catch (e) {
		err = String((e && e.message) || e);
	}
	return { data, err, seen };
}

// 面板条目（与 81-schedule-model.js 的 scheduleNormalize 同一入口；title / show / rawSrc 就是悬停读的那几个字段）
const recOf = (pl) => Object.assign({ id: "arknights", name: "明日方舟" }, pl);
function normalizeOf(pl, nowIso) {
	return T.scheduleNormalize(recOf(pl), "event", new Date(AT(nowIso)));
}
// 表格格子的悬停全文（88 → 82-schedule-view.js 的 hoverTextOf：base = eventHover，为空才用 title ⏎ rawSrc 兜底）
function cellHoverOf(pl, nowIso) {
	const it = normalizeOf(pl, nowIso);
	const base = pl.eventHover || "";
	const own = [it.title, it.rawSrc || it.raw].filter(Boolean).join("\n");
	return T.scheduleHoverNote(base || own, recOf(pl), false) || "—";
}
// 「近期」行的悬停全文（81-schedule-model.js 的 scheduleHoverText）
function rowHoverOf(pl, nowIso) {
	return T.scheduleHoverText(normalizeOf(pl, nowIso));
}

// ── 时间表（数据驱动：一个时刻一行；断言在下面统一跑，不写 10 段 if）────────────────
// 悬停/提示行的逐字基线先在表外命名，避免同一段长文本抄三遍（三条兑换期时刻的期望完全相同）。
const HOVER_CLAIM = "视相博物馆：演化 兑换截止   11-07 03:59 ~ 11-10 03:59\n"
	+ "登录活动：感谢庆典2026限时签到   11-01 12:00 ~ 11-15 03:59\n"
	+ "支线故事：时间啊，向前！   11-01 12:00 ~ 11-22 03:59";
const NOTES_CLAIM = "支线故事：时间啊，向前！\n支线故事：时间啊，向前！ 兑换截止   11-29 03:59";
const HOVER_EVENT_3 = "视相博物馆：演化   10-24 16:00 ~ 11-07 03:59\n"
	+ "登录活动：感谢庆典2026限时签到   11-01 12:00 ~ 11-15 03:59\n"
	+ "支线故事：时间啊，向前！   11-01 12:00 ~ 11-22 03:59";
const NOTES_EVENT_3 = "视相博物馆：演化\n视相博物馆：演化 兑换截止   11-10 03:59\n"
	+ "支线故事：时间啊，向前！\n支线故事：时间啊，向前！ 兑换截止   11-29 03:59";
const HOVER_AFTER_CLAIM = "登录活动：感谢庆典2026限时签到   11-01 12:00 ~ 11-15 03:59\n"
	+ "支线故事：时间啊，向前！   11-01 12:00 ~ 11-22 03:59";
const NOTES_START_ONLY = "视相博物馆：演化\n视相博物馆：演化 兑换截止   11-10 03:59";

const MOMENTS = [
	{
		key: "M1-before-start", now: "2026-10-23T16:00:00+08:00",
		desc: "活动开始**前 1 天**（一览里三条都还没开始）", expectNull: true
	},
	{
		key: "M2-start-plus-1h", now: "2026-10-24T17:00:00+08:00",
		desc: "活动开始**后 1 小时**（当期只有视相一条 ⇒ 悬停走单条兜底）",
		phase: "event", event: "视相博物馆：演化",
		eventDates: "10-24 16:00 ~ 11-07 03:59", show: null,
		claimDates: "11-07 03:59 ~ 11-10 03:59",
		hover: "", notes: NOTES_START_ONLY
	},
	{
		key: "M3-event-end-minus-6h", now: "2026-11-06T21:59:00+08:00",
		desc: "活动结束**前 6 小时**（三条都在活动期；外显按类别档位仍是支线故事）",
		phase: "event", event: "支线故事：时间啊，向前！",
		eventDates: "11-01 12:00 ~ 11-22 03:59", show: null,
		claimDates: "11-22 03:59 ~ 11-29 03:59",
		hover: HOVER_EVENT_3, notes: NOTES_EVENT_3
	},
	{
		key: "M4-claim-plus-1min", now: "2026-11-07T04:00:00+08:00",
		desc: "活动结束**后 1 分钟**（视相刚进兑换期 ⇒ 外显必须切到它）",
		phase: "claim", event: "视相博物馆：演化",
		eventDates: "11-07 03:59 ~ 11-10 03:59", show: "视相博物馆：演化 兑换截止",
		claimDates: "11-07 03:59 ~ 11-10 03:59",
		hover: HOVER_CLAIM, notes: NOTES_CLAIM
	},
	{
		key: "M5-claim-mid", now: "2026-11-08T12:00:00+08:00",
		desc: "兑换期**中间**（视相仍在兑换期，外显不变）",
		phase: "claim", event: "视相博物馆：演化",
		eventDates: "11-07 03:59 ~ 11-10 03:59", show: "视相博物馆：演化 兑换截止",
		claimDates: "11-07 03:59 ~ 11-10 03:59",
		hover: HOVER_CLAIM, notes: NOTES_CLAIM
	},
	{
		key: "M6-claim-end-minus-1h", now: "2026-11-10T02:59:00+08:00",
		desc: "兑换结束**前 1 小时**（最后一个还能领的时刻）",
		phase: "claim", event: "视相博物馆：演化",
		eventDates: "11-07 03:59 ~ 11-10 03:59", show: "视相博物馆：演化 兑换截止",
		claimDates: "11-07 03:59 ~ 11-10 03:59",
		hover: HOVER_CLAIM, notes: NOTES_CLAIM
	},
	{
		key: "M7-claim-end-plus-1h", now: "2026-11-10T04:59:00+08:00",
		desc: "兑换结束**后 1 小时**（视相整条消失，只剩别的活动）",
		phase: "event", event: "支线故事：时间啊，向前！",
		eventDates: "11-01 12:00 ~ 11-22 03:59", show: null,
		claimDates: "11-22 03:59 ~ 11-29 03:59",
		hover: HOVER_AFTER_CLAIM, notes: NOTES_CLAIM,
		absent: ["视相博物馆：演化"]
	},
	{
		key: "M9-long-claim-day4", now: "2026-11-25T12:00:00+08:00",
		desc: "**兑换期第 4 天**（时间啊：11-22 03:59 结束、11-29 03:59 才截止 = 兑换期 **7 天** ⇒ 长于 3 天也不许消失）",
		phase: "claim", event: "支线故事：时间啊，向前！",
		eventDates: "11-22 03:59 ~ 11-29 03:59", show: "支线故事：时间啊，向前！ 兑换截止",
		claimDates: "11-22 03:59 ~ 11-29 03:59",
		hover: "", notes: null
	},
	{
		key: "M10-long-claim-last-hour", now: "2026-11-29T02:59:00+08:00",
		desc: "兑换期第 7 天（**最后一个还能领的时刻**；兑换期长于 3 天也不能提前消失）",
		phase: "claim", event: "支线故事：时间啊，向前！",
		eventDates: "11-22 03:59 ~ 11-29 03:59", show: "支线故事：时间啊，向前！ 兑换截止",
		claimDates: "11-22 03:59 ~ 11-29 03:59",
		hover: "", notes: null
	},
	{
		key: "M11-all-over", now: "2026-11-30T12:00:00+08:00",
		desc: "整个周期结束（兑换也过了 ⇒ 未公布；一次刷新仍然只有 1 条请求）",
		expectNull: true
	}
];

// 归一白名单里"现有"的字符串字段（改造前就有）—— 一个都不许因为两阶段改造而丢
const PERSIST_BASE = ["event", "eventDates", "eventDatesRaw", "eventHover"];
// 两阶段新增的三个"只给某一侧用"的字段（缺的时候归一成空串，形状固定）
const PERSIST_NEW = ["eventClaimDates", "eventShow", "eventHoverExtra"];

// 跑完一个时刻的全部不变量
async function runMoment(m) {
	const label = `${m.key}｜${m.desc}｜now=${m.now}`;
	const r = await fetchAt(m.now);

	// ⑤ 不崩
	check(`${label}｜不崩：抓取器不抛异常`, r.err === null,
		`不变量=不崩｜期望=无异常｜实测=${r.err}`);
	// 链路：活动侧**只有一条** `action=ask`（原来的一览 + 批量 wikitext 两次已整段删除）。
	check(`${label}｜链路：活动侧只有 **1 条** prts 请求（SMW 单请求）`,
		r.seen.length === 1 && r.seen[0] === SMW_URL + "&origin=*",
		`不变量=请求量｜期望=1 次（action=ask）｜实测=${JSON.stringify(r.seen.map((u) => u.slice(0, 56)))}`);

	if (m.expectNull) {
		check(`${label}｜阶段：没有覆盖 now 的条目 ⇒ 载荷为 null（未公布，不硬凑过期档期）`,
			r.data === null, `不变量=阶段｜期望=null｜实测=${JSON.stringify(r.data)}`);
		check(`${label}｜阶段：null 时连一个半截字段都没有`,
			r.data === null || Object.keys(r.data).length === 0,
			`不变量=阶段｜期望=无字段｜实测=${JSON.stringify(r.data && Object.keys(r.data))}`);
		return;
	}

	const pl = r.data;
	// ② 阶段正确
	check(`${label}｜阶段：外显事项名 event`,
		!!pl && pl.event === m.event,
		`不变量=阶段·外显｜期望=${JSON.stringify(m.event)}｜实测=${JSON.stringify(pl && pl.event)}`);
	check(`${label}｜阶段：外显区间 eventDates`,
		!!pl && pl.eventDates === m.eventDates,
		`不变量=阶段·区间｜期望=${JSON.stringify(m.eventDates)}｜实测=${JSON.stringify(pl && pl.eventDates)}`);
	check(m.show
		? `${label}｜阶段：兑换期 ⇒ eventShow =「${m.show}」`
		: `${label}｜阶段：活动期 / 无兑换期 ⇒ **没有** eventShow 键`,
		!!pl && (m.show ? pl.eventShow === m.show : !("eventShow" in pl)),
		`不变量=阶段·事项名｜期望=${JSON.stringify(m.show)}｜实测=${JSON.stringify(pl && pl.eventShow)}｜载荷键=${JSON.stringify(pl && Object.keys(pl))}`);
	check(m.claimDates
		? `${label}｜阶段：eventClaimDates = 活动结束 ~ 兑换结束（提醒侧第二条 deadline）`
		: `${label}｜阶段：**没有** eventClaimDates 键`,
		!!pl && (m.claimDates ? pl.eventClaimDates === m.claimDates : !("eventClaimDates" in pl)),
		`不变量=阶段·双 deadline｜期望=${JSON.stringify(m.claimDates)}｜实测=${JSON.stringify(pl && pl.eventClaimDates)}`);
	check(`${label}｜阶段：eventDatesRaw ${m.phase === "claim" ? "= eventDates（格子 tooltip 与格子里显示不能互相打脸）" : "非空（源站墙钟原文）"}`,
		!!pl && (m.phase === "claim" ? pl.eventDatesRaw === pl.eventDates : typeof pl.eventDatesRaw === "string" && pl.eventDatesRaw !== ""),
		`不变量=阶段·日期格｜期望=${JSON.stringify(m.phase === "claim" ? (pl && pl.eventDates) : "非空")}｜实测=${JSON.stringify(pl && pl.eventDatesRaw)}`);

	// ① 悬停逐字基线 + 结构不变量（两条路径：表格格子 / 「近期」行）
	check(`${label}｜悬停：eventHover 逐字基线`,
		!!pl && pl.eventHover === m.hover,
		`不变量=悬停原文｜期望=${JSON.stringify(m.hover)}｜实测=${JSON.stringify(pl && pl.eventHover)}`);
	check(m.notes == null
		? `${label}｜悬停：**没有** eventHoverExtra 键（没有兑换期就没有提示行）`
		: `${label}｜悬停：eventHoverExtra 逐字基线`,
		!!pl && (m.notes == null ? !("eventHoverExtra" in pl) : pl.eventHoverExtra === m.notes),
		`不变量=提示行｜期望=${JSON.stringify(m.notes)}｜实测=${JSON.stringify(pl && pl.eventHoverExtra)}`);

	const single = !!pl && pl.eventHover === "";
	for (const [pathLabel, txt] of [["表格格子", cellHoverOf(pl, m.now)], ["「近期」行", rowHoverOf(pl, m.now)]]) {
		assertHoverTextInvariants(`${label}｜悬停（${pathLabel}）`, txt, { singleActivity: single });
	}

	// ③ 名称不重复（分类前缀不得出现两次；labelOf 幂等兜第二道）
	const labels = [pl.event, pl.eventShow && pl.eventShow.replace(/ 兑换截止$/, "")]
		.concat(eventRowsOf(pl.eventHover || "").map((row) => row.label))
		.concat(noteAnchorsOf(pl.eventHoverExtra));
	const uniqLabels = [...new Set(labels.filter(Boolean))];
	const doubled = uniqLabels.filter((L) => doubledCategoryPrefixOf(L, CATEGORIES) !== "");
	check(`${label}｜名称：分类前缀不出现两次（${CATEGORIES.join(" / ")}）`,
		doubled.length === 0,
		`不变量=名称去重｜期望=无双重前缀（如「视相博物馆：视相博物馆：演化」）｜实测=${JSON.stringify(doubled)}`);
	const nonIdem = uniqLabels.filter((L) => {
		const category = CATEGORY_BY_LABEL.get(L);
		return category != null && T.parsers["arknights"].labelOf(category, L) !== L;
	});
	check(`${label}｜名称：labelOf 幂等（对各自分类再跑一次必须不变）`,
		nonIdem.length === 0,
		`不变量=labelOf 幂等｜期望=原样返回｜实测=${JSON.stringify(nonIdem)}`);

	// 提示行：每两条一组（锚点 ⏎ 提示行），锚点必须能在悬停里定位
	const anchors = noteAnchorsOf(pl.eventHoverExtra);
	const badAnchors = anchors.filter((a) => {
		const hoverLines = linesOf(pl.eventHover || "");
		return !hoverLines.some((l) => l === a || l.indexOf(a + "   ") === 0);
	});
	check(`${label}｜提示行：锚点数 = 提示行数（每两条一组，不会落单）`,
		anchors.length === noteRowsOf(pl.eventHoverExtra).length,
		`不变量=提示行分组｜期望=${anchors.length} 个锚点 ⇒ ${noteRowsOf(pl.eventHoverExtra).length} 行提示｜实测=${JSON.stringify(pl.eventHoverExtra)}`);
	// 单条活动时 eventHover 按契约是空串（UI 走兜底两行式）⇒ 锚点没有可定位的行，不算错
	check(`${label}｜提示行：锚点都能对上悬停里那一行（否则会被堆到末尾、看不出是哪个活动的截止）`,
		single || badAnchors.length === 0,
		`不变量=提示行位置｜期望=每个锚点都命中一行｜实测=落空 ${JSON.stringify(badAnchors)}`);

	// 该消失的活动真的不在了
	if (m.absent) {
		const hay = [pl.event, pl.eventShow, pl.eventHover, pl.eventHoverExtra].filter(Boolean).join("\n");
		const still = m.absent.filter((a) => hay.indexOf(a) >= 0);
		check(`${label}｜阶段：结束的活动不再外显（连悬停/提示行里都不出现）`,
			still.length === 0,
			`不变量=结束后消失｜期望=不出现 ${JSON.stringify(m.absent)}｜实测=仍在 ${JSON.stringify(still)}`);
	}

	// ④ 提醒：条目能派生、key 唯一、判定不抛（两个 deadline 的深一层回归在 §四）
	const nowTs = AT(m.now);
	const games = { arknights: recOf(pl) };
	let items = null, itemsErr = null;
	try { items = T.remindItemsOf(games, nowTs, null); } catch (e) { itemsErr = String((e && e.message) || e); }
	const ends = (items || []).filter((it) => it.side === "event" && it.kind === "end");
	// ⚠️ 2026-11-07（P4 展平）：提醒**按条目**派生（每条活动一条 end），不再是"每侧最多两条"。
	// 所以期望值 = 这一侧仍有效（endTs > now）的条目数 + 与主窗口不同的兑换截止（phase）条数 ——
	// 由载荷的 `events` 数组算出来，不写死数字（夹具里活动条数会随时刻变）。
	const liveItems = ((pl && pl.events) || []).filter((x) => x && typeof x.endTs === "number" && x.endTs > nowTs);
	const claimExtra = liveItems.filter((x) => x.phase && x.phase.kind === "claim"
		&& typeof x.phase.endTs === "number" && x.phase.endTs > nowTs && x.phase.endTs !== x.endTs).length;
	const expectEnds = liveItems.length + claimExtra;
	check(`${label}｜提醒：条目可派生（活动侧 end = 在期条目 ${liveItems.length} + 兑换截止 ${claimExtra} 条）`,
		itemsErr === null && Array.isArray(items) && ends.length === expectEnds,
		`不变量=提醒派生｜期望=${expectEnds} 条 end｜实测=${itemsErr || JSON.stringify((items || []).map((it) => it.key))}`);
	check(`${label}｜提醒：key 互不相同（两个 deadline 各走各的去重状态）`,
		!!items && new Set(items.map((it) => it.key)).size === items.length,
		`不变量=提醒去重键｜期望=全不相同｜实测=${JSON.stringify((items || []).map((it) => it.key))}`);
	let tick = null, tickErr = null;
	try { tick = T.remindTickOf(nowTs, items || [], {}, {}); } catch (e) { tickErr = String((e && e.message) || e); }
	check(`${label}｜提醒：remindTickOf 在该时刻不抛`,
		tickErr === null && !!tick && Array.isArray(tick.toNotify),
		`不变量=提醒判定｜期望={ toNotify:[…], stateNext:{} }｜实测=${tickErr || JSON.stringify(tick)}`);

	// ⑥ 持久化：现有字段不许丢；两个阶段的新字段也要能读回
	const storage = {
		async get(k) {
			return k === "lastData"
				? JSON.stringify({ arknights: Object.assign({ name: "明日方舟" }, pl, { notAField: "x" }) })
				: void 0;
		},
		async set() {}
	};
	const got = await createEngine({ storage }).getCached();
	const back = got.games.arknights || {};
	const lostBase = PERSIST_BASE.filter((f) => (pl[f] || "") !== back[f]);
	check(`${label}｜持久化：现有字符串字段一个不丢（${PERSIST_BASE.join(" / ")}）`,
		lostBase.length === 0,
		`不变量=持久化·现有字段｜期望=与载荷逐字相同｜实测=变了/丢了 ${JSON.stringify(lostBase)}`);
	const lostNew = PERSIST_NEW.filter((f) => (pl[f] || "") !== back[f]);
	check(`${label}｜持久化：两阶段新字段原样读回（${PERSIST_NEW.join(" / ")}；缺 ⇒ 空串）`,
		lostNew.length === 0,
		`不变量=持久化·新字段｜期望=与载荷逐字相同｜实测=变了/丢了 ${JSON.stringify(lostNew)}`);
	check(`${label}｜持久化：白名单外字段被丢掉（证明上面两条不是"什么都留着"）`,
		!("notAField" in back), `不变量=白名单｜期望=notAField 不存在｜实测=${JSON.stringify(Object.keys(back))}`);
	check(`${label}｜持久化：若 P1 的多活动字段 events 已落地，它也必须能读回（数组）`,
		!("events" in back) || Array.isArray(back.events),
		`不变量=持久化·P1｜期望=不存在或为数组｜实测=${JSON.stringify(back.events)}`);
}

export default async function run() {
	section("明日方舟时间轴（一整个活动周期 × 六条不变量；数据表驱动）");
	useFixtures();   // 装全局 fetch 兜底（本段自己再包一层记账/可失败的 impl）

	// 先证明夹具与"事实"对得上，否则下面每个时刻的逐字基线都可能是"空对空"
	check("先决：夹具里恰好三条活动（视相 / 登录活动 / 时间啊）", SNAPSHOT.length === 3,
		JSON.stringify(SNAPSHOT.map((x) => x.banner)));
	check("先决：三条活动的分类都在（视相博物馆 / 登录活动 / 支线故事）",
		CATEGORIES.length === 3 && CATEGORIES.includes("视相博物馆") && CATEGORIES.includes("登录活动") && CATEGORIES.includes("支线故事"),
		JSON.stringify(CATEGORIES));
	check("先决：夹具里有一条**没有**「兑换结束时间」的活动（退化路径的代表）",
		SNAPSHOT.some((x) => x.name === NO_CLAIM_NAME && x.claimEndTs === null)
		&& CATEGORY_BY_LABEL.get(NO_CLAIM_LABEL) === "登录活动",
		JSON.stringify(SNAPSHOT.map((x) => [x.name, x.category])));

	for (const m of MOMENTS) await runMoment(m);

	// 反向证明（守卫不是空的）：把 2026-11-07 那两处真机毛病**造回**时间轴上，必须报红
	{
		const claimCell = HOVER_CLAIM + "\n支线故事：时间啊，向前！\n11-01 12:00 ~ 11-22 03:59";  // 旧 bug ② 的形状
		check("反向证明：末尾追加「活动名 ⏎ 只有区间」（旧 bug ②）会被「两行形态」判据抓到",
			bareTwoLineFormOf(claimCell).length === 1 && bareTwoLineFormOf(HOVER_CLAIM).length === 0,
			JSON.stringify(bareTwoLineFormOf(claimCell)));
		const dupCell = HOVER_CLAIM + "\n" + linesOf(HOVER_CLAIM)[0];                              // 旧 bug ① 的形状
		check("反向证明：同一个区间那一行出现两次（旧 bug ①）会被去重判据抓到",
			dupLinesOf(dupCell).length === 1 && dupLinesOf(HOVER_CLAIM).length === 0,
			JSON.stringify(dupLinesOf(dupCell)));
	}

	// ── §二 跨年：12-30 开始、次年 01-05 结束（直接喂 snapshot 给 payload 纯函数）──────────
	// 为什么不另造夹具：跨年要验的是**文本与换算**（`fmtWindow` 两端带年份 / 按 +08 解析次年字段），
	// 不是抓取链路 —— 链路已被上面 8 个时刻覆盖。夹具还要能重抓才有意义，这里没有新数据可抓。
	section("跨年（12-30 开始 / 次年 01-05 结束：活动期 · 兑换期 · 结束后）");
	{
		const p = P;
		const NEW_YEAR = "支线故事：跨年活动";
		const snap = [{
			name: NEW_YEAR, category: "支线故事", page: "跨年活动",
			startTs: AT("2026-12-30T16:00:00+08:00"), stageEndTs: AT("2027-01-05T03:59:00+08:00"),
			claimEndTs: AT("2027-01-08T03:59:00+08:00"),
			raw: "12-30 16:00 ~ 01-05 03:59"
		}];
		const ev = p.prtsEventPayload(snap, TZ_CN, AT("2027-01-02T12:00:00+08:00"));
		const cl = p.prtsEventPayload(snap, TZ_CN, AT("2027-01-06T12:00:00+08:00"));
		const after = p.prtsEventPayload(snap, TZ_CN, AT("2027-01-09T12:00:00+08:00"));

		// ① 次年日期：SMW 的 timestamp 是**绝对** Unix 秒 ⇒ 本来就不会"跨错年"；
		//    这里喂一条真实的跨年响应，钉住两端都按源站 tz 渲染成**带年份**的文本（不会被读成"结束早于开始"）。
		const nyJson = { query: { results: { "跨年活动": { printouts: {
			"活动类型": ["支线故事"],
			"活动开始时间": [{ timestamp: String(AT("2026-12-30T16:00:00+08:00") / 1000) }],
			"活动结束时间": [{ timestamp: String(AT("2027-01-05T03:59:00+08:00") / 1000) }],
			"兑换结束时间": [{ timestamp: String(AT("2027-01-08T03:59:00+08:00") / 1000) }]
		}, fulltext: "跨年活动" } } } };
		const parsed = p.parseArknightsSmwEvents(nyJson, TZ_CN);
		check("跨年｜换算：SMW timestamp 跨年也精确（次年 01-05 / 01-08 各就各位）",
			parsed.length === 1 && parsed[0].stageEndTs === AT("2027-01-05T03:59:00+08:00")
			&& parsed[0].claimEndTs === AT("2027-01-08T03:59:00+08:00"),
			`不变量=跨年换算｜期望=${AT("2027-01-05T03:59:00+08:00")} / ${AT("2027-01-08T03:59:00+08:00")}｜实测=${JSON.stringify(parsed)}`);
		check("跨年｜换算：跨年窗口的 raw 两端都带年份（2026-12-30 16:00 ~ 2027-01-05 03:59）",
			parsed.length === 1 && parsed[0].raw === "2026-12-30 16:00 ~ 2027-01-05 03:59",
			JSON.stringify(parsed[0] && parsed[0].raw));
		// ② 活动期：跨年窗口两端都带年份（否则「12-30 ~ 01-05」会被读成"结束早于开始"）
		check("跨年｜活动期：eventDates 两端带年份（2026-12-30 16:00 ~ 2027-01-05 03:59）",
			!!ev && ev.eventDates === "2026-12-30 16:00 ~ 2027-01-05 03:59",
			`不变量=跨年窗口文本｜期望=两端带年份｜实测=${JSON.stringify(ev && ev.eventDates)}`);
		check("跨年｜活动期：**没有** eventShow 键（还在活动期）", !!ev && !("eventShow" in ev),
			JSON.stringify(ev && Object.keys(ev)));
		check("跨年｜活动期：eventClaimDates = 次年 01-05 03:59 ~ 01-08 03:59（同年 ⇒ 不带年份）",
			!!ev && ev.eventClaimDates === "01-05 03:59 ~ 01-08 03:59",
			`不变量=双 deadline｜期望=${JSON.stringify("01-05 03:59 ~ 01-08 03:59")}｜实测=${JSON.stringify(ev && ev.eventClaimDates)}`);
		check("跨年｜活动期：提示行指向次年的兑换截止（01-08 03:59）",
			!!ev && ev.eventHoverExtra === NEW_YEAR + "\n" + NEW_YEAR + " 兑换截止   01-08 03:59",
			JSON.stringify(ev && ev.eventHoverExtra));
		// ③ 兑换期：外显切到兑换区间，事项名带「兑换截止」
		check("跨年｜兑换期：eventDates = 兑换区间（01-05 03:59 ~ 01-08 03:59）",
			!!cl && cl.eventDates === "01-05 03:59 ~ 01-08 03:59",
			`不变量=阶段·区间｜期望=${JSON.stringify("01-05 03:59 ~ 01-08 03:59")}｜实测=${JSON.stringify(cl && cl.eventDates)}`);
		check("跨年｜兑换期：eventShow =「支线故事：跨年活动 兑换截止」",
			!!cl && cl.eventShow === NEW_YEAR + " 兑换截止", JSON.stringify(cl && cl.eventShow));
		check("跨年｜兑换期：**不再**生成提示行（主行就是兑换区间）", !!cl && !("eventHoverExtra" in cl),
			JSON.stringify(cl && Object.keys(cl)));
		// ④ 结束后：整条消失（未公布）
		check("跨年｜兑换结束后：载荷为 null（不再作为外显）", after === null, JSON.stringify(after));
		// ⑤ 悬停不变量：跨年那几行也走同一份判定（单条活动 ⇒ 兜底两行式）
		for (const [label, pl] of [["跨年｜活动期", ev], ["跨年｜兑换期", cl]]) {
			assertHoverTextInvariants(`${label}（表格格子）`, cellHoverOf(pl, pl === ev ? "2027-01-02T12:00:00+08:00" : "2027-01-06T12:00:00+08:00"), { singleActivity: true });
		}
		// ⑥ 提醒：跨年的两个 deadline 也读得出（不会被"次年"绕晕）
		const tNow = AT("2027-01-02T12:00:00+08:00");
		const items = T.remindItemsOf({ arknights: { name: "明日方舟", ...ev } }, tNow, null);
		const endKeys = items.filter((it) => it.kind === "end").map((it) => it.key).sort();
		check("跨年｜提醒：活动期载荷派生两条 end（活动结束 + 奖励领取），T 都对得上次年日期",
			endKeys.length === 2
			&& items.some((it) => it.kind === "end" && it.T === AT("2027-01-05T03:59:00+08:00"))
			&& items.some((it) => it.kind === "end" && it.claim === true && it.T === AT("2027-01-08T03:59:00+08:00")),
			JSON.stringify(items.map((it) => [it.key, it.T, !!it.claim])));

		// ⑦ 变体：兑换窗口自己跨年（活动 12-30 ~ 12-31，兑换到次年 01-03）——两端都得带年份
		const snap2 = [{
			name: "支线故事：跨年兑换", category: "支线故事", page: "跨年兑换",
			startTs: AT("2026-12-30T16:00:00+08:00"), stageEndTs: AT("2026-12-31T03:59:00+08:00"),
			claimEndTs: AT("2027-01-03T03:59:00+08:00"),
			raw: "12-30 16:00 ~ 12-31 03:59"
		}];
		const ev2 = p.prtsEventPayload(snap2, TZ_CN, AT("2026-12-30T20:00:00+08:00"));
		const cl2 = p.prtsEventPayload(snap2, TZ_CN, AT("2027-01-01T12:00:00+08:00"));
		check("跨年｜兑换窗口自己跨年：eventClaimDates 两端带年份（2026-12-31 03:59 ~ 2027-01-03 03:59）",
			!!ev2 && ev2.eventClaimDates === "2026-12-31 03:59 ~ 2027-01-03 03:59",
			JSON.stringify(ev2 && ev2.eventClaimDates));
		check("跨年｜兑换窗口自己跨年：兑换期 eventDates 与 eventDatesRaw 同值（同一份跨年区间）",
			!!cl2 && cl2.eventDates === "2026-12-31 03:59 ~ 2027-01-03 03:59"
			&& cl2.eventDatesRaw === cl2.eventDates,
			JSON.stringify([cl2 && cl2.eventDates, cl2 && cl2.eventDatesRaw]));
		check("跨年｜兑换窗口自己跨年：eventShow 与提示行分组仍然只有一层分类前缀",
			!!cl2 && cl2.eventShow === "支线故事：跨年兑换 兑换截止"
			&& doubledCategoryPrefixOf(cl2.eventShow, ["支线故事"]) === "",
			JSON.stringify(cl2 && cl2.eventShow));
	}

	// ── §三 退化路径（= 改造前的数据形状，一个键都不许多）────────────────────────────
	section("退化路径（无「兑换结束时间」/ 空结果 / 请求失败 / 坏响应）");
	{
		const p = P;
		const PRE_CHANGE_KEYS = "event,eventDates,eventDatesRaw,eventHover";

		// ① 夹具本来就有一条没有该字段的活动 ⇒ 解析给 claimEndTs = null
		const noClaimItem = SNAPSHOT.find((x) => x.name === NO_CLAIM_NAME);
		check("退化前提：夹具里「" + NO_CLAIM_LABEL + "」没有「兑换结束时间」⇒ claimEndTs = null",
			!!noClaimItem && noClaimItem.stageEndTs === AT("2026-11-15T03:59:00+08:00") && noClaimItem.claimEndTs === null,
			JSON.stringify(noClaimItem));
		const claimOf = (label) => (SNAPSHOT.find((x) => P.labelOf(x.category, x.name) === label) || {}).claimEndTs;
		check("退化前提：另两条活动（视相 / 时间啊）有兑换期",
			claimOf("视相博物馆：演化") === AT("2026-11-10T03:59:00+08:00")
			&& claimOf("支线故事：时间啊，向前！") === AT("2026-11-29T03:59:00+08:00"),
			JSON.stringify([claimOf("视相博物馆：演化"), claimOf("支线故事：时间啊，向前！")]));

		// ② 只有这条活动时（确实没有兑换期）⇒ 载荷与改造前逐键相同
		const only = SNAPSHOT.filter((x) => x.name === NO_CLAIM_NAME);
		const noClaimPl = p.prtsEventPayload(only, TZ_CN, AT("2026-11-08T12:00:00+08:00"));
		// P3（2026-11-07）：`events` / `eventHoverItems` 是数据层通道（记录里会被删掉），
		// 这里比的仍是"会显示/会落盘"的可见字段集合。
		const visibleKeysOf = (pl) => Object.keys(pl || {})
			.filter((k) => k !== "events" && k !== "eventHoverItems").sort().join(",");
		check("无兑换期：可见字段 = 改造前那四个（不多 eventShow / eventClaimDates / eventHoverExtra）",
			!!noClaimPl && visibleKeysOf(noClaimPl) === PRE_CHANGE_KEYS,
			`不变量=退化形状｜期望=${PRE_CHANGE_KEYS}｜实测=${visibleKeysOf(noClaimPl)}`);
		// ⚠️ 活动期 `eventDatesRaw` = SMW 那条 `raw`（两端都按源站 tz 渲染）。
		// 期望值写成**字面量**：本文件在 `TZ=UTC` 与 `TZ=Asia/Shanghai` 两道门禁下都必须逐字等于这一串
		// （这才是"跨时区相等"的断言，而不是跟着环境现算）。
		const NO_CLAIM_RAW = "11-01 12:00 ~ 11-15 03:59";
		check("无兑换期：eventDates 与 eventDatesRaw 都是源站墙钟原文（跨 TZ 逐字相同）",
			!!noClaimPl && noClaimPl.eventDates === NO_CLAIM_RAW
			&& noClaimPl.eventDatesRaw === NO_CLAIM_RAW
			&& only[0].raw === NO_CLAIM_RAW,
			JSON.stringify([noClaimPl && noClaimPl.eventDates, noClaimPl && noClaimPl.eventDatesRaw, only[0] && only[0].raw]));
		check("无兑换期：**没有** eventShow（不补猜「兑换截止」）", !!noClaimPl && !("eventShow" in noClaimPl),
			JSON.stringify(noClaimPl && Object.keys(noClaimPl)));

		// ③ 空结果（`query.results` 为空对象）⇒ 载荷 null（未公布），**不是**"退化成只有活动期"
		const emptyR = await fetchAt("2026-11-08T12:00:00+08:00", { mode: "empty" });
		check("空结果：`query.results` 为空 ⇒ 载荷 null（未公布），抓取器不抛、仍然只发 1 条请求",
			emptyR.err === null && emptyR.data === null && emptyR.seen.length === 1,
			`不变量=空结果｜err=${emptyR.err}｜data=${JSON.stringify(emptyR.data)}｜reqs=${emptyR.seen.length}`);

		// ④ 请求失败（HTTP 503）⇒ **抛错**（这一侧记 down）。
		//    ⚠️ 这里**没有**"回退解析活动一览 HTML"的备用路径：那条链路（collectPrtsEvents / 批量 wikitext）
		//    已整段删除 —— 留着只会让两套时间口径长期并存（见 fetchArknightsEvents 的注释）。
		const failHttp = await fetchAt("2026-11-08T12:00:00+08:00", { mode: "http" });
		check("请求失败：抓取器**抛错**（http-503），不返回半截载荷、也不静默给 null",
			failHttp.err === "http-503" && failHttp.data === null, JSON.stringify([failHttp.err, failHttp.data]));

		// ⑤ 坏响应（没有 query.results 的 JSON）⇒ 同样抛错（不伪装成"没有活动"）
		const failBad = await fetchAt("2026-11-08T12:00:00+08:00", { mode: "bad" });
		check("坏响应：SMW 报错响应（没有 query.results）⇒ 抛错 smw-bad-json",
			failBad.err === "smw-bad-json" && failBad.data === null, JSON.stringify([failBad.err, failBad.data]));

		// ⑥ 失败路径不污染成功路径：同一时刻独立再跑一遍，载荷照旧三条悬停
		const okEvent = await fetchAt("2026-11-06T21:59:00+08:00");
		check("活动期：成功抓取的载荷带 event + eventDates，悬停仍是三条（三条活动都在活动期）",
			!!okEvent.data && typeof okEvent.data.event === "string"
			&& String(okEvent.data.eventHover).split("\n").length === 3,
			JSON.stringify(okEvent.data && [okEvent.data.event, okEvent.data.eventHover]));
	}

	// ── §四 提醒：两个 deadline 在时间轴上各发一次（同一份 lastData 不刷新）──────────────
	section("提醒：活动结束前 72h 与兑换截止前 72h 各发一次（同一份 lastData 不刷新）");
	{
		// 取**活动期**那一刻的载荷当 lastData（两个窗口都还在未来 = 用户真实会经历的状态）
		const r = await fetchAt("2026-10-24T17:00:00+08:00");
		const pl = r.data;
		check("先决：活动期载荷同时带 eventDates 与 eventClaimDates（提醒侧能建两条 deadline 的前提）",
			!!pl && pl.eventDates === "10-24 16:00 ~ 11-07 03:59" && pl.eventClaimDates === "11-07 03:59 ~ 11-10 03:59",
			JSON.stringify(pl && [pl.eventDates, pl.eventClaimDates]));
		const lastData = { arknights: Object.assign({ name: "明日方舟" }, pl) };
		const snapshotBefore = JSON.stringify(lastData);
		const nowOfPl = AT("2026-10-24T17:00:00+08:00");
		const wEvent = T.remindWindowOf(pl.eventDates, nowOfPl, TZ_CN);
		const wClaim = T.remindWindowOf(pl.eventClaimDates, nowOfPl, TZ_CN);
		const actEnd = wEvent && wEvent.endTs, claimEnd = wClaim && wClaim.endTs;
		check("先决：两个窗口都读得出（活动结束 11-07 03:59 / 兑换截止 11-10 03:59）",
			actEnd === AT("2026-11-07T03:59:00+08:00") && claimEnd === AT("2026-11-10T03:59:00+08:00"),
			JSON.stringify([actEnd, claimEnd]));

		const tEvent = actEnd - 72 * 3600e3;   // 活动结束前 72h
		const tClaim = claimEnd - 72 * 3600e3; // 兑换截止前 72h
		const kEvent = "arknights|event|end|" + actEnd;
		const kClaim = "arknights|event-claim|end|" + claimEnd;
		// 两轮都用**同一份 lastData**（不重新抓、不改对象）—— 这正是"刷新一次之后不再刷新"的用户场景
		const first = T.remindTickOf(tEvent, T.remindItemsOf(lastData, tEvent, null), {}, {});
		const second = T.remindTickOf(tClaim, T.remindItemsOf(lastData, tClaim, null), {}, first.stateNext);

		check("提醒｜活动结束前 72h：发**一条**、key = 主条目、档位 72",
			first.toNotify.length === 1 && first.toNotify[0].key === kEvent && first.toNotify[0].node === 72,
			`不变量=第一次送达｜期望=${kEvent}（node 72）｜实测=${JSON.stringify(first.toNotify.map((n) => [n.key, n.node]))}`);
		check("提醒｜兑换截止前 72h：在**同一套状态**下仍发**一条**、key = event-claim、档位 72",
			second.toNotify.length === 1 && second.toNotify[0].key === kClaim && second.toNotify[0].node === 72,
			`不变量=第二次送达｜期望=${kClaim}（node 72）｜实测=${JSON.stringify(second.toNotify.map((n) => [n.key, n.node]))}`);
		check("提醒｜两个 key 不同、状态互不覆盖（第一条的键不挡第二条）",
			kEvent !== kClaim && !(kClaim in first.stateNext) && Object.keys(first.stateNext).join(",") === kEvent
			&& Object.keys(second.stateNext).join(",") === kClaim,
			JSON.stringify([Object.keys(first.stateNext), Object.keys(second.stateNext)]));
		check("提醒｜两次都用同一份 lastData（对象没被改成「已刷新」）：时间轴上不必中途再刷一次",
			JSON.stringify(lastData) === snapshotBefore,
			`不变量=不刷新也能各发一次｜期望=对象逐字不变｜实测=${JSON.stringify(lastData).slice(0, 120)}`);
		// 兑换期那次载荷（eventDates 本身就是兑换区间）⇒ 主窗口与 phase 的 T 相同，去重只留一条（不弹两遍）
		// ⚠️ 2026-11-07（P4 展平）：这一份载荷里**三条活动都在期**，所以「按条目派生」有 3 条 end；
		// 这条断言守的仍是原来那件事 —— 视相（主条目）的**兑换截止**与它自己的窗口同 T ⇒ 不另派生
		// `event-claim` 条目（同一时刻不弹两条），所以下面只看"T = 兑换截止"的那几条。
		const rClaim = await fetchAt("2026-11-08T12:00:00+08:00");
		const claimItems = T.remindItemsOf({ arknights: Object.assign({ name: "明日方舟" }, rClaim.data) }, AT("2026-11-08T12:00:00+08:00"), null)
			.filter((it) => it.side === "event" && it.kind === "end");
		const claimAt = claimItems.filter((it) => it.T === AT("2026-11-10T03:59:00+08:00"));
		check("提醒｜兑换期载荷：主窗口与兑换截止同 T ⇒ 去重只留一条（同一时刻不弹两条）",
			claimAt.length === 1 && claimAt[0].key === "arknights|event|end|" + AT("2026-11-10T03:59:00+08:00")
			&& claimItems.every((it) => it.key.indexOf("|event-claim|") < 0),
			JSON.stringify(claimItems.map((it) => it.key)));
	}

	// ── §五 持久化 / 沿用旧值：时间轴上任何一刻的字段都不能在路上丢 ─────────────────────
	section("持久化与沿用旧值（时间轴上任意时刻的字段都不许在路上丢）");
	{
		// 七个字段各给一个**互不相同**的值，真跑一遍引擎归一：
		// 白名单里少登记一个，这里就会丢一个（"清单不许漂"靠机制守，不靠人记）
		const sample = {
			event: "活动名", eventDates: "01-01 00:00 ~ 01-02 00:00", eventDatesRaw: "raw-dates",
			eventClaimDates: "claim-dates", eventShow: "活动名 兑换截止",
			eventHoverExtra: "锚点\n活动名 兑换截止   01-02 00:00", eventHover: "hover"
		};
		const sampleStorage = {
			async get(k) {
				return k === "lastData" ? JSON.stringify({ arknights: Object.assign({ name: "明日方舟" }, sample) }) : void 0;
			},
			async set() {}
		};
		const roundTrip = (await createEngine({ storage: sampleStorage }).getCached()).games.arknights || {};
		const lost = [...PERSIST_BASE, ...PERSIST_NEW].filter((f) => roundTrip[f] !== sample[f]);
		check("字段清单：七个字段（现有 4 + 两阶段 3）全都登记进归一白名单（少一个 ⇒ 这里必红）",
			lost.length === 0,
			`不变量=白名单｜期望=7 个字段原样读回｜实测=丢了 ${JSON.stringify(lost)}`);

		// 活动侧整列沿用旧值时，两个阶段的新字段也必须一起沿回（否则刷新失败一次就少一条 deadline / 少一行提示）
		const engine = createEngine({ storage: { async get() { return void 0; }, async set() {} } });
		const merged = engine.__test.mergeEntryRecord(
			{ data: {}, ok: false, reason: "超时", gachaFail: null, eventFail: { kind: "down", reason: "超时" } },
			{
				event: "视相博物馆：演化", eventDates: "11-07 03:59 ~ 11-10 03:59",
				eventDatesRaw: "11-07 03:59 ~ 11-10 03:59",
				eventShow: "视相博物馆：演化 兑换截止",
				eventClaimDates: "11-07 03:59 ~ 11-10 03:59",
				eventHoverExtra: "支线故事：时间啊，向前！\n支线故事：时间啊，向前！ 兑换截止   11-29 03:59",
				eventHover: "视相博物馆：演化 兑换截止   11-07 03:59 ~ 11-10 03:59"
			},
			1000
		);
		check("沿用旧值：eventShow / eventClaimDates / eventHoverExtra 一个不落（刷新失败一次也不丢阶段信息）",
			merged.eventStale === true
			&& merged.eventShow === "视相博物馆：演化 兑换截止"
			&& merged.eventClaimDates === "11-07 03:59 ~ 11-10 03:59"
			&& merged.eventHoverExtra === "支线故事：时间啊，向前！\n支线故事：时间啊，向前！ 兑换截止   11-29 03:59",
			JSON.stringify(merged));

		// 反过来：没有兑换期的来源沿用旧值后，**不许**凭空长出 eventShow / eventHoverExtra
		const mergedNoClaim = engine.__test.mergeEntryRecord(
			{ data: {}, ok: false, reason: "超时", gachaFail: null, eventFail: { kind: "down", reason: "超时" } },
			{ event: "登录活动：感谢庆典2026限时签到", eventDates: "11-01 12:00 ~ 11-15 03:59", eventDatesRaw: "11-01 12:00 ~ 11-15 03:59" },
			1000
		);
		check("沿用旧值：没有兑换期 ⇒ 归一后是空串（形状固定，且不会凭空多出提示行）",
			mergedNoClaim.eventShow === "" && mergedNoClaim.eventHoverExtra === "" && mergedNoClaim.eventClaimDates === "",
			JSON.stringify(mergedNoClaim));
		check("沿用旧值：活动名与区间逐字保留（沿用不许改写源站文本）",
			mergedNoClaim.event === "登录活动：感谢庆典2026限时签到"
			&& mergedNoClaim.eventDates === "11-01 12:00 ~ 11-15 03:59",
			JSON.stringify([mergedNoClaim.event, mergedNoClaim.eventDates]));
	}
}

// 供报告/调试：时刻表本身是数据，导出一份便于对照（用例里不依赖它）
export const TIMELINE_KEYS = MOMENTS.map((m) => m.key);
