// src/client/35-parsers-umamusume-official.js
//
// 由 next-sources/parsers/umamusume-official.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_umamusume-official__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// src/client/35-parsers-umamusume-official.js —— 赛马娘 **官方公告**（日服 umamusume.jp + 国际服 umamusume.com）
//
// 契约：async (url, signal, tz, now = Date.now()) → 数据对象 | null
//   卡池侧 { banner, bannerDates, bannerDatesRaw?, startTs?, endTs?, bannerHover? }
//   活动侧 { event, eventDates, eventDatesRaw?, eventHover? }
//   null = 未公布（抓到了公告，但没有覆盖 now 的档期）；只有结构性损坏才 throw。
//   `bannerHover` / `eventHover` 只在**当期 ≥2 条**时出现（`hoverPool` / `hoverEvent` 返回空串 → 本文件不设该字段），
//   否则交回 UI 的默认单条两行式；内容只有「名称 + 档期」，**不含任何元信息**（见 `ns_umamusume_official_umaCurrentItems` 的说明）。
//
// ── 与既有源的关系（**并存，不替换**）────────────────────────────────────────
//   · 日服：既有 `parsers/umapyoi.js`（第三方 api.umapyoi.net，只有"卡级获取窗口"、无卡池名）
//     与本文件的 `uma-jp-official`（官网公告，有卡池名 + 完整活动/卡池文案）**并存**。
//   · 国际服：既有 `parsers/bwiki.js` 的 `eventsUmaJp` / `gachaUmaCn`（bwiki 表格，简中服）
//     与本文件的 `uma-global`（**国际服官方公告**）**并存**。谁是主源由 Lead 决定，本文件不擅自替换。
//
// ── 实测形态（2026-10-02 夹具，见 fixtures/p5-uma-*）─────────────────────────
// 日服（TZ = Asia/Tokyo，源站即日服官网）：
//   GET  /api/ajax/pr_info_index?format=json&page=<N>
//        → { response_code: 1, information_list: [{ announce_id, title, message, post_at, update_at,
//            announce_label, image, og_image, post_platform_flag }], total_page_count: 32 }
//        实测 page=1 → 10 条（**分页参数只有 `page` 有效**；p / page_no / limit / size 实测全无效），
//        total_page_count=32（page=2 同样 10 条，已抓夹具 p5-uma-jp-index-p2）。
//   GET  /api/ajax/pr_info_detail?format=json&announce_id=<id>
//        → { response_code: 1, detail: { announce_id, title, message, from_date, to_date, post_at, … } }
// 国际服（TZ = **UTC**，与日服不同；post_at 实测是 UTC，如 "2026-09-28 22:00:00" = 15:00 PDT）：
//   POST /api/ajax/pr_info_index?format=json   body {"announce_label":1,"limit":50,"offset":0}
//        → { response_code: 1, information_list: [ … 50 条 … ], show_more_button: 1 }
//        ⚠️ **必须 POST**：GET / 空 body → `{"response_code":102}`（实测）；只有 1 才是成功。
//        announce_label：1=Game / 0=All / 3=Media（本解析器只用 1）。
//   POST /api/ajax/pr_info_detail?format=json  body {"announce_id":<id>}
//
// ── ⚠️ 最重要的一条实测纠正：「档期不在 from_date/to_date 里」────────────────
//   `detail.from_date` / `detail.to_date` 是**该公告的展示/失效期**，不是卡池/活动档期：
//     日服 3470：from=2026-10-01 to=2027-01-31，而正文写「開催期間 10/1 12:00 ～ 11/2 11:59」；
//     日服 3477（进化技能追加，其实没有活动期）：from=10-01 to=**2027-01-31**（同批公告共用同一 to_date）；
//     国际服所有详情：to_date 一律 `2026-12-31 23:59:59`（年终哨兵）——连"问题修复"公告也是。
//   → 真正的档期只在 `detail.message` 正文里，且**日文正文还有第二段小期间**
//     （3472 的「販売期間 9/30 12:00 ～ 10/13 4:59」），所以**绝不能**拿 from/to 当档期，
//     否则会把"整批公告的展示期"当成卡池期，`bannerDates` 会是错的（这条是本文件存在的理由）。
//   本解析器因此：① 先从正文抽日期区间（统一 tokenizer，日文/英文共用）；
//                 ② 只有正文里**完全抽不到**区间时，才退化为 from_date ~ to_date
//                    （退化事实标在 `windows[].label` / `source="fallback"` 上，**供测试与排障**，
//                     绝不写进 hover —— 用户 2026-10-03 要求悬停里元信息彻底删掉）；
//                 ③ 外显取"覆盖 now 且开始最晚"的那条区间；一条都不覆盖 now → 返回 null。
//
// ── 分类（靠标题关键词，源站没有分类字段）──────────────────────────────────
//   日服：`ガチャ` → 卡池；`イベント` / `キャンペーン` → 活动。
//   国际服：scout / recruit / gacha / spotlight / pickup / banner → 卡池；
//            event / campaign / celebration / story → 活动；卡池优先。
//
// ── 传输：POST 只能自己封装（lib/env.js 的 fetchText/fetchJson 只支持 GET）────
//   走宿主同源代理 `/api/gacha-calendar-proxy`：代理读**请求体**并透传
//   （src/index.js proxyHandler：`method = body !== "" ? "POST" : "GET"`），
//   所以 POST 的最小形态是 `fetch(proxyUrl, { method:"POST", body: JSON.stringify(payload) })`。
//   ⚠️ 实测（2026-10-02）两个域名响应都**没有 ACAO**（CloudFront `Vary: Origin` 但不回 ACAO）
//   → 只能是 mode="proxy"；但 `umamusume.jp` / `umamusume.com` **不在** src/index.js 的
//   PROXY_ALLOW_HOSTS 白名单里 → 代理会回 403 `host not allowed`（本批次只写 next-sources/，
//   已上报 Lead 加白名单，未擅自改插件本体）。


