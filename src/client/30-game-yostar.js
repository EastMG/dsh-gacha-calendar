// src/client/30-game-yostar.js —— 悠星（星塔旅人）
//
// ⚠️ 2026-10-03 重组（用户要求「28 款一视同仁」）：不再有「内置 11 款 / 另外 17 款」的文件分层，
//    每款/每组游戏一个**自包含**文件（条目 + 解析器 + 抓取器 + 登记）。
//    本次只挪位置，**符号名一个都没改** —— 所以导出表、注册表快照、所有用例都不受影响。
//
// ⚠️ 这些文件在 core 产物里位于 `createEngine` **内部**，每建一个引擎都会重跑一遍 →
//    对 `SOURCES` 的写操作**必须幂等**（统一走 `registerSource`，它按 id 找到就合并、否则追加）。


		// ══ 以下为原 42-parsers-stellasora.js 的内容（原样保留；压平后见 30-game-yostar.js）══
// 原 src/client/35-parsers-stellasora.js（压平后见 30-game-yostar.js）
//
// 由 next-sources/parsers/stellasora.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_stellasora__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// 原 src/client/35-parsers-stellasora.js（压平后见 30-game-yostar.js） —— 星塔旅人 国服（悠星官方 CMS API）
//
// 来源（2026-10-02 实测「已验证可达」）：
//   类型目录  GET /api/resource/news-type
//   列表      GET /api/resource/news?index=1&size=N&type=<latest|notice|news|activity>
//   详情      GET /api/resource/news/<id>
//   同源反代 —— bundle 原文：`const Ye="/"; function j(s){return x({url:`${Ye}api/${s}`})}`
//   （⚠️ 真实 host 是**官网同源**，不是独立 API 域名；我先前试 `*.yostar.net` 等全 DNS 不可达）
//
// 可抓取性：服务端裸 GET，**无 token / 无签名**；响应 **无 ACAO** → 必须 mode:"proxy"
//
// 时区：Asia/Shanghai
//   · publishTime 是 epoch ms，直接是绝对时刻，无需换算
//   · 正文档期是**国服墙钟**（如 `2026/10/01 04:00 ~ 2026/10/31 03:59`，04:00 日切 = 国服特征）
//   · ⚠️ 源站**未显式标注时区** → 标「推测」
//     ⚠️ 「时区是推测」这类实现说明**只留在代码注释里**，**绝不进悬停文本**
//        （用户 2026-10-03：悬停里的元信息——来源站名/URL/时区推定/抓取条数/内部 id/实现说明——彻底删掉）。
//
// ── 列表里哪个分类装什么（实测）──────────────────────────────
//   type=notice   (349 条)  ← **卡池 + 活动说明**都在这里，本解析器主用
//   type=latest   (366 条)  同上 + 新闻
//   type=activity (15 条)   基本是**线下/周边**（BW 展会、联动、周边上新）→ 不作为游戏内活动
//   type=news     (2 条)    首曝/定档类新闻
//
// ── 详情正文的档期形态（实测）────────────────────────────────
//   `▌招募时间<br>2026/09/29 维护结束后 ~ 2026/10/20 10:59<br>`
//   `▌开放时间<br>2026/09/01 04:00 ~ 2026/10/01 03:59<br>`
//   `▌售卖时间<br>2026/10/01 04:00 ~ 2026/10/31 03:59<br>`
//   ⇒ 统一形态：`▌<环节>时间<br> <起点> ~ <终点>`；起点可能是「维护结束后」（相对锚点）
//
//   ⚠️ 起点是「维护结束后」时**没有绝对时刻**：用该公告的 publishTime 当锚点，
//      并标 `startInferred: true`。绝不硬造一个假时刻。

const ns_stellasora_STELLA_BASE = "https://stellasora.yostar.cn";
const ns_stellasora_STELLA_TZ = "Asia/Shanghai";   // 推测：源站未标注，但 04:00 日切与国服一致

// ── 列表扫描深度（2026-11-09 修 P1）──
// 旧实现只扫列表**前 20 条**。live 11-09 实测：当期两口池（「乘光而起的星之砂」角色池 /
// 「若能触及那片繁星」秘纹池）已掉到原始行序 #16/#17（0 基 #15/#16）—— 11-10 那批公告一到
// 就会被挤出前 20 ⇒ `gacha` 整条变 null（"卡池会整条消失"）。
// 现在：一页 **50 条**，且**只在还没扫到"上一期已结束"时才翻第 2 页**（见 collectStellaSide），
// 最多 2 页 —— 接口支持 index/size 分页，但不无限翻。
const ns_stellasora_STELLA_SCAN_SIZE = 50;
const ns_stellasora_STELLA_SCAN_PAGES = 2;

