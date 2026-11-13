// src/client/30-game-pengpeng.js —— 夜幕之下（国服；曾用名「代号砰砰」，2026-06-05 公测）
//
// ── 卡池侧（2026-11-11 换源）：bwiki **SMW `action=ask` 语义查询** ────────────────────
// 旧写法是抓「契约一览」的 HTML 表（`action=parse&page=契约一览&prop=text`）。
// ⚠️ 2026-11-11 实测：该页**已变成 `#REDIRECT [[契约图鉴]]`** —— `action=parse` 只回一段
//    `redirectMsg`（1059 字节），正文里没有表格；`契约图鉴` 那边的表身是 `{{#ask:…}}` 且在
//    `资料状态::已核对` 闸门后面，抓 HTML **永远是空表**。这是"方法错"，不是"源站没数据"。
// 正确入口 = MediaWiki 的 SMW 查询接口（同一份数据，结构化直出）：
//   GET https://wiki.biligame.com/ymzx/api.php?action=ask&format=json
//       &query=[[分类:契约]][[条目类型::契约]]|?名称|?契约类型|?活动开始|?活动结束|?推荐风格
//   → { query: { printrequests: […], results: { "<页面名>": { printouts: {
//          名称: ["乘自由之风"], 契约类型: ["限时契约"],
//          活动开始: ["2026-07-30 05:00:00"], 活动结束: ["2026-08-13 04:59:59"],
//          推荐风格: ["热沙骑士"] }, fulltext, fullurl, … } } } }
//   实测 11 条（9 条「限时契约」+ 2 条「常规契约」），**9 期历史全部 05:00 起 / 04:59:59 止**。
//   `results` 是**对象**（key = 页面名），SMW 不保证顺序 ⇒ 逐条解析后由载荷层按 `endTs` 排。
// 口径：
//   · 池名 = `名称`；角色列 = `推荐风格`（多个风格用「、」连，缺就留空 ⇒ 不印假角色名）
//   · 窗口 = `活动开始` / `活动结束`（源站墙钟 UTC+8，无 DST）；只有开始没有结束（「常规契约」两口常驻池）
//     ⇒ 读不出窗口，**如实跳过**（`coversNow` 两端都要，见文件下方「长期池」注释）
//   · **不做「按固定 N 天外推」**：9 期里 6 期 14 天、3 期 21 天，规则不唯一 ⇒ 只报源站写下的窗口
//   · ⚠️ 该页最后一条契约止于 **2026-09-10 04:59:59**（wiki 停更）⇒ 当前（11-11）如实 nomatch。
//     这是**事实**：等 wiki 补档即自动恢复，绝不外推、不把上一期当"当前"。
//
// ── 卡池侧 2026-11-11 复核：**不接** TapTap（选项 C），证据与取舍 ────────────────────
// 现状（活网实测）：bwiki「契约」SMW 查询最后一条窗口止于 2026-09-10 04:59（见上）⇒ 当前（11-11）
//   没有在期池，抓取器如实返回 null（回归见 cases-new5 ④(b)）。停更的是 wiki，不是游戏
//   （游戏 11-05 已开「流光抛诸寰宇」新版本）—— 但 SMW 数据一补档就自动恢复。
//
// 调研（2026-11-11 实测）：
//   · TapTap tab 的**列表帖**里没有卡池窗口；卡池档期只在图片「版本活动一览」里（配图，不可解析）。
//   · 唯一能取到的文字是 TapTap **应用简介**（`/app/746164` 的 ld+json `description`）：
//       `10月22日，活动版本「无罪之国·上」正式开启。「幸福无罪论」活动契约限时开启，
//        6星风格「终身监护人·监狱长」获取概率大幅提升！`
//     ⇒ 只有「N月N日」**没有年份**、也**没有结束日**；而且它是营销简介（随版本换稿），不是逐期公告。
//
// 为什么三选一里选 **C（不动）**：
//   · **A**（抽「X」活动契约限时开启 + 开启日，结束日留空）：仓库没有「终点未知的卡池」这种载荷 ——
//     `ns_bwiki_batchGachaPayloadOf`（30-game-bwiki-common.js）用 `coversNow` 选池（**两端都必须明确**）
//     ⇒ 单边窗口恒 null；若绕过它强行产出非 null 载荷，显示层 `scheduleItemOf`
//     （81-schedule-model.js：`const endTs = item.endTs == null ? 0 : item.endTs`）会把 `endTs == null`
//     当**「长期」**（state "long"、无倒计时）—— 把限时池标成常驻，比「未公布」更误导。
//     而「只进悬停」也不成立：悬停（`bannerHover`）是载荷字段，没有载荷就没有悬停。
//     另外「10月22日」没有年份来源，按仓库口径（本文件活动侧/ hlr 同一句「不改写、不猜当前年」）不能补年。
//   · **B**（用下一期开启日推结束）：11-12 的新版本档期只在图片里（不可解析）⇒ **连推定的依据都没有**；
//     有依据也不做 —— 编一个结束日会把倒计时/提醒建立在猜测上（用户口径「宁可少显示，也不要假在期」）。
//   · **C**（不动）：卡池列继续如实「未公布」，等 bwiki 补档即恢复；**不做**「先 bwiki 后 TapTap」自动兜底
//     （仓库原则：无自动换源）。也没有做成 `altSources`：单边窗口没有合法载荷可出，做成选项等于
//     「选项看着能用、实际永远空」—— 与「不登记就 403」同类的坑，不制造。
//     「直接把默认换成 TapTap」同样不可行：它只能产出单边窗口 ⇒ 外显恒 null，等于用「永远空」
//     换掉 bwiki 的「等补档」，还丢掉结构最好的一张表。
//
// 显示层对「单边窗口」的处理（回归钉死，见 cases-new5 ④(d)）：`coversNow` 要求两端明确
//   ⇒ 只有开启日的条目**不算在期**、也不进悬停候选（`coveredOrOpen` 同样为 false）；
//   真把它喂进数组，则会被当「长期」（state=long、remain=0）。两条都用测试钉住，免得日后有人
//   「顺手」把单边池接进来还以为是当期。
//
// ── 活动侧旧源（2026-11-09 接入；2026-11-10 起降为 eventAltSources 手动备选）：bwiki `公告/` ──
// 旧结论是「官方只有逐条公告页（无列表接口），bwiki 也没有活动一览页」⇒ 当时留空未配置。
// 本批重新实测：bwiki `公告/` 前缀下共 **88 页**，其中 5 页以「版本活动总览」结尾，
// 每页 5~6 行「活动时间：」，**小节名就是活动名**：
//   列表  api.php?action=query&generator=allpages&gapprefix=公告/&gaplimit=100&format=json&formatversion=2
//         `origin=*` 由 `withBwikiCors` 统一补；实测 200、`ACAO: *`（但全站口径仍走宿主代理，见 15-env.js）
//   详情  api.php?action=parse&page=<页名>&prop=wikitext&format=json&formatversion=2
//         模板：{{公告页面|公告发布日期=2026-09-10|公告内容=…}}
//         正文：'''◈「共举昨日之酒·上」版本签到'''<br>
//               活动时间：2026/9/10 版本更新后 - 2026/10/1 4:59<br>
// 取**最新一页** = `pageid` 最大（MediaWiki 自增；标题里没有日期，不能按标题排）。
// 起点「版本更新后」= **起点未知** ⇒ `startTs = null`（与 wd 同口径：不进外显、进悬停）。
//
// ⚠️ 已知滞后：该 wiki 最新一版只到 **2026-09-10**（比游戏落后约 1 个版本；游戏本身仍在运营，
//    1.0.54 / 2026-10-21）。所以此刻抓到的活动全部已结束 ⇒ 如实 `null`（未公布），
//    **绝不**把九月档期当成"当前活动"。设置页的来源标签写明
//    「Bwiki 公告（不可靠）」—— 停更的是 wiki，不是游戏，不要标成"暂停"。
//
// ── 2026-11-09 23:1x 真机复测（结论：解析链路正常，nomatch 是「wiki 停更」）─────────
//  经宿主代理抓真接口：`action=query&generator=allpages&gapprefix=公告/` = 88 页（只有 title/pageid）；
//  再按标题发 `action=parse&prop=wikitext`（**不是**读 revisions —— 那才是拿不到正文的写法），
//  最新总览「共举昨日之酒·上」解析出 5 条：
//    彷徨往昔 ｜ 2026/9/12 5:00 ~ 2026/9/29 4:59（两端明确）
//    「共举昨日之酒·上」版本签到 / 吾血浓于酒 / 灰色酒路 / 橡木廊柜台 ｜ 2026/9/10 版本更新后 ~ …
//  ⇒ 「活动名 + 起止」都能解。真因：wiki `list=recentchanges` 最后编辑 = **2026-09-24**，
//  最新档期 10-01 04:59 就结束了 ⇒ 当前时刻如实 null。等 wiki 补档即恢复，抓取器不需要改
//  （回归 `test/cases-pengpeng-event.mjs` ③ 用期内 now 断言有数据、④ 用真机 now 断言 null）。
//
// ── 活动侧（2026-11-11 接；2026-11-13 改抓 tab 页 SSR）：默认源 = **TapTap 官方账号 tab 页** ──
// ⚠️ 2026-11-13：`www.taptap.cn/robots.txt` 明确 `Disallow: /webapi/` 与 `Disallow: /webapiv2/`
//   ⇒ 之前那套「feed 列表 JSON（`webapiv2/feed/v7/by-group`）」**不能**再作为默认抓取。
//   改成抓**允许路径**的 tab 页：`https://www.taptap.cn/app/746164/topic?type=official`
//   （实测 200、无 WAF、服务端渲染；SSR payload = Nuxt `window.__NUXT_DATA__`，devalue 编码）。
//   SSR 的帖子对象里就有 `moment.topic.title` + `moment.topic.summary`（纯文本，前 200 字），
//   活动区间在读到的摘要行里：
//     ▸活动时间：2026年11月5日 05:00 - 2026年11月19日 04:59
//   ⇒ 解析成「活动名 + 起止」（名称取标题里的【…】短语；没有【】就用整条标题）。
//   区间解析函数（`pengpengTaptapWindowsOf`）与"帖子 → 活动事实"（`pengpengTaptapActivitiesOf`）
//   **一行没动** —— 换的只是"文本从哪来"（`ns_taptap_topicPostsOf` 解 SSR，见 22-fetcher-core.js）。
// 为什么不再用 webapiv2 JSON：robots（上面那条，硬事实）+ 它会被 WAF 拦；tab 页是同一份数据的
//   可见版本，且**一个请求**拿到 10 帖标题 + 摘要（旧链路每页 1 个请求，还得翻页）。
// 仍需宿主代理：tab 页响应**无 ACAO**（`www.taptap.cn` 已在 PROXY_ALLOW_HOSTS）。
// 翻页：`?page=N`（允许路径）；`PENGPENG_TAPTAP_MAX_PAGES = 2` 封顶，
//   并且「第 1 页解析出的活动已覆盖当前时刻」就停（不再翻）。
//   为什么要第 2 页：每页 10 帖，仍在期、但公告早于最近 10 帖的活动在第 2 页
//   （实测「画廊夜游」10-29 ~ 11-12 就在那一页）；第 2 页抓挂不影响已有结果。
// 口径：
//   · 只认 `活动时间：` 那一行（`更新时间：` 是维护窗口、`折扣时间：` 是商城折扣，都不算活动）
//   · 两端都要**自带年份**才解；只有 `10月29日 …` 的（如【家族遗藏】）**不解**——不猜当前年
//     （与 hlr 同一口径：没有年份来源就 nomatch，绝不拿"今年"顶）
//   · 起点「版本更新后 / 维护后」= **起点未知** ⇒ startTs = null（与 wd 同口径：不进外显、进悬停）
//   · 只有日期没有时分 ⇒ 起 00:00 / 止 23:59（仓库通用约定，同 bwiki `windowsFromCell` 注释）
//
// ── 时区 ──
// 源站无标注；时间写成 `05:00:00 ~ 04:59:59`（凌晨 5 点换池 + 结束前一秒），是国服 UTC+8 口径
// ⇒ tz = Asia/Shanghai（推定，只写在这里，不进悬停）。
//
// ── 卡池类型（category）──
// 旧 HTML 表里「契约」列有个 `遴选 / 活动` 标签（`<span class="ymzx-qiyue-tag">`）。
// SMW 那条查询里对应的是 `契约类型`（实测只有「限时契约 / 常规契约」两种），**语义不同**（那是
// 「限时/常驻」而不是「遴选/活动」）⇒ 本批**不写** `category`（不拿一个含义不同的字段顶替），
// `?契约类型` 仍在查询里（排障用）；缺字段就留空。
//
// ── 长期池（「夜色的呼唤」「起始的契约」）──
// 这两条 `活动开始` 有值、`活动结束` **空** ⇒ 读不出窗口（`coversNow` 要求 endTs 非空），
// **如实跳过**：没有结束时刻就算不出倒计时，画不出来。屏幕上的代价只是这两口常驻池不进日历。

		const PENGPENG_TZ = "Asia/Shanghai";
		// 卡池默认源：bwiki 的 **SMW 语义查询**（`action=ask`）。`origin=*` 由抓取出口统一补，这里显式写上，
		// 让夹具键／日志／来源健康里看到的地址就是**实际请求**的那一串（幂等，见 15-env.js 的 withBwikiCors）。
		const PENGPENG_ASK_QUERY = "[[分类:契约]][[条目类型::契约]]|?名称|?契约类型|?活动开始|?活动结束|?推荐风格";
		const PENGPENG_ASK_URL = "https://wiki.biligame.com/ymzx/api.php?action=ask&format=json&query="
			+ encodeURIComponent(PENGPENG_ASK_QUERY) + "&origin=*";
		// 活动侧旧源（现为 eventAltSources 手动备选）：bwiki `公告/` 前缀页列表
		const PENGPENG_EVENT_URL = "https://wiki.biligame.com/pengpeng/api.php?action=query&generator=allpages&gapprefix="
			+ encodeURIComponent("公告/") + "&gaplimit=100&format=json&formatversion=2";
		const PENGPENG_EVENT_OVERVIEW_RE = /版本活动总览$/;
		const PENGPENG_MAX_OVERVIEWS = 1;
		// 活动侧默认源：TapTap tab 页（**允许路径的 SSR**；2026-11-13 起不再用 `webapiv2` JSON）
		// 这一条同时是抓取地址与 Referer（tab 页无 ACAO，走宿主代理）。
		const PENGPENG_TAPTAP_PAGE_URL = "https://www.taptap.cn/app/746164/topic?type=official";
		const PENGPENG_TAPTAP_REFERER = PENGPENG_TAPTAP_PAGE_URL;
		// 翻页上限（每页 10 帖）：第 2 页能捞到仍在期、但公告早于最近 10 帖的活动；2 页足够当期
		const PENGPENG_TAPTAP_MAX_PAGES = 2;

		// 页码 → URL：第 1 页原样；第 N 页 = `&page=N`（`?page=` 是允许路径，不是接口的偏移）
		function pengpengTaptapPageUrl(base, page) {
			const u = String(base == null ? "" : base).trim() || PENGPENG_TAPTAP_PAGE_URL;
			return ns_taptap_topicPageUrl(u, page);
		}

		// SMW 的 `printouts` 取值：正常情况下是 `["2026-07-30 05:00:00"]` 这样的字符串数组，
		// 但 SMW 对不同类型会给出对象（如 `{raw:"…", fulltext:"…"}`）⇒ 统一摊成「用「、」连起来的字符串」。
		function pengpengAskValueOf(v) {
			const one = (x) => {
				if (x == null) return "";
				if (typeof x === "object") return String(x.fulltext != null ? x.fulltext : (x.raw != null ? x.raw : ""))
					.replace(/<[^>]*>/g, "").trim();
				return decodeEntities(String(x)).trim();
			};
			if (Array.isArray(v)) return v.map(one).filter(Boolean).join("\u3001");
			return one(v);
		}

		// SMW 时间戳 `2026-07-30 05:00:00` → 源站墙钟的绝对毫秒（无时分秒也认；年月顺序固定）
		const PENGPENG_ASK_STAMP_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
		function pengpengAskInstantOf(text, tz) {
			const m = PENGPENG_ASK_STAMP_RE.exec(String(text == null ? "" : text).trim());
			if (!m) return null;
			const h = m[4] != null ? +m[4] : 0, mi = m[5] != null ? +m[5] : 0;
			if (h > 23 || mi > 59) return null;
			return sourceInstant(+m[1], +m[2], +m[3], h, mi, tz);
		}

		// `action=ask` 响应 → 逐条 `{ banner, roles, startTs, endTs, raw, display, isMain, _i }`
		//   banner = `名称`；roles = `推荐风格`（缺 ⇒ 空串）；窗口 = `活动开始` / `活动结束`
		// ⚠️ `results` 是**对象**（key = 页面名），SMW 不保证顺序 ⇒ 这里按序列稳定排序由载荷层负责，
		//    本函数只如实逐条产出（`_i` 留在源里的出现序号上，仅用于同一结束时刻的并列定序）。
		function pengpengAskPoolsOf(json, tz) {
			const q = json && typeof json === "object" ? json.query : null;
			if (!q || typeof q !== "object") {
				// SMW 查询本身报错（语法/权限）也走这里：抓取失败 ≠ 未公布
				throw new Error(json && json.error ? "pengpeng-ask-error" : "pengpeng-bad-shape");
			}
			const results = q.results;
			if (!results || typeof results !== "object" || Array.isArray(results)) throw new Error("pengpeng-bad-list");
			const out = [];
			let i = 0;
			for (const key of Object.keys(results)) {
				const row = results[key] || {};
				const p = row.printouts && typeof row.printouts === "object" ? row.printouts : {};
				const name = pengpengAskValueOf(p["名称"]) || String(row.fulltext || key || "").trim();
				if (!name) continue;
				const startText = pengpengAskValueOf(p["活动开始"]);
				const endText = pengpengAskValueOf(p["活动结束"]);
				const startTs = pengpengAskInstantOf(startText, tz);
				const endTs = pengpengAskInstantOf(endText, tz);
				// 读不出两端（「常规契约」那两口常驻池没有结束时间）⇒ 如实跳过（见文件头「长期池」）
				if (startTs == null || endTs == null || !(endTs > startTs)) continue;
				out.push({
					banner: name,
					roles: pengpengAskValueOf(p["推荐风格"]),
					// 两份文本（约定见 `30-game-bwiki-common.js` 文件头）：
					//   raw = 源站原文那一句；display = 补全后的可读文本（源站 tz）
					raw: `${startText} ~ ${endText}`,
					display: fmtWindow(startTs, endTs, tz),
					startTs,
					endTs,
					isMain: true,
					_i: i++
				});
			}
			return out;
		}

		// 抓取器（契约：async (url, signal, tz) → 数据对象 | null；now 在最后、有默认值）
		// bwiki 是 biligame 系主机 ⇒ 必须走宿主代理（见 15-env.js 的 CORS 收口点）
		async function ns_pengpeng_gachaPengpeng(url, signal, tz = PENGPENG_TZ, now) {
			const json = await fetchJson(url || PENGPENG_ASK_URL, { signal, mode: "proxy" });
			const items = pengpengAskPoolsOf(json, tz);
			// 0 条 = 查询结构变了（**不是**"没有在期池"）：没有在期池是载荷层返回 null 的那条分支
			if (items.length === 0) throw new Error("pengpeng-no-table");
			return ns_bwiki_batchGachaPayloadOf(items, tz, typeof now === "number" && Number.isFinite(now) ? now : nowMs(), { id: "pengpeng" });
		}

		// ── 活动侧：`公告/*` 版本活动总览 ────────────────────────────────────────
		function pengpengOverviewPagesOf(json) {
			if (!json || typeof json !== "object") throw new Error("pengpeng-bad-shape");
			const pages = json.query && json.query.pages;
			if (!Array.isArray(pages)) throw new Error("pengpeng-bad-list");
			return pages
				.map((p) => ({ title: String((p && p.title) || ""), pageid: Number(p && p.pageid) || 0 }))
				.filter((p) => p.title.indexOf("公告/") === 0 && PENGPENG_EVENT_OVERVIEW_RE.test(p.title))
				.sort((a, b) => b.pageid - a.pageid);
		}

		function pengpengOverviewUrl(title) {
			return "https://wiki.biligame.com/pengpeng/api.php?action=parse&page="
				+ encodeURIComponent(String(title)) + "&prop=wikitext&format=json&formatversion=2";
		}

		function pengpengWikitextOf(json) {
			if (!json || typeof json !== "object") throw new Error("pengpeng-bad-shape");
			const wt = json.parse && json.parse.wikitext;
			if (typeof wt !== "string") throw new Error("pengpeng-bad-wikitext");
			return wt;
		}

		// `'''◈「共举昨日之酒·上」版本签到'''<br>` → `「共举昨日之酒·上」版本签到`
		function pengpengHeadingOf(line) {
			const s = String(line == null ? "" : line).replace(/'''/g, "").replace(/◈/g, "");
			return stripTags(s).replace(/\s+/g, " ").trim();
		}

		// `2026/9/10 版本更新后` / `2026/9/12 5:00` / `2026/10/1 4:59`
		const PENGPENG_EVENT_POINT_RE = /(\d{4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*(\d{1,2})\s*[:：]\s*(\d{2}))?(?:\s*(版本更新后))?/g;
		const PENGPENG_EVENT_CONNECTOR_RE = /^\s*[-~～〜—–－至到]\s*$/;

		function pengpengEventPointsOf(text) {
			const s = String(text == null ? "" : text);
			const out = [];
			PENGPENG_EVENT_POINT_RE.lastIndex = 0;
			let m;
			while ((m = PENGPENG_EVENT_POINT_RE.exec(s))) {
				if (m[0] === "") { PENGPENG_EVENT_POINT_RE.lastIndex++; continue; }
				out.push({
					start: m.index,
					end: m.index + m[0].length,
					y: +m[1],
					mo: +m[2],
					d: +m[3],
					h: m[4] != null ? +m[4] : null,
					mi: m[5] != null ? +m[5] : null,
					open: m[6] === "版本更新后"
				});
			}
			return out;
		}

		// 一行「活动时间：…」→ 窗口事实（起点未知 = startTs null，display 保留「版本更新后」）
		function pengpengEventWindowsOf(text, tz = PENGPENG_TZ) {
			const s = String(text == null ? "" : text);
			const toks = pengpengEventPointsOf(s);
			const out = [];
			const seen = new Set();
			for (let i = 0; i + 1 < toks.length; i++) {
				const a = toks[i], b = toks[i + 1];
				if (!PENGPENG_EVENT_CONNECTOR_RE.test(s.slice(a.end, b.start))) continue;
				if (a.h == null && !a.open) continue;
				if (b.h == null) continue;
				const endY = a.y + (endsNextYear(a.mo, a.d, b.mo, b.d) ? 1 : 0);
				const startTs = a.open ? null : sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
				const endTs = sourceInstant(endY, b.mo, b.d, b.h, b.mi, tz);
				if (startTs != null && !(endTs > startTs)) continue;
				const key = (startTs == null ? "open" : startTs) + "|" + endTs;
				if (seen.has(key)) continue;
				seen.add(key);
				const aRaw = s.slice(a.start, a.end).replace(/\s+/g, " ").trim();
				const bRaw = s.slice(b.start, b.end).replace(/\s+/g, " ").trim();
				const endWall = sourceWallParts(endTs, tz);
				const startWall = a.open ? { y: a.y } : sourceWallParts(startTs, tz);
				const sameYear = startWall.y === endWall.y;
				const startText = a.open
					? (sameYear ? `${pad2(a.mo)}-${pad2(a.d)} 版本更新后` : `${a.y}-${pad2(a.mo)}-${pad2(a.d)} 版本更新后`)
					: (sameYear ? fmtMdHm(startTs, tz) : fmtYmdHm(startTs, tz));
				const endText = sameYear ? fmtMdHm(endTs, tz) : fmtYmdHm(endTs, tz);
				out.push({ startTs, endTs, raw: `${aRaw} ~ ${bRaw}`, display: `${startText} ~ ${endText}` });
			}
			return out;
		}

		// 一页 wikitext → 活动事实 [{ name, startTs, endTs, raw, display }]
		function pengpengOverviewActivitiesOf(wikitext, tz = PENGPENG_TZ) {
			const lines = String(wikitext == null ? "" : wikitext).split(/\r?\n/);
			const out = [], seen = new Set();
			let heading = "";
			for (const line of lines) {
				if (line.indexOf("◈") >= 0) heading = pengpengHeadingOf(line);
				if (line.indexOf("活动时间") < 0 || !heading) continue;
				for (const w of pengpengEventWindowsOf(line, tz)) {
					const key = heading + "|" + (w.startTs == null ? "open" : w.startTs) + "|" + w.endTs;
					if (seen.has(key)) continue;
					seen.add(key);
					out.push({ name: heading, ...w });
				}
			}
			return out;
		}

		async function fetchPengpengEvents(url, signal, tz = PENGPENG_TZ) {
			const at = nowMs();
			const listJson = await fetchJson(url || PENGPENG_EVENT_URL, { signal, mode: "proxy" });
			const pages = pengpengOverviewPagesOf(listJson);
			if (pages.length === 0) return null;
			const rows = [];
			let okCount = 0, firstHardErr = null;
			for (const page of pages.slice(0, PENGPENG_MAX_OVERVIEWS)) {
				let json;
				try {
					json = await fetchJson(pengpengOverviewUrl(page.title), { signal, mode: "proxy" });
				} catch (e) {
					if (!firstHardErr) firstHardErr = e;
					continue;
				}
				okCount++;
				for (const x of pengpengOverviewActivitiesOf(pengpengWikitextOf(json), tz)) rows.push(x);
			}
			if (okCount === 0) {
				if (firstHardErr) throw firstHardErr;
				return null;
			}
			if (rows.length === 0) return null;
			// 外显：两端都明确且覆盖 now（「版本更新后」那一批**不**进外显）
			const live = rows.filter((r) => coversNow(r, at));
			if (live.length === 0) return null;
			live.sort((a, b) => (a.endTs - b.endTs) || ((a.startTs == null ? Infinity : a.startTs) - (b.startTs == null ? Infinity : b.startTs)));
			const first = live[0];
			const hoverItems = rows.filter((r) => coveredOrOpen(r, at))
				.sort((a, b) => (a.endTs - b.endTs) || ((a.startTs == null ? Infinity : a.startTs) - (b.startTs == null ? Infinity : b.startTs)))
				.map((r) => ({ title: r.name, startTs: r.startTs, endTs: r.endTs, raw: r.raw }));
			const hover = hoverTextFromItems(hoverItems, "event", tz);
			const out = {
				event: first.name,
				eventDates: first.display,
				eventDatesRaw: first.raw,
				...(hover ? { eventHover: hover } : {})
			};
			out.events = dataArrayProducedEventsOf(out, hoverItems, { id: "pengpeng", tz }, at);
			out.eventHoverItems = hoverItems;
			return out;
		}

		// ══ 活动侧（2026-11-13）：TapTap tab 页的 **SSR payload**（`window.__NUXT_DATA__`）══
		// 解析在 22-fetcher-core.js 的 `ns_taptap_topicPostsOf`（Nuxt devalue 解码，两条链路共用）：
		//   HTML → [{ id, title, text, publishTime, url }]，text = `topic.summary` 的纯文本行。
		// 这里只保留「标题 → 活动名」与「行 → 窗口」两段纯函数（它们与 webapiv2 时期**逐字相同**）。
		// 标题 → 活动名：`🍃【新风同行】限时活动 即将开启` → `新风同行`；没有【】⇒ 用整条标题
		function pengpengTaptapNameOf(title) {
			const s = String(title == null ? "" : title).replace(/\s+/g, " ").trim();
			const m = /【([^】]{2,30})】/.exec(s);
			return m ? m[1].trim() : s;
		}

		// 一行「活动时间：…」→ 窗口事实。
		// 支持：`2026年11月5日 05:00 - 2026年11月19日 04:59`（两端绝对）
		//       `2026年10月22日版本更新后 - 2026年12月3日 04:59`（起点相对 ⇒ startTs=null）
		//       `2026年11月5日 - 2026年11月19日`（只有日期 ⇒ 00:00 / 23:59）
		// ⚠️ 两端都必须**自带年份**：源站写 `10月29日 5:00 - 11月12日 04:59`（【家族遗藏】）时没有年份来源
		//    ⇒ 整条不解（不猜当前年，与 hlr 同口径）。raw 保留源站原文（分隔符统一成 `~`）。
		const PENGPENG_TAPTAP_POINT_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(?:(\d{1,2})\s*[:：]\s*(\d{2})|(版本更新后|维护结束后|维护后|更新后))?/g;
		const PENGPENG_TAPTAP_CONNECTOR_RE = /^\s*[-~～〜—–－至到]\s*$/;

		function pengpengTaptapWindowsOf(text, tz = PENGPENG_TZ) {
			const s = String(text == null ? "" : text);
			const toks = [];
			PENGPENG_TAPTAP_POINT_RE.lastIndex = 0;
			let m;
			while ((m = PENGPENG_TAPTAP_POINT_RE.exec(s))) {
				if (m[0] === "") { PENGPENG_TAPTAP_POINT_RE.lastIndex++; continue; }
				toks.push({
					start: m.index, end: m.index + m[0].length,
					y: +m[1], mo: +m[2], d: +m[3],
					h: m[4] != null ? +m[4] : null,
					mi: m[5] != null ? +m[5] : null,
					rel: m[6] || ""
				});
			}
			const out = [];
			const seen = new Set();
			for (let i = 0; i + 1 < toks.length; i++) {
				const a = toks[i], b = toks[i + 1];
				if (!PENGPENG_TAPTAP_CONNECTOR_RE.test(s.slice(a.end, b.start))) continue;
				// 端点：起点 = 显式时刻 / 相对（未知）/ 只有日期（00:00）；终点 = 显式时刻 / 只有日期（23:59）
				const startTs = a.rel ? null : sourceInstant(a.y, a.mo, a.d, a.h == null ? 0 : a.h, a.mi == null ? 0 : a.mi, tz);
				const endTs = b.rel
					? null
					: sourceInstant(b.y, b.mo, b.d, b.h == null ? 23 : b.h, b.mi == null ? 59 : b.mi, tz);
				if (endTs == null) continue;                                    // 终点是相对表述 ⇒ 没有绝对时刻，丢掉
				if (startTs != null && !(endTs > startTs)) continue;
				const key = (startTs == null ? "open" : startTs) + "|" + endTs;
				if (seen.has(key)) continue;
				seen.add(key);
				const aRaw = s.slice(a.start, a.end).replace(/\s+/g, " ").trim();
				const bRaw = s.slice(b.start, b.end).replace(/\s+/g, " ").trim();
				const endWall = sourceWallParts(endTs, tz);
				const sameYear = a.y === endWall.y;
				const startText = startTs == null
					? (sameYear ? `${pad2(a.mo)}-${pad2(a.d)} ${a.rel}` : `${a.y}-${pad2(a.mo)}-${pad2(a.d)} ${a.rel}`)
					: (sameYear ? fmtMdHm(startTs, tz) : fmtYmdHm(startTs, tz));
				const endText = sameYear ? fmtMdHm(endTs, tz) : fmtYmdHm(endTs, tz);
				out.push({ startTs, endTs, raw: `${aRaw} ~ ${bRaw}`, display: `${startText} ~ ${endText}` });
			}
			return out;
		}

		// 一页帖子（`ns_taptap_topicPostsOf` 的产物）→ 活动事实 [{ name, url, startTs, endTs, raw, display }]
		function pengpengTaptapActivitiesOf(posts, tz = PENGPENG_TZ) {
			const out = [];
			const seen = new Set();
			for (const post of Array.isArray(posts) ? posts : []) {
				const name = pengpengTaptapNameOf(post.title);
				for (const line of String(post.text == null ? "" : post.text).split("\n")) {
					if (!/活动时间\s*[:：]/.test(line)) continue;               // 更新时间/折扣时间不算活动
					for (const w of pengpengTaptapWindowsOf(line, tz)) {
						const key = name + "|" + (w.startTs == null ? "open" : w.startTs) + "|" + w.endTs;
						if (seen.has(key)) continue;
						seen.add(key);
						out.push({ name, url: post.url, ...w });
					}
				}
			}
			return out;
		}

		async function fetchPengpengTaptapEvents(url, signal, tz = PENGPENG_TZ) {
			const at = nowMs();
			const base = String(url == null ? "" : url).trim() || PENGPENG_TAPTAP_PAGE_URL;
			const rows = [];
			let postCount = 0;
			for (let page = 1; page <= PENGPENG_TAPTAP_MAX_PAGES; page++) {
				let html;
				try {
					html = await fetchText(pengpengTaptapPageUrl(base, page), {
						signal, mode: "proxy", referer: PENGPENG_TAPTAP_REFERER
					});
				} catch (e) {
					if (page === 1) throw e;                                    // 第 1 页失败 = 真失败
					break;                                                      // 后续页失败 ⇒ 用手上已有结果
				}
				// SSR → 帖子（结构变了会抛 `taptap-topic:*`，不静默降级成"未公布"）
				const posts = ns_taptap_topicPostsOf(html);
				postCount += posts.length;
				const pageRows = pengpengTaptapActivitiesOf(posts, tz);
				for (const x of pageRows) rows.push(x);
				// 第 1 页已经覆盖当前窗口 ⇒ 再往后只会更旧，不再翻（任务口径：覆盖不到才翻，最多 2 页）
				if (pageRows.some((r) => coversNow(r, at))) break;
			}
			// 有响应但一帖都没解析出来 = 响应结构变了 ⇒ 抛错（抓取失败 ≠ 未公布）
			if (postCount === 0) throw new Error("taptap-topic:no-post");
			if (rows.length === 0) return null;
			// 外显 = **文档顺序里第一条覆盖 now 的**（列表从新到旧 ⇒ 最新公布的那条当期活动；
			// 与 hlr 的"第一条覆盖 now = 当前最新一期"同一口径）
			const live = rows.filter((r) => coversNow(r, at));
			if (live.length === 0) return null;
			const first = live[0];
			// 悬停 = 全部在期 / 起点未知但终点未过，按结束时间升序（与旧活动侧同一排版）
			const hoverItems = rows.filter((r) => coveredOrOpen(r, at))
				.sort((a, b) => (a.endTs - b.endTs) || ((a.startTs == null ? Infinity : a.startTs) - (b.startTs == null ? Infinity : b.startTs)))
				.map((r) => ({ title: r.name, startTs: r.startTs, endTs: r.endTs, raw: r.raw }));
			const hover = hoverTextFromItems(hoverItems, "event", tz);
			const out = {
				event: first.name,
				eventDates: first.display,
				eventDatesRaw: first.raw,
				...(hover ? { eventHover: hover } : {})
			};
			out.events = dataArrayProducedEventsOf(out, hoverItems, { id: "pengpeng", tz }, at);
			out.eventHoverItems = hoverItems;
			return out;
		}

		// ── 条目 ──
		registerSource({
			id: "pengpeng",
			defaultHidden: true,
			tz: PENGPENG_TZ,
			name: "夜幕之下",
			icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/3f/59/95/3f599572-4d8c-f4f3-0270-1ee72e007926/AppIcon-1x_U007emarketing-0-8-0-85-220-0.png/512x512bb.jpg",
			url: PENGPENG_ASK_URL,
			// 卡池来源标签 = **数据是 bwiki 的 SMW（语义查询）给的**，不是那个已改成 #REDIRECT 的
			// HTML 页。标签里**不再写「停更」**：停更的是 wiki 的内容（最后一期止于 2026-09-10），
			// 而"卡池列现在为空"是内容停更的结果、不是这条链路坏了 —— 两者混在一句里会让人以为
			// 抓取器坏了。等 wiki 补档，这里不需要改任何字。
			source: "Bwiki",
			// 活动侧默认源 = TapTap tab 页的 SSR（允许路径，2026-11-13 换；用户可见标签仍是「TapTap」）；
			// 旧 bwiki 公告源保留为手动备选
			eventUrl: PENGPENG_TAPTAP_PAGE_URL,
			eventSource: "TapTap",
			eventAltSources: [
				{ label: "Bwiki 公告（不可靠）", url: PENGPENG_EVENT_URL, fetcher: "pengpeng-bwiki" }
			]
		});

		GACHA_FETCHERS["pengpeng"] = (url, signal, tz) => ns_pengpeng_gachaPengpeng(url, signal, tz);
		EVENT_FETCHERS["pengpeng"] = {
			default: (url, signal, tz) => fetchPengpengTaptapEvents(url, signal, tz),
			"pengpeng-bwiki": (url, signal, tz) => fetchPengpengEvents(url, signal, tz)
		};
