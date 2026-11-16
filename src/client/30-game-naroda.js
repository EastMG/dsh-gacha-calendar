// src/client/30-game-naroda.js —— Naroda：雪松（kedr）
//
// 职责（2026-11-16 按厂商重排）：kedr 的条目 + 解析器 + 抓取器 + 登记都在本文件。
// 组成：
//   · 30-game-bwiki-kedr-wikitext.js：bwiki `Template:首页游戏版本内容` 模板调用解析（卡池 + 活动默认源）；
//   · 30-game-bwiki-kedr-html.js：bwiki「卡池信息」占位页解析（备选）；
//   · 30-game-bwiki-kedr-wiki.js：雪松社区归档页解析（往期动员，prop=text；生产已改走 wikitext，本文件供回归）；
//   · 30-game-bwiki-register.js 里 kedr 的注册与 GACHA/EVENT_FETCHERS 接线。
// 复用关系：bwiki 公共层（wikitext helper / 载荷生成器）与 bwiki-html-fetchers.js；符号名 `ns_bwiki_*` 不变。
// 请求预算：卡池 / 活动各 1 次（同一条 wikitext URL，轮内可复用）。

// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-bwiki-kedr-wikitext.js：bwiki `Template:首页游戏版本内容`（卡池 + 活动默认源）
// ─────────────────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// ③ 雪松（kedrgame）—— `Template:首页游戏版本内容` 的 `{{时间进度条|…}}` 调用
// ══════════════════════════════════════════════════════════════════════════════
const ns_bwiki_wikitext_KEDR_TZ = "Asia/Shanghai";         // 推测：每期 05:00 换池（与 P6 社区页旁证一致）
// ⚠️ **必须带 `Template:` 前缀**：不带前缀返回 `{"code":"missingtitle"}`（HTTP 仍 200）；
//    返回的 `parse.title` 是 `模板:首页游戏版本内容`（中文命名空间别名）。
const ns_bwiki_wikitext_KEDR_TEMPLATE_PAGE = "Template:首页游戏版本内容";
function ns_bwiki_wikitext_kedrTemplateUrl(page = ns_bwiki_wikitext_KEDR_TEMPLATE_PAGE) {
	return `https://wiki.biligame.com/kedrgame/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json`;
}
const ns_bwiki_wikitext_KEDR_TEMPLATE_URL = ns_bwiki_wikitext_kedrTemplateUrl();
const ns_bwiki_wikitext_KEDR_REFERER = "https://wiki.biligame.com/kedrgame/";

