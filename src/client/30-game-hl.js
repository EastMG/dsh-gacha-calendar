// src/client/30-game-hl.js —— 碧蓝航线：国服（hl，**只接活动**）+ 日服（hl-jp，卡池 + 活动）
//
// ── 本文件为什么长这样（用户 2026-11-15 拍板「方案 B」）────────────────────────────
// 国服与日服同款游戏、不同服、**不同站**，所以放同一个厂商级文件（`30-game-*` 家族，不是 bwiki 系）。
//   ① 国服 `id:"hl"`：**卡池侧不写来源**（`url: ""` + 不写 `source` ⇒ 设置页/面板显示「未配置」）；
//      活动侧 = B 站官方维护公告（biligame CMS）。标签逐字「官网公告」。
//   ② 日服 `id:"hl-jp"`：卡池与活动**同用**一条官方新闻列表（`/api/news/list`）。标签逐字「官网公告（日服）」。
//
// ── ① 国服为什么没有卡池源（已实测，别再来回找）────────────────────────────────────
//   · bwiki 的「限时建造存档区」最后编辑停在 2026-05-01（最新一期 2026.04.17~2026.05.01）；
//   · bwiki live 页 `建造模拟器/限时建造` 只有「概率 + 舰名」，**一个时间串都没有**（最后编辑 2026-09-27）；
//   · 客户端解包表没有当期池时间；GameKee `data:[]`；fandom 没有池表。
//   ⇒ 「能跟上当期的结构化卡池源」不存在。**不跨源拼接**（拿公告里的文字冒充"卡池源"会让来源标签撒谎），
//     按用户口径：卡池侧留空 = 未配置（面板显示「未配置」，不是失败、不抓取）。
//
// ── ② 国服活动源（2026-11-15 实测；夹具 test/fixtures/hl-cn-list / hl-cn-detail-18574）──
//   列表 `GET https://api.biligame.com/news/list?gameExtensionId=103&positionId=2&typeId=1&pageNum=1&pageSize=20`
//     → `{ request_id, data:[20 条], totalNum:476, pageNo:1, code:0, ts }`
//     条目 = `{ id, title, typeId, ctime, mtime, displayTime?, content(截断) }`
//     ⚠️ 列表**不是**按时间倒序：`1591`（2017 年的「概率公示」）置顶，真公告从第 2 条起才是倒序
//        ⇒ 自己按 `displayTime || ctime` 倒序（与 `30-game-biligame.js` 的 biligame-activity 同一口径）。
//     ⚠️ 只取标题命中「维护公告」的那几篇（实测 20 条里 19 篇是维护公告，1 篇是 2017 的置顶概率公示）。
//   详情 `GET https://api.biligame.com/news/{id}` → `{ data: { content(完整 HTML), title, displayTime, … } }`
//     正文是 Word 导出的富文本：**每个文字 run 一个 `<span>`**（`11月12日` 会被拆成 `1` + `1月12日`）
//     ⇒ 剥标签必须**不插分隔符**（本文件用 `stripTags`：`<br>` → 空格、其余标签 → 空串）。
//     用 `textOf`/`htmlText`（标签 → 空格）会把「11月12日」拆成「1 1月12日」，时间锚点就解析不出来。
//   正文里的档期写法（实测 4 篇）：
//     · `开启限时联动活动「开幕！天使们的碧蓝舞台」，活动时间11月12日维护后~11月26日23:59`
//     · `「JUUs动态」开启，活动时间11月12日维护后~11月26日23:59；`
//     · `「科研」系统开启蓝图补完计划「贝亚德」，活动时间11月5日维护后~12月3日维护`
//     · `开启限时复刻活动「限界挑战：天蝎座」，活动时间11月1日00:00~11月30日23:59`
//   ⇒ 活动名 = `活动时间` 锚点**前面最近的** `「…」`（没有引号就退到最后一个分句）；
//     起点 = 「维护后」+ 同篇顶部那句 `司令部将于11月12日10:00~15:00 … 改造建设` 的**结束时刻**
//     （源站明写，不是猜钟点；日期对不上 ⇒ 起点未知 ⇒ 不进外显）；
//     终点 = 写了 `23:59` 就用它；只写日期（含「~11月5日维护」）⇒ 按仓库通用约定 23:59。
//     `raw` 保留源站原文（`11月12日维护后 ~ 11月26日23:59`），`display` 是两端都明确时的 `fmtWindow`。
//
// ── ③ 日服源（2026-11-15 实测；夹具 test/fixtures/hl-jp-list）──────────────────────────
//   `GET https://www.azurlane.jp/api/news/list?index=1&size=10` → 200 JSON
//     `{ meta:{ v, ok, err:{code,msg} }, data:{ rows:[…], count:494 } }`
//     行 = `{ id, title, content(完整 HTML), publishTime(ms), type }`（type 3 = メンテナンス）
//   ⚠️ **`index` 的语义不是任务书写的「从 2 开始」**（2026-11-15 实测复核）：
//     站点自己的 SPA 用 `params:{ index: i.value, size: 10 }`，页号**从 1 起**；
//     但服务端分页 offset 少算 2 条（`offset = (index-1)*size - 2`，负数时**回绕**到列表末尾）：
//       · `index=1&size=10` → 末尾 2 条老行（2017 年）+ 最新 8 行 ✓  ← 本文件用这条
//       · `index=2&size=5`  → 从第 3 条起 ⇒ **漏掉最新两条**（771/770），只剩 10 月那批
//     所以「按任务书写 index=2&size=5」会得出"日服最新只有 10 月"的错误结论。解析器对前两行老行天然无感
//     （它们没有 `開催期間`，也过不了段首/年份判定）。
//   ⚠️ `index=0` → 500、`index=1`（不带 size）→ 400，别用。
//   正文里（每篇都是一次维护公告）：
//     · 池：`・「期間限定建造」を追加` / `下記の艦が期間限定建造で出現します。` + `開催期間：…` + 舰名行
//       （`風帆（前衛）「メルクーリィ」2% (pickup・先行実装)`）；**池名就写「期間限定建造」**，舰名进 roles。
//     · 活动：`・期間限定コラボイベント「開幕！天使たちのアズールステージ」開催` + `開催期間：…`。
//   日期形态：`11月12日(木)メンテナンス後～11月26日(木)23:59まで` / `…～12月3日(木)メンテナンスまで`
//     ⇒ 起点「メンテナンス後」= 同篇 `■実施時間` 那句 `11月12日(木)14:00 ～ 11月12日(木)20:00` 的**结束时刻**
//       （同日期才认；否则起点未知）；终点带时刻就用，只到「メンテナンスまで」⇒ 23:59（仓库通用约定）。
//   时区 = `Asia/Tokyo`（源站自身口径，不换算）。
//
// ── ④ 当期现状（2026-11-15 实测，必须如实写在这里）──────────────────────────────────
//   日服最新一篇 = 771（2026-11-10 发布 / 11-12 维护）：只有联动活动（11/12 20:00~11/26 23:59，
//   联动角色走**任务获取**）+ 継続中の「強化ユニットキャンペーン『バヤール』」（11/5~12/3）；
//   **这篇没有 期間限定建造 段**，最后一口限时池 = 769 的 10/22~11/5（已结束）。
//   ⇒ 真机 at 2026-11-15：日服**活动 2 条在期、卡池如实 null**（`ns_bwiki_batchGachaPayloadOf` 的
//     `coversNow` 只认两端明确且覆盖 now 的池，不硬凑过期档期）。把 now 放回 10-25 时卡池能出
//     `期間限定建造：メルクーリィ、セリミエ、ヤーンバアデン、オーメン・ランゲ`（回归用例钉住了这条）。
//   国服最新一篇 = 18574（11-12 维护）：「开幕！天使们的碧蓝舞台」11/12 15:00~11/26 23:59 在期 ✓。
//
// ── ⑤ 请求预算（用户口径：国服 1~2、日服 1~2，都按 id 缓存 TTL 24h）──────────────────
//   国服：列表 1 次 → **当期那篇**（按标题过滤 + 倒序，最多 2 篇）的详情 1 次 ⇒ 2 次；
//        详情正文按 id 缓存（TTL 24h）⇒ 稳态 1 次（只列表）。
//   日服：列表 1 次（行里**自带完整正文**，不需要详情）⇒ 1 次；每行解析结果按 id 缓存（TTL 24h）。
//        卡池侧与活动侧**同一条 URL**：`refreshAll` 一轮里两侧各调一次抓取器 ⇒ 用「轮内共享 Promise」
//        （`fetchRoundSeqOf` + 缓存 Promise，与 `30-game-cytq.js` / `30-game-cygames.js` 同一套）
//        把这一轮压成 1 次。轮外（设置页「测试来源」/ 离线用例直调）一律现取。
//
// ── ⑥ 失败语义（与全仓一致）────────────────────────────────────────────────────────
//   · HTTP 非 2xx ⇒ 抛（`fetchText` 自己抛 `http-…`）；
//   · 列表结构变了（`code !== 0` / 没有 `data` 数组 / 一条可用条目都没有；日服：`meta.ok === false` /
//     没有 `rows` / 一行正文都没有）⇒ **抛**（抓取失败 ≠ 未公布）；
//   · 详情结构变了（国服：没有 `data.content`；`{}` / 空串 / 改版页都落这里）⇒ **抛**；
//   · 正文正常但**没有任何时间锚点**（`活动时间` / `開催期間` 被抹掉）⇒ 不抛，这一篇就是"没有窗口"
//     （用户点名的反证：抹掉锚点 ⇒ 不进外显，也不该被当成失败）；
//   · 解出来了但没有任何窗口覆盖 now ⇒ `null`（未公布，不硬凑过期档期）。

