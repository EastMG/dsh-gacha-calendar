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