function ns_stellasora_stellaListUrl(type = "notice", size = ns_stellasora_STELLA_SCAN_SIZE, index = 1) {
	return `${ns_stellasora_STELLA_BASE}/api/resource/news?index=${index}&size=${size}&type=${type}`;
}
function ns_stellasora_stellaDetailUrl(id) {
	return `${ns_stellasora_STELLA_BASE}/api/resource/news/${id}`;
}

// 列表第 index 页的地址。
// ⚠️ 为什么在这里改写 `size` 而不是改注册表里的 URL：`src` 的 url 是**用户可在设置页改的源地址**
//    （历史值是 size=20），但"扫多深"是解析器的实现口径 —— 用户把地址改回 size=20 不该让挑池
//    静默退回旧深度。所以 size 一律由本解析器钉死为 SCAN_SIZE，index 跟着翻页走。
// ⚠️ 只改写星塔自家 API（yostar.cn）：自定义成别的地址时第 1 页原样用、也不翻页（不猜别人的分页参数）。
function ns_stellasora_stellaPageUrl(url, index) {
	const raw = String(url || "");
	let parsed = null;
	try { parsed = new URL(raw); } catch { return index === 1 ? raw : null; }
	if (!/(^|\.)yostar\.cn$/i.test(parsed.hostname)) return index === 1 ? raw : null;
	parsed.searchParams.set("size", String(ns_stellasora_STELLA_SCAN_SIZE));
	parsed.searchParams.set("index", String(index));
	return parsed.toString();
}

// ── 正文 → 纯文本（保留 `<br>` 换行；档期是 `<br>` 分隔的，不能直接压成空格）──
function ns_stellasora_brText(html) {
	let t = String(html == null ? "" : html);
	t = t.replace(/<br\s*\/?>/gi, "\n");
	t = t.replace(/<\/(?:p|div|li|tr|h\d)>/gi, "\n");
	t = t.replace(/<[^>]+>/g, "");
	t = decodeEntities(t);
	t = t.replace(/[ \t\u00a0\u3000]+/g, " ");
	return t.trim();
}

// ── 日期令牌子 ──
// `2026/09/29 09:00` / `2026-09-29 09:00` / `09/29 09:00`（省年份，用锚点年）
const ns_stellasora_YMD_RE = /(?:(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2}))(?:\s*(\d{1,2}):(\d{2}))?/;
const ns_stellasora_MD_RE = /(?<!\d)(\d{1,2})[\/\-.](\d{1,2})(?:\s*(\d{1,2}):(\d{2}))?/;
const ns_stellasora_REL_START_RE = /维护结束后|维护后|更新结束后|更新后/;

// ⚠️ 必须先"挖掉"已匹配的完整年月日，再找省略年份的月日。
//    否则 `2026/09/29 维护结束后` 里的 `09/29` 会被 ns_stellasora_MD_RE 当成"省年份的月日"匹配到，
//    于是走错分支、把「维护结束后」的相对锚点丢掉（本仓库实测踩过这个坑）。
function ns_stellasora_maskYmd(s) {
	return s.replace(new RegExp(ns_stellasora_YMD_RE.source, "g"), (m) => "\u0000".repeat(m.length));
}

