// next-sources/test/cases-b3.mjs —— 批次 B3 离线夹具测试（4 个来源）
//
// 运行（Lead 汇总进 test/run.mjs 前，可本地这样跑）：
//   node --input-type=module -e "import r from './test/cases-b3.mjs'; import {summary} from './test/harness.mjs'; await r(); summary();"
//
// 设计原则（两条）：
//   1. **纯解析函数用"注入 now"测试**：外显"选当期"依赖当前时刻，若在 fetch 层断言具体窗口，
//      夹具过期后测试会假失败。所以「可复现且与系统时间无关」的断言压在同名的纯函数上
//      （parseGf2Windows / parseBandoriSections / parseOurNotesWindows / parseFgoBannerTable /
//        parseFgoEventTable 都吃显式 now 或显式 hint）。
//   2. **fetch 层只做契约与非空断言**（run.mjs 的 ① 守卫同口径）。
//
// 夹具依赖（都在 fixtures/ 下，均由本批次用 test/capture.mjs 抓真实响应）：
//   gf2-gacha / gf2-event / gf2-detail-up(2128 卡池) / gf2-detail-event(2142 版本更新)
//   bandori-list / bandori-detail-18418
//   ournotes-list
//   fgo-gacha-parse / fgo-event-parse / fgo-ask-activity(SMW 证据)
// 映射用 useFixtures(overrides) **显式写死**（不只依赖 test/map.json）：
// map.json 是 capture.mjs 读改写共享的，多批次并行抓夹具时可能互相覆盖 → 显式覆盖才可复现。

import { readFileSync } from "node:fs";
import { useFixtures, check, section, assertContract } from "./harness.mjs";
import { SOURCES_B3, findSource } from "../registry-b3.js";
import { sourceInstant, sourceWallParts, textOf, fmtWindow } from "../lib/env.js";

import {
	gachaGf2, eventsGf2, parseGf2Windows, parseGf2List, parseGf2Date,
	GF2_GACHA_URL, GF2_EVENT_URL, GF2_BASE, GF2_TZ
} from "../parsers/gf2.js";
import {
	gachaBandori, eventsBandori, parseBandoriSections, parseBandoriList, parseBandoriDate,
	pickBandoriGachaSection, pickBandoriEventSection, parseBandoriWindow,
	BANDORI_LIST_URL, BANDORI_TZ
} from "../parsers/bandori.js";
import {
	eventsOurNotes, parseOurNotesPosts, parseOurNotesWindows, parseOurNotesInstant,
	selectOurNotesPrimary, OURNOTES_LIST_URL, OURNOTES_TZ
} from "../parsers/ournotes.js";
import {
	gachaFgo, eventsFgo, parseFgoBannerTable, parseFgoEventTable, findFgoEventTable, parseFgoWindow,
	FGO_GACHA_URL, FGO_EVENT_URL, FGO_TZ
} from "../parsers/fgo.js";

// 夹具覆盖：URL → fixtures/<name>/response.txt
const OVERRIDES = {
	[GF2_GACHA_URL]: "gf2-gacha/response.txt",
	[`${GF2_BASE}/website/news/2128`]: "gf2-detail-up/response.txt",
	[GF2_EVENT_URL]: "gf2-event/response.txt",
	[`${GF2_BASE}/website/news/2142`]: "gf2-detail-event/response.txt",
	[BANDORI_LIST_URL]: "bandori-list/response.txt",
	"https://api.biligame.com/news/18418": "bandori-detail-18418/response.txt",
	[OURNOTES_LIST_URL]: "ournotes-list/response.txt",
	[FGO_GACHA_URL]: "fgo-gacha-parse/response.txt",
	[FGO_EVENT_URL]: "fgo-event-parse/response.txt"
};

const fx = (p) => new URL("../fixtures/" + p, import.meta.url);
const readJsonFx = (p) => JSON.parse(readFileSync(fx(p), "utf8"));