// `{{时间进度条|开始时间=2026/10/02 05:00|结束时间=2026/10/09 05:00|名称=【精英集结·支援】西尔维亚|链接=…|倒计时名称=…}}`
// → 参数对象数组。`<!-- -->` 注释块先剥掉（页尾注释里有一堆 `{{板块|按钮|…}}`，虽不含时间进度条，防患于未然）。
function ns_bwiki_wikitext_kedrTemplateCalls(wikitext) {
	const src = String(wikitext == null ? "" : wikitext).replace(/<!--[\s\S]*?-->/g, "");
	const out = [];
	const re = /\{\{\s*时间进度条\s*\|([^{}]*)\}\}/g;
	let m;
	while ((m = re.exec(src))) {
		const params = {};
		for (const part of m[1].split("|")) {
			const eq = part.indexOf("=");
			if (eq < 0) continue;
			params[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
		}
		out.push(params);
	}
	return out;
}
// `2026/10/02 05:00`（月/日不补零，秒可省）
function ns_bwiki_wikitext_kedrStamp(text) { return ns_bwiki_wikitext_cznStamp(text); }
// 卡池 vs 活动分流（任务书口径）：含 `精英集结`/`演习`（雪松的抽卡系统叫「动员」，池名形如【精英集结·支援】）= 卡池；
// 含 `活动`/`赛季`/`通行证`/`剧情` = 活动。
function ns_bwiki_wikitext_kedrIsGacha(name) { return /精英集结|演习|动员|卡池/.test(String(name == null ? "" : name)); }
function ns_bwiki_wikitext_kedrIsEvent(name) {
	const n = String(name == null ? "" : name);
	if (ns_bwiki_wikitext_kedrIsGacha(n)) return false;
	return /活动|赛季|通行证|剧情|战令|防卫|挑战/.test(n);
}
// `【精英集结·支援】西尔维亚` → `西尔维亚`（`】` 之后就是 UP 角色）
function ns_bwiki_wikitext_kedrRoleFromName(name) {
	const m = /】\s*(.+?)\s*$/.exec(String(name == null ? "" : name));
	return m ? m[1].trim() : "";
}
// 模板 wikitext → { gacha:[…], event:[…], skipped }
// **一条时间进度条都没有 → 抛错**（模板被清空/改版 = 结构性损坏，不当"未公布"）
function ns_bwiki_wikitext_parseKedrTemplate(wikitext, tz = ns_bwiki_wikitext_KEDR_TZ) {
	const calls = ns_bwiki_wikitext_kedrTemplateCalls(wikitext);
	if (calls.length === 0) throw new Error("kedr-template:no-call");
	const gacha = [], event = [];
	let skipped = 0;
	calls.forEach((p, i) => {
		const name = String(p["名称"] || "").trim();
		const a = ns_bwiki_wikitext_kedrStamp(p["开始时间"]), b = ns_bwiki_wikitext_kedrStamp(p["结束时间"]);
		if (!name || !a || !b) { skipped++; return; }            // 缺名称/档期 → 跳过，不硬造
		const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
		if (!(endTs > startTs)) { skipped++; return; }
		const item = {
			_i: i, name, startTs, endTs,
			raw: `${p["开始时间"]} ~ ${p["结束时间"]}`,
			link: p["链接"] || "", timer: p["倒计时名称"] || ""
		};
		if (ns_bwiki_wikitext_kedrIsGacha(name)) gacha.push({ ...item, banner: name, roles: ns_bwiki_wikitext_kedrRoleFromName(name) });
		else if (ns_bwiki_wikitext_kedrIsEvent(name)) event.push(item);
		else skipped++;
	});
	if (gacha.length + event.length === 0) throw new Error("kedr-template:no-window");
	return { gacha, event, skipped, calls };
}
// ⚠️ 原先这里有个 _KEDR_HEADER：「雪松 bwiki Template:首页游戏版本内容（社区维护；【精英集结】/【演习】= 卡池，
//    活动/赛季/通行证/剧情 = 活动；tz=UTC+8 为推测）」——悬停元信息（来源站名/页面名/分流口径/时区推定），
//    按方案 A **整段删除**（分流规则仍在 ns_bwiki_wikitext_kedrIsGacha / ns_bwiki_wikitext_kedrIsEvent 的注释里）。
// 卡池：开始最新的覆盖档（该模板是**当期**面板，两条卡池同窗口 → 取文档顺序第一条）
async function ns_bwiki_wikitext_gachaKedrTemplate(url, signal, tz = ns_bwiki_wikitext_KEDR_TZ, now = nowMs()) {
	const { gacha } = ns_bwiki_wikitext_parseKedrTemplate(await ns_bwiki_wikitext_fetchWikitext(url || ns_bwiki_wikitext_KEDR_TEMPLATE_URL, signal, ns_bwiki_wikitext_KEDR_REFERER), tz);
	return ns_bwiki_wikitext_gachaPayload(gacha, tz, ns_bwiki_wikitext_nowOf(now), { cmp: (a, b) => (b.startTs - a.startTs) || (a._i - b._i) });
}
// 活动：开始最新的覆盖档（个人剧情活动 > 战令通行证赛季 / 边境防卫）
// ⚠️ category / tags 批 1（2026-11-08）：**故意不补** `category`。源站确实给了类别词（模板参数「倒计时名称」，
//    即 `item.timer`：赛季 / 活动 / 边境防卫），但把它当 `category` 会让档位判定**退化**：
//    `eventTier` 的判据是 `category || tags` 优先、读不到才回退**活动名**，而这三个词都不在
//    `EVENT_TIER1_RE` 里 ⇒ 原本靠名字命中第一档的「个人剧情活动第1期：【新机动队故事】」会被打成第二档，
//    外显从它变成「战令通行证赛季」（实测 2026-10-01，见 test/cases-category.mjs 的钉住用例）。
//    用户口径（批 1 硬约束②）：补 category/tags **不许**动已可见输出，除非那是有意的档位改进 ——
//    这里不是改进，所以留空。要改成"照源站写"只需一行：给 eventPayload 加回 `categoryOf` 并传 `x.timer`。
async function ns_bwiki_wikitext_eventsKedrTemplate(url, signal, tz = ns_bwiki_wikitext_KEDR_TZ, now = nowMs()) {
	const { event } = ns_bwiki_wikitext_parseKedrTemplate(await ns_bwiki_wikitext_fetchWikitext(url || ns_bwiki_wikitext_KEDR_TEMPLATE_URL, signal, ns_bwiki_wikitext_KEDR_REFERER), tz);
	return ns_bwiki_wikitext_eventPayload(event, tz, ns_bwiki_wikitext_nowOf(now), { cmp: (a, b) => (b.startTs - a.startTs) || (a._i - b._i), nameOf: (x) => x.name });
}
//#endregion


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-bwiki-kedr-html.js：bwiki「卡池信息」占位页（备选）
// ─────────────────────────────────────────────────────────────────────────────

//#region ⑤ 雪松（kedrgame / page=卡池信息）—— ⚠️ 台架测试占位页，可能已停更
// 该页**没有任何表格**，只有两个小节「台架测试[一]」「台架测试[二]」，正文形如：
//   `<b>===时间===</b>：2024/12/7-2024/12/13`（**只有日期、没有时刻**）
//   第二段是 `？-？`（未填）。→ 实测唯一可解析的窗口 = 2024/12/07 ~ 2024/12/13，早于当期 → null。
//   ⚠️ 风险标注：最近编辑 2025-08-01、页面自称「台架测试」；但同 wiki 有 `历史卡池-精英集结-1.0.0-*`、
//      `游戏内部公告(2026.6/7)` 等更新页面，说明 wiki 还活着、只是本页不再是有效数据源。
function ns_bwiki_parseKedrGacha(html, tz = "Asia/Shanghai") {
	const re = /={2,}\s*时间\s*={2,}\s*(?:<\/b>)?\s*[:：]?\s*([^<]*)/g;
	const items = [];
	let m, i = 0;
	while ((m = re.exec(String(html)))) {
		const value = m[1].replace(/\s+/g, " ").trim();
		const w = ns_bwiki_windowsFromCell(value, tz, "startFirst")[0];
		if (!w) continue;
		items.push({
			_i: i++,
			banner: ns_bwiki_headingBefore(html, m.index) || "卡池",
			roles: "", category: "台架测试", note: value,
			startTs: w.startTs, endTs: w.endTs, raw: value, display: w.display
		});
	}
	return items;
}
//#endregion


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-bwiki-kedr-wiki.js：雪松社区归档页（往期动员，prop=text）
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-kedr-wiki.js（压平后见 30-game-bwiki-kedr-wiki.js）
// ─────────────────────────────────────────────────────────────────────────────
// 原 src/client/35-parsers-kedr-wiki.js（压平后见 30-game-bwiki-kedr-wiki.js）
//
// 由 next-sources/parsers/kedr-wiki.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_kedr-wiki__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// 原 src/client/35-parsers-kedr-wiki.js（压平后见 30-game-bwiki-kedr-wiki.js） —— 雪松（bwiki 社区结构化页 `往期动员【常驻】—1.0.0—`）
//
// 契约：async (url, signal, tz, now = nowMs()) → { banner, roles, bannerDates, bannerDatesRaw, startTs, endTs, bannerHover } | null
//
// ⚠️ **这是社区 wiki，不是官方源**：雪松（Кедр / kedrgame，俄语"雪松"）**官方源未找到**
//    （调研结论见 `dsh-gacha-calendar-新增来源第二轮调研-2026-10-02.md` §5：官方无公告 API，
//      bwiki 的 `page=卡池信息` 又是「台架测试」占位页）→ 本来源是**社区结构化页**，`kind: "wiki"`。
//    稳定性弱于官方 API：页面随时可能被社区改写/停更。
//
// ══ 实测形态（2026-10-02 抓夹具 fixtures/p6-kedr-archive，HTTP 200 / 17,298 B）══
//   GET https://wiki.biligame.com/kedrgame/api.php?action=parse&page=<percent-encoded>&prop=text&format=json&formatversion=2
//   （页名 `往期动员【常驻】—1.0.0—` **必须 percent-encode 后再拼 URL**，见 ns_kedr_wiki_kedrParseUrl）
//   → 标准 MediaWiki `{ parse:{ title, pageid, text } }`，`text` 是 16,516 B 的 HTML。
//
//   ⚠️ **与任务书假设不同：该页没有任何 `<table>`（实测 0 张）**，所以不存在"表格档期抽取"。
//      真实结构是「每个小节一段档期 + 若干可折叠卡池面板」：
//        <h1><span class="mw-headline" id="1.0.0-1"><b>1.0.0-1</b></span>…[编辑]</h1>
//        <div …><p><big>
//          <b>开始时间：2026-06-22-12:00<br /></b>
//          <b>结束时间：2026-06-29-05:00<br /></b>
//        </big></p>
//        <div class="panel panel-info"><div class="panel-heading">…<span>卡池:精英集结·指挥</span>…展开/折叠
//          <div class="panel-body…"><p>角色：<a title="安吉拉">安吉拉</a><br />职业：指挥<br />卡池：【<a …>精英集结·指挥</a>】…
//      要点：① 档期不是一行"起 ~ 止"，而是**开始时间 / 结束时间 两行**（各带 `<br />`）→ 要配对；
//            ② 时间戳形态是 `YYYY-MM-DD-HH:MM`（日期与时刻之间**又多一个连字符**，非标准写法）；
//            ③ 小节标题在 `<h1>` 里，4 节 = `1.0.0-1` ~ `1.0.0-4`；
//            ④ 每节 2 个卡池（`卡池:` 出现在折叠面板标题上），`角色：` 后是 UP 角色（安克文本即名字）。
//      ⇒ 解析器按 `<h1>` 切节（下面 ns_kedr_wiki_kedrSections），节内配对两个时间戳 + 收集卡池/角色。
//
// ══ 时区 Asia/Shanghai（**推测**，源站未标注）══
//   页面正文没有任何时区字样。两条旁证支持国服 UTC+8：① 每期 `结束时间` 都落在 **05:00**
//   （国服常见的每日 05:00 日切点）；② 起始是 `12:00`（中午开池）。**未经源站声明**，故记"推测"。
//
// ══ 「往期动员」是**归档页**（重要）══
//   页面标题即「往期」：实测 4 期全部落在 2026-06-22 ~ 2026-07-20（抓取时刻 2026-10-02 已全部结束）
//   → 抓取器在"当期"语义下会**如实返回 null（未公布）**，而不是硬凑一个过期档期。
//   若社区把当期动员也挂到同一页/同款结构，本解析器无需改动即可产出。
//
// ══ bwiki 反爬（抓夹具时必看）══
//   高频请求会被腾讯 EdgeOne WAF 拦成 **HTTP 567**（返回 ~7KB 挑战页、**不是 JSON**）
//   → 抓夹具要限速 30s 重试，并**校验 body 是不是 JSON**（否则会把挑战页存成夹具）。
//   本次抓取两次请求都是 HTTP 200 + 合法 JSON（无触发）。`fetchMediaWikiText` 对坏 JSON 会抛
//   `bad-json` → 属"该侧抓取失败"，不会被当成"未公布"。


const ns_kedr_wiki_KEDR_API = "https://wiki.biligame.com/kedrgame/api.php";
const ns_kedr_wiki_KEDR_REFERER = "https://wiki.biligame.com/kedrgame/";
const ns_kedr_wiki_KEDR_ARCHIVE_PAGE = "往期动员【常驻】—1.0.0—";
// 推测：国服 UTC+8（源站未标注；旁证见文件头）
const ns_kedr_wiki_KEDR_TZ = "Asia/Shanghai";

// ⚠️ 页名必须 encodeURIComponent 后再拼（与 `30-game-aniplex.js` 的 `fgoParseUrl` 同做法）：
//    原 registry-p6.js 里的 URL 必须用这同一个函数构造，否则离线夹具（test/map.json 的整串键）命中不到。
function ns_kedr_wiki_kedrParseUrl(page) {
	return `${ns_kedr_wiki_KEDR_API}?action=parse&page=${encodeURIComponent(page)}&prop=text&format=json&formatversion=2`;
}
const ns_kedr_wiki_KEDR_ARCHIVE_URL = ns_kedr_wiki_kedrParseUrl(ns_kedr_wiki_KEDR_ARCHIVE_PAGE);

//#region 结构解析
// 按 <h1>…</h6> 切节；节标题取 `<span class="mw-headline">`（退回去标签后的文本），并去掉 `[编辑]`
//   ⚠️ 页首的目录标题 `<h2 id="mw-toc-heading">目录</h2>` 也是 heading → 显式排除（否则小节数虚高）
function ns_kedr_wiki_kedrSections(html) {
	const s = String(html == null ? "" : html);
	const heads = [];
	const re = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
	let m;
	while ((m = re.exec(s)) !== null) {
		if (/mw-toc-heading/.test(m[2])) continue;
		const inner = m[3];
		const hl = /<span[^>]*class="mw-headline"[^>]*>([\s\S]*?)<\/span>/i.exec(inner);
		const title = stripTags(hl ? hl[1] : inner)
			.replace(/\s*\[\s*编辑\s*\]\s*/g, "")
			.replace(/\s+/g, " ")
			.trim();
		heads.push({ level: +m[1], title, start: m.index, bodyStart: re.lastIndex });
	}
	return heads.map((h, i) => ({
		title: h.title,
		level: h.level,
		html: s.slice(h.bodyStart, i + 1 < heads.length ? heads[i + 1].start : s.length)
	}));
}
// `开始时间：2026-06-22-12:00` / `结束时间：2026-06-29-05:00`
//   ⚠️ 源站的时间戳是 `YYYY-MM-DD-HH:MM`（日期与时刻之间再多一个连字符）→ 分隔符放宽
const ns_kedr_wiki_STAMP_BODY = "(\\d{4})\\s*[-\\/.]\\s*(\\d{1,2})\\s*[-\\/.]\\s*(\\d{1,2})\\s*[-\\s]\\s*(\\d{1,2})\\s*[:：]\\s*(\\d{2})";
function ns_kedr_wiki_kedrStamp(sectionHtml, label) {
	const re = new RegExp(label + "\\s*[:：][\\s\\S]{0,40}?" + ns_kedr_wiki_STAMP_BODY);
	const m = re.exec(String(sectionHtml == null ? "" : sectionHtml));
	if (!m) return null;
	const h = +m[4], mi = +m[5];
	if (h > 23 || mi > 59) return null;
	return { y: +m[1], mo: +m[2], d: +m[3], h, mi, text: `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}-${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` };
}
// 节内卡池名：`卡池:精英集结·指挥`（折叠面板标题上）；正文里 `卡池：【<a…>…】` 形态由
// 排除 `<`/`【`/`】` 的字符类天然跳过，不会重复取到。去重保序。
function ns_kedr_wiki_kedrPools(sectionHtml) {
	return [...String(sectionHtml == null ? "" : sectionHtml).matchAll(/卡池\s*[:：]\s*([^<【】\n]{1,24})/g)]
		.map((m) => m[1].replace(/\s+/g, " ").trim())
		.filter((x, i, a) => x && a.indexOf(x) === i);
}
// 节内 UP 角色：`角色：<a …>安吉拉</a><br />` → 取到第一个 <br>/</p> 之前的内容去标签
function ns_kedr_wiki_kedrRoles(sectionHtml) {
	const out = [];
	const re = /角色\s*[:：]([\s\S]{0,200}?)(?:<br\s*\/?>|<\/p>|$)/gi;
	let m;
	while ((m = re.exec(String(sectionHtml == null ? "" : sectionHtml))) !== null) {
		const t = stripTags(m[1]).replace(/\s+/g, " ").trim();
		if (t && !out.includes(t)) out.push(t);
		if (m[0] === "") re.lastIndex++;
	}
	return out;
}

// 页面 HTML → { sectionTitles, items:[{section,pools,roles,startTs,endTs,raw}], skipped }
//   结构性损坏（没有任何小节）→ 抛错（该侧算抓取失败），与 `30-game-bwiki-common.js` 的 no-table 同口径。
function ns_kedr_wiki_parseKedrArchive(html, tz = ns_kedr_wiki_KEDR_TZ) {
	const sections = ns_kedr_wiki_kedrSections(html);
	if (sections.length === 0) throw new Error("kedr-wiki:no-section");
	const items = [];
	let skipped = 0;
	sections.forEach((sec, i) => {
		const a = ns_kedr_wiki_kedrStamp(sec.html, "开始时间");
		const b = ns_kedr_wiki_kedrStamp(sec.html, "结束时间");
		if (!a || !b) { skipped++; return; }                      // 缺档期的小节（如纯说明节）→ 跳过
		const startTs = sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
		const endTs = sourceInstant(b.y, b.mo, b.d, b.h, b.mi, tz);
		if (!(endTs > startTs)) { skipped++; return; }            // 源站错行 → 丢掉，不硬造
		items.push({
			_i: i,
			section: sec.title || `第 ${i + 1} 节`,
			pools: ns_kedr_wiki_kedrPools(sec.html),
			roles: ns_kedr_wiki_kedrRoles(sec.html),
			startTs, endTs,
			// raw：两端都是源站原文（`YYYY-MM-DD-HH:MM`），中间的 `~` 是本解析器拼的（源站分行写）
			raw: `${a.text} ~ ${b.text}`
		});
	});
	return { sectionTitles: sections.map((s) => s.title), items, skipped };
}
//#endregion

//#region 抓取器
// 当期 = 窗口覆盖 now 的那一节（取结束最早，并列按页面顺序）；没有覆盖 → null（未公布）
async function ns_kedr_wiki_gachaKedrWiki(url, signal, tz = ns_kedr_wiki_KEDR_TZ, now = nowMs()) {
	const html = await fetchMediaWikiText(url || ns_kedr_wiki_KEDR_ARCHIVE_URL, { referer: ns_kedr_wiki_KEDR_REFERER, signal, mode: "proxy" });
	const parsed = ns_kedr_wiki_parseKedrArchive(html, tz);
	const act = parsed.items
		.filter((x) => coversNow(x, now))
		.map((x, i) => ({ x, i }))
		.sort((a, b) => (a.x.endTs - b.x.endTs) || (a.x._i - b.x._i))
		.map((o) => o.x);
	if (act.length === 0) return null;
	const first = act[0];
	// ⚠️ 2026-10-03 改：这里原本手搓悬停，且三处不合规 ——
	//   ① 头行 `${KEDR_ARCHIVE_PAGE}（bwiki 社区页，非官方源；tz=UTC+8 为推测）` = 来源名 + 可信度说明 + 时区推定
	//      （「社区页 / 非官方 / tz 为推测」这类信息应写在**来源声明**里：条目 tz 字段 + 设置页来源标签）
	//   ② 行格式是 `档期   节名`（**档期在前**），本体一律「池名 ⏎ 档期」
	//   ③ 自带排版实现（没走共用 hoverPool）
	// 现在改用共用 hoverPool。
	const hover = hoverPool(act.map((x) => ({
		name: `${x.section}${x.pools.length ? `（${x.pools.join(" / ")}）` : ""}`,
		startTs: x.startTs,
		endTs: x.endTs
	})), tz);
	return {
		banner: first.pools.length ? `${first.section}（${first.pools.join(" / ")}）` : first.section,
		roles: first.roles.join("、"),
		bannerDates: fmtWindow(first.startTs, first.endTs, tz),
		bannerDatesRaw: first.raw,
		startTs: first.startTs,
		endTs: first.endTs,
		...(hover ? { bannerHover: hover } : {})
	};
}
//#endregion


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-bwiki-register.js：kedr 的条目登记 + 抓取器接线（唯一一处注册）
// ─────────────────────────────────────────────────────────────────────────────

		registerSource({
				id: "kedr",
				defaultHidden: false,
				tz: "Asia/Shanghai",
				name: "雪松",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/b5/8c/b6/b58cb6b2-4be3-0be0-852a-af761afaab06/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
				url: "https://wiki.biligame.com/kedrgame/api.php?action=parse&page=Template%3A%E9%A6%96%E9%A1%B5%E6%B8%B8%E6%88%8F%E7%89%88%E6%9C%AC%E5%86%85%E5%AE%B9&prop=wikitext&format=json",
				source: "Bwiki",
				eventUrl: "https://wiki.biligame.com/kedrgame/api.php?action=parse&page=Template%3A%E9%A6%96%E9%A1%B5%E6%B8%B8%E6%88%8F%E7%89%88%E6%9C%AC%E5%86%85%E5%AE%B9&prop=wikitext&format=json",
				eventSource: "Bwiki",
		});

		GACHA_FETCHERS["kedr"] = (url, signal, tz) => ns_bwiki_wikitext_gachaKedrTemplate(url, signal, tz);

		EVENT_FETCHERS["kedr"] = Object.assign(EVENT_FETCHERS["kedr"] || {}, { default: (url, signal, tz) => ns_bwiki_wikitext_eventsKedrTemplate(url, signal, tz) });
