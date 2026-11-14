// src/client/30-game-wxnn.js —— 无限暖暖（国服，2026-11-15 接入）
//
// ── 源（两次链路：列表 1 次 + 详情按 id 缓存）────────────────────────────────────
//   ① GET https://infinitynikki.nuanpaper.com/api/news
//        200 / application/json; charset=utf-8 / 6,607 B（实测 2026-11-15）+ **无需任何 header**。
//        结构 `{ data: { allNews: [5], notices: [5], news: [5] } }`，三桶**互相重叠**（同一篇会同时出现在
//        allNews 与 notices/news 里）⇒ 按 `id` 去重后实测 **10 篇唯一**。
//        ⚠️ **没有分页**：`page` / `limit` / `section` / `offset` 全被忽略（实测四种参数回的还是同一份 6,607 B）。
//        字段：`id` / `title` / `section`(0=资讯 1=公告) / `publish_time`(ISO UTC) / `cover` / `abstract`。
//   ② GET https://infinitynikki.nuanpaper.com/news/{id}
//        200 / text/html；正文与元数据都在 `__NEXT_DATA__` 的
//        `props.pageProps.pageData.{title, publish_time(ms), content_html}` 里。
//        实测 2026-11-15：
//        · 1092「「何人消隐于祷声」限定共鸣复刻开启」— 有池名 + `➤共鸣时间`（27,586 B）
//        · 1094「2.11版本…活动开启提醒」— 一篇 5 条活动，每条 `● 活动时间：…`（18,934 B）
//        · 1095「11月13日更新预告」— **同文维护窗** `2026年11月13日10:00-11:00（UTC+8）`（16,068 B）
//        · 1093「奇想衣橱 | 万物繁生谣」— 池名在 `前往「予大地以时光」进行共鸣`、`共鸣时间` 单独一行（17,472 B）
//
// ── 两个坑（实测踩过）────────────────────────────────────────────────────────
//   · **旧 id / 不存在的 id 回 200 + 空页**，不是 404：实测 `/news/999999` = 200 / 11,793 B 的骨架页，
//     `pageData.title` 是 `undefined`、`content_html` 空串 ⇒ "拿不到 pageData = 这条不在源站（跳过）"，
//     **不能**当抓取失败抛出去。
//   · **连续快速请求会回 200 + 空 body（0 字节）**（源站短时限流）⇒ 空 body 与"页面正常"必须分开：
//     空 body ⇒ 等 2.5 秒重试，最多 3 次，仍空才跳过该条。
//
// ── 时区 ──
//   `tz = Asia/Shanghai`（国服）。后缀两种写法：`（UTC+8）` 与 `（服务器时间）` —— 国服服务器时间就是 UTC+8，
//   两者按同一时区解析（后缀在解析前剥掉，**不进悬停**）。
//
// ── 解析口径 ─────────────────────────────────────────────────────────────────
//   · 锚点：`共鸣时间` ⇒ 卡池侧；`活动时间` ⇒ 活动侧。锚点可带前缀符号（实测 `➤` / `●` / 无），
//     档期**同行**（`● 活动时间：…`）或**下一行**（`➤共鸣时间` ⏎ 档期）两种都要吃。
//   · 池名：**优先**取正文里 `前往「…」进行共鸣` 的名字（1092/1093 都有；1093 的标题是套装名，不是池名）。
//   · 活动名：该「活动时间」行**之前最近的**「…」行（最多回看 3 行）。整行只有一对括号 ⇒ 去括号；
//     带尾巴的（`「颂愿感悟之礼」系列礼包限时上架`）⇒ 保留整行。回看到上一个锚点为止。
//   · 起点常写「版本更新后」：**同批维护窗兜底** —— 同批公告里有同一天的 `停服维护 … 10:00-11:00（UTC+8）`
//     ⇒ 起点 = **维护结束时刻**。取不到就如实留空（`startTs = null`）—— 那种条目**不进外显**，只在悬停列出。
//   · `raw` = 源站原文（连接号统一成 `~`，时间后缀剥掉）；`bannerDates` / `eventDates` = 补全后的绝对窗口。
//
// ── 取数（请求数）────────────────────────────────────────────────────────────
//   列表 **1 次** + 只对**没缓存的 id** 取详情。详情按 id 缓存（24h TTL）+ **已结束的封存永不重取**
//   ⇒ 稳态每轮只有列表那 1 个请求（实测首轮 1 + 10 = 11）。缓存是**引擎实例级**（本文件在 core 里位于
//   `createEngine` 内部）。轮内复用：卡池/活动两侧靠 `fetchRoundSeqOf()` 记住那一轮的结果，整轮仍 1 次列表请求。
//
// ── 失败语义 ────────────────────────────────────────────────────────────────
//   · 列表结构变了 ⇒ **抛错**；· 单篇详情失败/空 body ⇒ 跳过该条；**全部尝试都失败且出现过硬错** ⇒ 抛错；
//   · 有数据但没有覆盖 now 的条目 ⇒ `null`（未公布）。

		// ── 常量 ──
		const WXNN_TZ = "Asia/Shanghai";
		const WXNN_LIST_URL = "https://infinitynikki.nuanpaper.com/api/news";
		const WXNN_NEWS_BASE = "https://infinitynikki.nuanpaper.com/news/";
		const WXNN_SOURCE_LABEL = "官网公告";
		const WXNN_DETAIL_TTL_MS = 24 * 60 * 60 * 1000;
		const WXNN_CACHE_MAX = 80;
		const WXNN_EMPTY_RETRY_MS = 2500;
		const WXNN_EMPTY_RETRY = 2;
		const WXNN_NAME_LOOKBACK = 3;

		const WXNN_NEXT_DATA_RE = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;
		const WXNN_SCRIPT_RE = /<script[\s\S]*?<\/script>/gi;
		const WXNN_BLOCK_END_RE = /<\/(?:p|div|li|ul|ol|h[1-6]|tr|td|table|section|blockquote)>/gi;
		const WXNN_SUFFIX_RE = /[\s]*[（(]\s*(?:UTC\s*\+\s*8|服务器时间)\s*[）)]\s*$/;
		const WXNN_GACHA_ANCHOR_RE = /^(?:[※*·●▸➤〓■□☆◆◇>＞▶]\s*)*共鸣时间\s*[】\]]?\s*[：:]?\s*(.*)$/;
		const WXNN_EVENT_ANCHOR_RE = /^(?:[※*·●▸➤〓■□☆◆◇>＞▶]\s*)*活动时间\s*[】\]]?\s*[：:]?\s*(.*)$/;
		const WXNN_WINDOW_RE = new RegExp(
			String.raw`^(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*`
			+ String.raw`(?:版本更新后|版本更新完成后|更新维护后|(\d{1,2})\s*[:：]\s*(\d{2}))\s*`
			+ String.raw`[-~～—–－至到]\s*(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:：]\s*(\d{2})$`
		);
		const WXNN_MAINT_RE = new RegExp(
			String.raw`(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*`
			+ String.raw`(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~～—–－至到]\s*(\d{1,2})\s*[:：]\s*(\d{2})`
		);
		const WXNN_POOL_NAME_RE = /前往\s*「([^」]+)」\s*进行共鸣/;
		const WXNN_BARE_NAME_RE = /^「([^」]+)」$/;
		const WXNN_LEAD_NAME_RE = /^「[^」]+」/;
		const WXNN_MAINT_LINE_RE = /维护/;

		let wxnnCache = new Map();
		let wxnnRoundCache = { seq: -1, promise: null };

		function wxnnSleep(ms) {
			return new Promise((resolve) => coreEnv.timer.setTimeout(resolve, ms));
		}

		function wxnnTimestampOf(v) {
			if (typeof v === "number" && Number.isFinite(v)) return v;
			const t = Date.parse(String(v == null ? "" : v));
			return Number.isFinite(t) ? t : 0;
		}

		function wxnnNewsIdOf(v) {
			const n = Number(v);
			return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
		}

		function wxnnListOf(raw) {
			let j;
			try { j = JSON.parse(String(raw == null ? "" : raw)); } catch { throw new Error("wxnn-list-changed:bad-json"); }
			const data = j && j.data;
			if (!data || typeof data !== "object") throw new Error("wxnn-list-changed:no-data");
			// 取 `data` 下**所有数组**的并集：实测有 4 个栏目
			//（allNews / notices / news / **activity**），写死三个会漏掉 activity 里的在期活动
			//（2026-11-15 实测：1034「致独一无二的奇旅」在 activity 里，正在期）。
			const buckets = Object.keys(data).filter((k) => Array.isArray(data[k]));
			if (buckets.length === 0) throw new Error("wxnn-list-changed:no-buckets");
			const out = [], seen = new Set();
			for (const k of buckets) {
				for (const it of data[k]) {
					const id = wxnnNewsIdOf(it && it.id);
					if (id == null || seen.has(id)) continue;
					seen.add(id);
					out.push({
						id,
						title: htmlTextTight(it.title == null ? "" : it.title),
						publishTs: wxnnTimestampOf(it.publish_time)
					});
				}
			}
			if (out.length === 0) throw new Error("wxnn-list-changed:no-news");
			return out;
		}

		function wxnnPageOf(html) {
			const m = WXNN_NEXT_DATA_RE.exec(String(html == null ? "" : html));
			if (!m) return null;
			let j;
			try { j = JSON.parse(m[1]); } catch { return null; }
			const pd = j && j.props && j.props.pageProps && j.props.pageProps.pageData;
			if (!pd || typeof pd !== "object") return null;
			const title = htmlTextTight(pd.title == null ? "" : pd.title);
			const contentHtml = String(pd.content_html == null ? "" : pd.content_html);
			if (!title && contentHtml.trim() === "") return null;
			return { title, publishTs: wxnnTimestampOf(pd.publish_time), contentHtml };
		}

		function wxnnLinesOf(contentHtml) {
			const html = String(contentHtml == null ? "" : contentHtml)
				.replace(WXNN_SCRIPT_RE, " ")
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(WXNN_BLOCK_END_RE, "\n");
			return htmlText(html).split("\n").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
		}

		function wxnnMaintOf(line, hint, tz) {
			const s = String(line == null ? "" : line).replace(WXNN_SUFFIX_RE, "").trim();
			const m = WXNN_MAINT_RE.exec(s);
			if (!m) return null;
			const y = inferYear(m[1] != null ? Number(m[1]) : null, Number(m[2]), hint);
			if (y == null) return null;
			const mo = Number(m[2]), d = Number(m[3]);
			return { y, mo, d, ts: sourceInstant(y, mo, d, Number(m[6]), Number(m[7]), tz) };
		}

		function wxnnWindowOf(line, hint, tz) {
			const s = String(line == null ? "" : line).replace(WXNN_SUFFIX_RE, "").trim();
			const m = WXNN_WINDOW_RE.exec(s);
			if (!m) return null;
			const sm = Number(m[2]), sd = Number(m[3]);
			const startY = inferYear(m[1] != null ? Number(m[1]) : null, sm, hint);
			if (startY == null) return null;
			const openStart = m[4] == null;
			const startTs = openStart ? null : sourceInstant(startY, sm, sd, Number(m[4]), Number(m[5]), tz);
			const em = Number(m[7]), ed = Number(m[8]);
			const endY = m[6] != null ? Number(m[6]) : startY + (endsNextYear(sm, sd, em, ed) ? 1 : 0);
			const endTs = sourceInstant(endY, em, ed, Number(m[9]), Number(m[10]), tz);
			if (startTs != null && !(endTs > startTs)) return null;
			return {
				startTs,
				endTs,
				raw: s.replace(/\s*[-~～—–－至到]\s*/, " ~ "),
				openDate: openStart ? { y: startY, mo: sm, d: sd } : null
			};
		}

		function wxnnEventNameOf(lines, at) {
			const list = Array.isArray(lines) ? lines : [];
			const last = Math.max(0, at - WXNN_NAME_LOOKBACK);
			for (let k = at - 1; k >= last; k--) {
				const s = String(list[k] == null ? "" : list[k]).trim();
				if (!s) continue;
				if (WXNN_GACHA_ANCHOR_RE.test(s) || WXNN_EVENT_ANCHOR_RE.test(s)) return "";
				const bare = WXNN_BARE_NAME_RE.exec(s);
				if (bare) return bare[1].trim();
				if (WXNN_LEAD_NAME_RE.test(s)) return s;
			}
			return "";
		}

		function wxnnFactsOf(listItem, page, tz) {
			const lines = wxnnLinesOf(page.contentHtml);
			const hint = page.publishTs ? sourceWallParts(page.publishTs, tz) : null;
			const text = lines.join("\n");
			const pm = WXNN_POOL_NAME_RE.exec(text);
			const poolName = pm ? pm[1].trim() : "";
			const gacha = [], events = [], maint = [];
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (WXNN_MAINT_LINE_RE.test(line)) {
					const mt = wxnnMaintOf(line, hint, tz);
					if (mt) maint.push(mt);
				}
				const g = WXNN_GACHA_ANCHOR_RE.exec(line);
				if (g) {
					const w = wxnnWindowOf(String(g[1] || "").trim() || lines[i + 1] || "", hint, tz);
					if (w) gacha.push(Object.assign({ name: poolName || page.title || listItem.title }, w));
					continue;
				}
				const e = WXNN_EVENT_ANCHOR_RE.exec(line);
				if (e) {
					const w = wxnnWindowOf(String(e[1] || "").trim() || lines[i + 1] || "", hint, tz);
					if (!w) continue;
					const name = wxnnEventNameOf(lines, i);
					if (!name) continue;
					events.push(Object.assign({ name }, w));
				}
			}
			return {
				id: listItem.id,
				title: page.title || listItem.title,
				publishTs: page.publishTs || listItem.publishTs,
				gacha,
				events,
				maint
			};
		}

		function wxnnSealedOf(fact) {
			if (!fact) return true;
			const all = [].concat(fact.gacha || [], fact.events || []);
			if (all.length === 0) return true;
			const now = nowMs();
			return all.every((x) => x.endTs != null && x.endTs < now);
		}

		function wxnnCachedOf(id, now) {
			const hit = wxnnCache.get(id);
			if (!hit) return null;
			if (wxnnSealedOf(hit.fact)) return hit;
			return now - hit.at < WXNN_DETAIL_TTL_MS ? hit : null;
		}

		function wxnnPrune(list) {
			const inList = new Set((Array.isArray(list) ? list : []).map((x) => x.id));
			for (const [id, hit] of [...wxnnCache]) {
				if (!inList.has(id) && wxnnSealedOf(hit.fact)) wxnnCache.delete(id);
			}
			if (wxnnCache.size <= WXNN_CACHE_MAX) return;
			wxnnCache = new Map([...wxnnCache.entries()]
				.sort((a, b) => (b[1].fact.publishTs || 0) - (a[1].fact.publishTs || 0))
				.slice(0, WXNN_CACHE_MAX));
		}

		async function wxnnFetchFact(listItem, tz) {
			const url = WXNN_NEWS_BASE + listItem.id;
			for (let attempt = 0; ; attempt++) {
				const html = await proxyFetchText(url);
				if (String(html == null ? "" : html).trim() !== "") {
					const page = wxnnPageOf(html);
					return page ? wxnnFactsOf(listItem, page, tz) : null;
				}
				if (attempt >= WXNN_EMPTY_RETRY) return null;
				await wxnnSleep(WXNN_EMPTY_RETRY_MS);
			}
		}

		async function wxnnCollect(signal, tz) {
			const now = nowMs();
			const list = wxnnListOf(await proxyFetchText(WXNN_LIST_URL));
			let tried = 0, ok = 0;
			let firstErr = null;
			for (const it of list) {
				if (wxnnCachedOf(it.id, now)) continue;
				tried++;
				let fact = null;
				try {
					fact = await wxnnFetchFact(it, tz);
				} catch (e) {
					if (!firstErr) firstErr = e;
					continue;
				}
				if (!fact) continue;
				ok++;
				wxnnCache.set(it.id, { at: now, fact });
			}
			// 一条都没取到、却又真的试过 ⇒ 整侧如实报错（不许把封禁/改版静默成"未公布"）。
			// ⚠️ 例外：**缓存里已经有事实**时不抛 —— 那批详情只是"新公告没取到"，当期该显示的内容仍在
			//    （缓存里的档期都是绝对时刻，过期的自然被 coversNow 挡掉），下一轮还会重试那几条。
			//    不这么分，一次针对某篇公告的限流就会把整侧打成"抓取失败"，把已经拿到的当期一起丢掉。
			if (tried > 0 && ok === 0 && wxnnCache.size === 0) throw firstErr || new Error("wxnn-details-failed");
			wxnnPrune(list);
			return [...wxnnCache.values()]
				.map((x) => x.fact)
				.sort((a, b) => (b.publishTs || 0) - (a.publishTs || 0));
		}

		function wxnnCollectInRound(signal, tz) {
			const round = fetchRoundActive() ? fetchRoundSeqOf() : -1;
			if (round > 0 && wxnnRoundCache.seq === round && wxnnRoundCache.promise) return wxnnRoundCache.promise;
			const promise = wxnnCollect(signal, tz);
			if (round > 0) {
				wxnnRoundCache = { seq: round, promise };
				promise.catch(() => {
					if (wxnnRoundCache.promise === promise) wxnnRoundCache = { seq: -1, promise: null };
				});
			}
			return promise;
		}

		function wxnnMaintIndexOf(facts) {
			const map = new Map();
			for (const f of Array.isArray(facts) ? facts : []) {
				for (const m of f.maint || []) {
					const key = `${m.y}-${m.mo}-${m.d}`;
					const cur = map.get(key);
					if (cur == null || m.ts > cur) map.set(key, m.ts);
				}
			}
			return map;
		}

		function wxnnResolveStarts(items, maintIdx) {
			return (Array.isArray(items) ? items : []).map((x) => {
				if (x.startTs != null || !x.openDate) return x;
				const ts = maintIdx.get(`${x.openDate.y}-${x.openDate.mo}-${x.openDate.d}`);
				if (ts == null) return x;
				return Object.assign({}, x, { startTs: ts });
			});
		}

		function wxnnDedupe(items) {
			const seen = new Set(), out = [];
			for (const x of Array.isArray(items) ? items : []) {
				const key = `${x.name}|${x.startTs}|${x.endTs}`;
				if (seen.has(key)) continue;
				seen.add(key);
				out.push(x);
			}
			return out;
		}

		function wxnnPayloadOf(items, side, tz, now) {
			const isGacha = side === "gacha";
			const listed = (Array.isArray(items) ? items : []).filter((x) => coveredOrOpen(x, now));
			const primary = listed.filter((x) => coversNow(x, now))
				.sort((a, b) => (a.endTs - b.endTs) || (b.startTs - a.startTs))[0] || null;
			if (!primary) return null;
			const entries = isGacha ? listed.slice().sort(poolHoverOrderOf) : sortEventItems(listed);
			const hoverItems = entries.map((x) => (isGacha
				? { title: x.name, label: x.name, startTs: x.startTs, endTs: x.endTs, raw: x.raw }
				: { title: x.name, startTs: x.startTs, endTs: x.endTs, raw: x.raw }));
			const out = {};
			if (isGacha) {
				out.banner = primary.name;
				out.roles = "";
				out.bannerDates = fmtWindow(primary.startTs, primary.endTs, tz);
				out.bannerDatesRaw = primary.raw;
				out.startTs = primary.startTs;
				out.endTs = primary.endTs;
			} else {
				out.event = primary.name;
				out.eventDates = fmtWindow(primary.startTs, primary.endTs, tz);
				out.eventDatesRaw = primary.raw;
			}
			const hover = hoverTextFromItems(hoverItems, side, tz);
			if (hover) {
				if (isGacha) out.bannerHover = hover;
				else out.eventHover = hover;
			}
			if (isGacha) {
				out.gacha = dataArrayProducedGachaOf(out, hoverItems, { id: "wxnn", tz }, now);
				out.gachaHoverItems = hoverItems;
			} else {
				out.events = dataArrayProducedEventsOf(out, hoverItems, { id: "wxnn", tz }, now);
				out.eventHoverItems = hoverItems;
			}
			return out;
		}

		async function ns_wxnn_fetchWxnn(url, signal, tz) {
			const tzUse = tz || WXNN_TZ;
			const facts = await wxnnCollectInRound(signal, tzUse);
			const maintIdx = wxnnMaintIndexOf(facts);
			const gachaRaw = [], eventRaw = [];
			for (const f of facts) {
				for (const g of f.gacha || []) gachaRaw.push(g);
				for (const e of f.events || []) eventRaw.push(e);
			}
			const now = nowMs();
			const gacha = wxnnResolveStarts(wxnnDedupe(gachaRaw), maintIdx);
			const events = wxnnResolveStarts(wxnnDedupe(eventRaw), maintIdx);
			const g = wxnnPayloadOf(gacha, "gacha", tzUse, now);
			const e = wxnnPayloadOf(events, "event", tzUse, now);
			if (!g && !e) return null;
			return Object.assign({}, g || {}, e || {});
		}

		// ── 条目 ──
		registerSource({
			id: "wxnn",
			defaultHidden: false,
			tz: WXNN_TZ,
			name: "无限暖暖",
			url: WXNN_LIST_URL,
			source: WXNN_SOURCE_LABEL,
			eventUrl: WXNN_LIST_URL,
			eventSource: WXNN_SOURCE_LABEL
		});

		GACHA_FETCHERS["wxnn"] = (url, signal, tz) => ns_wxnn_fetchWxnn(url, signal, tz);
		EVENT_FETCHERS["wxnn"] = Object.assign(EVENT_FETCHERS["wxnn"] || {}, {
			default: (url, signal, tz) => ns_wxnn_fetchWxnn(url, signal, tz)
		});
