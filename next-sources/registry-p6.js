// next-sources/registry-p6.js —— 批次 P6 注册表片段
//
// 用法：Lead 汇总时 `import { SOURCES_P6 }` 并合并进 registry.js 的 NEXT_SOURCES。
// 契约与 CONVENTIONS.md 一致：`gacha`/`event` 各声明 { url, fetcher, kind, mode }。
//
// 两个来源（**id 刻意不叫 `kedrgame`** —— B2 已占用该 id，registry.js 对重复 id 直接抛错）：
//
// ① ddlezj —— 嘟嘟脸恶作剧 国服 · biligame **官方公告 API**（`api.biligame.com/news`）
//    · 两侧（卡池 + 活动）都读**同一份公告**：公告正文里既有「三、招募UP中」的卡池档期，
//      也有「一、主题活动」「四、签到活动」「七、艾利亚斯边境」等活动档期 —— 与 bandori.js 同型。
//    · `gameExtensionId=1282` 有**双重独立印证**：① 官网页面的网络请求自身带该参数；
//      ② `/news/17825` 详情 JSON 里 `data.gameExtensionId=1282` + `data.site=嘟嘟脸恶作剧`。
//    · tz = **"+540"（UTC+9 固定偏移）**：源站公告正文**自己标注 `(UTC+9)`**（实测 4 处，
//      例 `活动时间：2026/04/30 10:00 - 2026/05/07 09:59 (UTC+9)`）。
//      国服公告却用日本时区，**属源站如此**，本项目不改写源站口径（raw 保留原文是否带后缀）。
//    · 抓取性：`api.biligame.com` **无 ACAO**（调研实测）→ `mode: "proxy"`，**不可 direct**。
//    · ⚠️ 起点写作「维护后」的档期**不产出**（源站没给钟点、公告发布时间 ≠ 维护结束时刻）
//      → 抽不到覆盖当前的档期就返回 null，绝不硬凑（详见 parsers/biligame-announce.js 文件头）。
//
// ② kedr-wiki —— 雪松 · bwiki 社区结构化页 `往期动员【常驻】—1.0.0—`
//    · ⚠️ **官方源未找到**（调研结论：无免鉴权官方公告 API；bwiki `page=卡池信息` 又是
//      「台架测试」占位页）→ 这是**社区结构化页**，故 `kind: "wiki"`，稳定性弱于官方 API。
//    · 只有卡池侧（该页就是卡池档期归档；无活动侧）。
//    · tz = **Asia/Shanghai（推测）**：源站未标注；旁证 = 每期结束时间都落在 **05:00**
//      （国服常见日切点）、起始 12:00。
//    · ⚠️ 页面标题就是「**往期**动员」= 归档页：实测 4 期全部落在 2026-06-22 ~ 2026-07-20
//      （抓取时刻 2026-10-02 已全部结束）→ 当期语义下**如实返回 null**。若社区把当期挂上同款结构，
//      解析器无需改动即可产出。
//    · 抓取性：bwiki 全系无 ACAO → `mode: "proxy"`；且高频请求会被 EdgeOne WAF 拦成 HTTP 567
//      （挑战页非 JSON）→ 抓夹具要 30s 限速重试 + 校验 JSON。
//
// mode 汇总：两条来源**都不是**实测 ACAO 放行的三源（umapyoi / sekai / bushimo）→ 一律 "proxy"。
// （test/all.mjs 有守卫：声明 direct 的 URL 必须属于那三源。）

import { gachaDdlezj, eventsDdlezj, DDLEZJ_LIST_URL, DDLEZJ_TZ } from "./parsers/biligame-announce.js";
import { gachaKedrWiki, KEDR_ARCHIVE_URL, KEDR_TZ } from "./parsers/kedr-wiki.js";

export const SOURCES_P6 = [
	{
		id: "ddlezj",
		name: "嘟嘟脸恶作剧",
		tz: DDLEZJ_TZ,                                        // "+540" = UTC+9（**源站正文自标**）
		gacha: { url: DDLEZJ_LIST_URL, fetcher: gachaDdlezj, kind: "official-api", mode: "proxy" },
		event: { url: DDLEZJ_LIST_URL, fetcher: eventsDdlezj, kind: "official-api", mode: "proxy" }
	},
	{
		// 一游戏一条目：主源 = 社区结构化归档页 `往期动员【常驻】—1.0.0—`（有真实档期）
		// 备选源 = bwiki `卡池信息`（台架测试占位页）—— B2 原 `kedrgame` 条目已吸收到这里。
		id: "kedr",
		name: "雪松",
		tz: KEDR_TZ,                                          // Asia/Shanghai（**推测**，源站未标注）
		gacha: { url: KEDR_ARCHIVE_URL, fetcher: gachaKedrWiki, kind: "wiki", mode: "proxy" },
		// 无活动侧：该页只有卡池（动员）档期
		altSources: [
			{ label: "Bwiki 卡池信息（台架测试占位）", url: "https://wiki.biligame.com/kedrgame/api.php?action=parse&page=卡池信息&prop=text&format=json&formatversion=2", fetcher: "kedr-kaxi" }
		]
	}
];

export function findSourceP6(id) { return SOURCES_P6.find((s) => s.id === id) || null; }
export function listIdsP6() { return SOURCES_P6.map((s) => s.id); }
