// src/client/30-game-cygames.js —— Cygames：赛马娘 日服/国际服/繁中服/韩服/国服 + 公主连结 日服/繁中服 + 碧蓝幻想
//
// 职责（2026-11-16 按厂商重排）：Cygames 系（含代理服）的条目 + 解析器 + 抓取器 + 登记都在本文件；
//   每个 id 只在此注册一次（符号名沿用原 `ns_*`）。
// 组成：
//   · 本文件原有：uma-jp / uma-global（官网公告 / GameTora；umapyoi 与 bwiki 为备选源）；
//   · 并入 30-game-komoe.js：uma-tw（繁中服，Komoe 官方公告）；并入 30-game-daum.js：uma-kr（韩服，Daum 카페）；
//   · 并入 30-game-biligame.js 里 uma-cn 的官方公告解析与注册（来源 = api.biligame.com，tz=Asia/Shanghai）；
//   · 并入 30-game-pcr-jp.js（日服，microCMS）与 30-game-pcr-tw.js（繁中服，So-net 官网公告）；
//   · 并入 30-game-batch3.js 的 ① 段：gbf（碧蓝幻想，gbf-wiki 活动一览；卡池侧未配置）；
//   · 并入 30-game-bwiki-uma-cn.js / -bwiki-uma-jp.js 两个 bwiki 解析器（均为备选源）。
// 复用关系：bwiki 公共层与 bwiki-html-fetchers.js（uma-cn-bwiki / uma-jp-bwiki 抓取器）、
//   biligame 官方新闻 API 公共层（30-game-biligame-common.js，uma-cn 用）；各款解析器互不共享。
// 请求预算：赛马娘各服 1~2 次/轮；uma-cn 列表 1 + 详情 ≤8 篇（标题不在本侧就跳过）；gbf 1 次（URL 缓存 24h）；
//   pcr-jp 列表 1 + 详情（按 id 缓存 24h）；pcr-tw 列表 1 页 + 每侧详情 ≤2 篇（按 id 缓存 24h）。

		// ══ 以下为原 42-parsers-cygames.js 的内容（原样保留；压平后见 30-game-cygames.js）══
// src/client/42-parsers-cygames.js —— Cygames 系（赛马娘 日服 / 国际服）（压平后见 30-game-cygames.js）
//
// ⚠️ 2026-10-03 按**游戏厂商 / 来源平台**合并（用户要求）：原先一款游戏一个文件（17 个），
//    现按厂商/系列归并成 10 个。合并只改**文件边界**，符号名（`ns_<域>_` 前缀）**一个都没动** ——
//    所以 `44-test-exports.js` 的模块命名空间、`test/registry-shim.mjs` 的抓取器对照表、
//    以及所有用例都不受影响（它们认的是符号名，不是文件名）。
//
//    本文件由以下文件**原样**拼接而成（各自的原文件头整体保留，前面加了分隔标记）：
//      · 42-parsers-umamusume-official.js   赛马娘 日服 / 国际服 官网公告（压平后见 30-game-cygames.js）
//      · 42-parsers-umapyoi.js              赛马场日服 umapyoi 第三方库（备选源）（压平后见 30-game-cygames.js）

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-umamusume-official.js（压平后见 30-game-cygames.js）
// ─────────────────────────────────────────────────────────────────────────────
// 原 src/client/35-parsers-umamusume-official.js（压平后见 30-game-cygames.js）
//
// 由 next-sources/parsers/umamusume-official.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_umamusume-official__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// 原 src/client/35-parsers-umamusume-official.js（压平后见 30-game-cygames.js） —— 赛马娘 **官方公告**（日服 umamusume.jp + 国际服 umamusume.com）
//
// 契约：async (url, signal, tz, now = nowMs()) → 数据对象 | null
//   卡池侧 { banner, bannerDates, bannerDatesRaw?, startTs?, endTs?, bannerHover? }
//   活动侧 { event, eventDates, eventDatesRaw?, eventHover? }
//   null = 未公布（抓到了公告，但没有覆盖 now 的档期）；只有结构性损坏才 throw。
//   `bannerHover` / `eventHover` 只在**当期 ≥2 条**时出现（`hoverPool` / `hoverEvent` 返回空串 → 本文件不设该字段），
//   否则交回 UI 的默认单条两行式；内容只有「名称 + 档期」，**不含任何元信息**（见 `ns_umamusume_official_umaCurrentItems` 的说明）。
//
// ── 与既有源的关系（**并存，不替换**）────────────────────────────────────────
//   · 日服：既有 `30-game-cygames.js` 的 umapyoi 侧（第三方 api.umapyoi.net，只有"卡级获取窗口"、无卡池名）
//     与本文件的 `uma-jp-official`（官网公告，有卡池名 + 完整活动/卡池文案）**并存**。
//   · 国际服：既有 `30-game-bwiki-common.js` 的 `eventsUmaJp` / `gachaUmaCn`（bwiki 表格，简中服）
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
// ── 传输：POST 只能自己封装（lib/env.js 的 fetchText/fetchJson 只支持 GET；压平后见 22-fetcher-core.js）────
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
	//      所以"没有线索"分支实际不可达；退回 `new Date(nowMs()).getFullYear()` 只是兜底。
	//   ② `inferYear` 会做"起始月比线索月晚 6 个月以上 → 算**去年**"的修正 —— 那条规则是为
	//      **当期/近期**公告写的；而赛马娘日服会提前 1~2 个月公告未来活动，
	//      极端情况下（年初公告年末活动）套上去会把**今年**误判成去年。
	//   凡是要合并这条规则的场合，先确认该源的窗口不会远在 hints 之后。
	const hintYear = hintParts ? hintParts.y : new Date(nowMs()).getFullYear();
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
	// ⚠️ 2026-11-09（用户拍板**撤回**）：**这里不认"200 空壳 = nomatch"**。
	//    `{"response_code":200}`（21 字节）是**用 GET 打这个接口**才会拿到的退化响应 ——
	//    `pr_info_index` 只认 POST + `Content-Type: application/json`。空壳不是接口契约的一部分，
	//    把它当 nomatch 只会把"传输层把 POST 降级成 GET"这种**真故障**悄悄吞掉（症状：整侧"未公布"）。
	//    ⇒ 恢复原语义：`response_code !== 1` 一律抛（该侧如实报失败）。POST 契约见下方 uma-global 注册项注释。
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
 * 当期项（交给 `lib/env.js` 的 `hoverPool` / `hoverEvent` 排版，压平后见 28-parser-hover-tools.js）：**一条公告最多一项**。
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
		// `title` = P3b 的条目事实（反生成器与数组收口读它）；`name` 保留给 hoverPool/hoverEvent 的老调用。
		out.push({ name: e.title, title: e.title, startTs: w.startTs, endTs: w.endTs, raw: w.raw });
	}
	return out;
}

// ── 传输：POST 自己封装（lib/env.js 的 fetchText/fetchJson 只支持 GET；压平后见 22-fetcher-core.js）────────
const ns_umamusume_official_PROXY_PREFIX = "/api/gacha-calendar-proxy";

/** 代理 URL 形态（与 92-dsh-env.js 的 DSH 代理同前缀）。
 *  ⚠️ 2026-10-21 起生产路径**不再自己拼这个 URL**（改由 transport.fetchViaProxy 负责，见 postJsonUma）；
 *  保留它是为了让离线用例还能断言"代理调用确实打到 /api/gacha-calendar-proxy"这一契约形态。 */
function ns_umamusume_official_proxyUrlFor(url, referer = "", headers = null, contentType = null) {
	let api = ns_umamusume_official_PROXY_PREFIX + "?url=" + encodeURIComponent(url) + "&referer=" + encodeURIComponent(referer);
	if (headers) api += "&headers=" + encodeURIComponent(JSON.stringify(headers));
	if (contentType) api += "&contentType=" + encodeURIComponent(contentType);
	return api;
}

/**
 * POST JSON 的抓取封装。
 *   mode="proxy"（默认）：经**注入的 transport.fetchViaProxy**（= 宿主代理，读请求体透传为 POST）
 *   mode="direct"       ：经**注入的 transport.fetchRaw**（原生 HTTP，由宿主提供）
 * 结构问题（坏 JSON / 非 200 / 代理拒绝）→ throw。
 *
 * ⚠️ 2026-10-21（P3）：不再用 `globalThis.fetch` + **相对 URL** `/api/gacha-calendar-proxy…`。
 *    相对 URL 只有浏览器同源能解析 —— Node / 原生宿主里 `fetch("/api/…")` 直接抛
 *    `Failed to parse URL`（实测：纯 Node 下 uma-global 活动侧必失败），违反 core「零宿主依赖」契约。
 *    改走 15-env.js 的 proxyFetchText（薄封装 → coreEnv.transport.fetchViaProxy）；
 *    URL / body / headers / referer 与改动前逐项一致（headers 仍作 extraHeaders 透传，
 *    POST 的 Content-Type 由 transport 按 application/json 发出）。
 */
