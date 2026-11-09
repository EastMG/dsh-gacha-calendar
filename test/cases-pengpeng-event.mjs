// test/cases-pengpeng-event.mjs —— 夜幕之下：活动侧（**TapTap 官方 tab**，2026-11-10 换源）
//
// ── 本段守什么 ──
//   ① 注册：`pengpeng.eventUrl` = TapTap 官方 tab（`?type=official`）、`eventSource` = 「TapTap 官方（国服）」；
//      旧 bwiki `公告/` 降为 `eventAltSources`（标签仍如实写「wiki 数据滞后」）；卡池侧（契约一览）一个字没动；
//   ② 解析：官方 tab 每页 10 帖，两条真夹具（第 1 / 第 2 页）共 20 帖；活动名取标题里的【…】，
//      窗口取正文 `▸活动时间：…` 行；**只有日期没有年份的不解**（【家族遗藏】）；
//   ③ 当期（2026-11-10）：外显 = 列表里**第一条覆盖 now** 的（源站从新到旧 ⇒ 最新公布的当期活动）
//      = 新风同行 11-05 05:00 ~ 11-19 04:59；悬停 = 在期的两条（画廊夜游 10-29 ~ 11-12 在第 2 页）；
//   ④ 反向证明：删掉「活动时间：」⇒ 解析空、抓取 null；年份缺失 ⇒ 不是窗口；
//   ⑤ 第 2 页抓挂不影响第 1 页（当期仍在）；
//   ⑥ 旧 bwiki 源（altSources）仍能手动用：期内 now（09-15）照样出「彷徨往昔」。
//
// 夹具（均真抓；裁剪规则见各自 `response.txt.meta.json` 的 `trim`）：
//   · `pengpeng-taptap-official` / `pengpeng-taptap-official-p2`（TapTap 官方 tab 第 1/2 页）
//   · `pengpeng-announce-pages` + `pengpeng-overview-20260910`（旧 bwiki 源，回归用）
// 时间断言写绝对毫秒，UTC 与 +08 两道门禁同一份期望值。

import { createEngine } from "../packages/core/core.mjs";
import { check, section, assertHoverConvention } from "./harness.mjs";
import { readFileSync } from "node:fs";
import { T } from "./load.mjs";

const TZ_CN = "Asia/Shanghai";
const PP = T.parsers.pengpeng;
const fxText = (p) => readFileSync(new URL("./fixtures/" + p, import.meta.url), "utf8");

const B = {
	tt1: fxText("pengpeng-taptap-official/response.txt"),
	tt2: fxText("pengpeng-taptap-official-p2/response.txt"),
	pages: fxText("pengpeng-announce-pages/response.txt"),
	overview: fxText("pengpeng-overview-20260910/response.txt")
};
const TT2_URL = PP.PENGPENG_TAPTAP_URL + "&page=2";

// 2026-11-10（真机抓取时刻）：新风同行 11-05 ~ 11-19 在期；画廊夜游 10-29 ~ 11-12 也在期
const NOW_TT = Date.parse("2026-11-10T02:50:00+08:00");
// 旧 bwiki 源批内时刻（2026-09-15）：彷徨往昔 09-12 ~ 09-29 在期
const NOW_PP = Date.parse("2026-09-15T12:00:00+08:00");

function pickBody(url, overrideTt1) {
	const u = String(url).replace(/[?&]origin=\*/, "");
	if (u === PP.PENGPENG_TAPTAP_URL) return overrideTt1 != null ? overrideTt1 : B.tt1;
	// overrideTt1 用于反向证明：第 2 页也按同一规则剥掉「活动时间」行，否则第 2 页会照常出活动
	if (u === TT2_URL) return overrideTt1 != null ? B.tt2.split(/\r?\n/).filter((l) => l.indexOf("活动时间") < 0).join("\n") : B.tt2;
	if (u === PP.PENGPENG_EVENT_URL) return B.pages;
	if (/action=parse&page=.*&prop=wikitext/.test(u)) return B.overview;
	throw new Error("pengpeng 用例没有这个 URL 的夹具：" + u);
}