// 从一段文本解析一个「起点 ~ 终点」区间。返回 { startTs, endTs, raw, startInferred } 或 null
function ns_stellasora_parseStellaWindow(segText, tz = ns_stellasora_STELLA_TZ, anchorTs = null) {
	const s = String(segText == null ? "" : segText).replace(/\s*\n\s*/g, " ").trim();
	if (!s) return null;
	// 先看有没有显式区间分隔符
	const sepMatch = /[~～〜－—–]/.exec(s);
	const anchorParts = anchorTs != null ? sourceWallParts(anchorTs, tz) : null;

	// ① 起点：相对锚点（「维护结束后」）优先于裸日期 → 绝对日期（完整年月日） → 绝对日期（省年份）
	//
	// ⚠️ 顺序很重要：源站写的是 `2026/09/29 维护结束后 ~ 2026/10/20 10:59` —— **日期与「维护结束后」同时出现**。
	//    若让 ns_stellasora_YMD_RE 先命中，起点会变成 `09-29 00:00`（那天零点），但真实开局是**维护结束**那一刻。
	//    故「维护结束后」优先，用公告发布时刻当锚点并标 startInferred
	//    （与仓库既有惯例一致：FGO 的 `即日起` / 绝区零的 `4.6版本更新后` 起点都标 inferred 并写进 raw）。
	//    未出现该词时，`2026/10/01 04:00` 这类显式起点照常按原样解析。
	//    ⚠️ 2026-10-03：`startInferred` **只作内部标记**（供 raw / 调试用），**不再写进悬停** ——
	//       旧悬停里的「（起点按公告发布时刻推断）」是**实现说明**，用户要求元信息彻底删掉。
	let startTs = null, startInferred = false, startRaw = "";
	const relMatch = ns_stellasora_REL_START_RE.exec(s);
	const head = sepMatch ? s.slice(0, sepMatch.index) : s;
	const ymd1 = ns_stellasora_YMD_RE.exec(head);
	const md1 = !ymd1 ? ns_stellasora_MD_RE.exec(ns_stellasora_maskYmd(head)) : null;

	if (relMatch && anchorTs != null) {
		// 「维护结束后」：用公告发布时刻当锚点，并标记为推断值
		startTs = anchorTs;
		startInferred = true;
		startRaw = relMatch[0];
	} else if (ymd1) {
		startTs = sourceInstant(+ymd1[1], +ymd1[2], +ymd1[3], ymd1[4] != null ? +ymd1[4] : 0, ymd1[5] != null ? +ymd1[5] : 0, tz);
		startRaw = ymd1[0];
	} else if (md1 && anchorParts) {
		startTs = sourceInstant(anchorParts.y, +md1[1], +md1[2], md1[3] != null ? +md1[3] : 0, md1[4] != null ? +md1[4] : 0, tz);
		startRaw = md1[0];
	} else if (relMatch) {
		// 「维护结束后」但**没有锚点** → 无法定位绝对时刻 → 交给下面的 null 分支（不硬造）
		startTs = null;
	}

	// ② 终点（必须在分隔符之后）
	let endTs = null, endRaw = "";
	if (sepMatch) {
		const tail = s.slice(sepMatch.index + sepMatch[0].length);
		const ymd2 = ns_stellasora_YMD_RE.exec(tail);
		const md2 = !ymd2 ? ns_stellasora_MD_RE.exec(ns_stellasora_maskYmd(tail)) : null;
		if (ymd2) {
			endTs = sourceInstant(+ymd2[1], +ymd2[2], +ymd2[3], ymd2[4] != null ? +ymd2[4] : 23, ymd2[5] != null ? +ymd2[5] : 59, tz);
			endRaw = ymd2[0];
		} else if (md2) {
			// 省年份：月份比起点小（或同月日更小）→ 跨年
			let y = anchorParts ? anchorParts.y : null;
			const sParts = startTs != null ? sourceWallParts(startTs, tz) : null;
			if (sParts) {
				y = sParts.y;
				if (+md2[1] < sParts.mo || (+md2[1] === sParts.mo && +md2[2] < sParts.d)) y = sParts.y + 1;
			}
			if (y != null) {
				endTs = sourceInstant(y, +md2[1], +md2[2], md2[3] != null ? +md2[3] : 23, md2[4] != null ? +md2[4] : 59, tz);
				endRaw = md2[0];
			}
		}
	}

	if (startTs == null || endTs == null) return null;
	if (!(endTs > startTs)) return null;
	return { startTs, endTs, raw: s, startInferred };
}

// ── 正文 → 全部带标签的档期 ──
// 返回 [{ label, startTs, endTs, raw, startInferred }]，按出现顺序
function ns_stellasora_parseStellaWindows(html, tz = ns_stellasora_STELLA_TZ, anchorTs = null) {
	const text = ns_stellasora_brText(html);
	const out = [];
	// `▌<标签>时间` 后面紧跟一段（到下一个 ▌ 或结尾）
	const marks = [...text.matchAll(/▌\s*([^\n]{0,20}?时间)\s*\n?([^\n]*)/g)];
	for (const m of marks) {
		const label = m[1].replace(/\s+/g, "");
		const seg = (m[2] || "").trim();
		const w = ns_stellasora_parseStellaWindow(seg, tz, anchorTs);
		if (w) out.push({ label, ...w });
	}
	// 兜底：正文里存在「A ~ B」但没有 ▌标签
	if (out.length === 0) {
		for (const line of text.split("\n")) {
			const w = ns_stellasora_parseStellaWindow(line, tz, anchorTs);
			if (w) out.push({ label: "", ...w });
		}
	}
	return out;
}