//#region ① 常量
const ns_hl_TZ = "Asia/Shanghai";
const ns_hl_CN_LIST_URL = "https://api.biligame.com/news/list?gameExtensionId=103&positionId=2&typeId=1&pageNum=1&pageSize=20";
const ns_hl_CN_DETAIL_BASE = "https://api.biligame.com/news/";
// 列表/详情都带游戏官网首页当 Referer（与 biligame-activity 同口径；实测不带也 200，但不给源站留裸请求）
const ns_hl_CN_HOME = "https://game.bilibili.com/blhx/";
// 只往下抓几篇详情：当期活动在最上面那篇维护公告里（实测 11-12 那篇就有）；留 2 篇兜住"跨维护期的长档活动"
const ns_hl_CN_MAX_DETAILS = 2;
// 详情/行的解析结果缓存 TTL = 24h（用户口径）
const ns_hl_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 轮内列表复用的兜底上限（同 cytq / cygames 的 30s：一轮刷新不会跑这么久，超时即重取）
const ns_hl_ROUND_TTL_MS = 30000;
// 国服：标题里认这几种公告（实测只有「YYYY维护公告（…）」一种，放宽到"更新公告"以防改名）
const ns_hl_CN_TITLE_RE = /维护公告|更新公告/;
// 国服：维护窗（同篇顶部）：`司令部将于11月12日10:00~15:00 … 改造建设`
const ns_hl_CN_MAINT_RE = /司令部将于\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*[~～]\s*(\d{1,2})\s*[:：]\s*(\d{2})/;
// 国服：档期锚点（正文里只认这个标签；商店/礼包写的是「上架」「贩售」，不认）
const ns_hl_CN_ANCHOR = "活动时间";
// 日服
const ns_hl_jp_TZ = "Asia/Tokyo";
const ns_hl_jp_LIST_URL = "https://www.azurlane.jp/api/news/list?index=1&size=10";
const ns_hl_jp_ICON = "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/b0/e5/d1/b0e5d122-0fb4-c7cd-5512-5a798d5c2c78/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg";
const ns_hl_jp_SOURCE_LABEL = "官网公告（日服）";
// 池的段标题 / 活动的段标题（见文件头 ③；非贪婪取「…」里的名字；活动要求同一行有「開催」）
const ns_hl_jp_POOL_TITLE_RE = /「期間限定建造」|期間限定建造(?:の復刻)?(?:開催|を追加)/;
const ns_hl_jp_EVENT_TITLE_RE = /(?:期間限定)?(?:コラボ|ストーリー|海域)?イベント「([^」]{1,60})」/;
// 段首标记：`・`/`◇`/`【`/`■`/`●`/`◆` 开新段 ⇒ 清掉"窗口的归属"，免得商店/试穿的 `開催期間` 挂到上一个活动上
const ns_hl_jp_SECTION_START_RE = /^[・◇【■●◆]/;
// 池窗口后面的舰名行里的「…」
const ns_hl_jp_QUOTED_RE = /「([^「」]{1,24})」/;
//#endregion

