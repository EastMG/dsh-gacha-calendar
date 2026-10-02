// next-sources/registry-p9.js —— 批次 P9 注册表片段
//
// 用法：Lead 汇总时同样做**就地覆盖**（不是简单追加）：
//   `wuhuamixin`（B2）与 `uma-cn`（B2）在本批被**补强/取代**，直接把它们从 SOURCES_B2 里换成
//   本文件的版本，或先在 ALL 里过滤掉这两个 id 再并入 SOURCES_P9 —— 否则 registry.js 的
//   「id 重复直接抛错」会在汇总期就炸。三条 id：wuhuamixin / uma-cn / ournotes-global。
//
// ── 与 B2 的关系（**关键**）────────────────────────────────────────────────
//   ① `wuhuamixin`（物华弥新）
//      · 卡池侧 = **原样保留 B2 的 bwiki `限时招集档案`**（`gachaWhmx`，kind=wiki）——
//        本批只**补活动侧**，卡池侧一行不改（不保留就会丢卡池）。
//      · 活动侧 = **新增**：biligame 官方公告 API（gameExtensionId=613）。
//        B2 原来挂的 bwiki `活动` 页内容停在 2025-05-01（当期恒 null）→ 本批换成官方源。
//        ⚠️ 官方源**两路 typeId 都要拉**（4=活动专类 36 条 / 1=公告 17 条，两路 id 零重叠）：
//        注册表只声明主 URL（typeId=4），解析器由它派生 typeId=1 那路（见 whmxListUrls()）。
//   ② `uma-cn`（闪耀！优俊少女）
//      · 本批**取代** B2 的 bwiki 推算表作**主源**（任务书：官方源优先于 bwiki 推算表）：
//        卡池 + 活动都读官方 `gameExtensionId=1006`（单一 feed typeId=1，卡池/活动混排 → 靠标题分流）。
//      · B2 的 bwiki `简中卡池` **降级为卡池备选源**（`altSources`，fetcher 键 `uma-cn-bwiki`），
//        在设置页仍可切回；hover/kind 仍如实说明它是社区推算式内容（非官方时刻表）。
//   ③ `ournotes-global`（BanG Dream！OurNotes·国际服）——**新条目**，见下。
//
// ── ③ ournotes-global：**默认未配置**（照米游社「崩坏3」那套形态）────────────────
//   条目**不给 `url` / `eventUrl`**，只挂 `altSources` / `eventAltSources`：
//     · 插件 50-refresh.js：`if (!source.url && !source.eventUrl) → skipped`
//       → 不抓取、不计成功也不计失败，UI 显示「未配置（不抓取卡池/活动）」；
//       用户在设置页选「官方公告（BHK）」后才真正抓取。
//     · ⚠️ 备选源的标识是 `altSourceId(alt) = alt.url` → 这里的 URL 必须与
//       parsers/ournotes-global.js 里 `OURNOTES_GLOBAL_LIST_URL` **逐字一致**。
//   tz = Asia/Shanghai（**任务书指定**：国际服含港澳台，**不要**照日服用 Asia/Tokyo）。
//   为什么默认不配：源站**暂无公告**（`total_count:0`），且该域对本机 ECONNRESET（无法真抓）。
//
// ── 备选源抓取器登记（需要 Lead 合并，见文件末）──────────────────────────────
//   registry.js 的守卫要求：`altSources[].fetcher` 登记在 `EXTRA_GACHA_FETCHERS`（**扁平表**）、
//   `eventAltSources[].fetcher` 登记在 `EXTRA_EVENT_FETCHERS[条目id]`（**按条目分组**）。
//   而 `registry-extras.js` 属别的批次的文件（本批不越界改）→ 本文件把要登记的键**原样导出**：
//     `EXTRA_GACHA_FETCHERS_P9` / `EXTRA_EVENT_FETCHERS_P9`
//   Lead 合并时把这两个表并进 registry-extras.js 即可（否则 registry.js 会在汇总期抛
//   「备选源登记有问题」）。键：`uma-cn-bwiki` / `ournotes-global-gacha` / `ournotes-global-event`。
//
// mode 一律 "proxy"：`api.biligame.com` / `wiki.biligame.com` / `l11-web-api.biligames.com`
// 三家都**不在**实测 ACAO 放行的三源内（umapyoi / sekai / bushimo）。
// ⚠️ **插件侧待办（Lead，属 src/ 改动）**：`src/index.js` 的 `PROXY_ALLOW_HOSTS`
//    **不含 `l11-web-api.biligames.com`** → 真机上 OurNotes 国际服即便手动选源也会回
//    `{error:"host not allowed"}`（离线夹具测试不受影响）。需 Lead 把它加进白名单。