// ── 分类：招募（卡池） / 活动 ──
// 实测标题形态：
//   卡池  「空白的稚梦」限时招募开启 / 「沐于温情笑意中」限时招募开启
//   活动  「猎影合围Beta」活动说明 / 「月华窃梦人」活动说明 / 「联合讨伐」活动说明
//         ⚠️ 外显与悬停**只写去掉尾部「活动说明」的名字**（`ns_stellasora_stellaEventName`）：
//            「活动说明」是公告体裁，不是活动名的一部分（2026-11-09 用户要求）。
//   排除  维护更新说明 / 版本内容一览 / 版本活动一览 / 概率公示
function ns_stellasora_stellaIsGacha(title) {
	return /招募/.test(String(title || ""));
}
function ns_stellasora_stellaIsEvent(title) {
	const t = String(title || "");
	if (ns_stellasora_stellaIsGacha(t)) return false;
	if (/维护|更新说明|版本内容|版本活动一览|概率公示|封禁|处罚|问卷/.test(t)) return false;
	return /活动说明|活动开启|活动一览|活动预告/.test(t) || /活动/.test(t);
}
// 活动标题 → 活动名：**只在词尾**去掉「活动说明」四字（前面可能有半角/全角空格）。
// 源站标题一律是 `「联合讨伐」活动说明`，而「活动说明」是**公告体裁**不是活动名的一部分
// ⇒ 外显与悬停都只写 `「联合讨伐」`（2026-11-09 用户要求）。
// ⚠️ 判据钉在**词尾**且要求「活动说明」四字连续，否则会误伤名字里本来就含"说明"的活动：
//    反例 `「创业激励基金」说明`（尾是「说明」）、`「说明会」活动开场`（"说明"在名字里）—— 一律原样保留。
// ⚠️ 去完变空（标题只剩「活动说明」）时退回原串，不产空名。
function ns_stellasora_stellaEventName(title) {
	const t = String(title == null ? "" : title).trim();
	return t.replace(/[ \t\u00a0\u3000]*活动说明$/, "").trim() || t;
}

// 卡池标题 → 干净的卡池名：去掉「限时招募开启」等尾巴
function ns_stellasora_stellaGachaName(title) {
	return String(title || "").replace(/(限时|限定)?招募(开启|说明|一览)?[！!。.]?$/, "").trim() || String(title || "").trim();
}

// 卡池正文 → 该池 UP 主推的「名字 + 类别词」（悬停「池名：X」的右半边 / 角色池的 roles）。
// 实测形态（详情首段，**招募说明**里紧跟其后）：
//   「…全新5星旅人「艾蕾」招募概率提升！」          → { name: 艾蕾,  category: 旅人 }
//   「…全新5星秘纹「睡前童话」招募概率提升！」      → { name: 睡前童话, category: 秘纹 }
// 只取**首个**匹配（4 星行一定写在 5 星行之后，如「活动期间，4星旅人「师渺」「璟麟」…」）；
// 抓不到就返回 `{ name: "", category: "" }`，悬停行退回只写池名 —— 与本体
// `label = banner + (roles ? "：" + roles : "")` 同构，**绝不臆造**一个角色名。
//
// ⚠️ 2026-11-09（A 项）：源站的 5 星名字**不都是角色** —— 秘纹池给的是秘纹名（星之所向 / 睡前童话）。
//    所以这里比旧版多捕获一个**类别词**（`旅人` / `秘纹`），由 `stellaRolesOf` 决定要不要写进 roles。
//    悬停仍用 `name`（秘纹池照旧显示秘纹名：`「空白的稚梦」：睡前童话`，这是既有口径、本任务不改）。
const ns_stellasora_STELLA_NEW_FIVE_STAR_RE = /全新\s*5\s*星([^「」]{0,8})「([^「」]{1,24})」/;
const ns_stellasora_STELLA_FIVE_STAR_RE = /5\s*星([^「」]{0,8})「([^「」]{1,24})」/;
function ns_stellasora_stellaFeatured(html) {
	const t = ns_stellasora_brText(html);
	const m = ns_stellasora_STELLA_NEW_FIVE_STAR_RE.exec(t) || ns_stellasora_STELLA_FIVE_STAR_RE.exec(t);
	return m ? { name: m[2].trim(), category: m[1].trim() } : { name: "", category: "" };
}
function ns_stellasora_stellaFeaturedName(html) {
	return ns_stellasora_stellaFeatured(html).name;
}
// UP 是不是**角色**：源站把角色池写成「5星旅人」、秘纹池写成「5星秘纹」。
// 正判据（必须命中「旅人」）而不是"排除秘纹"：以后源站多出别的类别词时，
// 宁可**不写** roles（外显退回池名），也不要塞一个不是角色的名字进去。
function ns_stellasora_stellaRolesOf(featured) {
	const f = featured || {};
	return /旅人/.test(f.category || "") ? (f.name || "") : "";
}