// ── URL / 时区常量 ──
const ns_umamusume_official_UMA_JP_INDEX_URL = "https://umamusume.jp/api/ajax/pr_info_index?format=json&page=1";
const ns_umamusume_official_UMA_JP_DETAIL_URL = "https://umamusume.jp/api/ajax/pr_info_detail?format=json&announce_id=";
const ns_umamusume_official_UMA_JP_TZ = "Asia/Tokyo";
const ns_umamusume_official_UMA_GLOBAL_INDEX_URL = "https://umamusume.com/api/ajax/pr_info_index?format=json";
const ns_umamusume_official_UMA_GLOBAL_DETAIL_URL = "https://umamusume.com/api/ajax/pr_info_detail?format=json";
const ns_umamusume_official_UMA_GLOBAL_TZ = "UTC";                  // 实测：post_at 为 UTC（日服为 JST，两者不同）
const ns_umamusume_official_UMA_GLOBAL_LABEL_GAME = 1;              // 1=Game / 0=All / 3=Media

/** 每侧最多抓这么多条详情（列表每条候选一次请求，每个列表页最多 6 条候选） */
const ns_umamusume_official_UMA_DEFAULT_MAX_DETAILS = 12;
/** 列表翻页上限（page=1 通常就够；只在第一页没找到覆盖 now 的档期时才翻页） */
const ns_umamusume_official_UMA_DEFAULT_MAX_PAGES = 3;
/** 每页候选（分类命中）上限 */
const ns_umamusume_official_UMA_DEFAULT_PAGE_SIZE = 6;

// ── 分类关键词 ──
const ns_umamusume_official_JP_GACHA_RE = /ガチャ/;
const ns_umamusume_official_JP_EVENT_RE = /イベント|キャンペーン/;
const ns_umamusume_official_GL_GACHA_RE = /scout|recruit|gacha|spotlight|pickup|pick-?up|banner/i;
const ns_umamusume_official_GL_EVENT_RE = /event|campaign|celebration|story/i;

/**
 * 标题分流：返回 "gacha" | "event" | null（null = 与卡池/活动都无关，如「不具合」「功能更新」）。
 * mode="jp" 用日文关键词，mode="global" 用英文关键词；卡池优先于活动。
 */
function ns_umamusume_official_classifyUmaTitle(title, mode = "jp") {
	const t = String(title == null ? "" : title);
	const gacha = mode === "global" ? ns_umamusume_official_GL_GACHA_RE : ns_umamusume_official_JP_GACHA_RE;
	const event = mode === "global" ? ns_umamusume_official_GL_EVENT_RE : ns_umamusume_official_JP_EVENT_RE;
	if (gacha.test(t)) return "gacha";
	if (event.test(t)) return "event";
	return null;
}

// ── 日期区间 tokenizer（日文 / 英文共用）────────────────────────────────────
// 为什么用 tokenizer 而不是一条大正则：正文明日混杂、年份可省、时刻可省、
// 12 小时制的 am/pm 在月日之后、范围符有 `～`/`〜`/`-`/`–` 多种。
// ⚠️ 全部用具名捕获组。早期版本用 $n 下标（`endate` 里嵌了 `(Jan|…)` 与年份组），
//    导致后续下标整体错位（实测 `g[7].slice` 直接 TypeError）→ 换具名组。
const ns_umamusume_official_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const ns_umamusume_official_AMPM = String.raw`(?:a\.?\s?m\.?|p\.?\s?m\.?)`;
const ns_umamusume_official_TOKEN_RE = new RegExp([
	// 日文：2026年10月1日 / 10月1日（"日"必带）
	String.raw`(?<jpdate>(?:(?<y1>\d{4})\s*年\s*)?(?<mo1>\d{1,2})\s*月\s*(?<d1>\d{1,2})\s*日)`,
	// 英文：Sep 28 / September 28, 2026（年份只在**同一段**里粘着才吃，所以 `,?\s*` 里不含 `<`）
	String.raw`(?<endate>\b(?<mon>Jan|Feb|Mar|Apr|May|Jun|Jul|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(?<d3>\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(?<y3>\d{4}))?)`,
	// 数字：2026/10/1 2026-10-01 10/1
	// ⚠️ 分隔符两侧**不能**用 `\b`（`/` `-` 是 non-word，`/\b\d/` 永不成立 → 实测整条 numdate 全不匹配）
	//    → 用数字边界 `(?<!\d)` / `(?!\d)`。`.` 形式必须两侧都有点（`10.1`）。
	String.raw`(?<numdate>(?<![\d\/\-.])(?:(?<y4>\d{4})[\/\-](?<mo4>\d{1,2})[\/\-](?<d4>\d{1,2})|(?<mo5>\d{1,2})[\/\-](?<d5>\d{1,2})|\.(?<mo6>\d{1,2})\.(?<d6>\d{1,2}))(?![\d\/\-.]))`,
	// 裸 4 位年份（英文写法把年份写在末尾：`Oct 12, 2026`）；不能用 `\b`（见上）
	String.raw`(?<yearonly>(?<![\d\/\-.])\d{4}(?![\d\/\-.]))`,
	// 时刻：10:00 / 9:59 + 可选 am/pm（`\b` 在 `:` 右侧不成立，左侧只用数字边界）
	String.raw`(?<time>(?<!\d)(?<hh>\d{1,2}):(?<mm>\d{2})(?!\d)(?:\s*(?<ampm>${ns_umamusume_official_AMPM}))?)`,
	// 范围符：必须是**独立 token**（早期版本漏了这一支 → `～` 不产生 token，窗口永远配不上，
	// 实测症状是所有详情都退化成 from_date～to_date）。
	//   · `～〜〰` 与 en/em dash：直接认（英文原文 `Sep 28–9:59 p.m.` 前面紧贴数字，不能加"前后非数字"断言）
	//   · 半角 `-`：只认两侧带空白的（`2026-10-01` 里紧贴数字的连字符绝不能被当范围符）
	String.raw`(?<sep>[~～〜〰–—]|(?<![\d\w])\s+-\s+(?![\d\w]))`
].join("|"), "g");

