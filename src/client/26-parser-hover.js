
		// 活动列悬停（鸣潮式多行）：按传入顺序（调用方已 sortEventItems）每条一行；
		// 各行窗口完全相同 → 时间只在末尾写一遍；缺起止的行原样显示该行原文；跨年窗口两端带年份（②）。
		// 兜底：只有 0/1 条时返回 ""，由 UI 退回原有"活动名 + 时间"单条展示 ——
		// 公告类单条源（蔚蓝国服/日服、1999、异环等）因此完全不受影响，也不会出现空行或半截区间。
		// permanentCount：永久/常驻活动的条数（不参与排序，只在末尾补一行计数，避免"源站有、面板没有"）。
		//
		// ⚠️ `tz`（源站时区，**必传**、故意不给默认值）：悬停文本的用户口径 = **源站墙钟原文**
		//    （"服务器那个时间"，2026-10-21 用户定）。不传 tz 时 fmtWindow 会退化成**运行环境本机
		//    时区** —— 海外用户看到的钟点与外显/游戏内公告都对不上（`$env:TZ=UTC` 下实测到
		//    悬停 06:00 vs 外显 14:00）。放在**第 3 参**是为了让老调用 `(items, permanentCount)`
		//    不会把计数错位成时区；漏传由 `test/cases-rule-lint.mjs` 的静态守卫兜住。
		function buildEventHover(items, permanentCount = 0, tz) {
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
					return same ? x.name : `${x.name}   ${fmtWindow(x.startTs, x.endTs, tz)}`;
				}
				const raw = String(x.raw || "").trim();
				return raw ? `${x.name}   ${raw}` : x.name;
			});
			if (same) lines.push(fmtWindow(list[0].startTs, list[0].endTs, tz));
			if (permanentCount > 0) lines.push(permanentLine(permanentCount));
			return lines.join("\n");
		}


		// 卡池列悬停（统一格式，沿用方舟/面板既有"换行"排版）：
		// 每池两行 —— "池名：角色" + "起止时间"；窗口完全相同的池合并时间（只在末尾写一遍）；
		// 排序：结束时间升序（无/未知结束时间排最后）。
		// 外显不受此函数影响：仍按各源原有逻辑（同窗口角色合并）。兜底：0/1 池返回 ""，退回单条展示。
		// `tz`（源站时区）**必传**：与 buildEventHover 同口径 —— 悬停 = 源站墙钟原文。
		function buildPoolHover(pools, tz) {
			const rawList = (Array.isArray(pools) ? pools : [])
				.filter((p) => p && typeof p.name === "string" && p.name.trim() !== "")
				.sort((a, b) => {
					const ea = a.endTs == null ? Infinity : a.endTs;
					const eb = b.endTs == null ? Infinity : b.endTs;
					if (ea !== eb) return ea - eb;
					const sa = a.startTs == null ? Infinity : a.startTs;
					const sb = b.startTs == null ? Infinity : b.startTs;
					return sa - sb;
				});
			// ⚠️ 同一个池会被源重复描述两遍 ⇒ 探头上出现"重复"两行（用户 2026-10-16）：
			//    明日方舟「克莱门莎」+「海渊巡游：克莱门莎」；星塔旅人「「微醺茶香，藤花幽梦」」+「…：仙踪良梦」；
			//    重返未来「狩勋女巫红弩箭、小叶尼塞、婴儿蓝」+「「不渝者的领航」…：狩勋女巫红弩箭（星）…」。
			//    共同点：其中一条的信息，整段出现在另一条「：」的某一侧 ⇒ 它是同一池的残缺描述。
			//    规则：只认「：」两侧的整段包含（不做任意子串）——这样不会把「夏日活动」
			//    误当成「夏日活动·特别篇」的重复；括号后缀（(星)/（星））先归一化再去比。
			const normLabel = (s) => String(s || "").replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, "");
			const keep = [];
			for (const p of rawList) {
				const label = normLabel(p.label || p.name);
				const dup = rawList.some((q) => {
					if (q === p) return false;
					const other = normLabel(q.label || q.name);
					if (other === label) return true;
					if (label === "") return false;
					if (other.indexOf(label + "\uFF1A") === 0) return true;      // B = 池名：残缺信息
					const tail = other.lastIndexOf("\uFF1A" + label);             // B = 池名：残缺信息（在尾部）
					return tail >= 0 && tail === other.length - label.length - 1;
				});
				if (!dup) keep.push(p);
			}
			const list = keep;
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


		// ── 悬停文本 → 并列条目（**逆运算**；与上面的 buildPoolHover / buildEventHover 同一契约）──
		// 引擎只给**一条外显条目** + 一段供悬停用的多行文本（bannerHover / eventHover），**没有**并列数组。
		// 契约（本文件的 buildPoolHover / buildEventHover；28-parser-hover-tools.js 的 hoverPool / hoverEvent）：
		//   当期 ≥2 条时每条一行、不足 2 条时给空串，且三种排版：
		//     · 活动式 —— 每条自带档期：`名称   MM-DD HH:MM ~ MM-DD HH:MM`
		//     · 卡池式 —— 档期另起一行：`池名：角色` ⏎ `MM-DD HH:MM ~ MM-DD HH:MM`
		//     · 两者在"窗口完全相同"时都只在**末尾**写一遍档期
		// ⚠️ 鸣潮的卡池悬停（30-game-kuro.js）首行还多带一个"卡池类型"，它就等于外显标题 → 丢掉那一行。
		// 解析不出（或结果少于 1 条）一律返回空，调用方回退到外显那一条 —— 宁可少列，绝不列错。
		//
		// ⚠️ 2026-11-07（P1 数据层数组）**从 81-schedule-model.js 搬到这里**：数据层
		// （50-refresh.js 的 mergeEntryRecord）要按同一份判据把并列池展开成 `gacha` / `events` 数组，
		// 而 50-refresh.js 也在 core 产物里（`CORE_ORDER`）—— 81 是**只属于渲染层**的段（不出 core）。
		// 搬动是**逐字搬迁**（只想搬一个实现，不想有两份"谁算并列条目"的真理）。
		const SCHEDULE_WINDOW_LINE = /^(?:\d{4}-)?\d{1,2}-\d{1,2} \d{1,2}:\d{2} ~ (?:\d{4}-)?\d{1,2}-\d{1,2} \d{1,2}:\d{2}$/;
		const SCHEDULE_INLINE_WINDOW = / (?:\d{4}-)?\d{1,2}-\d{1,2} \d{1,2}:\d{2} ~ (?:\d{4}-)?\d{1,2}-\d{1,2} \d{1,2}:\d{2}$/;
		const scheduleNoYear = (x) => String(x).replace(/(\d{4})-(\d{1,2}-\d{1,2})/g, "$2");
		function scheduleHoverItems(hover, shownTitle, isG) {
			const lines = String(hover || "").split("\n").map((x) => x.trim()).filter(Boolean);
			if (lines.length < 2) return [];                        // 契约：只有 1 条时给的是空串
			// ⚠️ 这里**不要**再去丢"首行等于外显标题"的那一行（我曾这么写，结果把终末地的真池子丢了：
			// 「终末地」常驻寻访 正好既是外显标题、又是悬停里的第 1 个池子）。
			// 重复项（含鸣潮那个"卡池类型"首行，它等于外显标题）由 scheduleHoverOnes 按标题去重处理。
			const rest = lines.filter((x) => !/^以及常驻活动/.test(x));
			const out = [];
			let pending = [];                                       // 卡池式：先攒名称，等下一行（或后面某行）的档期
			for (const line of rest) {
				const inline = line.match(SCHEDULE_INLINE_WINDOW);
				if (inline && inline.index > 0) {                   // 活动式：名称 + 自己的档期
					const win = inline[0].trim();
					for (const t of pending.concat([line.slice(0, inline.index).trim()])) out.push({ title: t, win });
					pending = [];
					continue;
				}
				if (SCHEDULE_WINDOW_LINE.test(line)) {              // 纯档期行
					if (pending.length) for (const t of pending) out.push({ title: t, win: line });
					else if (out.length) out[out.length - 1].win = line;   // 窗口完全相同：给上一条补上档期
					pending = [];
					continue;
				}
				pending.push(line);
			}
			// ⚠️ 同一口池在数据里有两种写法，一起摆进探头就是"看起来重复"（用户 2026-10-16）：
			//    · 引擎的 roles 只给角色名 ——「克莱门莎」
			//    · 悬停原文给「池名：角色」——「海渊巡游：克莱门莎」「「微醺茶香，藤花幽梦」：仙踪良梦」
			//    用户定的口径：**只显示角色名那条** ⇒ 谁被另一条整个包住，就留谁、把带池名的那条丢掉。
			//    另外：完全同名（战双帕弥什「新增涂装」×6、原神「绮星盛会」×2）只留第一条。
			//    ⚠️ 只认「：」两侧的整段（不做任意子串）——否则「夏日活动」会被当成「夏日活动·特别篇」的重复。
			const normTitle = (s) => String(s || "").replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, "");
			// A 是不是「池名：B」或「B：其余」这种把 B 整个包住的写法（B 通常就是那条只有角色名的）
			const wraps = (A, B) => {
				const la = normTitle(A), lb = normTitle(B);
				if (lb === "" || la === lb) return false;
				if (la.indexOf(lb + "\uFF1A") === 0) return true;
				const tail = la.lastIndexOf("\uFF1A" + lb);
				return tail >= 0 && tail === la.length - lb.length - 1;
			};
			const kept = [];
			const seenTitle = new Set();
			for (const a of out) {
				const la = normTitle(a.title);
				if (la && seenTitle.has(la)) continue;              // 完全同名 ⇒ 只留第一条
				if (out.some((b) => b !== a && wraps(a.title, b.title))) continue;   // a 包着别人 ⇒ 丢 a，留被包住的那条
				if (la) seenTitle.add(la);
				kept.push(a);
			}
			// ⚠️ 这里**只**在一条都不剩时收手。老写法是"少于 2 条就当没有"，那是为
			//    "外显与探头会重复"的旧模型准备的；现在外显固定为列表第 0 条、且同池已去重，
			//    只剩 1 条并列池时必须照常列出来（否则那口池在面板上彻底看不见，用户 2026-10-16）。
			if (kept.length < 1) return [];
			return kept;
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
			return { ...cur, bannerHover: buildPoolHover(pools, tz) };
		}

		// 起止时间戳 → 统一文本 `MM-DD HH:MM ~ MM-DD HH:MM`（**源站墙钟**）
		//
		// ⚠️ `tz`（源站时区）**必传**：这里的两端来源不对称 —— 起点是**源站原文**（如 PRTS 一览第一列
		//    的 "2026-08-22 04:00"，已经是源站墙钟），终点却只有 `data-time` 的 Unix 秒（绝对值）⇒
		//    只能由我们渲染回文本。旧实现用 `new Date(ts)` 取字段（= **运行机器本机时区**）：
		//    · +08 机器上恰好对（源站也是 +08），所以本地开发看不出来；
		//    · `TZ=UTC` 机器上结束时刻比源站早 8 小时（`11-15 03:59` → `11-14 19:59`），
		//      同一条区间里起点是源站时区、终点是本机时区，两个口径打架（2026-11-07 用户实测）。
		// 所以这里**不给默认值**：漏传直接抛错。静默退回本机时区正是这个 bug 的成因 ——
		// 宁可当场炸掉让门禁/日志看见，也不要在海外用户的机器上悄悄显示错的钟点。
		//
		// 调用点：**只有** PRTS 活动一览 HTML 解析（`collectPrtsEvents`）这一处 —— 它是「活动来源」里的
		// **手动备选**（`PRTS 活动一览`）。默认来源（`PRTS 活动解析` = SMW action=ask）两端都是
		// `timestamp` 绝对值，直接走 `fmtWindow`，不经过这里。两条链路**都不许**跳过 tz。
		function range2(st, endTs, tz) {
			if (tz == null || tz === "") throw new Error("range2 需要源站 tz（源站墙钟原文不能按本机时区渲染）");
			const startTs = st && st.ts != null ? st.ts : null;
			const endText = fmtMdHm(endTs, tz);
			return {
				startTs,
				endTs,
				startText: st && st.text ? st.text : "",
				endText,
				raw: `${st && st.text ? st.text : ""} ~ ${endText}`.trim()
			};
		}

		// bwiki 通用"选当期"包装（原神/星铁/绝区零/方舟）
		const pickCurrent = (parse) => (html) => selectCurrent(parse(html), nowMs());

		//#endregion
