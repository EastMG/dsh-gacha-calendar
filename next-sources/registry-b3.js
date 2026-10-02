// next-sources/registry-b3.js —— 批次 B3 来源注册表片段（**不合并进插件本体**）
//
// 契约与 registry.js 一致：每条声明 id / name / tz / gacha? / event?，
// 每侧含 { url, fetcher, kind, mode }。URL 直接复用解析器导出的常量
// —— 保证「注册表里的 URL」与「解析器实际抓的 URL」**永远同一串**
// （离线夹具按整串匹配，写歪一个字符就命中不到）。
//
// ⚠️ 解析器内部的 `mode`（fetchText/fetchJson 的入参）必须与本文件声明的 mode 一致。
//    全目录实测可直连（ACAO 放行）的只有 3 个源，其中只有 ournotes 属本批次。
//
// 时区取值与依据（逐条都在对应 parser 文件头写全了）：
//   · gf2       Asia/Shanghai  UTC+8 —— **推定**：源站未硬标注；API 的 Date 全是北京时间口径
//               （发布 18:31、维护 09:00~12:00），且【迭代回廊】Date=2026-10-01 05:00:00
//               正是国服每日 05:00 刷新点。
//   · bandori   Asia/Shanghai  UTC+8 —— **已交叉验证**：官方 displayTime=2026-09-29 10:00
//               ↔ Bestdori CN startAt=2026-09-29 02:00Z（10:00+08）完全吻合。
//   · ournotes  Asia/Tokyo      —— **实测**：WP REST 的 date 与 date_gmt 逐条相差 9 小时
//               （夹具 11 篇全部如此）→ JST=UTC+9。
//   · fgo       Asia/Shanghai  UTC+8 —— **有硬交叉验证**：SMW 里同名活动的 开始时间(UTC)
//               与国服表墙钟严格差 8 小时（幕末武斗神话：SMW=2026-09-24T11:00Z ↔ 国服表 9/24 19:00）。
//
// 说明：少前2 在调研文档里曾用代号 `gongzhu2`、BanG Dream 国服曾用 `bandori-cn-official`，
// 本片段按 Team Lead 本轮指定的 id 命名（gf2 / bandori / ournotes / fgo）；合并进 registry.js
// 时若要保持调研文档的代号，改 id 即可（解析器不依赖 id）。

import { gachaGf2, eventsGf2, GF2_GACHA_URL, GF2_EVENT_URL, GF2_TZ } from "./parsers/gf2.js";
import { gachaBandori, eventsBandori, BANDORI_LIST_URL, BANDORI_TZ } from "./parsers/bandori.js";
import { eventsOurNotes, OURNOTES_LIST_URL, OURNOTES_TZ } from "./parsers/ournotes.js";
import { gachaFgo, eventsFgo, FGO_GACHA_URL, FGO_EVENT_URL, FGO_TZ } from "./parsers/fgo.js";

export const SOURCES_B3 = [
	{
		id: "gf2",
		name: "少女前线2：追放",
		tz: GF2_TZ,
		// 官方 API。两侧 URL 就是任务书给的两个 typeId：
		//   typeId=4 = 活动&卡池混排（卡池公告靠标题过滤出「概率UP/采购/军备提升」）
		//   typeId=3 = 官方公告（活动侧取最新「版本更新公告」的维护窗口）
		// 列表里的 Content 恒为空 → 抓取器会再取一次 /website/news/{Id} 拿正文窗口。
		gacha: { url: GF2_GACHA_URL, fetcher: gachaGf2, kind: "official-api", mode: "proxy" },
		event: { url: GF2_EVENT_URL, fetcher: eventsGf2, kind: "official-api", mode: "proxy" }
	},
	{
		// 一游戏一条目：主源 = 官方公告；备选源 = Bestdori（见 registry-extras.js）
		// （原 `bandori-bestdori` 独立条目已吸收到这里 —— 插件设计是"多来源走 altSources 切换"，
		//   不该为同一游戏并行列出两条；用户在 review 时明确指出。）
		id: "bandori",
		name: "BanG Dream！少女乐团派对·国服",
		tz: BANDORI_TZ,
		// 两侧**同源同一份公告列表**（biligame 官方公告 API，typeId=1）：
		// 卡池侧取「…招募」那一节、活动侧取「…挑战演出活动」那一节。
		// 列表页 content 被截断 + 顺序非严格倒序 → 抓取器会自行倒序并按需取详情。
		gacha: { url: BANDORI_LIST_URL, fetcher: gachaBandori, kind: "official-api", mode: "proxy" },
		event: { url: BANDORI_LIST_URL, fetcher: eventsBandori, kind: "official-api", mode: "proxy" },
		// 备选源（设置页可切）：Bestdori 是社区数据库，但结构化更好、带简中服起止毫秒。
		altSources: [
			{ label: "Bestdori 扭蛋（社区数据库）", url: "https://bestdori.com/api/gacha/all.5.json", fetcher: "bandori-bestdori-gacha" }
		],
		eventAltSources: [
			{ label: "Bestdori 活动（社区数据库）", url: "https://bestdori.com/api/events/all.5.json", fetcher: "bandori-bestdori-event" }
		]
	},
	{
		id: "ournotes",
		name: "BanG Dream！OurNotes·日服",
		tz: OURNOTES_TZ,
		// **只有活动/公告侧**（无卡池专用源）——按用户要求"只有一侧就只写一侧"。
		// WordPress REST；实测 ACAO 回显 Origin → 三个可直连源之一，故 mode="direct"。
		// ⚠️ 不要加 `_fields=` 裁剪：活动区间藏在 excerpt/content 里，裁掉就只剩发布时刻。
		event: { url: OURNOTES_LIST_URL, fetcher: eventsOurNotes, kind: "official-api", mode: "direct" }
	},
	{
		id: "fgo",
		name: "Fate/Grand Order",
		tz: FGO_TZ,
		// MediaWiki + SemanticMediaWiki。**外显走 action=parse 的 HTML 表格**：
		// 卡池页第一张表表头就是「国服当前卡池」，活动页的国服表按年份分节、日服表显式标注
		// 「（日本标准时间）」——服务器归属由页面自己标好，不用猜。
		// （SMW `action=ask` 实测可用但**分不出国服/日服**，理由见 parsers/fgo.js 文件头。）
		// ⚠️ 该页提示"信息或许并非最新…刷新缓存"，但 `action=purge` 必须 POST，
		//    本目录传输层只有 GET → 不做 purge（`action=parse` 本身按当前 revision 重渲染，实测新鲜）。
		gacha: { url: FGO_GACHA_URL, fetcher: gachaFgo, kind: "wiki", mode: "proxy" },
		event: { url: FGO_EVENT_URL, fetcher: eventsFgo, kind: "wiki", mode: "proxy" }
	}
];

// 便捷查询（与 registry.js 的 findSource 同名同义）
export function findSource(id) { return SOURCES_B3.find((s) => s.id === id) || null; }
export function listIds() { return SOURCES_B3.map((s) => s.id); }
