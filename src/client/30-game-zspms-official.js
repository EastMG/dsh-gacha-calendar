// src/client/30-game-zspms-official.js —— 战双帕弥什 国服：**官方 CDN** 「版本更新公告」（活动侧默认源）
//
// ══ 为什么接（2026-11-11）══════════════════════════════════════════════════════
// 活动侧此前默认 = bwiki `Test4/活动日历`（结构化档期页），但它**只抄到 2026/11/05**：
//   面板活动列从 11-06 起空窗，而游戏 11-05 已经进了「流光抛诸寰宇」版本。
// 官方 CDN 实测（2026-11-11，直连 200 / `Access-Control-Allow-Origin: *`）：
//   菜单  …/json/G144/ArticleMenu.json            217 条（含 id / 标题 / 类型 / 发布时间）
//   详情  …/json/G144/article/5682.json           《流光抛诸寰宇》版本更新公告（2026-11-03）
//        正文 12 处「2026年11月5日版本更新后 - 2026年12月17日05:00」⇒ **官方比 bwiki 新**
// ⇒ 活动侧默认源改成它（`eventUrl` = ArticleMenu，来源标签「官方公告」），
//   bwiki 两个页面（活动日历 / 旧公告）都降为 `eventAltSources` 手动备选（可切，不自动兜底）。
//
// ══ 抓取链路（4 个请求，全走宿主代理）═════════════════════════════════════════
//   ① ArticleMenu.json → 只留标题匹配「版本更新公告」的条目（**不硬编码 id**），按发布时间倒序取前 3 篇
//   ② 逐篇 article/<id>.json → `articleContent` 是 HTML 富文本 ⇒ 走本文件的解析器
//   ③ 三篇的条目合并（按 名+起+止 去重：相邻两版公告会重复同一批还不算过期的活动）
// ⚠️ 该域名**不在**宿主 `PROXY_ALLOW_HOSTS` 里 → 已在 `src/index.js` 登记
//    （虽然响应带 `ACAO:*`，但全仓口径是"官方公告一律走代理"，与 act-api-takumi 同一条）。
//
// ══ 正文形态（真夹具 `p8-zspms-cdn-menu` / `-art5682` / `-art5467`）═════════════
//   <div><span style="font-size: 18pt;"><strong>四、像素嚼嚼乐</strong></span><br>
//        <strong><span style="font-size: 14pt;">4）活动时间</span></strong><br>
//        <span style="font-size: 14pt;">2026年11月19日10:00 - 2026年12月16日05:00</span></div>
//   ⇒ **活动名在 `<strong>` 里**（不是标题层级：有时是 `一、…` 大标题，有时是 `1）…` 小标题，
//      有时是 `「揽光一瞬」` 这种只有名字的一行），档期是普通 `<span>`；所以：
//     · 整行加粗 = 标题行（大标题以「一、二、…」开头；小标题以「1）2）…」开头；其余按"名字行"处理）
//     · 档期只在**带时间标签**（`活动时间：/开放时间：/…`）或**整行就是档期**的行上认领
//       （正文里 `…将于2026年9月29日10:00 - 2026年11月3日23:59时间段内，通过…研发池获得`
//        这类句子里的档期属于**卡池**，卡池侧另有来源 ⇒ 不认；"整行档期"的判定顺带把它们排除）
//
// ══ 口径（逐条可查）════════════════════════════════════════════════════════════
//   · 起点写「版本更新后 / 维护后 / 更新后」⇒ **startTs = null**（仓库口径 2026-11-09：
//     起点未知 ≠ 已开始，**不猜**；`fillMissingStarts` 那种"显示用的猜测"也不做）
//     ⇒ 这类条目**不进外显**（`coversNow` 要求两端明确），但会进悬停/数组（`coveredOrOpen`：
//       终点未过就如实列出，档期用**源站原文**那一句）
//   · 终点必须绝对；终点写成相对表述（`… - 版本结束`）⇒ 整条丢掉（没有绝对时刻）
//   · 缺年份 ⇒ 借公告发布时间补（共用 `inferYear`）；结束月日早于开始 ⇒ 次年（共用 `endsNextYear`）
//   · 只有日期没有时分 ⇒ 起 00:00 / 止 23:59（仓库通用约定）
//   · tz = Asia/Shanghai（源站无标注；旁证：停服维护 05:00-11:00、卡池日切 05:00，与 bwiki 侧同一推测）
//   · 源站时间文本里的装饰符（`【】「」◆▌` 等）在**活动名**里清掉；名字内的 `·`（`莱亚·祈星`）保留
//
// ══ 不做什么 ══════════════════════════════════════════════════════════════════
//   · **不**用 `ArticleMenu` 里内联的 `articleContent`（菜单确实也带全文，但口径是"逐篇抓详情"：
//     列表只用来挑选，正文以详情为准，源站哪天把菜单瘦身了也不会静默失效）
//   · **不**接卡池侧：官方公告里的卡池档期与 bwiki `Test4/活动旗帜` 同源同期，
//     且公告正文把「研发池」写成句子（不是结构化字段）⇒ 卡池侧维持 bwiki（本任务只改活动侧）

