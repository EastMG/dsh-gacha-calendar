// test/cases-uma-tw.mjs —— 赛马娘·繁中服（`uma-tw`，Komoe 官方公告）2026-11-11 接入
//
// ── 本段守什么 ──
//   ① 注册：id / 名称 / tz=`Asia/Taipei` / `defaultHidden`（与 uma-jp、uma-global 一致 = false）/
//      url 与 eventUrl 同一条接口 / 两侧来源标签「Komoe 官方公告」；
//   ② 卡池（真夹具 `uma-tw-list`，真抓时刻 2026-11-10T16:35Z = 11-11 00:35 +08）：
//      当期池名 + 起止逐字；**「維護結束後」那两口池 `startTs=null` ⇒ 不进外显、只进悬停/数组**；
//   ③ 活动：当期活动名 + 起止逐字；`結束` / `即將舉辦` 两篇同档期稿**都不进数组**；
//   ④ 引擎整轮：两侧**共用 1 次请求**（`eventUrl === url` 且卡池载荷带 `event`）、
//      全程带 `Referer: https://uma.komoejoy.com/`（实测不带会被源站拒）、两侧都不 fail；
//   ⑤ 反向证明（纯函数，`now` 显式）：把"标题分流 / 窗口标签 / 維護結束後"三个关键环节逐个拿掉，
//      解析器就**产出空**（不是硬凑一条）；这些断言在 ⑥ 的临时实验里真的会红（见提交说明）。
//
// 时间断言一律写 `Date.UTC(...)` 手算的绝对毫秒（源站 tz = UTC+8）：
// UTC 与 +08 两道门禁跑的是**同一份期望值**，不存在"本机时区对了才绿"。

import { createEngine } from "../packages/core/core.mjs";
import { check, fixtureBody, section } from "./harness.mjs";
import { T } from "./load.mjs";

const K = T.parsers.komoe;
const TZ = K.KOMOE_TW_TZ;                       // Asia/Taipei
const URL_LIST = K.KOMOE_TW_URL;
// 夹具抓取时刻的同一分钟（2026-11-11 00:35 +08）
const NOW = Date.parse("2026-11-11T00:35:00+08:00");

// ── 真夹具 ──
const BODY = fixtureBody(URL_LIST);
const JSON_LIST = JSON.parse(BODY);
const ANNOUNCEMENTS = K.komoeTwAnnouncementsOf(JSON_LIST);