// ── 列表解析 ──
// `order` = **解析时记住的原始行序**（这一段响应里的第几行，0 基）。挑池的最后一档排序键用它 ——
// 旧实现拿 `row.id` 倒序当兜底（= 谁后发谁上），那是 id 的偶然性，不是"文档顺序"。
// 翻页时调用方传入 `orderBase`，让第 2 页的行序接在第 1 页后面（跨页仍是一个全序）。
function ns_stellasora_parseStellaList(json, orderBase = 0) {
	if (!json || json.code !== 0 || !json.data || !Array.isArray(json.data.rows)) throw new Error("stella-bad-json");
	return json.data.rows
		.filter((x) => x && x.id != null)
		.map((x, i) => ({
			id: x.id,
			title: decodeEntities(String(x.title || "")).trim(),
			publishTs: typeof x.publishTime === "number" ? x.publishTime : null,
			type: x.type || "",
			typeLabel: x.typeLabel || "",
			url: x.link || "",
			order: orderBase + i
		}))
		.sort((a, b) => (b.publishTs || 0) - (a.publishTs || 0));
}

// ── 卡池挑池的排序键（**全仓通用口径** + 星塔唯一一条特例）──────────────────────
// 通用口径（与 `50-refresh.js` 的 `dataArraySortOf`、`81-schedule-model.js` 的 `sideViewOf`、
// `26-parser-hover.js` 的 `poolHoverOrderOf` **同一个键**）：
//     在期里「结束最早」→「起点升序」→「文档顺序」
//   · 结束最早：越快结束越该被盯住；
//   · 起点升序：同一结束时间里先开始的那池已经开着了（不是"下一个"）；
//   · 文档顺序：两键全等时按解析时的**原始行序**（`row.order`），不是 id 倒序。
//     ⚠️ 旧实现就是 `b.row.id - a.row.id`（id 大者胜 = 谁后发谁上），这正是 P0 的根因之一。
//
// 星塔特例（插在"起点也相同"之后、"文档顺序"之前）：**窗口完全相同时优先"有角色的池"**。
//   为什么必须特例：源站把「角色池」和「秘纹池」写成**同一段档期**（live 11-09 实测：
//   「乘光而起的星之砂」角色池 = 火垂 与「若能触及那片繁星」秘纹池 = 星之所向，
//   两池都是 `2026/10/27 12:00 ~ 2026/11/17 10:59`，绝对时刻逐毫秒相同）。
//   此时"结束/起点"两键全等 ⇒ 只剩文档顺序能分胜负，而文档顺序 = 谁先发谁上 ⇒
//   一个**秘纹池**会顶掉角色池当外显、角色池被挤成并列条（用户看到的正是这一条）。
//   窗口全等 ⇒ 两池对用户就是"同一期"，这一期该露的是**带角色的**那口：角色池有角色名，
//   秘纹池只有池名，信息量严格更大。**窗口不等时不插手** —— 那样的两池是不同的一期，
//   "结束最早 → 起点升序"仍是唯一口径（10-02 夹具就是这种：两池起点因 C 项的锚点偏差
//   相差 847ms，故按通用口径选早开始的那池，与悬停首行一致）。
function ns_stellasora_stellaPickOrderOf(a, b) {
	const ea = a.win.endTs == null ? Infinity : a.win.endTs;
	const eb = b.win.endTs == null ? Infinity : b.win.endTs;
	if (ea !== eb) return ea - eb;
	const sa = a.win.startTs == null ? Infinity : a.win.startTs;
	const sb = b.win.startTs == null ? Infinity : b.win.startTs;
	if (sa !== sb) return sa - sb;
	const ra = a.roles ? 1 : 0;
	const rb = b.roles ? 1 : 0;
	if (ra !== rb) return rb - ra;   // 有角色的池在前
	return (a.row.order == null ? 0 : a.row.order) - (b.row.order == null ? 0 : b.row.order);
}

// 「扫到上一期了」：本页里出现**已经结束**的档期（`endTs < now`）。
// 列表按发布时间倒序 ⇒ 再往后只会更早，没必要继续翻页。这是"翻页直到覆盖到上一期已结束"的判据。
function ns_stellasora_seenEndedPeriod(candidates, now) {
	return candidates.some((c) => c.win.endTs != null && c.win.endTs < now);
}

