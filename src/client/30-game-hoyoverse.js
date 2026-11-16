// src/client/30-game-hoyoverse.js —— 米哈游：原神 / 星穹铁道 / 绝区零 / 崩坏3 / 崩坏学园2 / 未定事件簿
//
// 职责（2026-11-16 按厂商重排）：米哈游全家桶的**条目 + 解析器 + 抓取器 + 登记**都在本文件；
//   每个 id 只在此注册一次（符号名沿用原 `ns_*`，一个都没改）。
// 组成：
//   · 本文件原有：genshin / hsr / zzz（官网公告 + 米游社/Bwiki 备选源）、bh3 条目本体（米游社备选源）；
//   · 并入 30-game-benghuai2.js：bh2（崩坏学园2 国服，官网公告 → 卡池 + 活动）；
//   · 并入 30-game-miyoushe-bbs.js：wd（未定事件簿，米游社公告 → 卡池 + 活动）；
//   · 并入 30-game-batch2.js 的 ① 段：bh3 卡池 / 活动默认源 = 米哈游内容中台（GACHA/EVENT_FETCHERS 接线；
//     条目本体仍在原处，米游社备选源保留）。
// 复用关系：只复用公共层（sourceInstant / fmtWindow / hoverTextFromItems / dataArrayProduced* / coversNow …）
//   与 21-fetcher-tables.js 的两张抓取器表；厂商内各款解析器互不共享（不跨文件 import）。
// 请求预算：原神 / 星铁 / 绝区零各 1~2 次/轮（列表 + 详情，按 id 缓存）；崩坏3 内容中台卡池 1 + 活动 1；
//   崩坏学园2 列表 1 + 详情（两侧同一条列表，轮内共享）；未定事件簿列表 1 + 详情（按 id 缓存）。

		// ── 解析器 / 抓取器 ──

		// 「版本更新后」这类**只有日期没有时分**的写法，默认按当日该时刻折算。
		// 为什么需要一个默认值：源站常见 `2026/09/28 4.6版本更新后`（日期 + 版本标签的混合体），
		// 日期是明确的，缺的只是时分；不补的话 startTs 会是 null，外显只能回落源站原文
		// （星铁活动列一度显示成 `2026/09/28 4.6版本更新后 ~ 11-10 15:00`，与其它游戏的
		// `09-28 04:00 ~ 11-10 15:00` 口径不一致）。
		// 取 04:00 是因为国内二游版本更新普遍落在凌晨维护窗口（该表内 04:00 出现最多），
		// 拿它当锚点比"不补"更接近真实，也不会让"活动是否已开始"的判定偏移一天。
		const VERSION_UPDATE_ANCHOR = { h: 4, mi: 0 };


		// ── 「X.Y版本更新后」的锚点（**唯一真源**，卡池侧 parseZzzFreq 与活动侧 parseZzzEventsOfficial 共用）──
		//
		// 版本起点 = 该版本**官方公告正文里写明的维护/更新时刻**：
		//   · 「X.Y版本…更新公告」正文：【更新开始时间】2026/09/09 06:00（UTC+8）预计5个小时完成
		//   · 「X.Y版本…预下载开启&更新通知」正文：【版本更新时间】2026/10/21 06:00 开始，预计需要5个小时
		//
		// ⚠️ 2026-10-21 修（用户报「绝区零卡池时间有问题」）：老实现直接拿公告的 `dtStartTime` 当版本起点，
		//    这是**字段选错** —— `dtStartTime` 是公告的**排期上线时间**，与维护/开服时刻没有固定关系：
		//      · 3.2 更新公告   dtStartTime = 2026-09-09 07:00（正文维护时刻 06:00，+1h）→ 碰巧接近
		//      · 3.3 预下载通知 dtStartTime = 2026-10-19 12:05（正文维护时刻 2026-10-21 06:00，−2 天）
		//    第二行就是老实现把「预下载」整类排除的原因；但排除之后 **3.3 一点锚点都没有**
		//    （3.3 正式更新公告要到开服后才发），于是当期频段 startTs=null、
		//    bannerDates 退回源站原文「3.3版本更新后 ~ 11-11 11:59」、无法判定"是否已开始"
		//    —— 这正是用户看到的 bug。
		//
		// 现在改为「正文里的官方时刻优先」；正文没有该标签时才退回 `dtStartTime`，
		// 且**只认更新公告**：预下载通知的 dtStartTime 永远不能当锚点（比维护早 1~2 天）。
		//
		// 客观限制（不硬编造）：官方只给"维护**开始**"时刻，真实开服还要加上维护时长
		// （本次写「预计需要5个小时」）。所以本锚点与真实开池时刻的差 ≈ 维护时长（约 5h），
		// 与既有 3.2 口径（公告排期 07:00）同量级，但来源是官方明文而非巧合。
		const ZZZ_UPDATE_INSTANT_RE = /【(?:更新开始时间|版本更新时间)】\s*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s+\d{1,2}:\d{2})/;
		function zzzVersionStarts(list, tz) {
			const out = {};
			for (const it of list) {
				const title = stripTags(it?.sTitle);
				const vm = title.match(/(\d+\.\d+)\s*版本/);
				if (!vm || !/更新(?:公告|通知)/.test(title)) continue;
				const ver = vm[1];
				const body = stripTags(it?.sIntro) + " " + stripTags(it?.sContent);
				const bm = body.match(ZZZ_UPDATE_INSTANT_RE);
				const bp = bm ? parseTime(bm[1], tz) : null;
				if (bp && bp.ts != null) { if (out[ver] == null) out[ver] = bp; continue; }
				if (/预下载|预约|前瞻|预抽/.test(title)) continue;   // 只有公告时间，绝不能当版本起点
				const p = parseTime(it.dtStartTime, tz);
				if (p.ts != null && out[ver] == null) out[ver] = p;
			}
			return out;
		}


		// 绝区零官网公告解析：从公告频道（iChanId=279）取「X.Y版本限时频段（上/下期）」，选覆盖当前时刻的一期。
		// 公告形如：sIntro="本期代理人与音擎调频活动时间为：3.2版本更新后 ~ 2026/09/30 11:59"，
		// sContent 内含「活动期间，限定S级代理人[克拉蕾(电·锋御)]、[南宫羽(以太·击破)]…」。
		// 起点为"版本更新后"时用 zzzVersionStarts 的锚点补全；「独家重映/音擎回响」自选段跳过。
		function parseZzzFreq(payload, now = nowMs(), tz) {
			const list = Array.isArray(payload?.data?.list) ? payload.data.list : [];
			const clean = (s) => stripTags(s);
			// 版本起点表（卡池/活动共用同一口径）；同时抽取「S级代理人[X] → 「Y」频段」对应表
			// （频段名只写在更新公告里，逐期频段公告不含频段名，故用它回填卡池标题）
			const verStart = zzzVersionStarts(list, tz);
			const poolOf = {};
			for (const it of list) {
				const text = clean(it.sIntro) + " " + clean(it.sContent);
				for (const m of text.matchAll(/S级代理人\s*[\[【]([^\]】]+)[\]】][^「]{0,40}?「([^」]{2,14})」频段/g)) {
					const name = m[1].replace(/[（(].*$/, "").trim();
					if (name && poolOf[name] == null) poolOf[name] = m[2].trim();
				}
			}
			// 角色名统一为「职业·属性」全角括号（与 Bwiki 显示一致）：克拉蕾(电·锋御) → 克拉蕾（锋御·电）
			const normRole = (name) => {
				const m = name.match(/^([^（()]+)[（(]([^）)]+)[）)]\s*$/);
				if (!m) return name;
				const bits = m[2].split("·");
				return bits.length === 2 ? `${m[1]}（${bits[1]}·${bits[0]}）` : `${m[1]}（${m[2]}）`;
			};
			const pools = [];
			for (const it of list) {
				const title = clean(it?.sTitle);
				const vm = title.match(/(\d+\.\d+)\s*版本限时频段\s*((?:（[上下]期）)?)/);
				if (!vm) continue;
				const ver = vm[1];
				const part = vm[2] || "";
				const text = clean(it.sIntro) + " " + clean(it.sContent);
				const re = /((?:\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s+\d{1,2}:\d{2})|(?:\d+\.\d+\s*版本更新后))\s*[~～]\s*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s+\d{1,2}:\d{2})/g;
				const marks = [];
				let m;
				while ((m = re.exec(text)) !== null) {
					marks.push({ start: m[1], end: m[2], from: m.index, to: m.index + m[0].length, after: /版本更新后/.test(m[1]) });
				}
				const created = parseTime(it.dtCreateTime, tz).ts ?? 0;
				for (let i = 0; i < marks.length; i++) {
					const seg = text.slice(marks[i].to, i + 1 < marks.length ? marks[i + 1].from : text.length);
					// 该时间窗对应的「限定S级代理人」句（排除独家重映/音擎回响的自选说明）
					const sentence = seg.split(/[。！；]/).find((s) => /限定S级代理人/.test(s) && !/重映|回响|可自选/.test(s));
					if (!sentence) continue;
					const roleM = sentence.match(/限定S级代理人\s*((?:[\[【][^\]】]+[\]】][、，,及和与\s]*)+)/);
					if (!roleM) continue;
					const roles = [...roleM[1].matchAll(/[\[【]([^\]】]+)[\]】]/g)].map((x) => normRole(x[1].trim())).join("、");
					if (!roles) continue;
					const sp = marks[i].after ? (verStart[ver] || { ts: null, text: null }) : parseTime(marks[i].start, tz);
					const ep = parseTime(marks[i].end, tz);
					if (ep.ts == null) continue;
					pools.push({
						ver, part, roles,
						startTs: sp.ts, endTs: ep.ts,
						startText: sp.text, endText: ep.text,
						raw: `${marks[i].after ? `${ver}版本更新后` : sp.text} ~ ${ep.text}`,
						created,
						isMain: true
					});
				}
			}
			if (pools.length === 0) return null;
			// ⚠️ 2026-11-09 用户拍板「起点未知 ≠ 已开始」：原来这里有一条
			// `loose = pools.filter((p) => p.startTs == null && p.endTs >= now)` 的宽松分支
			// （同版本更新公告没收录时把「X.Y版本更新后」的上半当成在期）。那条分支正是
			// "维护当天整段空白/假在期"的来源之一 —— 起点未知就不再冒充在期，**已删除**。
			// 现在的顺序：覆盖 now 的（两端都明确）→ 空档期取"下一个要开的" → 都没有 ⇒ null。
			const cover = pools.filter((p) => coversNow(p, now));
			// 空档期：上一期已收池、下一期还没开（官方在版本维护前就发了下一期频段公告）。
			// 2026-10-21 实测：3.2下半 10-20 14:59 收池、3.3上半 = 3.3版本更新后（10-21 06:00 维护）。
			// 此时若只认 cover 会返回 null → 面板在维护当天整段空白；
			// 而"下一期 + MM-DD HH:MM 开始"才是该显示的内容（UI 的 state="wait" 分支本就支持）。
			// 只按 startTs 升序取**最近的一期**：更远的期次（官方很少提前公布）不该顶掉下一期。
			const upcoming = pools
				.filter((p) => p.startTs != null && p.startTs > now && p.endTs >= now)
				.sort((a, b) => (a.startTs - b.startTs) || (a.endTs - b.endTs));
			const picked = cover.length > 0 ? cover.sort((a, b) => (b.created - a.created) || (a.endTs - b.endTs))
				: upcoming;
			if (picked.length === 0) return null;
			const first = picked[0];
			const same = picked.filter((p) => p.ver === first.ver && p.part === first.part);
			const roles = [...new Set(same.flatMap((p) => p.roles.split("、")).filter(Boolean))].join("、");
			// 卡池名：优先用更新公告里的「频段名」（当期名单命中的新代理人）；复刻期无名时退回版本期名称
			let poolName = "";
			for (const r of roles.split("、")) {
				const base = r.replace(/[（(].*$/, "").trim();
				if (base && poolOf[base]) { poolName = poolOf[base]; break; }
			}
			return {
				banner: poolName ? `「${poolName}」频段` : `${first.ver}版本限时频段${first.part}`,
				roles,
				bannerDates: first.startText && first.endText ? `${first.startText} ~ ${first.endText}` : first.raw,
				bannerDatesRaw: first.raw,
				startTs: first.startTs,
				endTs: first.endTs
			};
		}


		// 绝区零卡池默认抓取器：**只**读官网公告（api-takumi-static content_v2_user，iChanId=279）。
		//
		// ⚠️ 2026-11-07（用户要求，与全站 28 款游戏同一口径）：**摘掉自动兜底** ——
		//    官网接口失败 / 结构异常 ⇒ 抛错；结构正常但没有覆盖当前的「限时频段」⇒ 返回 null。
		//    **绝不再**转身去抓 Bwiki 往期调频：要看 Bwiki 口径请在设置里把卡池来源切到
		//    「Bwiki 往期调频」备选源（走 GACHA_FETCHERS["zzz-bwiki"]）。活动侧同理，只在用户选 Bwiki 备选源时才用。
		async function fetchZzzGacha(listUrl, signal, tz, now = nowMs()) {
			const payload = await proxyFetchJson(listUrl, "https://zzz.mihoyo.com/");
			// 结构变了必须抛错（不是"未公布"），否则接口改版会长期伪装成「新卡池未公布」
			if (!Array.isArray(payload?.data?.list)) throw new Error("zzz-official-no-section");
			// **同一份 payload 里活动数据也在**（该接口同时含频段公告与「活动说明」公告）→ 顺带返回活动字段。
			// 这是"统一来源注册表"里写明的复用契约：卡池载荷带 event 字段时，refresh 不再为活动侧
			// 另抓一次。绝区零两侧是**同一条 URL**（同一 iChanId=279），所以此前每轮会向它发 2 次请求：
			// 一次 parseZzzFreq 取频段、一次 parseZzzEventsOfficial 取活动 —— 纯重复（2026-10-01 实测）。
			// 活动侧**仍保留**自己的抓取器（fetchZzzEventsOfficial 与 `zzz-event-bwiki` 备选）：
			// 卡池侧失败、或用户在设置里单独选活动来源时，活动侧要能自己抓、自己报错（解耦不变）。
			const ev = parseZzzEventsOfficial(payload, now, tz, { emitArrays: true, id: "zzz" });
			const evFields = ev
				? {
					event: ev.event, eventDates: ev.eventDates || "", eventDatesRaw: ev.eventDatesRaw || "", eventHover: ev.eventHover || "",
					// P3b：活动侧直出的数组/条目通道**原样带出**（别在这里重算，否则又成两份来源）
					...(ev.events ? { events: ev.events, eventHoverItems: ev.eventHoverItems } : {})
				}
				: {};
			const d = parseZzzFreq(payload, now, tz);
			if (!d) return null;
			// ── P3b：卡池侧条目事实 → `gacha` 数组 ────────────────────────────────
			// 本期只有**一口**当期频段（同名同期的角色已合并进 `roles`）⇒ 悬停生成器给 ""（交回
			// UI 默认两行式），数组也只有主条 —— 与改造前的合成结果一致。
			const pools = [{ title: d.banner, startTs: d.startTs, endTs: d.endTs, raw: d.bannerDatesRaw }];
			const out = { ...d };
			out.gacha = dataArrayProducedGachaOf(out, pools, { id: "zzz", tz }, now);
			out.gachaHoverItems = pools;
			return { ...out, ...evFields };
		}


		// 绝区零：官方公告列表（api-takumi-static，与卡池侧同一接口，经 host 代理）→ 当期活动。
		// 活动时间就写在公告正文里（【活动时间】A ~ B），**不需要再抓详情页**；
		// A/B 可能是绝对时间，也可能是"X.Y版本更新后" / "X.Y版本结束"——用 zzzVersionStarts 的锚点折算
		// （与卡池侧同一口径；2026-10-21 起不再用公告的 dtStartTime 当版本起点，见该函数的注释）：
		//   版本起点 = 官方公告正文里的维护/更新时刻；版本结束 = 下一个已知版本起点 − 1 分钟。
		// 当前版本还没有下一版本公告 → 结束时间未知：这类活动**保留**（endTs=null），
		// 由 sortEventItems / pickEventPrimary 的既有规则自然沉到外显与悬停的最后，不跳过、不丢弃。
		const ZZZ_EVENT_WINDOW_RE = /((?:\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s+\d{1,2}:\d{2})|(?:\d+\.\d+\s*版本更新后))\s*[~～\-—]\s*((?:\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s+\d{1,2}:\d{2})|(?:\d+\.\d+\s*版本结束))/g;


		function parseZzzEventsOfficial(payload, now = nowMs(), tz, opts) {
			const list = Array.isArray(payload?.data?.list) ? payload.data.list : [];
			const clean = (s) => stripTags(s);
			// 版本起点表：与卡池侧共用 zzzVersionStarts（它已处理「预下载」与「排期上线时间 ≠ 维护时刻」两个坑）。
			const verStart = zzzVersionStarts(list, tz);
			const startTsOf = (v) => (verStart[v] ? verStart[v].ts : null);
			const versions = Object.keys(verStart).sort((a, b) => startTsOf(a) - startTsOf(b));
			// 折算一个窗口的两个端点；返回 null 表示**窗口此刻不成立**（含"该版本还没开始/无法判定"）。
			// 规则：绝对时间直接用；"X.Y版本更新后"要求该版本已开始（版本更新公告已发布）；
			//      "X.Y版本结束" = 下一个已知版本起点 − 1 分钟；若 X.Y 已是最新版本 → 结束时间未知（endTs=null，
			//      仍算成立：活动在跑，只是没有绝对结束日）→ 由排序规则沉底，不跳过、不丢弃。
			const windowAt = (startText, endText) => {
				let startTs = null;
				const sv = startText.match(/(\d+\.\d+)\s*版本更新后/);
				if (sv) {
					if (startTsOf(sv[1]) == null) return null;   // 该版本尚未开始 → 活动还没上线
					startTs = startTsOf(sv[1]);
				} else {
					const p = parseTime(startText, tz);
					if (p.ts == null) return null;
					startTs = p.ts;
				}
				if (startTs > now) return null;
				let endTs = null;
				const ev = endText.match(/(\d+\.\d+)\s*版本结束/);
				if (ev) {
					if (startTsOf(ev[1]) == null) return null;   // 版本未知 → 无法判定，保守略过
					const later = versions.find((v) => startTsOf(v) > startTsOf(ev[1]));
					if (later != null) endTs = startTsOf(later) - 60000;
				} else {
					const p = parseTime(endText, tz);
					if (p.ts == null) return null;
					endTs = p.ts;
				}
				if (endTs != null && endTs < now) return null;
				return { startTs, endTs };
			};
			// 标题筛选用「活动说明」：正文里带活动时间的都是这类；商城/城募/剧情/频段公告不在此列
			const byName = new Map();
			for (const it of list) {
				const title = clean(it?.sTitle);
				if (!/活动说明/.test(title)) continue;
				const name = (title.match(/^「([^」]+)」/) || [])[1] || title.replace(/活动说明$/, "").trim();
				if (!name || byName.has(name)) continue;
				const text = clean(it.sIntro) + " " + clean(it.sContent);
				for (const m of text.matchAll(ZZZ_EVENT_WINDOW_RE)) {
					const w = windowAt(m[1], m[2]);
					if (!w) continue;                                  // 这个窗口此刻不成立 → 看下一个窗口
					byName.set(name, { banner: name, name, category: "", ...w, raw: `${m[1]} ~ ${m[2]}` });
					break;                                             // 一篇公告只取第一个成立的窗口
				}
			}
			const active = sortEventItems([...byName.values()]);
			if (active.length === 0) return null;
			const primary = pickEventPrimary(active) || active[0];
			const dates = primary.startTs != null && primary.endTs != null ? fmtWindow(primary.startTs, primary.endTs, tz) : (primary.raw || "");
			// ── P3b（2026-11-07）：条目事实 → 悬停 + `events` 数组 ────────────────
			// 顺序 = `sortEventItems`（生成器**不排序**）；只有 1 条时生成器给 ""，由 UI 退回单条展示。
			const hoverItems = active.map((x) => ({ title: x.name || x.banner, startTs: x.startTs, endTs: x.endTs, raw: x.raw }));
			const out = {
				event: primary.name,
				eventDates: dates,
				eventDatesRaw: primary.raw || "",
				eventHover: hoverTextFromItems(hoverItems, "event", tz)
			};
			if (opts && opts.emitArrays) {
				out.events = dataArrayProducedEventsOf(out, hoverItems, { id: opts.id || "zzz", tz }, now);
				out.eventHoverItems = hoverItems;
			}
			return out;
		}


		async function fetchZzzEventsOfficial(listUrl, signal, tz) {
			const payload = await proxyFetchJson(listUrl, "https://zzz.mihoyo.com/");
			return parseZzzEventsOfficial(payload, nowMs(), tz, { emitArrays: true, id: "zzz" });
		}


		// 原神 SMW 活动查询（经 origin=* 直连）
		// 返回 EVENT_FETCHERS 契约格式 {event, eventDates, eventDatesRaw}（parseSmwActivity 产出卡池格式，这里转换）
		// P3（2026-11-07）：parseSmwActivity 直出 `events` 数组 + 条目事实，这里**原样带出**（别在这里重算，
		// 否则数组与悬停又成了两份来源）。
		async function fetchYsActivity(signal, tz) {
			const nowYear = new Date(nowMs()).getFullYear();   // 走注入时钟（core 不得直接读宿主时钟）
			const q = "[[\u5206\u7C7B:\u6D3B\u52A8]][[\u7ED3\u675F\u65F6\u95F4::>" + nowYear + "/01/01]]|?\u540D\u79F0|?\u5F00\u59CB\u65F6\u95F4|?\u7ED3\u675F\u65F6\u95F4|?\u7C7B\u578B|sort=\u5F00\u59CB\u65F6\u95F4|order=desc|limit=60";
			const apiUrl = "https://wiki.biligame.com/ys/api.php?action=ask&query=" + encodeURIComponent(q) + "&format=json&origin=*";
			const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
			if (!res.ok) throw new Error("http-" + res.status);
			const json = await res.json();
			const d = parseSmwActivity(json, tz, { emitArrays: true, id: "genshin" });
			if (!d) return null;
			return {
				event: d.banner,
				eventDates: d.bannerDates || "",
				eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "",
				eventHover: d.eventHover || "",
				...(d.events ? { events: d.events, eventHoverItems: d.eventHoverItems } : {})
			};
		}

		const ZZZ_NEWS_LIST_URL = "https://api-takumi-static.mihoyo.com/content_v2_user/app/706fd13a87294881/getContentList?iChanId=279&iPageSize=50&iPage=1&sLangKey=zh-cn";


		const ZZZ_BWIKI_URL = "https://wiki.biligame.com/zzz/api.php?action=parse&page=%E5%BE%80%E6%9C%9F%E8%B0%83%E9%A2%91&prop=text&format=json&formatversion=2";


		// ── 星铁：卡池改**官方公告 CMS**（2026-11-09 用户拍板；bwiki「历史跃迁」降为备选）────────
		//
		// 为什么换：bwiki 的「历史跃迁」表里，**版本内上下半的起点常只写「4.6版本更新后」**（没有日期），
		// 于是起点未知；官方公告里同一期是带日期的窗口（`跃迁时间为 2026/09/28 4.6版本更新后 - 2026/11/10 15:00`），
		// 并且 5★ / 4★ / 光锥 / 卡池名 / 返场标记都写在同一段正文里。
		//
		// 端点（2026-11-09 实测 200 / `ACAO:*` / host 已在 `PROXY_ALLOW_HOSTS`）：
		//   GET content_v2_user/app/1963de8dc19e461c/getContentList?iChanId=257&iPageSize=200&iPage=1&sLangKey=zh-cn
		//   一页 200 条里既有「X.Y版本活动跃迁（其一/其二）」也有「X.Y版本更新维护预告」；
		//   **正文（sContent）在列表里就给了** ⇒ 不需要逐条详情（一次刷新 1 个请求）。
		//
		// ⚠️ 正文会**累积**：后一期公告会把前一期窗口再抄一遍（4.6其二 把 4.6其一 的「真珠」窗口
		//    原样又写了一次）⇒ 必须**收集全部窗口**再按 (角色, 起点, 终点) 判重，**不能取第一条公告就完事**。
		// ⚠️ 条目识别**只看正文特征**（出现「跃迁时间为」），不靠标题白名单：标题格式会变，
		//    而「Fate[UBW] 联动跃迁说明」这种没有该句式的公告也就不会被误收（它的窗口是"12:00 后长期开放"）。
		//
		// 起点三态交给 `anchorStartOf`（星铁锚点 = 该日 **10:00**，见 23-parser-time.js）；
		// 「只有版本标签」⇒ `startTs = null` ⇒ **不参与在期判定**（只在悬停里列出）。
		const HSR_CMS_LIST_URL = "https://api-takumi-static.mihoyo.com/content_v2_user/app/1963de8dc19e461c/getContentList?iPage=1&iPageSize=200&sLangKey=zh-cn&isPreview=0&iChanId=257";


		// 旧默认源（2026-11-09 起降为 `altSources` 的备选，抓取器键 `hsr-bwiki`）
		const HSR_BWIKI_URL = "https://wiki.biligame.com/sr/api.php?action=parse&page=%E5%8E%86%E5%8F%B2%E8%B7%83%E8%BF%81&prop=text&format=json&formatversion=2";


		// 「X.Y版本更新后」的钟点锚（用户拍板）：版本更新 06:00 开始、预计 5 小时 ⇒ 开服 10:00（+08）。
		const HSR_UPDATE_ANCHOR_HOUR = 10;


		// 一条「跃迁时间为 <起点> - <终点>」：**终点只认绝对时刻**（源站从不写"版本结束"），
		// 起点三态交给 anchorStartOf。`[^，。；]` 让起点不越过句读（这一句在正文里很长）。
		const HSR_WARP_TIME_RE = /跃迁时间为\s*([^，。；]{2,40}?)\s*[-~～—–]\s*(\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2})/g;


		// 该句里的 5★ 角色（「限定5星角色「真珠（欢愉•冰）」…」）
		const HSR_WARP_ROLE_RE = /限定5星角色\s*「([^」]{1,30})」/g;


		// 卡池名 ↔ 角色（只写在 ▌ 段的 ● 行里）：
		//   ● 「沧海萃珠」角色活动跃迁期间，限定5星角色「真珠（欢愉•冰）」，4星角色「青雀」…
		const HSR_WARP_POOL_RE = /「([^」]{1,24})」角色活动跃迁期间[，,]?\s*限定5星角色\s*「([^」]{1,30})」/g;


		// 标题里的版本 + 上下半（`4.6版本活动跃迁（其二）` → ver=4.6 / part=二）；卡池名取不到时当兜底名。
		const HSR_WARP_TITLE_RE = /(\d+\.\d+)\s*版本活动跃迁\s*(?:[（(]\s*其([一二三四五六七八九十]{1,3})\s*[）)])?/;


		const HSR_ROLE_BASE = (role) => String(role || "").replace(/[（(][^）)]*[）)]/g, "").trim();


		// 公告列表 → 全部「跃迁窗口」事实（**跨公告**收集；同一 (角色, 起点, 终点) 只留一条）。
		// 输出条目形状：`{ ver, part, role, base, pool, startTs, endTs, startText, endText, raw, annTitle }`
		// `startTs == null` = 起点只有版本标签（未知），调用方不得把它当"已开始"。
		function hsrWarpWindowsOf(list, tz) {
			const texts = [];
			for (const it of Array.isArray(list) ? list : []) {
				texts.push({
					title: stripTags(it && it.sTitle),
					text: `${stripTags(it && it.sIntro)}，${stripTags(it && it.sContent)}`
				});
			}
			// ① 先把「角色 → 卡池名」攒起来（同一角色只认第一次出现的名字）
			const poolOf = {};
			for (const t of texts) {
				HSR_WARP_POOL_RE.lastIndex = 0;
				let pm;
				while ((pm = HSR_WARP_POOL_RE.exec(t.text)) !== null) {
					const pool = pm[1].trim(), base = HSR_ROLE_BASE(pm[2]);
					if (pool && base && poolOf[base] == null) poolOf[base] = pool;
				}
			}
			// ② 再逐公告抽窗口（只认带「跃迁时间为」正文的公告）
			const out = [], seen = new Set();
			for (const t of texts) {
				if (!/跃迁时间为/.test(t.text)) continue;
				const tm = t.title.match(HSR_WARP_TITLE_RE);
				const ver = tm ? tm[1] : "";
				const part = tm && tm[2] ? tm[2] : "";
				HSR_WARP_TIME_RE.lastIndex = 0;
				let m;
				while ((m = HSR_WARP_TIME_RE.exec(t.text)) !== null) {
					const endP = parseTime(m[2], tz);
					if (endP.ts == null) continue;
					// 5★ 角色写在**同一句**里（句读 = 。/；）。取离窗口最近的那一个（最后一个）。
					const before = t.text.slice(0, m.index);
					const cut = Math.max(before.lastIndexOf("。"), before.lastIndexOf("；"));
					const roleAll = [...before.slice(cut + 1).matchAll(HSR_WARP_ROLE_RE)];
					const role = roleAll.length ? roleAll[roleAll.length - 1][1].trim() : "";
					const base = HSR_ROLE_BASE(role);
					if (!base) continue;
					const startText = m[1].trim();
					const startTs = anchorStartOf(startText, HSR_UPDATE_ANCHOR_HOUR, tz);
					const key = `${base}|${startTs == null ? "" : startTs}|${endP.ts}`;
					if (seen.has(key)) continue;
					seen.add(key);
					out.push({
						ver, part, role, base,
						pool: poolOf[base] || "",
						startTs, endTs: endP.ts,
						startText, endText: endP.text,
						// 源站原文（两端 token 逐字；分隔符统一成 `~`，与全仓悬停/数组同一写法）
						raw: `${startText} ~ ${m[2].replace(/\s+/g, " ")}`,
						annTitle: t.title
					});
				}
			}
			return out;
		}


		// 星铁官方公告 → 卡池载荷（契约同 zzz：`{ banner, roles, bannerDates, bannerDatesRaw, … }` + P1~P3 直出数组）。
		// 选法（逐条对应需求）：
		//   ① 覆盖 now 的窗口**全部**合并角色（正文会累积，同一角色判重）；
		//   ② 一条都不覆盖 now ⇒ 取"下一个要开的"那一批（同一 startTs 的窗口 = 同一批）当预告；
		//   ③ 连未来窗口都没有 ⇒ 只剩起点未知的行（`X.Y版本更新后`）⇒ 如实列出、**不算已开始**；
		//   ④ 什么都没有 ⇒ null（未公布，不硬凑）。
		// 悬停 / 数组 = 全部"终点未过"的窗口（含未来与起点未知），按结束时间升序 —— 事实不丢。
		function parseHsrWarp(payload, now, tz) {
			const list = payload && payload.data && payload.data.list;
			// 结构变了必须抛错（不是"未公布"），否则接口改版会长期伪装成「新卡池未公布」
			if (!Array.isArray(list)) throw new Error("hsr-official-no-section");
			const at = typeof now === "number" && Number.isFinite(now) ? now : nowMs();
			const wins = hsrWarpWindowsOf(list, tz);
			if (wins.length === 0) return null;
			const live = wins.filter((w) => coversNow(w, at));
			const future = wins.filter((w) => w.startTs != null && w.startTs > at && w.endTs >= at);
			const open = wins.filter((w) => w.startTs == null && w.endTs >= at);
			let picked = live;
			if (picked.length === 0 && future.length) {
				// 下一个要开的：只取起点最早的那一批（更远的期次不该顶掉它；与 zzz 同口径）
				const nextStart = future.reduce((acc, w) => (w.startTs < acc ? w.startTs : acc), Infinity);
				picked = future.filter((w) => w.startTs === nextStart);
			}
			if (picked.length === 0) picked = open;
			if (picked.length === 0) return null;
			const startKey = (w) => (w.startTs == null ? Infinity : w.startTs);
			const rows = picked.slice().sort((a, b) => (startKey(a) - startKey(b)) || (a.endTs - b.endTs));
			const main = rows[0];
			// 角色合并（按去属性名判重，保留源站写法；限定/返场不区分——都只是"这一批的 5★"）
			const roles = [], seenRole = new Set();
			for (const w of rows) {
				if (seenRole.has(w.base)) continue;
				seenRole.add(w.base);
				roles.push(w.role);
			}
			const banner = main.pool
				? `「${main.pool}」角色活动跃迁`
				: (main.ver ? `${main.ver}版本活动跃迁${main.part ? `（其${main.part}）` : ""}` : main.role);
			// 起点未知 ⇒ 档期文本写源站原文的起点（`4.7版本更新后`），不编造时刻
			const startOut = main.startTs != null ? fmtMdHm(main.startTs, tz) : main.startText;
			const out = {
				banner,
				roles: roles.join("\u3001"),
				bannerDates: `${startOut} ~ ${main.endText}`,
				bannerDatesRaw: main.raw,
				startTs: main.startTs,
				endTs: main.endTs
			};
			const hoverItems = wins
				.filter((w) => w.endTs >= at)
				.sort((a, b) => (a.endTs - b.endTs) || (startKey(a) - startKey(b)))
				.map((w) => {
					const label = `${w.pool ? `「${w.pool}」角色活动跃迁` : (w.annTitle || "活动跃迁")}：${w.role}`;
					return { title: label, label, startTs: w.startTs, endTs: w.endTs, raw: w.raw };
				});
			const hover = hoverTextFromItems(hoverItems, "gacha", tz);
			if (hover) out.bannerHover = hover;
			out.gacha = dataArrayProducedGachaOf(out, hoverItems, { id: "hsr", tz }, at);
			out.gachaHoverItems = hoverItems;
			return out;
		}


		// 星铁官方公告列表抓取器（契约：async (url, signal, tz, now) → 载荷 | null）
		// ⚠️ 不自动回退 bwiki（全站口径：默认源失败 = 失败）。要看 bwiki 请在设置里把卡池来源切到
		//    「Bwiki 历史跃迁」备选源（`GACHA_FETCHERS["hsr-bwiki"]`）。
		async function fetchHsrGacha(url, signal, tz, now = nowMs()) {
			const payload = await proxyFetchJson(url || HSR_CMS_LIST_URL, "https://sr.mihoyo.com/");
			return parseHsrWarp(payload, now, tz || "Asia/Shanghai");
		}


		// ══ 以下为原 42-parsers-miyoushe.js 的内容（原样保留；压平后见 30-game-hoyoverse.js）══