const ns_zspms_cdn_TZ = "Asia/Shanghai";
// ⚠️ G144 = 国服（全球版是另一个 path）；`website2.0` 段不可省
const ns_zspms_cdn_MENU_URL = "https://media-cdn-zspms.kurogame.com/pnswebsite/website2.0/json/G144/ArticleMenu.json";
const ns_zspms_cdn_ARTICLE_BASE = "https://media-cdn-zspms.kurogame.com/pnswebsite/website2.0/json/G144/article/";
// 取最近几篇：3 篇足够（一版公告的档期最长约 6 周，两版必然覆盖当期），
// 且单篇解析失败/结构改版时还有后两篇兜底
const ns_zspms_cdn_MAX_NOTICES = 3;
// 标题判据：**清洗后匹配**「版本更新公告」（不写死 id —— 源站每版换 id）
const ns_zspms_cdn_NOTICE_TITLE_RE = /版本更新公告/;

function ns_zspms_cdn_articleUrl(id) {
	return ns_zspms_cdn_ARTICLE_BASE + encodeURIComponent(String(id)) + ".json";
}

// ── 活动名清洗 ────────────────────────────────────────────────────────────────
// 源站在 `<strong>` 里塞的东西形如：`一、流光抛诸寰宇——新版内容&活动玩法` / `1）尽心者尽美-角色试玩关`
// / `「揽光一瞬」` / `【勤务·限时任务】开放时间：`。清洗规则（顺序固定）：
//   ① 解 HTML 实体（`&middot;` → `·`，`&bull;` → `•`；与全仓同一张表 `decodeExtra`）
//   ② 去行首列表符/装饰符（`- • · ● ◆ ◇ ▌ ▍ ■ □ | ｜ ※`）
//   ③ 去序号（`1）` / `1.` / `一、` / `（3）`）
//   ④ 去**装饰括号**（`【】「」『』`）与装饰块字符（`◆◇▌▍■□●○★☆※`）—— 名字里的 `·` 与 `-` 保留
//   ⑤ 去尾部空白与冒号（`9）新增涂装：` → `新增涂装`）
function ns_zspms_cdn_cleanName(text) {
	let s = decodeExtra(String(text == null ? "" : text)).replace(/\u00a0/g, " ");
	s = s.replace(/^[\s\-–—－•·●◆◇▌▍■□|｜※]+/, "");
	s = s.replace(/^(?:\d{1,2}\s*[）).．、]|[一二三四五六七八九十]{1,3}\s*[、.．]|[（(]\s*\d{1,2}\s*[）)])\s*/, "");
	s = s.replace(/[【】「」『』◆◇▌▍■□●○★☆※]/g, "");
	return s.replace(/[\s:：]+$/, "").replace(/[ \t\u00a0]+/g, " ").trim();
}
// 通用容器名（不是活动名）：`4）活动时间` / `1）活动说明` / `-【勤务】任务开放时间`
// ⚠️ 只认**整串**等于这些词，或**以**时间类标签收尾 —— 不能写成后缀通配：
//    `7日登录签到奖励`、`涂装复刻`、`战略评定手册-栖光档案` 都是**真活动名**。
const ns_zspms_cdn_GENERIC_NAME_RE = /^(活动说明|活动奖励|活动对象|活动规则|活动内容|活动玩法|活动时间|活动周期|参与条件|开启条件|奖励概览|特殊说明|版本新增礼包内容和上架时间请指挥官留意相关公告)$/;
const ns_zspms_cdn_TIME_TAIL_RE = /(活动时间|开放时间|开启时间|持续时间|售卖时间|兑换时间|领取时间)$/;
function ns_zspms_cdn_isGenericName(name) {
	const n = String(name || "");
	return n === "" || ns_zspms_cdn_GENERIC_NAME_RE.test(n) || ns_zspms_cdn_TIME_TAIL_RE.test(n);
}
// 标题行 → 活动名：`6）「伴航补给」研发` 这类"引号里是名字、外面只剩类别后缀"的，取引号内那段；
// 其余（`1）主线剧情-流光抛诸寰宇` / `「揽光一瞬」`）就是清洗后的整行。
function ns_zspms_cdn_titleName(text) {
	const raw = String(text == null ? "" : text);
	const all = ns_zspms_cdn_cleanName(raw);
	const quoted = /[「『【]([^」』】]{1,30})[」』】]/.exec(raw);
	if (quoted) {
		const inner = ns_zspms_cdn_cleanName(quoted[1]);
		const rest = all.split(inner).join("").trim();
		if (inner && rest.length > 0 && rest.length <= 4) return inner;   // 「X」研发 / 【X】开放时间
	}
	const whole = /^[「『【]([^」』】]{1,30})[」』】]$/.exec(raw.replace(/^[\s\-•·]+/, ""));
	if (whole) return ns_zspms_cdn_cleanName(whole[1]);                  // 整行就是「X」
	return all;
}

