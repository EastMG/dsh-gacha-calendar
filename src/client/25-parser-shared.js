// src/client/25-parser-shared.js —— 共用判定 / 悬停排版 / 解码 / 时间 / 选择
//
// ⚠️ 2026-10-03 重组（用户要求「28 款一视同仁」）：不再有「内置 11 款 / 另外 17 款」的文件分层，
//    每款/每组游戏一个**自包含**文件（条目 + 解析器 + 抓取器 + 登记）。
//    本次只挪位置，**符号名一个都没改** —— 所以导出表、注册表快照、所有用例都不受影响。
//
// ⚠️ 这些文件在 core 产物里位于 `createEngine` **内部**，每建一个引擎都会重跑一遍 →
//    对 `SOURCES` 的写操作**必须幂等**（统一走 `registerSource`，它按 id 找到就合并、否则追加）。

		//#region scrape parsers
		// 纯函数解析器：同一 HTML 输入必然产生同一输出（确定性），
		// 保证网页内容未变时手动刷新结果保持一致。
		function stripTags(s) {
			return (s || "")
				.replace(/<br\s*\/?>/gi, " ")
				.replace(/<[^>]+>/g, "")
				.replace(/&amp;/g, "&")
				.replace(/&lt;/g, "<")
				.replace(/&gt;/g, ">")
				.replace(/&quot;/g, '"')
				.replace(/&#91;/g, "[")
				.replace(/&#93;/g, "]")
				.replace(/&#39;/g, "'")
				.replace(/&#8211;/g, "\u2013")
				.replace(/&#160;/g, " ")
				.replace(/&nbsp;/g, " ")
				// 通用数字实体兜底：源站会用**白名单之外**的数字实体（FGO 卡池一览实测 89 处 `&#32;`，
				// 即空格），旧实现只认上面那几个硬编码 → 面板上直接显示成
				// `阿蒂拉&#32; 罗摩&#32; 兰斯洛特(Saber)&#32; …`（2026-10-03 修）。
				// 位置刻意放在硬编码白名单**之后**：已知实体优先，尽量不改变既有解析结果。
				// 注：`next-sources/lib/env.js` 的 decodeEntities 本来就是通用实现，
				//     这次补齐后两者语义一致，不再有"测试对、插件错"的落差。
				.replace(/&#(\d+);/g, (m, n) => {
					try { return String.fromCodePoint(Number(n)); } catch { return m; }
				})
				.replace(/\s+/g, " ")
				.trim();
		}


		// 解析单个时间 → {ts, text}；无法解析返回 {ts:null, text:null}
		// `tz`（可选）= 源站墙钟时区（见 15-env.js / 20-sources.js 的 `tz`）。
		// 传了 → 绝对时刻按**源站时区**换算；不传 → 沿用本机时区（= 改造前行为）。
		// **text 一律是源站墙钟原文**，不随 tz 变 —— 玩家看游戏内公告走的就是这串时间。
		//
		// 兜底：`sourceInstant` 定义在 15-env.js。若调用方只把本文件单独抽出来用
		// （回归脚本用 `new Function` 注入单个函数、或把 core 拆到别处），它可能不在作用域；
		// 那时退回 `new Date(...)`（本机时区）而不是抛 ReferenceError ——
		// 少一次时区换算，但绝不让"抽函数"这种用法直接崩掉。
		function parseTime(s, tz) {
			const mkTs = (y, mo, d, h, mi) => (typeof sourceInstant === "function"
				? sourceInstant(y, mo, d, h, mi, tz)
				: new Date(y, mo - 1, d, h, mi).getTime());
			const m = String(s).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
			if (m) {
				const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4]), mi = Number(m[5]);
				const text = `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
				return { ts: mkTs(y, mo, d, h, mi), text };
			}
			// 回退：`YYYY/MM/DD <版本更新后>`（日期 + 版本标签，缺时分）→ 按锚点时刻补全。
			// 注意只认**带日期前缀**的这种；纯标签（`4.6版本更新后`）保持 null —— 那种确实
			// 给不出日期（下一版本何时更新是未知的），硬造时间会错得更离谱。
			const v = String(s).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s*(?:\d+(?:\.\d+)?\s*版本更新后|版本更新后)/);
			if (v) {
				const y = Number(v[1]), mo = Number(v[2]), d = Number(v[3]);
				const { h, mi } = VERSION_UPDATE_ANCHOR;
				const text = `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
				return { ts: mkTs(y, mo, d, h, mi), text };
			}
			return { ts: null, text: null };
		}


		// 时间段 → startTs/endTs + 统一文本 mm-dd hh:mm ~ mm-dd hh:mm（无法解析的一侧保留原文）
		// `tz` 同 parseTime：源站墙钟时区（可选，不传 = 本机时区）
		function parseRange(raw, tz) {
			const t = stripTags(raw);
			const parts = t.split(/~/).map((x) => x.trim());
			if (parts.length < 2) {
				const p = parseTime(parts[0], tz);
				return { startTs: p.ts, endTs: null, startText: p.text, endText: null, raw: p.text ?? t };
			}
			const a = parseTime(parts[0], tz);
			const b = parseTime(parts[1], tz);
			return {
				startTs: a.ts, endTs: b.ts,
				startText: a.text ?? parts[0], endText: b.text ?? parts[1],
				raw: `${a.text ?? parts[0]} ~ ${b.text ?? parts[1]}`
			};
		}


		// bwiki 通用：解析所有含「时间+版本」的卡池表（原神/星铁/绝区零）
		function parseAllBwiki(html, tz) {
			const out = [];
			const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)];
			for (const t of tables) {
				const body = t[1];
				if (!/<th[^>]*>\s*时间\s*<\/th>/i.test(body)) continue;
				if (!/<th[^>]*>\s*版本\s*<\/th>/i.test(body)) continue;
				let banner = "";
				const tc = body.match(/<th[^>]*colspan\s*=\s*"?2"?[^>]*>([\s\S]*?)<\/th>/i);
				if (tc) {
					const alt = tc[1].match(/<img[^>]*alt\s*=\s*"([^"]*)"/i);
					banner = alt ? alt[1] : stripTags(tc[1]);
				}
				if (!banner) {
					const t2 = body.match(/<th[^>]*>([\s\S]*?)<\/th>/i);
					if (t2) banner = stripTags(t2[1]);
				}
				const timeM = body.match(/<th[^>]*>\s*时间\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
				const charM = body.match(/<th[^>]*>\s*(?:5星角色|S级代理人|6星干员|5星干员)\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
				if (!timeM) continue;
				const range = parseRange(timeM[1], tz);
				out.push({
					banner,
					roles: charM ? stripTags(charM[1]) : "",
					...range,
					isMain: isMainBanner(banner)
				});
			}
			return out;
		}


		// 通用规则：起始时间为"版本更新后"等无具体日期的卡池，继承前一组（按结束时间分组）
		// 卡池的结束时间 —— 同一维护时间点（如星铁 4.5 上半的"4.5版本更新后" = 4.4 下半的结束时间）。
		// 不针对任何游戏特判：所有经 selectCurrent 的解析器统一受益。
		// 补全时保留源站原文（rawOriginal），供面板悬停显示原文（倒计时仍用补全后的时间）。
		function fillMissingStarts(items) {
			const byEnd = items.filter((it) => it.endTs != null).slice().sort((a, b) => a.endTs - b.endTs);
			let groupEnd = null, groupText = null;
			let i = 0;
			while (i < byEnd.length) {
				let j = i;
				while (j < byEnd.length && byEnd[j].endTs === byEnd[i].endTs) j++; // 相同结束时间成组
				if (groupEnd != null) {
					for (let k = i; k < j; k++) {
						const cur = byEnd[k];
						if (cur.startTs == null && groupText) {
							if (!cur.rawOriginal) cur.rawOriginal = cur.raw; // 保留源站原文（如"4.5版本更新后 ~ …"）
							cur.startTs = groupEnd;
							cur.startText = groupText;
							cur.raw = `${groupText} ~ ${cur.endText ?? ""}`.trim();
						}
					}
				}
				groupEnd = byEnd[i].endTs;
				groupText = byEnd[i].endText;
				i = j;
			}
		}


		// 选当期：优先"起始明确且覆盖 now"的主池；
		// 其次"起始未知（版本更新后）但结束在未来"的主池（星铁/zzz 上半，此时起始已被 fillMissingStarts 补齐）；
		// **当期多个主池的角色全部合并**（见下方合并说明）。返回 null 时调用方回退内置数据。
		// bannerDates 为补全后用于倒计时的文本；bannerDatesRaw 为源站原文（悬停展示）。
		function selectCurrent(items, now) {
			// 先记下**补全前**哪些行的起点是"版本更新后"（startTs 原本为 null）。
			// 为什么要记：fillMissingStarts 会用"上一组结束时间"去猜这类行的起点，
			// 而那个猜测**并非总是对的** —— 星铁 4.6 上线时间期有两池：
			//   「韶艾裁英」4.6版本更新后 ~ 10-21 11:59
			//   「沧海萃珠」4.6版本更新后 ~ 11-10 15:00
			// 两者同为"4.6 上线"，只是结束不同；按"上一组结束"补会把后者补成 10-21，
			// 于是"起点已过"判定失败、它被踢出当期 —— 而它其实覆盖当前时刻
			// （用户实测：卡片只显示绯英，真珠不见了）。
			const hadOpenStart = new Set(items.filter((it) => it.startTs == null).map((it) => it));
			fillMissingStarts(items);
			const inWindow = (it) => it.endTs != null && it.endTs >= now
				&& (it.startTs == null ? true : it.startTs <= now || hadOpenStart.has(it));
			// 说明最后一个条件：起点原本为 null（写作"版本更新后"）的行，**一定已经开始**——
			// 源站表只列**已发布版本**的排期，"X.Y版本更新后"里的 X.Y 必已上线，
			// 所以它的真实起点在版本更新那天（≤ now），补出来的那个值不可信、不应用来判"未开始"。
			// 注意这里**不覆盖**补全后的 startTs：显示（bannerDates 等）仍用补出来的窗口，
			// 悬停也仍显示源站原文"4.6版本更新后 ~ …"，不编造日期。
			const pool = items.filter(inWindow).filter((it) => it.isMain);
			if (pool.length === 0) return null;
			// 外显取哪个池的"名字与时间"：结束最早的（越快结束越该被盯住）。
			//
			// ⚠️ 合并条件（用户要求，2026-09-30 改）：
			//   旧 = 起止**完全相同**才合并 → 星铁同期两池结束不同就只合到自己，
			//        卡片只显示一个池的角色。
			//   新 = **当前时刻落在其持续区间内的主池全部合并**（就是这个 `pool`）。
			const first = pool.slice().sort((a, b) => a.endTs - b.endTs)[0];
			const roles = [...new Set(pool.map((it) => cleanRoles(it.roles)).filter(Boolean))].join("、");
			return {
				banner: first.banner,
				roles,
				bannerDates: first.raw,
				bannerDatesRaw: first.rawOriginal || first.raw
			};
		}


		// MM-DD HH:MM（同年窗口用）
		// 时间戳 → 显示文本。`tz`（可选）= **按该时区渲染**（源站时区）。
		// 为什么必须带 tz：绝对时刻已按源站时区换算，若文本仍按本机时区渲染，
		// 海外用户会看到"文本与时刻不一致"（例如源站写 09-30 04:00，却显示 09-29 20:00）。
		// 传 tz 后：**文本 = 源站墙钟**（与游戏内公告一致）、**时刻 = 正确绝对时刻**，两边统一。
		// 不传 tz 时行为与改造前完全一致（本机时区）。
		//
		// 兜底同 parseTime：`sourceWallParts` 在 15-env.js，单抽本文件时可能不在作用域。
		function wallOf(ts, tz) {
			if (typeof sourceWallParts === "function") return sourceWallParts(ts, tz);
			const d = new Date(ts);
			return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
		}

		function fmtMdHm(ts, tz) {
			const w = wallOf(ts, tz);
			return `${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")} ${String(w.h).padStart(2, "0")}:${String(w.mi).padStart(2, "0")}`;
		}


		// YYYY-MM-DD HH:MM（跨年窗口用：避免"05-15 16:00 ~ 05-15 03:59"看着像结束早于开始）
		function fmtYmdHm(ts, tz) {
			const w = wallOf(ts, tz);
			return `${w.y}-${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")} ${String(w.h).padStart(2, "0")}:${String(w.mi).padStart(2, "0")}`;
		}


		// 窗口起止文本：两端同一年 → MM-DD；跨年 → 两端都带年份
		function fmtWindow(startTs, endTs, tz) {
			const sameYear = wallOf(startTs, tz).y === wallOf(endTs, tz).y;
			return sameYear ? `${fmtMdHm(startTs, tz)} ~ ${fmtMdHm(endTs, tz)}` : `${fmtYmdHm(startTs, tz)} ~ ${fmtYmdHm(endTs, tz)}`;
		}


		// ── 「长期/常驻窗口」通用规则（**唯一真源**）────────────────────────────────
		// 判定：声明窗口超过该天数的不当作"当期"（外显与悬停共用，①）。
		// 依据：各游戏限时活动实测最长约 84 天（原神），而常驻玩法动辄半年以上——
		// 明日方舟 PRTS 活动一览里「生息演算：重启锚点」245 天、「集成战略：沉沦者的黑流树海」179 天，
		// 两者都是常驻玩法（表内含"进行中"徽标），且因外显不带年份会被误读成"结束早于开始"。
		//
		// ⚠️ 2026-10-03 收敛：这条规则此前有 **3 套实现 / 2 个值** ——
		//   · 本文件 `EVENT_MAX_WINDOW_DAYS = 120` + `isLongTermEvent`（事件侧）
		//   · `41-sources-shared.js` `HOVER_MAX_WINDOW_DAYS = 120` + `hoverIsLongTerm`（**逐字重复**）
		//   · `42-parsers-bestdori.js` `LONG_MS = 400 天` ← **值不同**（sekai 是 120）
		//   实测：bestdori 历史上有 22 个窗口落在 (120, 400] 天之间（全是「新手限定/回归纪念/
		//   每日免费/少女们的回忆/开服纪念」这类长期池）→ 在 400 天下会被误判成"当期"。
		//   当前真实在架池里恰好 0 个落在这个区间，所以是**潜在**不一致而非现行 bug；
		//   但既然是同一条规则，就不该有第二个值。现在统一到下面这一处。
		const LONG_TERM_MAX_WINDOW_DAYS = 120;

		/** 声明窗口超阈值 = 长期/常驻（不当作"当期"）。名与阈值都只有这一处。 */

		function isLongTermWindow(x) {
			return !!x && x.startTs != null && x.endTs != null && (x.endTs - x.startTs) > LONG_TERM_MAX_WINDOW_DAYS * 864e5;
		}


		// 旧名（事件侧语境下可读性更好）。**只是别名**，判定逻辑仍在上面。
		function isLongTermEvent(x) { return isLongTermWindow(x); }

		// ── 「覆盖 now」与「选当期」（**唯一真源**）────────────────────────────────
		// 2026-10-03 普查：全仓有 **92 处**「覆盖 now」判定、**25 种写法**，实质只有 3 种方言：
		//   ① `x.startTs <= now && x.endTs >= now`                        ← 主流
		//   ② `endTs != null && endTs >= now && (startTs == null || startTs <= now)`  ← 显式容许 open start
		//   ③ `startTs != null && endTs != null && startTs <= now && endTs >= now`    ← 两端都要求
		// 其中 **① 与 ② 完全等价**（`startTs == null` 时 `null <= now` 恒真），只是②写得更"诚实"；
		// ③ 更严：它把 startTs 为 null 的行排除掉。所以只需要两个判定，各写各的没有意义。
		//
		// `endTs == null` 表示"没有结束时间"（永久/常驻，或源站没给）——**不覆盖 now**（不以"没结束"当"永远在开"）。

		/** 覆盖 now（常用）：起可为 null（视为"已开始"，如源站写"X.Y版本更新后"），末必须有且未过。 */

		function coversNow(x, now) {
			return !!x && x.endTs != null && x.endTs >= now && (x.startTs == null || x.startTs <= now);
		}

		/** 覆盖 now（**两端都必须有**）：需要明确起止的场合（如按窗口合并/排序的源）。 */

		function coversNowBounded(x, now) {
			return !!x && x.startTs != null && x.endTs != null && x.startTs <= now && x.endTs >= now;
		}

		/**
		 * 选「当期」条目（唯一真源）。在 `coversNow` 之上再加可选条件：
		 *   now            选哪一刻（毫秒，必传）
		 *   kind           只取 `x.kind === kind` 的行（biligame 系用）
		 *   bounded        true → 用 `coversNowBounded`（要求两端都有）
		 *   dropLongTerm   true → 剔除长期/常驻窗口（`isLongTermWindow`）；默认 **false**（保持各源原有语义）
		 *   sort           可选比较函数，对结果排序
		 *   first          可选 true → 只返回第一条（排序后）
		 *   map            可选，先做一次映射再判定（如把 `{win:{startTs,…}}` 摊平）
		 *
		 * ⚠️ `dropLongTerm` 默认 false 是**故意的**：多数调用点原本就没做这个过滤，
		 *    擅自打开会改变选择结果。要改的站点逐个显式打开。
		 *
		 * ⚠️ 名字：不叫 `pickCurrent` —— 那个名字在**本文件上方**已被抓取器工厂占用
		 *    （`const pickCurrent = (parse) => (html) => selectCurrent(...)`）。
		 *    同作用域重名会让产物直接语法错误（构建守卫会报出来）。
		 */

		function pickCovering(items, opts) {
			const o = opts || {};
			const now = o.now;
			const pred = o.bounded ? coversNowBounded : coversNow;
			let list = (Array.isArray(items) ? items : []).filter((x) => x && (o.kind == null || x.kind === o.kind) && pred(x, now));
			if (o.dropLongTerm) list = list.filter((x) => !isLongTermWindow(x));
			if (typeof o.sort === "function") list = list.slice().sort(o.sort);
			return o.first ? (list[0] || null) : list;
		}

		// ── 无年份日期的两条通用规则（**唯一真源**）──────────────────────────────
		// 源站常写「10月22日」这种**不带年份**的日期（限时活动、卡池档期）。要把它变成绝对时刻，
		// 必须回答两个问题；此前各解析器各写各的，共 12+ 处、4 种写法：
		//   A. 这是**哪一年**？—— 借一个"年份线索"（通常是公告发布时刻的墙钟）
		//   B. 结束日期排在开始日期之前 —— 说明**跨年**了（12/28 ~ 1/5），结束该算次年
		// 2026-10-03 收敛：`yearOf` 在 biligame-activity 与 ournotes-global 里**逐字相同**；
		//   「月+日都有的跨年判定」有 **4 处逐字相同**的副本（bandori / biligame-activity /
		//   ournotes-global / umamusume-official），另有 4 处只有月份的退化版。

		/** 月份比线索月晚这么多 → 该日期只可能是**上一年**（例：线索 1 月，档期写 12 月）。 */

		const YEAR_HINT_MONTH_GAP = 6;

		/**
		 * 补年份。`hint` = `{ y, mo }`（本地墙钟字段，通常来自公告发布时刻）。
		 * · 已有年份 → 原样返回
		 * · **没有线索 → 返回 null（不猜当前年）** —— 宁可这条档期不产出，也不编一个年份出来
		 *   （猜错会把整条档期挪到错误的时间，比"未公布"更糟；`40-fetchers.js` 里那条 45 天规则
		 *     属于"能拿到 now 但拿不到公告年"的少数源，单独保留并注明）
		 */

		function inferYear(y, mo, hint) {
			if (y != null) return y;
			if (!hint || hint.y == null) return null;
			return mo > hint.mo + YEAR_HINT_MONTH_GAP ? hint.y - 1 : hint.y;
		}

		/**
		 * 「结束排在开始之前」= 跨年，结束应记次年。
		 * `sd` / `ed` 可省（只有月份信息时退化为按月比较）——这一点覆盖了此前 4 处只有月份的写法。
		 */

		function endsNextYear(sm, sd, em, ed) {
			if (em !== sm) return em < sm;
			if (sd == null || ed == null) return false;
			return ed < sd;
		}


		// 永久/常驻活动判定：源站把「结束时间」写成 `永久`（星铁「星际碰碰好搭档！」等）。
		// 这类行 endTs 为 null，**过去被静默丢弃**——不是判定为"非当期"，而是连痕都没留下，
		// 表现为"源站表里有、面板悬停里没有"（用户点名要修）。
		// 现在显式识别：外显仍不选它（永久活动没有"当期"语义、也就没有倒计时），
		// 但悬停里以一行计数如实交代，不再无声消失。
		//
		// ⚠️ **必须同时满足 endTs == null**：星铁表里大量正常限时活动的**类别**叫
		// 「版本活动 常驻活动」「常驻活动 联动活动」（wiki 的命名习惯），但它们都有明确结束时间。
		// 只按名字判会把 39 条限时活动全误判成永久（实测踩到）。有结束时间 = 限时，不做特例。
		function isPermanentEvent(x) {
			if (!x || x.endTs != null) return false;
			if (/永久/.test(`${x.cat || ""} ${x.tags || ""}`)) return true;
			return /永久\s*$/.test(String(x.raw || ""));
		}


		// 活动列表统一排序（③）：结束时间升序（越快结束越靠前）；结束时间无/未知/未抓到的排最后；
		// 同结束时间再按开始时间升序。同时剔除常驻/长期玩法与空名行（①）。
		// 外显取排序后的第一条，悬停按同序逐行展示 —— 两处共用本函数保证一致。
		function sortEventItems(items) {
			return (Array.isArray(items) ? items : [])
				.filter((x) => x && typeof x.name === "string" && x.name.trim() !== "")
				.filter((x) => !isLongTermEvent(x))
				.sort((a, b) => {
					const ea = a.endTs == null ? Infinity : a.endTs;
					const eb = b.endTs == null ? Infinity : b.endTs;
					if (ea !== eb) return ea - eb;
					const sa = a.startTs == null ? Infinity : a.startTs;
					const sb = b.startTs == null ? Infinity : b.startTs;
					return sa - sb;
				});
		}


		// 活动类别优先级（只影响"外显"挑选，不影响悬停排序）：
		// 第一档 = 剧情/叙事类活动 + 限时高难玩法（剧情/叙事/故事、总力战/大决战、危机合约、挑战活动…）；
		// 其余为第二档。判定优先级：有类别字段（原神 SMW「类型」、星铁/绝区零表「类型」列、方舟分类前缀、
		// 终末地 tags、蔚蓝国际服 cat 列）就按类别判定；源头没有类别信息时才回退按活动名匹配关键词。
		const EVENT_TIER1_RE = /剧情|叙事|主线|故事|活动正篇|总力战|總力戰|大决战|大決戰|决战|決戰|危机合约|危機合約|制约解除|综合战术|綜合戰術|挑战|挑戰|深度巡防|极限|逆境深塔|冥歌海墟|全息/;


		function eventTier(x) {
			const cat = `${x?.cat || ""} ${x?.tags || ""}`.trim();
			const hay = cat || `${x?.name || ""}`;
			return EVENT_TIER1_RE.test(hay) ? 1 : 2;
		}


		// 外显挑选：先按类别档位（第一档优先），同档内按结束时间升序（③ 越快结束越靠前，
		// 结束时间未知排最后）；悬停仍按 endTs 升序全量展示，不受类别影响。
		function pickEventPrimary(items) {
			return (Array.isArray(items) ? items : []).slice().sort((a, b) => {
				const t = eventTier(a) - eventTier(b);
				if (t !== 0) return t;
				const ea = a.endTs == null ? Infinity : a.endTs;
				const eb = b.endTs == null ? Infinity : b.endTs;
				if (ea !== eb) return ea - eb;
				const sa = a.startTs == null ? Infinity : a.startTs;
				const sb = b.startTs == null ? Infinity : b.startTs;
				return sa - sb;
			})[0] || null;
		}


		// 永久/常驻活动的计数行。抽成函数是为了**措辞只有一处**，并让守卫能直接断言文案
		// （曾经的写法是 `常驻/永久活动 N 项（无结束时间，不参与倒计时）`，用户要求改为
		// `以及常驻活动 N 项`）。
		function permanentLine(count) {
			return count > 0 ? `以及常驻活动 ${count} 项` : "";
		}


		// 活动列悬停（鸣潮式多行）：按传入顺序（调用方已 sortEventItems）每条一行；
		// 各行窗口完全相同 → 时间只在末尾写一遍；缺起止的行原样显示该行原文；跨年窗口两端带年份（②）。
		// 兜底：只有 0/1 条时返回 ""，由 UI 退回原有"活动名 + 时间"单条展示 ——
		// 公告类单条源（蔚蓝国服/日服、1999、异环等）因此完全不受影响，也不会出现空行或半截区间。
		// permanentCount：永久/常驻活动的条数（不参与排序，只在末尾补一行计数，避免"源站有、面板没有"）。
		function buildEventHover(items, permanentCount = 0) {
			const list = (Array.isArray(items) ? items : [])
				.filter((x) => x && typeof x.name === "string" && x.name.trim() !== "")
				.filter((x) => !isLongTermEvent(x));
			// 只有 1 条当期活动时，本函数仍返回 ""（由 UI 单条展示）；但若还有永久活动，
			// 就必须把那一行计数带上，否则永久活动又变成看不见。
			if (list.length < 2) {
				return permanentLine(permanentCount);
			}
			const allTimed = list.every((x) => x.startTs != null && x.endTs != null);
			const same = allTimed && new Set(list.map((x) => `${x.startTs}~${x.endTs}`)).size === 1;
			const lines = list.map((x) => {
				// 有起止的行按行带时间（全部同窗口时只在末尾写一遍）；缺起止的行原样显示该行原文
				if (x.startTs != null && x.endTs != null) {
					return same ? x.name : `${x.name}   ${fmtWindow(x.startTs, x.endTs)}`;
				}
				const raw = String(x.raw || "").trim();
				return raw ? `${x.name}   ${raw}` : x.name;
			});
			if (same) lines.push(fmtWindow(list[0].startTs, list[0].endTs));
			if (permanentCount > 0) lines.push(permanentLine(permanentCount));
			return lines.join("\n");
		}


		// 卡池列悬停（统一格式，沿用方舟/面板既有"换行"排版）：
		// 每池两行 —— "池名：角色" + "起止时间"；窗口完全相同的池合并时间（只在末尾写一遍）；
		// 排序：结束时间升序（无/未知结束时间排最后）。
		// 外显不受此函数影响：仍按各源原有逻辑（同窗口角色合并）。兜底：0/1 池返回 ""，退回单条展示。
		function buildPoolHover(pools) {
			const list = (Array.isArray(pools) ? pools : [])
				.filter((p) => p && typeof p.name === "string" && p.name.trim() !== "")
				.sort((a, b) => {
					const ea = a.endTs == null ? Infinity : a.endTs;
					const eb = b.endTs == null ? Infinity : b.endTs;
					if (ea !== eb) return ea - eb;
					const sa = a.startTs == null ? Infinity : a.startTs;
					const sb = b.startTs == null ? Infinity : b.startTs;
					return sa - sb;
				});
			if (list.length < 2) return "";
			const allTimed = list.every((p) => p.startTs != null && p.endTs != null);
			const same = allTimed && new Set(list.map((p) => `${p.startTs}~${p.endTs}`)).size === 1;
			const lines = [];
			for (const p of list) {
				lines.push(p.label || p.name);
				if (same) continue;
				const t = p.startTs != null && p.endTs != null ? fmtWindow(p.startTs, p.endTs) : String(p.raw || "").trim();
				if (t) lines.push(t);
			}
			if (same) lines.push(fmtWindow(list[0].startTs, list[0].endTs));
			return lines.join("\n");
		}


		// 解 HTML 数字实体（wiki.gg 的区间分隔符写成 &#8211; = en dash、&#8722; = 减号）+
		// 常见具名实体。stripTags 不解实体，所以需要它才能把时间串拆干净。
		function decodeHtmlEntities(s) {
			return String(s)
				.replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(Number(d)); } catch { return ""; } })
				.replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; } })
				.replace(/&nbsp;/g, " ").replace(/&minus;/g, "\u2212").replace(/&ndash;/g, "\u2013").replace(/&mdash;/g, "\u2014").replace(/&amp;/g, "&");
		}


		// Bwiki 卡池列载荷（原神/星铁）：外显沿用 selectCurrent（同窗口主池角色合并、武器/光锥池不入选）；
		// bannerHover 列出同期全部主池（每池"池名：角色"+时间；窗口相同则合并时间；结束时间升序）
		function bwikiGachaPayload(html, tz) {
			const items = parseAllBwiki(html, tz);
			// 页面拿到了却连一行候选都没有 → wiki 表结构变了（抛错，面板显示"卡池失败"）；
			// 有候选但都不覆盖当前时刻 → 下面返回 null（未公布）。这两件事必须分开。
			if (items.length === 0) throw new Error("bwiki-gacha-no-table");
			// selectCurrent 会就地补全缺失起点（fillMissingStarts），故先取快照
			const snapshot = items.map((it) => ({ banner: it.banner, roles: it.roles, startTs: it.startTs, endTs: it.endTs, raw: it.rawOriginal || it.raw, isMain: it.isMain }));
			const cur = selectCurrent(items, nowMs());
			if (!cur) return null;
			const now = nowMs();
			const pools = snapshot
				.filter((it) => it.isMain && coversNow(it, now))
				.map((it) => ({
					name: it.banner,
					label: `${it.banner}${it.roles ? `\uFF1A${cleanRoles(it.roles)}` : ""}`,
					startTs: it.startTs,
					endTs: it.endTs,
					raw: it.raw
				}));
			return { ...cur, bannerHover: buildPoolHover(pools) };
		}

		// 起止时间戳 → 统一文本 `MM-DD HH:MM ~ MM-DD HH:MM`
		function range2(st, endTs) {
			const fmt = (ts) => {
				const d = new Date(ts);
				return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			};
			const startTs = st && st.ts != null ? st.ts : null;
			return {
				startTs,
				endTs,
				startText: st && st.text ? st.text : "",
				endText: fmt(endTs),
				raw: `${st && st.text ? st.text : ""} ~ ${fmt(endTs)}`.trim()
			};
		}

		// bwiki 通用"选当期"包装（原神/星铁/绝区零/方舟）
		const pickCurrent = (parse) => (html) => selectCurrent(parse(html), nowMs());

		//#endregion

		// ═══════════════════════════════════════════════════════════════════════════
		// ⚠️ 2026-10-03 合并：以下内容原为独立文件 `src/client/41-sources-shared.js`，
		//    现按用户要求内联到本体（它本就是「本体已有的 pad2/decodeEntities/textOf + 新增来源共用工具」，
		//    分成两个文件只让人来回跳）。符号名与实现**一律未改**。
		//    原文件头保留在下面，信息不丢。
		// ═══════════════════════════════════════════════════════════════════════════