// 原 src/client/35-parsers-miyoushe.js（压平后见 30-game-hoyoverse.js）
//
// 由 next-sources/parsers/miyoushe.js 压平而来（2026-10-03「不留 next-source」）。
// 模块级标识符仍带 ns_miyoushe__ 前缀 —— 17 个解析器之间有 28 处同名（如 plain / ENT_EXTRA / decodeExtra），
// 压平后同处一个作用域，靠前缀隔离；**改名会伤及大量调用点，故保留**。

// 原 src/client/35-parsers-miyoushe.js（压平后见 30-game-hoyoverse.js） —— 米哈游系官方公告（米游社 BBS API）
//
// 覆盖 4 个游戏（gids 实测四个都 200 且返回对应游戏的正确公告）：
//   1 = 崩坏3 / 2 = 原神 / 6 = 崩坏：星穹铁道 / 8 = 绝区零
//
// 契约：async (url, signal, tz, now = nowMs()) → 数据对象 | null
//   卡池侧 { banner, roles?, bannerDates, bannerDatesRaw?, startTs?, endTs?, bannerHover? }
//   活动侧 { event, eventDates, eventDatesRaw?, eventHover? }
//   ⚠️ **now 必须是第 4 个参数**。本仓库历史 bug：now 收到 tz 字符串 → `startTs <= now` 恒假
//      → 静默显示"未公布"。本文件全部命中判定都用传入的 now，不读全局时钟。
//   ⚠️ 这是**官方补充源**，与既有 bwiki 条目（`genshin` / `hsr` / `zzz`）**并存**，
//      所以 id 加 `-official` 后缀、不撞车。
//
// ══════════════════════════════════════════════════════════════════════════════
// 一、端点与实测形态（夹具 2026-10-02 抓，见 fixtures/p4-*）
// ══════════════════════════════════════════════════════════════════════════════
//  列表  GET /painter/wapi/getNewsList?gids=<gid>&type=<1|2|3>&page_size=20
//        type=1 公告/补给、type=2 活动、type=3 资讯
//        → { retcode:0, message:"OK", data:{ list:[ { post:{ post_id, subject,
//            created_at(epoch 秒), images[], content:"", summary:"", structured_content:"" },
//            news_meta:null, text_summary:"", brief_structured_content:"" }, … ],
//            last_id, is_last } }
//  详情  GET /post/wapi/getPostFull?post_id=<post_id>
//        → { retcode:0, data:{ post:{ post:{ post_id, subject, created_at, content(HTML) } } } }
//
//  ⚠️ `post_id` 在 JSON 里是**字符串**（"78549971"），不能用 `===` 跟数字比。
//  ⚠️ `created_at` 是 **epoch 秒**（不是毫秒），且是**绝对时刻**（可直接用，不必按 tz 解释）。
//
//  ⚠️⚠️ **列表里没有"档期文本"字段**：实测各游戏的 **type=1（公告/补给）** 列表里，
//      `post.content` / `post.summary` / `post.structured_content` / `post.meta_content` /
//      `text_summary` / `brief_structured_content` 全为空，`news_meta` 恒为 **null**
//      （夹具 p4-{bh3,genshin,hsr,zzz}-news：0/20 条 post.content，news_meta 全 null）。
//      → **卡池侧必须再抓详情正文**才能拿到档期。这是本解析器"抓列表 → 抓详情 → 从正文抽档期"
//        两步形态的原因（与 `30-game-bandori.js` 的 OurNotes 侧同形）。
//
//  ✅ **但 type=2（活动）列表有一层被低估的显式字段**（实测发现，任务书原话"该 API 没有显式
//      档期字段"**只对 type=1 成立**）：每条的 `news_meta` 都带
//         { activity_status: 1|2|3, start_at_sec: "…", end_at_sec: "…" }   （**epoch 秒的字符串**）
//      20/20 条齐全（夹具 p4-{bh3,genshin,hsr,zzz}-events）。`activity_status` 与"是否已结束"相关
//      （实测 bh3：进行中的两条=1，其余历史条目=3）。
//      ⚠️ 但它的**结束时刻口径各游戏不一致**，所以**没有**拿它当外显：
//        · 崩坏3  `09-28 12:00 ~ 10-07 23:59` = 正文「9.28 12:00~10.7 23:59」**完全一致**
//        · 星铁   `09-28 18:44 ~ 10-13 00:00` ≈ 正文「9月28日 - 10月12日 23:59」+1 分钟（= 参与截止）
//        · 原神   `10-02 12:00 ~ 11-10 20:00` ← 正文写「10月2日-10月31日23:59」、**开奖时间 11月10日**
//                  → 这里的 end 是**开奖时刻**，不是参与截止（口径不同）
//      结论：外显仍取**公告正文**（玩家看到的活动时间就是正文那句），
//      `news_meta` 只作**兜底**：当正文一个可解析窗口都抽不到时，用它的显式档期顶上，
//      并在 `eventDatesRaw` / `bannerDatesRaw` 里标明来源是 news_meta（不冒充正文）。
//      ⚠️ 这句来源说明**只进 raw 字段**（既有约定：本体也有条目这么做）；**悬停里不写**（见 §五）。
//
//  ⚠️ **详情端点有 Referer 门（实测）**：不带 Referer 一律 `HTTP 403 / body "Forbidden"`：
//        · 桌面 UA + 无 Referer                     → 403
//        · 桌面 UA + Referer: www.miyoushe.com      → 200
//        · 桌面 UA + Referer: bbs-api.miyoushe.com（宿主代理的默认值） → 200
//        · 只有 Origin、没有 Referer                 → 403   ← 门是 Referer，不是 UA
//      → 本文件显式传 `referer: https://www.miyoushe.com/`；**列表**端点不需要 Referer（200）。
//
//  🚨 生产环境前置条件（**Lead 集成时必须处理，本文件不越界改 src/**）：
//      `src/index.js` 的 `PROXY_ALLOW_HOSTS` **当前不含 `bbs-api.miyoushe.com`**
//      （白名单里只有同门的 `api-takumi-static.mihoyo.com`）。本目录新源一律 `mode="proxy"`，
//      所以离线夹具测试能全绿，但**真机上会拿到 `{error:"host not allowed"}`**。
//      → 需 Lead 在 `PROXY_ALLOW_HOSTS` 里加 `"bbs-api.miyoushe.com"`（一行，属插件本体改动）。
//
// ══════════════════════════════════════════════════════════════════════════════
// 二、时区 = Asia/Shanghai（UTC+8）—— **推测**
// ══════════════════════════════════════════════════════════════════════════════
//  正文里的时刻（`2026-09-30 12:00`、`9.28 12:00`）都是**国服墙钟原文**，源站**没有**标注时区。
//  按国服惯例取 UTC+8。可佐证的旁证（非硬证据）：
//    · 绝区零 3.2 限时频段 `2026-09-30 12:00 ~ 2026-10-20 14:59` —— 12:00 开池 / 14:59 收池，
//      是国服"中午开、下午收"的典型口径（与 bwiki 各源一致）；
//    · 官方公告的发布时刻 `created_at` 落在 UTC+8 的整点/半点（10:00、04:00、12:00 等），
//      而按 UTC+9 渲染会变成 11:00、05:00、13:00（不整）。
//  → 因此本文件把 `tz` 默认写成 `Asia/Shanghai`，并在**注释**里如实标"推测"
//    （⚠️ 悬停里**不写**时区说明 —— 用户 2026-10-03：「元信息彻底删掉」，见 §五）。
//
// ══════════════════════════════════════════════════════════════════════════════
// 三、正文档期抽取（**实测的格式清单**，全部来自 p4-*-detail-* 夹具）
// ══════════════════════════════════════════════════════════════════════════════
//   ✅ 能抽到：
//     · `9.28 12:00~10.7 23:59`                       崩坏3 有奖活动（**无年份**，取公告年）
//     · `2026-09-30 12:00 ~ 2026-10-20 14:59`         绝区零 3.2 限时频段
//     · `参与时间：即日起 - 2026年10月18日 23:59`      绝区零 有奖活动（起点"即日起"）
//     · `2026年10月2日-2026年10月31日23:59`           原神 有奖活动（分隔符是**紧贴的 `-`**）
//     · `2026年9月28日 - 2026年10月12日 23:59`        星铁 有奖活动
//     · `2026/09/28 4.6版本更新后 - 2026/11/10 15:00`  星铁 活动跃迁（起点是**版本锚点**）
//     · `整体活动时间：2026/09/30 10:00 ~ 2026/11/03 03:59` 原神 type=1 活动说明
//   ❌ **抽不到（正文里根本没有日期，时间画在配图里）→ 本侧如实返回 null**：
//     · 崩坏3 补给（`p4-bh3-detail-gacha` / `-char`）：正文只有 `>>开放等级`、
//       `>>补给信息`（**一张图**）、`>>补给规则`（`每10次装备补给必定获得4★武器或圣痕`）
//       → 全文 0 个日期。**绝不拿 `created_at` 当档期、绝不硬凑**。
//     · 原神 祈愿（`p4-genshin-detail-wish` / `-wish2`）：正文只有 `〓祈愿介绍〓`，
//       全程写"活动期间"却**不给日期**，全文 0 个日期。
//
//  抽取策略（令牌化 + 配对，而不是一条大正则）：
//    ① 扫令牌：ABS(YYYY-MM-DD/./年 的完整日期[+HH:MM])、VER(`X.Y版本更新后`/`X.Y版本结束`)、
//       BARE(无年份 `M.D HH:MM`)、OPEN(`即日起`)；
//    ② 相邻两令牌之间只允许"连接符"`~ ～ 〜 〰 - – — － 至 到`（可带空白）→ 配对成窗口；
//       紧贴的 `YYYY/MM/DD` + `X.Y版本更新后`（中间只有空白）视作**同一个起点**；
//    ③ 缺时刻：起点按 00:00、终点按 23:59；
//    ④ 无年份 `M.D` 的年份取**公告发布年**（按 tz 渲染）；终点月日早于起点 → 终点进一年；
//    ⑤ `即日起` → 起点取公告 `created_at`（并标 `inferred`）；`X.Y版本更新后` → 起点取
//       **同列表里 `X.Y版本更新说明` 的发布时刻**（版本锚点，标 `inferred`）；
//       锚点找不到才退回正文里的字面日期 00:00；
//    ⑥ `endTs > startTs` 才产出；按**时间区间**去重（保留 raw 更全的那条）；**文档顺序**保留。
//  选当期：候选公告按 `created_at` **倒序**，逐篇抓详情，取**第一条覆盖 now 的窗口**；
//          没有覆盖 now 的窗口 → 返回 `null`（未公布），**不退回过期档期**。
//
//  候选筛选（标题关键词分流，见 ns_miyoushe_classifyMiyousheTitle）：
//    · 卡池侧 补给/祈愿/跃迁/频段/调频/招募…
//    · 活动侧 活动/征集/赛事/签到/有奖/话题…
//    同一标题同时命中两边时**卡池关键词优先**（实例：`4.6版本活动跃迁（其一）` 是卡池公告，
//    虽然字面含"活动"）。命不中的（版本更新说明、封禁名单、商城上新…）直接跳过。
//
//  成本：列表 1 次请求 + **最多 ns_miyoushe_MIYOUSHE_MAX_DETAILS 篇正文**（顺序、间隔 ns_miyoushe_MIYOUSHE_DETAIL_DELAY_MS，
//        对 WAF 友好）；候选已按时间倒序，覆盖 now 的窗口一旦出现即被采用。
//
// ══════════════════════════════════════════════════════════════════════════════
// 四、失败口径（"只有结构性损坏才 throw"）
// ══════════════════════════════════════════════════════════════════════════════
//   · HTTP 非 2xx / 响应不是 JSON / `retcode !== 0`          → **throw**（该侧算抓取失败）
//   · 列表为空（实测 `gids=99999` → `retcode:0, list:[]`）    → 返回 null（未公布）
//   · 单篇详情 `retcode 1101/1102`（"post not exist"，实测）  → **跳过该篇**（不算失败）
//   · 单篇详情 HTTP 404/410                                   → 跳过该篇
//   · 全部候选都失败且出现过**硬错**（403/567/坏 JSON…）      → **throw**（别把封禁静默成"未公布"）
//     （实测详情缺 Referer 就是 403 "Forbidden" —— 这种必须能被看见）
//
// ══════════════════════════════════════════════════════════════════════════════
// 五、悬停排版（用户 2026-10-03：「元信息彻底删掉」）
// ══════════════════════════════════════════════════════════════════════════════
//  排版**不再本地实现**，一律调 `lib/env.js` 的 `hoverPool` / `hoverEvent`（压平后见 28-parser-hover-tools.js）
//  （与本体 `buildPoolHover` / `buildEventHover` 逐字一致），本文件只负责：
//    · 卡池侧：每池一项 `{ name: 公告标题, label: 「池名：角色」, startTs, endTs }` → hoverPool
//      （角色名空 → label 退化成池名；与本体 `banner：roles` 同构）
//    · 活动侧：每条 `{ name: 公告标题, startTs, endTs }`，**先按结束时间升序排好**再传给 hoverEvent
//      （`hoverEvent` 自己不排序，与本体一致）
//    · 当期**不足 2 项**时两个工具返回 `""` → **不设** `bannerHover` / `eventHover` 字段，
//      让 UI 走默认两行式（卡池 `池名：角色` ⏎ 档期；活动 `名称` ⏎ 档期）
//
//  🚫 以下信息**一律不进悬停文本**（只留在本文件的代码注释里）：
//     · 来源站名 / 域名 / URL / API 名（米游社官方公告、bbs-api.miyoushe.com、getNewsList…）
//     · 时区推定说明（"国服墙钟按 UTC+8 换算 —— 源站未标注时区＝推测"）
//     · 抓取统计（"本轮有 N 篇公告正文抓取失败"）
//     · 内部 id / 源站字段名（post_id、start_at_sec、end_at_sec、activity_status、news_meta…）
//     · 游戏名 + 区服前缀（悬停里不重复游戏名）
//     · 任何「（…）」形式的实现说明（"本篇第 N 段档期"、"起点为推断"、"源站 news_meta 显式档期"…）
//  ⇒ 用户明确要求"直接删掉"：**删除**，不要把这些信息改放到悬停的别的行/字段里。
//     （`bannerDatesRaw` / `eventDatesRaw` 是**既有**的"源站原文 / 溯源说明"约定字段，
//      本次维持现状 —— 那不是"迁移目的地"，只是原本就长这样。）


