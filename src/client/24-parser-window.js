
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


		// ── 选当期：**起点未知的行不参与"是否已开始"的判定**（2026-11-09 用户拍板）────────────
		// 源站写「X.Y版本更新后」而**没有日期**时，起点确实是未知的（下一版本哪天更新，源站没说）。
		// 旧口径把这种行**当成已开始**（`startTs == null` 直接放行），后果是"未来池假在期"：
		// 星铁 bwiki 的 4.7 两池（`4.7版本更新后 ~ 12-22`）在 11-07 就被当成在期、
		// 无期迷途 11-11 那批（`11-11 开服后 ~ 12-09`）在 11-09 就被当成在期。
		// 现在的口径：**未知起点既不算已开始、也不算未开始 —— 它不参与判定**（悬停里仍列出事实）。
		// 「宁可少显示，也不要假在期」。
		//
		// 判定用**补全前**的快照（`hadOpenStart`）：`fillMissingStarts` 会就地给这类行补一个
		// "上一组结束时间"当起点（那是**显示**用的猜测），拿它去判"已开始"等于把猜测当事实。
		function selectCurrent(items, now) {
			// `fillMissingStarts` 只为**显示**补起点（bannerDates / 悬停），不参与下面的在期判定。
			const hadOpenStart = new Set(items.filter((it) => it.startTs == null));
			fillMissingStarts(items);
			// 起点未知（原文「X.Y版本更新后」）⇒ 不参与在期判定；起点明确且已到 ⇒ 参与。
			const inWindow = (it) => it.endTs != null && it.endTs >= now
				&& !hadOpenStart.has(it)
				&& it.startTs != null && it.startTs <= now;
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
		// ⚠️ 不传 tz = **本机时区**，这只允许**显示层**用（`81-schedule-model.js` 的 localWin /
		//    localWinText：外显按用户本机时区）。凡是要产出「源站墙钟原文」的地方（`*Raw` / 悬停 /
		//    解析器的 bannerDates / eventDates）都**必须**传源站 tz —— 否则 UTC 机器上整体偏 8 小时。
		//    静态守卫见 `test/cases-rule-lint.mjs` 的「fmtWindow 调用必须带 tz」。
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
		//   · 原 `41-sources-shared.js` 的 `HOVER_MAX_WINDOW_DAYS = 120` + `hoverIsLongTerm`（**逐字重复**，2026-10-03 收敛时已删）
		//   · `42-parsers-bestdori.js` `LONG_MS = 400 天`（压平后见 30-game-bandori.js 的 `ns_bestdori_LONG_MS`）← **值不同**（sekai 是 120）
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
		// ⚠️ 2026-11-09（用户拍板）：**只剩一种** —— 起点未知（`startTs == null`）**不再视为已开始**，
		//    它不参与在期判定（"宁可少显示，也不要假在期"）。原来 ② 的 `startTs == null ||` 那个分支
		//    正是"未来池假在期"的根源（无期迷途 11-11 批、星铁 4.7 批、绝区零「X.Y版本更新后」上半）。
		//    事实本身不丢：这类行仍会出现在悬停 / 数据数组里，只是不冒充"在期"。
		//
		// `endTs == null` 表示"没有结束时间"（永久/常驻，或源站没给）——**不覆盖 now**（不以"没结束"当"永远在开"）。

		/** 覆盖 now：**两端都必须明确**（起点未知 ⇒ 不覆盖；终点未知 ⇒ 不覆盖）。 */

		function coversNow(x, now) {
			return !!x && x.startTs != null && x.endTs != null && x.startTs <= now && x.endTs >= now;
		}

		/** 覆盖 now（**两端都必须有**）：历史名，判据已与 `coversNow` 合并（保留以免调用点改签名）。 */

		function coversNowBounded(x, now) {
			return coversNow(x, now);
		}

		/**
		 * 「在期 + 起点未知但终点未过」——**只用于悬停 / 数据数组**（事实层），**不用于选外显**。
		 *
		 * 为什么单独一条：用户 2026-11-09 的口径是「起点未知 ≠ 已开始」，但**不等于把它删掉** ——
		 * 「只在悬停里列出」。所以悬停/数组要的是"这条事实还值得看吗"（终点未过？），
		 * 而外显要的是"它现在真的在开吗"（两端都明确且覆盖 now？= `coversNow`）。
		 * 起点**明确**且在未来的行不在此列：那种行有自己的状态（wait），不该混进"当期"的悬停。
		 */
		function coveredOrOpen(x, now) {
			if (!x) return false;
			if (coversNow(x, now)) return true;
			return x.startTs == null && x.endTs != null && x.endTs >= now;
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