// src/client/41-sources-shared.js —— 新增来源解析器共用的：抓取桥接 + 悬停排版工具
//
// 历史沿革：这些代码原本在 `next-sources/lib/env.js`（ESM 模块，由外部生成器内联进 45-next-sources.js）。
// 2026-10-03 按用户要求「把 next-sources 合并进原 source，不留 next-source」压平成普通源码段，
// `next-sources/` 目录与生成器均已删除 —— **这里就是唯一真源，直接改这里**。
//
// 本段提供（解析器直接引用这些名字，不再有 import）：
//   · 抓取：fetchText / fetchJson / fetchMediaWikiText（走宿主代理或直连）
//   · 文本：pad2 / decodeEntities / textOf
//   · 悬停排版：hoverPool / hoverEvent（与本体 buildPoolHover / buildEventHover 逐字一致）
// 其余 env 名字（sourceInstant / sourceWallParts / fmtWindow / fmtMdHm / stripTags）由 30-parsers.js 与 15-env.js 提供。

		// 解析器原本 import ./lib/env.js；这里用插件已有实现 + 少量补齐顶上（解析器代码不改）。
		//   sourceInstant / sourceWallParts / fmtWindow / fmtMdHm / stripTags → 本体已有
		//   pad2 / decodeEntities / textOf                                    → 本区补
		//   fetchText / fetchJson / fetchMediaWikiText                        → 接宿主代理 / 直连
		const ENTITIES_NS = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

		// ⚠️ pad2 本体**没有**（第一版误以为有 → 7 个 bwiki 来源全报 "pad2 is not defined"）
		function pad2(n) { return String(n).padStart(2, "0"); }

		function decodeEntities(s) {
			return String(s).replace(/&(#\d+|[a-z]+);/gi, (m, k) => {
				const key = k.toLowerCase();
				if (ENTITIES_NS[key] != null) return ENTITIES_NS[key];
				if (/^#\d+$/.test(key)) { try { return String.fromCodePoint(Number(key.slice(1))); } catch { return m; } }
				return m;
			});
		}

		function textOf(html) {
			return decodeEntities(String(html).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
				.replace(/[ \t\u00a0]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
		}


		// ── HTML 命名实体（**唯一真源**）───────────────────────────────────────────
		// 2026-10-03 合并：此前 **5 个解析器**各写一份 `ENT_EXTRA` + `decodeExtra`
		//   （bandori / biligame-activity / biligame-announce / ournotes-global / ournotes），
		//   函数体**逐字节相同**，差别只在实体表 —— 而 5 张表**互为子集**。
		//   现在用**并集**（30 个，行为探测确认完整覆盖 5 张表），所以：
		//     · 零回归（原来能解的仍然能解）
		//     · 更正确（原来哪个解析器缺 `&copy;` / `&yen;`，就会把实体字面量漏到面板上）
		//   表里也含 `amp/lt/gt/quot/apos/nbsp`（下面 `decodeEntities` 本来就处理），重复无害。
		const ENTITIES_EXTRA = {
			middot: "·", times: "×", hellip: "…", mdash: "—", ndash: "–",
			nbsp: " ", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
			sup2: "²", sup3: "³", deg: "°", ensp: " ", emsp: " ",
			thinsp: " ", bull: "•", copy: "©", reg: "®", trade: "™",
			laquo: "«", raquo: "»", amp: "&", quot: "\"", apos: "'",
			lt: "<", gt: ">", yen: "¥", hearts: "♥", star: "★",
		};
		/** 在 `decodeEntities` 之上再解一批命名实体（媒体/排版符号）。 */

		function decodeExtra(s) {
			return decodeEntities(String(s == null ? "" : s).replace(/&([a-z][a-z0-9]{1,8});/gi, (m, k) => {
				const v = ENTITIES_EXTRA[String(k).toLowerCase()];
				return v != null ? v : m;
			}));
		}
		/** HTML → 纯文本（保留换行结构）。原来 5 个文件里的 `plain()` 都是这个。 */

		function htmlText(html) { return decodeExtra(textOf(html)); }
		/** 同上，但把空白压成单空格并去首尾空白（原来只有 ournotes-global 这么做）。 */

		function htmlTextTight(html) { return htmlText(html).replace(/\s+/g, " ").trim(); }

		// ── 时间戳与排序（**唯一真源**）────────────────────────────────────────────
		// 2026-10-03 收敛：
		//   · `toTs` 有 2 份、语义还不同（bestdori **宽容**：接受数字字符串；sekai **严格**：只接受 number）
		//   · `byNewestStart` 有 3 份，其中 umapyoi 那份**缺 null 守卫**
		//     （`a.endTs - b.endTs` 在 endTs 为 null 时得 NaN，排序行为未定义）
		//   现在统一为下面两个。取**宽容版** `numOrNull`：对 number 两者行为一致，
		//   对数字字符串宽容版能解出来而严格版返回 null —— 即"能解析的更多"，属改进。

		/** 源站时间戳 → 数字毫秒；`null` / `""` / 非数字 → null。接受数字字符串。 */

		function numOrNull(v) {
			if (v == null || v === "") return null;
			const n = Number(v);
			return Number.isFinite(n) ? n : null;
		}

		/**
		 * 「按开始时间从新到旧」排序：开始晚的在前；同开始则**结束早的在前**（空结束排最后）；
		 * 再同则按 id 升序。`endTs` 用 `Infinity` 兜空值 —— 原 umapyoi 版直接相减，
		 * 一旦有 null 就得 NaN（潜在 bug），这里一并修掉。
		 */

		function byNewestStart(a, b) {
			return (b.startTs - a.startTs)
				|| ((a.endTs == null ? Infinity : a.endTs) - (b.endTs == null ? Infinity : b.endTs))
				|| ((Number(a.id) || 0) - (Number(b.id) || 0));
		}

		//#endregion

		//#region 悬停排版共用工具（**唯一真源，改实现就改这里**）
		// 方案 A（用户 2026-10-03）：新增来源的悬停频出「格式/规则与原有条目差别很大」，
		// 根因是各批次各写各的。这里把排版逻辑做成唯一真源，解析器一律调用。
		// ⚠️ 2026-10-03 之后 `next-sources/` 与生成器都已删除，本段**不再由任何脚本抽取/覆盖**。
		// ── 为什么单独立一个区域 ──
		// 用户 2026-10-03 反馈「新增游戏的悬停样式/格式/规则和原来的差别很大」。核实后确认：
		// 各批次解析器**各写各的悬停**，出现了三类偏差 ——
		//   ① 悬停里塞元信息（来源 URL / 时区推定 / 抓取条数 / 实现细节）—— 本体条目**从不**这样做
		//   ② 「档期在前、名称在后」（本体一律 `名称 + 3 空格 + 档期`）
		//   ③ 档期用源站原文而非 fmtWindow 格式化
		// 修法（方案 A）：把本体那两个函数的排版逻辑抽到这里做**唯一真源**，解析器一律调用。
		// （落点原本是 next-sources/lib/env.js，压平后就是本文件；测试与运行时读的是同一份代码。）
// ── 与本体唯一的差别 ──
// 本体的两个函数调 `fmtWindow(ts, endTs)` **漏传 tz**（`wallOf` 会退回本机时区）；
// 这里 tz 是**显式参数**，非 UTC+8 的源（日服 JST / 国际服 UTC）才能排对时刻。
//
// ── 返回 "" 的语义（与本体一致，调用方必须遵守）──
// 「当期条数 < 2」时返回 ""，表示**交回 UI 的默认单条两行式**：
//   卡池 `池名：角色名` ⏎ `档期`；活动 `名称` ⏎ `档期`。
// 所以调用方**不要**在返回值后面再拼任何东西；空串就让字段留空。

// 长期/常驻判定：**直接用本体 30-parsers.js 的那一条**（阈值也只有那一处）。
// ⚠️ 2026-10-03 收敛：这里曾有一份逐字重复的实现 + 第二个 `HOVER_MAX_WINDOW_DAYS = 120` 常量。
//    同一条规则不该有第二份实现/第二个值 —— 已删，改为调用 `isLongTermWindow`。
//    （函数声明会提升，所以 41 在本体的 30 之后拼接也不影响这里的调用。）
// 排序：结束时间升序（无/未知结束时间排最后），再按开始时间
		function hoverSortByEnd(a, b) {
			const ea = a.endTs == null ? Infinity : a.endTs;
			const eb = b.endTs == null ? Infinity : b.endTs;
			if (ea !== eb) return ea - eb;
			const sa = a.startTs == null ? Infinity : a.startTs;
			const sb = b.startTs == null ? Infinity : b.startTs;
			return sa - sb;
		}
		// 永久/常驻活动计数行 —— **直接用本体 `permanentLine`**（30-parsers.js）。
		// ⚠️ 2026-10-03 收敛：这里曾有一份逐字相同的副本 `hoverPermanentLine`（措辞 `以及常驻活动 N 项`）。
		//    本体注释写着"抽成函数是为了**措辞只有一处**"，副本正是打破了那句话，已删。

		/**
		 * 卡池列悬停。复刻本体 `buildPoolHover`：
		 *   每池两行 —— `池名：角色` ⏎ `档期`；窗口完全相同的池合并时间（只在末尾写一遍）。
		 * `pools` 项：`{ name, label?, startTs?, endTs?, raw? }`（`label` 优先于 `name`）。
		 * 返回 "" = 不足 2 池，交回 UI 默认两行式。
		 */

		function hoverPool(pools, tz) {
			const list = (Array.isArray(pools) ? pools : [])
				.filter((p) => p && typeof p.name === "string" && p.name.trim() !== "")
				.sort(hoverSortByEnd);
			if (list.length < 2) return "";
			const allTimed = list.every((p) => p.startTs != null && p.endTs != null);
			const same = allTimed && new Set(list.map((p) => `${p.startTs}~${p.endTs}`)).size === 1;
			const lines = [];
			for (const p of list) {
				lines.push(p.label || p.name);
				if (same) continue;
				const t = p.startTs != null && p.endTs != null ? fmtWindow(p.startTs, p.endTs, tz) : String(p.raw || "").trim();
				if (t) lines.push(t);
			}
			if (same) lines.push(fmtWindow(list[0].startTs, list[0].endTs, tz));
			return lines.join("\n");
		}

		/**
		 * 活动列悬停。复刻本体 `buildEventHover`：
		 *   每条一行 `名称` + **3 空格** + `档期`（档期用 fmtWindow 格式化）；
		 *   窗口完全相同时只列名称、末尾写一次档期；缺起止的行显示该行 `raw` 原文。
		 * **不排序**（与本体一致：调用方负责排序）。
		 * `permanentCount` = 永久/常驻活动数，只在末尾补一行计数。
		 * 返回 "" = 不足 2 条（交回 UI 默认两行式）。
		 */

		function hoverEvent(items, tz, permanentCount = 0) {
			const list = (Array.isArray(items) ? items : [])
				.filter((x) => x && typeof x.name === "string" && x.name.trim() !== "")
				.filter((x) => !isLongTermWindow(x));
			if (list.length < 2) return permanentLine(permanentCount);
			const allTimed = list.every((x) => x.startTs != null && x.endTs != null);
			const same = allTimed && new Set(list.map((x) => `${x.startTs}~${x.endTs}`)).size === 1;
			const lines = list.map((x) => {
				if (x.startTs != null && x.endTs != null) {
					return same ? x.name : `${x.name}   ${fmtWindow(x.startTs, x.endTs, tz)}`;
				}
				const raw = String(x.raw || "").trim();
				return raw ? `${x.name}   ${raw}` : x.name;
			});
			if (same) lines.push(fmtWindow(list[0].startTs, list[0].endTs, tz));
			if (permanentCount > 0) lines.push(permanentLine(permanentCount));
			return lines.join("\n");
		}

		//#region proxy fetchers（经 host 代理）与统一来源注册表
		// 中文时间解析（繁体/简体共用）：
		// "8月18日(二)維護後" / "9月1日(二)上午9點59分" / "晚間10點59分" / "08月20日 14:00"
		function parseZhTime(raw, nowYear) {
			const s = String(raw).trim();
			const md = s.match(/(\d{1,2})月(\d{1,2})日/);
			if (!md) return null;
			const mo = Number(md[1]), d = Number(md[2]);
			let h = 0, mi = 0;
			const tm = s.match(/(上午|下午|中午|凌晨|晚上|晚間)?\s*(\d{1,2})[點点](\d{1,2})?[分]?/);
			if (tm) {
				let hh = Number(tm[2]);
				const mm = tm[3] ? Number(tm[3]) : 0;
				const period = tm[1] || "";
				if ((period === "下午" || period === "晚上" || period === "晚間") && hh < 12) hh += 12;
				if (period === "中午" && hh < 12) hh += 12;
				if (period === "凌晨" && hh === 12) hh = 0;
				h = hh; mi = mm;
			}
			const ts = new Date(nowYear, mo - 1, d, h, mi).getTime();
			return { ts, text: `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` };
		}


		// 经 host 代理抓取文本 / JSON 两个函数的**实现**已移到外壳（92-dsh-env.js），
		// core 侧只在 15-env.js 保留同名薄封装（转调 coreEnv.transport）——这是 core 零宿主依赖的接缝之一。

		// 解析繁体时间段："8月18日(二)維護後 ~ 9月1日(二)上午9點59分"
		// 跨年（如 12月30日 ~ 1月5日）：结束月份小于开始月份 → 结束端按"下一年"解析；
		// 否则 end 会早于 start，当期会被误判成"未公布"（每年 12 月底~1 月初复发）。
		function parseBaZhRange(raw, nowYear) {
			const s = stripTags(raw);
			const parts = s.split(/[~～]/).map((x) => x.trim());
			if (parts.length < 2) return null;
			const moOf = (x) => { const m = String(x).match(/(\d{1,2})月/); return m ? Number(m[1]) : null; };
			const am = moOf(parts[0]), bm = moOf(parts[1]);
			const a = parseZhTime(parts[0], nowYear);
			const b = parseZhTime(parts[1], am != null && bm != null && endsNextYear(am, null, bm, null) ? nowYear + 1 : nowYear);
			if (!a || !b) return null;
			return { startTs: a.ts, endTs: b.ts, startText: a.text, endText: b.text, raw: `${a.text} ~ ${b.text}` };
		}


		// ---- GameKee（蔚蓝档案）----
		// 解析标题里的排期：【8/18~9/01】 / 【8月26日 ~ 9月9日】 → {startText, endText, startTs, endTs}
		function parseGkRange(title, nowYear) {
			const m = String(title).match(/【([^】]+)】/);
			if (!m) return null;
			const inner = m[1].replace(/\s+/g, "");
			const parts = inner.split(/[~～\-—]/);
			if (parts.length < 2) return null;
			const moOf = (p) => { const md = p.match(/(\d{1,2})[\/月](\d{1,2})日?/); return md ? Number(md[1]) : null; };
			const parseGkTime = (p, year) => {
				// 8/18 或 8月18日（日服可能带 日）
				const md = p.match(/(\d{1,2})[\/月](\d{1,2})日?/);
				if (!md) return null;
				const mo = Number(md[1]), d = Number(md[2]);
				const ts = new Date(year, mo - 1, d, 0, 0).getTime();
				return { ts, text: `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} 00:00` };
			};
			// 跨年（如 【12/28~1/5】）：结束月份小于开始月份 → 结束端按"下一年"解析
			const am = moOf(parts[0]), bm = moOf(parts[1]);
			const a = parseGkTime(parts[0], nowYear);
			const b = parseGkTime(parts[1], am != null && bm != null && endsNextYear(am, null, bm, null) ? nowYear + 1 : nowYear);
			if (!a || !b) return null;
			return { startTs: a.ts, endTs: b.ts, startText: a.text, endText: b.text, raw: `${a.text} ~ ${b.text}` };
		}

		const TZ_CN = "Asia/Shanghai";      // UTC+8：国服一览


		const AK_OFFICIAL_BULLETIN = "https://web-news.hypergryph.com/api/bulletin";


		// ⚠️ 2026-10-03 合并：以下内容原为独立文件 `src/client/43-sources-register.js`，
		//    现按用户要求（方案 C2）并入本文件。
		//
		//    为什么必须放在本文件**末尾**：它要在 `GACHA_FETCHERS` / `EVENT_FETCHERS`
		//    两张表**声明之后**才能登记（这两张表在本文件上方，是 `const`）→ 提前会 TDZ 报错。
		//
		//    为什么并入后仍然安全（C2 的前置条件，已逐条核实）：
		//      · 它引用 29 个解析器符号，**全是 `function` 声明**（会提升）→ 即使本文件排在
		//        那些 `42-parsers-*.js` 之前也不会 TDZ；
		//      · 它对 `SOURCES`（模块级）的写操作**全部幂等**：`NS_SOURCES` 按 id 找到就覆盖、
		//        备选源挂接按 fetcher 去重、bh3 那处 push 已补上 `some()` 守卫 —— 因为 core 产物里
		//        本文件位于 `createEngine` 内部，**每次新建引擎都会重跑一遍**；
		//      · 两张表本身是 `createEngine` 内的 `const` → 每个引擎各一份，不会互相污染。
		//
		//    符号名与实现**一律未改**，原文件头保留在下面。
		// ═══════════════════════════════════════════════════════════════════════════

// src/client/43-sources-register.js —— 新增来源的「条目声明 + 抓取器登记」
//
// 三件事：
//   ① 把 **17 条**新增来源追加进 `SOURCES`（16 条在 `NS_SOURCES` + 1 条 `bh3` 单独 push）
//   ② 登记主抓取器到 `GACHA_FETCHERS` / `EVENT_FETCHERS`
//   ③ 登记备选源抓取器，并把「米游社公告」挂成既有条目（原神/星铁/绝区零）的备选源 + 新建 `bh3`
//
// ⚠️ 数字口径（2026-10-03 核实，原文写的是「20 条」—— 不对）：
//   `20-sources.js` 内置 **11** 条 + 本文件 **17** 条 = 最终 `SOURCES` **28** 条。
//   合并规则见下方 `for (const s of NS_SOURCES)`：**按 id 找，命中就 `Object.assign` 覆盖、否则 push**。
//   那条"覆盖"分支当前**不会触发**（现存 17 条与内置 11 条无一重名），它是留给
//   "新增来源要接管某条内置条目"的升级路径 —— 历史上 `wuhuamixin` / `uma-cn` 的默认源
//   就从 bwiki 换成了 biligame 官方公告，靠的正是它。**别因为"跑不到"就删掉。**
//
// 位置说明：本文件排在 `40-fetchers.js` **之后**（ORDER），因为它要往那两张表里登记、往 SOURCES 里追加。
//
// 历史沿革：内容原为生成物 `src/client/45-next-sources.js` 的尾部（由 `next-sources/registry*.js` 生成）。
// 2026-10-03 用户要求「把 next-sources 合并进原 source，不留 next-source」后压平为普通源码，
// `next-sources/` 与生成器均已删除 —— **这里就是唯一真源，直接改这里**。
// （备选源的「键名 → 函数」对照表仍在 `test/registry-shim.mjs`，供测试侧的注册表结构守卫使用。）
//
// 历史沿革：内容原为生成物 `src/client/45-next-sources.js` 的尾部（由 `next-sources/registry*.js` 生成）。
// 2026-10-03 用户要求「把 next-sources 合并进原 source，不留 next-source」后压平为普通源码，
// `next-sources/` 与生成器均已删除 —— **这里就是唯一真源，直接改这里**。
// （备选源的「键名 → 函数」对照表仍在 `test/registry-shim.mjs`，供测试侧的注册表结构守卫使用。）





		// ===== 登记抓取器（键 = 条目 id）=====





		//#region 米游社公告（挂成**备选源**，不改默认主源）
		// 用户 2026-10-02 明确要求：「米游社来源全部改名米游社公告，且降级备选，恢复原默认来源」。
		// 所以这里**只加备选**：原神/星铁保持 Bwiki，绝区零保持官方公告（api-takumi-static）。
		// 命中规则 `altSourceId = (alt) => alt.url` 与当前 url 字符串相等；下面是各游戏**专属 gids URL**，不会串。




		// 崩坏3：插件本体此前无来源 → 新建条目且**默认未配置**（用户要求）。

		// 未配置的语义（50-refresh.js）：`if (!source.url && !source.eventUrl) return { ok:true, reason:"skipped" }`

		// → 不抓取、不计成功也不计失败；UI 显示「未配置（不抓取卡池/活动）」。设置页选「米游社公告」即可启用。

		if (!SOURCES.some((s) => s.id === "bh3")) {

			const G = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=1&type=1&page_size=20";

			const E = "https://bbs-api.miyoushe.com/painter/wapi/getNewsList?gids=1&type=2&page_size=20";

			GACHA_FETCHERS["bh3-miyoushe"] = (url, signal, tz) => ns_miyoushe_gachaMiyoushe(url, signal, tz);

			EVENT_FETCHERS["bh3"] = { default: null, "bh3-miyoushe": { default: (url, signal, tz) => ns_miyoushe_eventsMiyoushe(url, signal, tz) } };

			// ⚠️ 幂等（2026-10-03 为「43 并入 40 进 core」而补）：
			//    这一段在 core 产物里位于 `createEngine` **内部**，每次新建引擎都会重跑；
			//    而 `SOURCES` 是**模块级**共享的 → 直接 push 会让 bh3 越堆越多
			//    （`_core_engine_test.mjs` 就建了两个引擎，会立刻暴露）。
			//    本文件其余写操作本来就是幂等的：上面 `NS_SOURCES` 是"按 id 找到就覆盖"、
			//    备选源挂接是"按 fetcher 去重"，只有这处 push 不是。
			if (!SOURCES.some((s) => s.id === "bh3")) SOURCES.push({

				id: "bh3",

				tz: "Asia/Shanghai",

				name: "崩坏3",

				icon: "https://storage.moegirl.org.cn/moegirl/commons/f/f4/BH3_icon.png!/fw/64",

				// 出厂默认不勾选展示（用户要求）：默认未配置时面板恒空，不该占版面

				defaultHidden: true,

				// 默认**未配置**：不给 url / eventUrl

				source: "",

				eventSource: "",

				altSources: [{ label: "米游社公告", url: G, fetcher: "bh3-miyoushe" }],

				eventAltSources: [{ label: "米游社公告", url: E, fetcher: "bh3-miyoushe" }]

			});

		}

		//#endregion

		//#endregion
