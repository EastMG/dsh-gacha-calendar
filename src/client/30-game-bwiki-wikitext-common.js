// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-bwiki-wikitext.js
// ─────────────────────────────────────────────────────────────────────────────
// src/client/35-parsers-bwiki-wikitext.js
//
// 由 next-sources/parsers/bwiki-wikitext.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_bwiki-wikitext__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-bwiki-wikitext.js —— 批次 P8：三个 bwiki 来源的**wikitext 形态**解析器
//
// 本文件只装 P8 的三个来源（**不动** parsers/bwiki.js —— 那是 B2 的 `prop=text` HTML 形态）：
//   ① 战双帕弥什 zspms   —— 两步：SMW `action=ask` 索引 → 取最新「版本更新公告」→ `prop=wikitext` 正文
//   ② 卡厄斯梦境 czn     —— 一步：`Module:Gacha/data` 的 **Lua 表**（`prop=wikitext`）
//   ③ 雪松 kedrgame      —— 一步：`Template:首页游戏版本内容` 的 **模板调用**（`prop=wikitext`）
//
// 契约（与 CONVENTIONS.md / 插件 40-fetchers.js 完全一致）：
//   async (url, signal, tz, now = nowMs()) → 数据对象 | null
//     · 卡池侧 { banner, roles, bannerDates, bannerDatesRaw, startTs, endTs, bannerHover }
//     · 活动侧 { event, eventDates, eventDatesRaw, eventHover }
//   `now` 一律**第 4 个参数**（铁律 2：本仓库历史上把 now 放第二位 → `startTs <= now` 恒假 → 静默"未公布"）。
//   覆盖 now 的档期一条都没有 → **返回 null（未公布）**，绝不硬凑过期档期；结构性损坏才 throw。
//
// ══ 抓取证据（2026-10-02 实抓，夹具全部为真响应）══════════════════════════════
//   fixtures/p8-zspms-ask        HTTP 200 / 20,470B  SMW ask 命中 **40 条**，最新《远信回响》20260922
//   fixtures/p8-zspms-notice     HTTP 200 / 42,908B  parse.wikitext["*"] 正文 9,846B
//   fixtures/p8-czn-module       HTTP 200 /  1,591B  Lua 表 **6 期**（0001~0006）
//   fixtures/p8-kedr-template    HTTP 200 /  3,750B  `时间进度条` **5 条**
//   fixtures/p8-czn-record       HTTP 200 /    423B  备选页 `卡池记录`（模板调用 1 条，2026/03）
//
// ⚠️ bwiki 反爬（EdgeOne WAF）：请求发太密会被拦成 **HTTP 567**（≈7KB JS 挑战页、非 JSON、页内含 requestId）。
//    实测只带 UA 也能 200，**不是请求头问题** → 抓夹具要 6~10s 间隔 + 退避重试 + 校验 body 是 JSON
//    （见 test/capture-p8.mjs）。运行期若某侧抛 `bad-json`/`proxy-http-567`，那是 WAF，不是"未公布"。
//
// ══ 时区：三个来源一律 Asia/Shanghai（**均为推测**）═══════════════════════════
//   源站**都没有**时区标注。旁证：
//     · zspms 停服维护 05:00~11:00、卡池日切 05:00（国服特征）；公告尾部写「2026年9月22日」
//     · czn `10:00:00` 开池 / `02:00:00` 关池（国服作息）
//     · kedr 每期都在 `05:00` 换池（与 P6 的雪松社区页同款旁证）
//   故记"推测"，注册表注释里同样标注。
//
// ══ 「版本更新后」这类**相对起点**的锚点策略（重要，与任务书略有出入，理由在此）══
//   stellasora.js 的先例：相对起点没有绝对时刻 → 用**该公告的发布时间**当锚点 + 标 `startInferred: true`。
//   本文件沿用该精神（相对起点必须有据可依的锚点、必须标 inferred、绝不假造时刻），但锚点优先级更细：
//     ① 源站**自己写明的停服维护窗口**的结束时刻（`…将于2026年9月24日05:00 - 11:00进行"远信回响"版本更新的停服维护`）
//        —— "版本更新后"就是维护结束之后，这是**源站原文给的绝对锚点**，比公告发布日期精确 2 天；
//     ② 兜底：公告 `{{公告|时间=YYYYMMDD}}` 字段（**= stellasora 先例的"公告发布时间"**，本夹具里是 20260922）；
//     ③ 再兜底：该相对点**自带的日期**（`2026年9月24日版本更新后`）按当日 00:00（防御性；只要正则匹配到相对点，
//        ② 的公告时间字段就一定存在，故这条实际到不了，保留以防字段被源站删除）。
//   三条路径**都**标 `startInferred: true`，并把推断依据留在**数据字段**（`startFrom`/`startRel`）与代码注释里。
//   ⚠️ 悬停**不写**推断依据（用户 2026-10-03：「悬停里的元信息彻底删掉」）——悬停只放名称/角色/档期，
//   与本体 buildPoolHover / buildEventHover 同格式（见下面 "当期挑选 / 悬停" 区域）。
//   （若坚持"一律用发布时间"，只需删掉 ns_bwiki_wikitext_zspmsMaintenanceWindow 的调用。兜底锚点行为不受悬停改动影响。）