// ── 抓详情并按标题分流，选出「覆盖 now」的条目 ──
// side: "gacha" | "event"
// 返回 { picked, covering } 或 null
async function ns_stellasora_collectStellaSide(url, signal, tz, now, side) {
	const want = side === "gacha" ? ns_stellasora_stellaIsGacha : ns_stellasora_stellaIsEvent;
	const candidates = [];
	const seenIds = new Set();
	const baseUrl = url || ns_stellasora_stellaListUrl("notice", ns_stellasora_STELLA_SCAN_SIZE, 1);
	let orderBase = 0;
	// 逐页扫（一页 SCAN_SIZE 条）：列表按发布时间倒序，每篇抓一次详情。
	// 翻页条件见文件头的 SCAN_SIZE 说明：**只在还没扫到"上一期已结束"时**才翻，最多 SCAN_PAGES 页。
	for (let page = 1; page <= ns_stellasora_STELLA_SCAN_PAGES; page++) {
		const pageUrl = ns_stellasora_stellaPageUrl(baseUrl, page);
		if (!pageUrl) break;
		let json = null;
		try {
			json = await fetchJson(pageUrl, { signal, mode: "proxy" });
		} catch (e) {
			if (page === 1) throw e;   // 第 1 页失败 = 这一侧失败（与旧行为一致）
			break;                     // 第 2 页失败不拖垮整体：用第 1 页的结果说话
		}
		const list = ns_stellasora_parseStellaList(json, orderBase);
		orderBase += list.length;
		if (list.length === 0) break;
		for (const row of list) {
			if (seenIds.has(row.id)) continue;   // 两页之间理论上不重叠，防一手
			seenIds.add(row.id);
			if (!want(row.title)) continue;
			let detail = null;
			try {
				const dj = await fetchJson(ns_stellasora_stellaDetailUrl(row.id), { signal, mode: "proxy" });
				detail = dj && dj.code === 0 && dj.data && dj.data.news ? dj.data.news : null;
			} catch { continue; }   // 单篇失败不拖垮整体
			if (!detail) continue;
			const anchorTs = row.publishTs != null ? row.publishTs : null;
			const wins = ns_stellasora_parseStellaWindows(detail.content, tz, anchorTs);
			// featured：该篇正文里的 UP 主推（悬停「池名：X」用；活动侧不用）
			const feat = ns_stellasora_stellaFeatured(detail.content);
			const featured = feat.name;
			// roles：**该池的 UP 角色**（A 项）。秘纹池留空 —— 它的 UP 是秘纹不是角色；
			// 见 ns_stellasora_stellaRolesOf。活动侧一律不写。
			const roles = side === "gacha" ? ns_stellasora_stellaRolesOf(feat) : "";
			for (const w of wins) candidates.push({ row, win: w, featured, roles });
		}
		if (ns_stellasora_seenEndedPeriod(candidates, now)) break;   // 已经扫到上一期 ⇒ 不再翻页
	}
	if (candidates.length === 0) return null;
	// 覆盖 now 的里，取「结束最早 → 起点升序 → （同窗口：有角色的池优先）→ 文档顺序」的那条（B 项）。
	// 活动侧的挑法是既有口径（起点最新，并列时终点更晚），本任务不动它；只把 id 倒序换成文档顺序。
	const covering = candidates.filter((c) => coversNow(c.win, now));
	if (covering.length === 0) return null;
	if (side === "gacha") covering.sort(ns_stellasora_stellaPickOrderOf);
	else covering.sort((a, b) => (b.win.startTs - a.win.startTs) || (b.win.endTs - a.win.endTs)
		|| ((a.row.order == null ? 0 : a.row.order) - (b.row.order == null ? 0 : b.row.order)));
	return { picked: covering[0], covering };
}