//#region ② 国服：纯解析（列表 → 条目；详情 → 活动条目事实）
// 列表 JSON → [{ id, title, displayTime, ctime, sortKey, dateTs }]，严格按生效时刻倒序。
// 结构变了要抛（`{}` / code≠0 / 没有 data 数组 / 一条可用条目都没有）。
function ns_hl_cn_listOf(json) {
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("hl-cn-list-changed:bad-json");
	if (json.code !== 0) throw new Error("hl-cn-list-changed:code-" + String(json.code));
	if (!Array.isArray(json.data)) throw new Error("hl-cn-list-changed:no-data");
	const out = json.data
		.filter((x) => x && x.id != null && x.title)
		.map((x) => {
			const displayTime = String(x.displayTime || "");
			const ctime = String(x.ctime || "");
			const sortKey = displayTime || ctime;
			return {
				id: String(x.id),
				title: decodeExtra(String(x.title)).replace(/\s+/g, " ").trim(),
				displayTime,
				ctime,
				sortKey,
				dateTs: ns_hl_cn_stampOf(sortKey, ns_hl_TZ)
			};
		})
		.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
	if (out.length === 0) throw new Error("hl-cn-list-changed:empty");
	return out;
}
// `2026-11-11 10:00:00`（CMS 发布时刻，按条目 tz 解释墙钟）→ 绝对毫秒
function ns_hl_cn_stampOf(s, tz = ns_hl_TZ) {
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/.exec(String(s == null ? "" : s));
	if (!m) return null;
	return sourceInstant(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}
// 公告年份：标题里的 `（2026年11月12日10:00）` 优先，其次发布时刻的年份（都拿不到 ⇒ null，不猜）。
function ns_hl_cn_announceYear(post) {
	const m = /（\s*(\d{4})\s*年/.exec(String(post && post.title ? post.title : ""));
	if (m) return +m[1];
	const d = /^(\d{4})-/.exec(String(post && post.sortKey ? post.sortKey : ""));
	return d ? +d[1] : null;
}
// 详情正文 → 纯文本：**不插分隔符**（见文件头 ② 的 `<span>` 碎片问题）；实体再解一遍（`&times;` 等）
function ns_hl_cn_textOf(html) {
	return decodeExtra(stripTags(String(html == null ? "" : html)));
}
// 同篇维护窗 → `{ mo, d, endH, endMi }`（找不到 ⇒ null；起点「维护后」靠它补时刻）
function ns_hl_cn_maintOf(text) {
	const m = ns_hl_CN_MAINT_RE.exec(String(text == null ? "" : text));
	if (!m) return null;
	const mo = +m[1], d = +m[2], endH = +m[5], endMi = +m[6];
	if (mo < 1 || mo > 12 || d < 1 || d > 31 || endH > 23 || endMi > 59) return null;
	return { mo, d, endH, endMi };
}
// 一端文本（`11月12日维护后` / `11月26日23:59` / `12月3日维护`）→ 绝对毫秒（拿不到 ⇒ null）
//   · 带时刻 ⇒ 就用它；
//   · 起点相对（维护后/更新后/开服后）⇒ 同篇维护窗的结束时刻（**同日期才认**，否则起点未知）；
//   · 终点只有日期 ⇒ 23:59（仓库通用约定，含「~11月5日维护」这种写法）。
function ns_hl_cn_pointOf(text, year, maint, tz, isEnd) {
	const s = String(text == null ? "" : text);
	const md = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(s);
	if (!md) return null;
	if (year == null) return null;                        // 没有年份线索 ⇒ 不产出（不猜当前年）
	const mo = +md[1], d = +md[2];
	if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
	if (!isEnd && /维护后|更新后|开服后|维护结束后/.test(s)) {
		if (maint && maint.mo === mo && maint.d === d) return sourceInstant(year, mo, d, maint.endH, maint.endMi, tz);
		return null;                                      // 起点未知（不猜钟点）
	}
	const tm = /(\d{1,2})\s*[:：]\s*(\d{2})/.exec(s);
	if (tm) {
		const h = +tm[1], mi = +tm[2];
		if (h > 23 || mi > 59) return null;
		return sourceInstant(year, mo, d, h, mi, tz);
	}
	if (isEnd) return sourceInstant(year, mo, d, 23, 59, tz);
	return null;
}
// 活动名 = 锚点**前面最近的** `「…」`；没有引号就退到最后一个分句（去编号），再不行给「活动」
function ns_hl_cn_nameOf(text, at) {
	const head = String(text == null ? "" : text).slice(Math.max(0, at - 110), at);
	const quoted = [...head.matchAll(/「([^」]{1,40})」/g)];
	if (quoted.length) {
		const name = quoted[quoted.length - 1][1].replace(/\s+/g, " ").trim();
		if (name) return name;
	}
	const seg = head.split(/[。；;，,]/).filter(Boolean).pop() || "";
	const name = seg.replace(/^[0-9一二三四五六七八九十.、\s]+/, "").replace(/活动时间\s*$/, "").replace(/\s+/g, " ").trim();
	return name.slice(-24) || "活动";
}
// `活动时间` 锚点 → 条目事实（窗口不完整 ⇒ null）
function ns_hl_cn_itemAt(text, at, year, maint, tz) {
	const s = String(text == null ? "" : text);
	// 只截到第一个句末，避免把后面别的日期吞进来
	const rest = s.slice(at + ns_hl_CN_ANCHOR.length);
	const tail = rest.slice(0, 120);
	const cut = tail.search(/[；;。\n]/);
	const body = (cut >= 0 ? tail.slice(0, cut) : tail).trim().replace(/^[:：]\s*/, "");
	const sep = /[~～]/.exec(body);
	if (!sep) return null;
	// 一端的原文里常跟着说明（`23:59 ※联动期间…` / `23:59（周四）`）⇒ 只留到说明之前
	const clean = (s) => String(s).replace(/\s+/g, " ").split(/[※（(]/)[0].replace(/[，,、；;。]+$/, "").trim();
	const a = clean(body.slice(0, sep.index));
	const b = clean(body.slice(sep.index + 1));
	if (!a || !b) return null;
	const startTs = ns_hl_cn_pointOf(a, year, maint, tz, false);
	// 终点跨年：结束月日早于起始月日 ⇒ 次年（共用判据）
	const am = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(a);
	const bm = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(b);
	const endYear = (am && bm && endsNextYear(+am[1], +am[2], +bm[1], +bm[2])) ? year + 1 : year;
	const endTs = ns_hl_cn_pointOf(b, endYear, maint, tz, true);
	if (endTs == null) return null;
	if (startTs != null && !(endTs > startTs)) return null;   // 源站错行 ⇒ 丢掉，不硬造
	const raw = `${a} ~ ${b}`.replace(/\s+/g, " ");
	const display = startTs != null ? fmtWindow(startTs, endTs, tz) : raw;
	return { event: ns_hl_cn_nameOf(s, at), startTs, endTs, raw, display };
}
// 详情 JSON → `{ title, year, maint, items:[条目事实] }`。
// **结构变了要抛错**（没有 `data.content` ⇒ `{}` / 空串 / 改版页都落这里）；
// 有正文但没有 `活动时间` 锚点 ⇒ `items: []`（用户口径：不进外显，但不是失败）。
function ns_hl_cn_detailOf(json, tz = ns_hl_TZ) {
	const d = json && typeof json === "object" ? json.data : null;
	if (!d || typeof d !== "object") throw new Error("hl-cn-detail-changed:no-data");
	if (typeof d.content !== "string" || d.content.trim() === "") throw new Error("hl-cn-detail-changed:no-content");
	const text = ns_hl_cn_textOf(d.content);
	const post = {
		id: String(d.id == null ? "" : d.id),
		title: decodeExtra(String(d.title || "")),
		sortKey: String(d.displayTime || d.mtime || "")
	};
	const year = ns_hl_cn_announceYear(post);
	const maint = ns_hl_cn_maintOf(text);
	const items = [];
	const seen = new Set();
	const re = new RegExp(ns_hl_CN_ANCHOR, "g");
	let m;
	while ((m = re.exec(text)) !== null) {
		const it = ns_hl_cn_itemAt(text, m.index, year, maint, tz);
		if (!it) continue;
		const key = `${it.event}|${it.startTs}|${it.endTs}`;
		if (seen.has(key)) continue;
		seen.add(key);
		items.push({ _i: items.length, event: it.event, category: "", startTs: it.startTs, endTs: it.endTs, raw: it.raw, display: it.display });
	}
	return { title: post.title, year, maint, items };
}
//#endregion

//#region ③ 日服：纯解析（列表 → 行；行正文 → 池/活动条目事实）
// 列表 JSON → [{ id, title, content, publishTime }]（顺序 = 源站顺序）。
// 只认 `data.rows`（列表接口）与 `data`（新着接口 `/api/news/new` 是数组）两种形态；都没有 ⇒ 抛。
function ns_hl_jp_listOf(json) {
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("hl-jp-list-changed:bad-json");
	const meta = json.meta && typeof json.meta === "object" ? json.meta : null;
	if (meta && meta.ok === false) throw new Error("hl-jp-list-changed:meta-" + String(meta.err && meta.err.code));
	const data = json.data;
	const rows = data && Array.isArray(data.rows) ? data.rows : (Array.isArray(data) ? data : null);
	if (!rows) throw new Error("hl-jp-list-changed:no-rows");
	const out = rows
		.filter((x) => x && x.id != null)
		.map((x) => ({
			id: String(x.id),
			title: decodeExtra(String(x.title || "")).replace(/\s+/g, " ").trim(),
			content: String(x.content || ""),
			publishTime: numOrNull(x.publishTime)
		}))
		.filter((x) => x.content !== "");
	if (out.length === 0) throw new Error("hl-jp-list-changed:no-content");
	return out;
}
// 正文 → 按行纯文本（`<p>` / `<br>` 都是行边界；标签本身不插分隔符，`&nbsp;` 等实体解掉）
function ns_hl_jp_linesOf(html) {
	return String(html == null ? "" : html)
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/p\s*>/gi, "\n")
		.replace(/<\/(?:div|h[1-6]|li|tr|table)>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.split("\n")
		.map((s) => decodeExtra(s).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim())
		.filter(Boolean);
}
// `■実施時間` 后面那句 → `{ y, mo, d, startH, startMi, endH, endMi }`（找不到 ⇒ null）
function ns_hl_jp_maintOf(lines, year) {
	const list = Array.isArray(lines) ? lines : [];
	for (let i = 0; i < list.length; i++) {
		if (!/実施時間/.test(list[i])) continue;
		const seg = list.slice(i, i + 4).join(" ");
		const m = /(?:(\d{4})\s*年)?(\d{1,2})\s*月\s*(\d{1,2})\s*日\([^)]*\)\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*[～~]\s*(?:(\d{1,2})\s*月\s*(\d{1,2})\s*日\([^)]*\)\s*)?(\d{1,2})\s*[:：]\s*(\d{2})/.exec(seg);
		if (!m) continue;
		const mo = +m[2], d = +m[3], endH = +m[8], endMi = +m[9];
		if (mo < 1 || mo > 12 || d < 1 || d > 31 || endH > 23 || endMi > 59) continue;
		return { y: m[1] ? +m[1] : year, mo, d, startH: +m[4], startMi: +m[5], endH, endMi };
	}
	return null;
}
// 一端文本（`11月12日(木)メンテナンス後` / `11月26日(木)23:59まで` / `12月3日(木)メンテナンスまで`）→ 绝对毫秒
function ns_hl_jp_pointOf(text, year, maint, tz, isEnd) {
	const s = String(text == null ? "" : text);
	const md = /(?:(\d{4})\s*年)?(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(s);
	if (!md) return null;
	const y = md[1] ? +md[1] : year;
	if (y == null) return null;
	const mo = +md[2], d = +md[3];
	if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
	// 只认日期**之后**的时刻（`(木)` 之后），不会把维护开始时刻误当成窗口时刻
	const tm = /日(?:\s*\([^)]*\))?\s*(\d{1,2})\s*[:：]\s*(\d{2})/.exec(s);
	if (tm) {
		const h = +tm[1], mi = +tm[2];
		if (h > 23 || mi > 59) return null;
		return sourceInstant(y, mo, d, h, mi, tz);
	}
	if (!isEnd) {
		const rel = /メンテナンス後|アップデート後|更新後/.test(s);
		if (rel && maint && maint.mo === mo && maint.d === d) {
			const my = maint.y == null ? y : maint.y;
			return sourceInstant(my, mo, d, maint.endH, maint.endMi, tz);
		}
		return null;                                      // 起点未知（不猜钟点）
	}
	return sourceInstant(y, mo, d, 23, 59, tz);           // 终点只有日期 /「メンテナンスまで」⇒ 23:59
}
// `開催期間：…` 那一句 → `{ startTs, endTs, raw, display }`（拿不到完整窗口 ⇒ null）
function ns_hl_jp_windowOf(text, year, maint, tz) {
	const s = String(text == null ? "" : text).replace(/^\s*開催期間\s*[:：]\s*/, "");
	const cut = s.search(/[。\n]/);
	const body = (cut >= 0 ? s.slice(0, cut) : s).trim();
	const parts = body.split(/[～~]/);
	if (parts.length < 2) return null;
	const a = parts[0].trim();
	const b = parts.slice(1).join("～").trim();
	if (!a || !b) return null;
	const am = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(a);
	const bm = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(b);
	const endYear = (am && bm && endsNextYear(+am[1], +am[2], +bm[1], +bm[2])) ? year + 1 : year;
	const startTs = ns_hl_jp_pointOf(a, year, maint, tz, false);
	const endTs = ns_hl_jp_pointOf(b, endYear, maint, tz, true);
	if (endTs == null) return null;
	if (startTs != null && !(endTs > startTs)) return null;
	const raw = `${a} ~ ${b}`.replace(/\s+/g, " ");
	const display = startTs != null ? fmtWindow(startTs, endTs, tz) : raw;
	return { startTs, endTs, raw, display };
}
// 池窗口后面的舰名（`風帆（前衛）「メルクーリィ」2% …`）→ `、` 连接的名单；遇到 ※ / 新段就停
function ns_hl_jp_poolRolesOf(lines, at) {
	const list = Array.isArray(lines) ? lines : [];
	const out = [];
	const seen = new Set();
	for (let j = at + 1; j < list.length && j <= at + 24; j++) {
		const line = list[j];
		if (/^[※・◇【■●◆]/.test(line)) break;
		const m = ns_hl_jp_QUOTED_RE.exec(line);
		if (!m) continue;
		const name = m[1].replace(/\s+/g, " ").trim();
		if (!name || seen.has(name)) continue;
		seen.add(name);
		out.push(name);
	}
	return out.join("、");
}
// 一行正文 → `{ title, publishTime, pools, events }`（条目事实；锚点被抹掉 ⇒ 两者都空，**不抛**）
function ns_hl_jp_noticeOf(row, tz = ns_hl_jp_TZ) {
	const lines = ns_hl_jp_linesOf(row && row.content);
	const pub = numOrNull(row && row.publishTime);
	const wall = pub != null ? sourceWallParts(pub, tz) : null;
	const year = wall ? wall.y : null;
	const maint = ns_hl_jp_maintOf(lines, year);
	const pools = [], events = [];
	let owner = "";            // "" | "gacha" | "event"
	let ownerName = "";
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		// 段首 ⇒ 清归属（避免商店/试穿的 開催期間 挂到上一个活动上）
		if (ns_hl_jp_SECTION_START_RE.test(line)) { owner = ""; ownerName = ""; }
		if (ns_hl_jp_POOL_TITLE_RE.test(line)) { owner = "gacha"; ownerName = "期間限定建造"; continue; }
		// 活动段标题必须同一行带「開催」：`◇…イベント「X」について` 这种说明段不算（771 实测有两条）
		if (/開催/.test(line)) {
			const em = ns_hl_jp_EVENT_TITLE_RE.exec(line);
			if (em) { owner = "event"; ownerName = em[1].replace(/\s+/g, " ").trim(); continue; }
		}
		if (!owner || !/^開催期間\s*[:：]/.test(line)) continue;
		const kind = owner;
		const name = ownerName;
		owner = "";             // 一个段只挂一个窗口（后面的商店窗口不继承）
		ownerName = "";
		const win = ns_hl_jp_windowOf(line, year, maint, tz);
		if (!win) continue;
		if (kind === "gacha") {
			pools.push({
				_i: pools.length,
				banner: name || "期間限定建造",
				roles: ns_hl_jp_poolRolesOf(lines, i),
				startTs: win.startTs, endTs: win.endTs,
				raw: win.raw, display: win.display, isMain: true
			});
		} else {
			events.push({
				_i: events.length,
				event: name || "活动",
				category: "",
				startTs: win.startTs, endTs: win.endTs,
				raw: win.raw, display: win.display
			});
		}
	}
	return { title: decodeExtra(String(row && row.title || "")).trim(), publishTime: pub, pools, events };
}
//#endregion

