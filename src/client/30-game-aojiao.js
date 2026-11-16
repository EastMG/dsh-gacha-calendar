// src/client/30-game-aojiao.js —— 傲娇工作室：盲盒派对（gachaparty，国服）
//
// 职责（2026-11-16 按厂商重排）：由 30-game-bwiki-gachaparty.js 整体迁入（自包含：条目 + 解析 + 抓取 + 登记）。
// 源：卡池 = bwiki 模板 `模板:近期盲盒扭蛋`（prop=wikitext）；活动 = SMW `action=ask` 查 `分类:活动`。
// 复用关系：bwiki 公共层（载荷生成器 / 悬停）；符号名 `ns_bwiki_*` 不变。
// 请求预算：每轮 2 次（两侧 URL 不同，不共享）。

//
// ── 落点 ────────────────────────────────────────────────────────────────────────
// bwiki 系文件（`30-game-bwiki-*` 家族）：唯一来源 `id:"gachaparty"`，两侧**不是同一条 URL**：
//   · 卡池侧 = `模板:近期盲盒扭蛋` 的 wikitext（`prop=wikitext`）
//   · 活动侧 = SMW `action=ask` 查 `分类:活动`
// 标签逐字：卡池「Bwiki 近期盲盒扭蛋」/ 活动「Bwiki 近期活动」。tz = `Asia/Shanghai`（国服 wiki）。
//
// ── ① 卡池侧：模板调用逐字（夹具 test/fixtures/gachaparty-pools）─────────────────────
//   `GET https://wiki.biligame.com/gachaparty/api.php?action=parse&page=模板:近期盲盒扭蛋`
//       `&prop=wikitext&format=json&formatversion=2`
//     ⚠️ **必须带 `Referer: https://wiki.biligame.com/`**（bwiki 的 EdgeOne WAF 对裸请求回 **567**）；
//        响应**没有 ACAO**（2026-11-15 实测 `access-control-allow-origin` 为空，`content-type` 只有
//        `application/json; charset=utf-8`）⇒ 必须走宿主代理（域名已在 `PROXY_ALLOW_HOSTS`）。
//     200 / 2,219 B（wikitext 正文 1,544 字符）。正文就是首页轮播那一段：`{{板块|轮播图|…|图1=`
//     后面**一行三个**调用：
//       `{{首页卡池|联动卡池|天鹅魔女||2026/11/5 0:00|2026/11/29 23:59}}`
//       `{{首页卡池|万圣卡池|星夜床头柜|夜灯守护者|2026/10/29 0:00|2026/11/22 23:59}}`
//       `{{首页卡池|秋日自选扩招|太极宗师|心愿自选角色|2026/9/27 0:00|2026/11/15 23:59|link-2=山河同庆}}`
//   · 字段口径 = 模板 `模板:首页卡池` 的 templatedata（源站事实，别猜）：
//       `1`=卡池名称 / `2`=卡池角色1 / `3`=卡池角色2 / `4`=卡池开始时间 / `5`=卡池结束时间；
//       另有**命名参数** `补充角色1` / `补充角色2`（模板里同样渲染成角色按钮 ⇒ 也算 UP）与
//       `link-1` / `link-2` / `link-补充角色N`（只影响跳转，不进任何字段）。
//     ⚠️ **必须先剥 `<!-- … -->` 注释**：这一页原文 10 个调用里 **7 个写在注释里**（套圈广场 /
//        周年自选扩招 / 节拍律动 / 商城兑换 / 夏日自选扩招 / 联动卡池-幸福天使 / 春日自选扩招，
//        日期 2026-03~09）。不剥注释就会把已下架的旧池当当期 —— 与 `30-game-bwiki-reso.js` 同一条坑。
//     ⚠️ 占位符照抄：`秋日自选扩招` 的 `3` 号位写的是「心愿自选角色」、`周年自选扩招` 的 `2` 号位是
//        「4UP必出」—— 那是**源站自己的写法**（自选池没有具体角色名），不是角色名。
//        按仓库口径**原样**当 UP 用（不自己编、也不静默丢掉），理由同 reso 文件头「池名原样」。
//   · 日期写法实测只有一种：`YYYY/M/D H:MM`（月日不补零；时钟都写了）。两端都有 ⇒ 直接落绝对时刻，
//     **不需要补年份**（没有 `inferYear` 的年份线索问题）。
//
// ── ② 活动侧为什么用 SMW `action=ask`，而不是首页那份 `模板:近期活动`（重点）──────────
//   首页确实转写了 `{{近期活动}}`，它展开成 `{{活动板块|万圣惊魂夜||2026/11/22 23:59|万圣惊魂夜}}`
//   ——**第 2 个参数（开始时间）实测三条全空**，模板 `模板:活动板块` 把它原样传给 `{{活动计时|
//   {{2}}|{{3}}}}`，所以那一页**永远只有结束时刻**。按仓库 2026-11-09 的口径「起点未知 ≠ 已开始」
//   （`coversNow` 要求两端都明确），靠它一条都进不了外显 ⇒ 活动侧不能取它。
//   同站的 `模板:近期卡池和活动` 实为 **missingtitle**（页面不存在）。
//   改用该 wiki 自己用来生成 `活动` 页的同一份 SMW 查询（`活动` 页的 `#ask` 本体，见夹具所抓的 URL）：
//     `GET …/api.php?action=ask&format=json&query=<urlencoded>`
//       query = `[[分类:活动]]|?活动名称|?活动开始时间|?活动结束时间|sort=活动开始时间|order=desc|limit=100`
//     200 / 14,407 B（2026-11-15 实测：一页回 **34 条**，没有 `query-continue-offset` ⇒ 一页拿全）。
//     三个属性都是 `_txt` 类型 ⇒ printouts 是**字符串数组**，值形如 `["20261029"]`（不是 SMW 的
//     `{timestamp,raw}`；两种形态都吃，同 `30-game-bwiki-dhmmr.js` 的 `textOf`）。
//   ⇒ 活动侧**有完整起止**；`limit=100` 按开始时间倒序，当期一定在里面（实测最新一条 = 2026-10-29）。
//   ⚠️ 只日期没有时分 ⇒ 起 00:00 / 止 23:59（仓库通用约定；与首页 `活动板块` 自己写的
//      「万圣惊魂夜 2026/11/22 23:59」逐字对得上，SMW 的 `20261122` 就是那天的 23:59）。
//
// ── ③ 请求预算：每轮 **2 次**（卡池 1 + 活动 1），两侧 URL 不同 ⇒ 不需要轮内共享。
//
// ── ④ 失败语义（与全仓一致）────────────────────────────────────────────────────────
//   · HTTP 非 2xx ⇒ 抛（`fetchText` / `fetchJson` 自己抛）；
//   · 卡池：`parse.wikitext` 缺失 / 空串（`{}` 落这里）⇒ 抛 `gachaparty-pools-changed:*`；
//     剥完注释**一个 `{{首页卡池` 都没有** ⇒ 抛（模板改版，不是"当期没有"）；
//   · 活动：没有 `query.results` 对象 ⇒ 抛 `gachaparty-events-changed:no-results`；
//     results 一条不少但**没有一条能解出起止**（属性名被改）⇒ 抛 `gachaparty-events-changed:no-window`；
//   · 结构正常但没有一条覆盖 now ⇒ `null`（未公布，不硬凑过期档期）。
//
// ── ⑤ 当期现状（2026-11-15 13:50 +08 实测，见夹具 meta 的 capturedAt）────────────────────
//   卡池在期 3 口：`秋日自选扩招`（太极宗师 / 心愿自选角色）09-27 00:00 ~ **11-15 23:59**、
//     `联动卡池`（天鹅魔女）11-05 00:00 ~ 11-29 23:59、`万圣卡池`（星夜床头柜 / 夜灯守护者）
//     10-29 00:00 ~ 11-22 23:59 ⇒ 外显 = 结束最早那口（秋日自选扩招），悬停三行。
//   活动在期 2 条：`山河同庆` 09-27 ~ **11-15 23:59**、`万圣惊魂夜` 10-29 ~ 11-22 23:59
//     ⇒ 外显 = 山河同庆，悬停两行。
//   ⚠️ 外显口径 = **结束最早优先**（仓库通用 `ns_bwiki_batchGachaPayloadOf` 的 `endTs` 升序：
//      "越快结束越该盯住"，同 `30-game-bwiki-common.js` 的 `ns_bwiki_pickCurrentPool`）。

