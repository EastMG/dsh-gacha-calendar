// next-sources/registry-p5.js —— 批次 P5：赛马娘 **官方公告**（日服 + 国际服）
//
// ── 设计（遵循插件既有约定：**一游戏一条目，多来源走 altSources 在设置页切换**）──
//   本条**吸收**了原先散成两条的赛马娘日服来源，合并为一条：
//     · 主源（卡池+活动）：**官网公告** `umamusume.jp/api/ajax/pr_info_index`（有卡池名、有档期）
//     · 备选（卡池）：`api.umapyoi.net/api/v1/gacha`（第三方，只有卡级窗口、**无卡池名**）
//     · 备选（活动）：bwiki `umamusume` 的 `page=活动`（社区归档表，实测停在 2025-12）
//   国际服是**独立条目**（不同服区、不同站点、时区也不同：UTC vs JST）。
//
// ── 时区（实测，两者不同，别混）──
//   · 日服 `umamusume.jp` → **Asia/Tokyo**（源站即日服官网）
//   · 国际服 `umamusume.com` → **UTC**（实测 `post_at` 是 UTC，不是 JST）
//
// ── mode 一律 `"proxy"` ──
//   实测两个域名响应都**没有 ACAO**（CloudFront `Vary: Origin` 但不回 `access-control-allow-origin`），
//   浏览器直连必被 CORS 拦；`test/all.mjs` 的 direct 白名单也只放行
//   `api.umapyoi.net` / `sekai-world.github.io` / `bang-dream-on.bushimo.jp` 三个源。
//
// ── kind 都是 `official-api` ──（`test/all.mjs` 只允许 official-api | official-html | wiki | third-party）
//
// ⚠️ 国际服的列表/详情是 **POST**（GET 或缺 body → `{"response_code":102}`），解析器内已自行封装。
//
// ⚠️ 备选源命中规则：`altSourceId = (alt) => alt.url || alt.id || ""`，与当前 url **字符串相等**才命中。
//    所以下面两个备选 URL 必须与抓取器实际收到的 url 一字不差（也正因如此，日服用的是 `page=活动` 这个未编码形态）。
import {
	gachaUmaJpOfficial, eventsUmaJpOfficial,
	gachaUmaGlobal, eventsUmaGlobal,
	UMA_JP_INDEX_URL, UMA_GLOBAL_INDEX_URL
} from "./parsers/umamusume-official.js";
import { gachaUmapyoi, UMAPYOI_URL } from "./parsers/umapyoi.js";
import { eventsUmaJp } from "./parsers/bwiki.js";

// 与 registry-b2.js 的 `parseUrl("umamusume", "活动")` 同形态（页面名保持未编码，与 map.json 键一一对应）
const UMA_JP_BWIKI_EVENT_URL = "https://wiki.biligame.com/umamusume/api.php?action=parse&page=活动&prop=text&format=json&formatversion=2";

export const SOURCES_P5 = [
	{
		// 一游戏（日服）一条目
		id: "uma-jp",
		name: "赛马娘·日服",
		tz: "Asia/Tokyo",
		gacha: { url: UMA_JP_INDEX_URL, fetcher: gachaUmaJpOfficial, kind: "official-api", mode: "proxy" },
		event: { url: UMA_JP_INDEX_URL, fetcher: eventsUmaJpOfficial, kind: "official-api", mode: "proxy" },
		// 备选源（设置页可切）
		altSources: [
			{ label: "umapyoi（第三方，无卡池名）", url: UMAPYOI_URL, fetcher: "uma-jp-umapyoi" }
		],
		eventAltSources: [
			{ label: "Bwiki 活动（往期归档）", url: UMA_JP_BWIKI_EVENT_URL, fetcher: "uma-jp-bwiki" }
		]
	},
	{
		// 国际服：独立服区/站点/时区，**不是**日服的备选
		id: "uma-global",
		name: "赛马娘·国际服",
		tz: "UTC",
		gacha: { url: UMA_GLOBAL_INDEX_URL, fetcher: gachaUmaGlobal, kind: "official-api", mode: "proxy" },
		event: { url: UMA_GLOBAL_INDEX_URL, fetcher: eventsUmaGlobal, kind: "official-api", mode: "proxy" }
	}
];

/** 与其它 registry-*.js 同形态的查找函数（测试与 Lead 集成都用它） */
export function findSource(id) {
	return SOURCES_P5.find((s) => s.id === id) || null;
}
