// test/cases-arknights-claim.mjs —— 明日方舟「两阶段」（实际举行 / 奖励领取），SMW 单请求版
//
// ── 为什么需要这一段 ──
// 2026-11-06 用户要求：活动区分「实际举行」与「奖励领取」。改造前 PRTS 活动一览只给
// 「活动开始时间 + data-time="开始秒,结束秒"」，**没有**兑换/领取期 ⇒ 活动一结束、整条就从面板消失，
// 而那时恰恰是最该盯的（奖励还没领）。
//
// ── 2026-11-07 起：链路换成 **SMW 单请求** ──
// PRTS 已装 SemanticMediaWiki 7.3.1，`action=ask` 一次就把四列全给出来：
//   「活动类型」→ category、「活动开始时间」→ startTs、「活动结束时间」→ stageEndTs（关卡关闭）、
//   「兑换结束时间」→ claimEndTs（可缺；**与活动结束同值 = 没有兑换期**）。
// 于是原来那两条链路（① 活动一览 HTML 解析 + ② 一次批量 query 取活动页 wikitext）**整段删除**：
// `collectPrtsEvents` / `prtsEventSnapshot` / `fetchPrtsPagesWikitext` / `prtsPageTimesFromBatch` /
// `prtsClaimTitles` / `parsePrtsPageEndTimes` / `warnOnPrtsEndMismatch` 都不存在了。
// 本文件现在守的是**新链路**：纯函数解析（8 种边界）+ 一次请求 + 三态 + 分类前缀去重 + 真机逐字基线。
//
// 这一段的重点是**边界**，不是"正常能跑"：
//   · 有「兑换结束时间」→ 活动结束后仍出现，外显区间改成兑换期（还剩 X = 到兑换截止）；
//   · **没有**该字段（或与活动结束同值）→ 与改造前逐字节一致（不补猜 7 天）；
//   · 「活动类型」缺失 → category 留空 ⇒ `eventTier` 按名称关键词回退（实测 8 条里 1 条为空）；
//   · 请求失败 / 坏响应 → **抛错**（这一侧记 down）；空结果 → 载荷 null（未公布）；
//   · 分页游标（`query-continue-offset`）→ **不追页**（一次刷新只有 1 条请求）。
//
// ⚠️ 2026-11-06 / 11-07 那几条真机 bug（提示行漏进 `eventHover`、兑换期同一区间出现两遍、
//    分类前缀拼两遍、兑换期被别的活动挤掉）的回归**都还在**：本文件 §④ 与 §⑥ 逐字钉着。
//
// ⚠️ 夹具 `test/fixtures/arknights-smw-events/` 是**真实 SMW 响应**（本机出口 403，经宿主侧
//    web_fetch 取得，逐字保存；只保留 2026-11-07 那三条活动的 results，见 meta.json 的 note）。

import { readFileSync } from "node:fs";
import path from "node:path";
import { check, section, useFixtures, setFetchImpl, fixtureBody } from "./harness.mjs";
import { T, readComponentsSource, REPO } from "./load.mjs";
import { createEngine } from "../packages/core/core.mjs";
// 悬停文本的判定**只有一份实现**（在 `test/lib-text.mjs`）：本段（真机 bug 的逐字基线）与
// `cases-arknights-timeline.mjs`（整周期时间轴扫描）都调它 —— 两处不许各写一套谓词。
// `legacyHoverItemsOf` = **冻结 oracle**（悬停文本 → 并列条目）：产品里的 `scheduleHoverItems`
// 在 P5 清理中删除（自 P3c 起就没有生产调用方），判据逐字搬进 lib-text.mjs 供 §④ 的回归继续用。
import {
	assertHoverTextInvariants, bareTwoLineFormOf,
	dupLinesOf, linesOf, NOTE_LINE, SHARED_EVENT_LINE, legacyHoverItemsOf
} from "./lib-text.mjs";

const TZ_CN = "Asia/Shanghai";


// 活动侧唯一的一条请求（`eventUrl` 去掉 origin=*；抓取器会自己补）。
// 直接读源码导出的常量（与 registerSource 里那个 URL 是**同一个**，不抄第二份）。
const SMW_URL = T.parsers["arknights"].ARKNIGHTS_SMW_URL;
const SMW_QUERY = T.parsers["arknights"].ARKNIGHTS_SMW_QUERY;

// 夹具里那三条活动（2026-11-07 真机）：
//   视相博物馆：演化            10-24 16:00 ~ 11-07 03:59（兑换到 11-10 03:59）
//   登录活动：感谢庆典2026限时签到  11-01 12:00 ~ 11-15 03:59（**没有**兑换期 ⇒ 退化路径）
//   支线故事：时间啊，向前！      11-01 12:00 ~ 11-22 03:59（兑换到 11-29 03:59）
const FIXTURE_JSON = JSON.parse(fixtureBody(SMW_URL));

// `eventHoverExtra`（**只进提示框**）：每两条一组 —— ① 该活动的**标签** ② 提示行本身。
// 提示行**只有一种合法形态**（与该活动自己那行**同一排版**：`名称` + **3 空格** + `内容`）：
//   · 活动期（有兑换期） ⇒ `<标签> 兑换截止   11-10 03:59`
//   · 兑换期            ⇒ **一行都不生成**（主行已经是兑换区间，2026-11-07 真机 bug 的①）
// 正则与三条结构不变量都在 `test/lib-text.mjs`（NOTE_LINE / SHARED_EVENT_LINE / assertHoverTextInvariants）：
// 本文件不再自带一份，否则 timeline 那段一定会与这里判得不一样。
// 「泄漏」判据：**单条截止日**形态的提示行（`… 兑换截止   MM-DD HH:MM`）出现在 eventHover 里，
// 才说明提示行又跑进去了。注意兑换期那条**主行**（`… 兑换截止   MM-DD HH:MM ~ MM-DD HH:MM`）
// 是合法的——它本身就是兑换区间（2026-11-07 起），所以判据只认"单条截止日"那种。
const LEAK_RE = /兑换截止   \d{2}-\d{2} \d{2}:\d{2}$|奖励领取期/m;
// 解释句（用户 2026-11-06 点名删掉）：载荷里任何一处都不许再出现。
const EXPLAIN_RE = /活动已于|当前为奖励领取期/;

// 悬停逐字基线（= 只由 buildEventHover 产出；与时间轴那段同一组文本）。
const HOVER_EVENT_3 = "视相博物馆：演化   10-24 16:00 ~ 11-07 03:59\n"
	+ "登录活动：感谢庆典2026限时签到   11-01 12:00 ~ 11-15 03:59\n"
	+ "支线故事：时间啊，向前！   11-01 12:00 ~ 11-22 03:59";
const HOVER_CLAIM = "视相博物馆：演化 兑换截止   11-07 03:59 ~ 11-10 03:59\n"
	+ "登录活动：感谢庆典2026限时签到   11-01 12:00 ~ 11-15 03:59\n"
	+ "支线故事：时间啊，向前！   11-01 12:00 ~ 11-22 03:59";
// 提示行数据（每两条一组：标签 ⏎ 提示行），顺序 = 悬停顺序（结束时间升序）。
const EXTRA_EVENT_3 = "视相博物馆：演化\n视相博物馆：演化 兑换截止   11-10 03:59\n"
	+ "支线故事：时间啊，向前！\n支线故事：时间啊，向前！ 兑换截止   11-29 03:59";
const EXTRA_CLAIM = "支线故事：时间啊，向前！\n支线故事：时间啊，向前！ 兑换截止   11-29 03:59";
// 悬停最终全文（**逐字** = 用户 2026-11-07 给的期望文本：提示行插在自己那行之后）。
const HOVER_REAL_EVENT = "视相博物馆：演化   10-24 16:00 ~ 11-07 03:59\n"
	+ "视相博物馆：演化 兑换截止   11-10 03:59\n"
	+ "登录活动：感谢庆典2026限时签到   11-01 12:00 ~ 11-15 03:59\n"
	+ "支线故事：时间啊，向前！   11-01 12:00 ~ 11-22 03:59\n"
	+ "支线故事：时间啊，向前！ 兑换截止   11-29 03:59";
const HOVER_REAL_CLAIM = "视相博物馆：演化 兑换截止   11-07 03:59 ~ 11-10 03:59\n"
	+ "登录活动：感谢庆典2026限时签到   11-01 12:00 ~ 11-15 03:59\n"
	+ "支线故事：时间啊，向前！   11-01 12:00 ~ 11-22 03:59\n"
	+ "支线故事：时间啊，向前！ 兑换截止   11-29 03:59";

const okBody = (body) => ({
	ok: true, status: 200, headers: { get: () => "application/json" },
	text: async () => body, json: async () => JSON.parse(body)
});
// 坏响应：JSON 合法但没有 `query`（SMW 查询语法错/被限流时就是这个形状）
const BAD_BODY = JSON.stringify({ error: { code: "smw-error", info: "query failed" } });

// 装一层"记账 + 可失败"的 transport：走 map.json 的夹具（fixtureBody），并记录每次真实请求。
// （useFixtures() 先装全局 fetch 兜底，保证这一段万一漏网也不会打真网络。）
// mode: "ok" | "http"（HTTP 503） | "bad"（没有 query 的 JSON）
function installTransport({ mode = "ok" } = {}) {
	const seen = [];
	setFetchImpl(async (url) => {
		const u = String(url);
		seen.push(u);
		if (mode === "http") return { ok: false, status: 503, headers: { get: () => null }, text: async () => "", json: async () => ({}) };
		if (mode === "bad") return okBody(BAD_BODY);
		return okBody(fixtureBody(SMW_URL));
	});
	return seen;
}

// 跑一次真实抓取器（固定 now + 指定失败模式）。
async function runFetcher(nowIso, { mode = "ok" } = {}) {
	const seen = installTransport({ mode });
	T.setCoreEnv({ now: () => Date.parse(nowIso) });
	let data = null, err = null;
	try {
		data = await T.EVENT_FETCHERS["arknights"].default(SMW_URL, undefined, TZ_CN);
	} catch (e) {
		err = String((e && e.message) || e);
	}
	return { data, err, seen };
}

// 提示框最终全文 = 载荷 + **表格格子**那条路径（base = eventHover ⇒ scheduleHoverNote 插提示行）。
// 格子里的 title 就是这个字符串（82-schedule-view.js 的 hoverTextOf）。
function cellHoverOf(pl) {
	return T.scheduleHoverNote(pl.eventHover || "", Object.assign({ name: "明日方舟" }, pl), false);
}
// 提示框最终全文 = **「近期」行**那条路径（scheduleHoverText：hv / title / rawSrc / 提示行）。
function rowHoverOf(pl, nowIso) {
	const it = T.scheduleNormalize(Object.assign({ id: "arknights", name: "明日方舟" }, pl), "event",
		new Date(Date.parse(nowIso)));
	return T.scheduleHoverText(it);
}

// 一条最小的 SMW 结果（造边界用）：只给需要的 printouts
function smwOne(printouts, title) {
	return { query: { results: { [title || "测试活动"]: { printouts, fulltext: title || "测试活动" } } } };
}
const smwTime = (ts, raw) => [{ timestamp: String(ts / 1000), raw: raw || "" }];