const makeStore = () => {
	const m = new Map();
	return { async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
};
// 记账 transport：只认这一条 URL（其余一律 404，好让"没多打请求"这件事可断言）
function makeTransport(sink) {
	const rec = (url, opts) => sink.push({ url: String(url), referer: (opts && opts.referer) || "" });
	return {
		async fetchRaw(url) {
			rec(url);
			return { ok: false, status: 404, headers: { get: () => null }, text: async () => "", json: async () => ({}) };
		},
		async fetchViaProxy(url, opts) {
			rec(url, opts);
			if (String(url) !== URL_LIST) throw new Error("proxy-bad:404");
			return BODY;
		}
	};
}
const engineAt = (now, sink) => createEngine({
	transport: makeTransport(sink),
	storage: makeStore(),
	now: () => now,
	timer: { setTimeout, clearTimeout }
});
const komoeCallsOf = (calls) => calls.filter((c) => /komoejoy\.com/.test(c.url));

export default async function runUmaTw() {
	// ─────────────────────① 注册 ─────────────────────
	section("赛马娘·繁中服 ①：注册（id / tz / 名称 / 两侧同一条 Komoe 公告接口）");
	{
		const s = T.SOURCES.find((x) => x.id === "uma-tw") || null;
		check("条目已注册（id = uma-tw）", !!s, s ? s.id : "缺失");
		check("名称 = 赛马娘·繁中服", !!s && s.name === "赛马娘·繁中服", s && s.name);
		check("tz = Asia/Taipei（源站墙钟 UTC+8，无夏令时）", !!s && s.tz === TZ && TZ === "Asia/Taipei", s && s.tz);
		check("卡池 url = Komoe 公告列表接口（107075 / type=2 / region=3 / pageSize=20）",
			!!s && s.url === URL_LIST && /\/107075\/2\/list\?pageNum=1&pageSize=20&region=3$/.test(s.url), s && String(s.url));
		check("活动 eventUrl 与卡池同一条（同一份数据，按标题分流）", !!s && s.eventUrl === s.url, s && String(s.eventUrl));
		check("两侧来源标签 = Komoe 官方公告",
			!!s && s.source === "Komoe 官方公告" && s.eventSource === "Komoe 官方公告",
			s && JSON.stringify([s.source, s.eventSource]));
		check("defaultHidden 与 uma-jp / uma-global 一致（都是 false = 出厂展示）",
			!!s && s.defaultHidden === false, s && String(s.defaultHidden));
		check("图标沿用 uma 系列同款（mzstatic AppIcon）", !!s && /mzstatic\.com/.test(String(s.icon)), s && String(s.icon).slice(0, 60));
	}

	// ─────────────────────② 卡池（真夹具逐字）─────────────────────
	section("赛马娘·繁中服 ②：当期卡池（真夹具逐字 + 「維護結束後」不进外显）");
	let gacha = null;
	{
		const calls = [];
		const e = engineAt(NOW, calls);
		const s = e.__test.SOURCES.find((x) => x.id === "uma-tw");
		gacha = await e.__test.GACHA_FETCHERS["uma-tw"](s.url, undefined, s.tz);
		check("卡池抓取器返回对象", !!gacha && typeof gacha === "object");
		check("当期池名逐字（閃耀收藏 Pretty Derby轉蛋與保證SSR意志力轉蛋舉辦公告！）",
			!!gacha && gacha.banner === "閃耀收藏 Pretty Derby轉蛋與保證SSR意志力轉蛋舉辦公告！",
			JSON.stringify(gacha && gacha.banner));
		check("当期档期 = 「11-02 12:00 ~ 12-03 11:59」（补全文本，源站墙钟）",
			!!gacha && gacha.bannerDates === "11-02 12:00 ~ 12-03 11:59", JSON.stringify(gacha && gacha.bannerDates));
		check("源站原文 = 「11/2 12:00 ～ 12/3 11:59」（raw 与 display 分开，全形「～」原样）",
			!!gacha && gacha.bannerDatesRaw === "11/2 12:00 ～ 12/3 11:59", JSON.stringify(gacha && gacha.bannerDatesRaw));
		check("startTs = 2026-11-02 12:00 +08（UTC 04:00）",
			!!gacha && gacha.startTs === Date.UTC(2026, 10, 2, 4, 0), String(gacha && gacha.startTs));
		check("endTs = 2026-12-03 11:59 +08（UTC 03:59）",
			!!gacha && gacha.endTs === Date.UTC(2026, 11, 3, 3, 59), String(gacha && gacha.endTs));
		// 悬停：卡池按结束时间升序（11/23 → 12/2 → 12/3），起点未知那两口**印源站原文**
		check("卡池悬停逐字（3 口池；「維護結束後」原样印原文）",
			!!gacha && gacha.bannerHover === [
				"培育賽馬娘&支援卡片新登場！新培育劇本開幕轉蛋舉辦公告！",
				"10/29 維護結束後 ～ 11/23 11:59",
				"「保證★3」與「保證SSR」新培育劇本聲援轉蛋舉辦公告！",
				"10/29 維護結束後 ～ 12/2 11:59",
				"閃耀收藏 Pretty Derby轉蛋與保證SSR意志力轉蛋舉辦公告！",
				"11-02 12:00 ~ 12-03 11:59"
			].join("\n"),
			JSON.stringify(gacha && gacha.bannerHover));
		check("`gacha[]` 共 3 条（1 主条 + 2 口起点未知的并列条）",
			!!gacha && Array.isArray(gacha.gacha) && gacha.gacha.length === 3,
			JSON.stringify(gacha && gacha.gacha && gacha.gacha.map((x) => x.title)));
		check("`gacha[]` 主条 = 当期池 / source=primary / 两端 ts 都在",
			!!gacha && gacha.gacha[0]?.title === gacha.banner && gacha.gacha[0]?.source === "primary"
			&& gacha.gacha[0]?.startTs === Date.UTC(2026, 10, 2, 4, 0),
			JSON.stringify(gacha && gacha.gacha[0]));
		check("**起点未知那两条**（培育劇本開幕 / 保證★3·SSR 声援）startTs 为 null —— 事实保留、不冒充在期",
			!!gacha && gacha.gacha[1]?.title === "培育賽馬娘&支援卡片新登場！新培育劇本開幕轉蛋舉辦公告！"
			&& gacha.gacha[1]?.startTs === null
			&& gacha.gacha[2]?.title === "「保證★3」與「保證SSR」新培育劇本聲援轉蛋舉辦公告！"
			&& gacha.gacha[2]?.startTs === null,
			JSON.stringify(gacha && gacha.gacha.map((x) => [x.title.slice(0, 12), x.startTs])));
		check("**「維護結束後」那条不进外显**（外显只有两端明确的閃耀收藏池）",
			!!gacha && gacha.banner !== "培育賽馬娘&支援卡片新登場！新培育劇本開幕轉蛋舉辦公告！"
			&& gacha.banner.indexOf("維護結束後") < 0 && gacha.bannerDatesRaw.indexOf("維護結束後") < 0,
			JSON.stringify([gacha && gacha.banner, gacha && gacha.bannerDatesRaw]));
		check("卡池侧 1 次请求、且带 Referer `https://uma.komoejoy.com/`（实测不带被源站拒）",
			komoeCallsOf(calls).length === 1 && komoeCallsOf(calls)[0].referer === K.KOMOE_TW_REFERER,
			JSON.stringify(komoeCallsOf(calls)));
	}

	// ─────────────────────③ 活动（真夹具逐字）─────────────────────
	section("赛马娘·繁中服 ③：当期活动（真夹具逐字 + 结束/预告稿都不进数组）");
	let events = null;
	{
		const calls = [];
		const e = engineAt(NOW, calls);
		const s = e.__test.SOURCES.find((x) => x.id === "uma-tw");
		events = await e.__test.EVENT_FETCHERS["uma-tw"].default(s.eventUrl, undefined, s.tz);
		check("活动抓取器返回对象", !!events && typeof events === "object");
		check("当期活动名逐字（傳奇競賽舉辦中！）", !!events && events.event === "傳奇競賽舉辦中！",
			JSON.stringify(events && events.event));
		check("活动档期 = 「11-10 05:00 ~ 11-13 04:59」（同一条公告的两段区间里取覆盖 now 的那段）",
			!!events && events.eventDates === "11-10 05:00 ~ 11-13 04:59", JSON.stringify(events && events.eventDates));
		check("活动源站原文 = 「11/10 5:00 ～ 11/13 4:59」",
			!!events && events.eventDatesRaw === "11/10 5:00 ～ 11/13 4:59", JSON.stringify(events && events.eventDatesRaw));
		check("startTs = 2026-11-10 05:00 +08（UTC 11-09 21:00）",
			events?.events[0]?.startTs === Date.UTC(2026, 10, 9, 21, 0), String(events && events.events[0] && events.events[0].startTs));
		check("endTs = 2026-11-13 04:59 +08（UTC 11-12 20:59）",
			events?.events[0]?.endTs === Date.UTC(2026, 10, 12, 20, 59), String(events && events.events[0] && events.events[0].endTs));
		check("`events[]` 恰好 1 条（结束稿「訓練員技能測驗 結束！」与预告稿「即將舉辦！」都不进）",
			!!events && Array.isArray(events.events) && events.events.length === 1
			&& events.events[0].title === "傳奇競賽舉辦中！",
			JSON.stringify(events && events.events.map((x) => x.title)));
		check("只有 1 条在期活动 ⇒ 不设 eventHover（交回 UI 默认两行式）",
			!!events && !events.eventHover, JSON.stringify(events && events.eventHover));
		check("活动侧同样 1 次请求、同一条 Referer",
			komoeCallsOf(calls).length === 1 && komoeCallsOf(calls)[0].referer === K.KOMOE_TW_REFERER,
			JSON.stringify(komoeCallsOf(calls)));
	}

	// ─────────────────────④ 引擎整轮：两侧共用 1 次请求 ─────────────────────
	section("赛马娘·繁中服 ④：引擎整轮（两侧共用 1 次请求 / 两侧都不 fail / 记录形状）");
	{
		const calls = [];
		const e = engineAt(NOW, calls);
		const r = await e.refresh();
		const rec = r.games["uma-tw"] || {};
		check("整轮刷新只打了 **1 次** Komoe 接口（eventUrl === url 且卡池载荷带 event ⇒ 活动侧复用）",
			komoeCallsOf(calls).length === 1, String(komoeCallsOf(calls).length));
		check("两侧都不 fail（gachaFail / eventFail 都是 null）",
			rec.gachaFail == null && rec.eventFail == null, JSON.stringify([rec.gachaFail, rec.eventFail]));
		check("记录里的当期卡池与解析器逐字一致",
			rec.banner === "閃耀收藏 Pretty Derby轉蛋與保證SSR意志力轉蛋舉辦公告！"
			&& rec.bannerDates === "11-02 12:00 ~ 12-03 11:59"
			&& rec.bannerDatesRaw === "11/2 12:00 ～ 12/3 11:59",
			JSON.stringify([rec.banner, rec.bannerDates, rec.bannerDatesRaw]));
		check("记录里的当期活动与解析器逐字一致",
			rec.event === "傳奇競賽舉辦中！" && rec.eventDates === "11-10 05:00 ~ 11-13 04:59"
			&& rec.eventDatesRaw === "11/10 5:00 ～ 11/13 4:59",
			JSON.stringify([rec.event, rec.eventDates, rec.eventDatesRaw]));
		check("记录数组：gacha 3 条 / events 1 条",
			Array.isArray(rec.gacha) && rec.gacha.length === 3 && Array.isArray(rec.events) && rec.events.length === 1,
			JSON.stringify([(rec.gacha || []).length, (rec.events || []).length]));
		check("记录数组的 key 带条目 id 前缀（uma-tw:gacha:i / uma-tw:event:i）",
			(rec.gacha || []).every((x, i) => x.key === "uma-tw:gacha:" + i)
			&& (rec.events || []).every((x, i) => x.key === "uma-tw:event:" + i),
			JSON.stringify([(rec.gacha || []).map((x) => x.key), (rec.events || []).map((x) => x.key)]));
		check("记录里两条起点未知的并列池 startTs 仍为 null（数据层没把它们补成猜测值）",
			(rec.gacha || []).filter((x) => x.startTs === null).length === 2,
			JSON.stringify((rec.gacha || []).map((x) => [x.title.slice(0, 10), x.startTs])));
	}

	// ─────────────────────⑤ 反向证明（纯函数）─────────────────────
	section("赛马娘·繁中服 ⑤：反向证明（拿掉关键解析 ⇒ 产出空 / 不编值）");
	{
		const hint = { y: 2026, mo: 11, d: 10, h: 16, mi: 35 };
		// 反向 ①：标题分流 —— 把卡池稿标题里的「轉蛋 / 卡片 / 特選」全删掉，就不再是卡池稿
		const noKeyword = JSON.parse(BODY);
		for (const it of noKeyword.data) it.title = String(it.title).replace(/轉蛋|卡片|特選/g, "抽卡");
		check("反向①：卡池稿标题去掉「轉蛋/卡片/特選」⇒ 卡池侧产出 null（不是硬凑一条）",
			K.komoeTwPayloadOf(noKeyword, "gacha", TZ, NOW) === null,
			JSON.stringify(K.komoeTwPayloadOf(noKeyword, "gacha", TZ, NOW)));
		// 反向 ②：窗口标签 —— 把正文里的「舉辦期間 / 特選期間」标签换成别的字，区间就没人认领
		const noLabel = JSON.parse(BODY);
		for (const it of noLabel.data) it.rich_text = String(it.rich_text).replace(/舉辦期間|特選期間/g, "舉辦消息");
		check("反向②：正文去掉「舉辦期間/特選期間」标签 ⇒ 一条区间都解不出来（items 为空）",
			K.komoeTwItemsOf(noLabel, "gacha", TZ, NOW).length === 0 && K.komoeTwItemsOf(noLabel, "event", TZ, NOW).length === 0,
			JSON.stringify([K.komoeTwItemsOf(noLabel, "gacha", TZ, NOW).length, K.komoeTwItemsOf(noLabel, "event", TZ, NOW).length]));
		// 反向 ③：「維護結束後」= 起点未知 ⇒ startTs 必须留 null；同一行改成具体时刻才会得到起点
		const openWin = K.komoeTwWindowOfLine("10/29 維護結束後 ～ 11/23 11:59", hint, TZ);
		const absWin = K.komoeTwWindowOfLine("10/29 10:00 ～ 11/23 11:59", hint, TZ);
		check("反向③：「維護結束後」⇒ startTs = null（不编一个时刻）+ endTs 照常解出",
			!!openWin && openWin.startTs === null && openWin.endTs === Date.UTC(2026, 10, 23, 3, 59),
			JSON.stringify(openWin));
		check("反向③对照：同一行把起点写成具体时刻 ⇒ startTs 就有值（证明上面那条是「起点未知」分支起了作用）",
			!!absWin && absWin.startTs === Date.UTC(2026, 9, 29, 2, 0),
			JSON.stringify(absWin));
		// 反向 ④：预告 / 结束稿的分流
		check("反向④：「【預告】…轉蛋…」不进任何一侧（= 不重复列同一口池）",
			K.komoeTwSideOf("【預告】閃耀收藏 Pretty Derby轉蛋與保證SSR意志力轉蛋舉辦公告！") === null,
			String(K.komoeTwSideOf("【預告】閃耀收藏 Pretty Derby轉蛋與保證SSR意志力轉蛋舉辦公告！")));
		check("反向④：「活動「訓練員技能測驗」結束！」不进活动侧（结束稿）",
			K.komoeTwSideOf("活動「訓練員技能測驗」結束！") === null,
			String(K.komoeTwSideOf("活動「訓練員技能測驗」結束！")));
		// 反向 ⑤：机率公告 / 免费转蛋活动不是卡池
		check("反向⑤：「…機率公告」与「每天1次10連抽免費轉蛋活動」都不进卡池侧",
			K.komoeTwSideOf("「Pretty Derby轉蛋」與「支援卡片轉蛋」機率公告") === null
			&& K.komoeTwSideOf("最多可免費轉蛋80次！「每天1次10連抽免費轉蛋活動」舉辦中！") === null,
			JSON.stringify([
				K.komoeTwSideOf("「Pretty Derby轉蛋」與「支援卡片轉蛋」機率公告"),
				K.komoeTwSideOf("最多可免費轉蛋80次！「每天1次10連抽免費轉蛋活動」舉辦中！")
			]));
		// 反证守卫自身没瞎：夹具确实是 20 条 type=2 的公告（不是空壳）
		check("夹具是 20 条公告（守卫自身没瞎）", ANNOUNCEMENTS.length === 20, String(ANNOUNCEMENTS.length));
		check("夹具最新一条 = 2026-11-08（源站顺序头两条是 2022~2023 的置顶旧稿）",
			ANNOUNCEMENTS.some((a) => a.publishTs === Date.parse("2026-11-08T04:00:01Z")),
			JSON.stringify(ANNOUNCEMENTS.slice(0, 3).map((a) => [a.title.slice(0, 16), a.publishTs])));
	}
}

// ════════════════════════════════════════════════════════════════════════════════
// 赛马娘·韩服（`uma-kr`，Daum 카페「月间日程」帖）2026-11-15 接入 —— 同一个 case 文件的第二段
// ════════════════════════════════════════════════════════════════════════════════
//
// ── 本段守什么 ──
//   ① 注册：id / 名称 / tz=`Asia/Seoul` / 两侧同一条帖子 / 两侧来源标签 / `defaultHidden:false` / 面板配色；
//   ② 抓取链：**板块置顶列表（8 条）→ 当月日程帖**（文章 id 每月变，不写死）—— 2 次请求；
//   ③ 卡池：真夹具逐字（池名 = 池类型 + 角色名 / 起止 / 跨年 `12월 3일`）；`점검 완료 후` ⇒ `startTs=null`；
//   ④ 活动：当期活动名 + 起止逐字；悬停按结束时间升序且**起点未知那行印韩文原文**；
//   ⑤ 引擎整轮：两侧**共用同一份载荷**（同 URL + 载荷带 `event`）⇒ 仍然只有 2 次请求；
//   ⑥ 反向证明：抹掉日期锚点 ⇒ 一条都进不了外显；`{}` / 空 HTML ⇒ **抛错**（不是 nomatch）；
//      跨年 / 带年份 / 池类型剥离 / 角色小节 各一条反证。
//
// 时间断言一律写 `Date.UTC(...)` 手算的绝对毫秒（源站 tz = UTC+9）：
// UTC 与 +08 两道门禁跑的是**同一份期望值**，不存在"本机时区对了才绿"。

export async function runUmaKr() {
	const KK = T.parsers.umakr;
	const TZK = KK.UMA_KR_TZ;                       // Asia/Seoul
	const LIST_URL = KK.UMA_KR_BOARD_URL;
	const ART_URL = KK.UMA_KR_SCHEDULE_URL;
	// 夹具抓取时刻（2026-11-15 03:22 +08 = 04:22 KST）
	const NOW_LIVE = Date.parse("2026-11-15T03:22:00+08:00");
	// 11-19 12:00 之后（下一口池两端都明确 —— 用来证明"卡池侧真的能出外显"）
	const NOW_NEXT = Date.parse("2026-11-20T12:00:00+09:00");
	const LIST_BODY = fixtureBody(LIST_URL);
	const ART_BODY = fixtureBody(ART_URL);
	const HINT = { y: 2026, mo: 10 };               // 帖子发布日期 26.10.29

	section("赛马娘·韩服 ①：注册（id / tz / 两侧同一条日程帖 / 配色）");
	{
		const s = T.SOURCES.find((x) => x.id === "uma-kr") || null;
		check("条目已注册（id = uma-kr）", !!s, s ? s.id : "缺失");
		check("名称 = 赛马娘·韩服", !!s && s.name === "赛马娘·韩服", s && s.name);
		check("tz = Asia/Seoul（源站墙钟 KST，无夏令时）", !!s && s.tz === TZK && TZK === "Asia/Seoul", s && s.tz);
		check("卡池 url = 当月日程帖（默认兜底 id 799）", !!s && s.url === ART_URL && /\/umamusume-kor\/Z4os\/799$/.test(ART_URL), s && String(s.url));
		check("活动 eventUrl 与卡池同一条（同一个帖子，按 ❖ 块分流）", !!s && s.eventUrl === s.url, s && String(s.eventUrl));
		check("两侧来源标签 = Daum 月度日程",
			!!s && s.source === KK.UMA_KR_SOURCE_LABEL && s.eventSource === KK.UMA_KR_SOURCE_LABEL
			&& KK.UMA_KR_SOURCE_LABEL === "Daum 月度日程",
			s && JSON.stringify([s.source, s.eventSource]));
		check("defaultHidden 与 uma-jp / uma-tw 一致（都是 false = 出厂展示）",
			!!s && s.defaultHidden === false, s && String(s.defaultHidden));
		check("图标沿用 uma 系列同款（mzstatic AppIcon）", !!s && /mzstatic\.com/.test(String(s.icon)), s && String(s.icon).slice(0, 60));
		check("面板配色已下发（SOURCE_COLORS 里登记了 uma-kr）", !!s && s.color === "#B86A9B", s && String(s.color));
	}

	section("赛马娘·韩服 ②：抓取链（置顶列表 → 当月日程帖；文章 id 不写死）");
	{
		const notices = KK.umaKrNoticesOf(LIST_BODY);
		check("列表页认出 8 条置顶公告（源站只渲染 8 条）", notices.length === 8, String(notices.length));
		const row = KK.umaKrScheduleRowOf(notices);
		check("当月日程帖 = Z4os/799「(수정) 우마무스메 프리티 더비 11월 스케줄」",
			!!row && row.board === "Z4os" && row.id === "799"
			&& row.title === "(수정) 우마무스메 프리티 더비 11월 스케줄",
			JSON.stringify(row));
		check("非日程稿一律不选（업데이트 안내 / 오류 현상 / 결제 / 2차 창작 가이드라인 都不含 일정·스케줄）",
			!!row && notices.filter((n) => /일정|스케줄/.test(n.title)).length === 1,
			JSON.stringify(notices.filter((n) => /일정|스케줄/.test(n.title)).map((n) => n.title)));
		check("帖子发布日期 26.10.29 → 补年线索 { y: 2026, mo: 10 }",
			JSON.stringify(KK.umaKrHintOf(ART_BODY)) === JSON.stringify(HINT), JSON.stringify(KK.umaKrHintOf(ART_BODY)));
		const blocks = KK.umaKrBlocksOf(ART_BODY);
		check("正文按 ❖ 分成 10 块（其中 2 块是卡池）", blocks.length === 10 && blocks.filter((b) => b.kind === "gacha").length === 2,
			JSON.stringify([blocks.length, blocks.filter((b) => b.kind === "gacha").length]));
		check("卡池块判定只认 `뽑기`：第 1、2 块是卡池，其余全是活动",
			blocks[0].kind === "gacha" && blocks[1].kind === "gacha" && blocks.slice(2).every((b) => b.kind === "event"),
			JSON.stringify(blocks.map((b) => b.kind)));
	}

	section("赛马娘·韩服 ③：卡池（池名 = 池类型 + 角色名；`점검 완료 후` ⇒ 起点未知）");
	{
		const items = KK.umaKrItemsOf(KK.umaKrBlocksOf(ART_BODY), "gacha", TZK, HINT);
		check("卡池条目 2 条（11-10 池 / 11-19 池）", items.length === 2, JSON.stringify(items.map((x) => x.display)));
		check("11-10 池：起点未知（startTs=null）/ 终点 = 11-19 11:59 KST",
			items[0].startTs === null && items[0].endTs === Date.UTC(2026, 10, 19, 2, 59)
			&& items[0].raw === "11월 10일(화) 점검 완료 후 ~ 11월 19일(목) 11:59",
			JSON.stringify([items[0].startTs, items[0].endTs, items[0].raw]));
		check("11-10 池的池名 = 池类型 + 角色名（日期前缀已剥掉）",
			items[0].title === "픽업 프리티 더비 뽑기 & 셀렉트 픽업 서포트 카드 뽑기（[Assorted Cuteness♡] 후사이치 판도라）",
			JSON.stringify(items[0].title));
		check("11-19 池：角色只取「育成马娘」小节（支援卡 SSR/R 不进 roles）",
			items[1].roles === "[맑은 섬에 핀 아름다운 꽃] 사토노 크라운、[잔잔한 여름의 네이비 드롭] 슈발 그랑",
			JSON.stringify(items[1].roles));
		check("11-19 池：跨年日期 `12월 3일` 记同一年 ⇒ startTs = 11-19 12:00 KST / endTs = 12-03 11:59 KST",
			items[1].startTs === Date.UTC(2026, 10, 19, 3, 0) && items[1].endTs === Date.UTC(2026, 11, 3, 2, 59),
			JSON.stringify([items[1].startTs, items[1].endTs]));
		check("两端都明确时 display 是格式化后的 `11-19 12:00 ~ 12-03 11:59`（raw 仍是韩文原文）",
			items[1].display === "11-19 12:00 ~ 12-03 11:59"
			&& items[1].raw === "11월 19일(목) 12:00 ~ 12월 3일(목) 11:59",
			JSON.stringify([items[1].display, items[1].raw]));

		// 外显：抓取当天（11-15）唯一在期的 11-10 池起点未知 ⇒ **不进外显**（宁可少显示，不要假在期）
		const liveGacha = KK.umaKrPayloadOf(items, "gacha", TZK, NOW_LIVE);
		check("抓取当天（11-15）卡池外显 = null（在期那口池起点写「점검 완료 후」，取不到点检时刻 ⇒ 如实留空）",
			liveGacha === null, JSON.stringify(liveGacha));

		// 11-19 12:00 之后：下一口池两端明确 ⇒ 外显正常产出（证明卡池侧不是永远空）
		const nextGacha = KK.umaKrPayloadOf(items, "gacha", TZK, NOW_NEXT);
		check("11-20 起卡池外显 = 11-19 池（池类型 + 角色名逐字）",
			!!nextGacha && nextGacha.banner === "픽업 프리티 더비 뽑기 & 픽업 서포트 카드 뽑기（[맑은 섬에 핀 아름다운 꽃] 사토노 크라운、[잔잔한 여름의 네이비 드롭] 슈발 그랑）",
			JSON.stringify(nextGacha && nextGacha.banner));
		check("11-20 起档期 = `11-19 12:00 ~ 12-03 11:59` / 原文 = 韩文原句",
			!!nextGacha && nextGacha.bannerDates === "11-19 12:00 ~ 12-03 11:59"
			&& nextGacha.bannerDatesRaw === "11월 19일(목) 12:00 ~ 12월 3일(목) 11:59",
			JSON.stringify(nextGacha && [nextGacha.bannerDates, nextGacha.bannerDatesRaw]));
		check("11-20 起 `gacha[]` 1 条（11-10 池已于 11-19 11:59 结束，不再列为在期）",
			!!nextGacha && Array.isArray(nextGacha.gacha) && nextGacha.gacha.length === 1,
			JSON.stringify(nextGacha && nextGacha.gacha && nextGacha.gacha.map((x) => x.title)));
	}

	section("赛马娘·韩服 ④：活动（当期名 + 起止逐字；起点未知那行印韩文原文）");
	{
		const items = KK.umaKrItemsOf(KK.umaKrBlocksOf(ART_BODY), "event", TZK, HINT);
		check("活动条目 7 条（`메인 스토리` 块没有区间 ⇒ 不产出，不是硬凑）", items.length === 7,
			JSON.stringify(items.map((x) => x.title)));
		check("带年份的两端（마스터즈 챌린지）：2026-11-19 12:00 KST ~ 2027-02-17 11:59 KST",
			items.some((x) => x.startTs === Date.UTC(2026, 10, 19, 3, 0) && x.endTs === Date.UTC(2027, 1, 17, 2, 59)),
			JSON.stringify(items.filter((x) => /마스터즈/.test(x.title)).map((x) => [x.startTs, x.endTs])));
		const live = KK.umaKrPayloadOf(items, "event", TZK, NOW_LIVE);
		check("抓取当天（11-15）当期活动 = 챔피언스 미팅 「CLASSIC」", !!live && live.event === "챔피언스 미팅 「CLASSIC」",
			JSON.stringify(live && live.event));
		check("活动档期 = `11-13 12:00 ~ 11-19 11:59` / 原文 = 韩文原句",
			!!live && live.eventDates === "11-13 12:00 ~ 11-19 11:59"
			&& live.eventDatesRaw === "11월 13일(금) 12:00 ~ 11월 19일(목) 11:59",
			JSON.stringify(live && [live.eventDates, live.eventDatesRaw]));
		check("活动 `events[]` 2 条（主条 + 起点未知的「무인도 캠페인」并列条）",
			!!live && Array.isArray(live.events) && live.events.length === 2
			&& live.events[0].title === "챔피언스 미팅 「CLASSIC」" && live.events[0].source === "primary"
			&& /무인도/.test(live.events[1].title),
			JSON.stringify(live && live.events && live.events.map((x) => [x.title, x.source])));
		check("起点未知的并列条 `startTs` 仍为 null（事实保留、不冒充在期）",
			!!live && live.events[1].startTs === null, JSON.stringify(live && live.events[1] && live.events[1].startTs));
		check("活动悬停逐字（起点未知那行**印韩文原文**，不进格式化）",
			!!live && live.eventHover === [
				"무인도에 어서 오세요 -DESIGN YOUR ISLAND- 공개 기념 캠페인(진행 중)   10월 16일(금) 점검 완료 후 ~ 11월 19일(목) 04:59",
				"챔피언스 미팅 「CLASSIC」   11-13 12:00 ~ 11-19 11:59"
			].join("\n"),
			JSON.stringify(live && live.eventHover));
	}

	section("赛马娘·韩服 ⑤：引擎整轮（2 次请求 / 两侧共用同一份载荷 / 记录形状）");
	{
		const sink = [];
		const e = createEngine({
			transport: makeKrTransport(sink),
			storage: makeKrStore(),
			now: () => NOW_NEXT,
			timer: { setTimeout, clearTimeout }
		});
		const r = await e.refresh();
		const rec = r.games["uma-kr"] || {};
		const kr = krCallsOf(sink);
		check("整轮只有 2 次请求：置顶列表 → 日程帖（活动侧复用卡池载荷）",
			kr.length === 2 && kr[0].url === LIST_URL && kr[1].url === ART_URL,
			JSON.stringify(kr.map((x) => x.url)));
		check("两次都走宿主代理（源站没有 ACAO）", kr.length === 2 && kr.every((x) => x.via === "proxy"),
			JSON.stringify(kr.map((x) => x.via)));
		check("两侧都不 fail（11-20：卡池 11-19 池在期 / 活动 스토리 이벤트 在期）",
			rec.gachaFail == null && rec.eventFail == null, JSON.stringify([rec.gachaFail, rec.eventFail]));
		check("记录里的当期卡池与解析器逐字一致",
			/^픽업 프리티 더비 뽑기 & 픽업 서포트 카드 뽑기（\[맑은 섬에 핀 아름다운 꽃\] 사토노 크라운、\[잔잔한 여름의 네이비 드롭\] 슈발 그랑）$/.test(String(rec.banner))
			&& rec.bannerDates === "11-19 12:00 ~ 12-03 11:59",
			JSON.stringify([rec.banner, rec.bannerDates]));
		check("记录里的当期活动与解析器逐字一致",
			rec.event === "스토리 이벤트 「서머 데이즈 『You』 그라피티」" && rec.eventDates === "11-19 12:00 ~ 12-03 11:59",
			JSON.stringify([rec.event, rec.eventDates]));
		check("记录数组的 key 带条目 id 前缀（uma-kr:gacha:i / uma-kr:event:i）",
			(rec.gacha || []).every((x, i) => x.key === "uma-kr:gacha:" + i)
			&& (rec.events || []).every((x, i) => x.key === "uma-kr:event:" + i),
			JSON.stringify([(rec.gacha || []).map((x) => x.key), (rec.events || []).map((x) => x.key)]));

		// 抓取当天（11-15）的那一轮：卡池侧 = nomatch（起点未知，不是 down）、活动侧照常出当期
		const sinkLive = [];
		const eLive = createEngine({
			transport: makeKrTransport(sinkLive),
			storage: makeKrStore(),
			now: () => NOW_LIVE,
			timer: { setTimeout, clearTimeout }
		});
		const recLive = (await eLive.refresh()).games["uma-kr"] || {};
		check("11-15 那一轮：卡池侧记 nomatch（不是 down ⇒ 源站没坏，只是这一口池起点未知）",
			!!recLive.gachaFail && recLive.gachaFail.kind === "nomatch", JSON.stringify(recLive.gachaFail));
		check("11-15 那一轮：活动侧不 fail，当期 = 챔피언스 미팅 「CLASSIC」",
			recLive.eventFail == null && recLive.event === "챔피언스 미팅 「CLASSIC」",
			JSON.stringify([recLive.eventFail, recLive.event]));
		check("11-15 那一轮同样只有 2 次请求（列表 + 日程帖）", krCallsOf(sinkLive).length === 2,
			JSON.stringify(krCallsOf(sinkLive).map((x) => x.url)));
	}

	section("赛马娘·韩服 ⑥：反向证明（抹掉锚点 ⇒ 不进外显；空结构 ⇒ 抛错，不是 nomatch）");
	{
		// 反证 ①：抹掉日期锚点（把 `N월 N일` 全换成 `언젠가`）⇒ 10 个块还在，但一条区间都解不出来
		const noDates = ART_BODY.replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, "언젠가");
		const blocksNoDates = KK.umaKrBlocksOf(noDates);
		const gachaNoDates = KK.umaKrItemsOf(blocksNoDates, "gacha", TZK, HINT);
		const eventNoDates = KK.umaKrItemsOf(blocksNoDates, "event", TZK, HINT);
		check("反向①：抹掉日期锚点后块结构仍在（10 块），但卡池/活动条目都为 0",
			blocksNoDates.length === 10 && gachaNoDates.length === 0 && eventNoDates.length === 0,
			JSON.stringify([blocksNoDates.length, gachaNoDates.length, eventNoDates.length]));
		check("反向①：外显因此为 null（**不进**正在显示的当期）",
			KK.umaKrPayloadOf(gachaNoDates, "gacha", TZK, NOW_LIVE) === null
			&& KK.umaKrPayloadOf(eventNoDates, "event", TZK, NOW_LIVE) === null,
			JSON.stringify([KK.umaKrPayloadOf(gachaNoDates, "gacha", TZK, NOW_LIVE), KK.umaKrPayloadOf(eventNoDates, "event", TZK, NOW_LIVE)]));

		// 反证 ②：空 HTML / 空对象 ⇒ **抛错**（结构变了按"抓取失败"处理，绝不伪装成"未公布"）
		const thrown = (fn) => { try { fn(); return null; } catch (err) { return String((err && err.message) || err); } };
		check("反向②：空列表页 ⇒ 抛 uma-kr-bad-list（不是返回空数组）",
			thrown(() => KK.umaKrNoticesOf("")) === "uma-kr-bad-list", String(thrown(() => KK.umaKrNoticesOf(""))));
		check("反向②：空正文 / 没有 #article ⇒ 抛 uma-kr-bad-article",
			thrown(() => KK.umaKrBlocksOf("")) === "uma-kr-bad-article"
			&& thrown(() => KK.umaKrLinesOf("<html><body>{}</body></html>")) === "uma-kr-bad-article",
			JSON.stringify([thrown(() => KK.umaKrBlocksOf("")), thrown(() => KK.umaKrLinesOf("<html></html>"))]));
		check("反向②：正文里一个 ❖ 都没有 ⇒ 同样抛 uma-kr-no-blocks",
			thrown(() => KK.umaKrBlocksOf("<div id=\"article\">내용</div>")) === "uma-kr-no-blocks",
			String(thrown(() => KK.umaKrBlocksOf("<div id=\"article\">내용</div>"))));

		// 反证 ③：起点 `점검 완료 후` ⇒ null；同一行改成具体时刻 ⇒ 有值（证明走的是"起点未知"分支）
		const openWin = KK.umaKrWindowOfLine("- 11월 10일(화) 점검 완료 후 ~ 11월 19일(목) 11:59", HINT, TZK);
		const absWin = KK.umaKrWindowOfLine("- 11월 10일(화) 12:00 ~ 11월 19일(목) 11:59", HINT, TZK);
		check("反向③：`점검 완료 후` ⇒ startTs=null / endTs 照常解出",
			!!openWin && openWin.startTs === null && openWin.endTs === Date.UTC(2026, 10, 19, 2, 59),
			JSON.stringify(openWin));
		check("反向③对照：同一行起点写成具体时刻 ⇒ startTs = 11-10 12:00 KST",
			!!absWin && absWin.startTs === Date.UTC(2026, 10, 10, 3, 0), JSON.stringify(absWin));

		// 反证 ④：跨年与年份线索 —— 12 月底 → 1 月初按次年；没有年份线索 ⇒ 不猜（不产出）
		const cross = KK.umaKrWindowOfLine("- 12월 30일(수) 12:00 ~ 1월 5일(화) 11:59", { y: 2026, mo: 12 }, TZK);
		check("反向④：`12월 30일 ~ 1월 5일` ⇒ 结束记次年（2027-01-05 11:59 KST）",
			!!cross && cross.startTs === Date.UTC(2026, 11, 30, 3, 0) && cross.endTs === Date.UTC(2027, 0, 5, 2, 59),
			JSON.stringify(cross));
		check("反向④：拿不到年份线索（hint=null）⇒ 这一行不产出（不猜当前年）",
			KK.umaKrWindowOfLine("- 11월 19일(목) 12:00 ~ 12월 3일(목) 11:59", null, TZK) === null,
			JSON.stringify(KK.umaKrWindowOfLine("- 11월 19일(목) 12:00 ~ 12월 3일(목) 11:59", null, TZK)));

		// 反证 ⑤：池类型剥离与角色小节
		check("反向⑤：`11 월 10일(화) 개최 예정, ` 前缀剥掉（源站的嵌套 span 会留下 `11 월` 空格）",
			KK.umaKrPoolTypeOf("11 월 10일(화) 개최 예정, 픽업 프리티 더비 뽑기 & 셀렉트 픽업 서포트 카드 뽑기")
			=== "픽업 프리티 더비 뽑기 & 셀렉트 픽업 서포트 카드 뽑기",
			JSON.stringify(KK.umaKrPoolTypeOf("11 월 10일(화) 개최 예정, 픽업 프리티 더비 뽑기 & 셀렉트 픽업 서포트 카드 뽑기")));
		check("反向⑤：角色只收「育成马娘」小节里的 `·` 行，支援卡（SSR/R）不收",
			KK.umaKrRolesOf([
				"- 픽업 육성 우마무스메",
				"· ★★★ [맑은 섬에 핀 아름다운 꽃] 사토노 크라운",
				"- 픽업 서포트 카드",
				"· SSR [수면의 프린시펄] 윈 바리아시옹",
				"· R [트레센 학원] 윈 바리아시옹"
			]) === "[맑은 섬에 핀 아름다운 꽃] 사토노 크라운",
			JSON.stringify(KK.umaKrRolesOf([
				"- 픽업 육성 우마무스메",
				"· ★★★ [맑은 섬에 핀 아름다운 꽃] 사토노 크라운",
				"- 픽업 서포트 카드",
				"· SSR [수면의 프린시펄] 윈 바리아시옹"
			])));

		// 反证 ⑥：抓取器在"页面结构变了"时抛错（不是返回 null）—— 用空响应的 transport
		const bad = createEngine({
			transport: {
				async fetchRaw() { return { ok: false, status: 404, headers: { get: () => null }, text: async () => "", json: async () => ({}) }; },
				async fetchViaProxy() { return ""; }
			},
			storage: makeKrStore(),
			now: () => NOW_LIVE,
			timer: { setTimeout, clearTimeout }
		});
		const badR = await bad.refresh();
		const badRec = badR.games["uma-kr"] || {};
		check("反向⑥：列表页返回空串 ⇒ 该侧记 down（fail 有 reason / kind=down），不当成 nomatch",
			!!badRec.gachaFail && badRec.gachaFail.kind === "down" && !!badRec.gachaFail.reason,
			JSON.stringify([badRec.gachaFail, badRec.eventFail]));
	}
}

// 记账 transport（uma-kr 专用）：只认置顶列表与当月日程帖两条 URL，其余 404
function makeKrTransport(sink) {
	return {
		async fetchRaw(url) {
			sink.push({ url: String(url), via: "raw" });
			return { ok: false, status: 404, headers: { get: () => null }, text: async () => "", json: async () => ({}) };
		},
		async fetchViaProxy(url) {
			const u = String(url);
			sink.push({ url: u, via: "proxy" });
			if (u === T.parsers.umakr.UMA_KR_BOARD_URL) return fixtureBody(u);
			if (u === T.parsers.umakr.UMA_KR_SCHEDULE_URL) return fixtureBody(u);
			throw new Error("proxy-bad:404 " + u);
		}
	};
}

function makeKrStore() {
	const m = new Map();
	return { async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
}

/** 引擎整轮会把**全部**来源都抓一遍 ⇒ 统计请求数必须只数 daum 那两条（与 komoeCallsOf 同一手法）。 */
function krCallsOf(calls) {
	return (Array.isArray(calls) ? calls : []).filter((c) => /m\.cafe\.daum\.net/.test(c.url));
}
