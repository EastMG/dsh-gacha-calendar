// test/cases-batch2.mjs —— 第二批接入（2026-11-11）：崩坏3 内容中台 / OurNotes 日服 SPICA / 卡厄斯 TapTap
//
// ── 本段守什么 ──
//   ① 崩坏3：注册（两侧 url/eventUrl + 来源标签 + defaultHidden 保持 true + 米游社备选源保留）；
//      卡池**名称/角色 + 档期**：`>>开放时间` 优先 → 同帖「商城礼包【上架时间】」兜底 → 都没有就只出名称/角色；
//      `dtEndTime` 恒 2035 占位 ⇒ **一个字段都不许出现 2035**（反证：载荷 JSON 里 grep 不到）；
//      活动正文「>>开放时间 / 【活动时间】」时间块 → 逐字区间；相对起点 `9.1版本更新后` ⇒ startTs=null；
//      3 条主线更新稿没有时间块 ⇒ 如实不进日历；
//   ② OurNotes·日服：卡池侧此前无来源，现挂 SPICA（列表取 id → **只抓前 5 条详情**，不是 23 条）；
//      tz=Asia/Tokyo / 活动侧 bushimo 原样不动；详情「開催期間」→ 绝对 ts；pickup 名单逐字；
//   ③ 卡厄斯：卡池 + 活动**都**从 TapTap tab 的 **topic 页 SSR** 解析（2026-11-13 换路径）：
//      旧 `webapiv2/feed` + `webapiv2/moment detail` 被 robots.txt 明确 Disallow ⇒ 整体删除。
//      现在固定抓 2 页（`topic?type=official` + `&page=2`），页面里的 `__NUXT_DATA__` 是
//      **Nuxt devalue** 编码（数组 + 数字下标引用；含自引用环）⇒ 用 `ns_batch2_cznDevalueOf` 最小解码。
//      每帖取 `moment.topic.title/summary` + `created_time`：
//      卡池 = 标题/正文首行含「营救概率提升」（首行是 `-…` 列表项时用帖子标题）+ `概率提升时间：` /
//      `活动时间：` 标签行的区间；「维护结束后/前」用**同页**维护窗映射（12-02 的窗不在 p1/p2 ⇒ endTs 留空）。
//      活动 = 同帖维护窗 + `活动时间：` 标签（`➤活动时间：` / `〓活动时间〓` / `【活动时间】`）；
//      `即日起～<绝对终点>` 的起点锚 `created_time`（没有就留空）；卡池帖不算活动（不双计）。
//      请求数：卡池侧 2 个（p1+p2）；引擎里活动侧复用卡池载荷 ⇒ 整轮仍 2 个。**没有**共享缓存。
//
// ── 真夹具（test/fixtures/<名>/response.txt + .meta.json 的 url/capturedAt/trim）──
//   bh3-content-gacha / bh3-content-event（抓取时刻 2026-11-11T01:00:20+08；当天 10:30 复核与夹具逐字节相同）
//   spica-ournotes-gachas + spica-ournotes-gacha-{5001,22,4001,21,20}
//   czn-taptap-topic-p1 / czn-taptap-topic-p2（2026-11-13T22:29~22:30+08 真抓；只保留 SSR 的
//     `<script id="__NUXT_DATA__">…</script>` 原文，payload 未改 —— 见各自 meta 的 trim）
//
// 时间断言一律写 `Date.UTC(...)` 手算的绝对毫秒：UTC 与 +08 两道门禁跑**同一份期望值**，
// 不存在"本机时区对了才绿"。`NOW` 固定为 2026-11-13 23:00 +08 —— 比抓取时刻晚半小时，
// 让卡池（11-04 02:00 ~ 11-25 02:00）与「卡厄思小课堂」（即日起 ~ 12-01 23:59:59）都在期。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createEngine } from "../packages/core/core.mjs";
import { check, section, fixtureBody, useFixtures } from "./harness.mjs";
import { T } from "./load.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

const B = T.parsers.batch2;
const BH3_G = B.NS_BATCH2_BH3_GACHA_URL;
const BH3_E = B.NS_BATCH2_BH3_EVENT_URL;
const SPICA_LIST = B.NS_BATCH2_SPICA_LIST_URL;
const SPICA_DETAIL = B.NS_BATCH2_SPICA_DETAIL_BASE;
const CZN = B.NS_BATCH2_CZN_TOPIC_URL;
const CZN_P2 = B.ns_batch2_cznTopicUrlOf(2);
const NOW = Date.parse("2026-11-11T12:00:00+08:00");
// czn 的夹具是 2026-11-13T22:29~22:30+08 抓的；23:00 时卡池与「卡厄思小课堂」都在期。
const CZN_NOW = Date.parse("2026-11-13T23:00:00+08:00");

