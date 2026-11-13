// test/cases-pengpeng-event.mjs —— 夜幕之下：活动侧（**TapTap tab 的 feed JSON**，2026-11-11 换源）
//
// ── 本段守什么 ──
//   ① 注册：`pengpeng.eventUrl` = `webapiv2/feed/v7/by-group`（type=official / group_id=924367 / from=0）、
//      `eventSource` = 「TapTap」；旧 bwiki `公告/` 降为 `eventAltSources`（标签仍如实写「不可靠」）；
//      卡池侧 2026-11-11 **换了方法**（HTML 表 → bwiki SMW `action=ask`），`source` 标签随之改成
//      「Bwiki」；本段的注册断言只钉这两点（卡池解析的逐字断言在 cases-new5 ④）；
//   ② 解析：三页真夹具（`from=0/10/20`）各 10 帖；活动名取标题里的【…】，窗口取 `topic.summary` 里
//      `▸活动时间：…` 那一行；**只有日期没有年份的不解**（【家族遗藏】两期都是）；
//   ③ 当期（2026-11-11 00:00 +08，= 活网验收时刻）：外显 = 列表里**第一条覆盖 now** 的
//      = 新风同行 11-05 05:00 ~ 11-19 04:59；悬停 = 在期的两条（画廊夜游 10-29 ~ 11-12 在 `from=10`）；
//   ④ 反向证明：删掉「活动时间：」⇒ 解析空、抓取 null；年份缺失 ⇒ 不是窗口；`data.list` 缺失 ⇒ 抛错
//      （抓取失败 ≠ 未公布）；列表为空 ⇒ 抛 `no-post`；
//   ⑤ 第 2 页抓挂不影响第 1 页（当期仍在）；
//   ⑥ 旧 bwiki 源（altSources）仍能手动用：期内 now（09-15）照样出「彷徨往昔」；
//   ⑦ 翻页策略：整页活动都已结束 ⇒ 第 1 页就停（只发 1 个请求），不无限翻。
//
// 夹具（均真抓；字段裁剪见各自 `response.txt.meta.json` 的 `trim`）：
//   · `pengpeng-taptap-feed-p1` / `-p2` / `-p3`（`from=0/10/20`，2026-11-11 抓）
//   · `pengpeng-announce-pages` + `pengpeng-overview-20260910`（旧 bwiki 源，回归用）
// 时间断言写绝对毫秒，UTC 与 +08 两道门禁同一份期望值。

import { createEngine } from "../packages/core/core.mjs";
import { check, section, assertHoverConvention } from "./harness.mjs";
import { readFileSync } from "node:fs";
import { T } from "./load.mjs";

const TZ_CN = "Asia/Shanghai";
const PP = T.parsers.pengpeng;
const fxText = (p) => readFileSync(new URL("./fixtures/" + p, import.meta.url), "utf8");
const fxJson = (p) => JSON.parse(fxText(p));

const B = {
	f1: fxText("pengpeng-taptap-feed-p1/response.txt"),
	f2: fxText("pengpeng-taptap-feed-p2/response.txt"),
	f3: fxText("pengpeng-taptap-feed-p3/response.txt"),
	pages: fxText("pengpeng-announce-pages/response.txt"),
	overview: fxText("pengpeng-overview-20260910/response.txt")
};
const J1 = JSON.parse(B.f1), J2 = JSON.parse(B.f2), J3 = JSON.parse(B.f3);

const U1 = PP.pengpengTaptapApiUrl(0);
const U2 = PP.pengpengTaptapApiUrl(10);
const U3 = PP.pengpengTaptapApiUrl(20);

// 2026-11-11 00:00 +08（= 活网验收时刻）：新风同行 11-05 ~ 11-19 在期；画廊夜游 10-29 ~ 11-12 也在期
const NOW_LIVE = Date.parse("2026-11-11T00:00:00+08:00");
// 旧 bwiki 源批内时刻（2026-09-15）：彷徨往昔 09-12 ~ 09-29 在期
const NOW_PP = Date.parse("2026-09-15T12:00:00+08:00");

