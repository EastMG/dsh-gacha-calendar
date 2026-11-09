		//#region refresh
		// 两侧各自只允许写自己的字段：某些来源的载荷同时含卡池与活动字段（如 GameKee），
		// 若把整对象直接合并，活动源的数据会污染卡池列（反之亦然）——解耦契约的一部分。
		// `gacha` = **数据层数组**（P1，2026-11-07）：每口池一条（见下面「数据层数组」region）。
		// 它必须在这里登记，否则解析器将来直出的结构化数组会在这一层被 `pickFields` 静默削掉
		// （P1 的来源都不给这个字段 ⇒ 由 mergeEntryRecord 从字符串合成；P3 才由解析器直出）。
		// `itemFacts` = **类别/标签的事实通道**（P2 收尾，2026-11-07）：解析器知道"这一条属于哪个类别"
		// （如 FGO 活动表第 4 列的 `Event` / `Campaign`），但悬停文本里**只允许**名称与档期 ⇒ 没有
		// 别的地方能把它带进数组。所以由解析器额外给一份 `{ "<条目标题>": { category?, tags? } }`，
		// 数据层在合成数组时按标题贴到条目上（见 dataArrayAttachFactsOf），**随后就从记录里删掉**
		// （它不是展示字段，也不进 lastData；留在数组条目上的 `category`/`tags` 才是事实）。
		// 两边的字段表都要登记，否则 `pickFields` 会把这条通道静默削掉。
		// `gachaHoverItems` / `eventHoverItems` = **条目事实**（P3，2026-11-07）：解析器直出
		// `gacha` / `events` 时，把"生成悬停文本与数组的那份条目"一并带上来（`{ title/label, startTs,
		// endTs, raw }`）。它是 `gacha` / `events` 的**同一份来源**（数组 = 它排序发 key 的结果、
		// 悬停 = 它排版的结果），到 `mergeEntryRecord` 末尾就删掉 —— **不进记录、不进 lastData**。
		// 与 `itemFacts` 同一性质：只是"解析器 → 数据层"这一跳的通道（回归用例靠它证明两边同源）。
		const GACHA_FIELDS = ["banner", "roles", "bannerDates", "bannerDatesRaw", "bannerHover", "gacha", "gachaHoverItems", "itemFacts"];
		// `eventClaimDates` = 明日方舟「奖励领取（兑换）截止」窗口（只有**有兑换期**的来源才带；
		// 没有就没有这个键）。它是**提醒侧**的第二个 deadline，不参与任何显示逻辑 ⇒ 必须原样进 lastData，
		// 否则「刷新过一次、中途不再刷新」就只剩一个 deadline 会响（见 65-remind.js 的 remindItemsOf）。
		// `eventShow` = **只给显示**的事项名（明日方舟兑换期 ⇒「<去重后的活动名> 兑换截止」；活动期没有这个键）。
		// 它同样必须原样进 lastData，否则兑换期那一行会退回活动名（`event` 本身不动）。
		// `eventHoverExtra` = **只进提示框**的提示行（`活动标签` ⏎ `… 兑换截止   档期` 每两条一组；没有兑换期就没有这个键）。
		// 同样要随 lastData 走，否则"沿用旧值时"提示框会少掉那一行（与 `eventShow` 同口径）。
		// `events` = **数据层数组**（P1，2026-11-07）：每条活动一条、兑换期放在 `phase` 里
		// （见下面「数据层数组」region）。与 `gacha` 同理必须登记，否则结构化来源会被静默削掉。
		const EVENT_FIELDS = ["event", "eventDates", "eventDatesRaw", "eventClaimDates", "eventShow", "eventHoverExtra", "eventHover", "events", "eventHoverItems", "itemFacts"];
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
						// ⚠️ P3（2026-11-07）：解析器直出的 `events` / 条目事实也要跟着走 —— 只是"省一次请求"，
						//    不是"活动侧的数据可以少"（漏了这行，鸣潮的活动数组就会在复用分支里静默消失）。
						evData = {
							event: g.data.event,
							eventDates: g.data.eventDates || "",
							eventDatesRaw: g.data.eventDatesRaw || g.data.bannerDatesRaw || "",
							eventHover: g.data.eventHover || "",
							...(g.data.events ? { events: g.data.events, eventHoverItems: g.data.eventHoverItems } : {})
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
					// 数组里的**可选事实**（category / tags / preview / source）不在字符串字段里 ⇒ 从字符串
					// 重算这一侧会把它们丢掉（FGO 的 Event/Campaign 档位就是这么来的）。整列是沿用值时
					// 连数组一起沿用，事实才与显示的那行保持同一份。
					// 只沿用"每条都带 `source`"的数组：P2 收尾之前写进 lastData 的老数组没有这个事实，
					// 沿用会让显示层的规则退化 ⇒ 那种情况宁可按字符串重算（重算会补回 source）。
					if (!Array.isArray(rec.gacha) && dataArrayInheritableOf(prevRec.gacha)) rec.gacha = dataArrayGachaListOf(prevRec.gacha);
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
					if (!Array.isArray(rec.events) && dataArrayInheritableOf(prevRec.events)) rec.events = dataArrayEventListOf(prevRec.events);
					rec.eventStale = true;
				}
			}
			// "两侧都拿到新数据"才算 okAt；被跳过的条目（两侧都没配来源）本轮根本没抓，不能算新数据
			const skipped = !!(r && r.reason === "skipped");
			rec.okAt = (!skipped && !gachaFail && !eventFail) ? nowTs : (prevRec && prevRec.okAt) || 0;
			// 数据层数组（P1，见下面「数据层数组」region）：**唯一来源 = 解析器直出**。
			// ⚠️ P3c（2026-11-07）：最后 3 款切完后，"从字符串字段合成"的那条老路（`dataArrayGachaOf` /
			//    `dataArrayEventsOf` / `dataArrayHoverPoolsOf`）已删。于是：
			//      · 解析器给了数组 ⇒ 归一 + 按记录 id 重发 key（见下）；
			//      · 没给（老 lastData 归一后的空数组 / 未切直出的备选源）⇒ **空数组**，
			//        显示层据此写「该来源无数据」，**不抛错**（`dataArrayGachaListOf(undefined)` = []）。
			//    沿回旧值那条路（上面 `dataArrayInheritableOf`）仍然保留：抓取失败时这一列显示上一轮的
			//    数组，"旧数据"照旧能看见。
			// 合成发生在**沿回旧值之后**，所以"这一列显示的是沿用值"时数组内容与沿回的那串文本一致，
			// 不会出现"字符串是新的、数组还是上一轮"这种两套事实。
			// ⚠️ P3（2026-11-07）：解析器直出的数组**已经是**最终形状（顺序 / 事实都在解析器侧定好，
			//    见 `dataArrayProducedItemOf`），这里只做**归一 + 按记录 id 重发 key**：
			//    解析器不必知道自己的 `meta.id`（通用源 / 自定义条目根本拿不到），key 的前缀由
			//    数据层统一裁到 `<id>:gacha:i` / `<id>:event:i` —— 顺带保证"同一记录里 key 唯一"。
			rec.gacha = dataArrayProducedListOf(dataArrayGachaListOf(rec.gacha), ((meta && meta.id) || "") + ":gacha");
			// 主条 `show` 与记录的字符串**同源**：`cleanRoleNames` 对蔚蓝三服（`BA_ROLE_IDS`）按 id
			// 保留括号后缀，而解析器未必知道 `meta.id`（通用源 / 自定义条目拿不到）→ 这里按记录 id
			// 再算一次，与 `dataArrayGachaMainOf` 是**同一句**（解析器直出与合成因此不会在 show 上漂开）。
			if (rec.gacha.length && rec.roles != null) {
				const mainItem = rec.gacha.find((x) => x.source === "primary");
				if (mainItem && typeof rec.banner === "string" && rec.banner) {
					mainItem.show = cleanRoleNames(rec.roles, (meta && meta.id) || "") || rec.banner;
				}
			}
			rec.events = dataArrayProducedListOf(dataArrayEventListOf(rec.events), ((meta && meta.id) || "") + ":event");
			// `itemFacts` / `gachaHoverItems` / `eventHoverItems` 只是"解析器 → 数组"的**通道**：
			// 事实已经贴到数组条目上了、悬停文本也已经生成了，它们不进记录/缓存。
			delete rec.itemFacts;
			delete rec.gachaHoverItems;
			delete rec.eventHoverItems;
			return rec;
		}

		//#region 数据层数组（P1，2026-11-07）
		// ── 为什么有这一段 ──────────────────────────────────────────────────────────
		// 用户定的方向：数据核心只放**事实**；"谁排第一"是**纯展示决策**，要下移到显示层；
		// 表格与探头必须**共用同一份数组**（探头只是会动的 UI，零数据语义）。
		//
		// P1（第一阶段的迁移）**只做数据层、不碰显示层行为**：
		//   · 新增两个数组字段（每个游戏都有）：`gacha` / `events`（形状见下）
		//   · 它们**不从解析器改**（那是 P3），而是在"数据流入 lastData 前"这一层（就是这里）
		//     从**现有字符串字段合成** —— 旧字段一个都不删、值一字不改，所以面板行为逐字不变。
		//   ⚠️ **P3c（2026-11-07）起那条合成路径已删**：解析器全部直出数组（`dataArrayProduced*`），
		//      这里只做"归一 + 按记录 id 重发 key"。老缓存（没有数组）⇒ 空数组 ⇒ 该侧显示「无数据」。
		//   · 顺序 = **自然顺序**（结束时间升序，与现有悬停同一口径）；这里**不挑选**"第一条"。
		//     外显哪一条是显示层的决定（`sideViewOf`）。
		//
		// 形状（每个元素都是一条"事实"）：
		//   gacha:  [{ key, title, show, roles: string[], startTs, endTs, tz, raw,
		//              source, category?, tags?, preview?, longTerm? }]
		//   events: [{ key, title, show, startTs, endTs, tz, raw, source,
		//              category?, tags?, preview?, phase?: { kind:"claim", startTs, endTs, show } }]
		//   · title = 源站原文名（卡池名 / 活动名）；show = **显示名**（外显时真正显示的那串）
		//   · key   = `<gameId>:gacha:<index>` / `<gameId>:event:<index>`，同一次归一里唯一
		//   · startTs/endTs = **绝对时刻**（epoch 毫秒）。
		//     ⚠️ 口径沿革（P4，2026-11-07）：P1~P3 是"源站墙钟按**本机**时区解释"的临时口径
		//     （同一份数据在 UTC 机器上比 +08 少 8 小时）；现在 `dataArrayWindowOf(文本, now, tz)`
		//     按**条目自己的 tz** 解析源站墙钟 → 两端都是同一个绝对时刻。所以数组 ts 逐字节
		//     跨时区相同，显示层也据此按条目 tz 渲染源站墙钟文本（见 81 的 scheduleMeta）。
		//   · tz = 条目声明的源站时区（既是"这串时间按哪个墙钟读"，也是显示层渲染的时区）
		//   · raw = 源站原文（`bannerDatesRaw` / `eventDatesRaw`）。⚠️ 2026-11-09 起**并列条**那条
		//     与悬停**有意不同**：主条 raw 直接取 `*DatesRaw`（= 源站原文，可能含「开服后」这类相对表述）；
		//     并列条的 raw 由 `dataArrayWindowTextOf` 从 ts 派生（`MM-DD HH:MM ~ MM-DD HH:MM`）——
		//     因为它还要被 `dataArrayWindowOf` **反解析回 ts**，源站原文里的相对词会让 ts 整片变 null
		//     （2026-11-09 实测 banGDream 活动 16 条全丢）。用户可见的悬停才需要源站措辞。
		//   · source = **这条是谁**（P2 收尾，2026-11-07）：`"primary"` = 引擎给的外显那条；
		//     `"hover"` = 从悬停文本解析出来的并列条目。两侧都要在数组里（旧探头一直这么显示），
		//     显示层按 `source` 分辨"主行 / 并列行"，不再靠判重键把同一口池并成一条。
		//   · category / tags = **类别事实**（可缺）：取不到就**留空**（不猜）。`category` 如 FGO 活动表第 4 列
		//     的 `Event` / `Campaign`；`tags` 预留给带标签的来源。解析器若知道类别，通过 `itemFacts`
		//     通道给（见 GACHA_FIELDS 的说明），数据层按标题贴到条目上。
		//   · preview = **预告稿标记**（可缺）：标题里带「予告」/coming soon 时为 `true`
		//     （与赛马娘老实现 `ns_umamusume_official_umaCurrentWindows` 的 previewRank 同一判据）。
		//   · phase = 活动的第二阶段（明日方舟「奖励领取（兑换）截止」）：只有来源给了
		//     `eventClaimDates` 才有这个键 —— 它是一条**独立的**截止窗口，不是另一个活动条目。
		//   · longTerm = P1 **不合成**（可选字段，留给 P2/P3 的结构化来源；归一函数会原样透传）。
		//
		// 并列条目怎么展开：**唯一实现** = `dataArrayExtrasFromEntriesOf`（下面那份；三条"这条已经在
		// 数组里了"的判据 + "完全相同"去重）。P3c 之前还有一条"把悬停文本拆成 `{ title, win }` 再喂进来"
		// 的路径（`dataArrayHoverPoolsOf`），28 款全部直出后已删 —— 现在条目事实由解析器直接给。
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
		// `now` 两种都收：数据层合成器手里是 `Date`，解析器（P3 直出数组）手里是毫秒数。
		//
		// ── 时间口径（P4，2026-11-07）：数组条目的 ts = **绝对时刻** ─────────────────────
		// `tz` = 条目声明的**源站墙钟**时区。同一段 `MM-DD HH:MM` 在 UTC 与 +08 的机器上必须读出
		// **同一个绝对毫秒**（P1~P3 的"本机墙钟"口径已废，见下面的实现说明）。做法只有三步、全是既有工具：
		//   ① 把 `now` 换成"**源站墙钟字段**构成的本机 Date"（`sourceWallParts`）——
		//      于是 `parseDisplayRange` 补年份 / 判跨年时用的是**源站那一年**（跨年那半天不会错位）；
		//   ② 让 `parseDisplayRange` 照常把文本当本机墙钟解释（它只会这一种），得到"墙钟时刻"；
		//   ③ 把每个时刻按 `sourceInstant(墙钟字段, tz)` 平移成真正的绝对时刻 ——
		//      与解析器造 ts、ics 导出用的是**同一个函数**，换算只有一处实现。
		// ⚠️ 为什么不在 `parseDisplayRange` 里加 tz 参数：60-helpers 在 core 产物里位于**模块顶层**，
		//    而 15-env 的 `sourceInstant` 在 `createEngine` 内部 ⇒ 在 core 里那句 `typeof sourceInstant`
		//    会静默退化成本机时区（2026-11-07 实测：core 产物的数组 ts 全体偏 8 小时、lib 却是对的，
		//    最后 P3 等价性在 +08 机器上红了一大片）。本函数在 createEngine 内 ⇒ 这里引用才是安全的。
		// 没有 tz（自定义条目 / 老调用）⇒ 沿用本机墙钟（与改造前一致，不猜时区）。
		function dataArrayWindowOf(text, now, tz) {
			const at = now instanceof Date ? now : new Date(now);
			const textOf = dataArrayTextOf(text);
			const srcTz = tz == null || tz === "" ? "" : String(tz).trim();
			// ① 源站墙钟字段 → 一个"本机字段恰好等于源站墙钟"的 Date（只用于补年份 / 判跨年）
			const wp = srcTz ? sourceWallParts(at.getTime(), srcTz) : null;
			const atSrc = wp ? new Date(wp.y, wp.mo - 1, wp.d, wp.h, wp.mi) : at;
			// ② 两种文本形态：`MM-DD HH:MM ~ MM-DD HH:MM`（年份给 `parseDisplayRange` 按 atSrc 补）
			//    与 `YYYY-MM-DD HH:MM ~ YYYY-MM-DD HH:MM`（跨年窗口的原文，`fmtWindow` 的另一种输出）。
			//    后者不带进 `parseDisplayRange` 是因为它只认两位月份（ics 那边也刻意另写了一份）；
			//    这里按**墙钟字段**直接构造，再把两端按同一个 toSrc 平移。
			const parts = textOf.split("~").map((s) => s.trim());
			const parseYmd = (s) => {
				const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
				if (!m) return null;
				const mo = Number(m[2]), d = Number(m[3]);
				if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
				return { y: Number(m[1]), mo, d, h: m[4] ? Number(m[4]) : 0, mi: m[5] ? Number(m[5]) : 0 };
			};
			let r = null;
			if (parts.length >= 2) {
				const a = parseYmd(parts[0]), b = parseYmd(parts[1]);
				if (a && b) {
					r = {
						startTs: new Date(a.y, a.mo - 1, a.d, a.h, a.mi).getTime(),
						endTs: new Date(b.y, b.mo - 1, b.d, b.h, b.mi).getTime()
					};
				}
			}
			// ③ 其余形态照常交给 `parseDisplayRange`（年份 / 跨年规则只有那一处实现）
			if (!r) r = parseDisplayRange(textOf, atSrc);
			// ④ **单边窗口**（P4，2026-11-07）：星铁那类「4.6版本更新后 ~ 11-10 15:00」——
			//    起点读不出、终点是明确日期。以前整条两端都判 null ⇒ 数组里留着这条事实、面板却
			//    永远看不到它（"同一游戏的多个在期条目各占一行"就少一条）。现在两端**各自独立解析**：
			//    唯一可解析的那一端照常给绝对时刻，另一端 null（调用方按"起点未知 = 已开始 / 终点未知 = 长期"
			//    退化，绝不编一个开始时刻）。年份仍按 atSrc 那一年补（单边跨年的极端情形与两端都写年份的
			//    形态另有分支，见上面 ②）。
			if (!r && parts.length >= 2) {
				const selfOf = (s) => {
					if (!s) return null;
					const one = parseDisplayRange(s + " ~ " + s, atSrc);
					return one ? one.startTs : null;
				};
				const sa = selfOf(parts[0]), sb = selfOf(parts[1]);
				if (sa != null || sb != null) r = { startTs: sa, endTs: sb };
			}
			if (!r) return { startTs: null, endTs: null };
			if (!srcTz) return { startTs: dataArrayTsOf(r.startTs), endTs: dataArrayTsOf(r.endTs) };
			// ⑤ 墙钟时刻 → 源站时区下的绝对时刻（`sourceInstant` 对 IANA 名做两遍法，跨 DST 也对）
			const toSrc = (ts) => {
				if (ts == null) return null;
				const d = new Date(ts);
				return sourceInstant(d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), srcTz);
			};
			return { startTs: dataArrayTsOf(toSrc(r.startTs)), endTs: dataArrayTsOf(toSrc(r.endTs)) };
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
		// ── 判重口径（P2 收尾，2026-11-07：**不再按「同池」并掉行**）────────────────────
		// P1 曾用「起止时间 + 池名」当判重键，把"同一口池的另一种写法"合并成一条。那是**数据层
		// 自己发明的**判据：旧探头（81 的 scheduleHoverOnes）从来没有这一条，它一直把
		// 「合并角色的主行」和「池名：角色」并列显示 —— 物华弥新卡池少的那行「繁霜春落：李小孩项链」、
		// 星铁卡池少的「我身即刃…：千冶•刃」就是这么丢的（用户 2026-11-07 点名要回来）。
		// 现在的口径：**引擎主行一条 + 悬停并列行各一条**，用 `source` 区分；只有"内容完全一样"
		// （同标题 + 同起止）才去掉一条，并且**优先保留 `source:"primary"` 那条**。
		function dataArrayIdentityOf(title, startTs, endTs) {
			return `${dataArrayTextOf(title)}|${startTs == null ? "" : startTs}|${endTs == null ? "" : endTs}`;
		}
		// 能不能把上一轮的数组原样沿用（"这一列显示的是旧值"时）：
		// 只有**每条都带 `source`** 的数组才算同一代事实（P2 收尾之后写的）；老数组没有这个键，
		// 沿用会让显示层的规则退化 ⇒ 不沿用，按字符串重算（重算会补回 source / preview）。
		function dataArrayInheritableOf(list) {
			return Array.isArray(list) && list.length > 0
				&& list.every((x) => x && typeof x.source === "string" && x.source);
		}
		// 并列条目（**结构化**）→ 数组条目：三条判据 + "完全相同"去重（与上面那段注释同一份口径）。
		// `entries` 元素形状 = 解析器直出的条目事实 `{ title|label, startTs, endTs, raw }`
		// （历史：P3c 之前还有一条"把悬停文本拆成 `{ title, win }` 再进来"的路径 ——
		//  `dataArrayHoverPoolsOf` 已在 P3c 删除；这里的 `win` 分支只为回归 oracle 保留，见 test/cases-p3.mjs）。
		// `opts.tz`：条目没有现成的窗口文本时，按**源站时区**渲染出同一串。
		// ⚠️ 2026-11-09 起这里**不再**用 `hoverWindowTextOf`（它会给相对表述退回源站原文）——
		//    数组的 raw 要能被 `dataArrayWindowOf` 反解析回 ts，源站措辞做不到（见下面调用点的注释）。
		// 时间戳口径（P4，2026-11-07）：窗口文本按**条目 tz** 读成**绝对时刻**（`dataArrayWindowOf`），
		// 于是"同一段 `MM-DD HH:MM`"在 UTC 与 +08 的机器上得到同一个 ts；显示层再按条目 tz 渲染回
		// 源站墙钟 —— 渲染文本因此跨时区逐字相同（P1 的"本机时刻"口径已废）。
		// 数组派生用的窗口文本（2026-11-09）：**有 ts 就 fmtWindow，缺时刻退回 raw** —— 即 P3b 之前
		// `hoverWindowTextOf` 的旧函数体。刻意**不**与悬停侧共用（理由见下面调用点那段注释：
		// 数组的 raw 还要被 `dataArrayWindowOf` 反解析回 ts，源站的「维护后 / 版本更新后」解析不了）。
		function dataArrayWindowTextOf(item, tz) {
			if (item.startTs != null && item.endTs != null) return fmtWindow(item.startTs, item.endTs, tz);
			return dataArrayTextOf(item.raw).trim();
		}
		function dataArrayExtrasFromEntriesOf(entries, main, now, opts) {
			const o = opts || {};
			const isEvent = o.kind === "event";
			const shown = DATA_ARRAY_LABEL(main && (main.show || main.title));
			// 先按"会不会出现在悬停里"过滤一遍（标题非空 + 活动侧的长期窗口过滤）。
			// ⚠️ 2026-11-07（P3b）：后面两步是**悬停逆解析的既有口径**，结构化条目也必须照做，否则
			//    "解析器直出的数组"与"从同一份悬停文本反解的数组"会不一致（真机两例：
			//    ddlezj「七、艾利亚斯边境」与「…（商店兑换时间）」归一后同名、umaCn 只有 1 条期间）：
			//    ① **不足 2 条 ⇒ 没有并列条目**（`hoverTextFromItems` 对 <2 条给空串，
			//       文本路径因此拿到 []）；② **归一后完全同名只留第一条**（`scheduleHoverItems` 的
			//       `normTitle` 判重：去掉 `（…）/(…)` 与空白 —— 探头上不会出现两行同名，数组也不该）。
			const eligible = (Array.isArray(entries) ? entries : [])
				.filter((x) => x && dataArrayTextOf(x.title || x.label))
				.filter((x) => !(isEvent && isLongTermEvent(x)));
			if (eligible.length < 2) return [];
			const normTitle = (s) => String(s || "").replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, "");
			const seen = new Set();
			const seenTitle = new Set();
			if (main) seen.add(dataArrayIdentityOf(main.title, main.startTs, main.endTs));
			const out = [];
			for (const x of eligible) {
				const title = dataArrayTextOf(x.title || x.label);
				const nt = normTitle(title);
				if (nt && seenTitle.has(nt)) continue;          // 归一后同名 ⇒ 只留第一条（与显示层同一判据）
				if (main) {
					if (title === main.title) continue;
					if (main.show && title === main.show) continue;
					const t = DATA_ARRAY_LABEL(title);
					if (shown && t && t !== shown) {
						const tail = t.lastIndexOf("\uFF1A" + shown);
						if (t.indexOf(shown + "\uFF1A") === 0 || (tail >= 0 && tail === t.length - shown.length - 1)) continue;
					}
				}
				// ⚠️ P5 清理（2026-11-08）：原来这里是 `dataArrayTextOf(x.win) || hoverWindowTextOf(x, o.tz)`
				//    —— `win` 分支只服务"把悬停文本拆成 `{ title, win }` 再进来"的回归 oracle，
				//    生产调用方一律给结构化条目（`startTs` / `endTs` / `raw`）。oracle 已固化成字面量，
				//    该分支随之删除（`{ title, win }` 形状不再被支持：`hoverWindowTextOf` 只读 ts/raw）。
				//
				// ⚠️ 2026-11-09（悬停档期改成「相对表述 ⇒ 原文」）：**数组这里仍用旧口径**（有 ts 就
				//    fmtWindow）。原因：`win` 不只是给数组的 `raw` 字段，它还要被 `dataArrayWindowOf`
				//    **反解析回 ts**（下面一行）—— 一旦换成含「维护后 / 版本更新后」的源站原文，
				//    数组条目的 ts 会整片变 null（实测 banGDream 活动 16 条全丢 ts，日程/展平/提醒跟着塌）。
				//    数组条目是**结构化事实**（ts 来自解析器），它的 raw 一直是"派生文本"而不是源站原文；
				//    用户可见的**悬停**才需要保留源站措辞。所以两者从这一轮起**有意分开**：
				//      · 悬停展示 = `hoverWindowTextOf`（26-parser-hover.js，原文优先）；
				//      · 数组派生 = `dataArrayWindowTextOf`（这里，保持 P3 等价性逐字不变）。
				const win = dataArrayWindowTextOf(x, o.tz);
				const w = dataArrayWindowOf(scheduleNoYear(win), now, o.tz);
				const identity = dataArrayIdentityOf(title, w.startTs, w.endTs);
				if (seen.has(identity)) continue;
				seen.add(identity);
				if (nt) seenTitle.add(nt);
				out.push({ title, show: title, startTs: w.startTs, endTs: w.endTs, tz: dataArrayTextOf(o.tz), raw: win, source: "hover" });
			}
			return out;
		}
		// ── 事实字段（category / tags / preview）────────────────────────────────────────────
		// `itemFacts` = 解析器给的 `{ "<条目标题>": { category?, tags? } }`（通道说明见 GACHA_FIELDS）。
		// 取不到就**不写这个键**（"留空"= 没有这个事实，不是空串）；绝不按标题去猜类别。
		function dataArrayFactsOf(rec) {
			const f = rec && rec.itemFacts;
			return f && typeof f === "object" && !Array.isArray(f) ? f : null;
		}
		// 预告稿标记：与 `ns_umamusume_official_umaCurrentWindows` 的 previewRank 同一判据
		// （30-game-cygames.js:392）。只有命中才写 `preview:true`（可选字段，false 不写）。
		const DATA_ARRAY_PREVIEW_RE = /予告|coming soon/i;
		function dataArrayIsPreview(title) {
			return DATA_ARRAY_PREVIEW_RE.test(dataArrayTextOf(title));
		}
		// 把事实贴到条目上（键顺序固定：category → tags → preview，与归一函数一致，往返才逐字相同）
		function dataArrayAttachFactsOf(item, facts) {
			const f = facts && typeof facts === "object" ? facts[item.title] : null;
			if (f && typeof f === "object" && !Array.isArray(f)) {
				if (typeof f.category === "string" && f.category) item.category = f.category;
				if (Array.isArray(f.tags)) {
					const tags = f.tags.map(dataArrayTextOf).filter(Boolean);
					if (tags.length) item.tags = tags;
				}
			}
			if (dataArrayIsPreview(item.title)) item.preview = true;
			return item;
		}
		// 卡池侧数组：主条目（banner / roles / bannerDates，`source:"primary"`）
		// 主条目（P3b 从已删的 `dataArrayGachaOf` **原样抽出**）：从记录里已定稿的字符串字段造第一条。
		// ⚠️ P3c（2026-11-07）：`dataArrayGachaOf` / `dataArrayEventsOf` / `dataArrayHoverPoolsOf`（从字符串
		//    字段合成整列数组的三个函数）已删 —— 28 款全部直出后它们再没有生产调用方。主条这两个构造函数
		//    **保留**：解析器直出路径（`dataArrayProduced*`）与回归 oracle 都用它，删了会变成两套"主条"。
		function dataArrayGachaMainOf(rec, id, tz, now) {
			const banner = dataArrayTextOf(rec && rec.banner);
			if (!banner) return null;   // 这一侧没有卡池数据（未公布 / 失败）⇒ 空数组，不硬造
			const roles = dataArrayTextOf(rec.roles);
			const w = dataArrayWindowOf(rec.bannerDates, now, tz);
			return {
				title: banner,
				// 外显口径与 81 的 scheduleNormalize 一致：有角色名就显示**去修饰**的角色名，否则池名
				show: cleanRoleNames(roles, id) || banner,
				roles: dataArrayRolesOf(roles),
				startTs: w.startTs,
				endTs: w.endTs,
				tz,
				raw: dataArrayTextOf(rec.bannerDatesRaw),
				source: "primary"
			};
		}
		// 活动侧主条目（event / eventShow / eventDates，带 phase，`source:"primary"`）—— 同上，保留。
		function dataArrayEventMainOf(rec, id, tz, now) {
			const event = dataArrayTextOf(rec && rec.event);
			if (!event) return null;
			const eventShow = dataArrayTextOf(rec.eventShow);
			const w = dataArrayWindowOf(rec.eventDates, now, tz);
			const main = {
				title: event,
				// 与 scheduleNormalize 一致：活动侧优先用**只给显示**的 `eventShow`，没有就退回活动名
				show: eventShow || event,
				startTs: w.startTs,
				endTs: w.endTs,
				tz,
				raw: dataArrayTextOf(rec.eventDatesRaw),
				source: "primary"
			};
			// 第二阶段（奖励领取/兑换截止）：独立窗口，不是第二个活动条目
			const claim = dataArrayTextOf(rec.eventClaimDates);
			if (claim) {
				const cw = dataArrayWindowOf(claim, now, tz);
				main.phase = {
					kind: "claim",
					startTs: cw.startTs,
					endTs: cw.endTs,
					show: eventShow || (event + " 兑换截止")
				};
			}
			return main;
		}
		// ── 归一（持久化白名单的数组分支用；engine-head.js 的 normalizeRecord 调它们）──
		// 只做**最少校验**：非对象丢弃、ts 必须是 number 否则 null、其余字符串字段缺了填空串。
		// `source` 与合成侧同口径（字符串，缺了空串）；`category` / `tags` / `preview` 是**可选事实** ——
		// 有就原样保留（顺序固定在 source 之后），没有就**不写这个键**（"留空"= 没有这个事实）。
		//
		// ⚠️ 向后兼容（2026-11-08，字段改名 category ← 旧名 `cat`）：本字段此前叫 `cat`（缩写，
		//    用户要求全仓改掉）。老的 lastData 里数组条目上可能还是那个旧键 ⇒ **读入时当
		//    `category` 的旧名接受**，写出只写 `category`（`out` 上永远不会出现旧键）。
		//    效果：老缓存不会丢掉类别事实，下一次写盘就自动迁到新名。旧键只在这一处出现 ——
		//    它是**源数据里已经存在的名字**（不是我们用的缩写），刻意保留成常量而不是写死两遍。
		const LEGACY_CATEGORY_KEY = "cat";
		function dataArrayOptionalFactsOf(raw, out) {
			const category = typeof raw.category === "string" && raw.category
				? raw.category
				: (typeof raw[LEGACY_CATEGORY_KEY] === "string" ? raw[LEGACY_CATEGORY_KEY] : "");
			if (category) out.category = category;
			if (Array.isArray(raw.tags)) {
				const tags = raw.tags.map(dataArrayTextOf).filter(Boolean);
				if (tags.length) out.tags = tags;
			}
			if (raw.preview === true) out.preview = true;
			return out;
		}
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
				raw: dataArrayTextOf(raw.raw),
				source: dataArrayTextOf(raw.source)
			};
			dataArrayOptionalFactsOf(raw, out);
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
				raw: dataArrayTextOf(raw.raw),
				source: dataArrayTextOf(raw.source)
			};
			dataArrayOptionalFactsOf(raw, out);
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
		// ── P3（2026-11-07）：解析器直出条目 → 记录数组条目 ───────────────────────────
		// 解析器不再"手拼字符串、等着数据层反解"，而是自己给出**条目事实**：
		//   `{ title, show, roles?, startTs, endTs, tz, raw, source, category?, tags?, preview?, phase? }`
		// 这里做**唯一一次**归一（复用持久化白名单那份 `dataArray*ItemOf`，键顺序因此天然与
		// getCached 往返一致），并按与合成路径**同一判据**补 `preview` 事实（标题命中 予告/coming soon）。
		// ⚠️ 时间戳口径（P4，2026-11-07）：解析器给的是**绝对时刻**，这里原样归一、**不重算**。
		//    从窗口文本反算 ts 的那几个入口（`dataArray*MainOf` / `dataArrayExtrasFromEntriesOf`）
		//    一律经 `dataArrayWindowOf(文本, now, tz)` 按条目 tz 解析源站墙钟 ⇒ 同一份数据在
		//    UTC 与 +08 的机器上得到同一个 ts（P1 的"本机时刻"临时口径已废）。
		function dataArrayProducedItemOf(raw, kind) {
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
			const src = Object.assign({}, raw);
			if (src.preview !== true && dataArrayIsPreview(dataArrayTextOf(src.title))) src.preview = true;
			return kind === "event" ? dataArrayEventItemOf(src) : dataArrayGachaItemOf(src);
		}
		// 排序 + 发 key（下标 = 自然顺序里的位置）。解析器直出的数组一律走这里，
		// 免得"排序/发 key"在两处各写一份。
		// ⚠️ 必须先摘掉条目上可能已有的 `key`：`dataArrayOrderedOf` 是 `Object.assign({ key }, x)`，
		//    带着一个空 `key` 的条目会把刚发好的 key **覆盖成空串**（解析器路径的条目已经过归一，
		//    `key` 恒存在 —— 所以这一摘是必需的，不是保险）。
		function dataArrayProducedListOf(list, prefix) {
			const clean = (Array.isArray(list) ? list : []).filter(Boolean).map((x) => {
				const out = Object.assign({}, x);
				delete out.key;
				return out;
			});
			return dataArrayOrderedOf(clean, prefix);
		}
		// ── P3b：解析器直出数组的**收口**（每款只写一句，不各写一套）────────────────────────
		// 入参 `payload` = 解析器**已经定稿的字符串字段**（banner/roles/bannerDates/bannerDatesRaw 或
		// event/eventShow/eventDates/eventDatesRaw/eventClaimDates）；`entries` = 悬停行对应的
		// **条目事实**（顺序 = 悬停行顺序，形状 `{ title|label, startTs, endTs, raw }`）。
		// 主条走 `dataArrayGachaMainOf` / `dataArrayEventMainOf`（与合成路径**同一个函数**），
		// 并列条走 `dataArrayExtrasFromEntriesOf`（与文本路径**同一条判据**）—— 所以
		// "解析器直出的数组"与"改造前从字符串合成"必然逐条相同，这由结构保证、不靠调用方记得。
		function dataArrayProducedGachaOf(payload, entries, meta, now) {
			const id = (meta && meta.id) || "";
			const tz = (meta && meta.tz) || "";
			const main = dataArrayGachaMainOf(payload, id, tz, now);
			if (!main) return [];
			const facts = dataArrayFactsOf(payload);
			const extras = dataArrayExtrasFromEntriesOf(entries, main, now, { kind: "gacha", tz });
			return dataArrayProducedListOf([main].concat(extras)
				.map((x) => dataArrayAttachFactsOf(x, facts))
				.map((x) => dataArrayProducedItemOf(x, "gacha")), id + ":gacha");
		}
		function dataArrayProducedEventsOf(payload, entries, meta, now) {
			const id = (meta && meta.id) || "";
			const tz = (meta && meta.tz) || "";
			const main = dataArrayEventMainOf(payload, id, tz, now);
			if (!main) return [];
			const facts = dataArrayFactsOf(payload);
			const extras = dataArrayExtrasFromEntriesOf(entries, main, now, { kind: "event", tz }).map((x) => ({
				title: x.title,
				show: x.show,
				startTs: x.startTs,
				endTs: x.endTs,
				tz: x.tz,
				raw: x.raw,
				source: x.source
			}));
			return dataArrayProducedListOf([main].concat(extras)
				.map((x) => dataArrayAttachFactsOf(x, facts))
				.map((x) => dataArrayProducedItemOf(x, "event")), id + ":event");
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
