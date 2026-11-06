// test/cases-arknights-claim.mjs —— 明日方舟「两阶段」（实际举行 / 奖励领取）
//
// ── 为什么需要这一段 ──
// 2026-11-06 用户要求：活动区分「实际举行」与「奖励领取」。改造前 PRTS 活动一览只给
// 「活动开始时间 + data-time="开始秒,结束秒"」，**没有**兑换/领取期 ⇒ 活动一结束、整条就从面板消失，
// 而那时恰恰是最该盯的（奖励还没领）。现在补一条链路：
//   ① 一览（1 次，行为不变）→ ② **一次**批量 query 取相关活动页的 wikitext（≤12 页）→
//   解析每页 `{{活动信息}}` 的 `活动结束时间` / `兑换结束时间`。
//
// 这一段的重点是**边界**，不是"正常能跑"：
//   · 页里有「兑换结束时间」→ 活动结束后仍出现，外显区间改成 兑换期（还剩 X = 到兑换截止）；
//   · 页里**没有**该字段（有的活动就是没有）→ 与改造前逐字节一致（不补猜 7 天）；
//   · 批量请求失败 / 解析不出 → **整条链路退化**成改造前行为，绝不让主链路跟着失败；
//   · 一览 data-time 与页内「活动结束时间」冲突 → **以页内为准**，并留一条 console.warn。
//
// ⚠️ 2026-11-06 真机 bug（用户截图）：提示行（`兑换截止：…` / `奖励领取期…`）曾被塞进 `eventHover`，
//    而表格格子会把 `eventHover` 交给 `scheduleHoverItems` 解析成**并列条目** ⇒ 格子里多出一行
//    **可见文字**「兑换截止：11-10 03:59」。现在提示行只走独立字段 `eventHoverNote`（只进提示框），
//    `eventHover` 恢复成**只由 buildEventHover 产出**。本文件的第④节就是这条的回归（含"旧实现会多一条"的反向证明）。
//
// ⚠️ 夹具是**手工构造**的（不是抓的）：本机出口对 prts.wiki 返回 403（Tengine，浏览器/curl 一致），
//    无法像其它批次那样 capture。行结构照 collectPrtsEvents 的解析契约写（见两份 meta.json 的 note）。

import { check, section, useFixtures, setFetchImpl, fixtureBody } from "./harness.mjs";
import { T, readComponentsSource } from "./load.mjs";
import { createEngine } from "../packages/core/core.mjs";

const TZ_CN = "Asia/Shanghai";

// 活动一览（eventUrl 去掉 origin=*；抓取器会自己补）
const LIST_URL = "https://prts.wiki/api.php?action=parse&page=%E6%B4%BB%E5%8A%A8%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2";
// 批量 query 的**查找用** URL（只为了走 map.json 的前缀映射；真实请求的 titles 由抓取器拼）
const BATCH_LOOKUP = "https://prts.wiki/api.php?action=query&prop=revisions&rvslots=main&rvprop=content&format=json&formatversion=2&origin=*&titles="
	+ encodeURIComponent("墟");
// 抓取器里的批量接口前缀（断言用：必须**一次** query，不是 N 次）
const BATCH_PREFIX = "https://prts.wiki/api.php?action=query&prop=revisions";

// `eventHoverNote`（**只进提示框**）提示行的两种合法形态 —— 它们**绝不能**出现在 `eventHover` 里。
const NOTE_CLAIM_RE = /^兑换截止：\d{2}-\d{2} \d{2}:\d{2}$/;
const NOTE_PHASE_RE = /^活动已于 \d{2}-\d{2} \d{2}:\d{2} 结束，当前为奖励领取期（兑换截止 \d{2}-\d{2} \d{2}:\d{2}）$/;
// 悬停 = 共用排版：`名称 + 3 空格 + 档期`。
const SHARED_LINE_RE = /^\S.*   (\d{4}-)?\d{2}-\d{2} \d{2}:\d{2} ~ (\d{4}-)?\d{2}-\d{2} \d{2}:\d{2}$/;
// 「泄漏」判据：eventHover 里出现这两类字样就说明提示行又跑进去了。
const LEAK_RE = /兑换截止|奖励领取期/;
// 活动期 / 兑换期的 `eventHover` **逐字**基线（= 只由 buildEventHover 产出；与改造前一致）。
const HOVER_ACTIVITY = "支线故事：墟   10-24 16:00 ~ 11-07 03:59\n危机合约：尖灭测试作战   11-01 04:00 ~ 11-15 03:59\n支线故事：火山旅梦   11-05 04:00 ~ 11-19 03:59";
const HOVER_CLAIM = "支线故事：墟   11-07 03:59 ~ 11-10 03:59\n危机合约：尖灭测试作战   11-01 04:00 ~ 11-15 03:59\n支线故事：火山旅梦   11-05 04:00 ~ 11-19 03:59";

