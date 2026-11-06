		//#region refresh
		// 两侧各自只允许写自己的字段：某些来源的载荷同时含卡池与活动字段（如 GameKee），
		// 若把整对象直接合并，活动源的数据会污染卡池列（反之亦然）——解耦契约的一部分。
		// `gacha` = **数据层数组**（P1，2026-11-07）：每口池一条（见下面「数据层数组」region）。
		// 它必须在这里登记，否则解析器将来直出的结构化数组会在这一层被 `pickFields` 静默削掉
		// （P1 的来源都不给这个字段 ⇒ 由 mergeEntryRecord 从字符串合成；P3 才由解析器直出）。
		const GACHA_FIELDS = ["banner", "roles", "bannerDates", "bannerDatesRaw", "bannerHover", "gacha"];
		// `eventClaimDates` = 明日方舟「奖励领取（兑换）截止」窗口（只有**有兑换期**的来源才带；
		// 没有就没有这个键）。它是**提醒侧**的第二个 deadline，不参与任何显示逻辑 ⇒ 必须原样进 lastData，
		// 否则「刷新过一次、中途不再刷新」就只剩一个 deadline 会响（见 65-remind.js 的 remindItemsOf）。
		// `eventShow` = **只给显示**的事项名（明日方舟兑换期 ⇒「<去重后的活动名> 兑换截止」；活动期没有这个键）。
		// 它同样必须原样进 lastData，否则兑换期那一行会退回活动名（`event` 本身不动）。
		// `eventHoverExtra` = **只进提示框**的提示行（`活动标签` ⏎ `… 兑换截止   档期` 每两条一组；没有兑换期就没有这个键）。
		// 同样要随 lastData 走，否则"沿用旧值时"提示框会少掉那一行（与 `eventShow` 同口径）。
		// `events` = **数据层数组**（P1，2026-11-07）：每条活动一条、兑换期放在 `phase` 里
		// （见下面「数据层数组」region）。与 `gacha` 同理必须登记，否则结构化来源会被静默削掉。
		const EVENT_FIELDS = ["event", "eventDates", "eventDatesRaw", "eventClaimDates", "eventShow", "eventHoverExtra", "eventHover", "events"];
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
		// `tz`（可选）= 源站墙钟时区，透传给抓取器/解析器（不传 = 本机时区，向后兼容）。
		async function resolveSide(side, { fetcher, url, allowGeneric, signal, tz }) {
			const emptyOf = (d) => (side === "gacha" ? !d || !d.banner : !d || !d.event);
			const parseGeneric = () => (side === "gacha"
				? tryParseGenericGacha(url, signal, tz)
				: tryParseGenericEvent(url, signal, tz));
			let data = null;
			let fail = null;
			if (fetcher) {
				try {
					data = await fetcher(url, signal, tz);
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
						signal,
						tz: source.tz
					});
				}
				let evData = null;
				let eventFail = null;
				if (source.eventUrl) {
					// 活动侧自己的抓取器（与卡池侧各自独立选择，来源可以完全不同）。
					// 注意：**默认路径就是"活动侧自己抓"** —— 解耦是常态，复用只是优化。
					const evFetcher = eventFetcherFor(source, eventUrl);
					// ── 两侧同一条 URL 时的请求复用：**命中才触发**的分支 ───────────
					// 只有两个条件**同时**成立才复用，否则一律走下面的独立抓取：
					//   ① 两侧是**同一条 URL**（按**完整 URL 含查询参数**比，不是「同一个网站」）
					//      —— 例如星铁的卡池与活动都是 wiki.biligame.com/sr/api.php，
					//         但 `page=历史跃迁` vs `page=活动一览`，**不是**同一条 URL；
					//         而绝区零/鸣潮两侧是字面完全相同的 URL，一次请求的响应完全一样。
					//   ② 卡池那次的载荷**确实带了活动字段**（`event`）
					// 复用只是"省掉一次**同一 URL** 的重复请求"，**不是解耦的腿**：
					// 活动侧的抓取器、失败归因、来源选择都保持独立（见 §53）。
					//
					// 2026-10-01 实测（11 内置条目逐条）：复用支命中 5 次
					//   （wuwa / nte / r1999 / ba-cn / ba-global —— 它们的卡池载荷本身就含活动字段），
					// 其余 6 条目（zzz / genshin / hsr / arknights / ba-jp / endfield）走独立抓取。
					const reuseSameRequest = eventUrl === gachaUrl && !!(g.data && g.data.event);
					if (reuseSameRequest) {
						// 同 URL：活动字段就在卡池载荷里，不重复抓
						evData = {
							event: g.data.event,
							eventDates: g.data.eventDates || "",
							eventDatesRaw: g.data.eventDatesRaw || g.data.bannerDatesRaw || "",
							eventHover: g.data.eventHover || ""
						};
					} else if (eventUrl === gachaUrl && !evFetcher) {
						// ── 两侧同一条 URL、但活动侧**没有自己的抓取器**（该条目就只有这一份载荷可用）──
						// ⚠️ **这一支不是死代码，别删**：**自定义条目**可以没有注册抓取器 ——
						//   `getAllEntries` 里 customEntries 带 `custom:true` + 用户填的 url/eventUrl，
						//   而 GACHA_FETCHERS / EVENT_FETCHERS 里没有它们的 id → `eventFetcherFor` 返回 null。
						//
						// 语义（2026-10-01 修）：
						//  · 卡池那次**成功**（g.data 非空）→ 用**同一份 HTML** 再跑一次通用活动解析。
						//    为什么必须试：卡池那次的载荷里可能只有卡池字段（没有 event），但**同一个页面**
						//    里就写着活动表。此前这里直接判 nomatch，于是自定义条目"卡池列有内容、活动列恒空"
						//    （用户点名，与卡池侧新加的普通表兜底不对称 —— 同一张表两侧口径必须一致）。
						//    复用 HTML 而不是重新抓：这条分支的初衷就是"省掉同一条 URL 的重复请求"。
						//  · 复用没解析出活动、或卡池那次本身失败 → 记 nomatch；
						//    后者沿用**同一次请求**的失败原因（如 HTTP 567），而不是笼统报"无可用来源"。
						// 教训：我一度只按"内置 11 条目命中 0 次"就判它死代码 —— **错的**，
						// 把"当前没命中"当成了"不可达"。`_batch1` A3 用合成条目（sim-nte）刻意覆盖这两条语义。
						// 取同一份文本：**只读缓存**（`peekHtmlText` 命中才返回，绝不发动新请求）。
						// 为什么不能调 fetchHtmlText：卡池那次若是走注册抓取器、或直连取到的，
						// 缓存里就没有它 —— 那时再去取就等于**打一次必被 CORS 拦的直连**，
						// 而这条分支的既有语义恰恰是"不打直连、如实记未公布"（`_batch1` A3 守护着）。
						// 只有"卡池那次确实经 fetchHtmlText 取过同一 URL"（自定义条目的常态）才复用。
						const sameHtml = g.data ? peekHtmlText(gachaUrl) : null;
						const reusedEvent = sameHtml ? genericEventPayloadFromHtml(sameHtml, source.tz) : null;
						if (reusedEvent) {
							evData = reusedEvent;
						} else {
							eventFail = g.data ? { kind: "nomatch" } : (g.fail || { kind: "nomatch" });
						}
					} else {
						// 活动侧独立抓取（含"两侧不是同一条 URL"与"同一条 URL 但载荷无活动字段"两种情形）
						const ev = await resolveSide("event", {
							fetcher: evFetcher,
							url: eventUrl,
							allowGeneric: !!(source.custom || source.allowGenericEvent),
							signal,
							tz: source.tz
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
				// 顶层异常（含 REFRESH_TIMEOUT_MS 超时中断）：两侧按"报错"记，面板照实提示
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
		function mergeEntryRecord(r, prevRec, nowTs, meta) {
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
					// 活动侧整列是旧值时，奖励领取窗口也一起沿用（否则一次抓取失败就会**少一个 deadline**）
					if (!rec.eventClaimDates) rec.eventClaimDates = prevRec.eventClaimDates || "";
					// 事项名同口径沿用：否则兑换期那一行会从「<活动名> 兑换截止」退回活动名（与格子里的兑换区间打脸）
					if (!rec.eventShow) rec.eventShow = prevRec.eventShow || "";
					// 提示行同口径沿用：否则活动侧整列是旧值时，提示框会少掉「兑换截止」那一行
					if (!rec.eventHoverExtra) rec.eventHoverExtra = prevRec.eventHoverExtra || "";
					if (!rec.eventHover) rec.eventHover = prevRec.eventHover || "";
					rec.eventStale = true;
				}
			}
			// "两侧都拿到新数据"才算 okAt；被跳过的条目（两侧都没配来源）本轮根本没抓，不能算新数据
			const skipped = !!(r && r.reason === "skipped");
			rec.okAt = (!skipped && !gachaFail && !eventFail) ? nowTs : (prevRec && prevRec.okAt) || 0;
			// 数据层数组（P1，见下面「数据层数组」region）：
			// 来源若已给结构化数组（P3 的解析器会开始给）就原样用；否则从**上面合并后的**字符串字段合成。
			// 合成发生在**沿回旧值之后**，所以"这一列显示的是沿用值"时数组内容与沿回的那串文本一致，
			// 不会出现"字符串是新的、数组还是上一轮"这种两套事实。
			rec.gacha = Array.isArray(rec.gacha) ? rec.gacha : dataArrayGachaOf(rec, meta, new Date(nowTs));
			rec.events = Array.isArray(rec.events) ? rec.events : dataArrayEventsOf(rec, meta, new Date(nowTs));
			return rec;
		}

		//#region 数据层数组（P1，2026-11-07）
		// ── 为什么有这一段 ──────────────────────────────────────────────────────────
		// 用户定的方向：数据核心只放**事实**；"谁排第一"是**纯展示决策**，要下移到显示层；
		// 表格与探头必须**共用同一份数组**（探头只是会动的 UI，零数据语义）。
		//
		// P1（本阶段）**只做数据层、不碰显示层行为**：
		//   · 新增两个数组字段（每个游戏都有）：`gacha` / `events`（形状见下）
		//   · 它们**不从解析器改**（那是 P3），而是在"数据流入 lastData 前"这一层（就是这里）
		//     从**现有字符串字段合成** —— 旧字段一个都不删、值一字不改，所以面板行为逐字不变。
		//   · 顺序 = **自然顺序**（结束时间升序，与现有悬停同一口径）；这里**不挑选**"第一条"。
		//     外显哪一条是显示层的决定（现在它仍在 81/82 里自己选，P2 再改成读数组）。
		//
		// 形状（每个元素都是一条"事实"）：
		//   gacha:  [{ key, title, show, roles: string[], startTs, endTs, tz, raw, longTerm? }]
		//   events: [{ key, title, show, startTs, endTs, tz, raw, phase?: { kind:"claim", startTs, endTs, show } }]
		//   · title = 源站原文名（卡池名 / 活动名）；show = **显示名**（外显时真正显示的那串）
		//   · key   = `<gameId>:gacha:<index>` / `<gameId>:event:<index>`，同一次归一里唯一
		//   · startTs/endTs = **本机时刻**（`parseDisplayRange` 按运行环境时区解释源站墙钟）。
		//     ⚠️ 这是 P1 的**临时口径**（任务书明说可以先这样）：它没做"源站 tz → 本机"的换算，
		//     所以在非 +08 的机器上会与显示层换算后的小时不符。P2 会换成**结构化来源**
		//     （解析器直出 startTs/endTs），届时两端都按绝对时刻，这个偏差自动消失。
		//   · tz = 条目声明的源站时区（让下游能自己判断"这串时间按哪个墙钟读"）
		//   · raw = 源站原文（`bannerDatesRaw` / `eventDatesRaw`；并列池那条 = 悬停里那行档期）
		//   · phase = 活动的第二阶段（明日方舟「奖励领取（兑换）截止」）：只有来源给了
		//     `eventClaimDates` 才有这个键 —— 它是一条**独立的**截止窗口，不是另一个活动条目。
		//   · longTerm = P1 **不合成**（可选字段，留给 P2/P3 的结构化来源；归一函数会原样透传）。
		//
		// 并列池怎么展开：复用**显示层同一个** `scheduleHoverItems`（2026-11-07 搬进 26-parser-hover.js，
		// 因为它要同时进 core 产物），再用下面 dataArrayHoverPoolsOf 里那三条"这口池已经在数组里了"
		// 的判据 —— 与 81-schedule-model.js 的 scheduleHoverOnes **逐字对应**。P2 让显示层直接读数组后，
		// 那段显示层解析会删掉，这里就成为唯一实现。
		const DATA_ARRAY_LABEL = (s) => String(s || "").replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, "");
		// 字符串字段归一（数组元素用）：非字符串一律空串（与 CONTENT_FIELDS 的口径一致）
		function dataArrayTextOf(v) {
			return typeof v === "string" ? v : "";
		}
		// 时间戳归一（数组元素用）：**必须是 number**，否则 null（0 是合法值：长期档期的哨兵）
		function dataArrayTsOf(v) {
			return typeof v === "number" && isFinite(v) ? v : null;
		}
		// 角色名 → string[]（**原始文本**，不做 cleanRoleNames 的去修饰 —— 那是显示名的事）
		function dataArrayRolesOf(roles) {
			return String(roles || "").split(/[、,，]/).map((x) => x.trim()).filter(Boolean);
		}
		// 一段档期文本 → { startTs, endTs }；读不出（"长期"/"版本更新后 ~ …"/空）⇒ 两端 null，不硬凑
		function dataArrayWindowOf(text, now) {
			const r = parseDisplayRange(dataArrayTextOf(text), now);
			return r ? { startTs: dataArrayTsOf(r.startTs), endTs: dataArrayTsOf(r.endTs) } : { startTs: null, endTs: null };
		}
		// 自然顺序：结束时间升序 → 起点升序 → 无结束时间的排最后（与 buildPoolHover 同一口径）
		function dataArraySortOf(a, b) {
			const ea = a.endTs == null ? Infinity : a.endTs;
			const eb = b.endTs == null ? Infinity : b.endTs;
			if (ea !== eb) return ea - eb;
			const sa = a.startTs == null ? Infinity : a.startTs;
			const sb = b.startTs == null ? Infinity : b.startTs;
			if (sa !== sb) return sa - sb;
			return 0;   // 相等 ⇒ 保持插入顺序（Array#sort 自 ES2019 起是稳定排序）
		}
		// 排好序 + 按最终下标发 key（下标即"自然顺序里的位置"，跨刷新稳定）
		function dataArrayOrderedOf(list, prefix) {
			return list.slice().sort(dataArraySortOf).map((x, i) => Object.assign({ key: prefix + ":" + i }, x));
		}
		// 悬停文本 → 可进数组的**并列条目**（这口池/这条活动在上面主条目之外，还是独立一条）
		// ⚠️ 三条判据与 81-schedule-model.js 的 scheduleHoverOnes 逐字对应：
		//   ① 与外显同名（那条已经在数组里了）
		//   ② 与**显示名**同名（明日方舟兑换期的主行 = `eventShow`「<活动名> 兑换截止」⇒ 同一条）
		//   ③ 「池名：外显名」/「外显名：其余」= 同一口池的两种写法（只认「：」两侧整段）
		function dataArrayHoverPoolsOf(hover, main, now) {
			const list = scheduleHoverItems(dataArrayTextOf(hover), main ? main.title : "", true);
			const shown = DATA_ARRAY_LABEL(main && (main.show || main.title));
			const out = [];
			for (const x of list) {
				if (main) {
					if (x.title === main.title) continue;
					if (main.show && x.title === main.show) continue;
					const t = DATA_ARRAY_LABEL(x.title);
					if (shown && t && t !== shown) {
						const tail = t.lastIndexOf("\uFF1A" + shown);
						if (t.indexOf(shown + "\uFF1A") === 0 || (tail >= 0 && tail === t.length - shown.length - 1)) continue;
					}
				}
				const w = dataArrayWindowOf(scheduleNoYear(x.win), now);
				out.push({ title: x.title, show: x.title, startTs: w.startTs, endTs: w.endTs, raw: x.win });
			}
			return out;
		}
		// 卡池侧数组：主条目（banner / roles / bannerDates）+ 并列池（bannerHover 能解析出来时）
		function dataArrayGachaOf(rec, meta, now) {
			const id = (meta && meta.id) || "";
			const tz = (meta && meta.tz) || "";
			const banner = dataArrayTextOf(rec && rec.banner);
			if (!banner) return [];   // 这一侧没有卡池数据（未公布 / 失败）⇒ 空数组，不硬造
			const roles = dataArrayTextOf(rec.roles);
			const w = dataArrayWindowOf(rec.bannerDates, now);
			const main = {
				title: banner,
				// 外显口径与 81 的 scheduleNormalize 一致：有角色名就显示**去修饰**的角色名，否则池名
				show: cleanRoleNames(roles, id) || banner,
				roles: dataArrayRolesOf(roles),
				startTs: w.startTs,
				endTs: w.endTs,
				tz,
				raw: dataArrayTextOf(rec.bannerDatesRaw)
			};
			const list = [main].concat(dataArrayHoverPoolsOf(rec.bannerHover, main, now));
			return dataArrayOrderedOf(list.map((x) => ({
				title: x.title,
				show: x.show,
				roles: x.roles || [],
				startTs: x.startTs,
				endTs: x.endTs,
				tz,
				raw: x.raw
			})), id + ":gacha");
		}
		// 活动侧数组：主条目（event / eventShow / eventDates，带 phase）+ 并列活动（eventHover）
		function dataArrayEventsOf(rec, meta, now) {
			const id = (meta && meta.id) || "";
			const tz = (meta && meta.tz) || "";
			const event = dataArrayTextOf(rec && rec.event);
			if (!event) return [];
			const eventShow = dataArrayTextOf(rec.eventShow);
			const w = dataArrayWindowOf(rec.eventDates, now);
			const main = {
				title: event,
				// 与 scheduleNormalize 一致：活动侧优先用**只给显示**的 `eventShow`，没有就退回活动名
				show: eventShow || event,
				startTs: w.startTs,
				endTs: w.endTs,
				tz,
				raw: dataArrayTextOf(rec.eventDatesRaw)
			};
			// 第二阶段（奖励领取/兑换截止）：独立窗口，不是第二个活动条目
			const claim = dataArrayTextOf(rec.eventClaimDates);
			if (claim) {
				const cw = dataArrayWindowOf(claim, now);
				main.phase = {
					kind: "claim",
					startTs: cw.startTs,
					endTs: cw.endTs,
					show: eventShow || (event + " 兑换截止")
				};
			}
			const extras = dataArrayHoverPoolsOf(rec.eventHover, main, now).map((x) => ({
				title: x.title,
				show: x.show,
				startTs: x.startTs,
				endTs: x.endTs,
				tz,
				raw: x.raw
			}));
			return dataArrayOrderedOf([main].concat(extras), id + ":event");
		}
		// ── 归一（持久化白名单的数组分支用；engine-head.js 的 normalizeRecord 调它们）──
		// 只做**最少校验**：非对象丢弃、ts 必须是 number 否则 null、其余字符串字段缺了填空串。
		function dataArrayGachaItemOf(raw) {
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
			const out = {
				key: dataArrayTextOf(raw.key),
				title: dataArrayTextOf(raw.title),
				show: dataArrayTextOf(raw.show),
				roles: Array.isArray(raw.roles) ? raw.roles.map(dataArrayTextOf).filter(Boolean) : [],
				startTs: dataArrayTsOf(raw.startTs),
				endTs: dataArrayTsOf(raw.endTs),
				tz: dataArrayTextOf(raw.tz),
				raw: dataArrayTextOf(raw.raw)
			};
			if (raw.longTerm === true) out.longTerm = true;   // 可选字段：P1 不合成，只透传
			return out;
		}
		function dataArrayEventItemOf(raw) {
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
			const out = {
				key: dataArrayTextOf(raw.key),
				title: dataArrayTextOf(raw.title),
				show: dataArrayTextOf(raw.show),
				startTs: dataArrayTsOf(raw.startTs),
				endTs: dataArrayTsOf(raw.endTs),
				tz: dataArrayTextOf(raw.tz),
				raw: dataArrayTextOf(raw.raw)
			};
			const ph = raw.phase;
			if (ph && typeof ph === "object" && !Array.isArray(ph)) {
				out.phase = {
					kind: dataArrayTextOf(ph.kind),
					startTs: dataArrayTsOf(ph.startTs),
					endTs: dataArrayTsOf(ph.endTs),
					show: dataArrayTextOf(ph.show)
				};
			}
			return out;
		}
		function dataArrayGachaListOf(v) {
			return Array.isArray(v) ? v.map(dataArrayGachaItemOf).filter(Boolean) : [];
		}
		function dataArrayEventListOf(v) {
			return Array.isArray(v) ? v.map(dataArrayEventItemOf).filter(Boolean) : [];
		}
		//#endregion

		// 一轮刷新的总预算（毫秒）。注意：这只是"到点收尾"的兜底——被掐断的前提是 transport 理会 signal；
		// 宿主代理等不理会 signal 的实现靠 runEntriesWithDeadline 的兜底收尾，不会让调用方永远等下去。
		//
		// 2026-10-21：12000 → 20000（用户点名）。12 秒对**多请求串行**的来源不够用（如赛马娘国际服
		// 一次刷新要 POST 列表 + 逐条详情、GameKee 要目录树 + 多个详情），慢网下还没抓完就被判超时；
		// 20 秒与 selfCheck 的默认预算对齐（selfCheck 不传 timeoutMs 时用同一个常量）。
		const REFRESH_TIMEOUT_MS = 20000;

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
			// 每轮清空 HTML 文本缓存：两侧同址的复用必须落在**同一轮内**，
			// 跨轮复用会拿到过期页面（见 30-parsers.js 的 fetchHtmlText，压平后见 22-fetcher-core.js）
			resetHtmlTextCache();
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
