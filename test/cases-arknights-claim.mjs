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
//    **可见文字**「兑换截止：11-10 03:59」。现在提示行只走独立字段 `eventHoverExtra`（只进提示框），
//    `eventHover` 恢复成**只由 buildEventHover 产出**。本文件的第④节就是这条的回归（含"旧实现会多一条"的反向证明）。
//
// ⚠️ 2026-11-06 第二轮（用户四条要求）：
//    ① 分类前缀去重 `labelOf(cat, name)`（名称本身已带 `视相博物馆：` 前缀时不再拼第二遍）；
//    ② 兑换期的事项名 = `<去重后的活动名> 兑换截止`（**一个空格**，不是冒号）；
//    ③ 提示行与该活动自己那行**同一排版**（`名称` + **3 空格** + `内容`），且**插在该活动那一行之后**；
//       删掉「活动已于 … 结束，当前为奖励领取期（…）」解释句；
//    ④ 提示框里出现的标签与面板显示的那一串**同一串**。
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

// `eventHoverExtra`（**只进提示框**）：每两条一组 —— ① 该活动的**标签** ② 提示行本身。
// 提示行的两种合法形态（与该活动自己那行**同一排版**：`名称` + **3 空格** + `内容`）：
//   · 活动期（有兑换期） ⇒ `<标签> 兑换截止   11-10 03:59`
//   · 兑换期            ⇒ `<标签> 兑换截止   11-07 03:59 ~ 11-10 03:59`
const NOTE_EVENT_RE = /^(\S.*) 兑换截止   \d{2}-\d{2} \d{2}:\d{2}$/;
const NOTE_CLAIM_RE = /^(\S.*) 兑换截止   \d{2}-\d{2} \d{2}:\d{2} ~ \d{2}-\d{2} \d{2}:\d{2}$/;
// 悬停 = 共用排版：`名称 + 3 空格 + 档期`。
const SHARED_LINE_RE = /^\S.*   (\d{4}-)?\d{2}-\d{2} \d{2}:\d{2} ~ (\d{4}-)?\d{2}-\d{2} \d{2}:\d{2}$/;
// 「泄漏」判据：eventHover 里出现这两类字样就说明提示行又跑进去了。
const LEAK_RE = /兑换截止|奖励领取期/;
// 解释句（用户 2026-11-06 点名删掉）：载荷里任何一处都不许再出现。
const EXPLAIN_RE = /活动已于|当前为奖励领取期/;
// 活动期 / 兑换期的 `eventHover` **逐字**基线（= 只由 buildEventHover 产出；与改造前一致）。
const HOVER_ACTIVITY = "支线故事：墟   10-24 16:00 ~ 11-07 03:59\n危机合约：尖灭测试作战   11-01 04:00 ~ 11-15 03:59\n支线故事：火山旅梦   11-05 04:00 ~ 11-19 03:59";
const HOVER_CLAIM = "支线故事：墟   11-07 03:59 ~ 11-10 03:59\n危机合约：尖灭测试作战   11-01 04:00 ~ 11-15 03:59\n支线故事：火山旅梦   11-05 04:00 ~ 11-19 03:59";
// 提示行数据的**逐字**基线（活动期 / 兑换期）：每组两行（标签 ⏎ 提示行），顺序 = 悬停顺序（结束时间升序）。
const EXTRA_ACTIVITY = "支线故事：墟\n支线故事：墟 兑换截止   11-10 03:59\n支线故事：火山旅梦\n支线故事：火山旅梦 兑换截止   11-22 03:59";
const EXTRA_CLAIM = "支线故事：墟\n支线故事：墟 兑换截止   11-07 03:59 ~ 11-10 03:59\n支线故事：火山旅梦\n支线故事：火山旅梦 兑换截止   11-22 03:59";

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
	const { parsePrtsPageEndTimes, prtsClaimTitles, prtsPageTimesFromBatch, prtsPageNameFromHref, PRTS_CLAIM_MAX_TITLES,
		labelOf, collectPrtsEvents, prtsEventPayload } =
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

	// ── ①b 分类前缀去重 `labelOf`（纯函数）/ `collectPrtsEvents` 的 label ────────────
	// 起因（用户 2026-11-06）：「分类前缀重复问题做个判定如果完全一致就合并」——
	// PRTS 的活动名本身可能就带分类前缀（页名「视相博物馆：演化」），再无条件拼 `${cat}：${name}`
	// 就成了「视相博物馆：视相博物馆：演化」。
	{
		check("labelOf：名称不带前缀 ⇒ 拼一次 `<cat>：<name>`",
			labelOf("视相博物馆", "演化") === "视相博物馆：演化", labelOf("视相博物馆", "演化"));
		check("labelOf：名称已带 `<cat>：` ⇒ **原样返回**（不再拼成 视相博物馆：视相博物馆：演化）",
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
		check("labelOf：幂等（labelOf(cat, labelOf(cat, name)) 不会多拼一层）",
			labelOf("视相博物馆", labelOf("视相博物馆", "演化")) === "视相博物馆：演化"
			&& labelOf("视相博物馆", labelOf("视相博物馆", "视相博物馆：演化")) === "视相博物馆：演化");

		// 真实结构：一览第二列那个 <a> 的**文本本身就带前缀**（PRTS 页名「视相博物馆：演化」）
		const dupHtml = '<table><tr><th>活动开始时间</th><th>活动</th><th>分类</th></tr>'
			+ '<tr><td data-time="1792828800,1793995140">2026-10-24 16:00</td>'
			+ '<td><a href="/w/%E8%A7%86%E7%9B%B8%E5%8D%9A%E7%89%A9%E9%A6%86%EF%BC%9A%E6%BC%94%E5%8C%96" title="视相博物馆：演化">视相博物馆：演化</a></td>'
			+ '<td><a title="分类:视相博物馆">视相博物馆</a></td></tr></table>';
		const dupItems = collectPrtsEvents(dupHtml, TZ_CN);
		check("collectPrtsEvents：名称本身带分类前缀时**不重复**（banner 逐字 =「视相博物馆：演化」）",
			dupItems.length === 1 && dupItems[0].banner === "视相博物馆：演化" && dupItems[0].cat === "视相博物馆",
			JSON.stringify(dupItems.map((x) => [x.banner, x.cat])));

		// 用户举的那个例子端到端跑一遍 payload：活动期 → 兑换期（页内给「兑换结束时间」）
		const snap = [{
			name: "视相博物馆：演化", cat: "视相博物馆", page: "p",
			startTs: at("2026-10-24T16:00:00+08:00"), endTs: at("2026-11-07T03:59:00+08:00"),
			raw: "10-24 16:00 ~ 11-07 03:59"
		}];
		const pages = new Map([["p", { actEndTs: at("2026-11-07T03:59:00+08:00"), claimEndTs: at("2026-11-10T03:59:00+08:00") }]]);
		const claimPl = prtsEventPayload(snap, TZ_CN, at("2026-11-08T12:00:00+08:00"), pages);
		check("去重端到端：兑换期 `event` / `eventShow` / 提示行前缀是**同一串**（「视相博物馆：演化」）",
			!!claimPl && claimPl.event === "视相博物馆：演化"
			&& claimPl.eventShow === "视相博物馆：演化 兑换截止"
			&& claimPl.eventHoverExtra.split("\n")[0] === "视相博物馆：演化",
			JSON.stringify(claimPl && [claimPl.event, claimPl.eventShow, claimPl.eventHoverExtra]));
		check("去重端到端：兑换期提示行 = `<标签> 兑换截止   <活动结束> ~ <兑换结束>`（逐字，3 空格）",
			!!claimPl && claimPl.eventHoverExtra.split("\n")[1] === "视相博物馆：演化 兑换截止   11-07 03:59 ~ 11-10 03:59",
			JSON.stringify(claimPl && claimPl.eventHoverExtra));
		// 单条活动时 buildEventHover 返回 ""（UI 退回「名称 ⏎ 档期」两行式）⇒ 提示行仍要插到活动名后面
		const singleHover = "视相博物馆：演化\n11-07 03:59 ~ 11-10 03:59";
		check("去重端到端：单条活动（eventHover 为空）时提示行插在活动名那行之后，不是凭空另起一段",
			T.scheduleHoverNote(singleHover, claimPl, false)
				=== "视相博物馆：演化\n视相博物馆：演化 兑换截止   11-07 03:59 ~ 11-10 03:59\n11-07 03:59 ~ 11-10 03:59",
			JSON.stringify(T.scheduleHoverNote(singleHover, claimPl, false)));
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

	// ── ③ 三态：活动期 / 兑换期 / batch 失败退化 ────────────────────────────────
	{
		// ① 活动期（now = 2026-11-06 15:54，墟 11-07 03:59 结束）—— 外显与改造前**完全一致**
		const a = await runFetcher("2026-11-06T15:54:00+08:00");
		check("活动期：外显是活动区间（10-24 16:00 ~ 11-07 03:59，逐字）",
			!!a.data && a.data.event === "支线故事：墟" && a.data.eventDates === "10-24 16:00 ~ 11-07 03:59",
			JSON.stringify(a.data && [a.data.event, a.data.eventDates]));
		// ⚠️ 提示行**只进 `eventHoverExtra`**（提示框），绝不进 `eventHover`（格子会把它解析成并列条目）。
		// 形态与该活动自己那行同一排版：`名称` + **3 空格** + `内容`；每组两行（标签 ⏎ 提示行）。
		check("活动期：`eventHoverExtra` = 每条有兑换期的活动一组「<标签> ⏎ <标签> 兑换截止   MM-DD HH:mm」（墟 11-10 / 火山 11-22）",
			!!a.data && a.data.eventHoverExtra === EXTRA_ACTIVITY,
			JSON.stringify(a.data && a.data.eventHoverExtra));
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
		check("活动期：没有兑换期的活动（尖灭）不补提示行 —— 提示行恰好 2 行、都是活动期形态、不含 11-15",
			!!a.data && (() => {
				const L = String(a.data.eventHoverExtra || "").split("\n");
				const notes = L.filter((_, i) => i % 2 === 1).filter(Boolean);
				return notes.length === 2 && notes.every((l) => NOTE_EVENT_RE.test(l) && !NOTE_CLAIM_RE.test(l))
					&& !notes.some((l) => /11-15/.test(l));
			})(),
			JSON.stringify(a.data && a.data.eventHoverExtra));
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
		check("兑换期：`eventHoverExtra` = 每组「<标签> ⏎ <标签> 兑换截止   活动结束 ~ 兑换结束」（逐字）",
			!!b.data && b.data.eventHoverExtra === EXTRA_CLAIM,
			JSON.stringify(b.data && b.data.eventHoverExtra));
		check("兑换期：**不再有**解释句「活动已于 … 结束，当前为奖励领取期（…）」（用户点名删掉）",
			!!b.data && !EXPLAIN_RE.test(JSON.stringify(b.data)),
			JSON.stringify(b.data && b.data.eventHoverExtra));
		check("兑换期：`eventHover` 里**没有任何**「兑换截止 / 奖励领取期」字样（与活动期同一个判据）",
			!!b.data && !LEAK_RE.test(b.data.eventHover) && b.data.eventHover === HOVER_CLAIM,
			JSON.stringify(b.data && b.data.eventHover));
		check("兑换期：日期格悬停（eventDatesRaw）与格子里显示的区间是同一份",
			!!b.data && b.data.eventDatesRaw === b.data.eventDates, JSON.stringify(b.data && b.data.eventDatesRaw));
		// 兑换期里 eventDates 本身就是兑换区间 ⇒ eventClaimDates 与它**同值**；提醒侧按「T 相同只留一条」去重。
		check("兑换期：`eventClaimDates` 与 `eventDates` 同值（提醒侧去重后只留一条，不会弹两次）",
			!!b.data && b.data.eventClaimDates === b.data.eventDates, JSON.stringify(b.data && b.data.eventClaimDates));
		// 事项名（只给显示）：`<去重后的活动名> 兑换截止`（墟 的标签 = 支线故事：墟）；`event` 一字不动。
		check("兑换期：`eventShow` = 「<去重后的活动名> 兑换截止」（一个空格，逐字 =「支线故事：墟 兑换截止」）",
			!!b.data && b.data.eventShow === "支线故事：墟 兑换截止", JSON.stringify(b.data && b.data.eventShow));
		check("一致性：`eventShow` 就是 `event` + 「 兑换截止」（同一串，不是又一次拼分类前缀）",
			!!b.data && b.data.eventShow === b.data.event + " 兑换截止"
			&& !/支线故事：支线故事/.test(b.data.eventShow), JSON.stringify(b.data && [b.data.event, b.data.eventShow]));
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
			!!b.data && b.data.event === "支线故事：墟", JSON.stringify(b.data && b.data.event));

		// ③ 批量失败（同一时刻）—— 退化为改造前行为：墟消失、尖灭用的是**一览**的 11-14
		const c = await runFetcher("2026-11-08T12:00:00+08:00", { failBatch: true });
		check("batch 失败：退化为「只有活动期」—— 兑换期内的墟**消失**（= 改造前行为）",
			!!c.data && c.data.event === "危机合约：尖灭测试作战", JSON.stringify(c.data && c.data.event));
		check("batch 失败：结束时间回落**一览**的 data-time（11-14，不是页内的 11-15）",
			!!c.data && c.data.eventDates === "11-01 04:00 ~ 11-14 03:59", JSON.stringify(c.data && c.data.eventDates));
		check("batch 失败：没有任何「兑换截止 / 领取期」提示行、也不打日志（不留半截元信息）",
			!!c.data && !LEAK_RE.test(c.data.eventHover) && !("eventHoverExtra" in c.data)
			&& c.warns.length === 0, JSON.stringify([c.data && c.data.eventHover, c.warns]));
		check("batch 失败：**不写** `eventClaimDates` 这个键（不是给空串，下游不必多问一遍）",
			!!c.data && !("eventClaimDates" in c.data), JSON.stringify(c.data && Object.keys(c.data)));
		check("batch 失败：也**不写** `eventShow` / `eventHoverExtra` 这两个键（没有兑换期就没有提示行）",
			!!c.data && !("eventShow" in c.data) && !("eventHoverExtra" in c.data), JSON.stringify(c.data && Object.keys(c.data)));

		// ④ 活动期 + batch 失败：与改造前**逐字节一致**（回归基线）
		const d = await runFetcher("2026-11-06T15:54:00+08:00", { failBatch: true });
		check("batch 失败（活动期）：event / eventDates / 悬停 与改造前逐字节一致",
			!!d.data && d.data.event === "支线故事：墟" && d.data.eventDates === "10-24 16:00 ~ 11-07 03:59"
			&& d.data.eventHover === "支线故事：墟   10-24 16:00 ~ 11-07 03:59\n危机合约：尖灭测试作战   11-01 04:00 ~ 11-14 03:59\n支线故事：火山旅梦   11-05 04:00 ~ 11-19 03:59"
			&& !("eventShow" in d.data) && !("eventHoverExtra" in d.data),
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
			&& aLines.concat(bLines).every((l) => !NOTE_EVENT_RE.test(l) && !NOTE_CLAIM_RE.test(l)),
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
		// ③ 提示行**不参与解析**：把提示行拼进提示框（正确路径）之后，探头仍只解析 eventHover —— 条目数不变
		check("格子探头：提示行只在提示框里（不参与解析）⇒ 条目数仍是 3，且没有一条以「兑换截止」结尾",
			scheduleHoverItems(a.data.eventHover, "支线故事：墟", false).length === 3
			&& scheduleHoverNote(a.data.eventHover, a.data, false).split("\n")
				.filter((l) => / 兑换截止   /.test(l)).length === 2
			&& aItems.concat(bItems).every((x) => !/兑换截止$/.test(x.title)),
			JSON.stringify(scheduleHoverNote(a.data.eventHover, a.data, false)));

		// ④ 反向回归（证明上面那条断言**真能**抓到这次泄漏）：按旧实现把提示行插回 eventHover
		const oldHover = String(a.data.eventHover).split("\n")
			.flatMap((l) => (l === "支线故事：墟   10-24 16:00 ~ 11-07 03:59" ? [l, "支线故事：墟 兑换截止   11-10 03:59"] : [l]))
			.join("\n");
		const oldItems = scheduleHoverItems(oldHover, "支线故事：墟", false);
		check("反向回归：提示行若进了 eventHover ⇒ 探头**多出一条**「支线故事：墟 兑换截止   11-10 03:59」（用户截图那一行）",
			oldItems.length === 4 && oldItems.some((x) => x.title === "支线故事：墟 兑换截止   11-10 03:59"),
			JSON.stringify(oldItems.map((x) => x.title)));

		// ⑤ 提示框：表格格子 hoverTextOf / 「近期」行 scheduleHoverText 都调同一个插入函数
		const compSrc = readComponentsSource();
		const iHover = compSrc.indexOf("const hoverTextOf = (x, withFail)");
		const hoverBody = iHover >= 0 ? compSrc.slice(iHover, compSrc.indexOf("const itemOf =", iHover)) : "";
		check("静态：表格格子 hoverTextOf 用 scheduleHoverNote(text, g, x.isG) 插提示行（不是手写 \\n 拼接）",
			hoverBody.length > 0 && /return scheduleHoverNote\(text, g, x\.isG\) \|\| "—";/.test(hoverBody),
			hoverBody.slice(-160));
		const iRecent = compSrc.indexOf("function scheduleHoverText(x)");
		const recentBody = iRecent >= 0 ? compSrc.slice(iRecent, compSrc.indexOf("function scheduleKindIcon", iRecent)) : "";
		check("静态：「近期」行的 scheduleHoverText 也走同一个插入函数（两处口径一致）",
			recentBody.length > 0 && /scheduleHoverNote\(\[hv, head\]/.test(recentBody), recentBody);
		// 渲染层真的把 `eventHoverExtra` 透传进面板（否则 refetch 之后提示行整段消失）
		const rawAll = compSrc;
		check("静态：面板把 `eventHoverExtra` 从抓取结果透传给面板条目（与 eventShow 同口径）",
			/eventShow: sc\.eventShow \|\| "",[\s\S]{0,120}?eventHoverExtra: sc\.eventHoverExtra \|\| ""/.test(rawAll));

		// ⑥ 插入位置：**紧跟该活动那一行之后**，不是统一堆到末尾
		const gNote = {
			eventHover: "视相博物馆：演化   10-24 16:00 ~ 11-07 03:59\n危机合约：尖灭测试作战   11-01 04:00 ~ 11-15 03:59",
			eventHoverExtra: "视相博物馆：演化\n视相博物馆：演化 兑换截止   11-10 03:59"
		};
		check("提示框拼接：提示行插在**该活动那一行之后**（第 2 行，不是堆到末尾）",
			scheduleHoverNote(gNote.eventHover, gNote, false)
				=== "视相博物馆：演化   10-24 16:00 ~ 11-07 03:59\n视相博物馆：演化 兑换截止   11-10 03:59\n危机合约：尖灭测试作战   11-01 04:00 ~ 11-15 03:59",
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
		// 端到端：真抓取的载荷 + 真档案 ⇒ 两条提示行分别紧跟在自己那条活动之后（火山是最后一条 ⇒ 末尾）
		const rec = Object.assign({}, a.data, { name: "明日方舟" });
		check("提示框拼接（端到端）：活动期实际提示框逐行 = 原 hover 三行 + 两条提示行各插在其活动之后",
			scheduleHoverNote(a.data.eventHover, rec, false)
				=== "支线故事：墟   10-24 16:00 ~ 11-07 03:59\n支线故事：墟 兑换截止   11-10 03:59\n"
				+ "危机合约：尖灭测试作战   11-01 04:00 ~ 11-15 03:59\n"
				+ "支线故事：火山旅梦   11-05 04:00 ~ 11-19 03:59\n支线故事：火山旅梦 兑换截止   11-22 03:59",
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
		const { pickEventPrimary, eventTier, sortEventItems } = T;
		// 真机 lastData 等价的候选（两个窗口首尾相接，与 prtsEventPayload 生成的一致）
		const claimCand = {
			name: "视相博物馆：演化", cat: "视相博物馆", phase: "claim",
			startTs: at("2026-11-07T03:59:00+08:00"), endTs: at("2026-11-10T03:59:00+08:00")
		};
		const runCand = {
			name: "支线故事：时间啊，向前！", cat: "支线故事", phase: "event",
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
				name: "视相博物馆：演化", cat: "视相博物馆", page: "p1",
				startTs: at("2026-10-24T16:00:00+08:00"), endTs: at("2026-11-07T03:59:00+08:00"),
				raw: "10-24 16:00 ~ 11-07 03:59"
			},
			{
				name: "时间啊，向前！", cat: "支线故事", page: "p2",
				startTs: at("2026-11-01T12:00:00+08:00"), endTs: at("2026-11-22T03:59:00+08:00"),
				raw: "11-01 12:00 ~ 11-22 03:59"
			}
		];
		const pageTimes = new Map([
			["p1", { actEndTs: at("2026-11-07T03:59:00+08:00"), claimEndTs: at("2026-11-10T03:59:00+08:00") }],
			["p2", { actEndTs: at("2026-11-22T03:59:00+08:00"), claimEndTs: null }]
		]);
		const now = at("2026-11-07T12:00:00+08:00");   // 视相已结束 8 小时，兑换期还剩 3 天
		const pl = prtsEventPayload(snapshot, TZ_CN, now, pageTimes);
		check("端到端（真机等价输入）：外显 `event` = 兑换期那一条（视相博物馆：演化），不再被还剩 15 天的那条挤掉",
			!!pl && pl.event === "视相博物馆：演化", JSON.stringify(pl && pl.event));
		check("端到端：`eventShow` = 「视相博物馆：演化 兑换截止」（面板/近期那一行的事项名）",
			!!pl && pl.eventShow === "视相博物馆：演化 兑换截止", JSON.stringify(pl && pl.eventShow));
		check("端到端：`eventDates` = 兑换区间（11-07 03:59 ~ 11-10 03:59 ⇒「还剩」指向兑换截止）",
			!!pl && pl.eventDates === "11-07 03:59 ~ 11-10 03:59", JSON.stringify(pl && pl.eventDates));
		// 悬停**不动**：仍按结束时间升序全量（兑换期那条 11-10 本来就最早，这里换成"兑换期最晚"再验一次）
		const hoverOrder = sortEventItems([
			{ name: "晚截止：兑换期", cat: "视相博物馆", phase: "claim", startTs: at("2026-11-07T03:59:00+08:00"), endTs: at("2026-11-20T03:59:00+08:00") },
			{ name: "早结束：进行中", cat: "支线故事", phase: "event", startTs: at("2026-11-01T12:00:00+08:00"), endTs: at("2026-11-12T03:59:00+08:00") }
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
			{ name: "A", cat: "支线故事", phase: "event", startTs: 10, endTs: 300 },
			{ name: "B", cat: "支线故事", phase: "event", startTs: 20, endTs: 200 },
			{ name: "C", cat: "支线故事", phase: "event", startTs: 30, endTs: 200 }
		];
		check("反向守卫：同档位内仍按 endTs 升序、再按 startTs 升序（旧排序键一个没丢）",
			pickEventPrimary(sameTier).name === "B" && pickEventPrimary([sameTier[2], sameTier[0], sameTier[1]]).name === "B",
			pickEventPrimary(sameTier).name);
		// 两个都是 claim（同一时刻两条都在兑换期）⇒ 档位规则在领取期内部照旧生效
		const twoClaims = [
			Object.assign({}, claimCand),
			{ name: "危机合约：兑换期", cat: "危机合约", phase: "claim", startTs: 10, endTs: 400 }
		];
		check("反向守卫：两条都在领取期 ⇒ 领取期**内部**仍按类别档位/结束时间挑（不是随便选一条）",
			pickEventPrimary(twoClaims) === twoClaims[1] && pickEventPrimary([twoClaims[1], twoClaims[0]]) === twoClaims[1],
			JSON.stringify(twoClaims.map((x) => x.name)));

		// 反向守卫 ②：**其它游戏的数据形状没有 `phase`** ⇒ 与显式 `"event"` 逐排列同解。
		// 4 条候选（档位 × 结束时间都不同）取 24 种排列：去掉 phase / 标成 "event" 两种形状的挑选结果必须一致。
		const base = [
			{ name: "t1-早", cat: "支线故事", startTs: 100, endTs: 200 },   // tier 1
			{ name: "t1-晚", cat: "危机合约", startTs: 100, endTs: 900 },   // tier 1
			{ name: "t2-早", cat: "登录活动", startTs: 50, endTs: 150 },    // tier 2
			{ name: "t2-晚", cat: "签到活动", startTs: 50, endTs: 800 }     // tier 2
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
}

