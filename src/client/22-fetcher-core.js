// src/client/22-fetcher-core.js —— 抓取公共设施：抓取桥接 + 通用载荷 + 备选源解析
//
// ⚠️ 2026-10-03 重组（用户要求「28 款一视同仁」）：不再有「内置 11 款 / 另外 17 款」的文件分层，
//    每款/每组游戏一个**自包含**文件（条目 + 解析器 + 抓取器 + 登记）。
//    本次只挪位置，**符号名一个都没改** —— 所以导出表、注册表快照、所有用例都不受影响。
//
// ⚠️ 这些文件在 core 产物里位于 `createEngine` **内部**，每建一个引擎都会重跑一遍 →
//    对 `SOURCES` 的写操作**必须幂等**（统一走 `registerSource`，它按 id 找到就合并、否则追加）。


		// 角色名清理：去首尾方括号/空白（zzz 的 [希格莉德（强攻·冰）]）
		function cleanRoles(roles) {
			const r = stripTags(roles).replace(/^[\[【\s]+|[\]】\s]+$/g, "");
			return r;
		}


		// 主池过滤：排除武器/光锥/音擎/回响/重映等副池
		function isMainBanner(banner) {
			if (!banner) return false;
			if (/武器|光锥|音擎|回响|重映|神铸赋形|流光定影|溯回忆象/.test(banner)) return false;
			return /角色活动祈愿|角色活动跃迁|独家频段|寻访|频段/.test(banner) || banner.includes("「");
		}


		// 通用抓取网页文本：MediaWiki api.php（action=parse）→ JSON 的 parse.text；其它 URL → 原始 HTML
		//
		// 同一轮里按 URL 缓存：两侧同址时（自定义条目最常见：用户把同一个页面同时填给
		// 卡池与活动），需要在**不重复发请求**的前提下拿到同一份文本 —— 见 50-refresh.js
		// 的「两侧同一条 URL、活动侧无注册抓取器」分支。缓存按轮清空（refreshAll 开始时重置），
		// 避免跨轮拿到过期数据。
		let htmlTextCache = null;

		function resetHtmlTextCache() { htmlTextCache = new Map(); }

		// **只读**查询：命中才返回，绝不发起请求。
		// 用途见 50-refresh.js：两侧同址且活动侧没有注册抓取器时，**只有在卡池那次
		// 已经通过本函数取过同一 URL 的情况下**才复用；否则宁可记"未公布"，
		// 也**绝不**去打那次注定被 CORS 拦的直连（这条语义有测试守护，别改成会发请求）。
		function peekHtmlText(url) {
			return (htmlTextCache && htmlTextCache.get(url)) || null;
		}

		async function fetchHtmlText(url, signal) {
			if (htmlTextCache && htmlTextCache.has(url)) return htmlTextCache.get(url);
			const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
			const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
			if (!res.ok) throw new Error("http-" + res.status);
			let out;
			if (/action\s*=\s*parse/i.test(url)) {
				const json = await res.json();
				const text = json?.parse?.text;
				if (typeof text !== "string") throw new Error("bad-json");
				out = text;
			} else {
				out = await res.text();
			}
			if (htmlTextCache) htmlTextCache.set(url, out);
			return out;
		}


		// 通用卡池解析（新增自定义条目的"卡池来源"地址用）：
		// 依次尝试 bwiki 式「时间+版本」表、方舟式「限时寻访」表、GachaTracker 式日期表、
		// Next.js SPA（canmoe 等，页面无表格、数据在组件 chunk 里），选当期；
		// 最后再退到**普通 HTML 表**（见下方 collectGenericGacha）；
		// 全部失败返回 null（调用方按解析失败处理，不做可达性健康检查）
		async function tryParseGenericGacha(url, signal, tz) {
			const html = await fetchHtmlText(url, signal);
			const now = nowMs();
			const cur = selectCurrent(parseAllBwiki(html, tz), now) || selectCurrent(parseArknights(html, tz), now);
			if (cur && cur.banner && cur.bannerDates) return cur;
			const gt = parseGachaTracker(html, tz);
			if (gt && gt.banner && gt.bannerDates) return gt;
			// Next.js SPA：HTML 无表格数据，定位组件 chunk 后抓 chunk JS 解析。
			// chunk 与页面同源：页面能直连（CORS 允许）时 chunk 直连，否则经 host 代理。
			const chunks = nextJsChunkUrls(html, "BannerCalendar", url);
			for (const c of chunks) {
				try {
					const js = await fetchHtmlText(c, signal);
					// 每个 chunk 只解析一次：解析里最重的是 chunk 的括号平衡扫描，
					// 而"没命中当期"恰恰是最常见的情况 → 不要为了`a || b`那种写法白跑两遍
					const d = parseCanmoe(js, now, tz);
					if (d && d.banner && d.bannerDates) return d;
				} catch { /* 下一个 chunk */ }
			}
			// 末位兜底：**普通 HTML 表**（时间 + 名称两列，或含「类型」列）。
			// 为什么需要（2026-10-01 用户点名）：上面三条都是各自的**私有格式**
			// （bwiki 卡池列 / PRTS 卡池一览 / GachaTracker），而用户给自定义条目
			// 填一个普通 wiki 页面时，**活动列能出、卡池列恒空** —— 同一张表明显有内容。
			// 这一兜底复用与活动侧同一套"时间+名称"列识别，保证自定义条目两侧口径一致。
			const generic = selectCurrent(collectGenericGacha(html, tz), now);
			if (generic && generic.banner && generic.bannerDates) return generic;
			return null;
		}


		// 通用活动解析：扫描含「时间」（或「活动时间」）表头的表格，行内找时间与名称列，选当期
		// 起始为"版本更新后"等无日期文本时保留 startTs=null，由 selectCurrent 的 fillMissingStarts 补全
		function collectGenericEvents(html, tz) {
			const items = [];
			const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)];
			for (const t of tables) {
				const body = t[1];
				if (!/<th[^>]*>[^<]*时间[^<]*<\/th>/i.test(body)) continue;
				// 「类型」列（如 版本活动/常规活动/剧情活动）→ 用于活动外显的类别优先级
				const heads = [...body.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => stripTags(m[1]).trim());
				const catIdx = heads.findIndex((h) => /类型|類型/.test(h));
				for (const rm of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
					const row = rm[1];
					if (!/<td/i.test(row)) continue;
					const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]).trim());
					if (tds.length < 2) continue;
					// 时间列（含日期/区间）与名称列分开
					let name = "", time = "";
					for (const td of tds) {
						if (!time && /20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}|[~～]/.test(td)) time = td;
						else if (td && !name) name = td;
					}
					if (!time || !name) continue;
					// 名字里偶发混进图片文件名残渣（如「文件:巡星之礼第二十六期.png 」）→ 去掉该前缀
					name = name.replace(/^文件:[^\s]*?\.(?:png|jpe?g|gif|webp|svg)\s*/i, "").trim();
					if (!name) continue;
					const range = parseRange(time, tz);
					// 起始可为 null（"版本更新后"），结束时间必须有效——**除非这行是永久活动**。
					// 原来这里一律 `endTs == null → continue`，把「…~永久」的行在采集阶段就丢了，
					// 下游连"它存在过"都看不到（表现为源站表里有、面板悬停里没有）。
					// 永久活动（结束写作「永久」）保留下来，由 genericEventPayload 单独计数；
					// 其它无结束时间的行仍按旧规则丢弃（起止都拿不到，画不出来）。
					const cat0 = catIdx >= 0 ? (tds[catIdx] || "") : "";
					const isPermanent = range.endTs == null && (/永久/.test(cat0) || /永久\s*$/.test(String(range.raw || time)));
					if (range.endTs == null && !isPermanent) continue;
					items.push({ banner: name, cat: cat0, ...range, isMain: true });
				}
			}
			return items;
		}


		// 当期活动（外显取 selectCurrent 的那条，行为同旧版）
				// 通用**卡池**采集（末位兜底，2026-10-01 加）：
		// 与 collectGenericEvents 同一套「时间 + 名称」列识别，但用于**卡池列**。
		//
		// 为什么需要：tryParseGenericGacha 前三条路径（parseAllBwiki / parseArknights /
		// parseGachaTracker）认的都是各自源站的**私有结构**；用户给自定义条目填一个普通
		// wiki 页面时，活动列（走 collectGenericEvents）能出内容，**卡池列却恒空**。
		// 这一条让"同一张表、两侧都能读"，与活动侧口径一致。
		//
		// 与活动侧的唯一差别：**不丢"永久"行**（卡池没有"永久"语义，但也不该在采集阶段
		// 就无声消失），并保留 roles 空串（普通表里没有角色列的结构约定）。
		function collectGenericGacha(html, tz) {
			const items = [];
			const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)];
			for (const t of tables) {
				const body = t[1];
				if (!/<th[^>]*>[^<]*时间[^<]*<\/th>/i.test(body)) continue;
				const heads = [...body.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => stripTags(m[1]).trim());
				const catIdx = heads.findIndex((h) => /类型|類型/.test(h));
				for (const rm of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
					const row = rm[1];
					if (!/<td/i.test(row)) continue;
					const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]).trim());
					if (tds.length < 2) continue;
					let name = "", time = "";
					for (const td of tds) {
						if (!time && /20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}|[~～]/.test(td)) time = td;
						else if (td && !name) name = td;
					}
					if (!time || !name) continue;
					name = name.replace(/^文件:[^\s]*?\.(?:png|jpe?g|gif|webp|svg)\s*/i, "").trim();
					if (!name) continue;
					const range = parseRange(time, tz);
					// 起止都拿不到的行画不出来（活动侧对"永久"有特例，卡池没有该语义）
					if (range.startTs == null && range.endTs == null) continue;
					const cat0 = catIdx >= 0 ? (tds[catIdx] || "") : "";
					items.push({ banner: name, roles: "", cat: cat0, ...range, isMain: true });
				}
			}
			return items;
		}


		// 活动列载荷：外显=排序第一条（最快结束的当期活动，③）；eventHover=全部覆盖当前时刻的活动（同序）。
		// 注意 selectCurrent 会就地补全缺失起点（fillMissingStarts），故这里只取快照自行排序，
		// 避免"版本更新后 ~ 未来"这类起点未给的行被补成未来起点而漏掉。
		// 只有 1 条时 buildEventHover 返回 ""，由 UI 退回单条展示（兜底）。
		function genericEventPayload(html, tz) {
			const items = collectGenericEvents(html, tz);
			// 页面拿到了却连一行候选都没有 → 活动表结构变了（抛错 = "活动失败"）；
			// 有候选但当期没有覆盖现在的 → 下面返回 null（未公布）
			if (items.length === 0) throw new Error("bwiki-event-no-table");
			const snapshot = items.map((it) => ({ name: it.banner, cat: it.cat || "", startTs: it.startTs, endTs: it.endTs, raw: it.rawOriginal || it.raw }));
			const now = nowMs();
			// 永久/常驻活动单独计一项：它们 endTs 为 null，本就不该混进"当期"排序，
			// 但也不能像以前那样无声丢掉（见 isPermanentEvent 注释）。
			const permanent = snapshot.filter((it) => isPermanentEvent(it));
			const active = sortEventItems(snapshot.filter((it) => coversNow(it, now)));
			if (active.length === 0) return null;
			// 外显：类别优先（剧情/叙事、限时高难），同级内结束时间升序；悬停仍按 endTs 升序全量
			const primary = pickEventPrimary(active) || active[0];
			return {
				event: primary.name,
				eventDates: primary.startTs != null && primary.endTs != null ? fmtWindow(primary.startTs, primary.endTs, tz) : (primary.raw || ""),
				eventDatesRaw: primary.raw || "",
				eventHover: buildEventHover(active, permanent.length)
			};
		}


		// 通用活动源解析（自定义条目/自定义活动来源地址用）：抓取页面 → collectGenericEvents → {event, eventDates}
		// ⚠️ 2026-10-03：原来这里还有个 `parseGenericEvents(html, tz)`（collectGenericEvents + selectCurrent 的组合），
		//    经全仓引用分析确认**生产与测试都没用**（活路径走的是下面的 `genericEventPayloadFromHtml`，
		//    它多一层"表里一行都没有 → null"的错误语义处理），已删。
		async function tryParseGenericEvent(url, signal, tz) {
			const html = await fetchHtmlText(url, signal);
			return genericEventPayloadFromHtml(html, tz);
		}


		// 已拿到 HTML 时的活动载荷（**不抛错**版本）：
		// 供「两侧同一条 URL、且活动侧没有注册抓取器」（自定义条目）复用卡池那次已经取到的
		// HTML —— 省掉第二次请求，同时保证活动侧也能被通用解析命中。
		// 与 genericEventPayload 的差别：表里一行都没有时返回 null（交给调用方按 nomatch 处理），
		// 而不是抛 "bwiki-event-no-table"（那条错误语义是给"内置源站改版"用的）。
		function genericEventPayloadFromHtml(html, tz) {
			let items;
			try { items = collectGenericEvents(html, tz); } catch { return null; }
			if (items.length === 0) return null;
			const cur = selectCurrent(items, nowMs());
			if (!cur || !cur.banner) return null;
			return {
				event: cur.banner,
				eventDates: cur.bannerDates || "",
				eventDatesRaw: cur.bannerDatesRaw || cur.bannerDates || ""
			};
		}


		// ---- 抓取器工厂 ----
		// mkMediaWiki：MediaWiki api.php JSON 源（追加 &origin=* 绕过 CORS）
		// mkRaw：直接抓取原始 HTML（非 MediaWiki 源，如 GachaTracker）
		// 经 host 同源代理的来源（蔚蓝系列 / 终末地 wiki.gg / 1999 等）不用工厂包装：
		// 其抓取器内部自行调用 proxyFetchText / proxyFetchJson（绕过 CORS 与 Referer 反爬）。
		// 抓取器签名：async (url, signal, tz) → 数据对象 | null
		//   第三个参数 `tz` = 源站墙钟时区（可选，见 15-env.js）。工厂把它透传给解析函数，
		//   解析函数再交给 parseTime/parseRange —— 这样"源站时区"只需在来源声明里写一次。
		function mkMediaWiki(parse) {
			return async (url, signal, tz) => {
				const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
				const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
				if (!res.ok) throw new Error("http-" + res.status);
				const json = await res.json();
				const text = json?.parse?.text;
				if (typeof text !== "string") throw new Error("bad-json");
				return parse(text, tz);
			};
		}

		function mkRaw(parse) {
			return async (url, signal, tz) => {
				const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
				const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
				if (!res.ok) throw new Error("http-" + res.status);
				return parse(await res.text(), tz);
			};
		}


		async function fetchText(url, opts) {
			const o = opts || {};
			if (o.mode === "direct") {
				const res = await transportFetchRaw(url, { signal: o.signal, headers: Object.assign({}, rawHeaders(url), o.headers || {}) });
				if (!res.ok) throw new Error("http-" + res.status);
				return res.text();
			}
			return proxyFetchText(url, o.referer || "", o.headers, o.body);
		}

		async function fetchJson(url, opts) {
			const t = await fetchText(url, opts);
			try { return JSON.parse(t); } catch { throw new Error("bad-json"); }
		}

		async function fetchMediaWikiText(url, opts) {
			const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
			const json = await fetchJson(apiUrl, opts);
			const text = json && json.parse && json.parse.text;
			if (typeof text !== "string") throw new Error("bad-json");
			return text;
		}


		// —— 备选源（altSources / eventAltSources）的字段约定与 altSourceId / normalizeSourceId，
		//    以及下面的 gachaFetcherFor / eventFetcherFor 用到的标识归一，都在 60-helpers.js ——
		//    （设置页也要用这两个纯函数，所以放在 core 与外壳共用的 helpers 里，而不是 core 内部）
		// 取条目当前卡池源的抓取器：命中的备选源 > 默认抓取器（无 → null）
		function gachaFetcherFor(source, url) {
			const want = normalizeSourceId(url);
			const alt = (source.altSources || []).find((a) => altSourceId(a) === want && GACHA_FETCHERS[a.fetcher]);
			return alt ? GACHA_FETCHERS[alt.fetcher] : GACHA_FETCHERS[source.id] || null;
		}


		// 取条目当前活动源的抓取器：命中的活动备选源 > 默认活动抓取器（无 → null）
		function eventFetcherFor(source, url) {
			const table = EVENT_FETCHERS[source.id];
			if (!table) return null;
			const want = normalizeSourceId(url);
			const alt = (source.eventAltSources || []).find((a) => altSourceId(a) === want && table[a.fetcher]);
			return alt ? table[alt.fetcher] : table.default || null;
		}
