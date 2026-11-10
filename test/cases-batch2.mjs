// test/cases-batch2.mjs —— 第二批接入（2026-11-11）：崩坏3 内容中台 / OurNotes 日服 SPICA / 卡厄斯 TapTap tab
//
// ── 本段守什么 ──
//   ① 崩坏3：注册（两侧 url/eventUrl + 来源标签 + defaultHidden 保持 true + 米游社备选源保留）；
//      卡池**只出名称/角色**（`dtEndTime` 恒 2035 占位、正文无起止 ⇒ `bannerDates` 留空，不硬凑）；
//      活动正文「>>开放时间 / 【活动时间】」时间块 → 逐字区间；相对起点 `9.1版本更新后` ⇒ startTs=null；
//      3 条主线更新稿没有时间块 ⇒ 如实不进日历；
//   ② OurNotes·日服：卡池侧此前无来源，现挂 SPICA（列表取 id → **只抓前 5 条详情**，不是 23 条）；
//      tz=Asia/Tokyo / 活动侧 bushimo 原样不动；详情「開催期間」→ 绝对 ts；pickup 名单逐字；
//   ③ 卡厄斯：活动侧此前无来源，现挂 TapTap tab；HTML 卡片正则 → 有完整区间的 2 帖进日历，
//      其余 8 帖（角色演示/设定图/PV/福利）**不硬凑**；12:00 +08 时首条维护窗已在期。
//
// ── 真夹具（test/fixtures/<名>/response.txt + .meta.json 的 url/capturedAt/trim）──
//   bh3-content-gacha / bh3-content-event（抓取时刻 2026-11-11T01:00:20+08）
//   spica-ournotes-gachas + spica-ournotes-gacha-{5001,22,4001,21,20}
//   czn-taptap-official（抓取时刻 2026-11-11T01:00:23+08）
//
// 时间断言一律写 `Date.UTC(...)` 手算的绝对毫秒：UTC 与 +08 两道门禁跑**同一份期望值**，
// 不存在"本机时区对了才绿"。`NOW` 固定为 2026-11-11 12:00 +08 —— 比抓取时刻晚 11 小时，
// 为的是让 czn 首条维护窗（08:00~13:00）真的在期（抓取时刻 01:00 还没开始，见 ③ 的反向证明）。

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
const CZN = B.NS_BATCH2_CZN_URL;
const NOW = Date.parse("2026-11-11T12:00:00+08:00");