//#region ① 常量
const ns_gachaparty_TZ = "Asia/Shanghai";
const ns_gachaparty_REFERER = "https://wiki.biligame.com/";
const ns_gachaparty_POOL_PAGE = "模板:近期盲盒扭蛋";
// 卡池：模板 wikitext（`prop=wikitext` 直出 `{{首页卡池|…}}` 调用，不用解析后的 HTML）
const ns_gachaparty_POOL_URL = "https://wiki.biligame.com/gachaparty/api.php?action=parse&page="
	+ ns_gachaparty_POOL_PAGE + "&prop=wikitext&format=json&formatversion=2";
// 活动：SMW 查询（属性名 = 解析时读的键，**只写一处**：改名时不会只改一半）
const ns_gachaparty_KEY_NAME = "活动名称";
const ns_gachaparty_KEY_START = "活动开始时间";
const ns_gachaparty_KEY_END = "活动结束时间";
const ns_gachaparty_EVENT_QUERY = "[[分类:活动]]"
	+ `|?${ns_gachaparty_KEY_NAME}|?${ns_gachaparty_KEY_START}|?${ns_gachaparty_KEY_END}`
	+ `|sort=${ns_gachaparty_KEY_START}|order=desc|limit=100`;
const ns_gachaparty_EVENT_URL = "https://wiki.biligame.com/gachaparty/api.php?action=ask&format=json&query="
	+ encodeURIComponent(ns_gachaparty_EVENT_QUERY);
