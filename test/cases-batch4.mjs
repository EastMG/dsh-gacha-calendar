// test/cases-batch4.mjs —— 第四批新来源（2026-11-15 合并）：6 条 + 2026-11-15 追加的 imas 第 5 款
//
// 落点（**只取源文件 + 重新接线**，不是 git merge）：
//   · `src/client/30-game-nikki4.js`   闪耀暖暖·国服 —— 首页 `__NEXT_DATA__` + `/news/{id}`
//   · `src/client/30-game-idolmaster.js` アイドルマスター系列 **5 款**（学マス / シャニマス /
//     ミリシタ / デレステ / **シャニソン = シャイニーカラーズ Song for Prism**）——
//     `melonpapapapa-n.com` 每款一个月份页，卡池 + 活动同一张表
//     （第 5 款是同日补的：源站第 5 个品牌代号 `ss`；判据见 30-game-idolmaster.js 文件头）
//
// ── 这一段守什么 ──
//   ① **注册项**：7 条的 id / 名称 / tz / 来源标签 / 卡池·活动同源 URL（+ 颜色）；
//      以及用户 2026-11-15 拍板的**标签后缀口径**：5 条 imas 的来源文案逐字带「（日文）」，
//      条目 name 不加任何后缀；
//      引擎整轮；imas 五款走引擎的 `GACHA_FETCHERS` 抓取器，卡池/活动同一次抓取）；
//   ③ **反证**：`{}` ⇒ **抛错**（不是 nomatch）；抹掉时间锚点 ⇒ 该条**不进外显**（不抛、不硬凑）；
//      imas 月份页所有时刻锚都消失 ⇒ 抛结构错（不许静默成"本期没有"）。
//
// ⚠️ 时间断言一律写**绝对毫秒**（`Date.UTC(...)` 手算，不用 `sourceInstant` 自证）：
//    这样 `TZ=UTC` 与 `TZ=Asia/Shanghai` 两道门禁跑的是同一份期望值。
//
// 夹具全部真抓（见各 `response.txt.meta.json` 的 capturedAt / note）：
//   `nikki4-detail-{102568,102571,102574,102582,102583}`；`imas-{gakumas-202610,
//   gakumas-202611,shinycolors-202611,millisita-202611,deresute-202611,shanison-202611}`。

import { createEngine } from "../packages/core/core.mjs";
import { check, section, fixtureBody, assertHoverConvention } from "./harness.mjs";
import { T } from "./load.mjs";

const TZ_TW = "Asia/Taipei";
const TZ_CN4 = "Asia/Shanghai";
const TZ_JP = "Asia/Tokyo";

const srcOf = (id) => T.SOURCES.find((s) => s.id === id) || null;
const allIds = () => T.SOURCES.map((s) => s.id);

