// src/client/30-game-daum.js —— 赛马娘 Pretty Derby **韩服**（Daum 카페 官方「月间日程」；2026-11-15 接入）
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
		const UMA_KR_SOURCE_LABEL = "Daum 카페 月间日程";
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
		 * 起点写 `점검 완료 후` ⇒ `startTs = null`（**不编一个时刻**），`display` 与 `raw` 同值。
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
			const startTs = openStart ? null : sourceInstant(y1, mo1, d1, h1, mi1, tz);
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