/** 文本 → token 流：[{k:"d"|"t"|"y"|"s", …, at, end}] */
function ns_umamusume_official_tokenizeUma(text) {
	const s = String(text == null ? "" : text);
	ns_umamusume_official_TOKEN_RE.lastIndex = 0;
	const toks = [];
	let m;
	while ((m = ns_umamusume_official_TOKEN_RE.exec(s)) !== null) {
		if (m[0] === "") { ns_umamusume_official_TOKEN_RE.lastIndex++; continue; }
		const g = m.groups || {};
		const at = m.index, end = m.index + m[0].length;
		if (g.jpdate) {
			toks.push({ k: "d", y: g.y1 ? +g.y1 : null, mo: +g.mo1, d: +g.d1, at, end });
		} else if (g.endate) {
			toks.push({ k: "d", y: g.y3 ? +g.y3 : null, mo: ns_umamusume_official_MONTHS[g.mon.slice(0, 3).toLowerCase()] || null, d: +g.d3, at, end });
		} else if (g.numdate) {
			toks.push(g.y4
				? { k: "d", y: +g.y4, mo: +g.mo4, d: +g.d4, at, end }
				: { k: "d", y: null, mo: +(g.mo5 != null ? g.mo5 : g.mo6), d: +(g.d5 != null ? g.d5 : g.d6), at, end });
		} else if (g.yearonly) {
			toks.push({ k: "y", y: +g.yearonly, at, end });
		} else if (g.time) {
			let h = +g.hh;
			const mi = +g.mm;
			const ap = String(g.ampm || "").replace(/[.\s]/g, "").toLowerCase();
			if (ap.startsWith("p") && h < 12) h += 12;
			if (ap.startsWith("a") && h === 12) h = 0;
			toks.push({ k: "t", h, mi, at, end });
		} else if (g.sep) {
			toks.push({ k: "s", at, end });
		}
	}
	return toks;
}
/** 调试用（测试可直接断言 token 流） */
function ns_umamusume_official_debugUmaTokens(text) { return ns_umamusume_official_tokenizeUma(text); }

// ── 档期区间的"标板"（plate）正则 ───────────────────────────────────────────
// 走「正则切候选串 → tokenizer 解释」两条腿：位置运算交给正则引擎，避免手工下标。
// ⚠️ 本文件早期版本在同一个 token 数组上手写 `j`/`firstSepIdx` 双重游标，实测出现
//    `j=4 但 seq=["d:11/2"]`（范围符凭空消失）这种自相矛盾状态，最后定位为下标耦合错误。
//    改成正则标板后，从结构上不可能再出现"范围符没被收进 seq"的情况。
const ns_umamusume_official_F_DATE = String.raw`(?:(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*日|(?:\d{4}[\/\-])?\d{1,2}[\/\-]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?)`;
const ns_umamusume_official_F_TIME = String.raw`(?:\d{1,2}:\d{2}(?:\s*(?:a\.?\s?m\.?|p\.?\s?m\.?))?)`;
const ns_umamusume_official_F_SEP = String.raw`(?:[~～〜〰–—]|\s-\s)`;
const ns_umamusume_official_F_ATOM = String.raw`(?:(?:${ns_umamusume_official_F_TIME}\s*,?\s*)?${ns_umamusume_official_F_DATE}(?:\s*,?\s*${ns_umamusume_official_F_TIME})?(?:\s*,?\s*\d{4})?|${ns_umamusume_official_F_TIME})`;
/** 用于"抹掉上下文里的日期/时刻"（取 label 时），以及定位相邻区间 */
const ns_umamusume_official_DATE_TIME_SPAN_RE = new RegExp(String.raw`${ns_umamusume_official_F_ATOM}|${ns_umamusume_official_F_TIME}\s*,`, "g");
const ns_umamusume_official_RANGE_PLATES = [
	new RegExp(String.raw`${ns_umamusume_official_F_ATOM}\s*${ns_umamusume_official_F_SEP}\s*${ns_umamusume_official_F_ATOM}`, "g"),
	// 兜底写法：「…10/1 12:00から11/2 11:59まで」（没有范围符，用「から」）
	/(?:(?:\d{1,2}[\/\-]\d{1,2})\s*\d{1,2}:\d{2}[^\d]{0,8}から[^\d]{0,8}(?:\d{1,2}[\/\-]\d{1,2})\s*\d{1,2}:\d{2})/g
];

/** 从正文里切出所有"日期[时刻] 范围符 日期[时刻]"候选串（含位置，供 label 取上下文）；去重叠 */
function ns_umamusume_official_extractUmaRangePlates(s) {
	const text = String(s == null ? "" : s);
	const found = [];
	for (const re of ns_umamusume_official_RANGE_PLATES) {
		re.lastIndex = 0;
		let m;
		while ((m = re.exec(text)) !== null) {
			if (m[0] === "") { re.lastIndex++; continue; }
			found.push({ text: m[0], at: m.index });
		}
	}
	found.sort((a, b) => (a.at - b.at) || (b.text.length - a.text.length));
	const picked = [];
	for (const f of found) {
		if (picked.some((p) => f.at < p.at + p.text.length && p.at < f.at + f.text.length)) continue;
		picked.push(f);
	}
	return picked;
}