const ns_miyoushe_MIYOUSHE_TZ = "Asia/Shanghai";                     // **推测**（理由见文件头 §二）
const ns_miyoushe_MIYOUSHE_REFERER = "https://www.miyoushe.com/";    // 详情端点的 Referer 门（实测）
// ⚠️ 这里**曾**导出 `MIYOUSHE_PROVENANCE`（"米游社官方公告（档期由公告正文抽出；国服墙钟按 UTC+8 换算
//    —— 源站未标注时区＝推测）"），专门塞进悬停首行。用户 2026-10-03 要求「元信息彻底删掉」→
//    常量与悬停首行**一并删除**。来源站名 / 时区推定这类信息只留在**本文件注释**里（§一/§二）。

const ns_miyoushe_LIST_BASE = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList";
const ns_miyoushe_DETAIL_BASE = "https://bbs-api.miyoushe.com/post/wapi/getPostFull";

// gids（实测：1=崩坏3 / 2=原神 / 6=星穹铁道 / 8=绝区零）
const ns_miyoushe_MIYOUSHE_GIDS = { bh3: 1, genshin: 2, hsr: 6, zzz: 8 };
// type（实测：1=公告/补给、2=活动、3=资讯）
const ns_miyoushe_MIYOUSHE_TYPES = { GACHA: 1, EVENT: 2, INFO: 3 };

const ns_miyoushe_MIYOUSHE_MAX_DETAILS = 5;        // 每侧最多抓几篇正文
const ns_miyoushe_MIYOUSHE_DETAIL_DELAY_MS = 200;  // 篇间隔（顺序抓，避免把源站打急）

// ⚠️ 原 registry-p4.js 里声明的 url 必须由这两个函数生成，否则离线夹具（map.json 按整串匹配）命中不到。
function ns_miyoushe_miyousheListUrl(gids, type, pageSize = 20) {
	return `${ns_miyoushe_LIST_BASE}?gids=${gids}&type=${type}&page_size=${pageSize}`;
}
function ns_miyoushe_miyousheDetailUrl(postId) {
	return `${ns_miyoushe_DETAIL_BASE}?post_id=${encodeURIComponent(String(postId))}`;
}

//#region 列表 / 详情解析（纯函数）
// type=2 列表每条都带 `news_meta`（显式档期，epoch 秒**字符串**）→ 解析成绝对毫秒；type=1 恒 null。
function ns_miyoushe_parseNewsMeta(nm) {
	if (!nm || typeof nm !== "object") return null;
	const s = Number(nm.start_at_sec), e = Number(nm.end_at_sec);
	if (!Number.isFinite(s) || !Number.isFinite(e) || !(s > 0) || !(e > s)) return null;
	const st = Number(nm.activity_status);
	return { startTs: s * 1000, endTs: e * 1000, status: Number.isFinite(st) ? st : null };
}

function ns_miyoushe_parseMiyousheList(json) {
	if (!json || typeof json !== "object") throw new Error("miyoushe-bad-shape");
	if (json.retcode !== 0) throw new Error("miyoushe-retcode-" + json.retcode);
	const list = json.data && json.data.list;
	if (!Array.isArray(list)) throw new Error("miyoushe-bad-list");
	const out = [];
	for (const it of list) {
		const p = it && it.post;
		if (!p || p.post_id == null || p.post_id === "") continue;
		const sec = Number(p.created_at);
		out.push({
			// ⚠️ 保留字符串形态（源站就是字符串；夹具 map 的 URL 也按它拼）
			postId: String(p.post_id),
			subject: String(p.subject || "").replace(/\s+/g, " ").trim(),
			// created_at 是 **epoch 秒**，转毫秒；源站的绝对时刻，不需要按 tz 解释
			createdTs: Number.isFinite(sec) && sec > 0 ? sec * 1000 : null,
			// 只有 type=2 列表才有（type=1 恒 null）；epoch 秒的**字符串**，要 Number() 一下
			newsMeta: ns_miyoushe_parseNewsMeta(it && it.news_meta)
		});
	}
	return out;
}

function ns_miyoushe_parseMiyousheDetail(json) {
	if (!json || typeof json !== "object") throw new Error("miyoushe-bad-shape");
	if (json.retcode !== 0) throw new Error("miyoushe-retcode-" + json.retcode);
	const p = json.data && json.data.post && json.data.post.post;
	if (!p || p.post_id == null) throw new Error("miyoushe-bad-post");
	const sec = Number(p.created_at);
	return {
		postId: String(p.post_id),
		subject: String(p.subject || "").replace(/\s+/g, " ").trim(),
		createdTs: Number.isFinite(sec) && sec > 0 ? sec * 1000 : null,
		content: String(p.content || "")
	};
}

// "这篇拿不到"≠"这一侧抓取失败"：实测详情对不存在的 post 回 **HTTP 200 + retcode 1101/1102**
// （`{"data":null,"message":"post not exist","retcode":1102}`），不是 HTTP 404。
function ns_miyoushe_isMiyousheMissing(err) {
	const m = String((err && err.message) || err || "");
	return /\b(404|410)\b/.test(m) || /miyoushe-retcode-(1101|1102)\b/.test(m);
}
//#endregion

//#region 标题关键词分流
// 冲突时卡池优先：`4.6版本活动跃迁（其一）` 是**卡池**公告（字面含"活动"）。
const ns_miyoushe_BANNER_KW = /祈愿|补给|跃迁|频段|调频|招募|概率UP|概率提升|扭蛋|蛋池/;
const ns_miyoushe_EVENT_KW = /活动|征集|赛事|签到|登录|庆典|有奖|话题|抽奖|投票|答题|委托|福利/;

function ns_miyoushe_classifyMiyousheTitle(subject) {
	const t = String(subject == null ? "" : subject);
	if (ns_miyoushe_BANNER_KW.test(t)) return "gacha";
	if (ns_miyoushe_EVENT_KW.test(t)) return "event";
	return "unknown";
}
//#endregion

//#region 版本锚点（`X.Y版本更新后` → 该版本更新公告的发布时刻）
// 实测（p4-hsr-news）：`4.6版本更新说明` created_at=2026-09-28 07:00:11 +08 → 4.6 的起点。
// 必须排除「预下载开启&更新通知」（比正式更新早 1~2 天）与《云•XX》的更新说明。
const ns_miyoushe_VER_UPD_RE = /(\d{1,2}\.\d{1,2})\s*版本(?:更新说明|更新公告|更新通知|更新预告)/;
function ns_miyoushe_miyousheVersionStarts(items) {
	const map = {};
	for (const it of items || []) {
		const t = String((it && it.subject) || "");
		if (/预下载|前瞻|预约|预抽|云[•·]/.test(t)) continue;
		const m = ns_miyoushe_VER_UPD_RE.exec(t);
		if (!m) continue;
		if (map[m[1]] == null && it.createdTs != null) map[m[1]] = it.createdTs;
	}
	return map;
}
// 版本锚点 → 绝对时刻。`更新后` = 该版本的起点（没有 → 不可解）；`结束` = 下一个已知版本起点 − 1 分钟。
function ns_miyoushe_resolveVersionAnchor(ver, kind, verStarts) {
	const cur = verStarts ? verStarts[ver] : null;
	if (cur == null) return null;
	if (kind === "更新后") return cur;
	if (kind === "结束") {
		const later = Object.keys(verStarts)
			.filter((v) => verStarts[v] > cur)
			.sort((a, b) => verStarts[a] - verStarts[b])[0];
		return later == null ? null : verStarts[later] - 60000;
	}
	return null;
}
//#endregion

//#region 正文档期抽取
// 令牌化：ABS 完整日期 | VER 版本锚点 | BARE 无年份 M.D HH:MM | OPEN 即日起
// 组序号：1-5 = ABS(y,mo,d,h,mi)，6-7 = VER(num,kind)，8-11 = BARE(mo,d,h,mi)
const ns_miyoushe_ABS_SRC = "(20\\d{2})\\s*[-\\/年.]\\s*(\\d{1,2})\\s*[-\\/月.]\\s*(\\d{1,2})\\s*日?"
	+ "(?:\\s*[（(]\\s*周?[一二三四五六日天]\\s*[）)])?"
	+ "(?:\\s*(\\d{1,2})\\s*[:：]\\s*(\\d{2}))?";