async function ns_umamusume_official_postJsonUma(url, body, { referer = "", headers = null, signal, mode = "proxy", label = "uma" } = {}) {
	const payload = JSON.stringify(body == null ? {} : body);
	if (mode === "direct") {
		const res = await transportFetchRaw(url, {
			method: "POST",
			signal,
			headers: { "content-type": "application/json; charset=utf-8", accept: "application/json, text/plain, */*", ...(headers || {}), ...(referer ? { referer } : {}) },
			body: payload
		});
		if (!res.ok) throw new Error(label + "-http-" + res.status);
		const text = await res.text();
		try { return JSON.parse(text); } catch { throw new Error(label + "-bad-json"); }
	}
	let text;
	try {
		text = await proxyFetchText(url, referer, headers, payload);
	} catch (e) {
		// 代理**信封**本身不是 JSON（WAF 挑战页 / 纯文本错误页）：旧实现抛 -proxy-bad-json，
		// 这里保持同一语义（否则会漏出原生 SyntaxError，被 normErr 归成泛化的"抓取异常"）。
		if (e && e.name === "SyntaxError") throw new Error(label + "-proxy-bad-json");
		throw e;   // proxy-http-<status> / proxy-bad:<目标状态码|error> 由 transport 抛出，原样上抛
	}
	try { return JSON.parse(text); } catch { throw new Error(label + "-bad-json"); }
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
async function ns_umamusume_official_gachaUmaJpOfficial(url, signal, tz = ns_umamusume_official_UMA_JP_TZ, now = nowMs(), opts = {}) {
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
	// ── P3b：条目事实 → 悬停 + `gacha` 数组（排序与 hoverPool 同一份：结束时间升序）──
	const pools = ns_umamusume_official_umaCurrentItems(r.details, now).slice().sort(poolHoverOrderOf);
	const bannerHover = hoverTextFromItems(pools, "gacha", tz);
	const out = {
		banner: picked.e.title,
		bannerDates: fmtWindow(picked.w.startTs, picked.w.endTs, tz),
		bannerDatesRaw: picked.w.raw,
		startTs: picked.w.startTs,
		endTs: picked.w.endTs,
		...(bannerHover ? { bannerHover } : {})
	};
	out.gacha = dataArrayProducedGachaOf(out, pools, { tz }, now);
	out.gachaHoverItems = pools;
	return out;
}

/** 赛马娘 日服 官方公告 活动侧（イベント / キャンペーン）。now 是第 4 参。 */
async function ns_umamusume_official_eventsUmaJpOfficial(url, signal, tz = ns_umamusume_official_UMA_JP_TZ, now = nowMs(), opts = {}) {
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
	// ── P3b：条目事实 → 悬停 + `events` 数组（**不排序**：原 hoverEvent 收到的就是 umaCurrentItems 原序）──
	const eventItems = ns_umamusume_official_umaCurrentItems(r.details, now);
	const eventHover = hoverTextFromItems(eventItems, "event", tz);
	const out = {
		event: picked.e.title,
		eventDates: fmtWindow(picked.w.startTs, picked.w.endTs, tz),
		eventDatesRaw: picked.w.raw,
		...(eventHover ? { eventHover } : {})
	};
	out.events = dataArrayProducedEventsOf(out, eventItems, { tz }, now);
	out.eventHoverItems = eventItems;
	return out;
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
async function ns_umamusume_official_gachaUmaGlobal(url, signal, tz = ns_umamusume_official_UMA_GLOBAL_TZ, now = nowMs(), opts = {}) {
	const r = await ns_umamusume_official_collectGlobal("gacha", url, tz, now, signal, opts);
	const picked = ns_umamusume_official_pickUmaWindow(r.details, now);
	if (!picked) return null;
	// 同卡池侧：≥2 个当期池才给悬停，否则交回 UI 默认两行式
	// ── P3b：条目事实 → 悬停 + `gacha` 数组 ──────────────────────────────────
	const pools = ns_umamusume_official_umaCurrentItems(r.details, now).slice().sort(poolHoverOrderOf);
	const bannerHover = hoverTextFromItems(pools, "gacha", tz);
	const out = {
		banner: picked.e.title,
		bannerDates: fmtWindow(picked.w.startTs, picked.w.endTs, tz),
		bannerDatesRaw: picked.w.raw,
		startTs: picked.w.startTs,
		endTs: picked.w.endTs,
		...(bannerHover ? { bannerHover } : {})
	};
	out.gacha = dataArrayProducedGachaOf(out, pools, { tz }, now);
	out.gachaHoverItems = pools;
	return out;
}

/** 赛马娘 国际服（Global）官方公告 活动侧。now 是第 4 参。 */
async function ns_umamusume_official_eventsUmaGlobal(url, signal, tz = ns_umamusume_official_UMA_GLOBAL_TZ, now = nowMs(), opts = {}) {
	const r = await ns_umamusume_official_collectGlobal("event", url, tz, now, signal, opts);
	const picked = ns_umamusume_official_pickUmaWindow(r.details, now);
	if (!picked) return null;
	// 同活动侧：≥2 条当期活动才给悬停，否则交回 UI 默认两行式
	// ── P3b：条目事实 → 悬停 + `events` 数组（不排序，与 hoverEvent 的输入同序）──
	const eventItems = ns_umamusume_official_umaCurrentItems(r.details, now);
	const eventHover = hoverTextFromItems(eventItems, "event", tz);
	const out = {
		event: picked.e.title,
		eventDates: fmtWindow(picked.w.startTs, picked.w.endTs, tz),
		eventDatesRaw: picked.w.raw,
		...(eventHover ? { eventHover } : {})
	};
	out.events = dataArrayProducedEventsOf(out, eventItems, { tz }, now);
	out.eventHoverItems = eventItems;
	return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── 原 42-parsers-umapyoi.js（压平后见 30-game-cygames.js）
// ─────────────────────────────────────────────────────────────────────────────
// 原 src/client/35-parsers-umapyoi.js（压平后见 30-game-cygames.js）
//
// 由 next-sources/parsers/umapyoi.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_umapyoi__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// 原 src/client/35-parsers-umapyoi.js（压平后见 30-game-cygames.js） —— 赛马娘 日服（第三方 API：api.umapyoi.net）
//
// 契约：async (url, signal, tz) → { banner, roles?, bannerDates, bannerDatesRaw?, startTs?, endTs?, bannerHover? } | null
//
// ⚠️ 实测（2026-10-02 夹具 `b1-umapyoi-gacha`，704 条）与任务给的简化形态的差别：
//   GET https://api.umapyoi.net/api/v1/gacha → JSON **数组**，每条 =
//     { card_type: "Outfit" | "Support Card", id, start_date, end_date, type }
//   · `start_date` / `end_date` 是 **Unix 秒**（不是毫秒）。
//   · `end_date === 2147483647`（INT32_MAX）是**常驻哨兵**：源站用它表示"没有结束时间"（夹具里 38 条）。
//   · **源站只给"卡"（id + 卡类型）的获取窗口，没有卡池名** —— 所以 banner 只能合成：
//     本解析器把"同一 (start_date, end_date) 的一批新卡"当作一个卡池窗口，
//     banner 写成「赛马娘日服卡池（卡类型…）」。
//     ⚠️ 只按 `start_date` 分组是**错的**：实测 29 个 start_date 同时挂多组不同 end_date，
//        而且常驻卡（哨兵）与有界卡会共用同一个 start_date —— 按 start 分组会把"常驻"
//        混进窗口，从而把整组误判成已过期（2026-03-11 那批就是这样）。
//
// 时区：`Asia/Tokyo`。依据（两条）：
//   ① bwiki 正文硬标注「日服卡池时间记录统一为日本时间」；
//   ② 夹具自洽：666 个**有界** end_date 全部落在 02:59:59Z（= 11:59:59 JST，一个不差），
//      且 664/704 个 start_date 落在 03:00Z（= 12:00 JST，日服卡池 12:00 更新）——
//      只有 UTC+9 才能把这些渲染成"整点 12:00 / 11:59:59"。
//
// 选池规则（本项目 JSON 源的通用约定，见 registry-b1.js 注释）：
//   覆盖当前时刻的**有界窗口**里取 startTs 最新的那批（并列取结束更早、id 更小）。
//   常驻卡（哨兵）不构成"当期窗口"；当期没有任何有界窗口 → 返回 null（未公布）。


const ns_umapyoi_DEFAULT_URL = "https://api.umapyoi.net/api/v1/gacha";
// 供注册表引用（作为「备选源」时必须与 `altSourceId(alt) = alt.url` 的字符串**完全一致**才能命中）
const ns_umapyoi_PERMANENT_END = 2147483647;   // 源站常驻哨兵（Unix 秒 = INT32_MAX）

const ns_umapyoi_toNum = (v) => {
	if (v == null || v === "") return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};
// ⚠️ 2026-10-03 收敛：本文件原有 `byNewestStart`，与 bestdori/sekai 那两份**是同一概念的第 3 种写法** ——
//    而且它 `(a.endTs - b.endTs)` **没有 null 守卫**，任一 endTs 为 null 就整条得 NaN、排序未定义。
//    已统一到 `27-parser-text.js` 的 `byNewestStart`（带 Infinity 兜底），潜在 bug 一并修掉。

// 纯函数：夹具/单测可直接喂 JSON（不联网）
function ns_umapyoi_parseUmapyoiGacha(json, now = nowMs(), tz = "Asia/Tokyo") {
	if (!Array.isArray(json)) throw new Error("umapyoi-bad-shape");
	const rows = [];
	for (const it of json) {
		if (!it || typeof it !== "object") continue;
		const s = ns_umapyoi_toNum(it.start_date);
		if (s == null) continue;
		const e = ns_umapyoi_toNum(it.end_date);
		// 常驻哨兵（或缺失结束）→ endTs 记为 null：**绝不**把 2147483647 当成真实时刻
		const permanent = e == null || e >= ns_umapyoi_PERMANENT_END;
		rows.push({
			id: it.id,
			id0: ns_umapyoi_toNum(it.id) == null ? Number.MAX_SAFE_INTEGER : ns_umapyoi_toNum(it.id),
			cardType: String(it.card_type == null ? "" : it.card_type),
			type: it.type,
			startTs: s * 1000,
			endTs: permanent ? null : e * 1000,
			permanent
		});
	}
	if (rows.length === 0) throw new Error("umapyoi-no-rows");

	// 有界窗口 = 同一 (start_date, end_date) 的一批卡（见文件头：不能只按 start_date 分组）
	const merged = new Map();
	for (const r of rows) {
		if (r.permanent) continue;
		const k = r.startTs + "|" + r.endTs;
		let p = merged.get(k);
		if (!p) { p = { startTs: r.startTs, endTs: r.endTs, id0: r.id0, items: [] }; merged.set(k, p); }
		p.items.push(r);
		if (r.id0 < p.id0) p.id0 = r.id0;
	}
	const pools = [...merged.values()].map((p) => ({
		startTs: p.startTs,
		endTs: p.endTs,
		// `id` 供共用 `byNewestStart` 做末级 tie-break（原来叫 `id0`、只有本地比较器认它）。
		// 池已按 `startTs|endTs` 去重，所以这一级实际不会决出胜负 —— 只是让对象形状与别处一致。
		id: p.id0,
		items: p.items,
		ids: p.items.map((x) => x.id).filter((x) => x != null),
		cardTypes: [...new Set(p.items.map((x) => x.cardType).filter(Boolean))]
	}));

	const active = pools.filter((p) => coversNow(p, now)).sort(byNewestStart);
	const cur = active[0] || null;
	if (!cur) return null;   // 抓到数据但当期没有有界窗口（常驻卡不算） = 未公布

	const types = cur.cardTypes.join("、");
	const banner = types ? `赛马娘日服卡池（${types}）` : "赛马娘日服卡池";
	const dates = fmtWindow(cur.startTs, cur.endTs, tz);
	// ⚠️ 2026-10-03 改：这里原本**手搓悬停**，且三处违反方案 A 的悬停规则 ——
	//    ① 档期在前（`档期  卡级明细`），本体一律「池名 ⏎ 档期」（卡池侧）
	//    ② 塞元信息：内部 id（`（id 30474、50248）`）、源站字段名（`end_date=2147483647 哨兵`）、
	//       来源与实现说明（`赛马娘日服（源站为卡级数据，无卡池名；起止＝该批新卡的获取窗口）`）、
	//       `另有 N 个同期窗口未列出`
	//    ③ 自带 20 行截断（`HOVER_MAX`）
	//    它会漏网是因为它只是 `uma-jp.altSources` 里的**备选源**，不在主源悬停审计的覆盖范围内。
	//    现在改用共用 hoverPool：池名与档期分开两行，无元信息，无截断。
	//    （源站没有卡池名 → 池名用「赛马娘日服卡池（卡级构成）」，与 banner 同构。）
	// ⚠️ P3e（2026-11-07）：手动切到「umapyoi（无卡池名）」时该侧也要有数组。三段式：
	//    条目事实 → `hoverTextFromItems` → `dataArrayProducedGachaOf`；排序用 `poolHoverOrderOf`
	//    （= `hoverPool` 内部的 `hoverSortByEnd`），所以悬停与改造前逐字相同、数组与改造前合成结果逐条相等。
	const items = active
		.map((p) => ({
			title: p.cardTypes.length ? `赛马娘日服卡池（${p.cardTypes.join("、")}）` : "赛马娘日服卡池",
			startTs: p.startTs,
			endTs: p.endTs
		}))
		.sort(poolHoverOrderOf);
	const hover = hoverTextFromItems(items, "gacha", tz);

	const out = {
		banner,
		roles: "",
		bannerDates: dates,
		bannerDatesRaw: dates,
		startTs: cur.startTs,
		endTs: cur.endTs,
		...(hover ? { bannerHover: hover } : {})
	};
	out.gacha = dataArrayProducedGachaOf(out, items, { tz }, now);
	out.gachaHoverItems = items;
	return out;
}

// 抓取器：mode="direct"（实测 api.umapyoi.net 响应 ACAO=*）
async function ns_umapyoi_gachaUmapyoi(url, signal, tz = "Asia/Tokyo", now = nowMs()) {
	const data = await fetchJson(url || ns_umapyoi_DEFAULT_URL, { signal, mode: "direct" });
	return ns_umapyoi_parseUmapyoiGacha(data, now, tz);
}

		// ── 条目 ──
		registerSource({
				id: "uma-jp",
				defaultHidden: false,
				tz: "Asia/Tokyo",
				name: "赛马娘·日服",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/73/7c/0b/737c0b9b-6e90-8838-f0d3-fc7c576fbbad/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
				url: "https://umamusume.jp/api/ajax/pr_info_index?format=json&page=1",
				// 日文站点 → 加语言括号（本体惯例，见 ba-jp 的 `官方公告（日文）`）
				source: "官方公告（日文）",
				eventUrl: "https://umamusume.jp/api/ajax/pr_info_index?format=json&page=1",
				eventSource: "官方公告（日文）",
				altSources: [{"label":"umapyoi（无卡池名）","url":"https://api.umapyoi.net/api/v1/gacha","fetcher":"uma-jp-umapyoi"}],
				eventAltSources: [{"label":"Bwiki 活动往期归档","url":"https://wiki.biligame.com/umamusume/api.php?action=parse&page=活动&prop=text&format=json&formatversion=2","fetcher":"uma-jp-bwiki"}],
		});

		registerSource({
				id: "uma-global",
				defaultHidden: false,
				tz: "UTC",
				name: "赛马娘·国际服",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/8f/35/f4/8f35f477-05cb-0058-944a-0b796ee42583/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
				// 2026-10-21 换默认源：**GameTora**（社区数据库，en/ 就是国际服数据）。
				// 历史：2026-10-05 曾因官网 umamusume.com 整站按出口 IP/地域封锁（首页与 API 都 403，
				// 换 UA/Referer/X-Requested-With/Accept-Language 全部 403，而同机 umamusume.jp 是 200）
				// 把默认换成 GachaTracker；但 GachaTracker **数据陈旧**（2026-10-21 实测：页面能解析、
				// 却没有任何覆盖 now 的档期 → 自检长期「未公布」）→ 现降为备选。
				url: "https://gametora.com/data/manifests/umamusume.json",
				// 标签不带语言括号（用户 2026-11-14 拍板：同一来源就不留「（英文）」后缀）
				source: "GameTora",
				// 2026-11-14：**活动侧也换成 GameTora**（与卡池同一个 manifest 端点，见文件内 GameTora 段落）。
				//   起因（用户拍板，事实已实测）：官网 `umamusume.com` 已**整站 403** —— 连 robots.txt /
				//   sitemap.xml / wp-json 都回 199B 的 Apache 错误页 ⇒ 站点级 IP 封禁，官方接口不能再当默认。
				//   GameTora 的 `events/story-events` 有国际服档期（`start_en` / `end_en`）+ 繁中译名。
				//
				// 官方接口保留为**备选**（`eventAltSources`，标签一个字都不改）。它此前的 POST 契约仍然有效：
				//   `pr_info_index` / `pr_info_detail`（umamusume.com `api/ajax/*`）**只认 POST**，且必须带
				//   `Content-Type: application/json`（body 形如 `{announce_label:1, limit:50, offset:0}`；
				//   detail 用 `{announce_id}`）。走 `ns_umamusume_official_postJsonUma`（POST，body 交
				//   transport 透传），别改成 GET：
				//     · **GET 恒返回 HTTP 200 + 21 字节 `{"response_code":200}`**（没有 information_list、
				//       没有任何内容条目）。这**不是**"当期没有内容"的契约，只是拿不到东西时的空壳。
				//     · ⇒ `parseUmaIndex` **不把空壳当 nomatch**：`response_code !== 1` 一律抛
				//       （`uma-bad-response`），该侧如实报"抓取失败"。
				//     · **若 transport 把 POST 降级成 GET（或吞掉 body / Content-Type），症状就是这枚空壳**
				//       —— 排查顺序：先看请求方法与 Content-Type，再看源站。别再把它归成 nomatch。
				eventUrl: "https://gametora.com/data/manifests/umamusume.json",
				eventSource: "GameTora",
				altSources: [
					{
						// 降级：境外可达但联通线路不稳，且数据停在旧期（详细原因见文件内 GameTora 段落）
						label: "GachaTracker（英文 · 不可靠）",
						url: "https://gachatracker.app/games/umamusume/banners/",
						fetcher: "uma-global-gt"
					},
					{
						// 最后兜底：官方公告最准，但曾按出口 IP 封锁（2026-10-05），可能整站 403
						label: "官方公告（英文 · 不可靠）",
						url: "https://umamusume.com/api/ajax/pr_info_index?format=json",
						fetcher: "uma-global-official"
					}
				],
				// 活动侧备选 = 原来的官方接口（标签**逐字**沿用，未改）。2026-11-14 起整站 403，仅备用。
				eventAltSources: [
					{
						label: "官方公告（英文 · 不可靠）",
						url: "https://umamusume.com/api/ajax/pr_info_index?format=json",
						fetcher: "uma-global-official"
					}
				],
		});

		// ══ 赛马娘国际服（Global）：GachaTracker（英文第三方站，2026-10-05 起为卡池默认源）══
		// 起因：官网 umamusume.com 整站对本机出口 403（见条目注释），国际服卡池与活动两侧都「抓取失败」。
		// GachaTracker 卡池页实测 200、数据当期，行结构与终末地那页同款
		// （`<tr id>` + `banner-name-cell` + 两个 `date-cell`）→ 照 parseGachaTracker 写一份赛马娘版。
		function ns_cygames_parseGtUmaGacha(html, tz) {
			const parse = (s) => { const m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null; };
			const shift = (d) => (typeof sourceInstant === "function" ? sourceInstant(d.y, d.mo, d.d, 0, 0, tz) : new Date(d.y, d.mo - 1, d.d, 0, 0).getTime());
			const shiftEnd = (d) => (typeof sourceInstant === "function" ? sourceInstant(d.y, d.mo, d.d, 23, 59, tz) : new Date(d.y, d.mo - 1, d.d, 23, 59).getTime());
			const items = [];
			for (const rm of html.matchAll(/<tr id="([^"]+)">([\s\S]*?)<\/tr>/g)) {
				const body = rm[2];
				if (!body.includes("date-cell")) continue;
				const nameM = body.match(/banner-name-cell">[\s\S]*?<a[^>]*>([^<]+)<\/a>/);
				const dateM = [...body.matchAll(/date-cell">([\d-]+)<\/td>/g)];
				if (!nameM || dateM.length < 2) continue;
				const sd = parse(dateM[0][1]);
				const ed = parse(dateM[1][1]);
				if (!sd || !ed) continue;
				items.push({
					banner: stripTags(nameM[1]),
					roles: [...new Set([...body.matchAll(/\/games\/umamusume\/characters\/[^"]+" title="([^"]+)"/g)].map((m) => m[1]))].join("、"),
					startTs: shift(sd),
					endTs: shiftEnd(ed),
					startText: dateM[0][1],
					endText: dateM[1][1]
				});
			}
			// 一行都没解析出来 → 页面结构变了：抛错让该侧记 down，绝不伪装成"未公布"
			if (items.length === 0) throw new Error("uma-gt-no-rows");
			const now = nowMs();
			// 角色池与支援卡池常并行 → 取结束最晚的一条作外显（"越晚结束越靠前"，与其它游戏一致）
			const cur = items.filter((it) => coversNow(it, now)).sort((a, b) => b.endTs - a.endTs)[0];
			if (!cur) return null;
			const fmtDate = (s) => { const m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); return m ? `${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : String(s); };
			const out = {
				banner: cur.banner,
				roles: cur.roles,
				bannerDates: `${fmtDate(cur.startText)} 00:00 ~ ${fmtDate(cur.endText)} 23:59`
			};
			// ── P3e（2026-11-07）：手动切到「GachaTracker（英文 · 不可靠）」时该侧也要有数组 ──
			// 本源**没有悬停**（改造前就没写 `bannerHover`：只取一口当期池，UI 走默认两行式）⇒
			// 并列条目为 0（`entries` 传空数组）。与「终末地 GachaTracker」「鸣潮 Bwiki」两处同一口径：
			// 只补「能显示」这一件，不把池列表塞进数组（那会让数组比改造前多出条目 = 行为变更）。
			out.gacha = dataArrayProducedGachaOf(out, [], { tz }, now);
			return out;
		}

		async function ns_cygames_gachaGtUma(url, signal, tz) {
			const html = await proxyFetchText(url, "https://gachatracker.app/");
			return ns_cygames_parseGtUmaGacha(html, tz);
		}

		// ══ 赛马娘国际服（Global）：**GameTora**（社区数据库，2026-10-21 起为卡池默认源）══
		//
		// 为什么换（用户指令：GameTora 接并设为默认，原来源降级）：
		//   · 原默认 GachaTracker **数据陈旧**：2026-10-21 实测页面能解析，但没有一条覆盖 now 的档期
		//     → 自检长期显示「未公布」（不是抓取失败，所以一直没人发现）；
		//   · 官网 umamusume.com 曾按出口 IP 封锁（2026-10-05），只能当最后兜底。
		//
		// 为什么 GameTora 可用（2026-10-21 实测）：
		//   · `en/` 数据集**就是国际服**：68 期，首期 start=2025-06-26 = 国际服开服日（无前缀的是日服，别用）；
		//   · 当期 char 池 id=30136 `start=1792015200 end=1792792799` = UTC `2026-10-14 22:00 ~ 2026-10-23 21:59`，
		//     与国际服官方公告逐秒吻合 → 时区沿用该源既有的 `UMA_GLOBAL_TZ="UTC"`，**不要**按 Asia/Tokyo 渲染；
		//   · 该站**不含未来池**（末期 = 当期）→ 没有覆盖 now 的就返回 null（符合现有「未公布」语义）；
		//   · 全部文件 `Access-Control-Allow-Origin: *` → 抓取走 `mode:"direct"`，**不需要**动 PROXY_ALLOW_HOSTS。
		//
		// 数据形态：
		//   GET https://gametora.com/data/manifests/umamusume.json    11KB，**无 hash、稳定**
		//     → { "en/gacha/char-standard": "<hash>", "en/gacha/support-standard": "<hash>",
		//         "character-cards": "<hash>", "support-cards": "<hash>", … }
		//   GET https://gametora.com/data/umamusume/<key>.<hash>.json
		//     en/gacha/char-standard     42KB  [{id, start, end, pickups:[[cardId, rarity, isNew]], lineup}]
		//     en/gacha/support-standard  77KB  同上（pickups 里是**支援卡** id）
		//     character-cards           262KB  [{card_id, char_id, name_en, title_en_gl, …}]（name_en = 角色名）
		//     support-cards             584KB  [{support_id, char_id, char_name, title_en, …}]
		//   ⚠️ `start` / `end` 是 **unix 秒**（不是毫秒）。
		//
		// 请求量与正确性的权衡（用户要求"优先少请求"，所以这里刻意做了取舍）：
		//   · 基础 **3 个文件**（manifest + 两个池表 = 130KB）：只有档期，**没有名字**；
		//   · 池表里**没有池名**，pickups 只有 id ⇒ 不拉名字表就只剩一个空壳标题（面板外显就是 roles），
		//     所以名字是"要显示得有意义就必须有"的字段，不是锦上添花；
		//   · 因此只拉**当期那一个池**用到的名字表（角色池 → character-cards 262KB；支援卡池 → support-cards 584KB），
		//     不把两张都拉（否则 +846KB）。`characters`（118KB）用不上——
		//     character-cards 自带 name_en，实测 271/271 与 characters.name_en 完全一致。
		//   · 当期实际成本（2026-10-21 实测，本机真实网络）：**4 次请求 / 400,713 B（≈391KB）/ 2030ms**
		//     （角色池当期）；支援卡池当期时 4 次 / 731,270 B（≈714KB）。不拉名字表只要 3 次 / 133KB，
		//     但那会只剩「赛马娘国际服卡池」一个空壳 —— 面板外显就是 roles，值不回票价。
		const GT_UMA_MANIFEST = "https://gametora.com/data/manifests/umamusume.json";
		const GT_UMA_DATA = "https://gametora.com/data/umamusume/";
		const GT_UMA_POOL_CHAR = "en/gacha/char-standard";
		const GT_UMA_POOL_SUPPORT = "en/gacha/support-standard";
		const GT_UMA_CARDS_CHAR = "character-cards";
		const GT_UMA_CARDS_SUPPORT = "support-cards";

		function gtUmaFail(where) { return new Error(`GameTora 数据接口失败（${where}）`); }

		// manifest 里的 hash → 取一个数据文件。hash 缺失/形状不对 → 抛（结构变化按失败处理，不猜 URL）
		async function gtUmaFile(manifest, key, signal) {
			const hash = manifest && manifest[key];
			if (typeof hash !== "string" || !/^[0-9a-z]{6,32}$/i.test(hash)) throw gtUmaFail(`manifest 缺 "${key}"`);
			try {
				return await fetchJson(GT_UMA_DATA + key + "." + hash + ".json", { signal, mode: "direct" });
			} catch (e) {
				if (e && e.name === "AbortError") throw e;
				throw gtUmaFail(`${key}：${(e && e.message) || e}`);
			}
		}

		// 池表 → 只留有明确起止的项（unix 秒 → 毫秒）。不是数组 → 抛（结构变化）。
		function gtUmaPools(list) {
			if (!Array.isArray(list)) throw gtUmaFail("池表不是数组（结构可能变了）");
			const out = [];
			for (const p of list) {
				const s = Number(p && p.start), e = Number(p && p.end);
				if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
				out.push({ id: p.id, startTs: s * 1000, endTs: e * 1000, pickups: Array.isArray(p.pickups) ? p.pickups : [] });
			}
			return out;
		}

		// 当期 = 覆盖 now 的池里**结束最晚**的那条（多池并行时"越晚结束越靠前"，与全站惯例一致）
		function gtUmaCurrent(pools, now) {
			const cur = pools.filter((p) => coversNowBounded(p, now));
			if (!cur.length) return null;
			return cur.sort((a, b) => (b.endTs - a.endTs) || (b.startTs - a.startTs))[0];
		}

		// pickups → 角色名：char 池走 `card_id → name_en`，支援卡池走 `support_id → char_name`。
		// 名字去重（同一角色的不同卡不再重复列）；**一个都解析不出来 → 抛**（表结构变了，不产出空 roles）。
		function gtUmaRoleNames(pickups, table, idKey, nameKey) {
			const byId = new Map();
			for (const c of table || []) {
				if (c && c[idKey] != null && typeof c[nameKey] === "string" && c[nameKey]) byId.set(Number(c[idKey]), c[nameKey]);
			}
			const out = [];
			for (const p of pickups || []) {
				const id = Number(Array.isArray(p) ? p[0] : (p && (p.cardId != null ? p.cardId : p.id)));
				const nm = byId.get(id);
				if (nm && !out.includes(nm)) out.push(nm);
			}
			return out.join("、");
		}

		async function ns_cygames_gachaGameToraUma(url, signal, tz = ns_umamusume_official_UMA_GLOBAL_TZ, now = nowMs()) {
			const manifest = await gtUmaManifestOf(url || GT_UMA_MANIFEST, signal);
			// 两个池表**都要**：角色池与支援卡池常并行，得先知道"当期是哪一个"
			const [charList, supList] = await Promise.all([
				gtUmaFile(manifest, GT_UMA_POOL_CHAR, signal),
				gtUmaFile(manifest, GT_UMA_POOL_SUPPORT, signal)
			]);
			const curChar = gtUmaCurrent(gtUmaPools(charList), now);
			const curSup = gtUmaCurrent(gtUmaPools(supList), now);
			const cur = curChar || curSup;          // 角色池优先（主线池是角色池；支援卡池并行时不混进同一行）
			if (!cur) return null;                  // 没有覆盖 now 的池 = 未公布（该站无未来池）
			// 名字：**只**拉当期那个池用到的那一张表（见上面"请求量与正确性的权衡"）
			const isChar = cur === curChar;
			const table = await gtUmaFile(manifest, isChar ? GT_UMA_CARDS_CHAR : GT_UMA_CARDS_SUPPORT, signal);
			const roles = isChar
				? gtUmaRoleNames(cur.pickups, table, "card_id", "name_en")
				: gtUmaRoleNames(cur.pickups, table, "support_id", "char_name");
			if (!roles) throw gtUmaFail(isChar ? "当期角色池的角色名解析出 0 条" : "当期支援卡池的角色名解析出 0 条");
			const dates = fmtWindow(cur.startTs, cur.endTs, tz);
			const out = {
				// 该站没有池名 → 用"赛马娘国际服卡池（角色/支援卡）"，与 umapyoi 那支「赛马娘日服卡池（类型）」同构。
				// 面板外显是 roles，banner 只在悬停/标题里作前缀。
				banner: isChar ? "赛马娘国际服卡池（角色）" : "赛马娘国际服卡池（支援卡）",
				roles,
				bannerDates: dates,
				bannerDatesRaw: dates
			};
			// ── P3b：条目事实 → `gacha` 数组（该源一次只有一口当期池 ⇒ 悬停生成器给 ""，与改造前一致）──
			const pools = [{ title: out.banner, startTs: cur.startTs, endTs: cur.endTs, raw: dates }];
			out.gacha = dataArrayProducedGachaOf(out, pools, { tz }, now);
			out.gachaHoverItems = pools;
			return out;
		}

		// ══ 赛马娘国际服（Global）：GameTora **活动侧**（2026-11-14 起为活动默认源）══
		//
		// 为什么接（用户拍板，事实已实测 2026-11-14）：
		//   · 官网 `umamusume.com` 已**整站 403**（连 robots.txt / sitemap.xml / wp-json 都是 199B 的
		//     Apache 错误页）⇒ 站点级 IP 封禁，官方接口只能当备选（见注册项 `eventAltSources`）；
		//   · `events/story-events` 是**国际服活动档期**：57 条，`start_en` / `end_en` 是 unix 秒；
		//     实测在期 = id 1022（`start_en` 22:00 起 / `end_en` 21:59 止，按 UTC 渲染与官方公告一致）；
		//   · 与卡池侧**同一个 manifest 端点** ⇒ 不用改代理白名单（`mode:"direct"`，该站全文件 ACAO=*）。
		//
		// 数据形态：
		//   GET https://gametora.com/data/manifests/umamusume.json
		//     → { "events/story-events": "9c7f5afc", … }   ← hash 随数据更新而变，**不写死**
		//   GET https://gametora.com/data/umamusume/events/story-events.<hash>.json   （116KB，`cache-control: must-revalidate` + `etag`）
		//     数组；字段逐字：id / name_en / name_en_old / name_ja / name_ko / name_zh_tw /
		//     start_en / start_ja / start_ko / start_zh_tw / end_en / end_ja / end_ko / end_zh_tw /
		//     banners / bonus_chars / bonus_supports / event_support_ids / url_name
		//   ⚠️ 时间字段是 **epoch 秒**（不是毫秒）；`en` 那套 = **国际服（Global）**档期。
		//   ⚠️ 57 条里只有 **22 条**有 `start_en` / `end_en`：1023~1057 是还没上国际服的未来活动
		//      （只有 `*_ja`，部分有 `*_zh_tw`）⇒ 条目筛选只认 `start_en && end_en`。
		//   ⚠️ `name_zh_tw` 是同一活动的**繁中译名**（47/57 条有，用户指定**只用它**：缺就跳过该条，
		//      不拿 `name_en` 兜底）。`start_zh_tw` / `end_zh_tw` 是**日服**档期，**不要**拿它当国际服档期。
		const GT_UMA_EVENTS = "events/story-events";

		// manifest **轮内**复用（卡池侧与活动侧都要同一个 11KB 的 manifest）：
		// 只在**一轮刷新**里生效（`refreshAll` 期间为真），且**按轮次号**判定 ⇒ 跨轮一定不复用（hash 变了立刻跟上）；
		// 同一轮只发一次请求（缓存的是 **Promise**，即便两侧并发也只发一次；失败不留缓存），30s 是轮内的兜底上限。
		// 轮外（设置页「测试来源」/ 离线用例直调抓取器）一律现取：调用方可能正是在验"源站此刻返回什么"。
		const GT_UMA_MANIFEST_TTL_MS = 30000;
		let gtUmaManifestCache = null;   // { url, round, at, promise }
		async function gtUmaManifestOf(url, signal) {
			const key = url || GT_UMA_MANIFEST;
			const at = nowMs();
			const round = fetchRoundSeqOf();
			const hit = gtUmaManifestCache;
			let promise;
			if (fetchRoundActive() && hit && hit.url === key && hit.round === round && at - hit.at < GT_UMA_MANIFEST_TTL_MS) {
				promise = hit.promise;
			} else {
				promise = fetchJson(key, { signal, mode: "direct" });
				gtUmaManifestCache = { url: key, round, at, promise };
				promise.catch(() => { if (gtUmaManifestCache && gtUmaManifestCache.promise === promise) gtUmaManifestCache = null; });
			}
			const manifest = await promise;
			if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw gtUmaFail("manifest 不是对象（结构可能变了）");
			return manifest;
		}

		// 活动名：**只取 `name_zh_tw`**（繁中译名，用户 2026-11-14 指定）。
		// 不拿英文名兜底（用户 2026-11-14 拍板：回退到 en 纯浪费）⇒ 没有繁中译名就是空串，调用方直接跳过该条。
		function gtUmaEventTitleOf(e) {
			return typeof e.name_zh_tw === "string" ? e.name_zh_tw.trim() : "";
		}

		// 活动表 → 条目事实：**三个字段都齐**才进候选 —— `start_en && end_en && name_zh_tw`
		// （未来活动还没上国际服 ⇒ 没有 en 档期；缺繁中译名的条目**直接跳过**：不进外显、不进 `events`
		//  数组、不进 `eventHoverItems`）。
		// 秒 → 毫秒在这里换算；不是数组 ⇒ 抛错（结构变化按"抓取失败"处理，不是 nomatch）。
		function gtUmaEventItems(list) {
			if (!Array.isArray(list)) throw gtUmaFail("活动表不是数组（结构可能变了）");
			const out = [];
			for (const e of list) {
				if (!e || !e.start_en || !e.end_en) continue;
				const title = gtUmaEventTitleOf(e);
				if (!title) continue;
				const s = Number(e.start_en), en = Number(e.end_en);
				if (!Number.isFinite(s) || !Number.isFinite(en) || s <= 0 || en <= 0) continue;
				out.push({ id: e.id, title, startTs: s * 1000, endTs: en * 1000 });
			}
			return out;
		}

		async function ns_cygames_eventsGameToraUma(url, signal, tz = ns_umamusume_official_UMA_GLOBAL_TZ, now = nowMs()) {
			const manifest = await gtUmaManifestOf(url || GT_UMA_MANIFEST, signal);
			const items = gtUmaEventItems(await gtUmaFile(manifest, GT_UMA_EVENTS, signal));
			// 在期 = 覆盖 now 的条（两端都必须明确）；一条都不覆盖 ⇒ `null`（未公布，**不是**失败）
			const live = items.filter((x) => coversNow(x, now));
			if (live.length === 0) return null;
			// 外显 = 在期里**结束最晚**的那条（"越晚结束越靠前"，与其它游戏同一口径）
			const cur = live.slice().sort((a, b) => (b.endTs - a.endTs) || (b.startTs - a.startTs))[0];
			// 名称已在筛选里保证非空（缺 `name_zh_tw` 的条目进不来）⇒ 这只是结构断言
			if (!cur.title) throw gtUmaFail("当期活动没有名称（结构可能变了）");
			// ── 条目事实 → 悬停 + `events` 数组（同其它条目：**不排序**，保持源站顺序）──
			// `raw` 与卡池侧同口径：源站只有 epoch 秒 ⇒ 按源站 tz（UTC）渲染出的墙钟原文。
			const eventItems = live.map((x) => ({
				title: x.title,
				startTs: x.startTs,
				endTs: x.endTs,
				raw: fmtWindow(x.startTs, x.endTs, tz)
			}));
			const eventHover = hoverTextFromItems(eventItems, "event", tz);
			const dates = fmtWindow(cur.startTs, cur.endTs, tz);
			const out = {
				event: cur.title,
				eventDates: dates,
				eventDatesRaw: dates,
				...(eventHover ? { eventHover } : {})
			};
			out.events = dataArrayProducedEventsOf(out, eventItems, { tz }, now);
			out.eventHoverItems = eventItems;
			return out;
		}

		// ══ 原 43-sources-register.js 里属于本组的登记代码（原样保留）══
		GACHA_FETCHERS["uma-jp"] = (url, signal, tz) => ns_umamusume_official_gachaUmaJpOfficial(url, signal, tz);
		// 国际服卡池默认：GameTora（2026-10-21 起）。原 GachaTracker 转备选键 `uma-global-gt`；
		// 再往前默认过的官网公告保留 `uma-global-official`（最后兜底）。
		GACHA_FETCHERS["uma-global"] = (url, signal, tz) => ns_cygames_gachaGameToraUma(url, signal, tz);
		GACHA_FETCHERS["uma-global-gt"] = (url, signal, tz) => ns_cygames_gachaGtUma(url, signal, tz);            // 备选：GachaTracker（境外 · 联通不稳/数据陈旧）
		GACHA_FETCHERS["uma-global-official"] = (url, signal, tz) => ns_umamusume_official_gachaUmaGlobal(url, signal, tz);   // 最后兜底：官网公告
		EVENT_FETCHERS["uma-jp"] = Object.assign(EVENT_FETCHERS["uma-jp"] || {}, { default: (url, signal, tz) => ns_umamusume_official_eventsUmaJpOfficial(url, signal, tz) });
		// 国际服活动默认：GameTora（2026-11-14 起，与卡池同一个 manifest）。原官方公告转
		// `eventAltSources` 的 `uma-global-official`（标签逐字「官方公告（英文 · 不可靠）」）。
		EVENT_FETCHERS["uma-global"] = Object.assign(EVENT_FETCHERS["uma-global"] || {}, {
			default: (url, signal, tz) => ns_cygames_eventsGameToraUma(url, signal, tz),
			"uma-global-official": (url, signal, tz) => ns_umamusume_official_eventsUmaGlobal(url, signal, tz)
		});
		GACHA_FETCHERS["uma-jp-umapyoi"] = (url, signal, tz) => ns_umapyoi_gachaUmapyoi(url, signal, tz);
		EVENT_FETCHERS["uma-jp"] = EVENT_FETCHERS["uma-jp"] || {};

		Object.assign(EVENT_FETCHERS["uma-jp"], {

			"uma-jp-bwiki": { default: (url, signal, tz) => ns_bwiki_eventsUmaJp(url, signal, tz) },

		});


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-komoe.js：赛马娘·繁中服（uma-tw，Komoe 官方公告）
// ─────────────────────────────────────────────────────────────────────────────

//
// ── 源（1 次请求，卡池 + 活动同一份数据）───────────────────────────────────────
//   GET https://l11-web-api.komoejoy.com/game/website/content/107075/2/list?pageNum=1&pageSize=20&region=3
//     107075 = 赛马娘繁中服的游戏 id；`/2/list` 里的 2 = 公告频道；region=3 = 繁中区。
//     实测 2026-11-11：200 / application/json / 100 KB / 20 条（最新 2026-11-08）。
//     返回 `{ code:0, message:"success", data:[{ code, type, title, sub_title, tag, publish_time, rich_text }] }`
//       · `type`：2 = 公告（本文件只吃这个）；1 空 / 3 影像 / 4·5 不支持
//       · `publish_time` = **毫秒**（补年份的线索）；`rich_text` = 整篇公告的 HTML
//   ⚠️ 响应 `Access-Control-Allow-Origin` **只允许 `https://uma.komoejoy.com`** ⇒ DSH（`dsh-app://` 源）
//     里必须走宿主代理，且实测**必须带 Referer**（不带 ⇒ 源站侧拒绝）。宿主白名单见 `src/index.js`
//     的 `PROXY_ALLOW_HOSTS`（`l11-web-api.komoejoy.com`）。
//
// ── 时区 ──
//   源站墙钟即繁中服（UTC+8，无夏令时）⇒ `tz = Asia/Taipei`。只写在这里，**不进悬停**（方案 A）。
//
// ── 标题分流（标题是**唯一**的分类依据，不去正文猜）──────────────────────────────
//   ① 先剔三类"有标题、没档期"的稿：
//      · `機率公告`（「Pretty Derby轉蛋」與「支援卡片轉蛋」機率公告 —— 整篇是概率表，无期间）
//      · `每天1次 / 每日1次 / 免費轉蛋`（免费 10 连活动：正文里那段时间是**活动期**，不是卡池期）
//      · `結束`（「活動「訓練員技能測驗」結束！」：活动本体已结束，正文里只剩"报酬领取期"）
//   ② 卡池：标题含 `轉蛋` / `特選`（这两词是卡池稿的固定用词）。
//   ③ 活动：标题含 `活動` / `競賽` / `培育劇本` / `紀念`。
//      顺序很重要：`新培育劇本開幕轉蛋舉辦公告！` 同时含「轉蛋」与「培育劇本」——
//      它的正文/标题是**卡池**稿（培育剧本只是池名主题），所以 ② 必须排在 ③ 前面。
//   ④ `【預告】…`（实测 11-01 的卡池预告 + 10-28 的转蛋预告）与 `即將舉辦`（11-06 的传奇竞赛预告）：
//      正式稿一定在**同一页列表**里（实测 11-02 正式稿、11-07 正式稿）⇒ 预告稿整条丢掉，
//      否则同一口池会在悬停/数组里出现两行（标题不同、档期完全一样）。
//
// ── 正文区间（`rich_text`）────────────────────────────────────────────────────
//   档期写成「标签行 + 1~N 行区间」，实测两种：
//     举办期間
//     11/2 12:00 ～ 12/3 11:59                      ← 两端都明确
//     舉辦期間
//     10/29 維護結束後 ～ 11/23 11:59               ← **起点未知**（维护什么时候结束，源站写完就固定了）
//   解析口径：
//     · 只认**第一段**带区间的窗口块（`舉辦期間` / `特選期間` 两种标签）：一条公告 = 一条条目。
//       公告里后面那些 `販賣期間` / `領取報酬…期間` 是商店与报酬窗口，不是这条事项的档期。
//     · 同一个窗口块里的**多行区间全收**（实测「傳奇競賽舉辦中！」有两段：
//       11/7 12:00 ~ 11/10 4:59 与 11/10 5:00 ~ 11/13 4:59）—— 一条公告只取其中**一段**：
//       覆盖 now 的那段（startTs 最新）优先，都不覆盖时取结束最晚的那段。
//     · 起点写「維護結束後」⇒ **起点未知**（`startTs = null`）。按仓库口径
//       （24-parser-window.js 的 `coversNow` / `coveredOrOpen`）它**不算已开始**：
//       不进外显，只在悬停 / 数据数组里如实列出（`raw` 保留源站原文）。
//     · 区间里**没有年份**：用 `publish_time` 的年份补（共用 `inferYear`），
//       结束月日早于开始 ⇒ 记次年（共用 `endsNextYear`）。
//
// ── 输出（条目事实 → 悬停 + 数据数组）────────────────────────────────────────
//   条目事实形状：`{ key, title, show, startTs, endTs, tz, raw, display, source }`
//     · `key`     = 源站公告 `code`（诊断用；数据层会按 `<id>:gacha:i` 重发 key）
//     · `raw`     = 源站原文那一行（`11/2 12:00 ～ 12/3 11:59` / `10/29 維護結束後 ～ 11/23 11:59`）
//     · `display` = 补全后的可读文本（两端明确 ⇒ `MM-DD HH:MM ~ MM-DD HH:MM`，源站 tz；
//                   起点未知 ⇒ 与 `raw` 同值，**不编**一个时刻出来）
//   悬停由 **共用** `hoverTextFromItems` 生成、数组由 `dataArrayProducedGachaOf` /
//   `dataArrayProducedEventsOf` 生成 —— 排版与"谁算当期"都不在本文件各写一套（方案 A）。
//
// ── 卡池没有角色名 / 卡池名 ──
//   繁中服的公告标题就是"这一期卡池/活动"的唯一名字（例如「閃耀收藏 Pretty Derby轉蛋與保證SSR
//   意志力轉蛋舉辦公告！」），正文里那串 `★★★ [波浪間的綠寶石]無聲鈴鹿` 是**卡**而不是"卡池"。
//   与日服官方公告同口径：`banner` = 公告标题，`roles` 留空（不去正文猜角色，也不补前缀）。

		// ── 常量 ──
		const KOMOE_TW_TZ = "Asia/Taipei";
		const KOMOE_TW_URL = "https://l11-web-api.komoejoy.com/game/website/content/107075/2/list?pageNum=1&pageSize=20&region=3";
		// 实测：不带 Referer 时源站侧拒绝（ACAO 只放行 https://uma.komoejoy.com）
		const KOMOE_TW_REFERER = "https://uma.komoejoy.com/";
		const KOMOE_TW_SOURCE_LABEL = "Komoe 官方公告";
		// 只吃 `type: 2`（公告）；1 空 / 3 影像 / 4·5 不支持
		const KOMOE_TW_TYPE_NOTICE = 2;

		// 标题分流：先剔"有标题、没档期"的稿（判据见文件头 ①）
		const KOMOE_TW_DROP_TITLE_RE = /機率|概率|每天1次|每日1次|免費轉蛋|結束|預告|即將舉辦|即將登場|coming soon/i;
		// 卡池用词（必须先于活动判定，理由见文件头 ③）
		const KOMOE_TW_GACHA_TITLE_RE = /轉蛋|特選/;
		const KOMOE_TW_EVENT_TITLE_RE = /活動|競賽|培育劇本|紀念/;
		const KOMOE_TW_CARD_TITLE_RE = /卡片/;

		// 正文：窗口标签行 + 区间行（两种形态：两端明确 / 起点"維護結束後"）
		const KOMOE_TW_WINDOW_LABEL_RE = /舉辦期間|特選期間/;
		// `11/2 12:00 ～ 12/3 11:59`（全形「～」与半形「~」源站都在用）
		const KOMOE_TW_RANGE_RE = /^(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})\s*[～~]\s*(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})$/;
		// `10/29 維護結束後 ～ 11/23 11:59`（前缀日期是**维护那天**，起点仍然未知）
		const KOMOE_TW_OPEN_RANGE_RE = /^(\d{1,2})\/(\d{1,2})\s*(?:維護結束後|維護後|更新維護後|版本更新後|更新後|開服後)\s*[～~]\s*(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})$/;

		/** `rich_text` HTML → 逐行纯文本。`<br>` 与**块级**闭合标签算换行（`<td>` 靠空格），
		 *  再用共用 `htmlText` 解实体（`&nbsp;` / `&amp;` / 数字实体）。 */
		function komoeTwTextLinesOf(html) {
			const s = String(html == null ? "" : html)
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(/<\/(?:p|div|tr|li|ul|ol|h[1-6]|table|thead|tbody)>/gi, "\n");
			return htmlText(s)
				.split("\n")
				.map((x) => x.replace(/\s+/g, " ").trim())
				.filter(Boolean);
		}

		/** 列表 JSON → `[{ code, title, publishTs, html }]`（只留 `type: 2` 的公告，保持源站顺序）。
		 *  结构不对 **throw**（该侧如实报失败）；列表为空 = 未公布（返回 `[]`，不抛）。 */
		function komoeTwAnnouncementsOf(json) {
			if (!json || typeof json !== "object") throw new Error("komoe-tw-bad-json");
			if (numOrNull(json.code) !== 0) throw new Error("komoe-tw-bad-code:" + json.code);
			if (!Array.isArray(json.data)) throw new Error("komoe-tw-bad-list");
			const out = [];
			for (const it of json.data) {
				if (!it || typeof it !== "object") continue;
				if (numOrNull(it.type) !== KOMOE_TW_TYPE_NOTICE) continue;
				const title = String(it.title == null ? "" : it.title).replace(/\s+/g, " ").trim();
				const publishTs = numOrNull(it.publish_time);
				if (!title || publishTs == null) continue;
				out.push({ code: String(it.code == null ? "" : it.code), title, publishTs, html: String(it.rich_text == null ? "" : it.rich_text) });
			}
			return out;
		}

		/** 标题 → 该公告属于哪一侧（`"gacha"` / `"event"`）；不属于任何一侧 ⇒ `null`（判据见文件头）。 */
		function komoeTwSideOf(title) {
			const t = String(title == null ? "" : title);
			if (KOMOE_TW_DROP_TITLE_RE.test(t)) return null;
			if (KOMOE_TW_GACHA_TITLE_RE.test(t)) return "gacha";
			if (KOMOE_TW_EVENT_TITLE_RE.test(t)) return "event";
			if (KOMOE_TW_CARD_TITLE_RE.test(t)) return "gacha";
			return null;
		}

		/**
		 * 一行区间 → `{ startTs, endTs, raw, display }`；不是区间 / 年份线索缺失 ⇒ `null`。
		 * `hint` = 公告发布时刻的源站墙钟（`sourceWallParts(publishTs, tz)`），用于补年份。
		 */
		function komoeTwWindowOfLine(line, hint, tz) {
			const s = String(line == null ? "" : line).trim();
			let mo1, d1, h1, mi1, mo2, d2, h2, mi2, openStart = false;
			const m = KOMOE_TW_OPEN_RANGE_RE.exec(s);
			if (m) {
				// 起点「維護結束後」⇒ 起点未知：只解终点，`startTs` 留 null（仓库口径：起点未知 ≠ 已开始）
				mo1 = +m[1]; d1 = +m[2];
				mo2 = +m[3]; d2 = +m[4]; h2 = +m[5]; mi2 = +m[6];
				openStart = true;
			} else {
				const r = KOMOE_TW_RANGE_RE.exec(s);
				if (!r) return null;
				mo1 = +r[1]; d1 = +r[2]; h1 = +r[3]; mi1 = +r[4];
				mo2 = +r[5]; d2 = +r[6]; h2 = +r[7]; mi2 = +r[8];
			}
			const y1 = inferYear(null, mo1, hint);
			if (y1 == null) return null;                       // 拿不到年份线索 ⇒ 不猜（宁可这条不产出）
			const y2 = endsNextYear(mo1, d1, mo2, d2) ? y1 + 1 : y1;
			const endTs = sourceInstant(y2, mo2, d2, h2, mi2, tz);
			const startTs = openStart ? null : sourceInstant(y1, mo1, d1, h1, mi1, tz);
			if (startTs != null && !(endTs > startTs)) return null;
			return {
				startTs,
				endTs,
				raw: s,                                        // 源站原文那一行
				display: startTs == null ? s : fmtWindow(startTs, endTs, tz)   // 起点未知 ⇒ 不编时刻
			};
		}

		/**
		 * 一篇公告的正文 → 窗口数组（**只取第一段**带区间的窗口块，见文件头）。
		 * 标签行之后允许跨过少量非区间行（实测「指定競賽．舉辦期間．報酬」下面先是一行 `【天皇賞（秋）】`）。
		 */
		function komoeTwWindowsOf(html, publishTs, tz) {
			const hint = sourceWallParts(publishTs, tz);
			const lines = komoeTwTextLinesOf(html);
			const out = [];
			for (let i = 0; i < lines.length; i++) {
				if (!KOMOE_TW_WINDOW_LABEL_RE.test(lines[i])) continue;
				let miss = 0;
				for (let j = i + 1; j < lines.length && miss < 3; j++) {
					const w = komoeTwWindowOfLine(lines[j], hint, tz);
					if (w) { out.push(w); miss = 0; continue; }
					if (out.length) break;                 // 本块已收到区间 ⇒ 到下一行非区间就收工
					miss++;
				}
				if (out.length) break;                     // 只认第一段窗口块（见文件头）
			}
			return out;
		}

		/**
		 * 列表 JSON → 某一侧的**条目事实** `[{ key, title, show, startTs, endTs, tz, raw, display, source }]`。
		 * 一条公告 = 一条条目：多段窗口取"覆盖 now 的那段"，都不覆盖时取结束最晚的那段
		 * （后者仍会进悬停/数组 —— 起点未知的条目就靠这条路留下事实）。
		 */
		function komoeTwItemsOf(json, side, tz, now) {
			const out = [];
			for (const a of komoeTwAnnouncementsOf(json)) {
				if (komoeTwSideOf(a.title) !== side) continue;
				const wins = komoeTwWindowsOf(a.html, a.publishTs, tz);
				if (wins.length === 0) continue;            // 正文没有可解析区间 ⇒ 这条稿没有档期（不猜）
				const cover = wins.filter((w) => coversNow(w, now)).sort((x, y) => y.startTs - x.startTs)[0];
				const w = cover || wins.slice().sort((x, y) => y.endTs - x.endTs)[0];
				out.push({
					key: a.code,
					title: a.title,
					show: a.title,
					startTs: w.startTs,
					endTs: w.endTs,
					tz,
					raw: w.raw,
					display: w.display,
					source: "hover"
				});
			}
			return out;
		}

		/**
		 * 一侧的载荷（卡池 `banner` + `gacha`，或活动 `event` + `events`）：外显只取**两端都明确且覆盖 now** 的条目
		 * （起点未知的不进外显）；悬停/数组取 `coveredOrOpen`（在期 + 起点未知但终点未过）。
		 * 一条都没有 ⇒ `null`（未公布，绝不把过期/未来档期硬凑成"当期"）。
		 */
		function komoeTwPayloadOf(json, side, tz, now) {
			const isGacha = side === "gacha";
			const listed = komoeTwItemsOf(json, side, tz, now).filter((x) => coveredOrOpen(x, now));
			const primary = listed
				.filter((x) => coversNow(x, now))
				.sort((a, b) => (b.startTs - a.startTs) || (a.endTs - b.endTs))[0] || null;
			if (!primary) return null;
			// 悬停/数组的顺序：卡池按结束时间升序（与 `hoverPool` 同一份）；活动按仓库统一的 `sortEventItems`
			const entries = isGacha
				? listed.slice().sort(poolHoverOrderOf)
				: sortEventItems(listed.map((x) => Object.assign({}, x, { name: x.title })));
			const out = {};
			if (isGacha) {
				out.banner = primary.title;
				out.bannerDates = primary.display;          // 两端明确 ⇒ `MM-DD HH:MM ~ MM-DD HH:MM`
				out.bannerDatesRaw = primary.raw;
				out.startTs = primary.startTs;
				out.endTs = primary.endTs;
			} else {
				out.event = primary.title;
				out.eventDates = primary.display;
				out.eventDatesRaw = primary.raw;
			}
			const hover = hoverTextFromItems(entries, side, tz);
			if (hover) {
				if (isGacha) out.bannerHover = hover;
				else out.eventHover = hover;
			}
			if (isGacha) {
				out.gacha = dataArrayProducedGachaOf(out, entries, { tz }, now);
				out.gachaHoverItems = entries;
			} else {
				out.events = dataArrayProducedEventsOf(out, entries, { tz }, now);
				out.eventHoverItems = entries;
			}
			return out;
		}

		/** 抓取器：一次请求，两侧一起解（卡池载荷带 `event` ⇒ `fetchEntry` 复用同一份响应，不重复请求）。 */
		async function ns_komoe_fetchUmaTw(url, signal, tz = KOMOE_TW_TZ) {
			const json = await proxyFetchJson(url || KOMOE_TW_URL, KOMOE_TW_REFERER);
			const now = nowMs();
			const gacha = komoeTwPayloadOf(json, "gacha", tz, now);
			const events = komoeTwPayloadOf(json, "event", tz, now);
			if (!gacha && !events) return null;
			return Object.assign({}, gacha || {}, events || {});
		}

		// ── 条目 ──
		registerSource({
			id: "uma-tw",
			defaultHidden: false,
			tz: KOMOE_TW_TZ,
			name: "赛马娘·繁中服",
			// 与 uma-jp / uma-global 同款图标（同一款游戏的 App 图标；不另找 komoe 站外图片）
			icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/73/7c/0b/737c0b9b-6e90-8838-f0d3-fc7c576fbbad/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
			// 卡池与活动**同一条接口**（标题分流）：两侧 URL 相同 ⇒ 一次请求供两侧用
			url: KOMOE_TW_URL,
			source: KOMOE_TW_SOURCE_LABEL,
			eventUrl: KOMOE_TW_URL,
			eventSource: KOMOE_TW_SOURCE_LABEL
		});

		GACHA_FETCHERS["uma-tw"] = (url, signal, tz) => ns_komoe_fetchUmaTw(url, signal, tz);
		EVENT_FETCHERS["uma-tw"] = Object.assign(EVENT_FETCHERS["uma-tw"] || {}, { default: (url, signal, tz) => ns_komoe_fetchUmaTw(url, signal, tz) });


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-daum.js：赛马娘·韩服（uma-kr，Daum 카페 月间日程）
// ─────────────────────────────────────────────────────────────────────────────

//
// ── 源（2 次请求：板块置顶列表 → 当月日程帖；卡池 + 活动同一份数据）─────────────────
//   ① GET https://m.cafe.daum.net/umamusume-kor/Z4os                      ← 公告板块（공지사항）
//        SSR 页面，**只渲染 8 条置顶公告**（实测 2026-11-15：200 / text/html;charset=UTF-8 / 37,008 B）。
//        每行形如
//          <a href="/umamusume-kor/Z4os/799?" class="link_cafe">
//            <strong class="tit_info"><span class="txt_state txt_notice">공지</span
//            ><span class="txt_detail">(수정) 우마무스메 프리티 더비 11월 스케줄</span></strong>
//            <span class="txt_info">…<span class="created_at">26.10.29</span>…</span>
//        实测这 8 条里**含当月的日程帖**（标题带 `스케줄`）——跨月会换新帖、文章 id 随之变
//        （11 月 = 799，12 月会是新 id），所以**每次都从列表页找**，不写死 id。
//   ② GET https://m.cafe.daum.net/umamusume-kor/Z4os/799                  ← 当月日程帖
//        200 / 54,529 B（11 月）；正文在 `<div id="article" class="tx-content-container">` 里。
//        实测**免登录**、**不需要 Referer**（与 Komoe 繁中服那条不同）。
//   ③ 响应**没有 `Access-Control-Allow-Origin`** ⇒ 必须走宿主代理；域名见 `src/index.js`
//      的 `PROXY_ALLOW_HOSTS`（`m.cafe.daum.net`）。
//
// ── 时区 ──
//   源站墙钟 = 韩服（KST，UTC+9，无夏令时）⇒ `tz = Asia/Seoul`。只写在这里，**不进悬停**（方案 A）。
//
// ── 正文结构（`❖ <块标题>` 分块，实测 11 月帖共 10 块）──────────────────────────────
//   ❖ 11월 10일(화) 개최 예정, 픽업 프리티 더비 뽑기 & 셀렉트 픽업 서포트 카드 뽑기
//   1. 일정
//   - 11월 10일(화) 점검 완료 후 ~ 11월 19일(목) 11:59          ← 起点 = 「点检完成后」
//   2. 뽑기 대상
//   - 픽업 육성 우마무스메
//    · ★★★ [Assorted Cuteness♡] 후사이치 판도라
//   ❖ 11월 19일(목) 개최 예정, 픽업 프리티 더비 뽑기 & 픽업 서포트 카드 뽑기
//   - 11월 19일(목) 12:00 ~ 12월 3일(목) 11:59                 ← 两端都明确（跨年同理）
//   其他块（活动侧）：`❖ 스토리 이벤트 …` / `❖ 챔피언스 미팅 …` / `❖ 레전드 레이스 …` /
//   `❖ 마스터즈 챌린지` / `❖ … 캠페인(진행 중)` / `❖ 아그네스 타키온의 인자 연구`。
//
//   解析口径（与 `30-game-komoe.js` 逐条同构，只换语种）：
//     · **一个 ❖ 块 = 一条条目**；块内**只认第一条区间**（各块都把主档期放在最前，
//       后面的 `보상 수령 기간` / `참가 리그 선택 기간` / 第二个对手的窗口是附属窗口，不是这条事项的档期）。
//     · 卡池 vs 活动：块标题含 `뽑기`（抽卡）⇒ 卡池，其余 ⇒ 活动。
//     · 韩文日期 `11월 19일(목) 12:00` 的可选前缀 `2026년 `（实测「마스터즈 챌린지」块两个都带）；
//       没有年份时用**帖子发布时间**（`<span class="num_subject">26.10.29</span>`）补年（共用 `inferYear`），
//       `12월 3일` 这类跨年由 `endsNextYear` 记次年。
//     · 起点写 `점검 완료 후`（点检完成后）⇒ **起点未知**（`startTs = null`）：按仓库口径
//       （`24-parser-window.js` 的 `coversNow` / `coveredOrOpen`）它**不算已开始**，不进外显，
//       只在悬停 / 数据数组里如实列出（`raw` 保留源站原文）。
//       ⚠️ 2026-11-15 实测：更新公告（同一置顶列表里的 `11월 10일(화) 업데이트 안내`）正文
//           **只有**「11월 10일(화) 점검을 통해 업데이트가 진행될 예정입니다.」—— **没有点检时刻**，
//           所以取不到就如实留空（**不**拿"上一口池结束 +1 分钟"去猜，也不拿 12:00 当默认值）。
//           若将来更新公告开始写 `점검 시간: 05:00 ~ 11:00`，补全日期的入口就在 `umaKrWindowOfLine`。
//     · 池名：源站**没有独立的卡池 banner**（卡池块标题 = 日期 + 池类型，例
//       「픽업 프리티 더비 뽑기 & 셀렉트 픽업 서포트 카드 뽑기」）⇒ 池名 = **池类型 + 角色名**
//       （`banner = "<池类型>（<角色>）"`，角色取自块内 `- 픽업 육성 우마무스메` 小节）；
//       支援卡（`SSR` / `R` 行）不进 roles —— 与日服/国际服同口径（面板外显是育成马娘名）。
//
// ── 输出（条目事实 → 悬停 + 数据数组）────────────────────────────────────────
//   条目事实形状：`{ key, title, banner?, roles?, kind, startTs, endTs, tz, raw, display, source }`
//   悬停由 **共用** `hoverTextFromItems` 生成、数组由 `dataArrayProducedGachaOf` /
//   `dataArrayProducedEventsOf` 生成（方案 A：排版与"谁算当期"都不在本文件各写一套）。
//   起点未知的条目 `raw` 含 `점검 완료 후` ⇒ `hoverWindowTextOf` 自动退回原文（两端口 ts 不齐），
//   所以**不需要**往 `HOVER_RELATIVE_WINDOW_RE` 里加韩文词条。
//
// ── 失败语义 ──
//   · 列表页/正文页**结构变了**（`link_cafe` 一处都认不出 / 找不到 `<div id="article"` / 一个 ❖ 块都没有）
//     ⇒ **抛错**（该侧如实报"抓取失败"，绝不伪装成"未公布"）；
//   · 页面正常、只是当期没有两端明确的档期 ⇒ 返回 `null`（未公布）。

		// ── 常量 ──
		const UMA_KR_TZ = "Asia/Seoul";
		const UMA_KR_BOARD_URL = "https://m.cafe.daum.net/umamusume-kor/Z4os";
		// 兜底文章 id（列表页里找不到日程帖时用；用户在设置页可以改成别的帖）
		const UMA_KR_SCHEDULE_URL = "https://m.cafe.daum.net/umamusume-kor/Z4os/799";
		const UMA_KR_SOURCE_LABEL = "Daum 月度日程";
		// 文章 id 的上限（防御：列表页里 `\d+` 匹配到别的数字）
		const UMA_KR_MAX_ARTICLE_CHARS = 400000;

		// 列表页的置顶公告行：`<a href="/umamusume-kor/<板块>/<文章>?" class="link_cafe">…</a>`
		const UMA_KR_NOTICE_RE = /<a href="\/umamusume-kor\/([A-Za-z0-9]+)\/(\d+)\?"[^>]*class="link_cafe">([\s\S]*?)<\/a>/g;
		const UMA_KR_TITLE_RE = /txt_detail">([\s\S]*?)<\/span>/;
		const UMA_KR_CREATED_RE = /created_at">([^<]*)</;
		// 日程帖标题（实测 `(수정) 우마무스메 프리티 더비 11월 스케줄`）；先剔掉非日程的置顶稿
		const UMA_KR_SCHEDULE_TITLE_RE = /일정|스케줄/;
		const UMA_KR_NOT_SCHEDULE_RE = /점검|업데이트|오류|결제|가이드|행위|이벤트\s*안내/;

		// 正文里的块标题（实测 10 块都是 `❖ ` 开头）
		const UMA_KR_BLOCK_RE = /^❖\s*/;
		// 卡池块的用词（`뽑기` = 抽卡；活动块标题不含这个词）
		const UMA_KR_GACHA_TITLE_RE = /뽑기/;
		// 卡池块标题里的日期前缀：「11월 19일(목) 개최 예정, 」—— 池名只留后面的池类型
		// ⚠️ 源站在 `11` 与 `월` 之间塞了嵌套 `<span>`，`htmlText` 压平后变成「11 월」（实测 11 月帖第一块）
		//    ⇒ 数字与 `월`/`일` 之间必须容许空白，否则这条前缀剥不掉、池名会带上日期。
		const UMA_KR_POOL_LEAD_RE = /^\d{1,2}\s*월\s*\d{1,2}\s*일\([월화수목금토일]\)\s*(?:개최\s*예정)?\s*[,，]?\s*/;
		// 块内「育成马娘」小节标题（角色名就在它下面的 `·` 行里）
		const UMA_KR_ROLES_HEAD_RE = /육성\s*우마무스메/;

		// 韩文区间：`- 11월 19일(목) 12:00 ~ 12월 3일(목) 11:59`
		//            `· 10월 16일(금) 점검 완료 후 ~ 11월 19일(목) 04:59`
		//            `· 2026년 11월 19일(목) 12:00 ~ 2027년 2월 17일(수) 11:59`
		// 分组：1=起年 2=起月 3=起日 4=起时 5=起分 6=终年 7=终月 8=终日 9=终时 10=终分
		const UMA_KR_RANGE_RE = new RegExp(
			String.raw`^[-·]\s*(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일\([월화수목금토일]\)\s*`
			+ String.raw`(?:(\d{1,2}):(\d{2})|점검\s*완료\s*후|점검\s*후|업데이트\s*후)\s*`
			+ String.raw`~\s*(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일\([월화수목금토일]\)\s*(\d{1,2}):(\d{2})$`
		);
		// 正文 html → 行文本：`<br>` 与块级闭合标签算换行；`<script>` 整段丢掉
		// （实测正文尾部挂着 `imageGrid` 的那段内联脚本，不丢会混进行文本）
		const UMA_KR_SCRIPT_RE = /<script[\s\S]*?<\/script>/gi;

		/** 帖子自己的发布日期（源站墙钟）→ `{ y, mo }`（补年份的唯一线索）。认不出 ⇒ `null`。 */
		function umaKrHintOf(html) {
			const m = /작성시간<\/span>\s*<span class="num_subject">\s*(\d{2})\.(\d{1,2})\.(\d{1,2})/.exec(String(html == null ? "" : html));
			if (!m) return null;
			return { y: 2000 + Number(m[1]), mo: Number(m[2]) };
		}

		/** 列表页 html → `[{ board, id, title, created }]`（保持源站顺序）。
		 *  **一行都认不出 ⇒ 抛**（列表页结构变了）；认得行但标题都不匹配 = 当期没换帖（返回 `[]` 由调用方兜底）。 */
		function umaKrNoticesOf(html) {
			const s = String(html == null ? "" : html);
			const out = [];
			UMA_KR_NOTICE_RE.lastIndex = 0;
			let m;
			while ((m = UMA_KR_NOTICE_RE.exec(s)) !== null) {
				const inner = m[3] || "";
				const tm = UMA_KR_TITLE_RE.exec(inner);
				const cm = UMA_KR_CREATED_RE.exec(inner);
				const title = htmlText(tm ? tm[1] : "").replace(/\s+/g, " ").trim();
				if (!title) continue;                       // `link_cmt` 之类的无标题行
				out.push({ board: m[1], id: m[2], title, created: cm ? cm[1].trim() : "" });
			}
			if (out.length === 0 && !/link_cafe/.test(s)) throw new Error("uma-kr-bad-list");
			return out;
		}

		/** 列表里的置顶稿 → 当月的日程帖（`null` = 没找到，调用方回退到配置的 url）。 */
		function umaKrScheduleRowOf(notices) {
			for (const r of Array.isArray(notices) ? notices : []) {
				if (UMA_KR_NOT_SCHEDULE_RE.test(r.title)) continue;
				if (UMA_KR_SCHEDULE_TITLE_RE.test(r.title)) return r;
			}
			return null;
		}

		/** 置顶稿 → 文章 url（板块前缀跟着源站走，不把 `Z4os` 写死）。 */
		function umaKrArticleUrlOf(row) {
			return `https://m.cafe.daum.net/umamusume-kor/${row.board}/${row.id}`;
		}

		/** 帖子 html → 正文行文本（`view_subject` 的发布日期 + `#article` 的正文）。
		 *  找不到 `#article` ⇒ **抛**（正文页结构变了）。 */
		function umaKrLinesOf(html) {
			const s = String(html == null ? "" : html);
			const a = s.indexOf('<div id="article"');
			if (a < 0) throw new Error("uma-kr-bad-article");
			const endMark = s.indexOf('<div id="search_keyword_suggest"', a);
			const body = s.slice(a, endMark > a ? endMark : Math.min(s.length, a + UMA_KR_MAX_ARTICLE_CHARS));
			const text = htmlText(
				body
					.replace(UMA_KR_SCRIPT_RE, " ")
					.replace(/<br\s*\/?>/gi, "\n")
					.replace(/<\/(?:p|div|tr|li|ul|ol|h[1-6]|table|thead|tbody)>/gi, "\n")
			);
			return text.split("\n").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
		}

		/**
		 * 一行韩文区间 → `{ startTs, endTs, raw, display }`；不是区间 / 拿不到年份线索 ⇒ `null`。
		 * `hint` = 帖子发布时刻的源站墙钟（`{ y, mo }`），只用来补年。
		 * 起点写 `점검 완료 후`（维护完成后）⇒ 固定用**当日 12:00**（韩服更新维护的固定开始时刻；
 *   用户 2026-11-15 拍板：官方日程只写「维护完成后」不给钟点，但 11-10 那次维护是 12:00开始）。
 *   `raw` 仍保留源站原文。
		 */
		function umaKrWindowOfLine(line, hint, tz) {
			const s = String(line == null ? "" : line).trim();
			const m = UMA_KR_RANGE_RE.exec(s);
			if (!m) return null;
			const y1raw = m[1] != null ? Number(m[1]) : null;
			const mo1 = Number(m[2]), d1 = Number(m[3]);
			const openStart = m[4] == null;                       // 起点是「点检完成后」
			const h1 = openStart ? null : Number(m[4]);
			const mi1 = openStart ? null : Number(m[5]);
			const y2raw = m[6] != null ? Number(m[6]) : null;
			const mo2 = Number(m[7]), d2 = Number(m[8]);
			const h2 = Number(m[9]), mi2 = Number(m[10]);
			const y1 = inferYear(y1raw, mo1, hint);
			if (y1 == null) return null;                          // 没有年份线索 ⇒ 不猜（宁可这条不产出）
			const y2 = y2raw != null ? y2raw : (endsNextYear(mo1, d1, mo2, d2) ? y1 + 1 : y1);
			if (y2 < y1) return null;
			const endTs = sourceInstant(y2, mo2, d2, h2, mi2, tz);
			// 起点写「점검 완료 후」：韩服固定 12:00 开始维护（用户 2026-11-15 拍板）
			const UMA_KR_MAINT_START_HOUR = 12;
			const startTs = openStart
				? sourceInstant(y1, mo1, d1, UMA_KR_MAINT_START_HOUR, 0, tz)
				: sourceInstant(y1, mo1, d1, h1, mi1, tz);
			if (startTs != null && !(endTs > startTs)) return null;
			// 列表符号（`- ` / `· `）是排版记号，不进 raw/display（悬停里那两行要读成"起止"本身）
			const bare = s.replace(/^[-·]\s*/, "");
			return {
				startTs,
				endTs,
				raw: bare,                                        // 源站原文那一行（去掉列表符号）
				display: startTs == null ? bare : fmtWindow(startTs, endTs, tz)   // 起点未知 ⇒ 不编时刻
			};
		}

		/** 块内行文本 → 块的主档期（**只认第一条**区间，理由见文件头）。一条都没有 ⇒ `null`。 */
		function umaKrWindowOfBlock(lines, hint, tz) {
			const list = Array.isArray(lines) ? lines : [];
			for (let i = 0; i < list.length; i++) {
				const w = umaKrWindowOfLine(list[i], hint, tz);
				if (w) return w;
				if (UMA_KR_RANGE_RE.test(String(list[i] || "").trim())) return null;  // 认得出是区间但补不出年份
			}
			return null;
		}

		/** 块内「育成马娘」小节的 `·` 行 → 角色名（去掉 `★★★` 稀有度记号，保留 `[卡名] 马娘名`）。 */
		function umaKrRolesOf(lines) {
			const list = Array.isArray(lines) ? lines : [];
			const out = [];
			let inRoles = false;
			for (const raw of list) {
				const s = String(raw == null ? "" : raw).trim();
				if (!s) continue;
				if (UMA_KR_BLOCK_RE.test(s)) break;
				if (/^-\s*/.test(s)) {                       // 小节标题（`- 픽업 육성 우마무스메` / `- 픽업 서포트 카드`）
					inRoles = UMA_KR_ROLES_HEAD_RE.test(s);
					continue;
				}
				if (!inRoles) continue;
				if (!/^[·•]/.test(s)) continue;
				const name = s.replace(/^[·•]\s*/, "").replace(/^★+\s*/, "").replace(/\s+/g, " ").trim();
				if (name && !out.includes(name)) out.push(name);
			}
			return out.join("、");
		}

		/** 帖子 html → `[{ title, lines, kind }]`（按 `❖` 分块，保持源站顺序）。一块都没有 ⇒ 抛。 */
		function umaKrBlocksOf(html) {
			const lines = umaKrLinesOf(html);
			const out = [];
			let cur = null;
			for (const line of lines) {
				if (UMA_KR_BLOCK_RE.test(line)) {
					cur = { title: line.replace(UMA_KR_BLOCK_RE, "").trim(), lines: [] };
					if (cur.title) out.push(cur);
					else cur = null;
					continue;
				}
				if (cur) cur.lines.push(line);
			}
			if (out.length === 0) throw new Error("uma-kr-no-blocks");
			return out.map((b) => ({
				title: b.title,
				lines: b.lines,
				kind: UMA_KR_GACHA_TITLE_RE.test(b.title) ? "gacha" : "event"
			}));
		}

		/** 卡池块标题 → 池类型（去掉「11월 19일(목) 개최 예정, 」这类日期前缀）。 */
		function umaKrPoolTypeOf(title) {
			return String(title == null ? "" : title).replace(UMA_KR_POOL_LEAD_RE, "").trim();
		}

		/**
		 * 块 → 某一侧的**条目事实** `[{ key, title, banner?, roles?, startTs, endTs, tz, raw, display, source }]`。
		 * 没有可解析档期的块**直接跳过**（不猜）；`hint` 缺年份线索时同样跳过。
		 */
		function umaKrItemsOf(blocks, side, tz, hint) {
			const out = [];
			for (const b of Array.isArray(blocks) ? blocks : []) {
				if (b.kind !== side) continue;
				const w = umaKrWindowOfBlock(b.lines, hint, tz);
				if (!w) continue;
				const base = {
					key: b.title,
					startTs: w.startTs,
					endTs: w.endTs,
					tz,
					raw: w.raw,
					display: w.display,
					source: "hover"
				};
				if (side === "gacha") {
					const type = umaKrPoolTypeOf(b.title);
					const roles = umaKrRolesOf(b.lines);
					// 池名 = 池类型 + 角色名（源站没有独立 banner，见文件头）
					out.push(Object.assign(base, {
						title: roles ? `${type}（${roles}）` : type,
						banner: roles ? `${type}（${roles}）` : type,
						roles
					}));
				} else {
					out.push(Object.assign(base, { title: b.title }));
				}
			}
			return out;
		}

		/**
		 * 一侧的载荷（卡池 `banner` + `gacha`，或活动 `event` + `events`）：
		 * 外显只取**两端都明确且覆盖 now** 的条目（起点未知的不进外显）；
		 * 悬停/数组取 `coveredOrOpen`（在期 + 起点未知但终点未过）。
		 * 一条都不覆盖 ⇒ `null`（未公布，绝不把过期/未来档期硬凑成"当期"）。
		 */
		function umaKrPayloadOf(items, side, tz, now) {
			const isGacha = side === "gacha";
			const listed = (Array.isArray(items) ? items : []).filter((x) => coveredOrOpen(x, now));
			const primary = listed
				.filter((x) => coversNow(x, now))
				.sort((a, b) => (b.startTs - a.startTs) || (a.endTs - b.endTs))[0] || null;
			if (!primary) return null;
			// 悬停/数组顺序：卡池按结束时间升序（`poolHoverOrderOf`）；活动按仓库统一 `sortEventItems`
			const entries = isGacha
				? listed.slice().sort(poolHoverOrderOf)
				: sortEventItems(listed.map((x) => Object.assign({}, x, { name: x.title })));
			const out = {};
			if (isGacha) {
				out.banner = primary.banner;
				out.roles = primary.roles;
				out.bannerDates = primary.display;
				out.bannerDatesRaw = primary.raw;
				out.startTs = primary.startTs;
				out.endTs = primary.endTs;
			} else {
				out.event = primary.title;
				out.eventDates = primary.display;
				out.eventDatesRaw = primary.raw;
			}
			const hover = hoverTextFromItems(entries, side, tz);
			if (hover) {
				if (isGacha) out.bannerHover = hover;
				else out.eventHover = hover;
			}
			if (isGacha) {
				out.gacha = dataArrayProducedGachaOf(out, entries, { tz }, now);
				out.gachaHoverItems = entries;
			} else {
				out.events = dataArrayProducedEventsOf(out, entries, { tz }, now);
				out.eventHoverItems = entries;
			}
			return out;
		}

		/** 抓取器：两次请求（列表页找当月日程帖 → 正文页）；两侧一起解，
		 *  卡池载荷带 `event` ⇒ `fetchEntry` 复用同一份响应，活动侧不再重复请求。 */
		async function ns_umakr_fetchUmaKr(url, signal, tz = UMA_KR_TZ) {
			const tzUse = tz || UMA_KR_TZ;
			const listHtml = await proxyFetchText(UMA_KR_BOARD_URL);
			const row = umaKrScheduleRowOf(umaKrNoticesOf(listHtml));
			// 列表里没有日程帖（置顶槽位换了）⇒ 回退到配置的 url（默认 = 上一个已知的日程帖）
			const articleUrl = row ? umaKrArticleUrlOf(row) : (url || UMA_KR_SCHEDULE_URL);
			const html = await proxyFetchText(articleUrl);
			const hint = umaKrHintOf(html);
			const blocks = umaKrBlocksOf(html);
			const now = nowMs();
			const gacha = umaKrPayloadOf(umaKrItemsOf(blocks, "gacha", tzUse, hint), "gacha", tzUse, now);
			const events = umaKrPayloadOf(umaKrItemsOf(blocks, "event", tzUse, hint), "event", tzUse, now);
			if (!gacha && !events) return null;
			return Object.assign({}, gacha || {}, events || {});
		}

		// ── 条目 ──
		registerSource({
			id: "uma-kr",
			defaultHidden: false,
			tz: UMA_KR_TZ,
			name: "赛马娘·韩服",
			// 与 uma-jp / uma-global / uma-tw 同款图标（同一款游戏的 App 图标）
			icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/73/7c/0b/737c0b9b-6e90-8838-f0d3-fc7c576fbbad/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
			// 卡池与活动**同一个帖子**（按 `❖` 块标题分流）：两侧 URL 相同 ⇒ 一次抓取供两侧用
			url: UMA_KR_SCHEDULE_URL,
			source: UMA_KR_SOURCE_LABEL,
			eventUrl: UMA_KR_SCHEDULE_URL,
			eventSource: UMA_KR_SOURCE_LABEL
		});

		GACHA_FETCHERS["uma-kr"] = (url, signal, tz) => ns_umakr_fetchUmaKr(url, signal, tz);
		EVENT_FETCHERS["uma-kr"] = Object.assign(EVENT_FETCHERS["uma-kr"] || {}, { default: (url, signal, tz) => ns_umakr_fetchUmaKr(url, signal, tz) });


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-pcr-jp.js：公主连结·日服（pcr-jp，microCMS 官方公告）
// ─────────────────────────────────────────────────────────────────────────────

//
// ── 落点 ────────────────────────────────────────────────────────────────────────
// 厂商级文件（`30-game-*` 家族，不是 bwiki 系）：唯一来源 `id:"pcr-jp"`，
// 卡池侧与活动侧**共用一份公告列表**，标签逐字「官网公告（日文）」（两侧同一条）。
// 与 `30-game-pcr-tw.js`（繁中服 So-net 官网 HTML）**不是**同一套接口：日服走 microCMS JSON。
//
// ── ① 站点形态（2026-11-15 16:36 JST 实测；夹具 test/fixtures/pcr-jp-*）──────────────
//   列表 `GET https://bekr66d8pd-833ej8ymdl32y5zpbknx.microcms.io/api/v1/news`
//     `?filters=title[contains]ガチャ[or]categories[contains]イベント`
//     `&limit=20&fields=id,title,categories,display_date&orders=-display_date`
//     header **必须**带 `X-MICROCMS-API-KEY: OeGtcSAG23n5RAIQO9RtDLvroc0ROUR4m1ci`
//     200 / `application/json; charset=utf-8` / 每行 `{ id, title, categories[], display_date(ISO/UTC) }`
//     全量 `totalCount=6620`（limit 单独请求）；本条的 filter 组合 `totalCount=2072`。
//     `orders=-display_date` 让源站直接倒序；`fields` 只要 4 个键 ⇒ 响应 ~3.6 KB。
//     ⚠️ 一次 filter **同时圈住两侧**（activity 靠 `categories` 含「イベント」，卡池靠标题含「ガチャ」），
//        所以"列表 1 次"就能同时喂卡池与活动（见 ③）。
//     ⚠️ 响应带 `Access-Control-Allow-Origin: *`，且 OPTIONS 预检明确放行自定义头
//        （`Access-Control-Allow-Headers` 里有 `X-Microcms-Api-Key`；带 `Origin: dsh-app://dsh`
//        实测预检 200）⇒ 浏览器可**直连**（`mode: "direct"`），不进宿主代理白名单
//        （`tools/check-host-allow.mjs` 的 `DIRECT_HOSTS` 同步登记了这个域名）。
//   详情 `GET …/api/v1/news/{id}`（同域、同一把 key、同样 ACAO * ⇒ 直连）
//     200 / 6~9 KB JSON，字段 `id/createdAt/updatedAt/publishedAt/revisedAt/display_date/
//     categories/thumbnail/display_flag/title/body_html`；正文只在 `body_html`（HTML 串，**单行**）。
//   正文写法（实测多篇逐篇一致）：
//     `<p>■ピックアップガチャ開催期間<br>2026/11/10(火) 12:00 ～ 2026/11/30(月) 11:59<br>…</p>`
//     ⇒ 锚点行 `■…期間` + **下一行恰为日期区间**（两端 4 位年 + 时分 + `(曜日)`，分隔符 `～`/`~`）。
//     实测锚点：`■ピックアップガチャ開催期間` / `■開催期間`（活动）/ `■マスターピースつき ★3確定
//     プラチナガチャ開催期間`（非本命池，见 ②）。另有 `■イベント期間` 一类同类锚点，尾缀一律剥掉。
//     ⚠️ 只在**整行恰为区间**时认窗口：这两篇里各有一条"行内日期"陷阱（实测逐字保留在夹具里）——
//        カード池正文的 `※マスターピースつき ★3確定プラチナガチャの開催期間は2026/11/10(火) 12:00
//        ～ 2026/11/16(月) 11:59までです。`、活动正文的 `※★獲得報酬は、2026/11/19(木) 14:59まで
//        受け取ることができます。`、以及注意事項里的 `3. 2026/11/10(火) 11:59以前から…` 都**不是**档期。
//   详情里同一篇会写多个 `■…期間`（如マスターピース期間、販売期間）⇒ 只认"锚点行 + 整行区间"这一对，
//   每对产一条窗口；名字 = 锚点行去掉尾缀（`開催期間`/`イベント期間`/`販売期間`/`期間`）。
//
// ── ② 卡池 / 活动怎么分（标题 + categories）─────────────────────────────────────────
//   卡池 = 标题含「ピックアップガチャ」或「フェスガチャ」（本命池：期间限定角色 / プリンセスフェス）。
//     标题里 `期間限定キャラ「…」`/`限定キャラ「…」` 的引号内是**角色**；池名取正文锚点
//     （`ピックアップガチャ` / `プリンセスフェスガチャ`），锚点拿不到才退回标题里的 `…ガチャ`。
//     ⚠️ **不**收同期并行的其他池 —— `マスターピースつき ★3確定プラチナガチャ` / `選べるプライズガチャ` /
//        `10回目ピックアップキャラ出現率3倍ガチャ` / `コネクトコインつき ★3確定プラチナガチャ`
//        都写成 `お知らせ`、标题也不含「ピックアップガチャ」⇒ 天然落进 other。
//        （口径同 `hl-jp`：只认「期間限定建造」那种"本命池"，不收常驻/付费/次数池。）
//   活动 = `categories` 含「イベント」。标题尾巴（`開催決定！`/`開催中！`/`開催期間終了！`）剥掉；
//     `「…」` 包住的就用引号里的名字（`復刻ストーリーイベント「…」開催決定！` ⇒ 引号内）；
//     **标题已写明 `開催期間終了`/`開催終了` 的直接不收**（已结束的正文没必要再抓，省一个请求）。
//   其余（`アップデート` / `メンテナンス` / 纯 `お知らせ`）两侧都不要。
//
// ── ③ 请求预算（用户口径：列表 1 + 新公告详情；详情按 id 缓存 TTL 24h，已结束不再取）──────────
//   第 1 轮 = **列表 1 次**（两侧共用同一次请求，`fetchRoundSeqOf` + 轮内 Promise）+ 详情：
//     卡池侧 1 篇（当期本命池）、活动侧 3 篇（明日开的活动 → 无整行区间的复刻活动 → 当期活动），
//     命中当期窗口即**提前收**（`ns_pcr_JP_MAX_DETAILS` = 4 是上限，不是固定值）⇒ 实测 5 次。
//   稳态 = **1 次**（只列表；详情正文按 id 缓存 24h；已结束的（窗口全部 endTs<=抓取时刻）缓存
//     永久有效 —— "已结束不再取"，见 `ns_pcr_JP_cacheSealedOf`）。
//
// ── ④ 失败语义（与全仓一致）──────────────────────────────────────────────────────
//   · HTTP 非 2xx ⇒ 抛（`fetchJson` 自己抛 `http-…`）；
//   · 列表结构变了（`{}` / 空串 / 没有 `contents` / 一条可用行都没有）⇒ **抛**（`pcr-jp-list-changed:*`）；
//   · 详情结构变了（`{}` / 空串 / 没有 `body_html` / `body_html` 不是非空字符串 / 正文里抽不出任何一行）
//     ⇒ **抛**（`pcr-jp-detail-changed:*`）；**不是** nomatch；
//   · 正文正常但**没有任何整行区间**（锚点被抹掉）⇒ 不抛，这一篇就是"没有窗口"（不进外显）；
//   · 详情全部失败且一条都没解析出来 ⇒ 抛第一篇的错（抓取失败 ≠ 未公布）；
//   · 解出来了但没有窗口覆盖 now ⇒ `null`（未公布，不硬凑过期档期）。
//
// ── ⑤ 当期现状（2026-11-15 16:36 JST 实测）────────────────────────────────────────
//   卡池 = `ピックアップガチャ`（`ラッキーライラック`）11-10 12:00 ~ 11-30 11:59 在期；
//   活动 = `バトルスタジアム` 11-09 12:00 ~ 11-15 20:59 在期（当天 20:59 收）；
//   明日 11/16 12:00 开的 `エルピス討魔戦線`（11-16 12:00 ~ 11-22 04:59）抓到了但**尚未在期** ⇒
//   如实不进外显（`ns_bwiki_eventPayload` 只收覆盖 now 的条目）。
//   时区 = `Asia/Tokyo`（源站公告墙钟就是 JST；与 UTC 的换算由 `sourceInstant` 负责）。

//#region ① 常量
const ns_pcr_JP_TZ = "Asia/Tokyo";
const ns_pcr_JP_API_BASE = "https://bekr66d8pd-833ej8ymdl32y5zpbknx.microcms.io/api/v1/news";
// microCMS 的**读**用 API key（官方文档口径：只读 key 就是放在前端公开调用的，写 key 才有危险）
const ns_pcr_JP_API_KEY = "OeGtcSAG23n5RAIQO9RtDLvroc0ROUR4m1ci";
// 一次 filter 同时圈卡池与活动；`orders=-display_date` 让源站排好序（不在本地猜排序）
const ns_pcr_JP_LIST_URL = ns_pcr_JP_API_BASE
	+ "?filters=" + encodeURIComponent("title[contains]ガチャ[or]categories[contains]イベント")
	+ "&limit=20&fields=id,title,categories,display_date&orders=-display_date";
const ns_pcr_JP_DETAIL_BASE = ns_pcr_JP_API_BASE + "/";
const ns_pcr_JP_SOURCE_LABEL = "官网公告（日文）";
// 每侧最多取几篇详情（见文件头 ③：命中当期窗口会提前收，4 只是上限）
const ns_pcr_JP_MAX_DETAILS = 4;
// 详情正文解析结果缓存 TTL = 24h（按 id 缓存，换池不会串）
const ns_pcr_JP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 轮内列表复用兜底上限（同 hl / cytq / pcr-tw 的 30s）
const ns_pcr_JP_ROUND_TTL_MS = 30000;
// 本命池 = 标题含这两个字样（见文件头 ②）
const ns_pcr_JP_GACHA_TITLE_RE = /(?:ピックアップ|フェス)ガチャ/;
const ns_pcr_JP_EVENT_CATEGORY = "イベント";
// 标题已写明"已结束"的活动公告：没必要再抓正文（省一个请求；正文里那串窗口也已过期）
const ns_pcr_JP_ENDED_TITLE_RE = /(?:開催期間終了|開催終了)[！!。]*(?:【[^】]{0,40}】)?\s*$/;
// 正文里"一整行恰为一个日期区间"：两端 4 位年 + 时分 + 可选 `(曜日)`（见文件头 ①）。
// 结束年可省（实测没出现，出现时按 `endsNextYear` 判）；分隔符 `～`/`~`/`〜` 全认。
const ns_pcr_JP_RANGE_RE = /^(\d{4})\s*[\/／]\s*(\d{1,2})\s*[\/／]\s*(\d{1,2})(?:\s*\([^)]{1,12}\))?\s+(\d{1,2})\s*[:：]\s*(\d{2})\s*[～~〜]\s*(?:(\d{4})\s*[\/／]\s*)?(\d{1,2})\s*[\/／]\s*(\d{1,2})(?:\s*\([^)]{1,12}\))?\s+(\d{1,2})\s*[:：]\s*(\d{2})$/;
// 锚点行（`■ピックアップガチャ開催期間`）
const ns_pcr_JP_LABEL_RE = /^■\s*(.{1,60}?)\s*$/;
// 锚点行尾缀：剥掉这些词，剩下的才是"这个档期叫什么"
const ns_pcr_JP_LABEL_TAIL_RE = /(?:開催|イベント|販売|提供)?期間$/;
// 标题派生活动名要剥的尾巴（`…開催決定！` / `…開催中！`）
const ns_pcr_JP_EVENT_TAIL_RE = /(?:開催期間終了|開催終了|開催決定|開催中|開催)[！!。\s]*$/;
// 标题里的「…」：角色名（卡池）/ 活动名（活动）都从这取
const ns_pcr_JP_QUOTED_RE = /「([^「」]{1,80})」/;
//#endregion

//#region ② 纯解析：列表
// 列表 JSON → `[{ id, title, categories, kind }]`（顺序 = 源站 `orders=-display_date`，本地不再排）。
// **结构变了要抛**：`{}` / 空串 / 没有 `contents` / 一条可用行都解析不出。
function ns_pcr_jp_listOf(json) {
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("pcr-jp-list-changed:bad-json");
	if (!Array.isArray(json.contents)) throw new Error("pcr-jp-list-changed:no-contents");
	const out = [];
	for (const x of json.contents) {
		if (!x || typeof x !== "object") continue;
		const id = String(x.id == null ? "" : x.id).trim();
		if (!id) continue;
		const title = String(x.title == null ? "" : x.title).trim();
		const categories = Array.isArray(x.categories) ? x.categories.map((c) => String(c == null ? "" : c).trim()) : [];
		out.push({
			id,
			title,
			categories,
			displayDate: String(x.display_date == null ? "" : x.display_date),
			kind: ns_pcr_jp_kindOf(title, categories)
		});
	}
	if (out.length === 0) throw new Error("pcr-jp-list-changed:no-item");
	return out;
}
// 标题 + categories → 哪一侧（见文件头 ②）：gacha / event / ended / other
function ns_pcr_jp_kindOf(title, categories) {
	const t = String(title == null ? "" : title);
	if (ns_pcr_JP_GACHA_TITLE_RE.test(t)) return "gacha";
	const cats = Array.isArray(categories) ? categories : [];
	if (!cats.includes(ns_pcr_JP_EVENT_CATEGORY)) return "other";
	return ns_pcr_JP_ENDED_TITLE_RE.test(t) ? "ended" : "event";
}
//#endregion

//#region ③ 纯解析：详情（body_html → 行 → 整行区间 → 条目事实）
// body_html → 行数组。`<br>` / `</p>` / 块级收尾都当行边界，**其余标签不插分隔符**；
// 实体再解一遍（`&nbsp;` 等）。抽不出任何一行 ⇒ 返回空数组（调用方当结构变了抛）。
function ns_pcr_jp_linesOf(bodyHtml) {
	return String(bodyHtml == null ? "" : bodyHtml)
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(?:p|div|h[1-6]|li|tr|table|section)>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.split("\n")
		.map((x) => decodeExtra(x).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim())
		.filter(Boolean);
}
// 详情 JSON → `{ title, windows:[{ label, startTs, endTs, raw, display }] }`。
// **没有 body_html（`{}` / 空串 / 改版页）⇒ 抛**；正文正常但没有整行区间 ⇒ `windows: []`（不抛）。
function ns_pcr_jp_detailOf(json, tz = ns_pcr_JP_TZ) {
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("pcr-jp-detail-changed:bad-json");
	const body = json.body_html;
	if (typeof body !== "string" || body.trim() === "") throw new Error("pcr-jp-detail-changed:no-body");
	const lines = ns_pcr_jp_linesOf(body);
	if (lines.length === 0) throw new Error("pcr-jp-detail-changed:no-lines");
	const windows = [];
	const seen = new Set();
	for (let i = 0; i < lines.length; i++) {
		const w = ns_pcr_jp_windowOf(lines[i], tz);
		if (!w) continue;
		const label = ns_pcr_jp_labelOf(lines, i);
		const key = `${w.startTs}|${w.endTs}|${label}`;
		if (seen.has(key)) continue;
		seen.add(key);
		windows.push({ label, startTs: w.startTs, endTs: w.endTs, raw: w.raw, display: w.display });
	}
	return { title: String(json.title == null ? "" : json.title).trim(), windows };
}
// 一整行 → 窗口；不是"整行恰为区间"⇒ null（行内日期 / 前瞻句都落这里）
function ns_pcr_jp_windowOf(line, tz) {
	const raw = String(line == null ? "" : line).trim();
	const m = ns_pcr_JP_RANGE_RE.exec(raw);
	if (!m) return null;
	const y1 = +m[1], mo1 = +m[2], d1 = +m[3], h1 = +m[4], mi1 = +m[5];
	let y2 = m[6] == null ? y1 : +m[6];
	const mo2 = +m[7], d2 = +m[8], h2 = +m[9], mi2 = +m[10];
	if (mo1 < 1 || mo1 > 12 || d1 < 1 || d1 > 31 || h1 > 23 || mi1 > 59) return null;
	if (mo2 < 1 || mo2 > 12 || d2 < 1 || d2 > 31 || h2 > 23 || mi2 > 59) return null;
	// 结束年没写且终点月日排在起点前面 ⇒ 跨年（实测没出现，出现时用共用判定，不自己写一套）
	if (m[6] == null && endsNextYear(mo1, d1, mo2, d2)) y2 = y1 + 1;
	const startTs = sourceInstant(y1, mo1, d1, h1, mi1, tz);
	const endTs = sourceInstant(y2, mo2, d2, h2, mi2, tz);
	if (endTs == null || startTs == null || !(endTs > startTs)) return null;   // 源站错行 ⇒ 丢掉，不硬造
	return { startTs, endTs, raw, display: fmtWindow(startTs, endTs, tz) };
}
// 区间行的名字：往上最多 3 行找 `■…`，剥掉尾缀；找不到 / 剥完是空（`■開催期間`）⇒ 空串
function ns_pcr_jp_labelOf(lines, at) {
	for (let j = at - 1; j >= 0 && j >= at - 3; j--) {
		const m = ns_pcr_JP_LABEL_RE.exec(lines[j]);
		if (!m) continue;
		return m[1].replace(ns_pcr_JP_LABEL_TAIL_RE, "").replace(/\s+/g, " ").trim();
	}
	return "";
}
// 卡池名：正文锚点拿不到时，从标题里取 `ピックアップガチャ` / `プリンセスフェスガチャ`
function ns_pcr_jp_poolNameOf(title) {
	const m = /((?:プリンセス)?フェスガチャ|ピックアップガチャ)/.exec(String(title == null ? "" : title));
	return m ? m[1] : "";
}
// 卡池角色：标题里 `…キャラ「X」` 的 X（`期間限定キャラ「ラッキーライラック」`）
function ns_pcr_jp_rolesOf(title) {
	const m = /キャラ(?:クター)?「([^「」]{1,40})」/.exec(String(title == null ? "" : title));
	return m ? m[1].trim() : "";
}
// 活动名：标题里 `「…」` 包住的就留里面；没有引号才剥尾巴（`バトルスタジアム開催中！` ⇒ `バトルスタジアム`）
function ns_pcr_jp_eventNameOf(title) {
	const t = String(title == null ? "" : title).trim();
	const q = ns_pcr_JP_QUOTED_RE.exec(t);
	if (q) return q[1].trim();
	let s = t;
	for (let i = 0; i < 3; i++) {
		const n = s.replace(ns_pcr_JP_EVENT_TAIL_RE, "").trim();
		if (n === s) break;
		s = n;
	}
	return s || t;
}
// 详情 → 卡池条目事实（每个整行区间一口池；没有窗口 ⇒ 空数组）
function ns_pcr_jp_poolItemsOf(detail) {
	const d = detail && typeof detail === "object" ? detail : {};
	const title = String(d.title || "");
	const fallback = ns_pcr_jp_poolNameOf(title);
	const roles = ns_pcr_jp_rolesOf(title);
	const items = [];
	for (const w of Array.isArray(d.windows) ? d.windows : []) {
		const banner = w.label || fallback;
		if (!banner) continue;                       // 池名都拿不到 ⇒ 这一条不产出（不留空池名）
		items.push({
			_i: items.length,
			banner,
			roles,
			startTs: w.startTs,
			endTs: w.endTs,
			raw: w.raw,
			display: w.display,
			isMain: true
		});
	}
	return items;
}
// 详情 → 活动条目事实（活动名取标题派生名；`■開催期間` 这种通用锚点不是活动名）
function ns_pcr_jp_eventItemsOf(detail) {
	const d = detail && typeof detail === "object" ? detail : {};
	const name = ns_pcr_jp_eventNameOf(String(d.title || ""));
	const items = [];
	for (const w of Array.isArray(d.windows) ? d.windows : []) {
		items.push({
			_i: items.length,
			event: name || "活动",
			category: "",
			startTs: w.startTs,
			endTs: w.endTs,
			raw: w.raw,
			display: w.display
		});
	}
	return items;
}
//#endregion

//#region ④ 抓取器（契约：async (url, signal, tz, now = nowMs()) → 数据对象 | null）
let ns_pcr_jp_listCache = null;              // { url, round, at, promise }
let ns_pcr_jp_detailCache = new Map();       // id → { at, value:{ title, windows }, sealed }
function ns_pcr_jp_resetCache() { ns_pcr_jp_listCache = null; ns_pcr_jp_detailCache = new Map(); }
// 详情地址（按 id）
function ns_pcr_jp_detailUrlOf(id) { return ns_pcr_JP_DETAIL_BASE + String(id == null ? "" : id); }
// 缓存是否可用：TTL 内，或**已结束**（窗口全部 endTs<=抓取时刻）⇒ 永久有效（"已结束不再取"）
function ns_pcr_jp_cacheValidOf(entry, now) {
	if (!entry || !entry.value) return false;
	if (entry.sealed) return true;
	return now - entry.at < ns_pcr_JP_CACHE_TTL_MS;
}
// 这篇是不是"已结束"（有窗口且全部在 at 之前收）⇒ 封存，后续轮次不再取
function ns_pcr_jp_cacheSealedOf(detail, at) {
	const ws = detail && Array.isArray(detail.windows) ? detail.windows : [];
	return ws.length > 0 && ws.every((w) => w.endTs <= at);
}
// 列表：一轮刷新里两侧共用同一次请求（轮外 / 设置页「测试来源」一律现取）
async function ns_pcr_jp_rowsOf(url, signal) {
	const key = String(url == null ? "" : url).trim() || ns_pcr_JP_LIST_URL;
	const at = nowMs();
	const round = fetchRoundSeqOf();
	const hit = ns_pcr_jp_listCache;
	let promise;
	if (fetchRoundActive() && hit && hit.url === key && hit.round === round && at - hit.at < ns_pcr_JP_ROUND_TTL_MS) {
		promise = hit.promise;
	} else {
		promise = fetchJson(key, { mode: "direct", signal, headers: { "X-MICROCMS-API-KEY": ns_pcr_JP_API_KEY } })
			.then((json) => ns_pcr_jp_listOf(json));
		ns_pcr_jp_listCache = { url: key, round, at, promise };
		promise.catch(() => { if (ns_pcr_jp_listCache && ns_pcr_jp_listCache.promise === promise) ns_pcr_jp_listCache = null; });
	}
	return promise;
}
// 单篇详情：按 id 缓存（TTL 24h；已结束的永久有效）。结构变了就抛（不吞成"没有窗口"）
async function ns_pcr_jp_detailOfId(id, signal, tz, now) {
	const hit = ns_pcr_jp_detailCache.get(id);
	if (hit && !hit.sealed) hit.sealed = ns_pcr_jp_cacheSealedOf(hit.value, now);   // 到期前已结束 ⇒ 当场封存
	if (ns_pcr_jp_cacheValidOf(hit, now)) return hit.value;
	const json = await fetchJson(ns_pcr_jp_detailUrlOf(id), {
		mode: "direct",
		signal,
		headers: { "X-MICROCMS-API-KEY": ns_pcr_JP_API_KEY }
	});
	const value = ns_pcr_jp_detailOf(json, tz);
	const entry = { at: now, value, sealed: ns_pcr_jp_cacheSealedOf(value, now) };
	ns_pcr_jp_detailCache.set(id, entry);
	return value;
}
// 一侧的条目：按 kind 筛 → 最多 4 篇详情 → 条目事实；**命中当期窗口就停**（省后面的详情请求）。
// 详情全部失败且一条都没解析出来 ⇒ 抛（抓取失败 ≠ 未公布）。
async function ns_pcr_jp_itemsOf(url, signal, tz, now, side) {
	const rows = await ns_pcr_jp_rowsOf(url, signal);
	const want = side === "pools" ? "gacha" : "event";
	const cand = rows.filter((r) => r.kind === want).slice(0, ns_pcr_JP_MAX_DETAILS);
	const out = [];
	let firstErr = null, parsed = 0;
	for (const row of cand) {
		let detail;
		try {
			detail = await ns_pcr_jp_detailOfId(row.id, signal, tz, now);
			parsed++;
		} catch (e) {
			if (!firstErr) firstErr = e;
			continue;                              // 单篇失败不整体崩；全失败才抛（见下）
		}
		for (const it of side === "pools" ? ns_pcr_jp_poolItemsOf(detail) : ns_pcr_jp_eventItemsOf(detail)) {
			out.push(Object.assign({}, it, { _i: out.length }));
		}
		if (out.some((it) => coversNow(it, now))) break;   // 当期窗口到手 ⇒ 后面的更早公告不用再抓
	}
	if (parsed === 0 && firstErr) throw firstErr;      // 详情全失败 ⇒ 抛
	return out;
}
// 卡池侧：同批（同结束时刻）合并角色 —— 换池通常整批换（轮换池一期同收）
async function ns_pcr_jp_gacha(url, signal, tz = ns_pcr_JP_TZ, now = nowMs()) {
	const items = await ns_pcr_jp_itemsOf(url, signal, tz, now, "pools");
	if (items.length === 0) return null;              // 没有带窗口的本命池 ⇒ 未公布（不是失败）
	return ns_bwiki_batchGachaPayloadOf(items, tz, now, { id: "pcr-jp" });
}
// 活动侧：覆盖 now 的活动 → 共用活动载荷
async function ns_pcr_jp_events(url, signal, tz = ns_pcr_JP_TZ, now = nowMs()) {
	const items = await ns_pcr_jp_itemsOf(url, signal, tz, now, "events");
	if (items.length === 0) return null;
	return ns_bwiki_eventPayload(items, tz, now, 0, "pcr-jp");
}
//#endregion

//#region ⑤ 条目登记
// 卡池与活动**同一条列表**（`eventUrl` 与 `url` 相同）⇒ 两侧标签逐字「官网公告（日文）」。
registerSource({
	id: "pcr-jp",
	defaultHidden: false,
	tz: ns_pcr_JP_TZ,
	name: "公主连结Re:Dive·日服",
	icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/6c/ce/1a/6cce1a8b-f385-0410-f799-072435e5707c/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
	url: ns_pcr_JP_LIST_URL,
	source: ns_pcr_JP_SOURCE_LABEL,
	eventUrl: ns_pcr_JP_LIST_URL,
	eventSource: ns_pcr_JP_SOURCE_LABEL
});
GACHA_FETCHERS["pcr-jp"] = (url, signal, tz, now) => ns_pcr_jp_gacha(url, signal, tz, now);
EVENT_FETCHERS["pcr-jp"] = Object.assign(EVENT_FETCHERS["pcr-jp"] || {}, {
	default: (url, signal, tz, now) => ns_pcr_jp_events(url, signal, tz, now)
});
//#endregion


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-pcr-tw.js：公主连结·繁中服（pcr-tw，So-net 官网公告）
// ─────────────────────────────────────────────────────────────────────────────

//
// ── 落点 ────────────────────────────────────────────────────────────────────────
// 厂商级文件（`30-game-*` 家族，不是 bwiki 系）：唯一来源 `id:"pcr-tw"`，
// 卡池侧与活动侧**共用一份公告列表**，标签逐字「官网公告」。
//
// ── ① 站点形态（2026-11-15 实测；夹具 test/fixtures/pcr-tw-list / -list-2 / -list-3 / detail-{4106,4117,4115}）──
//   列表 `GET https://www.princessconnect.so-net.tw/news?page=1`（翻页 = `?page=2` / `?page=3`）
//     200 / 58,895 B / `content-type: text/html; charset=UTF-8` / **服务端渲染**（无 JS）
//     ⚠️ 响应**没有 `Access-Control-Allow-Origin`**（带 `Origin: dsh-app://dsh` 再测也是空）
//        ⇒ 浏览器直连必被 CORS 拦，**必须走宿主代理**（域名已登记 `src/index.js` 的 `PROXY_ALLOW_HOSTS`）。
//     一页 10 条，源站**已按日期倒序**；`page=1..5` 都实测 200 且结构逐字相同（本条按页前进，上限见 ③）。
//     条目 = `<li>` 三件套：`<time datetime="YYYY.MM.DD">` + `<span class="ac0X">類型</span>` +
//            `<a href="/news/newsDetail/{id}">標題</a>`（整页只有 10 个 newsDetail 链接，全在 `<article class="news_con">` 里）。
//     ⚠️ 页面是**日期倒序、同日按发布先后（id 升序）**：2026-11-15 19:16 实测第 1 页
//        = `4118,4119,4120,4121,4122,4123`（都 11-15，id 升序）+ `4116,4117`（11-14）+ `4115`（11-13）+ `4125`（11-11）；
//        第 2 页 = `4111`（11-09）… `4106,4107,4108,4109,4105`（都 11-03，id 升序）。
//        ⚠️ 所以**越新的公告越可能只是「舉辦預告」**（窗口还没开）：11-15 那批 4119/4120/4121
//        全是 11-16 才开的卡池预告，当期的《精選轉蛋》（4106，11-04~11-16）已经被挤到第 2 页。
//     ⚠️ `ac0X` 的类名**不是**类别：`ac01` 同时出现在「活動」和「轉蛋」上（4106 是【轉蛋】、label 却写「活動」）
//        ⇒ 类别**只认标题前缀**（见 ②），`span` 里的字只当参考、不参与分流。
//   详情 `GET https://www.princessconnect.so-net.tw/news/newsDetail/{id}`（同样无 ACAO ⇒ 代理）
//     200 / 58~63 KB / 整页里真正要的只有 `<section class="news_con">`：
//       `<p class="news_meta">`（日期 + 类别）→ `<h2>标题</h2>` → `<div class="news-body">正文</div>`。
//     正文是**每段一个 `<p>` + `<br />` 换行**（不是 Word 富文本那种一字一 `<span>`），
//     所以「一行一句」的切法稳定：`<br>` / `</p>` 当行边界，其余标签不插分隔符。
//   档期写法（实测 9 篇，逐篇一致）：
//     `■精選轉蛋舉辦期間` ⏎ `2026/11/04 16:00 ～ 2026/11/16 15:59`
//     **整行只有一个日期区间**（两端都带 4 位年 + 时分），前面紧邻一行 `■…期間` 就是它的名字。
//     实测的四种 `■` 标签：`精選轉蛋舉辦期間` / `第10次精選角色出現率3倍轉蛋舉辦期間` /
//     `公主祭典轉蛋舉辦期間` / `附贈大師碎片的★3必中白金轉蛋舉辦期間` / `舉辦期間` / `活動期間` / `販售期間`。
//     ⇒ 名字取 `■` 那行去掉尾缀（`舉辦期間`/`活動期間`/`販售期間`/`期間`）；`舉辦|活動|販售` 这种
//        **通用词**（名字剥完是空）就退回标题派生名（见 `ns_pcr_tw_titleNameOf`）。
//     ⚠️ 只在**整行恰为区间**时认窗口：`4. 2026/11/0415:59以前停留在轉蛋頁面…` 这种行内日期、
//        `預計自2026/11/24 05:00起…` 这种前瞻句都**不是**档期（实测 4106 里两种都有）。
//
// ── ② 卡池 / 活动怎么分（只认标题前缀）────────────────────────────────────────────
//   `【轉蛋】…` ⇒ 卡池；`【活動】…` ⇒ 活动；其余（`【更新】` / `【公告】` / `【優惠】` / `《外掛停權》`）
//   ⇒ 两侧都不要（更新公告里没有档期，礼包/停权不是"卡池或活动"）。
//   ⚠️ **不要再假设"当期本命池一定在第 1 页"**（2026-11-15 19:16 实测已被推翻）：公告一多，
//      当期池/活动会被当天新发的「舉辦預告」挤到第 2 页甚至更后面 ⇒ 必须按页前进（见 ③）。
//      翻页后**页内也按"公告日期从早到晚"取候选**（同一页里越早发的越可能已经开期；
//      同日多条按站点原序 = 发布先后）—— 这是把"被新预告挤到页尾的当期公告"重新纳入 2 篇预算的办法。
//
// ── ③ 请求预算（用户口径：按页前进 + N 条详情，详情按 id 缓存 TTL 24h）──────────────────
//   每侧：page 1 → 解析不出「覆盖 now 的窗口」→ page 2 → page 3（上限 `ns_pcr_TW_MAX_LIST_PAGES` = 3），
//        某页能产出有效载荷就停；三页都没有 ⇒ `null`（nomatch，不抛）。
//   · 每侧每页最多 2 篇详情（`ns_pcr_TW_MAX_DETAILS`），候选 = 该页该侧按 (公告日期升序, 站点原序) 的前 2 条；
//   · **列表按 (url, page) 缓存到本轮刷新**（`fetchRoundSeqOf` + 轮内 Promise，`ns_pcr_tw_listCache` 是 Map）
//     —— 两侧共用同一页的列表请求；轮外（设置页「测试来源」/ 离线用例直调）一律现取；
//   · 详情按 id 缓存 24h（跨轮、跨页共用；某页没命中而被翻过去的详情也算白拿到的结论，不重复取）。
//   ⇒ 稳态（page 1 就能出）= 列表 1 次；page 1 miss 才多花 1~2 次列表请求（2026-11-15 19:16 实测：
//      page 1 miss 卡池 → page 2 命中 ⇒ 列表 2 次 + 详情 6 次 = 8 次，见 ⑤）。
//   ⚠️ 每侧 2 篇/页够不够：**单看一页的最新 2 篇是不够的**（11-15 那批全是 11-16 才开的预告）；
//      页内从早到晚取 + 按页前进，才能在第 2 页把 4106《精選轉蛋》与 4107（同批、同窗口）一起取到。
//
// ── ④ 失败语义（与全仓一致）──────────────────────────────────────────────────────
//   · HTTP 非 2xx ⇒ 抛（`fetchText` 自己抛 `http-…`）；
//   · 列表结构变了（**任一所取页**找不到 `<article class="news_con">` / 一条 `<li>` 都解析不出）⇒ **抛**；
//   · 详情结构变了（没有 `<h2>` / 没有 `news-body`；`{}` / 空串 / 改版页都落这里）⇒ **抛**；
//   · 正文正常但**没有任何整行区间**（`～` 被抹掉）⇒ 不抛，这一篇就是"没有窗口"（不进外显）；
//   · 某页的候选详情全部失败且一条都没解析出来 ⇒ 抛第一篇的错（抓取失败 ≠ 未公布）；
//   · 解出来了但没有窗口覆盖 now ⇒ **继续下一页**；全部页都没有 ⇒ `null`（未公布，不硬凑过期档期）。
//
// ── ⑤ 当期现状（2026-11-15 19:16 实测，page 1 已不含当期池）────────────────────────
//   at 2026-11-15 19:16 +08：
//   卡池 = `精選轉蛋`（`露易絲瑪莉（夏日）`）11-04 16:00 ~ 11-16 15:59 在期 —— 公告 4106 在 **page 2**
//     （page 2 的候选按 (日期, 站点原序) = 4106, 4107，正好把同批同窗口的两条都拿到；
//      page 1 的 4119/4120 是 11-16 才开的预告 ⇒ page 1 卡池如实 miss）；
//   活动 = `「NORMAL」裝備道具、星素掉落量3倍・瑪那掉落量2倍` 11-15 05:00 ~ 11-21 04:59 在期 ——
//     公告 4115 仍在 page 1，但它是 page 1 里**按 id 倒序的第 4 条活动**（上面压着 4123/4118/4117 三条新预告），
//     页内按日期从早到晚取候选后它是**第 1 篇候选**、当场命中（若按"最新 2 篇"取，会被三条预告挤掉
//     ⇒ 这就是旧实现活动侧也 nomatch 的真因，**不是**分页）；
//   另：`官方 WebStore限定 每月主題禮包「究極鍊成」` 11-15 16:00 已开期 ⇒ 同批候选里也在期，
//     events[] 会如实有 2 条（外显取结束最早的那条 = NORMAL）。
//   时区 = `Asia/Taipei`（源站是繁中服官网，墙钟就是 UTC+8；与 UTC 的换算由 `sourceInstant` 负责）。

//#region ① 常量
const ns_pcr_TW_TZ = "Asia/Taipei";
const ns_pcr_TW_HOME = "https://www.princessconnect.so-net.tw/";
const ns_pcr_TW_LIST_URL = "https://www.princessconnect.so-net.tw/news?page=1";
const ns_pcr_TW_DETAIL_BASE = "https://www.princessconnect.so-net.tw/news/newsDetail/";
const ns_pcr_TW_SOURCE_LABEL = "官网公告";
// 每侧最多取几篇详情（见文件头 ③）
const ns_pcr_TW_MAX_DETAILS = 2;
// 列表最多翻到第几页（见文件头 ③：1 → 2 → 3 顺序前进，某页命中即停）
const ns_pcr_TW_MAX_LIST_PAGES = 3;
// 详情正文解析结果缓存 TTL = 24h（用户口径；按 id 缓存，换池不会串）
const ns_pcr_TW_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 轮内列表复用兜底上限（同 hl / cytq 的 30s）
const ns_pcr_TW_ROUND_TTL_MS = 30000;
// 列表段（导航里没有 newsDetail 链接，但收窄到 article 更稳，也让静态守卫能定位）
const ns_pcr_TW_ARTICLE_OPEN = '<article class="news_con"';
const ns_pcr_TW_ARTICLE_CLOSE = "</article>";
// 详情段：**必须收窄到这一段**（理由见 `ns_pcr_tw_sectionOf`）
const ns_pcr_TW_SECTION_OPEN = '<section class="news_con">';
const ns_pcr_TW_SECTION_CLOSE = "</section>";
// 条目：`<time datetime="…">` + 类别 span + 详情链接 + 标题（四组：日期 / 类别字 / id / 标题）
const ns_pcr_TW_ITEM_RE = /<time\b[^>]*\bdatetime="([^"]+)"[^>]*>[\s\S]*?<\/time>\s*<span\b[^>]*>([\s\S]*?)<\/span>\s*<a\b[^>]*href="\/news\/newsDetail\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
// 详情正文里"一整行恰为一个日期区间"（两端都带 4 位年 + 时分）——见文件头 ①
const ns_pcr_TW_RANGE_RE = /^(\d{4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})\s+(\d{1,2})\s*[:：]\s*(\d{2})\s*[~～]\s*(\d{4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})\s+(\d{1,2})\s*[:：]\s*(\d{2})$/;
// 档期的名字行（`■精選轉蛋舉辦期間`）
const ns_pcr_TW_LABEL_RE = /^■\s*(.{1,40}?)\s*$/;
// 名字行尾缀：剥掉这些词，剩下的才是"这个档期叫什么"
const ns_pcr_TW_LABEL_TAIL_RE = /(?:舉辦|活動|販售)?期間$/;
// 标题前缀 = 类别（见文件头 ②）
const ns_pcr_TW_GACHA_RE = /^【\s*轉蛋\s*】/;
const ns_pcr_TW_EVENT_RE = /^【\s*活動\s*】/;
// 标题派生名要剥掉的尾巴（`…舉辦預告！` / `…期間限定方式販售預告！`）
const ns_pcr_TW_TITLE_TAIL_RE = /(?:期間限定)?(?:方式)?(?:販售|舉辦|登場|開始|推出|復刻)?(?:預告|中)?[！!。\s]*$/;
// 卡池角色从标题里的「…」取；这些词说明那对引号里是**池名**不是角色
const ns_pcr_TW_POOL_WORD_RE = /轉蛋|扭蛋|招募|卡池|精選/;
//#endregion

//#region ② 纯解析：列表
// 列表页 → `[{ id, date, type, title, kind, dateTs, src }]`，按日期倒序（源站本来倒序，这里再稳一次）。
// **结构变了要抛**：找不到 `<article>`、或一条都解析不出（`{}` / 改版页 / 空串都落这里）。
// `src` = 该条在**站点原始顺序**里的下标（日期倒序、同日按发布先后）——只给候选排序用（见 ③），
// 不参与外显；排序本身不动（同日仍按 id 倒序，历史用例钉着）。
function ns_pcr_tw_listOf(html) {
	const src = String(html == null ? "" : html);
	const a = src.indexOf(ns_pcr_TW_ARTICLE_OPEN);
	const b = a >= 0 ? src.indexOf(ns_pcr_TW_ARTICLE_CLOSE, a) : -1;
	if (a < 0 || b < 0) throw new Error("pcr-tw-list-changed:no-article");
	const seg = src.slice(a, b);
	const out = [];
	ns_pcr_TW_ITEM_RE.lastIndex = 0;
	let m;
	while ((m = ns_pcr_TW_ITEM_RE.exec(seg)) !== null) {
		const title = decodeExtra(stripTags(m[4])).replace(/\s+/g, " ").trim();
		const date = String(m[1] || "").trim();
		out.push({
			src: out.length,
			id: String(m[3]),
			date,
			type: decodeExtra(stripTags(m[2])).replace(/\s+/g, " ").trim(),
			title,
			kind: ns_pcr_tw_kindOf(title),
			dateTs: ns_pcr_tw_dateTsOf(date)
		});
	}
	if (out.length === 0) throw new Error("pcr-tw-list-changed:no-item");
	return out.sort((x, y) => ((y.dateTs || 0) - (x.dateTs || 0)) || (Number(y.id) - Number(x.id)));
}
// 标题前缀 → 哪一侧（见文件头 ②）
function ns_pcr_tw_kindOf(title) {
	const t = String(title == null ? "" : title);
	if (ns_pcr_TW_GACHA_RE.test(t)) return "gacha";
	if (ns_pcr_TW_EVENT_RE.test(t)) return "event";
	return "other";
}
// `2026.11.14`（列表上的日期）→ 该日 00:00 的绝对毫秒（只用于排序，不做窗口语义）
function ns_pcr_tw_dateTsOf(s) {
	const m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})/.exec(String(s == null ? "" : s));
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], 0, 0, ns_pcr_TW_TZ);
}
// 列表地址 + 页号 → 该页地址（page 1 **原样返回**：注册表里的 URL 就是 page=1，历史行为/请求数不变）。
function ns_pcr_tw_pageUrlOf(url, page) {
	const base = String(url == null ? "" : url).trim() || ns_pcr_TW_LIST_URL;
	const n = Math.floor(Number(page) || 1);
	if (!(n > 1)) return base;
	try {
		const u = new URL(base);
		u.searchParams.set("page", String(n));
		return u.toString();
	} catch {
		return base + (base.includes("?") ? "&" : "?") + "page=" + n;
	}
}
// 一页里某一侧的候选：按 **(公告日期升序, 站点原序)** 取前 `ns_pcr_TW_MAX_DETAILS` 条（见文件头 ③）。
// 为什么不是"取最新 2 条"：列表是日期倒序，新公告多数只是「舉辦預告」（窗口还没开）；
// 同一页里越早发布的越可能已经开期。同日多条按站点原序（= 发布先后）—— 同批卡池里
// 主池公告（page2 的 4106《精選轉蛋》）就排在 4107/4108 之前，重排成 id 倒序会把它挤出预算。
function ns_pcr_tw_candidatesOf(rows, want) {
	return (Array.isArray(rows) ? rows : [])
		.filter((r) => r && r.kind === want)
		.sort((a, b) => ((a.dateTs || 0) - (b.dateTs || 0)) || ((a.src || 0) - (b.src || 0)))
		.slice(0, ns_pcr_TW_MAX_DETAILS);
}
//#endregion

