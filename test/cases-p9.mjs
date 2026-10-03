// next-sources/test/cases-p9.mjs —— 批次 P9 离线夹具测试
//   ① 物华弥新 国服 **活动侧**（biligame 官方公告 API，两路 typeId=4/1 合并去重）
//   ② 闪耀优俊少女 国服（biligame 官方公告 API，单一 feed 靠标题分流；卡池 + 活动）
//   ③ BanG Dream！OurNotes 国际服（BHK 官方公告 API；**默认未配置**，只挂备选源）
//
// 四个原则（照 CONVENTIONS.md 与 cases-b1/b3/p6）：
//   ① 全程离线：useFixtures(OVERRIDES) 注入夹具 fetch；纯函数测试直接读 fixtures/*/response.txt。
//   ② 确定性：「当前时刻」一律用**夹具抓取时刻**（meta.capturedAt）或**显式注入**的 now，
//      绝不用 Date.now() —— 否则一个月后"当期"变了会假失败。
//   ③ 每个抓取器调用都包 try/catch，失败只记 ✗，不抛出去中断 test/all.mjs。
//   ④ 断言里的硬编码值都是**夹具快照值**（物华/闪耀 11 个夹具是**真抓**的；
//      OurNotes 国际服 4 个夹具是**合成**的，见 P9-6 / P9-7 的显式标注）。
//
//   ⑤ 悬停（2026-10-03 用户反馈「新增游戏的悬停样式/格式/规则和原来的差别很大」→ 方案 A）：
//      悬停里**只许有名称与档期**，且一律「名称在前 + 3 空格 + fmtWindow 档期」（卡池侧「池名：角色」）；
//      元信息（来源站/URL/gameExtensionId/typeId/tz 推定/抓取条数/▶/「粘连」「常驻不产出」说明）
//      **一条都不许出现**（用户原话「元信息彻底删掉」）→ 本文件用 HOVER_META_RE 做统一守卫。
//      排版唯一真源 = lib/env.js 的 hoverPool / hoverEvent（与本体 buildPoolHover / buildEventHover
//      逐字一致）；<2 项返回 "" → 调用方**不设** bannerHover / eventHover，交回 UI 默认两行式。
//
// 本地直接跑：node test/cases-p9.mjs

import { readFileSync } from "node:fs";
import { useFixtures, check, section, assertContract, summary } from "./harness.mjs";
const { sourceInstant, sourceWallParts, fmtWindow } = T;
import { SOURCES_P9, findSourceP9, listIdsP9, EXTRA_GACHA_FETCHERS_P9, EXTRA_EVENT_FETCHERS_P9 } from "./registry-shim.mjs";
import { T } from "./load.mjs";
// 仅测试用：核对备选源登记的就是 B2 那份实现（解析器本体不改）
const { gachaUmaCn } = T.parsers["bwiki"];

const { eventsWhmxOfficial, gachaUmaCnOfficial, eventsUmaCnOfficial, parseBiligameList, mergeBiligameLists, parseWhmxActivity, parseUmaCnAnnouncement, classifyUmaCnTitle, pickWhmxEvent, pickUmaWindow, umaRoles, quotedName, cleanTitle, biligameParagraphs, extractWindowsDetailed, deglueDateTimes, siblingListUrl, whmxListUrls, biligameDetailUrl, biligameListUrl, parseCmsStamp, whmxEventHover, umaCnEventHover, umaCnPoolHover, BILIGAME_ACTIVITY_TZ, WHMX_GAME_EXTENSION_ID, UMA_CN_GAME_EXTENSION_ID, WHMX_LIST_URL, WHMX_LIST_URLS, UMA_CN_LIST_URL } = T.parsers["biligame-activity"];

const { gachaOurNotesGlobal, eventsOurNotesGlobal, parseOurNotesGlobalPage, isOurNotesGlobalEmpty, classifyOurNotesGlobalTitle, cleanTitle: cleanTitleGlobal, extractOurNotesGlobalWindows, ournotesGlobalListUrl, ournotesGlobalDetailUrl, OURNOTES_GLOBAL_LIST_URL, OURNOTES_GLOBAL_TZ, OURNOTES_GLOBAL_GAME_BASE_ID } = T.parsers["ournotes-global"];

// ── 夹具读取 ──
const fixtureText = (p) => readFileSync(new URL("./fixtures/" + p, import.meta.url), "utf8");
const fixtureJson = (p) => JSON.parse(fixtureText(p));
const meta = (p) => JSON.parse(fixtureText(p + ".meta.json"));

// 夹具覆盖：URL → fixtures/<name>/response.txt（**显式写死**，不只依赖多人共写的 test/map.json）
//   ⚠️ OurNotes 的**列表 URL 在 map.json 里映射到「空响应」夹具**（那是 Lead 唯一真抓到过的形态）；
//      本用例在同名 section 里再 useFixtures() 一次，把列表改指到**合成**的非空夹具，
//      用来验证解析逻辑本身（见 P9-6）。
const OVERRIDES = {
	[WHMX_LIST_URLS[0]]: "p9-whmx-act4/response.txt",
	[WHMX_LIST_URLS[1]]: "p9-whmx-act1/response.txt",
	[UMA_CN_LIST_URL]: "p9-uma-cn-list/response.txt",
	"https://api.biligame.com/news/18419": "p9-whmx-d18419/response.txt",
	"https://api.biligame.com/news/18334": "p9-whmx-d18334/response.txt",
	"https://api.biligame.com/news/18265": "p9-whmx-d18265/response.txt",
	"https://api.biligame.com/news/18194": "p9-whmx-d18194/response.txt",
	"https://api.biligame.com/news/18109": "p9-whmx-d18109/response.txt",
	"https://api.biligame.com/news/18426": "p9-uma-d18426/response.txt",
	"https://api.biligame.com/news/18425": "p9-uma-d18425/response.txt",
	"https://api.biligame.com/news/18424": "p9-uma-d18424/response.txt",
	"https://api.biligame.com/news/18423": "p9-uma-d18423/response.txt",
	"https://api.biligame.com/news/18376": "p9-uma-d18376/response.txt",
	[OURNOTES_GLOBAL_LIST_URL]: "p9-ournotes-global-empty/response.txt"
};
// OurNotes「非空」合成夹具（列表 + 两条详情）
const OVERRIDES_OURNOTES_NEWS = {
	[OURNOTES_GLOBAL_LIST_URL]: "p9-ournotes-global-list/response.txt",
	[ournotesGlobalDetailUrl(9001, "zh-tw")]: "p9-ournotes-global-detail-9001/response.txt",
	[ournotesGlobalDetailUrl(9002, "zh-tw")]: "p9-ournotes-global-detail-9002/response.txt"
};

// ── 夹具抓取时刻（= 抓取那一刻）当"当前时刻" ──
const SNAP_WHMX = Date.parse(meta("p9-whmx-act4/response.txt").capturedAt);
const SNAP_UMA = Date.parse(meta("p9-uma-cn-list/response.txt").capturedAt);

// ── 显式注入的 now（与系统时间无关）──
const TZ = BILIGAME_ACTIVITY_TZ;
const NOW_WHMX_SNAP = SNAP_WHMX;                                  // 2026-10-03 00:33 (UTC+8)
const NOW_WHMX_AUG = sourceInstant(2026, 8, 25, 12, 0, TZ);       // 只被 typeId=1 那路的 18265 覆盖
const NOW_LATE = sourceInstant(2026, 11, 20, 12, 0, TZ);          // 两个游戏都全部过期
const NOW_UMA_1001 = sourceInstant(2026, 10, 1, 12, 0, TZ);       // 命中 18423（且其 raw 是源站粘连原文）
const NOW_GLOBAL = sourceInstant(2026, 10, 2, 12, 0, OURNOTES_GLOBAL_TZ);