import { gachaWhmx, gachaUmaCn } from "./parsers/bwiki.js";
import {
	eventsWhmxOfficial, gachaUmaCnOfficial, eventsUmaCnOfficial,
	WHMX_LIST_URL, UMA_CN_LIST_URL, BILIGAME_ACTIVITY_TZ
} from "./parsers/biligame-activity.js";
import {
	gachaOurNotesGlobal, eventsOurNotesGlobal, OURNOTES_GLOBAL_LIST_URL, OURNOTES_GLOBAL_TZ
} from "./parsers/ournotes-global.js";

// bwiki api.php 拼法（与 registry-b2.js **逐字一致**：页名保持未编码，便于与 test/map.json 键一一对应）
const parseUrl = (wiki, page) =>
	`https://wiki.biligame.com/${wiki}/api.php?action=parse&page=${page}&prop=text&format=json&formatversion=2`;
const UMA_CN_BWIKI_URL = parseUrl("umamusume", "简中卡池");

export const SOURCES_P9 = [
	{
		// 本条目**补强活动侧**：卡池侧沿用 B2 的 bwiki（不动），活动侧换成官方 API。
		id: "wuhuamixin",
		name: "物华弥新",
		tz: BILIGAME_ACTIVITY_TZ,                          // Asia/Shanghai（官方公告正文未标时区，推定；见解析器文件头交叉印证）
		// B2 原文：wiki 子域 whmx，卡池页「限时招集档案」= CardSelect 表 114 行 → 当期可用
		gacha: { url: parseUrl("whmx", "限时招集档案"), fetcher: gachaWhmx, kind: "wiki", mode: "proxy" },
		// 官方公告 API（gameExtensionId=613）：列表两路 typeId=4/1 合并去重，档期从详情正文抽
		event: { url: WHMX_LIST_URL, fetcher: eventsWhmxOfficial, kind: "official-api", mode: "proxy" }
	},
	{
		// 官方源**取代** bwiki 推算表作主源；bwiki 降级为卡池备选源（可切回）
		id: "uma-cn",
		name: "闪耀！优俊少女",
		tz: BILIGAME_ACTIVITY_TZ,                          // Asia/Shanghai（官方 displayTime 与正文墙钟逐字一致 → 推定 UTC+8）
		gacha: { url: UMA_CN_LIST_URL, fetcher: gachaUmaCnOfficial, kind: "official-api", mode: "proxy" },
		event: { url: UMA_CN_LIST_URL, fetcher: eventsUmaCnOfficial, kind: "official-api", mode: "proxy" },
		// ⚠️ 备选：B2 的 bwiki「简中卡池」**不是官方时刻表**（wiki 按日服时差推算，正文写着
		//   「简中卡池加速 -> 简中预测时间-185天」）→ 只作备选，显示名里如实标注。
		altSources: [
			{ label: "Bwiki 简中卡池（社区推算，非官方）", url: UMA_CN_BWIKI_URL, fetcher: "uma-cn-bwiki" }
		]
	},
	{
		// **默认未配置**：只有备选源，没有 url / eventUrl（= 不抓取、UI 显示「未配置」）
		id: "ournotes-global",
		name: "BanG Dream！OurNotes·国际服",
		tz: OURNOTES_GLOBAL_TZ,                            // Asia/Shanghai（任务书指定；国际服含港澳台，不用 Asia/Tokyo）
		altSources: [
			{ label: "官方公告（BHK）", url: OURNOTES_GLOBAL_LIST_URL, fetcher: "ournotes-global-gacha" }
		],
		eventAltSources: [
			{ label: "官方公告（BHK）", url: OURNOTES_GLOBAL_LIST_URL, fetcher: "ournotes-global-event" }
		]
	}
];

// ── 备选源抓取器登记（Lead 合并进 registry-extras.js）──
/** 卡池侧备选抓取器（键 = altSources[].fetcher；扁平表） */
export const EXTRA_GACHA_FETCHERS_P9 = {
	"uma-cn-bwiki": gachaUmaCn,
	"ournotes-global-gacha": gachaOurNotesGlobal
};
/** 活动侧备选抓取器（键 = 条目 id → altSources[].fetcher） */
export const EXTRA_EVENT_FETCHERS_P9 = {
	"ournotes-global": {
		"ournotes-global-event": eventsOurNotesGlobal
	}
};

export function findSourceP9(id) { return SOURCES_P9.find((s) => s.id === id) || null; }
export function listIdsP9() { return SOURCES_P9.map((s) => s.id); }