//#region ③ 纯解析：详情（正文行 → 整行区间 → 条目事实）
// 详情页 → 只留内容块 `<section class="news_con"> … </section>`（拿不到 ⇒ null）。
// ⚠️ **必须收窄**：整页里还有**别的 `<h2>`** —— 导航折叠面板在正文之前就有
//    `<h2 class="accordion-header" id="flush-heading0">…熱門遊戲…</h2>`（2026-11-15 实测 4115）。
//    在整页上找"第一个 `<h2>`"会拿到导航标题（第一次活网跑出来 event = "熱門遊戲" 就是这个坑）。
//    夹具 `pcr-tw-detail-4115` 因此**刻意保留整页未裁**，专门钉住这一点。
function ns_pcr_tw_sectionOf(html) {
	const src = String(html == null ? "" : html);
	const a = src.indexOf(ns_pcr_TW_SECTION_OPEN);
	if (a < 0) return null;
	const b = src.indexOf(ns_pcr_TW_SECTION_CLOSE, a);
	return b > a ? src.slice(a, b + ns_pcr_TW_SECTION_CLOSE.length) : src.slice(a);
}
// 内容块 → 行数组。`<br>` / `</p>` / 块级收尾都当行边界，
// **其余标签不插分隔符**（实体再解一遍：`&times;` 等）。没有正文区 ⇒ null（结构变了，调用方抛）。
function ns_pcr_tw_linesOf(section) {
	const src = String(section == null ? "" : section);
	const s = src.indexOf('<div class="news-body"');
	if (s < 0) return null;                       // 没有正文区 = 结构变了，交给调用方抛
	const e = src.indexOf(ns_pcr_TW_SECTION_CLOSE, s);
	const body = e > s ? src.slice(s, e) : src.slice(s);
	return body
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(?:p|div|h[1-6]|li|tr|table|section)>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.split("\n")
		.map((x) => decodeExtra(x).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim())
		.filter(Boolean);
}
// 详情页 → `{ title, windows:[{ label, startTs, endTs, raw, display }] }`。
// **没有内容块 / 没有 `<h2>` / 没有 `news-body` ⇒ 抛**（`{}` / 空串 / 改版页）；
// 有正文但没有整行区间 ⇒ `windows: []`。
function ns_pcr_tw_detailOf(html, tz = ns_pcr_TW_TZ) {
	const sec = ns_pcr_tw_sectionOf(html);
	if (sec == null) throw new Error("pcr-tw-detail-changed:no-section");
	const h = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(sec);
	if (!h) throw new Error("pcr-tw-detail-changed:no-title");
	const lines = ns_pcr_tw_linesOf(sec);
	if (lines == null) throw new Error("pcr-tw-detail-changed:no-body");
	const title = decodeExtra(stripTags(h[1])).replace(/\s+/g, " ").trim();
	const windows = [];
	const seen = new Set();
	for (let i = 0; i < lines.length; i++) {
		const m = ns_pcr_TW_RANGE_RE.exec(lines[i]);
		if (!m) continue;
		const startTs = sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
		const endTs = sourceInstant(+m[6], +m[7], +m[8], +m[9], +m[10], tz);
		if (endTs == null || startTs == null || !(endTs > startTs)) continue;   // 源站错行 ⇒ 丢掉，不硬造
		const label = ns_pcr_tw_labelOf(lines, i);
		const raw = `${m[1]}/${String(m[2]).padStart(2, "0")}/${String(m[3]).padStart(2, "0")} ${String(m[4]).padStart(2, "0")}:${m[5]}`
			+ ` ~ ${m[6]}/${String(m[7]).padStart(2, "0")}/${String(m[8]).padStart(2, "0")} ${String(m[9]).padStart(2, "0")}:${m[10]}`;
		const key = `${startTs}|${endTs}|${label}`;
		if (seen.has(key)) continue;
		seen.add(key);
		windows.push({ label, startTs, endTs, raw, display: fmtWindow(startTs, endTs, tz) });
	}
	return { title, windows };
}
// 区间行的名字：往上最多 3 行找 `■…`，剥掉尾缀；找不到 / 剥完是通用词 ⇒ 空串（交给标题派生）
function ns_pcr_tw_labelOf(lines, at) {
	for (let j = at - 1; j >= 0 && j >= at - 3; j--) {
		const m = ns_pcr_TW_LABEL_RE.exec(lines[j]);
		if (!m) continue;
		const name = m[1].replace(ns_pcr_TW_LABEL_TAIL_RE, "").replace(/\s+/g, " ").trim();
		return /^(?:舉辦|活動|販售)?$/.test(name) ? "" : name;
	}
	return "";
}
// 标题 → 可读名：剥 `【…】` 前缀 + 尾巴（`舉辦預告！` / `期間限定方式販售預告！`），
// 整名被一对「」包住就留里面的（`「艾爾皮斯討魔戰線」舉辦預告！` ⇒ `艾爾皮斯討魔戰線`）。
function ns_pcr_tw_titleNameOf(title) {
	let s = String(title == null ? "" : title).replace(/^【[^】]{1,8}】\s*/, "").replace(/\s+/g, " ").trim();
	for (let i = 0; i < 3; i++) {
		const t = s.replace(ns_pcr_TW_TITLE_TAIL_RE, "").trim();
		if (t === s) break;
		s = t;
	}
	const q = /^「([^」]{1,60})」$/.exec(s);
	if (q) s = q[1].trim();
	return s || String(title == null ? "" : title).trim();
}
// 卡池角色：标题里的「…」；含 `轉蛋/精選` 类的引号是**池名**不是角色（4107 / 4101 实测）
function ns_pcr_tw_rolesOf(title, banner) {
	const out = [], seen = new Set();
	for (const m of String(title == null ? "" : title).matchAll(/「([^「」]{1,32})」/g)) {
		const name = m[1].replace(/\s+/g, " ").trim();
		if (!name || name === banner || ns_pcr_TW_POOL_WORD_RE.test(name) || seen.has(name)) continue;
		seen.add(name);
		out.push(name);
	}
	return out.join("、");
}
// 详情 → 卡池条目事实（每个区间一口池；没有窗口 ⇒ 空数组）
function ns_pcr_tw_poolItemsOf(detail) {
	const d = detail && typeof detail === "object" ? detail : {};
	const title = String(d.title || "");
	const titleName = ns_pcr_tw_titleNameOf(title);
	const items = [];
	for (const w of Array.isArray(d.windows) ? d.windows : []) {
		const banner = w.label || titleName;
		items.push({
			_i: items.length,
			banner,
			roles: ns_pcr_tw_rolesOf(title, banner),
			startTs: w.startTs,
			endTs: w.endTs,
			raw: w.raw,
			display: w.display,
			isMain: true
		});
	}
	return items;
}
// 详情 → 活动条目事实（活动名取**标题派生名**；`■舉辦期間` 那种通用标签不是活动名）
function ns_pcr_tw_eventItemsOf(detail) {
	const d = detail && typeof detail === "object" ? detail : {};
	const name = ns_pcr_tw_titleNameOf(String(d.title || ""));
	const items = [];
	for (const w of Array.isArray(d.windows) ? d.windows : []) {
		items.push({
			_i: items.length,
			event: name,
			category: "",
			startTs: w.startTs,
			endTs: w.endTs,
			raw: w.raw,
			display: w.display
		});
	}
	return items;
}
//#endregion