export default async function run() {
	section("明日方舟两阶段（实际举行 / 奖励领取：PRTS SMW **单请求**）");
	useFixtures();   // 装全局 fetch 兜底（本段自己再包一层记账/可失败的 impl）
	const { parseArknightsSmwEvents, prtsEventPayload, labelOf } = T.parsers["arknights"];
	const eventTier = T.eventTier;
	const at = (iso) => Date.parse(iso);

	// ── ① 纯函数：SMW 响应 → 三态条目（八种输入）────────────────────────────────
	{
		const items = parseArknightsSmwEvents(FIXTURE_JSON, TZ_CN);
		check("纯函数：真实响应 → 3 条活动（键 / fulltext 都在、页名 = fulltext）",
			items.length === 3 && items.every((x) => x.name === x.page && x.name.length > 0),
			JSON.stringify(items.map((x) => x.name)));

		// 三态时间戳：**直接**用 timestamp×1000，绝不拿 raw 按源站 tz 重算
		const sx = items.find((x) => x.name === "视相博物馆：演化") || {};
		check("纯函数：时间戳 = timestamp×1000（Unix 秒 → 毫秒，不按 +08 重算）",
			sx.startTs === at("2026-10-24T16:00:00+08:00")
			&& sx.stageEndTs === at("2026-11-07T03:59:00+08:00")
			&& sx.claimEndTs === at("2026-11-10T03:59:00+08:00"),
			JSON.stringify([sx.startTs, sx.stageEndTs, sx.claimEndTs]));
		check("纯函数：raw = 按源站 tz 渲染的活动区间（与改造前一览 data-time 那串逐字相同）",
			sx.raw === "10-24 16:00 ~ 11-07 03:59", JSON.stringify(sx.raw));

		// 兑换结束时间缺失 ⇒ claimEndTs = null（不补猜）
		const noClaim = items.find((x) => x.name === "感谢庆典2026限时签到") || {};
		check("纯函数：没有「兑换结束时间」（空数组）⇒ claimEndTs = null（不补猜 7 天）",
			noClaim.stageEndTs === at("2026-11-15T03:59:00+08:00") && noClaim.claimEndTs === null,
			JSON.stringify(noClaim));

		// 兑换结束时间 **与活动结束同值** ⇒ 也没有兑换期（实测 30 条里有 6 条是这种）
		const sameTs = parseArknightsSmwEvents(smwOne({
			"活动类型": ["其他活动"],
			"活动开始时间": smwTime(at("2026-10-01T04:00:00+08:00")),
			"活动结束时间": smwTime(at("2026-10-10T03:59:00+08:00")),
			"兑换结束时间": smwTime(at("2026-10-10T03:59:00+08:00"))
		}), TZ_CN);
		check("纯函数：兑换结束**等于**活动结束 ⇒ claimEndTs = null（那条活动本来就不设兑换商店）",
			sameTs.length === 1 && sameTs[0].claimEndTs === null, JSON.stringify(sameTs));

		// 兑换结束 **早于** 活动结束（脏数据）⇒ 丢掉兑换期，活动期照旧
		const reversed = parseArknightsSmwEvents(smwOne({
			"活动类型": ["支线故事"],
			"活动开始时间": smwTime(at("2026-10-01T04:00:00+08:00")),
			"活动结束时间": smwTime(at("2026-10-10T03:59:00+08:00")),
			"兑换结束时间": smwTime(at("2026-10-05T03:59:00+08:00"))
		}), TZ_CN);
		check("纯函数：兑换结束早于活动结束（顺序颠倒）⇒ 丢弃兑换期，只留活动期",
			reversed.length === 1 && reversed[0].claimEndTs === null
			&& reversed[0].stageEndTs === at("2026-10-10T03:59:00+08:00"),
			JSON.stringify(reversed));

		// 「活动类型」缺失 ⇒ category 留空，交给 eventTier 按名字回退
		const noType = parseArknightsSmwEvents(smwOne({
			"活动类型": [],
			"活动开始时间": smwTime(at("2026-10-01T04:00:00+08:00")),
			"活动结束时间": smwTime(at("2026-10-10T03:59:00+08:00")),
			"兑换结束时间": []
		}, "危机合约：尖灭测试作战"), TZ_CN);
		check("纯函数：「活动类型」缺失 ⇒ category = 空串（不编分类、不抛错）",
			noType.length === 1 && noType[0].category === "", JSON.stringify(noType));
		check("「活动类型」缺失时的档位回退：`eventTier` 按**名称**判（尖灭 → 第一档，登录名 → 第二档）",
			eventTier(noType[0]) === 1
			&& eventTier({ name: "感谢庆典2026限时签到", category: "" }) === 2
			&& eventTier({ name: "感谢庆典2026限时签到", category: "登录活动" }) === 2,
			JSON.stringify([eventTier(noType[0]), eventTier({ name: "感谢庆典2026限时签到", category: "" })]));
		check("有「活动类型」时按分类判档（同一名字「尖灭测试作战」：分类=登录活动 ⇒ 第二档）",
			eventTier({ name: "尖灭测试作战", category: "登录活动" }) === 2
			&& eventTier({ name: "尖灭测试作战", category: "危机合约" }) === 1,
			JSON.stringify([eventTier({ name: "尖灭测试作战", category: "登录活动" }), eventTier({ name: "尖灭测试作战", category: "危机合约" })]));

		// 缺时间 / 时间坏掉 ⇒ 跳过该条（算不出窗口就别硬凑）
		const halfBaked = parseArknightsSmwEvents({
			query: {
				results: {
					"只有开始": { printouts: { "活动开始时间": smwTime(at("2026-10-01T04:00:00+08:00")), "活动结束时间": [] }, fulltext: "只有开始" },
					"时间坏掉": { printouts: { "活动开始时间": [{ timestamp: "not-a-number" }], "活动结束时间": smwTime(at("2026-10-10T03:59:00+08:00")) }, fulltext: "时间坏掉" },
					"空对象": {},
					"好的": { printouts: { "活动开始时间": smwTime(at("2026-10-01T04:00:00+08:00")), "活动结束时间": smwTime(at("2026-10-10T03:59:00+08:00")) }, fulltext: "好的" }
				}
			}
		}, TZ_CN);
		check("纯函数：缺活动结束 / timestamp 非数字 / 空条目 ⇒ 跳过（只留算得出窗口的那条）",
			halfBaked.length === 1 && halfBaked[0].name === "好的", JSON.stringify(halfBaked.map((x) => x.name)));

		// fulltext 缺失 ⇒ 用结果键（页名）当名字
		const noFulltext = parseArknightsSmwEvents({
			query: {
				results: {
					"页名兜底": { printouts: { "活动开始时间": smwTime(at("2026-10-01T04:00:00+08:00")), "活动结束时间": smwTime(at("2026-10-10T03:59:00+08:00")) } }
				}
			}
		}, TZ_CN);
		check("纯函数：fulltext 缺失 ⇒ 用结果键（页名）当名字", noFulltext.length === 1 && noFulltext[0].name === "页名兜底",
			JSON.stringify(noFulltext.map((x) => x.name)));

		// 空结果 / 坏响应
		check("纯函数：`query.results` 是空对象 ⇒ []（源站没有活动，不是故障）",
			parseArknightsSmwEvents({ query: { results: {} } }, TZ_CN).length === 0);
		let badErr = null;
		try { parseArknightsSmwEvents(JSON.parse(BAD_BODY), TZ_CN); } catch (e) { badErr = String((e && e.message) || e); }
		check("纯函数：没有 `query.results`（SMW 报错响应）⇒ **抛错**（不伪装成「没有活动」）", badErr === "smw-bad-json", String(badErr));
		let emptyErr = null;
		try { parseArknightsSmwEvents(null, TZ_CN); } catch (e) { emptyErr = String((e && e.message) || e); }
		check("纯函数：null 响应 ⇒ 同样抛错（不静默返回空数组）", emptyErr === "smw-bad-json", String(emptyErr));

		// tz 只影响**渲染**，不影响绝对时刻（TZ=UTC 与 +08 两道门禁下 ts 同一个数；raw 跟着渲染口径变）
		const asUtc = parseArknightsSmwEvents(smwOne({
			"活动开始时间": smwTime(Date.UTC(2026, 10, 1, 4, 0)),
			"活动结束时间": smwTime(Date.UTC(2026, 10, 14, 19, 59))
		}), "UTC");
		check("纯函数：tz 只参与渲染 —— 两个 tz 下 ts 一个字不变，raw 按该 tz 渲染（UTC 下 = 11-01 04:00 ~ 11-14 19:59）",
			asUtc.length === 1
			&& asUtc[0].startTs === at("2026-11-01T12:00:00+08:00")
			&& asUtc[0].stageEndTs === at("2026-11-15T03:59:00+08:00")
			&& asUtc[0].raw === "11-01 04:00 ~ 11-14 19:59",
			JSON.stringify(asUtc));

		// 查询串形态：属性名与排序/上限都必须在 URL 里（少一个属性就少一列，静默退化）
		check("查询串：四个属性 + 倒序 + limit=30 都在（`action=ask` 与 `format=json` 在 URL 上）",
			SMW_QUERY.includes("[[活动开始时间::+]]")
			&& SMW_QUERY.includes("?活动类型") && SMW_QUERY.includes("?活动开始时间")
			&& SMW_QUERY.includes("?活动结束时间") && SMW_QUERY.includes("?兑换结束时间")
			&& SMW_QUERY.includes("sort=活动开始时间") && SMW_QUERY.includes("order=desc")
			&& SMW_QUERY.includes("limit=30")
			&& SMW_URL.startsWith("https://prts.wiki/api.php?action=ask&format=json&query="),
			JSON.stringify([SMW_QUERY, SMW_URL.slice(0, 60)]));
	}

	// ── ①b 分类前缀去重 `labelOf`（纯函数）+ 快照里的 label ────────────────────────
	// 起因（用户 2026-11-06）：「分类前缀重复问题做个判定如果完全一致就合并」——
	// PRTS 的活动名本身可能就带分类前缀（页名「视相博物馆：演化」），再无条件拼 `${category}：${name}`
	// 就成了「视相博物馆：视相博物馆：演化」。
	{
		check("labelOf：名称不带前缀 ⇒ 拼一次 `<category>：<name>`",
			labelOf("视相博物馆", "演化") === "视相博物馆：演化", labelOf("视相博物馆", "演化"));
		check("labelOf：名称已带 `<category>：` ⇒ **原样返回**（不再拼成 视相博物馆：视相博物馆：演化）",
			labelOf("视相博物馆", "视相博物馆：演化") === "视相博物馆：演化", labelOf("视相博物馆", "视相博物馆：演化"));
		check("labelOf：半角冒号 / 空格两种分隔变体也认（`:`, ` `）",
			labelOf("视相博物馆", "视相博物馆:演化") === "视相博物馆:演化"
			&& labelOf("视相博物馆", "视相博物馆 演化") === "视相博物馆 演化",
			JSON.stringify([labelOf("视相博物馆", "视相博物馆:演化"), labelOf("视相博物馆", "视相博物馆 演化")]));
		check("labelOf：前缀比较大小写不敏感，但返回值保留源站大小写（不擅自改字）",
			labelOf("Viewing Hall", "VIEWING HALL：演化") === "VIEWING HALL：演化",
			labelOf("Viewing Hall", "VIEWING HALL：演化"));
		check("labelOf：名称与分类完全一致 ⇒ 原样返回（用户口径「完全一致就合并」）",
			labelOf("支线故事", "支线故事") === "支线故事", labelOf("支线故事", "支线故事"));
		check("labelOf：没有分类（空 / null）⇒ 原样返回 name",
			labelOf("", "视相博物馆：演化") === "视相博物馆：演化" && labelOf(null, "墟") === "墟",
			JSON.stringify([labelOf("", "视相博物馆：演化"), labelOf(null, "墟")]));
		check("labelOf：幂等（labelOf(category, labelOf(category, name)) 不会多拼一层）",
			labelOf("视相博物馆", labelOf("视相博物馆", "演化")) === "视相博物馆：演化"
			&& labelOf("视相博物馆", labelOf("视相博物馆", "视相博物馆：演化")) === "视相博物馆：演化");

		// 真实结构：SMW 结果里 `fulltext` 本身就带前缀，`活动类型` 也是同一个词
		const dup = parseArknightsSmwEvents(smwOne({
			"活动类型": ["视相博物馆"],
			"活动开始时间": smwTime(Date.UTC(2026, 9, 24, 8, 0)),
			"活动结束时间": smwTime(Date.UTC(2026, 10, 6, 19, 59))
		}, "视相博物馆：演化"), TZ_CN);
		check("SMW 快照：名称本身带分类前缀时**不重复**（labelOf(name) 逐字 =「视相博物馆：演化」）",
			dup.length === 1 && labelOf(dup[0].category, dup[0].name) === "视相博物馆：演化" && dup[0].category === "视相博物馆",
			JSON.stringify(dup.map((x) => [x.name, x.category])));

		// 用户举的那个例子端到端跑一遍 payload：活动期 → 兑换期
		const snap = [{
			name: "视相博物馆：演化", category: "视相博物馆", page: "视相博物馆：演化",
			startTs: at("2026-10-24T16:00:00+08:00"), stageEndTs: at("2026-11-07T03:59:00+08:00"),
			claimEndTs: at("2026-11-10T03:59:00+08:00"), raw: "10-24 16:00 ~ 11-07 03:59"
		}];
		const claimPl = prtsEventPayload(snap, TZ_CN, at("2026-11-08T12:00:00+08:00"));
		check("去重端到端：兑换期 `event` / `eventShow` / 面板显示是**同一串**（「视相博物馆：演化」）",
			!!claimPl && claimPl.event === "视相博物馆：演化"
			&& claimPl.eventShow === "视相博物馆：演化 兑换截止",
			JSON.stringify(claimPl && [claimPl.event, claimPl.eventShow]));
		// 2026-11-07：兑换期那条活动**不再生成提示行** —— 它的主行本身就是兑换区间
		// （单条活动时 buildEventHover 给空串，主行由「名称 ⏎ 档期」兜底显示，区间仍是兑换区间）。
		check("去重端到端：兑换期**不写** `eventHoverExtra`（主行已是兑换区间，不再补一行同区间的提示）",
			!!claimPl && !("eventHoverExtra" in claimPl),
			JSON.stringify(claimPl && Object.keys(claimPl)));
		check("去重端到端：兑换期的 `eventDates` 与 `eventClaimDates` 都是兑换区间（逐字）",
			!!claimPl && claimPl.eventDates === "11-07 03:59 ~ 11-10 03:59"
			&& claimPl.eventClaimDates === "11-07 03:59 ~ 11-10 03:59",
			JSON.stringify(claimPl && [claimPl.eventDates, claimPl.eventClaimDates]));
		// 单条活动时 buildEventHover 返回 ""（UI 退回「名称 ⏎ 档期」两行式）⇒ 提示行既然不生成，
		// 这段悬停就该**原样不动**（不补空行、不凭空另起一段）。
		const singleHover = "视相博物馆：演化\n11-07 03:59 ~ 11-10 03:59";
		check("去重端到端：单条活动（eventHover 为空）+ 兑换期 ⇒ 悬停原样不动（没有提示行可插）",
			T.scheduleHoverNote(singleHover, claimPl, false) === singleHover,
			JSON.stringify(T.scheduleHoverNote(singleHover, claimPl, false)));
	}

	// ── ② 抓取链路：**恰好 1 次**请求（SMW），分页不追 ───────────────────────────
	{
		const { data, seen, err } = await runFetcher("2026-11-06T15:54:00+08:00");
		check("抓取链路：活动侧一次刷新只发 **1 条** prts 请求（不是「一览 + 批量」两条）",
			seen.length === 1, JSON.stringify(seen.map((u) => u.slice(0, 60))));
		check("抓取链路：那一条就是 `action=ask`（带 origin=*，与卡池侧同一条通道）",
			seen[0] === SMW_URL + "&origin=*", seen[0]);
		check("抓取链路：**不再**有 `action=query&prop=revisions`（批量 wikitext 已删）",
			!seen.some((u) => u.includes("action=query&prop=revisions")), JSON.stringify(seen));
		check("抓取链路：抓取器不抛错、事件侧契约成立（event + eventDates）",
			!err && !!data && typeof data.event === "string" && typeof data.eventDates === "string", err || JSON.stringify(data && data.event));

		// 响应里带 `query-continue-offset`（真实响应就有）⇒ **不追页**：还是 1 条请求。
		// 这条夹具是 3 条的**子集**所以没有游标，这里显式造一个带游标的响应来钉住"不追页"。
		const paged = JSON.stringify(Object.assign({ "query-continue-offset": 30 }, JSON.parse(fixtureBody(SMW_URL))));
		const seen2 = [];
		setFetchImpl(async (url) => { seen2.push(String(url)); return okBody(paged); });
		T.setCoreEnv({ now: () => at("2026-11-06T15:54:00+08:00") });
		const pagedData = await T.EVENT_FETCHERS["arknights"].default(SMW_URL, undefined, TZ_CN);
		check("分页：响应带 query-continue-offset ⇒ **不追页**（仍然只有 1 条请求，载荷照旧）",
			seen2.length === 1 && !!pagedData && pagedData.event === "支线故事：时间啊，向前！",
			`reqs=${seen2.length} event=${JSON.stringify(pagedData && pagedData.event)}`);

		// 空结果 ⇒ 1 条请求 + 载荷 null（未公布）
		const seen3 = [];
		setFetchImpl(async (url) => { seen3.push(String(url)); return okBody(JSON.stringify({ query: { results: {} } })); });
		T.setCoreEnv({ now: () => at("2026-11-06T15:54:00+08:00") });
		const empty = await T.EVENT_FETCHERS["arknights"].default(SMW_URL, undefined, TZ_CN);
		check("空结果：`query.results` 为空 ⇒ 载荷 null（未公布），仍然只有 1 条请求",
			seen3.length === 1 && empty === null, `reqs=${seen3.length} data=${JSON.stringify(empty)}`);

		// 请求失败 / 坏响应 ⇒ 抛错（这一侧记 down），不返回半截载荷
		for (const [label, mode, wantErr] of [["HTTP 503", "http", "http-503"], ["没有 query 的 JSON", "bad", "smw-bad-json"]]) {
			const r = await runFetcher("2026-11-06T15:54:00+08:00", { mode });
			check(`请求失败（${label}）⇒ **抛错**（error = ${wantErr}），不伪装成"没有活动"`,
				r.err === wantErr && r.data === null, JSON.stringify([r.err, r.data]));
		}
	}

	// ── ②b 持久化：`eventClaimDates` / `eventShow` / `eventHoverExtra` 必须能随 lastData 出去 ──────
	// `lastData` 是 JSON 字符串，但引擎写回前会过一遍 normalizeRecord（**只留白名单字段**）——
	// 忘了登记就会被**静默丢掉**：面板照常、提醒却少一条（或兑换期的事项名退回活动名 / 提示框少一行）。
	// 这里用 getCached 真跑一遍那条归一。
	{
		const data = {
			arknights: {
				name: "明日方舟", event: "视相博物馆：演化",
				eventDates: "10-24 16:00 ~ 11-07 03:59",
				eventClaimDates: "11-07 03:59 ~ 11-10 03:59",
				eventShow: "视相博物馆：演化 兑换截止",
				eventHoverExtra: "视相博物馆：演化\n视相博物馆：演化 兑换截止   11-10 03:59",
				notAField: "x"   // 没登记的白名单外字段必须被丢掉（证明断言不是"什么都留着"）
			},
			// 没有提示行的条目：归一后是**空串**（形状固定，消费方不必到处 `?? ""`）
			other: { name: "其它", event: "某活动", eventDates: "10-01 00:00 ~ 10-02 00:00" }
		};
		const storage = { async get(k) { return k === "lastData" ? JSON.stringify(data) : void 0; }, async set() {} };
		const engine = createEngine({ storage });
		const got = await engine.getCached();
		check("lastData 里的 `eventClaimDates` 原样读回（normalizeRecord 白名单已登记该字段）",
			got.games.arknights.eventClaimDates === "11-07 03:59 ~ 11-10 03:59"
			&& !("notAField" in got.games.arknights), JSON.stringify(got.games.arknights));
		check("lastData 里的 `eventShow` 原样读回（只给显示的事项名也要登记，否则持久化后丢掉）",
			got.games.arknights.eventShow === "视相博物馆：演化 兑换截止", JSON.stringify(got.games.arknights));
		check("lastData 里的 `eventHoverExtra` 原样读回（只进提示框的提示行也要登记，否则刷新一次就没了）",
			got.games.arknights.eventHoverExtra === "视相博物馆：演化\n视相博物馆：演化 兑换截止   11-10 03:59",
			JSON.stringify(got.games.arknights));
		check("没有 `eventHoverExtra` 的条目归一成空串（形状固定，且不会凭空多出提示行）",
			got.games.other.eventHoverExtra === "", JSON.stringify(got.games.other));

		// 沿用旧值（活动侧整列是旧值）：提示行也要跟着沿回，否则刷新失败一次后提示框就少一行。
		const merged = engine.__test.mergeEntryRecord(
			{ data: {}, ok: false, reason: "超时", gachaFail: null, eventFail: { kind: "down", reason: "超时" } },
			{
				event: "视相博物馆：演化", eventDates: "10-24 16:00 ~ 11-07 03:59",
				eventShow: "视相博物馆：演化 兑换截止",
				eventHoverExtra: "视相博物馆：演化\n视相博物馆：演化 兑换截止   11-10 03:59",
				eventHover: "视相博物馆：演化   10-24 16:00 ~ 11-07 03:59"
			},
			1000
		);
		check("活动侧沿用旧值时 `eventHoverExtra` 一起沿回（与 eventShow 同口径）",
			merged.eventStale === true
			&& merged.eventHoverExtra === "视相博物馆：演化\n视相博物馆：演化 兑换截止   11-10 03:59"
			&& merged.eventHover === "视相博物馆：演化   10-24 16:00 ~ 11-07 03:59", JSON.stringify(merged));
	}

	// ── ③ 三态：活动期 / 兑换期 / 无兑换期 ──────────────────────────────────────
	{
		// ① 活动期（now = 2026-11-06 15:54，视相 11-07 03:59 结束）
		// 外显按类别档位：这一组里只有「支线故事：时间啊，向前！」是第一档
		const a = await runFetcher("2026-11-06T15:54:00+08:00");
		check("活动期：外显是**第一档**那条（支线故事：时间啊，向前！）的活动区间（逐字）",
			!!a.data && a.data.event === "支线故事：时间啊，向前！" && a.data.eventDates === "11-01 12:00 ~ 11-22 03:59",
			JSON.stringify(a.data && [a.data.event, a.data.eventDates]));
		// ⚠️ 提示行**只进 `eventHoverExtra`**（提示框），绝不进 `eventHover`（格子会把它解析成并列条目）。
		// 形态与该活动自己那行同一排版：`名称` + **3 空格** + `内容`；每组两行（标签 ⏎ 提示行）。
		check("活动期：`eventHoverExtra` = 每条有兑换期的活动一组「<标签> ⏎ <标签> 兑换截止   MM-DD HH:mm」（视相 11-10 / 时间啊 11-29）",
			!!a.data && a.data.eventHoverExtra === EXTRA_EVENT_3,
			JSON.stringify(a.data && a.data.eventHoverExtra));
		check("活动期：`eventHover` 里**没有任何**「兑换截止 / 奖励领取期」字样（提示行不再泄漏进悬停原文）",
			!!a.data && !LEAK_RE.test(a.data.eventHover), JSON.stringify(a.data && a.data.eventHover));
		check("活动期：`eventHover` 与改造前**逐字一致**（只由 buildEventHover 产出；三条活动一行一条）",
			!!a.data && a.data.eventHover === HOVER_EVENT_3, JSON.stringify(a.data && a.data.eventHover));
		// 提醒侧的第二个 deadline：活动期就得把「奖励领取截止」窗口一起带出去（不是等进了兑换期才给）。
		check("活动期：载荷带 `eventClaimDates` = 活动结束 ~ 兑换结束（提醒侧据此建第二条 deadline）",
			!!a.data && a.data.eventClaimDates === "11-22 03:59 ~ 11-29 03:59",
			JSON.stringify(a.data && a.data.eventClaimDates));
		// 事项名（只给显示）：活动期**不能**有 `eventShow` 这个键 —— 否则面板那一行会提前变成「兑换截止」。
		check("活动期：**没有** `eventShow` 键（事项名仍是活动名，显示与改造前一致）",
			!!a.data && !("eventShow" in a.data), JSON.stringify(a.data && Object.keys(a.data)));
		check("活动期：没有兑换期的那条（登录活动）不补提示行 —— 提示行恰好 4 行、成对、不含 11-15",
			!!a.data && (() => {
				const L = String(a.data.eventHoverExtra || "").split("\n");
				const notes = L.filter((_, i) => i % 2 === 1).filter(Boolean);
				return notes.length === 2 && notes.every((l) => NOTE_LINE.test(l))
					&& !notes.some((l) => /11-15/.test(l));
			})(),
			JSON.stringify(a.data && a.data.eventHoverExtra));
		// 数据源唯一：不再有"一览 data-time 与页内活动结束时间不一致"这回事，也就不该再打日志
		check("活动期：没有「结束时间不一致」的 console.warn（SMW 是唯一数据源，两套口径已删）",
			!a.data || !String(a.data.eventHover).includes("11-14"), JSON.stringify(a.data && a.data.eventHover));

		// ② 兑换期（now = 2026-11-08 12:00：视相 11-07 03:59 已结束，兑换到 11-10 03:59）
		const b = await runFetcher("2026-11-08T12:00:00+08:00");
		check("兑换期：活动**仍然出现**（外显切到视相，没像改造前那样消失）",
			!!b.data && b.data.event === "视相博物馆：演化", JSON.stringify(b.data && b.data.event));
		check("兑换期：eventDates = 可解析的兑换区间（11-07 03:59 ~ 11-10 03:59 ⇒ 外显「还剩 X」指向兑换截止）",
			!!b.data && b.data.eventDates === "11-07 03:59 ~ 11-10 03:59"
			&& /^(\d{2}-\d{2} \d{2}:\d{2}) ~ (\d{2}-\d{2} \d{2}:\d{2})$/.test(b.data.eventDates),
			JSON.stringify(b.data && b.data.eventDates));
		// 2026-11-07 起：兑换期那条活动**不再生成提示行** ⇒ 这一组只剩"活动期 + 有兑换期"的时间啊（11-29）。
		check("兑换期：`eventHoverExtra` 只剩活动期那组「<标签> ⏎ <标签> 兑换截止   MM-DD HH:mm」（逐字）",
			!!b.data && b.data.eventHoverExtra === EXTRA_CLAIM,
			JSON.stringify(b.data && b.data.eventHoverExtra));
		check("兑换期：视相（已在兑换期）**不再贡献任何提示行**（主行本身就是兑换区间）",
			!!b.data && !String(b.data.eventHoverExtra || "").includes("视相博物馆：演化"),
			JSON.stringify(b.data && b.data.eventHoverExtra));
		check("兑换期：**不再有**解释句「活动已于 … 结束，当前为奖励领取期（…）」（用户点名删掉）",
			!!b.data && !EXPLAIN_RE.test(JSON.stringify(b.data)),
			JSON.stringify(b.data && b.data.eventHoverExtra));
		check("兑换期：`eventHover` 里没有**单条截止日**的提示行（与活动期同一个判据），且与逐字基线一致",
			!!b.data && !LEAK_RE.test(b.data.eventHover) && b.data.eventHover === HOVER_CLAIM,
			JSON.stringify(b.data && b.data.eventHover));
		check("兑换期：日期格悬停（eventDatesRaw）与格子里显示的区间是同一份",
			!!b.data && b.data.eventDatesRaw === b.data.eventDates, JSON.stringify(b.data && b.data.eventDatesRaw));
		check("兑换期：`eventClaimDates` 与 `eventDates` 同值（提醒侧去重后只留一条，不会弹两次）",
			!!b.data && b.data.eventClaimDates === b.data.eventDates, JSON.stringify(b.data && b.data.eventClaimDates));
		check("兑换期：`eventShow` = 「<去重后的活动名> 兑换截止」（一个空格，逐字 =「视相博物馆：演化 兑换截止」）",
			!!b.data && b.data.eventShow === "视相博物馆：演化 兑换截止", JSON.stringify(b.data && b.data.eventShow));
		check("一致性：`eventShow` 就是 `event` + 「 兑换截止」（同一串，不是又一次拼分类前缀）",
			!!b.data && b.data.eventShow === b.data.event + " 兑换截止"
			&& !/视相博物馆：视相博物馆/.test(b.data.eventShow), JSON.stringify(b.data && [b.data.event, b.data.eventShow]));
		check("一致性：提示行里每组的前缀 = 悬停原文里某一行的标签（同一串，逐组对得上）",
			!!b.data && (() => {
				const pairLines = b.data.eventHoverExtra.split("\n");
				const hoverLines = b.data.eventHover.split("\n");
				for (let i = 0; i + 1 < pairLines.length; i += 2) {
					const label = pairLines[i];
					if (!hoverLines.some((l) => l === label || l.indexOf(label + "   ") === 0)) return false;
					if (pairLines[i + 1].indexOf(label + " 兑换截止") !== 0) return false;
				}
				return true;
			})(), JSON.stringify([b.data && b.data.eventHoverExtra, b.data && b.data.eventHover]));
		check("兑换期：`event` 仍是活动名（提醒标题 / 侧栏轮播 / 搜索匹配读它，不被显示名改写）",
			!!b.data && b.data.event === "视相博物馆：演化", JSON.stringify(b.data && b.data.event));

		// ③ 无兑换期（纯函数）：只留那一条登录活动 ⇒ 载荷键集合 = 改造前那四个
		const only = parseArknightsSmwEvents(FIXTURE_JSON, TZ_CN).filter((x) => x.name === "感谢庆典2026限时签到");
		const noClaimPl = prtsEventPayload(only, TZ_CN, at("2026-11-08T12:00:00+08:00"));
		const PRE_CHANGE_KEYS = "event,eventDates,eventDatesRaw,eventHover";
		// P3（2026-11-07）：载荷多了两条**数据层通道** —— `events`（解析器直出的数组）与
		// `eventHoverItems`（生成悬停/数组的那份条目事实）。两者到 `mergeEntryRecord` 末尾就删掉、
		// 不进记录也不落盘，所以这里比的仍是"**会显示/会落盘**的可见字段"是否还是改造前那四个。
		const visibleKeysOf = (pl) => Object.keys(pl || {})
			.filter((k) => k !== "events" && k !== "eventHoverItems").sort().join(",");
		check("无兑换期：可见字段 = 改造前那四个（不多 eventShow / eventClaimDates / eventHoverExtra）",
			!!noClaimPl && visibleKeysOf(noClaimPl) === PRE_CHANGE_KEYS,
			`不变量=退化形状｜期望=${PRE_CHANGE_KEYS}｜实测=${visibleKeysOf(noClaimPl)}`);
		const NO_CLAIM_RAW = "11-01 12:00 ~ 11-15 03:59";
		check("无兑换期：eventDates 与 eventDatesRaw 都是源站墙钟原文（跨 TZ 逐字相同）",
			!!noClaimPl && noClaimPl.eventDates === NO_CLAIM_RAW
			&& noClaimPl.eventDatesRaw === NO_CLAIM_RAW
			&& only[0].raw === NO_CLAIM_RAW,
			JSON.stringify([noClaimPl && noClaimPl.eventDates, noClaimPl && noClaimPl.eventDatesRaw, only[0] && only[0].raw]));
		check("无兑换期：**没有** eventShow（不补猜「兑换截止」）", !!noClaimPl && !("eventShow" in noClaimPl),
			JSON.stringify(noClaimPl && Object.keys(noClaimPl)));

		// ④ 待开始的活动不出现（视相 10-24 才开 ⇒ 2026-10-23 那一刻整侧未公布）
		const before = await runFetcher("2026-10-23T16:00:00+08:00");
		check("待开始的活动不出现（三条都还没开 ⇒ 载荷 null，仍然只发 1 条请求）",
			before.data === null && before.seen.length === 1,
			`reqs=${before.seen.length} data=${JSON.stringify(before.data)}`);
	}

	// ── ④ 真机 bug 回归：提示行**不再进 `eventHover`** ⇒ 格子不会多出可见的一行 ─────────────
	// 表格格子的「探头」当时由 `scheduleHoverItems`（悬停文本 → 并列条目，82-schedule-view.js 的 cells）解析；
	// P5 起产品里没有这个函数了，判据冻结在 test/lib-text.mjs 的 `legacyHoverItemsOf`（见文件顶部 import）。
	// 提示行不匹配「名称 + 3 空格 + 档期」⇒ 旧实现里它会被攒成 pending、再被下一条活动的档期"带上"，
	// 于是格子里多出一行**可见文字**（用户截图：`兑换截止：11-10 03:59`）。
	{
		const { scheduleHoverNote } = T;
		const a = await runFetcher("2026-11-06T15:54:00+08:00");
		const b = await runFetcher("2026-11-08T12:00:00+08:00");

		// ① 悬停原文每一行都是共用排版（提示行一条都没有）—— 活动期 / 兑换期都查
		const aLines = String((a.data && a.data.eventHover) || "").split("\n").filter(Boolean);
		const bLines = String((b.data && b.data.eventHover) || "").split("\n").filter(Boolean);
		check("悬停排版：活动期 / 兑换期的 eventHover 全部是共用排版的「名称 + 3 空格 + 档期」（没有单条截止日的提示行）",
			aLines.length === 3 && bLines.length === 3
			&& aLines.concat(bLines).every((l) => SHARED_EVENT_LINE.test(l))
			&& aLines.concat(bLines).every((l) => !NOTE_LINE.test(l)),
			JSON.stringify([aLines, bLines]));

		// ② 探头条目数 = 当期活动条数（活动期 / 兑换期都是 3）—— 与改造前一致，不因提示行多出条目
		const aItems = legacyHoverItemsOf(a.data && a.data.eventHover, "支线故事：时间啊，向前！", false);
		const bItems = legacyHoverItemsOf(b.data && b.data.eventHover, "视相博物馆：演化", false);
		check("格子探头：eventHover 解析出的并列条目数 = 当期活动条数（活动期 3 条，与改造前一致）",
			aItems.length === 3, JSON.stringify(aItems.map((x) => x.title)));
		check("格子探头：兑换期也还是 3 条（视相的兑换期没有顶掉任何一条，也不多出提示行）",
			bItems.length === 3, JSON.stringify(bItems.map((x) => x.title)));
		check("格子探头：每条都是「名称 + 3 空格 + 档期」，没有一条是单条截止日的提示行（格子里不会多出那段文字）",
			aItems.concat(bItems).every((x) => SHARED_EVENT_LINE.test(`${x.title}   ${x.win}`))
			&& aItems.concat(bItems).every((x) => !NOTE_LINE.test(`${x.title}   ${x.win}`))
			&& aItems.concat(bItems).every((x) => !/奖励领取期/.test(x.title)),
			JSON.stringify(aItems.concat(bItems).map((x) => x.title)));
		// ③ 提示行**不参与解析**：把提示行拼进提示框（正确路径）之后，探头仍只解析 eventHover —— 条目数不变
		check("格子探头：提示行只在提示框里（不参与解析）⇒ 条目数仍是 3；兑换期那条的标题 =「<活动名> 兑换截止」（唯一一条）",
			legacyHoverItemsOf(a.data.eventHover, "支线故事：时间啊，向前！", false).length === 3
			&& scheduleHoverNote(a.data.eventHover, a.data, false).split("\n")
				.filter((l) => / 兑换截止   \d{2}-\d{2} \d{2}:\d{2}$/.test(l)).length === 2
			&& bItems.filter((x) => / 兑换截止$/.test(x.title)).length === 1
			&& bItems.filter((x) => / 兑换截止$/.test(x.title))[0].title === "视相博物馆：演化 兑换截止",
			JSON.stringify([scheduleHoverNote(a.data.eventHover, a.data, false), bItems.map((x) => x.title)]));

		// ④ 反向回归（证明上面那条断言**真能**抓到这次泄漏）：按旧实现把提示行插回 eventHover
		const oldHover = String(a.data.eventHover).split("\n")
			.flatMap((l) => (l === "视相博物馆：演化   10-24 16:00 ~ 11-07 03:59" ? [l, "视相博物馆：演化 兑换截止   11-10 03:59"] : [l]))
			.join("\n");
		const oldItems = legacyHoverItemsOf(oldHover, "支线故事：时间啊，向前！", false);
		check("反向回归：提示行若进了 eventHover ⇒ 探头**多出一条**「视相博物馆：演化 兑换截止   11-10 03:59」（用户截图那一行）",
			oldItems.length === 4 && oldItems.some((x) => x.title === "视相博物馆：演化 兑换截止   11-10 03:59"),
			JSON.stringify(oldItems.map((x) => x.title)));

		// ⑤ 提示框：表格格子 hoverTextOf / 「近期」行 scheduleHoverText 都调同一个插入函数
		const compSrc = readComponentsSource();
		const iHover = compSrc.indexOf("const hoverTextOf = (x, withFail)");
		const hoverBody = iHover >= 0 ? compSrc.slice(iHover, compSrc.indexOf("const itemOf =", iHover)) : "";
		check("静态：表格格子 hoverTextOf 用 scheduleHoverNote(text, g, x.isG) 插提示行（不是手写 \\n 拼接）",
			hoverBody.length > 0 && /return scheduleHoverNote\(text, g, x\.isG\) \|\| "—";/.test(hoverBody),
			hoverBody.slice(-160));
		// 2026-11-07 真机 bug 的②：活动侧**不再追加** title + 原文（卡池侧仍按"池名不在悬停里"才补）
		check("静态：hoverTextOf 的追加分支带 `x.isG` 守卫（活动侧只在 eventHover 为空时用 own 兜底）",
			hoverBody.length > 0
			&& /if \(!base\) text = own;/.test(hoverBody)
			&& /else if \(x\.isG && x\.title && base\.indexOf\(x\.title\) < 0\) text = base \+ "\\n" \+ own;/.test(hoverBody)
			&& /else text = base;/.test(hoverBody),
			hoverBody.slice(0, 240));
		const iRecent = compSrc.indexOf("function scheduleHoverText(x)");
		const recentBody = iRecent >= 0 ? compSrc.slice(iRecent, compSrc.indexOf("function scheduleKindIcon", iRecent)) : "";
		check("静态：「近期」行的 scheduleHoverText 也走同一个插入函数（两处口径一致），且活动侧不追加 title + 原文",
			recentBody.length > 0
			&& /scheduleHoverNote\(text, x\.g, x\.isG\)/.test(recentBody)
			&& /: \(hv \|\| head\)/.test(recentBody),
			recentBody);
		// 渲染层真的把 `eventHoverExtra` 透传进面板（否则 refetch 之后提示行整段消失）
		const rawAll = compSrc;
		check("静态：面板把 `eventHoverExtra` 从抓取结果透传给面板条目（与 eventShow 同口径）",
			/eventShow: sc\.eventShow \|\| "",[\s\S]{0,120}?eventHoverExtra: sc\.eventHoverExtra \|\| ""/.test(rawAll));

		// ⑥ 插入位置：**紧跟该活动那一行之后**，不是统一堆到末尾
		const gNote = {
			eventHover: "视相博物馆：演化   10-24 16:00 ~ 11-07 03:59\n感谢庆典2026限时签到   11-01 12:00 ~ 11-15 03:59",
			eventHoverExtra: "视相博物馆：演化\n视相博物馆：演化 兑换截止   11-10 03:59"
		};
		check("提示框拼接：提示行插在**该活动那一行之后**（第 2 行，不是堆到末尾）",
			scheduleHoverNote(gNote.eventHover, gNote, false)
				=== "视相博物馆：演化   10-24 16:00 ~ 11-07 03:59\n视相博物馆：演化 兑换截止   11-10 03:59\n感谢庆典2026限时签到   11-01 12:00 ~ 11-15 03:59",
			JSON.stringify(scheduleHoverNote(gNote.eventHover, gNote, false)));
		// 锚点要精确：「墟」不能把提示行插到「墟·复刻」那一行后面
		const gPrefix = { eventHoverExtra: "支线故事：墟\n支线故事：墟 兑换截止   11-10 03:59" };
		const dupHover = "支线故事：墟·复刻   11-01 04:00 ~ 11-15 03:59\n支线故事：墟   10-24 16:00 ~ 11-07 03:59";
		check("提示框拼接：锚点按整行/「标签 + 3 空格」精确匹配（「墟」不抢「墟·复刻」那行的位置）",
			scheduleHoverNote(dupHover, gPrefix, false)
				=== "支线故事：墟·复刻   11-01 04:00 ~ 11-15 03:59\n支线故事：墟   10-24 16:00 ~ 11-07 03:59\n支线故事：墟 兑换截止   11-10 03:59",
			JSON.stringify(scheduleHoverNote(dupHover, gPrefix, false)));
		check("提示框拼接：没有 `eventHoverExtra`（或卡池侧）⇒ 原样返回，不补空行",
			scheduleHoverNote("a\nb", { eventHover: "x" }, false) === "a\nb"
			&& scheduleHoverNote("a\nb", { eventHoverExtra: "x\ny" }, true) === "a\nb");
		check("提示框拼接：悬停为空时至少把提示行给出来（不丢 deadline）",
			scheduleHoverNote("", gNote, false) === "视相博物馆：演化 兑换截止   11-10 03:59",
			JSON.stringify(scheduleHoverNote("", gNote, false)));
		// 端到端：真抓取的载荷 + 真档案 ⇒ 两条提示行分别紧跟在自己那条活动之后
		const rec = Object.assign({}, a.data, { name: "明日方舟" });
		check("提示框拼接（端到端）：活动期实际提示框逐行 = 原 hover 三行 + 两条提示行各插在其活动之后",
			scheduleHoverNote(a.data.eventHover, rec, false)
				=== "视相博物馆：演化   10-24 16:00 ~ 11-07 03:59\n视相博物馆：演化 兑换截止   11-10 03:59\n"
				+ "登录活动：感谢庆典2026限时签到   11-01 12:00 ~ 11-15 03:59\n"
				+ "支线故事：时间啊，向前！   11-01 12:00 ~ 11-22 03:59\n支线故事：时间啊，向前！ 兑换截止   11-29 03:59",
			JSON.stringify(scheduleHoverNote(a.data.eventHover, rec, false)));
		check("提示框拼接（端到端）：不出现解释句（「活动已于 / 当前为奖励领取期」）",
			!EXPLAIN_RE.test(scheduleHoverNote(a.data.eventHover, rec, false))
			&& !EXPLAIN_RE.test(scheduleHoverNote(b.data.eventHover, b.data, false)));
	}

	// ── ⑤ 真机 bug 回归（2026-11-07 lastData）：兑换期的活动被别的活动**挤掉** ───────────────
	// 现场：now ≈ 2026-11-07，lastData 里 `event` 是「支线故事：时间啊，向前！」（11-22 结束，还剩 15 天），
	// 而「视相博物馆：演化」11-07 03:59 已结束 ⇒ 正处于**奖励领取期**（兑换截止 11-10 03:59），
	// 本该作为「视相博物馆：演化 兑换截止」出现在面板与「近期」，却在 `eventHover` 里排第一、
	// 外显被 tier 档位更高的支线故事抢走（它还剩 15 天 ⇒ 也不进「近期」）⇒ 两条都看不到。
	// 根因：`pickEventPrimary` 的第一排序键是类别档位（「支线故事」含「故事」⇒ tier 1，
	// 「视相博物馆」⇒ tier 2），**紧迫的兑换期**因此永远排在后面。
	// 修法：`phase === "claim"` 的候选**排最前**（压过档位）；其它游戏没有 `phase` ⇒ 行为不变。
	{
		const { pickEventPrimary, sortEventItems } = T;
		// 真机 lastData 等价的候选（两个窗口首尾相接，与 prtsEventPayload 生成的一致）
		const claimCand = {
			name: "视相博物馆：演化", category: "视相博物馆", phase: "claim",
			startTs: at("2026-11-07T03:59:00+08:00"), endTs: at("2026-11-10T03:59:00+08:00")
		};
		const runCand = {
			name: "支线故事：时间啊，向前！", category: "支线故事", phase: "event",
			startTs: at("2026-11-01T12:00:00+08:00"), endTs: at("2026-11-22T03:59:00+08:00")
		};
		// 先证明"档位确实相反"——否则下面那条断言可能因为别的原因通过
		check("先决：类别档位把兑换期那条判在第二档、把还剩 15 天的那条判在第一档（= 旧行为会选后者）",
			eventTier(claimCand) === 2 && eventTier(runCand) === 1,
			JSON.stringify([eventTier(claimCand), eventTier(runCand)]));
		check("挑选：奖励领取期的候选排最前（与输入顺序无关，压过类别档位）",
			pickEventPrimary([claimCand, runCand]) === claimCand
			&& pickEventPrimary([runCand, claimCand]) === claimCand,
			JSON.stringify([[claimCand, runCand].map((x) => x.name), [runCand, claimCand].map((x) => x.name)]));

		// 端到端（payload）：同一份输入 → 外显必须是兑换期那一条
		const snapshot = [
			{
				name: "视相博物馆：演化", category: "视相博物馆", page: "视相博物馆：演化",
				startTs: at("2026-10-24T16:00:00+08:00"), stageEndTs: at("2026-11-07T03:59:00+08:00"),
				claimEndTs: at("2026-11-10T03:59:00+08:00"), raw: "10-24 16:00 ~ 11-07 03:59"
			},
			{
				name: "时间啊，向前！", category: "支线故事", page: "时间啊，向前！",
				startTs: at("2026-11-01T12:00:00+08:00"), stageEndTs: at("2026-11-22T03:59:00+08:00"),
				claimEndTs: null, raw: "11-01 12:00 ~ 11-22 03:59"
			}
		];
		const now = at("2026-11-07T12:00:00+08:00");   // 视相已结束 8 小时，兑换期还剩 3 天
		const pl = prtsEventPayload(snapshot, TZ_CN, now);
		check("端到端（真机等价输入）：外显 `event` = 兑换期那一条（视相博物馆：演化），不再被还剩 15 天的那条挤掉",
			!!pl && pl.event === "视相博物馆：演化", JSON.stringify(pl && pl.event));
		check("端到端：`eventShow` = 「视相博物馆：演化 兑换截止」（面板/近期那一行的事项名）",
			!!pl && pl.eventShow === "视相博物馆：演化 兑换截止", JSON.stringify(pl && pl.eventShow));
		check("端到端：`eventDates` = 兑换区间（11-07 03:59 ~ 11-10 03:59 ⇒「还剩」指向兑换截止）",
			!!pl && pl.eventDates === "11-07 03:59 ~ 11-10 03:59", JSON.stringify(pl && pl.eventDates));
		// 悬停**不动**：仍按结束时间升序全量（兑换期那条 11-10 本来就最早，这里换成"兑换期最晚"再验一次）
		const hoverOrder = sortEventItems([
			{ name: "晚截止：兑换期", category: "视相博物馆", phase: "claim", startTs: at("2026-11-07T03:59:00+08:00"), endTs: at("2026-11-20T03:59:00+08:00") },
			{ name: "早结束：进行中", category: "支线故事", phase: "event", startTs: at("2026-11-01T12:00:00+08:00"), endTs: at("2026-11-12T03:59:00+08:00") }
		]);
		check("悬停排序（sortEventItems）**不动**：仍按结束时间升序（兑换期最晚 ⇒ 排在悬停最后）",
			hoverOrder.length === 2 && hoverOrder[0].name === "早结束：进行中" && hoverOrder[1].name === "晚截止：兑换期",
			JSON.stringify(hoverOrder.map((x) => x.name)));
		check("外显与悬停**各有各的口径**：同一组里外显选领取期那条、悬停第一条是更早结束的那条",
			pickEventPrimary(hoverOrder).name === "晚截止：兑换期" && hoverOrder[0].name === "早结束：进行中",
			JSON.stringify([pickEventPrimary(hoverOrder).name, hoverOrder[0].name]));

		// 反向守卫 ①：两个都是 `phase: "event"` ⇒ 与改动前**完全一致**（类别档位仍然生效）
		const runOnly = [
			Object.assign({}, claimCand, { phase: "event" }),
			runCand
		];
		check("反向守卫：两条都是活动期 ⇒ 仍选类别档位更高的那条（支线故事）。兑换期结束更早也不再影响",
			pickEventPrimary(runOnly) === runOnly[1] && pickEventPrimary([runOnly[1], runOnly[0]]) === runOnly[1],
			JSON.stringify(runOnly.map((x) => x.name)));
		// 同档位时仍按结束时间升序（旧规则的第二、三键没被挤掉）
		const sameTier = [
			{ name: "A", category: "支线故事", phase: "event", startTs: 10, endTs: 300 },
			{ name: "B", category: "支线故事", phase: "event", startTs: 20, endTs: 200 },
			{ name: "C", category: "支线故事", phase: "event", startTs: 30, endTs: 200 }
		];
		check("反向守卫：同档位内仍按 endTs 升序、再按 startTs 升序（旧排序键一个没丢）",
			pickEventPrimary(sameTier).name === "B" && pickEventPrimary([sameTier[2], sameTier[0], sameTier[1]]).name === "B",
			pickEventPrimary(sameTier).name);
		// 两个都是 claim（同一时刻两条都在兑换期）⇒ 档位规则在领取期内部照旧生效
		const twoClaims = [
			Object.assign({}, claimCand),
			{ name: "危机合约：兑换期", category: "危机合约", phase: "claim", startTs: 10, endTs: 400 }
		];
		check("反向守卫：两条都在领取期 ⇒ 领取期**内部**仍按类别档位/结束时间挑（不是随便选一条）",
			pickEventPrimary(twoClaims) === twoClaims[1] && pickEventPrimary([twoClaims[1], twoClaims[0]]) === twoClaims[1],
			JSON.stringify(twoClaims.map((x) => x.name)));

		// 反向守卫 ②：**其它游戏的数据形状没有 `phase`** ⇒ 与显式 `"event"` 逐排列同解。
		// 4 条候选（档位 × 结束时间都不同）取 24 种排列：去掉 phase / 标成 "event" 两种形状的挑选结果必须一致。
		const base = [
			{ name: "t1-早", category: "支线故事", startTs: 100, endTs: 200 },   // tier 1
			{ name: "t1-晚", category: "危机合约", startTs: 100, endTs: 900 },   // tier 1
			{ name: "t2-早", category: "登录活动", startTs: 50, endTs: 150 },    // tier 2
			{ name: "t2-晚", category: "签到活动", startTs: 50, endTs: 800 }     // tier 2
		];
		const permute = (arr) => arr.length <= 1 ? [arr] : arr.flatMap((x, i) =>
			permute(arr.slice(0, i).concat(arr.slice(i + 1))).map((rest) => [x].concat(rest)));
		const withEvent = (arr) => arr.map((x) => Object.assign({}, x, { phase: "event" }));
		const perms = permute(base);
		const shapeOk = perms.every((p) => {
			const noPhase = pickEventPrimary(p).name;
			const asEvent = pickEventPrimary(withEvent(p)).name;
			return noPhase === asEvent && noPhase === "t1-早";   // tier 1 → 结束最早的 t1-早
		});
		check("反向守卫：没有 `phase` 的候选（= 其它游戏的数据形状）与显式 `phase:\"event\"` **24 种排列逐一相同**",
			perms.length === 24 && shapeOk,
			JSON.stringify(perms.filter((p) => pickEventPrimary(p).name !== pickEventPrimary(withEvent(p)).name).map((p) => p.map((x) => x.name))));
	}

	// ── ⑥ 真机 bug 回归（2026-11-07）：悬停提示「重复三次」─────────────────────────────
	// 用户机器上读到的 title（now = 2026-11-07 05:16，视相已进兑换期）：
	//   ① 兑换期那条活动**多出一行与主行逐字同区间**的「… 兑换截止」；
	//   ② 末尾又追加了 `title` ⏎ `rawSrc` 两行（「视相博物馆：演化」⏎「11-07 03:59 ~ 11-10 03:59」）。
	// 这里把两段**期望文本逐字**钉住，并加三条反向守卫：
	//   · 整段里任何一行不得出现两次；不得出现连续两行完全相同；
	//   · 活动侧不得出现「活动名单独一行 ⏎ 下一行只有区间」这种两行形态。
	// 两条渲染路径都查：表格格子（hoverTextOf：base = eventHover ⇒ scheduleHoverNote）
	// 与「近期」行（scheduleHoverText）—— 用户 2026-11-06 定的口径是"两处必须一致"。
	{
		const { scheduleNormalize, scheduleHoverText } = T;
		const NOW_EVENT = "2026-11-06T15:54:00+08:00";   // 活动期（视相 11-07 03:59 才结束）
		const NOW_CLAIM = "2026-11-08T12:00:00+08:00";   // 兑换期（视相 11-10 03:59 才截止）
		const a = await runFetcher(NOW_EVENT);
		const b = await runFetcher(NOW_CLAIM);

		// ① 先钉住夹具确实被解析成真机上那三条活动（否则下面的逐字断言可能是"空对空"）
		check("真机夹具：活动期 `eventHover` = 那三条活动，逐字",
			!!a.data && a.data.eventHover === "视相博物馆：演化   10-24 16:00 ~ 11-07 03:59\n"
				+ "登录活动：感谢庆典2026限时签到   11-01 12:00 ~ 11-15 03:59\n"
				+ "支线故事：时间啊，向前！   11-01 12:00 ~ 11-22 03:59",
			JSON.stringify(a.data && a.data.eventHover));
		check("真机夹具：活动期的提示行恰两条（视相 11-10 / 时间啊 11-29；登录活动没有兑换期不补）",
			!!a.data && a.data.eventHoverExtra === "视相博物馆：演化\n视相博物馆：演化 兑换截止   11-10 03:59\n"
				+ "支线故事：时间啊，向前！\n支线故事：时间啊，向前！ 兑换截止   11-29 03:59",
			JSON.stringify(a.data && a.data.eventHoverExtra));

		// ② 活动期：两段路径的悬停最终全文 **逐字** = 用户给的期望
		check("活动期：表格格子的悬停全文**逐字** = 期望（5 行，兑换截止插在自己那行之后）",
			!!a.data && cellHoverOf(a.data) === HOVER_REAL_EVENT, JSON.stringify(cellHoverOf(a.data)));
		check("活动期：「近期」行的悬停全文与格子**同一份**（逐字）",
			!!a.data && rowHoverOf(a.data, NOW_EVENT) === HOVER_REAL_EVENT, JSON.stringify(rowHoverOf(a.data, NOW_EVENT)));

		// ③ 兑换期：视相的主行**就是兑换区间** ⇒ 不再生成提示行、也不再追加 title + rawSrc
		check("兑换期：`eventHoverExtra` 里**没有**视相那一组（已进兑换期，一行提示都不生成）",
			!!b.data && b.data.eventHoverExtra === "支线故事：时间啊，向前！\n支线故事：时间啊，向前！ 兑换截止   11-29 03:59",
			JSON.stringify(b.data && b.data.eventHoverExtra));
		check("兑换期：表格格子的悬停全文**逐字** = 期望（4 行，主行 =「视相博物馆：演化 兑换截止   11-07 03:59 ~ 11-10 03:59」）",
			!!b.data && cellHoverOf(b.data) === HOVER_REAL_CLAIM, JSON.stringify(cellHoverOf(b.data)));
		check("兑换期：「近期」行的悬停全文与格子**同一份**（逐字）",
			!!b.data && rowHoverOf(b.data, NOW_CLAIM) === HOVER_REAL_CLAIM, JSON.stringify(rowHoverOf(b.data, NOW_CLAIM)));
		check("兑换期：旧主行「视相博物馆：演化   11-07 03:59 ~ 11-10 03:59」（不带「兑换截止」）**不再出现**",
			!!b.data && !linesOf(cellHoverOf(b.data)).includes("视相博物馆：演化   11-07 03:59 ~ 11-10 03:59"),
			JSON.stringify(linesOf(cellHoverOf(b.data))));
		check("兑换期：`eventShow` = 悬停主行的名字（面板那一行与悬停那一行是同一串）",
			!!b.data && linesOf(cellHoverOf(b.data))[0].indexOf(b.data.eventShow + "   ") === 0,
			JSON.stringify([b.data && b.data.eventShow, linesOf(cellHoverOf(b.data))[0]]));

		// ④ 反向守卫：去重 / 连续重复 / 两行形态 —— 两段 × 两条路径
		// 三条结构不变量走 `test/lib-text.mjs` 的同一份实现（timeline 那一段也调它）。
		for (const [label, txt] of [
			["活动期（表格格子）", cellHoverOf(a.data)],
			["兑换期（表格格子）", cellHoverOf(b.data)],
			["活动期（「近期」行）", rowHoverOf(a.data, NOW_EVENT)],
			["兑换期（「近期」行）", rowHoverOf(b.data, NOW_CLAIM)]
		]) {
			assertHoverTextInvariants(label, txt);
		}

		// ⑤ 反向证明（守卫不是空的）：把真机那两处毛病**造回去**，守卫必须报红
		const withOwn = HOVER_REAL_CLAIM + "\n视相博物馆：演化\n11-07 03:59 ~ 11-10 03:59";   // 旧 bug ② 的形状
		check("反向证明：末尾追加 `title` ⏎ `rawSrc`（旧 bug ②）会被「两行形态」守卫抓到（期望文本则一条都没有）",
			bareTwoLineFormOf(withOwn).length === 1 && bareTwoLineFormOf(HOVER_REAL_CLAIM).length === 0,
			JSON.stringify(bareTwoLineFormOf(withOwn)));
		const dupText = HOVER_REAL_CLAIM + "\n" + linesOf(HOVER_REAL_CLAIM)[0];                 // 旧 bug ① 的形状
		check("反向证明：同一个区间那一行出现两次（旧 bug ①）会被去重断言抓到",
			dupLinesOf(dupText).length === 1 && dupLinesOf(dupText)[0] === "视相博物馆：演化 兑换截止   11-07 03:59 ~ 11-10 03:59",
			JSON.stringify(dupLinesOf(dupText)));
		const oldPair = "视相博物馆：演化   11-07 03:59 ~ 11-10 03:59\n视相博物馆：演化 兑换截止   11-07 03:59 ~ 11-10 03:59";
		check("反向证明：旧实现「主行（不带兑换截止）+ 同区间提示行」两行只差 5 个字，所以必须靠**逐字**基线兜住",
			oldPair !== HOVER_REAL_CLAIM && linesOf(oldPair).length === 2
			&& linesOf(oldPair)[0].replace("   ", " 兑换截止   ") === linesOf(oldPair)[1],
			oldPair);

		// ⑥ 探头：兑换期那条主行的名字 = 面板事项名（`eventShow`）⇒ 不该被当成"另一条并列活动"
		const bItems = legacyHoverItemsOf(b.data.eventHover, "视相博物馆：演化", false);
		check("格子探头：兑换期仍是 3 条活动（主行带着「兑换截止」也照旧解析成一条）",
			bItems.length === 3 && bItems[0].title === "视相博物馆：演化 兑换截止"
			&& bItems[0].win === "11-07 03:59 ~ 11-10 03:59",
			JSON.stringify(bItems.map((x) => [x.title, x.win])));
		// ⚠️ P3c（2026-11-07）：这条判据的**唯一实现**现在在数据层 `50-refresh.js` 的
		// `dataArrayExtrasFromEntriesOf`（P3c 删掉了 81 里的 `scheduleHoverOnes` 与兼容分支，
		// 判据只剩这一处）。断言从"grep 显示层"改成"grep 数据层"—— 守的仍是同一件事：
		// 与外显事项名（`show`）同名的那条不再重复成第二个条目。
		const refreshSrc = readFileSync(path.join(REPO, "src", "client", "50-refresh.js"), "utf8");
		check("静态：并列条目判据跳过与外显事项名（`show`）同名的那条（兑换期主行不会在探头里重复一条）",
			/if \(main\.show && title === main\.show\) continue;/.test(refreshSrc),
			(refreshSrc.match(/if \(main\.show && title === main\.show\) continue;/) || [""])[0]);

		// ⑦ 卡池侧**行为不变** / 活动侧只有 eventHover 为空才兜底
		const gachaX = {
			isG: true, title: "寻访：视相", show: "寻访：视相",
			rawSrc: "10-24 16:00 ~ 11-07 03:59", raw: "10-24 16:00 ~ 11-07 03:59",
			g: { bannerHover: "寻访：视相：角色A   10-24 16:00 ~ 11-07 03:59", eventHover: "" }
		};
		check("卡池侧不变：「近期」行的悬停仍是「悬停原文 ⏎ 池名 ⏎ 档期」",
			scheduleHoverText(gachaX) === "寻访：视相：角色A   10-24 16:00 ~ 11-07 03:59\n寻访：视相\n10-24 16:00 ~ 11-07 03:59",
			JSON.stringify(scheduleHoverText(gachaX)));
		const evEmpty = {
			isG: false, title: "视相博物馆：演化", show: "视相博物馆：演化 兑换截止",
			rawSrc: "11-07 03:59 ~ 11-10 03:59", g: { eventHover: "", eventHoverExtra: "" }
		};
		check("活动侧兜底：`eventHover` 为空（当期只有 1 条）⇒ 仍给「标题 ⏎ 原文」两行，不返回空",
			scheduleHoverText(evEmpty) === "视相博物馆：演化\n11-07 03:59 ~ 11-10 03:59",
			JSON.stringify(scheduleHoverText(evEmpty)));
		const evMulti = {
			isG: false, title: "视相博物馆：演化", show: "视相博物馆：演化 兑换截止",
			rawSrc: "11-07 03:59 ~ 11-10 03:59", g: { eventHover: "以及常驻活动 3 项" }
		};
		check("活动侧：只要 `eventHover` 非空就**不追加**（追加就是同一区间出现两次的入口）",
			scheduleHoverText(evMulti) === "以及常驻活动 3 项", JSON.stringify(scheduleHoverText(evMulti)));
		// scheduleNormalize 只用来造「近期」行的条目；这里确认它给的 title / rawSrc 就是上面那两个值
		const bNorm = scheduleNormalize(Object.assign({ id: "arknights" }, b.data), "event", new Date(Date.parse(NOW_CLAIM)));
		check("「近期」行条目：title = 活动名、show =「… 兑换截止」、rawSrc = 兑换区间（悬停读的就是这几个字段）",
			bNorm.title === "视相博物馆：演化" && bNorm.show === "视相博物馆：演化 兑换截止"
			&& bNorm.rawSrc === "11-07 03:59 ~ 11-10 03:59",
			JSON.stringify([bNorm.title, bNorm.show, bNorm.rawSrc]));
	}

	// ── ⑦ 活动来源（用户 2026-11-07 定名）：「PRTS 活动解析」= 默认 SMW / 「PRTS 活动一览」= 手动备选 ──
	// 用户原话：「原来的还叫一览只是降级备选 新的SMW才叫解析」。
	//   · 默认（`eventUrl` + `eventSource`，设置页「活动来源」下拉的默认项）= **PRTS 活动解析**（SMW action=ask）；
	//   · 备选（`eventAltSources` 第一项）= **PRTS 活动一览**（旧 HTML 链路，从 8de869d 恢复，抓取器键
	//     `arknights-event-list`）。
	// 这一段守四件事，缺一条就是回归：
	//   ① 两个名字**逐字**（注册表里的字段 + 设置页下拉实际会渲染出的选项）；
	//   ② **没有自动兜底**：SMW 失败 ⇒ 抛错，`calls` 里**不许**出现活动一览的请求 —— 哪怕备选侧给了
	//      一份"能解析出当期活动"的夹具（只断言"结果为 null"挡不住回归，"偷偷换站成功"恰恰会返回数据）；
	//   ③ **手动可切**：切到备选 ⇒ 用真机夹具端到端取到数据（外显区间 + 悬停行 + 提示行），且与 SMW
	//      同一时刻的载荷**逐字相同**（两种来源归一到同一份三态，下游不看来源）；
	//   ④ **可持久化**：切到备选后读回仍是备选（沿用既有活动侧键 `customEventUrls`，没有新增键）。
	{
		const { getDefaultSourceName, getEntryUrl, eventFetcherFor } = T;
		const ARK = T.SOURCES.find((s) => s.id === "arknights");
		const LIST_URL = T.parsers["arknights"].ARKNIGHTS_EVENTS_LIST_URL;
		const PAGES_PREFIX = T.parsers["arknights"].PRTS_PAGES_API;
		const SMW = T.parsers["arknights"].ARKNIGHTS_SMW_URL;
		const at7 = (iso) => Date.parse(iso);
		const NOW_EVENT = "2026-11-06T15:54:00+08:00";   // 活动期
		const NOW_CLAIM = "2026-11-08T12:00:00+08:00";   // 兑换期
		// 真机 2026-11-07 那三条活动的**一览**夹具（与 SMW 夹具同一个时刻、同一批活动）：
		// `fixtureBody` 的 overrides 只在"确实请求了这两个地址"时才生效 —— 所以 SMW 失败时
		// 这些夹具的存在本身就是"备选侧本来能取到数据"的反证。
		const LIST_OV = {
			[LIST_URL]: "arknights-events-list-1107/response.txt",
			[PAGES_PREFIX]: "arknights-events-pages-1107/response.txt"
		};
		const comp = readComponentsSource();

		// ① 命名（逐字）
		check("命名：默认活动来源逐字 = 「PRTS 活动解析」（`eventSource`）",
			ARK.eventSource === "PRTS 活动解析", JSON.stringify(ARK.eventSource));
		check("命名：默认活动源仍指向 SMW `action=ask`（不是一览的 `action=parse`）",
			ARK.eventUrl === SMW && /action=ask/.test(ARK.eventUrl) && !/action=parse/.test(ARK.eventUrl), ARK.eventUrl);
		check("命名：备选活动来源只有一条、label 逐字 = 「PRTS 活动一览」",
			Array.isArray(ARK.eventAltSources) && ARK.eventAltSources.length === 1
			&& ARK.eventAltSources[0].label === "PRTS 活动一览",
			JSON.stringify(ARK.eventAltSources));
		check("命名：备选指向活动一览的 `action=parse` 地址，抓取器键 = `arknights-event-list`",
			ARK.eventAltSources[0].url === LIST_URL && /action=parse/.test(LIST_URL)
			&& ARK.eventAltSources[0].fetcher === "arknights-event-list",
			JSON.stringify([ARK.eventAltSources[0].url, ARK.eventAltSources[0].fetcher]));
		check("注册：`EVENT_FETCHERS[\"arknights\"]` 有 default（SMW）与 arknights-event-list（一览）两个抓取器",
			!!T.EVENT_FETCHERS["arknights"] && typeof T.EVENT_FETCHERS["arknights"].default === "function"
			&& typeof T.EVENT_FETCHERS["arknights"]["arknights-event-list"] === "function",
			JSON.stringify(Object.keys(T.EVENT_FETCHERS["arknights"] || {})));

		// ② 设置页「活动来源」下拉（**既有机制**：列头 + 下拉 + 持久化都在，本轮只补了条目的备选源）
		check("设置页：表头本来就有「活动来源」一列（不是本轮新加的控件）",
			/children: "\\u6D3B\\u52A8\\u6765\\u6E90"/.test(comp));
		check("设置页：活动来源下拉的默认项取 `getDefaultSourceName(g, \"eventUrl\")`（= eventSource）",
			/children: getDefaultSourceName\(g, "eventUrl"\)/.test(comp));
		check("设置页：备选项由 `g.eventAltSources` 的 label 渲染（不写死名字）",
			/\(g\.eventAltSources \|\| \[\]\)\.map\(\(a\) => \(0, react_jsx_runtime\.jsx\)\("option", \{ value: altSourceId\(a\), children: a\.label \}/.test(comp));
		check("设置页渲染：活动来源下拉的三项逐字 = [PRTS 活动解析, PRTS 活动一览, 自定义]",
			JSON.stringify([
				getDefaultSourceName(ARK, "eventUrl"),
				...(ARK.eventAltSources || []).map((a) => a.label),
				"自定义"
			]) === JSON.stringify(["PRTS 活动解析", "PRTS 活动一览", "自定义"]),
			JSON.stringify([getDefaultSourceName(ARK, "eventUrl"), (ARK.eventAltSources || []).map((a) => a.label)]));

		// ③ **没有自动兜底**：SMW 失败 / 坏响应 ⇒ 抛错，且一次都不去抓一览
		//    transport 故意让**备选侧**返回一份能解析出当期活动的夹具（若发生换站，载荷就会非空）。
		for (const [label, mode, wantErr] of [["HTTP 503", "http", "http-503"], ["没有 query 的 JSON", "bad", "smw-bad-json"]]) {
			const seen = [];
			setFetchImpl(async (url) => {
				const u = String(url);
				seen.push(u);
				if (u.startsWith(LIST_URL)) return okBody(fixtureBody(LIST_URL, LIST_OV));       // 备选"本来能取到数据"
				if (u.startsWith(PAGES_PREFIX)) return okBody(fixtureBody(PAGES_PREFIX, LIST_OV));
				if (mode === "http") return { ok: false, status: 503, headers: { get: () => null }, text: async () => "", json: async () => ({}) };
				return okBody(BAD_BODY);
			});
			T.setCoreEnv({ now: () => at7(NOW_EVENT) });
			let data = null, err = null;
			try {
				data = await T.EVENT_FETCHERS["arknights"].default(SMW, undefined, TZ_CN);
			} catch (e) {
				err = String((e && e.message) || e);
			}
			check(`无自动兜底（${label}）：默认源**抛错**（${wantErr}）、载荷 null（不是「未公布」）`,
				err === wantErr && data === null, JSON.stringify([err, data]));
			check(`无自动兜底（${label}）：calls 里**没有任何**活动一览 / 批量 wikitext 请求（备选侧有可用夹具也没被碰）`,
				seen.length === 1 && !seen.some((u) => u.startsWith(LIST_URL) || u.includes("action=parse") || u.includes("action=query&prop=revisions")),
				JSON.stringify(seen.map((u) => u.slice(0, 70))));
		}

		// ④ **手动切到「PRTS 活动一览」** ⇒ 端到端取到数据（外显区间 / 悬停行 / 提示行全都要有）
		const runList = async (nowIso) => {
			const seen = [];
			setFetchImpl(async (url) => {
				const u = String(url);
				seen.push(u);
				if (u.startsWith(LIST_URL)) return okBody(fixtureBody(LIST_URL, LIST_OV));
				if (u.startsWith(PAGES_PREFIX)) return okBody(fixtureBody(PAGES_PREFIX, LIST_OV));
				return { ok: false, status: 404, headers: { get: () => null }, text: async () => "", json: async () => ({}) };
			});
			T.setCoreEnv({ now: () => at7(nowIso) });
			return { data: await T.EVENT_FETCHERS["arknights"]["arknights-event-list"](LIST_URL, undefined, TZ_CN), seen };
		};
		const listEvent = await runList(NOW_EVENT);
		check("手动切换（一览）：恰好 2 条请求 —— ① 活动一览 + ② **一次**批量 wikitext（不是 N 次详情页）",
			listEvent.seen.length === 2
			&& listEvent.seen[0] === LIST_URL + "&origin=*"
			&& listEvent.seen[1].startsWith(PAGES_PREFIX),
			JSON.stringify(listEvent.seen.map((u) => u.slice(0, 70))));
		check("手动切换（一览）：批量 titles = 3 条相关活动页（一览里只有这 3 条在窗口内）",
			decodeURIComponent(String(listEvent.seen[1] || "").split("titles=")[1] || "").split("|").length === 3,
			decodeURIComponent(String(listEvent.seen[1] || "").split("titles=")[1] || ""));
		check("手动切换（一览）端到端：外显事项名 =「支线故事：时间啊，向前！」，外显区间逐字 = 11-01 12:00 ~ 11-22 03:59",
			!!listEvent.data && listEvent.data.event === "支线故事：时间啊，向前！"
			&& listEvent.data.eventDates === "11-01 12:00 ~ 11-22 03:59",
			JSON.stringify(listEvent.data && [listEvent.data.event, listEvent.data.eventDates]));
		check("手动切换（一览）端到端：悬停 3 行逐字（三条当期活动，名称 + 3 空格 + 档期）",
			!!listEvent.data && listEvent.data.eventHover === HOVER_EVENT_3, JSON.stringify(listEvent.data && listEvent.data.eventHover));
		check("手动切换（一览）端到端：提示行逐字（视相 11-10 / 时间啊 11-29）",
			!!listEvent.data && listEvent.data.eventHoverExtra === EXTRA_EVENT_3,
			JSON.stringify(listEvent.data && listEvent.data.eventHoverExtra));
		check("手动切换（一览）端到端：提醒侧的第二条 deadline 也在（`eventClaimDates` = 活动结束 ~ 兑换结束）",
			!!listEvent.data && listEvent.data.eventClaimDates === "11-22 03:59 ~ 11-29 03:59",
			JSON.stringify(listEvent.data && listEvent.data.eventClaimDates));

		// 两种来源归一到**同一份三态**：同一时刻的载荷逐字相同（下游显示/提醒/持久化不看来源）
		const runSmw = async (nowIso) => {
			setFetchImpl(async () => okBody(fixtureBody(SMW)));
			T.setCoreEnv({ now: () => at7(nowIso) });
			return T.EVENT_FETCHERS["arknights"].default(SMW, undefined, TZ_CN);
		};
		const FIELDS = ["event", "eventDates", "eventDatesRaw", "eventHover", "eventHoverExtra", "eventClaimDates", "eventShow"];
		const pick = (o) => FIELDS.map((k) => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null));
		const smwEvent = await runSmw(NOW_EVENT);
		const listClaim = (await runList(NOW_CLAIM)).data;
		const smwClaim = await runSmw(NOW_CLAIM);
		check("两来源同一份三态（活动期）：SMW 与一览的 7 个字段**逐字相同**",
			JSON.stringify(pick(smwEvent)) === JSON.stringify(pick(listEvent.data)),
			JSON.stringify([pick(smwEvent), pick(listEvent.data)]));
		check("两来源同一份三态（兑换期）：SMW 与一览的 7 个字段**逐字相同**（含 `eventShow` / 兑换区间）",
			JSON.stringify(pick(smwClaim)) === JSON.stringify(pick(listClaim)),
			JSON.stringify([pick(smwClaim), pick(listClaim)]));
		check("手动切换（一览）兑换期：外显切到兑换区间、事项名带「兑换截止」（与 SMW 同口径）",
			!!listClaim && listClaim.event === "视相博物馆：演化"
			&& listClaim.eventDates === "11-07 03:59 ~ 11-10 03:59"
			&& listClaim.eventShow === "视相博物馆：演化 兑换截止",
			JSON.stringify(listClaim && [listClaim.event, listClaim.eventDates, listClaim.eventShow]));

		// ⑤ 持久化 / 路由：切到备选后**读回仍是备选**（键沿用既有 `customEventUrls`，没有新增键）
		check("持久化：默认设置里本来就有活动侧键 `customEventUrls`（沿用，不新增键）",
			T.DEFAULT_SETTINGS.customEventUrls === "{}", JSON.stringify(T.DEFAULT_SETTINGS.customEventUrls));
		check("持久化：设置页两种活动来源选择都写这个键（选备选源不再是「删掉 key 弹回默认」）",
			/(else if \(mode === "default"\) delete next\[id\];\s*\n\s*else next\[id\] = mode;)/.test(comp)
			&& /const next = \{ \.\.\.\(eventUrls \|\| \{\}\) \};/.test(comp));
		const stored = { customEventUrls: JSON.stringify({ arknights: LIST_URL }) };
		check("持久化：切到备选后读回仍是备选（getEntryUrl 读回 = 一览地址，不是回落到 SMW）",
			getEntryUrl(stored, "arknights", SMW, "eventUrl") === LIST_URL,
			getEntryUrl(stored, "arknights", SMW, "eventUrl"));
		check("持久化：没存过 ⇒ 读回仍是默认 SMW 地址（默认项就是「PRTS 活动解析」）",
			getEntryUrl({}, "arknights", SMW, "eventUrl") === SMW,
			getEntryUrl({}, "arknights", SMW, "eventUrl"));
		check("路由：切到备选 ⇒ `eventFetcherFor` 选中 arknights-event-list（不是 default）",
			eventFetcherFor(ARK, LIST_URL) === T.EVENT_FETCHERS["arknights"]["arknights-event-list"],
			String(eventFetcherFor(ARK, LIST_URL) === T.EVENT_FETCHERS["arknights"]["arknights-event-list"]));
		check("路由：默认 ⇒ `eventFetcherFor` 选中 default（SMW）",
			eventFetcherFor(ARK, SMW) === T.EVENT_FETCHERS["arknights"]["default"],
			String(eventFetcherFor(ARK, SMW) === T.EVENT_FETCHERS["arknights"]["default"]));
		check("路由：备选地址归一后原样（不会被当成「未知来源」而回落到默认）",
			T.normalizeSourceId(LIST_URL) === LIST_URL);

		// ⑥ 从 8de869d 恢复的纯函数（旧用例一并恢复：它们本来全绿）
		const { parsePrtsPageEndTimes, prtsPageNameFromHref, prtsPageTimesFromBatch, prtsClaimTitles,
			PRTS_CLAIM_MAX_TITLES, collectPrtsEvents, prtsEventSnapshot, labelOf } = T.parsers["arknights"];
		const both = parsePrtsPageEndTimes("{{活动信息\n|活动结束时间=2026-11-07 03:59\n|兑换结束时间=2026-11-10 03:59\n}}", TZ_CN);
		check("恢复·纯函数：有兑换期 → 两个时间戳（按 +08 解析）",
			both.actEndTs === at7("2026-11-07T03:59:00+08:00") && both.claimEndTs === at7("2026-11-10T03:59:00+08:00"),
			JSON.stringify(both));
		const noClaim = parsePrtsPageEndTimes("{{活动信息\n|活动结束时间=2026-11-07 03:59\n}}", TZ_CN);
		check("恢复·纯函数：无「兑换结束时间」字段 → claimEndTs = null（不补猜）",
			noClaim.actEndTs === at7("2026-11-07T03:59:00+08:00") && noClaim.claimEndTs === null, JSON.stringify(noClaim));
		const badTime = parsePrtsPageEndTimes("{{活动信息\n|活动结束时间=2026-13-45 99:99\n|兑换结束时间=2026年11月10日 03:59\n}}", TZ_CN);
		check("恢复·纯函数：日期格式异常/越界 → 两个都给 null（宁缺勿错）",
			badTime.actEndTs === null && badTime.claimEndTs === null, JSON.stringify(badTime));
		const reversed = parsePrtsPageEndTimes("{{活动信息\n|活动结束时间=2026-11-10 03:59\n|兑换结束时间=2026-11-07 03:59\n}}", TZ_CN);
		check("恢复·纯函数：兑换结束不晚于活动结束 → 丢弃兑换期，只留活动结束",
			reversed.actEndTs === at7("2026-11-10T03:59:00+08:00") && reversed.claimEndTs === null, JSON.stringify(reversed));
		check("恢复·纯函数：tz 参与换算（同一墙钟在 UTC 下比 +08 晚 8 小时）",
			parsePrtsPageEndTimes("{{活动信息\n|活动结束时间=2026-11-07 03:59\n}}", "UTC").actEndTs === noClaim.actEndTs + 8 * 3600e3);
		check("恢复·页名解码：`/w/<URL 编码页名>` → 页名（全角冒号也在内）",
			prtsPageNameFromHref("/w/%E5%8D%B1%E6%9C%BA%E5%90%88%E7%BA%A6%EF%BC%9A%E5%B0%96%E7%81%AD%E6%B5%8B%E8%AF%95%E4%BD%9C%E6%88%98") === "危机合约：尖灭测试作战");
		check("恢复·页名解码：`index.php?title=` / 非法编码 / 空 → 空串（不猜）",
			prtsPageNameFromHref("/w/index.php?title=X") === "" && prtsPageNameFromHref("/w/%ZZ") === ""
			&& prtsPageNameFromHref("") === "" && prtsPageNameFromHref(undefined) === "");
		const norm = prtsPageTimesFromBatch({
			query: {
				normalized: [{ from: "火山旅梦_旧", to: "火山旅梦" }],
				pages: [
					{ title: "火山旅梦", revisions: [{ slots: { main: { content: "{{活动信息\n|活动结束时间=2026-11-19 03:59\n|兑换结束时间=2026-11-22 03:59\n}}" } } }] },
					{ title: "没有正文的页" }
				]
			}
		}, TZ_CN);
		check("恢复·批量响应 → Map：返回名与请求名（normalized）都能取到；无正文的页跳过",
			!!norm.get("火山旅梦") && !!norm.get("火山旅梦_旧")
			&& norm.get("火山旅梦").claimEndTs === at7("2026-11-22T03:59:00+08:00")
			&& norm.get("火山旅梦_旧") === norm.get("火山旅梦") && !norm.has("没有正文的页"),
			JSON.stringify([...norm.keys()]));
		const now7 = at7("2026-11-06T15:54:00+08:00");
		const many = Array.from({ length: 20 }, (_, i) => ({ name: "e" + i, page: "p" + i, startTs: now7 - 864e5, endTs: now7 + 864e5 }));
		check("恢复·相关筛选：去重后上限 = 12（一次批量请求的体量上限）",
			PRTS_CLAIM_MAX_TITLES === 12 && prtsClaimTitles(many, now7).length === 12, String(prtsClaimTitles(many, now7).length));
		check("恢复·相关筛选：结束早于 now-3天 / 开始晚于 now+45天 的条目被排除（连请求都不发）",
			prtsClaimTitles([
				{ name: "太早", page: "old", startTs: now7 - 30 * 864e5, endTs: now7 - 4 * 864e5 },
				{ name: "太远", page: "far", startTs: now7 + 60 * 864e5, endTs: now7 + 70 * 864e5 },
				{ name: "刚好", page: "ok", startTs: now7 - 864e5, endTs: now7 + 864e5 }
			], now7).join(",") === "ok");
		// 一览的 `labelOf` 去重（名称本身已带分类前缀的真实结构）
		const dupHtml = '<table><tr><th>活动开始时间</th><th>活动</th><th>分类</th></tr>'
			+ '<tr><td data-time="1792828800,1793995140">2026-10-24 16:00</td>'
			+ '<td><a href="/w/%E8%A7%86%E7%9B%B8%E5%8D%9A%E7%89%A9%E9%A6%86%EF%BC%9A%E6%BC%94%E5%8C%96" title="视相博物馆：演化">视相博物馆：演化</a></td>'
			+ '<td><a title="分类:视相博物馆">视相博物馆</a></td></tr></table>';
		const dupItems = collectPrtsEvents(dupHtml, TZ_CN);
		check("恢复·collectPrtsEvents：名称本身带分类前缀时**不重复**（banner 逐字 =「视相博物馆：演化」）",
			dupItems.length === 1 && dupItems[0].banner === "视相博物馆：演化" && dupItems[0].category === "视相博物馆",
			JSON.stringify(dupItems.map((x) => [x.banner, x.category])));
		// 快照形状：与 SMW 那份**同一组字段名**（startTs / endTs / raw / page / name / category）
		const LIST_TEXT7 = JSON.parse(fixtureBody(LIST_URL, LIST_OV)).parse.text;
		const snap7 = prtsEventSnapshot(LIST_TEXT7, TZ_CN);
		check("恢复·prtsEventSnapshot：一览 HTML → 3 条快照（name/category/startTs/endTs/raw/page 齐备，页名解出来了）",
			snap7.length === 3 && snap7.every((x) => typeof x.name === "string" && x.name.length > 0
				&& typeof x.category === "string" && typeof x.raw === "string" && typeof x.page === "string" && x.page.length > 0
				&& typeof x.startTs === "number" && typeof x.endTs === "number"),
			JSON.stringify(snap7.map((x) => [x.name, x.category, x.page])));
		check("恢复·labelOf 幂等（一览与 SMW 用的都是这一份去重）",
			labelOf("视相博物馆", labelOf("视相博物馆", "演化")) === "视相博物馆：演化");
	}
	// ── 2026-11-11：**同月跨年**补年回归（真机 bug）───────────────────────
	// 数组反解时 `scheduleNoYear` 会先把年份剥掉；「卫戍协议·规程」原文
	// 2026-11-08 ~ 2027-11-07 剥年后是「11-08 ~ 11-07」——同月且结束日更小，
	// 旧判据只看月份不加年 ⇒ 窗口变成 -2 天。
	section("同月跨年：结束日 < 开始日 ⇒ 结束记次年（只有月-日 时）");
	{
		const nowRef = new Date(2026, 10, 15, 12, 0, 0);
		const sameMonth = T.parseDisplayRange("11-08 16:00 ~ 11-07 03:59", nowRef);
		check("同月跨年：11-08 ~ 11-07 ⇒ 起 2026 / 止 2027（而非 -2 天）",
			!!sameMonth && new Date(sameMonth.startTs).getFullYear() === 2026 && new Date(sameMonth.endTs).getFullYear() === 2027
				&& sameMonth.endTs > sameMonth.startTs, JSON.stringify(sameMonth));
		const normal = T.parseDisplayRange("11-01 12:00 ~ 11-22 03:59", nowRef);
		check("同年正常窗口不受影响（11-01 ~ 11-22 都是 2026）",
			!!normal && new Date(normal.startTs).getFullYear() === 2026 && new Date(normal.endTs).getFullYear() === 2026,
			JSON.stringify(normal));
		const sameDay = T.parseDisplayRange("11-11 20:00 ~ 11-11 23:59", nowRef);
		check("同日只比时间不加年（合法当日窗口仍是 2026）",
			!!sameDay && new Date(sameDay.startTs).getFullYear() === 2026 && new Date(sameDay.endTs).getFullYear() === 2026
				&& sameDay.endTs > sameDay.startTs, JSON.stringify(sameDay));
		const crossMonth = T.parseDisplayRange("12-20 06:00 ~ 01-05 03:59", nowRef);
		check("跨月跨年仍正确（12-20 ~ 01-05 ⇒ 2027 年 1 月）",
			!!crossMonth && new Date(crossMonth.endTs).getFullYear() === 2027 && new Date(crossMonth.endTs).getMonth() === 0,
			JSON.stringify(crossMonth));
	}

	// ── 2026-11-11：**移除 120 天常驻判定**（用户拍板）的回归 ─────────────────────────────
	// PRTS 活动一览（备选源）里两条长窗口以前被 `isLongTermEvent`（>120 天）从 `events[]`
	// 与悬停里一起剔除；现在必须如实出现（363 天 / 236 天）。夹具见 `p3d-arknights-events-list`。
	section("2026-11-11 移除 120 天常驻判定：明日方舟 363 / 236 天窗口出现在 events[] 与悬停里");
	{
		const { collectPrtsEvents, prtsEventPayload } = T.parsers["arknights"];
		const html = JSON.parse(fixtureBody("p3d:arknights-events-list", {
			"p3d:arknights-events-list": "p3d-arknights-events-list/response.txt"
		})).parse.text;
		const snap = collectPrtsEvents(html, TZ_CN).map((it) => ({
			name: it.banner, category: it.category || "", startTs: it.startTs, endTs: it.endTs, raw: it.raw, page: it.page || ""
		}));
		// 2026-11-11 11:00 +08：两条长窗口都已开始（卫戍协议 11-08 16:00 开）
		const pl = prtsEventPayload(snap, TZ_CN, Date.parse("2026-11-11T03:00:00Z"), null);
		const hover = String((pl && pl.eventHover) || "");
		const cases = [
			{ name: "卫戍协议：卫戍协议·规程", days: 363, window: "2026-11-08 16:00 ~ 2027-11-07 03:59" },
			{ name: "集成战略：沉沦者的黑流树海", days: 236, window: "2026-07-17 16:00 ~ 2027-03-10 16:00" }
		];
		for (const c of cases) {
			const hit = ((pl && pl.events) || []).find((x) => x.title === c.name) || null;
			check(`明日方舟：${c.days} 天窗口「${c.name}」在 \`events[]\` 里`,
				!!hit && /^[\d-]+ \d{2}:\d{2} ~ [\d-]+ \d{2}:\d{2}$/.test(hit.raw), JSON.stringify(hit && hit.raw));
			check(`明日方舟：「${c.name}」在悬停里逐字出现（${c.window}）`,
				hover.split("\n").includes(`${c.name}   ${c.window}`), JSON.stringify(hover));
		}
	}
}
