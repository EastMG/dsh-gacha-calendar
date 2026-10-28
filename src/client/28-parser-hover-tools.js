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
		// （落点原本是 next-sources/lib/env.js，压平后就是本文件 28-parser-hover-tools.js；测试与运行时读的是同一份代码。）
// ── 与本体唯一的差别 ──
// 本体的两个函数调 `fmtWindow(ts, endTs)` **漏传 tz**（`wallOf` 会退回本机时区）；
// 这里 tz 是**显式参数**，非 UTC+8 的源（日服 JST / 国际服 UTC）才能排对时刻。
//
// ── 返回 "" 的语义（与本体一致，调用方必须遵守）──
// 「当期条数 < 2」时返回 ""，表示**交回 UI 的默认单条两行式**：
//   卡池 `池名：角色名` ⏎ `档期`；活动 `名称` ⏎ `档期`。
// 所以调用方**不要**在返回值后面再拼任何东西；空串就让字段留空。

// 长期/常驻判定：**直接用本体 30-parsers.js 的那一条**（压平后见 24-parser-window.js 的 isLongTermWindow；阈值也只有那一处）。
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
		// 永久/常驻活动计数行 —— **直接用本体 `permanentLine`**（30-parsers.js；压平后见 25-parser-order.js）。
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