const okBody = (body) => ({
	ok: true, status: 200, headers: { get: () => "application/json" },
	text: async () => body, json: async () => JSON.parse(body)
});

// 装一层"记账 + 可失败"的 transport：走 map.json 的夹具（fixtureBody），并记录每次真实请求。
// （useFixtures() 先装全局 fetch 兜底，保证这一段万一漏网也不会打真网络。）
function installTransport({ failBatch = false } = {}) {
	const seen = [];
	setFetchImpl(async (url) => {
		const u = String(url);
		seen.push(u);
		if (u.startsWith(LIST_URL)) return okBody(fixtureBody(LIST_URL));
		if (u.includes("action=query&prop=revisions")) {
			if (failBatch) return { ok: false, status: 503, headers: { get: () => null }, text: async () => "", json: async () => ({}) };
			return okBody(fixtureBody(BATCH_LOOKUP));
		}
		throw new Error("unexpected-url:" + u);
	});
	return seen;
}

// 跑一次真实抓取器（固定 now + 指定失败模式），顺带收集 console.warn
async function runFetcher(nowIso, { failBatch = false } = {}) {
	const seen = installTransport({ failBatch });
	T.setCoreEnv({ now: () => Date.parse(nowIso) });
	const warns = [];
	const orig = console.warn;
	console.warn = (...a) => { warns.push(a.map(String).join(" ")); };
	let data = null, err = null;
	try {
		data = await T.EVENT_FETCHERS["arknights"].default(LIST_URL, undefined, TZ_CN);
	} catch (e) {
		err = String((e && e.message) || e);
	} finally {
		console.warn = orig;
	}
	return { data, err, seen, warns };
}