// 固定"当前时刻"＝ 2026-10-02 01:27 (UTC+8)，即夹具抓取时刻
const NOW = Date.UTC(2026, 9, 1, 17, 27);

export default async function run() {
	useFixtures(OVERRIDES);

	//#region ① 注册表片段
	section("B3 ① 注册表片段（契约字段 / 时区 / mode）");
	{
		const ids = SOURCES_B3.map((s) => s.id);
		check("B3 有 4 个来源", SOURCES_B3.length === 4, ids.join(","));
		check("B3 id 无重复", new Set(ids).size === ids.length, ids.join(","));
		check("B3 id 齐备（gf2/bandori/ournotes/fgo）",
			["gf2", "bandori", "ournotes", "fgo"].every((x) => ids.includes(x)), ids.join(","));
		for (const s of SOURCES_B3) {
			check(`B3 ${s.id} 声明 tz`, typeof s.tz === "string" && s.tz.length > 0, String(s.tz));
			for (const side of ["gacha", "event"]) {
				if (!s[side]) continue;
				check(`B3 ${s.id}.${side} url 是 http`, /^https?:\/\//.test(s[side].url), s[side].url);
				check(`B3 ${s.id}.${side} fetcher 是函数`, typeof s[side].fetcher === "function");
				check(`B3 ${s.id}.${side} mode 合法`, ["proxy", "direct"].includes(s[side].mode), String(s[side].mode));
			}
		}
		// 实测结论：本批次只有 ournotes 可直连（ACAO 回显 Origin）；fgo.wiki 的 ACAO 为空
		check("B3 ournotes 只有活动侧（卡池无专用源）",
			!!findSource("ournotes").event && !findSource("ournotes").gacha);
		check("B3 ournotes 是 direct", findSource("ournotes").event.mode === "direct");
		check("B3 gf2/bandori/fgo 两侧都是 proxy",
			["gf2", "bandori", "fgo"].every((id) => {
				const s = findSource(id);
				return s.gacha && s.event && s.gacha.mode === "proxy" && s.event.mode === "proxy";
			}));
		check("B3 bandori 两侧同源同 URL", findSource("bandori").gacha.url === findSource("bandori").event.url);
		check("B3 时区取值：gf2/bandori/fgo = UTC+8，ournotes = JST",
			FGO_TZ === "Asia/Shanghai" && GF2_TZ === "Asia/Shanghai"
			&& BANDORI_TZ === "Asia/Shanghai" && OURNOTES_TZ === "Asia/Tokyo");
	}
	//#endregion

	//#region ② GF2 —— 窗口解析（纯函数，注入 hint）
	section("B3 ② 少女前线2：追放 —— 窗口解析（纯函数）");
	{
		const tz = GF2_TZ;
		const w1 = parseGf2Windows("维护时间： 2026年9月22日09:00~12:00", tz, null);
		check("GF2 同日窗口（末段只有时刻）解析出 1 条", w1.length === 1, JSON.stringify(w1.map((x) => x.raw)));
		if (w1[0]) {
			check("GF2 同日窗口起点 = 09-22 09:00 (UTC+8)",
				w1[0].startTs === sourceInstant(2026, 9, 22, 9, 0, tz), String(w1[0].startTs));
			check("GF2 同日窗口终点 = 09-22 12:00 (UTC+8)",
				w1[0].endTs === sourceInstant(2026, 9, 22, 12, 0, tz), String(w1[0].endTs));
			check("GF2 标签取自行内「维护时间：」", w1[0].label === "维护时间", String(w1[0].label));
		}

		// 「版本更新后」→ 用该条公告 Date 的时刻补起点（9/22 维护 09:00~12:00 → Date 12:00:00）
		const hint = parseGf2Date("2026-09-22 12:00:00", tz);
		const w2 = parseGf2Windows("活动时间：\n2026年9月22日 版本更新后~2026年10月13日 08:59", tz, hint);
		check("GF2「版本更新后」窗口解析出 1 条", w2.length === 1, JSON.stringify(w2.map((x) => x.raw)));
		if (w2[0]) {
			check("GF2「版本更新后」起点补成 12:00（= Date 的时刻）",
				w2[0].startTs === sourceInstant(2026, 9, 22, 12, 0, tz), String(w2[0].startTs));
			check("GF2「版本更新后」终点 = 10-13 08:59",
				w2[0].endTs === sourceInstant(2026, 10, 13, 8, 59, tz), String(w2[0].endTs));
			check("GF2 起点是短语时标记 openStart", w2[0].openStart === true);
			check("GF2 标签回退到上一行「活动时间」", w2[0].label === "活动时间", String(w2[0].label));
		}

		// 单日期不是区间：不硬凑（宁缺勿造）
		check("GF2 单日期（补偿有效期）不产出窗口",
			parseGf2Windows("补偿有效期：2026年9月28日23:59:59", tz, null).length === 0);
		// 短语起点但 Date 不同日 → 不猜时刻，跳过
		check("GF2「版本更新后」与 Date 不同日 → 不产出（不猜）",
			parseGf2Windows("2026年9月22日 版本更新后~2026年10月13日 08:59", tz, parseGf2Date("2026-09-21 18:31:03", tz)).length === 0);
		check("GF2 无日期文本 → 空数组", parseGf2Windows("本次更新内容\n新增角色", tz, null).length === 0);
	}
	//#endregion

	//#region ③ GF2 —— 列表 / 卡池侧 / 活动侧（夹具）
	section("B3 ③ 少女前线2：追放 —— 列表与抓取器（夹具）");
	{
		const gListJson = readJsonFx("gf2-gacha/response.txt");
		const list = parseGf2List(gListJson);
		check("GF2 列表解析出条目", list.length === 10, String(list.length));
		check("GF2 列表条目字段（Id/Title/Date）齐备",
			list.every((x) => typeof x.id === "number" && typeof x.title === "string" && x.date), JSON.stringify(list[0]));
		check("GF2 列表 Content 恒为空（所以必须抓详情）—— 夹具证实",
			gListJson.data.list.every((x) => x.Content === ""));
		check("GF2 typeId=4 是卡池与活动混排（含【静默突触】与「概率UP」）",
			list.some((x) => /静默突触/.test(x.title)) && list.some((x) => /概率UP/.test(x.title)));

		// 证据 ①：top_news_list 只是聚合（notice=typeId3 / strategy=typeId4），用不上 → 不必多一个请求
		const top = readJsonFx("gf2-topnews/response.txt");
		check("GF2 top_news_list 是聚合（newest/news/notice/strategy 四段，notice=Type3 / strategy=Type4）",
			!!top.data && Array.isArray(top.data.notice) && Array.isArray(top.data.strategy)
			&& top.data.notice.every((x) => x.Type === 3) && top.data.strategy.every((x) => x.Type === 4),
			JSON.stringify(Object.keys((top.data || {}))));
		const noticeList = parseGf2List(readJsonFx("gf2-event/response.txt"));
		check("GF2 top_news_list.notice 与 typeId=3 列表同源（首条同 Id）",
			!!top.data.notice[0] && top.data.notice[0].Id === noticeList[0].id,
			JSON.stringify([top.data.notice[0] && top.data.notice[0].Id, noticeList[0] && noticeList[0].id]));

		// 证据 ②：主题大活动的窗口落在 typeId=4（所以活动侧按任务书用 typeId=3 时，
		// 只能拿到维护窗口、拿不到活动周期 —— 这是已注明的语义弱点，不是解析失败）
		const d2129 = readJsonFx("gf2-detail-gacha/response.txt").data;
		const w2129 = parseGf2Windows(textOf(d2129.Content), GF2_TZ, parseGf2Date(d2129.Date, GF2_TZ));
		check("GF2 主题活动【静默突触】的窗口在 typeId=4 详情里（9/22 维护后 ~ 11/3 08:59）",
			w2129.some((w) => /2026年11月3日/.test(w.raw)),
			JSON.stringify(w2129.map((w) => w.raw)));

		const src = findSource("gf2");
		const g = await src.gacha.fetcher(src.gacha.url, undefined, src.tz);
		assertContract("GF2", "gacha", g);
		check("GF2 卡池 banner 命中「概率UP」类公告（不是主题活动）",
			!!g && /概率UP/.test(g.banner), JSON.stringify(g && g.banner));
		check("GF2 卡池 roles 抽出 UP 人形",
			!!g && /代理人/.test(g.roles || "") && /莉塔拉/.test(g.roles || ""), JSON.stringify(g && g.roles));
		check("GF2 卡池 bannerDates（唯一窗口 → 与系统时间无关）",
			!!g && g.bannerDates === "09-22 12:00 ~ 10-13 08:59", JSON.stringify(g && g.bannerDates));
		check("GF2 卡池 bannerDatesRaw 保留源站原文",
			!!g && /版本更新后/.test(g.bannerDatesRaw || ""), JSON.stringify(g && g.bannerDatesRaw));

		const e = await src.event.fetcher(src.event.url, undefined, src.tz);
		assertContract("GF2", "event", e);
		check("GF2 活动侧取最新「版本更新公告」",
			!!e && /版本更新公告/.test(e.event), JSON.stringify(e && e.event));
		check("GF2 活动侧 eventDates = 维护窗口",
			!!e && e.eventDates === "09-22 09:00 ~ 09-22 12:00", JSON.stringify(e && e.eventDates));
		check("GF2 活动侧 eventHover 带标签「维护时间」",
			!!e && /维护时间/.test(e.eventHover || ""), JSON.stringify(e && e.eventHover));
	}
	//#endregion

	//#region ④ Bandori —— 分节解析（纯函数）
	section("B3 ④ BanG Dream 国服 —— 公告分节解析（纯函数）");
	{
		const tz = BANDORI_TZ;
		// 实测形态：`活动N、…` 分节 + `★…日程★` 表头 + 窗口行；`维护后` 用 displayTime 补时刻
		const SNIP = [
			"活动一、「测试挑战演出」挑战演出活动 开启！",
			"★活动日程★",
			"9月29日维护后~10月14日22:59",
			"活动二、「测试 Dream Festival招募」开启！",
			"★招募日程★",
			"9月29日维护后~10月11日12:59",
			"活动三、「测试 1日1次免费10连招募」开启！",
			"★招募日程★",
			"9月29日维护后~11月9日23:59"
		].join("\n");
		const hint = parseBandoriDate("2026-09-29 10:00:00", tz);
		const secs = parseBandoriSections(SNIP, tz, hint);
		check("Bandori 分节出 3 节", secs.length === 3, String(secs.length));
		check("Bandori 每节都拿到主窗口", secs.every((s) => s.primary), JSON.stringify(secs.map((s) => !!(s.primary))));
		check("Bandori「维护后」起点补成 displayTime 的 10:00",
			!!secs[0] && secs[0].primary.startTs === sourceInstant(2026, 9, 29, 10, 0, tz),
			secs[0] && fmtWindow(secs[0].primary.startTs, secs[0].primary.endTs, tz));
		check("Bandori 窗口文本形态（MM-DD HH:MM ~ MM-DD HH:MM）",
			!!secs[0] && /^\d{2}-\d{2} \d{2}:\d{2} ~ \d{2}-\d{2} \d{2}:\d{2}$/.test(fmtWindow(secs[0].primary.startTs, secs[0].primary.endTs, tz)),
			secs[0] && fmtWindow(secs[0].primary.startTs, secs[0].primary.endTs, tz));
		const gs = pickBandoriGachaSection(secs), es = pickBandoriEventSection(secs);
		check("Bandori 卡池节 = 含「招募」且排除免费/1日1次（活动二）",
			!!gs && /测试 Dream Festival招募/.test(gs.name), JSON.stringify(gs && gs.name));
		check("Bandori 活动节 = 不含「招募」的挑战演出活动（活动一）",
			!!es && /测试挑战演出/.test(es.name), JSON.stringify(es && es.name));
		// 整行匹配：带尾巴的日期句不算窗口（实测正文里这类句子极多）
		check("Bandori 带尾巴的日期句不算窗口",
			parseBandoriWindow("9月29日维护后，《MATSURI BAYASHI》将上架CiRCLE乐曲商店~", tz, hint) === null);
		check("Bandori 括注里的区间不算窗口",
			parseBandoriWindow("本期也将开启限时招募券任务（9月29日 维护后～10月14日 22:59）！", tz, hint) === null);
		check("Bandori 缺 hint 时「维护后」不猜时刻",
			parseBandoriWindow("9月29日维护后~10月14日22:59", tz, null) === null);

		const lj = readJsonFx("bandori-list/response.txt");
		const bl = parseBandoriList(lj);
		check("Bandori 列表倒序后首条是最新公告（18418）", bl.length > 0 && bl[0].id === 18418, JSON.stringify(bl[0] && bl[0].id));
		check("Bandori 列表原始顺序非严格倒序（夹具第 1 条是 2019 置顶公告）",
			lj.data[0].id === 3724 && /2019/.test(String(lj.data[0].ctime)), JSON.stringify(lj.data[0].ctime));
	}
	//#endregion

	//#region ⑤ Bandori —— 两侧抓取器（夹具）
	section("B3 ⑤ BanG Dream 国服 —— 两侧抓取器（夹具）");
	{
		const src = findSource("bandori");
		const g = await src.gacha.fetcher(src.gacha.url, undefined, src.tz);
		assertContract("Bandori", "gacha", g);
		check("Bandori 卡池 banner = 主招募节名（实体 &middot; 已还原）",
			!!g && g.banner === "黄金周纪念·前篇Dream＆KIRAMEKI Festival招募", JSON.stringify(g && g.banner));
		check("Bandori 卡池 bannerDates（节主窗口 → 与系统时间无关）",
			!!g && g.bannerDates === "09-29 10:00 ~ 10-11 12:59", JSON.stringify(g && g.bannerDates));
		check("Bandori 卡池 roles 抽出节内 ★5 名单",
			!!g && /丸山彩/.test(g.roles || "") && /CHU²/.test(g.roles || ""), JSON.stringify(g && g.roles));

		const e = await src.event.fetcher(src.event.url, undefined, src.tz);
		assertContract("Bandori", "event", e);
		check("Bandori 活动 event = 挑战演出活动名",
			!!e && e.event === "All☆Stars CiRCRiNG Fes!", JSON.stringify(e && e.event));
		check("Bandori 活动 eventDates",
			!!e && e.eventDates === "09-29 10:00 ~ 10-14 22:59", JSON.stringify(e && e.eventDates));
		check("Bandori 活动 eventHover 是逐行多节（含招募节）",
			!!e && typeof e.eventHover === "string" && e.eventHover.split("\n").length >= 5,
			JSON.stringify((e && e.eventHover || "").slice(0, 120)));
	}
	//#endregion

	//#region ⑥ OurNotes —— 时区实测 + 区间解析（纯函数）
	section("B3 ⑥ BanG Dream! OurNotes 日服 —— 时区实测与区间解析");
	{
		const posts = readJsonFx("ournotes-list/response.txt");
		// 「date 与 date_gmt 差 9 小时」的**正确**测法：date_gmt(UTC) 在 Asia/Tokyo 下渲染出的墙钟
		// 必须逐字等于 date（date 是**不带时区后缀的源站本地时间**）。
		const wall = (s) => {
			const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ""));
			return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : null;
		};
		const pad = (n) => String(n).padStart(2, "0");
		const jst9 = posts.map((p) => {
			const w = sourceWallParts(Date.parse(p.date_gmt + "Z"), OURNOTES_TZ);
			return `${w.y}-${pad(w.mo)}-${pad(w.d)} ${pad(w.h)}:${pad(w.mi)}`;
		});
		check("OurNotes date_gmt(UTC)+JST 渲染 == date 墙钟 → 日服 = UTC+9（逐条 11 篇）",
			posts.length > 0 && jst9.every((s, i) => s === wall(posts[i].date)),
			JSON.stringify([jst9[0], wall(posts[0].date)]));
		// 同一时刻：date_gmt+Z 是绝对时刻，按 tz 解释 date 也应得同一时刻（±1min，契约只到分钟）
		const skew = posts.map((p) => parseOurNotesInstant(p.date, OURNOTES_TZ) - Date.parse(p.date_gmt + "Z"));
		check("OurNotes date 按 tz 解释 == date_gmt 的绝对时刻（±1min，分钟精度）",
			skew.every((x) => Math.abs(x) < 60000), JSON.stringify(skew.slice(0, 3)));
		check("OurNotes 夹具是 11 篇公告（新游戏的正常状态）", posts.length === 11, String(posts.length));

		const tz = OURNOTES_TZ;
		const hint = parseOurNotesInstant("2026-09-13T22:51:23", tz);
		const w1 = parseOurNotesWindows("対象期間：2026年9月24日(木)～10月28日(水)14:59", tz, hint);
		check("OurNotes 跨月区间解析（〜 分隔 + 末段带时刻）",
			w1.length === 1 && fmtWindow(w1[0].startTs, w1[0].endTs, tz) === "09-24 00:00 ~ 10-28 14:59",
			JSON.stringify(w1.map((w) => fmtWindow(w.startTs, w.endTs, tz))));
		check("OurNotes 起点无时刻 → 00:00，终点 14:59",
			!!w1[0] && w1[0].startTs === sourceInstant(2026, 9, 24, 0, 0, tz) && w1[0].endTs === sourceInstant(2026, 10, 28, 14, 59, tz));
		const w2 = parseOurNotesWindows("2026年10月17日(土)・18日(日)", tz, hint);
		check("OurNotes「・」连写两日（末段省「月」）解析为 17→18 全天",
			w2.length === 1 && fmtWindow(w2[0].startTs, w2[0].endTs, tz) === "10-17 00:00 ~ 10-18 23:59",
			JSON.stringify(w2.map((w) => fmtWindow(w.startTs, w.endTs, tz))));
		const w3 = parseOurNotesWindows("2026年9月13日(日)　21:00～22:30", tz, hint);
		check("OurNotes 同日时刻区间（末段省日期）",
			w3.length === 1 && fmtWindow(w3[0].startTs, w3[0].endTs, tz) === "09-13 21:00 ~ 09-13 22:30",
			JSON.stringify(w3.map((w) => fmtWindow(w.startTs, w.endTs, tz))));
		check("OurNotes 单个日期不算区间（不硬凑）",
			parseOurNotesWindows("2026年9月24日(木)に決定しました！", tz, hint).length === 0);
		check("OurNotes 裸「N日」（5日連続/30日間）不当窗口",
			parseOurNotesWindows("9月25日(金)から5日連続で、30日間有効です。", tz, hint).length === 0);

		// 外显挑选用**注入 now**（系统时间无关）
		const entries = parseOurNotesPosts(posts, tz);
		const pick = selectOurNotesPrimary(entries, NOW);
		check("OurNotes 选当期 = 覆盖 2026-10-02 的那篇（id 288）",
			!!pick && pick.post.id === 288, JSON.stringify(pick && pick.post.id));
		check("OurNotes 当期窗口 = 09-24 00:00 ~ 10-28 14:59",
			!!pick && fmtWindow(pick.win.startTs, pick.win.endTs, tz) === "09-24 00:00 ~ 10-28 14:59",
			pick && fmtWindow(pick.win.startTs, pick.win.endTs, tz));
	}
	//#endregion

	//#region ⑦ OurNotes —— 抓取器（夹具，direct）
	section("B3 ⑦ BanG Dream! OurNotes 日服 —— 抓取器（夹具 / direct）");
	{
		const src = findSource("ournotes");
		const e = await src.event.fetcher(src.event.url, undefined, src.tz);
		assertContract("OurNotes", "event", e);
		check("OurNotes 活动名非空", !!(e && e.event), JSON.stringify(e && e.event));
		check("OurNotes eventDates 形态合法",
			!!e && /^(\d{4}-)?\d{2}-\d{2} \d{2}:\d{2} ~ (\d{4}-)?\d{2}-\d{2} \d{2}:\d{2}$/.test(e.eventDates),
			JSON.stringify(e && e.eventDates));
		check("OurNotes eventHover 至少一行", !!(e && e.eventHover && e.eventHover.length > 0));
	}
	//#endregion

	//#region ⑧ FGO —— 表格解析（纯函数，注入 now）
	section("B3 ⑧ FGO 国服 · fgo.wiki —— 表格解析（纯函数，注入 now）");
	{
		const tz = FGO_TZ;
		// 国服活动表两个日期之间**没有 `~`**（只有 <br />）→ 按"格内前两个日期时刻"解析
		const w = parseFgoWindow("2026年9月29日(周二)19:00 2026年12月20日(周日)13:59", tz);
		check("FGO 无分隔符的窗口也能解析（活动表形态）", !!w, JSON.stringify(w));
		check("FGO 窗口起止按 UTC+8 换算",
			!!w && w.startTs === sourceInstant(2026, 9, 29, 19, 0, tz) && w.endTs === sourceInstant(2026, 12, 20, 13, 59, tz),
			JSON.stringify(w));
		check("FGO raw 归一成 `… ~ …`",
			!!w && w.raw === "2026年9月29日(周二)19:00 ~ 2026年12月20日(周日)13:59", JSON.stringify(w && w.raw));
		check("FGO 只有一个日期的单元格不算窗口",
			parseFgoWindow("2026年9月29日(周二)19:00", tz) === null);

		const gHtml = readJsonFx("fgo-gacha-parse/response.txt").parse.text;
		const g = parseFgoBannerTable(gHtml, tz, NOW);
		check("FGO 卡池表选中「国服当前卡池」并取到当期", !!g, JSON.stringify(g && g.banner));
		check("FGO 卡池外显 = 结束最早的当期池（与插件 selectCurrent 同口径）",
			!!g && g.banner === "「OVER THE SAME SKY-SEPTEMBER-」推荐召唤", JSON.stringify(g && g.banner));
		check("FGO 卡池窗口 = 09-22 19:00 ~ 10-06 13:59",
			!!g && fmtWindow(g.startTs, g.endTs, tz) === "09-22 19:00 ~ 10-06 13:59",
			g && fmtWindow(g.startTs, g.endTs, tz));
		check("FGO 卡池 roles 拿到推荐召唤从者（≥15 骑时 wiki 用占位提示 → 我判空）",
			!!g && /阿蒂拉/.test(g.roles), JSON.stringify(g && g.roles.slice(0, 40)));
		check("FGO 国服当前卡池同期 ≥1 个", !!g && g.openCount >= 1, JSON.stringify(g && g.openCount));

		const eHtml = readJsonFx("fgo-event-parse/response.txt").parse.text;
		const found = findFgoEventTable(eHtml);
		check("FGO 活动表选到国服当年表（2026）", !!found && found.year === 2026, JSON.stringify(found && found.year));
		const er = parseFgoEventTable(eHtml, tz, NOW);
		check("FGO 活动表 2026 行数 ≥50 且几乎全可解析",
			er.rows.length >= 50 && er.skipped <= 2, `rows=${er.rows.length} skipped=${er.skipped}`);
		check("FGO 活动外显优先 Event 档（不是 Campaign）",
			!!er.event && er.event === "幕末武斗神话 唠唠叨叨新选组 THE END REVENGE OF MAKOTO", JSON.stringify(er.event));
		check("FGO 活动窗口 = 09-24 19:00 ~ 10-15 13:59",
			er.eventDates === "09-24 19:00 ~ 10-15 13:59", String(er.eventDates));
		check("FGO 活动 hover 只列覆盖当前时刻的行（≥2 条）",
			typeof er.eventHover === "string" && er.eventHover.split("\n").length >= 2,
			String(er.activeCount));
		check("FGO 日服表被排除（表头含「日本标准时间」不参与选表）",
			!/(日本标准时间)/.test(er.eventDatesRaw || "") && er.event !== "见鬼去吧！ 南瓜农场屠杀", String(er.event));
	}
	//#endregion

	//#region ⑨ FGO —— 两条路线对比（SMW ask 证据）
	section("B3 ⑨ FGO —— 为什么选 HTML 表格而不是 SMW ask（夹具证据）");
	{
		const ask = readJsonFx("fgo-ask-activity/response.txt");
		const res = ask.query && ask.query.results ? ask.query.results : {};
		const items = Object.entries(res).map(([title, r]) => ({ title, p: r.printouts || {} }));
		check("FGO ask 可用（返回结构化结果 8 条）", items.length === 8, String(items.length));
		check("FGO ask 的时间属性带 UTC timestamp（中文名称/开始时间/结束时间/类型 齐备）",
			items.every((x) => x.p["中文名称"] && x.p["开始时间"] && x.p["结束时间"] && x.p["类型"]),
			JSON.stringify(Object.keys(items[0].p)));
		// 关键反证：国服/日服 的 Property 存在但**值全为空** → 过滤不掉另一个服
		check("FGO ask 的「国服/日服」属性全为空数组（无法按服过滤）",
			items.every((x) => (x.p["国服"] || []).length === 0 && (x.p["日服"] || []).length === 0),
			JSON.stringify(items.map((x) => [x.p["国服"], x.p["日服"]]).slice(0, 2)));
		const covers = (x) => {
			const s = +(x.p["开始时间"][0] || {}).timestamp, e = +(x.p["结束时间"][0] || {}).timestamp;
			return s <= NOW / 1000 && e >= NOW / 1000;
		};
		const evs = items.filter((x) => /Event/i.test(String(x.p["类型"][0] || "")) && covers(x));
		check("FGO ask 结果里**两个不同服**的 Event 同时覆盖当期 → ask 选不出国服当期",
			evs.length >= 2 && evs.some((x) => /幕末武斗神话/.test(x.title)) && evs.some((x) => /南瓜农场屠杀/.test(x.title)),
			JSON.stringify(evs.map((x) => x.title)));
		// 交叉验证时区：SMW 的 UTC 时刻 + 8h = 国服表墙钟
		const cn = items.find((x) => /^幕末武斗神话/.test(x.title));
		const cnTs = cn && +(cn.p["开始时间"][0] || {}).timestamp;
		check("FGO 时区交叉验证：SMW 的 UTC=2026-09-24T11:00Z ↔ 国服表 9/24 19:00（UTC+8）",
			cnTs === Date.UTC(2026, 8, 24, 11, 0) / 1000 && sourceInstant(2026, 9, 24, 19, 0, FGO_TZ) === cnTs * 1000,
			String(cnTs));
	}
	//#endregion

	//#region ⑩ FGO —— 两侧抓取器（夹具）
	section("B3 ⑩ FGO 国服 · fgo.wiki —— 两侧抓取器（夹具）");
	{
		const src = findSource("fgo");
		const g = await src.gacha.fetcher(src.gacha.url, undefined, src.tz);
		assertContract("FGO", "gacha", g);
		check("FGO 卡池 banner 非空且是推荐召唤", !!g && /推荐召唤/.test(g.banner), JSON.stringify(g && g.banner));
		const e = await src.event.fetcher(src.event.url, undefined, src.tz);
		assertContract("FGO", "event", e);
		check("FGO 活动 event 非空", !!(e && e.event), JSON.stringify(e && e.event));
		check("FGO 活动 eventDates 形态合法",
			!!e && /^\d{2}-\d{2} \d{2}:\d{2} ~ \d{2}-\d{2} \d{2}:\d{2}$/.test(e.eventDates), JSON.stringify(e && e.eventDates));
	}
	//#endregion
}
