// src/client/30-game-netease.js —— 时空中的绘旅人（国服）：官网新闻列表 + 学院公告 + 详情（卡池 + 活动）
//
// ── 为什么现在能接（2026-11-09 调研）────────────────────────────────────────────
// 旧结论是「官网只有公告 HTML（SSR），没有列表接口 / 没有稳定分页」⇒ 当时只注册条目、来源留空。
// 本批实测：`hlr.163.com/news/official/` 就是**静态列表页**（200 / 27,309 B / 6 条一页，
// 页脚 `index_2.html` … `index_280.html`），条目结构稳定：
//   <a title="…" href="…/news/official/20261105/30882_1318851.html"><span>新闻</span>
//     <p class="lside"><span class="title">…</span><span class="comment">…</span></p></a>
// 详情页正文在 `<div class="artText">`，标题 `<p class="artTitle">`，正文标注日期
// `<span class="artDate">时间：2026-10-31</span>`。
//
//  字段：活动[名称 ✓ 起止 ✓]、卡池[角色 ✓ 起止 ✓ 名称 ✓（「XX」活动画廊 / 活动卡池）]
//  代理：**必须**（响应不回 ACAO；`hlr.163.com` 已登记进宿主 PROXY_ALLOW_HOSTS）
//  维护：官方，最新 2026-11-05（官方通稿）/ 2026-11-04（学院公告）。
//        一次刷新 = 2 次列表（官方 + 学院公告）+ 详情：卡池侧最多 4 篇、活动侧最多 7 篇。
//  已知滞后：官网新闻是"活动开启"通稿，通常当天发；周末/版本末可能空档 ⇒ 抓不到当期就 nomatch，
//            不拿旧活动顶（与全仓口径一致）。
//
// ── 正文长什么样（真夹具 hlr-official-detail-20261105）──────────────────────────
//   「10月31日09:30 - 11月7日05:00，「怪谈：时融」活动画廊限时开启。活动期间，
//     叶瑄SSR[叠轨晨昏]获得概率提升。」
//   ⇒ 同一段里同时给出：窗口 / 画廊名（「…」 + 活动画廊|活动卡池）/ SSR 画灵名。
//   画灵名只取方括号里的部分（`叶瑄SSR[叠轨晨昏]` → `叠轨晨昏`），与 wd 的思绪名同口径。
//
// ── 缺年份怎么补（**本文件最容易错的地方**）────────────────────────────────────
//  正文常写 `10月31日09:30 - 11月7日05:00`（两端都无年份）。年份来源按优先级：
//    ① 详情页 `<span class="artDate">时间：YYYY-MM-DD</span>`（= 该活动开启日，最准）；
//    ② 详情页 URL 的 `YYYYMMDD`（`/news/official/20261105/…`）；
//    ③ 都拿不到 ⇒ 这一篇**不解**（不猜当前年）。
//  结束端：自身带 `YYYY年` 就用它（跨年），否则继承开始端年份，且
//  「结束月日早于开始月日」⇒ 结束进一年（`endsNextYear`，与全仓同一判据）。
//  真跨年用例：`12月27日09:30 - 2026年1月5日05:00`（夹具 hlr-official-detail-20251229，
//  artDate=2025-12-27）⇒ 2025-12-27 09:30 ~ 2026-01-05 05:00。
//
// ── 外显 vs 悬停 ──────────────────────────────────────────────────────────────
//  本侧窗口两端都明确（官网通稿都写钟点）⇒ 外显 = 覆盖 now 的活动里**结束最早**的那条；
//  悬停 = 全部覆盖 now / 终点未过的条目，按结束时间升序（`hoverTextFromItems` 统一排版）。
//  两份文本的约定与 bwiki 通用层一致：raw = 源站原文（分隔符统一 `~`），display = 补全文本
//  （跨年两端带年份，`fmtWindow` 同一规则）。
//
// ── 失败语义 ─────────────────────────────────────────────────────────────────
//  · 列表 / 详情 HTTP 非 2xx、响应不是文本 → 抛（该侧记失败）；
//  · 列表为空 / 没有活动类条目 → null（未公布）；
//  · 单篇详情失败 → 跳过该篇；全部失败且出现硬错 → 抛（别把封禁静默成未公布）；
//  · 正文没有窗口 / 没有画廊段 ⇒ 该条不产出（nomatch，不硬凑）。
//  卡池与活动是两个独立抓取器：一侧失败不影响另一侧。
//
// ── 2026-11-10 改：增抓「学院公告」（`/news/update/`，每周一条）────────────────────────
// 只抓 `/news/official/`（新活动通稿）时，通稿稀疏 ⇒ 2026-11-07 之后面板空窗。实测同站另一条
// 列表 `/news/update/`（学院公告）**每周一条**、6 条一页（分页 `index_2` … `index_51`），
// 正文里同样写 `活动时间：…` 与 `[画廊]开启「…」卡池…`，且**窗口可以很长**：
//   `10月1日新增内容公告`（update 列表第 5 条）里写着
//   `活动时间：2026年10月9日09:30-11月20日05:00`（缱绻假日）—— 这一条覆盖 11-09 之后的空窗。
// 方案：**两个列表都抓**（各 1 次请求），条目按"列表顺序 = 从新到旧"分别取前 N 篇详情。
//   为什么不改用 `/news/` 聚合页：聚合页第 1 页只有 6 条，官方通稿与学院公告混排，
//   而那条 10/1 公告在**学院公告列表第 5 条 / 聚合页第 2 页**——聚合页反而要多翻一页，
//   且"两类各占多少配额"无法控制；两个子列表各取配额更稳、也不依赖聚合页的分页形态。
// 标题分流：`HLR_EVENT_TITLE_RE` 原来只认 活动/版本/生日/联动，**「学院公告 | X月X日…」一个都不匹配**
//   ⇒ 放宽为把「学院公告」也算候选（正文里才有窗口）。维护公告也在候选里，没有窗口就自然不产出。
// 详情预算：旧值 3 篇只够官方通稿；学院公告每周一条、活动窗口长达 6 周 ⇒ 给 5 篇（约 6 周）。
//   卡池侧只需"当期画廊"，给 2 + 2 篇足够（同时避免为找过期画廊多打请求）。
//
// ── 2026-11-09 23:1x 真机复测（结论：解析链路正常，nomatch 是「官网活动空窗期」）───────
//  经宿主代理抓真页：列表 24,505 B、6 条（正则 6/6 命中）；最新详情 24,569 B，`artTitle` /
//  `artDate`（`时间：2026-10-31`）/ `artText` 全部命中，`hlrGalleryRowsOf` 出
//  `怪谈：时融 | 叠轨晨昏 | 10-31 09:30 ~ 11-07 05:00` —— 所以「真机没数据」**不是详情页解析坏了**。
//  真因：官网新闻首页此刻最新一篇仍是 **2026-11-05**，该期终点 11-07 05:00，而 now = 2026-11-09
//  ⇒ 没有任何覆盖 now 的窗口 ⇒ 按「不拿旧活动顶」如实 null。
//  （2026-11-10 起上面「增抓学院公告」已补上这个空窗：官网通稿仍是稀疏的，但学院公告里有长窗口。
//    旧结论仅作为历史记录保留；回归 `test/cases-wd-hlr.mjs` ⑧ 现在钉的是"活动出缱绻假日、画廊如实 null"。）

		const HLR_TZ = "Asia/Shanghai";
		const HLR_LIST_URL = "https://hlr.163.com/news/official/";
		// 学院公告（每周一条）：正文同样写 `活动时间：…` / `[画廊]开启「…」卡池…`，窗口可长达 6 周
		const HLR_UPDATE_LIST_URL = "https://hlr.163.com/news/update/";
		const HLR_REFERER = "https://hlr.163.com/";
		// 每侧详情预算 = 两类列表各取前 N 篇（列表顺序 = 从新到旧）。旧值 3 只够官方通稿，
		// 而当前覆盖期的那条活动写在学院公告第 5 条 ⇒ 活动侧给 5 篇（≈ 6 周）。
		const HLR_DETAIL_QUOTA = {
			gacha: { official: 2, update: 2 },
			event: { official: 2, update: 5 }
		};
		const HLR_MAX_DETAILS = HLR_DETAIL_QUOTA.event.official + HLR_DETAIL_QUOTA.event.update;   // 7（导出给用例/文档）
		// 列表页混着新闻 / 获奖名单 / 节气祝福 / 布告栏 ⇒ 只把「活动类」条目当候选。
		// ⚠️ 2026-11-10：原来只有 活动|版本|生日|联动，**「学院公告 | X月X日…」一个都不匹配** ——
		//    而新增的 `update` 列表标题全是「学院公告 | …」。不放宽这一条，增抓的列表会被整列过滤掉。
		//    维护公告也在候选里：正文没有窗口/没有画廊段 ⇒ 自然不产出（nomatch，不硬凑）。
		const HLR_EVENT_TITLE_RE = /活动|版本|生日|联动|学院公告/;

		// 从一个 HTML 片段的 depth 0 `<div …marker…>` 切到配对 `</div>`（artText 里嵌套 video div）
		function hlrDivOf(html, marker) {
			const s = String(html == null ? "" : html);
			const at = s.indexOf(marker);
			if (at < 0) return "";
			const open = s.lastIndexOf("<div", at);
			if (open < 0) return "";
			let depth = 0, m;
			const re = /<div\b[^>]*>|<\/div>/gi;
			re.lastIndex = open;
			while ((m = re.exec(s))) {
				if (m[0][1] !== "/") depth++;
				else {
					depth--;
					if (depth === 0) return s.slice(open, m.index + m[0].length);
				}
			}
			return s.slice(open);
		}

		function hlrAbsoluteUrl(href) {
			const h = String(href == null ? "" : href).trim();
			if (/^https?:\/\//i.test(h)) return h;
			if (h.startsWith("//")) return "https:" + h;
			return "https://hlr.163.com" + (h.startsWith("/") ? "" : "/") + h;
		}

		// 列表页 → [{ title, url, dateText, comment, kind }]（文档顺序 = 从新到旧）
		// 官方通稿 `/news/official/…` 与学院公告 `/news/update/…` 的条目结构逐字相同（只有目录不同），
		// 所以同一个正则吃两类，`kind` 只用于"按列表分配详情配额"。
		function hlrParseList(html) {
			const s = String(html == null ? "" : html);
			const out = [];
			const re = /<a\b[^>]*\btitle="([^"]*)"[^>]*\bhref="([^"]*\/news\/(official|update)\/(\d{8})\/[^"]+\.html)"[^>]*>([\s\S]*?)<\/a>/gi;
			let m;
			while ((m = re.exec(s))) {
				const inner = m[5];
				const c = /<span\b[^>]*class="[^"]*comment[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(inner);
				out.push({
					title: textOf(m[1]).replace(/\s+/g, " ").trim(),
					url: hlrAbsoluteUrl(m[2]),
					dateText: m[4],
					comment: c ? textOf(c[1]).replace(/\s+/g, " ").trim() : "",
					kind: m[3].toLowerCase()
				});
			}
			return out;
		}

		// 详情页 → { title, dateText, contentHtml }
		function hlrParseDetail(html) {
			const s = String(html == null ? "" : html);
			const t = /<p\b[^>]*class="[^"]*artTitle[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(s);
			const d = /<span\b[^>]*class="[^"]*artDate[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(s);
			return {
				title: t ? textOf(t[1]).replace(/\s+/g, " ").trim() : "",
				dateText: d ? textOf(d[1]).replace(/\s+/g, " ").trim() : "",
				contentHtml: hlrDivOf(s, 'class="artText"') || s
			};
		}

		// 年份来源：artDate 的 YYYY-MM-DD > URL 的 YYYYMMDD；都没有 ⇒ null（不解，不猜）
		function hlrYearOf(detail, url) {
			const m = /(\d{4})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})/.exec(String((detail && detail.dateText) || ""));
			if (m) return +m[1];
			// 官方通稿与学院公告的 URL 同形：`/news/<official|update>/YYYYMMDD/<id>.html`
			const u = /\/news\/(?:official|update)\/(\d{4})\d{4}\//.exec(String(url || ""));
			return u ? +u[1] : null;
		}

		// ── 时间窗口 ────────────────────────────────────────────────────────────
		// 完整年份 `2026年1月5日05:00` 必须排在省年份之前，否则会从 `1月5日` 起匹配、把年份丢掉。
		const HLR_POINT_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:：]\s*(\d{2})|(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:：]\s*(\d{2})/g;
		const HLR_CONNECTOR_RE = /^\s*[-~～〜—–－至到]\s*$/;

		function hlrPointsOf(text) {
			const s = String(text == null ? "" : text);
			const out = [];
			HLR_POINT_RE.lastIndex = 0;
			let m;
			while ((m = HLR_POINT_RE.exec(s))) {
				if (m[0] === "") { HLR_POINT_RE.lastIndex++; continue; }
				const abs = m[1] != null;
				out.push({
					start: m.index,
					end: m.index + m[0].length,
					y: abs ? +m[1] : null,
					mo: abs ? +m[2] : +m[6],
					d: abs ? +m[3] : +m[7],
					h: abs ? +m[4] : +m[8],
					mi: abs ? +m[5] : +m[9]
				});
			}
			return out;
		}

		// 正文 → 窗口事实 [{ startTs, endTs, raw, display }]。`refYear` 缺省 ⇒ 只解带年份的点。
		function hlrWindowsOf(text, refYear, tz = HLR_TZ) {
			const s = String(text == null ? "" : text);
			const toks = hlrPointsOf(s);
			const out = [];
			const seen = new Set();
			for (let i = 0; i + 1 < toks.length; i++) {
				const a = toks[i], b = toks[i + 1];
				if (!HLR_CONNECTOR_RE.test(s.slice(a.end, b.start))) continue;
				const startY = a.y != null ? a.y : (Number.isFinite(refYear) ? refYear : null);
				if (startY == null) continue;
				const endY = b.y != null ? b.y : startY + (endsNextYear(a.mo, a.d, b.mo, b.d) ? 1 : 0);
				const startTs = sourceInstant(startY, a.mo, a.d, a.h, a.mi, tz);
				const endTs = sourceInstant(endY, b.mo, b.d, b.h, b.mi, tz);
				if (!(endTs > startTs)) continue;
				const key = startTs + "|" + endTs;
				if (seen.has(key)) continue;
				seen.add(key);
				const aRaw = s.slice(a.start, a.end).replace(/\s+/g, " ").trim();
				const bRaw = s.slice(b.start, b.end).replace(/\s+/g, " ").trim();
				out.push({ startTs, endTs, raw: `${aRaw} ~ ${bRaw}`, display: fmtWindow(startTs, endTs, tz) });
			}
			return out;
		}

		// 正文段落（`<p>`）→ 纯文本；画廊/卡池名与画灵名都在同一段里
		function hlrBlocksOf(contentHtml) {
			const s = String(contentHtml == null ? "" : contentHtml);
			const out = [];
			const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
			let m;
			while ((m = re.exec(s))) {
				const t = textOf(m[1]).replace(/\s+/g, " ").trim();
				if (t) out.push(t);
			}
			return out;
		}

		// `叶瑄SSR[叠轨晨昏]` / `叶瑄SSR【叠轨晨昏】` → 叠轨晨昏
		const HLR_CARD_RE = /(?:SSR|SSS|SR|MR)\s*[\[【]([^\]】]+)[\]】]/g;
		function hlrRolesOf(text) {
			const s = String(text == null ? "" : text);
			const out = [], seen = new Set();
			HLR_CARD_RE.lastIndex = 0;
			let m;
			while ((m = HLR_CARD_RE.exec(s))) {
				const n = m[1].replace(/[（(].*$/, "").trim();
				if (!n || seen.has(n)) continue;
				seen.add(n);
				out.push(n);
			}
			return out.join("\u3001");
		}

		// 标题 → 活动名：`全新活动「怪谈：时融」现已开启！` → `怪谈：时融`
		function hlrNameOf(title) {
			const s = String(title == null ? "" : title).replace(/\s+/g, " ").trim();
			const m = /「([^」]+)」/.exec(s);
			return m ? m[1].trim() : s;
		}

		// 段落 → 活动名（学院公告里名字写在窗口前面，如 `[缱绻假日·世纪来电] 活动时间：…`）
		// 优先取紧邻「活动时间/开放时间」的 `[…]`/`【…】`/`「…」` 短语；没有就退回标题里的「…」。
		// ⚠️ 只做"把源站自己写的短语摘出来"，不改写、不补字；摘不到就用标题（与旧行为一致）。
		function hlrEventNameOf(block, title) {
			const t = String(block == null ? "" : block);
			const near = /[\[【「]([^\]】」]{2,30})[\]】」]\s*(?:活动时间|开放时间)/.exec(t);
			if (near) return near[1].trim();
			const lead = /^[\[【「]([^\]】」]{2,30})[\]】」]/.exec(t.trim());
			if (lead) return lead[1].trim();
			return hlrNameOf(title);
		}

		// 画廊段 → 卡池事实。只有同时含「活动画廊 / 活动卡池」+ 一个完整窗口的段落才算。
		function hlrGalleryRowsOf(block, refYear, tz = HLR_TZ) {
			const t = String(block == null ? "" : block);
			if (!/活动画廊|活动卡池/.test(t)) return [];
			const wins = hlrWindowsOf(t, refYear, tz);
			if (wins.length === 0) return [];
			const nm = /「([^」]+)」\s*(?:活动画廊|活动卡池)/.exec(t);
			const banner = nm ? nm[1].trim() : "";
			const roles = hlrRolesOf(t);
			return wins.map((w) => ({ banner, roles, ...w }));
		}

		// ── 抓取：两类列表 → 活动类条目 → 按列表配额逐篇详情 ──────────────────────
		// 返回要抓的列表计划：官方通稿 + 学院公告，**谁先谁后只影响行的文档顺序**。
		// 传进来的 `url` 是注册条目的默认地址（卡池与活动都填官方列表 ⇒ 官方通稿先入队，同一窗口
		// 两类都报到时保留名字更好的通稿那条）；传学院公告地址则它排前；两个已知地址之外
		// （自定义/备选）只抓那一个（向后兼容旧行为）。
		function hlrListPlanOf(url) {
			const OFFICIAL = { kind: "official", url: HLR_LIST_URL };
			const UPDATE = { kind: "update", url: HLR_UPDATE_LIST_URL };
			const u = String(url == null ? "" : url).trim();
			if (u === "" || u === HLR_LIST_URL) return [OFFICIAL, UPDATE];
			if (u === HLR_UPDATE_LIST_URL) return [UPDATE, OFFICIAL];
			return [{ kind: "", url: u }];
		}

		async function hlrCollectSide(listUrl, signal, tz, want, now = nowMs()) {
			const at = typeof now === "number" && Number.isFinite(now) ? now : nowMs();
			const quota = HLR_DETAIL_QUOTA[want] || HLR_DETAIL_QUOTA.event;
			const lists = [];
			let firstListErr = null;
			for (const plan of hlrListPlanOf(listUrl)) {
				let html;
				try {
					html = await fetchText(plan.url, { signal, mode: "proxy", referer: HLR_REFERER });
				} catch (e) {
					// 一类列表抓挂（如学院公告改版 404）不该把另一类带塌；两类都挂才算真失败。
					if (!firstListErr) firstListErr = e;
					continue;
				}
				lists.push({
					kind: plan.kind,
					items: hlrParseList(html).filter((it) => HLR_EVENT_TITLE_RE.test(it.title))
				});
			}
			if (lists.length === 0) throw firstListErr || new Error("hlr-list-failed");
			const rows = [];
			let okCount = 0, firstHardErr = null;
			for (const list of lists) {
				// 配额按类取：没标 kind 的自定义地址用活动侧的学院公告配额（最多，最保险）
				const cap = list.kind === "official" ? quota.official : quota.update;
				for (const it of list.items.slice(0, cap)) {
					let detail;
					try {
						detail = hlrParseDetail(await fetchText(it.url, { signal, mode: "proxy", referer: HLR_REFERER }));
					} catch (e) {
						if (!firstHardErr) firstHardErr = e;
						continue;
					}
					okCount++;
					const refYear = hlrYearOf(detail, it.url);
					if (refYear == null) continue;
					const title = detail.title || it.title;
					if (want === "gacha") {
						for (const block of hlrBlocksOf(detail.contentHtml)) {
							for (const r of hlrGalleryRowsOf(block, refYear, tz)) rows.push({ ...r, title, name: hlrNameOf(title) });
						}
						continue;
					}
					// 活动侧：一篇可能有多段窗口（10/1 公告里同时有 10/1、10/6、10/9 三段）。
					// 挑"覆盖 now 的那一段"；都不覆盖就保留第一段（只用于悬停/过期判断，不冒充在期）。
					// 一篇只产一条 —— 否则同一篇里三段窗口会都以同一个名字重复出现在悬停里。
					let pickedBlock = "", pickedWin = null;
					for (const block of hlrBlocksOf(detail.contentHtml)) {
						const wins = hlrWindowsOf(block, refYear, tz);
						if (wins.length === 0) continue;
						if (!pickedWin) { pickedBlock = block; pickedWin = wins[0]; }
						const hit = wins.find((w) => coversNow(w, at));
						if (hit) { pickedBlock = block; pickedWin = hit; break; }
					}
					if (pickedWin) rows.push({ ...pickedWin, title, name: hlrEventNameOf(pickedBlock, title) });
				}
			}
			if (okCount === 0) {
				if (firstHardErr) throw firstHardErr;
				return null;
			}
			// 活动侧：同一窗口可能两类列表都报到（官方通稿「怪谈：时融」+ 学院公告「10月29日不停服更新公告」）。
			// 官方通稿先入队 ⇒ 按窗口去重后保留名字更好的那条；卡池侧不按窗口去重（同期可有不同画廊）。
			if (want !== "gacha") {
				const seenWin = new Set();
				return rows.filter((r) => {
					const key = r.startTs + "|" + r.endTs;
					if (seenWin.has(key)) return false;
					seenWin.add(key);
					return true;
				});
			}
			return rows;
		}

		async function fetchHlrGacha(url, signal, tz = HLR_TZ) {
			const at = nowMs();
			const rows = await hlrCollectSide(url, signal, tz, "gacha", at);
			if (!rows || rows.length === 0) return null;
			const live = rows.filter((r) => coversNow(r, at));
			if (live.length === 0) return null;
			live.sort((a, b) => (a.endTs - b.endTs) || (a.startTs - b.startTs));
			const first = live[0];
			const banner = first.banner || first.name;
			const hoverItems = rows.filter((r) => coveredOrOpen(r, at)).sort(poolHoverOrderOf).map((r) => {
				const nm = r.banner || r.name;
				const label = r.roles ? `${nm}\uFF1A${r.roles}` : nm;
				return { title: label, label, startTs: r.startTs, endTs: r.endTs, raw: r.raw };
			});
			const hover = hoverTextFromItems(hoverItems, "gacha", tz);
			const out = {
				banner,
				roles: first.roles,
				bannerDates: first.display,
				bannerDatesRaw: first.raw,
				startTs: first.startTs,
				endTs: first.endTs,
				...(hover ? { bannerHover: hover } : {})
			};
			out.gacha = dataArrayProducedGachaOf(out, hoverItems, { id: "hlr", tz }, at);
			out.gachaHoverItems = hoverItems;
			return out;
		}

		async function fetchHlrEvents(url, signal, tz = HLR_TZ) {
			const at = nowMs();
			const rows = await hlrCollectSide(url, signal, tz, "event", at);
			if (!rows || rows.length === 0) return null;
			const live = rows.filter((r) => coversNow(r, at));
			if (live.length === 0) return null;
			// 两类列表都按"从新到旧"处理：第一条覆盖 now 的就是"当前最新一期"
			const first = live[0];
			const hoverItems = rows.filter((r) => coveredOrOpen(r, at))
				.sort((a, b) => (a.endTs - b.endTs) || (a.startTs - b.startTs))
				.map((r) => ({ title: r.name, startTs: r.startTs, endTs: r.endTs, raw: r.raw }));
			const hover = hoverTextFromItems(hoverItems, "event", tz);
			const out = {
				event: first.name,
				eventDates: first.display,
				eventDatesRaw: first.raw,
				...(hover ? { eventHover: hover } : {})
			};
			out.events = dataArrayProducedEventsOf(out, hoverItems, { id: "hlr", tz }, at);
			out.eventHoverItems = hoverItems;
			return out;
		}

		// ── 条目 ──
		registerSource({
			id: "hlr",
			defaultHidden: true,
			tz: HLR_TZ,
			name: "时空中的绘旅人",
			icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/1d/2b/48/1d2b48c5-4cdd-ec4b-80a5-336e3574c6ca/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/512x512bb.jpg",
			source: "官网新闻",
			url: HLR_LIST_URL,
			// 活动侧默认地址仍写官方列表：抓取器**同时抓两类**（官方通稿在前、学院公告在后），
			// 官方通稿在前 ⇒ 同一窗口两类都报到时保留通稿那条（名字更好）。来源标签如实写全。
			eventSource: "官网新闻 + 学院公告",
			eventUrl: HLR_LIST_URL
		});

		GACHA_FETCHERS["hlr"] = (url, signal, tz) => fetchHlrGacha(url, signal, tz);
		EVENT_FETCHERS["hlr"] = {
			default: (url, signal, tz) => fetchHlrEvents(url, signal, tz)
		};
