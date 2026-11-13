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
//   ③ 卡厄斯：卡池 + 活动**都**从 TapTap tab 的「feed 列表 → 逐帖详情」解析（此前活动侧只吃列表摘要、
//      卡池侧 bwiki 停更恒 nomatch）：`■ …营救概率提升` 分节 → 池名 + 角色 + 起止；
//      「维护结束后 / 维护开始前」按**同帖**维护窗映射（12-02 的维护窗不在同帖 ⇒ endTs 如实留空）；
//      活动 = 同帖维护窗 + `■ 活动 – …` 的【活动时间】；**营救概率提升不再算成活动**（此前双计）。
//      2026-11-12 加固（TapTap 有 WAF）：按标题挑详情（更新/版本/维护/活动/一览/概率提升）+ 成功 3 份早停、
//      `MAX_DETAILS=4` 只作兜底上限；两侧共享同一份 docs（模块级缓存 / key=完整 feed URL / TTL 30 s /
//      失败不入缓存）；单帖 500 跳过、≥1 份成功照常出数据、全失败才 down。
//      于是每轮刷新 22 个 TapTap 请求 ⇒ 1 列表 + 3 详情 = 4 个。
//
// ── 真夹具（test/fixtures/<名>/response.txt + .meta.json 的 url/capturedAt/trim）──
//   bh3-content-gacha / bh3-content-event（抓取时刻 2026-11-11T01:00:20+08；当天 10:30 复核与夹具逐字节相同）
//   spica-ournotes-gachas + spica-ournotes-gacha-{5001,22,4001,21,20}
//   czn-taptap-feed（列表 / 10 帖）+ czn-taptap-moment-<帖 id> ×10（详情；抓取时刻 2026-11-11T10:35+08；
//     10 份都留在夹具里 —— 解析器用例仍逐份喂，抓取器用例按新口径只碰标题命中的 3 份）
//
// 时间断言一律写 `Date.UTC(...)` 手算的绝对毫秒：UTC 与 +08 两道门禁跑**同一份期望值**，
// 不存在"本机时区对了才绿"。`NOW` 固定为 2026-11-11 12:00 +08 —— 比抓取时刻晚 1.5 小时，
// 为的是让 czn 首条维护窗（08:00~13:00）真的在期（抓取时刻 10:35 也还没结束，见 ③ 的反向证明）。

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
const CZN = B.NS_BATCH2_CZN_FEED_URL;
const CZN_DETAIL = B.ns_batch2_cznDetailUrl;
const NOW = Date.parse("2026-11-11T12:00:00+08:00");

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
// TapTap 帖详情请求（moment/v3/detail）；列表 feed 是另一条地址。
const detailCallsOf = (list) => list.filter((c) => /\/webapiv2\/moment\/v3\/detail\?/.test(c.url));

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

	// ═══════════════════ ③ 卡厄斯梦境 TapTap（feed 列表 → 逐帖详情）═══════════════════
	section("第二批③：卡厄斯梦境 —— TapTap tab（列表 → 详情：卡池「营救概率提升」+ 活动分节）");
	{
		const s = T.SOURCES.find((x) => x.id === "czn") || null;
		check("卡池 url = TapTap feed 列表（group_id=974342 / type=official / limit=10 / from=0）",
			!!s && s.url === CZN && /group_id=974342/.test(s.url) && /type=official/.test(s.url)
			&& /limit=10/.test(s.url) && /from=0$/.test(s.url), s && String(s.url));
		check("卡池 url 带编码后的 X-UA（缺了源站直接 400）",
			!!s && /[?&]X-UA=V%3D1%26PN%3DWebApp/.test(s.url), s && String(s.url).slice(0, 90));
		check("卡池 / 活动来源标签都 = 「TapTap」",
			!!s && s.source === "TapTap" && s.source === B.NS_BATCH2_CZN_SOURCE_LABEL
			&& s.eventSource === "TapTap", s && JSON.stringify([s.source, s.eventSource]));
		check("活动 eventUrl = 同一份 feed 列表（两侧同一套列表+详情）",
			!!s && s.eventUrl === CZN && s.eventUrl === s.url, s && String(s.eventUrl).slice(0, 60));
		check("bwiki `Module:Gacha/data` 降为卡池备选源（键 czn-bwiki；label 写明停更）",
			!!s && (s.altSources || []).length === 1 && s.altSources[0].fetcher === "czn-bwiki"
			&& /wiki\.biligame\.com\/czn\/api\.php/.test(s.altSources[0].url)
			&& /停更/.test(s.altSources[0].label), s && JSON.stringify(s.altSources));
		check("tz = Asia/Shanghai / defaultHidden 保持 true", !!s && s.tz === "Asia/Shanghai" && s.defaultHidden === true,
			s && JSON.stringify([s.tz, s.defaultHidden]));
		check("详情上限 = 4（兜底上限）/ 早停目标 = 3（最近 3 份命中帖即覆盖当期）",
			B.NS_BATCH2_CZN_MAX_DETAILS === 4 && B.NS_BATCH2_CZN_DETAIL_TARGET === 3,
			JSON.stringify([B.NS_BATCH2_CZN_MAX_DETAILS, B.NS_BATCH2_CZN_DETAIL_TARGET]));
		check("两侧共享 docs 的缓存 TTL = 30 s", B.NS_BATCH2_CZN_DOCS_TTL_MS === 30 * 1000, String(B.NS_BATCH2_CZN_DOCS_TTL_MS));

		// ── 列表 + 详情 → 正文行 ──
		const feed = JSON.parse(fixtureBody(CZN));
		check("feed 首帖 id / 标题逐字",
			feed.data.list[0].moment.id_str === "869262052198190619"
			&& feed.data.list[0].moment.topic.title === "赛季「凝结于雪上的约定」阶段2更新介绍",
			JSON.stringify([feed.data.list[0].moment.id_str, feed.data.list[0].moment.topic.title]));
		const docs = feed.data.list.map((x) => B.ns_batch2_cznDocOf(JSON.parse(fixtureBody(CZN_DETAIL(x.moment.id_str)))));
		check("10 帖详情都能解析出正文行（`contents.json` 的 paragraph；image 块跳过）",
			docs.length === 10 && docs.every((d) => d.title && d.lines.length > 0),
			JSON.stringify(docs.map((d) => d.lines.length)));

		// ── 按标题挑详情：只有「更新/版本/维护/活动/一览/概率提升」这类帖才进详情 ──
		const hits = B.ns_batch2_cznPostsOf(feed);
		check("标题命中 = 3 帖（更新介绍 / 活动回顾 / 营救概率提升），角色演示·PV·设定图·一封信都不进",
			hits.length === 3
			&& hits.map((x) => x.id).join(",") === [
				feed.data.list[0].moment.id_str,
				feed.data.list[7].moment.id_str,
				feed.data.list[8].moment.id_str
			].join(","),
			JSON.stringify(hits.map((x) => x.title)));
		check("物料帖确实一条都没命中（反证：不是「取前 3 帖」）",
			hits.every((x) => /更新|版本|活動|活动|概率提升/.test(x.title))
			&& feed.data.list.slice(1, 7).every((x) => !hits.some((h) => h.id === x.moment.id_str)),
			JSON.stringify(feed.data.list.slice(1, 7).map((x) => x.moment.topic.title.slice(0, 12))));
		check("更新帖正文逐字：首行「亲爱的领航者…」（源站把游戏名写成「卡厄思梦境」）/ 含维护行「…（服务器时间）…」",
			docs[0].lines[0].startsWith("亲爱的领航者，《卡厄思梦境》将于 11 月 11 日进行版本更新")
			&& docs[0].lines.some((l) => l.startsWith("2026/11/11 08:00 ~ 2026/11/11 13:00（服务器时间）")),
			JSON.stringify(docs[0].lines.slice(0, 2)));

		// ── 卡池：「营救概率提升」分节 ──
		const poolsOf = (list) => {
			const out = [];
			for (const d of list) for (const p of B.ns_batch2_cznPoolsOf(d, "Asia/Shanghai", NOW)) out.push(p);
			return out;
		};
		const pools = poolsOf(docs);
		check("卡池事实 = 4 条（更新帖 3 + 蒂菲拉专帖 1）", pools.length === 4, JSON.stringify(pools.map((x) => x.title)));
		const poolOf = (t) => pools.find((x) => x.title === t) || {};
		const bz = poolOf("全新主战员「布蕾兹贝尔」营救概率提升");
		check("布蕾兹贝尔：角色只取分节标题里的「」（正文里的 罗丝薇瑟·希格 不算）",
			bz.roles === "布蕾兹贝尔" && !/罗丝薇瑟|希格/.test(String(bz.roles)), JSON.stringify(bz.roles));
		check("布蕾兹贝尔：「2026/11/11 维护结束后」按同帖维护窗映射成 11-11 13:00 +08（UTC 05:00）",
			bz.startTs === Date.UTC(2026, 10, 11, 5, 0), String(bz.startTs));
		check("布蕾兹贝尔：「2026/12/02 维护开始前」同帖没有 12-02 维护窗 ⇒ endTs 如实留空（不猜）",
			bz.endTs === null, String(bz.endTs));
		check("布蕾兹贝尔：raw 逐字 / 有一端留空 ⇒ display 原样印原文（不渲染成确定时刻）",
			bz.raw === "2026/11/11 维护结束后 ~ 2026/12/02 维护开始前" && bz.display === bz.raw,
			JSON.stringify([bz.raw, bz.display]));
		check("薇薇安：同一维护锚 + 同一未映射终点（「概率提升时间：」写法也认）",
			poolOf("全新辅战员「薇薇安」营救概率提升").startTs === Date.UTC(2026, 10, 11, 5, 0)
			&& poolOf("全新辅战员「薇薇安」营救概率提升").endTs === null
			&& poolOf("全新辅战员「薇薇安」营救概率提升").roles === "薇薇安",
			JSON.stringify(poolOf("全新辅战员「薇薇安」营救概率提升")));
		const ld = poolOf("常驻主战员「莉妲」& 辅战员「艾薇」营救概率提升");
		check("莉妲&艾薇：两端绝对时刻 11-25 02:00 ~ 12-16 02:00（raw 逐字 / display 格式化）",
			ld.startTs === Date.UTC(2026, 10, 24, 18, 0) && ld.endTs === Date.UTC(2026, 11, 15, 18, 0)
			&& ld.raw === "2026/11/25 02:00 ~ 2026/12/16 02:00" && ld.display === "11-25 02:00 ~ 12-16 02:00",
			JSON.stringify([ld.startTs, ld.endTs, ld.raw, ld.display]));
		const tf = poolOf("常驻主战员「蒂菲拉」& 辅战员「蒂亚娜」营救概率提升即将开始");
		check("蒂菲拉专帖没有 `■` 分节 ⇒ 整帖算一条池（池名 = 帖子标题）/ 11-04 02:00 ~ 11-25 02:00",
			tf.startTs === Date.UTC(2026, 10, 3, 18, 0) && tf.endTs === Date.UTC(2026, 10, 24, 18, 0)
			&& tf.raw === "2026/11/04 02:00~2026/11/25 02:00" && tf.roles === "蒂菲拉、蒂亚娜",
			JSON.stringify([tf.startTs, tf.endTs, tf.roles]));

		const calls = [];
		const e = engineAt(NOW, calls);
		const gp = await e.__test.GACHA_FETCHERS["czn"](s.url, undefined, s.tz);
		check("卡池抓取器返回对象（换源前 bwiki 停更 ⇒ 恒 null）", !!gp && typeof gp === "object");
		check("当期池 = 蒂菲拉&蒂亚娜（11-04~11-25 覆盖 12:00；两个新池 13:00 才开 ⇒ 不冒充当期）",
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
		check("卡池侧请求 = 1 次列表 + 3 次详情（修前 1 + 10；按标题挑 + 早停）；全程经代理、Referer `https://www.taptap.cn/`",
			proxyCallsOf(calls).length === 4
			&& calls.filter((c) => c.url === CZN).length === 1
			&& detailCallsOf(calls).length === B.NS_BATCH2_CZN_DETAIL_TARGET
			&& hits.every((h) => detailCallsOf(calls).some((c) => c.url === CZN_DETAIL(h.id)))
			&& calls.every((c) => c.referer === "https://www.taptap.cn/"),
			JSON.stringify(calls.map((c) => c.url.slice(-24))));

		// ── 活动：同帖维护窗 + `■ 活动 – …` 的【活动时间】 ──
		const rowsOf = (list) => {
			const out = [];
			for (const d of list) for (const r of B.ns_batch2_cznEventRowsOf(d, "Asia/Shanghai", NOW)) out.push(r);
			return out;
		};
		const rows = rowsOf(docs);
		check("活动事实 = 5 条（维护窗 1 + 活动分节 4）", rows.length === 5, JSON.stringify(rows.map((x) => x.title)));
		const maint = rows.find((x) => x.title === "赛季「凝结于雪上的约定」阶段2更新介绍") || {};
		check("维护窗逐字：2026/11/11 08:00 ~ 2026/11/11 13:00 → 08:00 / 13:00 +08",
			maint.startTs === Date.UTC(2026, 10, 11, 0, 0) && maint.endTs === Date.UTC(2026, 10, 11, 5, 0)
			&& maint.raw === "2026/11/11 08:00 ~ 2026/11/11 13:00" && maint.display === "11-11 08:00 ~ 11-11 13:00",
			JSON.stringify([maint.startTs, maint.endTs, maint.raw]));
		check("**营救概率提升不算活动**（双计守卫）：5 条里没有一条含「营救概率提升」",
			rows.every((x) => !/营救概率提升/.test(x.title)), JSON.stringify(rows.map((x) => x.title)));
		check("4 条活动分节名逐字（取分节标题里「」的名字）",
			JSON.stringify(rows.slice(1).map((x) => x.title)) === JSON.stringify(["梦境巡游庆典", "映照记忆的焰火", "今日晴，宜开工", "循星迹而行"]),
			JSON.stringify(rows.slice(1).map((x) => x.title)));
		check("「维护结束后」起点的三条：startTs=11-11 13:00 / endTs=null（12-02、12-23 维护窗不在同帖）",
			rows.slice(1, 4).every((x) => x.startTs === Date.UTC(2026, 10, 11, 5, 0) && x.endTs === null
				&& x.display === x.raw), JSON.stringify(rows.slice(1, 4)));
		check("循星迹而行两端绝对：11-25 02:00 ~ 12-16 02:00",
			rows[4].startTs === Date.UTC(2026, 10, 24, 18, 0) && rows[4].endTs === Date.UTC(2026, 11, 15, 18, 0),
			JSON.stringify([rows[4].startTs, rows[4].endTs]));

		const ep = await e.__test.EVENT_FETCHERS["czn"].default(s.eventUrl, undefined, s.tz);
		check("两侧共享 docs：活动侧紧接着跑**一个请求都不发**（同 now 命中缓存；修前这里再打 11 次）",
			calls.length === 4 && proxyCallsOf(calls).length === 4,
			JSON.stringify(calls.map((c) => c.url.slice(-24))));
		check("活动抓取器返回对象", !!ep && typeof ep === "object");
		check("当期活动 = 维护窗（12:00 落在 08:00~13:00）",
			!!ep && ep.event === "赛季「凝结于雪上的约定」阶段2更新介绍", JSON.stringify(ep && ep.event));
		check("当期档期逐字 = 维护窗", !!ep && ep.eventDates === "11-11 08:00 ~ 11-11 13:00"
			&& ep.eventDatesRaw === "2026/11/11 08:00 ~ 2026/11/11 13:00",
			JSON.stringify([ep && ep.eventDates, ep && ep.eventDatesRaw]));
		check("`events[]` 1 条（4 条活动分节终点未知 / 循星迹而行未开始 ⇒ 不进在期数组），且不含营救帖",
			!!ep && ep.events.length === 1 && ep.events[0].title === "赛季「凝结于雪上的约定」阶段2更新介绍",
			JSON.stringify(ep && ep.events.map((x) => x.title)));
		check("悬停为空（共用工具 <2 条给空串 ⇒ 解析器不设该字段）", !!ep && ep.eventHover == null,
			JSON.stringify(ep && ep.eventHover));

		// 引擎整轮（只让 czn 可见）：两侧共享同一份 docs ⇒ 1 次列表 + 3 次详情 = 4 次请求（修前 22 次）。
		const calls2 = [];
		const allIds = engineAt(NOW, []).__test.SOURCES.map((x) => x.id);
		const e2 = engineAt(NOW, calls2, { hidden: allIds.filter((id) => id !== "czn"), shown: ["czn"] });
		const r = await e2.refresh();
		const rec = r.games["czn"] || {};
		check("整轮：两侧都不 fail", rec.gachaFail == null && rec.eventFail == null,
			JSON.stringify([rec.gachaFail, rec.eventFail]));
		check("整轮：TapTap 请求总数 = 1 次列表 + 3 次详情（两侧共享 docs；修前 2×(1+10)=22）",
			calls2.length === 4 && calls2.filter((c) => c.url === CZN).length === 1
			&& detailCallsOf(calls2).length === B.NS_BATCH2_CZN_DETAIL_TARGET
			&& hits.every((h) => detailCallsOf(calls2).some((c) => c.url === CZN_DETAIL(h.id))),
			JSON.stringify([calls2.length, calls2.filter((c) => c.url === CZN).length]));
		check("整轮记录：banner / roles / bannerDates / event / events 逐字",
			rec.banner === "常驻主战员「蒂菲拉」& 辅战员「蒂亚娜」营救概率提升即将开始"
			&& rec.roles === "蒂菲拉、蒂亚娜"
			&& rec.bannerDates === "11-04 02:00 ~ 11-25 02:00"
			&& rec.event === "赛季「凝结于雪上的约定」阶段2更新介绍"
			&& (rec.events || []).length === 1 && (rec.gacha || []).length === 1,
			JSON.stringify([rec.banner, rec.roles, rec.bannerDates, rec.event, (rec.events || []).length]));
	}

	// ── ③-2 docs 缓存（TTL 30 s / 成功才入缓存）与请求数 ──
	section("第二批③-2：两侧共享 docs 缓存 —— 同 now 命中（0 请求）/ 超 30 s 重抓");
	{
		const allIds = engineAt(NOW, []).__test.SOURCES.map((x) => x.id);
		const only = { hidden: allIds.filter((id) => id !== "czn"), shown: ["czn"] };
		const feed = JSON.parse(fixtureBody(CZN));
		const hitIds = B.ns_batch2_cznPostsOf(feed).map((x) => x.id);

		// ⚠️ 缓存跟着**引擎实例**走（`createEngine` 每次造一个独立 core，30-game-batch2.js 整段都在它里面）。
		//    所以"过期"必须在同一个引擎里拨表测；换引擎 = 从零开始（生产只有 90-plugin.js 那一个引擎）。
		const clock = { now: NOW };
		const calls = [];
		const e1 = engineWithClock(clock, calls, only);
		await e1.refresh();
		check("首轮：1 列表 + 3 详情 = 4 个 TapTap 请求",
			calls.length === 4 && calls.filter((c) => c.url === CZN).length === 1
			&& detailCallsOf(calls).length === 3,
			JSON.stringify(calls.map((c) => c.url.slice(-24))));
		await e1.refresh();
		check("缓存命中：同 now 下第二次刷新 0 个 TapTap 请求", calls.length === 4, JSON.stringify(calls.length));

		clock.now = NOW + 29 * 1000;
		await e1.refresh();
		check("TTL 内（+29 s）仍然命中缓存 ⇒ 0 请求", calls.length === 4, JSON.stringify(calls.length));

		clock.now = NOW + 31 * 1000;
		await e1.refresh();
		check("超过 30 s（+31 s）⇒ 重新抓：累计 +4（1 列表 + 3 详情）",
			calls.length === 8 && calls.slice(4).filter((c) => c.url === CZN).length === 1
			&& detailCallsOf(calls.slice(4)).length === 3,
			JSON.stringify(calls.map((c) => c.url.slice(-24))));
		check("重抓的详情仍是那 3 份命中帖（不是重新挑成别的）",
			hitIds.length === 3 && hitIds.every((id) => detailCallsOf(calls.slice(4)).some((c) => c.url === CZN_DETAIL(id))),
			JSON.stringify(detailCallsOf(calls.slice(4)).map((c) => c.url.slice(-19))));
	}

	// ── ③-3 单帖失败跳过 / 全部失败才抛错 / 失败不入缓存 ──
	section("第二批③-3：单帖 500 跳过（≥1 份成功照常出数据）/ 全失败才 down");
	{
		const allIds = engineAt(NOW, []).__test.SOURCES.map((x) => x.id);
		const only = { hidden: allIds.filter((id) => id !== "czn"), shown: ["czn"] };
		const feed = JSON.parse(fixtureBody(CZN));
		const updateId = feed.data.list[0].moment.id_str;    // 更新帖：活动侧（维护窗 + 4 条活动分节）的唯一来源
		const reviewId = feed.data.list[8].moment.id_str;    // 活动回顾特辑：命中标题但不贡献任何档期
		const detailFail = (u) => /\/webapiv2\/moment\/v3\/detail\?/.test(u);

		// A：最后一份命中帖（活动回顾）500 ⇒ 前两份已成功 ⇒ 数据与全成功时一致
		const cTail = [];
		const eTail = engineAt(NOW, cTail, only, { fail: (u) => u === CZN_DETAIL(reviewId) });
		const rTail = await eTail.refresh();
		const recTail = rTail.games["czn"] || {};
		check("A 单帖失败（活动回顾帖 500）⇒ 两侧照常出数据、不 down",
			recTail.gachaFail == null && recTail.eventFail == null
			&& recTail.banner === "常驻主战员「蒂菲拉」& 辅战员「蒂亚娜」营救概率提升即将开始"
			&& recTail.event === "赛季「凝结于雪上的约定」阶段2更新介绍",
			JSON.stringify([recTail.gachaFail, recTail.eventFail, recTail.banner]));
		check("A 请求数：失败那份也照抓（1 列表 + 3 详情尝试），但数据不受影响",
			cTail.length === 4 && detailCallsOf(cTail).length === 3, JSON.stringify(cTail.length));

		// B：更新帖（活动来源）500 ⇒ 卡池照常出数据；活动侧如实 nomatch（不是 down）
		const cMain = [];
		const eMain = engineAt(NOW, cMain, only, { fail: (u) => u === CZN_DETAIL(updateId) });
		const rMain = await eMain.refresh();
		const recMain = rMain.games["czn"] || {};
		check("B 更新帖 500 ⇒ 卡池照常出数据（蒂菲拉），整条记录不 down",
			recMain.gachaFail == null
			&& recMain.banner === "常驻主战员「蒂菲拉」& 辅战员「蒂亚娜」营救概率提升即将开始"
			&& !recMain.event && !!recMain.eventFail && recMain.eventFail.kind === "nomatch",
			JSON.stringify([recMain.banner, recMain.event, recMain.eventFail]));
		check("B 请求数：1 列表 + 3 详情尝试（失败的 1 份跳过，后 2 份照抓）",
			cMain.length === 4 && detailCallsOf(cMain).length === 3, JSON.stringify(cMain.length));

		// C：全部详情失败 ⇒ 抛错 / 两侧 down
		const cAll = [];
		const eAll = engineAt(NOW, cAll, only, { fail: detailFail });
		const rAll = await eAll.refresh();
		const recAll = rAll.games["czn"] || {};
		check("C 全部详情失败 ⇒ 两侧都记抓取异常（down），不是静默 null",
			!!recAll.gachaFail && recAll.gachaFail.kind === "down"
			&& !!recAll.eventFail && recAll.eventFail.kind === "down",
			JSON.stringify([recAll.gachaFail, recAll.eventFail]));
		check("C 请求数：失败不入缓存 ⇒ 两侧各试一遍 = 2×(1 列表 + 3 详情)（不是 22）",
			cAll.length === 8 && cAll.filter((c) => c.url === CZN).length === 2 && detailCallsOf(cAll).length === 6,
			JSON.stringify(cAll.length));
		let thrown = "";
		try { await eAll.__test.GACHA_FETCHERS["czn"](CZN, undefined, "Asia/Shanghai"); }
		catch (err) { thrown = String((err && err.message) || err); }
		check("C 抓取器直接调用也抛错（`proxy-bad:500`，不是返回 null）", /proxy-bad:500/.test(thrown), thrown);

		// D：失败不入缓存 —— 失败那一轮没写缓存，下一轮照常重抓（不是"缓存住一个失败"）
		const cRetry = [];
		await engineAt(NOW, cRetry, only, { fail: detailFail }).refresh();
		check("D 失败不入缓存：同 now 再来一轮照常 2×(1 列表 + 3 详情)（8 个请求，一次没少）",
			cRetry.length === 8 && cRetry.filter((c) => c.url === CZN).length === 2, JSON.stringify(cRetry.length));

		// E：早停 + 兜底上限 —— 把 10 帖标题全改成命中词：成功 3 份即停；全失败时每侧最多 4 次尝试
		const allHit = JSON.parse(JSON.stringify(feed));
		allHit.data.list.forEach((x) => { x.moment.topic.title += "（更新公告）"; });
		const allHitBody = JSON.stringify(allHit);
		const cEarly = [];
		await engineAt(NOW, cEarly, only, { override: (u) => (u === CZN ? allHitBody : null) }).refresh();
		check("E 早停：10 帖全命中时也只抓 3 份详情（1 列表 + 3；活动侧命中缓存 = 0）",
			cEarly.length === 4 && detailCallsOf(cEarly).length === 3,
			JSON.stringify(cEarly.length));
		const cCap = [];
		await engineAt(NOW, cCap, only, { override: (u) => (u === CZN ? allHitBody : null), fail: detailFail }).refresh();
		check("F 兜底上限：10 帖全命中且全部 500 ⇒ 每侧最多 4 次详情尝试（2×4，不是 2×10）",
			cCap.length === 10 && cCap.filter((c) => c.url === CZN).length === 2
			&& detailCallsOf(cCap).length === 2 * B.NS_BATCH2_CZN_MAX_DETAILS,
			JSON.stringify(cCap.length));
	}

	section("第二批③反证：拿掉关键解析 ⇒ 不产出 / 不猜 / 不双计");
	{
		const feed = JSON.parse(fixtureBody(CZN));
		const docs = feed.data.list.map((x) => B.ns_batch2_cznDocOf(JSON.parse(fixtureBody(CZN_DETAIL(x.moment.id_str)))));
		const upd = docs[0];
		const poolsOf = (list) => {
			const out = [];
			for (const d of list) for (const p of B.ns_batch2_cznPoolsOf(d, "Asia/Shanghai", NOW)) out.push(p);
			return out;
		};
		const withLines = (lines) => ({ title: upd.title, lines });

		// 反证 A：删掉「概率提升期间/时间：」整行 ⇒ 分节还在，但不再成池（不拿正文里别的区间凑）
		const noPeriod = withLines(upd.lines.filter((l) => !/概率提升(?:期间|时间)\s*[:：]/.test(l)));
		check("反证 A：删掉「概率提升期间」行 ⇒ 更新帖卡池 0 条（不硬凑）",
			poolsOf([noPeriod]).length === 0, JSON.stringify(poolsOf([noPeriod])));

		// 反证 B：分节标题的关键词拿掉 ⇒ 也不成池（证明卡池真的来自 `■ …营救概率提升` 分节）
		const noKw = withLines(upd.lines.map((l) => l.replace(/营救概率提升/g, "营救")));
		check("反证 B：分节标题去掉「营救概率提升」⇒ 更新帖卡池 0 条",
			poolsOf([noKw]).length === 0, JSON.stringify(poolsOf([noKw]).map((x) => x.title)));

		// 反证 C：抹掉维护窗 ⇒ 维护活动消失，且「维护结束后」锚点失效 ⇒ 只剩两端绝对时刻那一条
		const noMaint = withLines(upd.lines.map((l) => l.replace("2026/11/11 08:00 ~ 2026/11/11 13:00", "时间待定")));
		const rowsC = B.ns_batch2_cznEventRowsOf(noMaint, "Asia/Shanghai", NOW);
		const poolsC = poolsOf([noMaint]);
		check("反证 C：抹掉维护窗 ⇒ 3 条「维护结束后…」活动分节两端都解不出 ⇒ 只剩「循星迹而行」那一条（不猜锚点）",
			rowsC.length === 1 && rowsC[0].title === "循星迹而行", JSON.stringify(rowsC.map((x) => x.title)));
		check("反证 C：抹掉维护窗 ⇒ 「维护结束后」端点解不出 ⇒ 只剩「莉妲&艾薇」那条两端绝对的池（不猜锚点）",
			poolsC.length === 1 && poolsC[0].title === "常驻主战员「莉妲」& 辅战员「艾薇」营救概率提升",
			JSON.stringify(poolsC.map((x) => x.title)));

		// 反证 D：抓取时刻 01:00 +08（维护还没开始）⇒ 活动侧 null（严格 coversNow）
		const cap = Date.parse("2026-11-11T01:00:20+08:00");
		const capRows = B.ns_batch2_cznEventRowsOf(docs[0], "Asia/Shanghai", cap);
		check("反证 D：01:00 时维护窗未开始 / 活动分节 13:00 才开 ⇒ 活动载荷 null",
			capRows.length === 5 && B.ns_batch2_cznEventPayloadOf(capRows, "Asia/Shanghai", cap) === null,
			JSON.stringify(capRows.map((x) => x.title)));
		check("反证 D 对照：12:00 时维护窗已在期 ⇒ 当期 = 维护（证明是 coversNow 起的作用）",
			(B.ns_batch2_cznEventPayloadOf(B.ns_batch2_cznEventRowsOf(docs[0], "Asia/Shanghai", NOW), "Asia/Shanghai", NOW) || {}).event
			=== "赛季「凝结于雪上的约定」阶段2更新介绍");

		// 反证 E：换源不是删源 —— bwiki 备选抓取器仍登记（设置页能手动切回）
		const e = engineAt(NOW, []);
		check("反证 E：bwiki 备选抓取器 `czn-bwiki` 仍登记在 GACHA_FETCHERS（停更但未删）",
			typeof e.__test.GACHA_FETCHERS["czn-bwiki"] === "function");

		// 反证 F：标题词汇一个都不认识 ⇒ 明确抛 `czn-no-title-match`（不退回"10 帖全抓"那条被 WAF 限流的老路）
		const noKwFeed = JSON.parse(JSON.stringify(feed));
		noKwFeed.data.list.forEach((x) => { x.moment.topic.title = "角色演示"; });
		let noKwErr = "";
		try { B.ns_batch2_cznPostsOf(noKwFeed); } catch (err) { noKwErr = String((err && err.message) || err); }
		check("反证 F：标题全部改成「角色演示」⇒ 抛 `czn-no-title-match`", noKwErr === "czn-no-title-match", noKwErr);
	}
}
