// test/cases-batch2.mjs —— 第二批接入（2026-11-11）：崩坏3 内容中台 / OurNotes 日服 SPICA / 卡厄斯 TapTap
//
// ── 本段守什么 ──
//   ① 崩坏3：注册（两侧 url/eventUrl + 来源标签 + defaultHidden 改为 false + 米游社备选源保留）；
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
import { check, section, fixtureBody, useFixtures, assertHoverConvention } from "./harness.mjs";
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
		check("defaultHidden 改为 false（两侧都有来源 ⇒ 出厂展示；2026-11-19 口径）", !!s && s.defaultHidden === false, s && String(s.defaultHidden));
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
		// ⚠️ 2026-11-26 **已批准差异**（真机《装备补给丨濯海之蕊&谐谑奇锋》）：正文**完全没写时间**的补给帖
		//    不再整条消失 —— 同批（发布日期不早于任一在期池）里它**以名称进 `gacha[]`**（ts/raw 留空），
		//    当期外显仍只从"有窗口且在期"的里挑。golden 因此从 4 条变 5 条；悬停仍是 4 口有档期的池
		//    （悬停排版要求每条都有档期）。反向证明见下面 ①-3 的「名称条目」断言与本节末尾的对照。
		check("`gacha[]` 5 条 = 4 条在期池（ts 逐条非空）+ 1 条「正文没写时间」的名称条目（濯海之蕊，ts=null）",
			!!gp && Array.isArray(gp.gacha) && gp.gacha.length === 5
			&& gp.gacha.filter((x) => x.source === "primary").length === 1
			&& gp.gacha.filter((x) => x.startTs != null && x.endTs != null).length === 4
			&& gp.gacha.find((x) => x.source === "primary").title === gp.banner,
			JSON.stringify(gp && gp.gacha.map((x) => [x.title, x.source, x.startTs])));
		check("名称条目逐字 = 「装备补给丨濯海之蕊&谐谑奇锋」，raw 空、两端 ts=null（= 档期未知这一事实，不猜窗口）",
			!!gp && (() => {
				const x = gp.gacha.find((y) => y.title === "装备补给丨濯海之蕊&谐谑奇锋");
				return !!x && x.source === "hover" && x.startTs === null && x.endTs === null && !x.raw;
			})(),
			JSON.stringify(gp && gp.gacha.filter((x) => x.startTs === null).map((x) => [x.title, x.raw])));
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
		// ⚠️ 2026-11-26 **已批准差异**：`ns_batch2_bh3EventWindowOf` 改成逐个时间标签块各取区间
		//    （原来只看**第一个**标签块）。《海正用火的声音歌唱》的第一个块是 `【开放时间】10月5日10:00`
		//    （单个时刻 ⇒ 非区间），真正的活动区间写在后面的 `【活动时间】10月5日10:00~11月26日04:00`
		//    ⇒ 旧实现把这一条整条丢掉（27 条）。新口径 28 条；反向证明见 ①-4「反证 E」。
		check("活动条目事实 = 28 条（30 条里 28 条有时间块；+1 = 海正用火的声音歌唱，它的区间在第二个标签块）",
			bh3Items.length === 28, String(bh3Items.length));
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
		check("2 条主线更新稿（正文没有**任何**时间区间）**如实不进日历**，不补时刻",
			absent.length === 2 && absent.every((t) => /主线|终章/.test(t)), JSON.stringify(absent));
		// 已批准差异的另一面：海正用火**这一条**现在进来了（区间来自第二个标签块，不是全文兜底）
		const hai = bh3Items.find((x) => x.title.startsWith("海正用火的声音歌唱")) || {};
		check("《海正用火的声音歌唱》现在有窗口：10-05 10:00 ~ 11-26 04:00 +08（区间来自后面的【活动时间】块）",
			hai.startTs === Date.UTC(2026, 9, 5, 2, 0) && hai.endTs === Date.UTC(2026, 10, 25, 20, 0)
			&& hai.raw === "10月5日10:00~11月26日04:00",
			JSON.stringify([hai.startTs, hai.endTs, hai.raw]));

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
		check("活动悬停逐字 10 行（7 条两端明确 + 3 条相对起点印原文；结束时间升序）",
			!!bh3Pay && bh3Pay.eventHover === [
				"忆旅的流彩叙映丨完成数据回顾获取水晶等奖励   09-28 10:00 ~ 11-26 04:00",
				"溯梦之行 | 七日登录领取S级角色卡等奖励   10-01 04:00 ~ 11-26 04:00",
				"海正用火的声音歌唱丨全新主线更新，参与获取携梦待曙礼盒、水晶等奖励   10-05 10:00 ~ 11-26 04:00",
				"英雄远征：神谕试炼丨参与活动得水晶、根源棱镜等奖励   10-12 10:00 ~ 11-26 04:00",
				"畅游吼姆世界：好友成群丨参与得服装自选箱、水晶等奖励   10-22 10:00 ~ 11-26 04:00",
				"银海拾忆 | 完成任务赢取手办、角色自选箱等好礼   10-22 12:00 ~ 11-26 04:00",
				"双核协战丨参与活动获取活动勋章、水晶等奖励！   11-05 10:00 ~ 11-26 04:00",
				"甜趣沙集丨参与活动获取武器&服装自选箱等奖励   9.1版本更新后~11月26日04:00",
				"行于曙光丨七日登录领圣痕自选箱、水晶等奖励   9.1版本更新后~11月26日04:00",
				"V9.1作战凭证开启   9.1版本更新后~11月26日06:00"
			].join("\n"), JSON.stringify(bh3Pay && bh3Pay.eventHover));
		check("`events[]` 10 条：7 条带绝对 ts、3 条相对起点在数组派生口径下 ts=null（已知下游口径）",
			!!bh3Pay && bh3Pay.events.length === 10
			&& bh3Pay.events.filter((x) => x.startTs != null && x.endTs != null).length === 7
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
		// **已批准差异**（2026-11-26 显示名缩短）：bh3 活动名的「丨」后面是**参与方式/奖励说明**
// （`双核协战丨参与活动获取活动勋章、水晶等奖励！`），不是名字的一部分 ⇒ 卡片外显取「丨」前那段
// （26 字 ⇒ 11 字那种量级）。规则在 `30-game-hoyoverse.js` 的 `ns_batch2_bh3EventCoreNameOf`
// （游戏专属、不进共享白名单），只由 `mergeEntryRecord` 的外显名入口调用 ⇒ 数组 title / 悬停 /
// 提醒标题仍读源站原文（上面 `eventHover` 与下面数组断言各自守一遍）。
		check("整轮记录：banner 逐字 / roles 留空 / 档期逐字 / 活动外显 = 「丨」前那段（bh3 取核心名）",
			rec.banner === "装备补给丨琉璃朱燧&泣之哲人" && rec.roles === ""
			&& rec.bannerDates === "11-06 12:00 ~ 11-26 04:00"
			&& rec.bannerDatesRaw === "11月6日12:00~11月26日04:00"
			&& rec.event === "双核协战"
			&& rec.eventDates === "11-05 10:00 ~ 11-26 04:00",
			JSON.stringify([rec.banner, rec.roles, rec.bannerDates, rec.event, rec.eventDates]));
		check("整轮记录（bh3）**已批准差异**：外显 = 原文「丨」前那段；数组主条 title / 悬停仍是原文",
			rec.event === "双核协战丨参与活动获取活动勋章、水晶等奖励！".split("丨")[0]
			&& (rec.events || []).some((x) => x.title === "双核协战丨参与活动获取活动勋章、水晶等奖励！" && x.source === "primary")
			&& (rec.eventHover || "").indexOf("双核协战丨参与活动获取活动勋章、水晶等奖励！") >= 0,
			JSON.stringify([rec.event, (rec.events || []).map((x) => x.title).slice(0, 2)]));
		check("整轮记录：gacha 5 条 / events 10 条，key 带 bh3 前缀",
			rec.gacha.length === 5 && rec.events.length === 10
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

	// ── ①-5 2026-11-26 真机：带年份终点（2027年1月8日）/ 无时间补给帖 / 多时间块 ──
	// 现场（_audit-A-raw/bh3.gacha.0.txt + bh3.event.0.txt，2026-11-26 01:53 +08 真抓）：
	//   · 《协同补给丨协同者「薇塔」》`>>开放时间 9.2版本更新后~2027年1月8日12:00`
	//   · 《度星终端迭代丨神之键「覆羽终端」》同窗口（区间写在「养成活动」段的【开放时间】）
	//   · 《装备补给丨濯海之蕊&谐谑奇锋》正文**完全没有时间**（`>>补给信息` 只有图片）
	//   · 《海正用火的声音歌唱》第一个标签块 `【开放时间】10月5日10:00` 不带区间，真区间在后面
	//   · 活动侧 5 条当期帖子终点都是 `2027年1月28日…`
	// 旧实现：终点只认 `M月D日` ⇒ 2027 那批整条消失；只看第一个标签块 ⇒ 海正用火 整条消失；
	//         无时间帖 ⇒ 整条消失。三类都钉在下面（每条都配一条反向证明）。
	section("第二批①-5：2026-11-26 真机（2027年终点 / 无时间补给帖 / 多时间块）—— 三类丢数据修复");
	{
		const G1126 = JSON.parse(fixtureBody("fixture:bh3-content-gacha-1126",
			{ "fixture:bh3-content-gacha-1126": "bh3-content-gacha-1126/response.txt" }));
		const E1126 = JSON.parse(fixtureBody("fixture:bh3-content-event-1126",
			{ "fixture:bh3-content-event-1126": "bh3-content-event-1126/response.txt" }));
		const NOW1126 = Date.parse("2026-11-26T01:53:00+08:00");
		const TZ = "Asia/Shanghai";
		// 2027-01-08 12:00 +08 = 2027-01-08 04:00Z；2027-01-28 04:00 +08 = 2027-01-27 20:00Z（V9.2作战凭证是 06:00 ⇒ 22:00Z）
		const END_2027_0108 = Date.UTC(2027, 0, 8, 4, 0);
		const END_2027_0128 = Date.UTC(2027, 0, 27, 20, 0);
		const END_2027_0128_6 = Date.UTC(2027, 0, 27, 22, 0);

		// ── 卡池：薇塔 / 覆羽终端（2027 终点）+ 濯海之蕊（无时间，只进数组） ──
		const gp = B.ns_batch2_bh3GachaPayloadOf(G1126, TZ, NOW1126);
		const gItems = (gp && gp.gachaHoverItems) || [];
		check("卡池：薇塔的窗口读出来了 —— 条目事实 raw 逐字「9.2版本更新后~2027年1月8日12:00」、endTs = 2027-01-08 12:00 +08、起点未知为空",
			!!gp && (() => {
				const x = gItems.find((y) => y.title === "协同补给丨协同者「薇塔」开放获取");
				return !!x && x.raw === "9.2版本更新后~2027年1月8日12:00" && x.startTs === null && x.endTs === END_2027_0108;
			})(),
			JSON.stringify(gItems.filter((x) => /薇塔/.test(x.title))));
		check("卡池：覆羽终端同窗口也在（区间来自「养成活动」段的【开放时间】块）",
			!!gp && (() => {
				const x = gItems.find((y) => y.title.indexOf("度星终端迭代") === 0);
				return !!x && x.endTs === END_2027_0108 && x.startTs === null;
			})(),
			JSON.stringify(gItems.filter((x) => /覆羽终端/.test(x.title))));
		check("卡池 `gacha[]` = 6 条：3 条在期（琉璃/跃升武装/跃升补给）+ 2 条 2027 终点 + 1 条无时间（濯海之蕊）",
			!!gp && gp.gacha.length === 6
			&& gp.gacha.filter((x) => x.startTs != null && x.endTs != null).length === 3
			&& gItems.filter((x) => x.endTs === END_2027_0108).length === 2,
			JSON.stringify(gp && gp.gacha.map((x) => [x.title, x.startTs, x.endTs])));
		check("无时间稿：濯海之蕊**以名称进数组**（ts=null、raw 空），当期外显仍是「琉璃朱燧」（拿不到窗口就不当外显）",
			!!gp && gp.banner === "装备补给丨琉璃朱燧&泣之哲人" && (() => {
				const x = gp.gacha.find((y) => y.title.indexOf("濯海之蕊") >= 0);
				return !!x && x.startTs === null && x.endTs === null && !x.raw;
			})(),
			JSON.stringify(gp && [gp.banner, gp.gacha.filter((x) => x.startTs === null).map((x) => x.title)]));
		check("悬停 5 口有档期的池（含薇塔/覆羽终端原文行）；濯海之蕊不进悬停（悬停每条都要有档期）",
			!!gp && String(gp.bannerHover || "").split("\n").filter((l) => /2027年1月8日12:00/.test(l)).length === 2
			&& String(gp.bannerHover || "").indexOf("濯海之蕊") < 0
			&& gItems.length === 5,
			JSON.stringify(gp && gp.bannerHover));

		// ── 活动：5 条 2027 终点 + 海正用火（第二个标签块） ──
		const items = B.ns_batch2_bh3EventItemsOf(E1126, TZ, NOW1126);
		const ep = B.ns_batch2_bh3EventPayloadOf(items, TZ, NOW1126);
		const eItems = (ep && ep.eventHoverItems) || [];
		check("活动：4 条「2027年1月28日」终点的帖子全在（游羽欣临 / 星愿祈礼 / 旧日来客 04:00；V9.2作战凭证 06:00）",
			!!ep && ["游羽欣临", "星愿祈礼", "旧日来客"].every((k) =>
				eItems.some((x) => x.title.indexOf(k) === 0 && x.endTs === END_2027_0128)
				&& (ep.events || []).some((x) => x.title.indexOf(k) === 0))
			&& eItems.some((x) => x.title.indexOf("V9.2作战凭证") === 0 && x.endTs === END_2027_0128_6),
			JSON.stringify(eItems.map((x) => [x.title.slice(0, 8), x.endTs])));
		check("活动：《海正用火的声音歌唱》在（区间来自第二个标签块 10月5日10:00~11月26日04:00，不是全文兜底）",
			!!ep && eItems.some((x) => x.title.indexOf("海正用火的声音歌唱") === 0
				&& x.startTs === Date.UTC(2026, 9, 5, 2, 0) && x.endTs === Date.UTC(2026, 10, 25, 20, 0)),
			JSON.stringify(eItems.filter((x) => /海正/.test(x.title))));
		check("活动 `events[]` = 15 条（= 审计现场「10 条 + 缺的 5 条」），含 2027/01/28 终点 3+1 条 + 海正用火",
			!!ep && ep.events.length === 15 && eItems.length === 15
			&& eItems.filter((x) => x.endTs === END_2027_0128).length === 3
			&& eItems.filter((x) => x.endTs === END_2027_0128_6).length === 1,
			JSON.stringify(ep && [ep.events.length, eItems.filter((x) => x.endTs === END_2027_0128).length]));
		check("反向证明：已结束的《周年累消》（10-05~11-06）**不在** events[]（过期的窗口不当当期事实）",
			!!ep && (ep.events || []).every((x) => x.title.indexOf("周年累消") < 0),
			JSON.stringify(ep && (ep.events || []).map((x) => x.title.slice(0, 8))));

		// ── 反向证明（纯函数）：三处修复各自都是必需的 ──
		// 旧式相对区间正则（起点标签 + 终点只认 M月D日）—— 对 2027 那条整段匹配不上
		const OLD_REL_RE = /(?:\d+(?:\.\d+)?\s*版本更新后|版本更新后|维护后|更新后|开服后)\s*[~～\-–—]\s*(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/;
		check("反向证明①（带年份终点）：旧式「版本更新后~M月D日」正则解不了「~2027年1月8日12:00」（匹配为 null）",
			OLD_REL_RE.exec("9.2版本更新后~2027年1月8日12:00") === null
			&& B.ns_batch2_bh3RangeOf("9.2版本更新后~2027年1月8日12:00", { y: 2026, mo: 11, d: 24, h: 18, mi: 0 }, TZ).endTs === END_2027_0108);
		check("反向证明②（端点年份写了两端）：`2026年12月30日12:00~2027年1月5日12:00` 按显式年份解（不再按「结束月日靠前」推次年）",
			(() => {
				const w = B.ns_batch2_bh3RangeOf("2026年12月30日12:00~2027年1月5日12:00", { y: 2026, mo: 11 }, TZ);
				return !!w && w.startTs === Date.UTC(2026, 11, 30, 4, 0) && w.endTs === Date.UTC(2027, 0, 5, 4, 0);
			})(),
			JSON.stringify(B.ns_batch2_bh3RangeOf("2026年12月30日12:00~2027年1月5日12:00", { y: 2026, mo: 11 }, TZ)));
		const haiItem = E1126.data.list.find((x) => String(x.sTitle).indexOf("海正用火的声音歌唱") === 0);
		const haiText = B.ns_batch2_bh3Text(haiItem.sContent);
		const haiHint = B.ns_batch2_bh3WallOf(haiItem.dtStartTime);
		check("反向证明③（多时间块）：海正用火的**第一个**标签块没有区间（旧实现只看它 ⇒ 整条丢），逐个块取就有",
			B.ns_batch2_bh3RangesOf(B.ns_batch2_bh3EventBlockOf(haiText), haiHint, TZ).length === 0
			&& B.ns_batch2_bh3EventRangesOf(haiText, haiHint, TZ).length >= 1
			&& B.ns_batch2_bh3EventWindowOf(haiText, haiHint, TZ, NOW1126).startTs === Date.UTC(2026, 9, 5, 2, 0),
			JSON.stringify([B.ns_batch2_bh3EventBlockOf(haiText).slice(0, 20), B.ns_batch2_bh3EventRangesOf(haiText, haiHint, TZ).length]));
		// 反向证明④（无窗口条目的范围）：把濯海之蕊的发布日期挪到半年前 ⇒ 它不属于"同一批" ⇒ 不被打进数组
		const OLD = JSON.parse(JSON.stringify(G1126));
		OLD.data.list.find((x) => String(x.sTitle).indexOf("濯海之蕊") >= 0).dtStartTime = "2026-06-01 18:00:00";
		const gpOld = B.ns_batch2_bh3GachaPayloadOf(OLD, TZ, NOW1126);
		check("反向证明④（同批范围）：半年前那条无时间帖**不**被带出来（gacha[] 回到 5 条，濯海不在）",
			!!gpOld && gpOld.gacha.length === 5 && gpOld.gacha.every((x) => x.title.indexOf("濯海之蕊") < 0),
			JSON.stringify(gpOld && gpOld.gacha.map((x) => x.title)));
	}

	// ═══════════════════ ② OurNotes 日服 SPICA ═══════════════════
	section("第二批②：OurNotes 日服卡池 —— SPICA（列表→前 5 条详情 / 開催期間 / pickup）");
	{
		const s = T.SOURCES.find((x) => x.id === "ournotes") || null;
		check("卡池 url = SPICA 列表（此前该侧无来源）", !!s && s.url === SPICA_LIST, s && String(s.url));
		check("卡池来源标签 = SPICA", !!s && s.source === B.NS_BATCH2_SPICA_SOURCE_LABEL, s && s.source);
		check("活动侧默认源 = SPICA 活动页（2026-11-26 审计 B 换源；此前是 bushimo WP 公告）",
			!!s && s.eventUrl === "https://spica.wiki/ournotes/events" && s.eventSource === "SPICA",
			s && JSON.stringify([s.eventUrl, s.eventSource]));
		check("旧 bushimo WP 源降为**手动备选**（标签「官方公告（日文）」/ fetcher `ournotes-bushimo` 已登记）",
			!!s && (s.eventAltSources || []).length === 1
			&& s.eventAltSources[0].url === "https://bang-dream-on.bushimo.jp/wp-json/wp/v2/posts?per_page=20&page=1"
			&& s.eventAltSources[0].label === "官方公告（日文）"
			&& s.eventAltSources[0].fetcher === "ournotes-bushimo"
			&& typeof (T.EVENT_FETCHERS["ournotes"] || {})["ournotes-bushimo"] === "function",
			s ? JSON.stringify(s.eventAltSources) : "缺失");
		check("tz = Asia/Tokyo / defaultHidden 改为 false（与同款其它服一致）",
			!!s && s.tz === "Asia/Tokyo" && s.defaultHidden === false, s && JSON.stringify([s.tz, s.defaultHidden]));
		// ── 2026-11-17 用户口径（真机 bug 修复）：没有任何「覆盖 now」的区间时 ⇒ **null（nomatch）**，
		//    不再 fallback 到"最新一篇的区间"（那会把已结束的活动当当期外显，且 eventFail=null 不会提示沿用）。
		// ⚠️ 2026-11-26：活动默认源已换成 SPICA 活动页 ⇒ 这一段改走**旧 bushimo 备选源**（它才是本段要守的
		//    那个"没有区间覆盖 now 就 null"的解析器；降为备选后仍要能用）。
		{
			const alt = (s.eventAltSources || []).find((a) => a.fetcher === "ournotes-bushimo");
			const e2 = engineAt(NOW + 400 * 864e5, []);   // 固定夹具的所有区间都已过去
			let fb = undefined, err = null;
			try { fb = await e2.__test.EVENT_FETCHERS["ournotes"]["ournotes-bushimo"](alt.url, undefined, s.tz, NOW + 400 * 864e5); } catch (x) { err = x; }
			check("活动侧（无区间覆盖 now）：不抛错", err === null, err && err.message);
			check("活动侧（无区间覆盖 now）：返回 null（nomatch），不拿过期活动顶",
				fb === null, JSON.stringify(fb));
		}

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

	// ── 2026-11-26（活网审计 B）：活动默认源 = **SPICA 活动页**（列表 → 每期详情 `開催期間`）──
	section("第二批②B：OurNotes 日服活动 —— SPICA 活动页（列表 → 详情 開催期間 / 当期 きみはまるくん）");
	{
		const EV_LIST = B.NS_BATCH2_SPICA_EVENTS_URL;
		const EV_DETAIL = B.NS_BATCH2_SPICA_EVENT_DETAIL_BASE;
		// 审计当天时刻（2026-11-26 02:52 +08）：当期 = きみはまるくん 11-18 15:00 ~ 11-27 14:59（JST）
		const NOW_EV = Date.parse("2026-11-26T02:52:37+08:00");
		const s = T.SOURCES.find((x) => x.id === "ournotes") || null;

		// ① 列表：6 期、只有名称（日期必须进详情页）
		const ids = B.ns_batch2_spicaEventIdsOf(fixtureBody(EV_LIST));
		check("活动列表解析出 6 期（源站顺序；首期 = きみはまるくん）",
			ids.length === 6 && ids[0].id === "you-re-maru-kun" && ids[0].title === "きみはまるくん",
			JSON.stringify(ids.slice(0, 2)));
		check("列表本身**没有日期**（与卡池列表同形态 ⇒ 必须进详情页拿）",
			ids.every((x) => x.title && !/\d{4}\.\d{1,2}\.\d{1,2}/.test(x.title)),
			JSON.stringify(ids.map((x) => x.title.slice(0, 12))));

		// ② 详情：名称 + 開催期間（源站原文 / 补全 display / 绝对时刻）
		const d = B.ns_batch2_spicaEventDetailOf(fixtureBody(EV_DETAIL + "you-re-maru-kun"), "Asia/Tokyo");
		check("详情 きみはまるくん：名称逐字 + 源站原文「2026.11.18 15:00 – 2026.11.27 14:59」",
			d.title === "きみはまるくん" && d.raw === "2026.11.18 15:00 – 2026.11.27 14:59",
			JSON.stringify([d.title, d.raw]));
		check("详情补全文本 = 「11-18 15:00 ~ 11-27 14:59」（按条目 tz=JST 渲染源站墙钟）",
			d.display === "11-18 15:00 ~ 11-27 14:59", JSON.stringify(d.display));
		check("startTs = 2026-11-18 15:00 JST（UTC 06:00）/ endTs = 2026-11-27 14:59 JST（UTC 05:59）",
			d.startTs === Date.UTC(2026, 10, 18, 6, 0) && d.endTs === Date.UTC(2026, 10, 27, 5, 59),
			JSON.stringify([d.startTs, d.endTs]));

		// ③ 窗口解析：**终点省略年份**的 `M.DD HH:MM` 写法也要解对（起点年补齐；跨年回绕 +1 年）
		{
			const w1 = B.ns_batch2_spicaEventWindowOf("2026.11.18 15:00 – 11.27 14:59", "Asia/Tokyo");
			check("M.DD 写法（终点省年）：`2026.11.18 15:00 – 11.27 14:59` ⇒ 与带年写法同一对绝对时刻",
				w1.startTs === d.startTs && w1.endTs === d.endTs, JSON.stringify(w1));
			const w2 = B.ns_batch2_spicaEventWindowOf("2026.12.28 – 01.05", "Asia/Tokyo");
			check("跨年回绕：`2026.12.28 – 01.05` ⇒ 终点在 2027-01-05（只有日期 ⇒ 起 00:00 / 止 23:59）",
				w2.startTs === Date.UTC(2026, 11, 27, 15, 0) && w2.endTs === Date.UTC(2027, 0, 5, 14, 59),
				JSON.stringify([w2.startTs, w2.endTs]));
			const w3 = B.ns_batch2_spicaEventWindowOf("未定", "Asia/Tokyo");
			check("反证：`未定` ⇒ 两端 null（不编时刻）", w3.startTs === null && w3.endTs === null, JSON.stringify(w3));
		}

		// ④ 抓取器（夹具）：外显 / 悬停 / 数组 / 请求量 / 代理
		{
			const calls = [];
			const e = engineAt(NOW_EV, calls);
			const ev = await e.__test.EVENT_FETCHERS["ournotes"].default(s.eventUrl, undefined, s.tz);
			check("活动抓取器返回对象；外显 = きみはまるくん / 档期 = 11-18 15:00 ~ 11-27 14:59",
				!!ev && ev.event === "きみはまるくん" && ev.eventDates === "11-18 15:00 ~ 11-27 14:59",
				JSON.stringify(ev && [ev.event, ev.eventDates]));
			check("源站原文 eventDatesRaw 逐字（raw 与 display 分开）",
				!!ev && ev.eventDatesRaw === "2026.11.18 15:00 – 2026.11.27 14:59", JSON.stringify(ev && ev.eventDatesRaw));
			check("`events[]` 1 条 = 当期（primary）+ tz Asia/Tokyo + 绝对时刻",
				!!ev && Array.isArray(ev.events) && ev.events.length === 1
				&& ev.events[0].source === "primary" && ev.events[0].tz === "Asia/Tokyo"
				&& ev.events[0].startTs === d.startTs && ev.events[0].endTs === d.endTs,
				JSON.stringify(ev && ev.events && ev.events.map((x) => [x.title, x.startTs, x.endTs])));
			check("只有 1 条在期 ⇒ 不设 eventHover（交回 UI 默认两行式）",
				!!ev && ev.eventHover === void 0, JSON.stringify(ev && ev.eventHover));
			const listCalls = calls.filter((c) => /\/ournotes\/events$/.test(c.url));
			const detailCalls = calls.filter((c) => /\/ournotes\/event\/[A-Za-z0-9_-]+$/.test(c.url));
			check("请求 = 列表 1 次 + 详情 6 次（MAX_DETAILS=6；不是抓全站 / 不是 0 次）",
				listCalls.length === 1 && detailCalls.length === 6 && B.NS_BATCH2_SPICA_EVENT_MAX_DETAILS === 6,
				JSON.stringify([listCalls.length, detailCalls.length]));
			check("全程经代理、带 Referer `https://spica.wiki/`",
				proxyCallsOf(calls).length === calls.length && calls.every((c) => c.referer === "https://spica.wiki/"),
				JSON.stringify(calls.slice(0, 2)));

			// 反证：此刻全部活动都已结束（2026-12-20）⇒ null（不拿过期活动顶）
			const eLate = engineAt(Date.parse("2026-12-20T00:00:00+08:00"), []);
			let late;
			try { late = await eLate.__test.EVENT_FETCHERS["ournotes"].default(s.eventUrl, undefined, s.tz); }
			catch (err) { late = "throw:" + err.message; }
			check("反证：所有期次都已结束 ⇒ 抓取器如实 null（nomatch，不是抛错）", late === null, JSON.stringify(late));
		}
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
		check("tz = Asia/Shanghai / defaultHidden 改为 false", !!s && s.tz === "Asia/Shanghai" && s.defaultHidden === false,
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
			rec.banner === "常驻主战员「蒂菲拉」& 辅战员「蒂亚娜」营救概率提升"
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
			recA.gachaFail == null && recA.banner === "常驻主战员「蒂菲拉」& 辅战员「蒂亚娜」营救概率提升",
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

		// C：两页都 500 ⇒ 两侧 down。HTTP 500 属**瞬时失败** ⇒ 调度层会退避后重试该条目
		// （2026-11-17 起；2026-11-18 起瞬时类（超时 / 网络 / http-5xx）**最多重试 2 次**，见
		// 50-refresh.js 的 runEntriesWithDeadline / retryClassOf）。
		// 这里守的仍是**页级不重试**：每一侧每次尝试只抓 p1 + p2 两页，没有第三次页请求。
		// 于是总请求 = 3 次尝试 × 2 侧 × 2 页 = 12，每个 URL 恰好 6 次（不是 8 次，也不是无限重试）。
		const cC = [];
		const eC = engineAt(CZN_NOW, cC, only, { fail: (u) => u === CZN || u === CZN_P2 });
		const recC = (await eC.refresh()).games["czn"] || {};
		check("C 两页全 500 ⇒ 两侧都记抓取异常（down），不是静默 null",
			!!recC.gachaFail && recC.gachaFail.kind === "down" && !!recC.eventFail && recC.eventFail.kind === "down",
			JSON.stringify([recC.gachaFail, recC.eventFail]));
		check("C 两页全 500 ⇒ 请求数 12（每侧每轮 2 页 × 瞬时类重试 2 次 = 3 次尝试；没有页级第三次重试）",
			cC.length === 12 && cC.filter((c) => c.url === CZN).length === 6 && cC.filter((c) => c.url === CZN_P2).length === 6,
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
			recE.gachaFail == null && recE.banner === "常驻主战员「蒂菲拉」& 辅战员「蒂亚娜」营救概率提升",
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

	// ═══════════════════ ④ 白荆回廊（bjhl）—— bwiki 两个页面 ═══════════════════
	section("白荆回廊 ④：bwiki「历史卡池一览」+「活动一览」（注册 / 逐字档期 / 角色去重 / 请求数 / 反证）");
	{
		// 夹具原文（不走 transport）：给"看响应长什么样 + 造变异"用
		const bjhlGachaRaw = fixtureBody("fixture:bjhl-gacha", { "fixture:bjhl-gacha": "bjhl-gacha/response.txt" });
		const bjhlEventsRaw = fixtureBody("fixture:bjhl-events", { "fixture:bjhl-events": "bjhl-events/response.txt" });
		const bjhlGachaHtml = JSON.parse(bjhlGachaRaw).parse.text;
		const bjhlEventsJson = JSON.parse(bjhlEventsRaw);
		const BJ = T.parsers.bwiki;
		// 夹具抓取时刻（2026-11-15 00:15 +08）
		const NOW_BJHL = Date.parse("2026-11-15T00:15:14+08:00");

		// ── 注册项 ──
		{
			const s = T.SOURCES.find((x) => x.id === "bjhl") || null;
			check("条目已存在（id = bjhl）", !!s, s ? s.id : "缺失");
			check("名称 = 白荆回廊", !!s && s.name === "白荆回廊", s && s.name);
			check("tz = Asia/Shanghai（源站墙钟 = 国服）", !!s && s.tz === "Asia/Shanghai", s && String(s.tz));
			check("defaultHidden = false（出厂展示）", !!s && s.defaultHidden === false, s && String(s.defaultHidden));
			check("有游戏主题色（#rrggbb）", !!s && /^#[0-9A-Fa-f]{6}$/.test(String(s.color)), s && String(s.color));
			check("卡池 url = bwiki `历史卡池一览`（page= 逐字，prop=text / formatversion=2）",
				!!s && s.url === BJ.BJHL_GACHA_URL && /page=历史卡池一览&/.test(s.url), s && String(s.url));
			check("活动 eventUrl = bwiki SMW `action=ask`（`分类:活动` + 四列 printout + limit=500）",
				!!s && s.eventUrl === BJ.BJHL_EVENTS_URL && /action=ask/.test(s.eventUrl)
				&& /%E5%88%86%E7%B1%BB%3A%E6%B4%BB%E5%8A%A8/.test(s.eventUrl),
				s && String(s.eventUrl));
			check("来源标签 = 「Bwiki 历史卡池」/「Bwiki 活动一览」（逐字）",
				!!s && s.source === "Bwiki 历史卡池" && s.eventSource === "Bwiki 活动一览",
				s && JSON.stringify([s.source, s.eventSource]));
			const e0 = engineAt(NOW_BJHL, []);
			check("两侧抓取器都登记（GACHA_FETCHERS.bjhl / EVENT_FETCHERS.bjhl.default）",
				typeof e0.__test.GACHA_FETCHERS["bjhl"] === "function"
				&& !!(e0.__test.EVENT_FETCHERS["bjhl"] && typeof e0.__test.EVENT_FETCHERS["bjhl"].default === "function"));
		}

		// ── 纯解析：10 张卡（夹具裁到前 10 张：11-19 未来池 + 11-05 三张在期 + 往期边界）──
		{
			const items = BJ.parseBjhlGacha(bjhlGachaHtml, BJ.BJHL_TZ);
			check("卡池页解出 10 张卡（夹具 = 原页前 10 张）", items.length === 10, String(items.length));
			check("首卡 = 常态共鸣·红珠小姐 / 2026.11.19 04:00 ~ 12.03 03:50（**未来池**，源站原文照录）",
				items[0] && items[0].banner === "常态共鸣·红珠小姐" && items[0].raw === "2026.11.19 04:00 ~ 2026.12.03 03:50",
				JSON.stringify(items[0] && [items[0].banner, items[0].raw]));
			check("首卡绝对时刻 = UTC 11-18 20:00 / UTC 12-02 19:50（+08 → UTC 换算对）",
				items[0] && items[0].startTs === Date.UTC(2026, 10, 18, 20, 0) && items[0].endTs === Date.UTC(2026, 11, 2, 19, 50),
				JSON.stringify(items[0] && [items[0].startTs, items[0].endTs]));
			// 角色：`同调者/…` 链接；池名已写的角色**只去掉不重复**
			check("常态共鸣·红珠小姐 的角色为空（池名已含「红珠小姐」⇒ 只去掉，不改写）",
				items[0] && items[0].roles === "", JSON.stringify(items[0] && items[0].roles));
			const gobi = items.find((x) => x.banner === "去往彼岸");
			check("去往彼岸 的角色 = 伊琅相思、无咎、罗咤、吉娜（4 个同调者链接原序）",
				!!gobi && gobi.roles === "伊琅相思、无咎、罗咤、吉娜", gobi && gobi.roles);
			const sail = items.find((x) => x.banner === "启明潜航·伊琅相思 昊苍 红珠小姐");
			check("启明潜航（记忆烙痕池）角色为空串 —— 只有 `记忆烙痕/…` 链接，不拿它冒充角色",
				!!sail && sail.roles === "", sail && JSON.stringify(sail.roles));
			check("`bjhlRolesOf` 直接吃掉池名里的角色、保留其它（纯函数反证）",
				BJ.bjhlRolesOf('<a title="同调者/甲"></a><a title="同调者/乙"></a>', "常态共鸣·甲") === "乙",
				BJ.bjhlRolesOf('<a title="同调者/甲"></a><a title="同调者/乙"></a>', "常态共鸣·甲"));
		}

		// ── 卡池载荷（引擎路径）：外显 = 结束最早的**在期**池，未来池不进 ──
		{
			const calls = [];
			const e = engineAt(NOW_BJHL, calls);
			const s = e.__test.SOURCES.find((x) => x.id === "bjhl");
			const g = await e.__test.GACHA_FETCHERS["bjhl"](s.url, undefined, s.tz);
			check("卡池抓取器返回对象", !!g && typeof g === "object");
			check("外显池 = 常态共鸣·昊苍（在期池里结束最早：11-19 03:50）",
				g && g.banner === "常态共鸣·昊苍", JSON.stringify(g && g.banner));
			check("外显角色为空（同批只有它自己；角色已在池名里）", g && g.roles === "", JSON.stringify(g && g.roles));
			check("档期 = 「11-05 10:00 ~ 11-19 03:50」", g && g.bannerDates === "11-05 10:00 ~ 11-19 03:50", JSON.stringify(g && g.bannerDates));
			check("源站原文 = 「2026.11.05 10:00 ~ 2026.11.19 03:50」（只保留一份原文，不与补全文本混用）",
				g && g.bannerDatesRaw === "2026.11.05 10:00 ~ 2026.11.19 03:50", JSON.stringify(g && g.bannerDatesRaw));
			check("startTs / endTs = UTC 11-05 02:00 / UTC 11-18 19:50",
				g && g.startTs === Date.UTC(2026, 10, 5, 2, 0) && g.endTs === Date.UTC(2026, 10, 18, 19, 50),
				JSON.stringify(g && [g.startTs, g.endTs]));
			const arr = (g && g.gacha) || [];
			check("gacha[] = 3 条（主条 + 2 个并列条），key 前缀 = bjhl:gacha",
				arr.length === 3 && arr.every((x) => String(x.key).indexOf("bjhl:gacha:") === 0),
				JSON.stringify(arr.map((x) => x.key)));
			check("gacha[] 逐条标题 = 昊苍 / 去往彼岸：4 角色 / 启明潜航…（与悬停同序同源）",
				arr.length === 3 && arr[0].title === "常态共鸣·昊苍"
				&& arr[1].title === "去往彼岸：伊琅相思、无咎、罗咤、吉娜"
				&& arr[2].title === "启明潜航·伊琅相思 昊苍 红珠小姐",
				JSON.stringify(arr.map((x) => x.title)));
			check("**未来池不进数组**（常态共鸣·红珠小姐 11-19 才开）",
				arr.every((x) => x.title !== "常态共鸣·红珠小姐"), JSON.stringify(arr.map((x) => x.title)));
			check("悬停逐字（3 池 × 名称 + 档期两行；未来池不在里面）",
				g && g.bannerHover === "常态共鸣·昊苍\n11-05 10:00 ~ 11-19 03:50\n去往彼岸：伊琅相思、无咎、罗咤、吉娜\n11-05 10:00 ~ 12-03 03:50\n启明潜航·伊琅相思 昊苍 红珠小姐\n11-05 10:00 ~ 12-03 03:50",
				JSON.stringify(g && g.bannerHover));
			check("悬停合规（只含名称与档期）", assertHoverConvention("bjhl 卡池", g && g.bannerHover, { requireSet: true }) !== false);
			check("**1 个请求**：两个页面另一侧才算，本侧只打 `历史卡池一览`",
				calls.length === 1 && calls[0].via === "proxy" && /page=历史卡池一览/.test(calls[0].url),
				JSON.stringify(calls.map((c) => c.url.slice(0, 70))));
			check("bwiki 请求带 `origin=*` + `Referer: https://wiki.biligame.com/`（否则会被 WAF 回 567）",
				calls.length === 1 && /[?&]origin=\*/.test(calls[0].url) && calls[0].referer === "https://wiki.biligame.com/",
				JSON.stringify(calls[0]));
		}

		// ── 活动载荷（SMW ask：四列 printout，一次拿全）──
		{
			const calls = [];
			const e = engineAt(NOW_BJHL, calls);
			const s = e.__test.SOURCES.find((x) => x.id === "bjhl");
			const d = await e.__test.EVENT_FETCHERS["bjhl"].default(s.eventUrl, undefined, s.tz);
			check("活动抓取器返回对象", !!d && typeof d === "object");
			check("在期活动 = 破限·伊琅相思（11-05 10:00 ~ 12-03 03:50）",
				d && d.event === "破限·伊琅相思", JSON.stringify(d && d.event));
			check("活动档期 = 「11-05 10:00 ~ 12-03 03:50」/ 原文带秒「2026-11-05 10:00:00 ~ 2026-12-03 03:50:00」",
				d && d.eventDates === "11-05 10:00 ~ 12-03 03:50"
				&& d.eventDatesRaw === "2026-11-05 10:00:00 ~ 2026-12-03 03:50:00",
				JSON.stringify(d && [d.eventDates, d.eventDatesRaw]));
			check("events[] = 1 条（夹具 8 行里只有这一期覆盖当期；其余 7 行不进）",
				!!d && Array.isArray(d.events) && d.events.length === 1
				&& d.events[0].title === "破限·伊琅相思" && d.events[0].startTs === Date.UTC(2026, 10, 5, 2, 0),
				JSON.stringify(d && (d.events || []).map((x) => [x.title, x.startTs])));
			check("只有 1 条在期 ⇒ 不设 eventHover（交回 UI 单条两行式）", d && d.eventHover === void 0, JSON.stringify(d && d.eventHover));
			check("**1 个请求**：本侧只打一次 `action=ask`（`offset` 未触发）",
				calls.length === 1 && /action=ask/.test(calls[0].url),
				JSON.stringify(calls.map((c) => c.url.slice(0, 70))));
			check("bwiki 请求带 `origin=*` + `Referer: https://wiki.biligame.com/`（否则会被 WAF 回 567）",
				calls.length === 1 && /[?&]origin=\*/.test(calls[0].url) && calls[0].referer === "https://wiki.biligame.com/",
				JSON.stringify(calls[0]));
		}

		// ── 活动纯解析（ask JSON → 条目事实；HTML 那套断言换成 JSON）──
		{
			const items = BJ.parseBjhlEvents(bjhlEventsJson, BJ.BJHL_TZ);
			check("活动 ask 解出 8 条（夹具 = 原 55 行裁剪）", items.length === 8, String(items.length));
			const cur = items.find((x) => x.event === "破限·伊琅相思");
			check("在期那条：startTs / endTs = UTC 11-05 02:00 / UTC 12-02 19:50",
				!!cur && cur.startTs === Date.UTC(2026, 10, 5, 2, 0) && cur.endTs === Date.UTC(2026, 11, 2, 19, 50),
				JSON.stringify(cur && [cur.startTs, cur.endTs]));
			check("`raw` = 两列原文拼回 `起 ~ 止`（与旧 HTML 的同一条逐字相同）",
				!!cur && cur.raw === "2026-11-05 10:00:00 ~ 2026-12-03 03:50:00", JSON.stringify(cur && cur.raw));
			check("`category` = `活动类型`（普通活动）", !!cur && cur.category === "普通活动", JSON.stringify(cur && cur.category));
			const cross = items.find((x) => x.event.indexOf("中国国家地理") >= 0);
			check("页名 ≠ 活动名称：取 `活动名称`（不是页名 `「寻花异旅，此世同行」`）",
				!!cross && cross.event === "白荆回廊 × 中国国家地理·图书「寻花异旅，此世同行」",
				JSON.stringify(cross && cross.event));
			check("四类 `活动类型` 都进了 `category`（普通 / 主题 / 联动 / 测试 各至少 1 条）",
				["普通活动", "主题活动", "联动活动", "测试"].every((t) => items.some((x) => x.category === t)),
				JSON.stringify([...new Set(items.map((x) => x.category))]));
		}

		// ── 反证 ①：抹掉起止正则的关键锚点（终点日期）⇒ 那一张卡解不出 ⇒ 该条不进外显/数组 ──
		{
			// bwiki 的窗口解析要**两个日期点**（`ns_bwiki_DATE_RE` 认 `YYYY.MM.DD`）：
			// 抹掉终点那一刻，这张卡就只剩一个点 ⇒ 整条丢弃。
			// （只抹 ` ~ ` 连接号是**无效**反证 —— 该解析器不要求连接号，第一次就是这么假绿的。）
			const mutated = bjhlGachaHtml.replace(/2026\.11\.19\s+03:50/, "待定");
			const items = BJ.parseBjhlGacha(mutated, BJ.BJHL_TZ);
			check("反证：抹掉终点日期 ⇒ 该卡解不出（9 张），`常态共鸣·昊苍` 不在解析结果里",
				items.length === 9 && !items.some((x) => x.banner === "常态共鸣·昊苍"),
				JSON.stringify([items.length, items.map((x) => x.banner)]));
			const tr = makeTransport([], { override: () => JSON.stringify({ parse: { text: mutated } }) });
			const e = createEngine({ transport: tr, storage: makeStore(), now: () => NOW_BJHL, timer: { setTimeout, clearTimeout } });
			const s = e.__test.SOURCES.find((x) => x.id === "bjhl");
			const g = await e.__test.GACHA_FETCHERS["bjhl"](s.url, undefined, s.tz);
			check("反证：外显换人 = 去往彼岸（抹掉的那条不进外显，而不是硬凑原值）",
				g && g.banner === "去往彼岸", JSON.stringify(g && g.banner));
			check("反证：gacha[] 里没有 常态共鸣·昊苍（数组与悬停同源）",
				g && (g.gacha || []).every((x) => x.title !== "常态共鸣·昊苍"),
				JSON.stringify(g && (g.gacha || []).map((x) => x.title)));
		}

		// ── 反证 ②：响应换成 `{}` / 空 HTML ⇒ **抛错**（抓取失败，不是 nomatch）──
		{
			const grab = async (body) => {
				const tr = makeTransport([], { override: () => body });
				const e = createEngine({ transport: tr, storage: makeStore(), now: () => NOW_BJHL, timer: { setTimeout, clearTimeout } });
				const s = e.__test.SOURCES.find((x) => x.id === "bjhl");
				let err = null, data;
				try { data = await e.__test.GACHA_FETCHERS["bjhl"](s.url, undefined, s.tz); } catch (e2) { err = e2; }
				return { err, data };
			};
			const r1 = await grab("{}");
			check("反证：卡池响应 `{}` ⇒ 抛错（`bad-json`），不是返回 null", !!r1.err && /bad-json/.test(r1.err.message), JSON.stringify(r1.err && r1.err.message));
			const r2 = await grab('{"parse":{"text":""}}');
			check("反证：卡池 `parse.text` 是空串 ⇒ 抛错（`bjhl-gacha-changed:no-cards`）",
				!!r2.err && /bjhl-gacha-changed/.test(r2.err.message), JSON.stringify(r2.err && r2.err.message));
			// 卡片 class 改名（源站改版）：先改 HTML 再封成 JSON —— 直接对 JSON.stringify 的结果做替换
			// 会因为内层引号被转义成 `\"` 而**静默不命中**（本用例第一次就是这么假绿的）
			const renamed = bjhlGachaHtml.replace(/class="draw-box[^"]*"/g, 'class="x"');
			const r3 = await grab(JSON.stringify({ parse: { text: renamed } }));
			check("反证：卡片 class 改名（源站改版）⇒ 抛错（不是「当期没有」）", !!r3.err && /no-cards/.test(r3.err.message),
				JSON.stringify([r3.err && r3.err.message, renamed.length !== bjhlGachaHtml.length]));
			// 活动侧同一条：{} ⇒ 抛
			const trA = makeTransport([], { override: () => "{}" });
			const eA = createEngine({ transport: trA, storage: makeStore(), now: () => NOW_BJHL, timer: { setTimeout, clearTimeout } });
			const sA = eA.__test.SOURCES.find((x) => x.id === "bjhl");
			let errA = null;
			try { await eA.__test.EVENT_FETCHERS["bjhl"].default(sA.eventUrl, undefined, sA.tz); } catch (e2) { errA = e2; }
			check("反证：活动响应 `{}` ⇒ 抛错（`bjhl-events-changed:bad-json`，不是 nomatch）",
				!!errA && /bjhl-events-changed/.test(errA.message), JSON.stringify(errA && errA.message));
			check("夹具本身是真抓的 bwiki SMW ask JSON（`query.results` 每条带四列 printout）",
				!!bjhlEventsJson.query && typeof bjhlEventsJson.query.results === "object"
				&& Object.values(bjhlEventsJson.query.results).every((v) => v.printouts && v.printouts["开始时间"] && v.printouts["结束时间"]),
				JSON.stringify(Object.keys(bjhlEventsJson.query && bjhlEventsJson.query.results || {}).slice(0, 3)));
		}

		// ── 反证 ③：抹掉在期那条的「结束时间」字段 ⇒ 它不出窗口 / 活动载荷 null（不硬凑）──
		{
			const doc = JSON.parse(bjhlEventsRaw);
			delete doc.query.results["破限·伊琅相思"].printouts["结束时间"];
			const items = BJ.parseBjhlEvents(doc, BJ.BJHL_TZ);
			check("反证：抹掉「结束时间」字段 ⇒ 该条不出窗口（8 → 7 条，且不在解析结果里）",
				items.length === 7 && !items.some((x) => x.event === "破限·伊琅相思"),
				JSON.stringify([items.length, items.some((x) => x.event === "破限·伊琅相思")]));
			const tr = makeTransport([], { override: () => JSON.stringify(doc) });
			const e = createEngine({ transport: tr, storage: makeStore(), now: () => NOW_BJHL, timer: { setTimeout, clearTimeout } });
			const s = e.__test.SOURCES.find((x) => x.id === "bjhl");
			let data = "unset";
			try { data = await e.__test.EVENT_FETCHERS["bjhl"].default(s.eventUrl, undefined, s.tz); } catch (e2) { data = e2; }
			check("反证：抹掉在期那条的「结束时间」⇒ 活动载荷 = null（不是拿往期/别的窗口硬凑）",
				data === null, JSON.stringify(data && (data.message || data.event)));
		}
	// ── 2026-11-26（活网审计 B）：三池同批、`gacha[]` 少一条「去往彼岸」──────────────
		// 现场：悬停 3 池，`gacha[]` 只 2 条。根因不是"按窗口去重"，而是**批次合并角色表**后
		// `main.show`（= 去往彼岸那 4 个角色）与另一口池悬停行的「池名：角色」后缀撞车，
		// 并列条判据把「去往彼岸」整条当成外显行的重复并掉。
		// 修法：`ns_bwiki_gachaBjhl` 显式开 `extrasStrictTitle`（同一口池要求「池名前缀 = 主条标题」）。
		// 夹具仍是 `bjhl-gacha`（真抓前 10 张卡，含这三池；只把 now 拨到审计当天）。
		{
			const NOW_1126 = Date.parse("2026-11-26T02:20:00+08:00");
			const calls = [];
			const e = engineAt(NOW_1126, calls);
			const s = e.__test.SOURCES.find((x) => x.id === "bjhl");
			const g = await e.__test.GACHA_FETCHERS["bjhl"](s.url, undefined, s.tz);
			const arr = (g && g.gacha) || [];
			const hoverItems = (g && g.gachaHoverItems) || [];
			check("bjhl 三池同批（11-26）：外显仍是 常态共鸣·红珠小姐（结束最早那批里 _i 最前）",
				g && g.banner === "常态共鸣·红珠小姐"
				&& g.bannerDates === "11-19 04:00 ~ 12-03 03:50",
				JSON.stringify(g && [g.banner, g.bannerDates]));
			check("bjhl 三池同批（11-26）：gacha[] = 3 条且**含「去往彼岸」**（修复前只有 2 条）",
				arr.length === 3 && arr.some((x) => String(x.title).indexOf("去往彼岸") === 0),
				JSON.stringify(arr.map((x) => x.title)));
			check("bjhl 三池同批（11-26）：key 唯一、按自然顺序重发（`bjhl:gacha:0..2`）",
				arr.map((x) => x.key).join(",") === "bjhl:gacha:0,bjhl:gacha:1,bjhl:gacha:2"
				&& new Set(arr.map((x) => x.key)).size === 3,
				JSON.stringify(arr.map((x) => x.key)));
			check("bjhl 三池同批（11-26）：数组与悬停**逐条对齐**（3 条 hover item 全部在数组里，顺序同源）",
				hoverItems.length === 3 && arr.length === hoverItems.length
				&& arr.map((x) => x.title).join("|") === hoverItems.map((x) => x.title).join("|"),
				JSON.stringify([arr.map((x) => x.title), hoverItems.map((x) => x.title)]));
			check("bjhl 三池同批（11-26）：悬停逐字不变（3 池 × 名称 + 档期两行，修复不动悬停）",
				g && g.bannerHover === "去往彼岸：伊琅相思、无咎、罗咤、吉娜\n11-05 10:00 ~ 12-03 03:50\n启明潜航·伊琅相思 昊苍 红珠小姐\n11-05 10:00 ~ 12-03 03:50\n常态共鸣·红珠小姐\n11-19 04:00 ~ 12-03 03:50",
				JSON.stringify(g && g.bannerHover));
			// 反向证明：同一判据的**开关**是必需的 —— 默认（旧口径）会把"另一个池：同一份角色表"并掉，
			// 显式开 `extrasStrictTitle` 后只并"主条标题：显示名"那条（同一口池），另一个池保留。
			const samePayload = { banner: "甲池", roles: "角色X", bannerDates: "11-05 10:00 ~ 12-03 03:50", bannerDatesRaw: "2026.11.05 10:00 ~ 2026.12.03 03:50" };
			const sameEntries = [
				{ title: "甲池：角色X", startTs: Date.UTC(2026, 10, 5, 2, 0), endTs: Date.UTC(2026, 11, 2, 19, 50), raw: "2026.11.05 10:00 ~ 2026.12.03 03:50" },
				{ title: "乙池：角色X", startTs: Date.UTC(2026, 10, 5, 2, 0), endTs: Date.UTC(2026, 11, 2, 19, 50), raw: "2026.11.05 10:00 ~ 2026.12.03 03:50" }
			];
			const oldArr = T.dataArrayProducedGachaOf(samePayload, sameEntries, { id: "bjhl", tz: BJ.BJHL_TZ }, NOW_1126);
			const strictArr = T.dataArrayProducedGachaOf(samePayload, sameEntries, { id: "bjhl", tz: BJ.BJHL_TZ, extrasStrictTitle: true }, NOW_1126);
			check("bjhl 反证：默认口径把「乙池：同一份角色表」并掉（1 条）；开 extrasStrictTitle 后保留（2 条）",
				oldArr.length === 1 && strictArr.length === 2
				&& strictArr.some((x) => x.title === "乙池：角色X") && strictArr.some((x) => x.title === "甲池"),
				JSON.stringify([oldArr.map((x) => x.title), strictArr.map((x) => x.title)]));
			check("bjhl 反证：开 extrasStrictTitle 后「主条标题：显示名」那条**仍然**并掉（同一口池不重复列）",
				strictArr.every((x) => x.title !== "甲池：角色X"), JSON.stringify(strictArr.map((x) => x.title)));
		}
	}

	// ═══════════════════ ⑤ 阴阳师（yys）—— 官网公告列表 + 详情 ═══════════════════
	section("阴阳师 ⑤：官网公告 `/news/update/`（注册 / 维护后锚点 / 卡池+活动 / 请求数 / 反证）");
	{
		const YY = T.parsers.yys;
		const yysListRaw = fixtureBody("fixture:yys-update-list", { "fixture:yys-update-list": "yys-update-list/response.txt" });
		const detailRaw = (d) => fixtureBody("fixture:yys-update-detail-" + d, { ["fixture:yys-update-detail-" + d]: "yys-update-detail-" + d + "/response.txt" });
		const NOW_YYS = Date.parse("2026-11-15T00:15:14+08:00");

		// ── 注册项 ──
		{
			const s = T.SOURCES.find((x) => x.id === "yys") || null;
			check("条目已存在（id = yys）", !!s, s ? s.id : "缺失");
			check("名称 = 阴阳师", !!s && s.name === "阴阳师", s && s.name);
			check("tz = Asia/Shanghai（国服官网，无夏令时）", !!s && s.tz === "Asia/Shanghai", s && String(s.tz));
			check("defaultHidden = false（出厂展示）", !!s && s.defaultHidden === false, s && String(s.defaultHidden));
			check("有游戏主题色（#rrggbb）", !!s && /^#[0-9A-Fa-f]{6}$/.test(String(s.color)), s && String(s.color));
			check("两侧 url 都是官网公告列表（卡池/活动同一条列表页）",
				!!s && s.url === YY.YYS_LIST_URL && s.eventUrl === YY.YYS_LIST_URL,
				s && JSON.stringify([s.url, s.eventUrl]));
			check("两侧来源标签 = 「官网公告」（与 hlr/其它网易源同口径，逐字）",
				!!s && s.source === "官网公告" && s.eventSource === "官网公告",
				s && JSON.stringify([s.source, s.eventSource]));
			const e0 = engineAt(NOW_YYS, []);
			check("两侧抓取器都登记（GACHA_FETCHERS.yys / EVENT_FETCHERS.yys.default）",
				typeof e0.__test.GACHA_FETCHERS["yys"] === "function"
				&& !!(e0.__test.EVENT_FETCHERS["yys"] && typeof e0.__test.EVENT_FETCHERS["yys"].default === "function"));
		}

		// ── 列表 + 详情解析（纯函数）──
		{
			const list = YY.yysParseList(yysListRaw);
			check("列表解出 15 条文章链接（`/news/update/YYYYMMDD/…html`；翻页 `index_N.html` 不算）", list.length === 15, String(list.length));
			check("首条 = 11-10 的「11月11日维护更新公告」（最新在前）",
				list[0] && list[0].dateText === "20261110" && list[0].title === "《阴阳师》手游11月11日维护更新公告"
				&& list[0].url === "https://yys.163.com/news/update/20261110/23024_1319269.html",
				JSON.stringify(list[0]));
			check("协议相对地址 `//yys.163.com/…` → https 绝对地址",
				list.every((x) => /^https:\/\/yys\.163\.com\/news\/update\/\d{8}\/[\w_]+\.html$/.test(x.url)),
				String(list[0] && list[0].url));

			const d1 = YY.yysParseDetail(detailRaw("20261110"));
			check("详情标题 / artDate = 「《阴阳师》手游11月11日维护更新公告」/ 2026-11-10",
				d1.title === "《阴阳师》手游11月11日维护更新公告" && d1.dateText === "2026-11-10",
				JSON.stringify([d1.title, d1.dateText]));
			const blocks = YY.yysBlocksOf(d1.html);
			const anchor = YY.yysMaintenanceOf(blocks[0] || []);
			check("「维护后」锚点 = 同篇 `※维护时间 2026年11月11日7:00-9:00` 的**结束时刻** 09:00",
				!!anchor && anchor.y === 2026 && anchor.mo === 11 && anchor.d === 11 && anchor.h === 9 && anchor.mi === 0,
				JSON.stringify(anchor));
			const rows = YY.yysGachaRowsOf(blocks, YY.YYS_TZ, YY.yysRefYearOf(d1, anchor), anchor);
			check("召唤条解出 1 条：旧枷离解·祸命权现 / 笼梦祸津神 / 11-11 09:00 ~ 11-22 23:59",
				rows.length === 1 && rows[0].banner === "旧枷离解·祸命权现" && rows[0].roles === "笼梦祸津神"
				&& rows[0].display === "11-11 09:00 ~ 11-22 23:59",
				JSON.stringify(rows));
			check("起点按锚点补成绝对时刻（UTC 11-11 01:00 = +08 09:00），原文保留「维护后」",
				rows.length === 1 && rows[0].startTs === Date.UTC(2026, 10, 11, 1, 0)
				&& rows[0].endTs === Date.UTC(2026, 10, 22, 15, 59)
				&& rows[0].raw === "11月11日维护后 ~ 11月22日23:59",
				JSON.stringify(rows[0] && [rows[0].startTs, rows[0].endTs, rows[0].raw]));
			const evRows = YY.yysEventRowsOf(blocks, YY.YYS_TZ, YY.yysRefYearOf(d1, anchor), anchor);
			check("活动条：`开放时间：…` 与「标签单独一行 + 下一行窗口」两种写法都吃（超鬼王 / 双十一呱呱礼 都在）",
				evRows.some((x) => x.event === "祸至无日，超鬼王开启！" && x.endTs === Date.UTC(2026, 10, 17, 15, 59))
				&& evRows.some((x) => x.event === "双十一呱呱礼" && x.endTs === Date.UTC(2026, 10, 17, 15, 59)),
				JSON.stringify(evRows.map((x) => [x.event, x.endTs])));
			check("只有裸窗口的条目（`追忆绘卷`）**不产出** —— 只认带 `活动时间/开放时间/开启时间/活动日期` 的标签窗口",
				!evRows.some((x) => /追忆绘卷/.test(x.event)), JSON.stringify(evRows.map((x) => x.event)));
			check("`新礼包情报`（限购时间）/`皮肤限时返场`（返场时间）不算活动（标签不在白名单里）",
				!evRows.some((x) => /礼包情报|皮肤限时返场/.test(x.event)), JSON.stringify(evRows.map((x) => x.event)));
		}

		// ── 卡池载荷（引擎路径）──
		{
			const calls = [];
			const e = engineAt(NOW_YYS, calls);
			const s = e.__test.SOURCES.find((x) => x.id === "yys");
			const g = await e.__test.GACHA_FETCHERS["yys"](s.url, undefined, s.tz);
			check("卡池抓取器返回对象", !!g && typeof g === "object");
			check("当期池 = 旧枷离解·祸命权现 / 角色 = 笼梦祸津神",
				g && g.banner === "旧枷离解·祸命权现" && g.roles === "笼梦祸津神",
				JSON.stringify(g && [g.banner, g.roles]));
			check("档期 = 「11-11 09:00 ~ 11-22 23:59」/ 原文「11月11日维护后 ~ 11月22日23:59」",
				g && g.bannerDates === "11-11 09:00 ~ 11-22 23:59"
				&& g.bannerDatesRaw === "11月11日维护后 ~ 11月22日23:59",
				JSON.stringify(g && [g.bannerDates, g.bannerDatesRaw]));
			check("gacha[] = 1 条（只有这一口池在期；10-27 那期的飞驰天地 11-08 已收）",
				!!g && Array.isArray(g.gacha) && g.gacha.length === 1
				&& g.gacha[0].key === "yys:gacha:0" && g.gacha[0].title === "旧枷离解·祸命权现"
				&& g.gacha[0].show === "笼梦祸津神",
				JSON.stringify(g && (g.gacha || []).map((x) => [x.key, x.title, x.show])));
			check("只有 1 条在期 ⇒ 不设 bannerHover", g && g.bannerHover === void 0, JSON.stringify(g && g.bannerHover));
			check("请求数 = 4（1 次列表 + 3 篇详情；只挑「维护更新公告」，违规处罚稿不抓）",
				calls.length === 4
				&& calls[0].url === YY.YYS_LIST_URL
				&& calls.slice(1).every((c) => /\/news\/update\/\d{8}\/[\w_]+\.html$/.test(c.url)),
				JSON.stringify(calls.map((c) => c.url.slice(-40))));
			check("详情地址 = 最新 3 篇更新公告（11-10 / 11-03 / 10-27，按列表顺序）",
				calls.slice(1).map((c) => (c.url.match(/\/(\d{8})\//) || [])[1]).join(",") === "20261110,20261103,20261027",
				JSON.stringify(calls.slice(1).map((c) => c.url)));
			check("全部请求走宿主代理并带 `Referer: https://yys.163.com/`（该站无 ACAO）",
				calls.every((c) => c.via === "proxy" && c.referer === "https://yys.163.com/"),
				JSON.stringify(calls[0]));
		}

		// ── 活动载荷（引擎路径）──
		{
			const calls = [];
			const e = engineAt(NOW_YYS, calls);
			const s = e.__test.SOURCES.find((x) => x.id === "yys");
			const d = await e.__test.EVENT_FETCHERS["yys"].default(s.url, undefined, s.tz);
			check("活动抓取器返回对象", !!d && typeof d === "object");
			check("外显活动 = 祸至无日，超鬼王开启！（在期活动里结束最早：11-17 23:59）",
				d && d.event === "祸至无日，超鬼王开启！", JSON.stringify(d && d.event));
			check("活动档期 = 「11-11 09:00 ~ 11-17 23:59」/ 原文保留「维护后」",
				d && d.eventDates === "11-11 09:00 ~ 11-17 23:59"
				&& d.eventDatesRaw === "11月11日维护后 ~ 11月17日23:59",
				JSON.stringify(d && [d.eventDates, d.eventDatesRaw]));
			const arr = (d && d.events) || [];
			check("events[] 非空且按结束时间升序（每篇详情各出多条，不折叠）",
				arr.length >= 10 && arr.every((x, i) => i === 0 || x.endTs >= arr[i - 1].endTs),
				JSON.stringify(arr.map((x) => [x.title, x.endTs])));
			check("events[] 里含 3 篇公告的档期（超鬼王 11-17 / 祈愿福礼 11-22 / 曜之阁 2027-01-26）",
				arr.some((x) => x.title === "祸至无日，超鬼王开启！" && x.endTs === Date.UTC(2026, 10, 17, 15, 59))
				&& arr.some((x) => x.title === "祈愿福礼" && x.endTs === Date.UTC(2026, 10, 22, 15, 59))
				&& arr.some((x) => /曜之阁/.test(x.title) && x.endTs === Date.UTC(2027, 0, 26, 15, 59)),
				JSON.stringify(arr.map((x) => [x.title, x.endTs])));
			check("悬停 = 逐条「名称 + 3 空格 + 档期」，行数 = events[] 条数（首行逐字；档期印源站原文，含「维护后」）",
				!!d && d.eventHover.split("\n").length === arr.length
				&& d.eventHover.split("\n")[0] === "霜月「诞生庆典」开启！   11-10 00:00 ~ 11-16 23:59"
				&& d.eventHover.indexOf("祸至无日，超鬼王开启！   11月11日维护后 ~ 11月17日23:59") > 0,
				JSON.stringify(d && d.eventHover && d.eventHover.split("\n").slice(0, 3)));
			// ⚠️ 这里**不**调 assertHoverConvention：它的元信息词表把「维护后」算作元信息，而本源的
			//    「维护后」是**档期原文的一部分**（与 bandori `9月29日维护后~…` / 嘟嘟脸同一情形，
			//    那两处也都不走该助手）。上面那条逐字断言比它更严。
			check("请求数 = 4（列表 1 + 详情 3）", calls.length === 4, String(calls.length));
		}

		// ── 反证 ①：抹掉起点锚点（`※维护时间`）⇒ 当期池不再产出（**假在期比少显示更糟**）──
		{
			const noAnchor = (u) => {
				if (/20261110/.test(u)) return detailRaw("20261110").replace(/维护时间/g, "维护说明");
				if (/20261103/.test(u)) return detailRaw("20261103");
				if (/20261027/.test(u)) return detailRaw("20261027");
				return yysListRaw;
			};
			const tr = makeTransport([], { override: noAnchor });
			const e = createEngine({ transport: tr, storage: makeStore(), now: () => NOW_YYS, timer: { setTimeout, clearTimeout } });
			const s = e.__test.SOURCES.find((x) => x.id === "yys");
			const g = await e.__test.GACHA_FETCHERS["yys"](s.url, undefined, s.tz);
			check("反证：抹掉 `※维护时间` ⇒ 「维护后」没有锚点 ⇒ 当期池对 now 无覆盖 ⇒ **null（未公布）**",
				g === null, JSON.stringify(g && g.banner));
		}

		// ── 反证 ②：抹掉某条窗口的连接号 ⇒ 那一条不进 events[]（且不会被后面的子阶段窗口顶替）──
		{
			const d1 = YY.yysParseDetail(detailRaw("20261110"));
			const blocks = YY.yysBlocksOf(d1.html);
			const anchor = YY.yysMaintenanceOf(blocks[0] || []);
			const refYear = YY.yysRefYearOf(d1, anchor);
			const base = YY.yysEventRowsOf(blocks, YY.YYS_TZ, refYear, anchor);
			check("基线：未改动时 超鬼王 在 events[]（11-11 09:00 ~ 11-17 23:59）",
				base.some((x) => x.event === "祸至无日，超鬼王开启！" && x.endTs === Date.UTC(2026, 10, 17, 15, 59)),
				JSON.stringify(base.map((x) => [x.event, x.endTs])));
			const mutated = blocks.map((lines) => (/超鬼王/.test(lines[0] || "")
				? lines.map((l) => (l === "开放时间：11月11日维护后-11月17日23:59" ? "开放时间：11月11日维护后 11月17日23:59" : l))
				: lines));
			const rows = YY.yysEventRowsOf(mutated, YY.YYS_TZ, refYear, anchor);
			check("反证：把 `-` 抹掉 ⇒ 超鬼王那条解不出 ⇒ 不进 events[]（限 8 行扫描 ⇒ 不拿「笼中残梦」的 11-24 顶替）",
				!rows.some((x) => /超鬼王/.test(x.event)), JSON.stringify(rows.map((x) => [x.event, x.endTs])));
			// 纯函数级：窗口行本身也就解不出了（证明是正则锚点，不是别的层）
			check("反证：`yysWindowOf` 对「开放时间：11月11日维护后 11月17日23:59」返回 null（连接号是硬锚点）",
				YY.yysWindowOf("11月11日维护后 11月17日23:59", YY.YYS_TZ, refYear, anchor) === null);
		}

		// ── 反证 ③：`{}` / 空 HTML / 结构改名 ⇒ **抛错**（不是 nomatch）──
		{
			const grab = async (body) => {
				const tr = makeTransport([], { override: () => body });
				const e = createEngine({ transport: tr, storage: makeStore(), now: () => NOW_YYS, timer: { setTimeout, clearTimeout } });
				const s = e.__test.SOURCES.find((x) => x.id === "yys");
				let err = null, data;
				try { data = await e.__test.GACHA_FETCHERS["yys"](s.url, undefined, s.tz); } catch (e2) { err = e2; }
				return { err, data };
			};
			const r1 = await grab("{}");
			check("反证：列表响应 `{}` ⇒ 抛错（`yys-list-changed:no-articles`）",
				!!r1.err && /no-articles/.test(r1.err.message), JSON.stringify(r1.err && r1.err.message));
			const r2 = await grab(yysListRaw.replace(/维护更新公告/g, "维护更新说明"));
			check("反证：标题口径变了（没有「维护更新公告」）⇒ 抛错（`no-update-articles`）",
				!!r2.err && /no-update-articles/.test(r2.err.message), JSON.stringify(r2.err && r2.err.message));
			const r3 = await grab("");
			check("反证：空响应体 ⇒ 抛错（不是返回 null）", !!r3.err, JSON.stringify(r3.err && r3.err.message));
			// 详情侧：把三篇的 `artText` 抹掉 ⇒ 全部详情失败 ⇒ 抛错
			const trD = makeTransport([], { override: (u) => (/\/news\/update\/\d{8}\//.test(u) ? "<html><body>{}" : yysListRaw) });
			const eD = createEngine({ transport: trD, storage: makeStore(), now: () => NOW_YYS, timer: { setTimeout, clearTimeout } });
			const sD = eD.__test.SOURCES.find((x) => x.id === "yys");
			let errD = null;
			try { await eD.__test.EVENT_FETCHERS["yys"].default(sD.url, undefined, sD.tz); } catch (e2) { errD = e2; }
			check("反证：详情页没有 `artText` ⇒ 抛错（`yys-detail-changed:artText`，不是静默 nomatch）",
				!!errD && /yys-detail-changed/.test(errD.message), JSON.stringify(errD && errD.message));
		}
	}

	// ═══════════════ ⑥ 以闪亮之名（yslz）—— bwiki 两个分类：卡池 / 活动 ═══════════════
	section("以闪亮之名 ⑥：bwiki 分类（卡池 `Category:限时追光` + 活动 SMW ask）—— 注册 / 脏日期 / 复刻档 / 分页 / 反证");
	{
		const Y = T.parsers.yslz;
		const raw = (name) => fixtureBody("fixture:" + name, { ["fixture:" + name]: name + "/response.txt" });
		const g1Raw = raw("yslz-gacha");
		const g2Raw = raw("yslz-gacha-p2");
		const e1Raw = raw("yslz-events");
		const e2Raw = raw("yslz-events-p2");
		// 夹具抓取时刻 = 2026-11-15T03:31Z（+08 11:31）；now 取 11:30+08 ⇒ 三个窗口都还在期、
		// 魔卡契约的复刻（11-17 10:00）还没开。
		const NOW_YS = Date.parse("2026-11-15T11:30:00+08:00");
		const pagesOf = (jsonText) => JSON.parse(jsonText).query.pages
			.filter((p) => p.revisions && p.revisions[0].slots.main)
			.map((p) => ({ title: p.title, content: p.revisions[0].slots.main.content }));
		const pages1 = pagesOf(g1Raw), pages2 = pagesOf(g2Raw);
		const RERUN = Y.YSLZ_RERUN_TAG;

		// ── 注册项 ──
		{
			const s = T.SOURCES.find((x) => x.id === "yslz") || null;
			check("条目已存在（id = yslz）", !!s, s ? s.id : "缺失");
			check("名称 = 以闪亮之名", !!s && s.name === "以闪亮之名", s && s.name);
			check("tz = Asia/Shanghai（源站墙钟 = 国服）", !!s && s.tz === "Asia/Shanghai", s && String(s.tz));
			check("defaultHidden = false（出厂展示）", !!s && s.defaultHidden === false, s && String(s.defaultHidden));
			check("有游戏主题色（#rrggbb）", !!s && /^#[0-9A-Fa-f]{6}$/.test(String(s.color)), s && String(s.color));
			check("卡池 url = `generator=categorymembers` + `gcmtitle=Category:限时追光` + `prop=revisions`（一次拿成员 + 正文）",
				!!s && s.url === Y.YSLZ_GACHA_URL && /gcmtitle=Category%3A/.test(s.url) && /gcmnamespace=0/.test(s.url)
				&& /prop=revisions/.test(s.url) && /rvprop=content/.test(s.url), s && String(s.url));
			check("活动 eventUrl = SMW `action=ask` + `[[分类:活动]]|?名称|?开始时间|?结束时间`（limit=500）",
				!!s && s.eventUrl === Y.YSLZ_EVENTS_URL && /action=ask/.test(s.eventUrl)
				&& /%E5%88%86%E7%B1%BB%3A%E6%B4%BB%E5%8A%A8/.test(s.eventUrl) && /limit%3D500/.test(s.eventUrl),
				s && String(s.eventUrl));
			check("两侧来源标签逐字 = 「Bwiki 限时追光」/「Bwiki 活动一览」（**提议**，等用户复核）",
				!!s && s.source === "Bwiki 限时追光" && s.eventSource === "Bwiki 活动一览",
				s && JSON.stringify([s.source, s.eventSource]));
			const e0 = engineAt(NOW_YS, []);
			check("两侧抓取器都登记（GACHA_FETCHERS.yslz / EVENT_FETCHERS.yslz.default）",
				typeof e0.__test.GACHA_FETCHERS["yslz"] === "function"
				&& !!(e0.__test.EVENT_FETCHERS["yslz"] && typeof e0.__test.EVENT_FETCHERS["yslz"].default === "function"));
		}

		// ── 脏日期归一（纯函数）：双空格 / 无前导零 / 只有日期 / 单边 / 源站错行 ──
		{
			const w1 = Y.yslzWindowOf("2026/11/03  09:10", "2026/11/23  23:59", Y.YSLZ_TZ);
			check("双空格 `2026/11/03  09:10` ⇒ 09:10（不是 00:00），display = 「11-03 09:10 ~ 11-23 23:59」",
				!!w1 && w1.display === "11-03 09:10 ~ 11-23 23:59" && w1.startTs === Date.UTC(2026, 10, 3, 1, 10),
				JSON.stringify(w1 && [w1.display, w1.startTs]));
			const w2 = Y.yslzWindowOf("2026/8/30", "2026/9/15", Y.YSLZ_TZ);
			check("无前导零 + 只有日期 `2026/8/30` ~ `2026/9/15` ⇒ 起 00:00 / 止 23:59（`08-30 00:00 ~ 09-15 23:59`）",
				!!w2 && w2.display === "08-30 00:00 ~ 09-15 23:59"
				&& w2.startTs === Date.UTC(2026, 7, 29, 16, 0) && w2.endTs === Date.UTC(2026, 8, 15, 15, 59),
				JSON.stringify(w2 && [w2.display, w2.startTs, w2.endTs]));
			const w3 = Y.yslzWindowOf("2026/11/03 10:00", "", Y.YSLZ_TZ);
			check("只有一端 ⇒ 另一端 null（不猜结束日），raw 照原文",
				!!w3 && w3.endTs === null && w3.startTs === Date.UTC(2026, 10, 3, 2, 0) && w3.raw === "2026/11/03 10:00",
				JSON.stringify(w3));
			const w4 = Y.yslzWindowOf("2026/04/07 10:00", "2025/04/21 05:00", Y.YSLZ_TZ);
			check("源站错行（止早于起）⇒ 两端 null + 原文保留（不硬造在期）",
				!!w4 && w4.startTs === null && w4.endTs === null && w4.raw === "2026/04/07 10:00 ~ 2025/04/21 05:00",
				JSON.stringify(w4));
			const w5 = Y.yslzWindowOf("", "", Y.YSLZ_TZ);
			check("两端都空 ⇒ null", w5 === null, JSON.stringify(w5));
		}

		// ── 纯解析：卡池（两页正文合起来 9 页 → 1 + N 条窗口）──
		{
			const items = Y.yslzParsePools(pages1.concat(pages2), Y.YSLZ_TZ);
			check("9 页正文 ⇒ 16 条窗口（棱彩幻梦 / 黯影新誓 各 3 = 原始 + 2 次复刻；谲舞缚厄 / 月狩神谕 / 魔卡契约 各 2；其余 4 页各 1）",
				items.length === 16, String(items.length));
			const shi = items.find((x) => x.banner === "追光·时砂寄念" && x.isMain === true);
			check("当期主档 追光·时砂寄念 = 原始档（isMain）",
				!!shi && shi.category === "" && shi.raw === "2026/11/03 10:00 ~ 2026/11/23 23:59",
				JSON.stringify(shi && [shi.category, shi.raw]));
			check("角色 = 套装1~3 + 羁绊角色（`、` 连接，去重保序）=「逆时沙海、风翎叶信、珠幕摇星、落言」",
				!!shi && shi.roles === "逆时沙海、风翎叶信、珠幕摇星、落言", shi && shi.roles);
			const rerun = items.filter((x) => x.banner === "追光·黯影新誓");
			check("黯影新誓 = 原始档 + 2 个复刻档（第 1 次 01-21 / 第 2 次 10-27）",
				rerun.length === 3 && rerun.filter((x) => x.category === RERUN).length === 2
				&& rerun.some((x) => x.raw === "2026/10/27 10:00 ~ 2026/11/16 23:59" && x.startTs === Date.UTC(2026, 9, 27, 2, 0)),
				JSON.stringify(rerun.map((x) => [x.raw, x.category])));
			check("复刻档的 category = 复刻 / isMain = false；原始档 category = 空 / isMain = true",
				rerun.filter((x) => x.isMain === true).length === 1
				&& rerun.filter((x) => x.isMain === false).every((x) => x.category === RERUN));
			const pools = Y.yslzParsePools(pages1, Y.YSLZ_TZ);
			check("第 1 页（6 页）里**没有**时砂寄念 —— 当期主档在第 2 页（`rvcontinue` 那一页）",
				!pools.some((x) => x.banner === "追光·时砂寄念"), JSON.stringify(pools.map((x) => x.banner)));
			check("`yslzPoolRolesOf` 去重（套装与羁绊同名时只留一个）",
				Y.yslzPoolRolesOf({ 套装1: "甲", 套装2: "甲", 套装3: "", 羁绊角色: "乙" }) === "甲、乙",
				Y.yslzPoolRolesOf({ 套装1: "甲", 套装2: "甲", 套装3: "", 羁绊角色: "乙" }));
			check("`yslzFieldOf` 只读到行内值（`|阁名=甲|邀请函=乙` ⇒ 甲）",
				Y.yslzFieldOf("|阁名=甲|邀请函=乙", "阁名") === "甲", Y.yslzFieldOf("|阁名=甲|邀请函=乙", "阁名"));
			check("`yslzRerunsOf` 按 N 升序、缺的一端给空串",
				JSON.stringify(Y.yslzRerunsOf("|第2次复刻开始时间=2026/10/27 10:00|第1次复刻开始时间=2026/01/21 10:00|第1次复刻结束时间=2026/02/10 23:59"))
				=== JSON.stringify([{ k: 1, start: "2026/01/21 10:00", end: "2026/02/10 23:59" }, { k: 2, start: "2026/10/27 10:00", end: "" }]),
				JSON.stringify(Y.yslzRerunsOf("|第2次复刻开始时间=2026/10/27 10:00|第1次复刻开始时间=2026/01/21 10:00|第1次复刻结束时间=2026/02/10 23:59")));
		}

		// ── 卡池载荷（引擎路径）：外显 = 结束最早的**在期**窗口（= 复刻里的 11-16）──
		{
			const calls = [];
			const e = engineAt(NOW_YS, calls);
			const s = e.__test.SOURCES.find((x) => x.id === "yslz");
			const g = await e.__test.GACHA_FETCHERS["yslz"](s.url, undefined, s.tz, NOW_YS);
			check("卡池抓取器返回对象", !!g && typeof g === "object");
			check("外显 = 追光·黯影新誓（在期窗口里结束最早：11-16 23:59；复刻窗口也算当期）",
				g && g.banner === "追光·黯影新誓", JSON.stringify(g && g.banner));
			check("外显角色 = 该批自己的套装（同批 = endTs 相同 ⇒ 只有它自己，不串到别的池）",
				g && g.roles === "无烬之誓、隐刃破晓、馥心夜蔷、蓝殊", JSON.stringify(g && g.roles));
			check("档期 = 「10-27 10:00 ~ 11-16 23:59」/ 原文「2026/10/27 10:00 ~ 2026/11/16 23:59」",
				g && g.bannerDates === "10-27 10:00 ~ 11-16 23:59"
				&& g.bannerDatesRaw === "2026/10/27 10:00 ~ 2026/11/16 23:59",
				JSON.stringify(g && [g.bannerDates, g.bannerDatesRaw]));
			check("startTs / endTs = UTC 10-27 02:00 / 11-16 15:59",
				g && g.startTs === Date.UTC(2026, 9, 27, 2, 0) && g.endTs === Date.UTC(2026, 10, 16, 15, 59),
				JSON.stringify(g && [g.startTs, g.endTs]));
			const arr = (g && g.gacha) || [];
			check("gacha[] = 3 条（主条 + 2 个并列条），key 前缀 = yslz:gacha",
				arr.length === 3 && arr.every((x) => String(x.key).indexOf("yslz:gacha:") === 0),
				JSON.stringify(arr.map((x) => x.key)));
			check("gacha[] 逐条标题 = 黯影新誓 / 时砂寄念：… / 月狩神谕：…（与悬停同序同源）",
				arr.length === 3 && arr[0].title === "追光·黯影新誓"
				&& arr[1].title === "追光·时砂寄念：逆时沙海、风翎叶信、珠幕摇星、落言"
				&& arr[2].title === "追光·月狩神谕：朔月神临、墨绛焚花、沉砂絮语、苏黎",
				JSON.stringify(arr.map((x) => x.title)));
			check("复刻档在数组里带 category = 复刻（走 itemFacts 通道，主条与并列条都有）",
				arr.length === 3 && arr[0].category === RERUN && arr[2].category === RERUN && arr[1].category === void 0,
				JSON.stringify(arr.map((x) => x.category)));
			check("**未来复刻不进数组**（魔卡契约 第 1 次 11-17 10:00 才开）",
				arr.every((x) => x.title.indexOf("魔卡契约") < 0), JSON.stringify(arr.map((x) => x.title)));
			check("悬停逐字（3 个在期窗口 × 名称 + 档期两行）",
				g && g.bannerHover === "追光·黯影新誓：无烬之誓、隐刃破晓、馥心夜蔷、蓝殊\n10-27 10:00 ~ 11-16 23:59\n"
				+ "追光·时砂寄念：逆时沙海、风翎叶信、珠幕摇星、落言\n11-03 10:00 ~ 11-23 23:59\n"
				+ "追光·月狩神谕：朔月神临、墨绛焚花、沉砂絮语、苏黎\n11-11 10:00 ~ 12-01 23:59",
				JSON.stringify(g && g.bannerHover));
			check("悬停合规（只含名称与档期）", assertHoverConvention("yslz 卡池", g && g.bannerHover, { requireSet: true }) !== false);
			check("**2 个请求**：分类成员+正文（第 1 页）+ `rvcontinue` 续页（当期主档在续页里）",
				calls.length === 2
				&& /gcmtitle=Category%3A/.test(calls[0].url) && !/rvcontinue/.test(calls[0].url)
				&& /rvcontinue=/.test(calls[1].url),
				JSON.stringify(calls.map((c) => c.url.slice(-46))));
			check("两个请求都走宿主代理 + `Referer: https://wiki.biligame.com/` + 自动补 `origin=*`",
				calls.length === 2 && calls.every((c) => c.via === "proxy" && c.referer === Y.YSLZ_REFERER)
				&& calls.every((c) => /[?&]origin=\*/.test(c.url)),
				JSON.stringify(calls.map((c) => [c.via, c.referer, /origin=\*/.test(c.url)])));
		}

		// ── 活动载荷（引擎路径）：ask 两页合并 ──
		{
			const calls = [];
			const e = engineAt(NOW_YS, calls);
			const s = e.__test.SOURCES.find((x) => x.id === "yslz");
			const d = await e.__test.EVENT_FETCHERS["yslz"].default(s.eventUrl, undefined, s.tz, NOW_YS);
			check("活动抓取器返回对象", !!d && typeof d === "object");
			check("外显活动 = 店长体验·星幕季（在期活动里结束最早：11-17 05:00）",
				d && d.event === "店长体验·星幕季", JSON.stringify(d && d.event));
			check("活动档期 = 「11-03 10:00 ~ 11-17 05:00」/ 原文「2026/11/03 10:00 ~ 2026/11/17 05:00」",
				d && d.eventDates === "11-03 10:00 ~ 11-17 05:00"
				&& d.eventDatesRaw === "2026/11/03 10:00 ~ 2026/11/17 05:00",
				JSON.stringify(d && [d.eventDates, d.eventDatesRaw]));
			const arr = (d && d.events) || [];
			check("events[] = 5 条（在期 5 条；往期 / 缺一端 / 错行都不进），key 前缀 = yslz:event",
				arr.length === 5 && arr.every((x) => String(x.key).indexOf("yslz:event:") === 0),
				JSON.stringify(arr.map((x) => [x.key, x.title])));
			check("events[] 按结束时间升序（每条的绝对时刻 = 源站墙钟按 +08 换算）",
				arr.length === 5 && arr.every((x, i) => i === 0 || x.endTs >= arr[i - 1].endTs)
				&& arr[0].startTs === Date.UTC(2026, 10, 3, 2, 0) && arr[0].endTs === Date.UTC(2026, 10, 16, 21, 0),
				JSON.stringify(arr.map((x) => [x.title, x.startTs, x.endTs])));
			check("双空格那条（泠雨织澜 09:10）在数组里逐字 = 「11-03 09:10 ~ 11-23 23:59」",
				arr.some((x) => x.title === "泠雨织澜" && x.startTs === Date.UTC(2026, 10, 3, 1, 10)
					&& x.endTs === Date.UTC(2026, 10, 23, 15, 59)),
				JSON.stringify(arr.map((x) => [x.title, x.startTs])));
			check("**缺一端的不进外显/数组**：2022年红包封面（缺结束）/ 初芽新绽（缺开始）/ 全渠道1500W预约谢礼（两端都缺）",
				!arr.some((x) => /红包封面|初芽新绽|全渠道/.test(x.title)), JSON.stringify(arr.map((x) => x.title)));
			check("**源站错行不进数组**：仙喵神游记（2026/04/07 ~ 2025/04/21，止早于起）",
				!arr.some((x) => /仙喵神游记/.test(x.title)), JSON.stringify(arr.map((x) => x.title)));
			check("活动名取 `名称` 不是页名（p2 的【风起花游】名称 = 春游寻趣）",
				!arr.some((x) => x.title === "【风起花游】"));
			check("悬停 = 逐条「名称 + 3 空格 + 档期」（5 行，行数 = events[] 条数）",
				!!d && d.eventHover.split("\n").length === 5
				&& d.eventHover.split("\n")[0] === "店长体验·星幕季   11-03 10:00 ~ 11-17 05:00"
				&& d.eventHover.split("\n")[4] === "泠雨织澜   11-03 09:10 ~ 11-23 23:59",
				JSON.stringify(d && d.eventHover && d.eventHover.split("\n")));
			check("悬停合规（活动单行式）", assertHoverConvention("yslz 活动", d && d.eventHover, { requireSet: true }) !== false);
			check("**2 个请求**：`limit=500` 第 1 页 + `|offset=500` 第 2 页（该 wiki 的列是 `_txt`，`sort=` 被忽略 ⇒ 只能分页取全）",
				calls.length === 2 && !/offset/.test(calls[0].url) && /offset%3D500/.test(calls[1].url),
				JSON.stringify(calls.map((c) => c.url.slice(-40))));
			check("第 2 页的地址由 `yslzEventsUrlOf(500)` 逐字生成（不由调用方手拼）",
				calls.length === 2 && calls[1].url.indexOf(Y.yslzEventsUrlOf(500)) === 0, String(calls[1] && calls[1].url.slice(0, 80)));
		}

		// ── 纯解析：活动（两页合并；缺一端 / 错行如实保留为 null）──
		{
			const merged = { query: { results: Object.assign({}, JSON.parse(e1Raw).query.results, JSON.parse(e2Raw).query.results) } };
			const items = Y.yslzParseEvents(merged, Y.YSLZ_TZ);
			check("两页合并后 17 行全部成为条目（12 + 5，不丢行）", items.length === 17, String(items.length));
			const none = items.filter((x) => x.startTs === null && x.endTs === null);
			check("两端都 null 的条目 = 2（全渠道1500W预约谢礼 两端都缺 / 仙喵神游记 错行且原文保留）",
				none.length === 2
				&& none.some((x) => x.event === "全渠道1500W预约谢礼")
				&& none.some((x) => x.event === "仙喵神游记" && x.raw === "2026/04/07 10:00 ~ 2025/04/21 05:00"),
				JSON.stringify(none.map((x) => [x.event, x.raw])));
			const half = items.filter((x) => (x.startTs === null) !== (x.endTs === null));
			check("只有一端的条目 = 3（2022年红包封面 缺结束 / 初芽新绽 缺开始 / 萌新必备 缺结束），那一端如实为 null",
				half.length === 3
				&& half.some((x) => x.event === "2022年红包封面" && x.endTs === null && x.startTs !== null)
				&& half.some((x) => x.event === "初芽新绽" && x.startTs === null && x.endTs !== null)
				&& half.some((x) => x.event === "萌新必备" && x.endTs === null),
				JSON.stringify(half.map((x) => [x.event, x.startTs, x.endTs])));
			const fq = items.find((x) => x.event === "春游寻趣");
			check("「春游寻趣」来自页名【风起花游】的 `名称` 字段", !!fq, JSON.stringify(items.filter((x) => /花游/.test(x.event)).map((x) => x.event)));
			check("`yslzParseEvents` 对 `{}` 抛错（结构变了，不是「没有活动」）",
				(() => { try { Y.yslzParseEvents({}, Y.YSLZ_TZ); return false; } catch (e2) { return /yslz-events-changed:bad-json/.test(e2.message); } })());
			check("`yslzParseEvents` 对空 results 抛错（`no-rows`）",
				(() => { try { Y.yslzParseEvents({ query: { results: {} } }, Y.YSLZ_TZ); return false; } catch (e2) { return /yslz-events-changed:no-rows/.test(e2.message); } })());
		}

		// ── 反证 ①：抹掉**外显那条**的时间锚点 ⇒ 它不进外显（换人，而不是硬凑原值）──
		{
			// 只动 `追光·黯影新誓` 那一页：把「第2次复刻结束时间」的值清空 ⇒ 那条窗口只剩一端
			// ⇒ `coversNow` 两端都要 ⇒ 它不再是当期 ⇒ 外显换成次早结束的月狩神谕（12-01）。
			const broken = (u) => {
				if (/rvcontinue=/.test(u)) return g2Raw;
				const j = JSON.parse(g1Raw);
				j.query.pages = j.query.pages.map((p) => {
					if (p.title !== "追光·黯影新誓") return p;
					const content = p.revisions[0].slots.main.content.replace(/\|第2次复刻结束时间=[^\n|}]*/, "|第2次复刻结束时间=");
					return { ...p, revisions: [{ ...p.revisions[0], slots: { main: { content } } }] };
				});
				return JSON.stringify(j);
			};
			const tr = makeTransport([], { override: broken });
			const e = createEngine({ transport: tr, storage: makeStore(), now: () => NOW_YS, timer: { setTimeout, clearTimeout } });
			const s = e.__test.SOURCES.find((x) => x.id === "yslz");
			const g = await e.__test.GACHA_FETCHERS["yslz"](s.url, undefined, s.tz, NOW_YS);
			check("反证：清空 黯影新誓 第 2 次复刻的结束时间 ⇒ 它只剩一端 ⇒ 外显换成 追光·时砂寄念（11-03 ~ 11-23，次早结束）",
				!!g && g.banner === "追光·时砂寄念" && g.bannerDates === "11-03 10:00 ~ 11-23 23:59",
				JSON.stringify(g && [g.banner, g.bannerDates]));
			check("反证：那条窗口不进 gacha[]（外显与数组同一判据 `coversNow`），黯影新誓整条消失",
				!!g && (g.gacha || []).length === 2 && !(g.gacha || []).some((x) => x.title.indexOf("黯影新誓") >= 0),
				JSON.stringify(g && (g.gacha || []).map((x) => x.title)));
			check("反证：悬停里也不再出现黯影新誓", !!g && g.bannerHover.indexOf("黯影新誓") < 0, JSON.stringify(g && g.bannerHover));
		}

		// ── 反证 ②：第 2 页失败 ⇒ 抛错（不许把"只看了 50 页"当成完整当期）──
		{
			const tr = makeTransport([], { fail: (u) => /rvcontinue=/.test(u) });
			const e = createEngine({ transport: tr, storage: makeStore(), now: () => NOW_YS, timer: { setTimeout, clearTimeout } });
			const s = e.__test.SOURCES.find((x) => x.id === "yslz");
			let err = null, data;
			try { data = await e.__test.GACHA_FETCHERS["yslz"](s.url, undefined, s.tz, NOW_YS); } catch (e2) { err = e2; }
			check("反证：`rvcontinue` 那一页失败 ⇒ 抛错（不是只拿第 1 页就返回——当期主档就在第 2 页）",
				!!err && data === void 0, JSON.stringify(err && err.message));
		}

		// ── 反证 ③：`{}` / 空 pages / 空 results ⇒ **抛错**（不是 nomatch）──
		{
			const grabGacha = async (body) => {
				const tr = makeTransport([], { override: () => body });
				const e = createEngine({ transport: tr, storage: makeStore(), now: () => NOW_YS, timer: { setTimeout, clearTimeout } });
				const s = e.__test.SOURCES.find((x) => x.id === "yslz");
				let err = null, data;
				try { data = await e.__test.GACHA_FETCHERS["yslz"](s.url, undefined, s.tz, NOW_YS); } catch (e2) { err = e2; }
				return { err, data };
			};
			const r1 = await grabGacha("{}");
			check("反证：卡池响应 `{}` ⇒ 抛错（`yslz-gacha-changed:no-pages`），不是返回 null",
				!!r1.err && /no-pages/.test(r1.err.message), JSON.stringify(r1.err && r1.err.message));
			const r2 = await grabGacha(JSON.stringify({ query: { pages: [] } }));
			check("反证：`query.pages` 是空数组 ⇒ 抛错（`no-pools`）",
				!!r2.err && /no-pools/.test(r2.err.message), JSON.stringify(r2.err && r2.err.message));
			const r3 = await grabGacha("");
			check("反证：空响应体 ⇒ 抛错（`bad-json`）", !!r3.err && /bad-json/.test(r3.err.message), JSON.stringify(r3.err && r3.err.message));
			// 字段名整体改名（源站改版）：页面还在、但一个窗口都读不到
			const renamed = g1Raw.replace(/\|追光开始时间=/g, "|开池=").replace(/\|追光结束时间=/g, "|关池=")
				.replace(/\|第(\d+)次复刻开始时间=/g, "|复刻开$1=").replace(/\|第(\d+)次复刻结束时间=/g, "|复刻关$1=");
			const r4 = await grabGacha(renamed);
			check("反证：模板字段改名（源站改版）⇒ 抛错（`no-pools`，不是「当期没有」）",
				!!r4.err && /no-pools/.test(r4.err.message), JSON.stringify(r4.err && r4.err.message));
			// 活动侧
			const grabEvent = async (body) => {
				const tr = makeTransport([], { override: () => body });
				const e = createEngine({ transport: tr, storage: makeStore(), now: () => NOW_YS, timer: { setTimeout, clearTimeout } });
				const s = e.__test.SOURCES.find((x) => x.id === "yslz");
				let err = null;
				try { await e.__test.EVENT_FETCHERS["yslz"].default(s.eventUrl, undefined, s.tz, NOW_YS); } catch (e2) { err = e2; }
				return err;
			};
			const a1 = await grabEvent("{}");
			check("反证：活动响应 `{}` ⇒ 抛错（`yslz-events-changed:bad-json`）",
				!!a1 && /yslz-events-changed:bad-json/.test(a1.message), JSON.stringify(a1 && a1.message));
			const a2 = await grabEvent(JSON.stringify({ query: { results: {} } }));
			check("反证：`query.results` 空 ⇒ 抛错（`no-rows`）", !!a2 && /no-rows/.test(a2.message), JSON.stringify(a2 && a2.message));
			// 当期确实没有（只给往期）⇒ null（不是抛错）
			const past = JSON.stringify({ query: { results: {
				"【往期】": { printouts: { 名称: ["往期活动"], 开始时间: ["2020/01/01 10:00"], 结束时间: ["2020/01/10 23:59"], 类型: ["限时"] } }
			} } });
			const trP = makeTransport([], { override: () => past });
			const eP = createEngine({ transport: trP, storage: makeStore(), now: () => NOW_YS, timer: { setTimeout, clearTimeout } });
			const sP = eP.__test.SOURCES.find((x) => x.id === "yslz");
			const dP = await eP.__test.EVENT_FETCHERS["yslz"].default(sP.eventUrl, undefined, sP.tz, NOW_YS);
			check("当期确实没有（只有往期）⇒ **null**（未公布），不是抛错", dP === null, JSON.stringify(dP));
		}
	}
	// ═══════════════ ⑦ 无限暖暖（wxnn）—— 官网「资讯快报」列表 + 详情 ═══════════════
	section("无限暖暖 ⑦：官网资讯列表 + 详情（注册 / 共鸣时间→卡池 / 活动时间→活动 / 维护窗兜底 / 按 id 缓存 / 反证）");
	{
		const X = T.parsers.wxnn;
		const raw = (name) => fixtureBody("fixture:" + name, { ["fixture:" + name]: name + "/response.txt" });
		const LIST_RAW = raw("wxnn-list");
		const D92 = raw("wxnn-detail-1092");
		const D93 = raw("wxnn-detail-1093");
		const D94 = raw("wxnn-detail-1094");
		const D95 = raw("wxnn-detail-1095");
		// 夹具抓取时刻 = 2026-11-15 上午（+08）。now 取 11-15 12:00+08：
		// 卡池 11-13 11:00 ~ 11-27 01:29、五条活动全在期、外显 = 结束最早的「超级激化」。
		const NOW_X = Date.parse("2026-11-15T12:00:00+08:00");
		// 源站真实列表 15 条里有 6 篇**没有档期**的资讯稿（表情包 / OST / 声明 …），夹具只抓了带档期的
		// 1092/1093/1094/1095 ⇒ 用例用合成列表把 id 收窄，保证「每个请求都有夹具可回」，
		// 请求数断言才是在测**缓存**，而不是在测「失败跳过」。
		const listOf = (ids) => {
			const j = JSON.parse(LIST_RAW);
			const all = [];
			for (const k of ["allNews", "notices", "news"]) for (const it of j.data[k]) all.push(it);
			const uniq = new Map(all.map((it) => [it.id, it]));
			const rows = ids.map((id) => uniq.get(id) || {
				id, title: "《无限暖暖》奇想衣橱 | 万物繁生谣", section: 0, publish_time: "2026-11-10T07:30:00.000Z"
			});
			return JSON.stringify({ data: { allNews: rows, notices: [], news: [] } });
		};
		const withList = (ids, fallback) => (u) => {
			if (/\/api\/news$/.test(String(u))) return listOf(ids);
			return fallback ? fallback(String(u)) : null;
		};
		const urlsOf = (sink) => sink.filter((c) => c.via === "proxy").map((c) => String(c.url));
		const newsIdsOf = (sink) => urlsOf(sink)
			.map((u) => (/\/news\/(\d+)$/.exec(u) || [])[1])
			.filter(Boolean)
			.map(Number);
		// 可拨动的时钟 + 立即返回的计时器（空 body 重试别真睡 2.5 秒）
		const clock = { now: NOW_X };
		const engineX = (sink, opts) => createEngine({
			transport: makeTransport(sink, opts),
			storage: makeStore(),
			now: () => clock.now,
			timer: { setTimeout: (fn) => setTimeout(fn, 0), clearTimeout }
		});

		// ── 注册项 ──
		{
			const s = T.SOURCES.find((x) => x.id === "wxnn") || null;
					// 2026-11-15：列表实际有 4 个栏目（含 activity）——并集解析不能写死三个
		check("列表解析取 data 下所有数组的并集（activity 也要读）",
			X.wxnnListOf(JSON.stringify({ data: {
				allNews: [{ id: 11, title: "a" }],
				notices: [{ id: 12, title: "b" }],
				news: [{ id: 12, title: "b" }],
				activity: [{ id: 13, title: "c" }]
			} })).length === 3,
			"并集应为 3（11/12/13，12 重复只算一次）");
		check("条目已存在（id = wxnn）", !!s, s ? s.id : "缺失");
			check("名称 = 无限暖暖", !!s && s.name === "无限暖暖", s && s.name);
			check("tz = Asia/Shanghai（国服；`（UTC+8）` 与 `（服务器时间）` 两种后缀同一时区）",
				!!s && s.tz === "Asia/Shanghai", s && String(s.tz));
			check("defaultHidden = false（出厂展示）", !!s && s.defaultHidden === false, s && String(s.defaultHidden));
			check("有游戏主题色（#rrggbb）", !!s && /^#[0-9A-Fa-f]{6}$/.test(String(s.color)), s && String(s.color));
			check("卡池 url = 列表接口 `/api/news`（不分页：page/limit/section/offset 全被忽略）",
				!!s && s.url === X.WXNN_LIST_URL && /\/api\/news$/.test(s.url), s && String(s.url));
			check("活动 eventUrl = 同一条列表（两侧同一份载荷 ⇒ `fetchEntry` 只取一次）",
				!!s && s.eventUrl === X.WXNN_LIST_URL, s && String(s.eventUrl));
			check("两侧来源标签逐字 = 「官网公告」/「官网公告」（**提议**，等用户复核）",
				!!s && s.source === "官网公告" && s.eventSource === "官网公告",
				s && JSON.stringify([s.source, s.eventSource]));
			const e0 = engineX([]);
			check("两侧抓取器都登记（GACHA_FETCHERS.wxnn / EVENT_FETCHERS.wxnn.default）",
				typeof e0.__test.GACHA_FETCHERS["wxnn"] === "function"
				&& !!(e0.__test.EVENT_FETCHERS["wxnn"] && typeof e0.__test.EVENT_FETCHERS["wxnn"].default === "function"));
		}

		// ── 纯函数：列表 / 档期 / 维护窗（含「后缀剥掉、不进悬停」）──
		{
			const rows = X.wxnnListOf(LIST_RAW);
			check("列表 20 条（四栏各 5、含 activity、互相重叠）⇒ 按 id 去重后 15 篇唯一", rows.length === 15, String(rows.length));
			check("去重后含 1092/1094/1095（卡池稿 / 活动稿 / 维护稿）",
				rows.some((x) => x.id === 1092) && rows.some((x) => x.id === 1094) && rows.some((x) => x.id === 1095),
				rows.map((x) => x.id).join(","));
			check("`publish_time` 是 ISO 串也能解成毫秒（1094 = 2026-11-11T04:00:00Z）",
				rows.find((x) => x.id === 1094).publishTs === Date.UTC(2026, 10, 11, 4, 0),
				String(rows.find((x) => x.id === 1094).publishTs));

			const w1 = X.wxnnWindowOf("2026年11月13日版本更新后 — 2026年11月27日01:29（UTC+8）", null, X.WXNN_TZ);
			check("「版本更新后」⇒ startTs = null + openDate 11-13（不编时刻），终点 = 11-27 01:29",
				!!w1 && w1.startTs === null && w1.endTs === Date.UTC(2026, 10, 26, 17, 29)
				&& !!w1.openDate && w1.openDate.mo === 11 && w1.openDate.d === 13,
				JSON.stringify(w1 && [w1.startTs, w1.endTs, w1.openDate]));
			check("raw = 源站原文（连接号统一 `~`），时间后缀已剥掉（`（UTC+8）` 不进悬停）",
				!!w1 && w1.raw === "2026年11月13日版本更新后 ~ 2026年11月27日01:29", w1 && w1.raw);
			const w2 = X.wxnnWindowOf("2026年11月14日04:00 — 2026年11月21日03:59（服务器时间）", null, X.WXNN_TZ);
			check("两端都明确 + 另一种后缀「（服务器时间）」⇒ 按 UTC+8 换算绝对时刻",
				!!w2 && w2.startTs === Date.UTC(2026, 10, 13, 20, 0) && w2.endTs === Date.UTC(2026, 10, 20, 19, 59),
				JSON.stringify(w2 && [w2.startTs, w2.endTs]));
			check("「（服务器时间）」同样剥掉：raw 里既没有 UTC 也没有那个后缀",
				!!w2 && w2.raw === "2026年11月14日04:00 ~ 2026年11月21日03:59", w2 && w2.raw);
			const m1 = X.wxnnMaintOf("我们计划将于2026年11月13日10:00-11:00（UTC+8）进行停服维护更新，维护期间将无法登录游戏", null, X.WXNN_TZ);
			check("维护窗 ⇒ 锚点 = 维护结束 11-13 11:00（`10:00-11:00` 取后半段）",
				!!m1 && m1.y === 2026 && m1.mo === 11 && m1.d === 13 && m1.ts === Date.UTC(2026, 10, 13, 3, 0),
				JSON.stringify(m1));

			const throwsWith = (f, re) => { try { f(); return false; } catch (e) { return re.test(e.message); } };
			check("列表 `{}` ⇒ 抛错（`wxnn-list-changed:no-data`），不是「当期没有」",
				throwsWith(() => X.wxnnListOf("{}"), /no-data/));
			check("列表空串 ⇒ 抛错（`bad-json`）", throwsWith(() => X.wxnnListOf(""), /bad-json/));
			check("三个桶都是空数组 ⇒ 抛错（`no-news`）",
				throwsWith(() => X.wxnnListOf(JSON.stringify({ data: { allNews: [], notices: [], news: [] } })), /no-news/));

			const p94 = X.wxnnPageOf(D94);
			check("详情页 `__NEXT_DATA__.pageData` 能取到 title / publishTs / content_html",
				!!p94 && /活动开启提醒/.test(p94.title) && p94.publishTs === Date.UTC(2026, 10, 11, 4, 0) && p94.contentHtml.length > 500,
				JSON.stringify(p94 && [p94.title, p94.publishTs, p94.contentHtml.length]));
			check("骨架页（旧 id / 不存在的 id 回 200）⇒ pageData 取不到 ⇒ null（跳过，不是失败）",
				X.wxnnPageOf("<html><body>no next data</body></html>") === null);
			check("没有 pageData 的空壳 __NEXT_DATA__ ⇒ null",
				X.wxnnPageOf('<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script>') === null);
			// 1093 / 1095 的夹具至少要被用到一次（否则抓了没人验证）
			check("1093 详情夹具能解出「予大地以时光」（共鸣时间独占一行、池名只在正文）",
				(() => {
					const p = X.wxnnPageOf(D93);
					if (!p) return false;
					const items = X.wxnnFactsOf({ id: 1093, title: p.title, publishTs: p.publishTs }, p, X.WXNN_TZ);
					return items.gacha.length === 1 && items.gacha[0].name === "予大地以时光";
				})());
			check("1095 详情夹具只贡献维护窗（没有共鸣/活动锚点）",
				(() => {
					const p = X.wxnnPageOf(D95);
					if (!p) return false;
					const f = X.wxnnFactsOf({ id: 1095, title: p.title, publishTs: p.publishTs }, p, X.WXNN_TZ);
					return f.maint.length === 1 && f.maint[0].ts === Date.UTC(2026, 10, 13, 3, 0)
						&& f.gacha.length === 0 && f.events.length === 0;
				})());
		}

		// ── 端到端：一篇 5 条活动的稿 + 一篇维护稿 + 一篇共鸣稿 ──
		{
			const sink = [];
			const e = engineX(sink, { override: withList([1094, 1095, 1092]) });
			const s = e.__test.SOURCES.find((x) => x.id === "wxnn");
			const r = await e.__test.fetchEntry(s);
			check("首轮请求 = 列表 1 + 详情 3（只对列表里的 id 取）", urlsOf(sink).length === 4, urlsOf(sink).join(" | "));
			check("卡池外显 = 何人消隐于祷声（池名取 `前往「…」进行共鸣`，不是标题）",
				r.data.banner === "何人消隐于祷声", JSON.stringify(r.data.banner));
			check("卡池档期 = 「11-13 11:00 ~ 11-27 01:29」（起点由 1095 的同批维护窗补出 11:00）",
				r.data.bannerDates === "11-13 11:00 ~ 11-27 01:29", JSON.stringify(r.data.bannerDates));
			check("卡池原文保留相对表述 = 「2026年11月13日版本更新后 ~ 2026年11月27日01:29」",
				r.data.bannerDatesRaw === "2026年11月13日版本更新后 ~ 2026年11月27日01:29", JSON.stringify(r.data.bannerDatesRaw));
			check("卡池 roles = 空串（源站只给池名与套装名；套装不是「角色」）", r.data.roles === "", JSON.stringify(r.data.roles));
			check("活动外显 = 超级激化（覆盖 now 的活动里结束最早的）", r.data.event === "超级激化", JSON.stringify(r.data.event));
			check("活动外显档期 = 「11-14 04:00 ~ 11-21 03:59」（两端都明确）",
				r.data.eventDates === "11-14 04:00 ~ 11-21 03:59", JSON.stringify(r.data.eventDates));
			check("`gacha[]` 1 条（绝对时刻 11-13 11:00 ~ 11-27 01:29）",
				(r.data.gacha || []).length === 1
				&& r.data.gacha[0].startTs === Date.UTC(2026, 10, 13, 3, 0)
				&& r.data.gacha[0].endTs === Date.UTC(2026, 10, 26, 17, 29),
				JSON.stringify((r.data.gacha || []).map((x) => [x.title, x.startTs, x.endTs])));
			check("`events[]` 5 条（一篇多活动全部进数组，不是只取外显那条）",
				(r.data.events || []).length === 5, JSON.stringify((r.data.events || []).map((x) => x.title)));
			check("5 条活动的名字逐字（第 5 条带尾巴的保留整行，不去引号）",
				JSON.stringify((r.data.events || []).map((x) => x.title))
				=== JSON.stringify(["超级激化", "向明日落笔", "艾莉森的旅行小铺", "星光评选赛", "「颂愿感悟之礼」系列礼包限时上架"]),
				JSON.stringify((r.data.events || []).map((x) => x.title)));
			check("活动悬停 5 行（相对起点的行退回源站原文）",
				String(r.data.eventHover || "").split("\n").filter(Boolean).length === 5,
				JSON.stringify(String(r.data.eventHover || "").split("\n")));
			assertHoverConvention("无限暖暖活动悬停", r.data.eventHover);
			assertHoverConvention("无限暖暖卡池悬停（单条 ⇒ 允许空，由 UI 两行式兜底）", r.data.bannerHover || "");

			// ── 稳态：同一个引擎第二轮只有列表那 1 个请求 ──
			sink.length = 0;
			const r2 = await e.__test.fetchEntry(s);
			check("稳态（缓存内）：第二轮只发 1 个请求（列表），详情一篇都不重取",
				urlsOf(sink).length === 1, urlsOf(sink).join(" | "));
			check("稳态第二轮的外显与首轮逐字相同",
				r2.data.banner === r.data.banner && r2.data.bannerDates === r.data.bannerDates
				&& r2.data.event === r.data.event, JSON.stringify([r2.data.banner, r2.data.event]));
		}

		// ── 新公告出现：只补那一条（1093 = 锚点独占一行 + 池名只在正文）──
		{
			const sink = [];
			const e = engineX(sink, { override: withList([1094, 1095, 1092, 1093]) });
			const s = e.__test.SOURCES.find((x) => x.id === "wxnn");
			await e.__test.fetchEntry(s);
			check("列表多出一篇 1093 ⇒ 首轮 1 + 4 个请求", urlsOf(sink).length === 5, urlsOf(sink).join(" | "));
			sink.length = 0;
			const g = await e.__test.GACHA_FETCHERS["wxnn"](s.url, undefined, s.tz);
			check("1093 解析出「予大地以时光」（`共鸣时间` 单独一行 + 「前往…进行共鸣」给池名）",
				!!g && (g.gacha || []).some((x) => x.title === "予大地以时光"),
				JSON.stringify((g && g.gacha || []).map((x) => x.title)));
			check("新篇已入缓存 ⇒ 再取一轮只有列表 1 个请求", urlsOf(sink).length === 1, urlsOf(sink).join(" | "));
			check("两口池同窗 ⇒ 悬停把同名同窗折叠成「名称… ⏎ 档期」两行式",
				!!g && String(g.bannerHover || "").split("\n").filter(Boolean).length === 3,
				JSON.stringify(String((g && g.bannerHover) || "").split("\n")));
			assertHoverConvention("无限暖暖卡池悬停（两口池同窗）", (g && g.bannerHover) || "");
		}

		// ── 24h TTL + 已结束的封存：稳态仍只有列表 1 个请求 ──
		{
			clock.now = NOW_X;
			const sink = [];
			const e = engineX(sink, { override: withList([1094, 1095, 1092]) });
			const s = e.__test.SOURCES.find((x) => x.id === "wxnn");
			await e.__test.fetchEntry(s);
			sink.length = 0;
			clock.now = NOW_X + 25 * 3600 * 1000;   // 距上次 > 24h
			await e.__test.fetchEntry(s);
			const idsTtl = newsIdsOf(sink);
			check("过 24h TTL 后：仍在期的 1092/1094 补一次详情，无档期的 1095 不再取",
				idsTtl.length === 2 && idsTtl.includes(1092) && idsTtl.includes(1094), idsTtl.join(","));
			sink.length = 0;
			clock.now = NOW_X + 40 * 24 * 3600 * 1000;   // 全部档期已结束
			const r40 = await e.__test.fetchEntry(s);
			check("40 天后（全部档期已结束）：**详情一篇都不重取**（封存）——剩下的请求只有列表",
				newsIdsOf(sink).length === 0, `${urlsOf(sink).length} 个请求，详情 ${newsIdsOf(sink).join(",")}`);
			check("40 天后当期确实没有 ⇒ 卡池/活动都不外显（如实 null，不拿过期档期顶）",
				!r40.data.banner && !r40.data.event, JSON.stringify([r40.data.banner, r40.data.event]));
			clock.now = NOW_X;
		}

		// ── 反证 ①：抹掉「共鸣时间」锚点 ⇒ 卡池不进外显（活动侧不受影响）──
		{
			const e = engineX([], { override: withList([1094, 1095, 1092], (u) => (/\/news\/1092$/.test(u) ? D92.replace(/共鸣时间/g, "共鸣说明") : null)) });
			const s = e.__test.SOURCES.find((x) => x.id === "wxnn");
			const r = await e.__test.fetchEntry(s);
			check("反证：抹掉「共鸣时间」⇒ 卡池外显 = null（没有锚点就不产出，不硬凑）",
				!r.data.banner && !r.data.bannerDates, JSON.stringify([r.data.banner, r.data.bannerDates]));
			check("反证：同一轮里活动侧照常出（1094 的「活动时间」锚点没被动）",
				r.data.event === "超级激化" && (r.data.events || []).length === 5, JSON.stringify(r.data.event));
		}

		// ── 反证 ②：抹掉「活动时间」锚点 ⇒ 活动不进外显，卡池照常 ──
		{
			const e = engineX([], { override: withList([1094, 1095, 1092], (u) => (/\/news\/1094$/.test(u) ? D94.replace(/活动时间/g, "活动档期") : null)) });
			const s = e.__test.SOURCES.find((x) => x.id === "wxnn");
			const r = await e.__test.fetchEntry(s);
			check("反证：抹掉「活动时间」⇒ 活动外显 = null、`events[]` 空",
				!r.data.event && (r.data.events || []).length === 0, JSON.stringify([r.data.event, (r.data.events || []).length]));
			check("反证：卡池侧照常（同一轮两侧锚点互不影响）", r.data.banner === "何人消隐于祷声", JSON.stringify(r.data.banner));
		}

		// ── 反证 ③：抹掉维护窗 ⇒ 「版本更新后」如实留空（不编 10:00 / 12:00 之类的时刻）──
		{
			const e = engineX([], { override: withList([1094, 1092], null) });   // 列表里没有 1095 ⇒ 没有维护窗
			const s = e.__test.SOURCES.find((x) => x.id === "wxnn");
			const g = await e.__test.GACHA_FETCHERS["wxnn"](s.url, undefined, s.tz);
			check("反证：没有维护窗 ⇒ 卡池不外显（「版本更新后」的起点如实留空，不拿 10:00 之类去猜）",
				!g || !g.banner, JSON.stringify(g && [g.banner, g.bannerDates]));
			check("反证：同一轮活动侧仍有「超级激化」（它两端都明确，不依赖维护窗）",
				!!g && g.event === "超级激化", JSON.stringify(g && g.event));
		}

		// ── 反证 ④：列表 `{}` ⇒ 抛错（不是 nomatch）──
		{
			const sink = [];
			const e = engineX(sink, { override: (u) => (/\/api\/news$/.test(u) ? "{}" : null) });
			const s = e.__test.SOURCES.find((x) => x.id === "wxnn");
			const r = await e.__test.fetchEntry(s);
			check("反证：列表 `{}` ⇒ 该侧记 down，不是「未公布」",
				!!r.gachaFail && r.gachaFail.kind === "down", JSON.stringify(r.gachaFail));
			let err = null;
			try { await e.__test.GACHA_FETCHERS["wxnn"](s.url, undefined, s.tz); } catch (e2) { err = e2; }
			check("反证：抓取器本身对 `{}` 抛 `wxnn-list-changed:no-data`",
				!!err && /wxnn-list-changed:no-data/.test(err.message), JSON.stringify(err && err.message));
		}

		// ── 反证 ⑤：详情回空 body（短时限流）⇒ 重试 3 次后跳过该条，其余照出 ──
		{
			const sink = [];
			const e = engineX(sink, {
				override: withList([1094, 1095, 1092], (u) => (/\/news\/1092$/.test(u) ? "" : null))
			});
			const s = e.__test.SOURCES.find((x) => x.id === "wxnn");
			const r = await e.__test.fetchEntry(s);
			const calls92 = urlsOf(sink).filter((u) => /\/news\/1092$/.test(u)).length;
			check("反证：空 body ⇒ 重试 2 次（共 3 次请求）后跳过该条", calls92 === 3, String(calls92));
			check("反证：被跳过的那篇不影响另一侧（活动照出 5 条）",
				r.data.event === "超级激化" && (r.data.events || []).length === 5, JSON.stringify(r.data.event));
			check("反证：卡池那一侧因为没拿到 ⇒ 不外显（不抛错、不硬凑）", !r.data.banner, JSON.stringify(r.data.banner));
		}

		// ── 反证 ⑥：全部详情都拿不到（缓存也空）⇒ down（别把封禁静默成「未公布」）──
		{
			const e = engineX([], { override: (u) => (/\/api\/news$/.test(u) ? listOf([1094, 1095, 1092]) : "") });
			const s = e.__test.SOURCES.find((x) => x.id === "wxnn");
			const r = await e.__test.fetchEntry(s);
			check("反证：全部详情失败 + 缓存为空 ⇒ 该侧 down",
				!!r.gachaFail && r.gachaFail.kind === "down", JSON.stringify(r.gachaFail));
		}
	}

	// ═══════════════════ ⑯ 盲盒派对（gachaparty，2026-11-15 接入）═══════════════════
	// 两侧 URL 不同：卡池 = bwiki `模板:近期盲盒扭蛋` 的 wikitext（`prop=wikitext`）；
	// 活动 = 同站 SMW `action=ask` 查 `分类:活动`（首页那份 `模板:近期活动` 只有结束时刻、没有起点
	// ⇒ 按仓库口径构不成窗口，不取它 —— 见 `30-game-bwiki-gachaparty.js` 文件头 ②）。
	section("第二批⑯：盲盒派对 —— bwiki 卡池模板（注释里的旧池不算）+ SMW 活动");
	{
		const GP = T.parsers.gachaparty;
		const GP_POOL = GP.GACHAPARTY_POOL_URL;
		const GP_EVENT = GP.GACHAPARTY_EVENT_URL;
		// 抓取时刻 2026-11-15 13:50 +08（夹具 capturedAt 之后）⇒ 三池 / 两活动都在期
		// （秋日自选扩招与山河同庆当天 23:59 结束）
		const GP_NOW = Date.parse("2026-11-15T13:50:00+08:00");
		const at = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi) - 8 * 3600 * 1000;

		// ── ⑯-1 注册 ──
		{
			const s = T.SOURCES.find((x) => x.id === "gachaparty") || null;
			check("条目已存在（id = gachaparty）", !!s, s ? s.id : "缺失");
			check("name = 盲盒派对", !!s && s.name === "盲盒派对", s && s.name);
			check("tz = Asia/Shanghai", !!s && s.tz === "Asia/Shanghai", s && s.tz);
			check("卡池 url = 模板:近期盲盒扭蛋 的 wikitext（prop=wikitext）",
				!!s && s.url === GP_POOL && /action=parse/.test(s.url) && /prop=wikitext/.test(s.url), s && String(s.url));
			check("活动 eventUrl = SMW action=ask（**不是**首页模板）",
				!!s && s.eventUrl === GP_EVENT && /action=ask/.test(s.eventUrl), s && String(s.eventUrl));
			check("两侧来源标签逐字 = Bwiki 近期盲盒扭蛋 / Bwiki 近期活动",
				!!s && s.source === "Bwiki 近期盲盒扭蛋" && s.eventSource === "Bwiki 近期活动",
				s && JSON.stringify([s.source, s.eventSource]));
			check("defaultHidden = false（出厂展示）", !!s && s.defaultHidden === false, s && String(s.defaultHidden));
			check("配色已登记（gachaparty = #B4559F）", !!s && s.color === "#B4559F", s && String(s.color));
		}

		// ── ⑯-2 卡池：注释里的 7 个旧池不算；三个在期池逐字 ──
		{
			const calls = [];
			const e = engineAt(GP_NOW, calls);
			const s = e.__test.SOURCES.find((x) => x.id === "gachaparty");
			const gp = await e.__test.GACHA_FETCHERS["gachaparty"](s.url, undefined, s.tz);
			check("卡池抓取器返回对象（不是 null）", !!gp && typeof gp === "object");
			check("外显池名 = 秋日自选扩招（结束最早那口）", !!gp && gp.banner === "秋日自选扩招", JSON.stringify(gp && gp.banner));
			check("UP 逐字 = 太极宗师、心愿自选角色（`3` 号位是源站的占位写法，也照抄）",
				!!gp && gp.roles === "太极宗师、心愿自选角色", JSON.stringify(gp && gp.roles));
			check("档期 = 09-27 00:00 ~ 11-15 23:59（源站原文两端 = 2026/9/27 0:00 ~ 2026/11/15 23:59）",
				!!gp && gp.bannerDates === "09-27 00:00 ~ 11-15 23:59"
				&& gp.bannerDatesRaw === "2026/9/27 0:00 ~ 2026/11/15 23:59",
				JSON.stringify([gp && gp.bannerDates, gp && gp.bannerDatesRaw]));
			check("`gacha[]` 3 条在期池（结束时间升序）",
				!!gp && Array.isArray(gp.gacha) && gp.gacha.length === 3
				&& gp.gacha.map((x) => x.title).join("|") === "秋日自选扩招|万圣卡池：星夜床头柜、夜灯守护者|联动卡池：天鹅魔女",
				JSON.stringify(gp && (gp.gacha || []).map((x) => x.title)));
			check("三条池的绝对时刻逐条对（UTC 手算，与时区无关）",
				!!gp && gp.gacha[0].startTs === at(2026, 9, 27, 0, 0) && gp.gacha[0].endTs === at(2026, 11, 15, 23, 59)
				&& gp.gacha[1].startTs === at(2026, 10, 29, 0, 0) && gp.gacha[1].endTs === at(2026, 11, 22, 23, 59)
				&& gp.gacha[2].startTs === at(2026, 11, 5, 0, 0) && gp.gacha[2].endTs === at(2026, 11, 29, 23, 59),
				JSON.stringify((gp && gp.gacha || []).map((x) => [x.startTs, x.endTs])));
			// 反证：`<!-- … -->` 里的 7 个调用（套圈广场 / 周年自选扩招 / 节拍律动 / 商城兑换 /
			// 夏日自选扩招 / 联动卡池-幸福天使 / 春日自选扩招）一个都不许出现
			const all = JSON.stringify(gp || {});
			const leaked = ["套圈广场", "周年自选扩招", "节拍律动", "商城兑换", "夏日自选扩招", "幸福天使", "春日自选扩招"]
				.filter((n) => all.indexOf(n) >= 0);
			check("反证：注释里已下架的 7 个旧池一个都没漏进载荷", leaked.length === 0, leaked.join(","));
			assertHoverConvention("gachaparty 卡池悬停", gp && gp.bannerHover, { requireSet: true });
			check("悬停三行池（池名：角色 ⏎ 档期 …）",
				!!gp && String(gp.bannerHover).split("\n").length === 6 && String(gp.bannerHover).indexOf("万圣卡池：星夜床头柜、夜灯守护者") >= 0,
				JSON.stringify(gp && gp.bannerHover));
		}

		// ── ⑯-3 活动：SMW 的 `"20261029"` → 起 00:00 / 止 23:59 ──
		{
			const calls = [];
			const e = engineAt(GP_NOW, calls);
			const s = e.__test.SOURCES.find((x) => x.id === "gachaparty");
			const ge = await e.__test.EVENT_FETCHERS["gachaparty"].default(s.eventUrl, undefined, s.tz);
			check("活动抓取器返回对象（不是 null）", !!ge && typeof ge === "object");
			check("活动外显 = 山河同庆（结束最早）", !!ge && ge.event === "山河同庆", JSON.stringify(ge && ge.event));
			check("活动档期 = 09-27 00:00 ~ 11-15 23:59（源站原文两端 = 20260927 ~ 20261115）",
				!!ge && ge.eventDates === "09-27 00:00 ~ 11-15 23:59" && ge.eventDatesRaw === "20260927 ~ 20261115",
				JSON.stringify([ge && ge.eventDates, ge && ge.eventDatesRaw]));
			check("`events[]` 2 条在期（山河同庆 / 万圣惊魂夜；11-08 就结束的智能生活节不在）",
				!!ge && Array.isArray(ge.events) && ge.events.length === 2
				&& ge.events[0].title === "山河同庆" && ge.events[1].title === "万圣惊魂夜",
				JSON.stringify(ge && (ge.events || []).map((x) => x.title)));
			check("活动时刻逐条对（起 00:00 / 止 23:59）",
				!!ge && ge.events[0].startTs === at(2026, 9, 27, 0, 0) && ge.events[0].endTs === at(2026, 11, 15, 23, 59)
				&& ge.events[1].startTs === at(2026, 10, 29, 0, 0) && ge.events[1].endTs === at(2026, 11, 22, 23, 59),
				JSON.stringify((ge && ge.events || []).map((x) => [x.startTs, x.endTs])));
			assertHoverConvention("gachaparty 活动悬停", ge && ge.eventHover, { requireSet: true });
		}

		// ── ⑯-4 请求数：整轮 2 次（卡池 1 + 活动 1，两侧 URL 不同 ⇒ 没有共享）──
		{
			const sink = [];
			const allIds = engineAt(GP_NOW, []).__test.SOURCES.map((x) => x.id);
			const only = { hidden: allIds.filter((id) => id !== "gachaparty"), shown: ["gachaparty"] };
			const e = engineAt(GP_NOW, sink, only);
			const r = await e.refresh();
			const rec = r.games["gachaparty"] || {};
			const proxied = proxyCallsOf(sink);
			check("整轮：两侧都不 fail", rec.gachaFail == null && rec.eventFail == null,
				JSON.stringify([rec.gachaFail, rec.eventFail]));
			check("整轮：请求总数 = 2（卡池模板 1 次 + SMW 1 次）", proxied.length === 2, String(proxied.length));
			check("整轮：两次都带 Referer: https://wiki.biligame.com/（否则 567）",
				proxied.every((c) => c.referer === "https://wiki.biligame.com/"), JSON.stringify(proxied.map((c) => c.referer)));
			check("整轮记录：卡池 + 活动两侧字段都落进同一条记录",
				rec.banner === "秋日自选扩招" && rec.event === "山河同庆" && (rec.gacha || []).length === 3 && (rec.events || []).length === 2,
				JSON.stringify([rec.banner, rec.event, (rec.gacha || []).length, (rec.events || []).length]));
		}

		// ── ⑯-5 纯解析：剥注释 / 命名参数也算 UP ──
		{
			const wt = JSON.parse(fixtureBody(GP_POOL)).parse.wikitext;
			const callsAll = GP.gachapartyPoolCallsOf(wt);
			check("剥注释后只剩 3 个 `{{首页卡池}}` 调用（原文 10 个，7 个在注释里）",
				callsAll.length === 3, String(callsAll.length));
			const args = GP.gachapartyArgsOf("秋日自选扩招|太极宗师|心愿自选角色|2026/9/27 0:00|2026/11/15 23:59|link-2=山河同庆");
			check("参数拆分：5 个位置参数 + 命名参数 link-2 不进位置参数",
				args.pos.length === 5 && args.pos[0] === "秋日自选扩招" && args.pos[4] === "2026/11/15 23:59"
				&& args.named["link-2"] === "山河同庆",
				JSON.stringify([args.pos.length, args.pos[4], args.named["link-2"]]));
			const withExtra = GP.gachapartyPoolOf("池甲|角色甲|角色乙|2026/1/1 0:00|2026/1/8 23:59|补充角色1=角色丙|补充角色2=角色丁", "Asia/Shanghai");
			check("命名参数 补充角色1/2 也算 UP（模板里同样渲染成角色按钮）",
				!!withExtra && withExtra.roles === "角色甲、角色乙、角色丙、角色丁", JSON.stringify(withExtra && withExtra.roles));
			const noDate = GP.gachapartyPoolOf("商城兑换|风之铃|||", "Asia/Shanghai");
			check("反证：起止全空（源站真的这么写过）⇒ 这条不产出", noDate === null, JSON.stringify(noDate));
		}

		// ── ⑯-6 反证：抹掉时间锚点 ⇒ 不进外显；`{}` ⇒ 抛错（非 nomatch）──
		{
			// 抹掉万圣卡池那一行的起止（`|2026/10/29 0:00|2026/11/22 23:59` → `||`）
			const e = engineAt(GP_NOW, [], null, {
				override: (u) => (/gachaparty\/api\.php\?action=parse/.test(u)
					? fixtureBody(GP_POOL).replace("|2026/10/29 0:00|2026/11/22 23:59", "||")
					: null)
			});
			const s = e.__test.SOURCES.find((x) => x.id === "gachaparty");
			const gp = await e.__test.GACHA_FETCHERS["gachaparty"](s.url, undefined, s.tz);
			check("反证：抹掉万圣卡池的起止 ⇒ 它从 `gacha[]` 里消失（3 → 2）",
				!!gp && gp.gacha.length === 2 && JSON.stringify(gp).indexOf("万圣卡池") < 0,
				JSON.stringify(gp && (gp.gacha || []).map((x) => x.title)));
			check("反证：外显不受影响（仍是秋日自选扩招）", !!gp && gp.banner === "秋日自选扩招", JSON.stringify(gp && gp.banner));

			// 起止全被抹掉 ⇒ 一条窗口都没有 ⇒ null（未公布，**不抛错**）
			const e2 = engineAt(GP_NOW, [], null, {
				override: (u) => (/gachaparty\/api\.php\?action=parse/.test(u)
					? fixtureBody(GP_POOL).replace(/\|2026\/\d{1,2}\/\d{1,2} \d{1,2}:\d{2}\|2026\/\d{1,2}\/\d{1,2} \d{1,2}:\d{2}/g, "||")
					: null)
			});
			const s2 = e2.__test.SOURCES.find((x) => x.id === "gachaparty");
			const gp2 = await e2.__test.GACHA_FETCHERS["gachaparty"](s2.url, undefined, s2.tz);
			check("反证：所有池的起止都被抹掉 ⇒ 卡池侧 null（不是抛错）", gp2 === null, JSON.stringify(gp2));

			// `{}` ⇒ 抛错（不是"未公布"）
			const e3 = engineAt(GP_NOW, [], null, { override: (u) => (/gachaparty\/api\.php/.test(u) ? "{}" : null) });
			const s3 = e3.__test.SOURCES.find((x) => x.id === "gachaparty");
			let err = null;
			try { await e3.__test.GACHA_FETCHERS["gachaparty"](s3.url, undefined, s3.tz); } catch (e4) { err = e4; }
			check("反证：卡池模板回 `{}` ⇒ 抛 `gachaparty-pools-changed:no-wikitext`",
				!!err && /gachaparty-pools-changed:no-wikitext/.test(err.message), JSON.stringify(err && err.message));
			let err2 = null;
			try { await e3.__test.EVENT_FETCHERS["gachaparty"].default(s3.eventUrl, undefined, s3.tz); } catch (e5) { err2 = e5; }
			check("反证：SMW 回 `{}` ⇒ 抛 `gachaparty-events-changed:no-results`",
				!!err2 && /gachaparty-events-changed:no-results/.test(err2.message), JSON.stringify(err2 && err2.message));

			// 空分类（results = {}）⇒ null（当期没有，不是失败）
			const e6 = engineAt(GP_NOW, [], null, {
				override: (u) => (/gachaparty\/api\.php\?action=ask/.test(u) ? JSON.stringify({ query: { results: {} } }) : null)
			});
			const s6 = e6.__test.SOURCES.find((x) => x.id === "gachaparty");
			const ge6 = await e6.__test.EVENT_FETCHERS["gachaparty"].default(s6.eventUrl, undefined, s6.tz);
			check("反证：分类里一条活动都没有 ⇒ 活动侧 null（不是抛错）", ge6 === null, JSON.stringify(ge6));
		}
	}
	// ═══════════════════ 2026-11-15 第三批：碧蓝幻想（gbf）/ 舰队Collection（kancolle）═══════════════════
	// 两条都**只接活动侧**（卡池侧 `url: ""` = 未配置，一个请求都不发）：
	//   · gbf        = gbf-wiki.com「イベント/開催予定・開催中」（PukiWiki 两张同构表：現在開催中 + 今後の予定）
	//   · kancolle   = wikiwiki.jp「期間限定出撃」（历年大型活动档案，新的一期在最上面）
	// 真夹具：`gbf-events`（2026-11-15 抓，裁剪到两张表）/ `kancolle-events`（同日抓，裁剪到最新 6 期）。
	// 断言一律写 `Date.UTC(...)` 手算的绝对毫秒：UTC 与 +08 两道门禁跑**同一份期望值**。
	{
		section("2026-11-15 第三批①：注册项（两条都只接活动侧 + 标签逐字 + 颜色下发）");
		const GF = T.parsers.gbf;
		const KC = T.parsers.kancolle;
		const gbf = T.SOURCES.find((x) => x.id === "gbf") || null;
		const kc = T.SOURCES.find((x) => x.id === "kancolle") || null;
		check("gbf 已注册进 SOURCES", !!gbf, gbf ? gbf.id : "缺失");
		check("kancolle 已注册进 SOURCES", !!kc, kc ? kc.id : "缺失");
		check("gbf 名称 = 碧蓝幻想·日服", !!gbf && gbf.name === "碧蓝幻想·日服", gbf && gbf.name);
		check("kancolle 名称 = 舰队Collection·日服", !!kc && kc.name === "舰队Collection·日服", kc && kc.name);
		check("gbf tz = Asia/Tokyo（源站自身口径）", !!gbf && gbf.tz === "Asia/Tokyo", gbf && String(gbf.tz));
		check("kancolle tz = Asia/Tokyo（源站自身口径）", !!kc && kc.tz === "Asia/Tokyo", kc && String(kc.tz));
		check("gbf tz 与解析器常量一致", GF.GBF_TZ === "Asia/Tokyo", GF.GBF_TZ);
		check("kancolle tz 与解析器常量一致", KC.KANCOLLE_TZ === "Asia/Tokyo", KC.KANCOLLE_TZ);
		check("gbf 出厂不展示（defaultHidden = true，缺卡池侧；用户 2026-11-19 口径）", !!gbf && gbf.defaultHidden === true, gbf && String(gbf.defaultHidden));
		check("kancolle 出厂不展示（defaultHidden = true，缺卡池侧；用户 2026-11-19 口径）", !!kc && kc.defaultHidden === true, kc && String(kc.defaultHidden));
		// 颜色由 20-source-core.js 的 SOURCE_COLORS 下发（条目自己不写 color）
		check("gbf 颜色 = #2E62B0（王室蓝，已下发）", !!gbf && gbf.color === "#2E62B0", gbf && String(gbf.color));
		check("kancolle 颜色 = #3C5470（浓绀，已下发）", !!kc && kc.color === "#3C5470", kc && String(kc.color));
		check("两条都有 http(s) 图标",
			!!gbf && /^https?:\/\//.test(String(gbf.icon)) && !!kc && /^https?:\/\//.test(String(kc.icon)),
			`${gbf && String(gbf.icon).slice(0, 46)} | ${kc && String(kc.icon).slice(0, 46)}`);
		// 卡池侧**刻意留空**（未配置 ⇒ 不发请求、面板显示「未配置」，不是失败）
		check("gbf 卡池侧未配置（url = \"\" 且不写 source）",
			!!gbf && gbf.url === "" && gbf.source == null, gbf && JSON.stringify({ url: gbf.url, source: gbf.source }));
		check("kancolle 卡池侧未配置（url = \"\" 且不写 source）",
			!!kc && kc.url === "" && kc.source == null, kc && JSON.stringify({ url: kc.url, source: kc.source }));
		// 活动侧 = 源站单页；标签逐字
		check("gbf eventUrl = gbf-wiki 的「イベント/開催予定・開催中」",
			!!gbf && gbf.eventUrl === GF.GBF_EVENTS_URL && /^https:\/\/gbf-wiki\.com\/\?/.test(String(gbf.eventUrl)), gbf && String(gbf.eventUrl));
		check("kancolle eventUrl = wikiwiki 的「期間限定出撃」",
			!!kc && kc.eventUrl === KC.KANCOLLE_EVENTS_URL && /^https:\/\/wikiwiki\.jp\/kancolle\//.test(String(kc.eventUrl)), kc && String(kc.eventUrl));
		check("gbf 活动来源标签逐字 = wiki 活动一览（gbf-wiki）",
			!!gbf && gbf.eventSource === "wiki 活动一览（gbf-wiki）", gbf && String(gbf.eventSource));
		check("kancolle 活动来源标签逐字 = wiki 活动一览（wikiwiki）",
			!!kc && kc.eventSource === "wiki 活动一览（wikiwiki）", kc && String(kc.eventSource));
		check("gbf 标签与常量同源", GF.GBF_SOURCE_LABEL === (gbf && gbf.eventSource), GF.GBF_SOURCE_LABEL);
		check("kancolle 标签与常量同源", KC.KANCOLLE_SOURCE_LABEL === (kc && kc.eventSource), KC.KANCOLLE_SOURCE_LABEL);
		check("gbf 活动抓取器已登记（EVENT_FETCHERS.gbf.default）",
			typeof (T.EVENT_FETCHERS.gbf && T.EVENT_FETCHERS.gbf.default) === "function");
		check("kancolle 活动抓取器已登记（EVENT_FETCHERS.kancolle.default）",
			typeof (T.EVENT_FETCHERS.kancolle && T.EVENT_FETCHERS.kancolle.default) === "function");
		check("gbf 没有卡池抓取器（卡池侧未配置）", T.GACHA_FETCHERS.gbf == null, typeof T.GACHA_FETCHERS.gbf);
		check("kancolle 没有卡池抓取器（卡池侧未配置）", T.GACHA_FETCHERS.kancolle == null, typeof T.GACHA_FETCHERS.kancolle);
		check("id 全局唯一（新增两条没造成重复）", new Set(T.SOURCES.map((x) => x.id)).size === T.SOURCES.length);
	}

	{
		section("2026-11-15 第三批②：碧蓝幻想 —— gbf-wiki 两张活动表（真夹具）");
		const GF = T.parsers.gbf;
		const html = fixtureBody(GF.GBF_EVENTS_URL);
		const tables = GF.gbfTablesOf(html).filter((t) => t.includes(GF.GBF_DATE_HEAD));
		check("两张活动表都命中（表头含「開催日時」的那两张）", tables.length === 2, String(tables.length));
		const items = GF.gbfItemsOf(html, GF.GBF_TZ);
		check("解析出 4 条（現在開催中 1 + 今後 3）", items.length === 4, JSON.stringify(items.map((x) => x.event)));
		const want = [
			["十天衆戦記", Date.UTC(2026, 10, 13, 8, 0), Date.UTC(2026, 10, 20, 7, 59), "2026/11/13 17:00～2026/11/20 16:59", "11-13 17:00 ~ 11-20 16:59"],
			["コラボイベント（SHAMAN KING）", Date.UTC(2027, 0, 14, 15, 0), null, "2027/01/15 ～", null],
			["シナリオイベント（不明）", Date.UTC(2026, 10, 28, 8, 0), Date.UTC(2026, 11, 6, 11, 59), "2026/11/28 17:00～2026/12/06 20:59", "11-28 17:00 ~ 12-06 20:59"],
			["決戦！星の古戦場", Date.UTC(2026, 10, 21, 10, 0), Date.UTC(2026, 10, 28, 14, 59), "2026/11/21 19:00～2026/11/28 23:59", "11-21 19:00 ~ 11-28 23:59"]
		];
		want.forEach(([name, st, en, raw, disp], i) => {
			const it = items[i];
			check(`第 ${i + 1} 条名称 = ${name}`, !!it && it.event === name, it && it.event);
			check(`第 ${i + 1} 条 startTs（JST 墙钟 → 绝对毫秒）`, !!it && it.startTs === st,
				it && new Date(it.startTs).toISOString());
			check(`第 ${i + 1} 条 endTs`, !!it && it.endTs === en, it && String(it.endTs));
			check(`第 ${i + 1} 条 raw 保留源站原文（不换算）`, !!it && it.raw === raw, it && it.raw);
			check(`第 ${i + 1} 条 display（缺终点就退回原文）`, !!it && it.display === (disp || raw), it && it.display);
		});
		check("占位括号名补了种别前缀（没有只剩括号的名字）",
			items.every((x) => !/^（[^）]*）$/.test(x.event)), JSON.stringify(items.map((x) => x.event)));
		check("名字尾巴没有 PukiWiki 的新建页问号",
			items.every((x) => !/[?？]$/.test(x.event)), JSON.stringify(items.map((x) => x.event)));
		check("只有起点的那条（2027/01/15 ～）endTs = null（不冒充在期）",
			items.filter((x) => x.event.indexOf("SHAMAN KING") >= 0).every((x) => x.endTs === null));
		// 只写日期的写法（这里没有，用纯函数直接钉住 00:00 / 23:59 的通用约定）
		const onlyDate = GF.gbfWindowOf("2026/11/13～2026/11/20", GF.GBF_TZ);
		check("只写日期 ⇒ 起点 00:00 / 终点 23:59（仓库通用约定）",
			!!onlyDate && onlyDate.startTs === Date.UTC(2026, 10, 12, 15, 0) && onlyDate.endTs === Date.UTC(2026, 10, 20, 14, 59),
			onlyDate && (new Date(onlyDate.startTs).toISOString() + " / " + new Date(onlyDate.endTs).toISOString()));
		// 反证：抹掉时间锚点 ⇒ 不产出条目（不是抛错）
		const noDates = GF.gbfItemsOf(html.replace(/\d{4}\/\d{1,2}\/\d{1,2}/g, ""), GF.GBF_TZ);
		check("反证：把所有日期抹掉 ⇒ 一条窗口都产不出来（表还在、行还在）", noDates.length === 0, String(noDates.length));
		// `{}` ⇒ 结构变了，抛错
		let e1 = null;
		try { GF.gbfItemsOf("{}", GF.GBF_TZ); } catch (e) { e1 = e; }
		check("反证：`{}` ⇒ 抛 `gbf-events-changed:no-table`",
			!!e1 && /gbf-events-changed:no-table/.test(e1.message), e1 && e1.message);
		// 表还在、一行 <td> 行都没有 ⇒ 也是结构变了
		let e2 = null;
		try { GF.gbfItemsOf(html.replace(/<td\b/g, "<xx"), GF.GBF_TZ); } catch (e) { e2 = e; }
		check("反证：表在但一行数据行都没有 ⇒ 抛 `gbf-events-changed:no-rows`",
			!!e2 && /gbf-events-changed:no-rows/.test(e2.message), e2 && e2.message);

		// 列位由表头逐字定位：表头改名（= 结构变了）⇒ 抛错，绝不错列吞数据
		let e3 = null;
		try { GF.gbfItemsOf(html.replace(">イベント名<", ">イベント名（改）<"), GF.GBF_TZ); } catch (e) { e3 = e; }
		check("反证：表头「イベント名」被改掉 ⇒ 抛 `gbf-events-changed:no-columns`（按表头定位，不硬编码列号）",
			!!e3 && /gbf-events-changed:no-columns/.test(e3.message), e3 && e3.message);
	}

	{
		section("2026-11-15 第三批③：碧蓝幻想 —— 抓取器（单页 1 请求 / 按 URL 缓存 24h / 走代理）");
		const GF = T.parsers.gbf;
		const NOW = Date.parse("2026-11-15T12:00:00+09:00");
		const sink = [];
		GF.gbfResetCache();
		const e = engineAt(NOW, sink);
		const s = e.__test.SOURCES.find((x) => x.id === "gbf");
		const p = await e.__test.EVENT_FETCHERS.gbf.default(s.eventUrl, undefined, s.tz);
		check("在期活动 = 十天衆戦記", !!p && p.event === "十天衆戦記", p && p.event);
		check("活动档期文本 = 11-13 17:00 ~ 11-20 16:59", !!p && p.eventDates === "11-13 17:00 ~ 11-20 16:59", p && p.eventDates);
		check("活动档期原文保留源站写法", !!p && p.eventDatesRaw === "2026/11/13 17:00～2026/11/20 16:59", p && p.eventDatesRaw);
		check("数据数组 events[] 只有覆盖当期的那 1 条（今后 3 条不冒充在期）",
			!!p && Array.isArray(p.events) && p.events.length === 1, p && (p.events || []).length);
		assertHoverConvention("gbf 活动悬停", p && p.eventHover);
		check("只请求 1 次（单页，行里自带档期）", sink.length === 1, JSON.stringify(sink.map((x) => x.via)));
		check("走宿主代理（源站无 ACAO）且目标就是 gbf-wiki.com",
			sink.length === 1 && sink[0].via === "proxy" && /^https:\/\/gbf-wiki\.com\//.test(sink[0].url), sink[0] && sink[0].url);
		// 缓存：同一 now 再调一次不再发请求
		const p2 = await e.__test.EVENT_FETCHERS.gbf.default(s.eventUrl, undefined, s.tz);
		check("缓存命中（同一 now 再取一次：请求数仍是 1）", sink.length === 1, String(sink.length));
		check("缓存命中后载荷逐字相同", JSON.stringify(p2) === JSON.stringify(p), JSON.stringify(p2).slice(0, 80));
		// 换 now 看档期切换（每次复位缓存，避免跨引擎命中上一轮的 at）
		const at = async (iso) => {
			GF.gbfResetCache();
			const sk = [];
			const en = engineAt(Date.parse(iso), sk);
			const so = en.__test.SOURCES.find((x) => x.id === "gbf");
			return en.__test.EVENT_FETCHERS.gbf.default(so.eventUrl, undefined, so.tz);
		};
		const p3 = await at("2026-11-22T12:00:00+09:00");
		check("2026-11-22 ⇒ 決戦！星の古戦場（今後の予定表の行が当期になる）",
			!!p3 && p3.event === "決戦！星の古戦場" && p3.eventDates === "11-21 19:00 ~ 11-28 23:59",
			p3 && (p3.event + " / " + p3.eventDates));
		const p4 = await at("2026-12-01T12:00:00+09:00");
		check("2026-12-01 ⇒ シナリオイベント（不明）",
			!!p4 && p4.event === "シナリオイベント（不明）" && p4.eventDates === "11-28 17:00 ~ 12-06 20:59",
			p4 && (p4.event + " / " + p4.eventDates));
		const p5 = await at("2027-02-01T12:00:00+09:00");
		check("2027-02-01 ⇒ 没有覆盖当期的窗口 ⇒ null（不是抛错）", p5 === null, JSON.stringify(p5));
		// `{}` ⇒ 抛错（经抓取器）
		GF.gbfResetCache();
		const e2 = engineAt(NOW, [], null, { override: () => "{}" });
		const s2 = e2.__test.SOURCES.find((x) => x.id === "gbf");
		let err = null;
		try { await e2.__test.EVENT_FETCHERS.gbf.default(s2.eventUrl, undefined, s2.tz); } catch (e3) { err = e3; }
		check("反证：源站回 `{}` ⇒ 抓取器抛 `gbf-events-changed:no-table`",
			!!err && /gbf-events-changed:no-table/.test(err.message), err && err.message);
		// 抹掉档期 ⇒ null（不抛）
		GF.gbfResetCache();
		const e3 = engineAt(NOW, [], null, { override: () => fixtureBody(GF.GBF_EVENTS_URL).replace(/\d{4}\/\d{1,2}\/\d{1,2}/g, "") });
		const s3 = e3.__test.SOURCES.find((x) => x.id === "gbf");
		const p6 = await e3.__test.EVENT_FETCHERS.gbf.default(s3.eventUrl, undefined, s3.tz);
		check("反证：档期全被抹掉 ⇒ 活动侧 null（不抛错、不算失败）", p6 === null, JSON.stringify(p6));
	}

	{
		section("2026-11-15 第三批④：舰队Collection —— wikiwiki「期間限定出撃」（真夹具）");
		const KC = T.parsers.kancolle;
		const html = fixtureBody(KC.KANCOLLE_EVENTS_URL);
		const secs = KC.kancolleSectionsOf(html);
		check("夹具里 12 个事件段（裁剪到最新 12 期）", secs.length === 12, String(secs.length));
		const items = KC.kancolleItemsOf(html, KC.KANCOLLE_TZ);
		check("12 期都解析出了窗口", items.length === 12, JSON.stringify(items.map((x) => x.event)));
		const first = items[0];
		check("最新一期名称 = 反撃！第三十一戦隊の戦い（期次后缀已去掉）",
			!!first && first.event === "反撃！第三十一戦隊の戦い", first && first.event);
		check("最新一期 startTs（只写日期 ⇒ 00:00 JST）", !!first && first.startTs === Date.UTC(2026, 6, 7, 15, 0),
			first && new Date(first.startTs).toISOString());
		check("最新一期 endTs（只写日期 ⇒ 23:59 JST）", !!first && first.endTs === Date.UTC(2026, 8, 10, 14, 59),
			first && new Date(first.endTs).toISOString());
		check("最新一期 raw = 源站原文 2026/07/08～2026/09/10", !!first && first.raw === "2026/07/08～2026/09/10", first && first.raw);
		check("最新一期 display = 07-08 00:00 ~ 09-10 23:59", !!first && first.display === "07-08 00:00 ~ 09-10 23:59", first && first.display);
		check("所有名字都不带 `(YYYY年…イベント)` 期次后缀",
			items.every((x) => !/[（(]\s*\d{4}\s*年/.test(x.event)), JSON.stringify(items.map((x) => x.event)));
		check("名字清洗纯函数：`逆転！ナルヴィク攻防戦(2025年秋イベント)` ⇒ `逆転！ナルヴィク攻防戦`",
			KC.kancolleNameOf("逆転！ナルヴィク攻防戦(2025年秋イベント)") === "逆転！ナルヴィク攻防戦",
			KC.kancolleNameOf("逆転！ナルヴィク攻防戦(2025年秋イベント)"));
		check("名字清洗纯函数：没有后缀的名字原样返回",
			KC.kancolleNameOf("Operation Menace") === "Operation Menace", KC.kancolleNameOf("Operation Menace"));
		// 反证：抹掉档期锚点 ⇒ 不产出条目（段位还在）
		const noWin = KC.kancolleItemsOf(html.replace(/期間限定[！!]?\s*【[^】]*】/g, "期間限定"), KC.KANCOLLE_TZ);
		check("反证：把所有 `期間限定！【…】` 抹掉 ⇒ 一条窗口都产不出来（段位还在、不抛错）",
			noWin.length === 0, String(noWin.length));
		// `{}` ⇒ 结构变了，抛错
		let e1 = null;
		try { KC.kancolleItemsOf("{}", KC.KANCOLLE_TZ); } catch (e) { e1 = e; }
		check("反证：`{}` ⇒ 抛 `kancolle-events-changed:no-sections`",
			!!e1 && /kancolle-events-changed:no-sections/.test(e1.message), e1 && e1.message);
		// 段位换标签（h2 → h3）= 结构变了，也要抛
		let e2 = null;
		try { KC.kancolleItemsOf(html.replace(/<h2\b/g, "<h3").replace(/<\/h2>/g, "</h3>"), KC.KANCOLLE_TZ); } catch (e) { e2 = e; }
		check("反证：事件段标签换成 h3 ⇒ 抛 `kancolle-events-changed:no-sections`",
			!!e2 && /kancolle-events-changed:no-sections/.test(e2.message), e2 && e2.message);
	}

	{
		section("2026-11-15 第三批⑤：舰队Collection —— 抓取器（单页 1 请求 / 24h 缓存 / 真机当期为空）");
		const KC = T.parsers.kancolle;
		const at = async (iso, extraOpts) => {
			KC.kancolleResetCache();
			const sk = [];
			const en = engineAt(Date.parse(iso), sk, null, extraOpts);
			const so = en.__test.SOURCES.find((x) => x.id === "kancolle");
			const out = await en.__test.EVENT_FETCHERS.kancolle.default(so.eventUrl, undefined, so.tz);
			return { out, sk };
		};
		const live = await at("2026-08-01T12:00:00+09:00");
		const p = live.out;
		check("2026-08-01（2026 夏イベ在期）⇒ 反撃！第三十一戦隊の戦い",
			!!p && p.event === "反撃！第三十一戦隊の戦い", p && p.event);
		check("活动档期文本 = 07-08 00:00 ~ 09-10 23:59",
			!!p && p.eventDates === "07-08 00:00 ~ 09-10 23:59", p && p.eventDates);
		check("活动档期原文 = 2026/07/08～2026/09/10", !!p && p.eventDatesRaw === "2026/07/08～2026/09/10", p && p.eventDatesRaw);
		check("数据数组 events[] 只有覆盖当期的那 1 条", !!p && Array.isArray(p.events) && p.events.length === 1,
			p && (p.events || []).length);
		check("只请求 1 次（单页档案）", live.sk.length === 1, JSON.stringify(live.sk.map((x) => x.via)));
		check("走宿主代理（源站无 ACAO）且目标就是 wikiwiki.jp",
			live.sk.length === 1 && live.sk[0].via === "proxy" && /^https:\/\/wikiwiki\.jp\/kancolle\//.test(live.sk[0].url),
			live.sk[0] && live.sk[0].url);
		assertHoverConvention("kancolle 活动悬停", p && p.eventHover);
		// 2026-11-15 真机口径：最近一期（2026 夏イベ）已于 2026-09-10 结束、秋イベ未公布 ⇒ null
		const nowDay = await at("2026-11-15T12:00:00+09:00");
		check("2026-11-15（真机当天：最近一期已结束、下一期未公布）⇒ null（不是抛错）",
			nowDay.out === null, JSON.stringify(nowDay.out));
		const later = await at("2027-03-01T12:00:00+09:00");
		check("2027-03-01（夹具里没有覆盖该时刻的期）⇒ null", later.out === null, JSON.stringify(later.out));
		// 缓存：同一 now 再调一次不再发请求
		KC.kancolleResetCache();
		const sk2 = [];
		const e2 = engineAt(Date.parse("2026-08-01T12:00:00+09:00"), sk2);
		const s2 = e2.__test.SOURCES.find((x) => x.id === "kancolle");
		await e2.__test.EVENT_FETCHERS.kancolle.default(s2.eventUrl, undefined, s2.tz);
		await e2.__test.EVENT_FETCHERS.kancolle.default(s2.eventUrl, undefined, s2.tz);
		check("缓存命中（同一 now 连取两次：请求数仍是 1）", sk2.length === 1, String(sk2.length));
		// `{}` ⇒ 抛错
		const bad = await at("2026-08-01T12:00:00+09:00", { override: () => "{}" }).then(
			() => null, (e) => e);
		check("反证：源站回 `{}` ⇒ 抓取器抛 `kancolle-events-changed:no-sections`",
			!!bad && /kancolle-events-changed:no-sections/.test(bad.message), bad && bad.message);
		// 抹掉档期 ⇒ 本页没有窗口；但**页面里有一条更早的窗口**（脚本注：抹掉后全空 ⇒ null）
		const wiped = await at("2026-08-01T12:00:00+09:00", {
			override: () => fixtureBody(KC.KANCOLLE_EVENTS_URL).replace(/期間限定[！!]?\s*【[^】]*】/g, "期間限定")
		});
		check("反证：档期全被抹掉 ⇒ 活动侧 null（不抛错）", wiped.out === null, JSON.stringify(wiped.out));
	}
}

