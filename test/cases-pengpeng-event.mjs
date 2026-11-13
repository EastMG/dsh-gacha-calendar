// test/cases-pengpeng-event.mjs —— 夜幕之下：活动侧（**TapTap 官方 tab 页的 SSR**，2026-11-13 换源）
//
// ── 本段守什么 ──
//   ① 注册：`pengpeng.eventUrl` = `https://www.taptap.cn/app/746164/topic?type=official`
//      （**允许路径的 tab 页**，不再是 `webapiv2` —— robots.txt 明确 Disallow 那两条接口），
//      `eventSource` 仍是「TapTap」（用户可见标签不改）；旧 bwiki `公告/` 仍是 `eventAltSources`；
//      卡池侧（bwiki SMW `action=ask`）本批**不动**；
//   ② 解析：两页真夹具（`?page=1` / `?page=2`）各 10 帖；标题 + `topic.summary` 的纯文本行；
//      活动名取标题里的【…】，窗口取 `▸活动时间：…` 那一行；**只有日期没有年份的不解**（【家族遗藏】）；
//   ③ 当期（2026-11-11 00:00 +08）：第 1 页就覆盖当前窗口 ⇒ **只发 1 个请求**；
//      外显 = 新风同行 11-05 05:00 ~ 11-19 04:59；
//   ④ 反向证明：删掉「活动时间：」⇒ 解析空、抓取 null；无年份 ⇒ 不是窗口；`__NUXT_DATA__` 缺失 /
//      SSR 里没有帖子列表 ⇒ 抛错（抓取失败 ≠ 未公布）；
//   ⑤ 第 2 页抓挂不影响第 1 页（如实 null，不抛错）；
//   ⑥ 旧 bwiki 源（altSources）仍能手动用：期内 now（09-15）照样出「彷徨往昔」；
//   ⑦ 翻页策略：第 1 页覆盖不到当前窗口（10-30）才翻第 2 页 ⇒ 画廊夜游，2 个请求。
//
// 夹具（均真抓；`response.txt.meta.json` 记 url / capturedAt / trim）：
//   · `pengpeng-taptap-topic-p1` / `-p2`（2026-11-13 抓；只留 `<script id="__NUXT_DATA__">` 段）
//   · `pengpeng-announce-pages` + `pengpeng-overview-20260910`（旧 bwiki 源，回归用）
// 时间断言写绝对毫秒，UTC 与 +08 两道门禁同一份期望值。

import { createEngine } from "../packages/core/core.mjs";
import { check, section, assertHoverConvention } from "./harness.mjs";
import { readFileSync } from "node:fs";
import { T } from "./load.mjs";

const TZ_CN = "Asia/Shanghai";
const PP = T.parsers.pengpeng;
const TT = T.parsers["taptap-topic"];
const fxText = (p) => readFileSync(new URL("./fixtures/" + p, import.meta.url), "utf8");

const B = {
	t1: fxText("pengpeng-taptap-topic-p1/response.txt"),
	t2: fxText("pengpeng-taptap-topic-p2/response.txt"),
	pages: fxText("pengpeng-announce-pages/response.txt"),
	overview: fxText("pengpeng-overview-20260910/response.txt")
};

const TOPIC1 = PP.PENGPENG_TAPTAP_PAGE_URL;
const TOPIC2 = PP.pengpengTaptapPageUrl(TOPIC1, 2);

// 2026-11-11 00:00 +08（= 活网验收时刻）：新风同行 11-05 ~ 11-19 在期
const NOW_LIVE = Date.parse("2026-11-11T00:00:00+08:00");
// 2026-10-30 00:00 +08：第 1 页没有在期活动（画廊夜游在第 2 页，10-29 ~ 11-12）
const NOW_OLS = Date.parse("2026-10-30T00:00:00+08:00");
// 旧 bwiki 源批内时刻（2026-09-15）：彷徨往昔 09-12 ~ 09-29 在期
const NOW_PP = Date.parse("2026-09-15T12:00:00+08:00");