/**
 * 标签清洗（从"范围起点之前"的正文里取短标签，如「イベント開催期間」「Spotlight Scout Availability Period」）。
 *
 * ⚠️ 踩过的两个坑，顺序不能反：
 *   ① **先切段再去标签**会切在标签属性里（`<h2 class="heading">` 的最后一个 `>` 落在属性引号里）
 *      → 必须先 `strip tags`，再按句读/换行切段；
 *   ② 不能停在句读/"！"上取整段：日文长公告里"上一段正文 + 下一段标题"中间是句号
 *      （`…開催中です！ イベント開催期間 9/30 …`）→ 段内还有正文。所以段内再取
 *      **最后一个全角空格后的片段**（日文标题与正文之间正是全角空格），并把空白折叠成 `·`。
 *   最后掐掉段首引导词（`As of` / `until` / `まで`）与段尾连接词（`from` / `（UTC）`）。
 */
const ns_umamusume_official_LABEL_LEAD_RE = /^(?:as of|from|until|till|on|at|the|period|期間|日時)\s*[:：]?\s*/i;
const ns_umamusume_official_LABEL_TAIL_RE = /[\s（(]*(?:from|to|until|till|at|on|まで|から|より|以降|以前)[\s（()）]*$/i;
function ns_umamusume_official_labelBeforeUma(text, at) {
	const head = String(text == null ? "" : text).slice(Math.max(0, at - 180), at);
	const plain = head.replace(/<[^>]*>/g, " ").replace(ns_umamusume_official_DATE_TIME_SPAN_RE, " ");
	// ⚠️ 切段对象必须**先掐掉尾部空白**：`…Period</h2>\n ` 去标签后是 `…Period \n `，
	//    直接按最后一个 `\n` 切会只剩一个空格 → 标签全空（实测英文标签就是这么丢的）
	const trimmed = plain.replace(/\s+$/, "");
	const cut = Math.max(trimmed.lastIndexOf("\n"), trimmed.lastIndexOf("。"), trimmed.lastIndexOf("！"), trimmed.lastIndexOf("!"));
	const seg = trimmed.slice(cut >= 0 ? cut + 1 : 0);
	// 段内取最后一个全角空格后的片段（仅当该空格前面出现 CJK 时；否则英文标题会被切碎）
	const zs = seg.lastIndexOf("\u3000");
	const tail = zs >= 0 && /[぀-ヿ一-鿿]/.test(seg.slice(0, zs)) ? seg.slice(zs + 1) : seg;
	let x = tail.replace(/\s+/g, "·").trim();
	// ⚠️ 两端只能用**字符类**裁剪：`(?:connector)?\s*$` 这种"可选+空白"的正则会把整段吃掉
	//    （实测 `…Availability Period` 被整段删除，因为可选组匹配空 + `\s*$` 匹配了结尾）
	x = x.replace(/^[·\s■・:：、,，\-–—]+/, "").replace(/[·\s,、，■・:：–—-]+$/, "");
	x = x.replace(ns_umamusume_official_LABEL_LEAD_RE, "").replace(ns_umamusume_official_LABEL_TAIL_RE, "");
	x = x.replace(/^&nbsp;|^[·・]+/i, "").replace(/[·\s,、，■・:：–—&-]+$/i, "").trim();
	if (x.length > 40) x = x.slice(-40).trim();
	return x;
}

/**
 * 正文 → 档期窗口数组 [{ startTs, endTs, raw, label }]（按出现顺序，按绝对区间去重）。
 * tz = 源站墙钟时区；hintTs = 该公告 post_at 换算出的绝对时刻（用于补年份）。
 *
 * 两种语序都要吃（实测两种都存在）：
 *   日文 `開催期間 10/1 12:00 ～ 11/2 11:59`                        → [d,t] ～ [d,t]
 *   英文 `Period 10:00 p.m., Sep 28–9:59 p.m., Oct 12, 2026 (UTC)` → [t,d] ～ [t,d]，年份在末段末尾
 */
function ns_umamusume_official_parseUmaWindows(text, tz, hintTs = null) {
	const s = String(text == null ? "" : text);
	const hintParts = hintTs != null && Number.isFinite(hintTs) ? sourceWallParts(hintTs, tz) : null;
	// ⚠️ 这里**有意**不用共用 `inferYear`，理由有两条（不是漏改）：
	//   ① 本源的年份线索是**公告自己的时间戳**（`post_at`），生产路径上一定拿得到，
	//      所以"没有线索"分支实际不可达；退回 `new Date().getFullYear()` 只是兜底。
	//   ② `inferYear` 会做"起始月比线索月晚 6 个月以上 → 算**去年**"的修正 —— 那条规则是为
	//      **当期/近期**公告写的；而赛马娘日服会提前 1~2 个月公告未来活动，
	//      极端情况下（年初公告年末活动）套上去会把**今年**误判成去年。
	//   凡是要合并这条规则的场合，先确认该源的窗口不会远在 hints 之后。
	const hintYear = hintParts ? hintParts.y : new Date().getFullYear();
	const out = [];
	const seen = new Set();

	for (const plate of ns_umamusume_official_extractUmaRangePlates(s)) {
		const toks = ns_umamusume_official_tokenizeUma(plate.text);
		const sepIdx = toks.findIndex((t) => t.k === "s");
		if (sepIdx < 0) continue;
		const left = toks.slice(0, sepIdx);
		const right = toks.slice(sepIdx + 1);
		const startDate = left.find((t) => t.k === "d") || null;
		const startTime = left.find((t) => t.k === "t") || null;
		const endDate = right.find((t) => t.k === "d") || null;
		const endTime = right.find((t) => t.k === "t") || null;
		if (!startDate || (!endDate && !endTime)) continue;

		const y1 = startDate.y != null ? startDate.y : hintYear;
		let y2, mo2, d2;
		if (endDate) {
			mo2 = endDate.mo || startDate.mo;
			d2 = endDate.d;
			const ey = endDate.y != null ? endDate.y : (right.find((t) => t.k === "y") || {}).y;
			y2 = ey != null ? ey : y1;
			// 跨年：末段月日比起点早且没写年份 → +1 年
			if (ey == null && endsNextYear(startDate.mo, startDate.d, mo2, d2)) y2 = y1 + 1;
		} else {
			mo2 = startDate.mo; d2 = startDate.d; y2 = y1;
		}
		const h1 = startTime ? startTime.h : 0, mi1 = startTime ? startTime.mi : 0;
		const h2 = endTime ? endTime.h : 23, mi2 = endTime ? endTime.mi : 59;
		const startTs = sourceInstant(y1, startDate.mo, startDate.d, h1, mi1, tz);
		const endTs = sourceInstant(y2, mo2, d2, h2, mi2, tz);
		if (!(endTs > startTs)) continue;
		const key = startTs + "|" + endTs;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ startTs, endTs, raw: plate.text.replace(/\s+/g, " ").trim(), label: ns_umamusume_official_labelBeforeUma(s, plate.at) });
	}
	return out;
}

