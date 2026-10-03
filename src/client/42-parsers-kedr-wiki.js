// src/client/35-parsers-kedr-wiki.js
//
// 由 next-sources/parsers/kedr-wiki.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_kedr-wiki__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-kedr-wiki.js —— 雪松（bwiki 社区结构化页 `往期动员【常驻】—1.0.0—`）
//
// 契约：async (url, signal, tz, now = Date.now()) → { banner, roles, bannerDates, bannerDatesRaw, startTs, endTs, bannerHover } | null
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

// ⚠️ 页名必须 encodeURIComponent 后再拼（与 fgo.js 的 fgoParseUrl 同做法）：
//    registry-p6.js 里的 URL 必须用这同一个函数构造，否则离线夹具（test/map.json 的整串键）命中不到。
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
//   结构性损坏（没有任何小节）→ 抛错（该侧算抓取失败），与 bwiki.js 的 no-table 同口径。
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
async function ns_kedr_wiki_gachaKedrWiki(url, signal, tz = ns_kedr_wiki_KEDR_TZ, now = Date.now()) {
	const html = await fetchMediaWikiText(url || ns_kedr_wiki_KEDR_ARCHIVE_URL, { referer: ns_kedr_wiki_KEDR_REFERER, signal, mode: "proxy" });
	const parsed = ns_kedr_wiki_parseKedrArchive(html, tz);
	const act = parsed.items
		.filter((x) => x.startTs <= now && x.endTs >= now)
		.map((x, i) => ({ x, i }))
		.sort((a, b) => (a.x.endTs - b.x.endTs) || (a.x._i - b.x._i))
		.map((o) => o.x);
	if (act.length === 0) return null;
	const first = act[0];
	const head = `${ns_kedr_wiki_KEDR_ARCHIVE_PAGE}（bwiki 社区页，非官方源；tz=UTC+8 为推测）`;
	const lines = act.map((x) => `${fmtWindow(x.startTs, x.endTs, tz)}   ${x.section}${x.pools.length ? `（${x.pools.join(" / ")}）` : ""}`);
	return {
		banner: first.pools.length ? `${first.section}（${first.pools.join(" / ")}）` : first.section,
		roles: first.roles.join("、"),
		bannerDates: fmtWindow(first.startTs, first.endTs, tz),
		bannerDatesRaw: first.raw,
		startTs: first.startTs,
		endTs: first.endTs,
		bannerHover: [head, ...lines].join("\n")
	};
}
//#endregion