// failPage2：第 2 页抛（验证"翻页失败不影响第 1 页"）；overrideTt1：整页替换（反向证明用）
function makeTransport(overrideTt1, failPage2) {
	const rec = [];
	const t = {
		calls: rec,
		async fetchRaw(url) {
			rec.push(String(url));
			const body = pickBody(url, overrideTt1);
			return { ok: true, status: 200, headers: { get: () => null }, text: async () => body, json: async () => JSON.parse(body) };
		},
		async fetchViaProxy(url) {
			rec.push(String(url));
			if (failPage2 && String(url) === TT2_URL) throw new Error("http-500");
			return pickBody(url, overrideTt1);
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

// 把 TapTap 夹具里所有「活动时间」整行删掉（反向证明用）
function strippedTt1() {
	return B.tt1.split(/\r?\n/).filter((l) => l.indexOf("活动时间") < 0).join("\n");
}

export default async function runPengpengEvent() {
	// ─────────────────────① 注册 ─────────────────────
	section("夜幕之下 ①：活动侧注册（默认 TapTap 官方 tab；bwiki 降为备选；卡池侧不动）");
	{
		const s = T.SOURCES.find((x) => x.id === "pengpeng") || null;
		check("pengpeng eventUrl = TapTap 官方 tab（type=official）",
			!!s && s.eventUrl === PP.PENGPENG_TAPTAP_URL && /type=official/.test(String(s.eventUrl)),
			s ? String(s.eventUrl) : "缺失");
		check("pengpeng 活动来源标签 = 「TapTap 官方（国服）」",
			!!s && s.eventSource === "TapTap 官方（国服）", s ? String(s.eventSource) : "缺失");
		check("pengpeng 卡池侧仍是 bwiki 契约一览（卡池不动）",
			!!s && /action=parse&page=契约一览/.test(String(s.url)) && s.source === "Bwiki",
			s ? String(s.url) : "缺失");
		check("旧 bwiki 活动源保留在 eventAltSources（url + 抓取器键 pengpeng-bwiki + 标签如实）",
			!!s && (s.eventAltSources || []).length === 1
			&& s.eventAltSources[0].url === PP.PENGPENG_EVENT_URL
			&& s.eventAltSources[0].fetcher === "pengpeng-bwiki"
			&& /wiki 数据滞后/.test(String(s.eventAltSources[0].label))
			&& typeof (T.EVENT_FETCHERS["pengpeng"] || {})["pengpeng-bwiki"] === "function",
			s ? JSON.stringify(s.eventAltSources) : "缺失");
		check("默认活动抓取器仍是 EVENT_FETCHERS.pengpeng.default（不是备选键）",
			typeof (T.EVENT_FETCHERS["pengpeng"] || {}).default === "function");
		check("翻页页数 = 2（每页 10 帖；第 2 页能捞到仍在期的旧公告）", PP.PENGPENG_TAPTAP_PAGES === 2, String(PP.PENGPENG_TAPTAP_PAGES));
	}

	// ─────────────────────② TapTap 列表 → 活动事实 ─────────────────────
	section("夜幕之下 ②：TapTap 官方 tab 解析（20 帖 / 活动名取【…】/ 只认「活动时间：」）");
	{
		const posts1 = PP.pengpengTaptapPostsOf(B.tt1);
		const posts2 = PP.pengpengTaptapPostsOf(B.tt2);
		check("第 1 / 第 2 页各解析出 10 帖", posts1.length === 10 && posts2.length === 10, JSON.stringify([posts1.length, posts2.length]));
		check("帖子带 title / url（url 绝对化到 www.taptap.cn/moment/…）",
			posts1.every((p) => p.title && /^https:\/\/www\.taptap\.cn\/moment\/\d+/.test(p.url)),
			JSON.stringify(posts1[0]));
		check("正文里含「活动时间：」的帖：第 1 页 1 条（新风同行）、第 2 页 2 条（家族遗藏 + 画廊夜游）",
			posts1.filter((p) => /活动时间\s*[:：]/.test(p.text)).length === 1
			&& posts2.filter((p) => /活动时间\s*[:：]/.test(p.text)).length === 2,
			JSON.stringify([posts1.filter((p) => /活动时间/.test(p.text)).map((p) => p.title), posts2.filter((p) => /活动时间/.test(p.text)).map((p) => p.title)]));

		const a1 = PP.pengpengTaptapActivitiesOf(B.tt1, TZ_CN);
		const a2 = PP.pengpengTaptapActivitiesOf(B.tt2, TZ_CN);
		check("第 1 页活动 = 新风同行（标题【新风同行】去壳）+ 源站原文档期",
			a1.length === 1 && a1[0].name === "新风同行"
			&& a1[0].raw === "2026年11月5日 05:00 ~ 2026年11月19日 04:59"
			&& a1[0].display === "11-05 05:00 ~ 11-19 04:59",
			JSON.stringify(a1));
		check("第 2 页活动只剩画廊夜游：同一页的【家族遗藏】`10月29日 5:00 - 11月12日 04:59` **没有年份 ⇒ 不解**",
			a2.length === 1 && a2[0].name === "画廊夜游"
			&& a2[0].raw === "2026年10月29日 05:00 ~ 2026年11月12日 04:59",
			JSON.stringify(a2.map((x) => [x.name, x.raw])));
		check("活动名取标题里的【…】；没有【】⇒ 整条标题（不改写、不补字）",
			PP.pengpengTaptapNameOf("🍃【新风同行】限时活动 即将开启") === "新风同行"
			&& PP.pengpengTaptapNameOf("《夜幕之下》活动版本PV：羊群安息处") === "《夜幕之下》活动版本PV：羊群安息处",
			PP.pengpengTaptapNameOf("🍃【新风同行】限时活动 即将开启"));
	}

	// ─────────────────────③ 当期外显 ─────────────────────
	section("夜幕之下 ③：当期（2026-11-10）外显 = 新风同行；悬停含仍在期的画廊夜游");
	let event = null;
	{
		const tr = makeTransport();
		const e = engineAt(NOW_TT, tr);
		const s = e.__test.SOURCES.find((x) => x.id === "pengpeng");
		event = await e.__test.EVENT_FETCHERS["pengpeng"].default(s.eventUrl, undefined, s.tz);
		check("pengpeng 活动抓取器返回对象", !!event && typeof event === "object");
		check("外显活动名 = 新风同行（文档顺序里第一条覆盖 now 的）",
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
		check("悬停逐字（2 行，按结束时间升序：画廊夜游 11-12 在前，新风同行 11-19 在后）",
			event && event.eventHover === "画廊夜游   10-29 05:00 ~ 11-12 04:59\n新风同行   11-05 05:00 ~ 11-19 04:59",
			JSON.stringify(event && event.eventHover));
		check("`events[]` 共 2 条：画廊夜游（hover 并列）+ 新风同行（primary）",
			!!event && Array.isArray(event.events) && event.events.length === 2
			&& event.events.filter((x) => x.source === "primary").map((x) => x.title).join(",") === "新风同行",
			JSON.stringify(event && event.events.map((x) => [x.title, x.source])));
		if (event && event.eventHover) assertHoverConvention("pengpeng 活动", event.eventHover, { requireSet: true });
		check("一次刷新只发 2 个请求（官方 tab 第 1 / 第 2 页，各 1 次）",
			tr.calls.length === 2 && tr.calls[0] === PP.PENGPENG_TAPTAP_URL && tr.calls[1] === TT2_URL,
			JSON.stringify(tr.calls.map((u) => u.slice(0, 70))));
	}

	// ─────────────────────④ 反向证明 ─────────────────────
	section("夜幕之下 ④：反向证明（删掉「活动时间：」⇒ 解析空 / 抓取 null；无年份不是窗口）");
	{
		const noLabel = strippedTt1();
		check("反证：把第 1 页的「活动时间」行整行删掉 ⇒ 活动解析返回空数组",
			PP.pengpengTaptapActivitiesOf(noLabel, TZ_CN).length === 0,
			String(PP.pengpengTaptapActivitiesOf(noLabel, TZ_CN).length));
		check("反证：窗口两端缺年份（`10月29日 5:00 - 11月12日 04:59`）⇒ 不是窗口（不猜当前年）",
			PP.pengpengTaptapWindowsOf("▸活动时间：10月29日 5:00 - 11月12日 04:59", TZ_CN).length === 0,
			JSON.stringify(PP.pengpengTaptapWindowsOf("▸活动时间：10月29日 5:00 - 11月12日 04:59", TZ_CN)));
		check("反证：起点「版本更新后」⇒ startTs 必须是 null（不许猜钟点）",
			(() => {
				const w = PP.pengpengTaptapWindowsOf("▸活动时间：2026年10月22日版本更新后 - 2026年12月3日 04:59", TZ_CN);
				return w.length === 1 && w[0].startTs === null && w[0].display === "10-22 版本更新后 ~ 12-03 04:59";
			})(),
			JSON.stringify(PP.pengpengTaptapWindowsOf("▸活动时间：2026年10月22日版本更新后 - 2026年12月3日 04:59", TZ_CN)));
		const tr = makeTransport(noLabel);
		const e = engineAt(NOW_TT, tr);
		const s = e.__test.SOURCES.find((x) => x.id === "pengpeng");
		let got = "not-run";
		try { got = await e.__test.EVENT_FETCHERS["pengpeng"].default(s.eventUrl, undefined, s.tz); } catch { /* null 是预期 */ }
		check("反证：源站有帖子但没有任何活动时间 ⇒ 抓取器如实返回 null（不是编一条）", got === null, JSON.stringify(got));
	}

	// ─────────────────────⑤ 翻页失败隔离 ─────────────────────
	section("夜幕之下 ⑤：第 2 页抓挂不影响第 1 页（当期仍在）");
	{
		const tr = makeTransport(null, true);
		const e = engineAt(NOW_TT, tr);
		const s = e.__test.SOURCES.find((x) => x.id === "pengpeng");
		const got = await e.__test.EVENT_FETCHERS["pengpeng"].default(s.eventUrl, undefined, s.tz);
		check("第 2 页 500 ⇒ 仍是新风同行（第 1 页结果照常产出）",
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
}