const makeStore = (seed) => {
	const m = new Map(Object.entries(seed || {}));
	return { map: m, async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
};

/** 夹具 transport：默认按 map.json 取夹具原文；`overrides` 里按 URL 覆盖（反证用）。 */
const makeTransport = (sink, overrides) => ({
	async fetchRaw(url) {
		if (sink) sink.push(String(url));
		throw new Error("本批 6 条都走宿主代理（mode=proxy）：" + url);
	},
	async fetchViaProxy(url) {
		const u = String(url);
		if (sink) sink.push(u);
		if (overrides && overrides[u] != null) return overrides[u];
		return fixtureBody(u);
	}
});

const engineAt = (now, shownId, sink, overrides) => {
	const others = allIds().filter((x) => x !== shownId);
	return createEngine({
		transport: makeTransport(sink, overrides),
		storage: makeStore({ hidden: others, shown: [shownId] }),
		now: () => now,
		timer: { setTimeout, clearTimeout }
	});
};

export default async function run() {
	// ═════════ ① 注册项（6 条 + imas 第 5 款 = 7 条）═════════
	section("第四批 ①：7 条注册项（id / 名称 / tz / 标签 / 卡池·活动同源 URL + 颜色）");
	{
		const N = T.parsers.nikki4, I = T.parsers.idolmaster;
		// 用户 2026-11-15 拍板的后缀口径：只许这一种写法（不许（日服）/（JST）/（原文）…）
		const IMAS_LABEL_LITERAL = "melonpapapapa 総合カレンダー（日文）";
		for (const [id, name, tz, label] of [
			["nikki4", "闪耀暖暖", TZ_CN4, "官网公告"],
			["gakumas", "学園アイドルマスター", TZ_JP, I.IMAS_SOURCE_LABEL],
			["shinycolors", "シャイニーカラーズ", TZ_JP, I.IMAS_SOURCE_LABEL],
			["millisita", "ミリオンライブ！シアターデイズ", TZ_JP, I.IMAS_SOURCE_LABEL],
			["deresute", "アイドルマスター シンデレラガールズ スターライトステージ", TZ_JP, I.IMAS_SOURCE_LABEL],
			// 2026-11-15 追加：源站第 5 个品牌代号 `ss`（页面标题「シャニソン」）
			["shanison", "シャイニーカラーズ Song for Prism", TZ_JP, I.IMAS_SOURCE_LABEL]
		]) {
			const s = srcOf(id);
			check(`${id} 已注册（name / tz / 标签逐字）`,
				!!s && s.name === name && s.tz === tz && s.source === label && s.eventSource === label,
				s ? JSON.stringify([s.name, s.tz, s.source, s.eventSource]) : "缺失");
			check(`${id} 卡池与活动**同一条** URL（同源同轮只抓一次）`,
				!!s && !!s.url && s.url === s.eventUrl, s ? JSON.stringify([s.url, s.eventUrl]) : "缺失");
			check(`${id} 出厂默认展示（defaultHidden = false）`, !!s && s.defaultHidden === false, s && String(s.defaultHidden));
			check(`${id} 有配色（面板「颜色 = 游戏」）`, !!s && /^#[0-9A-F]{6}$/i.test(String(s.color)), s && String(s.color));
		}
		// 用户 2026-11-15 明确要求：这 5 条来源的**选项文案**（source / eventSource）含日文原文
		// ⇒ 统一加「（日文）」后缀，且只许这一种；条目 `name` 保持日文原名、**不加**后缀。
		const IMAS_FIVE = ["gakumas", "shinycolors", "millisita", "deresute", "shanison"];
		check(`imas 5 条来源标签逐字 = 「${IMAS_LABEL_LITERAL}」（后缀只此一种）`,
			IMAS_FIVE.every((id) => srcOf(id).source === IMAS_LABEL_LITERAL && srcOf(id).eventSource === IMAS_LABEL_LITERAL),
			JSON.stringify(IMAS_FIVE.map((id) => [srcOf(id).source, srcOf(id).eventSource])));
		check("imas 5 条来源标签都**不是**旧写法（无后缀的那版已全部改掉）",
			IMAS_FIVE.every((id) => srcOf(id).source !== "melonpapapapa 総合カレンダー"),
			JSON.stringify(IMAS_FIVE.map((id) => srcOf(id).source)));
		check("imas 5 条的条目 name **不带**「（日文）」这类后缀（后缀只加在来源文案上）",
			IMAS_FIVE.every((id) => !/（日文）$/.test(String(srcOf(id).name))),
			JSON.stringify(IMAS_FIVE.map((id) => srcOf(id).name)));
		check("nikki4 首页地址逐字", srcOf("nikki4").url === N.NIKKI4_LIST_URL, String(srcOf("nikki4").url));
		check("imas 五款的注册地址 = 当月的各自月份页（YYYYMM + brand slug）",
			[["gakumas", "imas_gm"], ["shinycolors", "imas_sc"], ["millisita", "imas_ml"], ["deresute", "imas_cgss"], ["shanison", "imas_ss"]]
				.every(([id, slug]) => new RegExp("^https://melonpapapapa-n\\.com/" + slug + "_\\d{6}/$").test(String(srcOf(id).url))),
			JSON.stringify(IMAS_FIVE.map((id) => srcOf(id).url)));
		check("imas 第 5 款（shanison）brand class / 名称 / slug 三者对得上（`ss` ⇒ brand-shanison）",
			I.IMAS_BRANDS.shanison.slug === "imas_ss" && I.IMAS_BRANDS.shanison.cls === "brand-shanison"
			&& I.IMAS_BRANDS.shanison.name === "シャイニーカラーズ Song for Prism",
			JSON.stringify(I.IMAS_BRANDS.shanison));
		check("7 条 id 全局唯一（没和既有来源撞 id）", new Set(allIds()).size === allIds().length, String(allIds().length));
	}

	// ═════════ ③ nikki4：首页 4 条精选 + 详情（「更新后」锚定 09:30 / 跨年）═════════
	section("第四批 ③：闪耀暖暖·国服（nikki4）真夹具 —— 首页 / 详情 / 引擎整轮");
	{
		const N = T.parsers.nikki4;
		const NK_LIST = N.NIKKI4_LIST_URL;
		const NK_D = (id) => N.NIKKI4_DETAIL_BASE + id;
		const ids = ["102568", "102571", "102574", "102582", "102583"];
		const BODY = { [NK_LIST]: fixtureBody(NK_LIST) };
		for (const id of ids) BODY[NK_D(id)] = fixtureBody(NK_D(id));

		const rows = N.nikki4HomeOf(BODY[NK_LIST], TZ_CN4);
		check("首页：4 条精选，按新闻 id 倒序（102583 / 102574 / 102571 / 102568）",
			rows.length === 4 && rows.map((x) => x.id).join(",") === "102583,102574,102571,102568",
			JSON.stringify(rows.map((x) => x.id)));
		check("新闻 id 取自 `info` 的 `/news/{id}`（栏目格子 id 8/9/6/10 不当新闻 id）",
			rows.every((x) => /^\d{6}$/.test(x.id)) && rows[0].url === NK_D("102583"),
			JSON.stringify(rows.map((x) => [x.id, x.url])));

		const fact = (id) => {
			const page = N.nikki4PageOf(BODY[NK_D(id)], TZ_CN4);
			return N.nikki4FactsOf({ id, title: page.title, publishTs: page.publishTs }, page, TZ_CN4);
		};
		check("「更新后」锚定 = 当日 09:30（+08；依据见 30-game-nikki4.js 文件头 ③）",
			N.NIKKI4_UPDATE_ANCHOR.h === 9 && N.NIKKI4_UPDATE_ANCHOR.mi === 30,
			JSON.stringify(N.NIKKI4_UPDATE_ANCHOR));
		check("详情 102574：活动窗口 1 条，起止 = 2026-11-05 09:30 ~ 11-18 23:59 +08（UTC 手算 01:30Z / 15:59Z）",
			fact("102574").windows.length === 1 && fact("102574").windows[0].kind === "event"
			&& fact("102574").windows[0].startTs === Date.UTC(2026, 10, 5, 1, 30)
			&& fact("102574").windows[0].endTs === Date.UTC(2026, 10, 18, 15, 59),
			JSON.stringify(fact("102574").windows.map((w) => [w.kind, w.startTs, w.endTs])));
		check("102574 raw 保留「11月5日更新后」⇒ 悬停印原文、外显用锚定后的可读文本",
			fact("102574").windows[0].raw === "11月5日更新后 ~ 11月18日23:59"
			&& fact("102574").windows[0].display === "11-05 09:30 ~ 11-18 23:59",
			JSON.stringify([fact("102574").windows[0].raw, fact("102574").windows[0].display]));
		check("102583：锚点与档期**分两行**也认；活动名取正文上一行的 `【改造吧！PP游戏！】`",
			fact("102583").windows.length === 1 && fact("102583").windows[0].name === "改造吧！PP游戏！"
			&& fact("102583").windows[0].startTs === Date.UTC(2026, 10, 5, 1, 30),
			JSON.stringify(fact("102583").windows.map((w) => [w.name, w.startTs])));
		check("102582：两端绝对时刻 + 跨年 ⇒ 2026-11-16 05:00 ~ 2027-01-17 23:59（不做「更新后」锚定）",
			fact("102582").windows.length === 1
			&& fact("102582").windows[0].startTs === Date.UTC(2026, 10, 15, 21, 0)
			&& fact("102582").windows[0].endTs === Date.UTC(2027, 0, 17, 15, 59)
			&& fact("102582").windows[0].openStart === false,
			JSON.stringify(fact("102582").windows));
		check("只有起点没有终点的两篇（概念PV / 套装预告）⇒ 0 窗口",
			fact("102568").windows.length === 0 && fact("102571").windows.length === 0,
			JSON.stringify([fact("102568").windows.length, fact("102571").windows.length]));

		N.nikki4ResetCache();
		const calls = [];
		const e = engineAt(Date.parse("2026-11-15T15:00:00+08:00"), "nikki4", calls, BODY);
		const rec = (await e.refresh()).games.nikki4 || {};
		check("引擎：首轮 5 次（首页 1 + 4 篇精选详情各 1）",
			calls.length === 5 && calls.filter((u) => u === NK_LIST).length === 1
			&& ["102583", "102574", "102571", "102568"].every((id) => calls.filter((x) => x === NK_D(id)).length === 1),
			"requests=" + calls.length + " " + JSON.stringify(calls));
		check("引擎外显：活动 = 改造吧！PP游戏！/ 11-05 09:30 ~ 11-18 23:59（raw 保留「更新后」）",
			rec.event === "改造吧！PP游戏！" && rec.eventDates === "11-05 09:30 ~ 11-18 23:59"
			&& rec.eventDatesRaw === "11月5日更新后 ~ 11月18日23:59" && rec.eventFail === null,
			JSON.stringify([rec.event, rec.eventDates, rec.eventDatesRaw]));
		check("引擎：卡池侧当日如实 nomatch（不冒充有池），活动数组 2 条",
			rec.banner === "" && String((rec.gachaFail || {}).kind) === "nomatch"
			&& Array.isArray(rec.events) && rec.events.length === 2
			&& rec.events.every((x) => x.key.startsWith("nikki4:event:")),
			JSON.stringify([rec.banner, rec.gachaFail, (rec.events || []).map((x) => x.key)]));
		if (rec.eventHover) assertHoverConvention("nikki4 活动悬停", rec.eventHover, { requireSet: true });
	}

	// ═════════ ④ アイドルマスター系列 5 款：月份页（1 次请求 / 跨月补抓）═════════
	section("第四批 ④：アイドルマスター系列 5 款真夹具 —— 名 + 起止（卡池 + 活动）");
	{
		const I = T.parsers.idolmaster;
		const NOW = Date.parse("2026-11-15T12:00:00+09:00");
		const jst = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h - 9, mi);
		const fetchOf = async (id, now, sink, overrides) => {
			const e = engineAt(now, id, sink, overrides);
			const s = e.__test.SOURCES.find((x) => x.id === id);
			const d = await e.__test.GACHA_FETCHERS[id](s.url, undefined, s.tz);
			return { d, fu: e.__test.EVENT_FETCHERS[id].default };
		};

		// 学マス：当月页 1 次；卡池/活动起止到分
		{
			const sink = [];
			const { d } = await fetchOf("gakumas", NOW, sink);
			check("学マス：只抓当月页 1 次", sink.length === 1 && /imas_gm_202611\/$/.test(sink[0]), JSON.stringify(sink));
			check("学マス 卡池 = LIVE TOUR -標-ファイナル公演記念ガシャDAY2 · 11-08 21:00 ~ 11-16 09:59（JST→绝对毫秒）",
				!!d && d.banner === "LIVE TOUR -標-ファイナル公演記念ガシャDAY2"
				&& d.startTs === jst(2026, 11, 8, 21, 0) && d.endTs === jst(2026, 11, 16, 9, 59)
				&& d.bannerDates === "11-08 21:00 ~ 11-16 09:59" && d.bannerDatesRaw === "11/8 21:00 ~ 11/16 09:59",
				d ? JSON.stringify([d.banner, d.bannerDates, d.startTs, d.endTs]) : "null");
			check("学マス 活动 = 「氷渡香名江エピソード0」公開，起止同窗",
				!!d && d.event === "「氷渡香名江エピソード0」公開" && d.eventDates === "11-08 21:00 ~ 11-16 09:59",
				d ? JSON.stringify([d.event, d.eventDates]) : "null");
			if (d && d.bannerHover) assertHoverConvention("学マス 卡池悬停", d.bannerHover);
		}
		// シャニマス
		{
			const sink = [];
			const { d } = await fetchOf("shinycolors", NOW, sink);
			check("シャニマス：只抓当月页 1 次", sink.length === 1 && /imas_sc_202611\/$/.test(sink[0]), JSON.stringify(sink));
			check("シャニマス 卡池 = 【ふたりぶんわんだふる】市川 雛菜 特別ピンナップアイドルスタンプガシャ · 11-11 00:00 ~ 11-18 11:59",
				!!d && d.banner === "【ふたりぶんわんだふる】市川 雛菜 特別ピンナップアイドルスタンプガシャ"
				&& d.startTs === jst(2026, 11, 11, 0, 0) && d.endTs === jst(2026, 11, 18, 11, 59),
				d ? JSON.stringify([d.banner, d.bannerDates]) : "null");
			check("シャニマス 活动 = 2026年11月「マスターズフェス」· 11-10 15:00 ~ 11-18 04:59",
				!!d && d.event === "2026年11月「マスターズフェス」" && d.eventDates === "11-10 15:00 ~ 11-18 04:59",
				d ? JSON.stringify([d.event, d.eventDates]) : "null");
		}
		// ミリシタ / デレステ
		{
			const { d: ml } = await fetchOf("millisita", NOW, []);
			check("ミリシタ 卡池 = Snapshot Memoriesガシャ · 11-09 15:00 ~ 11-17 14:59",
				!!ml && ml.banner === "Snapshot Memoriesガシャ" && ml.bannerDates === "11-09 15:00 ~ 11-17 14:59"
				&& ml.startTs === jst(2026, 11, 9, 15, 0) && ml.endTs === jst(2026, 11, 17, 14, 59),
				ml ? JSON.stringify([ml.banner, ml.bannerDates]) : "null");
			check("ミリシタ 活动 = ミリコレ！～MILLIONLIVE COLLECTION～ · 11-09 15:00 ~ 11-15 20:59",
				!!ml && ml.event === "ミリコレ！～MILLIONLIVE COLLECTION～" && ml.eventDates === "11-09 15:00 ~ 11-15 20:59",
				ml ? JSON.stringify([ml.event, ml.eventDates]) : "null");
			const { d: cs } = await fetchOf("deresute", NOW, []);
			check("デレステ 卡池 = プレミアムオーディションガシャ · 11-15 00:00 ~ 11-23 23:59",
				!!cs && cs.banner === "プレミアムオーディションガシャ" && cs.bannerDates === "11-15 00:00 ~ 11-23 23:59"
				&& cs.startTs === jst(2026, 11, 15, 0, 0) && cs.endTs === jst(2026, 11, 23, 23, 59),
				cs ? JSON.stringify([cs.banner, cs.bannerDates]) : "null");
			check("デレステ 活动 = SSレアアイドル勧誘チャレンジ · 11-01 00:00 ~ 11-30 23:59",
				!!cs && cs.event === "SSレアアイドル勧誘チャレンジ" && cs.eventDates === "11-01 00:00 ~ 11-30 23:59",
				cs ? JSON.stringify([cs.event, cs.eventDates]) : "null");
		}
		// シャニソン（第 5 款）：源站代号 `ss`，与上面 4 款同一套月份页 → 同一个抓取器形态
		{
			const sink = [];
			const { d } = await fetchOf("shanison", NOW, sink);
			check("シャニソン：只抓当月页 1 次（`imas_ss_202611`）", sink.length === 1 && /imas_ss_202611\/$/.test(sink[0]), JSON.stringify(sink));
			check("シャニソン 卡池 = 小糸誕生日記念ガシャ2026 · 11-11 00:00 ~ 11-17 23:59（JST→绝对毫秒；`t-text` 写的是 0:00，raw 补零成 00:00）",
				!!d && d.banner === "小糸誕生日記念ガシャ2026"
				&& d.startTs === jst(2026, 11, 11, 0, 0) && d.endTs === jst(2026, 11, 17, 23, 59)
				&& d.bannerDates === "11-11 00:00 ~ 11-17 23:59" && d.bannerDatesRaw === "11/11 00:00 ~ 11/17 23:59",
				d ? JSON.stringify([d.banner, d.bannerDates, d.bannerDatesRaw, d.startTs, d.endTs]) : "null");
			check("シャニソン 活动 = 第18回テクニカルチャレンジ杯「秋の終わり、僕の記憶(xRライブ ver.)」· 11-13 12:00 ~ 11-16 20:59",
				!!d && d.event === "第18回テクニカルチャレンジ杯「秋の終わり、僕の記憶(xRライブ ver.)」"
				&& d.eventDates === "11-13 12:00 ~ 11-16 20:59"
				&& d.eventDatesRaw === "11/13 12:00 ~ 11/16 20:59",
				d ? JSON.stringify([d.event, d.eventDates]) : "null");
			// 夹具里 cat-gacha 6 条 / cat-event 3 条都在期内（其余 cat-login/mission/shop/other 一律不进）
			check("シャニソン：cat-gacha 6 条进卡池数组 / cat-event 3 条进活动数组（ログボ·ミッション·ショップ·その他 一条不进）",
				!!d && d.gacha.length === 6 && d.events.length === 3
				&& JSON.stringify(d).indexOf("ログインボーナス") < 0 && JSON.stringify(d).indexOf("記念ミッション") < 0
				&& JSON.stringify(d).indexOf("販売") < 0,
				d ? JSON.stringify([d.gacha.length, d.events.length, d.gacha.map((x) => x.title)]) : "null");
			if (d && d.bannerHover) assertHoverConvention("シャニソン 卡池悬停", d.bannerHover);
			if (d && d.eventHover) assertHoverConvention("シャニソン 活动悬停", d.eventHover);
		}
		// 月初：当月页无覆盖 ⇒ 补抓上一月（跨月条目只在上一月页带完整起点）
		{
			const sink = [];
			const { d } = await fetchOf("gakumas", Date.parse("2026-11-01T12:00:00+09:00"), sink);
			check("月初（11/01 12:00 JST 11 月页还没开池）⇒ 当月 + 上一月 = 2 次请求",
				sink.length === 2 && /imas_gm_202611\/$/.test(sink[0]) && /imas_gm_202610\/$/.test(sink[1]),
				JSON.stringify(sink));
			check("跨月卡池从上一月页拿到完整起点（10-09 11:00 ~ 11-04 10:59）",
				!!d && d.banner === "アナザーアイドルアップデート記念！48 時間限定 SSR アナザーアイドル確定ガシャ"
				&& d.bannerDates === "10-09 11:00 ~ 11-04 10:59"
				&& d.startTs === jst(2026, 10, 9, 11, 0) && d.endTs === jst(2026, 11, 4, 10, 59),
				d ? JSON.stringify([d.banner, d.bannerDates]) : "null");
			check("跨月活动也从上一月页补齐（あさり先生のプロデュースゼミ · 10-30 11:00 ~ 11-09 10:59）",
				!!d && d.event === "あさり先生のプロデュースゼミ" && d.eventDates === "10-30 11:00 ~ 11-09 10:59",
				d ? JSON.stringify([d.event, d.eventDates]) : "null");
		}
	}

	// ═════════ ⑤ 反证（`{}` ⇒ 抛错；抹掉时间锚点 ⇒ 不进外显）═════════
	section("第四批 ⑤：反证 —— `{}` ⇒ 抛错（不是 nomatch）/ 抹掉时间锚点 ⇒ 不进外显");
	{
		const N = T.parsers.nikki4, I = T.parsers.idolmaster;
		const throws = (fn) => { try { fn(); return false; } catch { return true; } };
		check("nikki4 反证：首页 `{}` / 空串 / 没有 __NEXT_DATA__ / 无 newsbanner ⇒ 抛错",
			throws(() => N.nikki4HomeOf({})) && throws(() => N.nikki4HomeOf(""))
			&& throws(() => N.nikki4HomeOf("<html></html>"))
			&& throws(() => N.nikki4HomeOf('<script id="__NEXT_DATA__">{"props":{"pageProps":{"pageData":{}}}}</script>')));
		check("nikki4 反证：详情 `{}` / 空串 / 没有 pageData（不存在的 id 的骨架页）⇒ 抛错",
			throws(() => N.nikki4PageOf({})) && throws(() => N.nikki4PageOf(""))
			&& throws(() => N.nikki4PageOf('<script id="__NEXT_DATA__">{"props":{"pageProps":{}}}</script>')));

		// 抹掉时间锚点 ⇒ 0 窗口（不抛、不进外显）
		const NK_102574 = N.NIKKI4_DETAIL_BASE + "102574";
		const nkNoAnchor = fixtureBody(NK_102574).replace(/活动时间/g, "活动说明");
		check("nikki4 反证：抹掉 `活动时间` 锚点 ⇒ 这篇 0 窗口（不进外显、不抛）",
			(() => {
				const page = N.nikki4PageOf(nkNoAnchor, TZ_CN4);
				return N.nikki4FactsOf({ id: "102574", title: page.title }, page, TZ_CN4).windows.length === 0;
			})(),
			"0 windows");

		// imas：抹掉**单条**的时刻锚 ⇒ 该条不进 gacha[]（其余与外显不变，且不抛）
		const GM11_URL = "https://melonpapapapa-n.com/imas_gm_202611/";
		const GM11 = fixtureBody(GM11_URL);
		const oneGone = String(GM11).replace(/<tr class='calendar-row[\s\S]*?<\/tr>/g, (row) =>
			(row.indexOf("ガラクタロード Vol.7 千奈ガシャ") >= 0 ? row.replace(/<span class='t-text'>[^<]*<\/span>/g, "") : row));
		{
			const e = engineAt(Date.parse("2026-11-15T12:00:00+09:00"), "gakumas", [], { [GM11_URL]: oneGone });
			const s = e.__test.SOURCES.find((x) => x.id === "gakumas");
			const d = await e.__test.GACHA_FETCHERS["gakumas"](s.url, undefined, s.tz);
			check("imas 反证：抹掉单条的时刻锚 ⇒ 该条不进 gacha[]（4 → 3），外显仍是 DAY2",
				!!d && d.gacha.length === 3 && d.banner === "LIVE TOUR -標-ファイナル公演記念ガシャDAY2"
				&& JSON.stringify(d).indexOf("千奈ガシャ") < 0,
				d ? JSON.stringify([d.banner, d.gacha.map((x) => x.title)]) : "null");
		}
		// 所有时刻锚都抹掉 ⇒ 结构错（不许静默成"本期没有"）
		{
			const allGone = String(GM11).replace(/<span class='t-text'>[^<]*<\/span>/g, "");
			const e = engineAt(Date.parse("2026-11-15T12:00:00+09:00"), "gakumas", [], { [GM11_URL]: allGone });
			const s = e.__test.SOURCES.find((x) => x.id === "gakumas");
			let err = null;
			try { await e.__test.GACHA_FETCHERS["gakumas"](s.url, undefined, s.tz); } catch (x) { err = x; }
			check("imas 反证：所有时刻锚都消失 ⇒ 抛 `imas-gakumas-rows-changed`（不是「未公布」）",
				!!err && err.message === "imas-gakumas-rows-changed", JSON.stringify(err && err.message));
		}
		// `{}` ⇒ 抛 `imas-gakumas-no-table`（页面结构变了，不许冒充"当期没有"）
		{
			const e = engineAt(Date.parse("2026-11-15T12:00:00+09:00"), "gakumas", [], { [GM11_URL]: "{}" });
			const s = e.__test.SOURCES.find((x) => x.id === "gakumas");
			let err = null;
			try { await e.__test.GACHA_FETCHERS["gakumas"](s.url, undefined, s.tz); } catch (x) { err = x; }
			check("imas 反证：月份页回 `{}` ⇒ 抛 `imas-gakumas-no-table`",
				!!err && err.message === "imas-gakumas-no-table", JSON.stringify(err && err.message));
		}
		// 第 5 款同一套失败语义（错误码带自己的 brand key：`imas-shanison-…`）
		{
			const SS11_URL = "https://melonpapapapa-n.com/imas_ss_202611/";
			const e = engineAt(Date.parse("2026-11-15T12:00:00+09:00"), "shanison", [], { [SS11_URL]: "{}" });
			const s = e.__test.SOURCES.find((x) => x.id === "shanison");
			let err = null;
			try { await e.__test.GACHA_FETCHERS["shanison"](s.url, undefined, s.tz); } catch (x) { err = x; }
			check("シャニソン 反证：月份页回 `{}` ⇒ 抛 `imas-shanison-no-table`（与老四款同一套语义）",
				!!err && err.message === "imas-shanison-no-table", JSON.stringify(err && err.message));
			const allGone = String(fixtureBody(SS11_URL)).replace(/<span class='t-text'>[^<]*<\/span>/g, "");
			const e2 = engineAt(Date.parse("2026-11-15T12:00:00+09:00"), "shanison", [], { [SS11_URL]: allGone });
			const s2 = e2.__test.SOURCES.find((x) => x.id === "shanison");
			let err2 = null;
			try { await e2.__test.GACHA_FETCHERS["shanison"](s2.url, undefined, s2.tz); } catch (x) { err2 = x; }
			check("シャニソン 反证：所有时刻锚都消失 ⇒ 抛 `imas-shanison-rows-changed`",
				!!err2 && err2.message === "imas-shanison-rows-changed", JSON.stringify(err2 && err2.message));
		}
		check("imas 反证：条目全部已结束 ⇒ 卡池/活动侧 null（不是抛错）",
			I.imasSidePayloadOf([{ name: "往期池", startTs: Date.UTC(2026, 9, 1, 0, 0), endTs: Date.UTC(2026, 9, 2, 0, 0), raw: "10/1 00:00 ~ 10/2 00:00" }],
				"gacha", "gakumas", TZ_JP, Date.parse("2026-11-15T12:00:00+09:00")) === null);
	}
}
