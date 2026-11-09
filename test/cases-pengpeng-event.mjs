// test/cases-pengpeng-event.mjs —— 夜幕之下：活动侧（bwiki `公告/` 版本活动总览）2026-11-09 晚接入
//
// ── 本段守什么 ──
//   ① 注册：`pengpeng.eventUrl` 指向 bwiki `公告/` 的 allpages 列表、`eventSource` 写明
//      「Bwiki 公告（wiki 数据滞后）」；卡池侧（契约一览）一个字都没动；
//   ② 解析：`公告/` 88 页里挑出 5 页「…版本活动总览」；最新一页 = pageid 最大
//      （「共举昨日之酒·上」）；每行「活动时间：」配前面 `◈小节名` = 活动名 + 起止；
//   ③ 当期：在抓取那天（2026-09-15）只有「彷徨往昔」两端都明确 ⇒ 外显它；
//      其余 5 行都写「版本更新后」⇒ startTs=null，**只在悬停里**，不进外显；
//   ④ 真机现状（2026-11-09）：wiki 最新一版只到 09-10 ⇒ 全部已结束 ⇒ **返回 null（未公布）**，
//      绝不把九月档期当成当前活动（「wiki 数据滞后」，不是游戏暂停）；
//   ⑤ 反向证明：把 wikitext 里的「活动时间：」删掉 ⇒ 解析器返回空、抓取器返回 null。
//
// 夹具：`pengpeng-announce-pages`（88 页标题）+ `pengpeng-overview-20260910`（最新总览 wikitext），
// 都是真响应，裁剪规则见各自 `response.txt.meta.json` 的 `trim`。
// 时间断言写绝对毫秒，UTC 与 +08 两道门禁同一份期望值。

import { createEngine } from "../packages/core/core.mjs";
import { check, section, fixtureBody, assertHoverConvention } from "./harness.mjs";
import { T } from "./load.mjs";

const TZ_CN = "Asia/Shanghai";
const FIX = (dir) => fixtureBody("fixture:" + dir, { ["fixture:" + dir]: dir + "/response.txt" });
const PP = T.parsers.pengpeng;

const B = {
	pages: FIX("pengpeng-announce-pages"),
	overview: FIX("pengpeng-overview-20260910")
};

// 夹具版本页的活动都在 2026-09-10 ~ 10-01；取批内时刻断言逐字值
const NOW_PP = Date.parse("2026-09-15T12:00:00+08:00");
// 真机抓取时刻（2026-11-09）：wiki 还没补新版本 ⇒ 应如实 null
const NOW_REAL = Date.parse("2026-11-09T22:53:00+08:00");

function pickBody(url) {
	const u = String(url).replace(/[?&]origin=\*/, "");
	if (u === PP.PENGPENG_EVENT_URL) return B.pages;
	if (/action=parse&page=.*&prop=wikitext/.test(u)) return B.overview;
	throw new Error("pengpeng 活动用例没有这个 URL 的夹具：" + u);
}

