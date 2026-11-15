// src/client/30-game-bwiki-batch5.js —— 第五批（2026-11-15）：4 款 bwiki 游戏（**卡池侧为主，gwdz 另接活动侧**）
//
//   id           游戏        slug        取数形态（2026-11-15 实测）                         请求数
//   langrisser   梦幻模拟战  langrisser  SMW `action=ask` 查 `分类:召唤`（名称/开始/结束/项目）   1
//   crashfever   CrashFever  crashfever  SMW `action=ask` 查 `类别::卡池`（标题/时间/结束时间/类别） 1
//   bfzy         百分之一    bfzy        页面 `历史卡池` 的 wikitext 表格（更新日/卡池/新UP/上期UP） 1
//   gwdz         怪物弹珠    gwdz        ① `Data:GachaConfig.json`（**JSON 直读**，卡池名/启用/起止）
//                                        ② `Widget:游戏活动日历` 的 `CALENDAR_DATA.events`（活动侧） 1+1
//
// ── 为什么四款合成一个文件（而不是四份）────────────────────────────────────────
// 2026-10-03 起本仓库的惯例是「每款/每组游戏一个**自包含**文件」；同批接入、共用同一套
// 「bwiki 时间锚 → 绝对窗口」口径的几款放一个文件，与 `30-game-batch2.js` / `30-game-batch3.js`
// （第三批两款）/ `30-game-idolmaster.js`（四款一个文件）同性质。**符号名一律 `ns_<游戏>_` 前缀**，
// 且复用公共层：`fetchJson` / `stripTags` / `sourceInstant` / `fmtWindow` / `coversNow` 与
// `30-game-bwiki-common.js` 的载荷生成器（`ns_bwiki_batchGachaPayloadOf` / `ns_bwiki_eventPayload`）。
// **没有**第二套「当期判定」、也没有第二套悬停排版。
//
// ── 源站事实（2026-11-15 实测；夹具见 test/fixtures/b5-*）────────────────────────
// ⚠️ bwiki 对无 `Referer` 的裸请求回 567（WAF 挑战页）⇒ 每个请求都必须带
//    `Referer: https://wiki.biligame.com/`（统一走 `fetchJson(..., { referer })`，bwiki 主机由
//    `15-env.js` 收口改走宿主代理 —— 与既有 bwiki 源同一条通道）。
//
// ① langrisser / 梦幻模拟战（国服 wiki，内容中文）
//    GET …/langrisser/api.php?action=ask&format=json&query=<enc>
//    query = `[[分类:召唤]][[开始::+]]|?名称|?开始|?结束|?项目|sort=开始|order=desc|limit=100`
//    `action=ask` 一页**默认只回 50 条**且默认按页面名（最老在前）⇒ 必须 `sort=开始|order=desc`，
//    否则最新一期永远不在第一页（与深空之眼 dhmmr 同一个坑，实测）。
//    属性类型：`名称` `_txt`、`开始`/`结束` `_dat`、`项目` `_txt`（多值 ⇒ `["妮","红莲"]`）。
//    `_dat` 的 printout = `[{ timestamp, raw }]`，raw 形如 `1/2026/9/10`（首段恒为 1，其后 y/m/d/H/i）。
//    实测最新一期：`召唤/20260910/炽潮双刃，斩浪焚海` = 2026-09-10 ~ 2026-10-14（2026-11-15 已结束
//    ⇒ 本轮活网返回 null，符合「当期没有 ⇒ null」；夹具把 now 钉在 2026-09-20 断言在期那一期）。
//    `项目` = 本期 UP 角色（多值）⇒ 当 `roles`（不是池名重复）。
// ② crashfever / CrashFever（中文 wiki）
//    GET …/crashfever/api.php?action=ask&format=json&query=<enc>
//    query = `[[类别::卡池]]|?标题|?时间|?结束时间|?类别|limit=500`
//    `类别` 是**属性**（不是分类），值为 `卡池`；`时间`/`结束时间` 都是 `_dat`（raw 带时分）。
//    实测 166 行、**一次拿全**（`limit=500` 生效、无 `query-continue-offset`）。页「添加卡池预设」
//    是模板页，printouts 没有时间 ⇒ 解析时跳过（结构性坏行 ≠ 结构损坏）。
//    页 `超Fever祭典【傅柯】` 的 wikitext（`{{卡池信息|时间=…|结束时间=…}}`）与 ask 结果逐字一致。
// ③ bfzy / 百分之一（国服 wiki）
//    GET …/bfzy/api.php?action=parse&page=历史卡池&prop=wikitext&format=json&formatversion=2
//    正文是一张 `wikitable`（2022-10 ~ 2026-09，**530 行**，按年分 5 张表）：`更新日期 | 卡池 | 新UP | 上期UP`。
//    更新日期两种写法：`[[9月7号更新说明|2026-09-04]]`（带公告链接）与裸 `2025-08-22`；新UP 有
//    `'''粗体'''` / `'''[[链接]]'''` 两种写法（粗体 = 当期新上架，标题里已说明）。
//    ⚠️ 表里**只有「更新日」一个时间锚**（没有结束时间）⇒ 窗口按「表内相邻更新日」构造：
//       起 = 更新日 00:00，止 = **下一期更新日 00:00**；最新一期没有下一期 ⇒ 按源站「每周一轮换」
//       （抽卡页：每周一 15:30~18:30 例行维护后轮换；表内 2026 各行相邻均 7 天）推 `+7 天`。
//       这条推定只影响「最新一期的止」，来源与依据写在这里；`raw` 仍只写源站原文的更新日。
//    实测最新更新日 2026-09-04 ⇒ 2026-11-15 当期 null（夹具把 now 钉在 2026-09-05 断言在期那一期）。
// ④ gwdz / 怪物弹珠（中文 wiki；游戏是日版内容、wiki 用中文写）
//    ① 卡池：GET …/gwdz/api.php?action=parse&page=Data:GachaConfig.json&prop=wikitext&format=json&formatversion=2
//       `parse.wikitext` 是**一份 JSON 字符串**（不是 HTML）⇒ `JSON.parse` 后取 `卡池列表`：
//       每条 `{ 名称, 启用, 启用时间, 关闭时间, 相对路径, 引用卡池列表? }`。
//       `启用:false` 的是模板条目（`池基础` / `友情抽` / `4星基础-暗`）⇒ 跳过。
//       `关闭时间` 为 **`9999/9/9 99:59` 哨兵**（常驻池：彩兽神祭/超兽神祭/…）⇒ `endTs = null`
//       （仓库口径：终点未知**不算**当期；事实仍保留在条目里）。
//       实测在期：`物语` = 无职转生Ⅲ联动-6星3体up，2026/11/15 11:00 ~ 2026/12/02 10:59。
//    ② 活动：GET …/gwdz/api.php?action=parse&page=Widget:游戏活动日历&prop=wikitext&format=json&formatversion=2
//       正文里是 `var CALENDAR_DATA = { meta, categories, events:[…] }`（**wiki 自己的活动日历数据**，
//       页内注释明写「更新：只改下面 CALENDAR_DATA 里的 events 数组」）。每个事件
//       `{ start, end, time, endTime, title, type, recur? }`；带 `recur` 的是每月轮换（无具体窗口）⇒ 跳过。
//       ⚠️ 为什么不是 `#ask`：该 wiki 的活动记事（`分类:活动记事`）是**月份总览页**，
//       `{{活动记事}}` 用 `{{#set:}}` 写在**页面上**（不是子对象）⇒ SMW 的 printouts 是
//       页面级多值数组（`活动期间` / `活动全称` / `活动类型` 各存一份），**无法把「名称 ↔ 期间 ↔ 类型」配成一行**；
//       实测 `[[分类:活动记事]][[活动期间::>2026/11/01]]` 连日期过滤都不生效（`_txt` 类型）。
//       所以活动侧取 wiki 自己的 `CALENDAR_DATA`（结构化、按事件配对、页内自述为维护入口）。
//
// ── 时区 ───────────────────────────────────────────────────────────────────────
// 四款都是**中文 wiki**（内容中文），wiki 站点自身 `timezone` 实测 `Asia/Shanghai`（siteinfo），
// 未见任何「台服/日服墙钟」标注 ⇒ 四条一律 `tz = "Asia/Shanghai"`（任务书：默认上海，改需证据）。
//
// ── 失败语义（与全仓一致）──────────────────────────────────────────────────────
//   · HTTP 非 2xx / 响应不是 JSON ⇒ **抛**（`fetchJson` 自己抛 `http-…` / `bad-json`）；
//   · 结构变（没有 `query.results` / `parse.wikitext` / `卡池列表` / `CALENDAR_DATA` / 一行都解不出）
//     ⇒ **抛**（带 `<id>:<形态>` 前缀，便于来源健康里一眼看出是哪种损坏）；
//   · 解出来了、但没有任何一条覆盖当前时刻 ⇒ 返回 `null`（未公布，不硬凑过期档期）。
//   · 单条行缺时间锚（页模板 / 哨兵终点）⇒ 跳过或 `endTs=null`，**不**因此抛错。