const ns_gachaparty_POOL_LABEL = "Bwiki 近期盲盒扭蛋";
const ns_gachaparty_EVENT_LABEL = "Bwiki 近期活动";
// 一个模板调用：`{{首页卡池|…}}`（参数里没有 `{`/`}` ⇒ 用 `[^{}]` 收口最稳）
const ns_gachaparty_POOL_CALL_RE = /\{\{\s*首页卡池\s*\|([^{}]*?)\}\}/g;
// `2026/11/5 0:00`（月日不补零；时钟可选，实测都写了）
const ns_gachaparty_POINT_RE = /^(\d{4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})(?:\s+(\d{1,2})\s*:\s*(\d{2}))?$/;
// `20261029`（SMW 的 _txt 日期）
const ns_gachaparty_DAY_RE = /^(\d{4})(\d{2})(\d{2})$/;
//#endregion

//#region ② 纯解析：卡池模板（wikitext → 条目事实）
// 剥 HTML 注释，返回**全部** `{{首页卡池…}}` 的参数原文（没剥到 / 剥完一个都没有 ⇒ 抛）。
function ns_gachaparty_poolCallsOf(wikitext) {
	if (typeof wikitext !== "string" || wikitext.trim() === "") throw new Error("gachaparty-pools-changed:empty");
	const plain = wikitext.replace(/<!--[\s\S]*?-->/g, "\n");
	const out = [];
	ns_gachaparty_POOL_CALL_RE.lastIndex = 0;
	let m;
	while ((m = ns_gachaparty_POOL_CALL_RE.exec(plain)) !== null) out.push(m[1]);
	if (out.length === 0) throw new Error("gachaparty-pools-changed:no-call");
	return out;
}
// 一个调用的参数串 → `{ pos:[…], named:{…} }`。
// ⚠️ **位置参数要保留空位**（`{{首页卡池|商城兑换|风之铃|||}}` 的 4/5 号位是空串）：直接 `split` 不丢项，
//    只是不做 trim 后的过滤 —— 丢了空位就会把"起止缺失"误解成"起止在别的位子上"。
function ns_gachaparty_argsOf(text) {
	const pos = [];
	const named = Object.create(null);
	for (const raw of String(text == null ? "" : text).split("|")) {
		const s = raw.trim();
		const eq = s.indexOf("=");
		if (eq > 0) { named[s.slice(0, eq).trim()] = s.slice(eq + 1).trim(); continue; }
		pos.push(s);
	}
	return { pos, named };
}
// `2026/11/5 0:00` / `2026/11/5` → `{ y, mo, d, h, mi }`（h/mi 为 null 表示只有日期）
function ns_gachaparty_pointOf(text) {
	const m = ns_gachaparty_POINT_RE.exec(String(text == null ? "" : text).trim());
	if (!m) return null;
	const p = { y: +m[1], mo: +m[2], d: +m[3], h: m[4] == null ? null : +m[4], mi: m[5] == null ? null : +m[5] };
	if (p.mo < 1 || p.mo > 12 || p.d < 1 || p.d > 31) return null;
	if (p.h != null && (p.h < 0 || p.h > 23 || p.mi < 0 || p.mi > 59)) return null;
	return p;
}
// 起点只有日期 ⇒ 00:00；终点只有日期 ⇒ 23:59（仓库通用约定）
function ns_gachaparty_tsOf(point, isEnd, tz) {
	if (!point) return null;
	if (point.h != null) return sourceInstant(point.y, point.mo, point.d, point.h, point.mi, tz);
	return isEnd
		? sourceInstant(point.y, point.mo, point.d, 23, 59, tz)
		: sourceInstant(point.y, point.mo, point.d, 0, 0, tz);
}
// 一个调用 → 条目事实（窗口解不出 ⇒ null；`_i` 由调用方统一编号）
// UP 只取 2/3 号位的原文 + 命名参数 `补充角色1/2`（模板里四个都渲染成角色按钮），`、` 连接、去重。
function ns_gachaparty_poolOf(argsText, tz) {
	const { pos, named } = ns_gachaparty_argsOf(argsText);
	const banner = String(pos[0] == null ? "" : pos[0]).replace(/\s+/g, " ").trim();
	if (!banner) return null;
	const startText = String(pos[3] == null ? "" : pos[3]).trim();
	const endText = String(pos[4] == null ? "" : pos[4]).trim();
	const startPoint = startText ? ns_gachaparty_pointOf(startText) : null;
	const endPoint = endText ? ns_gachaparty_pointOf(endText) : null;
	const startTs = ns_gachaparty_tsOf(startPoint, false, tz);
	const endTs = ns_gachaparty_tsOf(endPoint, true, tz);
	if (startTs == null || endTs == null || !(endTs > startTs)) return null;   // 没有完整窗口 ⇒ 这条不产出
	const roles = [pos[1], pos[2], named["补充角色1"], named["补充角色2"]]
		.map((x) => String(x == null ? "" : x).replace(/\s+/g, " ").trim())
		.filter(Boolean)
		.filter((x, i, all) => all.indexOf(x) === i)
		.join("、");
	return {
		banner,
		roles,
		startTs,
		endTs,
		raw: `${startText} ~ ${endText}`,                 // 源站原文两端（分隔符统一成 `~`）
		display: fmtWindow(startTs, endTs, tz),
		isMain: true
	};
}
// 整页 wikitext → 条目事实数组（注释里的旧池不算；一条窗口都没有 ⇒ 空数组 = 当期未公布）
function ns_gachaparty_poolsOf(wikitext, tz = ns_gachaparty_TZ) {
	const out = [];
	for (const argsText of ns_gachaparty_poolCallsOf(wikitext)) {
		const it = ns_gachaparty_poolOf(argsText, tz);
		if (it) out.push(Object.assign({ _i: out.length }, it));
	}
	return out;
}
//#endregion