// HTML 夹具里**没有**的东西现在都在 JSON 里了；这里只做「URL → 响应体」的映射，
// overrides 用于反向证明（整页替换），failUrls 用于「第 N 页抓挂」。
function makeTransport(overrides, failUrls) {
	const ov = overrides || {};
	const bad = new Set(failUrls || []);
	const rec = [];
	const bodyOf = (url) => {
		const u = String(url).replace(/[?&]origin=\*/, "");
		if (ov[u] != null) return ov[u];
		if (u === U1) return B.f1;
		if (u === U2) return B.f2;
		if (u === U3) return B.f3;
		if (u === PP.PENGPENG_EVENT_URL) return B.pages;
		if (/action=parse&page=.*&prop=wikitext/.test(u)) return B.overview;
		throw new Error("pengpeng 用例没有这个 URL 的夹具：" + u);
	};
	const t = {
		calls: rec,
		async fetchRaw(url) {
			rec.push(String(url));
			const body = bodyOf(url);
			return { ok: true, status: 200, headers: { get: () => null }, text: async () => body, json: async () => JSON.parse(body) };
		},
		async fetchViaProxy(url) {
			rec.push(String(url));
			if (bad.has(String(url))) throw new Error("http-500");
			return bodyOf(url);
		}
	};
	return t;
}
const makeStore = () => {
	const m = new Map();
	return { map: m, async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
};
const engineAt = (now, transport) => createEngine({
	transport,
	storage: makeStore(),
	now: () => now,
	timer: { setTimeout, clearTimeout }
});

// ── 夹具改写工具（都在**真实响应**上动刀，不手搓 JSON 形状）────────────────────────
// 把第 1 页里「新风同行」那条的活动区间换成**已经结束**的（反证翻页早停 / 无在期活动）
function page1WithEndedWindow() {
	const j = JSON.parse(B.f1);
	for (const it of j.data.list) {
		const t = it.moment && it.moment.topic;
		if (!t || !/活动时间\s*[:：]/.test(String(t.summary))) continue;
		t.summary = String(t.summary).replace(
			/▸活动时间：[^\n]*/,
			"▸活动时间：2026年9月1日 05:00 - 2026年9月2日 04:59"
		);
	}
	return JSON.stringify(j, null, 2);
}
// 整页删掉「活动时间」行（反证：有帖子没有区间 ⇒ 解析空 / 抓取 null）
function pageWithoutActivityLine(text) {
	return JSON.stringify((() => {
		const j = JSON.parse(text);
		for (const it of j.data.list) {
			const t = it.moment && it.moment.topic;
			if (!t) continue;
			t.summary = String(t.summary).split(/\r?\n/).filter((l) => !/活动时间\s*[:：]/.test(l)).join("\n");
		}
		return j;
	})(), null, 2);
}
// 把整份响应改成"没有 data.list"（反证：结构变了 ⇒ 抛错，不是 null）
function brokenShape(text) {
	const j = JSON.parse(text);
	delete j.data;
	return JSON.stringify(j, null, 2);
}

export default async function runPengpengEvent() {
	// ─────────────────────① 注册 ─────────────────────
	section("夜幕之下 ①：活动侧注册（默认 TapTap feed JSON；bwiki 降为备选；卡池标签写明停更）");
	{
		const s = T.SOURCES.find((x) => x.id === "pengpeng") || null;
		check("pengpeng eventUrl = TapTap `webapiv2/feed/v7/by-group`（type=official / group_id=924367 / from=0）",
			!!s && s.eventUrl === PP.pengpengTaptapApiUrl(0)
			&& /\/webapiv2\/feed\/v7\/by-group\?/.test(String(s.eventUrl))
			&& /[?&]type=official/.test(String(s.eventUrl))
			&& /[?&]group_id=924367/.test(String(s.eventUrl))
			&& /[?&]from=0$/.test(String(s.eventUrl)),
			s ? String(s.eventUrl) : "缺失");
		check("pengpeng eventUrl 带 X-UA（缺了源站回 400 INVALID_XUA）",
			!!s && /[?&]X-UA=V%3D1%26PN%3DWebApp%26/.test(String(s.eventUrl)),
			s ? String(s.eventUrl).slice(0, 90) : "缺失");
		check("pengpeng 活动来源标签 = 「TapTap」（换源不改标签）",
			!!s && s.eventSource === "TapTap", s ? String(s.eventSource) : "缺失");
		check("pengpeng 卡池侧地址 = bwiki **SMW ask**（2026-11-11 换源：`契约一览` 已 #REDIRECT 到 `契约图鉴`，抓 HTML 永远空表）",
			!!s && /^https:\/\/wiki\.biligame\.com\/ymzx\/api\.php\?action=ask/.test(String(s.url))
			&& /%E5%A5%91%E7%BA%A6/.test(String(s.url)),
			s ? String(s.url) : "缺失");
		check("pengpeng 卡池侧 `source` 标签 = 「Bwiki」",
			!!s && s.source === "Bwiki", s ? String(s.source) : "缺失");
		check("旧 bwiki 活动源保留在 eventAltSources（url + 抓取器键 pengpeng-bwiki + 标签如实）",
			!!s && (s.eventAltSources || []).length === 1
			&& s.eventAltSources[0].url === PP.PENGPENG_EVENT_URL
			&& s.eventAltSources[0].fetcher === "pengpeng-bwiki"
			&& /不可靠/.test(String(s.eventAltSources[0].label))
			&& typeof (T.EVENT_FETCHERS["pengpeng"] || {})["pengpeng-bwiki"] === "function",
			s ? JSON.stringify(s.eventAltSources) : "缺失");
		check("默认活动抓取器仍是 EVENT_FETCHERS.pengpeng.default（不是备选键）",
			typeof (T.EVENT_FETCHERS["pengpeng"] || {}).default === "function");
		check("翻页上限 = 3 页（每页 10 帖；第 2 页能捞到仍在期的旧公告）", PP.PENGPENG_TAPTAP_MAX_PAGES === 3, String(PP.PENGPENG_TAPTAP_MAX_PAGES));
		check("页码 → `from` 偏移（第 1/2/3 页 = 0 / 10 / 20，不是 `&page=`）",
			PP.pengpengTaptapPageUrl(U1, 1) === U1
			&& /[?&]from=10$/.test(PP.pengpengTaptapPageUrl(U1, 2))
			&& /[?&]from=20$/.test(PP.pengpengTaptapPageUrl(U1, 3)),
			JSON.stringify([PP.pengpengTaptapPageUrl(U1, 1).slice(-8), PP.pengpengTaptapPageUrl(U1, 2).slice(-8), PP.pengpengTaptapPageUrl(U1, 3).slice(-8)]));
	}

	// ─────────────────────② JSON → 活动事实 ─────────────────────
	section("夜幕之下 ②：feed JSON 解析（30 帖 / 活动名取【…】/ 只认「活动时间：」/ 无年份不解）");
	{
		const posts1 = PP.pengpengTaptapPostsOf(J1);
		const posts2 = PP.pengpengTaptapPostsOf(J2);
		const posts3 = PP.pengpengTaptapPostsOf(J3);
		check("三页各解析出 10 帖", posts1.length === 10 && posts2.length === 10 && posts3.length === 10,
			JSON.stringify([posts1.length, posts2.length, posts3.length]));
		check("帖子带 title / url（url 绝对化到 www.taptap.cn/moment/…）+ 纯文本正文",
			posts1.every((p) => p.title && /^https:\/\/www\.taptap\.cn\/moment\/\d+$/.test(p.url) && typeof p.text === "string")
			&& posts1[0].url === "https://www.taptap.cn/moment/868455478294743319"
			&& posts1[0].title === "【无罪之国·下】版本活动一览",
			JSON.stringify([posts1[0].url, posts1[0].title]));
		check("正文含「活动时间：」的帖：第 1 页 1 条（新风同行）、第 2 页 2 条（家族遗藏 + 画廊夜游）、第 3 页 1 条（家族遗藏）",
			posts1.filter((p) => /活动时间\s*[:：]/.test(p.text)).length === 1
			&& posts2.filter((p) => /活动时间\s*[:：]/.test(p.text)).length === 2
			&& posts3.filter((p) => /活动时间\s*[:：]/.test(p.text)).length === 1,
			JSON.stringify([posts1.filter((p) => /活动时间/.test(p.text)).map((p) => p.title),
				posts2.filter((p) => /活动时间/.test(p.text)).map((p) => p.title),
				posts3.filter((p) => /活动时间/.test(p.text)).map((p) => p.title)]));

		const a1 = PP.pengpengTaptapActivitiesOf(posts1, TZ_CN);
		const a2 = PP.pengpengTaptapActivitiesOf(posts2, TZ_CN);
		const a3 = PP.pengpengTaptapActivitiesOf(posts3, TZ_CN);
		check("第 1 页活动 = 新风同行（标题【新风同行】去壳）+ 源站原文档期",
			a1.length === 1 && a1[0].name === "新风同行"
			&& a1[0].raw === "2026年11月5日 05:00 ~ 2026年11月19日 04:59"
			&& a1[0].display === "11-05 05:00 ~ 11-19 04:59",
			JSON.stringify(a1));
		check("第 2 页活动只剩画廊夜游：同一页的【家族遗藏】`10月29日 5:00 - 11月12日 04:59` **没有年份 ⇒ 不解**",
			a2.length === 1 && a2[0].name === "画廊夜游"
			&& a2[0].raw === "2026年10月29日 05:00 ~ 2026年11月12日 04:59",
			JSON.stringify(a2.map((x) => [x.name, x.raw])));
		check("第 3 页唯一一条也**没有年份**（`10月8日 5:00 - 10月22日 04:59`）⇒ 整页 0 条",
			a3.length === 0, JSON.stringify(a3));
		check("活动名取标题里的【…】；没有【】⇒ 整条标题（不改写、不补字）",
			PP.pengpengTaptapNameOf("🍃【新风同行】限时活动 即将开启") === "新风同行"
			&& PP.pengpengTaptapNameOf("《夜幕之下》活动版本PV：羊群安息处") === "《夜幕之下》活动版本PV：羊群安息处",
			PP.pengpengTaptapNameOf("🍃【新风同行】限时活动 即将开启"));
	}

	// ─────────────────────③ 当期外显（活网验收时刻） ─────────────────────
	section("夜幕之下 ③：当期（2026-11-11）外显 = 新风同行 11-05 05:00 ~ 11-19 04:59；悬停含仍在期的画廊夜游");
	let event = null;
	{
		const tr = makeTransport();
		const e = engineAt(NOW_LIVE, tr);
		const s = e.__test.SOURCES.find((x) => x.id === "pengpeng");
		event = await e.__test.EVENT_FETCHERS["pengpeng"].default(s.eventUrl, undefined, s.tz);
		check("pengpeng 活动抓取器返回对象", !!event && typeof event === "object");
		check("外显活动名 = 新风同行（数组顺序里第一条覆盖 now 的）",
			event && event.event === "新风同行", JSON.stringify(event && event.event));
		check("外显档期 = 「11-05 05:00 ~ 11-19 04:59」（补全文本）",
			event && event.eventDates === "11-05 05:00 ~ 11-19 04:59", JSON.stringify(event && event.eventDates));
		check("源站原文 = 「2026年11月5日 05:00 ~ 2026年11月19日 04:59」（raw 与 display 分开）",
			event && event.eventDatesRaw === "2026年11月5日 05:00 ~ 2026年11月19日 04:59", JSON.stringify(event && event.eventDatesRaw));
		check("startTs = 2026-11-05 05:00 +08（UTC 11-04 21:00）",
			!!event && (event.events.find((x) => x.title === "新风同行") || {}).startTs === Date.UTC(2026, 10, 4, 21, 0),
			JSON.stringify(event && event.events && event.events.map((x) => [x.title, x.startTs])));
		check("endTs = 2026-11-19 04:59 +08（UTC 11-18 20:59）",
			!!event && (event.events.find((x) => x.title === "新风同行") || {}).endTs === Date.UTC(2026, 10, 18, 20, 59),
			JSON.stringify(event && event.events && event.events.map((x) => [x.title, x.endTs])));
		check("画廊夜游 startTs / endTs = 2026-10-29 05:00 / 2026-11-12 04:59 +08",
			!!event && (event.events.find((x) => x.title === "画廊夜游") || {}).startTs === Date.UTC(2026, 9, 28, 21, 0)
			&& (event.events.find((x) => x.title === "画廊夜游") || {}).endTs === Date.UTC(2026, 10, 11, 20, 59),
			JSON.stringify(event && event.events && event.events.map((x) => [x.title, x.startTs, x.endTs])));
		check("悬停逐字（2 行，按结束时间升序：画廊夜游 11-12 在前，新风同行 11-19 在后）",
			event && event.eventHover === "画廊夜游   10-29 05:00 ~ 11-12 04:59\n新风同行   11-05 05:00 ~ 11-19 04:59",
			JSON.stringify(event && event.eventHover));
		check("`events[]` 共 2 条：画廊夜游（hover 并列）+ 新风同行（primary）",
			!!event && Array.isArray(event.events) && event.events.length === 2
			&& event.events.filter((x) => x.source === "primary").map((x) => x.title).join(",") === "新风同行",
			JSON.stringify(event && event.events.map((x) => [x.title, x.source])));
		if (event && event.eventHover) assertHoverConvention("pengpeng 活动", event.eventHover, { requireSet: true });
		check("一次刷新发 3 个请求（from=0 / 10 / 20，各 1 次）",
			tr.calls.length === 3 && tr.calls[0] === U1 && tr.calls[1] === U2 && tr.calls[2] === U3,
			JSON.stringify(tr.calls.map((u) => u.slice(-12))));
	}

	// ─────────────────────④ 反向证明 ─────────────────────
	section("夜幕之下 ④：反向证明（删「活动时间：」⇒ 空/null；无年份不是窗口；结构变 ⇒ 抛错）");
	{
		// (a) 整页删掉「活动时间」行 ⇒ 解析空
		const noLine1 = pageWithoutActivityLine(B.f1);
		const postsNoLine = PP.pengpengTaptapPostsOf(JSON.parse(noLine1));
		check("反证：第 1 页整行删掉「活动时间：…」⇒ 活动解析返回空数组（帖子还在 10 条）",
			postsNoLine.length === 10 && PP.pengpengTaptapActivitiesOf(postsNoLine, TZ_CN).length === 0,
			JSON.stringify([postsNoLine.length, PP.pengpengTaptapActivitiesOf(postsNoLine, TZ_CN).length]));

		// (b) 三页全删 ⇒ 抓取器如实 null（不编一条）
		const tr = makeTransport({
			[U1]: noLine1,
			[U2]: pageWithoutActivityLine(B.f2),
			[U3]: pageWithoutActivityLine(B.f3)
		});
		const e = engineAt(NOW_LIVE, tr);
		const s = e.__test.SOURCES.find((x) => x.id === "pengpeng");
		let got = "not-run";
		try { got = await e.__test.EVENT_FETCHERS["pengpeng"].default(s.eventUrl, undefined, s.tz); } catch (err) { got = "throw:" + err.message; }
		check("反证：源站有 30 帖但没有任何活动时间 ⇒ 抓取器如实返回 null（不是编一条）", got === null, JSON.stringify(got));
		check("反证：上面那一次仍然翻满了 3 页（没有活动 ≠ 提前停）", tr.calls.length === 3, String(tr.calls.length));

		// (c) 无年份 / 相对起点 —— 直接打区间解析函数
		check("反证：窗口两端缺年份（`10月29日 5:00 - 11月12日 04:59`）⇒ 不是窗口（不猜当前年）",
			PP.pengpengTaptapWindowsOf("▸活动时间：10月29日 5:00 - 11月12日 04:59", TZ_CN).length === 0,
			JSON.stringify(PP.pengpengTaptapWindowsOf("▸活动时间：10月29日 5:00 - 11月12日 04:59", TZ_CN)));
		check("反证：起点「版本更新后」⇒ startTs 必须是 null（不许猜钟点）",
			(() => {
				const w = PP.pengpengTaptapWindowsOf("▸活动时间：2026年10月22日版本更新后 - 2026年12月3日 04:59", TZ_CN);
				return w.length === 1 && w[0].startTs === null && w[0].display === "10-22 版本更新后 ~ 12-03 04:59";
			})(),
			JSON.stringify(PP.pengpengTaptapWindowsOf("▸活动时间：2026年10月22日版本更新后 - 2026年12月3日 04:59", TZ_CN)));

		// (d) 结构变了 ⇒ 抛错（抓取失败 ≠ 未公布）
		const trBad = makeTransport({ [U1]: brokenShape(B.f1) });
		const eBad = engineAt(NOW_LIVE, trBad);
		const sBad = eBad.__test.SOURCES.find((x) => x.id === "pengpeng");
		let errMsg = "not-run";
		try { await eBad.__test.EVENT_FETCHERS["pengpeng"].default(sBad.eventUrl, undefined, sBad.tz); } catch (err) { errMsg = err.message; }
		check("反证：响应里没有 `data` ⇒ 抛 pengpeng-bad-shape（抓取失败 ≠ 未公布）", errMsg === "pengpeng-bad-shape", errMsg);

		// (e) 空列表 ⇒ 抛 no-post（三页都空才算「一帖都没解析出来」）
		const emptyList = JSON.stringify({ data: { list: [] }, success: true });
		const trEmpty = makeTransport({ [U1]: emptyList, [U2]: emptyList, [U3]: emptyList });
		const eEmpty = engineAt(NOW_LIVE, trEmpty);
		const sEmpty = eEmpty.__test.SOURCES.find((x) => x.id === "pengpeng");
		let errEmpty = "not-run";
		try { await eEmpty.__test.EVENT_FETCHERS["pengpeng"].default(sEmpty.eventUrl, undefined, sEmpty.tz); } catch (err) { errEmpty = err.message; }
		check("反证：列表为空（一帖都没解析出来）⇒ 抛 pengpeng-taptap:no-post", errEmpty === "pengpeng-taptap:no-post", errEmpty);
	}

	// ─────────────────────⑤ 翻页失败隔离 ─────────────────────
	section("夜幕之下 ⑤：第 2 页抓挂不影响第 1 页（当期仍在）");
	{
		const tr = makeTransport(null, [U2]);
		const e = engineAt(NOW_LIVE, tr);
		const s = e.__test.SOURCES.find((x) => x.id === "pengpeng");
		const got = await e.__test.EVENT_FETCHERS["pengpeng"].default(s.eventUrl, undefined, s.tz);
		check("第 2 页 500 ⇒ 仍是新风同行（第 1 页结果照常产出；只剩一条时没有悬停）",
			got && got.event === "新风同行" && got.eventHover === void 0,
			JSON.stringify(got && [got.event, got.eventHover]));
	}

	// ─────────────────────⑥ 旧 bwiki 源（备选）仍可用 ─────────────────────
	section("夜幕之下 ⑥：旧 bwiki 源（eventAltSources）仍能手动切回并出数据");
	{
		const tr = makeTransport();
		const e = engineAt(NOW_PP, tr);
		const s = e.__test.SOURCES.find((x) => x.id === "pengpeng");
		const alt = (s.eventAltSources || [])[0];
		const got = await e.__test.EVENT_FETCHERS["pengpeng"][alt.fetcher](alt.url, undefined, s.tz);
		check("备选源（bwiki 公告/）在批内 now（09-15）出「彷徨往昔」09-12 05:00 ~ 09-29 04:59",
			got && got.event === "彷徨往昔" && got.eventDates === "09-12 05:00 ~ 09-29 04:59"
			&& got.eventDatesRaw === "2026/9/12 5:00 ~ 2026/9/29 4:59",
			JSON.stringify(got && [got.event, got.eventDates, got.eventDatesRaw]));
	}

	// ─────────────────────⑦ 翻页策略：早停 ─────────────────────
	section("夜幕之下 ⑦：翻页策略（整页活动都已结束 ⇒ 第 1 页就停，只发 1 个请求）");
	{
		const tr = makeTransport({ [U1]: page1WithEndedWindow() });
		const e = engineAt(NOW_LIVE, tr);
		const s = e.__test.SOURCES.find((x) => x.id === "pengpeng");
		const got = await e.__test.EVENT_FETCHERS["pengpeng"].default(s.eventUrl, undefined, s.tz);
		check("第 1 页那条活动是**已结束**的（09-01 ~ 09-02）⇒ 抓取器只发 1 个请求就收手",
			tr.calls.length === 1 && tr.calls[0] === U1, JSON.stringify(tr.calls.map((u) => u.slice(-8))));
		check("…并且如实返回 null（没有在期活动就不编）", got === null, JSON.stringify(got));
	}
}