// ── 公告条目 / 详情 ─────────────────────────────────────────────────────────
/** `"2026-10-01 12:00:00"` 这种源站墙钟 → 绝对毫秒（按 tz 解释，**不**用 Date 直接解析） */
function ns_umamusume_official_parseUmaInstant(s, tz) {
	const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s == null ? "" : s).trim());
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}

/** 列表 JSON → [{ id, title, kind, postTs, postText }]（保持源站顺序：新→旧） */
function ns_umamusume_official_parseUmaIndex(json, mode = "jp", tz = ns_umamusume_official_UMA_JP_TZ) {
	if (!json || typeof json !== "object") throw new Error("uma-bad-json");
	if (json.response_code !== 1) throw new Error("uma-bad-response:" + json.response_code);
	const list = json.information_list;
	if (!Array.isArray(list)) throw new Error("uma-bad-list");
	const out = [];
	for (const it of list) {
		if (!it || typeof it !== "object") continue;
		const id = it.announce_id;
		if (id == null) continue;
		const title = String(it.title == null ? "" : it.title).replace(/\s+/g, " ").trim();
		out.push({
			id,
			title,
			kind: ns_umamusume_official_classifyUmaTitle(title, mode),
			postTs: ns_umamusume_official_parseUmaInstant(it.post_at, tz),
			postText: it.post_at == null ? "" : String(it.post_at)
		});
	}
	return out;
}

/**
 * 详情 JSON → { id, title, windows, source, postTs, kind }。
 *   source = "body"    ：档期来自正文（正常路径）
 *   source = "fallback"：正文里一条区间都抽不到 → 退化为 from_date ~ to_date
 *                        （只在 `windows[].label` 上标注，**不进 hover**）
 *   source = "none"    ：正文与 from/to 都没有区间 → windows 为空
 */
function ns_umamusume_official_parseUmaDetail(json, tz = ns_umamusume_official_UMA_JP_TZ, classifyMode = "jp") {
	if (!json || typeof json !== "object") throw new Error("uma-bad-json");
	if (json.response_code !== 1) throw new Error("uma-bad-response:" + json.response_code);
	const d = json.detail || json.information || null;
	if (!d || typeof d !== "object") throw new Error("uma-bad-detail");
	const title = String(d.title == null ? "" : d.title).replace(/\s+/g, " ").trim();
	const postTs = ns_umamusume_official_parseUmaInstant(d.post_at, tz);
	let windows = ns_umamusume_official_parseUmaWindows(d.message, tz, postTs);
	let source = windows.length ? "body" : "none";
	if (!windows.length) {
		const fromTs = ns_umamusume_official_parseUmaInstant(d.from_date, tz);
		const toTs = ns_umamusume_official_parseUmaInstant(d.to_date, tz);
		if (fromTs != null && toTs != null && toTs > fromTs) {
			windows = [{ startTs: fromTs, endTs: toTs, raw: `${d.from_date} ～ ${d.to_date}`, label: "from_date～to_date（正文无区间，退化；**非**真实档期）" }];
			source = "fallback";
		}
	}
	return { id: d.announce_id, title: title || "", windows, source, postTs, kind: ns_umamusume_official_classifyUmaTitle(title, classifyMode) };
}

// ── 选当期 / 悬停 ───────────────────────────────────────────────────────────
/**
 * 覆盖 now 的「公告 × 窗口」对，按固定偏好排序：
 *   ① startTs 最新（并列取 endTs 更早、id 更小）；
 *   ② 并列时**预告稿排后**：日服同一档期常有两篇（`【予告】…開催決定！` + 正式 `…開催！`），
 *      实测 3469/3470 的窗口完全一样（都是 10-01 12:00 ~ 11-02 11:59）→ 否则外显会显示预告稿。
 *
 * ⚠️ 一条都不覆盖 now → 空数组（`ns_umamusume_official_pickUmaWindow` 据此返回 null = 未公布，绝不把过期/未来档期硬凑成"当期"）。
 * ⚠️ 排序**同时**服务外显与悬停：`ns_umamusume_official_pickUmaWindow` 取第 0 项当外显；`hoverEvent` 不重排 →
 *    活动悬停的第一行就是外显的那条。`hoverPool` 自带"按结束时间升序"的规则（与本体一致），会重排卡池。
 */
