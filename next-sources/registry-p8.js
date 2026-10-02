// next-sources/registry-p8.js —— 批次 P8 注册表片段：bwiki **wikitext 形态**三源
//
// 用法：Lead 汇总时 `import { SOURCES_P8 }` 合并进 registry.js 的 NEXT_SOURCES。
// 契约与 CONVENTIONS.md 一致：`gacha`/`event` 各声明 { url, fetcher, kind, mode }。
//
// ⚠️⚠️ **本文件三个 id 与既有批次同名，是"就地覆盖"用的（Lead 合并时按 id 覆盖）**：
//   · `zspms`（战双帕弥什）—— 取代 **B2** 的 zspms：B2 挂的是 `page=研发记录`（`prop=text` HTML），
//       实测停在 2024Q1；本次改挂 **SMW ask 索引 + 最新「版本更新公告」的 wikitext**，是**当期活数据**。
//   · `czn`（卡厄斯梦境）—— 取代 **B2** 的 czn：B2 挂的 `page=卡池记录`（prop=text）实测是空页；
//       本次改挂 **`Module:Gacha/data` 的 Lua 表**（6 期，实测可达）。⚠️ 最新一期 2026-07-08 止
//       → 抓取时刻（2026-10-02）已全部过期 → **如实返回 null（未公布）**，仍不硬凑过期档期。
//   · `kedr`（雪松）—— 取代/补强 **P6** 的 kedr：P6 主源是社区归档页 `往期动员【常驻】—1.0.0—`
//       （4 期全在 2026-06~07，已过期）+ 备选 `卡池信息`（台架测试占位）；
//       本次改挂 **`Template:首页游戏版本内容`**（当期面板，2026/10/02~10/09 **覆盖当前**）。
//       P6 的备选源 `kedr-kaxi`（已登记在 registry-extras.js 的 EXTRA_GACHA_FETCHERS）**保留**在 altSources 里。
//
// ── 抓取证据（2026-10-02 实抓；夹具全部为真响应，见 test/capture-p8.mjs 的限速重试逻辑）──
//   fixtures/p8-zspms-ask       HTTP 200 / 20,470B  SMW ask 命中 **40 条**；最新 = 《远信回响》/ 时间=20260922
//   fixtures/p8-zspms-notice    HTTP 200 / 42,908B  `parse.wikitext["*"]` 正文 9,846B → 28 条档期（6 卡池 + 22 活动）
//   fixtures/p8-czn-module      HTTP 200 /  1,591B  Lua 表 **6 期**（0001~0006，2026-05-28 ~ 2026-07-08）
//   fixtures/p8-kedr-template   HTTP 200 /  3,750B  `{{时间进度条}}` **5 条** → 2 卡池 + 3 活动
//   fixtures/p8-czn-record      HTTP 200 /    423B  备选页 `卡池记录` 的模板调用 1 条（2026/03，已过期）
//
// ── 当期可用性（"当期" = 档期覆盖 now）──────────────────────────────────────
//   zspms.gacha  ✅ 覆盖（最新公告的研发池档期 09-24 ~ 11-05）
//   zspms.event  ✅ 覆盖（同公告的版本内限时内容档期）
//   czn.gacha    ❌ Lua 最新一期止于 2026-07-08 → **如实 null**（解析函数仍能解出全部 6 期，测试有覆盖）
//   kedr.gacha   ✅ 覆盖（【精英集结·支援】/【演习·联合领】 10-02 05:00 ~ 10-09 05:00）
//   kedr.event   ✅ 覆盖（个人剧情活动第1期 09-25 ~ 10-09 等 3 条）
//
// ── 时区：三源一律 Asia/Shanghai，**均为推测**（源站都没有时区标注）────────────────
//   旁证：zspms 停服维护 05:00~11:00、日切 05:00；czn 10:00 开池 / 02:00 关池；kedr 每期 05:00 换池。
//
// ── mode 一律 "proxy" ──
//   实测定论：bwiki 全系响应 **无 ACAO**，不在"实测放行的三源"（umapyoi / sekai / bushimo）之内
//   → 不能声明 direct（test/all.mjs 有守卫）。
//   ⚠️ 另有一条运行期注意：bwiki 走腾讯 EdgeOne WAF，**请求过密会返回 HTTP 567 挑战页（非 JSON）**。
//      本批 zspms 的抓取器是**两步请求**（ask → parse 正文），且卡池/活动两侧各自独立调用
//      → 一次刷新最多 4 个请求。若被 WAF 拦下，`fetchJson` 会抛 bad-json / proxy-http-567，
//      **表现为"该侧抓取失败"而不是"未公布"**（这正是我们要的语义，不会误导用户）。
//
// ── kind 一律 "wiki" ──
//   三源都是 bwiki 社区编辑维护的页面/模块（非官方 API、非官方公告），故记 `wiki`。