// URL → 响应体映射；`overrides` 用于反向证明（整页替换），`failUrls` 用于「第 N 页抓挂」。
// `calls` 记下每次代理请求的 { url, referer }（tab 页无 ACAO ⇒ 必须走宿主代理 + Referer）。
function makeTransport(overrides, failUrls) {
	const ov = overrides || {};
	const bad = new Set(failUrls || []);
	const rec = [];
	const bodyOf = (url) => {
		const u = String(url).replace(/[?&]origin=\*/, "");
		if (ov[u] != null) return ov[u];
		if (u === TOPIC1) return B.t1;
		if (u === TOPIC2) return B.t2;
		if (u === PP.PENGPENG_EVENT_URL) return B.pages;
		if (/action=parse&page=.*&prop=wikitext/.test(u)) return B.overview;
		throw new Error("pengpeng 用例没有这个 URL 的夹具：" + u);
	};
	return {
		calls: rec,
		async fetchRaw(url) {
			rec.push({ url: String(url), referer: "" });
			const body = bodyOf(url);
			return { ok: true, status: 200, headers: { get: () => null }, text: async () => body, json: async () => JSON.parse(body) };
		},
		async fetchViaProxy(url, opts) {
			rec.push({ url: String(url), referer: String((opts && opts.referer) || "") });
			if (bad.has(String(url))) throw new Error("http-500");
			return bodyOf(url);
		}
	};
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
const urlsOf = (tr) => tr.calls.map((c) => c.url);

// ── 夹具改写（都在**真实响应**上动刀，不手搓 devalue 数组）────────────────────────
// 把 `▸活动时间：…` 改成 `▸时间：…` ⇒ 解析器认不出（反向证明「只认活动时间那一行」）
function withoutActivityLines(html) {
	return html.split("▸活动时间：").join("▸时间：");
}
// 把 11-03 那帖的当期窗口改成**已经结束**的（反向证明翻页：第 1 页覆盖不到 ⇒ 翻第 2 页）
function page1WithEndedWindow() {
	return B.t1
		.split("2026年11月5日 05:00 - 2026年11月19日 04:59")
		.join("2026年9月1日 05:00 - 2026年9月2日 04:59");
}
// 去掉 `__NUXT_DATA__` 这个 id（反向证明：没有 SSR payload ⇒ 抛 taptap-topic:no-nuxt）
function withoutNuxt(html) {
	return html.split('id="__NUXT_DATA__"').join('id="__NO_NUXT__"');
}
// 换成"合法但没有任何帖子列表"的 devalue 数组（反向证明：结构变了 ⇒ 抛 taptap-topic:no-post）
function withoutList(html) {
	const bare = '<script type="application/json" id="__NUXT_DATA__">[["ShallowReactive",1],{"data":2},{"x":3},"y"]</script>';
	return html.replace(/<script[^>]*\bid="__NUXT_DATA__"[^>]*>[\s\S]*?<\/script>/, bare);
}

export default async function runPengpengEvent() {
	// ─────────────────────① 注册 ─────────────────────
	section("夜幕之下 ①：活动侧注册（默认 = TapTap tab 页 SSR；bwiki 公告仍是备选；卡池不动）");
	{
		const s = T.SOURCES.find((x) => x.id === "pengpeng") || null;
		check("pengpeng eventUrl = TapTap tab 页 `app/746164/topic?type=official`（允许路径）",
			!!s && s.eventUrl === TOPIC1 && /^https:\/\/www\.taptap\.cn\/app\/746164\/topic\?type=official$/.test(String(s.eventUrl)),
			s ? String(s.eventUrl) : "缺失");
		check("反证：活动侧地址**不再**指向 `webapiv2`（robots.txt 的 Disallow 路径）",
			!!s && String(s.eventUrl).indexOf("webapiv2") < 0, s ? String(s.eventUrl) : "缺失");
		check("pengpeng 活动来源标签 = 「TapTap」（换抓取方式不改用户可见标签）",
			!!s && s.eventSource === "TapTap", s ? String(s.eventSource) : "缺失");
		check("pengpeng 卡池侧地址 = bwiki **SMW ask**（本批不动）",
			!!s && /^https:\/\/wiki\.biligame\.com\/ymzx\/api\.php\?action=ask/.test(String(s.url))
			&& /%E5%A5%91%E7%BA%A6/.test(String(s.url)),
			s ? String(s.url) : "缺失");
		check("pengpeng 卡池侧 `source` 标签 = 「Bwiki 契约（SMW）」",
			!!s && s.source === "Bwiki 契约（SMW）", s ? String(s.source) : "缺失");
		check("旧 bwiki 活动源保留在 eventAltSources（url + 抓取器键 pengpeng-bwiki + 标签如实）",
			!!s && (s.eventAltSources || []).length === 1
			&& s.eventAltSources[0].url === PP.PENGPENG_EVENT_URL
			&& s.eventAltSources[0].fetcher === "pengpeng-bwiki"
			&& /不可靠/.test(String(s.eventAltSources[0].label))
			&& typeof (T.EVENT_FETCHERS["pengpeng"] || {})["pengpeng-bwiki"] === "function",
			s ? JSON.stringify(s.eventAltSources) : "缺失");
		check("默认活动抓取器仍是 EVENT_FETCHERS.pengpeng.default（不是备选键）",
			typeof (T.EVENT_FETCHERS["pengpeng"] || {}).default === "function");
		check("翻页上限 = 2 页（每页 10 帖；第 2 页捞仍在期的旧公告）", PP.PENGPENG_TAPTAP_MAX_PAGES === 2,
			String(PP.PENGPENG_TAPTAP_MAX_PAGES));
		check("页码 → `&page=N`（第 2 页；已有 page= 就替换，不会拼出两个）",
			PP.pengpengTaptapPageUrl(TOPIC1, 1) === TOPIC1
			&& /[?&]page=2$/.test(PP.pengpengTaptapPageUrl(TOPIC1, 2))
			&& /[?&]page=3$/.test(PP.pengpengTaptapPageUrl(TOPIC2, 3)),
			JSON.stringify([TOPIC1, PP.pengpengTaptapPageUrl(TOPIC1, 2)]));
		check("设置页下拉：卡池侧写「Bwiki 契约（SMW）」、活动侧写「TapTap」",
			!!s && T.getDefaultSourceName(s, "url") === "Bwiki 契约（SMW）" && T.getDefaultSourceName(s, "eventUrl") === "TapTap",
			JSON.stringify([s && T.getDefaultSourceName(s, "url"), s && T.getDefaultSourceName(s, "eventUrl")]));
	}

	// ─────────────────────② SSR → 帖子 / 活动事实 ─────────────────────
	section("夜幕之下 ②：tab 页 SSR 解析（10 帖 / 标题 + 摘要行 / 活动名取【…】/ 无年份不解）");
	{
		const posts1 = TT.ns_taptap_topicPostsOf(B.t1);
		const posts2 = TT.ns_taptap_topicPostsOf(B.t2);
		check("两页各解析出 10 帖", posts1.length === 10 && posts2.length === 10,
			JSON.stringify([posts1.length, posts2.length]));
		check("帖子带 id / title / 绝对 moment 链接 + 纯文本行",
			posts1[0].id === "869616689782720591"
			&& posts1[0].title === "【更新公告】11月12日停服维护说明"
			&& posts1[0].url === "https://www.taptap.cn/moment/869616689782720591"
			&& typeof posts1[0].text === "string",
			JSON.stringify([posts1[0].id, posts1[0].url]));
		check("摘要里的活动行逐字（SSR 只给前 200 字，活动档期恰在这一段）",
			posts1.find((p) => p.id === "866427359920655283").text.split("\n")
				.includes("▸活动时间：2026年11月5日 05:00 - 2026年11月19日 04:59"),
			JSON.stringify(posts1.find((p) => p.id === "866427359920655283").text.slice(-120)));
		check("帖子字段齐全：publishTime = 11-11 10:00 UTC（时间戳原样）+ 绝对 moment 链接",
			posts1[0].publishTime === 1794391200
			&& posts1[0].url === "https://www.taptap.cn/moment/869616689782720591",
			JSON.stringify([posts1[0].publishTime, posts1[0].url]));

		const a1 = PP.pengpengTaptapActivitiesOf(posts1, TZ_CN);
		const a2 = PP.pengpengTaptapActivitiesOf(posts2, TZ_CN);
		check("第 1 页活动 = 新风同行（标题【新风同行】去壳）+ 源站原文档期",
			a1.length === 1 && a1[0].name === "新风同行"
			&& a1[0].raw === "2026年11月5日 05:00 ~ 2026年11月19日 04:59"
			&& a1[0].display === "11-05 05:00 ~ 11-19 04:59",
			JSON.stringify(a1));
		check("第 2 页只解出画廊夜游：同页的【家族遗藏】`10月29日 5:00 - 11月12日 04:59` **没有年份 ⇒ 不解**",
			a2.length === 1 && a2[0].name === "画廊夜游"
			&& a2[0].raw === "2026年10月29日 05:00 ~ 2026年11月12日 04:59"
			&& !a2.some((x) => /家族遗藏/.test(x.name)),
			JSON.stringify(a2.map((x) => [x.name, x.raw])));
		check("活动事实带该帖的 moment 链接（画廊夜游 866… 之外的 863395943943245309）",
			(a2[0] || {}).url === "https://www.taptap.cn/moment/863395943943245309", JSON.stringify((a2[0] || {}).url));
		check("活动名取标题里的【…】；没有【】⇒ 整条标题（不改写、不补字）",
			PP.pengpengTaptapNameOf("🍃【新风同行】限时活动 即将开启") === "新风同行"
			&& PP.pengpengTaptapNameOf("《夜幕之下》活动版本PV：羊群安息处") === "《夜幕之下》活动版本PV：羊群安息处",
			PP.pengpengTaptapNameOf("🍃【新风同行】限时活动 即将开启"));

		// 共用 SSR 解码本身：根（ShallowReactive 壳）→ data → 结构定位
		const data = TT.ns_taptap_topicDataOf(B.t1);
		check("SSR 解码：根壳 `[\"ShallowReactive\",1]` 解开后能拿到 data 对象", !!data && typeof data === "object");
		check("SSR 解码：data 树里按**结构**找到帖子列表（键名是构建期哈希，不写死）",
			!!TT.ns_taptap_topicListOf(data) && TT.ns_taptap_topicListOf(data).list.length === 10);
		check("反证：SSR 解码器对两页都稳定（同一 helper、同一结构，第 2 页也是 10 帖）",
			TT.ns_taptap_topicListOf(TT.ns_taptap_topicDataOf(B.t2)).list.length === 10);
	}

	// ─────────────────────③ 当期外显（活网验收时刻） ─────────────────────
	section("夜幕之下 ③：当期（2026-11-11）外显 = 新风同行 11-05 05:00 ~ 11-19 04:59；第 1 页覆盖 ⇒ 1 个请求");
	let event = null;
	{
		const tr = makeTransport();
		const e = engineAt(NOW_LIVE, tr);
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
		check("第 1 页只有 1 条在期活动 ⇒ 不设 eventHover（交回 UI 两行式，不编第二条）",
			!!event && event.eventHover === void 0, JSON.stringify(event && event.eventHover));
		check("`eventHoverItems` 与 `events` 同源且都只有 1 条（悬停/数组同一份条目事实）",
			!!event && Array.isArray(event.eventHoverItems) && event.eventHoverItems.length === 1
			&& event.eventHoverItems[0].title === "新风同行",
			JSON.stringify(event && event.eventHoverItems));
		check("`events[]` 共 1 条（primary = 新风同行）",
			!!event && Array.isArray(event.events) && event.events.length === 1
			&& event.events[0].source === "primary" && event.events[0].title === "新风同行",
			JSON.stringify(event && event.events.map((x) => [x.title, x.source])));
		if (event && event.eventHover) assertHoverConvention("pengpeng 活动", event.eventHover, { requireSet: true });
		check("第 1 页已覆盖当前窗口 ⇒ **只发 1 个请求**（不再为更旧的帖子翻页）",
			tr.calls.length === 1 && urlsOf(tr)[0] === TOPIC1,
			JSON.stringify(urlsOf(tr)));
		check("走宿主代理、并带 tab 页自己的 Referer（tab 页无 ACAO）",
			tr.calls.length === 1 && tr.calls[0].referer === TOPIC1, JSON.stringify(tr.calls));
	}

	// ─────────────────────④ 反向证明 ─────────────────────
	section("夜幕之下 ④：反向证明（删「活动时间：」⇒ 空/null；无年份不是窗口；SSR 结构变 ⇒ 抛错）");
	{
		// (a) 整页删掉「活动时间」行 ⇒ 解析空
		const noLine1 = withoutActivityLines(B.t1);
		const postsNoLine = TT.ns_taptap_topicPostsOf(noLine1);
		check("反证：第 1 页把「▸活动时间：」全改掉 ⇒ 活动解析返回空数组（帖子还在 10 条）",
			postsNoLine.length === 10 && PP.pengpengTaptapActivitiesOf(postsNoLine, TZ_CN).length === 0,
			JSON.stringify([postsNoLine.length, PP.pengpengTaptapActivitiesOf(postsNoLine, TZ_CN).length]));

		// (b) 两页全删 ⇒ 抓取器如实 null（不编一条）；且会翻到第 2 页（覆盖不到 ≠ 提前停）
		const tr = makeTransport({
			[TOPIC1]: noLine1,
			[TOPIC2]: withoutActivityLines(B.t2)
		});
		const e = engineAt(NOW_LIVE, tr);
		const s = e.__test.SOURCES.find((x) => x.id === "pengpeng");
		let got = "not-run";
		try { got = await e.__test.EVENT_FETCHERS["pengpeng"].default(s.eventUrl, undefined, s.tz); } catch (err) { got = "throw:" + err.message; }
		check("反证：源站有 20 帖但没有任何活动时间 ⇒ 抓取器如实返回 null（不是编一条）", got === null, JSON.stringify(got));
		check("反证：上面那一次翻满了 2 页（没有覆盖当前窗口的活动 ≠ 提前停）", tr.calls.length === 2, String(tr.calls.length));

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

		// (d) 没有 `__NUXT_DATA__` ⇒ 抛错（抓取失败 ≠ 未公布）
		const trBad = makeTransport({ [TOPIC1]: withoutNuxt(B.t1) });
		const eBad = engineAt(NOW_LIVE, trBad);
		const sBad = eBad.__test.SOURCES.find((x) => x.id === "pengpeng");
		let errMsg = "not-run";
		try { await eBad.__test.EVENT_FETCHERS["pengpeng"].default(sBad.eventUrl, undefined, sBad.tz); } catch (err) { errMsg = err.message; }
		check("反证：响应里没有 `__NUXT_DATA__` ⇒ 抛 taptap-topic:no-nuxt（抓取失败 ≠ 未公布）",
			errMsg === "taptap-topic:no-nuxt", errMsg);

		// (e) 合法 devalue 但没有帖子列表 ⇒ 抛 taptap-topic:no-post
		const trNoList = makeTransport({ [TOPIC1]: withoutList(B.t1) });
		const eNoList = engineAt(NOW_LIVE, trNoList);
		const sNoList = eNoList.__test.SOURCES.find((x) => x.id === "pengpeng");
		let errNoList = "not-run";
		try { await eNoList.__test.EVENT_FETCHERS["pengpeng"].default(sNoList.eventUrl, undefined, sNoList.tz); } catch (err) { errNoList = err.message; }
		check("反证：SSR 里找不到帖子列表（结构变了）⇒ 抛 taptap-topic:no-post", errNoList === "taptap-topic:no-post", errNoList);
	}

	// ─────────────────────⑤ 翻页失败隔离 ─────────────────────
	section("夜幕之下 ⑤：第 2 页抓挂不影响第 1 页（如实 null，不抛错）");
	{
		const tr = makeTransport(null, [TOPIC2]);
		const e = engineAt(NOW_OLS, tr);
		const s = e.__test.SOURCES.find((x) => x.id === "pengpeng");
		const got = await e.__test.EVENT_FETCHERS["pengpeng"].default(s.eventUrl, undefined, s.tz);
		check("第 2 页 500 ⇒ 抓取器不抛错、如实 null（第 1 页本来就没有在期活动）", got === null, JSON.stringify(got));
		check("…并且确实只试了 2 次（第 1 页成功 + 第 2 页失败）", tr.calls.length === 2, String(tr.calls.length));
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

	// ─────────────────────⑦ 翻页策略（覆盖不到才翻） ─────────────────────
	section("夜幕之下 ⑦：第 1 页覆盖不到当前窗口（10-30）⇒ 翻第 2 页拿到画廊夜游（2 个请求）");
	{
		const tr = makeTransport();
		const e = engineAt(NOW_OLS, tr);
		const s = e.__test.SOURCES.find((x) => x.id === "pengpeng");
		const got = await e.__test.EVENT_FETCHERS["pengpeng"].default(s.eventUrl, undefined, s.tz);
		check("第 2 页活动 = 画廊夜游 10-29 05:00 ~ 11-12 04:59（第 1 页无在期活动 ⇒ 翻页）",
			got && got.event === "画廊夜游" && got.eventDates === "10-29 05:00 ~ 11-12 04:59",
			JSON.stringify(got && [got.event, got.eventDates]));
		check("请求顺序 = page1 → page2（各 1 次，最多 2 页）",
			tr.calls.length === 2 && urlsOf(tr)[0] === TOPIC1 && urlsOf(tr)[1] === TOPIC2,
			JSON.stringify(urlsOf(tr)));
	}
}
