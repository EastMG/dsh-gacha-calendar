		// ═══════════════════════════════════════════════════════════════════════════
		// ⚠️ 2026-10-03 合并：以下内容原为独立文件 `src/client/41-sources-shared.js`，
		//    现按用户要求内联到本体（它本就是「本体已有的 pad2/decodeEntities/textOf + 新增来源共用工具」，
		//    分成两个文件只让人来回跳）。符号名与实现**一律未改**。
		//    原文件头保留在下面，信息不丢。
		// ═══════════════════════════════════════════════════════════════════════════

// src/client/41-sources-shared.js —— 新增来源解析器共用的：抓取桥接 + 悬停排版工具
//
// 历史沿革：这些代码原本在 `next-sources/lib/env.js`（ESM 模块，由外部生成器内联进 45-next-sources.js；压平后即本文件 27-parser-text.js ——
// 2026-10-28 又按职责拆段，其中「文本/实体/时间戳」这几件留在这里，抓取与悬停排版已各自成文件）。
// 2026-10-03 按用户要求「把 next-sources 合并进原 source，不留 next-source」压平成普通源码段，
// `next-sources/` 目录与生成器均已删除 —— **这里就是唯一真源，直接改这里**。
//
// 本段提供（解析器直接引用这些名字，不再有 import）：
//   · 文本：pad2 / decodeEntities / textOf（命名实体表 ENTITIES_NS 随 decodeEntities 走）
//   · 实体与 HTML：decodeExtra / htmlText / htmlTextTight（扩展实体表 ENTITIES_EXTRA）
//   · 时间戳与排序：numOrNull / byNewestStart（宽容版，见下方注释）
// 原本也在本段、2026-10-28 拆段后已迁走的（解析器照旧直接引用，不用 import）：
//   · 抓取：fetchText / fetchJson / fetchMediaWikiText → 现在在 22-fetcher-core.js（走宿主代理或直连）
//   · 悬停排版：hoverPool / hoverEvent（与本体 buildPoolHover / buildEventHover 逐字一致）→ 现在在 28-parser-hover-tools.js
// 其余 env 名字（sourceInstant / sourceWallParts / fmtWindow / fmtMdHm / stripTags）原本由 30-parsers.js 与 15-env.js 提供 —— 压平后分别是 15-env.js（sourceInstant / sourceWallParts）、24-parser-window.js（fmtWindow / fmtMdHm）、23-parser-time.js（stripTags）。

		// 解析器原本 import ./lib/env.js（压平后分散到 15-env.js / 22-fetcher-core.js / 23~28 各段，本文件只承接其中的文本工具）；这里用插件已有实现 + 少量补齐顶上（解析器代码不改）。
		//   sourceInstant / sourceWallParts / fmtWindow / fmtMdHm / stripTags → 本体已有（15-env.js / 24-parser-window.js / 23-parser-time.js）
		//   pad2 / decodeEntities / textOf                                    → 本区补
		//   fetchText / fetchJson / fetchMediaWikiText                        → 22-fetcher-core.js（接宿主代理 / 直连）
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