//#region ③ 纯解析：SMW 活动（`action=ask` → 条目事实）
// printout 值 → 首个非空字符串（`["20261029"]` / `[{timestamp}]` / `[{raw}]` 三种形态都吃）
function ns_gachaparty_textOf(v) {
	if (v == null) return "";
	if (typeof v === "string") return v.trim();
	if (typeof v === "number") return String(v);
	if (Array.isArray(v)) return ns_gachaparty_textOf(v[0]);
	if (typeof v === "object") {
		if (typeof v.raw === "string" && v.raw.trim() !== "") return v.raw.trim();
		if (typeof v.timestamp === "number") return String(v.timestamp);
		if (typeof v.fulltext === "string") return v.fulltext.trim();
		if (typeof v["*"] === "string") return v["*"].trim();
	}
	return "";
}
// `20261029` → `{ y, mo, d }`（只认 8 位纯数字；别的时间写法一律当"解不出"）
function ns_gachaparty_dayOf(text) {
	const m = ns_gachaparty_DAY_RE.exec(String(text == null ? "" : text).trim());
	if (!m) return null;
	const p = { y: +m[1], mo: +m[2], d: +m[3] };
	if (p.mo < 1 || p.mo > 12 || p.d < 1 || p.d > 31) return null;
	return p;
}
// ask JSON → 条目事实。**形状不对要抛**；形状对但一条都解不出窗口 ⇒ 抛（属性被改名）。
function ns_gachaparty_eventsOf(json, tz = ns_gachaparty_TZ) {
	const results = json && json.query && json.query.results;
	if (!results || typeof results !== "object" || Array.isArray(results)) {
		throw new Error("gachaparty-events-changed:no-results");
	}
	const out = [];
	for (const [page, v] of Object.entries(results)) {
		if (!v || typeof v !== "object") continue;
		const p = v.printouts;
		if (!p || typeof p !== "object") continue;
		const name = ns_gachaparty_textOf(p[ns_gachaparty_KEY_NAME]).replace(/\s+/g, " ").trim()
			|| String(page).replace(/\s+/g, " ").trim();
		if (!name) continue;
		const startText = ns_gachaparty_textOf(p[ns_gachaparty_KEY_START]);
		const endText = ns_gachaparty_textOf(p[ns_gachaparty_KEY_END]);
		const startPoint = startText ? ns_gachaparty_dayOf(startText) : null;
		const endPoint = endText ? ns_gachaparty_dayOf(endText) : null;
		if (!startPoint || !endPoint) continue;                    // 缺任一端 ⇒ 不猜，这条不产出
		const startTs = sourceInstant(startPoint.y, startPoint.mo, startPoint.d, 0, 0, tz);
		const endTs = sourceInstant(endPoint.y, endPoint.mo, endPoint.d, 23, 59, tz);
		if (startTs == null || endTs == null || !(endTs > startTs)) continue;   // 源站错行 ⇒ 丢掉
		out.push({
			_i: out.length,
			event: name,
			category: "",
			startTs,
			endTs,
			raw: `${startText} ~ ${endText}`,
			display: fmtWindow(startTs, endTs, tz)
		});
	}
	if (Object.keys(results).length > 0 && out.length === 0) throw new Error("gachaparty-events-changed:no-window");
	return out;
}
//#endregion