//#region 通用：MediaWiki `prop=wikitext`（fetchMediaWikiText 只取 parse.text，这里要 parse.wikitext）
// 实测两种返回形态都要兼容：
//   · 本项目抓到的 bwiki 是 `{"parse":{"title":…,"wikitext":{"*":"正文"}}}`（对象包一层 `"*"`）
//   · 部分 MediaWiki（如 fgo.wiki 的某些配置）直接给字符串 → 也兼容
function ns_bwiki_wikitext_mediaWikiWikitext(json) {
	const p = json && json.parse;
	if (!p) return null;
	const wt = p.wikitext;
	if (typeof wt === "string") return wt;
	if (wt && typeof wt === "object" && typeof wt["*"] === "string") return wt["*"];
	return null;
}
// 带 Referer 请求（浏览器真实会带；bwiki 的 EdgeOne WAF 拦的主要是"频率"，但少一个 bot 信号没坏处）。
// ⚠️ 夹具测试不受影响：离线 harness 只读代理 URL 里的 `url` 参数，忽略 referer。
async function ns_bwiki_wikitext_fetchWikitext(url, signal, referer = "") {
	const json = await fetchJson(url, { referer, signal, mode: "proxy" });
	const wt = ns_bwiki_wikitext_mediaWikiWikitext(json);
	if (wt == null) throw new Error("bad-json");     // 含 missingtitle（HTTP 仍 200）→ 结构性损坏
	return wt;
}
//#endregion