function makeTransport(sink, overrideOverview) {
	const rec = (url) => { if (sink) sink.push(String(url)); };
	return {
		async fetchRaw(url) {
			rec(url);
			const body = overrideOverview && /action=parse&page=/.test(String(url)) ? overrideOverview : pickBody(url);
			return { ok: true, status: 200, headers: { get: () => null }, text: async () => body, json: async () => JSON.parse(body) };
		},
		async fetchViaProxy(url) {
			rec(url);
			return overrideOverview && /action=parse&page=/.test(String(url)) ? overrideOverview : pickBody(url);
		}
	};
}
const makeStore = () => {
	const m = new Map();
	return { map: m, async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
};
const engineAt = (now, sink, overrideOverview) => createEngine({
	transport: makeTransport(sink, overrideOverview),
	storage: makeStore(),
	now: () => now,
	timer: { setTimeout, clearTimeout }
});

// 把最新总览 wikitext 里的「活动时间」行整行删掉（反向证明用）
function strippedOverview() {
	const j = JSON.parse(B.overview);
	j.parse.wikitext = j.parse.wikitext.split(/\r?\n/).filter((l) => l.indexOf("活动时间") < 0).join("\n");
	return JSON.stringify(j);
}

export default async function runPengpengEvent() {
	// ─────────────────────① 注册 ─────────────────────
	section("夜幕之下 ①：活动侧注册（bwiki 公告/版本活动总览；卡池侧不动）");
	{
		const s = T.SOURCES.find((x) => x.id === "pengpeng") || null;
		check("pengpeng eventUrl = bwiki 公告/ 的 allpages 列表",
			!!s && s.eventUrl === PP.PENGPENG_EVENT_URL && /generator=allpages&gapprefix=/.test(String(s.eventUrl)),
			s ? String(s.eventUrl) : "缺失");
		check("pengpeng 活动来源标签 = 「Bwiki 公告（wiki 数据滞后）」（不标暂停）",
			!!s && s.eventSource === "Bwiki 公告（wiki 数据滞后）", s ? String(s.eventSource) : "缺失");
		check("pengpeng 卡池侧仍是契约一览（本次只加活动侧，没换卡池源）",
			!!s && /action=parse&page=契约一览/.test(String(s.url)) && s.source === "Bwiki",
			s ? String(s.url) : "缺失");
	}

	// ─────────────────────② 列表 / 解析 ─────────────────────
	section("夜幕之下 ②：公告列表 → 最新版本总览 → 活动名 + 起止");
	{
		const pages = PP.pengpengOverviewPagesOf(JSON.parse(B.pages));
		check("从 88 个 `公告/*` 页里挑出 5 页「版本活动总览」", pages.length === 5, String(pages.length));
		check("按 pageid 倒序 ⇒ 最新一页 = 「共举昨日之酒·上」版本活动总览",
			pages[0] && pages[0].title === "公告/「共举昨日之酒·上」版本活动总览",
			JSON.stringify(pages.map((p) => p.title)));
		check("pageid 严格递减（最新一版一定排在第一个）",
			pages.every((p, i) => i === 0 || p.pageid < pages[i - 1].pageid), JSON.stringify(pages.map((p) => p.pageid)));

		const wt = PP.pengpengWikitextOf(JSON.parse(B.overview));
		const acts = PP.pengpengOverviewActivitiesOf(wt, TZ_CN);
		check("最新总览解析出 5 条活动（每行「活动时间：」一条，与调研「每页稳定 5 行」一致）", acts.length === 5, String(acts.length));
		check("活动名 = 小节名（`◈「共举昨日之酒·上」版本签到` → 「共举昨日之酒·上」版本签到）",
			acts[0] && acts[0].name === "「共举昨日之酒·上」版本签到", JSON.stringify(acts[0] && acts[0].name));
		check("起止逐字：`2026/9/12 5:00 ~ 2026/9/29 4:59`（彷徨往昔）",
			!!acts.find((a) => a.name === "彷徨往昔" && a.raw === "2026/9/12 5:00 ~ 2026/9/29 4:59"),
			JSON.stringify(acts.find((a) => a.name === "彷徨往昔")));
		check("「版本更新后」起点 ⇒ startTs = null、display 保留原文（`09-10 版本更新后 ~ 10-01 04:59`）",
			(() => {
				const a = acts.find((x) => x.name === "「共举昨日之酒·上」版本签到");
				return !!a && a.startTs === null && a.display === "09-10 版本更新后 ~ 10-01 04:59"
					&& a.endTs === Date.UTC(2026, 9, 0, 20, 59);
			})(),
			JSON.stringify(acts.find((x) => x.name === "「共举昨日之酒·上」版本签到")));
	}

	// ─────────────────────③ 当期（夹具批内时刻）─────────────────────
	section("夜幕之下 ③：活动外显（两端明确的才进外显；「版本更新后」只在悬停）");
	let event = null;
	{
		const calls = [];
		const e = engineAt(NOW_PP, calls);
		const s = e.__test.SOURCES.find((x) => x.id === "pengpeng");
		event = await e.__test.EVENT_FETCHERS["pengpeng"].default(s.eventUrl, undefined, s.tz);
		check("pengpeng 活动抓取器返回对象", !!event && typeof event === "object");
		check("外显活动名 = 彷徨往昔（唯一两端都明确且覆盖 now 的那条）",
			event && event.event === "彷徨往昔", JSON.stringify(event && event.event));
		check("外显档期 = 「09-12 05:00 ~ 09-29 04:59」",
			event && event.eventDates === "09-12 05:00 ~ 09-29 04:59", JSON.stringify(event && event.eventDates));
		check("源站原文 = 「2026/9/12 5:00 ~ 2026/9/29 4:59」",
			event && event.eventDatesRaw === "2026/9/12 5:00 ~ 2026/9/29 4:59", JSON.stringify(event && event.eventDatesRaw));
		check("startTs = 2026-09-12 05:00 +08（UTC 09-11 21:00）",
			event && event.events[0].startTs === Date.UTC(2026, 8, 11, 21, 0), String(event && event.events[0].startTs));
		check("endTs = 2026-09-29 04:59 +08（UTC 09-28 20:59）",
			event && event.events[0].endTs === Date.UTC(2026, 8, 28, 20, 59), String(event && event.events[0].endTs));
		// 悬停：彷徨往昔结束最早 → 5 行；4 条「版本更新后」原样印源站原文
		check("悬停逐字（5 行：彷徨往昔 + 4 条版本更新后，按结束时间升序）",
			event && event.eventHover === "彷徨往昔   09-12 05:00 ~ 09-29 04:59\n吾血浓于酒   2026/9/10 版本更新后 ~ 2026/9/29 4:59\n灰色酒路   2026/9/10 版本更新后 ~ 2026/9/29 4:59\n「共举昨日之酒·上」版本签到   2026/9/10 版本更新后 ~ 2026/10/1 4:59\n橡木廊柜台   2026/9/10 版本更新后 ~ 2026/10/1 4:59",
			JSON.stringify(event && event.eventHover));
		check("「版本更新后」的 4 条**都不进外显**（event ≠ 版本签到/吾血/灰色/橡木）",
			!!event && !/版本签到|吾血浓于酒|灰色酒路|橡木廊柜台/.test(event.event), JSON.stringify(event && event.event));
		check("`events[]` 共 5 条；4 条版本更新后条目的 startTs 为 null",
			!!event && Array.isArray(event.events) && event.events.length === 5
			&& event.events.filter((x) => x.startTs === null).length === 4,
			JSON.stringify(event && event.events.map((x) => [x.title, x.startTs])));
		if (event && event.eventHover) assertHoverConvention("pengpeng 活动", event.eventHover, { requireSet: true });
		check("一次刷新只发 2 个请求（1 次 allpages + 1 次最新总览 wikitext）",
			calls.length === 2, JSON.stringify(calls.map((u) => u.slice(0, 60))));
	}

	// ─────────────────────④ 真机现状：wiki 滞后 ⇒ null ─────────────────────
	section("夜幕之下 ④：2026-11-09 真机现状（wiki 数据滞后 ⇒ 未公布，不是暂停/不是失败）");
	{
		const e = engineAt(NOW_REAL);
		const s = e.__test.SOURCES.find((x) => x.id === "pengpeng");
		let got = "not-run", err = "";
		try { got = await e.__test.EVENT_FETCHERS["pengpeng"].default(s.eventUrl, undefined, s.tz); }
		catch (e2) { err = String((e2 && e2.message) || e2); }
		check("当前时刻（11-09）九月档期全部结束 ⇒ 返回 null（不硬凑过期活动）",
			got === null && err === "", err || JSON.stringify(got));
	}

	// ─────────────────────⑤ 反向证明 ─────────────────────
	section("夜幕之下 ⑤：反向证明（删掉「活动时间：」⇒ 解析空、抓取 null）");
	{
		const wt = PP.pengpengWikitextOf(JSON.parse(strippedOverview()));
		check("反证：wikitext 里没有「活动时间」行 ⇒ 活动解析返回空数组",
			PP.pengpengOverviewActivitiesOf(wt, TZ_CN).length === 0, String(PP.pengpengOverviewActivitiesOf(wt, TZ_CN).length));
		const e = engineAt(NOW_PP, [], strippedOverview());
		const s = e.__test.SOURCES.find((x) => x.id === "pengpeng");
		let got = "not-run";
		try { got = await e.__test.EVENT_FETCHERS["pengpeng"].default(s.eventUrl, undefined, s.tz); } catch { /* 返回 null 是预期 */ }
		check("反证：源站有页面但没有活动时间 ⇒ 抓取器如实返回 null（不是编一条）",
			got === null, JSON.stringify(got));
		check("反证：只写「将于X月X日结束」不构成窗口（不会拼出假档期）",
			PP.pengpengEventWindowsOf("活动时间：2026/9/10 版本更新后 - 2026/10/1 4:59 说明：将于9月20日结束", TZ_CN).length === 1
			&& PP.pengpengEventWindowsOf("说明：将于9月20日结束", TZ_CN).length === 0,
			String(PP.pengpengEventWindowsOf("说明：将于9月20日结束", TZ_CN).length));
	}
}