//#region ④ 抓取器（契约：async (url, signal, tz, now = nowMs()) → 数据对象 | null）
// 卡池侧：逐池并列（联动的池型不同，**不按"同结束时刻"合并角色** —— 与 reso 同一条口径）
async function ns_gachaparty_gacha(url, signal, tz = ns_gachaparty_TZ, now = nowMs()) {
	const target = String(url == null ? "" : url).trim() || ns_gachaparty_POOL_URL;
	const json = await fetchJson(target, { mode: "proxy", referer: ns_gachaparty_REFERER, signal });
	const wikitext = ns_bwiki_wikitext_mediaWikiWikitext(json);
	if (wikitext == null) throw new Error("gachaparty-pools-changed:no-wikitext");
	const items = ns_gachaparty_poolsOf(wikitext, tz);
	if (items.length === 0) return null;                       // 有调用但都没窗口 ⇒ 未公布（不是失败）
	return ns_bwiki_batchGachaPayloadOf(items, tz, ns_bwiki_nowOf(now), { id: "gachaparty" });
}
// 活动侧：覆盖 now 的活动 → 共用活动载荷（当前 2 条在期）
async function ns_gachaparty_events(url, signal, tz = ns_gachaparty_TZ, now = nowMs()) {
	const target = String(url == null ? "" : url).trim() || ns_gachaparty_EVENT_URL;
	const json = await fetchJson(target, { mode: "proxy", referer: ns_gachaparty_REFERER, signal });
	const items = ns_gachaparty_eventsOf(json, tz);
	if (items.length === 0) return null;                       // 分类里一条都没有 ⇒ 未公布
	return ns_bwiki_eventPayload(items, tz, ns_bwiki_nowOf(now), 0, "gachaparty");
}
//#endregion

//#region ⑤ 条目登记
// 两侧 URL 不同（卡池 = 模板 wikitext / 活动 = SMW ask）⇒ `eventUrl` 单独写。
registerSource({
	id: "gachaparty",
	defaultHidden: false,
	tz: ns_gachaparty_TZ,
	name: "盲盒派对",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/2d/7f/76/2d7f76fd-3560-5afb-6544-1c0bb3f28b5d/AppIcon-0-0-1x_U007epad-0-11-0-85-220.png/512x512bb.jpg",
	url: ns_gachaparty_POOL_URL,
	source: ns_gachaparty_POOL_LABEL,
	eventUrl: ns_gachaparty_EVENT_URL,
	eventSource: ns_gachaparty_EVENT_LABEL
});
GACHA_FETCHERS["gachaparty"] = (url, signal, tz, now) => ns_gachaparty_gacha(url, signal, tz, now);
EVENT_FETCHERS["gachaparty"] = Object.assign(EVENT_FETCHERS["gachaparty"] || {}, {
	default: (url, signal, tz, now) => ns_gachaparty_events(url, signal, tz, now)
});
//#endregion