//#region 通用：当期挑选 / 悬停
// ── 悬停排版（用户 2026-10-03 方案 A）────────────────────────────────────────
// 用户反馈「新增游戏的面板外显/悬停的样式、格式、规则和原来的差别很大」。本文件此前各写各的悬停，
// 三类偏差全中：① 首行塞元信息（来源站名/URL/SMW 时间/tz 推定/抓取条数/维护锚点）；
// ② 「档期在前、名称在后」；③ 自拼档期文本而非 fmtWindow。
// 修法：**排版一律交给 lib/env.js 的共用工具**（压平后见 28-parser-hover-tools.js；与本体 buildPoolHover / buildEventHover 逐字一致），
// 本区域只负责把解析结果映射成入参；悬停里**只剩** 名称/角色/档期。
// ⚠️ 元信息（来源站名、域名/URL、API/页面名、时区推定、抓取条数、内部 id、SMW 时间、起点锚点、
//    「起点推断」注记、游戏名+区服前缀、任何「（…）」实现说明）**直接删掉**，不搬家、不进任何字段。
//    实现说明只留在**代码注释**与数据字段（startInferred/startFrom/startRel）里，供测试与排查用。
function ns_bwiki_wikitext_nowOf(now) { return typeof now === "number" && Number.isFinite(now) ? now : nowMs(); }
// 覆盖 now 的条目（起点/终点都有绝对时刻才进候选；缺任一端的不产出）
function ns_bwiki_wikitext_activeItems(items, now) {
	return items.filter((it) => it.endTs != null && it.startTs != null && coversNow(it, now));
}
// 卡池条目 → `hoverPool` 入参。`name` = 池名原文（工具用它判空/兜底），`label` = 外显同构的「池名：角色」
// （逐字照本体调用方：src/client/30-parsers.js 的 selectArknights（压平后见 30-game-hypergryph.js）的 `label: `${it.banner}：${it.roles}``）。
// ⚠️ 战双的池名形如「时崎狂三狙击 / 命运时崎狂三狙击」——**原样**当池名用，不自己编角色名。
function ns_bwiki_wikitext_poolItem(x) {
	const name = String(x.banner == null ? "" : x.banner).trim();
	const roles = String(x.roles == null ? "" : x.roles).trim();
	return {
		name,
		label: roles ? `${name}：${roles}` : name,
		startTs: x.startTs,
		endTs: x.endTs,
		raw: x.raw || ""
	};
}
// 活动条目 → `hoverEvent` 入参：显示的是**活动名**（不是「活动时间」这类标签）+ 档期。
function ns_bwiki_wikitext_eventItem(x, nameOf) {
	return { name: nameOf(x), startTs: x.startTs, endTs: x.endTs, raw: x.raw || "" };
}
// 卡池侧载荷。cmp 决定"外显"优先序；默认 = 结束最早优先（越快结束越该盯住，与 bwiki.js 同口径）。
// 悬停一律走共用 `hoverPool`：≥2 池 → 每池「池名：角色」行 + 档期行（窗口全同则只写一次档期）；
// **<2 池 → 不设 bannerHover**（交回 UI 的「banner：roles」⏎「档期」两行式兜底，与本体约定一致）。
function ns_bwiki_wikitext_gachaPayload(items, tz, now, opts = {}) {
	const act = ns_bwiki_wikitext_activeItems(items, now);
	if (act.length === 0) return null;                       // 有候选但都不覆盖当期 → 未公布（不硬凑过期档期）
	const sorted = act.slice().sort(opts.cmp || ((a, b) => (a.endTs - b.endTs) || ((a._i || 0) - (b._i || 0))));
	const first = sorted[0];
	const hover = hoverPool(sorted.map(ns_bwiki_wikitext_poolItem), tz);
	const out = {
		banner: first.banner,
		roles: first.roles || "",
		bannerDates: fmtWindow(first.startTs, first.endTs, tz),
		bannerDatesRaw: first.raw || "",
		startTs: first.startTs,
		endTs: first.endTs
	};
	if (hover) out.bannerHover = hover;
	return out;
}
// 活动侧载荷。cmp 决定外显优先序；悬停列出**全部覆盖当期**的条目（按同一排序，**名称在前**）。
// 悬停一律走共用 `hoverEvent`（名称 + 3 空格 + 档期；不排序，由调用方排好）：
// **<2 条 → 不设 eventHover**（交回 UI 的「event」⏎「eventDates|raw」兜底）。
function ns_bwiki_wikitext_eventPayload(items, tz, now, opts = {}) {
	const act = ns_bwiki_wikitext_activeItems(items, now);
	if (act.length === 0) return null;
	const sorted = act.slice().sort(opts.cmp || ((a, b) => (a.endTs - b.endTs) || (a.startTs - b.startTs) || ((a._i || 0) - (b._i || 0))));
	const first = sorted[0];
	const nameOf = opts.nameOf || ((x) => x.name || x.event || "");
	const hover = hoverEvent(sorted.map((x) => ns_bwiki_wikitext_eventItem(x, nameOf)), tz, opts.permanentCount || 0);
	return {
		event: nameOf(first),
		eventDates: fmtWindow(first.startTs, first.endTs, tz),
		eventDatesRaw: first.raw || "",
		...(hover ? { eventHover: hover } : {})
	};
}
//#endregion