//#region ④ 抓取器（契约：async (url, signal, tz, now = nowMs()) → 数据对象 | null）
// ── 国服：列表 → 最多 2 篇维护公告详情（按 id 缓存 TTL 24h；命中就说 1 次请求）──
let ns_hl_cn_detailCache = new Map();     // id → { at, items }
function ns_hl_cn_resetCache() { ns_hl_cn_detailCache = new Map(); }
function ns_hl_cn_detailUrlOf(id) { return ns_hl_CN_DETAIL_BASE + String(id == null ? "" : id); }
async function ns_hl_cn_itemsOfPost(post, signal, tz, now) {
	const hit = ns_hl_cn_detailCache.get(post.id);
	if (hit && now - hit.at < ns_hl_CACHE_TTL_MS) return hit.items;
	const json = await fetchJson(ns_hl_cn_detailUrlOf(post.id), { mode: "proxy", referer: ns_hl_CN_HOME, signal });
	const detail = ns_hl_cn_detailOf(json, tz);
	ns_hl_cn_detailCache.set(post.id, { at: now, items: detail.items });
	return detail.items;
}
// 活动侧：列表 1 次 → 标题过滤 → 最新那篇详情；没有覆盖 now 的窗口就再试下一篇（最多 2 篇）
async function ns_hl_cn_events(url, signal, tz = ns_hl_TZ, now = nowMs()) {
	const listUrl = String(url == null ? "" : url).trim() || ns_hl_CN_LIST_URL;
	const list = ns_hl_cn_listOf(await fetchJson(listUrl, { mode: "proxy", referer: ns_hl_CN_HOME, signal }));
	const posts = list.filter((p) => ns_hl_CN_TITLE_RE.test(p.title)).slice(0, ns_hl_CN_MAX_DETAILS);
	if (posts.length === 0) return null;              // 列表里没有维护公告 ⇒ 未公布（不是失败）
	let firstErr = null, parsed = 0;
	for (const p of posts) {
		let items;
		try {
			items = await ns_hl_cn_itemsOfPost(p, signal, tz, now);
			parsed++;
		} catch (e) {
			if (!firstErr) firstErr = e;
			continue;                                   // 单篇失败不整体崩；全失败才抛（见下）
		}
		if (items.some((x) => coversNow(x, now))) return ns_bwiki_eventPayload(items, tz, now, 0, "hl");
	}
	if (parsed === 0 && firstErr) throw firstErr;     // 详情全失败 ⇒ 抛（抓取失败 ≠ 未公布）
	return null;                                      // 抓到公告但没有覆盖 now 的活动 ⇒ 未公布
}