//#region ④ 抓取器（契约：async (url, signal, tz, now = nowMs()) → 数据对象 | null）
// 列表缓存：**按页**存（`${page}\u0000${url}`），值 = { url, page, round, at, promise }。
// 只在一轮刷新内复用（round 一致 + 30s 兜底）；轮外/跨轮一律现取。两侧共用同一页的请求 ⇒ 同时翻到
// 第 2 页也只发一次（promise 先入 Map 再 await，后到的调用方拿同一个 promise）。
let ns_pcr_tw_listCache = new Map();
let ns_pcr_tw_detailCache = new Map();       // id → { at, value:{ title, windows } }
function ns_pcr_tw_resetCache() { ns_pcr_tw_listCache = new Map(); ns_pcr_tw_detailCache = new Map(); }
// 列表第 page 页：一轮刷新里两侧共用同一次请求（轮外 / 设置页「测试来源」一律现取）
async function ns_pcr_tw_rowsOf(url, page, signal) {
	const key = String(url == null ? "" : url).trim() || ns_pcr_TW_LIST_URL;
	const n = Math.max(1, Math.floor(Number(page) || 1));
	const at = nowMs();
	const round = fetchRoundSeqOf();
	const mapKey = n + "\u0000" + key;
	const hit = ns_pcr_tw_listCache.get(mapKey);
	let promise;
	if (fetchRoundActive() && hit && hit.url === key && hit.page === n && hit.round === round && at - hit.at < ns_pcr_TW_ROUND_TTL_MS) {
		promise = hit.promise;
	} else {
		promise = fetchText(ns_pcr_tw_pageUrlOf(key, n), { mode: "proxy", referer: ns_pcr_TW_HOME, signal })
			.then((html) => ns_pcr_tw_listOf(html));
		ns_pcr_tw_listCache.set(mapKey, { url: key, page: n, round, at, promise });
		promise.catch(() => {
			const cur = ns_pcr_tw_listCache.get(mapKey);
			if (cur && cur.promise === promise) ns_pcr_tw_listCache.delete(mapKey);
		});
	}
	return promise;
}
// 一页里的候选（≤2 篇）→ 条目事实。详情按 id 缓存 24h（跨轮 / 跨页共用）。
// 这一页的候选详情**全部失败且一条都没解析出来** ⇒ 抛第一篇的错（抓取失败 ≠ 未公布）。
async function ns_pcr_tw_itemsOnPage(cand, signal, tz, now, side) {
	const out = [];
	let firstErr = null, got = 0, failed = 0;
	for (const row of cand) {
		const hit = ns_pcr_tw_detailCache.get(row.id);
		let detail;
		if (hit && now - hit.at < ns_pcr_TW_CACHE_TTL_MS) {
			detail = hit.value;
			got++;
		} else {
			try {
				const html = await fetchText(ns_pcr_TW_DETAIL_BASE + row.id, { mode: "proxy", referer: ns_pcr_TW_HOME, signal });
				detail = ns_pcr_tw_detailOf(html, tz);
				ns_pcr_tw_detailCache.set(row.id, { at: now, value: detail });
				got++;
			} catch (e) {
				if (!firstErr) firstErr = e;
				failed++;
				continue;                              // 单篇失败不整体崩；全失败才抛（见下）
			}
		}
		for (const it of side === "pools" ? ns_pcr_tw_poolItemsOf(detail) : ns_pcr_tw_eventItemsOf(detail)) {
			out.push(Object.assign({}, it, { _i: out.length }));
		}
	}
	if (failed > 0 && got === 0) throw firstErr;       // 这一页详情全失败 ⇒ 抛
	return out;
}
// 一侧的条目：按页前进 —— page 1 → 解析不出「覆盖 now 的窗口」→ page 2 → page 3（上限 3），
// 某页能产出有效载荷就停；全部页都没有覆盖 now 的窗口 ⇒ 空数组（调用方给 null = nomatch，不抛）。
// `maxPages` 第 6 参只给回归用（=1 钉住"第 1 页单独没有覆盖 now"；生产调用不传，走常量上限）。
async function ns_pcr_tw_itemsOf(url, signal, tz, now, side, maxPages = ns_pcr_TW_MAX_LIST_PAGES) {
	const want = side === "pools" ? "gacha" : "event";
	const limit = Math.max(1, Math.min(ns_pcr_TW_MAX_LIST_PAGES, Math.floor(Number(maxPages) || ns_pcr_TW_MAX_LIST_PAGES)));
	for (let page = 1; page <= limit; page++) {
		const rows = await ns_pcr_tw_rowsOf(url, page, signal);
		const cand = ns_pcr_tw_candidatesOf(rows, want);
		if (cand.length === 0) continue;               // 这一页没有该侧公告 ≠ 结构变了（继续翻）
		const items = await ns_pcr_tw_itemsOnPage(cand, signal, tz, now, side);
		if (items.some((it) => coversNow(it, now))) return items;   // 这一页能产出有效载荷 ⇒ 停
	}
	return [];
}
// 卡池侧：同批（同结束时刻）合并角色 —— 这款的换池是整批换的（精選轉蛋 / 白金轉蛋 / 第10次同窗开合）
async function ns_pcr_tw_gacha(url, signal, tz = ns_pcr_TW_TZ, now = nowMs()) {
	const items = await ns_pcr_tw_itemsOf(url, signal, tz, now, "pools");
	if (items.length === 0) return null;              // 没有带窗口的卡池公告 ⇒ 未公布（不是失败）
	return ns_bwiki_batchGachaPayloadOf(items, tz, now, { id: "pcr-tw" });
}
// 活动侧：覆盖 now 的活动 → 共用活动载荷
async function ns_pcr_tw_events(url, signal, tz = ns_pcr_TW_TZ, now = nowMs()) {
	const items = await ns_pcr_tw_itemsOf(url, signal, tz, now, "events");
	if (items.length === 0) return null;
	return ns_bwiki_eventPayload(items, tz, now, 0, "pcr-tw");
}
//#endregion