const ns_miyoushe_VER_SRC = "(\\d{1,2}\\.\\d{1,2})\\s*版本(更新后|结束)";
const ns_miyoushe_BARE_SRC = "(\\d{1,2})\\s*[.\\/]\\s*(\\d{1,2})\\s*(\\d{1,2})\\s*[:：]\\s*(\\d{2})";
const ns_miyoushe_OPEN_SRC = "即日起";
const ns_miyoushe_TOKEN_RE = new RegExp([ns_miyoushe_ABS_SRC, ns_miyoushe_VER_SRC, ns_miyoushe_BARE_SRC, ns_miyoushe_OPEN_SRC].join("|"), "g");
// 两个日期之间只允许"连接符"（可带空白）。**故意不允许空串**：避免把相邻但无关的日期配成窗口。
const ns_miyoushe_CONNECTOR_RE = /^\s*[~～〜〰\-–—－至到]\s*$/;

function ns_miyoushe_tokenizeMiyoushe(s) {
	const toks = [];
	ns_miyoushe_TOKEN_RE.lastIndex = 0;
	let m;
	while ((m = ns_miyoushe_TOKEN_RE.exec(s)) !== null) {
		if (m[0] === "") { ns_miyoushe_TOKEN_RE.lastIndex++; continue; }
		const start = m.index, end = m.index + m[0].length;
		if (m[1] != null) {
			toks.push({ kind: "abs", start, end, y: +m[1], mo: +m[2], d: +m[3], h: m[4] != null ? +m[4] : null, mi: m[5] != null ? +m[5] : null, ver: null });
		} else if (m[6] != null) {
			toks.push({ kind: "ver", start, end, ver: m[6], verKind: m[7] });
		} else if (m[8] != null) {
			toks.push({ kind: "bare", start, end, y: null, mo: +m[8], d: +m[9], h: +m[10], mi: +m[11] });
		} else {
			toks.push({ kind: "open", start, end });
		}
	}
	return toks;
}

/**
 * 从一段公告正文（HTML 或纯文本）里抽出所有「起 ~ 止」档期。
 * @param {string} text 详情正文（HTML 会先 textOf 去标签；已是纯文本也安全）
 * @param {string} tz 源站墙钟时区
 * @param {{hintTs?:number, verStarts?:Record<string,number>}} opts
 *        hintTs = 公告发布时刻（**无年份**日期的年份来源 + `即日起` 的起点）
 *        verStarts = `X.Y版本更新后` 的版本锚点表（见 ns_miyoushe_miyousheVersionStarts）
 * @returns {Array<{startTs:number,endTs:number,raw:string,at:number,inferred:boolean,note:string}>}
 */
function ns_miyoushe_collectMiyousheWindows(text, tz = ns_miyoushe_MIYOUSHE_TZ, opts = {}) {
	const html = String(text == null ? "" : text);
	const s = /<[a-z!/]/i.test(html) ? textOf(html) : html;
	const hintTs = opts.hintTs != null && Number.isFinite(opts.hintTs) ? opts.hintTs : null;
	const verStarts = opts.verStarts || {};
	const hint = hintTs != null ? sourceWallParts(hintTs, tz) : null;
	const toks = ns_miyoushe_tokenizeMiyoushe(s);

	// 起点令牌 → 绝对时刻
	const startOf = (info) => {
		if (info.kind === "abs") {
			let ts = sourceInstant(info.y, info.mo, info.d, info.h == null ? 0 : info.h, info.mi == null ? 0 : info.mi, tz);
			if (info.ver) {
				// `2026/09/28 4.6版本更新后` → 用版本更新公告时刻（更准）；锚点缺失才退回字面日期 00:00
				const v = ns_miyoushe_resolveVersionAnchor(info.ver, info.verKind || "更新后", verStarts);
				if (v != null) ts = v;
			}
			return ts;
		}
		if (info.kind === "bare") {
			if (!hint) return null;      // 没有公告年份可借 → 不解（不猜当前年）
			return sourceInstant(hint.y, info.mo, info.d, info.h == null ? 0 : info.h, info.mi == null ? 0 : info.mi, tz);
		}
		if (info.kind === "ver") return ns_miyoushe_resolveVersionAnchor(info.ver, info.verKind, verStarts);
		if (info.kind === "open") return hintTs;   // `即日起` → 公告发布时刻
		return null;
	};
	// 终点令牌 → 绝对时刻（无年份时按起点年，月日更早则进一年）
	const endOf = (info, startTs) => {
		if (info.kind === "ver") return ns_miyoushe_resolveVersionAnchor(info.ver, info.verKind, verStarts);
		if (info.kind === "open") return null;
		const h = info.h == null ? 23 : info.h, mi = info.mi == null ? 59 : info.mi;
		let y = info.y;
		if (y == null) {
			const sw = sourceWallParts(startTs, tz);
			y = sw.y;
			// 月日排在起点之前 → 跨年（共用判定）
			if (endsNextYear(sw.mo, sw.d, info.mo, info.d)) y += 1;
		}
		return sourceInstant(y, info.mo, info.d, h, mi, tz);
	};

	const byKey = new Map();
	// 去重键用**时间区间**而不是 raw 文本：同一段区间在正文里常有"全写"与"只写版本锚点"两种形态
	// （实测星铁：`2026/09/28 4.6版本更新后 ~ …` 与 `4.6版本更新后 ~ …` 是同一段），
	// 只按 raw 去重会重复列出。保留 raw 更长的那条（信息更全），插入顺序即文档顺序。
	const addWindow = (w) => {
		const key = w.startTs + "|" + w.endTs;
		const prev = byKey.get(key);
		if (!prev) { byKey.set(key, w); return; }
		if (w.raw.length > prev.raw.length) {
			prev.raw = w.raw;
			prev.at = w.at;
			prev.inferred = w.inferred;
			prev.note = w.note;
		}
	};
	let i = 0;
	while (i < toks.length) {
		const a = toks[i];
		const info = { kind: a.kind, y: a.y, mo: a.mo, d: a.d, h: a.h, mi: a.mi, ver: a.ver, verKind: a.verKind };
		let aEnd = a.end;
		let j = i + 1;
		// 紧贴的 `YYYY/MM/DD` + `X.Y版本更新后`（中间只有空白）= 同一个起点
		if (a.kind === "abs" && a.h == null && toks[j] && toks[j].kind === "ver" && /^\s*$/.test(s.slice(a.end, toks[j].start))) {
			info.ver = toks[j].ver;
			info.verKind = toks[j].verKind;
			aEnd = toks[j].end;
			j++;
		}
		const b = toks[j];
		i++;
		if (!b) continue;
		if (!ns_miyoushe_CONNECTOR_RE.test(s.slice(aEnd, b.start))) continue;
		if (b.kind !== "abs" && b.kind !== "bare" && b.kind !== "ver") continue;

		const st = startOf(info);
		if (st == null) continue;
		const en = endOf(b, st);
		if (en == null || !(en > st)) continue;
		const raw = s.slice(a.start, b.end).replace(/\s+/g, " ").trim();
		const inferredVer = info.kind === "ver" || (info.kind === "abs" && !!info.ver);
		addWindow({
			startTs: st,
			endTs: en,
			raw,
			at: a.start,
			inferred: info.kind === "open" || inferredVer,
			note: info.kind === "open" ? "起点「即日起」＝取公告发布时刻"
				: inferredVer ? "起点「版本更新后」＝取该版本更新公告的发布时刻"
					: ""
		});
	}
	return [...byKey.values()];
}