//#region 共用：bwiki 时间锚 → 墙钟点 → 绝对时刻
const ns_b5_REFERER = "https://wiki.biligame.com/";

// printout / 文本 → `{ y, mo, d, h, mi }`（h/mi = null 表示源站只有日期）。
// 兼容三种实测形态：
//   · `_dat` printout：`[{ timestamp, raw }]`，raw = `1/2026/9/10`（首段恒 1，其后 y/m/d/H/i/s/…）
//   · `_txt` printout（字符串数组）：`["2026-07-23"]`
//   · 普通文本：`2026/11/15 11:00` / `2026-11-15` / `20261115`
function ns_b5_pointOfText(text) {
	const s = String(text == null ? "" : text).trim();
	if (!s) return null;
	// bwiki `_dat.raw`：`1/2026/9/10` / `1/2026/11/12/15/0/0/0`（首段恒为 1）
	const p = s.split("/");
	if (p.length >= 4 && /^\d{4}$/.test(p[1])) {
		const h = p.length > 4 && p[4] !== "" ? +p[4] : null;
		const mi = p.length > 5 && p[5] !== "" ? +p[5] : null;
		return { y: +p[1], mo: +p[2], d: +p[3], h, mi };
	}
	const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(s);
	if (m) return { y: +m[1], mo: +m[2], d: +m[3], h: m[4] == null ? null : +m[4], mi: m[5] == null ? null : +m[5] };
	const m2 = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
	if (m2) return { y: +m2[1], mo: +m2[2], d: +m2[3], h: null, mi: null };
	return null;
}
function ns_b5_pointOfPrintout(v) {
	const first = Array.isArray(v) ? v[0] : v;
	if (first == null) return null;
	if (typeof first === "string") return ns_b5_pointOfText(first);
	if (typeof first === "number") return null;
	if (typeof first === "object") {
		// `_dat` 的 `raw` 是源站墙钟原样（`1/2026/9/10`）；`timestamp` 只是兜底（UTC 秒）
		if (typeof first.raw === "string") {
			const p = ns_b5_pointOfText(first.raw);
			if (p) return p;
		}
		if (typeof first.timestamp === "number" && Number.isFinite(first.timestamp)) {
			// 兜底：时间戳是绝对时刻，按源站 tz 取墙钟（本站 tz = Asia/Shanghai，与 SMW 存储时区一致）
			return null;
		}
	}
	return null;
}
// 点 → 绝对时刻。起：只有日期 ⇒ 00:00；止：只有日期 ⇒ 23:59（仓库通用约定）。
function ns_b5_tsOf(point, isEnd, tz) {
	if (!point) return null;
	if (point.h != null) return sourceInstant(point.y, point.mo, point.d, point.h, point.mi == null ? 0 : point.mi, tz);
	return isEnd
		? sourceInstant(point.y, point.mo, point.d, 23, 59, tz)
		: sourceInstant(point.y, point.mo, point.d, 0, 0, tz);
}
// 点 → `YYYY-MM-DD` / `YYYY-MM-DD HH:MM`（**只改写法不改数值**；工具提示用）
function ns_b5_stampOf(point) {
	const two = (n) => String(n).padStart(2, "0");
	const d = `${point.y}-${two(point.mo)}-${two(point.d)}`;
	return point.h == null ? d : `${d} ${two(point.h)}:${two(point.mi == null ? 0 : point.mi)}`;
}
// printout 值 → 首个非空字符串（`["a","b"]` / `[{raw}]` / `"a"` 都吃）
function ns_b5_textOf(v) {
	if (v == null) return "";
	if (typeof v === "string") return v.trim();
	if (typeof v === "number") return String(v);
	if (Array.isArray(v)) { for (const x of v) { const s = ns_b5_textOf(x); if (s) return s; } return ""; }
	if (typeof v === "object") {
		if (typeof v.raw === "string" && v.raw.trim() !== "") return v.raw.trim();
		if (typeof v.fulltext === "string") return v.fulltext.trim();
		if (typeof v["*"] === "string") return v["*"].trim();
	}
	return "";
}
// printout 多值 → 字符串数组
function ns_b5_listOf(v) {
	const arr = Array.isArray(v) ? v : (v == null ? [] : [v]);
	return arr.map((x) => ns_b5_textOf(x)).map((x) => x.trim()).filter(Boolean);
}
// wikitext 片段 → 纯文本（去 HTML / 去 `'''` 粗体 / `[[a|b]]` 取 b / `[[a]]` 取 a）
function ns_b5_plainOf(text) {
	let s = String(text == null ? "" : text);
	s = s.replace(/<[^>]*>/g, "");
	s = s.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2").replace(/\[\[([^\]]*)\]\]/g, "$1");
	s = s.replace(/'''/g, "").replace(/''/g, "");
	return s.replace(/\s+/g, " ").trim();
}
// SMW ask 的公共取数：`query.results` 不在 ⇒ 结构损坏（`{}` / 改版都走这条）
function ns_b5_resultsOf(json, tag) {
	const results = json && json.query && json.query.results;
	if (!results || typeof results !== "object" || Array.isArray(results)) throw new Error(tag + ":bad-json");
	return results;
}
//#endregion

//#region ① 梦幻模拟战（langrisser）：SMW `分类:召唤`（卡池侧）
const ns_langrisser_TZ = "Asia/Shanghai";
const ns_langrisser_PAGE = "召唤";
const ns_langrisser_KEY_NAME = "名称";
const ns_langrisser_KEY_START = "开始";
const ns_langrisser_KEY_END = "结束";
const ns_langrisser_KEY_UP = "项目";
// `sort=开始|order=desc` 是**必需**的（默认只回最老 50 条，见文件头）；`limit=100` 覆盖最近 ~3 个月。
const ns_langrisser_QUERY = `[[分类:${ns_langrisser_PAGE}]][[${ns_langrisser_KEY_START}::+]]`
	+ `|?${ns_langrisser_KEY_NAME}|?${ns_langrisser_KEY_START}|?${ns_langrisser_KEY_END}|?${ns_langrisser_KEY_UP}`
	+ `|sort=${ns_langrisser_KEY_START}|order=desc|limit=100`;
const ns_langrisser_URL = "https://wiki.biligame.com/langrisser/api.php?action=ask&format=json&query="
	+ encodeURIComponent(ns_langrisser_QUERY);

// ask JSON → 条目事实（纯函数：JSON + tz → 数组，不碰网络 / 时钟）
function ns_langrisser_parseAsk(json, tz = ns_langrisser_TZ) {
	const results = ns_b5_resultsOf(json, "langrisser-ask");
	const rows = [];
	let i = 0;
	for (const [, v] of Object.entries(results)) {
		if (!v || typeof v !== "object") continue;
		const p = v.printouts;
		if (!p || typeof p !== "object") continue;
		const banner = String(ns_b5_textOf(p[ns_langrisser_KEY_NAME])).replace(/\s+/g, " ").trim();
		const sp = ns_b5_pointOfPrintout(p[ns_langrisser_KEY_START]);
		const ep = ns_b5_pointOfPrintout(p[ns_langrisser_KEY_END]);
		if (!banner || !sp || !ep) continue;                            // 单条缺时间锚 ⇒ 跳过（不是结构损坏）
		const startTs = ns_b5_tsOf(sp, false, tz);
		const endTs = ns_b5_tsOf(ep, true, tz);
		if (!(endTs > startTs)) continue;                               // 源站错行 ⇒ 丢掉（不硬造）
		rows.push({
			_i: i++,
			banner,
			roles: ns_b5_listOf(p[ns_langrisser_KEY_UP]).join("、"),
			category: "",
			startTs,
			endTs,
			raw: `${ns_b5_stampOf(sp)} ~ ${ns_b5_stampOf(ep)}`,
			display: fmtWindow(startTs, endTs, tz),
			isMain: true
		});
	}
	if (rows.length === 0) throw new Error("langrisser-ask:no-rows");
	return rows;
}
function ns_langrisser_payloadOf(items, tz, now) {
	return ns_bwiki_batchGachaPayloadOf(Array.isArray(items) ? items : [], tz, now, { id: "langrisser" });
}
async function ns_langrisser_gacha(url, signal, tz = ns_langrisser_TZ, now = nowMs()) {
	const target = String(url == null ? "" : url) === "" ? ns_langrisser_URL : String(url);
	const json = await fetchJson(target, { referer: ns_b5_REFERER, signal, mode: "proxy" });
	return ns_langrisser_payloadOf(ns_langrisser_parseAsk(json, tz), tz, ns_bwiki_nowOf(now));
}
//#endregion

//#region ② CrashFever（crashfever）：SMW `类别::卡池`（卡池侧）
// 2026-11-15 修正：CrashFever 是**日服**（bwiki 首页「日服角色图鉴 / 最新卡池」）——
// SMW 的 `时间` 墙钟按 JST 记（165 口池里 60 口 = 15:00，正是日服换池时刻；
// 同池页内渲染写 14:00 是北京时间的同一时刻）⇒ 条目时区 = Asia/Tokyo。
const ns_crashfever_TZ = "Asia/Tokyo";
const ns_crashfever_KEY_TAG = "类别";
const ns_crashfever_KEY_TITLE = "标题";
const ns_crashfever_KEY_START = "时间";
const ns_crashfever_KEY_END = "结束时间";
const ns_crashfever_QUERY = `[[${ns_crashfever_KEY_TAG}::卡池]]`
	+ `|?${ns_crashfever_KEY_TITLE}|?${ns_crashfever_KEY_START}|?${ns_crashfever_KEY_END}|?${ns_crashfever_KEY_TAG}|limit=500`;
const ns_crashfever_URL = "https://wiki.biligame.com/crashfever/api.php?action=ask&format=json&query="
	+ encodeURIComponent(ns_crashfever_QUERY);

function ns_crashfever_parseAsk(json, tz = ns_crashfever_TZ) {
	const results = ns_b5_resultsOf(json, "crashfever-ask");
	const rows = [];
	let i = 0;
	for (const [, v] of Object.entries(results)) {
		if (!v || typeof v !== "object") continue;
		const p = v.printouts;
		if (!p || typeof p !== "object") continue;
		const banner = String(ns_b5_textOf(p[ns_crashfever_KEY_TITLE])).replace(/\s+/g, " ").trim();
		const sp = ns_b5_pointOfPrintout(p[ns_crashfever_KEY_START]);
		const ep = ns_b5_pointOfPrintout(p[ns_crashfever_KEY_END]);
		if (!banner || !sp || !ep) continue;                            // 模板页（添加卡池预设）没有时间 ⇒ 跳过
		const startTs = ns_b5_tsOf(sp, false, tz);
		const endTs = ns_b5_tsOf(ep, true, tz);
		if (!(endTs > startTs)) continue;
		rows.push({
			_i: i++,
			banner,
			roles: "",
			category: ns_b5_listOf(p[ns_crashfever_KEY_TAG]).join("、"),
			startTs,
			endTs,
			raw: `${ns_b5_stampOf(sp)} ~ ${ns_b5_stampOf(ep)}`,
			display: fmtWindow(startTs, endTs, tz),
			isMain: true
		});
	}
	if (rows.length === 0) throw new Error("crashfever-ask:no-rows");
	// 排序**稳定化**（不是新口径）：同一时刻开的多口池在 SMW 里不保证顺序 ⇒ 按「开始 desc →
	// 结束 asc → 池名」定死，避免外显在同期几口池之间乱跳（同 dhmmr 的理由）
	rows.sort((a, b) => (b.startTs - a.startTs) || (a.endTs - b.endTs) || (a.banner < b.banner ? -1 : a.banner > b.banner ? 1 : 0));
	rows.forEach((r, k) => { r._i = k; });
	return rows;
}
function ns_crashfever_payloadOf(items, tz, now) {
	return ns_bwiki_batchGachaPayloadOf(Array.isArray(items) ? items : [], tz, now, { id: "crashfever" });
}
async function ns_crashfever_gacha(url, signal, tz = ns_crashfever_TZ, now = nowMs()) {
	const target = String(url == null ? "" : url) === "" ? ns_crashfever_URL : String(url);
	const json = await fetchJson(target, { referer: ns_b5_REFERER, signal, mode: "proxy" });
	return ns_crashfever_payloadOf(ns_crashfever_parseAsk(json, tz), tz, ns_bwiki_nowOf(now));
}
//#endregion

//#region ③ 百分之一（bfzy）：页面 `历史卡池` 的 wikitext 表格（卡池侧）
const ns_bfzy_TZ = "Asia/Shanghai";
const ns_bfzy_PAGE = "历史卡池";
const ns_bfzy_URL = "https://wiki.biligame.com/bfzy/api.php?action=parse&page="
	+ encodeURIComponent(ns_bfzy_PAGE) + "&prop=wikitext&format=json&formatversion=2";
// 最新一期没有「下一期」⇒ 按源站「每周一轮换」推 7 天（依据见文件头 ③）
const ns_bfzy_ROTATE_MS = 7 * 24 * 60 * 60 * 1000;

// 表格行 → `{ date, pool, up, prev }`（裸日期与 `[[公告|日期]]` 两种写法都吃）
function ns_bfzy_rowsOf(wikitext) {
	const lines = String(wikitext == null ? "" : wikitext).split(/\r?\n/);
	const rows = [];
	for (const line of lines) {
		const ln = line.trim();
		if (!ln.startsWith("|")) continue;
		const cells = ln.slice(1).split("||").map((x) => x.trim());
		if (cells.length < 4) continue;
		const dm = /(20\d{2})-(\d{2})-(\d{2})/.exec(cells[0]);
		if (!dm) continue;
		const pool = ns_b5_plainOf(cells[1]);
		const up = ns_b5_plainOf(cells[2]);
		if (!pool || !up) continue;
		rows.push({ date: dm[0], pool, up, prev: ns_b5_plainOf(cells[3]) });
	}
	if (rows.length === 0) throw new Error("bfzy-history:no-rows");
	return rows;
}
// 行 → 条目事实：**同一更新日 = 同一期**（3 行：80抽·第1天 / 50抽·第2天 / 50抽·第1天）
function ns_bfzy_parseHistory(wikitext, tz = ns_bfzy_TZ) {
	const rows = ns_bfzy_rowsOf(wikitext);
	const dates = Array.from(new Set(rows.map((r) => r.date))).sort();    // 升序：下一期 = 后一个日期
	const startOf = (d) => {
		const [y, mo, dd] = d.split("-").map(Number);
		return sourceInstant(y, mo, dd, 0, 0, tz);
	};
	const items = [];
	let i = 0;
	for (const r of rows) {
		const k = dates.indexOf(r.date);
		const startTs = startOf(r.date);
		const endTs = k >= 0 && k + 1 < dates.length ? startOf(dates[k + 1]) : startTs + ns_bfzy_ROTATE_MS;
		if (!(endTs > startTs)) continue;
		items.push({
			_i: i++,
			banner: r.pool,                      // 卡池列（80抽·第1天 / 50抽·第2天 / …）
			roles: r.up,                         // 新UP = 当期上架卡（多行同期同窗口 ⇒ 由载荷生成器合并）
			category: r.pool,
			prveUp: r.prev,                      // 上期UP：源站有、面板不用（不新造字段，留给回归断言）
			startTs,
			endTs,
			raw: r.date,                         // 源站原文**只有更新日**（止 = 我们的推定，不进 raw）
			display: fmtWindow(startTs, endTs, tz),
			isMain: true
		});
	}
	if (items.length === 0) throw new Error("bfzy-history:no-window");
	return items;
}
function ns_bfzy_payloadOf(items, tz, now) {
	return ns_bwiki_batchGachaPayloadOf(Array.isArray(items) ? items : [], tz, now, { id: "bfzy" });
}
async function ns_bfzy_gacha(url, signal, tz = ns_bfzy_TZ, now = nowMs()) {
	const target = String(url == null ? "" : url) === "" ? ns_bfzy_URL : String(url);
	const json = await fetchJson(target, { referer: ns_b5_REFERER, signal, mode: "proxy" });
	const wikitext = json && json.parse && json.parse.wikitext;
	if (typeof wikitext !== "string") throw new Error("bfzy-history:bad-json");
	return ns_bfzy_payloadOf(ns_bfzy_parseHistory(wikitext, tz), tz, ns_bwiki_nowOf(now));
}
//#endregion

//#region ④ 怪物弹珠（gwdz）：卡池 = `Data:GachaConfig.json`（JSON 直读）；活动 = 活动日历 `CALENDAR_DATA`
const ns_gwdz_TZ = "Asia/Shanghai";
const ns_gwdz_GACHA_PAGE = "Data:GachaConfig.json";
const ns_gwdz_GACHA_URL = "https://wiki.biligame.com/gwdz/api.php?action=parse&page="
	+ encodeURIComponent(ns_gwdz_GACHA_PAGE) + "&prop=wikitext&format=json&formatversion=2";
const ns_gwdz_CAL_PAGE = "Widget:游戏活动日历";
const ns_gwdz_CAL_URL = "https://wiki.biligame.com/gwdz/api.php?action=parse&page="
	+ encodeURIComponent(ns_gwdz_CAL_PAGE) + "&prop=wikitext&format=json&formatversion=2";
// `关闭时间` 是 `9999/9/9 99:59` 这类哨兵 ⇒ 常驻池（`endTs = null`，见文件头 ④①）
function ns_gwdz_isSentinel(point) {
	return !!point && (point.y >= 9999 || point.mo > 12 || point.d > 31 || (point.h != null && point.h > 23) || (point.mi != null && point.mi > 59));
}
// `parse.wikitext`（JSON 字符串）→ 条目事实
function ns_gwdz_parseConfig(json, tz = ns_gwdz_TZ) {
	const wikitext = json && json.parse && json.parse.wikitext;
	if (typeof wikitext !== "string") throw new Error("gwdz-config:bad-json");
	let cfg;
	try { cfg = JSON.parse(wikitext); } catch { throw new Error("gwdz-config:bad-json"); }
	const list = cfg && cfg.卡池列表;
	if (!list || typeof list !== "object" || Array.isArray(list)) throw new Error("gwdz-config:bad-list");
	const rows = [];
	let i = 0;
	for (const [, v] of Object.entries(list)) {
		if (!v || typeof v !== "object") continue;
		if (v.启用 !== true) continue;                                  // 模板条目（池基础 / 友情抽 / 4星基础-暗）
		const banner = String(v.名称 == null ? "" : v.名称).replace(/\s+/g, " ").trim();
		const sp = ns_b5_pointOfText(v.启用时间);
		if (!banner || !sp) continue;
		const epRaw = ns_b5_pointOfText(v.关闭时间);
		const startTs = ns_b5_tsOf(sp, false, tz);
		const sentinel = ns_gwdz_isSentinel(epRaw);
		const endTs = epRaw && !sentinel ? ns_b5_tsOf(epRaw, true, tz) : null;
		if (endTs != null && !(endTs > startTs)) continue;
		const rawEnd = String(v.关闭时间 == null ? "" : v.关闭时间).trim();
		const rawStart = String(v.启用时间 == null ? "" : v.启用时间).trim();
		rows.push({
			_i: i++,
			banner,
			roles: "",
			category: "",
			startTs,
			endTs,                                                       // 常驻（哨兵）= null：不算当期
			raw: rawEnd ? `${rawStart} ~ ${rawEnd}` : rawStart,          // 源站原文（起止两格各按原样）
			display: endTs == null ? ns_b5_stampOf(sp) : fmtWindow(startTs, endTs, tz),
			isMain: true
		});
	}
	if (rows.length === 0) throw new Error("gwdz-config:no-rows");
	return rows;
}
// ── 活动日历 `CALENDAR_DATA` ───────────────────────────────────────────────────
// 从 JS 对象字面量里取 `events: [ … ]`：**按括号平衡 + 跳过字符串与 // 行注释**切片（不 eval）。
function ns_gwdz_sliceBalance(text, openCh, closeCh, from) {
	let depth = 0;
	for (let i = from; i < text.length; i++) {
		const c = text[i];
		if (c === '"') { i++; while (i < text.length && text[i] !== '"') { if (text[i] === "\\") i++; i++; } continue; }
		if (c === "/" && text[i + 1] === "/") { const n = text.indexOf("\n", i); i = n < 0 ? text.length : n; continue; }
		if (c === openCh) depth++;
		else if (c === closeCh) { depth--; if (depth === 0) return { start: from, end: i, text: text.slice(from, i + 1) }; }
	}
	return null;
}
// `var CALENDAR_DATA = { … };` → 对象字面量文本（找不到 ⇒ 结构损坏）
function ns_gwdz_calendarObjectOf(wikitext) {
	const s = String(wikitext == null ? "" : wikitext);
	const at = s.indexOf("var CALENDAR_DATA");
	if (at < 0) throw new Error("gwdz-calendar:bad-json");
	const objStart = s.indexOf("{", at);
	if (objStart < 0) throw new Error("gwdz-calendar:bad-json");
	const seg = ns_gwdz_sliceBalance(s, "{", "}", objStart);
	if (!seg) throw new Error("gwdz-calendar:bad-json");
	return seg.text;
}
// events 数组 → 逐条对象文本（跳过统一 `recur` 轮换；不 eval，只按花括号切）
function ns_gwdz_eventObjectsOf(objText) {
	// ⚠️ 必须认**属性名** `events:` + `[`（注释里也出现过 "events 数组" 这种字样，
	//    按裸 `indexOf("events")` 会切到 meta.notices 那个数组 —— 2026-11-15 实测踩过）
	const s = String(objText);
	const m = /\bevents\s*:\s*\[/.exec(s);
	if (!m) throw new Error("gwdz-calendar:bad-events");
	const arrStart = m.index + m[0].length - 1;
	const seg = ns_gwdz_sliceBalance(s, "[", "]", arrStart);
	if (!seg) throw new Error("gwdz-calendar:bad-events");
	const arr = seg.text;
	const out = [];
	for (let i = 0; i < arr.length; i++) {
		if (arr[i] !== "{") continue;
		const one = ns_gwdz_sliceBalance(arr, "{", "}", i);
		if (!one) break;
		out.push(one.text);
		i = one.end;
	}
	if (out.length === 0) throw new Error("gwdz-calendar:no-events");
	return out;
}
// 对象文本里取某个 `key: "值"`（只认字符串值；取不到 ⇒ ""）
function ns_gwdz_fieldOf(objText, key) {
	const s = String(objText);
	const re = new RegExp("(?:^|[\\s,{])" + key + "\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
	const m = re.exec(s);
	if (!m) return "";
	return m[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").trim();
}
// `CALENDAR_DATA` → 活动条目事实（纯函数）。单日解禁（`endTime` 空且同一天）⇒ 没有窗口 ⇒ 跳过。
function ns_gwdz_parseCalendar(wikitext, tz = ns_gwdz_TZ) {
	const objects = ns_gwdz_eventObjectsOf(ns_gwdz_calendarObjectOf(wikitext));
	const rows = [];
	let i = 0;
	for (const obj of objects) {
		if (/\brecur\s*:/.test(obj)) continue;                          // 每月轮换：没有具体窗口
		const title = ns_gwdz_fieldOf(obj, "title");
		const startText = ns_gwdz_fieldOf(obj, "start");
		const endText = ns_gwdz_fieldOf(obj, "end");
		const timeText = ns_gwdz_fieldOf(obj, "time") || "00:00";
		const endTimeText = ns_gwdz_fieldOf(obj, "endTime");
		if (!title || !startText) continue;
		const sp = ns_b5_pointOfText(`${startText} ${timeText}`);
		if (!sp) continue;
		const epDay = endText ? ns_b5_pointOfText(endText) : null;
		let ep = null;
		if (epDay && endTimeText) ep = ns_b5_pointOfText(`${endText} ${endTimeText}`);
		else if (epDay && endText !== startText) ep = { ...epDay, h: 23, mi: 59 };
		if (!ep) continue;                                             // 单日解禁 / 维护：一个时刻，不构成窗口
		const startTs = ns_b5_tsOf(sp, false, tz);
		const endTs = ns_b5_tsOf(ep, true, tz);
		if (!(endTs > startTs)) continue;
		const raw = `${ns_b5_stampOf(sp)} ~ ${ns_b5_stampOf(ep)}`;
		rows.push({
			_i: i++,
			event: title,
			kind: ns_gwdz_fieldOf(obj, "type"),
			category: ns_gwdz_fieldOf(obj, "type"),
			startTs,
			endTs,
			raw,
			display: fmtWindow(startTs, endTs, tz)
		});
	}
	if (rows.length === 0) throw new Error("gwdz-calendar:no-window");
	return rows;
}
function ns_gwdz_gachaPayloadOf(items, tz, now) {
	return ns_bwiki_batchGachaPayloadOf(Array.isArray(items) ? items : [], tz, now, { id: "gwdz" });
}
function ns_gwdz_eventPayloadOf(items, tz, now) {
	return ns_bwiki_eventPayload(Array.isArray(items) ? items : [], tz, now, 0, "gwdz");
}
async function ns_gwdz_gacha(url, signal, tz = ns_gwdz_TZ, now = nowMs()) {
	const target = String(url == null ? "" : url) === "" ? ns_gwdz_GACHA_URL : String(url);
	const json = await fetchJson(target, { referer: ns_b5_REFERER, signal, mode: "proxy" });
	return ns_gwdz_gachaPayloadOf(ns_gwdz_parseConfig(json, tz), tz, ns_bwiki_nowOf(now));
}
async function ns_gwdz_events(url, signal, tz = ns_gwdz_TZ, now = nowMs()) {
	const target = String(url == null ? "" : url) === "" ? ns_gwdz_CAL_URL : String(url);
	const json = await fetchJson(target, { referer: ns_b5_REFERER, signal, mode: "proxy" });
	const wikitext = json && json.parse && json.parse.wikitext;
	if (typeof wikitext !== "string") throw new Error("gwdz-calendar:bad-json");
	return ns_gwdz_eventPayloadOf(ns_gwdz_parseCalendar(wikitext, tz), tz, ns_bwiki_nowOf(now));
}
//#endregion

// ── 注册（2026-11-15 第五批 4 条；标签命名沿用「Bwiki + 页面/数据名」的既有风格）──────────────
// 2026-11-15 晚（用户口径）：langrisser / bfzy 的**来源默认置空**（`url: ""` + 不写 `source`
// ⇒ 设置页/面板显示裸「未配置」，一个请求都不发），原 wiki 源降为**备选源**并标「（停更）」：
//   · langrisser：SMW `分类:召唤` 最新一期止于 2026-10-14（之后没有新卡池）⇒ 停更；
//   · bfzy：`历史卡池` 表内最新更新日停在 2026-09-04（之后没有新一期）⇒ 停更。
// 引擎按 `altSources` 的 `fetcher` 键路由（主源不抓、只在用户手动切过去时抓）；抓取器函数
// 直接**别名登记**，不另造第二份实现。`defaultHidden` 保持 `false` ——「置空」= 来源未配置，
// 不是整条隐藏（面板仍占一行、显示「未配置」）。
registerSource({
	id: "langrisser",
	defaultHidden: false,
	tz: "Asia/Shanghai",
	name: "梦幻模拟战",
			icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/71/f6/6e/71f66e00-6fdc-5f63-76bc-3ea3389d03c5/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/512x512bb.jpg",
	url: "",
	altSources: [{
		label: "Bwiki 召唤一览（停更）",
		url: ns_langrisser_URL,
		fetcher: "langrisser-stopped"
	}],
	eventUrl: ""
});
registerSource({
	id: "crashfever",
	defaultHidden: false,
	tz: ns_crashfever_TZ,
	name: "CrashFever·日服",
			icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/96/9a/78/969a78f3-9c5f-e0d8-23bd-db2153b133ad/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
	url: ns_crashfever_URL,
	source: "Bwiki 卡池一览",
	eventUrl: ""
});
registerSource({
	id: "bfzy",
	defaultHidden: false,
	tz: "Asia/Shanghai",
	name: "百分之一",
			icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/83/a4/e4/83a4e4f5-ce7f-1b6f-aab8-ae53746722fc/AppIcon-1x_U007emarketing-0-6-0-85-220-0.png/512x512bb.jpg",
	url: "",
	altSources: [{
		label: "Bwiki 历史卡池（停更）",
		url: ns_bfzy_URL,
		fetcher: "bfzy-stopped"
	}],
	eventUrl: ""
});
registerSource({
	id: "gwdz",
	defaultHidden: false,
	tz: "Asia/Shanghai",
	name: "怪物弹珠·日服",
			icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/cb/99/e6/cb99e6ce-600e-c8b3-94d4-3846ef2c4a04/AppIcon-1x_U007emarketing-0-9-0-85-220-0.png/512x512bb.jpg",
	url: ns_gwdz_GACHA_URL,
	source: "Bwiki 卡池配置",
	eventUrl: ns_gwdz_CAL_URL,
	eventSource: "Bwiki 活动日历"
});
GACHA_FETCHERS["langrisser"] = (url, signal, tz, now) => ns_langrisser_gacha(url, signal, tz, now);
GACHA_FETCHERS["crashfever"] = (url, signal, tz, now) => ns_crashfever_gacha(url, signal, tz, now);
GACHA_FETCHERS["bfzy"] = (url, signal, tz, now) => ns_bfzy_gacha(url, signal, tz, now);
GACHA_FETCHERS["gwdz"] = (url, signal, tz, now) => ns_gwdz_gacha(url, signal, tz, now);
// 备选源键（主源 `url: ""` ⇒ 默认不抓；用户手动切到「（停更）」那一项时才被路由到这里）。
// 直接别名到原抓取器 —— 解析代码只有一份，不另造实现（见 test/all.mjs 的备选源登记守卫）。
GACHA_FETCHERS["langrisser-stopped"] = (url, signal, tz, now) => ns_langrisser_gacha(url, signal, tz, now);
GACHA_FETCHERS["bfzy-stopped"] = (url, signal, tz, now) => ns_bfzy_gacha(url, signal, tz, now);
EVENT_FETCHERS["gwdz"] = Object.assign(EVENT_FETCHERS["gwdz"] || {}, {
	default: (url, signal, tz, now) => ns_gwdz_events(url, signal, tz, now)
});