function ns_umamusume_official_umaCurrentWindows(entries, now) {
	const active = [];
	for (const e of entries) for (const w of e.windows) if (coversNow(w, now)) active.push({ e, w });
	if (!active.length) return [];
	const previewRank = (e) => (/予告|coming soon/i.test(String(e.title || "")) ? 1 : 0);
	active.sort((x, y) =>
		(y.w.startTs - x.w.startTs)
		|| (previewRank(x.e) - previewRank(y.e))
		|| (x.w.endTs - y.w.endTs)
		|| (x.e.id - y.e.id));
	return active;
}

/**
 * 从多个详情的窗口里选当期：覆盖 now 的窗口里取 startTs 最新（并列取 endTs 更早、id 更小）。
 * 一条都不覆盖 → **返回 null**（未公布），绝不把过期/未来档期硬凑成"当期"。
 */
function ns_umamusume_official_pickUmaWindow(entries, now) {
	return ns_umamusume_official_umaCurrentWindows(entries, now)[0] || null;
}

/**
 * 当期项（交给 `lib/env.js` 的 `hoverPool` / `hoverEvent` 排版）：**一条公告最多一项**。
 *   · `name` = 公告标题（即卡池名 / 活动名）—— 与本体的 `banner：roles` / 活动名同构；
 *     ⚠️ 官方公告**只有标题、没有"角色"字段**，所以卡池悬停的 `name` 就是 `banner` 本身
 *     （本体是 `池名：角色`，这里退化成只有池名；**不**去正文猜角色，也不补任何前缀）。
 *   · 一条公告正文可能有**多段**覆盖 now 的小期间（实测 3472 有 3 段、3481 有 2 段）→ 只取
 *     `ns_umamusume_official_umaCurrentWindows` 里该公告的**第一段**（startTs 最新、并列取 endTs 更早），
 *     否则同名活动会在悬停里重复 2~3 行（本体一律一条目一行）。
 *   · 档期交给共用工具用**源站 tz**（日服 JST / 国际服 UTC）格式化成 `MM-DD HH:MM ~ MM-DD HH:MM`。
 *
 * ⚠️ 悬停里**只放名称与档期**（用户 2026-10-03：「元信息彻底删掉」）。以下信息一律**不进悬停文本**：
 *     来源站名 / URL / API 名 · 时区推定说明 · 抓取统计（`共扫描 N 条 / 取详情 M 条`）·
 *     内部公告 id（`[3470]`）· 源站字段名标签（`開催期間` / `Event·Availability·Period`）·
 *     游戏名+区服前缀 · fallback 退化说明与任何「（…）」实现说明。
 *     这些只留在**代码注释**与 `ns_umamusume_official_parseUmaDetail` 的 `source` / `windows[].label` 字段里（供测试与排障）。
 *     ⚠️ 所以这里**不传 `label`**：`hoverPool` 会用 `label` 顶掉 `name`，而 label 正是源站字段名。
 *
 * ⚠️ 抓取策略说明（"每条候选抓一次详情、每页最多 N 条候选"）写在 `ns_umamusume_official_collectSide` 的注释里，不进悬停。
 */
function ns_umamusume_official_umaCurrentItems(entries, now) {
	const seen = new Set();
	const out = [];
	for (const { e, w } of ns_umamusume_official_umaCurrentWindows(entries, now)) {
		const key = e.id != null ? "id:" + e.id : e;      // 同一条公告只留第一段（见上）
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ name: e.title, startTs: w.startTs, endTs: w.endTs, raw: w.raw });
	}
	return out;
}

// ── 传输：POST 自己封装（lib/env.js 的 fetchText/fetchJson 只支持 GET）────────
const ns_umamusume_official_PROXY_PREFIX = "/api/gacha-calendar-proxy";

/** 代理 URL（与 lib/env.js 同形态；测试夹具 harness 能识别该前缀并取出被代理的 url） */
function ns_umamusume_official_proxyUrlFor(url, referer = "", headers = null, contentType = null) {
	let api = ns_umamusume_official_PROXY_PREFIX + "?url=" + encodeURIComponent(url) + "&referer=" + encodeURIComponent(referer);
	if (headers) api += "&headers=" + encodeURIComponent(JSON.stringify(headers));
	if (contentType) api += "&contentType=" + encodeURIComponent(contentType);
	return api;
}

/**
 * POST JSON 的抓取封装。
 *   mode="proxy"（默认）：宿主代理读**请求体**并透传为 POST（见 src/index.js proxyHandler）
 *   mode="direct"       ：浏览器原生 fetch（本两源无 ACAO，实跑只能走 proxy）
 * 结构问题（坏 JSON / 非 200 / 代理拒绝）→ throw。
 */
async function ns_umamusume_official_postJsonUma(url, body, { referer = "", headers = null, signal, mode = "proxy", label = "uma" } = {}) {
	const fetchImpl = globalThis.fetch;
	if (typeof fetchImpl !== "function") throw new Error(label + "-no-fetch");
	const payload = JSON.stringify(body == null ? {} : body);
	if (mode === "direct") {
		const res = await fetchImpl(url, {
			method: "POST",
			signal,
			headers: { "content-type": "application/json; charset=utf-8", accept: "application/json, text/plain, */*", ...(headers || {}), ...(referer ? { referer } : {}) },
			body: payload
		});
		if (!res.ok) throw new Error(label + "-http-" + res.status);
		const text = await res.text();
		try { return JSON.parse(text); } catch { throw new Error(label + "-bad-json"); }
	}
	const api = ns_umamusume_official_proxyUrlFor(url, referer, headers, "application/json; charset=utf-8");
	const res = await fetchImpl(api, { method: "POST", signal, headers: { Accept: "application/json", "content-type": "application/json; charset=utf-8" }, body: payload });
	if (!res.ok) throw new Error(label + "-proxy-http-" + res.status);
	const text = await res.text();
	let j = null;
	try { j = JSON.parse(text); } catch { j = null; }
	if (!j || typeof j !== "object") throw new Error(label + "-proxy-bad-json");
	if (j.status !== 200 || typeof j.body !== "string") throw new Error(label + "-proxy:" + (j.error || j.status));
	try { return JSON.parse(j.body); } catch { throw new Error(label + "-bad-json"); }
}