// 当期 = 文档顺序里**第一条覆盖 now** 的窗口；没有就是没有（不退回过期档期）
// 卡池名册：优先只看"首个档期之前"的引言（那才是本期名单），引言里没有才退回全文。
// 例：星铁跃迁引言 → 「真珠」；绝区零频段引言没有名单 → 全文取「洛克茜、普罗米娅」。
const ns_miyoushe_ROLE_RE = /限定\s*(?:[5S]\s*[星级])?\s*(?:角色|代理人|女武神)\s*[「【\[]([^」】\]]+)[」】\]]/g;
function ns_miyoushe_extractRoles(s) {
	const names = [];
	ns_miyoushe_ROLE_RE.lastIndex = 0;
	let m;
	while ((m = ns_miyoushe_ROLE_RE.exec(s)) !== null) {
		const n = m[1].replace(/[（(].*$/, "").trim();
		if (n && !names.includes(n)) names.push(n);
		if (names.length >= 6) break;
	}
	return names.join("、");
}
function ns_miyoushe_miyousheRoles(text, stopAt = null) {
	const s = String(text == null ? "" : text);
	const plain = /<[a-z!/]/i.test(s) ? textOf(s) : s;
	const head = stopAt != null && stopAt > 0 ? plain.slice(0, stopAt) : "";
	return (head ? ns_miyoushe_extractRoles(head) : "") || ns_miyoushe_extractRoles(plain);
}
//#endregion

//#region 抓取
const ns_miyoushe_sleep = (ms) => new Promise((r) => coreEnv.timer.setTimeout(r, ms));

// 源站原文（`bannerDatesRaw` / `eventDatesRaw` 用）。
// ⚠️ 这两个字段**会被 UI 的默认两行式直接显示**（面板取 `bannerDatesRaw || bannerDates`、
//    `eventDatesRaw || eventDates`）—— 所以它们**只能放档期文本本身**，
//    绝不能夹带「这来自哪个字段」之类的说明（用户 2026-10-03：「元信息彻底删掉」）。
//    旧实现在 news_meta 兜底时返回 `news_meta 档期（源站显式字段，非正文）：…`，
//    一旦兜底路径触发，这句话就会原样出现在面板上 —— 已修。
//    「本窗口来自 news_meta 兜底」这一事实保留在 `p.source`（不显示）+ 代码注释里。
function ns_miyoushe_rawOf(p, tz) {
	if (p.source === "news_meta") return fmtWindow(p.startTs, p.endTs, tz);
	return p.raw;
}

// ── 悬停条目 ──────────────────────────────────────────────────────────────────
// 排版交给 lib/env.js 的 `hoverPool` / `hoverEvent`（压平后见 28-parser-hover-tools.js；与本体 buildPoolHover / buildEventHover 逐字一致）。
// 用户 2026-10-03：「悬停里的元信息彻底删掉」→ 这里**只**产出名称与档期，别的一概不传。
// 池名与本体 `banner：roles` 同构：有角色名 →「池名：角色」，没有 → 只写池名。
const ns_miyoushe_hoverPoolName = (w) => (w.roles ? `${w.subject}：${w.roles}` : w.subject);
// 活动悬停顺序：结束时间升序（无/未知结束排在最后），并列再按开始时间 —— 与 lib/env.js（压平后见 28-parser-hover-tools.js）内部规则一致
function ns_miyoushe_byEndTs(a, b) {
	const ea = a.endTs == null ? Infinity : a.endTs;
	const eb = b.endTs == null ? Infinity : b.endTs;
	if (ea !== eb) return ea - eb;
	const sa = a.startTs == null ? Infinity : a.startTs;
	const sb = b.startTs == null ? Infinity : b.startTs;
	return sa - sb;
}
// `raw` 只在"缺起止"时才会被 hoverEvent 印出来；news_meta 兜底行的 raw 是内部字段说明
// （`start_at_sec=…`）→ 不给它，免得内部字段名有机会漏进悬停。
const ns_miyoushe_hoverRaw = (w) => (w.source === "news_meta" ? "" : w.raw);

// 列表 → 候选 → 逐篇详情 → 抽档期。返回值可能是 null（未公布）；结构性损坏直接抛。
async function ns_miyoushe_collectMiyousheSide(listUrl, signal, tz, now, want) {
	const listJson = await fetchJson(listUrl, { signal, mode: "proxy", referer: ns_miyoushe_MIYOUSHE_REFERER });
	const items = ns_miyoushe_parseMiyousheList(listJson);
	if (items.length === 0) return null;                       // 实测 gids=99999 → retcode 0 + 空 list
	const verStarts = ns_miyoushe_miyousheVersionStarts(items);
	const cands = items
		.filter((it) => ns_miyoushe_classifyMiyousheTitle(it.subject) === want)
		.sort((a, b) => (b.createdTs || 0) - (a.createdTs || 0))
		.slice(0, ns_miyoushe_MIYOUSHE_MAX_DETAILS);
	if (cands.length === 0) return null;                       // 该列表里没有本侧公告

	const covering = [];
	let okCount = 0, firstHardErr = null;
	for (let idx = 0; idx < cands.length; idx++) {
		if (idx > 0 && ns_miyoushe_MIYOUSHE_DETAIL_DELAY_MS > 0) await ns_miyoushe_sleep(ns_miyoushe_MIYOUSHE_DETAIL_DELAY_MS);
		const it = cands[idx];
		let d;
		try {
			d = ns_miyoushe_parseMiyousheDetail(await fetchJson(ns_miyoushe_miyousheDetailUrl(it.postId), { signal, mode: "proxy", referer: ns_miyoushe_MIYOUSHE_REFERER }));
		} catch (e) {
			if (!ns_miyoushe_isMiyousheMissing(e) && !firstHardErr) firstHardErr = e;
			continue;
		}
		okCount++;
		const hintTs = d.createdTs != null ? d.createdTs : it.createdTs;
		const wins = ns_miyoushe_collectMiyousheWindows(d.content, tz, { hintTs, verStarts });
		const roles = ns_miyoushe_miyousheRoles(d.content, wins.length ? wins[0].at : null);
		for (const w of wins) {
			w.subject = d.subject || it.subject;
			w.postId = d.postId;
			w.roles = roles;
			w.source = "content";
			// 候选已按 created_at 倒序、窗口按文档顺序 → covering[0] 就是"最新一篇公告里的第一条当期窗口"
			if (coversNow(w, now)) covering.push(w);
		}
	}
	// 一篇正文都没拿到、且出现过硬错（403/567/坏 JSON）→ 抛出去，让界面显示"抓取失败"
	// 而不是把封禁静默成"未公布"。全是"post not exist"（1101/1102）则不算失败 → null。
	if (okCount === 0) {
		if (firstHardErr) throw firstHardErr;
		return null;
	}
	// 兜底：正文一个覆盖 now 的窗口都抽不到时，退回源站**显式**字段 news_meta（只有 type=2 列表有）。
	// 口径与正文可能不同（实测原神的 end 是开奖时刻）→ 悬停/raw 里**标明来源**，不冒充正文。
	if (covering.length === 0) {
		for (const it of cands) {
			const nm = it.newsMeta;
			if (!nm || !(coversNow(nm, now))) continue;
			covering.push({
				startTs: nm.startTs, endTs: nm.endTs,
				// ⚠️ 不留「news_meta start_at_sec=… end_at_sec=…」这种内部字段说明：内部字段名不进数据
				//    （`eventDatesRaw` 的溯源说明由 ns_miyoushe_rawOf 统一给；悬停由 ns_miyoushe_hoverRaw 屏蔽）
				raw: fmtWindow(nm.startTs, nm.endTs, tz),
				subject: it.subject, postId: it.postId, roles: "",
				inferred: false, note: "", source: "news_meta", status: nm.status
			});
		}
	}
	if (covering.length === 0) return null;                    // 抓到正文但没有覆盖 now 的档期 = 未公布
	return { primary: covering[0], covering };
}

/** 卡池侧（type=1 公告/补给；标题按卡池关键词分流） */
async function ns_miyoushe_gachaMiyoushe(url, signal, tz = ns_miyoushe_MIYOUSHE_TZ, now = nowMs()) {
	const listUrl = url || ns_miyoushe_miyousheListUrl(ns_miyoushe_MIYOUSHE_GIDS.bh3, ns_miyoushe_MIYOUSHE_TYPES.GACHA);
	const r = await ns_miyoushe_collectMiyousheSide(listUrl, signal, tz, now, "gacha");
	if (!r) return null;
	const p = r.primary;
	// 悬停 = 全部当期池，每池「池名：角色」一行 + 档期（排版交给**条目反生成** hoverTextFromItems）。
	// 只有 1 个当期池 → "" → **不设** bannerHover，由 UI 走默认两行式「banner ⏎ bannerDates」。
	// ── P3b（2026-11-07）：条目事实 → 悬停 + `gacha` 数组（顺序 = poolHoverOrderOf，与 hoverPool 同口径）──
	const pools = r.covering.map((w) => ({
		title: w.subject,
		label: ns_miyoushe_hoverPoolName(w),
		startTs: w.startTs,
		endTs: w.endTs,
		raw: ns_miyoushe_hoverRaw(w)
	})).sort(poolHoverOrderOf);
	const bannerHover = hoverTextFromItems(pools, "gacha", tz);
	const out = {
		banner: p.subject,
		roles: p.roles || "",
		bannerDates: fmtWindow(p.startTs, p.endTs, tz),
		bannerDatesRaw: ns_miyoushe_rawOf(p, tz),
		startTs: p.startTs,
		endTs: p.endTs,
		...(bannerHover ? { bannerHover } : {})
	};
	out.gacha = dataArrayProducedGachaOf(out, pools, { id: "miyoushe", tz }, now);
	out.gachaHoverItems = pools;
	return out;
}

/** 活动侧（type=2 活动；标题按活动关键词分流） */
async function ns_miyoushe_eventsMiyoushe(url, signal, tz = ns_miyoushe_MIYOUSHE_TZ, now = nowMs()) {
	const listUrl = url || ns_miyoushe_miyousheListUrl(ns_miyoushe_MIYOUSHE_GIDS.bh3, ns_miyoushe_MIYOUSHE_TYPES.EVENT);
	const r = await ns_miyoushe_collectMiyousheSide(listUrl, signal, tz, now, "event");
	if (!r) return null;
	const p = r.primary;
	// 悬停 = 全部当期活动，结束时间升序逐行「名称 + 3 空格 + 档期」
	// （排版交给**条目反生成**；它自己**不排序** → 这里先排好再传）。
	// 只有 1 条 → "" → **不设** eventHover，由 UI 走默认两行式「event ⏎ eventDates」。
	// ── P3b（2026-11-07）：条目事实 → 悬停 + `events` 数组 ─────────────────────
	const eventItems = r.covering.slice().sort(ns_miyoushe_byEndTs).map((w) => ({
		title: w.subject,
		startTs: w.startTs,
		endTs: w.endTs,
		raw: ns_miyoushe_hoverRaw(w)
	}));
	const eventHover = hoverTextFromItems(eventItems, "event", tz);
	const out = {
		event: p.subject,
		eventDates: fmtWindow(p.startTs, p.endTs, tz),
		eventDatesRaw: ns_miyoushe_rawOf(p, tz),
		...(eventHover ? { eventHover } : {})
	};
	out.events = dataArrayProducedEventsOf(out, eventItems, { id: "miyoushe", tz }, now);
	out.eventHoverItems = eventItems;
	return out;
}
//#endregion

		// ── 条目 ──
		registerSource({
				id: "genshin",
				defaultHidden: false,
				tz: TZ_CN,
				// parserVersion：该条目「解析逻辑」的版本号 —— 源站改版/规则更新后 +1。
				// 用途：无服务端分发时定位「坏了的是哪个版本的用户、哪个源」（见交接文档 §13.4）。
				parserVersion: 1,
				name: "原神",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/b/b0/%E5%8E%9F%E7%A5%9E%E5%9B%BE%E6%A0%87.png!/fw/512",
				source: "Bwiki \u5F80\u671F\u7948\u613F",
				url: "https://wiki.biligame.com/ys/api.php?action=parse&page=%E5%BE%80%E6%9C%9F%E7%A5%88%E6%84%BF&prop=text&format=json&formatversion=2",
				// 独立活动源：原神活动一览为 JS 动态加载（Dquery+SMW），经 SMW ask 查询开始/结束时间
				eventUrl: "https://wiki.biligame.com/ys/api.php?action=ask&query=%5B%5B%E5%88%86%E7%B1%BB%3A%E6%B4%BB%E5%8A%A8%5D%5D&format=json",
				eventSource: "Bwiki \u6D3B\u52A8\u4E00\u89C8"
		});

		registerSource({
				id: "hsr",
				defaultHidden: false,
				tz: TZ_CN,
				// 2026-11-09：卡池源换成**官方公告 CMS**（解析逻辑与来源同时变）⇒ 版本号 +1
				parserVersion: 2,
				name: "崩坏：星穹铁道",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/3/38/HonkaiStarRailIcon_StartingVer3.6_CHN.png!/fw/512",
				// 默认卡池源 = 官方公告（api-takumi-static content_v2_user iChanId=257，经 host 代理）：
				// 「X.Y版本活动跃迁（其N）」正文自带精确起止 + 5★/4★/光锥/卡池名；
				// 起点「X.Y版本更新后」按 10:00 锚定（见 23-parser-time.js 的 anchorStartOf）。
				source: "官方公告",
				url: HSR_CMS_LIST_URL,
				// bwiki「历史跃迁」降为备选（设置页可切）：它的窗口常只写「4.6版本更新后」（无日期）
				// ⇒ 起点未知 ⇒ 按 2026-11-09 的口径不参与在期判定，只在悬停里列出。
				altSources: [
					{ label: "Bwiki 历史跃迁", url: HSR_BWIKI_URL, fetcher: "hsr-bwiki" }
				],
				// 独立活动源：星铁活动一览（api.php 带 origin=* 可浏览器直连；「活动时间」表含当期活动）
				eventUrl: "https://wiki.biligame.com/sr/api.php?action=parse&page=%E6%B4%BB%E5%8A%A8%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
				eventSource: "Bwiki \u6D3B\u52A8\u4E00\u89C8"
		});

		registerSource({
				id: "zzz",
				defaultHidden: false,
				tz: TZ_CN,
				parserVersion: 2,
				name: "绝区零",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/3/3e/ZZZ_miYoYo_logo.jpg!/fw/512",
				source: "官方公告",
				// 默认卡池源=官网公告（api-takumi-static content_v2_user，经 host 代理，无 CORS、无需登录）：
				// 「X.Y版本限时频段（上/下期）」公告含该期精确起止与限定 S 级代理人/音擎；
				// 无当期频段公告 ⇒ 如实「未公布」，**不自动回退 Bwiki**（2026-11-07 摘除）；
				// 也可在设置中手动切 Bwiki（备选）
				url: ZZZ_NEWS_LIST_URL,
				altSources: [
					// ⚠️ `unknownStartIsActive: true` —— **全仓唯一**带这个开关的来源（2026-11-09 用户选 B）。
					// 语义：只在这一条被手动选中时（设置页「卡池来源」= Bwiki 往期调频），
					// `startTs == null`（源站写「X.Y版本更新后」）的池按"已开始"处理；
					// 默认源（官方公告）与其它任何来源都不受影响（见 22-fetcher-core.js 的
					// `unknownStartIsActiveOf` 与 24-parser-window.js 的 selectCurrent）。
					// 依据：**该页不收录未来卡池**（只列已开的频段；2026-11-09 实测整页每行起点都写
					// 「X.Y版本更新后」、终点是具体日期）⇒ 这一页的"起点未知"必然等于"已经在开"。
					// 为什么星铁 bwiki 备选**不能**同样处理：星铁那页收录**未来池**
					// （「4.6/4.7版本更新后 ~ …」在开池前几周就挂在页面上），同样放行就会重现
					// 2026-11-09 修掉的"未来池假在期"（那是用户当时点名要修的 bug）。
					{ label: "Bwiki 往期调频", url: ZZZ_BWIKI_URL, fetcher: "zzz-bwiki", unknownStartIsActive: true }
				],
				// 独立活动源：官方公告（api-takumi-static，与卡池侧同一接口，经 host 代理）。
				// 「…活动说明」公告正文自带【活动时间】起止（含"X.Y版本更新后/版本结束"折算），
				// 官方口径最及时；Bwiki 活动一览作为备选（编辑滞后时反而无当期内容）。
				eventUrl: ZZZ_NEWS_LIST_URL,
				eventSource: "官方公告",
				eventAltSources: [
					{
						label: "Bwiki 活动一览",
						url: "https://wiki.biligame.com/zzz/api.php?action=parse&page=%E6%B4%BB%E5%8A%A8%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
						fetcher: "zzz-event-bwiki"
					}
				]
		});

		registerSource({
			id: "bh3",
				defaultHidden: false,
			tz: "Asia/Shanghai",
			name: "崩坏3",
			icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/b0/03/81/b003811c-f82a-428c-aa49-195f22c311bd/AppIcon-1x_U007emarketing-0-10-0-85-220-0.png/512x512bb.jpg",
			// 2026-11-14 用户拍板：除 cytq 外全部默认展示。
			// 默认源 = 内容中台（`iChanId=697` 卡池 / `696` 活动，见 30-game-batch2.js 的文件头与抓取器登记）；
			// 解析口径（卡池只出名称/角色、活动正文无时间块如实跳过）也写在那份文件里。
			url: "https://act-api-takumi-static.mihoyo.com/content_v2_user/app/b9d5f96cd69047eb/getContentList?iChanId=697&iPageSize=30&iPage=1&sLangKey=zh-cn",
			source: "官网公告",
			eventUrl: "https://act-api-takumi-static.mihoyo.com/content_v2_user/app/b9d5f96cd69047eb/getContentList?iChanId=696&iPageSize=30&iPage=1&sLangKey=zh-cn",
			eventSource: "官网公告",
			altSources: [{ label: "米游社公告", url: "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=1&type=1&page_size=20", fetcher: "bh3-miyoushe" }],
			eventAltSources: [{ label: "米游社公告", url: "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=1&type=2&page_size=20", fetcher: "bh3-miyoushe" }]
		});

		// ── 抓取器登记 ──
		// P3（2026-11-07）：原神改由解析器**直出** `gacha` 数组（`bwikiGachaPayload` 的 emitArrays 分支），
		// 悬停文本由同一份条目反生成；星铁 **P3b** 起同样直出（叠上 `dedupeRoleNames`）。
		GACHA_FETCHERS["genshin"] = mkMediaWiki((html, tz) => bwikiGachaPayload(html, tz, { emitArrays: true, id: "genshin" }));
		// 星铁：bwiki「历史跃迁」的「5星角色」格子会把同一角色写两遍（缺图红链的名字 + 正常链接的
		// 「名字（属性）」）⇒ 载荷按**角色名（去掉括号属性后缀）**判重，保留第一次出现的形式。
		// 规则与理由见 26-parser-hover.js 的 dedupeRoleNames；**只在星铁这里开启**，
		// 原神/绝区零的 bwiki 载荷（以及全局 cleanRoleNames）语义一字不改。
		// ⚠️ 2026-11-09：这条 bwiki 抓取器**降为备选**（键 `hsr-bwiki`，对应 `altSources[0]`）；
		//    默认的 `hsr` 换成了官方公告 CMS（见上面 parseHsrWarp / fetchHsrGacha）。
		GACHA_FETCHERS["hsr-bwiki"] = mkMediaWiki((html, tz) => bwikiGachaPayload(html, tz, { dedupeRoleNames: true, emitArrays: true, id: "hsr" }));
		GACHA_FETCHERS["hsr"] = (url, signal, tz) => fetchHsrGacha(url, signal, tz);
		GACHA_FETCHERS["zzz"] = (url, signal, tz) => fetchZzzGacha(url, signal, tz);
		// 绝区零卡池**备选**（Bwiki 往期调频）：P3d（2026-11-07）起由这里补 `gacha` 数组。
		// `selectCurrent` 给的载荷只有外显那一条字符串（**没有** `bannerHover`）⇒ 并列条目为 0，
		// 数组 = 主条一条。`entries` 传空数组是**故意的**：把池列表塞进去会让数组比改造前多出条目，
		// 那不是等价切换（P3 的口径是"数组与改造前合成结果逐条相等"）。
		// 没切这一条时，用户手动把卡池源切到「Bwiki 往期调频」⇒ 数组恒 null ⇒ 该侧显示「无数据」。
		//
		// ── 起点未知的放行（2026-11-09 晚，用户选 B）────────────────────────────────
		// 本页**不收录未来卡池**（只列已开的频段；2026-11-09 实测整页每行起点都写「X.Y版本更新后」、
		// 终点是具体日期）⇒ 这一页的"起点未知"就是"已经在开"。所以这一条**唯一**声明了
		// `unknownStartIsActive: true`（见上面 `altSources` 的注释），这里把它读出来交给
		// `selectCurrent` 恢复旧判据（`startTs == null || startTs <= now`）。
		// "只对该来源生效"由调用关系保证：这个抓取器**只有**在设置里选中该备选源时才会被执行
		// （`gachaFetcherFor` 命中 altSourceId），默认源走 `GACHA_FETCHERS["zzz"]`，不经过这里。
		// ⚠️ 星铁 bwiki 备选（`hsr-bwiki`，收录未来池）**没有**这个开关，所以仍严格。
		GACHA_FETCHERS["zzz-bwiki"] = mkMediaWiki((html, tz) => {
			const now = nowMs();
			const openStartActive = unknownStartIsActiveOf("zzz-bwiki");
			const d = pickCurrent(parseAllBwiki)(html, { unknownStartIsActive: openStartActive });
			if (!d) return null;
			d.gacha = dataArrayProducedGachaOf(d, [], { tz }, now);
			return d;
		});
					// 原神：活动一览为 JS 动态加载（Dquery+SMW），走 SMW ask 查询（fetchYsActivity 忽略 URL 参数）
EVENT_FETCHERS["genshin"] = {
				default: (url, signal, tz) => fetchYsActivity(signal, tz)
			};
					// 星铁：活动一览（静态「活动时间」表，api.php 可直连）→ 外显当期 + 悬停列出全部并行活动
			// `categoryFacts`（category / tags 批 1）：把表里的「类型」列写进 `events[]` 的 `category`。
			// 批 2（2026-11-08）：**绝区零 Bwiki 备选源也开了**（同一个 `genericEventPayload`、同一列；
			//    多值按 `<br />` 拆成 category + tags，见 22-fetcher-core.js 的 `categoryValuesOf`）。
			//    绝区零的 TAG 列本批仍**不读**（留给后续决策）。
EVENT_FETCHERS["hsr"] = {
				default: mkMediaWiki((html, tz) => genericEventPayload(html, tz, { emitArrays: true, id: "hsr", categoryFacts: true }))
			};
					// 绝区零：默认=官方公告（api-takumi-static，与卡池侧同一接口；活动时间写在公告正文里，
			// 含"X.Y版本更新后/版本结束"的换算；结束时间未知的活动保留并沉底）→ 备选=Bwiki 活动一览
EVENT_FETCHERS["zzz"] = {
				default: (url, signal, tz) => fetchZzzEventsOfficial(url, signal, tz),
				"zzz-event-bwiki": mkMediaWiki((html, tz) => genericEventPayload(html, tz, { emitArrays: true, id: "zzz", categoryFacts: true }))
			};

		// ══ 原 43-sources-register.js 里属于本组的登记代码（原样保留）══
		{

			const e = SOURCES.find((s) => s.id === "genshin");

			if (!e) { console.warn("[next-sources] 找不到既有条目 genshin，米游社公告备选未挂上"); }

			else {

				const G = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=2&type=1&page_size=20";

				const E = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=2&type=2&page_size=20";

				GACHA_FETCHERS["genshin-miyoushe"] = (url, signal, tz) => ns_miyoushe_gachaMiyoushe(url, signal, tz);

				Object.assign(EVENT_FETCHERS["genshin"], { "genshin-miyoushe": { default: (url, signal, tz) => ns_miyoushe_eventsMiyoushe(url, signal, tz) } });

				// 按 fetcher 去重，避免重复执行时堆叠

				const ga = (e.altSources || []).filter((a) => a.fetcher !== "genshin-miyoushe");

				const ea = (e.eventAltSources || []).filter((a) => a.fetcher !== "genshin-miyoushe");

				e.altSources = [...ga, { label: "米游社公告", url: G, fetcher: "genshin-miyoushe" }];

				e.eventAltSources = [...ea, { label: "米游社公告", url: E, fetcher: "genshin-miyoushe" }];

			}

		}
		{

			const e = SOURCES.find((s) => s.id === "hsr");

			if (!e) { console.warn("[next-sources] 找不到既有条目 hsr，米游社公告备选未挂上"); }

			else {

				const G = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=6&type=1&page_size=20";

				const E = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=6&type=2&page_size=20";

				GACHA_FETCHERS["hsr-miyoushe"] = (url, signal, tz) => ns_miyoushe_gachaMiyoushe(url, signal, tz);

				Object.assign(EVENT_FETCHERS["hsr"], { "hsr-miyoushe": { default: (url, signal, tz) => ns_miyoushe_eventsMiyoushe(url, signal, tz) } });

				// 按 fetcher 去重，避免重复执行时堆叠

				const ga = (e.altSources || []).filter((a) => a.fetcher !== "hsr-miyoushe");

				const ea = (e.eventAltSources || []).filter((a) => a.fetcher !== "hsr-miyoushe");

				e.altSources = [...ga, { label: "米游社公告", url: G, fetcher: "hsr-miyoushe" }];

				e.eventAltSources = [...ea, { label: "米游社公告", url: E, fetcher: "hsr-miyoushe" }];

			}

		}
		{

			const e = SOURCES.find((s) => s.id === "zzz");

			if (!e) { console.warn("[next-sources] 找不到既有条目 zzz，米游社公告备选未挂上"); }

			else {

				const G = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=8&type=1&page_size=20";

				const E = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=8&type=2&page_size=20";

				GACHA_FETCHERS["zzz-miyoushe"] = (url, signal, tz) => ns_miyoushe_gachaMiyoushe(url, signal, tz);

				Object.assign(EVENT_FETCHERS["zzz"], { "zzz-miyoushe": { default: (url, signal, tz) => ns_miyoushe_eventsMiyoushe(url, signal, tz) } });

				// 按 fetcher 去重，避免重复执行时堆叠

				const ga = (e.altSources || []).filter((a) => a.fetcher !== "zzz-miyoushe");

				const ea = (e.eventAltSources || []).filter((a) => a.fetcher !== "zzz-miyoushe");

				e.altSources = [...ga, { label: "米游社公告", url: G, fetcher: "zzz-miyoushe" }];

				e.eventAltSources = [...ea, { label: "米游社公告", url: E, fetcher: "zzz-miyoushe" }];

			}

		}


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-benghuai2.js：崩坏学园2 国服（bh2）—— 官网公告（卡池 + 活动）
// ─────────────────────────────────────────────────────────────────────────────

//
// ══ 源站事实（2026-11-15 实测）════════════════════════════════════════════════
// 列表：`POST https://www.benghuai.com/news/getNotice` → `{ retcode:1, msg:"获取成功", data:{…} }`
//       `data` 四个栏目：`new` / `version` / `gach` / `event`（各 60 条，**已按发布时间从新到旧**）。
//       条目形态：`{ feature:"20", id:"20104735", title:"妮娜&黛尔塔", time:"2026-11-09 00:00:00", type:"2" }`
//       `type`：1=活动 / 2=祈愿 / 3=版本 / 0=其他；`feature` 细分祈愿种类（见下 FEATURE_LABEL）。
// 详情：`GET https://www.benghuai.com/news/getNoticeByID?id=<id>` → `{ retcode:1, data:{ title, text, time, … } }`
//       `text` 是 HTML 富文本，**档期与 UP 都在里面**：
//         · 档期：`活动时间：` / `【活动时间】` / `【开启时间】` + `11月9日 00:00 ~ 11月19日 24:00`
//         · UP  ：`本期UP装备:` 列表 / `第N使魔碎片:` + 表格首列 / 梦想祈愿的「UP装备如下」分段表
//
// ══ 真实抓包：站点自己怎么发这两个请求（不是猜的）════════════════════════════════
// `https://www.benghuai.com/news` 的 `news.js`（`static-event.benghuai.com/new_mihoyo_homepage/js/news.js`）：
//   getAllNotice : `$.ajax({ type:"POST", url: base_url+"news/getNotice", dataType:"json", async:false })`
//                  ——**没有 data、没有自定义头** ⇒ 实际是「空 body 的 POST」（浏览器只带默认头）。
//   getNoticeByID: `$.ajax({ type:"POST", url: base_url+"news/getNoticeByID?id="+id, dataType:"json" })`
//                  ——同样是空 body POST；`id` 在 **query**，不在 body。
// 实测（2026-11-15，curl/Invoke-WebRequest 复现）：
//   · 列表：GET / 空 body POST / `{}` body POST **都回 200 与同一份 31,206 B JSON**（服务端不看方法/body）
//   · 详情：GET 200（2,968 B），`id` 必须是 query 参数
// ⇒ 本文件按任务书用 **POST 列表 + GET 详情**；但宿主代理只在 body 非空时才发 POST
//   （`src/index.js` 的 `method = body !== "" ? "POST" : "GET"`），空 body 会被降级成 GET。
//   所以列表请求送 **body `{}`**（源站忽略 body，实测与空 body 同响应），Content-Type 用宿主默认的
//   `application/json; charset=utf-8`；这既保住了 POST 契约，又不需要新增"空 body POST"通道。
//   ⚠️ 别把 body 改成 `""`：那会被宿主降级成 GET；也别去掉 body —— 两者都会让"真 POST"静默消失。
//
// ══ 请求数 ═════════════════════════════════════════════════════════════════════
//   列表 1 次（**两侧共享**：同一轮刷新内用按轮次的 promise 缓存，见 `ns_bh2_listJsonOf`）
//   + 每条候选详情 1 次（每侧最多取 `ns_bh2_MAX_DETAILS` 条；列表按发布时间倒序，
//     当期池可能不是最新那条：2026-11-15 实测「少女的心愿」是第 4 条、仍开着）
//   ⇒ 单侧稳态 2 次（列表 + 1 条详情）；两侧一轮 = 1 + 6 + 6 = 13 次（当期在最前面时会少一些）。
//
// ══ 口径 ═══════════════════════════════════════════════════════════════════════
//   · tz = Asia/Shanghai（源站是国服官网，`time` 是 UTC+8 墙钟）
//   · 源站日期**不带年份**（`11月9日`）⇒ 借公告发布时间的年份补（共用 `inferYear`）；
//     ⚠️ `inferYear` 只覆盖"往回退一年"（`mo > hint.mo + 6`），「公告 12 月发、档期在 1 月」这个
//     **往前进一年**的方向由本文件先判（见 `ns_bh2_windowOf` 里 `hint && sm + YEAR_HINT_MONTH_GAP < hint.mo`）；
//     结束月日早于开始 ⇒ 次年（共用 `endsNextYear`）
//   · `24:00` 按次日 00:00 算（`sourceInstant` 的 Date.UTC 天然进位；`raw` 仍留源站原文）
//   · 只有日期没有时分 ⇒ 起 00:00 / 止 23:59（仓库通用约定）
//   · 外显 = 覆盖 now 的池里**结束最早**的那口；活动外显走共用 `pickEventPrimary`
//   · 悬停/数组一律由 `hoverTextFromItems` + `dataArrayProducedGachaOf` / `dataArrayProducedEventsOf`
//     生成（不新造字段、不手拼字符串）
//
// ══ 失败语义 ═══════════════════════════════════════════════════════════════════
//   · 列表结构变了（没有 `data` / 四个栏目一条都取不到）⇒ 抛错（不是 nomatch）
//   · 详情全抓失败 ⇒ 抛第一个错；详情抓到但一条档期都解不出（正文改版）⇒ 抛 `bh2:no-window`
//   · 结构正常、但没有任何一条覆盖 now ⇒ `null`（未公布；过期档期不冒充当期）
//   · 没有档期段的公告（周边/问卷/礼包上架…）逐条跳过，不算失败
const ns_bh2_TZ = "Asia/Shanghai";
const ns_bh2_LIST_URL = "https://www.benghuai.com/news/getNotice";
const ns_bh2_DETAIL_URL = "https://www.benghuai.com/news/getNoticeByID?id=";
const ns_bh2_REFERER = "https://www.benghuai.com/news";
// 每侧取多少条详情：当期可能排在第 4 条（2026-11-15 实测），6 条覆盖约两周的公告量。
const ns_bh2_MAX_DETAILS = 6;
// `feature` → 祈愿种类（站点 JS 的同一张映射：18 公主 / 19 魔女 / 20 使魔 / 21 魔法少女 / 22 梦想）
const ns_bh2_FEATURE_LABEL = {
	18: "公主祈愿", 19: "魔女祈愿", 20: "使魔祈愿", 21: "魔法少女祈愿", 22: "梦想祈愿"
};

// HTML → 逐行纯文本（**每个表格单元格/段落一行**：使魔碎片表的首列、UP 列表都靠行边界切）
function ns_bh2_linesOf(html) {
	const raw = String(html == null ? "" : html)
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(?:p|div|li|tr|td|th|h[1-6]|section|table|tbody|ul|ol)\s*>/gi, "\n")
		.replace(/<[^>]*>/g, "");
	return decodeExtra(raw)
		.replace(/\u00a0/g, " ")
		.split(/\r?\n/)
		.map((l) => l.replace(/[ \t]+/g, " ").trim())
		.filter(Boolean);
}
// 列表 JSON → `{ gach, event }`（各自按发布时间从新到旧）。结构不对就抛。
function ns_bh2_listOf(json) {
	const data = json && json.data;
	if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("bh2:bad-list");
	const rowOf = (v) => {
		if (!v || typeof v !== "object") return null;
		const id = v.id == null ? "" : String(v.id).trim();
		const title = String(v.title == null ? "" : v.title).replace(/\s+/g, " ").trim();
		const published = String(v.time == null ? "" : v.time).trim();
		if (!id || !title) return null;
		const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(published);
		return {
			id, title, published,
			feature: Number(v.feature) || 0,
			hint: m ? { y: +m[1], mo: +m[2] } : null
		};
	};
	const pick = (arr) => (Array.isArray(arr) ? arr.map(rowOf).filter(Boolean) : []);
	const gach = pick(data.gach);
	const event = pick(data.event);
	if (gach.length === 0 && event.length === 0) throw new Error("bh2:empty-list");
	const byNew = (a, b) => (a.published < b.published ? 1 : a.published > b.published ? -1 : 0);
	return { gach: gach.sort(byNew), event: event.sort(byNew) };
}
// 详情 JSON → `{ title, text, feature }`。正文缺失 = 结构性损坏（这一条算抓取失败，由调用方决定是否跳过）。
function ns_bh2_detailOf(json) {
	const data = json && json.data;
	if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("bh2:bad-detail");
	const text = typeof data.text === "string" ? data.text : "";
	if (!text.trim()) throw new Error("bh2:no-text");
	return {
		title: decodeExtra(String(data.title == null ? "" : data.title)).replace(/\s+/g, " ").trim(),
		text,
		feature: Number(data.feature) || 0
	};
}
// 正文 → 档期。标签必须是「活动时间 / 开启时间 / 活动日期 / 活动期限」之一（`售卖时间`、`问卷填写时间`
// 明确**不认**：那是礼包/问卷，不是活动档期）。
const NS_BH2_WINDOW_RE = new RegExp(
	"(?:活动时间|开启时间|活动日期|活动期限)[^0-9]{0,6}"
	+ "(\\d{1,2})月(\\d{1,2})日\\s*(?:(\\d{1,2}):(\\d{2}))?\\s*"
	+ "[~～\\-–—至到]\\s*"
	+ "(\\d{1,2})月(\\d{1,2})日\\s*(\\d{1,2}):(\\d{2})"
);
function ns_bh2_windowOf(text, hint, tz) {
	const m = NS_BH2_WINDOW_RE.exec(String(text == null ? "" : text));
	if (!m) return null;
	const sm = +m[1], sd = +m[2];
	const sh = m[3] == null ? 0 : +m[3];
	const si = m[4] == null ? 0 : +m[4];
	const em = +m[5], ed = +m[6], eh = +m[7], ei = +m[8];
	// 年份：`inferYear` **只覆盖"往回退一年"**（`mo > hint.mo + 6` ⇒ 上一年），
	// 而「公告 12 月发、档期落在 1 月」需要**往前进一年** —— 它没管这个方向。
	// 实测（2026-11-15，用本函数自己的导出跑）：hint={y:2025,mo:12} + `活动时间：1月1日 00:00 ~ 1月10日 24:00`
	// 旧代码给 **2025-01-01 ~ 2025-01-11**（错一年 ⇒ 整条被判"已结束"、元旦活动不显示）。
	// 这里按同一条 6 个月的界先判"次年"，其余仍交给 `inferYear`（跨年 12→1 由 `endsNextYear` 管，是另一件事）。
	const sy = (hint && sm + YEAR_HINT_MONTH_GAP < hint.mo)
		? hint.y + 1
		: inferYear(null, sm, hint);                            // 没有发布时间的线索 ⇒ null（不猜年份）
	if (sy == null) return null;
	const ey = endsNextYear(sm, sd, em, ed) ? sy + 1 : sy;
	const startTs = sourceInstant(sy, sm, sd, sh, si, tz);
	const endTs = sourceInstant(ey, em, ed, eh, ei, tz);
	if (!(endTs > startTs)) return null;
	const raw = m[0].replace(/^[^0-9]*/, "").replace(/\s+/g, " ").trim();
	return { startTs, endTs, raw, display: fmtWindow(startTs, endTs, tz) };
}
// UP 名单（源站三种写法，逐条见文件头）：
//   ① 使魔祈愿：`第N使魔碎片:` 之后紧跟的**表格首列**（= 碎片/使魔名）
//   ② 梦想祈愿：`UP装备如下：` + 分段表；取**覆盖 now 的那一段**（一段都不覆盖 → 空串，不猜是哪批）
//   ③ 其余（公主/魔女）：`本期UP装备[:：]` 之后、停止标记之前的名字行
const NS_BH2_UP_STOP_RE = /^(活动时间|活动期间|活动规则|活动奖励|活动说明|其他可能获得|UP装备如下|本期魔女)/;
const NS_BH2_SEG_RE = /^(\d{1,2})月(\d{1,2})日(\d{1,2}):(\d{2})[~～](\d{1,2})月(\d{1,2})日(\d{1,2}):(\d{2})$/;
function ns_bh2_upRolesOf(lines, win, now, tz) {
	const isName = (s) => s.length >= 2 && s.length <= 24
		&& !/^[>*·•\-–—\s]+$/.test(s) && !/^集齐\d+颗/.test(s) && !/^\d+$/.test(s)
		&& !/[:：]$/.test(s);                                  // 行尾冒号 = 说明标签（`Tips：` / `开放时间：`）
	const dedup = (arr) => [...new Set(arr)];
	// ① 使魔
	if (lines.some((l) => /^第[一二三四五六七八九十]+使魔碎片/.test(l))) {
		const out = [];
		for (let i = 0; i < lines.length; i++) {
			if (!/^第[一二三四五六七八九十]+使魔碎片/.test(lines[i])) continue;
			for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
				if (isName(lines[j])) { out.push(lines[j]); break; }
			}
		}
		return dedup(out).join("、");
	}
	// ② 梦想（分段表）
	// ⚠️ 标记**不能锚在行首**：源站把「…可以选择当前主题的任意六个装备来进行祈愿哦！UP装备如下：」
	//    写在同一段里（`<p>` 一行）⇒ 用 `test` 而不是 `^` 锚定；取它**之后**的行开始切分段。
	const di = lines.findIndex((l) => /UP装备如下/.test(l));
	if (di >= 0) {
		const hint = sourceWallParts(win.startTs, tz);
		const segs = [];
		let cur = null;
		for (let i = di + 1; i < lines.length; i++) {
			const l = lines[i];
			if (NS_BH2_UP_STOP_RE.test(l)) break;
			const sm = NS_BH2_SEG_RE.exec(l);
			if (sm) {
				const segWin = ns_bh2_windowOf(`活动时间 ${l}`, hint, tz);
				cur = { win: segWin, names: [] };
				segs.push(cur);
				continue;
			}
			if (/^(开放时间|UP装备)$/.test(l)) continue;
			if (cur && isName(l)) cur.names.push(l);
		}
		if (segs.length > 0) {
			// 只认**覆盖 now 的那一段**：分段表就是"每几天换一批 UP"，拼全部分段等于把整期的装备
			// 都印到当期那一行上。不覆盖任何分段（源站有缺口 / now 在池外）⇒ 空串（不猜是哪批）。
			const hit = segs.find((s) => s.win && coversNow(s.win, now));
			return hit ? dedup(hit.names).join("、") : "";
		}
	}
	// ③ 本期UP装备（公主 / 魔女）
	const ui = lines.findIndex((l) => /本期UP装备/.test(l));
	if (ui >= 0) {
		const out = [];
		for (let i = ui + 1; i < lines.length; i++) {
			const l = lines[i];
			if (NS_BH2_UP_STOP_RE.test(l)) break;
			if (/^自选UP组合装备[①-⑩]/.test(l)) continue;
			if (isName(l)) out.push(l);
		}
		return dedup(out).join("、");
	}
	return "";
}
// 一条公告 → 条目事实（卡池侧填 `banner` / `roles`；活动侧填 `name`）
function ns_bh2_itemOf(detail, row, kind, tz, now) {
	const lines = ns_bh2_linesOf(detail.text);
	const win = ns_bh2_windowOf(lines.join("\n"), row.hint, tz);
	if (!win) return null;                                      // 这条公告没有档期段（礼包/问卷/周边）
	const title = detail.title || row.title;
	if (kind === "gach") {
		const feature = detail.feature || row.feature;
		return {
			_i: 0,
			banner: title,
			roles: ns_bh2_upRolesOf(lines, win, now, tz),
			category: ns_bh2_FEATURE_LABEL[feature] || "祈愿",
			...win,
			isMain: true
		};
	}
	return { _i: 0, name: title, ...win };
}
// 卡池载荷：外显 = 结束最早的在期池；悬停/数组 = **全部在期池**（每池自己那行「池名：UP」）。
// 不复用 `ns_bwiki_batchGachaPayloadOf` 的「同批合并角色」：崩坏学园2 同期可开 2~3 口**不同种类**的
// 祈愿（公主/使魔），合并会把 20+ 个 UP 名拼到一口池上，看不出是哪一批。
function ns_bh2_gachaPayloadOf(items, tz, now) {
	const active = (Array.isArray(items) ? items : []).filter((it) => coversNow(it, now));
	if (active.length === 0) return null;
	const first = active.slice().sort((a, b) => (a.endTs - b.endTs) || ((a._i || 0) - (b._i || 0)))[0];
	const hoverItems = active.slice().sort(poolHoverOrderOf).map((it) => {
		const label = `${it.banner}${it.roles ? `\uFF1A${it.roles}` : ""}`;
		return { title: label, label, startTs: it.startTs, endTs: it.endTs, raw: it.raw };
	});
	const hover = hoverTextFromItems(hoverItems, "gacha", tz);
	// 类别事实按标题贴（`dataArrayAttachFactsOf` 的通道）：主条标题 = 池名，并列条标题 = `池名：UP`
	const facts = {};
	for (const it of active) {
		if (!it.category) continue;
		facts[it.banner] = { category: it.category };
		if (it.roles) facts[`${it.banner}\uFF1A${it.roles}`] = { category: it.category };
	}
	const out = {
		banner: first.banner,
		roles: first.roles || "",
		bannerDates: first.display,
		bannerDatesRaw: first.raw || "",
		startTs: first.startTs,
		endTs: first.endTs
	};
	if (hover) out.bannerHover = hover;
	if (Object.keys(facts).length) out.itemFacts = facts;
	out.gacha = dataArrayProducedGachaOf(out, hoverItems, { id: "bh2", tz }, now);
	out.gachaHoverItems = hoverItems;
	return out;
}
// 活动载荷：外显走 `pickEventPrimary`（档位 → 结束最早），悬停/数组 = 全部在期活动（`sortEventItems` 同序）
function ns_bh2_eventPayloadOf(items, tz, now) {
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
	out.events = dataArrayProducedEventsOf(out, hoverItems, { id: "bh2", tz }, now);
	out.eventHoverItems = hoverItems;
	return out;
}
// ── 列表的**轮内**共享（卡池 + 活动两侧同一条 URL，只该发一次）────────────────────
// 用法与 30-game-cygames.js 的 GameTora manifest 同一套：按 `fetchRoundSeqOf()` 判定"同一轮"，
// 轮外（设置页「测试来源」/离线用例直调抓取器）**不缓存**（跨轮复用会拿到过期公告）。
let ns_bh2_listRoundSeq = -1;
let ns_bh2_listPromise = null;
function ns_bh2_listJsonOf(signal) {
	const seq = fetchRoundSeqOf();
	if (fetchRoundActive() && seq === ns_bh2_listRoundSeq && ns_bh2_listPromise) return ns_bh2_listPromise;
	const p = fetchJson(ns_bh2_LIST_URL, {
		referer: ns_bh2_REFERER,
		signal,
		mode: "proxy",
		body: {}                         // 见文件头：body 非空才会真的发 POST；`{}` 与源站空 body 等价
	});
	if (!fetchRoundActive()) return p;
	ns_bh2_listRoundSeq = seq;
	ns_bh2_listPromise = p;
	p.catch(() => {                     // 失败不入缓存（下一次刷新要重试，别把错误钉死一整轮之后）
		if (ns_bh2_listPromise === p) { ns_bh2_listPromise = null; ns_bh2_listRoundSeq = -1; }
	});
	return p;
}
// 一侧的抓取器：列表 → 前 N 条详情 → 条目事实（`gach` / `event`）
//
// 详情取数**并发 4 路**（2026-11-15 用户拍板）：
//   · 原实现是 `for (… ) await fetchJson(…)` 串行 ⇒ 12 条详情要 6~12 秒，这一行迟迟不出版面；
//   · 上限 4 是折中：比串行快 3~4 倍，又不至于 12 条同时打过去（别让源站觉得被爬）；
//   · 结果按**行顺序**回填（`out[k]`），所以外显/悬停的排序与串行版逐字一致；
//   · 单条失败仍只影响自己（`{ err }` 槽位），全部失败才抛。
const ns_bh2_DETAIL_CONCURRENCY = 4;
async function ns_bh2_detailsOf(rows, signal) {
	const out = new Array(rows.length);
	let next = 0;
	const worker = async () => {
		for (;;) {
			const k = next++;
			if (k >= rows.length) return;
			try {
				out[k] = ns_bh2_detailOf(await fetchJson(ns_bh2_DETAIL_URL + encodeURIComponent(rows[k].id), {
					referer: ns_bh2_REFERER, signal, mode: "proxy"
				}));
			} catch (e) {
				out[k] = { err: e };
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(ns_bh2_DETAIL_CONCURRENCY, rows.length) }, worker));
	return out;
}
async function ns_bh2_sideOf(key, signal, tz, now) {
	const list = ns_bh2_listOf(await ns_bh2_listJsonOf(signal));
	const rows = list[key];
	if (rows.length === 0) return null;                          // 该栏目一条都没有 ⇒ 未公布
	const details = await ns_bh2_detailsOf(rows.slice(0, ns_bh2_MAX_DETAILS), signal);
	const items = [];
	let ok = 0, firstErr = null;
	for (let k = 0; k < details.length; k++) {
		const detail = details[k];
		if (detail && detail.err) {                               // 单条失败 ⇒ 跳过，其余照用
			if (!firstErr) firstErr = detail.err;
			continue;
		}
		ok++;
		const item = ns_bh2_itemOf(detail, rows[k], key === "gach" ? "gach" : "event", tz, now);
		if (!item) continue;
		item._i = items.length;
		items.push(item);
	}
	if (ok === 0) throw firstErr || new Error("bh2:no-detail");
	if (items.length === 0) throw new Error("bh2:no-window");     // 正文改版 = 结构性损坏
	return items;
}
async function ns_bh2_gacha(url, signal, tz = ns_bh2_TZ, now = nowMs()) {
	const at = ns_bwiki_nowOf(now);
	return ns_bh2_gachaPayloadOf(await ns_bh2_sideOf("gach", signal, tz, at), tz, at);
}
async function ns_bh2_events(url, signal, tz = ns_bh2_TZ, now = nowMs()) {
	const at = ns_bwiki_nowOf(now);
	return ns_bh2_eventPayloadOf(await ns_bh2_sideOf("event", signal, tz, at), tz, at);
}

