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