// ── 日服：列表 1 次（行里自带正文）→ 每行按 id 缓存解析结果；卡池/活动两侧轮内共享同一次列表请求 ──
let ns_hl_jp_listCache = null;            // { url, round, at, promise }
let ns_hl_jp_rowCache = new Map();        // id → { at, value:{ pools, events } }
function ns_hl_jp_resetCache() { ns_hl_jp_listCache = null; ns_hl_jp_rowCache = new Map(); }
async function ns_hl_jp_rowsOf(url, signal) {
	const key = String(url == null ? "" : url).trim() || ns_hl_jp_LIST_URL;
	const at = nowMs();
	const round = fetchRoundSeqOf();
	const hit = ns_hl_jp_listCache;
	let promise;
	if (fetchRoundActive() && hit && hit.url === key && hit.round === round && at - hit.at < ns_hl_ROUND_TTL_MS) {
		promise = hit.promise;
	} else {
		promise = fetchJson(key, { mode: "proxy", signal, headers: { Accept: "application/json" } })
			.then((json) => ns_hl_jp_listOf(json));
		ns_hl_jp_listCache = { url: key, round, at, promise };
		promise.catch(() => { if (ns_hl_jp_listCache && ns_hl_jp_listCache.promise === promise) ns_hl_jp_listCache = null; });
	}
	return promise;
}
async function ns_hl_jp_itemsOf(url, signal, tz, now, side) {
	const rows = await ns_hl_jp_rowsOf(url, signal);
	// 同一期会在**相邻两篇**公告里各写一遍（新公告的「継続中のコンテンツ」段 + 上篇的正文），
	// 而且上篇给得出起点、新公告只写「メンテナンス後」（起点未知）⇒ 按「名字 + 终点」去重，
	// **起点明确的优先**（否则悬停里同一期出现两行、其中一行还印着"维护后"）。
	const merged = new Map();
	for (const row of rows) {
		const hit = ns_hl_jp_rowCache.get(row.id);
		let value;
		if (hit && now - hit.at < ns_hl_CACHE_TTL_MS) value = hit.value;
		else {
			value = ns_hl_jp_noticeOf(row, tz);
			ns_hl_jp_rowCache.set(row.id, { at: now, value });
		}
		for (const it of value[side]) {
			const key = `${it.banner || it.event || ""}|${it.endTs}`;
			const prev = merged.get(key);
			if (!prev || (prev.startTs == null && it.startTs != null)) merged.set(key, it);
		}
	}
	return [...merged.values()].map((it, i) => Object.assign({}, it, { _i: i }));
}
// 卡池侧：覆盖 now 的限时池 → 共用载荷（同批合并 + 悬停 + `gacha[]`）
async function ns_hl_jp_gacha(url, signal, tz = ns_hl_jp_TZ, now = nowMs()) {
	const items = await ns_hl_jp_itemsOf(url, signal, tz, now, "pools");
	if (items.length === 0) return null;              // 一篇带池的公告都没有 ⇒ 未公布（不是失败）
	return ns_bwiki_batchGachaPayloadOf(items, tz, now, { id: "hl-jp" });
}
// 活动侧：覆盖 now 的活动 → 共用活动载荷
async function ns_hl_jp_events(url, signal, tz = ns_hl_jp_TZ, now = nowMs()) {
	const items = await ns_hl_jp_itemsOf(url, signal, tz, now, "events");
	if (items.length === 0) return null;
	return ns_bwiki_eventPayload(items, tz, now, 0, "hl-jp");
}
//#endregion