//#region ⑤ 条目登记
// 卡池与活动**同一条列表**（`eventUrl` 与 `url` 相同）⇒ 两侧标签逐字「官网公告」。
registerSource({
	id: "pcr-tw",
	defaultHidden: false,
	tz: ns_pcr_TW_TZ,
	name: "公主连结Re:Dive·繁中服",
	icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/5e/11/a2/5e11a217-4266-19ed-40e0-2a2357067278/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
	url: ns_pcr_TW_LIST_URL,
	source: ns_pcr_TW_SOURCE_LABEL,
	eventUrl: ns_pcr_TW_LIST_URL,
	eventSource: ns_pcr_TW_SOURCE_LABEL
});
GACHA_FETCHERS["pcr-tw"] = (url, signal, tz, now) => ns_pcr_tw_gacha(url, signal, tz, now);
EVENT_FETCHERS["pcr-tw"] = Object.assign(EVENT_FETCHERS["pcr-tw"] || {}, {
	default: (url, signal, tz, now) => ns_pcr_tw_events(url, signal, tz, now)
});
//#endregion


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-batch3.js 的 ① 段：碧蓝幻想（gbf，gbf-wiki 活动一览；卡池未配置）
// ─────────────────────────────────────────────────────────────────────────────

// ══ ① 碧蓝幻想 GRANBLUE FANTASY（id `gbf`，日服，Cygames）══════════════════════════
// ── 官方渠道为什么接不了（已实测，别再来回找）──────────────────────────────────
//   · `https://game.granbluefantasy.jp/` 是 SPA，且**未登录直接 `window.location.href='.../authentication'`**；
//     `rest/*`（`/rest/info/list`、`/rest/news/list`、`/rest/gacha/list` …）在未登录下**全部回落成同一份
//     1744 B 的 SPA 壳**（`Content-Type: text/html`，不是 JSON）—— 公告/卡池档期是登录态数据，无公开 JSON。
//   · `https://granbluefantasy.jp/news/` 是**系列官网**（Cygames 的 GBF 品牌站，动漫/周边），不是游戏内公告。
//   · `https://gbf.wiki/`（社区主 wiki）对非浏览器请求 **403**（正文由 WAF 拦，`api.php` 同样 403）；
//     `granbluefantasy.fandom.com` 同名的 Fandom 站**已停更**（首页活动块停在 2021-07）。
//   ⇒ 卡池侧按口径**留空**（`url: ""` = 设置页/面板显示「未配置」，一个请求都不发）。
//
// ── 活动侧源（2026-11-15 实测；夹具 test/fixtures/gbf-events）────────────────────
//   `GET https://gbf-wiki.com/?イベント/開催予定・開催中`（PukiWiki 1.5.2，服务端渲染 HTML，200 / 166,127 B）
//   页面里有两张同构表格（表头第 6 列都是 `開催日時`）：
//     ·「現在開催中のイベント」——本期正在跑的（实测 1 行）
//     ·「今後の開催予定」——下一期/已公布档期（实测 3 行）
//   行 = `イベント種別 | 回数 | イベント名 | ボス属性 | 有利属性 | 開催日時 | 備考`
//   实测原样（2026-11-15）：
//     十天衆戦記 / 9 / 十天衆戦記 / 水 / 土 / `2026/11/13 17:00～2026/11/20 16:59`
//     コラボイベント / 1 /（SHAMAN KING） / — / — / `2027/01/15 ～`（**只有起点**）
//     シナリオイベント / 1 /（不明） / — / — / `2026/11/28 17:00～2026/12/06 20:59`
//     決戦！星の古戦場 / 85 / 決戦！星の古戦場 / 光 / 闇 / `2026/11/21 19:00～2026/11/28 23:59`
//   ⇒ 档期一律 `YYYY/MM/DD [HH:MM]～YYYY/MM/DD [HH:MM]`：带时刻就用，只写日期 → 起点 00:00 / 终点 23:59
//     （仓库通用约定，与 bwiki 系一致）；**只有起点**（`2027/01/15 ～`）⇒ 终点 null，不冒充"在期"。
//   名称：`（SHAMAN KING）`/`（不明）` 这种**占位括号**补上 `イベント種別` 前缀（`コラボイベント（SHAMAN KING）` /
//     `シナリオイベント（不明）`）—— 否则面板上只剩一个括号，看不出是什么。
//     PukiWiki 的「新建页面」问号链接（`<span class="noexists">名<a href="?cmd=edit…">?</a></span>`）要先摘掉，
//     否则名字尾巴会多一个 `?`。
//   时区 = `Asia/Tokyo`（源站自身口径，不换算）。
//
// ── 请求预算 / 缓存 ────────────────────────────────────────────────────────────────
//   1 次请求（单页；行里自带名字与档期，没有详情页）。解析结果按 **URL** 缓存，TTL 24h ⇒ 稳态 1 次/天。
//   （该源没有"条目 id"可缓存 —— 一页即一期，URL 就是它的 id。）
//
// ── 失败语义（与全仓一致）─────────────────────────────────────────────────────────
//   · HTTP 非 2xx ⇒ 抛（`fetchText` 自己抛 `http-…`）；
//   · 结构变了（**一张带 `開催日時` 表头的表都没有** / 表在但**一行 `<td>` 行都没有**）⇒ 抛
//     `gbf-events-changed:…`（抓取失败 ≠ 未公布；`{}` / 改版页 / 空响应都落这里）；
//   · 表正常但**时间锚点被抹掉** ⇒ 不抛，这一页就是"没有窗口"（不产出条目）；
//   · 有窗口但没有一条覆盖 now ⇒ `null`（未公布，不硬凑过期档期）。