export default async function run() {
	section("明日方舟两阶段（实际举行 / 奖励领取：一览 + 批量 wikitext）");
	useFixtures();   // 装全局 fetch 兜底（本段自己再包一层记账/可失败的 impl）
	const { parsePrtsPageEndTimes, prtsClaimTitles, prtsPageTimesFromBatch, prtsPageNameFromHref, PRTS_CLAIM_MAX_TITLES } =
		T.parsers["arknights"];
	const at = (iso) => Date.parse(iso);

	// ── ① 纯函数：wikitext → 时间戳（四种输入）────────────────────────────────
	{
		const both = parsePrtsPageEndTimes("{{活动信息\n|活动结束时间=2026-11-07 03:59\n|兑换结束时间=2026-11-10 03:59\n}}", TZ_CN);
		check("纯函数：有兑换期 → 两个时间戳（按 +08 解析）",
			both.actEndTs === at("2026-11-07T03:59:00+08:00") && both.claimEndTs === at("2026-11-10T03:59:00+08:00"),
			JSON.stringify(both));

		const noClaim = parsePrtsPageEndTimes("{{活动信息\n|活动结束时间=2026-11-07 03:59\n}}", TZ_CN);
		check("纯函数：无「兑换结束时间」字段 → claimEndTs = null（不补猜）",
			noClaim.actEndTs === at("2026-11-07T03:59:00+08:00") && noClaim.claimEndTs === null, JSON.stringify(noClaim));

		const bad = parsePrtsPageEndTimes("{{活动信息\n|活动结束时间=2026-13-45 99:99\n|兑换结束时间=2026年11月10日 03:59\n}}", TZ_CN);
		check("纯函数：日期格式异常/越界 → 两个都给 null（宁缺勿错）",
			bad.actEndTs === null && bad.claimEndTs === null, JSON.stringify(bad));

		const reversed = parsePrtsPageEndTimes("{{活动信息\n|活动结束时间=2026-11-10 03:59\n|兑换结束时间=2026-11-07 03:59\n}}", TZ_CN);
		check("纯函数：开始/结束顺序颠倒（兑换结束不晚于活动结束）→ 丢弃兑换期，只留活动结束",
			reversed.actEndTs === at("2026-11-10T03:59:00+08:00") && reversed.claimEndTs === null, JSON.stringify(reversed));

		const empty = parsePrtsPageEndTimes("", TZ_CN);
		check("纯函数：空 wikitext → 两个都 null（不抛错）", empty.actEndTs === null && empty.claimEndTs === null);

		// tz 口径：同一条 wikitext 在 UTC 下解析，应恰好晚 8 小时（同一墙钟按 UTC 解释 = 更晚的绝对时刻）
		const utc = parsePrtsPageEndTimes("{{活动信息\n|活动结束时间=2026-11-07 03:59\n}}", "UTC");
		check("纯函数：tz 参与换算（同一墙钟在 UTC 下比 +08 晚 8 小时）",
			utc.actEndTs === noClaim.actEndTs + 8 * 3600e3, `${utc.actEndTs} vs ${noClaim.actEndTs}`);

		check("页名解码：`/w/<URL 编码页名>` → 页名（全角冒号也在内）",
			prtsPageNameFromHref("/w/%E5%8D%B1%E6%9C%BA%E5%90%88%E7%BA%A6%EF%BC%9A%E5%B0%96%E7%81%AD%E6%B5%8B%E8%AF%95%E4%BD%9C%E6%88%98") === "危机合约：尖灭测试作战");
		check("页名解码：`index.php?title=` / 非法编码 → 空串（不猜）",
			prtsPageNameFromHref("/w/index.php?title=X") === "" && prtsPageNameFromHref("/w/%ZZ") === "" &&
			prtsPageNameFromHref("") === "" && prtsPageNameFromHref(undefined) === "");

		// 批量响应 → Map（含 query.normalized 的"请求名 ↔ 返回名"两个键）
		const norm = prtsPageTimesFromBatch({
			query: {
				normalized: [{ from: "火山旅梦_旧", to: "火山旅梦" }],
				pages: [{ title: "火山旅梦", revisions: [{ slots: { main: { content: "{{活动信息\n|活动结束时间=2026-11-19 03:59\n|兑换结束时间=2026-11-22 03:59\n}}" } } }] },
					{ title: "没有正文的页" }]
			}
		}, TZ_CN);
		check("批量响应 → Map：按返回名与请求名都能取到（normalized 归一）；无正文的页跳过",
			!!norm.get("火山旅梦") && !!norm.get("火山旅梦_旧") &&
			norm.get("火山旅梦").claimEndTs === at("2026-11-22T03:59:00+08:00") &&
			norm.get("火山旅梦_旧") === norm.get("火山旅梦") && !norm.has("没有正文的页"),
			JSON.stringify([...norm.keys()]));

		// 「相关」筛选：只取 now-3天 ~ now+45天，且**最多 12 个**
		const now0 = at("2026-11-06T15:54:00+08:00");
		const many = Array.from({ length: 20 }, (_, i) => ({ name: "e" + i, page: "p" + i, startTs: now0 - 864e5, endTs: now0 + 864e5 }));
		check("相关筛选：去重后上限 = 12（一次批量请求的体量上限）",
			PRTS_CLAIM_MAX_TITLES === 12 && prtsClaimTitles(many, now0).length === 12, String(prtsClaimTitles(many, now0).length));
		check("相关筛选：结束早于 now-3天 / 开始晚于 now+45天 的条目被排除（连请求都不发）",
			prtsClaimTitles([
				{ name: "太早", page: "old", startTs: now0 - 30 * 864e5, endTs: now0 - 4 * 864e5 },
				{ name: "太远", page: "far", startTs: now0 + 60 * 864e5, endTs: now0 + 70 * 864e5 },
				{ name: "刚好", page: "ok", startTs: now0 - 864e5, endTs: now0 + 864e5 }
			], now0).join(",") === "ok");
	}

	// ── ② 抓取链路：两次请求（1 次一览 + **一次**批量），上限 12 页 ─────────────
	{
		const { data, seen, err } = await runFetcher("2026-11-06T15:54:00+08:00");
		check("抓取链路：① 一览 + ② 批量 —— 恰好 2 次请求（兑换期不是 N 次详情）", seen.length === 2, JSON.stringify(seen.map((u) => u.slice(0, 60))));
		check("抓取链路：第 1 次仍是活动一览（带 origin=*，与改造前同一条通道）",
			seen[0] === LIST_URL + "&origin=*", seen[0]);
		check("抓取链路：第 2 次是 action=query&prop=revisions 的**批量**接口", seen[1].startsWith(BATCH_PREFIX), seen[1]);
		const titles = decodeURIComponent(String(seen[1] || "").split("titles=")[1] || "").split("|");
		check("抓取链路：批量 titles = 3 条相关活动页（已结束>3天的那条不在内）",
			titles.length === 3 && titles.includes("墟") && titles.includes("火山旅梦") && titles.includes("危机合约：尖灭测试作战")
			&& !titles.includes("龙门夏日签到"), JSON.stringify(titles));
		check("抓取链路：抓取器不抛错、事件侧契约成立（event + eventDates）",
			!err && !!data && typeof data.event === "string" && typeof data.eventDates === "string", err || JSON.stringify(data && data.event));

		// 没有相关条目时**一次批量请求都不发**（不是"发了但空"）
		const idle = await runFetcher("2027-01-01T00:00:00+08:00");
		check("抓取链路：一览里没有相关条目 → 只发 1 次请求、载荷为 null（未公布）",
			idle.seen.length === 1 && idle.data === null, `reqs=${idle.seen.length} data=${JSON.stringify(idle.data)}`);
	}

	// ── ②b 持久化：`eventClaimDates` / `eventShow` / `eventHoverNote` 必须能随 lastData 出去 ──────────
	// `lastData` 是 JSON 字符串，但引擎写回前会过一遍 normalizeRecord（**只留白名单字段**）——
	// 忘了登记就会被**静默丢掉**：面板照常、提醒却少一条（或兑换期的事项名退回活动名 / 提示框少一行）。
	// 这里用 getCached 真跑一遍那条归一。
	{
		const data = {
			arknights: {
				name: "明日方舟", event: "支线故事：墟",
				eventDates: "10-24 16:00 ~ 11-07 03:59",
				eventClaimDates: "11-07 03:59 ~ 11-10 03:59",
				eventShow: "支线故事：兑换截止",
				eventHoverNote: "兑换截止：11-10 03:59",
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
			got.games.arknights.eventShow === "支线故事：兑换截止", JSON.stringify(got.games.arknights));
		check("lastData 里的 `eventHoverNote` 原样读回（只进提示框的提示行也要登记，否则刷新一次就没了）",
			got.games.arknights.eventHoverNote === "兑换截止：11-10 03:59", JSON.stringify(got.games.arknights));
		check("没有 `eventHoverNote` 的条目归一成空串（形状固定，且不会凭空多出提示行）",
			got.games.other.eventHoverNote === "", JSON.stringify(got.games.other));

		// 沿用旧值（活动侧整列是旧值）：提示行也要跟着沿回，否则刷新失败一次后提示框就少一行。
		const merged = engine.__test.mergeEntryRecord(
			{ data: {}, ok: false, reason: "超时", gachaFail: null, eventFail: { kind: "down", reason: "超时" } },
			{
				event: "视相博物馆：演化", eventDates: "10-24 16:00 ~ 11-07 03:59",
				eventShow: "视相博物馆：兑换截止",
				eventHoverNote: "兑换截止：11-10 03:59",
				eventHover: "视相博物馆：演化   10-24 16:00 ~ 11-07 03:59"
			},
			1000
		);
		check("活动侧沿用旧值时 `eventHoverNote` 一起沿回（与 eventShow 同口径）",
			merged.eventStale === true && merged.eventHoverNote === "兑换截止：11-10 03:59"
			&& merged.eventHover === "视相博物馆：演化   10-24 16:00 ~ 11-07 03:59", JSON.stringify(merged));
	}

	// ── ③ 三态：活动期 / 兑换期 / batch 失败退化 ────────────────────────────────
	{
		// ① 活动期（now = 2026-11-06 15:54，墟 11-07 03:59 结束）—— 外显与改造前**完全一致**
		const a = await runFetcher("2026-11-06T15:54:00+08:00");
		check("活动期：外显是活动区间（10-24 16:00 ~ 11-07 03:59，逐字）",
			!!a.data && a.data.event === "支线故事：墟" && a.data.eventDates === "10-24 16:00 ~ 11-07 03:59",
			JSON.stringify(a.data && [a.data.event, a.data.eventDates]));
		// ⚠️ 提示行**只进 `eventHoverNote`**（提示框），绝不进 `eventHover`（格子会把它解析成并列条目）。
		check("活动期：`eventHoverNote` = 每条有兑换期的活动一行「兑换截止：MM-DD HH:mm」（墟 11-10 / 火山 11-22）",
			!!a.data && a.data.eventHoverNote === "兑换截止：11-10 03:59\n兑换截止：11-22 03:59",
			JSON.stringify(a.data && a.data.eventHoverNote));
		check("活动期：`eventHover` 里**没有任何**「兑换截止 / 奖励领取期」字样（提示行不再泄漏进悬停原文）",
			!!a.data && !LEAK_RE.test(a.data.eventHover), JSON.stringify(a.data && a.data.eventHover));
		check("活动期：`eventHover` 与改造前**逐字一致**（只由 buildEventHover 产出）",
			!!a.data && a.data.eventHover === HOVER_ACTIVITY, JSON.stringify(a.data && a.data.eventHover));
		// 提醒侧的第二个 deadline：活动期就得把「奖励领取截止」窗口一起带出去（不是等进了兑换期才给）。
		check("活动期：载荷带 `eventClaimDates` = 活动结束 ~ 兑换结束（提醒侧据此建第二条 deadline）",
			!!a.data && a.data.eventClaimDates === "11-07 03:59 ~ 11-10 03:59",
			JSON.stringify(a.data && a.data.eventClaimDates));
		// 事项名（只给显示）：活动期**不能**有 `eventShow` 这个键 —— 否则面板那一行会提前变成「兑换截止」。
		check("活动期：**没有** `eventShow` 键（事项名仍是活动名，显示与改造前一致）",
			!!a.data && !("eventShow" in a.data), JSON.stringify(a.data && Object.keys(a.data)));
		check("活动期：没有兑换期的活动（尖灭）不补提示行 —— `eventHoverNote` 恰好 2 行（墟 / 火山）",
			!!a.data && (() => {
				const L = String(a.data.eventHoverNote || "").split("\n").filter(Boolean);
				return L.length === 2 && L.every((l) => NOTE_CLAIM_RE.test(l)) && !L.some((l) => /11-15/.test(l));
			})(),
			JSON.stringify(a.data && a.data.eventHoverNote));
		check("活动期：页内「活动结束时间」压过一览 data-time（尖灭 11-15 vs 一览 11-14）",
			!!a.data && a.data.eventHover.includes("危机合约：尖灭测试作战   11-01 04:00 ~ 11-15 03:59"),
			JSON.stringify(a.data && a.data.eventHover));
		check("活动期：一览与页内结束时间不一致时留一条 console.warn（便于排查）",
			a.warns.length === 1 && a.warns[0].includes("尖灭") && a.warns[0].includes("一览=11-14 03:59") && a.warns[0].includes("页内=11-15 03:59"),
			JSON.stringify(a.warns));

		// ② 兑换期（now = 2026-11-08 12:00：墟 11-07 03:59 已结束，兑换到 11-10 03:59）
		const b = await runFetcher("2026-11-08T12:00:00+08:00");
		check("兑换期：活动**仍然出现**（外显仍是墟，没像改造前那样消失）",
			!!b.data && b.data.event === "支线故事：墟", JSON.stringify(b.data && b.data.event));
		check("兑换期：eventDates = 可解析的兑换区间（11-07 03:59 ~ 11-10 03:59 ⇒ 外显「还剩 X」指向兑换截止）",
			!!b.data && b.data.eventDates === "11-07 03:59 ~ 11-10 03:59"
			&& /^(\d{2}-\d{2} \d{2}:\d{2}) ~ (\d{2}-\d{2} \d{2}:\d{2})$/.test(b.data.eventDates),
			JSON.stringify(b.data && b.data.eventDates));
		check("兑换期：`eventHoverNote` 第一行写明「活动已于 … 结束，当前为奖励领取期（兑换截止 …）」",
			!!b.data && String(b.data.eventHoverNote || "").split("\n")[0]
				=== "活动已于 11-07 03:59 结束，当前为奖励领取期（兑换截止 11-10 03:59）",
			JSON.stringify(b.data && b.data.eventHoverNote));
		check("兑换期：`eventHoverNote` 也带上其它活动自己的「兑换截止」（多行；火山 11-22）",
			!!b.data && b.data.eventHoverNote.split("\n").includes("兑换截止：11-22 03:59"),
			JSON.stringify(b.data && b.data.eventHoverNote));
		check("兑换期：`eventHover` 里**没有任何**「兑换截止 / 奖励领取期」字样（与活动期同一个判据）",
			!!b.data && !LEAK_RE.test(b.data.eventHover) && b.data.eventHover === HOVER_CLAIM,
			JSON.stringify(b.data && b.data.eventHover));
		check("兑换期：日期格悬停（eventDatesRaw）与格子里显示的区间是同一份",
			!!b.data && b.data.eventDatesRaw === b.data.eventDates, JSON.stringify(b.data && b.data.eventDatesRaw));
		// 兑换期里 eventDates 本身就是兑换区间 ⇒ eventClaimDates 与它**同值**；提醒侧按「T 相同只留一条」去重。
		check("兑换期：`eventClaimDates` 与 `eventDates` 同值（提醒侧去重后只留一条，不会弹两次）",
			!!b.data && b.data.eventClaimDates === b.data.eventDates, JSON.stringify(b.data && b.data.eventClaimDates));
		// 事项名（只给显示）：兑换期显示 `<分类>：兑换截止`（墟 的分类 = 支线故事）；`event` 一个字不动。
		check("兑换期：`eventShow` = 「<分类>：兑换截止」（支线故事 ⇒ 「支线故事：兑换截止」）",
			!!b.data && b.data.eventShow === "支线故事：兑换截止", JSON.stringify(b.data && b.data.eventShow));
		check("兑换期：`event` 仍是活动名（提醒标题 / 侧栏轮播 / 搜索匹配读它，不被显示名改写）",
			!!b.data && b.data.event === "支线故事：墟", JSON.stringify(b.data && b.data.event));

		// ③ 批量失败（同一时刻）—— 退化为改造前行为：墟消失、尖灭用的是**一览**的 11-14
		const c = await runFetcher("2026-11-08T12:00:00+08:00", { failBatch: true });
		check("batch 失败：退化为「只有活动期」—— 兑换期内的墟**消失**（= 改造前行为）",
			!!c.data && c.data.event === "危机合约：尖灭测试作战", JSON.stringify(c.data && c.data.event));
		check("batch 失败：结束时间回落**一览**的 data-time（11-14，不是页内的 11-15）",
			!!c.data && c.data.eventDates === "11-01 04:00 ~ 11-14 03:59", JSON.stringify(c.data && c.data.eventDates));
		check("batch 失败：没有任何「兑换截止 / 领取期」提示行、也不打日志（不留半截元信息）",
			!!c.data && !LEAK_RE.test(c.data.eventHover) && !("eventHoverNote" in c.data)
			&& c.warns.length === 0, JSON.stringify([c.data && c.data.eventHover, c.warns]));
		check("batch 失败：**不写** `eventClaimDates` 这个键（不是给空串，下游不必多问一遍）",
			!!c.data && !("eventClaimDates" in c.data), JSON.stringify(c.data && Object.keys(c.data)));
		check("batch 失败：也**不写** `eventShow` / `eventHoverNote` 这两个键（没有兑换期就没有提示行）",
			!!c.data && !("eventShow" in c.data) && !("eventHoverNote" in c.data), JSON.stringify(c.data && Object.keys(c.data)));

		// ④ 活动期 + batch 失败：与改造前**逐字节一致**（回归基线）
		const d = await runFetcher("2026-11-06T15:54:00+08:00", { failBatch: true });
		check("batch 失败（活动期）：event / eventDates / 悬停 与改造前逐字节一致",
			!!d.data && d.data.event === "支线故事：墟" && d.data.eventDates === "10-24 16:00 ~ 11-07 03:59"
			&& d.data.eventHover === "支线故事：墟   10-24 16:00 ~ 11-07 03:59\n危机合约：尖灭测试作战   11-01 04:00 ~ 11-14 03:59\n支线故事：火山旅梦   11-05 04:00 ~ 11-19 03:59"
			&& !("eventShow" in d.data) && !("eventHoverNote" in d.data),
			JSON.stringify(d.data));

		// ⑤ 未开始的活动：与改造前一致（不在当期里，不出现）
		const e = await runFetcher("2026-10-25T12:00:00+08:00");
		check("待开始的活动不出现（火山 11-05 才开；外显仍是墟）",
			!!e.data && e.data.event === "支线故事：墟" && !e.data.eventHover.includes("火山旅梦"),
			JSON.stringify(e.data));
	}

	// ── ④ 真机 bug 回归：提示行**不再进 `eventHover`** ⇒ 格子不会多出可见的一行 ─────────────
	// 表格格子的「探头」由 `scheduleHoverItems(eventHover)` 解析（82-schedule-view.js 的 cells）。
	// 提示行不匹配「名称 + 3 空格 + 档期」⇒ 旧实现里它会被攒成 pending、再被下一条活动的档期"带上"，
	// 于是格子里多出一行**可见文字**（用户截图：`兑换截止：11-10 03:59`）。
	{
		const { scheduleHoverItems, scheduleHoverNote } = T;
		const a = await runFetcher("2026-11-06T15:54:00+08:00");
		const b = await runFetcher("2026-11-08T12:00:00+08:00");

		// ① 悬停原文每一行都是共用排版（提示行一条都没有）—— 活动期 / 兑换期都查
		const aLines = String((a.data && a.data.eventHover) || "").split("\n").filter(Boolean);
		const bLines = String((b.data && b.data.eventHover) || "").split("\n").filter(Boolean);
		check("悬停排版：活动期 / 兑换期的 eventHover 全部是共用排版的「名称 + 3 空格 + 档期」",
			aLines.length === 3 && bLines.length === 3
			&& aLines.concat(bLines).every((l) => SHARED_LINE_RE.test(l))
			&& aLines.concat(bLines).every((l) => !NOTE_CLAIM_RE.test(l) && !NOTE_PHASE_RE.test(l)),
			JSON.stringify([aLines, bLines]));

		// ② 探头条目数 = 当期活动条数（活动期 / 兑换期都是 3）—— 与改造前一致，不因提示行多出条目
		const aItems = scheduleHoverItems(a.data && a.data.eventHover, "支线故事：墟", false);
		const bItems = scheduleHoverItems(b.data && b.data.eventHover, "支线故事：墟", false);
		check("格子探头：eventHover 解析出的并列条目数 = 当期活动条数（活动期 3 条，与改造前一致）",
			aItems.length === 3, JSON.stringify(aItems.map((x) => x.title)));
		check("格子探头：兑换期也还是 3 条（墟 的兑换期没有顶掉任何一条，也不多出提示行）",
			bItems.length === 3, JSON.stringify(bItems.map((x) => x.title)));
		check("格子探头：解析出的条目里没有任何「兑换截止 / 奖励领取期」标题（= 格子里不会出现那段文字）",
			aItems.concat(bItems).every((x) => !LEAK_RE.test(x.title))
			&& aItems.concat(bItems).every((x) => SHARED_LINE_RE.test(`${x.title}   ${x.win}`)),
			JSON.stringify(aItems.concat(bItems).map((x) => x.title)));

		// ③ 反向回归（证明上面那条断言**真能**抓到这次泄漏）：按旧实现把提示行插回 eventHover
		const oldHover = String(a.data.eventHover).split("\n")
			.flatMap((l) => (l === "支线故事：墟   10-24 16:00 ~ 11-07 03:59" ? [l, "兑换截止：11-10 03:59"] : [l]))
			.join("\n");
		const oldItems = scheduleHoverItems(oldHover, "支线故事：墟", false);
		check("反向回归：提示行若进了 eventHover ⇒ 探头**多出一条**「兑换截止：11-10 03:59」（用户截图那一行）",
			oldItems.length === 4 && oldItems.some((x) => x.title === "兑换截止：11-10 03:59"),
			JSON.stringify(oldItems.map((x) => x.title)));

		// ④ 提示框：表格格子 hoverTextOf / 「近期」行 scheduleHoverText 都调同一个拼接函数，提示行只在**末尾**
		const compSrc = readComponentsSource();
		const iHover = compSrc.indexOf("const hoverTextOf = (x, withFail)");
		const hoverBody = iHover >= 0 ? compSrc.slice(iHover, compSrc.indexOf("const itemOf =", iHover)) : "";
		check("静态：表格格子 hoverTextOf 用 scheduleHoverNote(text, g, x.isG) 拼提示行（不是手写 \n 拼接）",
			hoverBody.length > 0 && /return scheduleHoverNote\(text, g, x\.isG\) \|\| "—";/.test(hoverBody),
			hoverBody.slice(-160));
		const iRecent = compSrc.indexOf("function scheduleHoverText(x)");
		const recentBody = iRecent >= 0 ? compSrc.slice(iRecent, compSrc.indexOf("function scheduleKindIcon", iRecent)) : "";
		check("静态：「近期」行的 scheduleHoverText 也走同一个拼接函数（两处口径一致）",
			recentBody.length > 0 && /scheduleHoverNote\(\[hv, head\]/.test(recentBody), recentBody);

		const gNote = { eventHover: "视相博物馆：演化   10-24 16:00 ~ 11-07 03:59", eventHoverNote: "兑换截止：11-10 03:59" };
		check("提示框拼接：提示行追加在**末尾**、另起一行（`…档期` ⏎ `兑换截止：…`）",
			scheduleHoverNote("视相博物馆：演化\n10-24 16:00 ~ 11-07 03:59", gNote, false)
				=== "视相博物馆：演化\n10-24 16:00 ~ 11-07 03:59\n兑换截止：11-10 03:59",
			JSON.stringify(scheduleHoverNote("视相博物馆：演化", gNote, false)));
		check("提示框拼接：没有 eventHoverNote（或卡池侧）⇒ 原样返回，不补空行",
			scheduleHoverNote("a\nb", { eventHover: "x" }, false) === "a\nb"
			&& scheduleHoverNote("a\nb", { eventHoverNote: "兑换截止：11-10 03:59" }, true) === "a\nb");
		// 端到端：真抓取的载荷 + 真档案 ⇒ 提示框文本末尾就是提示行（表格与近期读的是同一份 g）
		const rec = Object.assign({}, a.data, { name: "明日方舟" });
		check("提示框拼接：把真载荷的 eventHoverNote 接到悬停原文后面 ⇒ 最后一行 = 提示行",
			scheduleHoverNote(a.data.eventHover, rec, false).split("\n").pop() === "兑换截止：11-22 03:59",
			JSON.stringify(scheduleHoverNote(a.data.eventHover, rec, false)));
	}
}