//#region ⑤ 条目登记
// 国服：卡池侧 `url: ""` + **不写 `source`**（设置页/面板显示「未配置」，一个请求都不发）。
// 活动侧 = 官方维护公告列表；标签逐字「官网公告」。
registerSource({
	id: "hl",
	defaultHidden: false,
	tz: ns_hl_TZ,
	name: "碧蓝航线",
	icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/26/7d/f7/267df745-0833-b6d5-51ab-f62e47d6037a/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
	url: "",
	eventUrl: ns_hl_CN_LIST_URL,
	eventSource: "官网公告"
});
EVENT_FETCHERS["hl"] = Object.assign(EVENT_FETCHERS["hl"] || {}, {
	default: (url, signal, tz, now) => ns_hl_cn_events(url, signal, tz, now)
});

// 日服：卡池与活动同用一条官方新闻列表（`/api/news/list`）；两侧标签逐字「官网公告（日服）」。
registerSource({
	id: "hl-jp",
	defaultHidden: false,
	tz: ns_hl_jp_TZ,
	name: "碧蓝航线·日服",
	icon: ns_hl_jp_ICON,
	url: ns_hl_jp_LIST_URL,
	source: ns_hl_jp_SOURCE_LABEL,
	eventUrl: ns_hl_jp_LIST_URL,
	eventSource: ns_hl_jp_SOURCE_LABEL
});
GACHA_FETCHERS["hl-jp"] = (url, signal, tz, now) => ns_hl_jp_gacha(url, signal, tz, now);
EVENT_FETCHERS["hl-jp"] = Object.assign(EVENT_FETCHERS["hl-jp"] || {}, {
	default: (url, signal, tz, now) => ns_hl_jp_events(url, signal, tz, now)
});
//#endregion