//#region ① 碧蓝幻想：常量
const ns_gbf_TZ = "Asia/Tokyo";
// 活动一览（PukiWiki 页面名 = `イベント/開催予定・開催中`；百分号编码是站点自己的规范形态）
const ns_gbf_EVENTS_URL = "https://gbf-wiki.com/?%E3%82%A4%E3%83%99%E3%83%B3%E3%83%88%2F%E9%96%8B%E5%82%AC%E4%BA%88%E5%AE%9A%E3%83%BB%E9%96%8B%E5%82%AC%E4%B8%AD";
// 官方游戏图标（game.granbluefantasy.jp 的 SPA `<link rel="apple-touch-icon-precomposed">`，实测 200 / image/png）
const ns_gbf_ICON = "https://prd-game-a-granbluefantasy.akamaized.net/assets/img/sp/touch_icon.png";
const ns_gbf_SOURCE_LABEL = "wiki 活动一览（gbf-wiki）";
// 解析结果缓存 TTL = 24h（用户口径；一页即一期，URL 就是它的 id）
const ns_gbf_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 表头认这一列（两张活动表都有；报表/商城表没有 ⇒ 天然被过滤掉）
const ns_gbf_DATE_HEAD = "開催日時";
// 档期：`YYYY/MM/DD [HH:MM]～YYYY/MM/DD [HH:MM]`，终点整段可缺（`2027/01/15 ～`）
const ns_gbf_RANGE_RE = /(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?\s*[～~]\s*(?:(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?)?/;
// 占位名：整格就是一对括号（`（不明）` / `（SHAMAN KING）`）
const ns_gbf_PLACEHOLDER_RE = /^（[^）]*）$/;
//#endregion

//#region ② 碧蓝幻想：纯解析（HTML → 条目事实）
// `<table>` 块（PukiWiki 1.5.2 的活动表没有嵌套表，非贪婪切即可）
function ns_gbf_tablesOf(html) {
	return [...String(html == null ? "" : html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((m) => m[1]);
}
// 单元格 → 文本：**先摘掉 PukiWiki 的「新建页面」问号链接**（`<a href="?cmd=edit…">?</a>`），
// 再走共用的 HTML → 文本（标签只当分隔符，实体解一遍）。不摘那一下，名字尾巴会多一个 `?`。
function ns_gbf_cellText(cell) {
	const s = String(cell == null ? "" : cell).replace(/<a\b[^>]*>\s*[?？]\s*<\/a>/gi, "");
	return htmlTextTight(s).trim();
}
// 一格档期 → `{ startTs, endTs, raw, display }`（没有起点 ⇒ null；只有起点 ⇒ endTs=null）
//   · 带时刻就用；只写日期 ⇒ 起点 00:00 / 终点 23:59（仓库通用约定）；
//   · 终点整段缺失 ⇒ endTs=null（"不冒充在期"，但仍如实产出条目，进 `raw`）。
function ns_gbf_windowOf(text, tz) {
	const s = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
	const m = ns_gbf_RANGE_RE.exec(s);
	if (!m) return null;
	const y1 = +m[1], mo1 = +m[2], d1 = +m[3], h1 = m[4] != null ? +m[4] : 0, mi1 = m[5] != null ? +m[5] : 0;
	if (mo1 < 1 || mo1 > 12 || d1 < 1 || d1 > 31 || h1 > 23 || mi1 > 59) return null;
	const startTs = sourceInstant(y1, mo1, d1, h1, mi1, tz);
	let endTs = null;
	if (m[6] != null) {
		const y2 = +m[6], mo2 = +m[7], d2 = +m[8], h2 = m[9] != null ? +m[9] : 23, mi2 = m[10] != null ? +m[10] : 59;
		if (mo2 < 1 || mo2 > 12 || d2 < 1 || d2 > 31 || h2 > 23 || mi2 > 59) return null;
		endTs = sourceInstant(y2, mo2, d2, h2, mi2, tz);
		if (!(endTs > startTs)) return null;           // 源站错行 ⇒ 丢掉，不硬造
	}
	const raw = s;
	const display = endTs != null ? fmtWindow(startTs, endTs, tz) : raw;
	return { startTs, endTs, raw, display };
}
// HTML → 条目事实数组（**结构变了才抛**；时间锚点被抹掉 ⇒ 返回空数组，不抛）
//   条目形状与 bwiki 系一致：`{ _i, event, category, startTs, endTs, raw, display }`
function ns_gbf_itemsOf(html, tz = ns_gbf_TZ) {
	const tables = ns_gbf_tablesOf(html).filter((t) => new RegExp(`<th\\b[^>]*>\\s*${ns_gbf_DATE_HEAD}\\s*</th>`).test(t));
	if (tables.length === 0) throw new Error("gbf-events-changed:no-table");
	const items = [];
	const seen = new Set();
	let rows = 0;
	for (const table of tables) {
		// 列位按**表头逐字**定位（`イベント種別|回数|イベント名|ボス属性|有利属性|開催日時|備考`）：
		// 源站若插入/删掉一列，名字与档期会**整列错位**（不报错、只出错数据）⇒ 这里不许硬编码下标。
		const heads = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((h) => ns_gbf_cellText(h[1]));
		const kindAt = heads.indexOf("イベント種別");
		const nameAt = heads.indexOf("イベント名");
		const dateAt = heads.indexOf(ns_gbf_DATE_HEAD);
		if (nameAt < 0 || dateAt < 0) throw new Error("gbf-events-changed:no-columns");
		const need = Math.max(kindAt, nameAt, dateAt) + 1;
		for (const tr of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
			const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
			if (cells.length < need) continue;         // `<thead>` 的 `<th>` 行 / 分隔行（colspan）都不算
			rows++;
			const kind = kindAt < 0 ? "" : ns_gbf_cellText(cells[kindAt]);
			const name0 = ns_gbf_cellText(cells[nameAt]);
			const win = ns_gbf_windowOf(ns_gbf_cellText(cells[dateAt]), tz);
			if (!name0 || !win) continue;
			const name = ns_gbf_PLACEHOLDER_RE.test(name0) && kind ? kind + name0 : name0;
			const key = `${name}|${win.startTs}|${win.endTs}`;
			if (seen.has(key)) continue;
			seen.add(key);
			items.push({
				_i: items.length,
				event: name,
				category: kind,                        // イベント種別（決戦！星の古戦場 等）—— 只用于档位排序
				startTs: win.startTs, endTs: win.endTs,
				raw: win.raw, display: win.display
			});
		}
	}
	if (rows === 0) throw new Error("gbf-events-changed:no-rows");
	return items;
}
//#endregion

//#region ③ 碧蓝幻想：抓取器（契约：async (url, signal, tz, now = nowMs()) → 载荷 | null）
let ns_gbf_cache = null;                           // { url, at, items }
function ns_gbf_resetCache() { ns_gbf_cache = null; }
async function ns_gbf_events(url, signal, tz = ns_gbf_TZ, now = nowMs()) {
	const key = String(url == null ? "" : url).trim() || ns_gbf_EVENTS_URL;
	const at = typeof now === "number" && Number.isFinite(now) ? now : nowMs();
	const hit = ns_gbf_cache;
	let items;
	if (hit && hit.url === key && at >= hit.at && at - hit.at < ns_gbf_CACHE_TTL_MS) items = hit.items;
	else {
		const html = await fetchText(key, { mode: "proxy", signal });
		items = ns_gbf_itemsOf(html, tz);
		ns_gbf_cache = { url: key, at, items };
	}
	if (items.length === 0) return null;           // 时间锚点被抹掉 ⇒ 这一页没有窗口（不是失败）
	return ns_bwiki_eventPayload(items, tz, at, 0, "gbf");
}
//#endregion

// 碧蓝幻想：**卡池侧留空**（`url: ""` + 不写 `source` ⇒ 设置页/面板显示「未配置」，不发请求）；
// 活动侧 = gbf-wiki 的活动一览（标签逐字「wiki 活动一览（gbf-wiki）」）。
registerSource({
	id: "gbf",
	defaultHidden: false,
	tz: ns_gbf_TZ,
	name: "碧蓝幻想·日服",
	icon: ns_gbf_ICON,
	url: "",
	eventUrl: ns_gbf_EVENTS_URL,
	eventSource: ns_gbf_SOURCE_LABEL
});
EVENT_FETCHERS["gbf"] = Object.assign(EVENT_FETCHERS["gbf"] || {}, {
	default: (url, signal, tz, now) => ns_gbf_events(url, signal, tz, now)
});


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-bwiki-uma-cn.js：bwiki「简中卡池」解析（uma-cn 卡池备选源）
// ─────────────────────────────────────────────────────────────────────────────

//#region ② 闪耀优俊少女 国服（umamusume / page=简中卡池）
// 页面两张同表头的表（各含表头行共 192 / 241 行，数据行 191 / 240）：
//   ①「已实装卡池」= 简中服**实际已实装**的记录（当期外显用这张） ②「预测卡池」= **推算**。
//   ⚠️ 页首正文：「简中卡池加速 -> 简中预测时间-185天 / 2025/05/22 简中重新更新 -> 简中预测时间+423天」
//      ⇒ 简中服时刻是**按日服时差推算**出来的，**不是官方时刻表**。本解析器只用①做当期外显，
//        ②的推算结果只放进 `bannerHover` 并显式标注「接下来的预测卡池（按日服时差推算，非官方时刻表）」。
//   表结构：表头 `时间 | 卡池(colspan=2) | Up对象` → 数据行 4 格 [时间][池类型][池名][Up对象]，
//     其中「支援卡卡池」行与上一行共用时间（上一行 `rowspan="2"`）→ 只有 3 格，需继承日期。
//   ⚠️① 表时间列是 **结束 ~ 开始**（整表多数票判定为 endFirst）；② 表是 **开始 ~ 结束**。
function ns_bwiki_parseUmaCnGacha(html, tz = "Asia/Shanghai") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return { live: [], predicted: [] };
	const cands = ns_bwiki_findTablesByHeaders(tables, ["时间", "卡池"]);
	if (cands.length === 0) throw new Error("bwiki-uma-cn-gacha:no-table");
	const parseOne = (tbl) => {
		const raw = [];
		let pendingDate = "";
		for (const r of ns_bwiki_tableRows(tbl)) {
			const cs = r.cells;
			if (!cs.length || cs.some((c) => c.tag === "th")) continue;
			if (cs.length >= 4) {
				pendingDate = cs[0].text;
				raw.push({ dateText: pendingDate, categoryCell: cs[1], nameCell: cs[2], upCell: cs[3] });
			} else if (cs.length === 3) {
				raw.push({ dateText: pendingDate, categoryCell: cs[0], nameCell: cs[1], upCell: cs[2] });
			}
		}
		const orient = ns_bwiki_detectOrientation(raw.map((x) => x.dateText), tz);
		const items = [];
		raw.forEach((x, i) => {
			const wins = ns_bwiki_windowsFromCell(x.dateText, tz, orient);
			if (wins.length === 0) return;
			const category = x.categoryCell.text;
			const roles = textOf(x.upCell.html).split("\n")
				.map((s) => s.trim().replace(/^简\//, "")).filter(Boolean).join("、");
			items.push({
				_i: i,
				banner: String(x.nameCell.text).replace(/\s+/g, " ").trim() || "卡池",
				roles, category, isMain: !/支援/.test(category),
				startTs: wins[0].startTs, endTs: wins[0].endTs,
				orient,                                   // 整表朝向（诊断/测试用；不进契约字段）
				raw: wins[0].raw,                         // 源站原文（不含任何加工）
				display: wins[0].display                  // 补全后的可读文本（约定见 bwiki-common 文件头）
			});
		});
		return items;
	};
	// 用各表之前最近的小节标题区分「已实装」/「预测」（取不到标题时退回文档顺序）
	const withHead = cands.map((tbl) => ({ tbl, head: ns_bwiki_headingBefore(html, html.indexOf(tbl)) }));
	const liveTbl = (withHead.find((x) => /已实装/.test(x.head)) || withHead[0]).tbl;
	const predTbl = (withHead.find((x) => /预测/.test(x.head)) || withHead[1] || withHead[0]).tbl;
	return { live: parseOne(liveTbl), predicted: predTbl === liveTbl ? [] : parseOne(predTbl) };
}
// 预测卡池：**不进悬停**（方案 A：悬停只放"当期"，且不得含元信息）。
// 该表是 wiki 按日服时差机械平移出来的：池名里连**日服原始年份**都还留着
// （如 `八骏赛马娘卡池 20230911` 被平移到 2026-09），远期条目一路排到 2029 年。
// 2026-10-03 改：原先这里给 bannerHover 追加「—— 接下来的预测卡池（按日服时差推算，非官方时刻表） ——」
//   + 3 条未来条目。那既是"非当期"内容，头部又是元信息/来源说明 ——
//   「社区推算、非官方」这层意思已经写在来源标签里（`Bwiki 简中社区推算卡池`），
//   不需要再在悬停里重复。保留函数是为了让夹具测试仍能直接断言"预测表的解析结果"。
//#endregion


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-bwiki-uma-jp.js：bwiki「活动」归档解析（uma-jp 活动备选源）
// ─────────────────────────────────────────────────────────────────────────────

//#region ③ 赛马娘 日服（umamusume / page=活动）—— 时区硬标注 Asia/Tokyo
// 页面只有一张表，标题是「往期活动」（**归档**，不是当期排期），100 行；表头 `活动时间 | 图 | 名称 | 类型`。
//   时间写法 `2025/12/26 11:00~ 2026/01/08 10:59`（开始 ~ 结束）。
//   第 1 行是常驻（`常驻~ 常驻`，无日期）→ 只计入常驻条数，不进当期排序。
//   ⚠️ 实测最新一条 2025/12/26 ~ 2026/01/08（页面缓存时间 2026-10-01）→ 当期无覆盖 → null。
//   ⚠️ 源站有错行 `2025/04/10 11:00~ 2024/04/18 10:59` → endTs<=startTs 被整行丢弃。
function ns_bwiki_parseUmaJpEvents(html, tz = "Asia/Tokyo") {
	const tables = ns_bwiki_eachTable(html);
	if (tables.length === 0) return { items: [], permanent: 0 };
	const cands = ns_bwiki_findTablesByHeaders(tables, ["活动时间", "名称", "类型"]);
	if (cands.length === 0) throw new Error("bwiki-uma-jp-event:no-table");
	const rows = ns_bwiki_tableRows(cands[0]).filter((r) => r.cells.length >= 4 && !r.cells.some((c) => c.tag === "th"));
	const orient = ns_bwiki_detectOrientation(rows.map((r) => r.cells[0].text), tz);
	const items = [];
	let permanent = 0;
	rows.forEach((r, i) => {
		const [c0, c1, c2, c3] = r.cells;
		const wins = ns_bwiki_windowsFromCell(c0.text, tz, orient);
		if (wins.length === 0) {
			if (/常驻|永久|長期|长期/.test(c0.text)) permanent++;
			return;
		}
		items.push({
			_i: i,
			event: c2.text || ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt")) || "活动",
			category: c3.text, img: ns_bwiki_cleanImgName(ns_bwiki_attrOf(c1.html, "alt")),
			startTs: wins[0].startTs, endTs: wins[0].endTs, raw: wins[0].raw, display: wins[0].display
		});
	});
	return { items, permanent };
}
//#endregion


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-biligame.js：闪耀优俊少女 国服（uma-cn）官方公告解析 + 注册
// ─────────────────────────────────────────────────────────────────────────────

// ══ ② 闪耀优俊少女 国服（gameExtensionId=1006）══════════════════════════════
//   ⚠️ **只有单一 feed（typeId=1）且卡池/活动混排**（totalNum=671，一页 50）。
//     `typeId=4`（活动专类）实测**已停更**（13 条，停在 2026-04-19）→ **不用它**。
//   标题分流（任务书口径）：
//     卡池 = 标题含 `招募` / `扭蛋` / `必得`（先判卡池：`…庆典招募开放！` 里也含「活动」字样）
//     活动 = 标题含 `活动` / `赛事` / `剧情` / `举办`
//     两者都不含 → **跳过**（如`养成剧本…开放！`/`部分养成优俊少女追加进化技能！`），不抓详情。
//   ⚠️ 正文档期形如：`10/2 12:00 ～ 10/13 11:59`（**全角波浪 `～`**、**不带年份**、**月/日**），
//     且**标签常与前一段或同段共存**：
//       <p>精选招募开放期间</p><p>10/2 12:00 ～ 10/13 11:59</p>      ← 上一段是标签
//       <p>活动期间 10/1 12:00 ～ 10/711:59</p>                      ← 同段；⚠️ 源站**少了一个空格**
//     ⇒ 标签取「同段内窗口之前的文字」，空则退回「上一段非窗口段」。
//     ⚠️ 实测源站笔误 `10/711:59`（18423 活动期间）：日期与时刻**粘连**。本解析器用
//        `ns_biligame_activity_deglueDateTimes()` 归一成 `10/7 11:59`，并记 `glued:true` + `rawNorm`（供测试与排障）。
//        ⚠️ 这条说明**只留在这里**：旧版曾把它拼成一个「（源站原文…粘连…）」括号注进悬停 → 已删。
//     外显挑选：同一条公告里常有多个「…期间」（活动期间 / 奖励领取期间 / 报名期间 / 第N轮…）→
//       卡池侧优先标签含`招募`的窗口，活动侧优先`活动期间`，其次含`期间|时间`，最后其它；同级结束早者先。
//
// ══ 时区 tz = Asia/Shanghai（**推测，但有逐字交叉印证**）════════════════════
//   源站**不标时区**。交叉印证：公告 `displayTime`（B 站 CMS 发布时刻）与正文档期墙钟**逐字一致**：
//     · 18419 displayTime=2026-09-30 10:00:00 ↔ 正文`活动时间：9月30日 10:00 ~ …`
//     · 18426 displayTime=2026-10-02 12:00:00 ↔ 正文`10/2 12:00 ～ 10/13 11:59`
//   ⇒ 正文墙钟与 CMS 同一口径；B 站 CMS 为 UTC+8 → 记 Asia/Shanghai。（仍是**推定**，不是源站声明。）
//   绝对时刻一律走 `sourceInstant(...)`，文本一律走 `fmtWindow(...)`（源站墙钟原文不重解释）。

//#region ② 闪耀优俊少女 正文/标题
// 标题分流：卡池（招募/扭蛋/必得）优先；其次活动（活动/赛事/剧情/举办）；都不含 → null（跳过，不抓详情）
const ns_biligame_activity_UMA_GACHA_RE = /招募|扭蛋|必得/;
const ns_biligame_activity_UMA_EVENT_RE = /活动|赛事|剧情|举办/;
function ns_biligame_activity_classifyUmaCnTitle(title) {
	const t = String(title == null ? "" : title);
	if (ns_biligame_activity_UMA_GACHA_RE.test(t)) return "gacha";
	if (ns_biligame_activity_UMA_EVENT_RE.test(t)) return "event";
	return null;
}
// 正文 HTML → { items:[{ name:标签, label, startTs, endTs, raw, glued }], skipped, paragraphs }
//   标签：同段内窗口之前的文字（`活动期间 10/1 12:00 ～ …`）→ 空则退回上一段非窗口段
function ns_biligame_activity_parseUmaCnAnnouncement(html, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ, yearHint = null) {
	const paragraphs = ns_biligame_activity_biligameParagraphs(html);
	const items = [], skipped = [];
	let prevLabel = "";
	for (const para of paragraphs) {
		const { norm, windows, skipped: sk } = ns_biligame_activity_extractWindowsDetailed(para, yearHint, tz);
		if (!windows.length) {
			for (const s of sk) skipped.push({ ...s, label: prevLabel });
			// 记录「可能是标签」的短段（供下一段的窗口使用）：实测标签形如
			// `精选招募开放期间` / `开放期间` / `活动期间` / `角色剧情开放期间` → 需含 期间|时间 等词
			if (para.length <= 24 && !/[。！？，,；;：:]/.test(para) && /期间|时间|开放|活动/.test(para)) prevLabel = para;
			continue;
		}
		for (const w of windows) {
			const head = norm.slice(0, w.at).replace(/^[※·・\-—\s]+/, "").replace(/[：:]\s*$/, "").trim();
			const label = head || prevLabel;
			items.push({ name: label || "（无标签）", label, startTs: w.startTs, endTs: w.endTs, raw: w.raw, rawNorm: w.rawNorm, glued: w.glued });
		}
		for (const s of sk) skipped.push({ ...s, label: prevLabel });
	}
	return { items, skipped, paragraphs };
}
// 外显挑选：卡池侧优先标签含`招募`；活动侧优先`活动期间`，其次含`期间|时间`，最后其它细分期间。
// 同级取结束最早，并列按文档顺序。（实测：18425 活动期间 / 18423 活动期间 都是 rank0）
function ns_biligame_activity_pickUmaWindow(items, now, want) {
	const act = (items || []).filter((x) => coversNow(x, now));
	if (!act.length) return null;
	const rank = (x) => {
		const l = String(x.label || "");
		if (want === "gacha") return /招募/.test(l) ? 0 : 1;
		if (/^(活动期间|活动时间)/.test(l)) return 0;
		if (/期间|时间/.test(l)) return 1;
		return 2;
	};
	return act.map((w, i) => ({ w, i })).sort((a, b) => rank(a.w) - rank(b.w) || (a.w.endTs - b.w.endTs) || (a.i - b.i))[0].w;
}
// UP 角色/协助卡名（可选字段）：只认 `★★★ [系列名]角色名` 这种明确行（协助卡列表没有 ★★★ → 不产出）
function ns_biligame_activity_umaRoles(paragraphs) {
	const out = [];
	for (const p of paragraphs || []) {
		const m = /^★★★\s*(?:\[[^\]]*\]|【[^】]*】)?\s*([^\s（(＜【\[]+)/.exec(p);
		if (m && m[1] && !out.includes(m[1])) out.push(m[1]);
		if (out.length >= 6) break;
	}
	return out;
}
//#endregion

//#region 闪耀优俊少女 抓取器（卡池 + 活动，同一 feed 靠标题分流）
// 单一 feed（typeId=1）→ 逐条往下（≤8 篇）→ 标题分流 → 只抓**本侧相关**的详情 → 正文抽档期
async function ns_biligame_activity_loadUmaCn(url, signal, tz, now, want) {
	const listUrl = url || ns_biligame_activity_UMA_CN_LIST_URL;
	const list = ns_biligame_activity_parseBiligameList(await fetchJson(listUrl, { referer: ns_biligame_activity_UMA_CN_HOME, signal, mode: "proxy" }));
	if (!list.length) return null;                     // 空列表 → 源站无公告 = 未公布
	let firstErr = null, loaded = 0, tried = 0;
	for (const it of list.slice(0, ns_biligame_activity_DETAIL_LIMIT_UMA)) {
		const title = decodeExtra(it.title || "").replace(/\s+/g, " ").trim();
		if (ns_biligame_activity_classifyUmaCnTitle(title) !== want) continue;   // 标题分流：不相关的不抓详情（省请求）
		tried++;
		let d = null;
		try {
			const detail = await fetchJson(ns_biligame_activity_biligameDetailUrl(listUrl, it.id), { referer: ns_biligame_activity_UMA_CN_HOME, signal, mode: "proxy" });
			d = detail && detail.data;
		} catch (e) {
			if (!firstErr) firstErr = e;
			continue;
		}
		if (!d || typeof d.content !== "string") continue;
		loaded++;
		const dt = decodeExtra(d.title || title).replace(/\s+/g, " ").trim();
		const parsed = ns_biligame_activity_parseUmaCnAnnouncement(d.content, tz, ns_biligame_activity_yearHintOf(it, tz));
		const best = ns_biligame_activity_pickUmaWindow(parsed.items, now, want);
		if (!best) continue;
		// 覆盖 now 的全部期间（**当期判定不变**，与旧版同一集合），按结束时间升序排好供悬停排版。
		// 悬停文本由调用方按侧拼（卡池 `hoverPool` / 活动 `hoverEvent`）——本函数不再返回 hover，
		// 因为两侧排版不同（卡池要「池名：角色」+ 每池两行），旧版共用一份 hover 正是偏差来源之一。
		// ⚠️ 旧版的「来源：B站官方公告 api.biligame.com/news（gameExtensionId=1006，单一 feed
		// typeId=1 卡池/活动混排，按标题分流）」「闪耀！优俊少女 国服 · 标题 + tz 推定」「▶ 支线」
		// 与「源站原文粘连 → 按 … 解析」全是元信息/实现说明 → 已彻底删除（见文件头「悬停规则」）。
		const active = parsed.items
			.filter((x) => coversNow(x, now))
			.sort(ns_biligame_activity_byEndAsc);
		return { title: dt, best, active, roles: want === "gacha" ? ns_biligame_activity_umaRoles(parsed.paragraphs) : [] };
	}
	if (loaded === 0 && tried > 0 && firstErr) throw firstErr;   // 本侧相关详情全都失败 → 抛错
	return null;
}
// 卡池侧
async function ns_biligame_activity_gachaUmaCnOfficial(url, signal, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ, now = nowMs()) {
	const hit = await ns_biligame_activity_loadUmaCn(url, signal, tz, now, "gacha");
	if (!hit) return null;
	const { title, best, active, roles } = hit;
	const banner = ns_biligame_activity_cleanTitle(title) || best.label;
	const rolesText = roles.join("、");
	// 悬停 = 全部当期池（每池「池名：角色」+ 档期）；只有 1 个当期池 → "" → **不设** bannerHover，
	// 交回 UI 默认两行式（`banner：roles` ⏎ `bannerDates`）。
	// ── P3b：条目事实 → 悬停 + `gacha` 数组 ──────────────────────────────────
	const poolItems = ns_biligame_activity_hoverRows(active, (x) => `${x.label || banner}${rolesText ? `：${rolesText}` : ""}`);
	const bannerHover = hoverTextFromItems(poolItems, "gacha", tz);
	const out = {
		banner,
		roles: rolesText,
		bannerDates: fmtWindow(best.startTs, best.endTs, tz),
		bannerDatesRaw: best.raw,
		startTs: best.startTs,
		endTs: best.endTs,
		...(bannerHover ? { bannerHover } : {})
	};
	out.gacha = dataArrayProducedGachaOf(out, poolItems, { tz }, now);
	out.gachaHoverItems = poolItems;
	return out;
}
// 活动侧
async function ns_biligame_activity_eventsUmaCnOfficial(url, signal, tz = ns_biligame_activity_BILIGAME_ACTIVITY_TZ, now = nowMs()) {
	const hit = await ns_biligame_activity_loadUmaCn(url, signal, tz, now, "event");
	if (!hit) return null;
	const { title, best, active } = hit;
	const event = ns_biligame_activity_cleanTitle(title) || best.label;
	// 悬停 = 全部当期期间，逐行「期间名 + 3 空格 + 档期」（档期由 fmtWindow 格式化：源站粘连笔误
	// `10/711:59` 在这里如实显示为 `10-07 11:59`）；只有 1 条 → "" → **不设** eventHover。
	// ── P3b：条目事实 → 悬停 + `events` 数组 ──────────────────────────────────
	const eventItems = ns_biligame_activity_hoverRows(active, (x) => x.label || event);
	const eventHover = hoverTextFromItems(eventItems, "event", tz);
	const out = {
		event,
		eventDates: fmtWindow(best.startTs, best.endTs, tz),
		eventDatesRaw: best.raw,
		...(eventHover ? { eventHover } : {})
	};
	out.events = dataArrayProducedEventsOf(out, eventItems, { tz }, now);
	out.eventHoverItems = eventItems;
	return out;
}

		registerSource({
				id: "uma-cn",
				defaultHidden: false,
				tz: "Asia/Shanghai",
				name: "闪耀！优俊少女",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/ca/23/bc/ca23bc1f-5dff-c21a-1881-66c48d02f5b2/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
				url: "https://api.biligame.com/news/list?gameExtensionId=1006&positionId=2&typeId=1&pageNum=1&pageSize=50",
				source: "官方公告",
				eventUrl: "https://api.biligame.com/news/list?gameExtensionId=1006&positionId=2&typeId=1&pageNum=1&pageSize=50",
				eventSource: "官方公告",
				altSources: [{"label":"Bwiki 简中社区推算卡池","url":"https://wiki.biligame.com/umamusume/api.php?action=parse&page=简中卡池&prop=text&format=json&formatversion=2","fetcher":"uma-cn-bwiki"}],
		});

		// ══ 原 43-sources-register.js 里属于本组的登记代码（原样保留）══
		GACHA_FETCHERS["uma-cn"] = (url, signal, tz) => ns_biligame_activity_gachaUmaCnOfficial(url, signal, tz);

		EVENT_FETCHERS["uma-cn"] = Object.assign(EVENT_FETCHERS["uma-cn"] || {}, { default: (url, signal, tz) => ns_biligame_activity_eventsUmaCnOfficial(url, signal, tz) });

		GACHA_FETCHERS["uma-cn-bwiki"] = (url, signal, tz) => ns_bwiki_gachaUmaCn(url, signal, tz);
