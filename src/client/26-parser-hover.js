
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
		//
		// ⚠️ P5 清理后（2026-11-08）：本函数与 `buildPoolHover` **已没有生产调用方**（解析器一律先有
		//   条目事实、再 `hoverTextFromItems` 反生成悬停）。它们保留下来当**冻结的排版参照**：
		//   · test/cases-p3.mjs ① 断言"生成器输出 == 改造前手拼排版（逐字节）"；
		//   · test/cases-tz.mjs ① 断言"同一份条目只由传入的 tz 决定文本"；
		//   · test/cases-rule-lint.mjs 的静态守卫把它们当作**排版唯一真源**（三者的调用点都必须显式传 tz）。
		//   删掉会让上面三处守卫一起失效 ⇒ 先保留（见 README_Dev 的「死代码」一节）。
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


		// 卡池悬停的**排序**（结束时间升序 → 起点升序；无/未知的排最后）。
		// 单独抽出来是因为 P3 的**反向生成**也要用同一份：解析器直出的条目列表必须按同一顺序，
		// 否则"hover 由条目反生成"就会与改造前的文本差一个行序。
		function poolHoverOrderOf(a, b) {
			const ea = a.endTs == null ? Infinity : a.endTs;
			const eb = b.endTs == null ? Infinity : b.endTs;
			if (ea !== eb) return ea - eb;
			const sa = a.startTs == null ? Infinity : a.startTs;
			const sb = b.startTs == null ? Infinity : b.startTs;
			return sa - sb;
		}

		// 卡池列表的**去重**（"同一个池被源重复描述两遍"）：
		// ⚠️ 同一个池会被源重复描述两遍 ⇒ 探头上出现"重复"两行（用户 2026-10-16）：
		//    明日方舟「克莱门莎」+「海渊巡游：克莱门莎」；星塔旅人「「微醺茶香，藤花幽梦」」+「…：仙踪良梦」；
		//    重返未来「狩勋女巫红弩箭、小叶尼塞、婴儿蓝」+「「不渝者的领航」…：狩勋女巫红弩箭（星）…」。
		//    共同点：其中一条的信息，整段出现在另一条「：」的某一侧 ⇒ 它是同一池的残缺描述。
		//    规则：只认「：」两侧的整段包含（不做任意子串）——这样不会把「夏日活动」
		//    误当成「夏日活动·特别篇」的重复；括号后缀（(星)/（星））先归一化再去比。
		// 抽成独立函数（P3）：**悬停文本**与**解析器直出的数组**都从这一份结果出发，
		// 不允许"文本里丢了两行、数组里还留着"这种两套事实。
		function poolHoverKept(pools) {
			const rawList = (Array.isArray(pools) ? pools : [])
				.filter((p) => p && String(p.label || p.name || p.title || "").trim() !== "")
				.sort(poolHoverOrderOf);
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
			return keep;
		}

		// 卡池列悬停（统一格式，沿用方舟/面板既有"换行"排版）：
		// 每池两行 —— "池名：角色" + "起止时间"；窗口完全相同的池合并时间（只在末尾写一遍）；
		// 排序：结束时间升序（无/未知结束时间排最后）。
		// 外显不受此函数影响：仍按各源原有逻辑（同窗口角色合并）。兜底：0/1 池返回 ""，退回单条展示。
		// `tz`（源站时区）**必传**：与 buildEventHover 同口径 —— 悬停 = 源站墙钟原文。
		function buildPoolHover(pools, tz) {
			// 过滤条件保持原样（`name` 必须是非空字符串）—— 去重 / 排序在 poolHoverKept 里，
			// 那一份也要给 P3 的数组路径用，所以**不能**让这里变成第二个"谁算重复"的实现。
			const list = poolHoverKept((Array.isArray(pools) ? pools : [])
				.filter((p) => p && typeof p.name === "string" && p.name.trim() !== ""));
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


		// ── P3（2026-11-07）：**条目 → 悬停文本**（与 buildPoolHover / buildEventHover 同一排版）──
		// 方向反过来了：以前是"解析器手拼字符串、数据层再从字符串反解条目"，现在是
		// **解析器先有条目事实**（`{ title/label, startTs, endTs, raw }`），悬停文本由条目生成。
		// 复刻的排版规则（逐条对得上 buildPoolHover / buildEventHover）：
		//   · 卡池侧：每条一行 `label || title`；档期另起一行（`MM-DD HH:MM ~ MM-DD HH:MM`，
		//     由 `fmtWindow(ts, ts, tz)` 渲染）；**窗口全同 ⇒ 每条只写名称、末尾写一遍档期**；
		//     缺起止的条目（源站写"X.Y版本更新后"）**原样写 raw**、没有 raw 就只写名称。
		//   · 活动侧：每条一行 `名称 + 3 个空格 + 档期`；窗口全同 ⇒ 每条只写名称、末尾写一遍档期；
		//     缺起止的条目写 `名称 + 3 空格 + raw`（没有 raw 就只写名称）。
		//   · 两侧都：**不足 2 条 ⇒ 空串**（交回 UI 单条展示）；`kind === "event"` 时另按
		//     `isLongTermEvent` 剔掉长期/常驻窗口（与 buildEventHover 完全一致）。
		// 顺序：**调用方给**（卡池侧与 `poolHoverOrderOf` 同口径、活动侧与 `sortEventItems` 同口径）。
		//   这里**不排序**：鸣潮卡池悬停的首行是"卡池类型"（不是任何一口池），必须固定在首位。
		function hoverWindowTextOf(item, tz) {
			if (item.startTs != null && item.endTs != null) return fmtWindow(item.startTs, item.endTs, tz);
			return String(item.raw || "").trim();
		}

		// `opts.permanentCount`（P3b）：永久/常驻活动的条数 —— 只在**活动侧**生效，末尾补一行
		// `以及常驻活动 N 项`（`permanentLine`，与 buildEventHover 同一句措辞）。为什么必须支持：
		// 通用活动源（`genericEventPayload`）一直把这个计数交给 `buildEventHover`，切到反生成器后
		// 若不支持，那一行会**静默消失**（源站有永久活动、面板却看不到）。
		// 不足 2 条时也要带上这一行（与 buildEventHover 的 `return permanentLine(permanentCount)` 一致）。
		function hoverLinesFromItems(items, kind, tz, opts) {
			const isEvent = kind === "event";
			const permanent = isEvent && opts && opts.permanentCount > 0 ? opts.permanentCount : 0;
			// 名称字段三选一：`title`（活动名）/ `label`（卡池那行"池名：角色"）/ `name`（老调用形状）
			const nameOf = (x) => String(x.title || x.label || x.name);
			const list = (Array.isArray(items) ? items : [])
				.filter((x) => x && nameOf(x).trim() !== "")
				.filter((x) => !isEvent || !isLongTermEvent(x));
			if (list.length < 2) return permanent > 0 ? [permanentLine(permanent)] : [];
			const allTimed = list.every((x) => x.startTs != null && x.endTs != null);
			const same = allTimed && new Set(list.map((x) => `${x.startTs}~${x.endTs}`)).size === 1;
			const lines = [];
			for (const x of list) {
				const win = hoverWindowTextOf(x, tz);
				if (isEvent) {
					lines.push(allTimed ? (same ? nameOf(x) : `${nameOf(x)}   ${win}`) : (win ? `${nameOf(x)}   ${win}` : nameOf(x)));
				} else {
					lines.push(x.label || nameOf(x));
					if (!same && win) lines.push(win);
				}
			}
			if (same) lines.push(fmtWindow(list[0].startTs, list[0].endTs, tz));
			if (permanent > 0) lines.push(permanentLine(permanent));
			return lines;
		}

		function hoverTextFromItems(items, kind, tz, opts) {
			return hoverLinesFromItems(items, kind, tz, opts).join("\n");
		}


		// ── 冻结点：`scheduleHoverItems`（悬停文本 → 并列条目）已在 P5 清理中删除 ────────────
		// 它从 P1 起就是"数据层从悬停文本反解并列条目"的那条路的逆运算；P3c（2026-11-07）把数据层改成
		// 读 `gacha` / `events` 数组之后，它**再没有生产调用方**，只剩回归里当"改造前"的对照 oracle
		// （test/cases-core.mjs ⑤-5 / test/cases-p3.mjs ③ / test/cases-arknights-claim.mjs §④）。
		//
		// P5 清理（2026-11-08）的处理方式（两步，缺一不可）：
		//   ① 先把 oracle 的**输出**固化成字面量（test/fixtures/legacy-oracle-golden.json，见 test/legacy-golden.mjs），
		//      等价性断言改成"当前实现 == 该字面量"；
		//   ② 再删实现，并把仍需要"解析悬停文本"的那一处（明日方舟 §④ 的提示行回归）**逐字搬进测试**
		//      （test/cases-arknights-claim.mjs 顶部的 `legacyHoverItemsOf`）。
		// 于是断言一条没少，产品里不再有这条没人调的路。

		// `scheduleNoYear`：去掉 `YYYY-` 前缀（跨年窗口用）。**保留**——50-refresh.js 的
		// `dataArrayExtrasFromEntriesOf` 仍在用（源站原文可能带年份）。
		const scheduleNoYear = (x) => String(x).replace(/(\d{4})-(\d{1,2}-\d{1,2})/g, "$2");

		// 解 HTML 数字实体（wiki.gg 的区间分隔符写成 &#8211; = en dash、&#8722; = 减号）+
		// 常见具名实体。stripTags 不解实体，所以需要它才能把时间串拆干净。
		function decodeHtmlEntities(s) {
			return String(s)
				.replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(Number(d)); } catch { return ""; } })
				.replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; } })
				.replace(/&nbsp;/g, " ").replace(/&minus;/g, "\u2212").replace(/&ndash;/g, "\u2013").replace(/&mdash;/g, "\u2014").replace(/&amp;/g, "&");
		}


		// 角色名判重（**按角色名 = 去掉括号属性后缀**；保留第一次出现的形式）。
		// 为什么需要（2026-11-07 星铁真机：「历史跃迁」页）：同一角色在「5星角色」格子里会出现两次 ——
		//   `<a class="new" title="文件:星神★阿哈.png">星神★阿哈</a>`（缺图红链，文本只有名字）
		// + `<a title="星神★阿哈">&#160;星神★阿哈（欢愉•量子）</a>`（正常链接，带属性后缀）
		// ⇒ stripTags 后同一格拼成 `星神★阿哈 星神★阿哈（欢愉•量子）`，外显（show）与 roles 就都重复了。
		// 口径：**「、」分组与组内空白分隔符原样保留**，只丢掉重复的那个名字（例如上面剩下
		// `星神★阿哈`）；判重键去掉 `（…）/(…)` 属性后缀，所以「有属性 / 无属性」两种写法算同一人。
		// ⚠️ 这是**载荷级**、按需开启的清洗（目前只有星铁调用，见 30-game-hoyoverse.js）；
		//    **不改**全局 `cleanRoleNames`（那是"外显去修饰"的语义，其它游戏不跟着变）。
		function dedupeRoleNames(roles) {
			const seen = new Set();
			const groups = [];
			for (const group of String(roles || "").split("\u3001")) {
				const kept = [];
				for (const name of group.split(/\s+/)) {
					if (!name) continue;
					const key = name.replace(/[（(][^）)]*[）)]/g, "").trim();
					if (!key || seen.has(key)) continue;
					seen.add(key);
					kept.push(name);
				}
				if (kept.length) groups.push(kept.join(" "));
			}
			return groups.join("\u3001");
		}


		// Bwiki 卡池列载荷（原神/星铁）：外显沿用 selectCurrent（同窗口主池角色合并、武器/光锥池不入选）；
		// bannerHover 列出同期全部主池（每池"池名：角色"+时间；窗口相同则合并时间；结束时间升序）
		// `opts.dedupeRoleNames === true` ⇒ 每个池的 roles 与合并后的 roles 都按「角色名」判重（星铁用）。
		// `opts.id` ⇒ **必传**：解析器直出 `gacha` 数组（条目事实 → 数组），悬停文本由**同一份条目**反生成
		//   （`hoverTextFromItems`）。
		// ⚠️ P5 清理（2026-11-08）：原来的 `!emit` 分支（`buildPoolHover(pools, tz)` 手拼悬停、不出数组）
		//   已删除 —— P3 之后**两个调用方都传 `emitArrays: true, id`**（原神 / 星铁），那条路没有任何生产
		//   调用方，只有回归 oracle 走它（oracle 的**输出**已固化成字面量，见 test/legacy-golden.mjs）。
		function bwikiGachaPayload(html, tz, opts) {
			const items = parseAllBwiki(html, tz);
			// 页面拿到了却连一行候选都没有 → wiki 表结构变了（抛错，面板显示"卡池失败"）；
			// 有候选但都不覆盖当前时刻 → 下面返回 null（未公布）。这两件事必须分开。
			if (items.length === 0) throw new Error("bwiki-gacha-no-table");
			const dedupe = !!(opts && opts.dedupeRoleNames === true);
			// 先按池判重（悬停的「池名：角色」也用这份 roles），再交给 selectCurrent 合并
			if (dedupe) for (const it of items) it.roles = dedupeRoleNames(it.roles);
			// selectCurrent 会就地补全缺失起点（fillMissingStarts），故先取快照
			const snapshot = items.map((it) => ({ banner: it.banner, roles: it.roles, startTs: it.startTs, endTs: it.endTs, raw: it.rawOriginal || it.raw, isMain: it.isMain }));
			const cur = selectCurrent(items, nowMs());
			if (!cur) return null;
			// 合并后（多条当期池用「、」拼接）再判重一次：同一角色可能同时出现在两口池里
			if (dedupe) cur.roles = dedupeRoleNames(cur.roles);
			const now = nowMs();
			const pools = snapshot
				.filter((it) => it.isMain && coveredOrOpen(it, now))
				.map((it) => ({
					name: it.banner,
					label: `${it.banner}${it.roles ? `\uFF1A${cleanRoles(it.roles)}` : ""}`,
					startTs: it.startTs,
					endTs: it.endTs,
					raw: it.raw
				}));
			// ── P3：条目事实（每口当期主池一行）→ 悬停 + 数组 ────────────────────
			// 顺序 = `poolHoverOrderOf`（与 buildPoolHover 同一份排序）；去重也走 `poolHoverKept`，
			// 所以"悬停里那几行"与"数组里的并列条目"从**同一份**结果出发。
			const hoverItems = poolHoverKept(pools).map((p) => ({
				title: p.label || p.name,
				label: p.label || p.name,
				startTs: p.startTs,
				endTs: p.endTs,
				raw: p.raw
			}));
			const bannerHover = hoverTextFromItems(hoverItems, "gacha", tz);
			// 主条：外显沿用 selectCurrent 的 banner/roles（显示名 = cleanRoleNames，与合成路径同一句）
			// `tz` 必传（P4）：数组条目的 ts 是**绝对时刻**，按条目 tz 解析源站墙钟。
			const w = dataArrayWindowOf(cur.bannerDates, now, tz);
			const main = {
				title: cur.banner,
				show: cleanRoleNames(cur.roles, opts.id) || cur.banner,
				roles: dataArrayRolesOf(cur.roles),
				startTs: w.startTs,
				endTs: w.endTs,
				tz,
				raw: cur.bannerDatesRaw,
				source: "primary"
			};
			const extras = dataArrayExtrasFromEntriesOf(hoverItems, main, now, { kind: "gacha", tz });
			return {
				...cur,
				bannerHover,
				gacha: dataArrayProducedListOf([main].concat(extras).map((x) => dataArrayProducedItemOf(x, "gacha")), opts.id + ":gacha"),
				gachaHoverItems: hoverItems
			};
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