function ns_umamusume_official_originOf(url) { try { return new URL(url).origin + "/"; } catch { return ""; } }
/** 日服列表 URL 构造函数：分页参数**只有 `page`**（实测 p / page_no / limit / size 全无效） */
function ns_umamusume_official_umaJpPageUrl(base, page) {
	const b = String(base || ns_umamusume_official_UMA_JP_INDEX_URL);
	if (/[?&]page=\d+/.test(b)) return b.replace(/([?&])page=\d+/, "$1page=" + page);
	return b + (b.includes("?") ? "&" : "?") + "page=" + page;
}

// ── 抓取主循环 ──────────────────────────────────────────────────────────────
/**
 * 通用主循环：列表新→旧，只看"卡池/活动"命中的条目；逐条抓详情抽窗口。
 *
 * ⚠️ 为什么**不**在"拿到第一个覆盖 now 的窗口"时就 break：
 *    同一页里可能有多条都覆盖 now（实测日服 page1：卡池 3470/3469 同窗口、活动 3481 与 3472 多段期间），
 *    而列表顺序 ≠ 档期新旧 → 提前 break 会让外显取决于"源站列表顺序"（不确定、且可能选到较旧的那条）。
 *    所以本函数**把本页所有分类命中的候选都扫完**（受 `pageSize`/`maxDetails` 约束），
 *    再由 `ns_umamusume_official_pickUmaWindow` 客观地取"覆盖 now 且 startTs 最新"的那条。
 *    只有"整页都没有覆盖 now 的窗口"时才翻下一页（更早的页只会有更旧的档期，没必要继续）。
 *
 * 错误处理：第一页列表失败 → throw（该侧算抓取失败）；后续页失败 → 当作"没有更多"停止翻页；
 *          单条详情失败 → 跳过并计数（不当成整侧失败）。
 */
async function ns_umamusume_official_collectSide({ side, kind, indexUrl, tz, now, signal, maxDetails, maxPages, pageSize, detailUrlFor }) {
	const details = [];
	const scanned = [];
	let detailCount = 0;
	let skipped = 0;
	const isGlobal = kind === "global";

	for (let page = 1; page <= maxPages && detailCount < maxDetails; page++) {
		const listUrl = isGlobal ? indexUrl : ns_umamusume_official_umaJpPageUrl(indexUrl, page);
		let listJson;
		try {
			listJson = isGlobal
				? await ns_umamusume_official_postJsonUma(indexUrl, { announce_label: ns_umamusume_official_UMA_GLOBAL_LABEL_GAME, limit: 50, offset: 0 }, { referer: ns_umamusume_official_originOf(indexUrl), signal, label: "uma-global-index" })
				: await fetchJson(listUrl, { signal, mode: "proxy", referer: ns_umamusume_official_originOf(listUrl) });
		} catch (e) {
			if (page === 1) throw e;
			break;
		}
		const items = ns_umamusume_official_parseUmaIndex(listJson, kind, tz);
		for (const it of items) scanned.push(it);
		const cands = items.filter((x) => x.kind === side).slice(0, pageSize);
		let covered = false;
		for (const c of cands) {
			if (detailCount >= maxDetails) break;
			const detailUrl = isGlobal ? ns_umamusume_official_UMA_GLOBAL_DETAIL_URL : detailUrlFor(c.id);
			let dj;
			try {
				dj = isGlobal
					? await ns_umamusume_official_postJsonUma(detailUrl, { announce_id: c.id }, { referer: ns_umamusume_official_originOf(detailUrl), signal, label: "uma-global-detail" })
					: await fetchJson(detailUrl, { signal, mode: "proxy", referer: ns_umamusume_official_originOf(detailUrl) });
			} catch { skipped++; detailCount++; continue; }
			detailCount++;
			let det;
			try { det = ns_umamusume_official_parseUmaDetail(dj, tz, kind); } catch { skipped++; continue; }
			if (!det.title) det.title = c.title;
			if (det.id == null) det.id = c.id;
			details.push(det);
			if (det.windows.some((w) => coversNow(w, now))) covered = true;
		}
		if (covered) break;                      // 本页已有覆盖 now 的候选 → 不再翻页（更早的页只会更旧）
	}
	return { details, scanned, detailCount, skipped };
	// ⚠️ `scanned` / `detailCount` / `skipped` 只作**诊断计数**（原来被拼进悬停首行「共扫描 N 条 / 取详情 M 条」，
	//    用户 2026-10-03 要求「元信息彻底删掉」→ 该首行已删，计数保留给排障与将来日志，**绝不进悬停文本**）。
}

// ── 日服 ────────────────────────────────────────────────────────────────────
/**
 * 赛马娘 日服 官方公告 卡池侧。
 * @param {string} url 列表 URL（默认 ns_umamusume_official_UMA_JP_INDEX_URL；分页参数 `page`）
 * @param {AbortSignal} signal
 * @param {string} tz 源站时区（默认 Asia/Tokyo）
 * @param {number} now 当前时刻（**第 4 参**；仓库历史 bug 是把 now 放第 2 参 → startTs<=now 恒假）
 * @param {{maxDetails?:number,maxPages?:number,pageSize?:number}} opts
 */