import {
	gachaZspms, eventsZspms,
	gachaCzn,
	gachaKedrTemplate, eventsKedrTemplate,
	ZSPMS_ASK_URL, CZN_MODULE_URL, KEDR_TEMPLATE_URL,
	ZSPMS_TZ, CZN_TZ, KEDR_TZ
} from "./parsers/bwiki-wikitext.js";

const WIKI = (url, fetcher) => ({ url, fetcher, kind: "wiki", mode: "proxy" });

export const SOURCES_P8 = [
	{
		// ⚠️ 就地覆盖 B2 的 `zspms`（原挂 `研发记录` 的 HTML 表，停在 2024Q1）
		id: "zspms",
		name: "战双帕弥什",
		tz: ZSPMS_TZ,                                        // Asia/Shanghai（**推测**）
		// 卡池 + 活动都读**同一份**「版本更新公告」（SMW ask 找最新版本公告 → 取其 wikitext 正文）：
		//   · 卡池 = 正文里「在<窗口>时间段内，通过…研发池产出/获得」的 6 个研发池
		//   · 活动 = 正文里带时间标签（活动时间/开放时间/开启时间…）的版本内限时内容（22 条）
		// url 传 **SMW ask 索引**；第 2 步的 `prop=wikitext` 页面 URL 由抓取器按页面名自行推导。
		gacha: WIKI(ZSPMS_ASK_URL, gachaZspms),
		event: WIKI(ZSPMS_ASK_URL, eventsZspms)
		// ⚠️ 不登记 altSources：旧 `研发记录` 页的抓取器 `gachaZspms` 在 parsers/bwiki.js 里，
		//    但**没有登记进 registry-extras.js 的 EXTRA_GACHA_FETCHERS**（那是 Lead 的文件，本批不动）
		//    → 登记会触发 registry.js 的备选源守卫。旧页实测停在 2024Q1，也无保留价值。
	},
	{
		// ⚠️ 就地覆盖 B2 的 `czn`（原挂 `卡池记录` 的 HTML，实测空页）
		id: "czn",
		name: "卡厄斯梦境",
		tz: CZN_TZ,                                          // Asia/Shanghai（**推测**）
		// ⚠️ 页面名是 `Module:Gacha/data`，但返回的 `parse.title` 是 **`模块:Gacha/data`**（中文别名）——
		//    不要用 title 反查页面名，也别改 URL 的大小写/分隔符。
		// ⚠️ 最新一期 2026-6-17 ~ 2026-7-08 已过期（抓取时刻 2026-10-02）→ 当期语义下**如实返回 null**。
		//    只有卡池侧：该 Lua 模块只登记"营救概率提升"卡池，没有活动档期。
		gacha: WIKI(CZN_MODULE_URL, gachaCzn)
	},
	{
		// ⚠️ 就地覆盖/补强 P6 的 `kedr`（P6 主源 `往期动员【常驻】` 归档页已全过期）
		id: "kedr",
		name: "雪松",
		tz: KEDR_TZ,                                         // Asia/Shanghai（**推测**）
		// 两侧都读 `Template:首页游戏版本内容` 的 `{{时间进度条|开始时间=…|结束时间=…|名称=…}}`：
		//   卡池 = 名称含 `精英集结`/`演习`（雪松抽卡叫「动员」）
		//   活动 = 名称含 `活动`/`赛季`/`通行证`/`剧情`
		// ⚠️ **URL 必须带 `Template:` 前缀**：不带前缀返回 `{"code":"missingtitle"}`（HTTP 仍 200）。
		gacha: WIKI(KEDR_TEMPLATE_URL, gachaKedrTemplate),
		event: WIKI(KEDR_TEMPLATE_URL, eventsKedrTemplate),
		// 保留 P6 的备选源（B2 原 `kedrgame` 条目吸收来的 `卡池信息` 台架测试占位页）：
		// 键 `kedr-kaxi` 已登记在 registry-extras.js 的 EXTRA_GACHA_FETCHERS，registry.js 的守卫可过。
		// 若 Lead 决定不要这条备选，删掉 altSources 即可（不影响本批其它内容）。
		altSources: [
			{
				label: "Bwiki 卡池信息（台架测试占位）",
				url: "https://wiki.biligame.com/kedrgame/api.php?action=parse&page=卡池信息&prop=text&format=json&formatversion=2",
				fetcher: "kedr-kaxi"
			}
		]
	}
];

export function findSourceP8(id) { return SOURCES_P8.find((s) => s.id === id) || null; }
export function listIdsP8() { return SOURCES_P8.map((s) => s.id); }