// ── 悬停 ──────────────────────────────────────────────────────────
// 一律走 `lib/env.js` 的 hoverPool / hoverEvent（压平后见 28-parser-hover-tools.js；与本体 buildPoolHover / buildEventHover **逐字同格式**）。
//
// 为什么不再自己拼字符串（2026-10-03 修，用户点名「新增游戏的悬停样式/格式/规则和原来的差别很大」）：
//   ① 旧实现把**元信息/实现说明**塞进了悬停 —— 主要是行尾的「（起点按公告发布时刻推断）」，
//      那本是 `startInferred` 的**实现说明**。本体条目**从不**在悬停里写这些 →
//      **直接删掉，且不改放到别的字段**；说明只留在本文件注释里（见 ns_stellasora_parseStellaWindow 与下方 ③）。
//   ② 旧实现是「档期在前、名称在后」；本体一律 `名称 + 3 空格 + 档期` → 交回 hoverEvent 排版。
//   ③ `startInferred` 的**判定逻辑原样保留**（「维护结束后」→ 用该公告 publishTime 当锚点，
//      不硬造时刻）；变的只是"不再把它写成悬停文案"。
//
// 卡池池项：`{ name, label, roles, startTs, endTs, raw }`。
//   name  = 池名（与面板外显 `banner` 同一个字符串）
//   label = 「池名：UP」（UP 抓不到就 = 池名）—— 与本体 `label = banner + (roles ? "：" + roles : "")` 同构
//   roles = 该池的 UP **角色**名（A 项；秘纹池为 ""）。**每个池条目都写**，不再让主条靠
//           `50-refresh.js` 从 `rec.roles` 反算——那条路在解析器不写 roles 时必然回退成池名（P0）。
function ns_stellasora_stellaPoolItems(covering) {
	return covering.map((c) => {
		const name = ns_stellasora_stellaGachaName(c.row.title);
		return {
			name,
			label: c.featured ? `${name}：${c.featured}` : name,
			roles: c.roles || "",
			startTs: c.win.startTs,
			endTs: c.win.endTs,
			raw: c.win.raw
		};
	});
}

// 活动项：`{ name, startTs, endTs, raw }`。**排序由调用方负责**（hoverEvent 不排序），
// 这里照本体 sortEventItems 同序：结束时间升序（越快结束越靠前），同结束时间再按开始时间升序。
// 名称走 `ns_stellasora_stellaEventName`（去掉尾部「活动说明」）—— 与下面外显 `event` 同一个函数，
// 保证「外显能看到的活动名」在悬停里一定看得到、且逐字相同。
function ns_stellasora_stellaEventItems(covering) {
	return covering
		.map((c) => ({ name: ns_stellasora_stellaEventName(c.row.title), startTs: c.win.startTs, endTs: c.win.endTs, raw: c.win.raw }))
		.sort((a, b) => (a.endTs - b.endTs) || (a.startTs - b.startTs));
}

// ── 卡池侧 ──
async function ns_stellasora_gachaStellasora(url, signal, tz = ns_stellasora_STELLA_TZ, now = nowMs()) {
	const got = await ns_stellasora_collectStellaSide(url, signal, tz, now, "gacha");
	if (!got) return null;
	const { picked, covering } = got;
	// ⚠️ 卡池列的悬停字段是 **bannerHover**（面板 `title: g.bannerHover || gachaTitle`；
	//    50-refresh 的 `pickFields(g.data, GACHA_FIELDS)` 也只留 bannerHover）——
	//    旧实现写的是 `eventHover`，运行时被丢弃 = 卡池悬停**根本没生效**。
	// ── P3b：条目事实 → 悬停 + `gacha` 数组（排序与 hoverPool 同一份：结束时间升序）──
	// ⚠️ 2026-11-09（A 项）：条目带上每池的 `roles`。`dataArrayProducedGachaOf` 的主条走
	//    `dataArrayGachaMainOf(rec)`，它读的是载荷上的 `roles` 字符串（`out.roles`，下面已写）——
	//    旧实现不写载荷 `roles` ⇒ 主条 `roles: []`、`show` 永远退回池名（P0 的另一半）。
	const gachaItems = ns_stellasora_stellaPoolItems(covering)
		.filter((p) => p.name)
		.sort(poolHoverOrderOf)
		.map((p) => ({ title: p.label || p.name, label: p.label || p.name, roles: p.roles || "", startTs: p.startTs, endTs: p.endTs, raw: p.raw }));
	const hover = hoverTextFromItems(gachaItems, "gacha", tz);
	const out = {
		banner: ns_stellasora_stellaGachaName(picked.row.title),
		// 主条的角色 = **被选中那口池**的 UP 角色（A 项：由解析器写，秘纹池为 ""）。
		// `50-refresh.js` 的 `dataArrayGachaMainOf` 据此算 `roles` 与 `show`：
		// 有角色 ⇒ show = 去修饰的角色名；没有（秘纹池）⇒ show = 池名。与本体 `cleanRoleNames` 同口径。
		roles: picked.roles || "",
		bannerDates: fmtWindow(picked.win.startTs, picked.win.endTs, tz),
		bannerDatesRaw: picked.win.raw,
		startTs: picked.win.startTs,
		endTs: picked.win.endTs,
		event: "",
		eventDates: ""
	};
	// 生成器在「当期池 < 2」时返回 ""：此时**不设** bannerHover，交回 UI 的默认两行式
	// 「池名：角色」⏎「档期」—— 不要自己再补一行，那正是与本体不一致的来源。
	if (hover) out.bannerHover = hover;
	out.gacha = dataArrayProducedGachaOf(out, gachaItems, { tz }, now);
	out.gachaHoverItems = gachaItems;
	return out;
}

