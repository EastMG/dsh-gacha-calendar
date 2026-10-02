// next-sources/registry-b2.js —— 批次 B2 注册表片段：7 个 bwiki（MediaWiki api.php）来源
//
// 用法：Lead 汇总时 import { SOURCES_B2 } 并合并进 registry.js 的 NEXT_SOURCES。
// 契约与 CONVENTIONS.md 一致：`gacha`/`event` 各声明 { url, fetcher, kind, mode }。
//
// ── 时区取值与依据 ──────────────────────────────────────────────────────────
//   · 国服（wuhuamixin / uma-cn / zspms / kedrgame / czn / stellasora）= "Asia/Shanghai"
//     **全部为推测**：这些 bwiki 页面正文**都没有**显式时区标注，按"国服 = UTC+8"推定。
//     （夹具里能看到的只有墙钟原文，如 `2026年09月30日 10:00`、`2024/03/21 10:00 AM`，本身不含 tz。）
//   · 赛马娘日服（uma-jp-bwiki）= "Asia/Tokyo"，**硬标注**：
//     同一 wiki 的卡池页正文写明「日服卡池时间记录统一为日本时间」；
//     夹具内该页时间形如 `2025/12/26 11:00~ 2026/01/08 10:59`（11:00 起 = 日服维护后的典型时刻）。
//   · 星塔旅人 stellasora 的 `data-end-time` 是**不带时区的 ISO**（`2026-04-01T02:59:59`），
//     页面 JS 用 `new Date(...)` 按**浏览器本地时间**解释 → 语义本身有歧义；
//     这里按国服墙钟 UTC+8 解释（**假设**，非源站声明）。
//
// ── 实测可用性（2026-10-02 抓取；"当期"= 窗口覆盖 now 2026-10-02）─────────────
//   id             侧      实测最新一条         当期有数据?  备注
//   wuhuamixin     gacha   2026-09-30 起       ✅           页面最新
//   wuhuamixin     event   2025-05-01 起       ❌ 停更      内容停在 2025-05（页面缓存时间 2026-10-01）
//   uma-cn         gacha   2026-09-23 起       ✅           ⚠️ 见下"预测"说明
//   uma-jp-bwiki   event   2025-12-26 起       ❌ 归档      该表标题是「往期活动」
//   zspms          gacha   2024-03-21 起       ❌ 停更      页面自述只收录两类池，停在 2024Q1
//   kedrgame       gacha   2024-12-07 起       ❌ 占位      台架测试，最近编辑 2025-08-01
//   czn            gacha   —                   ❌ 空页      正文只有「模板:Gacha」链接
//   stellasora     event   2026-04-07 止       ❌ 停更      且无活动名字段（只有立绘文件名）
//   ⇒ 只有 wuhuamixin.gacha 与 uma-cn.gacha 在当期能给出数据；其余 5 侧抓取器会**如实返回 null**
//     （抓到页面但当期无内容 = "未公布"，见 CONVENTIONS 契约），**没有硬凑过期档期**。
//
// ── 两个必须在 UI 上提醒用户的风险（用户明确要求如实写明）────────────────────
//   ① uma-cn（闪耀优俊少女 国服）**不是官方时刻表**：`page=简中卡池` 正文写着
//      「简中卡池加速 -> 简中预测时间-185天」「2025/05/22 简中重新更新 -> 简中预测时间+423天」
//      ⇒ 简中服时刻是 wiki 按**日服时差推算**出来的。解析器只把「已实装卡池」表（实际记录）用作
//        当期外显；「预测卡池」表的推算结果只进 `bannerHover`，并明确标注
//        「预测卡池（按日服时差推算，非官方时刻表）」。kind 记 `wiki`（社区维护），**不是 official**。
//   ② kedrgame（雪松）**可能已停更**：`page=卡池信息` 仍是「台架测试[一]/[二]」占位，最近编辑
//      2025-08-01；唯一可解析窗口是 2024/12/07~12/13。
//      **但该 wiki 本身仍活跃**（站内搜索到 `历史卡池-精英集结-1.0.0-1`、`往期动员【常驻】—1.0.0—`
//      含「开始时间：2026-06-22-12:00 / 结束时间：2026-06-29-05:00」、`游戏内部公告(2026.6/7)` 含
//      「本期动员卡池持续时间：2026/6/22 12:00～2026/6/29 05：00」）→ 建议后续把本来源改挂这些页面。
//
//   kind 一律 "wiki"：数据由 bwiki 社区编辑维护（含推算式内容），都不是官方 API/公告。
//   mode 一律 "proxy"：2026-10-02 实测 bwiki 全系响应**无 ACAO**，必须走宿主代理。

import {
	gachaWhmx, eventsWhmx,
	gachaUmaCn, eventsUmaJp,
	gachaZspms, gachaKedr, gachaCzn,
	eventsStellasora
} from "./parsers/bwiki.js";

const TZ_CN = "Asia/Shanghai";
const TZ_JP = "Asia/Tokyo";

// 统一拼 api.php?action=parse&…&prop=text（页面名保持未编码形态，便于与 test/map.json 键一一对应）
const parseUrl = (wiki, page) =>
	`https://wiki.biligame.com/${wiki}/api.php?action=parse&page=${page}&prop=text&format=json&formatversion=2`;

const WIKI = (url, fetcher) => ({ url, fetcher, kind: "wiki", mode: "proxy" });