const FIXTURES = useFixtures();   // 全局夹具 impl（下面的 transport 直接复用它）
const makeStore = (seed) => {
	const m = new Map(Object.entries(seed || {}));
	return { map: m, async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
};

// 记账 transport：`fetchViaProxy` 把**目标地址**记进 sink（与真实宿主代理同一形态），
// 再复用 harness 的夹具 impl（它认 `/api/gacha-calendar-proxy?url=…` 前缀并拆 `{status, body}`）。
function makeTransport(sink) {
	return {
		async fetchRaw(url) {
			sink.push({ url: String(url), via: "raw", referer: "" });
			throw new Error("直连不该被用到：" + String(url));
		},
		async fetchViaProxy(url, opts) {
			const referer = (opts && opts.referer) || "";
			sink.push({ url: String(url), via: "proxy", referer });
			const api = "/api/gacha-calendar-proxy?url=" + encodeURIComponent(String(url));
			const res = await FIXTURES(api);
			const wrapped = JSON.parse(await res.text());
			if (wrapped.status !== 200) throw new Error("proxy-bad:" + wrapped.status);
			return wrapped.body;
		}
	};
}
const engineAt = (now, sink, extra) => createEngine({
	transport: makeTransport(sink),
	storage: makeStore(extra),
	now: () => now,
	timer: { setTimeout, clearTimeout }
});
const proxyCallsOf = (calls) => calls.filter((c) => c.via === "proxy");

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

	// ── ①-2 卡池：只出名称/角色，起止留空 ──
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
		check("**起止两字段留空**：不把 `dtEndTime`=2035 当结束、也不拿 `dtStartTime` 凑一个区间",
			!!gp && gp.bannerDates === "" && gp.bannerDatesRaw === "",
			JSON.stringify([gp && gp.bannerDates, gp && gp.bannerDatesRaw]));
		check("源站该条 dtEndTime 确实是 2035 占位（反证：解析器根本没读它）",
			String(gJson.data.list[0].dtEndTime).startsWith("2035-01-01"), gJson.data.list[0].dtEndTime);
		check("`gacha[]` 1 条 / source=primary / startTs·endTs 都是 null（显示层按长期处理）",
			!!gp && Array.isArray(gp.gacha) && gp.gacha.length === 1
			&& gp.gacha[0].source === "primary" && gp.gacha[0].startTs === null && gp.gacha[0].endTs === null
			&& gp.gacha[0].title === gp.banner,
			JSON.stringify(gp && gp.gacha));
		check("卡池侧 1 次请求、全程经代理、带 Referer `https://bh3.mihoyo.com/`",
			proxyCallsOf(calls).length === 1 && calls[0].referer === "https://bh3.mihoyo.com/",
			JSON.stringify(calls));

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
		check("整轮记录：banner / roles 留空 / 活动逐字",
			rec.banner === "装备补给丨琉璃朱燧&泣之哲人" && rec.roles === ""
			&& rec.event === "双核协战丨参与活动获取活动勋章、水晶等奖励！"
			&& rec.eventDates === "11-05 10:00 ~ 11-26 04:00",
			JSON.stringify([rec.banner, rec.roles, rec.event, rec.eventDates]));
		check("整轮记录：gacha 1 条 / events 9 条，key 带 bh3 前缀",
			rec.gacha.length === 1 && rec.events.length === 9
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
		check("反证 C：源站卡池 30 条的 dtEndTime 全是 2035 占位，而载荷 bannerDates 为空（证明没拿它当档期）",
			JSON.parse(fixtureBody(BH3_G)).data.list.every((x) => String(x.dtEndTime).startsWith("2035-01-01")));
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

	// ═══════════════════ ③ 卡厄斯梦境 TapTap tab ═══════════════════
	section("第二批③：卡厄斯梦境活动 —— TapTap tab（HTML 卡片 + 区间）");
	{
		const s = T.SOURCES.find((x) => x.id === "czn") || null;
		check("活动 eventUrl = TapTap tab（app/759688）",
			!!s && s.eventUrl === CZN && /\/app\/759688\/topic\?type=official$/.test(s.eventUrl), s && String(s.eventUrl));
		check("活动来源标签 = TapTap", !!s && s.eventSource === B.NS_BATCH2_CZN_SOURCE_LABEL, s && s.eventSource);
		check("卡池侧保持 bwiki Lua（未动）",
			!!s && /wiki\.biligame\.com\/czn\/api\.php/.test(s.url) && s.source === "Bwiki", s && JSON.stringify([s.url, s.source]));
		check("tz = Asia/Shanghai / defaultHidden 保持 true", !!s && s.tz === "Asia/Shanghai" && s.defaultHidden === true,
			s && JSON.stringify([s.tz, s.defaultHidden]));

		const html = fixtureBody(CZN);
		const items = B.ns_batch2_cznItemsOf(html, "Asia/Shanghai", NOW);
		check("10 张官方卡里只有 2 张有完整起止（其余无区间 ⇒ 不进日历）", items.length === 2, String(items.length));
		const first = items[0] || {};
		check("首条名称逐字「赛季「凝结于雪上的约定」阶段2更新介绍」",
			first.title === "赛季「凝结于雪上的约定」阶段2更新介绍", JSON.stringify(first.title));
		check("首条 raw = 「2026/11/11 08:00 ~ 2026/11/11 13:00」（源站原文，含空格）",
			first.raw === "2026/11/11 08:00 ~ 2026/11/11 13:00", JSON.stringify(first.raw));
		check("首条 startTs = 2026-11-11 08:00 +08（UTC 00:00）", first.startTs === Date.UTC(2026, 10, 11, 0, 0), String(first.startTs));
		check("首条 endTs = 2026-11-11 13:00 +08（UTC 05:00）", first.endTs === Date.UTC(2026, 10, 11, 5, 0), String(first.endTs));
		check("首条 tz 显式 / source=hover", first.tz === "Asia/Shanghai" && first.source === "hover",
			JSON.stringify([first.tz, first.source]));
		check("角色演示 / 设定图 / PV / 福利帖都**没有完整区间** ⇒ 不在条目里（不拿单日/截止当活动期）",
			items.every((x) => !/角色演示|设定图|PV｜|感谢礼|一封信/.test(x.title)), JSON.stringify(items.map((x) => x.title)));

		const calls = [];
		const e = engineAt(NOW, calls);
		const ep = await e.__test.EVENT_FETCHERS["czn"].default(s.eventUrl, undefined, s.tz);
		check("活动抓取器返回对象", !!ep && typeof ep === "object");
		check("当期活动 = 首条维护（12:00 +08 落在 08:00~13:00 之间）",
			!!ep && ep.event === "赛季「凝结于雪上的约定」阶段2更新介绍", JSON.stringify(ep && ep.event));
		check("当期档期 = 11-11 08:00 ~ 11-11 13:00", !!ep && ep.eventDates === "11-11 08:00 ~ 11-11 13:00",
			JSON.stringify(ep && ep.eventDates));
		check("悬停 2 行逐字（维护窗先结束 ⇒ 排在前面）",
			!!ep && ep.eventHover === [
				"赛季「凝结于雪上的约定」阶段2更新介绍   11-11 08:00 ~ 11-11 13:00",
				"常驻主战员「蒂菲拉」& 辅战员「蒂亚娜」营救概率提升即将开始   11-04 02:00 ~ 11-25 02:00"
			].join("\n"), JSON.stringify(ep && ep.eventHover));
		check("活动侧 1 次请求、经代理、带 Referer `https://www.taptap.cn/`",
			proxyCallsOf(calls).length === 1 && calls[0].referer === "https://www.taptap.cn/", JSON.stringify(calls));

		// 引擎整轮：卡池侧 bwiki 没有夹具（404），活动侧必须 ok —— 单侧失败隔离
		const calls2 = [];
		const allIds = engineAt(NOW, []).__test.SOURCES.map((x) => x.id);
		const e2 = engineAt(NOW, calls2, { hidden: allIds.filter((id) => id !== "czn"), shown: ["czn"] });
		const r = await e2.refresh();
		const rec = r.games["czn"] || {};
		check("整轮：活动侧不 fail（卡池侧 bwiki 无夹具 404，互不影响）",
			rec.eventFail == null, JSON.stringify([rec.gachaFail, rec.eventFail]));
		check("整轮记录：event / eventDates / events 逐字一致",
			rec.event === "赛季「凝结于雪上的约定」阶段2更新介绍"
			&& rec.eventDates === "11-11 08:00 ~ 11-11 13:00"
			&& rec.events.length === 2,
			JSON.stringify([rec.event, rec.eventDates, (rec.events || []).length]));
	}

	section("第二批③反证：拿掉维护时刻 / 时刻未到 ⇒ 不冒充当期 / 不编区间");
	{
		const html = fixtureBody(CZN);
		// 反证 A：把首条的 08:00~13:00 抹掉 ⇒ 该帖不再产出条目（不会拿"11月11日更新"凑一个区间）
		const noWin = html.replace(/2026\/11\/11 08:00 ~ 2026\/11\/11 13:00/g, "时间待定");
		const items2 = B.ns_batch2_cznItemsOf(noWin, "Asia/Shanghai", NOW);
		check("反证 A：抹掉维护区间 ⇒ 只剩 1 条有区间的帖（首条被如实跳过，不硬凑）",
			items2.length === 1 && items2[0].title !== "赛季「凝结于雪上的约定」阶段2更新介绍",
			JSON.stringify(items2.map((x) => x.title)));

		// 反证 B：抓取时刻 01:00 +08 维护还没开始 ⇒ 当期是 11/04 那条卡池活动（严格 coversNow）
		const capNow = Date.parse("2026-11-11T01:00:20+08:00");
		const itemsCap = B.ns_batch2_cznItemsOf(html, "Asia/Shanghai", capNow);
		const payCap = B.ns_batch2_cznEventPayloadOf(itemsCap, "Asia/Shanghai", capNow);
		check("反证 B：01:00 时维护窗未开始 ⇒ 不当期（当期落到 11-04 的营救活动）",
			!!payCap && payCap.event === "常驻主战员「蒂菲拉」& 辅战员「蒂亚娜」营救概率提升即将开始",
			JSON.stringify(payCap && payCap.event));
		const payNow = B.ns_batch2_cznEventPayloadOf(B.ns_batch2_cznItemsOf(html, "Asia/Shanghai", NOW), "Asia/Shanghai", NOW);
		check("反证 B 对照：12:00 时维护窗已在期 ⇒ 当期回到首条（证明是 coversNow 起的作用）",
			!!payNow && payNow.event === "赛季「凝结于雪上的约定」阶段2更新介绍", JSON.stringify(payNow && payNow.event));

		// 反证 C：完整的 10 张卡里，只有 2 条能被区间正则命中（不是"每张卡都有时间"）
		const all = B.ns_batch2_cznItemsOf(html, "Asia/Shanghai", NOW);
		check("反证 C：10 张卡 → 2 条条目（8 条无完整起止），且逐条都带 raw", all.length === 2 && all.every((x) => x.raw.length > 0),
			JSON.stringify(all.map((x) => x.raw)));
	}
}