// ── 注册 ───────────────────────────────────────────────────────────────────────
// 两侧同一条来源（官网公告列表）：标签按任务书提议「官网公告」（等用户复核）。
registerSource({
	id: "bh2",
	defaultHidden: false,
	tz: "Asia/Shanghai",
	name: "崩坏学园2",
	icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/3e/98/27/3e98278c-da90-7fad-e045-97098507c98d/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
	url: ns_bh2_LIST_URL,
	source: "官网公告",
	eventUrl: ns_bh2_LIST_URL,
	eventSource: "官网公告"
});
GACHA_FETCHERS["bh2"] = (url, signal, tz, now) => ns_bh2_gacha(url, signal, tz, now);
EVENT_FETCHERS["bh2"] = Object.assign(EVENT_FETCHERS["bh2"] || {}, {
	default: (url, signal, tz, now) => ns_bh2_events(url, signal, tz, now)
});


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-miyoushe-bbs.js：未定事件簿（wd）—— 米游社公告（卡池 + 活动）
// ─────────────────────────────────────────────────────────────────────────────

//
// ── 为什么换到米游社公告（2026-11-09 调研）──────────────────────────────────
// 旧调研说 `wd.mihoyo.com` 的公告 CMS 停在 2025-04-02、bwiki 子站（`cxbs`）停在 2024-03-22
// ⇒ 当时只注册条目、来源留空。本批重新实测：**米游社（bbs-api.miyoushe.com）未定事件簿版块
// forum_id=33 仍在日更**（官方号 uid 76089447，最新一条 2026-11-07 20:06），列表/详情都通。
//
//  列表 GET /post/wapi/getForumPostList?forum_id=33&is_good=false&is_hot=false&page_size=20&sort_type=2
//        裸 GET 200 / 131,563 B / retcode 0 / 20 条。每条的 `post.content` 预览里就带
//        「▶活动时间：…」（详情里的正文是同一段的完整版）。
//  详情 GET /post/wapi/getPostFull?post_id=<id>
//        **必须带 Referer: https://www.miyoushe.com/wd/**（只带 UA ⇒ 403；与星铁/原神那套
//        米游社公告同一个 Referer 门）。
//        → data.post.post.content = HTML（`<p>` 段落 + 图片 div）
//
//  字段：卡池[名称 ✓ 角色 ✓ 起止 ✓]、活动[名称 ✓ 起止 ✓]
//  代理：**必须**（响应不回 ACAO；`bbs-api.miyoushe.com` 已在宿主 PROXY_ALLOW_HOSTS 里）
//  懒加载：一次刷新 = 1 次列表 + 最多 5 篇详情（卡池/活动**各自**一份，互不影响）。
//
// ── 时间怎么写 ────────────────────────────────────────────────────────────────
//  卡池正文：「▶活动时间：2026年10月30日11:00-11月13日11:00」
//  活动正文：「▶活动时间：2026年11月5日更新后-11月12日04:00」
//  开始端可能写 `更新后`（= **起点未知**，不许猜钟点）；结束端一定带 `HH:MM`。
//  年份只写在开始端 ⇒ 结束端继承开始端年份；结束月日早于开始月日 ⇒ 跨年。
//  `更新后` 的起点按全仓口径「起点未知 ≠ 已开始」：`startTs = null`，
//    · **不进外显**（`coversNow` 要求两端都明确）⇒ 面板不会把 11-05 才开的池子当成 11-04 就在开；
//    · **仍进悬停**（`coveredOrOpen`）⇒ 事实不丢，悬停里印源站原文「2026年11月5日更新后 ~ …」。
//  可选锚点：同列表的「11月5日08:00停服更新公告」可以给出真实的开服时刻，但本批**刻意不强依赖**
//  它 —— 公告有时晚发/改期，猜错比"起点未知"更糟（与无期迷途 `开服后` 同一套取舍）。
//
// ── 两份文本（与 bwiki 通用层同一约定）────────────────────────────────────────
//   raw     = 源站原文那一句（`2026年10月30日11:00 ~ 11月13日11:00`，分隔符统一成 `~`）
//   display = 补全文本（`10-30 11:00 ~ 11-13 11:00`；起点未知时写 `11-05 更新后 ~ 11-12 04:00`）
//  外显取 display，悬停取 raw（`hoverWindowTextOf` 见到「更新后」会原样印 raw）。
//
// ── 名称 / 角色口径 ──────────────────────────────────────────────────────────
//  标题 `<池名/活动名>丨<副标题>`：取 `丨` 之前那一段当名字（`轮替女神之影更新` → 去掉尾缀
//  `更新/开启/预告` → `轮替女神之影`）；没有 `丨` 就用整条标题。
//  角色 = 正文里 `SSR/SSS/SR/MR【…】` 的**思绪名**（与 `30-game-netease.js` 的画灵名同口径），
//  多个用「、」连接。例：`莫弈SSS【雪愿相宜】` → `雪愿相宜`。
//
// ── 失败语义 ─────────────────────────────────────────────────────────────────
//  · 列表 HTTP 非 2xx / 不是 JSON / `retcode !== 0` / `data.list` 不是数组 → **抛**（该侧记失败）；
//  · 列表为空 → null（源站没数据 = 未公布）；
//  · 单篇详情 404/410 / `retcode 1101/1102`（post not exist）→ 跳过该篇；
//    全部候选都失败且出现过硬错 → **抛**（别把 403/封禁静默成「未公布」）；
//  · 抓到正文但没有任何窗口覆盖 now → null（不硬凑过期档期）。
//
// ── 时区 ──
//  正文墙钟是国服 UTC+8（源站未标注，按国服惯例推定；只写在注释里，不进悬停）。

		const WD_TZ = "Asia/Shanghai";
		const WD_LIST_URL = "https://bbs-api.miyoushe.com/post/wapi/getForumPostList?forum_id=33&is_good=false&is_hot=false&page_size=20&sort_type=2";
		const WD_DETAIL_BASE = "https://bbs-api.miyoushe.com/post/wapi/getPostFull";
		// 详情端点的 Referer 门（实测：只带 UA ⇒ 403 / 带 miyoushe.com/wd/ ⇒ 200）
		const WD_REFERER = "https://www.miyoushe.com/wd/";
		const WD_MAX_DETAILS = 5;

		// 标题分流：卡池关键词优先（`雪愿相宜丨活动女神之影开启` 同时含"活动"与"女神之影"）。
		// ⚠️ 活动词表里**不放「登录」**：本周实测列表里「部分安卓设备登录时闪退问题处理说明」
		//    会因此被误判成活动，白白多抓一篇详情（其余词也验过：闪退/修复/更新都不含）。
		const WD_GACHA_KW = /女神之影|概率提升|限时返场|概率UP|启示/;
		const WD_EVENT_KW = /活动|征集|赛事|签到|庆典|有奖|话题|抽奖|投票|答题|委托|福利/;

		function wdDetailUrl(postId) {
			return `${WD_DETAIL_BASE}?post_id=${encodeURIComponent(String(postId))}`;
		}

		function wdParseList(json) {
			if (!json || typeof json !== "object") throw new Error("wd-bad-shape");
			if (json.retcode !== 0) throw new Error("wd-retcode-" + json.retcode);
			const list = json.data && json.data.list;
			if (!Array.isArray(list)) throw new Error("wd-bad-list");
			const out = [];
			for (const it of list) {
				const p = it && it.post;
				if (!p || p.post_id == null || p.post_id === "") continue;
				const sec = Number(p.created_at);
				out.push({
					// 源站是字符串；URL 与夹具都按它拼
					postId: String(p.post_id),
					subject: String(p.subject || "").replace(/\s+/g, " ").trim(),
					createdTs: Number.isFinite(sec) && sec > 0 ? sec * 1000 : null
				});
			}
			return out;
		}

		function wdParseDetail(json) {
			if (!json || typeof json !== "object") throw new Error("wd-bad-shape");
			if (json.retcode !== 0) throw new Error("wd-retcode-" + json.retcode);
			const p = json.data && json.data.post && json.data.post.post;
			if (!p || p.post_id == null) throw new Error("wd-bad-post");
			return {
				postId: String(p.post_id),
				subject: String(p.subject || "").replace(/\s+/g, " ").trim(),
				content: String(p.content || "")
			};
		}

		function wdClassify(subject) {
			const t = String(subject == null ? "" : subject);
			if (WD_GACHA_KW.test(t)) return "gacha";
			if (WD_EVENT_KW.test(t)) return "event";
			return "unknown";
		}

		// 「这篇拿不到」≠「这一侧失败」：详情对不存在的 post 回 HTTP 200 + retcode 1101/1102
		function wdIsMissing(err) {
			const m = String((err && err.message) || err || "");
			return /\b(404|410)\b/.test(m) || /wd-retcode-(1101|1102)\b/.test(m);
		}

		// ── 时间窗口 ────────────────────────────────────────────────────────────
		// 完整日期 `2026年10月30日11:00` / `2026年11月5日更新后`，或省年份 `11月13日11:00`。
		const WD_POINT_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(?:(\d{1,2})\s*[:：]\s*(\d{2})|(更新后))?|(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(?:(\d{1,2})\s*[:：]\s*(\d{2})|(更新后))?/g;
		const WD_CONNECTOR_RE = /^\s*[-~～〜—–－至到]\s*$/;

		function wdPointsOf(text) {
			const s = String(text == null ? "" : text);
			const out = [];
			WD_POINT_RE.lastIndex = 0;
			let m;
			while ((m = WD_POINT_RE.exec(s))) {
				if (m[0] === "") { WD_POINT_RE.lastIndex++; continue; }
				const abs = m[1] != null;
				out.push({
					start: m.index,
					end: m.index + m[0].length,
					y: abs ? +m[1] : null,
					mo: abs ? +m[2] : +m[7],
					d: abs ? +m[3] : +m[8],
					h: abs ? (m[4] != null ? +m[4] : null) : (m[9] != null ? +m[9] : null),
					mi: abs ? (m[5] != null ? +m[5] : null) : (m[10] != null ? +m[10] : null),
					open: (abs ? m[6] : m[11]) === "更新后"
				});
			}
			return out;
		}

		// 正文 → 窗口事实 [{ startTs, endTs, raw, display }]（按区间去重，保留文档顺序）
		function wdWindowsOf(text, tz = WD_TZ) {
			const s = String(text == null ? "" : text);
			const toks = wdPointsOf(s);
			const out = [];
			const seen = new Set();
			for (let i = 0; i + 1 < toks.length; i++) {
				const a = toks[i], b = toks[i + 1];
				if (!WD_CONNECTOR_RE.test(s.slice(a.end, b.start))) continue;
				// 端点必须能定：起点要「完整日期 + 时刻」或「完整日期 + 更新后」；终点要时刻
				if (a.y == null) continue;
				if (a.h == null && !a.open) continue;
				if (b.h == null) continue;
				const endY = b.y != null ? b.y : a.y + (endsNextYear(a.mo, a.d, b.mo, b.d) ? 1 : 0);
				const startTs = a.open ? null : sourceInstant(a.y, a.mo, a.d, a.h, a.mi, tz);
				const endTs = sourceInstant(endY, b.mo, b.d, b.h, b.mi, tz);
				if (startTs != null && !(endTs > startTs)) continue;
				const key = (startTs == null ? "open" : startTs) + "|" + endTs;
				if (seen.has(key)) continue;
				seen.add(key);
				const aRaw = s.slice(a.start, a.end).replace(/\s+/g, " ").trim();
				const bRaw = s.slice(b.start, b.end).replace(/\s+/g, " ").trim();
				// 跨年时 display 两端都带年份（与 fmtWindow 同一规则）；起点未知时保留「更新后」，
				// 不编造钟点（`startTs = null` 那一侧本来就进不了外显）。
				const endWall = sourceWallParts(endTs, tz);
				const startWall = a.open ? { y: a.y, mo: a.mo, d: a.d } : sourceWallParts(startTs, tz);
				const sameYear = startWall.y === endWall.y;
				let startText;
				if (a.open) {
					startText = sameYear
						? `${pad2(a.mo)}-${pad2(a.d)} 更新后`
						: `${a.y}-${pad2(a.mo)}-${pad2(a.d)} 更新后`;
				} else {
					startText = sameYear ? fmtMdHm(startTs, tz) : fmtYmdHm(startTs, tz);
				}
				const endText = sameYear ? fmtMdHm(endTs, tz) : fmtYmdHm(endTs, tz);
				out.push({ startTs, endTs, raw: `${aRaw} ~ ${bRaw}`, display: `${startText} ~ ${endText}` });
			}
			return out;
		}

		// 正文里的思绪名（`莫弈SSS【雪愿相宜】` → 雪愿相宜）。只认带稀有度前缀的【…】，
		// 避免把【女神之泪】【泪之痕】这类道具当成角色。
		const WD_CARD_RE = /(?:SSR|SSS|SR|MR)\s*(?:思绪|画灵)?\s*【([^】]+)】/g;
		function wdRolesOf(text) {
			const s = String(text == null ? "" : text);
			const out = [], seen = new Set();
			WD_CARD_RE.lastIndex = 0;
			let m;
			while ((m = WD_CARD_RE.exec(s))) {
				const n = m[1].replace(/[（(].*$/, "").trim();
				if (!n || seen.has(n)) continue;
				seen.add(n);
				out.push(n);
			}
			return out.join("\u3001");
		}

		// 标题 → 名字：`轮替女神之影更新丨左然SSR【风烛引归】限时返场` → `轮替女神之影`
		function wdNameOf(subject) {
			const s = String(subject == null ? "" : subject).replace(/\s+/g, " ").trim();
			const head = s.split("丨")[0].trim();
			return head.replace(/(?:更新|开启|预告)$/, "").trim() || s;
		}

		// ── 抓取：列表 → 按标题分流 → 逐篇详情 → 抽窗口 ──────────────────────────
		async function wdCollectSide(listUrl, signal, tz, want) {
			const listJson = await fetchJson(listUrl || WD_LIST_URL, { signal, mode: "proxy", referer: WD_REFERER });
			const items = wdParseList(listJson);
			if (items.length === 0) return null;
			const cands = items.filter((it) => wdClassify(it.subject) === want).slice(0, WD_MAX_DETAILS);
			if (cands.length === 0) return null;
			const rows = [];
			let okCount = 0, firstHardErr = null;
			for (const it of cands) {
				let d;
				try {
					d = wdParseDetail(await fetchJson(wdDetailUrl(it.postId), { signal, mode: "proxy", referer: WD_REFERER }));
				} catch (e) {
					if (!wdIsMissing(e) && !firstHardErr) firstHardErr = e;
					continue;
				}
				okCount++;
				const text = textOf(d.content || "");
				const subject = d.subject || it.subject;
				const name = wdNameOf(subject);
				const roles = wdRolesOf(text);
				for (const w of wdWindowsOf(text, tz)) rows.push({ ...w, subject, name, roles, postId: d.postId });
			}
			// 一篇都没拿到、且出现过硬错（403 / 567 / 坏 JSON）⇒ 抛出去（别把封禁静默成未公布）
			if (okCount === 0) {
				if (firstHardErr) throw firstHardErr;
				return null;
			}
			return rows;
		}

		async function fetchWdGacha(url, signal, tz = WD_TZ) {
			const at = nowMs();
			const rows = await wdCollectSide(url, signal, tz, "gacha");
			if (!rows || rows.length === 0) return null;
			// 外显：两端都明确且覆盖 now（起点未知的池**不**进外显）
			const live = rows.filter((r) => coversNow(r, at));
			if (live.length === 0) return null;
			live.sort((a, b) => (a.endTs - b.endTs) || ((a.startTs == null ? Infinity : a.startTs) - (b.startTs == null ? Infinity : b.startTs)));
			const first = live[0];
			// 悬停：在期 ∪ 起点未知但终点未过（全仓口径，见文件头）
			const hoverItems = rows.filter((r) => coveredOrOpen(r, at)).sort(poolHoverOrderOf).map((r) => {
				const label = r.roles ? `${r.name}\uFF1A${r.roles}` : r.name;
				return { title: label, label, startTs: r.startTs, endTs: r.endTs, raw: r.raw };
			});
			const hover = hoverTextFromItems(hoverItems, "gacha", tz);
			const out = {
				banner: first.name,
				roles: first.roles,
				bannerDates: first.display,
				bannerDatesRaw: first.raw,
				startTs: first.startTs,
				endTs: first.endTs,
				...(hover ? { bannerHover: hover } : {})
			};
			out.gacha = dataArrayProducedGachaOf(out, hoverItems, { id: "wd", tz }, at);
			out.gachaHoverItems = hoverItems;
			return out;
		}

		async function fetchWdEvents(url, signal, tz = WD_TZ) {
			const at = nowMs();
			const rows = await wdCollectSide(url, signal, tz, "event");
			if (!rows || rows.length === 0) return null;
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
			out.events = dataArrayProducedEventsOf(out, hoverItems, { id: "wd", tz }, at);
			out.eventHoverItems = hoverItems;
			return out;
		}

		// ── 条目 ──
		registerSource({
			id: "wd",
			defaultHidden: false,
			tz: WD_TZ,
			name: "未定事件簿",
			icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/bd/c8/ad/bdc8ad3c-1bd5-debe-90b9-e67ea22578de/AppIcon-1x_U007emarketing-0-8-0-85-220-0.png/512x512bb.jpg",
			source: "米游社公告",
			url: WD_LIST_URL,
			eventSource: "米游社公告",
			eventUrl: WD_LIST_URL
		});

		GACHA_FETCHERS["wd"] = (url, signal, tz) => fetchWdGacha(url, signal, tz);
		EVENT_FETCHERS["wd"] = {
			default: (url, signal, tz) => fetchWdEvents(url, signal, tz)
		};


// ─────────────────────────────────────────────────────────────────────────────
// ── 并入 30-game-batch2.js 的 ① 段：崩坏3 内容中台（bh3 卡池 / 活动默认源）
// ─────────────────────────────────────────────────────────────────────────────

// ── ① 崩坏3 `bh3`（卡池 + 活动）—— 米哈游内容中台 ─────────────────────────────────
//   GET https://act-api-takumi-static.mihoyo.com/content_v2_user/app/b9d5f96cd69047eb/getContentList
//       ?iChanId=697&iPageSize=30&iPage=1&sLangKey=zh-cn      ← 卡池频道
//       ?iChanId=696&iPageSize=30&iPage=1&sLangKey=zh-cn      ← 活动频道
//     `b9d5f96cd69047eb` = bh3.mihoyo.com 前端里的 appId（与米游社 BBS 那套是两个接口，别混）。
//     实测 2026-11-11 00:53 +08：卡池 200 / application/json / 151 KB / iTotal=863；
//                               活动 200 / application/json / 约 150 KB / iTotal=687。
//     响应 `{ retcode:0, message:"OK", data:{ iTotal, list:[{ iInfoId, sTitle, sContent(HTML), dtStartTime, dtEndTime }] } }`；
//     `Access-Control-Allow-Origin: *`（直连也通），这里仍走宿主代理 —— 与仓库其它来源同一条路径，
//     且能带 `Referer: https://bh3.mihoyo.com/`（实测源站不校验，但保持浏览器形态）。白名单见 src/index.js。
//
//   · 卡池：名称 + 正文里能确定的角色 + **档期**。档期三级取值（2026-11-11 二次实测 697 频道 30 条逐条）：
//       ① `>>开放时间` 文本块 —— 跃升武装 / 跃升补给 / 庆典（角色·装备）/ 时光追忆 / 服装补给这些类别有
//          （例：跃升武装「龙威燎天烈&游戏人生」→ `11月6日12:00~11月26日04:00`）；
//       ② 同帖「商城礼包【上架时间】」那几行 —— 标准双池（角色补给 / 装备补给）的正文只有图片
//          `>>补给信息`，但**礼包窗口与补给窗口一致**（跃升武装/跃升补给三条同帖文本互证：
//          礼包 `11月6日12:00~11月26日04:00` == 同帖 `>>开放时间` 的区间）；
//       ③ 两处都没有 ⇒ **只出名称/角色、不起档期**（`bannerDates` / `bannerDatesRaw` 留空，显示层按长期画）。
//     ⚠️ `dtEndTime` **一个字节都不读**：30/30 恒为 `2035-01-01 00:00:00` 占位（源站的"无结束"哨兵）。
//        上一版把它当权威 ⇒ 整批档期落在 2035；这一版宁可留空，也不把哨兵当年份。
//     `dtStartTime` 不当补给开始时刻（实测 跃升武装帖 `dtStartTime`=11-03 18:30，而 `>>开放时间` 写 11-06 12:00
//     —— 前者是帖子/内容上线时刻，不是开池时刻），只作两用：**年份线索**（`inferYear`）与「帖已发布」判据。
//     在期 = 档期两端明确且 `coveredOrOpen`；并列时按「开始更晚 → 帖更晚」取一条当外显，
//     悬停/数组收全部在期池（`poolHoverOrderOf`，结束升序）。一条都不在期 ⇒ 退回「已发布的最新一帖」、
//     档期留空 —— 不拿已经过去的窗口冒充当期。
//     角色：只认正文 `S级角色「X」` / `A级女武神角色卡「Y」`；标题 `角色补给丨X` 仅在该帖正文没写角色时兜底
//     （`庆典角色补给丨镇×偃月叩晓等目标限时UP` 会拆成 镇 / 偃月叩晓）。装备补给里的武器/圣痕名字**不当角色**。
//   · 活动：标题 + 正文「>>开放时间 / 【活动时间】」块里的区间。实测 30 条里 27 条有时间块；
//       其余 3 条（主线更新稿）正文没有时间块 ⇒ **如实跳过**，不补时刻。
//       区间两种写法：
//         `11月12日10:00~11月26日04:00`             ← 两端绝对时刻
//         `9.1版本更新后~11月6日12:00`               ← 起点是相对表述 ⇒ startTs=null（仓库口径），raw 原样保留
//       无年份：借 `dtStartTime` 的年份与月份（共用 `inferYear`）；结束月日小于开始 ⇒ 次年（`endsNextYear`）。
//     标题就是源站标题（`晚秋拾光丨参与活动获取3★圣痕等奖励`），不拆「丨」后半句 —— 与其它来源一致。

const NS_BATCH2_BH3_TZ = "Asia/Shanghai";
const NS_BATCH2_BH3_REFERER = "https://bh3.mihoyo.com/";
const NS_BATCH2_BH3_GACHA_URL = "https://act-api-takumi-static.mihoyo.com/content_v2_user/app/b9d5f96cd69047eb/getContentList?iChanId=697&iPageSize=30&iPage=1&sLangKey=zh-cn";
const NS_BATCH2_BH3_EVENT_URL = "https://act-api-takumi-static.mihoyo.com/content_v2_user/app/b9d5f96cd69047eb/getContentList?iChanId=696&iPageSize=30&iPage=1&sLangKey=zh-cn";
const NS_BATCH2_BH3_SOURCE_LABEL = "官网公告";

// ═══════════════════════════════════════════════════════════════════════════════
// ① 崩坏3：内容中台 JSON → 卡池 / 活动条目事实
// ═══════════════════════════════════════════════════════════════════════════════

/** 内容中台的 `sContent` 是 HTML（`<p>` / `<br>` / `<strong>`）→ 纯文本；块边界保留换行。 */
function ns_batch2_bh3Text(html) {
	return String(html == null ? "" : html)
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|li|h[1-6]|tr|td)>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&")
		.replace(/&nbsp;/g, " ").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
		.replace(/[ \t\u00a0]+/g, " ")
		.replace(/\n{2,}/g, "\n")
		.trim();
}

/** `dtStartTime` / `dtEndTime` 是**源站墙钟**（`2026-11-04 18:00:00`，无时区标记）→ 拆成字段。 */
function ns_batch2_bh3WallOf(s) {
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/.exec(String(s == null ? "" : s).trim());
	if (!m) return null;
	return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), h: Number(m[4]), mi: Number(m[5]) };
}

