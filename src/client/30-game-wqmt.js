// src/client/30-game-wqmt.js —— 无期迷途（国服 · AISNO / 自意）
//
// 两侧**都是真源**（2026-11-09 实测 200，夹具见 test/fixtures/wqmt-*）：
//   · 卡池 = bwiki「追踪一览」= MediaWiki `api.php?action=parse`（HTML 表，174 行 / 307KB）
//       列：追踪页面 | 开启时间 | 概率提升；行属性 `data-param1` = 卡池筛选类型
//       行例：隐秘深渊-格芮芙、渡鸦、阿黛拉、卡门奈特 | 统合追踪 | 2026-11-11 开服后 ～ 2026-12-09 09:59:59
//   · 活动 = 官方资讯 API `https://wqmt.aisnogames.com/api/news`（响应带 `ACAO:*` ⇒ **直连**，
//       不走宿主代理）。列表 `data.{allNews,activity,news,notices}` 各 5 条、**无分页**
//       （page/section/type 参数均不生效）；正文 `GET /api/news/<id>` → `data[0].content_html`。
//
// ── 时区（按源站墙钟 UTC+8 解析）────────────────────────────────────────────────
// 源站**没有**任何时区标注。判据：收池/结束时刻一律写成 `09:59:59` / `04:59` 这种"整点差一分"
// 的国内二游惯用写法，公告正文里的维护窗口是 `10:00-14:00`，与 UTC+8 的整点维护一致
// ⇒ 按 UTC+8 解释（来源声明的 tz = Asia/Shanghai）。**这是推定**，所以只写在这里；
// 悬停里不许出现元信息（规则见 test/cases-rule-lint.mjs）。
//
// ── 「开服后」= 起点只有日期、没有时刻（本文件最需要读清的一段）──────────────────
// 卡池表 174 行**全部**写成 `YYYY-MM-DD 开服后`，无一行给时刻。要写 startTs 就必须有
// 「开服时刻锚点」，本文件有锚点机制 `wqmtMaintAnchorsOf`：从**公告正文**里读
// `维护时间：10月13日10:00-14:00` ⇒ 那一天的开服时刻 = 维护窗口的**结束**（14:00）。
//   · 有锚点 ⇒ 写 startTs（该日期 + 维护结束时刻）；
//   · 没有锚点 ⇒ **退常量 14:00**（用户 2026-11-09 拍板，依据同上：实测 5 期维护公告
//     全部是 `10:00-14:00`）。卡池侧为了拿到锚点，会在同一次刷新里串行补 2 个请求
//     （资讯列表 1 次 + 最新维护公告正文 1 次，见 `wqmtGachaAnchorsOf`）；
//     取不到也不影响出数据，只是用常量。
//   · **日期都解析不到 ⇒ startTs = null**（起点未知）。这种行不参与"是否已开始"的判定
//     （2026-11-09 全仓口径：`coversNow` 不再把 null 起点当已开始），只在悬停里列出。
//
// ⚠️ 旧实现（2026-11-09 之前）**没有锚点就留 null**，而当时的 `coversNow` 把 null 起点当成
// "已开始" ⇒ 11-11 才开的 4 口池在 11-09 就显示成在期（假在期）。现在两头都改了：
// 钟点恒有（锚点 / 常量 14:00），判定也不再容 null ⇒ 未来批如实是未来（state=wait）。
//
// ── 两份文本：`raw` = 源站原文，`display` = 补全文本（2026-11-09，与星铁 `parseHsrWarp` 同口径）──
// 条目事实 = `{ name, startTs, endTs, raw, display, startText, endText }`（见 `wqmtWindowOf`）：
//   · `raw`     = `11-11 开服后 ~ 12-09 09:59` ← **锚点推出来的 14:00 不许写进来**；
//   · `display` = `11-11 14:00 ~ 12-09 09:59` ← 真正给面板外显的那一行；
//   · 两端都有时刻的窗口 ⇒ 两者逐字相同（源站本来就给全了）。
// 载荷与悬停各取一份：`bannerDates`/`eventDates` ← `display`、`bannerDatesRaw`/`eventDatesRaw` ← `raw`、
// 悬停 `hoverItems[].raw` ← `raw`。⚠️ 这两份**不许合并**：合并 = 悬停把 `开服后` 印成 `14:00`，
// 用户会以为源站明说了 14:00（2026-11-09 实测反馈，原文见 `30-game-bwiki-common.js` 文件头）。
//
// ── 卡池类型（category）──
// 行属性 `data-param1` 是 bwiki 的**筛选**分类（限定追踪 / 统合追踪 / 联动追踪 …），
// 单元格里那行加粗字更细（返场·限定追踪 / 复刻·联动追踪）。取**加粗那一行**（更具体），
// 取不到才退回 `data-param1`。它进数组条目的 `category`（通过 `itemFacts` 通道）。
//
// ── 活动侧的两条窗口来源（正文里长什么样，见 wqmtEventWindowsOf）──
//   ① `■「破碎防线·暗域」第35期开启，11月02日 05:00 ~ 12月14日 04:00，…` —— 两端时刻都明确；
//   ② `■活动时间：11月11日 开服后~12月09日 07:59` —— 起点是「开服后」，走上文那套锚点。
// 只有**两端都有明确时刻**的 `「…」…A ~ B` 才算 ①（要求两端都带 HH:MM），
// 否则维护公告里那些「将于X月X日结束」的句子会被拼成假区间。
//
// ── 活动为什么**不写** category / tags ──────────────────────────────────────────
// 官方资讯只有「栏目」（预告 / 公告 / 生日会），那是**公告体裁**，不是活动类型；按标题里的
// `【预告】` 贴个 category 会让档位判定去读一个假事实。取不到就**不写这个键**（不是空串）——
// 与 `dataArrayOptionalFactsOf` 的"没有这个事实"同口径。

		// ── 来源常量 ──
		const WQMT_TZ = "Asia/Shanghai";
		const WQMT_BWIKI_URL = "https://wiki.biligame.com/wqmt/api.php?action=parse&page=追踪一览&prop=text&format=json&formatversion=2";
		const WQMT_NEWS_URL = "https://wqmt.aisnogames.com/api/news";
		const WQMT_NEWS_DETAIL = "https://wqmt.aisnogames.com/api/news/";
		// 逐条取正文的条数上限：列表一共只有 15 条（三个栏目各 5），一次刷新取最新 **10** 条正文
		// ≈ 10 次串行请求（实测每条约 0.3s，远低于 REFRESH_TIMEOUT_MS = 20s）。
		// ⚠️ 2026-11-10 修：原来 6 条。11-09 起「禁闭者装束 / 档案 / 影像捕获 / MBCC前瞻」这类非档期
		//    公告密集发布，把真正写档期的 10/27 停服维护公告（id=2099）挤到第 7 位 ⇒ 被截断、活动空窗。
		//    配额提到 10 后 2099 落在候选内（实测其正文能出 2 条在期窗口）。
		const WQMT_EVENT_MAX_DETAILS = 10;
		// 正文里最多认几条活动：维护公告那种正文能扫出十几条「A ~ B」，再多悬停就没法看了。
		const WQMT_EVENT_MAX_ITEMS = 12;

		// 「开服后 / 维护后 / 更新后」= 只有日期没有时刻。**只有这一份词表**，两个用途：
		//   ① 判"这一端是不是相对表述"（`wqmtPointOf.open`）；
		//   ② 把源站**原话**取出来留在 `raw` 里（`开服后` 不能只剩 `开服`；见文件头「两份文本」）。
		const WQMT_OPEN_RE = /开服后|维护结束后|维护完成后|维护后|更新维护后|更新结束后|更新完成后|更新后|开服|维护|更新/;
		// ── 「开服后」的钟点锚（2026-11-09 用户拍板）─────────────────────────────────
		// 官方维护公告写「维护时间：10月27日10:00-14:00」⇒ **开服 = 窗口结束**。公告解析不到窗口时
		// 退这个常量（14:00），依据同上（实测 5 期维护公告全部是 10:00-14:00）。
		// ⚠️ 与旧实现的关键差别：旧实现**没有锚点就留 null**（起点未知），而 `coversNow` 当时把
		//    `startTs == null` 当成"已开始" ⇒ 11-11 才开的池子在 11-09 就显示成在期（假在期）。
		//    现在改成"恒定锚定一个钟点"，于是未来批如实是**未来**（state=wait，不进近期/提醒）。
		const WQMT_OPEN_FALLBACK_HOUR = 14;
		const WQMT_YMD_RE = /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/;
		const WQMT_MD_RE = /(\d{1,2})\s*月\s*(\d{1,2})\s*日?/;
		const WQMT_HM_RE = /(\d{1,2})\s*[:：]\s*(\d{2})/;
		// 维护窗口（锚点）：`维护时间：10月13日10:00-14:00`
		const WQMT_MAINT_RE = /维护时间\s*[：:]\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~—–]\s*(\d{1,2})\s*[:：]\s*(\d{2})/;
		// 活动窗口 ②：`活动时间：11月11日 开服后~12月09日 07:59`
		const WQMT_EVENT_TIME_RE = /(?:活动时间|开启时间|开放时间|持续时间)\s*[：:]\s*([^\n]{4,120})/;
		// 活动窗口 ①：`「名称」后缀，11月02日 05:00 ~ 12月14日 04:00`（**两端都必须带 HH:MM**）
		const WQMT_EVENT_QUOTED_RE = /「([^」\n]{1,30})」([^，。；\n]{0,12})，\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*[~～]\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:：]\s*(\d{2})/g;
		// 名称尾巴上那些动作词（`第35期开启` → `第35期`；`上半赛季开启` → `上半赛季`）
		const WQMT_NAME_TAIL_RE = /(开启|开始|开放|上线|结束|复刻|限时|活动)+$/;

		//#region 时间解析（bwiki 卡池表 / 官方公告正文共用）
		// 一段文本 → { y, mo, d, h, mi, open, openWord }；`h == null` = 这一端没有时刻。
		// `open` = 源站用「开服后」代替了时刻（起点专用）；`openWord` = **源站那句原话**
		// （`开服后` / `维护后` / `更新后`…），原文（`raw`）要原样带上它，见文件头「两份文本」。
		function wqmtPointOf(text) {
			const s = String(text == null ? "" : text).replace(/～/g, "~").replace(/[\s\u00a0]+/g, " ").trim();
			const hm = s.match(WQMT_HM_RE);
			const ymd = s.match(WQMT_YMD_RE);
			let y = null, mo = null, d = null;
			if (ymd) { y = Number(ymd[1]); mo = Number(ymd[2]); d = Number(ymd[3]); }
			else {
				const md = s.match(WQMT_MD_RE);
				if (!md) return null;
				mo = Number(md[1]); d = Number(md[2]);
			}
			if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
			const oword = hm ? null : s.match(WQMT_OPEN_RE);
			return {
				y, mo, d,
				h: hm ? Number(hm[1]) : null,
				mi: hm ? Number(hm[2]) : null,
				open: !!oword,
				openWord: oword ? oword[0] : ""
			};
		}

		// 一端的「补全文本 + 源站原文 + 绝对时刻」—— 三个都返回，因为这两份文本**不许合并**
		// （合并 = 悬停再也判不出相对表述，见 `30-game-bwiki-common.js` 文件头「两份文本」约定）。
		// 四种写法各有明确口径（都不猜时刻）：
		//   · 有时刻            → `text` 与 `rawText` 相同（照写）；
		//   · 「开服后」+ 锚点   → 补全 TEXT = 锚点时刻（维护窗口结束）；`rawText` 仍是 `MM-DD 开服后`；
		//   · 「开服后」无锚点   → 补全 TEXT = 常量 `openFallbackHour`（14:00，用户拍板）；
		//                          `rawText` 仍是 `MM-DD 开服后`（**原文不跟着被补全**）；
		//   · 只有日期、没有「开服后」（源站没这么写过，但别崩）→ 按 00:00 / 23:59 的既有约定
		//     （见 30-game-bwiki-common.js 的 windowsFromCell：这是全仓对"只有日期"的通用处理）。
		// 连年份都定不下来 ⇒ `ts = null`，但两份文本照给（不编时刻、也不丢原文）。
		function wqmtEndOfPoint(p, tz, fallbackH, fallbackMi, anchors, isStart, openFallbackHour) {
			const h = p.h == null ? fallbackH : p.h;
			const mi = p.mi == null ? fallbackMi : p.mi;
			const text = `${pad2(p.mo)}-${pad2(p.d)} ${pad2(h)}:${pad2(mi)}`;
			// 原文：源站用相对表述代替时刻时，原话（`开服后`）留在 raw 里，不写补全出来的钟点
			const rawText = isStart && p.h == null && p.open ? `${pad2(p.mo)}-${pad2(p.d)} ${p.openWord || "开服后"}` : text;
			if (!isStart) return { ts: sourceInstant(p.y, p.mo, p.d, h, mi, tz), text, rawText };
			if (p.h != null) return { ts: sourceInstant(p.y, p.mo, p.d, h, mi, tz), text, rawText };
			if (!p.open) return { ts: sourceInstant(p.y, p.mo, p.d, h, mi, tz), text, rawText };
			const anchor = anchors ? anchors[p.mo + "-" + p.d] : null;
			if (anchor != null) return { ts: anchor, text: fmtMdHm(anchor, tz), rawText };
			if (openFallbackHour != null && p.y != null) {
				const ts = sourceInstant(p.y, p.mo, p.d, openFallbackHour, 0, tz);
				return { ts, text: fmtMdHm(ts, tz), rawText };
			}
			return { ts: null, text: rawText, rawText };
		}

		// 一个「A ~ B」窗口 → **条目事实**（与 bwiki 通用层、星铁同一形状）：
		// `{ startTs, endTs, raw, display, startText, endText }`
		//   · `raw`     = 源站原文那一段：起点是「开服后」⇒ `11-11 开服后 ~ 12-09 09:59`（钟点不被补进来）；
		//                 两端都有时刻 ⇒ 与 `display` 逐字相同。
		//   · `display` = 补全后的可读文本：`11-11 14:00 ~ 12-09 09:59`（源站 tz 墙钟）。
		// 载荷按约定各取一份：`bannerDates`/`eventDates` ← display、`*DatesRaw` 与悬停 ← raw。
		function wqmtWindowOf(text, tz, anchors, hint) {
			const s = String(text == null ? "" : text).replace(/～/g, "~");
			const parts = s.split("~");
			if (parts.length < 2) return null;
			const a0 = wqmtPointOf(parts[0]);
			const b0 = wqmtPointOf(parts[parts.length - 1]);
			if (!a0 || !b0) return null;
			// 公告正文里的日期常常不带年份 ⇒ 用正文的发布时刻当"年份线索"（共用 inferYear）
			const a = { ...a0, y: inferYear(a0.y, a0.mo, hint) };
			if (a.y == null) return null;
			const endYear = b0.y != null ? b0.y : inferYear(null, b0.mo, { y: a.y, mo: a.mo });
			const b = { ...b0, y: endYear == null ? a.y : endYear };
			// 跨年（12-20 ~ 01-05）：结束月份小于开始月份 ⇒ 结束记次年（共用 endsNextYear）
			if (b0.y == null && a0.y == null && endsNextYear(a.mo, a.d, b.mo, b.d)) b.y = a.y + 1;
			const st = wqmtEndOfPoint(a, tz, 0, 0, anchors, true, WQMT_OPEN_FALLBACK_HOUR);
			const en = wqmtEndOfPoint(b, tz, 23, 59, anchors, false, null);
			if (!(en.ts > (st.ts == null ? 0 : st.ts))) return null;
			return {
				startTs: st.ts, endTs: en.ts,
				raw: `${st.rawText} ~ ${en.rawText}`,
				display: `${st.text} ~ ${en.text}`,
				startText: st.text, endText: en.text
			};
		}
		//#endregion

		//#region 卡池（bwiki 追踪一览）
		// 单元格里加粗的那行 = 更具体的卡池类型（`返场·限定追踪`）；取不到退回行属性 `data-param1`。
		function wqmtTypeOf(html, attrs) {
			const m = String(html == null ? "" : html).match(/<b[^>]*>([\s\S]*?)<\/b>/i);
			const bold = m ? stripTags(m[1]).trim() : "";
			return bold || ns_bwiki_attrOf(attrs || "", "data-param1");
		}

		// 「概率提升」列 → 角色名。名字只住在 `<a title="禁闭者:黛伦">` 的 title 里（正文是图片），
		// 所以走 `ns_bwiki_linkTitles`，再去掉 `禁闭者:` 这个命名空间前缀。
		function wqmtRolesOf(html) {
			return ns_bwiki_linkTitles(html)
				.map((t) => String(t).replace(/^禁闭者\s*[:：]\s*/, "").trim())
				.filter(Boolean)
				.join("、");
		}

		// 「追踪页面」列 → 池名。
		// 源站写法是 `<池名>-<角色1>、<角色2>…`（如 `隐秘深渊-格芮芙、渡鸦、阿黛拉、卡门奈特`）。
		// 只有**右侧每一项都能在「概率提升」列里找到**时才拆开（不猜：对不上就整串当池名），
		// 避免把池名本身带的 `-` 误切。
		function wqmtPoolNameOf(text, roles) {
			const s = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
			const at = s.indexOf("-");
			if (at > 0 && roles) {
				const chars = s.slice(at + 1).split(/[、,，]/).map((x) => x.trim()).filter(Boolean);
				const pool = new Set(String(roles).split(/[、,，]/).map((x) => x.trim()).filter(Boolean));
				if (chars.length > 0 && chars.every((c) => pool.has(c))) return s.slice(0, at).trim();
			}
			return s;
		}

		// HTML → 逐条 `{ banner, roles, category, startTs, endTs, raw, isMain }`（= whmx 同形的条目）
		function wqmtPoolsOf(html, tz, anchors) {
			const tables = ns_bwiki_findTablesByHeaders(ns_bwiki_eachTable(String(html == null ? "" : html)), ["追踪页面", "开启时间"]);
			const out = [];
			let i = 0;
			for (const tbl of tables) {
				for (const r of ns_bwiki_tableRows(tbl)) {
					const cells = r.cells || [];
					if (cells.length < 3) continue;
					const win = wqmtWindowOf(cells[1].text, tz, anchors, null);
					if (!win) continue;
					const roles = wqmtRolesOf(cells[2].html);
					const banner = wqmtPoolNameOf(cells[0].text, roles);
					if (!banner) continue;
					out.push({ banner, roles, category: wqmtTypeOf(cells[1].html, r.attrs), ...win, isMain: true, _i: i++ });
				}
			}
			return out;
		}
		//#endregion

		//#region 活动（官方资讯 API）
		// 正文 HTML → 纯文本（保留行结构：维护公告的每一条都在单独一行）
		function wqmtBodyTextOf(html) {
			return decodeHtmlEntities(String(html == null ? "" : html)
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
				.replace(/<[^>]+>/g, ""))
				.replace(/[ \t\u00a0]+/g, " ")
				.replace(/\n[ \t]*/g, "\n")
				.replace(/\n{2,}/g, "\n")
				.trim();
		}

		// 标题 → 活动名。
		// 公告标题是长句（`【预告】丨MBCC特别庆典·「恩慈余光」全新主线11月11日开启`），日历要的是
		// 名称：先去掉开头那个 `【预告】丨` 体裁标签，再取 `「…」` 里的名字（源站用引号标出名字，
		// 这是它自己的约定，不是我们猜的）；没有引号就用剩下的整句。
		function wqmtEventNameOf(title) {
			const s = String(title == null ? "" : title).replace(/^\s*【[^】]{1,12}】\s*[丨|｜]?\s*/, "").trim();
			const q = s.match(/[「『]([^」』]{1,40})[」』]/);
			return (q ? q[1] : s).trim();
		}

		// 公告列表 → 待取正文的候选（去重、按发布时间从新到旧、取前 N 条）
		function wqmtEventCandidatesOf(data) {
			const out = [], seen = new Set();
			for (const sec of ["news", "activity", "notices"]) {
				const arr = data && Array.isArray(data[sec]) ? data[sec] : [];
				for (const it of arr) {
					if (!it || it.id == null || seen.has(it.id)) continue;
					seen.add(it.id);
					const at = Date.parse(String(it.publish_time || ""));
					out.push({ id: it.id, title: String(it.title || ""), at: Number.isFinite(at) ? at : null });
				}
			}
			out.sort((a, b) => (b.at || 0) - (a.at || 0));
			return out.slice(0, WQMT_EVENT_MAX_DETAILS);
		}

		// 维护窗口 → 开服锚点表（`{ "8-20": ts, … }`）。键 = `月-日`（不补零，两端一致）。
		// 只从**本轮已经取到的正文**里读，不额外发请求（否则活动侧要再打一轮公告接口）。
		function wqmtMaintAnchorsOf(bodies, tz) {
			const out = {};
			for (const b of bodies) {
				if (b.at == null) continue;
				const m = WQMT_MAINT_RE.exec(b.text || "");
				if (!m) continue;
				const hint = sourceWallParts(b.at, tz);
				const y = inferYear(null, Number(m[1]), hint);
				if (y == null) continue;
				// 开服时刻 = 维护窗口的**结束**（`10:00-14:00` → 14:00）
				out[Number(m[1]) + "-" + Number(m[2])] = sourceInstant(y, Number(m[1]), Number(m[2]), Number(m[5]), Number(m[6]), tz);
			}
			return out;
		}

		// 一份正文 → 活动窗口条目（两种写法，见文件头）。`hint` = 该公告发布时刻的源站墙钟。
		function wqmtEventWindowsOf(text, title, hint, tz, anchors) {
			const out = [];
			const s = String(text == null ? "" : text);
			// ① `「名称」后缀，A HH:MM ~ B HH:MM`
			WQMT_EVENT_QUOTED_RE.lastIndex = 0;
			let m;
			while ((m = WQMT_EVENT_QUOTED_RE.exec(s))) {
				const name = (m[1] + String(m[2] || "").trim().replace(WQMT_NAME_TAIL_RE, "")).trim();
				if (!name) continue;
				const win = wqmtWindowOf(
					`${m[3]}月${m[4]}日 ${m[5]}:${m[6]} ~ ${m[7]}月${m[8]}日 ${m[9]}:${m[10]}`,
					tz, anchors, hint
				);
				if (!win) continue;
				out.push({ name, ...win });
			}
			// ② `活动时间：A ~ B`（名称来自公告标题）
			const t = WQMT_EVENT_TIME_RE.exec(s);
			if (t) {
				const win = wqmtWindowOf(t[1], tz, anchors, hint);
				const name = wqmtEventNameOf(title);
				if (win && name) out.push({ name, ...win });
			}
			return out;
		}

		// 条目事实 → 载荷（与 `genericEventPayload` 同一套：`sortEventItems` 排序、
		// `pickEventPrimary` 挑外显、`hoverTextFromItems` 反生成悬停、`dataArrayProducedEventsOf` 收口）
		// 档期两键**各取一份**（文件头「两份文本」）：`eventDates` ← `display`、`eventDatesRaw` ← `raw`。
		function wqmtEventPayloadOf(items, tz, now) {
			const active = sortEventItems((Array.isArray(items) ? items : []).filter((it) => coversNow(it, now)));
			if (active.length === 0) return null;
			const primary = pickEventPrimary(active) || active[0];
			const hoverItems = active.map((x) => ({ title: x.name, startTs: x.startTs, endTs: x.endTs, raw: x.raw }));
			const hover = hoverTextFromItems(hoverItems, "event", tz);
			const out = {
				event: primary.name,
				eventDates: primary.display,
				eventDatesRaw: primary.raw,
				...(hover ? { eventHover: hover } : {})
			};
			out.events = dataArrayProducedEventsOf(out, hoverItems, { id: "wqmt", tz }, now);
			out.eventHoverItems = hoverItems;
			return out;
		}
		//#endregion

		//#region 抓取器（契约：async (url, signal, tz) → 数据对象 | null；now 在最后、有默认值）
		// ── 开服锚点（卡池侧）────────────────────────────────────────────────────────
		// 卡池表只有「11-11 开服后」，钟点写在**维护公告正文**里。活动侧会顺手读到那份正文
		// （`wqmtMaintAnchorsOf`），卡池侧只抓 bwiki、手上没有正文 ⇒ 用**同一条资讯接口**补：
		//   ① `/api/news` 列表 1 次（找最新的「维护」公告）；
		//   ② 该公告正文 1 次 → `维护时间：10月27日10:00-14:00` ⇒ 当日开服 = 窗口结束。
		// 全程串行（bwiki 那条只打一个端点，不并发）；**任何一步失败都不影响卡池**：
		// 锚点是增强，取不到就退常量 14:00（`WQMT_OPEN_FALLBACK_HOUR`）。
		async function wqmtGachaAnchorsOf(signal, tz) {
			try {
				const list = await fetchJson(WQMT_NEWS_URL, { mode: "direct", signal });
				const data = list && list.data;
				if (!data || typeof data !== "object") return {};
				const seen = new Set(), cands = [];
				for (const sec of ["notices", "news", "activity", "allNews"]) {
					for (const it of Array.isArray(data[sec]) ? data[sec] : []) {
						if (!it || it.id == null || seen.has(it.id)) continue;
						seen.add(it.id);
						const title = String(it.title || "");
						// 只认会写维护窗口的公告（`【公告】丨10月27日停服维护更新公告`）
						if (!/维护/.test(title)) continue;
						const at = Date.parse(String(it.publish_time || ""));
						cands.push({ id: it.id, at: Number.isFinite(at) ? at : null });
					}
				}
				cands.sort((a, b) => (b.at || 0) - (a.at || 0));
				// 最多试 2 条（最新一期正常就 1 次；某条正文坏了再往下看一条，不影响总预算）
				for (const c of cands.slice(0, 2)) {
					try {
						const j = await fetchJson(WQMT_NEWS_DETAIL + c.id, { mode: "direct", signal });
						const row = j && Array.isArray(j.data) ? j.data[0] : null;
						const anchors = wqmtMaintAnchorsOf([{ at: c.at, text: wqmtBodyTextOf(row && row.content_html) }], tz);
						if (Object.keys(anchors).length) return anchors;
					} catch {
						// 单条正文失败 ⇒ 看下一条（都不行就退常量）
					}
				}
				return {};
			} catch {
				// 列表都拿不到 ⇒ 没有锚点（常量兜底），卡池照常出数据
				return {};
			}
		}

		// 卡池：bwiki（biligame 系主机 ⇒ 必须走宿主代理，见 15-env.js 的 CORS 收口点）
		async function ns_wqmt_gachaWqmt(url, signal, tz = WQMT_TZ, now) {
			const at = typeof now === "number" && Number.isFinite(now) ? now : nowMs();
			const html = await fetchMediaWikiText(url, { signal, mode: "proxy" });
			const anchors = await wqmtGachaAnchorsOf(signal, tz);
			const items = wqmtPoolsOf(html, tz, anchors);
			// 页面拿到了却一行候选都没有 ⇒ 表结构变了（抛错 = 该侧"抓取失败"，与"未公布"分开）
			if (items.length === 0) throw new Error("wqmt-no-table");
			return ns_bwiki_batchGachaPayloadOf(items, tz, at, { id: "wqmt" });
		}

		// 活动：官方资讯 API（`ACAO:*` ⇒ 直连），列表 1 次 + 正文最多 10 次
		async function ns_wqmt_eventsNews(url, signal, tz = WQMT_TZ, now) {
			const at = typeof now === "number" && Number.isFinite(now) ? now : nowMs();
			const list = await fetchJson(url, { mode: "direct", signal });
			const data = list && list.data;
			if (!data || typeof data !== "object") throw new Error("wqmt-news-no-section");
			const cands = wqmtEventCandidatesOf(data);
			if (cands.length === 0) return null;                 // 列表结构正常、但一条公告都没有 ⇒ 未公布
			const bodies = [];
			for (const c of cands) {
				try {
					const j = await fetchJson(WQMT_NEWS_DETAIL + c.id, { mode: "direct", signal });
					const row = j && Array.isArray(j.data) ? j.data[0] : null;
					bodies.push({ id: c.id, title: c.title, at: c.at, text: wqmtBodyTextOf(row && row.content_html) });
				} catch {
					// 单条正文失败不影响其它条目（同源容错）：列表已经拿到了，能出几条算几条。
					// 但**全都失败** ⇒ 下面抛错（改版要看得见，不能静默成"未公布"）。
				}
			}
			if (bodies.length === 0) throw new Error("wqmt-news-no-body");
			const anchors = wqmtMaintAnchorsOf(bodies, tz);
			const items = [];
			const seen = new Set();
			for (const b of bodies) {
				const hint = b.at == null ? null : sourceWallParts(b.at, tz);
				for (const it of wqmtEventWindowsOf(b.text, b.title, hint, tz, anchors)) {
					if (seen.has(it.name)) continue;
					seen.add(it.name);
					items.push(it);
					if (items.length >= WQMT_EVENT_MAX_ITEMS) break;
				}
				if (items.length >= WQMT_EVENT_MAX_ITEMS) break;
			}
			return wqmtEventPayloadOf(items, tz, at);
		}
		//#endregion

		// ── 条目 ──
		registerSource({
			id: "wqmt",
			defaultHidden: false,
			tz: WQMT_TZ,
			name: "无期迷途",
			icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/16/c7/c7/16c7c783-035b-4014-2c23-f0af50d1a563/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
			url: WQMT_BWIKI_URL,
			source: "Bwiki",
			eventUrl: WQMT_NEWS_URL,
			eventSource: "官方公告",
		});

		GACHA_FETCHERS["wqmt"] = (url, signal, tz) => ns_wqmt_gachaWqmt(url, signal, tz);
		EVENT_FETCHERS["wqmt"] = Object.assign(EVENT_FETCHERS["wqmt"] || {}, { default: (url, signal, tz) => ns_wqmt_eventsNews(url, signal, tz) });