const FIXTURES = useFixtures();   // 全局夹具 impl（下面的 transport 直接复用它）
const makeStore = (seed) => {
	const m = new Map(Object.entries(seed || {}));
	return { map: m, async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
};

// 记账 transport：`fetchViaProxy` 把**目标地址**记进 sink（与真实宿主代理同一形态），
// 再复用 harness 的夹具 impl（它认 `/api/gacha-calendar-proxy?url=…` 前缀并拆 `{status, body}`）。
// `opts.fail` = 可选的 `(url) => bool`：命中的请求按"代理层目标站 500"抛出（与真实代理同一失败形态，
// 见 92-dsh-env.js 的 `proxy-bad:<状态码>`）—— 用来模拟"某一份详情被限流 / 500"。
function makeTransport(sink, opts) {
	const fail = (opts && opts.fail) || null;
	const override = (opts && opts.override) || null;   // (url) => body 文本：替换夹具响应（造"标题全命中"这类 feed）
	return {
		async fetchRaw(url) {
			sink.push({ url: String(url), via: "raw", referer: "" });
			throw new Error("直连不该被用到：" + String(url));
		},
		async fetchViaProxy(url, opts2) {
			const referer = (opts2 && opts2.referer) || "";
			sink.push({ url: String(url), via: "proxy", referer });
			if (fail && fail(String(url))) throw new Error("proxy-bad:500");
			const over = override ? override(String(url)) : null;
			if (over != null) return over;
			const api = "/api/gacha-calendar-proxy?url=" + encodeURIComponent(String(url));
			const res = await FIXTURES(api);
			const wrapped = JSON.parse(await res.text());
			if (wrapped.status !== 200) throw new Error("proxy-bad:" + wrapped.status);
			return wrapped.body;
		}
	};
}
const engineAt = (now, sink, extra, opts) => createEngine({
	transport: makeTransport(sink, opts),
	storage: makeStore(extra),
	now: () => now,
	timer: { setTimeout, clearTimeout }
});
// 可拨动的时钟：用来在**同一个引擎**里跨过 TTL（`createEngine` 每次造一个独立 core，
// czn 的 docs 缓存跟着引擎实例走 ⇒ 换引擎测不了"过期"）。
const engineWithClock = (clock, sink, extra, opts) => createEngine({
	transport: makeTransport(sink, opts),
	storage: makeStore(extra),
	now: () => clock.now,
	timer: { setTimeout, clearTimeout }
});
const proxyCallsOf = (calls) => calls.filter((c) => c.via === "proxy");
// czn 的 topic 页请求（p1 = 注册地址；p2 由抓取器拼 `&page=2`）。

export default async function runBatch2() {
	// ═══════════════════ ① 崩坏3 ═══════════════════
	section("第二批①：崩坏3 内容中台 —— 注册 / 卡池只出名称·角色 / 活动时间块");
	{
		const s = T.SOURCES.find((x) => x.id === "bh3") || null;
		check("条目已存在（id = bh3）", !!s, s ? s.id : "缺失");
		check("tz = Asia/Shanghai（显式）", !!s && s.tz === "Asia/Shanghai", s && s.tz);
		check("卡池 url = 内容中台 iChanId=697（30 条 / zh-cn）",
			!!s && s.url === BH3_G && /iChanId=697/.test(s.url) && /iPageSize=30/.test(s.url), s && String(s.url));
		check("活动 eventUrl = 内容中台 iChanId=696",
			!!s && s.eventUrl === BH3_E && /iChanId=696/.test(s.eventUrl), s && String(s.eventUrl));
		check("两侧来源标签 = 官网公告",
			!!s && s.source === B.NS_BATCH2_BH3_SOURCE_LABEL && s.eventSource === B.NS_BATCH2_BH3_SOURCE_LABEL,
			s && JSON.stringify([s.source, s.eventSource]));
		check("defaultHidden 保持 true（原出厂隐藏，接入后仍不占版面）", !!s && s.defaultHidden === true, s && String(s.defaultHidden));
		check("米游社公告备选源仍在（卡池 + 活动各 1 条，抓取器 bh3-miyoushe）",
			!!s && (s.altSources || []).length === 1 && s.altSources[0].fetcher === "bh3-miyoushe"
			&& (s.eventAltSources || []).length === 1 && s.eventAltSources[0].fetcher === "bh3-miyoushe",
			s && JSON.stringify([(s.altSources || []).map((a) => a.label), (s.eventAltSources || []).map((a) => a.label)]));
		const idx = readFileSync(path.join(REPO, "src", "index.js"), "utf8");
		check("宿主白名单已登记 act-api-takumi-static.mihoyo.com（否则代理 403）",
			/const PROXY_ALLOW_HOSTS = \[[\s\S]*?"act-api-takumi-static\.mihoyo\.com"[\s\S]*?\n\];/.test(idx));
	}

	// ── ①-2 卡池：名称/角色 + 档期（`>>开放时间` → 礼包【上架时间】 → 只出名称）──
	{
		const gJson = JSON.parse(fixtureBody(BH3_G));
		const calls = [];
		const e = engineAt(NOW, calls);
		const s = e.__test.SOURCES.find((x) => x.id === "bh3");
		const gp = await e.__test.GACHA_FETCHERS["bh3"](s.url, undefined, s.tz);
		check("卡池抓取器返回对象（不是 null）", !!gp && typeof gp === "object");
		check("最新补给名逐字「装备补给丨琉璃朱燧&泣之哲人」",
			!!gp && gp.banner === "装备补给丨琉璃朱燧&泣之哲人", JSON.stringify(gp && gp.banner));
		check("装备补给的 roles 为空（武器/圣痕不当角色）", !!gp && gp.roles === "", JSON.stringify(gp && gp.roles));
		check("档期来自同帖「商城礼包【上架时间】」兜底：11-06 12:00 ~ 11-26 04:00（原文逐字）",
			!!gp && gp.bannerDates === "11-06 12:00 ~ 11-26 04:00"
			&& gp.bannerDatesRaw === "11月6日12:00~11月26日04:00",
			JSON.stringify([gp && gp.bannerDates, gp && gp.bannerDatesRaw]));
		check("**载荷里没有任何 2035**：`dtEndTime` 的 2035 占位一个字节都没进来",
			!!gp && JSON.stringify(gp).indexOf("2035") < 0, JSON.stringify(gp && gp.bannerDatesRaw));
		check("源站该条 dtEndTime 确实是 2035 占位（反证：解析器根本没读它）",
			String(gJson.data.list[0].dtEndTime).startsWith("2035-01-01"), gJson.data.list[0].dtEndTime);
		check("`gacha[]` 4 条在期池（主条 source=primary 在数组里，ts 逐条非空）",
			!!gp && Array.isArray(gp.gacha) && gp.gacha.length === 4
			&& gp.gacha.filter((x) => x.source === "primary").length === 1
			&& gp.gacha.every((x) => x.startTs != null && x.endTs != null)
			&& gp.gacha.find((x) => x.source === "primary").title === gp.banner,
			JSON.stringify(gp && gp.gacha.map((x) => [x.title, x.source])));
		check("在期池含「时光追忆丨服装补给限时开启！」（10-30 ~ 11-13，`>>开放时间` 而不是礼包）",
			!!gp && gp.gacha.some((x) => x.title === "时光追忆丨服装补给限时开启！"
				&& x.startTs === Date.UTC(2026, 9, 30, 4, 0) && x.endTs === Date.UTC(2026, 10, 13, 4, 0)),
			JSON.stringify(gp && gp.gacha.map((x) => [x.title.slice(0, 6), x.startTs, x.endTs])));
		check("卡池悬停逐字 4 池 ×「池名 ⏎ 档期」（结束时间升序）",
			!!gp && gp.bannerHover === [
				"时光追忆丨服装补给限时开启！",
				"10-30 12:00 ~ 11-13 12:00",
				"装备补给丨琉璃朱燧&泣之哲人",
				"11-06 12:00 ~ 11-26 04:00",
				"跃升武装丨龙威燎天烈&游戏人生",
				"11-06 12:00 ~ 11-26 04:00",
				"跃升补给丨逆命魔龙·降临！：逆命魔龙·降临！",
				"11-06 12:00 ~ 11-26 04:00"
			].join("\n"), JSON.stringify(gp && gp.bannerHover));
		check("卡池侧 1 次请求、全程经代理、带 Referer `https://bh3.mihoyo.com/`",
			proxyCallsOf(calls).length === 1 && calls[0].referer === "https://bh3.mihoyo.com/",
			JSON.stringify(calls));

		// 档期三级取值：逐条拿真夹具的原文喂进去
		const itemOf = (id) => gJson.data.list.find((x) => String(x.iInfoId) === String(id));
		const winOf = (item, text) => B.ns_batch2_bh3GachaWindowOf(
			text == null ? B.ns_batch2_bh3Text(item.sContent) : text,
			B.ns_batch2_bh3WallOf(item.dtStartTime), "Asia/Shanghai", NOW);
		const wOpen = winOf(itemOf(167193));   // 跃升武装：正文有 `>>开放时间`
		check("① `>>开放时间` 块：跃升武装「龙威燎天烈」→ 11月6日12:00~11月26日04:00",
			!!wOpen && wOpen.raw === "11月6日12:00~11月26日04:00"
			&& wOpen.startTs === Date.UTC(2026, 10, 6, 4, 0) && wOpen.endTs === Date.UTC(2026, 10, 25, 20, 0),
			JSON.stringify(wOpen));
		const wGift = winOf(itemOf(167237));  // 装备补给：正文只有礼包【上架时间】
		check("② 礼包【上架时间】兜底：装备补给「琉璃朱燧」→ 同一区间（原文逐字）",
			!!wGift && wGift.raw === "11月6日12:00~11月26日04:00" && wGift.startTs === wOpen.startTs && wGift.endTs === wOpen.endTs,
			JSON.stringify(wGift));
		check("③ 两处都没有 ⇒ 窗口 null（只出名称/角色，不拿 dtStartTime 凑区间）",
			winOf(itemOf(167236)) === null, JSON.stringify(winOf(itemOf(167236))));
		// 单条载荷（只有「濯海之蕊」这帖）：名称/角色照出，档期留空
		const loner = { data: { list: [itemOf(167236)] } };
		const lonePay = B.ns_batch2_bh3GachaPayloadOf(loner, "Asia/Shanghai", NOW);
		check("③ 单条载荷：banner 逐字、bannerDates/bannerDatesRaw 留空、gacha[] 1 条 ts=null",
			!!lonePay && lonePay.banner === "装备补给丨濯海之蕊&谐谑奇锋"
			&& lonePay.bannerDates === "" && lonePay.bannerDatesRaw === ""
			&& lonePay.gacha.length === 1 && lonePay.gacha[0].startTs === null && lonePay.gacha[0].endTs === null,
			JSON.stringify(lonePay && [lonePay.banner, lonePay.bannerDates, lonePay.gacha[0].source]));

		// 角色抽取：正文明确写法 / 标题兜底
		const charItem = gJson.data.list.find((x) => /角色补给丨愈生佑翎/.test(x.sTitle));
		check("角色补给正文 → `S级角色「愈生佑翎」` + `A级角色「午夜苦艾」`",
			!!charItem && JSON.stringify(B.ns_batch2_bh3RolesOf(charItem)) === JSON.stringify(["愈生佑翎", "午夜苦艾"]),
			JSON.stringify(charItem && B.ns_batch2_bh3RolesOf(charItem)));
		const cele = gJson.data.list.find((x) => /庆典角色补给/.test(x.sTitle));
		check("庆典角色补给（正文不写「X级角色」）→ 标题兜底拆成 镇 / 偃月叩晓（`等目标限时UP` 不算名字）",
			!!cele && JSON.stringify(B.ns_batch2_bh3RolesOf(cele)) === JSON.stringify(["镇", "偃月叩晓"]),
			JSON.stringify(cele && B.ns_batch2_bh3RolesOf(cele)));
	}

	// ── ①-3 活动：时间块 → 绝对 ts / 相对起点留 null / 无时间块不进 ──
	let bh3Items = null;
	let bh3Pay = null;
	{
		const eJson = JSON.parse(fixtureBody(BH3_E));
		bh3Items = B.ns_batch2_bh3EventItemsOf(eJson, "Asia/Shanghai", NOW);
		check("活动条目事实 = 27 条（30 条里 27 条有时间块）", bh3Items.length === 27, String(bh3Items.length));
		const first = bh3Items[0] || {};
		check("首条名称逐字「晚秋拾光丨参与活动获取3★圣痕等奖励」",
			first.title === "晚秋拾光丨参与活动获取3★圣痕等奖励", JSON.stringify(first.title));
		check("首条 startTs = 2026-11-12 10:00 +08（UTC 02:00）",
			first.startTs === Date.UTC(2026, 10, 12, 2, 0), String(first.startTs));
		check("首条 endTs = 2026-11-26 04:00 +08（UTC 11-25 20:00）",
			first.endTs === Date.UTC(2026, 10, 25, 20, 0), String(first.endTs));
		check("首条 raw = 源站原文「11月12日10:00~11月26日04:00」/ display = 补全文本「11-12 10:00 ~ 11-26 04:00」",
			first.raw === "11月12日10:00~11月26日04:00" && first.display === "11-12 10:00 ~ 11-26 04:00",
			JSON.stringify([first.raw, first.display]));
		check("首条 tz 显式 = Asia/Shanghai / source = hover（条目事实）",
			first.tz === "Asia/Shanghai" && first.source === "hover", JSON.stringify([first.tz, first.source]));

		const absent = eJson.data.list.map((x) => x.sTitle).filter((t) => !bh3Items.some((i) => i.title === t));
		check("3 条主线更新稿（正文没有活动时间块）**如实不进日历**，不补时刻",
			absent.length === 3 && absent.every((t) => /主线|终章/.test(t)), JSON.stringify(absent));

		const rel = bh3Items.find((x) => x.title.startsWith("甜趣沙集")) || {};
		check("相对起点「9.1版本更新后~11月26日04:00」⇒ startTs=null / endTs 绝对 / display 原样保留",
			rel.startTs === null && rel.endTs === Date.UTC(2026, 10, 25, 20, 0)
			&& rel.raw === "9.1版本更新后~11月26日04:00" && rel.display === rel.raw,
			JSON.stringify(rel));

		const calls = [];
		const e = engineAt(NOW, calls);
		const s = e.__test.SOURCES.find((x) => x.id === "bh3");
		bh3Pay = await e.__test.EVENT_FETCHERS["bh3"].default(s.eventUrl, undefined, s.tz);
		check("活动抓取器返回对象", !!bh3Pay && typeof bh3Pay === "object");
		check("当期活动 = 双核协战（覆盖 11-11、且开始最晚的那条）",
			!!bh3Pay && bh3Pay.event === "双核协战丨参与活动获取活动勋章、水晶等奖励！", JSON.stringify(bh3Pay && bh3Pay.event));
		check("当期档期 = 11-05 10:00 ~ 11-26 04:00（源站原文 11月5日10:00~11月26日04:00）",
			!!bh3Pay && bh3Pay.eventDates === "11-05 10:00 ~ 11-26 04:00"
			&& bh3Pay.eventDatesRaw === "11月5日10:00~11月26日04:00",
			JSON.stringify([bh3Pay && bh3Pay.eventDates, bh3Pay && bh3Pay.eventDatesRaw]));
		check("活动悬停逐字 9 行（6 条两端明确 + 3 条相对起点印原文；结束时间升序）",
			!!bh3Pay && bh3Pay.eventHover === [
				"忆旅的流彩叙映丨完成数据回顾获取水晶等奖励   09-28 10:00 ~ 11-26 04:00",
				"溯梦之行 | 七日登录领取S级角色卡等奖励   10-01 04:00 ~ 11-26 04:00",
				"英雄远征：神谕试炼丨参与活动得水晶、根源棱镜等奖励   10-12 10:00 ~ 11-26 04:00",
				"畅游吼姆世界：好友成群丨参与得服装自选箱、水晶等奖励   10-22 10:00 ~ 11-26 04:00",
				"银海拾忆 | 完成任务赢取手办、角色自选箱等好礼   10-22 12:00 ~ 11-26 04:00",
				"双核协战丨参与活动获取活动勋章、水晶等奖励！   11-05 10:00 ~ 11-26 04:00",
				"甜趣沙集丨参与活动获取武器&服装自选箱等奖励   9.1版本更新后~11月26日04:00",
				"行于曙光丨七日登录领圣痕自选箱、水晶等奖励   9.1版本更新后~11月26日04:00",
				"V9.1作战凭证开启   9.1版本更新后~11月26日06:00"
			].join("\n"), JSON.stringify(bh3Pay && bh3Pay.eventHover));
		check("`events[]` 9 条：6 条带绝对 ts、3 条相对起点在数组派生口径下 ts=null（已知下游口径）",
			!!bh3Pay && bh3Pay.events.length === 9
			&& bh3Pay.events.filter((x) => x.startTs != null && x.endTs != null).length === 6
			&& bh3Pay.events.filter((x) => x.startTs == null).length === 3,
			JSON.stringify((bh3Pay && bh3Pay.events || []).map((x) => [x.title.slice(0, 10), x.startTs, x.endTs])));
		check("活动侧 1 次请求、全程经代理、同一条 Referer",
			proxyCallsOf(calls).length === 1 && calls[0].referer === "https://bh3.mihoyo.com/", JSON.stringify(calls));

		// 引擎整轮（只让 bh3 可见 ⇒ 两侧各 1 次请求）
		const calls2 = [];
		const allIds = engineAt(NOW, []).__test.SOURCES.map((x) => x.id);
		const e2 = engineAt(NOW, calls2, { hidden: allIds.filter((id) => id !== "bh3"), shown: ["bh3"] });
		const r = await e2.refresh();
		const rec = r.games["bh3"] || {};
		check("整轮：卡池/活动各 1 次请求（两条不同 URL）",
			calls2.filter((c) => /iChanId=697/.test(c.url)).length === 1
			&& calls2.filter((c) => /iChanId=696/.test(c.url)).length === 1,
			JSON.stringify(calls2.map((c) => c.url.slice(-40))));
		check("整轮：两侧都不 fail", rec.gachaFail == null && rec.eventFail == null, JSON.stringify([rec.gachaFail, rec.eventFail]));
		check("整轮记录：banner 逐字 / roles 留空 / 档期逐字 / 活动逐字",
			rec.banner === "装备补给丨琉璃朱燧&泣之哲人" && rec.roles === ""
			&& rec.bannerDates === "11-06 12:00 ~ 11-26 04:00"
			&& rec.bannerDatesRaw === "11月6日12:00~11月26日04:00"
			&& rec.event === "双核协战丨参与活动获取活动勋章、水晶等奖励！"
			&& rec.eventDates === "11-05 10:00 ~ 11-26 04:00",
			JSON.stringify([rec.banner, rec.roles, rec.bannerDates, rec.event, rec.eventDates]));
		check("整轮记录：gacha 4 条 / events 9 条，key 带 bh3 前缀",
			rec.gacha.length === 4 && rec.events.length === 9
			&& rec.gacha[0].key === "bh3:gacha:0" && rec.events[0].key === "bh3:event:0",
			JSON.stringify([rec.gacha.length, rec.events.length, rec.gacha[0] && rec.gacha[0].key]));
	}

	// ── ①-4 反向证明 ──
	section("第二批①反证：拿掉关键解析 ⇒ 产出空 / 不编值");
	{
		const eJson = JSON.parse(fixtureBody(BH3_E));
		const hint = B.ns_batch2_bh3WallOf(eJson.data.list[0].dtStartTime);
		// 反证 A：把时间标签删掉 ⇒ 这条帖的窗口就消失了（不会退化成全文乱找）
		const text = B.ns_batch2_bh3Text(eJson.data.list[0].sContent);
		check("反证 A：正文有「>>开放时间」标签时能截出时间块", B.ns_batch2_bh3EventBlockOf(text).indexOf("11月12日") >= 0,
			JSON.stringify(B.ns_batch2_bh3EventBlockOf(text).slice(0, 40)));
		check("反证 A：标签换成普通文字 ⇒ 时间块为空 ⇒ 窗口 null（不硬凑）",
			B.ns_batch2_bh3EventBlockOf(text.replace(/>>\s*开放时间/, "开放说明")) === ""
			&& B.ns_batch2_bh3EventWindowOf(text.replace(/>>\s*开放时间/, "开放说明"), hint, "Asia/Shanghai", NOW) === null);
		// 反证 B：相对起点就是 null，不是"补一个 10:00"
		const relWin = B.ns_batch2_bh3RangeOf("9.1版本更新后~11月26日04:00", hint, "Asia/Shanghai");
		check("反证 B：相对起点 ⇒ startTs=null（不补锚点）", !!relWin && relWin.startTs === null && relWin.endTs === Date.UTC(2026, 10, 25, 20, 0),
			JSON.stringify(relWin));
		// 反证 C：卡池把 dtEndTime 当结束会得到 2035；解析器没这么干
		check("反证 C：源站卡池 30 条的 dtEndTime 全是 2035 占位，而载荷里 grep 不到 2035（证明没拿它当档期）",
			JSON.parse(fixtureBody(BH3_G)).data.list.every((x) => String(x.dtEndTime).startsWith("2035-01-01")));
		// 反证 D：档期的两条来源各自拿掉 ⇒ 该池窗口就没了（证明档期真的来自这两处，不是别处凑的）
		const gJson = JSON.parse(fixtureBody(BH3_G));
		const openItem = gJson.data.list.find((x) => String(x.iInfoId) === "167066");   // 时光追忆：只有 `>>开放时间`
		const openText = B.ns_batch2_bh3Text(openItem.sContent);
		const openHint = B.ns_batch2_bh3WallOf(openItem.dtStartTime);
		check("反证 D-①：抹掉 `>>开放时间` 标签 ⇒ 时光追忆窗口 null（它没有礼包兜底）",
			!!B.ns_batch2_bh3GachaWindowOf(openText, openHint, "Asia/Shanghai", NOW)
			&& B.ns_batch2_bh3GachaWindowOf(openText.replace(/>>\s*开放时间/, "开放说明"), openHint, "Asia/Shanghai", NOW) === null,
			JSON.stringify(B.ns_batch2_bh3GachaWindowOf(openText.replace(/>>\s*开放时间/, "开放说明"), openHint, "Asia/Shanghai", NOW)));
		const giftItem = gJson.data.list.find((x) => String(x.iInfoId) === "167237");  // 琉璃朱燧：只有礼包
		const giftText = B.ns_batch2_bh3Text(giftItem.sContent);
		const giftHint = B.ns_batch2_bh3WallOf(giftItem.dtStartTime);
		check("反证 D-②：抹掉「【上架时间】」⇒ 装备补给窗口 null（正文再没有别的窗口）",
			!!B.ns_batch2_bh3GachaWindowOf(giftText, giftHint, "Asia/Shanghai", NOW)
			&& B.ns_batch2_bh3GachaWindowOf(giftText.replace(/【上架时间】/g, "上市时间"), giftHint, "Asia/Shanghai", NOW) === null,
			JSON.stringify(B.ns_batch2_bh3GachaWindowOf(giftText.replace(/【上架时间】/g, "上市时间"), giftHint, "Asia/Shanghai", NOW)));
	}

	// ═══════════════════ ② OurNotes 日服 SPICA ═══════════════════
	section("第二批②：OurNotes 日服卡池 —— SPICA（列表→前 5 条详情 / 開催期間 / pickup）");
	{
		const s = T.SOURCES.find((x) => x.id === "ournotes") || null;
		check("卡池 url = SPICA 列表（此前该侧无来源）", !!s && s.url === SPICA_LIST, s && String(s.url));
		check("卡池来源标签 = SPICA", !!s && s.source === B.NS_BATCH2_SPICA_SOURCE_LABEL, s && s.source);
		check("活动侧原样不动（bushimo WP 公告 / 官方公告（日文））",
			!!s && s.eventUrl === "https://bang-dream-on.bushimo.jp/wp-json/wp/v2/posts?per_page=20&page=1"
			&& s.eventSource === "官方公告（日文）", s && JSON.stringify([s.eventUrl, s.eventSource]));
		check("tz = Asia/Tokyo / defaultHidden 保持 true（与同款其它服一致）",
			!!s && s.tz === "Asia/Tokyo" && s.defaultHidden === true, s && JSON.stringify([s.tz, s.defaultHidden]));

		const ids = B.ns_batch2_spicaIdsOf(fixtureBody(SPICA_LIST));
		check("列表解析出 23 本（与页面「23 件」一致）", ids.length === 23, String(ids.length));
		check("列表顺序 = 源站顺序，首条 id = 5001（最新开始）", ids[0] && ids[0].id === "5001", ids[0] && ids[0].id);
		check("列表本身**没有日期**（标题不含 2026.x.x）⇒ 日期必须进详情页",
			ids.every((x) => x.title && !/\d{4}\.\d{1,2}\.\d{1,2}/.test(x.title)), JSON.stringify(ids.slice(0, 2)));

		const d5001 = B.ns_batch2_spicaDetailOf(fixtureBody(SPICA_DETAIL + "5001"), "Asia/Tokyo");
		check("详情 5001：名称逐字", d5001.title === "光降る宮殿のエピソディウムガチャ", JSON.stringify(d5001.title));
		check("详情 5001：開催期間源站原文「2026.11.08 15:00 – 2026.11.18 14:59」",
			d5001.raw === "2026.11.08 15:00 – 2026.11.18 14:59", JSON.stringify(d5001.raw));
		check("详情 5001：startTs = 2026-11-08 15:00 JST（UTC 06:00）", d5001.startTs === Date.UTC(2026, 10, 8, 6, 0), String(d5001.startTs));
		check("详情 5001：endTs = 2026-11-18 14:59 JST（UTC 05:59）", d5001.endTs === Date.UTC(2026, 10, 18, 5, 59), String(d5001.endTs));
		check("详情 5001：pickup 名单逐字（4 个，含名字里自带「、」的那条）",
			d5001.roles === "煌めきのパッスス、玉座より見下ろして、何も映さない瞳、月よ、憐れみの光を", JSON.stringify(d5001.roles));

		const calls = [];
		const e = engineAt(NOW, calls);
		const gp = await e.__test.GACHA_FETCHERS["ournotes"](s.url, undefined, s.tz);
		check("卡池抓取器返回对象", !!gp && typeof gp === "object");
		check("当期池 = 光降る宮殿のエピソディウムガチャ（11-08~11-18 覆盖 now）",
			!!gp && gp.banner === "光降る宮殿のエピソディウムガチャ", JSON.stringify(gp && gp.banner));
		check("当期档期 / 原文逐字", !!gp && gp.bannerDates === "11-08 15:00 ~ 11-18 14:59"
			&& gp.bannerDatesRaw === "2026.11.08 15:00 – 2026.11.18 14:59",
			JSON.stringify([gp && gp.bannerDates, gp && gp.bannerDatesRaw]));
		check("roles 逐字（4 个 pickup）", !!gp && gp.roles === d5001.roles, JSON.stringify(gp && gp.roles));
		const listCalls = calls.filter((c) => /\/ournotes\/gachas$/.test(c.url));
		const detailCalls = calls.filter((c) => /\/ournotes\/gacha\/[A-Za-z0-9_-]+$/.test(c.url));
		check("**只抓前 5 条详情**（列表 1 次 + 详情 5 次，不是 23 次）",
			listCalls.length === 1 && detailCalls.length === B.NS_BATCH2_SPICA_MAX_DETAILS && B.NS_BATCH2_SPICA_MAX_DETAILS === 5,
			JSON.stringify([listCalls.length, detailCalls.length]));
		check("全程经代理、带 Referer `https://spica.wiki/`",
			proxyCallsOf(calls).length === calls.length && calls.every((c) => c.referer === "https://spica.wiki/"), JSON.stringify(calls.slice(0, 2)));
		check("悬停 = 4 池 ×「池名：pickup」⏎ 档期（结束时间升序；同结束再按开始）",
			!!gp && gp.bannerHover === [
				"A day〜#HalloweenSnap〜アイテムガチャ",
				"10-28 12:00 ~ 11-18 14:59",
				"光降る宮殿のエピソディウムガチャ：煌めきのパッスス、玉座より見下ろして、何も映さない瞳、月よ、憐れみの光を",
				"11-08 15:00 ~ 11-18 14:59",
				"撃奏アリーナ Season1 SSR確定チケットガチャ",
				"10-28 00:00 ~ 12-28 14:59",
				"撃奏アリーナ Season1 SR以上確定チケットガチャ",
				"10-28 00:00 ~ 12-28 14:59"
			].join("\n"), JSON.stringify(gp && gp.bannerHover));
		check("`gacha[]` 4 条；主条不在第 0 位（数组按结束时间升序，primary 由 source 区分）",
			!!gp && gp.gacha.length === 4 && gp.gacha.findIndex((x) => x.source === "primary") === 1
			&& gp.gacha.every((x) => x.tz === "Asia/Tokyo"),
			JSON.stringify(gp && gp.gacha.map((x) => [x.title.slice(0, 12), x.source])));
	}

	section("第二批②反证：详情缺「開催期間」⇒ null（不编时刻）");
	{
		const noPeriod = "<html><body><div class=\"wrap\"><h1>テストガチャ</h1><h2>ピックアップ</h2><ul><li><a href=\"/x\">名A</a></li></ul></div></body></html>";
		const d = B.ns_batch2_spicaDetailOf(noPeriod, "Asia/Tokyo");
		check("缺開催期間：名称/名单照常解析，startTs/endTs 都是 null", d.title === "テストガチャ" && d.startTs === null && d.endTs === null && d.roles === "名A",
			JSON.stringify(d));
		const undecided = "<html><body><h1>テスト</h1><dl class=\"info\"><div><dt class=\"k\">開催期間</dt><dd class=\"v\">未定</dd></div></dl></body></html>";
		const d2 = B.ns_batch2_spicaDetailOf(undecided, "Asia/Tokyo");
		check("開催期間=「未定」：ts 为 null、raw/display 原样保留「未定」", d2.startTs === null && d2.endTs === null && d2.raw === "未定" && d2.display === "未定",
			JSON.stringify(d2));
		check("空列表 ⇒ ids 为空（抓取器据此抛 `spica-list-empty`，不是静默 null）", B.ns_batch2_spicaIdsOf("<html></html>").length === 0);
	}

	// ═══════════════════ ③ 卡厄斯梦境 TapTap（topic 页 SSR：Nuxt devalue 解码）═══════════════════
	section("第二批③：卡厄斯梦境 —— topic 页 SSR（2 页：卡池「营救概率提升」+ 活动「活动时间」）");
	{
		const s = T.SOURCES.find((x) => x.id === "czn") || null;
		check("卡池 url = topic 页（app/759688 / type=official）",
			!!s && s.url === CZN && /\/app\/759688\/topic\?type=official$/.test(s.url), s && String(s.url));
		check("url 不再含 robots 禁的 /webapi/ 或 /webapiv2/",
			!!s && !/\/webapi(v2)?\//.test(s.url) && !/webapiv2/.test(String(s.eventUrl)), s && String(s.url));
		check("卡池 / 活动来源标签都 = 「TapTap」",
			!!s && s.source === "TapTap" && s.source === B.NS_BATCH2_CZN_SOURCE_LABEL
			&& s.eventSource === "TapTap", s && JSON.stringify([s.source, s.eventSource]));
		check("活动 eventUrl = 同一个 topic 页（两侧同一套 2 页）",
			!!s && s.eventUrl === CZN && s.eventUrl === s.url, s && String(s.eventUrl));
		check("bwiki `Module:Gacha/data` 降为卡池备选源（键 czn-bwiki；label 写明停更）",
			!!s && (s.altSources || []).length === 1 && s.altSources[0].fetcher === "czn-bwiki"
			&& /wiki\.biligame\.com\/czn\/api\.php/.test(s.altSources[0].url)
			&& /停更/.test(s.altSources[0].label), s && JSON.stringify(s.altSources));
		check("tz = Asia/Shanghai / defaultHidden 保持 true", !!s && s.tz === "Asia/Shanghai" && s.defaultHidden === true,
			s && JSON.stringify([s.tz, s.defaultHidden]));
		check("固定 2 页；page2 由抓取器自己拼（逐字 `&page=2`）",
			B.NS_BATCH2_CZN_PAGES === 2 && CZN_P2 === CZN + "&page=2"
			&& B.ns_batch2_cznTopicUrlOf(1) === CZN, JSON.stringify([B.NS_BATCH2_CZN_PAGES, CZN_P2]));
		check("旧的共享缓存 / feed / detail 常量已整体删除（`webapiv2` 路径不再存在）",
			B.NS_BATCH2_CZN_DOCS_TTL_MS === undefined && B.NS_BATCH2_CZN_FEED_URL === undefined
			&& B.ns_batch2_cznDetailUrl === undefined);
		const idx = readFileSync(path.join(REPO, "src", "index.js"), "utf8");
		check("宿主白名单已登记 www.taptap.cn（否则代理 403）",
			/const PROXY_ALLOW_HOSTS = \[[\s\S]*?"www\.taptap\.cn"[\s\S]*?\n\];/.test(idx));

		// ── 真夹具：topic p1 / p2（只保留 SSR payload，见 meta.trim）──
		const fx1 = JSON.parse(readFileSync(path.join(HERE, "fixtures", "czn-taptap-topic-p1", "response.txt.meta.json"), "utf8"));
		const fx2 = JSON.parse(readFileSync(path.join(HERE, "fixtures", "czn-taptap-topic-p2", "response.txt.meta.json"), "utf8"));
		check("p1 夹具是真抓：url = 注册地址 / status 200 / capturedAt / trim 写明只裁 HTML / bytes 可核",
			fx1.url === CZN && fx1.status === 200 && !Number.isNaN(Date.parse(fx1.capturedAt))
			&& /__NUXT_DATA__/.test(fx1.trim) && fx1.bytes > 100000, JSON.stringify([fx1.url, fx1.capturedAt, fx1.bytes]));
		check("p2 夹具是真抓：url = p1 + `&page=2`",
			fx2.url === CZN_P2 && fx2.status === 200 && !Number.isNaN(Date.parse(fx2.capturedAt))
			&& /__NUXT_DATA__/.test(fx2.trim) && fx2.bytes > 100000, JSON.stringify([fx2.url, fx2.capturedAt, fx2.bytes]));
		const p1 = fixtureBody(CZN);
		const p2 = fixtureBody(CZN_P2);
		check("p1/p2 都是真响应（含 `__NUXT_DATA__`；p1 有布蕾兹贝尔帖 / p2 有蒂菲拉帖）",
			/id="__NUXT_DATA__"/.test(p1) && /id="__NUXT_DATA__"/.test(p2)
			&& p1.includes("全新主战员「布蕾兹贝尔」") && p2.includes("常驻主战员「蒂菲拉」"),
			JSON.stringify([p1.length, p2.length]));

		// ── devalue 解码 ──
		const posts1 = B.ns_batch2_cznPostsOf(p1);
		const posts2 = B.ns_batch2_cznPostsOf(p2);
		check("p1 = 9 帖（10 个 moment，1 个 title/summary 全空的空帖跳过）/ p2 = 10 帖",
			posts1.length === 9 && posts2.length === 10, JSON.stringify([posts1.length, posts2.length]));
		check("p1 首帖逐字：id / title / created_time（源站 unix 秒 → ms）",
			posts1[0].id === "870362903092397848"
			&& posts1[0].title === "关于大龟裂功勋战段位难度反馈的说明"
			&& posts1[0].createdTs === Date.UTC(2026, 10, 13, 11, 30),
			JSON.stringify([posts1[0].id, posts1[0].title, posts1[0].createdTs]));
		check("p2 蒂菲拉帖逐字：title / summary 首行 / created_time",
			posts2[4].title === "常驻主战员「蒂菲拉」& 辅战员「蒂亚娜」营救概率提升即将开始"
			&& posts2[4].body.startsWith("-活动内容：常驻战员营救概率提升\n-概率提升时间：2026/11/04 02:00~2026/11/25 02:00（服务器时间）")
			&& posts2[4].createdTs === Date.UTC(2026, 10, 2, 3, 0),
			JSON.stringify([posts2[4].title, posts2[4].createdTs]));
		const raw = JSON.parse(B.ns_batch2_cznNuxtTextOf(p1));
		check("devalue 原文是**数组 + 数字下标引用**（`[0]`=`[\"ShallowReactive\",1]`，raw.data 是 2 而不是对象）",
			Array.isArray(raw) && Array.isArray(raw[0]) && raw[0][0] === "ShallowReactive" && raw[0][1] === 1
			&& raw[1] && typeof raw[1] === "object" && typeof raw[1].data === "number"
			&& !!B.ns_batch2_cznPayloadOf(p1).data && typeof B.ns_batch2_cznPayloadOf(p1).data === "object",
			JSON.stringify(raw.slice(0, 2)));
		check("devalue 自引用环不炸：容器先入 memo 再填（合成的 a↔b 环解出同一个对象）",
			(() => {
				const d = B.ns_batch2_cznDevalueOf(JSON.stringify([["ShallowReactive", 1], { "a": 2, "b": 2 }, ["Ref", 1]]));
				return !!d && d.a === d.b && d === d.a;
			})());

		// ── 两页 → docs（同页维护窗并集）──
		const docs = B.ns_batch2_cznDocsOf([p1, p2], CZN_NOW, "Asia/Shanghai");
		check("两页合成 19 个 doc（9 + 10）", docs.length === 19, String(docs.length));
		const maintDocs = docs.filter((d) => (d.ownMaint || []).length > 0);
		check("同页维护窗 1 条（11-11 08:00~13:00）/ 只有「赛季阶段2」那帖自己写它 / 每个 doc 都拿到同页并集",
			maintDocs.length === 1
			&& maintDocs[0].title === "赛季「凝结于雪上的约定」阶段2更新介绍"
			&& maintDocs[0].ownMaint[0].raw === "2026/11/11 08:00 ~ 2026/11/11 13:00"
			&& docs.slice(0, 9).every((d) => d.maint.length === 1)
			&& docs.slice(9).every((d) => d.maint.length === 0),
			JSON.stringify(maintDocs.map((d) => d.title)));

		// ── 卡池：「营救概率提升」帖 + 标签行 ──
		const poolsOf = (list) => {
			const out = [];
			for (const d of list) for (const p of B.ns_batch2_cznPoolsOf(d, "Asia/Shanghai", CZN_NOW)) out.push(p);
			return out;
		};
		const pools = poolsOf(docs);
		check("卡池事实 = 2 条（布蕾兹贝尔&薇薇安 / 蒂菲拉&蒂亚娜）", pools.length === 2, JSON.stringify(pools.map((x) => x.title)));
		const bz = pools.find((x) => /布蕾兹贝尔/.test(x.title)) || {};
		const tf = pools.find((x) => /蒂菲拉/.test(x.title)) || {};
		check("布蕾兹贝尔：池名 = 正文首行（公告标题那行）/ 角色只取池名里的「」",
			bz.title === "全新主战员「布蕾兹贝尔」& 辅战员「薇薇安」营救概率提升即将开始"
			&& bz.roles === "布蕾兹贝尔、薇薇安", JSON.stringify([bz.title, bz.roles]));
		check("布蕾兹贝尔：「2026/11/11 维护结束后」按**同页**维护窗映射成 11-11 13:00 +08（UTC 05:00）",
			bz.startTs === Date.UTC(2026, 10, 11, 5, 0), String(bz.startTs));
		check("布蕾兹贝尔：「2026/12/02 维护开始前」p1/p2 都没有 12-02 维护窗 ⇒ endTs 如实留空（不猜）",
			bz.endTs === null, String(bz.endTs));
		check("布蕾兹贝尔：raw 逐字 / 有一端留空 ⇒ display 原样印原文",
			bz.raw === "2026/11/11 维护结束后 ~ 2026/12/02 维护开始前" && bz.display === bz.raw,
			JSON.stringify([bz.raw, bz.display]));
		check("蒂菲拉：首行是 `-活动内容：` 列表项 ⇒ 池名退帖子标题（不是列表项）/ 角色 蒂菲拉、蒂亚娜",
			tf.title === "常驻主战员「蒂菲拉」& 辅战员「蒂亚娜」营救概率提升即将开始"
			&& tf.roles === "蒂菲拉、蒂亚娜", JSON.stringify([tf.title, tf.roles]));
		check("蒂菲拉：两端绝对 11-04 02:00 ~ 11-25 02:00（raw 逐字 / display 格式化）",
			tf.startTs === Date.UTC(2026, 10, 3, 18, 0) && tf.endTs === Date.UTC(2026, 10, 24, 18, 0)
			&& tf.raw === "2026/11/04 02:00~2026/11/25 02:00" && tf.display === "11-04 02:00 ~ 11-25 02:00",
			JSON.stringify([tf.startTs, tf.endTs, tf.raw, tf.display]));
		check("角色演示 / 主战员介绍 / 设定图 / PV 帖都不成池（正文提「营救」但标题与首行都没写）",
			docs.filter((d) => /角色演示|主战员介绍|设定图|PV/.test(d.title))
				.every((d) => B.ns_batch2_cznPoolsOf(d, "Asia/Shanghai", CZN_NOW).length === 0),
			JSON.stringify(docs.filter((d) => /角色演示|主战员介绍|设定图|PV/.test(d.title)).map((d) => d.title.slice(0, 16))));

		// ── 卡池抓取器（夹具 transport）──
		const calls = [];
		const e = engineAt(CZN_NOW, calls);
		const gp = await e.__test.GACHA_FETCHERS["czn"](s.url, undefined, s.tz);
		check("卡池抓取器返回对象（换源前 bwiki 停更 ⇒ 恒 null）", !!gp && typeof gp === "object");
		check("当期池 = 蒂菲拉&蒂亚娜（11-04~11-25 覆盖 23:00；布蕾兹贝尔终点未知 ⇒ 不算在期）",
			!!gp && gp.banner === "常驻主战员「蒂菲拉」& 辅战员「蒂亚娜」营救概率提升即将开始", JSON.stringify(gp && gp.banner));
		check("当期角色 / 档期 / 原文逐字",
			!!gp && gp.roles === "蒂菲拉、蒂亚娜"
			&& gp.bannerDates === "11-04 02:00 ~ 11-25 02:00"
			&& gp.bannerDatesRaw === "2026/11/04 02:00~2026/11/25 02:00",
			JSON.stringify([gp && gp.roles, gp && gp.bannerDates, gp && gp.bannerDatesRaw]));
		check("`gacha[]` 1 条 / source=primary / 两端 ts 明确",
			!!gp && gp.gacha.length === 1 && gp.gacha[0].source === "primary"
			&& gp.gacha[0].startTs === Date.UTC(2026, 10, 3, 18, 0) && gp.gacha[0].endTs === Date.UTC(2026, 10, 24, 18, 0),
			JSON.stringify(gp && gp.gacha));
		check("卡池侧请求 = 恰好 2 个（p1 + p2，顺序固定）；全程经代理、Referer `https://www.taptap.cn/`",
			calls.length === 2 && proxyCallsOf(calls).length === 2
			&& calls[0].url === CZN && calls[1].url === CZN_P2
			&& calls.every((c) => c.referer === "https://www.taptap.cn/"),
			JSON.stringify(calls.map((c) => c.url.slice(-20))));

		// ── 活动：维护窗 + 活动时间标签（`即日起` 锚 created_time）──
		const rowsOf = (list) => {
			const out = [];
			for (const d of list) for (const r of B.ns_batch2_cznEventRowsOf(d, "Asia/Shanghai", CZN_NOW)) out.push(r);
			return out;
		};
		const rows = rowsOf(docs);
		check("活动事实 = 2 条（小课堂「即日起」+ 同帖维护窗）", rows.length === 2, JSON.stringify(rows.map((x) => x.title)));
		const quiz = rows.find((x) => x.title === "卡厄思小课堂") || {};
		const maint = rows.find((x) => x.title === "赛季「凝结于雪上的约定」阶段2更新介绍") || {};
		check("小课堂：`即日起` 起点锚帖子 created_time（11-11 17:00 +08）/ 终点 12-01 23:59:59 +08",
			quiz.startTs === Date.UTC(2026, 10, 11, 9, 0) && quiz.endTs === Date.UTC(2026, 11, 1, 15, 59, 0),
			JSON.stringify([quiz.startTs, quiz.endTs]));
		check("小课堂：`〓活动时间〓` 标签独占一行 ⇒ 取紧随其后那一行 / raw 逐字 / display 格式化",
			quiz.raw === "即日起～2026年12月1日 23:59:59（UTC+8）" && quiz.display === "11-11 17:00 ~ 12-01 23:59",
			JSON.stringify([quiz.raw, quiz.display]));
		check("维护窗逐字：2026/11/11 08:00 ~ 2026/11/11 13:00 → 08:00 / 13:00 +08",
			maint.startTs === Date.UTC(2026, 10, 11, 0, 0) && maint.endTs === Date.UTC(2026, 10, 11, 5, 0)
			&& maint.raw === "2026/11/11 08:00 ~ 2026/11/11 13:00" && maint.display === "11-11 08:00 ~ 11-11 13:00",
			JSON.stringify([maint.startTs, maint.raw]));
		check("**营救概率提升帖不算活动**（双计守卫）：2 条里没有一条含「营救概率提升」",
			rows.every((x) => !/营救概率提升/.test(x.title)), JSON.stringify(rows.map((x) => x.title)));

		const ep = await e.__test.EVENT_FETCHERS["czn"].default(s.eventUrl, undefined, s.tz);
		check("活动侧独立再抓 2 页（**无共享缓存**）：累计 4 个请求",
			calls.length === 4 && proxyCallsOf(calls).length === 4, JSON.stringify(calls.length));
		check("活动抓取器返回对象 / 当期 = 卡厄思小课堂（12-01 终点覆盖 now；维护窗 11-11 已过）",
			!!ep && typeof ep === "object" && ep.event === "卡厄思小课堂", JSON.stringify(ep && ep.event));
		check("当期档期逐字", !!ep && ep.eventDates === "11-11 17:00 ~ 12-01 23:59"
			&& ep.eventDatesRaw === "即日起～2026年12月1日 23:59:59（UTC+8）",
			JSON.stringify([ep && ep.eventDates, ep && ep.eventDatesRaw]));
		check("`events[]` 1 条（维护窗已过 / 池帖不算活动）", !!ep && ep.events.length === 1 && ep.events[0].title === "卡厄思小课堂",
			JSON.stringify(ep && ep.events.map((x) => x.title)));
		check("卡池载荷顺手带活动字段（引擎 `reuseSameRequest` 的前提）",
			!!gp && gp.event === "卡厄思小课堂" && Array.isArray(gp.events) && gp.events.length === 1,
			JSON.stringify([gp && gp.event, gp && (gp.events || []).length]));

		// 引擎整轮（只让 czn 可见）：卡池 2 页 + 活动复用 0 请求 = 2 个 TapTap 请求。
		const calls2 = [];
		const allIds = engineAt(CZN_NOW, []).__test.SOURCES.map((x) => x.id);
		const e2 = engineAt(CZN_NOW, calls2, { hidden: allIds.filter((id) => id !== "czn"), shown: ["czn"] });
		const r = await e2.refresh();
		const rec = r.games["czn"] || {};
		check("整轮：两侧都不 fail", rec.gachaFail == null && rec.eventFail == null,
			JSON.stringify([rec.gachaFail, rec.eventFail]));
		check("整轮：TapTap 请求总数 = 2（卡池 p1+p2；活动侧复用卡池载荷 ⇒ 0）",
			calls2.length === 2 && calls2[0].url === CZN && calls2[1].url === CZN_P2,
			JSON.stringify(calls2.map((c) => c.url.slice(-20))));
		check("整轮记录：banner / roles / bannerDates / event / events 逐字",
			rec.banner === "常驻主战员「蒂菲拉」& 辅战员「蒂亚娜」营救概率提升即将开始"
			&& rec.roles === "蒂菲拉、蒂亚娜"
			&& rec.bannerDates === "11-04 02:00 ~ 11-25 02:00"
			&& rec.event === "卡厄思小课堂"
			&& (rec.events || []).length === 1 && (rec.gacha || []).length === 1,
			JSON.stringify([rec.banner, rec.roles, rec.bannerDates, rec.event, (rec.events || []).length]));
	}

	// ── ③-2 无共享缓存：每侧各 2 页；引擎同 URL 复用省掉活动侧那 2 个 ──
	section("第二批③-2：无共享缓存 —— 每侧各抓 2 页；引擎同 URL 复用只在载荷带 event 时生效");
	{
		const allIds = engineAt(CZN_NOW, []).__test.SOURCES.map((x) => x.id);
		const only = { hidden: allIds.filter((id) => id !== "czn"), shown: ["czn"] };
		const clock = { now: CZN_NOW };
		const calls = [];
		const e1 = engineWithClock(clock, calls, only);
		await e1.refresh();
		check("首轮：2 个请求（卡池 p1+p2；活动侧复用）",
			calls.length === 2 && calls[0].url === CZN && calls[1].url === CZN_P2,
			JSON.stringify(calls.map((c) => c.url.slice(-20))));
		clock.now = CZN_NOW + 29 * 1000;
		await e1.refresh();
		check("+29 s 再刷：照旧 +2 个请求（**没有** 30 s TTL 缓存了）", calls.length === 4, String(calls.length));

		const callsDirect = [];
		const eDirect = engineAt(CZN_NOW, callsDirect);
		await eDirect.__test.GACHA_FETCHERS["czn"](CZN, undefined, "Asia/Shanghai");
		check("卡池侧直接调用 = 2 个请求（p1 + p2）", callsDirect.length === 2, String(callsDirect.length));
		await eDirect.__test.EVENT_FETCHERS["czn"].default(CZN, undefined, "Asia/Shanghai");
		check("紧接着活动侧直接调用再 +2（两侧各抓各的，不共享中间结果）", callsDirect.length === 4, String(callsDirect.length));
		check("两侧同 URL 且卡池载荷带 event ⇒ 引擎整轮只 2 个请求（复用不是少一条腿）",
			calls.length === 4 && callsDirect.length === 4 && B.NS_BATCH2_CZN_PAGES === 2,
			JSON.stringify([calls.length, callsDirect.length]));
	}

	// ── ③-3 单页失败跳过 / 两页全失败才 down / 坏页不重试 ──
	section("第二批③-3：单页 500 / 坏 HTML 跳过（另一页照出数据）；两页全失败才 down");
	{
		const allIds = engineAt(CZN_NOW, []).__test.SOURCES.map((x) => x.id);
		const only = { hidden: allIds.filter((id) => id !== "czn"), shown: ["czn"] };

		// A：p1 500 ⇒ 卡池只吃 p2（蒂菲拉照常）；活动侧小课堂在 p1 ⇒ 如实 nomatch（不是 down）
		const cA = [];
		const eA = engineAt(CZN_NOW, cA, only, { fail: (u) => u === CZN });
		const recA = (await eA.refresh()).games["czn"] || {};
		check("A p1 500 ⇒ 卡池照常出蒂菲拉（只吃 p2），不 down",
			recA.gachaFail == null && recA.banner === "常驻主战员「蒂菲拉」& 辅战员「蒂亚娜」营救概率提升即将开始",
			JSON.stringify([recA.gachaFail, recA.banner]));
		check("A p1 500 ⇒ 活动侧如实 nomatch（不是 down）/ 请求 2+2 = 4",
			!!recA.eventFail && recA.eventFail.kind === "nomatch" && !recA.event
			&& cA.length === 4 && cA.filter((c) => c.url === CZN).length === 2,
			JSON.stringify([recA.eventFail, cA.length]));

		// B：p2 500 ⇒ 卡池侧当期 null（布蕾兹贝尔终点未知）⇒ nomatch；活动侧小课堂在 p1 ⇒ 照常出
		const cB = [];
		const eB = engineAt(CZN_NOW, cB, only, { fail: (u) => u === CZN_P2 });
		const recB = (await eB.refresh()).games["czn"] || {};
		check("B p2 500 ⇒ 卡池侧 nomatch（无当期），不是 down",
			!!recB.gachaFail && recB.gachaFail.kind === "nomatch" && !recB.banner,
			JSON.stringify([recB.gachaFail, recB.banner]));
		check("B p2 500 ⇒ 活动侧照常出「卡厄思小课堂」（p1 就够）/ 请求 4",
			recB.eventFail == null && recB.event === "卡厄思小课堂" && cB.length === 4,
			JSON.stringify([recB.event, cB.length]));

		// C：两页都 500 ⇒ 两侧 down；每侧只试 2 次，不重试
		const cC = [];
		const eC = engineAt(CZN_NOW, cC, only, { fail: (u) => u === CZN || u === CZN_P2 });
		const recC = (await eC.refresh()).games["czn"] || {};
		check("C 两页全 500 ⇒ 两侧都记抓取异常（down），不是静默 null",
			!!recC.gachaFail && recC.gachaFail.kind === "down" && !!recC.eventFail && recC.eventFail.kind === "down",
			JSON.stringify([recC.gachaFail, recC.eventFail]));
		check("C 两页全 500 ⇒ 请求数 2+2 = 4（每侧 2 页，没有第三次重试）",
			cC.length === 4 && cC.filter((c) => c.url === CZN).length === 2 && cC.filter((c) => c.url === CZN_P2).length === 2,
			String(cC.length));

		// D：p2 返回坏 HTML（无 `__NUXT_DATA__`）⇒ 跳过这一页，不重试；p1 照出活动
		const cD = [];
		const eD = engineAt(CZN_NOW, cD, only, { override: (u) => (u === CZN_P2 ? "<html><body>没有 payload</body></html>" : null) });
		const recD = (await eD.refresh()).games["czn"] || {};
		check("D p2 坏 HTML ⇒ 不重试（仍 2+2=4 个请求）；活动侧照常出小课堂",
			cD.length === 4 && recD.event === "卡厄思小课堂", JSON.stringify([cD.length, recD.event]));
		const cE = [];
		const eE = engineAt(CZN_NOW, cE, only, { override: (u) => (u === CZN ? "<html></html>" : null) });
		const recE = (await eE.refresh()).games["czn"] || {};
		check("D p1 坏 HTML + p2 正常 ⇒ 卡池只吃 p2 出蒂菲拉（坏页不拖垮另一页）",
			recE.gachaFail == null && recE.banner === "常驻主战员「蒂菲拉」& 辅战员「蒂亚娜」营救概率提升即将开始",
			JSON.stringify([recE.gachaFail, recE.banner]));
	}

	section("第二批③反证：关掉 decode / 关掉标签解析 ⇒ 不产出（逐条红）");
	{
		const p1 = fixtureBody(CZN);
		const p2 = fixtureBody(CZN_P2);

		// 反证 A：删掉 `__NUXT_DATA__` 脚本 = 不做 devalue 解码 ⇒ 明确抛错（不是静默 0 帖）
		const noScript = p1.replace(/<script[^>]*id="__NUXT_DATA__"[^>]*>[\s\S]*?<\/script>/, "");
		let noNuxtErr = "";
		try { B.ns_batch2_cznPostsOf(noScript); } catch (err) { noNuxtErr = String((err && err.message) || err); }
		check("反证 A：删掉 `__NUXT_DATA__`（不解码）⇒ 抛 `czn-no-nuxt`", noNuxtErr === "czn-no-nuxt", noNuxtErr);

		const docs = B.ns_batch2_cznDocsOf([p1, p2], CZN_NOW, "Asia/Shanghai");
		const bzDoc = docs.find((d) => /布蕾兹贝尔/.test(d.title));
		const tfDoc = docs.find((d) => /蒂菲拉/.test(d.title));
		const poolsOfDoc = (d) => B.ns_batch2_cznPoolsOf(d, "Asia/Shanghai", CZN_NOW);
		check("对照组：布蕾兹贝尔 / 蒂菲拉 都解析出 1 条池",
			poolsOfDoc(bzDoc).length === 1 && poolsOfDoc(tfDoc).length === 1,
			JSON.stringify([poolsOfDoc(bzDoc).length, poolsOfDoc(tfDoc).length]));

		// 反证 B：池名与标签都去掉「营救概率提升」⇒ 0 条池
		const noPool = Object.assign({}, bzDoc, {
			title: bzDoc.title.replace(/营救概率提升/g, "营救"),
			lines: bzDoc.lines.map((l) => l.replace(/营救概率提升/g, "营救").replace(/活动时间：.*$/, ""))
		});
		check("反证 B：池帖去掉「营救概率提升」（池名 + 标签）⇒ 0 条池",
			poolsOfDoc(noPool).length === 0, JSON.stringify(poolsOfDoc(noPool)));

		// 反证 C：删掉「概率提升时间：」整行 ⇒ 不成池（不拿正文里别的区间凑）
		const noLabel = Object.assign({}, tfDoc, { lines: tfDoc.lines.filter((l) => !/概率提升时间\s*[:：]/.test(l)) });
		check("反证 C：删掉「概率提升时间：」行 ⇒ 0 条池（不硬凑）",
			poolsOfDoc(noLabel).length === 0, JSON.stringify(poolsOfDoc(noLabel)));

		// 反证 D：抹掉同页维护窗（docs 层清空 maint/ownMaint）⇒ 「维护结束后/前」两端都解不出；维护活动也消失
		const docsNoMaint = docs.map((d) => Object.assign({}, d, { maint: [], ownMaint: [] }));
		const poolsNoMaint = [];
		for (const d of docsNoMaint) for (const p of poolsOfDoc(d)) poolsNoMaint.push(p);
		const rowsNoMaint = [];
		for (const d of docsNoMaint) for (const r of B.ns_batch2_cznEventRowsOf(d, "Asia/Shanghai", CZN_NOW)) rowsNoMaint.push(r);
		check("反证 D：抹掉维护窗 ⇒ 布蕾兹贝尔两端都解不出 ⇒ 只剩蒂菲拉那条池（不猜锚点）",
			poolsNoMaint.length === 1 && /蒂菲拉/.test(poolsNoMaint[0].title),
			JSON.stringify(poolsNoMaint.map((x) => x.title)));
		check("反证 D：抹掉维护窗 ⇒ 维护活动消失，活动事实只剩「卡厄思小课堂」",
			rowsNoMaint.length === 1 && rowsNoMaint[0].title === "卡厄思小课堂",
			JSON.stringify(rowsNoMaint.map((x) => x.title)));

		// 反证 E：抹掉 created_time ⇒ 「即日起」起点留空、活动载荷 null（不对 now 猜）
		const quizDoc = docs.find((d) => /卡厄思小课堂/.test(d.title));
		const quizNoCreated = Object.assign({}, quizDoc, { createdTs: null });
		const quizRows = B.ns_batch2_cznEventRowsOf(quizNoCreated, "Asia/Shanghai", CZN_NOW);
		check("反证 E：抹掉 created_time ⇒ 小课堂起点留空 / 活动载荷 null（不拿 now 当「即日起」）",
			quizRows.length === 1 && quizRows[0].startTs === null
			&& B.ns_batch2_cznEventPayloadOf(quizRows, "Asia/Shanghai", CZN_NOW) === null,
			JSON.stringify(quizRows));

		// 反证 F：池帖去掉「营救概率提升」⇒ 它的 `➤活动时间：` 才被当活动（双计守卫来自池判据）
		const bzNoKw = Object.assign({}, bzDoc, {
			title: bzDoc.title.replace(/营救概率提升/g, "营救"),
			lines: bzDoc.lines.map((l) => l.replace(/营救概率提升/g, "营救"))
		});
		const bzRows = B.ns_batch2_cznEventRowsOf(bzNoKw, "Asia/Shanghai", CZN_NOW);
		check("反证 F：池帖去掉「营救概率提升」⇒ `➤活动时间` 才变成活动（证明不是漏解析）",
			bzRows.length === 1 && bzRows[0].startTs === Date.UTC(2026, 10, 11, 5, 0) && bzRows[0].endTs === null,
			JSON.stringify(bzRows));

		// 反证 G：换源不是删源 —— bwiki 备选抓取器仍登记
		const e = engineAt(CZN_NOW, []);
		check("反证 G：bwiki 备选抓取器 `czn-bwiki` 仍登记在 GACHA_FETCHERS（停更但未删）",
			typeof e.__test.GACHA_FETCHERS["czn-bwiki"] === "function");
	}
}