/** 墙钟字段 → 绝对毫秒（按条目 tz）。 */
function ns_batch2_bh3InstantOf(hint, tz) {
	return sourceInstant(hint.y, hint.mo, hint.d, hint.h, hint.mi, tz);
}

// 区间两种写法（`raw` 保留源站原文；分隔符实测有 `~` / `～` / `-` / `–`）：
//   `11月12日10:00~11月26日04:00`
//   `9.1版本更新后~11月6日12:00`
const NS_BATCH2_BH3_ABS_RANGE_RE = /(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})\s*[~～\-–—]\s*(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/;
const NS_BATCH2_BH3_REL_RANGE_RE = /(?:\d+(?:\.\d+)?\s*版本更新后|版本更新后|维护后|更新后|开服后)\s*[~～\-–—]\s*(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/;

/** 一段匹配到的区间文本 → `{ startTs, endTs, raw, display }`；读不出返回 null（不硬凑）。 */
function ns_batch2_bh3RangeOf(text, hint, tz) {
	const s = String(text == null ? "" : text);
	const a = NS_BATCH2_BH3_ABS_RANGE_RE.exec(s);
	if (a) {
		const sm = Number(a[1]), sd = Number(a[2]), sh = Number(a[3]), smi = Number(a[4]);
		const em = Number(a[5]), ed = Number(a[6]), eh = Number(a[7]), emi = Number(a[8]);
		const sy = inferYear(null, sm, hint);
		let ey = inferYear(null, em, hint);
		if (sy == null || ey == null) return null;
		if (endsNextYear(sm, sd, em, ed)) ey += 1;
		const startTs = sourceInstant(sy, sm, sd, sh, smi, tz);
		const endTs = sourceInstant(ey, em, ed, eh, emi, tz);
		if (!(endTs > startTs)) return null;
		return { startTs, endTs, raw: a[0], display: fmtWindow(startTs, endTs, tz) };
	}
	const r = NS_BATCH2_BH3_REL_RANGE_RE.exec(s);
	if (r) {
		const em = Number(r[1]), ed = Number(r[2]), eh = Number(r[3]), emi = Number(r[4]);
		let ey = inferYear(null, em, hint);
		if (ey == null) return null;
		const hintTs = ns_batch2_bh3InstantOf(hint, tz);
		let endTs = sourceInstant(ey, em, ed, eh, emi, tz);
		// 「12月30日更新后 ~ 1月5日」这类跨年：补一个年份再解一次
		if (endTs < hintTs - 60 * 864e5) endTs = sourceInstant(ey + 1, em, ed, eh, emi, tz);
		if (!(endTs > hintTs - 400 * 864e5)) return null;
		// 起点是相对表述 ⇒ startTs=null（仓库口径：起点未知 ≠ 已开始），display 原样保留原文
		return { startTs: null, endTs, raw: r[0], display: r[0] };
	}
	return null;
}

/** 一段文本里的全部区间（按出现顺序；同一段 raw 只留一次）。 */
function ns_batch2_bh3RangesOf(text, hint, tz) {
	const s = String(text == null ? "" : text);
	const found = [];
	for (const re of [NS_BATCH2_BH3_ABS_RANGE_RE, NS_BATCH2_BH3_REL_RANGE_RE]) {
		const g = new RegExp(re.source, "g");
		let m;
		while ((m = g.exec(s)) !== null) {
			const w = ns_batch2_bh3RangeOf(m[0], hint, tz);
			if (w) found.push({ index: m.index, w });
			if (m.index === g.lastIndex) g.lastIndex++;
		}
	}
	found.sort((x, y) => x.index - y.index);
	const out = [];
	const seen = new Set();
	for (const it of found) {
		if (seen.has(it.w.raw)) continue;
		seen.add(it.w.raw);
		out.push(it.w);
	}
	return out;
}

// 活动正文的时间块标签：`>>开放时间` / `【活动时间】` 两种（简繁都收）。
const NS_BATCH2_BH3_TIME_LABEL_RE = /(?:【(?:活动|活動|开放|開放)(?:时间|時間)】|>>\s*(?:活动|活動|开放|開放)(?:时间|時間))/;

/** 截出「标签 → 下一个 `【` / `>>` / `=====` 标签」之间的那段正文。 */
function ns_batch2_bh3BlockAfter(text, labelRe) {
	const t = String(text == null ? "" : text);
	const m = labelRe.exec(t);
	if (!m) return "";
	const rest = t.slice(m.index + m[0].length);
	const stop = rest.search(/\n\s*(?:【|>>|=====)/);
	return (stop >= 0 ? rest.slice(0, stop) : rest).trim();
}

/** 活动正文里的时间块（`>>开放时间` / `【活动时间】`）。 */
function ns_batch2_bh3EventBlockOf(text) {
	return ns_batch2_bh3BlockAfter(text, NS_BATCH2_BH3_TIME_LABEL_RE);
}

/** 多段窗口里挑一段：优先覆盖 now 的（相对起点的 startTs=null 也接受），否则结束最早的那段。 */
function ns_batch2_bh3PickWindowOf(wins, now) {
	const list = Array.isArray(wins) ? wins.filter(Boolean) : [];
	if (list.length === 0) return null;
	const open = list.filter((w) => coveredOrOpen(w, now));
	const pool = open.length > 0 ? open : list;
	return pool.slice().sort((a, b) => (a.endTs - b.endTs))[0];
}

/** 一条活动帖的**那一段**窗口：块内多段时取覆盖 now 的（或结束最近的）那段。 */
function ns_batch2_bh3EventWindowOf(text, hint, tz, now) {
	const block = ns_batch2_bh3EventBlockOf(text);
	// ⚠️ **只认时间标签块**，不在全文里兜底找区间：正文里的「金币商店 11月23日04:00~11月26日04:00」
	//    这类子窗口会被误当成活动期（2026-11-11 实测 30 条里 13 条没有活动时间块，全文兜底会把
	//    其中 11 条硬凑出一条假档期）。没有块 ⇒ 这条帖如实不进日历，**不补时刻**。
	return ns_batch2_bh3PickWindowOf(block ? ns_batch2_bh3RangesOf(block, hint, tz) : [], now);
}

/** 活动频道 → 条目事实数组（无窗口的帖如实跳过）。 */
function ns_batch2_bh3EventItemsOf(json, tz, now) {
	const list = json && json.data && Array.isArray(json.data.list) ? json.data.list : null;
	if (!list) throw new Error("bh3-bad-json");
	const out = [];
	for (const it of list) {
		const hint = ns_batch2_bh3WallOf(it.dtStartTime);
		if (!hint) continue;
		const title = String(it.sTitle == null ? "" : it.sTitle).trim();
		if (!title) continue;
		const w = ns_batch2_bh3EventWindowOf(ns_batch2_bh3Text(it.sContent), hint, tz, now);
		if (!w) continue;
		out.push({
			key: String(it.iInfoId == null ? "" : it.iInfoId),
			title,
			show: title,
			startTs: w.startTs,
			endTs: w.endTs,
			tz,
			raw: w.raw,
			display: w.display,
			source: "hover"
		});
	}
	return out;
}

// 卡池正文里明确的角色写法：`S级角色「愈生佑翎」` / `A级女武神角色卡「午夜苦艾」`
const NS_BATCH2_BH3_ROLE_RE = /([SA])级(?:女武神)?角色(?:卡)?\s*[「『]([^」』]+)[」』]/g;

/** 补给正文 → 角色名数组（只认明确写法；正文没有时对「角色补给丨X」标题做一次保守兜底）。 */
function ns_batch2_bh3RolesOf(item) {
	const text = ns_batch2_bh3Text(item && item.sContent);
	const roles = [];
	const re = new RegExp(NS_BATCH2_BH3_ROLE_RE.source, "g");
	let m;
	while ((m = re.exec(text)) !== null) {
		const name = m[2].trim();
		if (name && roles.indexOf(name) < 0) roles.push(name);
	}
	if (roles.length === 0) {
		const title = String((item && item.sTitle) || "");
		if (/^(?:庆典)?角色补给[丨|]/.test(title)) {
			const tail = title.split(/[丨|]/).slice(1).join("丨")
				.replace(/[「」『』]/g, "")
				.replace(/等.*$/, "")
				.trim();
			if (tail) {
				for (const name of tail.split(/[×✕]/)) {
					const n = name.trim();
					if (n && roles.indexOf(n) < 0) roles.push(n);
				}
			}
		}
	}
	return roles;
}

// 补给档期的两个可选来源（见文件头①的三级取值）。
//   ① `>>开放时间` 块（与活动侧同一个标签族，但这里**只**取开放时间，不含活动时间）
//   ② 同帖「商城礼包【上架时间】」行
const NS_BATCH2_BH3_OPEN_LABEL_RE = /(?:【(?:开放|開放)(?:时间|時間)】|>>\s*(?:开放|開放)(?:时间|時間))/;

/** 「商城礼包【上架时间】」行的窗口（一帖可能有多行/多个礼包；同一区间只留一次）。 */
function ns_batch2_bh3GiftWindowsOf(text, hint, tz) {
	const out = [];
	const seen = new Set();
	for (const line of String(text == null ? "" : text).split("\n")) {
		if (line.indexOf("【上架时间】") < 0) continue;
		for (const w of ns_batch2_bh3RangesOf(line, hint, tz)) {
			if (seen.has(w.raw)) continue;
			seen.add(w.raw);
			out.push(w);
		}
	}
	return out;
}

/**
 * 一条补给帖的**档期**：`>>开放时间` 优先 → 同帖「【上架时间】」兜底 → 都没有 ⇒ null（只出名称/角色）。
 * ⚠️ 不读 `dtEndTime`（恒 2035 占位）。
 */
function ns_batch2_bh3GachaWindowOf(text, hint, tz, now) {
	const openWins = ns_batch2_bh3RangesOf(
		ns_batch2_bh3BlockAfter(text, NS_BATCH2_BH3_OPEN_LABEL_RE), hint, tz);
	const wins = openWins.length > 0 ? openWins : ns_batch2_bh3GiftWindowsOf(text, hint, tz);
	return ns_batch2_bh3PickWindowOf(wins, now);
}

/**
 * 卡池频道 → 载荷。档期取「在期池」；一条都不在期 ⇒ 只出名称/角色（日期留空），不把过去的窗口当当期。
 * 外显：在期池里按「开始更晚 → 帖更晚」取一条；悬停/数组：全部在期池（结束升序）。
 */
function ns_batch2_bh3GachaPayloadOf(json, tz, now) {
	const list = json && json.data && Array.isArray(json.data.list) ? json.data.list : null;
	if (!list) throw new Error("bh3-bad-json");
	const rows = [];
	for (const it of list) {
		const hint = ns_batch2_bh3WallOf(it.dtStartTime);
		if (!hint) continue;
		const title = String(it.sTitle == null ? "" : it.sTitle).trim();
		if (!title) continue;
		const text = ns_batch2_bh3Text(it.sContent);
		rows.push({
			title,
			roles: ns_batch2_bh3RolesOf(it).join("、"),
			postedTs: ns_batch2_bh3InstantOf(hint, tz),                 // `dtStartTime` = 帖子/内容上线时刻
			win: ns_batch2_bh3GachaWindowOf(text, hint, tz, now)
		});
	}
	const started = rows.filter((r) => r.postedTs <= now);
	if (started.length === 0) return null;                            // 一期都还没发布 = 未公布
	const live = started.filter((r) => r.win && coveredOrOpen(r.win, now));
	const startOf = (r) => (r.win && r.win.startTs != null ? r.win.startTs : 0);
	let primary;
	let win = null;
	if (live.length > 0) {
		primary = live.slice().sort((a, b) => (startOf(b) - startOf(a)) || (b.postedTs - a.postedTs))[0];
		win = primary.win;
	} else {
		primary = started.slice().sort((a, b) => b.postedTs - a.postedTs)[0];
	}
	const out = {
		banner: primary.title,
		roles: primary.roles,
		bannerDates: win ? win.display : "",
		bannerDatesRaw: win ? win.raw : ""
	};
	let entries = [];
	if (live.length > 0) {
		// ⚠️ 先摊平成条目事实、**再**排序：`poolHoverOrderOf` 读的是 `endTs` / `startTs`，
		//    直接对 `{ win: {…} }` 那层排会全是 undefined（= 全 Infinity，顺序等于没排）。
		entries = live.map((r) => ({
			title: r.title,
			label: r.roles ? `${r.title}：${r.roles}` : r.title,
			startTs: r.win.startTs,
			endTs: r.win.endTs,
			raw: r.win.raw
		})).sort(poolHoverOrderOf);
		const hover = hoverTextFromItems(entries, "gacha", tz);
		if (hover) out.bannerHover = hover;
		out.gachaHoverItems = entries;
	}
	out.gacha = dataArrayProducedGachaOf(out, entries, { tz }, now);
	return out;
}

/** 活动条目事实 → 载荷（当期 = 覆盖 now 且开始最晚的那条）。 */
function ns_batch2_bh3EventPayloadOf(items, tz, now) {
	const listed = (items || []).filter((x) => coveredOrOpen(x, now));
	const primary = listed.filter((x) => coversNow(x, now)).sort((a, b) => b.startTs - a.startTs)[0] || null;
	if (!primary) return null;
	const entries = sortEventItems(listed.map((x) => Object.assign({}, x, { name: x.title })));
	const out = { event: primary.title, eventDates: primary.display, eventDatesRaw: primary.raw };
	const hover = hoverTextFromItems(entries, "event", tz);
	if (hover) out.eventHover = hover;
	out.events = dataArrayProducedEventsOf(out, entries, { tz }, now);
	out.eventHoverItems = entries;
	return out;
}

/** 卡池抓取器（经宿主代理；`iChanId=697`）。 */
async function ns_batch2_fetchBh3Gacha(url, signal, tz = NS_BATCH2_BH3_TZ) {
	const json = await proxyFetchJson(url || NS_BATCH2_BH3_GACHA_URL, NS_BATCH2_BH3_REFERER);
	return ns_batch2_bh3GachaPayloadOf(json, tz, nowMs());
}

/** 活动抓取器（经宿主代理；`iChanId=696`）。 */
async function ns_batch2_fetchBh3Events(url, signal, tz = NS_BATCH2_BH3_TZ) {
	const json = await proxyFetchJson(url || NS_BATCH2_BH3_EVENT_URL, NS_BATCH2_BH3_REFERER);
	const now = nowMs();
	return ns_batch2_bh3EventPayloadOf(ns_batch2_bh3EventItemsOf(json, tz, now), tz, now);
}

// bh3 条目本体仍在 30-game-hoyoverse.js（图标 / 米游社备选源在那边）；这里只补两个抓取器。
// 卡池默认源 = 内容中台 697；活动默认源 = 内容中台 696；米游社备选源保留（用户仍可在设置页切）。
GACHA_FETCHERS["bh3"] = (url, signal, tz) => ns_batch2_fetchBh3Gacha(url, signal, tz);
EVENT_FETCHERS["bh3"] = Object.assign(EVENT_FETCHERS["bh3"] || {}, {
	default: (url, signal, tz) => ns_batch2_fetchBh3Events(url, signal, tz)
});