export const SOURCES_B2 = [
	{
		id: "wuhuamixin",
		name: "物华弥新 国服（bwiki）",
		tz: TZ_CN,                                  // 推测：国服 UTC+8，源站未显式标注
		// wiki 子域 whmx。卡池页「限时招集档案」= CardSelect 表 114 行（最新 2026-09-30 起）→ 当期可用。
		// 活动页「活动」= 63 行，但**内容停在 2025-05-01**（页面缓存时间 2026-10-01）→ 当期无覆盖 → null。
		gacha: WIKI(parseUrl("whmx", "限时招集档案"), gachaWhmx),
		event: WIKI(parseUrl("whmx", "活动"), eventsWhmx)
	},
	{
		id: "uma-cn",
		name: "闪耀优俊少女 国服（bwiki，简中卡池）",
		tz: TZ_CN,                                  // 推测：国服 UTC+8
		// ⚠️⚠️ 该页**不是官方时刻表**：正文写「简中卡池加速 -> 简中预测时间-185天」等，
		//   简中服时刻是 wiki 按日服时差**推算**的。解析器只用「已实装卡池」表做当期外显；
		//   「预测卡池」表的推算结果只进 bannerHover 并标注「非官方时刻表」。kind 因此记 wiki。
		//   佐证该推算不可当官方：预测表池名里还留着**日服原始年份**（`八骏赛马娘卡池 20230911`
		//   被平移到 2026-09），且远期条目一路机械外推到 **2029/09/26**（夹具原文）。
		gacha: WIKI(parseUrl("umamusume", "简中卡池"), gachaUmaCn)
		// 无独立活动侧（活动由 uma-jp-bwiki / 其它源的日服活动覆盖）
	},
	{
		id: "uma-jp-bwiki",
		name: "赛马娘 日服（bwiki 活动侧）",
		tz: TZ_JP,                                  // **硬标注**：同 wiki 卡池页正文「日服卡池时间记录统一为日本时间」
		// ⚠️ `page=活动` 只有一张表，标题是「往期活动」（归档），100 行；
		//   实测最新一条 2025/12/26 ~ 2026/01/08（页面缓存时间 2026-10-01）→ 当期无覆盖 → null。
		//   仅活动侧（卡池侧由 uma-jp-umapyoi 等官方/第三方源负责）。
		event: WIKI(parseUrl("umamusume", "活动"), eventsUmaJp)
	},
	{
		id: "zspms",
		name: "战双帕弥什 国服（bwiki 研发记录）",
		tz: TZ_CN,                                  // 推测：国服 UTC+8
		// 战双的抽卡系统叫「研发」。`page=研发记录` = 107 张小表（每池一张，日期带 12 小时制）。
		// ⚠️ 实测最新一期 2024/03/21（页面缓存时间 2026-10-01）→ 该页停在 2024Q1，当期无覆盖 → null。
		//   站内另有 `4.7"降临狙击"限时概率UP活动`、`3.10"降临狙击"…` 等公告页（本次未核其日期）。
		gacha: WIKI(parseUrl("zspms", "研发记录"), gachaZspms)
	},
	{
		id: "kedrgame",
		name: "雪松（bwiki 卡池信息）",
		tz: TZ_CN,                                  // 推测：国服 UTC+8
		// ⚠️ 停更风险：`page=卡池信息` 仍是「台架测试[一]/[二]」占位（最近编辑 2025-08-01），
		//   无表格，唯一可解析窗口 2024/12/07~12/13，第二段是「？-？」→ 当期无覆盖 → null。
		//   该 wiki 仍活跃，卡池数据实际在 `往期动员*` / `游戏内部公告(2026.x)` 页（见文件头）。
		gacha: WIKI(parseUrl("kedrgame", "卡池信息"), gachaKedr)
	},
	{
		id: "czn",
		name: "卡厄斯梦境 国服（bwiki 卡池记录）",
		tz: TZ_CN,                                  // 推测：国服 UTC+8
		// ⚠️ 官方名其实是「卡厄**思**梦境」；bwiki 子域是 **czn**（`kaesi` 是 soft-404）。
		//   `page=卡池记录` 实测是**空页**：prop=text 全文只有「模板:Gacha」链接，无表格无日期 → null。
		//   旁证：同 wiki `首页/PC端` 的 BANNER 区块自述「当前没有即将开始或进行中的卡池。」
		//   站内搜索「卡池」只命中 卡池记录 / 首页 / 首页-PC端 / 首页-移动端 —— 没有更好的卡池页。
		gacha: WIKI(parseUrl("czn", "卡池记录"), gachaCzn)
	},
	{
		id: "stellasora",
		name: "星塔旅人 国服（bwiki 首页·活动日历）",
		tz: TZ_CN,                                  // 推测：国服 UTC+8（data-end-time 是不带时区的 ISO，见文件头）
		// ⚠️ 低可用性，仅活动侧：首页「活动日历」只有 2 项，**没有活动名字段**（只能取立绘文件名
		//   `Banner bossrush 5.png`），剩余时间由页面 JS 现算（静态文本是「计算中...」）。
		//   实测两项止于 2026-04-01 / 2026-04-07 → 当期无覆盖 → null。
		//   卡池侧是纯图片、无时间字段 → 不注册。
		event: WIKI(parseUrl("stellasora", "首页"), eventsStellasora)
	}
];

export function findSourceB2(id) { return SOURCES_B2.find((s) => s.id === id) || null; }
export function listIdsB2() { return SOURCES_B2.map((s) => s.id); }
