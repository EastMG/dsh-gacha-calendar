		//#region refresh
		// 两侧各自只允许写自己的字段：某些来源的载荷同时含卡池与活动字段（如 GameKee），
		// 若把整对象直接合并，活动源的数据会污染卡池列（反之亦然）——解耦契约的一部分。
		const GACHA_FIELDS = ["banner", "roles", "bannerDates", "bannerDatesRaw", "bannerHover"];
		const EVENT_FIELDS = ["event", "eventDates", "eventDatesRaw", "eventHover"];
		function pickFields(src, fields) {
			const out = {};
			if (!src) return out;
			for (const k of fields) if (src[k] !== void 0) out[k] = src[k];
			return out;
		}
		// 抓取单侧字段：自带解析器优先；**用户自己填的地址**（自定义条目 / 自带条目的自定义网址）
		// 才允许通用解析兜底——内置默认源不兜底：代理源直连必被 CORS 拦，那个错误不该算到来源头上。
		// 返回 { data, fail }：fail=null 表示该侧成功，否则 { kind: "down"|"nomatch", reason }。
		// data 一律原样带回（未命中时也可能附带可供同 URL 复用的其它字段）。
		async function resolveSide(side, { fetcher, url, allowGeneric, signal }) {
			const emptyOf = (d) => (side === "gacha" ? !d || !d.banner : !d || !d.event);
			const parseGeneric = () => (side === "gacha"
				? tryParseGenericGacha(url, signal)
				: tryParseGenericEvent(url, signal));
			let data = null;
			let fail = null;
			if (fetcher) {
				try {
					data = await fetcher(url, signal);
				} catch (err) {
					if (err && err.name === "AbortError") throw err;
					fail = { kind: "down", reason: normErr(err) };
				}
			}
			if (emptyOf(data) && allowGeneric) {
				try {
					const g = await parseGeneric();
					if (!emptyOf(g)) { data = g; fail = null; } // 兜底成功 → 该侧按成功算
				} catch (err) {
					if (err && err.name === "AbortError") throw err;
					if (!fail) fail = { kind: "down", reason: normErr(err) };
				}
			}
			// 有地址、但既没注册抓取器、也不允许通用解析 → 这一侧根本没有可用来源：
			// 如实记"无可用来源"（既不冒充"未公布"，也不去发注定被 CORS 拦的直连——历史 bug）
			if (emptyOf(data) && !fetcher && !allowGeneric) return { data: data || null, fail: { kind: "down", reason: "无可用来源" } };
			if (emptyOf(data)) return { data: data || null, fail: fail || { kind: "nomatch" } };
			return { data, fail: null };
		}
		// 抓取单个条目：卡池字段与活动字段分别由各自来源产出（见"统一来源注册表"契约）。
		// 两个来源独立选择：同 URL 且载荷已带活动字段 → 单次请求复用；否则各自独立抓取。
		// 返回 { ok, data, gachaFail, eventFail }：ok = 两侧都没有 down（只有 nomatch 仍算 ok）。
		async function fetchEntry(source, signal) {
			// 无任何来源的条目：跳过（不计成功也不计失败）
			if (!source.url && !source.eventUrl) return { ok: true, reason: "skipped" };
			// 来源标识统一归一（老配置的 proxy:/gk-*: 写法 → 真实地址 / 内部来源 id）：
			// 抓取器一律只拿到"干净地址"，不再需要在抓取层剥前缀
			const gachaUrl = normalizeSourceId(source.url);
			const eventUrl = normalizeSourceId(source.eventUrl);
			try {
				let g = { data: null, fail: null };
				if (source.url) {
					g = await resolveSide("gacha", {
						fetcher: gachaFetcherFor(source, gachaUrl),
						url: gachaUrl,
						allowGeneric: !!(source.custom || source.allowGenericGacha),
						signal
					});
				}
				let evData = null;
				let eventFail = null;
				if (source.eventUrl) {
					// 活动侧自己的抓取器（与卡池侧各自独立选择，来源可以完全不同）
					const evFetcher = eventFetcherFor(source, eventUrl);
					if (eventUrl === gachaUrl && g.data && g.data.event) {
						// 同 URL：活动字段就在卡池载荷里，不重复抓
						evData = {
							event: g.data.event,
							eventDates: g.data.eventDates || "",
							eventDatesRaw: g.data.eventDatesRaw || g.data.bannerDatesRaw || "",
							eventHover: g.data.eventHover || ""
						};
					} else if (eventUrl === gachaUrl && !evFetcher) {
						// 同 URL 且活动侧**没有自己的抓取器**（该条目就只有这一份载荷可用）：
						//  · 卡池那次已抓成功但载荷里没有活动字段 → 该侧就是"未公布"；
						//  · 卡池那次本身失败 → 沿用它的失败原因（同一次请求的结果，不该另起一个"无可用来源"）。
						// 只在这一种情况下短路：若活动侧有自己的抓取器（如绝区零/异环），照旧独立抓取，解耦不变。
						eventFail = g.data ? { kind: "nomatch" } : (g.fail || { kind: "nomatch" });
					} else {
						const ev = await resolveSide("event", {
							fetcher: evFetcher,
							url: eventUrl,
							allowGeneric: !!(source.custom || source.allowGenericEvent),
							signal
						});
						evData = ev.data;
						eventFail = ev.fail;
					}
				}
				const data = pickFields(g.data, GACHA_FIELDS);
				if (evData) Object.assign(data, pickFields(evData, EVENT_FIELDS));
				const gachaFail = g.fail;
				return {
					ok: !isDown(gachaFail) && !isDown(eventFail),
					reason: "ok",
					data,
					gachaFail,
					eventFail
				};
			} catch (err) {
				// 顶层异常（含 12 秒超时中断）：两侧按"报错"记，面板照实提示
				const aborted = !!err && err.name === "AbortError";
				const reason = aborted ? "超时" : normErr(err);
				const fail = { kind: "down", reason };
				return {
					ok: false,
					reason,
					gachaFail: source.url ? fail : null,
					eventFail: source.eventUrl ? fail : null
				};
			}
		}

		// 合并本轮抓取结果与上次缓存（统一机制，不针对任何游戏）：
		// - 展示字段按列兜底：本次某列没拿到就沿回旧值，并标记该列"显示的是旧值"（gachaStale/eventStale）
		// - 抓取状态（gachaFail/eventFail）永远来自本轮，既不继承也不删除
		// - okAt = 最近一次"两侧都拿到新数据"的时间；有任一侧没拿到就不刷新
		function mergeEntryRecord(r, prevRec, nowTs) {
			const gachaFail = (r && r.gachaFail) || null;
			const eventFail = (r && r.eventFail) || null;
			const rec = { ...((r && r.data) || {}), gachaFail, eventFail };
			if (prevRec) {
				if (!rec.banner && prevRec.banner) {
					rec.banner = prevRec.banner;
					rec.roles = prevRec.roles || "";
					if (!rec.bannerDates) rec.bannerDates = prevRec.bannerDates || "";
					if (!rec.bannerDatesRaw) rec.bannerDatesRaw = prevRec.bannerDatesRaw || prevRec.bannerDates || "";
					if (!rec.bannerHover) rec.bannerHover = prevRec.bannerHover || "";
					rec.gachaStale = true;
				}
				if (!rec.event && prevRec.event) {
					rec.event = prevRec.event;
					if (!rec.eventDates) rec.eventDates = prevRec.eventDates || "";
					if (!rec.eventDatesRaw) rec.eventDatesRaw = prevRec.eventDatesRaw || prevRec.eventDates || "";
					if (!rec.eventHover) rec.eventHover = prevRec.eventHover || "";
					rec.eventStale = true;
				}
			}
			// "两侧都拿到新数据"才算 okAt；被跳过的条目（两侧都没配来源）本轮根本没抓，不能算新数据
			const skipped = !!(r && r.reason === "skipped");
			rec.okAt = (!skipped && !gachaFail && !eventFail) ? nowTs : (prevRec && prevRec.okAt) || 0;
			return rec;
		}

		// 一轮刷新的总预算（毫秒）。注意：这只是"到点收尾"的兜底——被掐断的前提是 transport 理会 signal；
		// 宿主代理等不理会 signal 的实现靠 runEntriesWithDeadline 的兜底收尾，不会让调用方永远等下去。
		const REFRESH_TIMEOUT_MS = 12000;

		// 跑一批 fetchEntry，并施加"到点即超时"的兜底：
		// · 到点时**已经回来**的条目保留自己的结果；
		// · 还没回来的条目按该条目"有哪一侧来源"记成 {kind:"down", reason:"超时"}（与 fetchEntry 顶层 catch 同口径）；
		// 这样即使 transport 完全不理会 signal（宿主代理就是这样），刷新也一定会结束、面板不会永远"刷新中"。
		async function runEntriesWithDeadline(targets, timeoutMs) {
			const ms = timeoutMs || REFRESH_TIMEOUT_MS;
			const controller = typeof AbortController === "function" ? new AbortController() : null;
			const signal = controller ? controller.signal : void 0;
			const timeoutResult = (t) => {
				const fail = { kind: "down", reason: "超时" };
				return { ok: false, reason: "超时", gachaFail: t.url ? fail : null, eventFail: t.eventUrl ? fail : null };
			};
			let timer = 0;
			const deadline = new Promise((resolve) => {
				timer = coreEnv.timer.setTimeout(() => {
					if (controller) { try { controller.abort(); } catch { /* ignore */ } }
					resolve(null);
				}, ms);
			});
			try {
				const raced = targets.map(async (t) => {
					const r = await Promise.race([fetchEntry(t, signal), deadline]);
					return r || timeoutResult(t);   // null ⇒ 到点时这条还没回来
				});
				return await Promise.all(raced);
			} finally {
				coreEnv.timer.clearTimeout(timer);
			}
		}

		async function refreshAll(entries, s, timeoutMs) {
			// 自定义爬取地址覆盖默认；克隆避免污染原始对象（卡池源+活动源分别覆盖）
			// allowGeneric*：只有"用户自己填的地址"（custom:<url>）或自定义条目才允许通用解析兜底
			const targets = entries.map((e) => ({
				...e,
				url: getEntryUrl(s, e.id, e.url),
				eventUrl: getEntryUrl(s, e.id, e.eventUrl, "eventUrl"),
				allowGenericGacha: !!e.custom || isCustomSource(s, e.id),
				allowGenericEvent: !!e.custom || isCustomSource(s, e.id, "eventUrl")
			}));
			const results = await runEntriesWithDeadline(targets, timeoutMs);
			// 被跳过的条目（两侧都没配来源）不算成功——与外壳 buildScrapeInfo 的口径一致
			const okCount = results.filter((r) => r.ok && r.reason !== "skipped").length;
			return {
				okCount,
				total: entries.length,
				at: nowMs(),
				status: okCount > 0 ? "ok" : "unreachable",
				results
			};
		}
		//#endregion