async function ns_umamusume_official_gachaUmaJpOfficial(url, signal, tz = ns_umamusume_official_UMA_JP_TZ, now = Date.now(), opts = {}) {
	const r = await ns_umamusume_official_collectSide({
		side: "gacha", kind: "jp", indexUrl: url || ns_umamusume_official_UMA_JP_INDEX_URL, tz, now, signal,
		maxDetails: opts.maxDetails || ns_umamusume_official_UMA_DEFAULT_MAX_DETAILS,
		maxPages: opts.maxPages || ns_umamusume_official_UMA_DEFAULT_MAX_PAGES,
		pageSize: opts.pageSize || ns_umamusume_official_UMA_DEFAULT_PAGE_SIZE,
		detailUrlFor: (id) => ns_umamusume_official_UMA_JP_DETAIL_URL + id
	});
	const picked = ns_umamusume_official_pickUmaWindow(r.details, now);
	if (!picked) return null;                       // 抓到公告但当期没有覆盖 now 的卡池期 = 未公布
	// ≥2 个当期池才给悬停；只有 1 个 → **不设** bannerHover，交回 UI 默认两行式（`池名：角色` ⏎ 档期）
	const bannerHover = hoverPool(ns_umamusume_official_umaCurrentItems(r.details, now), tz);
	return {
		banner: picked.e.title,
		bannerDates: fmtWindow(picked.w.startTs, picked.w.endTs, tz),
		bannerDatesRaw: picked.w.raw,
		startTs: picked.w.startTs,
		endTs: picked.w.endTs,
		...(bannerHover ? { bannerHover } : {})
	};
}

/** 赛马娘 日服 官方公告 活动侧（イベント / キャンペーン）。now 是第 4 参。 */
async function ns_umamusume_official_eventsUmaJpOfficial(url, signal, tz = ns_umamusume_official_UMA_JP_TZ, now = Date.now(), opts = {}) {
	const r = await ns_umamusume_official_collectSide({
		side: "event", kind: "jp", indexUrl: url || ns_umamusume_official_UMA_JP_INDEX_URL, tz, now, signal,
		maxDetails: opts.maxDetails || ns_umamusume_official_UMA_DEFAULT_MAX_DETAILS,
		maxPages: opts.maxPages || ns_umamusume_official_UMA_DEFAULT_MAX_PAGES,
		pageSize: opts.pageSize || ns_umamusume_official_UMA_DEFAULT_PAGE_SIZE,
		detailUrlFor: (id) => ns_umamusume_official_UMA_JP_DETAIL_URL + id
	});
	const picked = ns_umamusume_official_pickUmaWindow(r.details, now);
	if (!picked) return null;
	// ≥2 条当期活动才给悬停；只有 1 条 → **不设** eventHover，交回 UI 默认两行式（`名称` ⏎ 档期）
	const eventHover = hoverEvent(ns_umamusume_official_umaCurrentItems(r.details, now), tz);
	return {
		event: picked.e.title,
		eventDates: fmtWindow(picked.w.startTs, picked.w.endTs, tz),
		eventDatesRaw: picked.w.raw,
		...(eventHover ? { eventHover } : {})
	};
}

// ── 国际服（POST；时区 UTC）─────────────────────────────────────────────────
async function ns_umamusume_official_collectGlobal(side, url, tz, now, signal, opts) {
	const indexUrl = url || ns_umamusume_official_UMA_GLOBAL_INDEX_URL;
	return ns_umamusume_official_collectSide({
		side, kind: "global", indexUrl, tz, now, signal,
		maxDetails: opts.maxDetails || ns_umamusume_official_UMA_DEFAULT_MAX_DETAILS,
		maxPages: opts.maxPages || ns_umamusume_official_UMA_DEFAULT_MAX_PAGES,
		pageSize: opts.pageSize || ns_umamusume_official_UMA_DEFAULT_PAGE_SIZE,
		detailUrlFor: () => ns_umamusume_official_UMA_GLOBAL_DETAIL_URL
	});
}

/** 赛马娘 国际服（Global）官方公告 卡池侧（Scout）。now 是第 4 参。 */
async function ns_umamusume_official_gachaUmaGlobal(url, signal, tz = ns_umamusume_official_UMA_GLOBAL_TZ, now = Date.now(), opts = {}) {
	const r = await ns_umamusume_official_collectGlobal("gacha", url, tz, now, signal, opts);
	const picked = ns_umamusume_official_pickUmaWindow(r.details, now);
	if (!picked) return null;
	// 同卡池侧：≥2 个当期池才给悬停，否则交回 UI 默认两行式
	const bannerHover = hoverPool(ns_umamusume_official_umaCurrentItems(r.details, now), tz);
	return {
		banner: picked.e.title,
		bannerDates: fmtWindow(picked.w.startTs, picked.w.endTs, tz),
		bannerDatesRaw: picked.w.raw,
		startTs: picked.w.startTs,
		endTs: picked.w.endTs,
		...(bannerHover ? { bannerHover } : {})
	};
}

/** 赛马娘 国际服（Global）官方公告 活动侧。now 是第 4 参。 */
async function ns_umamusume_official_eventsUmaGlobal(url, signal, tz = ns_umamusume_official_UMA_GLOBAL_TZ, now = Date.now(), opts = {}) {
	const r = await ns_umamusume_official_collectGlobal("event", url, tz, now, signal, opts);
	const picked = ns_umamusume_official_pickUmaWindow(r.details, now);
	if (!picked) return null;
	// 同活动侧：≥2 条当期活动才给悬停，否则交回 UI 默认两行式
	const eventHover = hoverEvent(ns_umamusume_official_umaCurrentItems(r.details, now), tz);
	return {
		event: picked.e.title,
		eventDates: fmtWindow(picked.w.startTs, picked.w.endTs, tz),
		eventDatesRaw: picked.w.raw,
		...(eventHover ? { eventHover } : {})
	};
}