// ── HTML → 逐行（带"整行加粗"标记）────────────────────────────────────────────
// 只做本任务需要的最小结构提取：`<br>` / 块级结束标签 → 换行；`<strong>`/`<b>` → 私有标记，
// 用来判"这一行是不是标题"。行内其余标签一律丢掉（正文里全是 `<span style>` 包裹）。
function ns_zspms_cdn_linesOf(html) {
	let s = String(html == null ? "" : html);
	s = s.replace(/<(strong|b)\b[^>]*>/gi, "\u0001").replace(/<\/(strong|b)\s*>/gi, "\u0002");
	s = s.replace(/<br\s*\/?>/gi, "\n");
	s = s.replace(/<\/(?:div|p|h[1-6]|li|ul|ol|tr|td|th|table|tbody|section|blockquote)\s*>/gi, "\n");
	s = s.replace(/<[^>]*>/g, "");
	s = decodeExtra(s);
	const out = [];
	for (const rawLine of s.split(/\r?\n/)) {
		const boldParts = rawLine.match(/\u0001[^\u0001\u0002]*\u0002/g) || [];
		const text = rawLine.replace(/[\u0001\u0002]/g, "").replace(/\u00a0/g, " ");
		const boldText = boldParts.join("").replace(/[\u0001\u0002]/g, "").replace(/\u00a0/g, " ");
		const sq = (x) => x.replace(/[ \t\u00a0]+/g, " ").trim();
		out.push({ text: sq(text), boldText: sq(boldText) });
	}
	return out;
}