// ── 活动侧 ──
async function ns_stellasora_eventsStellasora(url, signal, tz = ns_stellasora_STELLA_TZ, now = nowMs()) {
	const got = await ns_stellasora_collectStellaSide(url, signal, tz, now, "event");
	if (!got) return null;
	const { picked, covering } = got;
	// ── P3b：条目事实 → 悬停 + `events` 数组 ─────────────────────────────────
	const eventItems = ns_stellasora_stellaEventItems(covering).map((x) => ({ title: x.name, startTs: x.startTs, endTs: x.endTs, raw: x.raw }));
	const hover = hoverTextFromItems(eventItems, "event", tz);
	const out = {
		// 外显 = 该公告标题**去掉尾部「活动说明」**后的活动名（`「联合讨伐」活动说明` → `「联合讨伐」`）。
		// 悬停里的名称与它同源（同一个 `ns_stellasora_stellaEventName`），故「外显能看到的活动名」在悬停里一定看得到。
		event: ns_stellasora_stellaEventName(picked.row.title),
		eventDates: fmtWindow(picked.win.startTs, picked.win.endTs, tz),
		eventDatesRaw: picked.win.raw
	};
	// 生成器在「当期活动 < 2」时返回 ""：此时**不设** eventHover，
	// 交回 UI 的默认两行式「活动名」⏎「档期|原文」。
	if (hover) out.eventHover = hover;
	out.events = dataArrayProducedEventsOf(out, eventItems, { tz }, now);
	out.eventHoverItems = eventItems;
	return out;
}

// 供测试：从一篇详情 JSON 直接算档期
function ns_stellasora_stellaWindowsFromDetail(detailJson, tz = ns_stellasora_STELLA_TZ) {
	const n = detailJson && detailJson.data && detailJson.data.news;
	if (!n) throw new Error("stella-bad-detail");
	const anchorTs = typeof n.publishTime === "number" ? n.publishTime : null;
	return ns_stellasora_parseStellaWindows(n.content, tz, anchorTs);
}

		// ── 条目 ──
		registerSource({
				id: "stellasora",
				defaultHidden: false,
				tz: "Asia/Shanghai",
				name: "星塔旅人",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/54/82/12/548212d8-790c-241d-b11e-f588000cbaef/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
				url: "https://stellasora.yostar.cn/api/resource/news?index=1&size=20&type=notice",
				source: "官方公告",
				eventUrl: "https://stellasora.yostar.cn/api/resource/news?index=1&size=20&type=notice",
				eventSource: "官方公告",
				eventAltSources: [{"label":"Bwiki 首页活动日历（不可靠）","url":"https://wiki.biligame.com/stellasora/api.php?action=parse&page=首页&prop=text&format=json&formatversion=2","fetcher":"stellasora-bwiki"}],
		});

		// ══ 原 43-sources-register.js 里属于本组的登记代码（原样保留）══
		GACHA_FETCHERS["stellasora"] = (url, signal, tz) => ns_stellasora_gachaStellasora(url, signal, tz);

		EVENT_FETCHERS["stellasora"] = Object.assign(EVENT_FETCHERS["stellasora"] || {}, { default: (url, signal, tz) => ns_stellasora_eventsStellasora(url, signal, tz) });

		// ===== 登记备选源抓取器（键 = altSources/eventAltSources 的 fetcher 字段）=====

		// GACHA_FETCHERS 是**扁平**表 → 卡池备选源注册在顶层即可；

		// EVENT_FETCHERS 是**按条目 id 分组**的表 → 活动备选源必须注册进 EVENT_FETCHERS[<条目id>]。

		EVENT_FETCHERS["stellasora"] = EVENT_FETCHERS["stellasora"] || {};

		Object.assign(EVENT_FETCHERS["stellasora"], {

			"stellasora-bwiki": { default: (url, signal, tz) => ns_bwiki_eventsStellasora(url, signal, tz) },

		});