// 抓取器调用包装：失败只记 ✗（不抛，避免中断共享 runner）
async function grab(fn) {
	try { return { ok: true, data: await fn() }; }
	catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
}
function throws(fn) { try { fn(); return false; } catch { return true; } }
async function throwsAsync(fn) { try { await fn(); return false; } catch { return true; } }
const wall = (ts, tz) => {
	const w = sourceWallParts(ts, tz);
	const p = (n) => String(n).padStart(2, "0");
	return `${w.y}-${p(w.mo)}-${p(w.d)} ${p(w.h)}:${p(w.mi)}`;
};
// ── 悬停元信息守卫（用户 2026-10-03：「元信息彻底删掉」）──
//   命中任意一条 = 元信息/实现说明又漏进悬停文本了。覆盖：
//   来源站名与域名（api.biligame.com / bwiki / 官网公告）、内部 id（gameExtensionId / typeId /
//   post_id）、时区推定（推定 / 推测 / tz= / 时区）、抓取统计（共 N 篇 / 抓取）、
//   旧版的排版残留（▶ 前缀 / 「粘连」「不产出」说明）、以及任何「（…）」形式的实现说明。
//   ⚠️ 断言的是**悬停文本**，不是代码注释 —— 实现说明留在注释里是对的（用户明确要求保留）。
const HOVER_META_RE = /来源|官方公告|api\.|bwiki|gameExtensionId|typeId|post_id|推定|推测|tz\s*=|时区|共\s*\d+\s*篇|抓取|▶|粘连|不产出|[（(]/;
// 悬停行格式守卫：每条一行「名称 + **3 个空格** + `MM-DD HH:MM ~ MM-DD HH:MM`」（档期已 fmtWindow 格式化）
const HOVER_EVENT_LINE_RE = /^\S.*   \d{2}-\d{2} \d{2}:\d{2} ~ \d{2}-\d{2} \d{2}:\d{2}$/;

export default async function run() {
	useFixtures(OVERRIDES);

	//#region P9-0 注册表片段
	section("P9-0 注册表片段（3 条目 / 覆盖 B2 的 wuhuamixin+uma-cn / ournotes-global 默认未配置）");
	{
		check("SOURCES_P9 有 3 条", SOURCES_P9.length === 3, String(SOURCES_P9.length));
		check("id = [wuhuamixin, uma-cn, ournotes-global]（前两条**就地覆盖** B2 的同名条目）",
			JSON.stringify(listIdsP9()) === JSON.stringify(["wuhuamixin", "uma-cn", "ournotes-global"]), listIdsP9().join(","));
		for (const s of SOURCES_P9) {
			check(`P9 ${s.id} 声明 tz`, typeof s.tz === "string" && s.tz.length > 0, String(s.tz));
			for (const side of ["gacha", "event"]) {
				if (!s[side]) continue;
				check(`P9 ${s.id}.${side} 四要素齐备（url/fetcher/kind/mode）`,
					/^https?:\/\//.test(s[side].url) && typeof s[side].fetcher === "function"
					&& ["official-api", "official-html", "wiki", "third-party"].includes(s[side].kind)
					&& s[side].mode === "proxy",
					JSON.stringify({ url: s[side].url, kind: s[side].kind, mode: s[side].mode }));
			}
		}
		// 三条来源都不在实测 ACAO 放行的三源内 → 一律 proxy，不许声明 direct
		check("P9 全部 mode=proxy（api.biligame.com / l11-web-api.biligames.com 均无 ACAO）",
			SOURCES_P9.every((s) => ["gacha", "event"].every((k) => !s[k] || s[k].mode === "proxy")));
		// ① 物华弥新：卡池侧**原样保留 B2 的 bwiki**（动它就会丢卡池），活动侧换成官方 API
		const whmx = findSourceP9("wuhuamixin");
		check("wuhuamixin.gacha 仍是 B2 的 bwiki「限时招集档案」（kind=wiki，一行不改）",
			whmx.gacha.kind === "wiki" && whmx.gacha.url === "https://wiki.biligame.com/whmx/api.php?action=parse&page=限时招集档案&prop=text&format=json&formatversion=2"
			&& typeof whmx.gacha.fetcher === "function", JSON.stringify([whmx.gacha.kind, whmx.gacha.url]));
		check("wuhuamixin.event 换成分 biligame 官方公告（kind=official-api，typeId=4 主 URL）",
			whmx.event.kind === "official-api" && whmx.event.url === WHMX_LIST_URL, whmx.event.url);
		check("wuhuamixin.event URL 带 gameExtensionId=613 与 positionId=2（positionId 省略会返回空）",
			whmx.event.url.includes(`gameExtensionId=${WHMX_GAME_EXTENSION_ID}`) && whmx.event.url.includes("positionId=2")
			&& WHMX_GAME_EXTENSION_ID === 613);
		// ② 闪耀：官方源取代 bwiki 推算表作主源；bwiki 降级为卡池备选源
		const uma = findSourceP9("uma-cn");
		check("uma-cn 卡池+活动两侧都是官方 API（gameExtensionId=1006）",
			uma.gacha.kind === "official-api" && uma.event.kind === "official-api"
			&& uma.gacha.url === UMA_CN_LIST_URL && uma.event.url === UMA_CN_LIST_URL
			&& UMA_CN_LIST_URL.includes(`gameExtensionId=${UMA_CN_GAME_EXTENSION_ID}`) && UMA_CN_GAME_EXTENSION_ID === 1006,
			JSON.stringify([uma.gacha.url, uma.event.url]));
		check("uma-cn 保留 B2 的 bwiki「简中卡池」为**卡池备选源**（含「非官方」提示）",
			Array.isArray(uma.altSources) && uma.altSources.length === 1
			&& uma.altSources[0].fetcher === "uma-cn-bwiki"
			&& /非官方/.test(uma.altSources[0].label)
			&& uma.altSources[0].url === "https://wiki.biligame.com/umamusume/api.php?action=parse&page=简中卡池&prop=text&format=json&formatversion=2",
			JSON.stringify(uma.altSources));
		check("uma-cn 无事件备选源（官方 feed 已覆盖两侧）", !uma.eventAltSources);
		// ③ OurNotes 国际服：**默认未配置**（照米游社「崩坏3」形态：只挂备选源、不给 url/eventUrl）
		const on = findSourceP9("ournotes-global");
		check("ournotes-global **没有** url / eventUrl（= 默认未配置；50-refresh 会 skipped，UI 显示「未配置」）",
			on.url === undefined && on.eventUrl === undefined, JSON.stringify([on.url, on.eventUrl]));
		check("ournotes-global 只有备选源：altSources + eventAltSources 各 1 条，都指向同一官方列表 URL",
			Array.isArray(on.altSources) && on.altSources.length === 1
			&& Array.isArray(on.eventAltSources) && on.eventAltSources.length === 1
			&& on.altSources[0].url === OURNOTES_GLOBAL_LIST_URL && on.eventAltSources[0].url === OURNOTES_GLOBAL_LIST_URL
			&& on.altSources[0].fetcher === "ournotes-global-gacha" && on.eventAltSources[0].fetcher === "ournotes-global-event",
			JSON.stringify([on.altSources, on.eventAltSources]));
		check("ournotes-global 备选源 URL 与解析器常量逐字一致（altSourceId(alt)=alt.url，差一字符就命中不到）",
			on.altSources[0].url === ournotesGlobalListUrl("zh-tw")
			&& on.altSources[0].url.includes(`game_base_id=${OURNOTES_GLOBAL_GAME_BASE_ID}`)
			&& on.altSources[0].url.includes("lang=zh-tw"));
		// 备选源抓取器登记：本文件导出两张表（registry-extras.js 属别批次文件，Lead 合并）
		check("EXTRA_GACHA_FETCHERS_P9 登记了 uma-cn-bwiki / ournotes-global-gacha",
			typeof EXTRA_GACHA_FETCHERS_P9["uma-cn-bwiki"] === "function"
			&& typeof EXTRA_GACHA_FETCHERS_P9["ournotes-global-gacha"] === "function",
			Object.keys(EXTRA_GACHA_FETCHERS_P9).join(","));
		check("EXTRA_EVENT_FETCHERS_P9['ournotes-global'] 登记了 ournotes-global-event",
			!!EXTRA_EVENT_FETCHERS_P9["ournotes-global"] && typeof EXTRA_EVENT_FETCHERS_P9["ournotes-global"]["ournotes-global-event"] === "function",
			JSON.stringify(Object.keys(EXTRA_EVENT_FETCHERS_P9)));
		check("EXTRA_GACHA_FETCHERS_P9['uma-cn-bwiki'] 就是 bwiki.js 的 gachaUmaCn（备选源不另造一份实现）",
			EXTRA_GACHA_FETCHERS_P9["uma-cn-bwiki"] === gachaUmaCn && typeof gachaUmaCn === "function");
		// tz：三条都是 Asia/Shanghai（物华/闪耀官方正文未标 tz，推定；国际服按任务书指定，**不是** Asia/Tokyo）
		check("tz 取值：wuhuamixin/uma-cn/ournotes-global 都是 Asia/Shanghai",
			SOURCES_P9.every((s) => s.tz === "Asia/Shanghai"), SOURCES_P9.map((s) => s.tz).join(","));
		check("ournotes-global 的 tz **不是** Asia/Tokyo（国际服含港澳台）",
			on.tz === OURNOTES_GLOBAL_TZ && on.tz !== "Asia/Tokyo", String(on.tz));
		const TZ_OK = (t) => t === "UTC" || /^[A-Za-z]+\/[A-Za-z_]+$/.test(t) || /^[+-]?\d+$/.test(t);
		check("tz 通过 test/all.mjs 的 TZ_OK 守卫", SOURCES_P9.every((s) => TZ_OK(s.tz)), SOURCES_P9.map((s) => s.tz).join(","));
		// test/map.json（多人共写；本批只**追加**）必须收录本批 URL
		const map = JSON.parse(readFileSync(new URL("./map.json", import.meta.url), "utf8"));
		const WANT = {
			[WHMX_LIST_URLS[0]]: "p9-whmx-act4/response.txt",
			[WHMX_LIST_URLS[1]]: "p9-whmx-act1/response.txt",
			[UMA_CN_LIST_URL]: "p9-uma-cn-list/response.txt",
			"https://api.biligame.com/news/18419": "p9-whmx-d18419/response.txt",
			"https://api.biligame.com/news/18423": "p9-uma-d18423/response.txt",
			[OURNOTES_GLOBAL_LIST_URL]: "p9-ournotes-global-empty/response.txt",
			[ournotesGlobalDetailUrl(9001, "zh-tw")]: "p9-ournotes-global-detail-9001/response.txt"
		};
		for (const url of Object.keys(WANT)) check(`map.json 收录 ${url.slice(0, 78)}…`, map[url] === WANT[url], JSON.stringify(map[url]));
	}
	//#endregion

	//#region P9-1 物华弥新：两路 typeId 合并去重
	section("P9-1 物华弥新 —— 官方列表**两路 typeId（4+1）**合并去重（夹具快照：36 + 17 = 53）");
	const act4 = fixtureJson("p9-whmx-act4/response.txt");
	const act1 = fixtureJson("p9-whmx-act1/response.txt");
	let merged = null;
	{
		check("两路列表顶层 = { request_id, data, totalNum, pageNo, code, ts }",
			JSON.stringify(Object.keys(act4)) === JSON.stringify(["request_id", "data", "totalNum", "pageNo", "code", "ts"]),
			JSON.stringify(Object.keys(act4)));
		check("typeId=4（活动专类）totalNum=36 / typeId=1（公告）totalNum=17（任务书实测值）",
			act4.code === 0 && act4.totalNum === 36 && act4.data.length === 36
			&& act1.code === 0 && act1.totalNum === 17 && act1.data.length === 17,
			JSON.stringify([act4.totalNum, act1.totalNum]));
		check("条目字段 = content(截断) / ctime / mtime / id / title / typeId / createTime / modifyTime / displayTime?",
			JSON.stringify(Object.keys(act4.data[0])) === JSON.stringify(["content", "ctime", "mtime", "id", "title", "typeId", "createTime", "modifyTime", "displayTime"]),
			JSON.stringify(Object.keys(act4.data[0])));
		// ⚠️ 核心：两路 id 集合**零重叠**（缺一路就丢档期）
		const ids4 = new Set(act4.data.map((x) => x.id));
		const ids1 = new Set(act1.data.map((x) => x.id));
		check("两路 id 零重叠（36 ∩ 17 = ∅）—— 所以两路都必须拉",
			[...ids4].every((i) => !ids1.has(i)), String([...ids4].filter((i) => ids1.has(i)).length));
		check("18334「无稽妄语」**只在 typeId=1**（typeId=4 里没有，任务书原文）", ids1.has(18334) && !ids4.has(18334));
		check("18419「经以山海」只在 typeId=4 那路", ids4.has(18419) && !ids1.has(18419));
		check("18265「寂夜长生」只在 typeId=1 那路（P9-3 用它证明两路真的都抓了）", ids1.has(18265) && !ids4.has(18265));

		merged = mergeBiligameLists([parseBiligameList(act4), parseBiligameList(act1)]);
		check("合并去重后 53 条", merged.length === 53, String(merged.length));
		check("合并后严格倒序（sortKey 单调不增）", merged.every((x, i) => i === 0 || merged[i - 1].sortKey >= x.sortKey));
		check("合并后前 6 条 = 18419 / 18334 / 18265 / 18194 / 18109 / 18047（两路交替，夹具详情已覆盖前 5 条）",
			JSON.stringify(merged.slice(0, 6).map((x) => x.id)) === JSON.stringify([18419, 18334, 18265, 18194, 18109, 18047]),
			JSON.stringify(merged.slice(0, 6).map((x) => x.id)));
		check("合并首条 = 18419「经以山海」限时活动开启 / displayTime=2026-09-30 10:00:00",
			merged[0].id === 18419 && merged[0].title === "「经以山海」限时活动开启" && merged[0].displayTime === "2026-09-30 10:00:00",
			JSON.stringify([merged[0].id, merged[0].title]));
		// 缺 displayTime 的条目排序键必须退到 ctime（实测：typeId=4 有 7 条、typeId=1 有 9 条没有 displayTime）
		check("缺 displayTime 的条数：typeId=4 有 7 条 / typeId=1 有 9 条 → 排序键退 ctime",
			act4.data.filter((x) => !x.displayTime).length === 7 && act1.data.filter((x) => !x.displayTime).length === 9,
			JSON.stringify([act4.data.filter((x) => !x.displayTime).length, act1.data.filter((x) => !x.displayTime).length]));
		check("14937（无 displayTime）用 ctime 当 sortKey = 2025-01-10 16:57:00",
			merged.find((x) => x.id === 14937).sortKey === "2025-01-10 16:57:00", merged.find((x) => x.id === 14937).sortKey);
		check("列表 content 是**截断**的（末尾 `...`）→ 正文必须抓详情",
			String(act4.data[0].content).trim().endsWith("..."), JSON.stringify(String(act4.data[0].content).slice(-10)));
		// 去重仍必要（万一将来两路出现同一 id）
		check("同 id 出现两次时只保留一条（合成最小列表）",
			mergeBiligameLists([[{ id: 1, sortKey: "2026-01-01 00:00:00" }], [{ id: 1, sortKey: "2026-01-01 00:00:00" }, { id: 2, sortKey: "2025-01-01 00:00:00" }]]).length === 2);
		check("结构损坏（对象/空 data/code≠0）→ 抛错",
			throws(() => parseBiligameList({})) && throws(() => parseBiligameList({ code: 0 })) && throws(() => parseBiligameList({ code: 1, data: [] })));
		// URL 派生：只改 typeId，其余参数原样（保证夹具整串命中）
		check("siblingListUrl 只换 typeId（其余参数与顺序不变）",
			siblingListUrl(WHMX_LIST_URLS[0], 1) === WHMX_LIST_URLS[1] && siblingListUrl(WHMX_LIST_URLS[1], 4) === WHMX_LIST_URLS[0],
			siblingListUrl(WHMX_LIST_URLS[0], 1));
		check("whmxListUrls(主 URL) = [typeId=4, typeId=1] 两条；重复调用结果稳定",
			JSON.stringify(whmxListUrls(WHMX_LIST_URL)) === JSON.stringify(WHMX_LIST_URLS)
			&& JSON.stringify(whmxListUrls(WHMX_LIST_URLS[1])) === JSON.stringify([WHMX_LIST_URLS[1], WHMX_LIST_URLS[0]]),
			JSON.stringify(whmxListUrls(WHMX_LIST_URL)));
		check("biligameListUrl / biligameDetailUrl 拼接正确",
			biligameListUrl(613, 4) === WHMX_LIST_URLS[0] && biligameListUrl(1006, 1) === UMA_CN_LIST_URL
			&& biligameDetailUrl(WHMX_LIST_URL, 18419) === "https://api.biligame.com/news/18419");
	}
	//#endregion

	//#region P9-2 物华弥新：详情正文档期抽取
	section("P9-2 物华弥新 —— 详情正文档期抽取（**无年份**的 `M月D日 HH:MM ~ M月D日 HH:MM`）");
	const det19 = fixtureJson("p9-whmx-d18419/response.txt");
	const content19 = String(det19.data.content);
	const hint19 = sourceWallParts(merged.find((x) => x.id === 18419).dateTs, TZ);
	let parsed19 = null;
	{
		check("详情 data.site=物华弥新 / gameExtensionId=613（扩展 id 的第二重独立印证）",
			det19.data.site === "物华弥新" && det19.data.gameExtensionId === 613,
			JSON.stringify([det19.data.site, det19.data.gameExtensionId]));
		check("详情带完整 HTML 正文（22,946 字 = 128 个 <p> / 0 个 <br>）",
			content19.length === 22946 && (content19.match(/<p/g) || []).length === 128 && (content19.match(/<br\s*\/?>/gi) || []).length === 0,
			JSON.stringify([content19.length, (content19.match(/<p/g) || []).length, (content19.match(/<br\s*\/?>/gi) || []).length]));
		check("按 </p> 切段 → 105 段（textOf 的行会把多段粘一起，不能用）",
			biligameParagraphs(content19).length === 105, String(biligameParagraphs(content19).length));
		check("标题占位引号里的活动名 = 经以山海（quotedName 用它锁定主线活动小节）",
			quotedName(det19.data.title) === "经以山海", quotedName(det19.data.title));
		check("yearHint 来自该公告 displayTime（2026-09-30 10:00:00）→ {y:2026,mo:9,d:30}",
			hint19.y === 2026 && hint19.mo === 9 && hint19.d === 30, JSON.stringify(hint19));

		parsed19 = parseWhmxActivity(content19, TZ, hint19);
		check("抽出 12 条档期（卡池 4 / 活动 8）+ 2 条跳过",
			parsed19.items.length === 12 && parsed19.items.filter((x) => x.kind === "gacha").length === 4
			&& parsed19.items.filter((x) => x.kind === "event").length === 8 && parsed19.skipped.length === 2,
			JSON.stringify([parsed19.items.length, parsed19.items.filter((x) => x.kind === "gacha").length, parsed19.skipped.length]));
		check("小节标题去掉序号（`一、旅程将启-经以山海` → 旅程将启-经以山海）",
			parsed19.items[0].section === "旅程将启-经以山海", parsed19.items[0].section);
		check("`限时招集`/`定向招集` 小节归卡池侧（六/七/八/九），其余归活动侧",
			parsed19.items.filter((x) => x.kind === "gacha").every((x) => /招集/.test(x.section))
			&& parsed19.items.filter((x) => x.kind === "event").every((x) => !/招集/.test(x.section)),
			JSON.stringify(parsed19.items.filter((x) => x.kind === "gacha").map((x) => x.section)));

		const main = parsed19.items.find((x) => x.section === "经以山海");
		check("主线活动小节「四、经以山海」= 9月30日 10:00 ~ 10月22日 09:59（源站**不带年份**）",
			!!main && main.raw === "9月30日 10:00 ~ 10月22日 09:59", JSON.stringify(main && main.raw));
		check("年份由公告 displayTime 补全 → 绝对时刻 = 2026-09-30T02:00Z（= 1790733600000）",
			!!main && main.startTs === sourceInstant(2026, 9, 30, 10, 0, TZ)
			&& main.startTs === 1790733600000 && new Date(main.startTs).toISOString() === "2026-09-30T02:00:00.000Z",
			JSON.stringify(main && [main.startTs, new Date(main.startTs).toISOString()]));
		check("bannerDates 文本按源站墙钟渲染 = 09-30 10:00 ~ 10-22 09:59（tz=Asia/Shanghai）",
			!!main && fmtWindow(main.startTs, main.endTs, TZ) === "09-30 10:00 ~ 10-22 09:59", main && fmtWindow(main.startTs, main.endTs, TZ));
		check("反证：同一墙钟若误用 UTC+9 会得到**更早** 1 小时的时刻（证明确实按 tz=Asia/Shanghai 换算）",
			!!main && main.startTs - sourceInstant(2026, 9, 30, 10, 0, "+540") === 3600000,
			String(main && main.startTs - sourceInstant(2026, 9, 30, 10, 0, "+540")));

		// 「常驻」= 无终点 → 不产出（如实记 skipped）
		check("2 条 `活动时间：… ~ 常驻` 不产出，如实记入 skipped.reason=perm",
			parsed19.skipped.length === 2 && parsed19.skipped.every((x) => x.reason === "perm" && x.raw === "9月30日 10:00 ~ 常驻"),
			JSON.stringify(parsed19.skipped.map((x) => [x.reason, x.section, x.raw])));
		check("产出的档期里没有一条终点是「常驻」", parsed19.items.every((x) => !/常驻/.test(x.raw)));

		// 没有公告年份 → 源站的「月日」档期一个都产不出（绝不硬凑年份）
		//   （注：年份判定在「常驻」之前 → 此时 2 条「常驻」也一并计入 no-year，共 14 条）
		const noHint = parseWhmxActivity(content19, TZ, null);
		check("不给 yearHint（源站又不写年份）→ 12 条档期全部落入 skipped.reason=no-year，items=0",
			noHint.items.length === 0 && noHint.skipped.length === 14 && noHint.skipped.every((x) => x.reason === "no-year"),
			JSON.stringify([noHint.items.length, noHint.skipped.length, [...new Set(noHint.skipped.map((x) => x.reason))]]));
		check("换了 yearHint（2025-03-01）→ 同一条档期年份随之变成 2025（年份确实来自公告）",
			(() => {
				const r = parseWhmxActivity(content19, TZ, { y: 2025, mo: 3, d: 1 });
				const m = r.items.find((x) => x.section === "经以山海");
				return !!m && new Date(m.startTs).getUTCFullYear() === 2025;
			})());
		check("跨年推断：起月比发布月大 6 个月以上 → 视为上一年（yearHint 2026-01 → 起点月 2025-12）",
			(() => {
				const w = extractWindowsDetailed("活动时间：12月20日 10:00 ~ 1月5日 09:59", { y: 2026, mo: 1, d: 3 }, TZ).windows[0];
				return !!w && new Date(w.startTs).toISOString() === "2025-12-20T02:00:00.000Z"
					&& new Date(w.endTs).toISOString() === "2026-01-05T01:59:00.000Z";
			})(),
			JSON.stringify(extractWindowsDetailed("活动时间：12月20日 10:00 ~ 1月5日 09:59", { y: 2026, mo: 1, d: 3 }, TZ).windows));
		check("带**年份**的写法也能解（任务书给的那种 `2026/09/30 10:00 - 2026/10/14 03:59`）",
			(() => {
				const w = extractWindowsDetailed("活动时间：2026/09/30 10:00 - 2026/10/14 03:59", null, TZ).windows[0];
				return !!w && w.raw === "2026/09/30 10:00 - 2026/10/14 03:59"
					&& w.startTs === sourceInstant(2026, 9, 30, 10, 0, TZ) && w.endTs === sourceInstant(2026, 10, 14, 3, 59, TZ);
			})());
		check("无日期文本 → 不产出任何窗口", extractWindowsDetailed("这段文字没有任何日期", { y: 2026, mo: 1, d: 1 }, TZ).windows.length === 0);

		// 外显挑选：标题引号里的活动名优先（否则会取到最早结束的「登录活动」）
		const quoted = quotedName(det19.data.title);
		check("pickWhmxEvent(now=夹具时刻) 取到主线「经以山海」（而不是最早结束的「旅程将启-经以山海」）",
			(pickWhmxEvent(parsed19.items, NOW_WHMX_SNAP, quoted) || {}).section === "经以山海",
			JSON.stringify((pickWhmxEvent(parsed19.items, NOW_WHMX_SNAP, quoted) || {}).section));
		check("不给 preferName 时会退化成「结束最早」（证明 preferName 真的在起作用）",
			(pickWhmxEvent(parsed19.items, NOW_WHMX_SNAP, "") || {}).section === "旅程将启-经以山海",
			JSON.stringify((pickWhmxEvent(parsed19.items, NOW_WHMX_SNAP, "") || {}).section));
		check("now=2026-11-20（全部过期）→ pickWhmxEvent = null", pickWhmxEvent(parsed19.items, NOW_LATE, quoted) === null);
		check("old 详情 d18334：8 条（卡池 3 / 活动 5），主线小节「无稽妄语」= 9月10日 10:00 ~ 9月30日 09:59",
			(() => {
				const d = fixtureJson("p9-whmx-d18334/response.txt").data;
				const p = parseWhmxActivity(d.content, TZ, { y: 2026, mo: 9, d: 10 });
				const m = p.items.find((x) => x.section === "无稽妄语");
				return d.content.length === 11833 && p.items.length === 8 && p.items.filter((x) => x.kind === "gacha").length === 3
					&& !!m && m.raw === "9月10日 10:00 ~ 9月30日 09:59";
			})());
	}
	//#endregion

	//#region P9-3 物华弥新 抓取器
	section("P9-3 物华弥新 活动侧抓取器（离线夹具；now 是**第 4 个参数**）");
	{
		const src = findSourceP9("wuhuamixin");
		// ✅ 抗历史 bug：now 传第 4 位；若实现把 now 当第 3 位（tz），这里会得到 null / 异常
		const r = await grab(() => src.event.fetcher(src.event.url, undefined, src.tz, NOW_WHMX_SNAP));
		check("event 抓取成功（now 传第 4 参）", r.ok, r.err);
		assertContract("物华弥新（活动）", "event", r.ok ? r.data : null);
		check("event = 「经以山海」限时活动 / 09-30 10:00 ~ 10-22 09:59",
			r.ok && r.data && r.data.event === "「经以山海」限时活动" && r.data.eventDates === "09-30 10:00 ~ 10-22 09:59",
			JSON.stringify(r.ok && r.data && [r.data.event, r.data.eventDates]));
		check("eventDatesRaw 保留源站原文（不带年份）= `9月30日 10:00 ~ 10月22日 09:59`",
			r.ok && r.data && r.data.eventDatesRaw === "9月30日 10:00 ~ 10月22日 09:59",
			JSON.stringify(r.ok && r.data && r.data.eventDatesRaw));
		// ── 悬停（方案 A）：只放「名称 + 3 空格 + 档期」；元信息**彻底不进悬停** ──
		const HV = (r.ok && r.data && r.data.eventHover) || "";
		const HV_LINES = HV.split("\n");
		check("hover 逐行「名称 + 3 空格 + 档期」：7 条（18419 公告里覆盖 10-03 的全部活动档期，按结束时间升序）",
			HV_LINES.length === 7 && HV_LINES.every((l) => HOVER_EVENT_LINE_RE.test(l)),
			JSON.stringify(HV_LINES));
		check("hover 行首是**名称**而不是日期（旧版「档期在前」+「▶ 前缀」已修掉）",
			/^旅程将启-经以山海   /.test(HV) && !/^\d{2}-\d{2}/.test(HV) && !/▶/.test(HV),
			JSON.stringify(HV_LINES.slice(0, 3)));
		check("hover 里能看到外显那条的**活动名**（pickWhmxEvent 选中的「经以山海」是其中一行的行首）",
			HV_LINES.some((l) => l.startsWith("经以山海   ")), JSON.stringify(HV_LINES));
		check("hover **不再含任何元信息**（来源站/URL/API 名/gameExtensionId/typeId/游戏名+区服前缀/tz 推定/抓取条数/内部 id/▶/「（…）」说明）",
			!HOVER_META_RE.test(HV) && !/物华弥新/.test(HV), JSON.stringify(HV_LINES));
		check("hover 不再写「常驻档期为何不产出」这类实现说明（只留在代码注释与 skipped[].reason 里）",
			!/常驻|不产出|另有/.test(HV), JSON.stringify(HV_LINES));
		check("hover 不含 tz 推定说明（源站未标时区这件事只写在文件头交叉印证里）",
			!/推定|Asia\/Shanghai|UTC\+8/.test(HV));
		// 守卫：<2 条 → 工具返回 ""，调用方据此**不设** eventHover（交回 UI 默认两行式）
		check("单条当期活动 → whmxEventHover 返回空串（调用方因此不设 eventHover，UI 走默认两行式）",
			whmxEventHover([], TZ) === ""
			&& whmxEventHover([parsed19.items.find((x) => x.section === "经以山海")], TZ) === "");

		// ⭐ 两路都拉的**行为级**证据：18265「寂夜长生」只在 typeId=1 那路，而它覆盖 2026-08-25
		const rAug = await grab(() => src.event.fetcher(src.event.url, undefined, src.tz, NOW_WHMX_AUG));
		check("now=2026-08-25 → 命中 18265「寂夜长生」（该 id **只在 typeId=1** 那路 → 证明两路都抓了）",
			rAug.ok && rAug.data && rAug.data.event === "「寂夜长生」限时活动" && rAug.data.eventDates === "08-20 10:00 ~ 09-10 09:59",
			JSON.stringify(rAug.ok ? (rAug.data && [rAug.data.event, rAug.data.eventDates]) : rAug.err));
		const HVA = (rAug.ok && rAug.data && rAug.data.eventHover) || "";
		check("同一规则在另一条公告上复现：5 条、首行 = `旅程将启-寂夜长生   …`、无元信息",
			rAug.ok && rAug.data && HVA.split("\n").length === 5
			&& /^旅程将启-寂夜长生   /.test(HVA)
			&& HVA.split("\n").every((l) => HOVER_EVENT_LINE_RE.test(l) && !HOVER_META_RE.test(l)),
			JSON.stringify(HVA.split("\n")));

		// 任务硬要求：覆盖 now 的档期一条都没有 → **如实返回 null**（不硬凑过期档期）
		const rNull = await grab(() => src.event.fetcher(src.event.url, undefined, src.tz, NOW_LATE));
		check("now=2026-11-20（两个游戏全部档期已过期）→ 返回 null（未公布）",
			rNull.ok && rNull.data === null, JSON.stringify(rNull.ok ? rNull.data : rNull.err));
		check("null 通过契约守卫（= 未公布，合法）", assertContract("物华弥新（过期）", "event", rNull.data) === true);

		// 结构性损坏/网络失败 → 抛错（不能把"源站挂了"静默降级成"未公布"）
		check("列表请求失败 → 抛错（不静默降级成 null）",
			await throwsAsync(() => eventsWhmxOfficial("https://example.invalid/news/list", undefined, TZ, NOW_WHMX_SNAP)));
		check("导出的抓取器可直接调用（不依赖 registry 包装）",
			(await grab(() => eventsWhmxOfficial(WHMX_LIST_URL, undefined, TZ, NOW_WHMX_SNAP))).ok);
		// 只有一路 feed 可用时：仍能出数据（另一路失败不致命），但没有覆盖 now 的档期时**不谎称未公布**
		check("两路 feed 都失败 → 抛错（不返回 null）",
			await throwsAsync(() => eventsWhmxOfficial("https://example.invalid/news/list", undefined, TZ, NOW_LATE)));
	}
	//#endregion

	//#region P9-4 闪耀优俊少女：标题分流 + 正文档期
	section("P9-4 闪耀优俊少女 —— 单一 feed 标题分流（招募/扭蛋/必得 vs 活动/赛事/剧情/举办）");
	const umaRaw = fixtureJson("p9-uma-cn-list/response.txt");
	{
		check("列表顶层 totalNum=671 / 一页 50 条（typeId=1 混排卡池与活动）",
			umaRaw.code === 0 && umaRaw.totalNum === 671 && umaRaw.data.length === 50,
			JSON.stringify([umaRaw.totalNum, umaRaw.data.length]));
		check("首条 = 18426「养成优俊少女&协助卡新登场！精选招募开放！」displayTime=2026-10-02 12:00:00",
			umaRaw.data[0].id === 18426 && umaRaw.data[0].displayTime === "2026-10-02 12:00:00",
			JSON.stringify([umaRaw.data[0].id, umaRaw.data[0].displayTime]));
		const list = parseBiligameList(umaRaw);
		check("parseBiligameList → 50 条且严格倒序（第 2 条 18425 与第 1 条同刻）",
			list.length === 50 && list[0].id === 18426 && list[1].id === 18425 && list.every((x, i) => i === 0 || list[i - 1].sortKey >= x.sortKey),
			JSON.stringify(list.slice(0, 3).map((x) => [x.id, x.sortKey])));
		// 分流计数：实测这一页 gacha 22 / event 25 / 都不含 3
		const kinds = list.map((x) => classifyUmaCnTitle(x.title));
		check("标题分流：卡池 22 / 活动 25 / 都不含 3（都不含的**跳过**，不抓详情）",
			kinds.filter((k) => k === "gacha").length === 22 && kinds.filter((k) => k === "event").length === 25
			&& kinds.filter((k) => k === null).length === 3,
			JSON.stringify([kinds.filter((k) => k === "gacha").length, kinds.filter((k) => k === "event").length, kinds.filter((k) => k === null).length]));
		check("三条「都不含」= 18390 部分养成优俊少女追加进化技能 / 18359 优俊歌曲点唱机 / 18303 养成剧本逐星之旅",
			JSON.stringify(list.filter((x) => classifyUmaCnTitle(x.title) === null).map((x) => x.id)) === JSON.stringify([18390, 18359, 18303]),
			JSON.stringify(list.filter((x) => classifyUmaCnTitle(x.title) === null).map((x) => x.id)));
		check("卡池关键词命中：招募/扭蛋/必得（照任务书口径，先判卡池）",
			classifyUmaCnTitle("养成优俊少女&协助卡新登场！精选招募开放！") === "gacha"
			&& classifyUmaCnTitle("自定义精选 协助卡招募开放！") === "gacha"
			&& classifyUmaCnTitle("“3★必得”“超稀有必得”动画第三季纪念招募 第1期开放！") === "gacha"
			&& classifyUmaCnTitle("最多100次免费招募！“每日1次免费十连招募活动”开放！") === "gacha");
		check("活动关键词命中：活动/赛事/剧情/举办",
			classifyUmaCnTitle("活动“爱丽速子的因子研究”开放！") === "event"
			&& classifyUmaCnTitle("赛事活动“群英联赛 中距离”举办！") === "event"
			&& classifyUmaCnTitle("剧情活动“将离别缀合成诗”举办中！") === "event"
			&& classifyUmaCnTitle("传奇赛事开放！") === "event"
			&& classifyUmaCnTitle("“2.5周年庆典活动第3弹”举办！") === "event");
		check("都不含 → null（不硬分流）",
			classifyUmaCnTitle("养成剧本“逐星之旅 凯旋门计划”开放！") === null
			&& classifyUmaCnTitle("优俊歌曲点唱机追加歌单＆歌曲！") === null
			&& classifyUmaCnTitle("") === null);

		// 正文：标签与前一段/同段共存；⚠️ 18423 的 `10/711:59` 是源站笔误
		const d18426 = parseUmaCnAnnouncement(fixtureJson("p9-uma-d18426/response.txt").data.content, TZ, { y: 2026, mo: 10, d: 2 });
		check("d18426 抽 2 条窗口，标签取自**上一段**（精选招募开放期间 / 角色剧情开放期间）",
			d18426.items.length === 2 && JSON.stringify(d18426.items.map((x) => x.label)) === JSON.stringify(["精选招募开放期间", "角色剧情开放期间"]),
			JSON.stringify(d18426.items.map((x) => x.label)));
		check("d18426 两条窗口都是 10/2 12:00 ～ 10/13 11:59",
			d18426.items.every((x) => x.raw === "10/2 12:00 ～ 10/13 11:59"), JSON.stringify(d18426.items.map((x) => x.raw)));
		check("UP 角色提取（可选字段）= 目白拉莫娜（`★★★ [墨瑙魅线]目白拉莫娜`）",
			JSON.stringify(umaRoles(biligameParagraphs(fixtureJson("p9-uma-d18426/response.txt").data.content))) === JSON.stringify(["目白拉莫娜"]),
			JSON.stringify(umaRoles(biligameParagraphs(fixtureJson("p9-uma-d18426/response.txt").data.content))));
		check("d18426 是**独立**窗口段（标签与窗口不同段）→ 验证了 prevLabel 分支",
			d18426.items[0].label !== d18426.items[0].raw);

		const d18425 = parseUmaCnAnnouncement(fixtureJson("p9-uma-d18425/response.txt").data.content, TZ, { y: 2026, mo: 10, d: 2 });
		check("d18425 抽 2 条窗口：活动期间 10/2~10/13 + 奖励领取·因子强化期间 10/13~10/16",
			d18425.items.length === 2 && JSON.stringify(d18425.items.map((x) => x.label)) === JSON.stringify(["活动期间", "奖励领取·因子强化期间"])
			&& d18425.items[1].raw === "10/13 12:00 ～ 10/16 11:59",
			JSON.stringify(d18425.items.map((x) => [x.label, x.raw])));
		check("活动侧外显优先「活动期间」（而非「奖励领取·因子强化期间」）",
			(pickUmaWindow(d18425.items, SNAP_UMA, "event") || {}).label === "活动期间",
			JSON.stringify((pickUmaWindow(d18425.items, SNAP_UMA, "event") || {}).label));
		check("now=2026-10-01 12:00（活动期间还没开始 10/2 12:00）→ d18425 无窗口覆盖 → null",
			pickUmaWindow(d18425.items, NOW_UMA_1001, "event") === null,
			JSON.stringify(pickUmaWindow(d18425.items, NOW_UMA_1001, "event")));

		const d18423 = parseUmaCnAnnouncement(fixtureJson("p9-uma-d18423/response.txt").data.content, TZ, { y: 2026, mo: 10, d: 1 });
		check("d18423（赛事活动）抽 7 条窗口（活动期间/报名/第1轮/第2轮/决赛轮×3）",
			d18423.items.length === 7, String(d18423.items.length));
		// ⚠️ 实测源站笔误：`10/711:59`（日期与时刻粘连）
		const glued = d18423.items[0];
		check("⚠️ 源站笔误 `10/711:59`：raw 保留**原文**，rawNorm 记为 10/7 11:59，glued=true",
			glued.raw === "10/1 12:00 ～ 10/711:59" && glued.rawNorm === "10/1 12:00 ～ 10/7 11:59" && glued.glued === true,
			JSON.stringify([glued.raw, glued.rawNorm, glued.glued]));
		check("粘连解析后的墙钟 = 10-01 12:00 ~ 10-07 11:59（Asia/Shanghai）",
			fmtWindow(glued.startTs, glued.endTs, TZ) === "10-01 12:00 ~ 10-07 11:59", fmtWindow(glued.startTs, glued.endTs, TZ));
		check("deglueDateTimes 单测：`10/711:59` → `10/7 11:59`；正常写法**不动**",
			deglueDateTimes("活动期间 10/1 12:00 ～ 10/711:59") === "活动期间 10/1 12:00 ～ 10/7 11:59"
			&& deglueDateTimes("9月30日 10:00 ~ 10月22日 09:59") === "9月30日 10:00 ~ 10月22日 09:59"
			&& deglueDateTimes("10/6 0:00 ～ 10/6 11:59") === "10/6 0:00 ～ 10/6 11:59"
			&& deglueDateTimes("10/2 12:00 ～ 10/13 11:59") === "10/2 12:00 ～ 10/13 11:59");
		check("d18423 只有 1 条窗口是粘连的（其余 6 条原样）",
			d18423.items.filter((x) => x.glued).length === 1, String(d18423.items.filter((x) => x.glued).length));
		check("同段标签也认（`活动期间 10/1 12:00 ～ …` → 标签 = 活动期间）", glued.label === "活动期间", glued.label);
		check("决赛轮各细分期间也抽到（参赛登记 / 匹配 / 赛事举办）",
			["决赛轮：参赛登记期间", "决赛轮：匹配期间", "决赛轮：赛事举办期间"].every((l) => d18423.items.some((x) => x.label === l)),
			JSON.stringify(d18423.items.map((x) => x.label)));
		check("活动侧外显优先「活动期间」（不是「第1轮」/「联赛报名期间」）",
			(pickUmaWindow(d18423.items, NOW_UMA_1001, "event") || {}).label === "活动期间",
			JSON.stringify((pickUmaWindow(d18423.items, NOW_UMA_1001, "event") || {}).label));
		check("卡池侧外显优先标签含「招募」的窗口（d18426 → 精选招募开放期间）",
			(pickUmaWindow(d18426.items, SNAP_UMA, "gacha") || {}).label === "精选招募开放期间",
			JSON.stringify((pickUmaWindow(d18426.items, SNAP_UMA, "gacha") || {}).label));

		// 无年份 + 无公告年份 → 一个窗口都不产出
		const noHint = parseUmaCnAnnouncement(fixtureJson("p9-uma-d18426/response.txt").data.content, TZ, null);
		check("不给 yearHint → d18426 的 2 条窗口全落入 no-year，items=0（绝不硬凑年份）",
			noHint.items.length === 0 && noHint.skipped.filter((x) => x.reason === "no-year").length === 2,
			JSON.stringify([noHint.items.length, noHint.skipped.length]));
		check("无档期正文 → items=0（不硬造）",
			parseUmaCnAnnouncement("<p>这段公告没有任何档期。</p>", TZ, { y: 2026, mo: 10, d: 1 }).items.length === 0);
		check("cleanTitle：去掉尾部动作尾巴但保留名字",
			cleanTitle("活动“爱丽速子的因子研究”开放！") === "活动“爱丽速子的因子研究”"
			&& cleanTitle("赛事活动“群英联赛 中距离”举办！") === "赛事活动“群英联赛 中距离”"
			&& cleanTitle("养成优俊少女&协助卡新登场！精选招募开放！") === "养成优俊少女&协助卡新登场！精选招募",
			JSON.stringify(cleanTitle("养成优俊少女&协助卡新登场！精选招募开放！")));
		check("parseCmsStamp 单测：`2026-10-02 12:00:00` → Asia/Shanghai 墙钟；垃圾串 → null",
			parseCmsStamp("2026-10-02 12:00:00", TZ) === sourceInstant(2026, 10, 2, 12, 0, TZ) && parseCmsStamp("nope", TZ) === null);
	}
	//#endregion

	//#region P9-5 闪耀优俊少女 抓取器
	section("P9-5 闪耀优俊少女 卡片/活动抓取器（离线夹具；now 是**第 4 个参数**）");
	{
		const src = findSourceP9("uma-cn");
		const rg = await grab(() => src.gacha.fetcher(src.gacha.url, undefined, src.tz, SNAP_UMA));
		check("gacha 抓取成功（now 传第 4 参）", rg.ok, rg.err);
		assertContract("闪耀优俊少女", "gacha", rg.ok ? rg.data : null);
		check("gacha banner = 养成优俊少女&协助卡新登场！精选招募（标题去掉「开放！」尾巴）",
			rg.ok && rg.data && rg.data.banner === "养成优俊少女&协助卡新登场！精选招募", JSON.stringify(rg.ok && rg.data && rg.data.banner));
		check("gacha 窗口 = 10-02 12:00 ~ 10-13 11:59 / raw 保留全角波浪原文",
			rg.ok && rg.data && rg.data.bannerDates === "10-02 12:00 ~ 10-13 11:59" && rg.data.bannerDatesRaw === "10/2 12:00 ～ 10/13 11:59",
			JSON.stringify(rg.ok && rg.data && [rg.data.bannerDates, rg.data.bannerDatesRaw]));
		check("gacha roles = 目白拉莫娜（可选字段，从 ★★★ 行抽）",
			rg.ok && rg.data && rg.data.roles === "目白拉莫娜", JSON.stringify(rg.ok && rg.data && rg.data.roles));
		// ── 卡池侧悬停（方案 A）：每池「池名：角色」⏎ 档期；窗口全同 → 档期只在末尾写一遍（交给共用 hoverPool）──
		//   18426 覆盖 10-03 的期间有 2 个（精选招募开放期间 / 角色剧情开放期间，窗口完全相同）
		//   → 列出的期间集合与旧版一致（**当期判定不变**，本次只改 hover 拼装）。
		const HVG = (rg.ok && rg.data && rg.data.bannerHover) || "";
		check("gacha hover = 2 个当期池逐行「池名：角色」，窗口全同 → 档期只在末尾写一遍（与本体 buildPoolHover 同格式）",
			HVG === ["精选招募开放期间：目白拉莫娜", "角色剧情开放期间：目白拉莫娜", "10-02 12:00 ~ 10-13 11:59"].join("\n"),
			JSON.stringify(HVG.split("\n")));
		check("gacha hover **不再含**元信息（官方源/URL/gameExtensionId/typeId=1 分流说明/tz 推定/▶/游戏名+区服前缀）",
			!HOVER_META_RE.test(HVG) && !/闪耀！优俊少女/.test(HVG), JSON.stringify(HVG.split("\n")));

		const re = await grab(() => src.event.fetcher(src.event.url, undefined, src.tz, SNAP_UMA));
		check("event 抓取成功（now 传第 4 参）", re.ok, re.err);
		assertContract("闪耀优俊少女", "event", re.ok ? re.data : null);
		check("event = 活动“爱丽速子的因子研究” / 10-02 12:00 ~ 10-13 11:59（**没有**误取同刻的卡池公告）",
			re.ok && re.data && re.data.event === "活动“爱丽速子的因子研究”" && re.data.eventDates === "10-02 12:00 ~ 10-13 11:59",
			JSON.stringify(re.ok && re.data && [re.data.event, re.data.eventDates]));
		check("活动侧**跳过**卡池标题（18426 是卡池 → 事件侧继续往下抓到 18425）",
			re.ok && re.data && !/招募/.test(re.data.event), JSON.stringify(re.ok && re.data && re.data.event));
		// 18425 在 SNAP 只有 1 条期间覆盖 now（活动期间；奖励领取·因子强化期间 10/13 才开）
		check("活动侧只有 1 条当期 → **不设** eventHover（交回 UI 默认两行式「event ⏎ eventDates」）",
			re.ok && re.data && !re.data.eventHover, JSON.stringify(re.ok && re.data && re.data.eventHover));

		// 换一个 now：18425/18424 都还没开或已过 → 落到 18423（且这条的 raw 是源站粘连原文）
		const re2 = await grab(() => src.event.fetcher(src.event.url, undefined, src.tz, NOW_UMA_1001));
		check("now=2026-10-01 12:00 → event = 赛事活动“群英联赛 中距离”/ 10-01 12:00 ~ 10-07 11:59",
			re2.ok && re2.data && re2.data.event === "赛事活动“群英联赛 中距离”" && re2.data.eventDates === "10-01 12:00 ~ 10-07 11:59",
			JSON.stringify(re2.ok ? (re2.data && [re2.data.event, re2.data.eventDates]) : re2.err));
		check("eventDatesRaw 是**源站原文**（粘连未修正）= `10/1 12:00 ～ 10/711:59`",
			re2.ok && re2.data && re2.data.eventDatesRaw === "10/1 12:00 ～ 10/711:59",
			JSON.stringify(re2.ok && re2.data && re2.data.eventDatesRaw));
		// ── 活动侧悬停：3 条当期期间，逐行「期间名 + 3 空格 + 档期」，按结束时间升序 ──
		const HVE = (re2.ok && re2.data && re2.data.eventHover) || "";
		check("hover 逐行「名称 + 3 空格 + 档期」且按结束时间升序（第1轮 → 联赛报名期间 → 活动期间）",
			HVE === [
				"第1轮   10-01 12:00 ~ 10-03 11:59",
				"联赛报名期间   09-28 12:00 ~ 10-05 11:59",
				"活动期间   10-01 12:00 ~ 10-07 11:59"
			].join("\n"), JSON.stringify(HVE.split("\n")));
		check("hover 行首是**名称**而不是日期（旧版「档期在前」+「▶ 前缀」已修掉）",
			!/^\d{2}-\d{2}/.test(HVE) && !/▶/.test(HVE) && HVE.split("\n").every((l) => HOVER_EVENT_LINE_RE.test(l)),
			JSON.stringify(HVE.split("\n")));
		check("源站笔误 `10/711:59` 只影响 eventDatesRaw；hover 走 fmtWindow → `10-07 11:59`，**不含**「粘连」这类实现说明",
			/10-07 11:59/.test(HVE) && !/粘连|10\/711:59/.test(HVE) && !HOVER_META_RE.test(HVE),
			JSON.stringify(HVE.split("\n")));
		check("hover 里能看到外显那条的**期间名**（pickUmaWindow 选中的「活动期间」是其中一行的行首）",
			HVE.split("\n").some((l) => l.startsWith("活动期间   ")), JSON.stringify(HVE.split("\n")));

		// ── helper 级守卫：<2 项一律空串（调用方据此不设 hover 字段）；2 项时排版与本体同构 ──
		check("helper 对 <2 项一律返回空串 → 单条/单池时调用方**不设** hover 字段（UI 走默认两行式）",
			umaCnEventHover([], TZ) === "" && umaCnPoolHover([], TZ) === ""
			&& umaCnEventHover([{ label: "活动期间", startTs: 1, endTs: 2 }], TZ) === ""
			&& umaCnPoolHover([{ label: "开放期间", startTs: 1, endTs: 2 }], TZ, "目白拉莫娜") === "");
		check("helper 2 池排版（合成数据）：每池「池名：角色」+ 各自档期；2 条活动排版：名称 + 3 空格 + 档期",
			umaCnPoolHover([
				{ label: "精选招募开放期间", startTs: sourceInstant(2026, 10, 2, 12, 0, TZ), endTs: sourceInstant(2026, 10, 13, 11, 59, TZ) },
				{ label: "精选协助卡招募开放期间", startTs: sourceInstant(2026, 10, 2, 12, 0, TZ), endTs: sourceInstant(2026, 10, 20, 11, 59, TZ) }
			], TZ, "目白拉莫娜") === [
				"精选招募开放期间：目白拉莫娜",
				"10-02 12:00 ~ 10-13 11:59",
				"精选协助卡招募开放期间：目白拉莫娜",
				"10-02 12:00 ~ 10-20 11:59"
			].join("\n")
			&& umaCnEventHover([
				{ label: "活动期间", startTs: sourceInstant(2026, 10, 2, 12, 0, TZ), endTs: sourceInstant(2026, 10, 13, 11, 59, TZ) },
				{ label: "奖励领取期间", startTs: sourceInstant(2026, 10, 13, 12, 0, TZ), endTs: sourceInstant(2026, 10, 16, 11, 59, TZ) }
			], TZ) === [
				"活动期间   10-02 12:00 ~ 10-13 11:59",
				"奖励领取期间   10-13 12:00 ~ 10-16 11:59"
			].join("\n"));

		// 任务硬要求：无覆盖 → null（不硬凑）
		const rgNull = await grab(() => src.gacha.fetcher(src.gacha.url, undefined, src.tz, NOW_LATE));
		const reNull = await grab(() => src.event.fetcher(src.event.url, undefined, src.tz, NOW_LATE));
		check("now=2026-11-20（夹具覆盖的公告全部过期）→ 卡池/活动两侧都返回 null（未公布）",
			rgNull.ok && rgNull.data === null && reNull.ok && reNull.data === null,
			JSON.stringify([rgNull.ok ? rgNull.data : rgNull.err, reNull.ok ? reNull.data : reNull.err]));
		check("null 通过契约守卫（= 未公布，合法）",
			assertContract("闪耀优俊少女（过期）", "gacha", rgNull.data) === true
			&& assertContract("闪耀优俊少女（过期）", "event", reNull.data) === true);
		check("列表请求失败 → 抛错（不静默降级成 null）",
			await throwsAsync(() => gachaUmaCnOfficial("https://example.invalid/news/list", undefined, TZ, SNAP_UMA))
			&& await throwsAsync(() => eventsUmaCnOfficial("https://example.invalid/news/list", undefined, TZ, SNAP_UMA)));
	}
	//#endregion

	//#region P9-6 OurNotes 国际服（**合成夹具**）
	section("P9-6 BanG Dream！OurNotes·国际服 —— **合成夹具**（源站暂无公告，无法真抓；字段名为假设）");
	{
		const src = findSourceP9("ournotes-global");
		// ① 空响应（= Lead 唯一真抓到过的形态）→ total_count:0 → null
		const emptyRaw = fixtureJson("p9-ournotes-global-empty/response.txt");
		const emptyPage = parseOurNotesGlobalPage(emptyRaw);
		check("空响应结构 = { code:0, data:{ page_number, page_size, total_count:0, list:[] } }（Lead 实测原文）",
			emptyRaw.code === 0 && emptyRaw.data.total_count === 0 && Array.isArray(emptyRaw.data.list) && emptyRaw.data.list.length === 0
			&& emptyRaw.data.page_number === 1 && emptyRaw.data.page_size === 20,
			JSON.stringify(emptyRaw));
		check("parseOurNotesGlobalPage → totalCount=0 / items=0；isOurNotesGlobalEmpty = true",
			emptyPage.totalCount === 0 && emptyPage.items.length === 0 && isOurNotesGlobalEmpty(emptyRaw, emptyPage) === true);
		const eEmpty = await grab(() => eventsOurNotesGlobal(src.eventAltSources[0].url, undefined, src.tz, NOW_GLOBAL));
		const gEmpty = await grab(() => gachaOurNotesGlobal(src.altSources[0].url, undefined, src.tz, NOW_GLOBAL));
		check("**total_count:0 → 两侧都返回 null**（未公布；不硬凑）",
			eEmpty.ok && eEmpty.data === null && gEmpty.ok && gEmpty.data === null,
			JSON.stringify([eEmpty.ok ? eEmpty.data : eEmpty.err, gEmpty.ok ? gEmpty.data : gEmpty.err]));
		check("null 通过契约守卫", assertContract("OurNotes 国际服（空）", "event", eEmpty.data) === true
			&& assertContract("OurNotes 国际服（空）", "gacha", gEmpty.data) === true);
		check("空列表（total_count 缺失但 list 空）也判为未公布",
			isOurNotesGlobalEmpty({ code: 0, data: { list: [] } }) === true);

		// ② 非空**合成**夹具：验证解析逻辑（列表 → 详情 → 正文抽档期 → 挑覆盖 now）
		useFixtures(Object.assign({}, OVERRIDES, OVERRIDES_OURNOTES_NEWS));
		const newsRaw = fixtureJson("p9-ournotes-global-list/response.txt");
		const newsPage = parseOurNotesGlobalPage(newsRaw);
		check("非空合成夹具：total_count=2 / 按发布时间倒序 → id [9002, 9001]",
			newsPage.totalCount === 2 && JSON.stringify(newsPage.items.map((x) => x.id)) === JSON.stringify([9002, 9001]),
			JSON.stringify(newsPage.items.map((x) => [x.id, x.sortKey])));
		check("字段候选生效（title/display_time 假设字段都能取到；**时刻部分**不能被吞成 00:00）",
			newsPage.items[0].title === "【招募】精選招募開放！" && newsPage.items[0].sortKey === "2026-10-01 12:00:00"
			&& newsPage.items[0].dateTs === sourceInstant(2026, 10, 1, 12, 0, OURNOTES_GLOBAL_TZ)
			&& wall(newsPage.items[0].dateTs, OURNOTES_GLOBAL_TZ) === "2026-10-01 12:00",
			JSON.stringify([newsPage.items[0].title, newsPage.items[0].sortKey, wall(newsPage.items[0].dateTs, OURNOTES_GLOBAL_TZ)]));
		const e = await grab(() => eventsOurNotesGlobal(OURNOTES_GLOBAL_LIST_URL, undefined, OURNOTES_GLOBAL_TZ, NOW_GLOBAL));
		check("event 抓取成功（列表 → 跳过招募那条 → 详情 9001 → 正文抽档期）", e.ok, e.err);
		assertContract("OurNotes 国际服", "event", e.ok ? e.data : null);
		check("event = 【活動】夏日慶典 / 09-30 12:00 ~ 10-14 11:59（tz=Asia/Shanghai）",
			e.ok && e.data && e.data.event === "【活動】夏日慶典" && e.data.eventDates === "09-30 12:00 ~ 10-14 11:59",
			JSON.stringify(e.ok && e.data && [e.data.event, e.data.eventDates]));
		check("eventDatesRaw = `2026/09/30 12:00 - 2026/10/14 11:59`（任务书给的那种带年份+连字符形态）",
			e.ok && e.data && e.data.eventDatesRaw === "2026/09/30 12:00 - 2026/10/14 11:59",
			JSON.stringify(e.ok && e.data && e.data.eventDatesRaw));
		check("hover 写明国际服 tz 依据（港澳台 / 不是 Asia/Tokyo）+ 来源域名",
			e.ok && e.data && /Asia\/Shanghai/.test(e.data.eventHover) && /Asia\/Tokyo/.test(e.data.eventHover)
			&& /l11-web-api\.biligames\.com/.test(e.data.eventHover),
			JSON.stringify(((e.ok && e.data && e.data.eventHover) || "").split("\n")[1]));
		const g = await grab(() => gachaOurNotesGlobal(OURNOTES_GLOBAL_LIST_URL, undefined, OURNOTES_GLOBAL_TZ, NOW_GLOBAL));
		check("gacha 抓取成功", g.ok, g.err);
		assertContract("OurNotes 国际服", "gacha", g.ok ? g.data : null);
		check("gacha banner = 【招募】精選招募 / 10-01 12:00 ~ 10-15 11:59（标题去掉「開放！」尾巴）",
			g.ok && g.data && g.data.banner === "【招募】精選招募" && g.data.bannerDates === "10-01 12:00 ~ 10-15 11:59",
			JSON.stringify(g.ok && g.data && [g.data.banner, g.data.bannerDates]));
		check("gacha 绝对时刻：起 1790827200000（2026-10-01T04:00Z）/ 止 1792036740000（2026-10-15T03:59Z）",
			g.ok && g.data && g.data.startTs === 1790827200000 && g.data.endTs === 1792036740000
			&& new Date(g.data.startTs).toISOString() === "2026-10-01T04:00:00.000Z"
			&& new Date(g.data.endTs).toISOString() === "2026-10-15T03:59:00.000Z",
			JSON.stringify(g.ok && g.data && [g.data.startTs, g.data.endTs]));
		check("两侧都从**同一条 feed** 读（混排靠标题分流）→ 两个 URL 常量相同",
			OURNOTES_GLOBAL_LIST_URL === ournotesGlobalListUrl("zh-tw") && src.altSources[0].url === src.eventAltSources[0].url);
		// 无覆盖 → null
		const eLate = await grab(() => eventsOurNotesGlobal(OURNOTES_GLOBAL_LIST_URL, undefined, OURNOTES_GLOBAL_TZ, sourceInstant(2026, 12, 1, 0, 0, OURNOTES_GLOBAL_TZ)));
		check("now=2026-12-01（合成档期全过期）→ event 返回 null（未公布）",
			eLate.ok && eLate.data === null, JSON.stringify(eLate.ok ? eLate.data : eLate.err));
		// 纯函数：窗口抽取的三种写法
		check("extractOurNotesGlobalWindows：`2026/09/30 12:00 - 2026/10/14 11:59` 带年份",
			(() => {
				const w = extractOurNotesGlobalWindows("活動時間：2026/09/30 12:00 - 2026/10/14 11:59", OURNOTES_GLOBAL_TZ, null).windows[0];
				return !!w && w.raw === "2026/09/30 12:00 - 2026/10/14 11:59"
					&& w.startTs === sourceInstant(2026, 9, 30, 12, 0, OURNOTES_GLOBAL_TZ)
					&& w.endTs === sourceInstant(2026, 10, 14, 11, 59, OURNOTES_GLOBAL_TZ);
			})());
		check("extractOurNotesGlobalWindows：无年份 + 公告年份补全；**没有年份线索 → 进 skipped(no-year)**",
			(() => {
				const a = extractOurNotesGlobalWindows("活動時間：9月30日 12:00 ~ 10月14日 11:59", OURNOTES_GLOBAL_TZ, { y: 2026, mo: 10, d: 1 });
				const b = extractOurNotesGlobalWindows("活動時間：9月30日 12:00 ~ 10月14日 11:59", OURNOTES_GLOBAL_TZ, null);
				return a.windows.length === 1 && a.windows[0].raw === "9月30日 12:00 ~ 10月14日 11:59"
					&& a.windows[0].startTs === sourceInstant(2026, 9, 30, 12, 0, OURNOTES_GLOBAL_TZ)
					&& b.windows.length === 0 && b.skipped.length === 1 && b.skipped[0].reason === "no-year";
			})());
		check("extractOurNotesGlobalWindows：裸连字符（无空格）也能解",
			(() => {
				const w = extractOurNotesGlobalWindows("2026/09/30 10:00-2026/10/14 03:59", OURNOTES_GLOBAL_TZ, null).windows[0];
				return !!w && w.startTs === sourceInstant(2026, 9, 30, 10, 0, OURNOTES_GLOBAL_TZ);
			})());
		check("extractOurNotesGlobalWindows：`~ 常驻` 无终点 → 不产出，记 skipped(perm)",
			(() => {
				const r = extractOurNotesGlobalWindows("活動時間：2026/09/30 12:00 ~ 常駐", OURNOTES_GLOBAL_TZ, null);
				return r.windows.length === 0 && r.skipped.length === 1 && r.skipped[0].reason === "perm";
			})());
		// 标题分流（多语言；**假设**的关键词）
		check("标题分流：繁中/简中/英/韩四套关键词",
			classifyOurNotesGlobalTitle("【活動】夏日慶典開啟！") === "event"
			&& classifyOurNotesGlobalTitle("【招募】精選招募開放！") === "gacha"
			&& classifyOurNotesGlobalTitle("New Recruit Banner!") === "gacha"
			&& classifyOurNotesGlobalTitle("Summer Event Campaign") === "event"
			&& classifyOurNotesGlobalTitle("신규 모집") === "gacha"
			&& classifyOurNotesGlobalTitle("이벤트 개최") === "event"
			&& classifyOurNotesGlobalTitle("Maintenance notice") === null,
			["【活動】夏日慶典開啟！", "【招募】精選招募開放！", "New Recruit Banner!", "Summer Event Campaign", "신규 모집", "이벤트 개최", "Maintenance notice"]
				.map((t) => t + "=" + classifyOurNotesGlobalTitle(t)).join(" | "));
		check("cleanTitle（简繁）去掉尾部动作尾巴",
			cleanTitleGlobal("【招募】精選招募開放！") === "【招募】精選招募"
			&& cleanTitleGlobal("【活動】夏日慶典開啟！") === "【活動】夏日慶典"
			&& cleanTitleGlobal("Summer Event Campaign!") === "Summer Event Campaign!");
		// 结构性损坏 → 抛错
		check("结构损坏（非对象 / code≠0 / data 非对象 / list 非数组）→ 抛错",
			throws(() => parseOurNotesGlobalPage(null)) && throws(() => parseOurNotesGlobalPage([]))
			&& throws(() => parseOurNotesGlobalPage({ code: 1, data: { list: [] } }))
			&& throws(() => parseOurNotesGlobalPage({ code: 0, data: null }))
			&& throws(() => parseOurNotesGlobalPage({ code: 0, data: { list: "x" } })));
		check("列表请求失败 → 抛错（不静默降级成 null）",
			await throwsAsync(() => eventsOurNotesGlobal("https://example.invalid/game/news/page", undefined, OURNOTES_GLOBAL_TZ, NOW_GLOBAL)));
		// 恢复默认覆盖，避免影响后续 section（本文件之后的 section 也只用本批夹具）
		useFixtures(OVERRIDES);
	}
	//#endregion

	//#region P9-7 夹具卫生 / 合成夹具标注
	section("P9-7 夹具卫生 —— 物华/闪耀**真抓**，OurNotes 国际服**合成并标注**");
	{
		const REAL = [
			"p9-whmx-act4", "p9-whmx-act1", "p9-uma-cn-list",
			"p9-whmx-d18419", "p9-whmx-d18334", "p9-whmx-d18265", "p9-whmx-d18194", "p9-whmx-d18109",
			"p9-uma-d18426", "p9-uma-d18425", "p9-uma-d18424", "p9-uma-d18423", "p9-uma-d18376"
		];
		const SYNTH = [
			"p9-ournotes-global-empty", "p9-ournotes-global-list",
			"p9-ournotes-global-detail-9001", "p9-ournotes-global-detail-9002"
		];
		check("真抓夹具 13 个（物华 2 列表 + 5 详情；闪耀 1 列表 + 5 详情）都带 .meta.json（url/status/capturedAt）",
			REAL.every((f) => {
				const m = meta(f + "/response.txt");
				return m.url && m.status === 200 && typeof m.capturedAt === "string" && m.synthetic === undefined;
			}), JSON.stringify(REAL.filter((f) => { const m = meta(f + "/response.txt"); return !(m.url && m.status === 200 && m.capturedAt); })));
		check("真抓夹具的 meta.url 与解析器实际请求的 URL 逐字一致（否则夹具命中不到）",
			meta("p9-whmx-act4/response.txt").url === WHMX_LIST_URLS[0]
			&& meta("p9-whmx-act1/response.txt").url === WHMX_LIST_URLS[1]
			&& meta("p9-uma-cn-list/response.txt").url === UMA_CN_LIST_URL
			&& meta("p9-whmx-d18419/response.txt").url === biligameDetailUrl(WHMX_LIST_URL, 18419)
			&& meta("p9-uma-d18423/response.txt").url === biligameDetailUrl(UMA_CN_LIST_URL, 18423),
			JSON.stringify([meta("p9-whmx-act4/response.txt").url, WHMX_LIST_URLS[0]]));
		check("真抓夹具抓取时刻 = 2026-10-02T16:33~16:36Z（本用例的 SNAP 就是它）",
			meta("p9-whmx-act4/response.txt").capturedAt === "2026-10-02T16:33:29.729Z"
			&& meta("p9-uma-cn-list/response.txt").capturedAt === "2026-10-02T16:33:46.098Z",
			JSON.stringify([meta("p9-whmx-act4/response.txt").capturedAt, meta("p9-uma-cn-list/response.txt").capturedAt]));
		// 合成夹具必须**明确标注**，绝不伪装成真抓
		check("OurNotes 国际服 4 个夹具都在 meta 里标了 synthetic:true",
			SYNTH.every((f) => meta(f + "/response.txt").synthetic === true),
			JSON.stringify(SYNTH.map((f) => [f, !!meta(f + "/response.txt").synthetic])));
		check("OurNotes 合成夹具的 note 写明「合成夹具（不是真抓的）」+ 原因（源站暂无公告 / ECONNRESET）",
			SYNTH.every((f) => {
				const n = String(meta(f + "/response.txt").note || "");
				return /合成夹具（不是真抓的）/.test(n) && /ECONNRESET|暂无公告/.test(n);
			}), JSON.stringify(SYNTH.map((f) => String(meta(f + "/response.txt").note || "").slice(0, 24))));
		check("合成夹具的 url 与 ournotes-global 解析器常量一致（空响应那条就是注册表备选源 URL）",
			meta("p9-ournotes-global-empty/response.txt").url === OURNOTES_GLOBAL_LIST_URL
			&& meta("p9-ournotes-global-detail-9001/response.txt").url === ournotesGlobalDetailUrl(9001, "zh-tw"));
	}
	//#endregion

	// run.mjs / all.mjs 会调用 summary()；直接 `node test/cases-p9.mjs` 时也自报结果
	if (process.argv[1] && process.argv[1].endsWith("cases-p9.mjs")) summary();
}

// 直接执行时自动跑（被 test/all.mjs import 时不自动跑）
if (process.argv[1] && process.argv[1].endsWith("cases-p9.mjs")) await run();