// ── 一行里的档期 ──────────────────────────────────────────────────────────────
// 端点：`[YYYY年]M月D日[ HH:MM | 版本更新后…]`（年份可缺 → 借公告年，共用 `inferYear`）
// 连接符：`- — – ~ ～ 〜 至 到`（两侧允许空白；**不跨行** —— 本函数只在单行上跑）
const ns_zspms_cdn_POINT_RE = /(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(?:(\d{1,2})\s*[:：]\s*(\d{2})|(版本更新后|维护结束后|维护完成后|维护后|更新结束后|更新完成后|更新后))?/g;
const ns_zspms_cdn_CONNECTOR_RE = /^\s*[-–—－~～〜至到]\s*$/;
const ns_zspms_cdn_TIME_LABEL_RE = /(活动时间|开放时间|开启时间|持续时间|售卖时间|兑换时间|领取时间)\s*[:：]/;
// 维护窗口（停服/停机维护）**不是活动**：整行有这些词 ⇒ 一律不认（哪怕行里带「活动时间：」标签）。
// 语料实测：三篇真公告里「停服维护/维护更新」只出现在开头那段维护说明里，与「活动时间：」从不同行，
// 所以这条是无损的；写成条件式反而会漏掉「停服维护活动时间：…」这种拙劣写法。
const ns_zspms_cdn_MAINTENANCE_RE = /停服维护|停机维护|维护更新|版本更新维护/;

function ns_zspms_cdn_windowsOfLine(line, tz = ns_zspms_cdn_TZ, hint = null) {
	const s = String(line == null ? "" : line);
	const toks = [];
	ns_zspms_cdn_POINT_RE.lastIndex = 0;
	let m;
	while ((m = ns_zspms_cdn_POINT_RE.exec(s))) {
		if (m[0] === "") { ns_zspms_cdn_POINT_RE.lastIndex++; continue; }
		toks.push({
			start: m.index, end: m.index + m[0].length,
			y: m[1] != null ? +m[1] : null, mo: +m[2], d: +m[3],
			h: m[4] != null ? +m[4] : null, mi: m[5] != null ? +m[5] : null,
			rel: m[6] || ""
		});
	}
	const out = [];
	for (let i = 0; i + 1 < toks.length; i++) {
		const a = toks[i], b = toks[i + 1];
		if (!ns_zspms_cdn_CONNECTOR_RE.test(s.slice(a.end, b.start))) continue;
		if (b.rel) continue;                                            // 终点是相对表述 ⇒ 没有绝对时刻
		const ay = inferYear(a.y, a.mo, hint);
		let by = inferYear(b.y, b.mo, hint);
		if (ay == null || by == null) continue;                         // 无年份线索 ⇒ 不产出（不猜当前年）
		if (a.y == null && b.y == null && endsNextYear(a.mo, a.d, b.mo, b.d)) by = ay + 1;   // 跨年
		const startTs = a.rel ? null : sourceInstant(ay, a.mo, a.d, a.h == null ? 0 : a.h, a.mi == null ? 0 : a.mi, tz);
		const endTs = sourceInstant(by, b.mo, b.d, b.h == null ? 23 : b.h, b.mi == null ? 59 : b.mi, tz);
		if (startTs != null && !(endTs > startTs)) continue;           // 源站错行 ⇒ 丢掉，不硬造
		const endWall = sourceWallParts(endTs, tz);
		const sameYear = ay === endWall.y;
		const aRaw = s.slice(a.start, a.end).replace(/[ \t\u00a0]+/g, " ").trim();
		const bRaw = s.slice(b.start, b.end).replace(/[ \t\u00a0]+/g, " ").trim();
		const startText = startTs == null
			? (sameYear ? `${pad2(a.mo)}-${pad2(a.d)} ${a.rel}` : `${ay}-${pad2(a.mo)}-${pad2(a.d)} ${a.rel}`)
			: (sameYear ? fmtMdHm(startTs, tz) : fmtYmdHm(startTs, tz));
		const endText = sameYear ? fmtMdHm(endTs, tz) : fmtYmdHm(endTs, tz);
		out.push({
			startTs, endTs,
			raw: `${aRaw} ~ ${bRaw}`,
			display: `${startText} ~ ${endText}`,
			startRel: a.rel,
			startInferred: startTs == null,
			_from: a.start,
			_to: b.end
		});
	}
	return out;
}
// 整行是否"只有档期"（把档期原文剪掉后只剩列表符/空白/连接符）：
// `2026年11月19日10:00 - 2026年12月16日05:00` / `•2026年9月24日版本更新后 - 2026年11月4日05:00`
// 按**下标从右往左**剪，避免剪完一次让后面的下标错位（不能拿 raw 再 split —— 原文里可能本来就有 `~`）。
function ns_zspms_cdn_isBareWindowLine(line, wins) {
	let s = String(line == null ? "" : line);
	for (const w of wins.slice().sort((a, b) => b._from - a._from)) {
		s = s.slice(0, w._from) + s.slice(w._to);
	}
	s = s.replace(/^[\s\-–—－•·●◆◇▌▍|｜※]+/, "").replace(/[\s\-–—－~～〜至到:：]+/g, "");
	return s === "";
}

// ── 一篇公告正文 → 活动条目 ───────────────────────────────────────────────────
// `publishedAt` = 该篇发布时间（{ y, mo } 平移到 tz 的墙钟），只用于**补缺年份**。
// 返回 { items, skipped }；一条都没有**不抛错**（单篇无档期 ≠ 整份源坏了，见下面抓取器）。
function ns_zspms_cdn_activitiesOfArticle(html, tz = ns_zspms_cdn_TZ, publishedAt = null) {
	const lines = ns_zspms_cdn_linesOf(html);
	const hint = publishedAt && publishedAt.y != null ? { y: publishedAt.y, mo: publishedAt.mo } : null;
	const items = [];
	let skipped = 0;
	let section = "", sectionIsName = false, cur = "";
	for (const ln of lines) {
		const text = ln.text;
		if (!text) continue;
		const wins = ns_zspms_cdn_windowsOfLine(text, tz, hint);
		if (wins.length > 0) {
			const labelM = ns_zspms_cdn_TIME_LABEL_RE.exec(text);
			const bare = ns_zspms_cdn_isBareWindowLine(text, wins);
			const maint = ns_zspms_cdn_MAINTENANCE_RE.test(text);                // 维护窗口 ≠ 活动
			// 源站行首的 `【名】`（如 `•【勤务·限时任务】开放时间：…`）：比标题栈更贴近这一条
			const bracket = /^\s*[-–—－•·●◆◇▌▍|｜※]*\s*【([^】]{1,30})】/.exec(text);
			const bracketName = bracket ? ns_zspms_cdn_cleanName(bracket[1]) : "";
			for (const w of wins) {
				if (maint) { skipped++; continue; }
				if (!labelM && !bare) { skipped++; continue; }                    // 句子里的档期（多为卡池）
				const name = bracketName || cur || (sectionIsName ? section : "");
				if (!name) { skipped++; continue; }
				items.push({
					name,
					startTs: w.startTs,
					endTs: w.endTs,
					raw: w.raw,
					display: w.display,
					startRel: w.startRel,
					startInferred: w.startInferred,
					_i: items.length
				});
			}
		}
		// ── 标题行状态机（只在**整行加粗**的行上走）──
		// 大标题（`一、…` / `二、…`）：带 `——` 的是**容器**（`二、流光抛诸寰宇——新版内容&活动玩法`），
		//   里面的小标题才是活动名；不带 `——` 的本身就是活动名（`四、像素嚼嚼乐`）。
		// 小标题/名字行（`1）…` / `「揽光一瞬」`）：非通用名 ⇒ 成为后续档期的名字。
		if (ln.boldText && ln.boldText === text) {
			const isSection = /^[一二三四五六七八九十]{1,3}\s*[、.．]/.test(text);
			const name = ns_zspms_cdn_titleName(text);
			if (isSection) {
				section = name;
				sectionIsName = !!name && !/—/.test(name) && !ns_zspms_cdn_isGenericName(name);
				cur = "";
			} else if (name && !ns_zspms_cdn_isGenericName(name)) {
				cur = name;
			} else if (name && ns_zspms_cdn_isGenericName(name)) {
				// 通用小标题（`4）活动时间` / `1）活动说明`）⇒ 名字沿用上一层，不清空
			}
		}
	}
	return { items, skipped };
}

// ── 菜单 → 待抓的「版本更新公告」列表 ─────────────────────────────────────────
// 实测菜单字段：{ articleId, articleTitle, articleType, createTime, startTime, articleContent, … }
//   · 顺序**不是**时间序（置顶/推荐混在一起）⇒ 必须自己按发布时间倒序排
//   · `startTime` = 发布时间（`2026-11-03 17:26:05`），`createTime` 早于它 ⇒ 排序用前者、缺了退后者
function ns_zspms_cdn_menuRows(menu) {
	const list = Array.isArray(menu) ? menu
		: (menu && Array.isArray(menu.data) ? menu.data
			: (menu && Array.isArray(menu.list) ? menu.list : null));
	if (!Array.isArray(list)) throw new Error("zspms-cdn:bad-menu");
	const rows = [];
	for (const it of list) {
		if (!it || typeof it !== "object") continue;
		const id = Number(it.articleId);
		const title = String(it.articleTitle == null ? "" : it.articleTitle).trim();
		if (!Number.isFinite(id) || !title) continue;
		rows.push({
			id,
			title,
			type: Number(it.articleType) || 0,
			published: String(it.startTime || it.createTime || "").trim()
		});
	}
	if (rows.length === 0) throw new Error("zspms-cdn:empty-menu");
	return rows;
}
function ns_zspms_cdn_noticesOf(menu) {
	const rows = ns_zspms_cdn_menuRows(menu)
		.filter((r) => ns_zspms_cdn_NOTICE_TITLE_RE.test(ns_zspms_cdn_cleanName(r.title)));
	if (rows.length === 0) throw new Error("zspms-cdn:no-notice");        // 标题样式改版 = 结构性损坏
	// `YYYY-MM-DD HH:MM:SS` 定长 ⇒ 字符串倒序即时间倒序（不依赖时区换算）
	rows.sort((a, b) => (a.published < b.published ? 1 : a.published > b.published ? -1 : b.id - a.id));
	return rows;
}

// 详情 JSON → { title, published, html }
function ns_zspms_cdn_articleOf(json) {
	const o = Array.isArray(json) ? json[0] : json;
	if (!o || typeof o !== "object") throw new Error("zspms-cdn:bad-article");
	const html = typeof o.articleContent === "string" ? o.articleContent : "";
	if (!html) throw new Error("zspms-cdn:no-content");                   // 正文缺失 = 结构性损坏
	return { title: String(o.articleTitle || "").trim(), published: String(o.startTime || "").trim(), html };
}
// `2026-11-03 17:26:05` → { y, mo }（墙钟字段，只用来补缺年份）
function ns_zspms_cdn_hintOf(text, tz = ns_zspms_cdn_TZ) {
	const p = ns_bwiki_parsePoints(String(text == null ? "" : text))[0];
	if (!p) return null;
	const w = sourceWallParts(sourceInstant(p.y, p.mo, p.d, p.h, p.mi, tz), tz);
	return { y: w.y, mo: w.mo };
}

// ── 抓取器：菜单 → 最近 3 篇详情 → 合并 → 载荷 ─────────────────────────────────
// 契约与全仓一致：async (url, signal, tz, now = nowMs()) → 数据对象 | null
//   · 单篇详情抓失败 ⇒ 跳过这一篇（其余篇照用）；**全部**失败 ⇒ 抛错（抓取失败 ≠ 未公布）
//   · 三篇都解开但**一条档期都没有** ⇒ 抛 `zspms-cdn:no-window`（正文改版 = 结构性损坏）
//   · 有档期但都不覆盖 now ⇒ 返回 null（未公布；「起点未知」那批按仓库口径**不算**在期）
async function ns_zspms_cdn_events(url, signal, tz = ns_zspms_cdn_TZ, now = nowMs()) {
	const at = ns_bwiki_wikitext_nowOf(now);
	const menuUrl = String(url == null ? "" : url) || ns_zspms_cdn_MENU_URL;
	const notices = ns_zspms_cdn_noticesOf(await fetchJson(menuUrl, { signal, mode: "proxy" }));
	const items = [];
	const seen = new Set();
	let okCount = 0, firstErr = null;
	for (const row of notices.slice(0, ns_zspms_cdn_MAX_NOTICES)) {
		let article;
		try {
			article = ns_zspms_cdn_articleOf(await fetchJson(ns_zspms_cdn_articleUrl(row.id), { signal, mode: "proxy" }));
		} catch (e) {
			if (!firstErr) firstErr = e;
			continue;
		}
		okCount++;
		const hint = ns_zspms_cdn_hintOf(article.published || row.published, tz);
		const parsed = ns_zspms_cdn_activitiesOfArticle(article.html, tz, hint);
		for (const x of parsed.items) {
			const key = `${x.name}|${x.startTs == null ? "open" : x.startTs}|${x.endTs}`;
			if (seen.has(key)) continue;                                 // 相邻两版公告重复列同一活动
			seen.add(key);
			items.push({ ...x, _i: items.length });
		}
	}
	if (okCount === 0) { if (firstErr) throw firstErr; throw new Error("zspms-cdn:no-article"); }
	if (items.length === 0) throw new Error("zspms-cdn:no-window");       // 正文改版 = 结构性损坏
	// 外显：**两端都明确且覆盖 now**（`coversNow` 唯一真源；「版本更新后」那批不冒充在期）
	const live = items.filter((x) => coversNow(x, at));
	if (live.length === 0) return null;
	const cmp = ns_bwiki_wikitext_zspmsEventCmp;                          // 与 bwiki 活动侧同一优先序
	const first = live.slice().sort(cmp)[0];
	// 悬停/数组：在期 + 「起点未知但终点未过」（`coveredOrOpen`，事实层）—— 按结束时间升序
	const hoverItems = items.filter((x) => coveredOrOpen(x, at))
		.sort(cmp)
		.map((x) => ({ title: x.name, startTs: x.startTs, endTs: x.endTs, raw: x.raw }));
	const hover = hoverTextFromItems(hoverItems, "event", tz);
	const out = {
		event: first.name,
		eventDates: first.display,
		eventDatesRaw: first.raw,
		...(hover ? { eventHover: hover } : {})
	};
	out.events = dataArrayProducedEventsOf(out, hoverItems, { id: "zspms", tz }, at);
	out.eventHoverItems = hoverItems;
	return out;
}
