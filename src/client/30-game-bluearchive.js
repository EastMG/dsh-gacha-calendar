// src/client/30-game-bluearchive.js —— 蔚蓝档案（国服 / 国际服 / 日服）
//
// ⚠️ 2026-10-03 重组（用户要求「28 款一视同仁」）：不再有「内置 11 款 / 另外 17 款」的文件分层，
//    每款/每组游戏一个**自包含**文件（条目 + 解析器 + 抓取器 + 登记）。
//    本次只挪位置，**符号名一个都没改** —— 所以导出表、注册表快照、所有用例都不受影响。
//
// ⚠️ 这些文件在 core 产物里位于 `createEngine` **内部**，每建一个引擎都会重跑一遍 →
//    对 `SOURCES` 的写操作**必须幂等**（统一走 `registerSource`，它按 id 找到就合并、否则追加）。


		// ── 解析器 / 抓取器 ──

		// 解析更新日誌正文的日程表 → 行数组 {cat, name, range, dateRaw}
		function parseBaLogRows(content, nowYear) {
			const rows = [...content.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
			const items = [];
			for (const row of rows) {
				const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]));
				if (cells.length < 3) continue;
				const cat = cells[1] || "";
				const name = cells[2] || "";
				if (!cat || !name) continue;
				let range = parseBaZhRange(cells[0], nowYear);
				let relStart = false;
				let openEnded = false;
				if (!range && /維護(?:結束)?後|維護後/.test(cells[0])) {
					// 起点写"維護結束後"的日程行：先解析结束端，起点留待按本期维护结束时间补全（fetchBaGlobal）
					const parts = stripTags(cells[0]).split(/[~～]/).map((x) => x.trim());
					if (parts.length >= 2) {
						const b = parseZhTime(parts[parts.length - 1], nowYear);
						if (b) { range = { startTs: null, endTs: b.ts, startText: null, endText: b.text, raw: stripTags(cells[0]) }; relStart = true; }
					} else {
						// 只有「維護後」、官方未给结束端（如常駐化活動）：保留该行，结束端留空、时间按原文展示，不做推算
						range = { startTs: null, endTs: null, startText: null, endText: null, raw: stripTags(cells[0]) };
						relStart = true;
						openEnded = true;
					}
				}
				items.push({ cat, name, range, dateRaw: cells[0], relStart, openEnded });
			}
			return items;
		}


		// 蔚蓝档案·国际服：nexon 官方「更新日誌」board(3352) → 当期卡池 + 当期活动
		// 一次请求拿到更新日誌正文，从日程表同时提取 特選招募（卡池）与 活動劇情/總力戰（活动）
		async function fetchBaGlobal(logListUrl, signal, tz, now = nowMs()) {
			const ref = "https://forum.nexon.com/bluearchiveTW/";
			const list = await proxyFetchJson(logListUrl, ref);
			const threads = Array.isArray(list?.threads) ? list.threads : [];
			// 每篇日志的维护日取标题日期（"8/18(二) 更新日誌"）；日期跨年按当前年推断
			// ⚠️ 这里是 `inferYear`（30-parsers.js）那条规则的**绝对值版本**：拿不到公告年、
			//    只拿得到 now，于是用"按今年解释后若落在 now 之后 45 天以外 → 必是去年"代替月份比较。
			//    之所以 45 天而非 6 个月：日志列表按时间倒序、且只取 `ts <= now` 的那篇，
			//    正常日期一定紧贴 now；超出一个半月的"未来日期"只可能是把去年的 12/31 解释成了今年。
			const LOG_DATE_ROLLBACK_DAYS = 45;
			const y = new Date(now).getFullYear();
			const threadDate = (t) => {
				const m = String(t.title || "").match(/(\d{1,2})\/(\d{1,2})\(/);
				if (!m) return null;
				let d = new Date(y, Number(m[1]) - 1, Number(m[2]), 0, 0);
				if (d.getTime() > now + LOG_DATE_ROLLBACK_DAYS * 864e5) d = new Date(y - 1, Number(m[1]) - 1, Number(m[2]), 0, 0);
				return d.getTime();
			};
			const dated = threads
				.map((t) => ({ t, ts: threadDate(t) }))
				.filter((x) => x.ts != null && /更新日誌/.test(String(x.t.title || "")))
				.sort((a, b) => b.ts - a.ts);
			// 窗口匹配：日志 i 覆盖 [其维护日, 下一篇(更早)日志维护日)；取"最新且不晚于 now"的一篇
			const pick = dated.find((x) => x.ts <= now);
			if (!pick?.t?.threadId) return null;
			const detail = await proxyFetchJson(`https://forum.nexon.com/api/v1/thread/${pick.t.threadId}?alias=bluearchiveTW&countryCode=KR`, ref);
			const content = typeof detail?.content === "string" ? detail.content : "";
			if (!content) return null;
			const nowYear = new Date(now).getFullYear();
			const rows = parseBaLogRows(content, nowYear);
			// 维护结束时刻：从正文维护段"日期…上午10點～下午2點"取结束钟点，
			// 用于把日程表里起点为"維護結束後"的行补成显式起点
			const logTxt = String(content).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
			const mEnd = logTxt.match(/日期\s*[：:]\s*\d{1,2}月\d{1,2}日(?:[^。\n]{0,60}?)[～~-]\s*(上午|下午|中午|晚上)(\d{1,2})點(?:\s*(\d{1,2})分?)?/);
			let maintEndTs = null, maintEndText = "";
			const dayBase = new Date(pick.ts);
			if (mEnd) {
				let hh = Number(mEnd[2]);
				if ((mEnd[1] === "下午" || mEnd[1] === "晚上") && hh < 12) hh += 12;
				if (mEnd[1] === "中午" && hh < 12) hh += 12;
				const mi = mEnd[3] ? Number(mEnd[3]) : 0;
				maintEndTs = new Date(dayBase.getFullYear(), dayBase.getMonth(), dayBase.getDate(), hh, mi).getTime();
				maintEndText = `${String(dayBase.getMonth() + 1).padStart(2, "0")}-${String(dayBase.getDate()).padStart(2, "0")} ${String(hh).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
			}
			if (maintEndTs == null) { // 兜底：维护日 14:00
				maintEndTs = new Date(dayBase.getFullYear(), dayBase.getMonth(), dayBase.getDate(), 14, 0).getTime();
				maintEndText = `${String(dayBase.getMonth() + 1).padStart(2, "0")}-${String(dayBase.getDate()).padStart(2, "0")} 14:00`;
			}
			for (const r of rows) {
				if (r.relStart && r.range && r.range.startTs == null) {
					r.range.startTs = maintEndTs;
					r.range.startText = maintEndText;
					// 结束端缺失的行不改写 raw：保留日程原文，避免出现"09-08 14:00 ~"这种半个区间
					if (!r.openEnded) r.range.raw = `${maintEndText} ~ ${r.range.endText ?? ""}`.trim();
				}
			}
			// 当期卡池：特別特選招募 / 特選招募（时间覆盖 now）
			const bannerRow = rows.find((r) => /特選招募/.test(r.cat) && r.range && coversNow(r.range, now));
			// 当期活动候选：活動劇情 > 迷你活動 > 總力戰/大決戰/制約解除決戰/綜合戰術考試；
			// 常駐化活動（名稱含「常駐」）优先级最低；只有起点、官方未给结束端的行同样纳入候选
			const activeRow = (r) => !!r.range && r.range.startTs != null && r.range.startTs <= now &&
				(r.openEnded || (r.range.endTs != null && r.range.endTs >= now));
			const evTier = (r) => {
				if (/活動劇情/.test(r.cat)) return 1;
				if (/迷你活動/.test(r.cat)) return 2;
				if (/總力戰|大決戰|制約解除決戰|綜合戰術考試/.test(r.cat)) return 3;
				return 9;
			};
			const evCandidates = rows.filter((r) => evTier(r) < 9 && activeRow(r));
			// ③ 统一排序：结束时间升序（常驻/未给结束端的行 endTs 为空，自然排最后）；
			// 外显取排序第一条，悬停按同序逐行；长期/常驻玩法由 sortEventItems 一并剔除
			const evOrdered = sortEventItems(evCandidates.map((r) => ({
				name: r.name,
				cat: r.cat,
				startTs: r.openEnded ? null : r.range.startTs,
				endTs: r.openEnded ? null : r.range.endTs,
				raw: r.openEnded ? r.dateRaw : r.range.raw
			})));
			// 外显：类别优先（活動劇情/總力戰/大決戰 优先于 迷你活動/常駐类），同级内结束时间升序
			const eventRow = pickEventPrimary(evOrdered) || null;
			const evDates = eventRow
				? (eventRow.startTs != null && eventRow.endTs != null ? fmtWindow(eventRow.startTs, eventRow.endTs) : (eventRow.raw || ""))
				: "";
			const eventHover = buildEventHover(evOrdered, 0, tz);
			const data = {
				banner: "",
				roles: "",
				bannerDates: "",
				event: "",
				eventDates: ""
			};
			if (bannerRow) {
				data.banner = bannerRow.cat; // 如「特別特選招募」「特選招募」
				data.roles = baRoleName(bannerRow.name); // 蔚蓝三服角色名：保留括号后缀 + 全角括号转半角
				data.bannerDates = bannerRow.range.raw;
			} else if (eventRow) {
				// 无卡池行时至少给出活动
				data.banner = eventRow.name;
				data.bannerDates = evDates;
			}
			// 卡池列悬停：日程表里同期所有招募行（特選招募/特別特選招募 等），每池"类别：成员"一行 + 时间
			const recRows = rows.filter((r) => /招募/.test(r.cat) && r.range && coversNowBounded(r.range, now));
			const poolHover = buildPoolHover(recRows.map((r) => ({
				name: r.cat,
				label: `${r.cat}\uFF1A${baRoleName(r.name)}`,
				startTs: r.range.startTs,
				endTs: r.range.endTs,
				raw: r.range.raw
			})), tz);
			if (poolHover) data.bannerHover = poolHover;
			if (eventRow) {
				data.event = eventRow.name; // 活动名（去掉"活動劇情："类类别前缀，精简展示）
				data.eventDates = evDates;
				if (eventRow.openEnded) data.eventDatesRaw = eventRow.dateRaw;
			}
			if (eventHover) data.eventHover = eventHover;
			if (!data.banner || !data.bannerDates) return null;
			return data;
		}


		// ---- 蔚蓝档案·日服 官方公告（api-web.bluearchive.jp）----
		// 「ピックアップ募集紹介」条目结构（同一公告内多池、逐池给出）：
		//   ▼ピックアップ対象
		//   ピックアップ名： 「そして夏は爆破で終わる！」
		//   ピックアップ生徒：★3「カスミ(水着)」
		//   ▼実施期間 2026年9月9日(水) メンテナンス後 ~ 2026年9月23日(水・祝) 10:59
		// 时间按 JST(+09:00) 解析（展示时转本地）；起点写「メンテナンス後」时取同期维护公告
		// 「▼実施時間 … ～ … 17:00前後」的结束时刻。活动取同期「イベント」条目的開催期間。
		function parseBaJpNews(json, now = nowMs(), tz) {
			const rows = Array.isArray(json?.data?.rows) ? json.data.rows : [];
			const clean = (s) => String(s || "")
				.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/\s+/g, " ").trim();
			// JST 时间戳（JST = UTC+9）
			const jstTs = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h - 9, mi);
			const jpDate = (s) => {
				const m = String(s).match(/(\d{4})年(\d{1,2})月(\d{1,2})日[^0-9]{0,8}(\d{1,2}):(\d{2})/);
				return m ? jstTs(+m[1], +m[2], +m[3], +m[4], +m[5]) : null;
			};
			const afterMaint = (s) => /メンテナンス後/.test(String(s));
			// 维护结束时刻（"メンテナンス後"的起点）：最新一篇维护公告的実施時間 结束端
			let maintEnd = null;
			for (const it of rows) {
				const m = clean(it.content).match(/実施時間\s*([^~～]{4,48})[~～]\s*([^前]{4,48})/);
				if (!m) continue;
				const e = jpDate(m[2]);
				if (e != null) { maintEnd = e; break; }
			}
			// 当期卡池：最新一篇含「ピックアップ名／ピックアップ生徒」的募集公告
			let pools = null;
			for (const it of rows) {
				const text = clean(it.content);
				if (!/ピックアップ募集/.test(text) || !/ピックアップ名/.test(text)) continue;
				const found = [...text.matchAll(/ピックアップ名：\s*「([^」]+)」\s*ピックアップ生徒：\s*(?:★\d)?「([^」]+)」/g)]
					.map((m) => ({ name: m[1], student: m[2] }));
				if (found.length === 0) continue;
				const windows = [...text.matchAll(/実施期間\s*([^~～]{4,64})[~～]\s*([^▼]{4,48})/g)].map((m) => {
					const a = m[1].trim(), b = m[2].trim();
					const startTs = afterMaint(a) ? maintEnd : jpDate(a);
					const endTs = jpDate(b);
					return { startTs: startTs ?? null, endTs: endTs ?? null, raw: `${afterMaint(a) ? "メンテナンス後" : a} ~ ${b}` };
				});
				const fallback = windows[0] || { startTs: null, endTs: null, raw: "" };
				pools = found.map((f, i) => Object.assign({ name: f.name, student: f.student }, windows[i] || fallback));
				break;
			}
			if (!pools) return null;
			// 只保留覆盖当前时刻的池（起点缺省时按"结束在未来"宽松判定）
			const cur = pools.filter((p) => coversNow(p, now));
			if (cur.length === 0) return null;
			// 展示用的档期必须取"被选中的那个池"自己的窗口（cur[0]）—— 旧实现固定取 windows[0]，
			// 一旦当期命中的不是第一个池，就会显示"B 池名字 + A 池时间"，倒计时按错档期跑。
			const win0 = cur[0];
			const dates = win0.startTs != null && win0.endTs != null ? fmtWindow(win0.startTs, win0.endTs, tz) : (win0.raw || "");
			const data = {
				banner: cur[0].name,
				roles: [...new Set(cur.map((p) => p.student))].join("、"),
				bannerDates: dates,
				bannerDatesRaw: win0.raw || dates,
				startTs: cur[0].startTs,
				endTs: cur[0].endTs
			};
			// 卡池列悬停：每池「池名：生徒」一行 + 时间（同窗口合并，结束时间升序）
			const hover = buildPoolHover(cur.map((p) => ({
				name: p.name,
				label: `${p.name}\uFF1A${p.student}`,
				startTs: p.startTs,
				endTs: p.endTs,
				raw: p.raw
			})), tz);
			if (hover) data.bannerHover = hover;
			// 活动：同期「イベント」条目的開催期間
			for (const it of rows) {
				const sum = clean(it.summary);
				const text = clean(it.content);
				const m = (sum || text).match(/【(復刻)?イベント】「([^」]+)」/);
				if (!m) continue;
				const pr = text.match(/開催期間\s*([^~～]{4,64})[~～]\s*([^▼]{4,48})/);
				if (!pr) continue;
				const a = pr[1].trim(), b = pr[2].trim();
				const startTs = afterMaint(a) ? maintEnd : jpDate(a);
				const endTs = jpDate(b);
				if (startTs == null || endTs == null || startTs > now || endTs < now) continue;
				data.event = m[1] ? `${m[2]}（復刻）` : m[2];
				data.eventDates = fmtWindow(startTs, endTs);
				data.eventDatesRaw = `${afterMaint(a) ? "メンテナンス後" : a} ~ ${b}`;
				break;
			}
			return data;
		}


		// 日服卡池默认抓取器：官网新闻接口优先；失败或无当期募集 → 回退 GameKee 当期卡池（仅池名+档期）。
		// 只返回卡池字段：活动字段由活动源单独负责（卡池/活动解耦，避免活动源失败时静默混入官方活动）
		async function fetchBaJpGacha(url, signal, tz, now = nowMs()) {
			try {
				const json = await proxyFetchJson(url, "https://bluearchive.jp/");
				const d = parseBaJpNews(json, now, tz);
				if (d) {
					delete d.event;
					delete d.eventDates;
					delete d.eventDatesRaw;
					return d;
				}
			} catch { /* 官方失败 → GameKee 兜底 */ }
			return fetchGameKeeBa("jp");
		}


		// 日服活动备选抓取器：同一个官方接口的「イベント」条目（只取 event 字段）
		async function fetchBaJpOfficialEvent(url, signal, tz, now = nowMs()) {
			const json = await proxyFetchJson(url, "https://bluearchive.jp/");
			const d = parseBaJpNews(json, now, tz);
			if (!d || !d.event) return null;
			return { event: d.event, eventDates: d.eventDates || "", eventDatesRaw: d.eventDatesRaw || d.eventDates || "" };
		}


		// ---- GameKee「往期卡池一览」→ 国际服卡池的**唯一来源**（2026-10-21 收敛，用户纠正：替换，不是叠加）----
		//
		// 两轮迭代的结论（别再走回头路）：
		//   ① 2026-10-21 把 ba-global 默认源换成 GameKee，池名/档期来自目录页 `/ba/huodong/15` 里
		//      「国际服当期卡池评测」条目的**标题**（`…：岚过天晴【10/13~10/27】`），`roles` 恒为空；
		//   ② 同一天为补角色名，又串了 detail + CDN（`api-cdn` ≈1MB）→ 整条抓取器 **5 次**请求
		//      （目录树 + 卡池标题 + 活动标题 + detail + CDN）。用户明确否掉：「太臃肿，如果那个内容合适就直接换掉」；
		//   ③ 本次：卡池侧**只**走 609133 这一条链（detail + CDN = **2 次**请求），目录页那次标题请求与
		//      「补名」的叠加逻辑一并删除；活动侧不动（仍走目录树 + 「国际服当期活动」标题）。
		//
		// 609133 是什么：`https://www.gamekee.com/ba/609133.html`（detail 标题「国际服往期卡池一览」）。
		//   页面 HTML 是**纯 SPA 壳**（3.4KB，"<div id=app>"，全文没有池名/角色名/招募时间）→ 从 HTML 抓不可行；
		//   正文在 `content_cdn` 的 JSON 里（编辑器 block 数组），「当期卡池」分节就是一张表：
		//     paragraph「当期卡池」 → table(表头 卡池图标|PU学生|卡池时间) → table(数据行)
		//     数据行 ["…图标…", "旬( 泳装)", "10月13日～10月27日"] / ["…", "妃姬(泳装)", ""]（合并单元格 → 时间留空）
		//   ⚠️ 表里**没有「池名」列**，页面标题也只是「国际服往期卡池一览」（2026-10-21 实测，别再假设有池名）——
		//      所以 `banner` 不再是「岚过天晴」那类真实池名，改用国际服卡池的**类型标签**（见 GK_BA_POOL_BANNER）。
		//      面板外显本来就是 roles（83-panel-shell.js: `gachaVisible = g.roles ? cleanRoleNames(...) : g.banner`），
		//      banner 只在悬停/标题里作 `banner：roles` 的前缀 → 现状仍是「招募类型＋角色名」，与改造前的口径一致。
		//
		// 交叉验证（2026-10-21，本机真实网络）：Nexon 官方更新日誌（`ba-global-nexon` 备选源）同一时刻给出
		//   `特選招募 / 妃姬(泳裝)、旬(泳裝) / 10-13 00:00 ~ 10-27 09:59` —— 与本表 **10月13日～10月27日 +
		//   旬/妃姬** 完全一致（仅简繁差异：GameKee 简体「泳装」，与本站其余文本一致，故采用 GameKee 写法）。
		//
		// 成本（2026-10-21 实测）：卡池侧 **2 次** / 1,019,699 B（≈996KB）/ 196ms；整条抓取器 **4 次** /
		//   1,851,766 B（≈1808KB）/ 459ms（改前 5 次 / 1,858,165 B / 967ms）。
		//   为什么不能省掉 detail：CDN URL 带 `?v=<更新时间戳>`，只有从 detail 拿到的那个才是**当期版本**；
		//   去掉 `?v` 可能命中 CDN 旧缓存 → 表里的档期不覆盖 now → 会被下面的校验判掉（宁缺勿错，但也等于白抓）。
		//   为什么不是"每池一次详情"：这里只有**一次**固定开销，与池数无关。
		const GK_BA_POOL_CONTENT_ID = 609133;   // 「国际服往期卡池一览」词条（固定 id；不再从目录树里找）
		// 609133 无「池名」列 → 用国际服卡池的**类型标签**（与旧 `ba-global-nexon` 源的 banner 同口径：
		// 那边取日程表里的「特選招募 / 特別特選招募」）。写成简体，与本站其余 GameKee 文本一致。
		const GK_BA_POOL_BANNER = "特选招募";

		// block（编辑器节点树）→ 纯文本
		function gkBlockText(node) {
			let s = "";
			const walk = (n) => {
				if (typeof n === "string") { s += n; return; }
				if (Array.isArray(n)) { for (const x of n) walk(x); return; }
				if (n && typeof n === "object") {
					if (typeof n.text === "string") s += n.text;
					if (n.children) walk(n.children);
				}
			};
			walk(node);
			return s.replace(/\u00a0/g, " ").replace(/[ \t\r\n]+/g, " ").trim();
		}

		// 表格里的"无年份"档期 → 窗口：`10月13日～10月27日` / `10/13~10/27` / `2026/10/13 ~ 2026/10/27 12:00`
		// 与 `parseGkRange` 同口径（本机时区墙钟、日粒度），另加跨年与可选钟点。
		//   · `startTs` / `endTs`：**判断用**。没写钟点时，`endTs` 取当日 23:59:59.999（含当日全天）——
		//     否则到期当天 00:00 起就会被判成"已过期"，整期最后一天显示空白。
		//   · `endDayTs`：**显示用**。没写钟点时取结束日 00:00，与标题口径 `【10/13~10/27】` → `10-27 00:00` 同形
		//     （上一轮 bannerDates 就是这个读数，收敛后保持不变）。
		function gkBaTableWindow(raw, nowYear) {
			const s = String(raw || "").replace(/[（(][^）)]*[）)]/g, " ").trim();
			if (!s) return null;
			const parts = s.split(/[~～〜]|—|–|－|\s-\s|至|到/).map((x) => x.trim()).filter(Boolean);
			if (parts.length < 2) return null;
			const side = (p, year) => {
				const md = p.match(/(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*日?/);
				if (!md) return null;
				const hm = p.match(/(\d{1,2})[:：](\d{2})/);
				const mo = Number(md[1]), d = Number(md[2]);
				if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
				const dayTs = new Date(year, mo - 1, d, 0, 0).getTime();
				if (!hm) return { dayTs, ts: dayTs };
				const h = Number(hm[1]), mi = Number(hm[2]);
				if (!(h <= 23) || !(mi <= 59)) return null;
				return { dayTs, ts: new Date(year, mo - 1, d, h, mi).getTime() };
			};
			const am = (parts[0].match(/(\d{1,2})\s*[\/月]/) || [])[1];
			const bm = (parts[1].match(/(\d{1,2})\s*[\/月]/) || [])[1];
			const a = side(parts[0], nowYear);
			const b = side(parts[1], am != null && bm != null && endsNextYear(Number(am), null, Number(bm), null) ? nowYear + 1 : nowYear);
			if (!a || !b || b.ts <= a.ts) return null;
			return {
				startTs: a.ts,
				endTs: b.ts === b.dayTs ? b.dayTs + 86399999 : b.ts,
				endDayTs: b.dayTs
			};
		}

		// 「当期卡池」表格 → 按档期分组的角色名（[{win, roles}]）；表结构不认识 → null
		function gkBaPoolGroups(blocks, nowYear) {
			if (!Array.isArray(blocks)) return null;
			let start = -1;
			for (let i = 0; i < blocks.length; i++) {
				if (blocks[i]?.type !== "paragraph") continue;
				if (/当期卡池/.test(gkBlockText(blocks[i]))) { start = i; break; }
			}
			if (start < 0) return null;
			const groups = [];
			let header = null;          // {role, time} 列下标：表头可能在**另一张** table 里（实测如此），故跨表保留
			const pushRoles = (g, cell) => {
				for (const part of String(cell || "").split(/[、,，\/\n]/)) {
					const n = gkBaRoleName(part);
					if (n && !/^卡池(图标|名)?$|^PU学生$|^时间$|^日期$/.test(n)) g.roles.push(n);
				}
			};
			for (let i = start + 1; i < blocks.length; i++) {
				const b = blocks[i];
				if (b?.type === "paragraph") {
					// 下一个分节（「历史卡池」等）→ 当期段结束
					if (/历史卡池|往期卡池|往期/.test(gkBlockText(b))) break;
					continue;
				}
				if (b?.type !== "table") continue;
				for (const row of (b.children || [])) {
					if (row?.type !== "table-row") continue;
					const cells = (row.children || []).filter((c) => c?.type === "table-cell").map((c) => gkBlockText(c));
					if (cells.length === 0) continue;
					// 表头行：带「PU学生/角色/卡池名」+「时间/日期」
					if (cells.some((c) => /PU学生|角色|卡池名/.test(c)) && cells.some((c) => /时间|日期/.test(c))) {
						header = {
							role: cells.findIndex((c) => /PU学生|角色/.test(c)),
							time: cells.findIndex((c) => /时间|日期/.test(c))
						};
						continue;
					}
					// 数据行
					let roleCell = header && header.role >= 0 ? (cells[header.role] || "") : "";
					let timeCell = header && header.time >= 0 ? (cells[header.time] || "") : "";
					if (!header) {   // 没有表头 → 启发式：含档期的是时间列，另一个非空且不像档期的是角色列
						const ti = cells.findIndex((c) => gkBaTableWindow(c, nowYear));
						timeCell = ti >= 0 ? cells[ti] : "";
						roleCell = cells.find((c, k) => k !== ti && c && !gkBaTableWindow(c, nowYear)) || "";
					}
					const win = gkBaTableWindow(timeCell, nowYear);
					if (win) groups.push({ win, roles: [] });
					const g = groups[groups.length - 1];
					if (g && roleCell) pushRoles(g, roleCell);
				}
			}
			return groups;
		}

		// 角色名清洗：去「」、去 `★3` 前缀、括号内空格归一（"旬( 泳装)" → "旬(泳装)"），
		// 最后交给 baRoleName（全角括号 → 半角），与国服/日服两侧的展示口径一致。
		function gkBaRoleName(s) {
			return baRoleName(String(s || "")
				.replace(/[「」]/g, "")
				.replace(/^\s*★\s*\d+\s*/, "")
				.replace(/\s+/g, " ")
				.replace(/\s*[（(]\s*/g, "(")
				.replace(/\s*[）)]\s*/g, ")")
				.trim());
		}

		// 从「当期卡池」表里选**当期那一组**。宁缺勿错（沿用上一轮的策略，但**顺序**按"单一来源"调整）：
		//   ② 恰好一组覆盖 now → 采信（表自己标出的当期，最高置信度）
		//   ① 没有任何组覆盖 now 时，才退回"与标题档期**同月同日**"（titleWindow）
		//   · 多组同时覆盖 now / 一组都对不上 → null（不猜，也不拿过期档期凑）
		//   · 一个角色都没解析出来 → null
		//
		// ⚠️ 为什么把 ② 提到 ① 前面（与上一轮不同）：上一轮的 titleWindow 是**卡池标题**（与表是同一期的
		//   两处独立填写，① 优先等于交叉验证）；现在线上**不再请求卡池标题**，titleWindow 只能来自同一条
		//   目录树里的**活动标题**（`蔚蓝档案国际服 …活动攻略整理【10/13~10/27】`）。活动标题与卡池档期通常
		//   一致、但可能**滞后一期**：若仍让 ① 优先，活动标题滞后时会把**上一期**的角色当成当期（真实错误）；
		//   而 ② 只依赖表自身，滞后也不会配错。所以 ① 降级为兜底。
		function gkBaCurrentPool(blocks, now, nowYear, titleWindow) {
			const groups = gkBaPoolGroups(blocks, nowYear);
			// 表结构不认识（整段「当期卡池」都找不到）→ 抛：按"内容接口失败"处理，绝不产出半成品
			if (!groups) throw new Error("GameKee 内容接口失败（当期卡池表：找不到「当期卡池」段，结构可能变了）");
			const withRoles = groups.filter((g) => g.win && g.roles.length);
			if (!withRoles.length) return null;
			const pick = (g) => ({ win: g.win, roles: [...new Set(g.roles)].join("、") });
			const cov = withRoles.filter((g) => coversNowBounded(g.win, now));
			if (cov.length === 1) return pick(cov[0]);
			if (cov.length > 1) return null;   // 多组同时覆盖 → 宁缺勿错
			if (titleWindow && titleWindow.startTs != null && titleWindow.endTs != null) {
				const md = (ts) => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()}`; };
				const hit = withRoles.find((g) => md(g.win.startTs) === md(titleWindow.startTs) && md(g.win.endTs) === md(titleWindow.endTs));
				if (hit) return pick(hit);
			}
			return null;
		}

		// 609133 这条链（detail + CDN）→ { win, roles } | null；**任何一步失败/结构变化都抛错**，
		// 不返回"只有池名"之类的半成品（用户 2026-10-21 明确要求：单一来源就该单一失败）。
		//
		// ⚠️ CDN 的 Referer 必须是**纯 origin**（`https://www.gamekee.com/`）：
		//   api-cdn.gamekee.com 的 WAF 对"带路径的 Referer"和"无 Referer"一律 **567**（实测矩阵，2026-10-21）：
		//     origin + accept json → 200 / origin + accept *\/* → 200
		//     path  (/ba/huodong/15) → 567 / 页面地址 (/ba/609133.html) → 567 / 无 Referer → 567
		//   而 `/v1/content/detail/<id>` 用页面 Referer 是正常的 —— 两个域的反爬口径**不一样**，
		//   所以 CDN 这一跳单独传 origin。踩过的坑：传页面地址时整条链静默失效，不报错、不留痕。
		const GK_BA_CDN_REF = "https://www.gamekee.com/";

		// 失败文案统一前缀 `GameKee 内容接口失败（<环节>）`：normErr 会原样透出（见 60-helpers.js），
		// 面板/自检上能一眼看出"是 GameKee 的内容接口挂了"，而不是笼统的"抓取异常"或"未公布"。
		function gkBaPoolFail(where, cause) {
			if (cause && cause.name === "AbortError") return cause;   // 超时/中断语义原样上抛
			const why = cause ? String((cause && cause.message) || cause) : "";
			return new Error(`GameKee 内容接口失败（${where}${why ? "：" + why : ""}）`);
		}

		async function fetchGkBaCurrentPool(ref, headers, now, nowYear, titleWindow) {
			let det;
			try {
				det = await proxyFetchJson(`https://www.gamekee.com/v1/content/detail/${GK_BA_POOL_CONTENT_ID}`, ref, headers);
			} catch (e) {
				throw gkBaPoolFail("detail 609133", e);
			}
			const cdn = String(det?.data?.content_cdn || "");
			if (!cdn) throw gkBaPoolFail("detail 609133：content_cdn 缺失");
			let json;
			try {
				json = await proxyFetchJson(cdn.startsWith("//") ? "https:" + cdn : cdn, GK_BA_CDN_REF, headers);
			} catch (e) {
				throw gkBaPoolFail("content CDN", e);
			}
			let blocks = null;
			try { blocks = JSON.parse(String(json?.content || "")); } catch { blocks = null; }
			if (!Array.isArray(blocks)) throw gkBaPoolFail("content CDN：content 不是 block 数组");
			return gkBaCurrentPool(blocks, now, nowYear, titleWindow);
		}


		// GameKee：按服务器拉当期卡池+活动（标题含排期）
		// serverKey: "jp"|"global"；返回 {banner, roles, bannerDates, event, eventDates}
		//   · jp    ：池名/档期 = 目录树里「日服当期卡池评测」的**标题**（现状不变，无角色名）
		//   · global：卡池 = 609133 **单源**（detail + CDN 两次请求，池名类型/角色名/起止都从那里来）；
		//             活动 = 目录树里「国际服当期活动」的标题（现状不变）
		// 请求数：jp 3 次（目录树 + 卡池标题 + 活动标题）；global 4 次（目录树 + 活动标题 + detail + CDN）。
		async function fetchGameKeeBa(serverKey, now = nowMs()) {
			const ref = "https://www.gamekee.com/ba/huodong/15";
			const headers = { "game-alias": "ba" };
			// 1. 目录树 → 找"当期活动 | 当期卡池"子条目（活动侧与日服卡池侧都要用）
			const tree = await proxyFetchJson("https://www.gamekee.com/v1/wiki/entry?id=15", ref, headers);
			const list = tree?.data?.entry_list || [];
			let currentCat = null;
			const find = (nodes) => {
				for (const n of nodes || []) {
					// 名称可能含隐藏字符，用 includes 匹配
					if (String(n.name || "").includes("\u5F53\u671F\u6D3B\u52A8") && String(n.name || "").includes("\u5361\u6C60")) { currentCat = n; return; }
					if (n.child) find(n.child);
				}
			};
			find(list);
			if (!currentCat?.child) return null;
			const child = currentCat.child;
			// 找该服条目：日服(jp) 活动/卡池；国际服(global) 活动
			//
			// ⚠️ 2026-10-21 修：目录树里的名字是「国际服**当期**活动」/「国际服当期卡池评测」，
			//    原来写 `includes(kw + "活动")`（= "国际服活动"）**永远匹配不到** → 活动名恒为空
			//    （实测：直接调 GameKee 抓取器返回 {banner:"岚过天晴", event:""}）。
			//    改成「含服别 + 含活动/卡池」两段匹配，对新旧命名都稳。
			const isJp = serverKey === "jp";
			const kw = isJp ? "日服" : "国际服";
			const nameOf = (c) => String(c.name || "");
			const eventEntry = child.find((c) => nameOf(c).includes(kw) && nameOf(c).includes("活动"));
			// international 的卡池**不再**读这个条目（池名已改由 609133 提供），只有日服还在用它
			const bannerEntry = isJp ? child.find((c) => nameOf(c).includes(kw) && nameOf(c).includes("卡池")) : null;
			// 2. 拉标题（含排期）
			const getTitle = async (entry) => {
				if (!entry?.content_id) return null;
				const d = await proxyFetchJson(`https://www.gamekee.com/v1/content/detail/${entry.content_id}`, ref, headers);
				return typeof d?.data?.title === "string" ? d.data.title : "";
			};
			const nowYear = new Date(now).getFullYear();   // 走注入时钟（core 不得直接读宿主时钟）
			const data = { banner: "", roles: "", bannerDates: "", event: "", eventDates: "" };
			// 3. 日服卡池侧：标题就是池名+档期（现状不变；GameKee 只是日服的兜底源，不补角色名）
			if (isJp) {
				const bannerTitle = bannerEntry ? await getTitle(bannerEntry) : "";
				if (bannerTitle) {
					const rng = parseGkRange(bannerTitle, nowYear);
					if (rng) {
						// 卡池名：只去「(蔚蓝档案)(日服/国际服)当期卡池(评测)：」这类表头与末尾日期括号，
						// 池名里的标点（! ~ ！ 等）一律保留
						data.banner = String(bannerTitle)
							.replace(/^(?:蔚蓝档案)?\s*(?:日服|国际服|国服)?\s*(?:当期)?\s*(?:卡池|招募|评测)[^：:]*[:：]\s*/, "")
							.replace(/【[^】]*\d[^】]*】/g, "")
							.trim();
						data.bannerDates = rng.raw;
					}
				}
			}
			// 4. 活动侧（两侧共用，现状不变）
			let eventWindow = null;
			const eventTitle = eventEntry ? await getTitle(eventEntry) : "";
			if (eventTitle) {
				const rng = parseGkRange(eventTitle, nowYear);
				if (rng) {
					eventWindow = rng;
					// 活动名：只删可识别的游戏/服别前缀与"活动攻略整理"类后缀 + 末尾日期括号；
					// 名字里的标点（! ~ ！ ～ 等）与「复刻」都保留
					// 如 "蔚蓝档案国际服 比赛开始~目标！满贯全垒打！~ 复刻活动攻略整理【09/01~09/15】"
					//    → "比赛开始~目标！满贯全垒打！~ 复刻"
					const cleaned = String(eventTitle)
						.replace(/【[^】]*\d[^】]*】/g, "")
						.replace(/^蔚蓝档案\s*/, "")
						.replace(/^(?:日服|国际服|国服)?\s*(?:当期)?\s*(?:活动|卡池)(?:攻略|评测)?[^：:]*[:：]\s*/, "")
						.replace(/^(?:日服|国际服|国服)\s*(?:当期)?\s*(?:活动|卡池)\s*/, "")
						.replace(/^(?:日服|国际服|国服)\s*[:：]?\s*/, "")
						.replace(/活动一图攻略整理|活动攻略整理|攻略整理$/, "")
						.trim();
					data.event = cleaned || String(eventTitle).replace(/【[^】]*\d[^】]*】/g, "").trim();
					data.eventDates = rng.raw;
				}
			}
			if (isJp) {
				if (!data.banner || !data.bannerDates) return null;
				return data;
			}
			// 5. 国际服卡池侧：**唯一来源** = 609133 这条链（detail + CDN）。
			//    任何一步失败/结构变化 → 抛（`GameKee 内容接口失败（…）`），不再有"只有池名"的半成品；
			//    表里没有覆盖 now 的当期池（真·未公布）→ 返回 null（两侧一起记"未公布"，与改造前一致）。
			const pool = await fetchGkBaCurrentPool(ref, headers, now, nowYear, eventWindow);
			if (!pool) return null;
			data.banner = GK_BA_POOL_BANNER;
			data.roles = pool.roles;
			// 显示用 `endDayTs`（日粒度，两端都落在 00:00）：与上一轮标题口径的读数一致（10-13 00:00 ~ 10-27 00:00）
			data.bannerDates = fmtWindow(pool.win.startTs, pool.win.endDayTs);
			return data;
		}


		// ══ 国服公告正文「■ 标签 + 起止时间」通用块解析器（2026-10-21，任务 B）══
		//
		// WHY 不是"再补一条【预告】标题正则"（用户明确否掉的方案）：
		//   标题形态是运营随手写的（「【预告】限时招募：X」/「【限时招募预告】X」/ 干脆不带前缀），
		//   而且当期公告的标题里**根本没有档期**。真正稳定的是**公告模板的结构**：
		//     ■ 招募时间
		//     10月08日 14:00 ~ 10月22日 13:59
		//   这个「标签 + 下一行的起止」组合在招募/活动/维护公告里都在用（实测 2026-10-21 的 30 篇里
		//   招募类 30/30、活动类 30/30 都有）。所以这里做的是**扫描结构化时间块**的通用解析器，
		//   全程不依赖标题；标题只在最后一步用来取"池名/类型/活动名"这类**文本**（取不到就不填，
		//   不影响档期判定 —— 档期只由时间块决定）。
		//
		// 标签归一化 + 时间写法归一化（都在 `baCnWindowIn` 里）：
		//   全角/半角冒号、`～`/`〜`/`—`/`–`/`－`/`-`/`至`/`到`、`月日`/`月 日`/`M/D`、
		//   可选年份（`2026/10/08`、`2026年10月08日`）、`HH:MM`/`H:MM`、跨年（右侧月份小于左侧 → 次年）、
		//   右侧只写钟点（`10月15日 14:00 ~ 18:00` ⇒ 与左侧同日）。
		//
		// 时区：走 `sourceInstant(..., tz)`（站点 +08）。**在这台 +08 机器上与旧的 `new Date(...)` 逐毫秒相同**，
		//   对海外用户则是修正（旧口径把 +08 墙钟当本机时区解释 → 档期整体偏移）。
		//
		// ⚠️ 严格性（宁可 nomatch，也不要显示错的档期）：**两端都必须有明确钟点**才认。
		//   站点常写「09月24日 维护结束后 ~ 10月01日 13:59」—— 左端是**相对时刻**，正文没给钟点，
		//   推算（14:00？18:00？）都可能错 ⇒ 这类块**一律不解析**（该期次交给 ① 的维护公告逻辑，
		//   它有自己的维护结束时刻来源）。实测 1961/1960/1955/1956/1962 都是这种写法：如果宽松地
		//   把左端当 00:00，它们会跟着"当期"一起被选中，档期就错了。

		// 公告 HTML → 纯文本（与 fetchBaCn 里原来那段**逐字**相同；抽出来是为了列表行与详情共用一份）
		function baCnNoticeText(html) {
			return String(html || "")
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(/<[^>]+>/g, "")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/&ldquo;/g, "「").replace(/&rdquo;/g, "」")
				.replace(/&hellip;/g, "…").replace(/&times;/g, "×").replace(/&bull;/g, "·")
				.replace(/\n\s*\n+/g, "\n").trim();
		}

		// 一行文本里的"起止时间" → {startTs,endTs,startText,endText,raw}；解析不了 / 不够严格 → null
		// `keepLongTerm`（内部用，默认 false = 原行为）：>120 天的长窗口不 return null，而是带上
		// `longTerm: true` 返回 —— 供 `baCnTimeBlocks` 统计"常驻/长期活动条数"（悬停末尾那行计数），
		// 判定本身仍只认全仓唯一真源 `isLongTermWindow`。**不影响任何 3 参调用方**。
		function baCnWindowIn(line, nowYear, tz, keepLongTerm = false) {
			const s = String(line || "")
				.replace(/[：]/g, ":")
				.replace(/[～〜]/g, "~")
				.replace(/[—–－]/g, "~")
				.replace(/[ \t\u3000]+/g, " ")
				.trim();
			// 左端：日期 + 明确钟点（"维护结束后"这类没有钟点的写法直接落空 → 整块不认）
			const sm = s.match(/(?:(\d{4})\s*[\/\-年]\s*)?(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*日?\s*(\d{1,2}):(\d{2})/);
			if (!sm) return null;
			const startY = sm[1] ? Number(sm[1]) : nowYear;
			const aMo = Number(sm[2]), aD = Number(sm[3]), aH = Number(sm[4]), aMi = Number(sm[5]);
			if (!(aMo >= 1 && aMo <= 12) || !(aD >= 1 && aD <= 31) || aH > 23 || aMi > 59) return null;
			const rest = s.slice(sm.index + sm[0].length);
			// 右端三种写法：① 只有钟点（同左端日期）② 日 + 钟点（月沿用左端）③ 月日 + 钟点（可带年份）
			let bY = startY, bMo = aMo, bD = aD, bH = 0, bMi = 0, ok = false;
			const onlyClock = rest.match(/^\s*~\s*(\d{1,2}):(\d{2})/);
			const full = rest.match(/^\s*~\s*(?:(\d{4})\s*[\/\-年]\s*)?(?:(\d{1,2})\s*[\/月]\s*)?(\d{1,2})\s*日?\s*(\d{1,2}):(\d{2})/);
			if (onlyClock) {
				bH = Number(onlyClock[1]); bMi = Number(onlyClock[2]); ok = bH <= 23 && bMi <= 59;
			} else if (full) {
				bMo = full[2] != null ? Number(full[2]) : aMo;
				bD = Number(full[3]); bH = Number(full[4]); bMi = Number(full[5]);
				ok = bMo >= 1 && bMo <= 12 && bD >= 1 && bD <= 31 && bH <= 23 && bMi <= 59;
				if (ok && full[1] != null) bY = Number(full[1]);
				// 跨年：右侧月份小于左侧（12月→1月）；有显式年份时以显式为准
				else if (ok && full[2] != null && endsNextYear(aMo, null, bMo, null)) bY = startY + 1;
			}
			if (!ok) return null;
			const startTs = sourceInstant(startY, aMo, aD, aH, aMi, tz);
			const endTs = sourceInstant(bY, bMo, bD, bH, bMi, tz);
			if (endTs <= startTs) return null;
			// 超长窗口（>120 天）当常驻/误解析，不参与"当期"判定（阈值与全仓唯一真源共用）
			const win = { startTs, endTs, startText: "", endText: "", raw: `${fmtMdHm(startTs, tz)} ~ ${fmtMdHm(endTs, tz)}` };
			if (isLongTermWindow(win)) {
				if (!keepLongTerm) return null;
				win.longTerm = true;
			}
			return win;
		}

		// 正文 → 时间块数组：[{label, tag:"招募"|"活动"|"", startTs, endTs, raw, longTerm?}]
		// 只认「■ 标签」开头的块，且只收**块内能解析出起止**的行：
		//   ■ 活动时间
		//   · 活动持续时间：10月08日 14:00 ~ 10月22日 13:59   ← 这才是**活动本身的档期**
		//   · 商店兑换时间：10月08日 14:00 ~ 10月29日 13:59   ← 商店关店时间，不是活动档期 ⇒ **必须排除**
		// 为什么要排除"辅助窗口"（商店/兑换/任务/奖励/领取/结算…）：
		//   它们通常比活动**晚一周**结束。若一并当候选，活动结束后的一周里会显示
		//   「-ive aLIVE! 10-08 ~ 10-29」——**错的档期**（活动其实 10-22 就结束了）。
		//   实测（2026-10-25 真值）：-ive aLIVE! 持续时间到 10-22 13:59，商店到 10-29 13:59。
		function baCnTimeBlocks(text, nowYear, tz) {
			const out = [];
			const lines = String(text || "").split("\n");
			let label = "";
			for (const rawLine of lines) {
				const line = rawLine.trim();
				if (!line) continue;
				const head = line.match(/^■\s*(.+)$/);
				if (head) {
					label = head[1].replace(/\s+/g, "").replace(/[:：]/g, "");
					continue;
				}
				if (!label) continue;
				// 「日期前面那段文字」= 本行的窗口名；命中辅助窗口就直接丢
				const aux = line.split(/[:：]/)[0];
				if (/商店|兑换|任務|任务|奖励|獎勵|领取|領取|结算|結算|购买|購買|签到|簽到/.test(aux)) continue;
				// ⚠️ keepLongTerm=true：>120 天的长窗口也收进来（带 longTerm 标记），
				// 由调用方 `baCnFromNoticeBlocks` 排除出"当期"候选、只计 permanentCount。
				// 若在这里就 return null，长窗口会**无声消失**（"源站有、面板没有"）。
				const win = baCnWindowIn(line, nowYear, tz, true);
				if (!win) continue;
				const tag = /招募/.test(label) ? "招募" : (/活动|活動/.test(label) ? "活动" : "");
				if (!tag) continue;                     // 维护时间/补偿时间等与卡池/活动无关的块
				out.push({ label, tag, ...win });
			}
			return out;
		}

		// 一篇公告正文 → 卡池信息（类型 / 成员 / 池名），文本取不到的就留空（**不影响档期**）
		function baCnPoolInfoFromNotice(title, text, block) {
			const lead = String(text || "").split("\n").slice(0, 6).join("\n");
			// 「限时招募【池名】即将开启」/「限时限定复刻招募【池名】」—— `招募` 前面的前缀就是卡池类型
			const typeM = lead.match(/([^\s，。！【】]{1,12}?)招募\s*【([^】]+)】/);
			const prefix = typeM ? typeM[1] : "";
			const kind = /限定/.test(prefix)
				? (/复刻|復刻/.test(prefix) ? "限定复刻" : "限定")
				: (/复刻|復刻/.test(prefix) ? "复刻" : "");
			// 成员：`全新3★成员"夏（乐队）"登场` / `3★限定成员"和纱（乐队）"的招募概率得到提升`
			const memM = lead.match(/成员\s*["“「]([^"”」\n]{1,24})["”」]/);
			const fromTitle = (String(title || "").match(/[:：]\s*(.+)$/) || [])[1] || "";
			return {
				kind,
				typeName: `限时${kind}招募`,
				member: baRoleName(String(memM ? memM[1] : fromTitle).trim()),
				poolName: typeM ? typeM[2] : "",
				startTs: block.startTs,
				endTs: block.endTs
			};
		}

		// 活动名（纯函数）：**不许按标点截断**。
		//
		// ⚠️ 2026-10-21 修（用户报「ba-cn 活动名称不完整」）：老实现是
		//      `fromTitle = title.match(/[:：]\s*(.+)$/)[1]`
		//    —— 把**第一个冒号之前**整段丢掉。冒号前是纯类别词（「限时活动」）时这样正好；
		//   但它也可能是**玩法名**，丢掉就不是"简洁"而是"残缺"。实测当前 30 篇里的反例：
		//      【预告】综合战术测试：护卫 • 特殊装甲 → 旧：护卫 • 特殊装甲
		//      【预告】总力战：猫鬼黑影 • 街区战     → 旧：猫鬼黑影 • 街区战
		//      【预告】大决战：比纳 • 街区战         → 旧：比纳 • 街区战
		//      【预告】无限制决战：提翡瑞 • 重装甲   → 旧：提翡瑞 • 重装甲
		//   标题**没有冒号**时更糟：`fromTitle` 取不到 → 活动名直接是空串（面板落成 "—"）：
		//      【预告】掉落量3倍活动即将开启！ / 【预告】家具互动即将更新 / 【预告】区域29更新 / 【预告】限时签到活动
		//
		//   所以规则改成：只去掉「【预告】」这类**发布标记**与**纯类别词**前缀，其余原样保留
			//   （含「：」「（）」「！」，一律不切）。
			//   ⚠️ 2026-10-21 用户指定改口径：活动名**连类别一起显示** ——
			//   `【预告】限时活动：-ive aLIVE!` 的名字就是「限时活动：-ive aLIVE!」，
			//   不再剥掉类别词前缀；玩法前缀本来就是名字的一部分。

		function baCnEventName(title) {
			const t = String(title || "")
				.replace(/^【(?:预告|預告|公告|通知)】\s*/, "")
				.replace(/\s+/g, " ")
				.trim();
			const m = t.match(/^([^：:]{1,16})[：:]\s*(.+)$/);
			return t;
		}


		// 一篇公告正文 → 活动信息（名称）
		// 名称来源优先级：正文里**明确写着活动名**的位置 → 标题。
		// "明确位置"只有两种（其余一律不取，否则会把正文里的"活动指南/活动商店"抓成名字）：
		//   · 显式的 `活动名：X` 标注行
		//   · `…活动【X】` 这种"活动"后紧跟【】的句式（维护公告里的 `更新限时活动【X】` 就是它）
		// 且只在**正文开头**（前 6 行）找 —— 活动名不会出现在正文深处。
		function baCnEventNameFromNotice(title, text) {
			const lead = String(text || "").split("\n").slice(0, 6).join("\n");
			const lineM = lead.match(/活动名\s*[：:]\s*([^\n]{1,40})/);
			const bracketM = lead.match(/活动\s*【([^】]{1,40})】/);
			return baCnEventName((lineM && lineM[1]) || (bracketM && bracketM[1]) || title);
		}


		// 正文里的「剧情/正篇」标志（③ 源级主活动判断的第一优先级）。
		// 这些都是**只有剧情正篇活动才写进正文**的段落名，实测（2026-10-21 的 30 条）：
		//   1974「-ive aLIVE!」正文命中 5/5（活动故事关卡 / 活动指南 / 活动限定成员 / 挑战关卡 / 成就任务）
		//   1968「沙勒总决算」（AP→道具→商店兑换的伴随活动）**0 命中**
		//   1967「无限制决战：提翡瑞」只命中「挑战关卡」（玩法类，同为第一档 —— 实测无冲突：
		//   它在列表里排 aLIVE 之后，同级按列表顺序，aLIVE 先）
		//   1964「掉落量3倍」0 命中
		const BA_CN_STORY_RE = /活动故事关卡|活动限定成员|活动指南|挑战关卡|成就任务/;


		function baCnEventInfoFromNotice(title, text, block) {
			return {
				name: baCnEventNameFromNotice(title, text),
				startTs: block.startTs,
				endTs: block.endTs,
				// `story` 只用于**外显挑选**（不进 data、不进悬停文案）：正文有剧情/正篇标志
				story: BA_CN_STORY_RE.test(String(text || ""))
			};
		}


		// ③ 国服**源级**主活动判断（只影响 ba-cn；共享的 `pickEventPrimary` 一个字都没改）。
		//
		// WHY 需要它：`events` 是按**列表顺序**（= 官方发帖倒序，最新在前）收集的，
		//   `events[0]` = "最近公布的活动"，与"这期的主活动/正篇"没有因果关系。
		//   2026-10-21 实测：覆盖当前的有 4 条，`events[0]` 恰好是 aLIVE（碰巧对）：
		//     1974 限时活动：-ive aLIVE!        ← 剧情正篇（有活动故事关卡/限定成员/指南/小游戏/挑战）
		//     1968 限时活动：沙勒总决算        ← AP→道具→商店兑换的**伴随活动**（无剧情/无关卡/无成员）
		//     1967 无限制决战：提翡瑞 • 重装甲  ← 玩法
		//     1964 掉落量3倍活动即将开启！      ← 加成
		//   若运营**先发总决算、后发 aLIVE**，`events[0]` 就是总决算 —— 那才是真正的错。
		//   所以这里按"内容形态"而不是"发帖顺序"选，见下。
		//
		// 优先级（**同级内保持传入顺序 = 列表顺序**，不按结束时间等任何其它键 —— 否则同名同档的
		//   几次刷新会来回跳）：
		//   ① 正文有剧情/正篇标志（`story`）
		//   ② 名字含「限时活动」且**不含**「总决算」（排除伴随活动）
		//   ③ 其余（玩法/加成/其它）
		//   ④ 兜底：全部同级时就是 `events[0]`（= 改造前行为，不会变成 null）
		//
		// 容错：`story` 取不到（旧数据/未算）→ 退回看 `text`；再取不到 → 落到下一级；
		//   任何离谱入参（null / 非数组 / 抛异常的 getter）都只会退到兜底，**绝不抛**。
		function baCnPickPrimary(events) {
			const list = (Array.isArray(events) ? events : []).filter((x) => x && typeof x === "object");
			if (list.length === 0) return null;
			const storyOf = (x) => {
				if (typeof x.story === "boolean") return x.story;
				const t = typeof x.text === "string" ? x.text : "";
				return t !== "" && BA_CN_STORY_RE.test(t);
			};
			const tierOf = (x) => {
				try {
					if (storyOf(x)) return 1;
					const name = String(x.name == null ? "" : x.name);
					if (/限时活动/.test(name) && !/总决算/.test(name)) return 2;
					return 3;
				} catch {
					return 3;              // 取字段抛了 → 当"其余"，不影响其它候选
				}
			};
			let best = list[0];
			let bestTier = tierOf(best);
			for (let i = 1; i < list.length; i++) {
				const t = tierOf(list[i]);
				if (t < bestTier) { best = list[i]; bestTier = t; }
			}
			return best;
		}


		// ②/③ 共用：扫**列表行**（content 即全文 → **零额外请求**），挑出覆盖当前时刻的招募/活动时间块。
		// previewOnly=true → 只认标题带「预告」的条目（②「预告类条目」）；false → 任意条目（③ 兜底）。
		//
		// 卡池外显口径与 ① 一致：`限时[限定][复刻]招募`（取档位最优的那类），角色为**同期全部**招募池的成员
		// 合并（去重、按文档顺序）。活动外显走 `baCnPickPrimary`（③：剧情正篇 > 限时活动 > 其余）；
		// **同期其余活动一律进 `eventHover`**（②：外显那条排第一，其余按列表顺序逐行）——
		// 单条时悬停工具返回 ""，交回 UI 的两行式，与其它源一致。
		function baCnFromNoticeBlocks(rows, opts) {
			const { now, nowYear, tz, previewOnly } = opts;
			const pools = [];
			const events = [];
			let permanentCount = 0;
			for (const it of rows || []) {
				const title = String(it?.title || "");
				if (previewOnly && !/预告/.test(title)) continue;
				const text = baCnNoticeText(it?.content);
				if (!text) continue;                      // 列表 content 被截断 → 跳过（不再为它拉详情：零额外请求）
				const blocks = baCnTimeBlocks(text, nowYear, tz);
				if (blocks.length === 0) continue;
				// 常驻/长期（>120 天，判定走全仓唯一真源）不参与"当期"，但也不能无声消失：
				// 末尾按既有 `permanentCount` 约定补一行计数（与通用源 `genericEventPayload` 同做法）。
				permanentCount += blocks.filter((b) => b.tag === "活动" && b.longTerm && coversNow(b, now)).length;
				const rec = blocks.find((b) => b.tag === "招募" && !b.longTerm && coversNow(b, now));
				if (rec) pools.push(baCnPoolInfoFromNotice(title, text, rec));
				const ev = blocks.find((b) => b.tag === "活动" && !b.longTerm && coversNow(b, now));
				if (ev) events.push(baCnEventInfoFromNotice(title, text, ev));
			}
			if (pools.length === 0 && events.length === 0) return null;
			const ranked = pools.slice().sort((a, b) => (BA_CN_POOL_RANK[a.kind] ?? 9) - (BA_CN_POOL_RANK[b.kind] ?? 9));
			const primary = ranked[0] || null;
			const ev = baCnPickPrimary(events);
			// ② 悬停：**外显那条排第一**（仓库既有不变量：外显必须能在悬停里看到），其余按列表顺序。
			// 零额外请求（content 已是全文）；<2 条时返回 ""（或只剩常驻计数行）。
			//
			// ⚠️ 这里用 `hoverEvent(…, tz)`（本体 buildEventHover 的 **tz 版复刻**，排版逐字一致）：
			//   ba-cn 的 `eventDates` 是 `fmtWindow(..., tz)`（源站 +08 墙钟），悬停必须同口径。
			//   （2026-10-21 之前本体 `buildEventHover` 不接受 tz、会用**机器本地时区**格式化档期，
			//    在 `$env:TZ=UTC` 下实测到悬停 06:00 vs 外显 14:00；本体当天已补上 tz 参数，
			//    两条路径现在等价 —— 这里保持 hoverEvent 不动，避免无谓改动已验收的 ba-cn 输出。）
			const eventHover = hoverEvent(ev ? [ev, ...events.filter((x) => x !== ev)] : events, tz, permanentCount);
			const data = {
				banner: primary ? primary.typeName : "",
				roles: [...new Set(pools.map((p) => p.member).filter(Boolean))].join("、"),
				bannerDates: primary ? fmtWindow(primary.startTs, primary.endTs, tz) : "",
				event: ev ? ev.name : "",
				eventDates: ev ? fmtWindow(ev.startTs, ev.endTs, tz) : ""
			};
			if (eventHover) data.eventHover = eventHover;
			if (!data.banner && !data.event) return null;
			return data;
		}


		// 蔚蓝国服（官网 bluearchive-cn.com）：news/list → 最新维护更新说明 → 当期卡池/活动名 + 维护起止
		// 时间：维护日 14:00 ~ 下次维护前（约 +14 天，取维护日开始、预加载下一期预告前）
		async function fetchBaCn(listUrl, _signal, tz, now = nowMs()) {
			const H = { "game-alias": "ba" };
			const ref = "https://bluearchive-cn.com/";
			const nowYear = new Date(now).getFullYear();
			const list = await proxyFetchJson(listUrl, ref, H);
			const rows = list?.data?.rows || [];
			const clean = (s) => String(s || "")
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(/<[^>]+>/g, "")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
			// 窗口匹配：对最新的若干篇"维护更新说明"，按其正文首个维护时间（起）+14 天（卡池窗口）判定是否覆盖 now；
			// 列表 content 被截断时按 id 取详情补齐再判定；选覆盖 now 的那一篇（不再无条件取最新）
			const mains = rows.filter((n) => /维护更新说明/.test(n.title || ""));
			let maintTitle = null;
			let maintRaw = null;      // 选中那篇的**原始正文**：循环里已经为它抓过详情时直接复用，不再重复请求
			for (const it of mains.slice(0, 8)) {
				let raw = String(it.content || "");
				let txt = clean(raw);
				let first = txt.match(/(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})/);
				if (!first && it.id) {
					try {
						const det = await proxyFetchJson(`https://bluearchive-cn.com/api/news/detail?id=${it.id}`, ref, H);
						raw = String(det?.data?.news?.content || "");
						txt = clean(raw);
						first = txt.match(/(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})/);
					} catch { /* 跳过该候选 */ }
				}
				if (!first) continue;
				const mo = Number(first[1]), d = Number(first[2]);
				const startTs = new Date(nowYear, mo - 1, d, Number(first[3]), Number(first[4])).getTime();
				const endTs = new Date(nowYear, mo - 1, d + 14, 13, 59).getTime();
				if (startTs <= now && now <= endTs) { maintTitle = it; maintRaw = raw; break; }
			}
			// ---- ① 「维护更新说明」解析（**原逻辑逐字保留**，优先级最高，不许回归）----
			// 找不到覆盖当前的维护公告、或那篇正文里没有「更新限时…招募【…】」句式 → **不再直接判死**，
			// 而是往下走 ②/③（这正是 2026-10-15 那篇公告失灵的根因：它只有区域/预加载，没有招募句式）。
			if (maintTitle?.id) {
				// 选中那篇若已经在上面抓过详情（列表 content 被截断的情况）→ 直接复用，省掉一次代理往返
				const content = maintRaw || String((await proxyFetchJson(`https://bluearchive-cn.com/api/news/detail?id=${maintTitle.id}`, ref, H))?.data?.news?.content || "");
				if (content) {
					const d1 = parseBaCnMaintText(baCnNoticeText(content), nowYear, tz);
					if (d1) return d1;
				}
			}
			// ---- ② 「预告」类条目的结构化时间块（招募/活动各取一条，用 coversNow 选当期）----
			const d2 = baCnFromNoticeBlocks(rows, { now, nowYear, tz, previewOnly: true });
			if (d2) return d2;
			// ---- ③ 兜底：任意条目里能解析出"覆盖当前时刻的招募/活动时间块"就用 ----
			// （宁可用带标题的近似，也不要空白；仍然靠 coversNow 判定，不会显示错档期）
			return baCnFromNoticeBlocks(rows, { now, nowYear, tz, previewOnly: false });
		}

		// 国服公告里「招募」开头的东西**不是一类**。实测（09月24日维护更新说明）：
		//   更新限时限定招募【秩序隐匿于粼粼波光中】   ← 限定角色卡池（当期主卡池）
		//   更新限时限定招募【思绪飘散在漫漫夏夜里】   ← 限定角色卡池（同期第二池）
		//   更新限时招募活动【100次免费招募】          ← 免费招募**活动**（不是卡池）
		//   更新限时招募活动【3★必得招募】            ← 必得**活动**
		//   更新限时招募活动【3★限定成员必得招募】    ← 限定必得**活动**
		//   更新限时招募活动【3★自选招募】            ← 自选**活动**
		// 关键区分点在**词序**：`…招募【` 后面紧跟 `】` 的是**卡池名**；
		//   而 `招募活动【` 是"招募"作定语去修饰"活动"，是**活动**。
		// 曾经的糟糕修法是"把所有 招募 塞进一条正则按出现顺序取第一条" —— 那等于把
		// 限定卡池与招募活动混成同一类（用户指出）。这里按类型分级取，并显式排除活动类。
		const BA_CN_CHAR_POOL_RE = /^更新限时(限定复刻|限定|复刻|)招募$/;

		// 档位：限定角色池 > 普通角色池 > 限定复刻池 > 复刻池（数值越小越优先）
		const BA_CN_POOL_RANK = { 限定: 0, "": 1, 限定复刻: 2, 复刻: 3 };


		function baCnPoolInfo(line) {
			const m = line.match(/更新限时([^【]*)【([^】]+)】/);
			if (!m) return null;
			const t = BA_CN_CHAR_POOL_RE.exec(`更新限时${m[1]}`);
			return { isPool: !!t, kind: t ? t[1] : "", name: m[2] };
		}


		// 国服维护公告正文 → 卡池/活动数据（纯函数：只吃**已清洗的文本**，不碰网络）。
		// 抽出来是为了能用合成文本精确回归 —— 这个源的坑全在措辞（见上面类型表），
		// 而措辞能不能认出来只能靠测解析，靠抓线上只能"等它坏了才发现"。
		// 无角色卡池时返回 null（调用方据此判"未公布"）。
		function parseBaCnMaintText(text, nowYear, tz) {
			// 卡池识别分两步：① 挑出**角色卡池**（排除招募活动）；② 按档位选外显那一类。
			//
			// WHY 不能只认一种写法：措辞漂移过。旧写法 `更新限时招募【X】` 曾一度**一处都没有**
			//   （实测 0 处），当前正文用的是 `更新限时限定招募【X】`。老代码只认旧写法 →
			//   banner 为空 → 末尾 `if (!data.banner) return null` 把整条记录判死，
			//   表现为卡池与活动**两列同时**「无匹配/未公布」（两列共用本函数）。
			const bannerPools = [];
			for (const line of text.split("\n")) {
				const info = baCnPoolInfo(line);
				if (info && info.isPool) bannerPools.push({ ...info, line });
			}
			// 按（档位, 出现顺序）取最优：稳定排序即可，因为 bannerPools 已按文档顺序收集
			bannerPools.sort((a, b) => (BA_CN_POOL_RANK[a.kind] ?? 9) - (BA_CN_POOL_RANK[b.kind] ?? 9));
			const bannerPool = bannerPools[0] || null;
			// 当期活动名（第一个"更新限时活动【X】"）
			const eventM = text.match(/更新限时活动【([^】]+)】/);
			// 维护开始时间 "08月20日 14:00"
			const maintM = text.match(/(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})/);
			const fmt = (mo, d, h, mi) => `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
			let bannerDates = "", eventDates = "";
			if (maintM) {
				const mo = Number(maintM[1]), d = Number(maintM[2]);
				const start = fmt(mo, d, Number(maintM[3]), Number(maintM[4]));
				// 卡池结束：约 14 天后（下一期维护）
				const end = new Date(nowYear, mo - 1, d + 14, 13, 59);
				bannerDates = `${start} ~ ${fmt(end.getMonth() + 1, end.getDate(), end.getHours(), end.getMinutes())}`;
				// 活动结束：约 28 天后（蓝档国服活动通常比卡池多一期，如和乐庆典到 09-17 13:59）
				const eEnd = new Date(nowYear, mo - 1, d + 28, 13, 59);
				eventDates = `${start} ~ ${fmt(eEnd.getMonth() + 1, eEnd.getDate(), eEnd.getHours(), eEnd.getMinutes())}`;
			}
			// 公告里同期**全部角色卡池**（只含卡池，不含招募活动）：池名 + 该行成员名，如
			// 2、更新限时招募【夏日思绪长…】，…全新3★成员「桔梗（泳装）」、2★成员「莲华（泳装）」登场
			const recPools = bannerPools.map((p) => {
				const members = [...new Set([...p.line.matchAll(/(?:\d★)?(?:限定)?成员\s*[「“"]([^」”"]+)[」”"]/g)].map((x) => baRoleName(x[1].trim())).filter(Boolean))];
				return { name: p.name, kind: p.kind, members };
			});
			// ---- 外显 = **卡池类型**（对齐国际服「特選招募」的呈现方式），不是某个池名 ----
			//
			// WHY 改成显示类型（用户要求，2026-09-30）：国服一期公告常同时开**同类多个池**
			//   （当期两个「限定招募」），只显示第一个池名会漏掉另一个池；而卡池类型才是
			//   "这一期在开什么"的稳定答案。国际服走结构化日程表，外显本来就是类别（`特選招募`），
			//   这里对齐它。
			// 同类型多池的**角色合并**展示（同国际服 roles 的做法）；悬停只列同类型那些池，
			// 不把其它档位的池混进来（否则"显示限定招募、悬停却列着复刻池"自相矛盾）。
			//
			// 类型只放在 `banner` 里（悬停第一行会显示它，与国际服 `特選招募` 的位置一致）。
			// **不另外加 `bannerKind` 字段**：面板卡片格的规则是"有角色就显示角色"，
			// 而 core 的 Result JSON 是冻结契约、字段白名单外的会被丢掉（实测过），
			// 想让卡片显示类型就得改契约。用户 2026-09-30 选择方案 A（类型只进悬停），
			// 故这里不留没有消费者的字段。
			const bannerKind = bannerPool ? bannerPool.kind : null;
			// 类型名 = **限时[限定][复刻]招募** —— 注意**不带 `更新`**。
			//
			// 公告原文是 `2、更新限时限定招募【秩序隐匿于粼粼波光中】`，断句是：
			//   「更新」= 公告的动词（这期更新了什么），「限时限定招募」= 卡池类型。
			// 我最初写成 `更新限时${kind}招募`（`更新限时限定招募`）是把动词也吞进了类型名——
			// 卡池不叫"更新限时限定招募"，就叫"限时限定招募"（用户指出）。
			const bannerTypeName = bannerPool ? `限时${bannerKind}招募` : "";
			const sameKindPools = bannerPool ? recPools.filter((p) => p.kind === bannerKind) : [];
			const roleNames = [...new Set(sameKindPools.flatMap((p) => p.members))];
			const data = {
				banner: bannerTypeName,
				roles: roleNames.join("、"),
				bannerDates,
				event: eventM ? eventM[1] : "",
				eventDates
			};
			// 卡池列悬停：**不单独构造 `bannerHover`**（用户要求"悬停显示卡池类型"，2026-09-30）。
			//
			// 原因：国服的"类型"已经在 `banner` 里（如 `更新限时限定招募`），而面板的悬停规则是
			//   `title = withFailNote(g.bannerHover || gachaTitle, …)`
			//   `gachaTitle = (g.roles ? `${g.banner}：${g.roles}` : g.banner) + 日期`
			// 所以**不设 bannerHover 时，悬停自然就是**
			//   `更新限时限定招募：莲见(泳装)、圣娅(泳装)`
			//   `09-24 14:00 ~ 10-08 13:59`
			// —— 已含类型，且类型与卡片口径一致。
			//
			// 曾试过"每池一行、以类型开头"，但国服一期常开**同类多池**，那样会输出多行**完全一样**
			// 的文字（只有成员不同）；而按类型归并成一条后，`buildPoolHover` 对 0/1 池返回空串
			// （全站共用的兜底约定）。结论：这里根本不需要 bannerHover，交给 UI 的兜底更准。
			if (!data.banner) return null;
			return data;
		}

		const TZ_JP = "Asia/Tokyo";         // UTC+9：日服


		const TZ_UTC = "UTC";               // UTC  ：国际服


		const BA_JP_NEWS_URL = "https://api-web.bluearchive.jp/api/news/list?pageIndex=1&pageNum=30";


		// 国际服 GameKee 默认源：目录树的「当期活动 · 当期卡池」页（稳定 id=15；GameKee 抓取器按目录树
		// 找子条目，本身**不读 url** —— 这里的地址只用于设置页默认项/来源地址的真实展示）。
		const BA_GK_HOME = "https://www.gamekee.com/ba/huodong/15";


		// 国际服 Nexon 官方更新日誌（**备选**源：内容更全——含「特選招募」类别与角色名，
		// 但 forum.nexon.com 在大陆被地区封锁 → 不能做默认，见下面 registerSource 的注释）
		const BA_GLOBAL_NEXON_URL = "https://forum.nexon.com/api/v1/board/3352/threads?alias=bluearchiveTW&countryCode=KR&pageNo=1&paginationType=PAGING&pageSize=30&blockSize=5&hideType=WEB";


		// ── 条目 ──
		registerSource({
				id: "ba-cn",
				defaultHidden: false,
				tz: TZ_CN,
				parserVersion: 1,
				name: "蔚蓝档案·国服",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/7c/4f/1a/7c4f1a51-59e5-977c-42e2-6c980485044a/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
				source: "\u5B98\u7F51\u516C\u544A",
				// 经 host 代理 POST 抓取（官网 CORS=null + 动态 SPA）；维护说明同时含当期卡池与活动
				url: "https://bluearchive-cn.com/api/news/list?pageIndex=1&pageNum=30&type=",
				// 活动默认源与卡池源相同（同一公告解析活动名），可独立切换
				eventUrl: "https://bluearchive-cn.com/api/news/list?pageIndex=1&pageNum=30&type=",
				eventSource: "\u5B98\u7F51\u516C\u544A"
		});

		registerSource({
				id: "ba-global",
				defaultHidden: false,
				tz: TZ_UTC,
				parserVersion: 1,
				name: "蔚蓝档案·国际服",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/2/25/AppIcon_Arona.png!/fw/512",
				source: "GameKee \u5F53\u671F\u5361\u6C60",
				// 默认走 GameKee（www.gamekee.com）：Nexon 官方论坛（forum.nexon.com）在大陆被地区封锁
				// （itdog 大陆 275 节点里 269 个 403；海外 43/43 正常）→ 用它做默认会让大陆用户
				// 这一格**永远空白**。改成 GameKee 后大陆可直达。
				// 注意：`ba-global` 的抓取器（GACHA_FETCHERS["ba-global"] → fetchGameKeeBa）自带地址
				// （按目录树找「国际服当期卡池/当期活动」），所以这里 url/eventUrl 只作**展示**；
				// 仍填真实可打开的 GameKee 页面，免得设置页把地址显示成一条不存在的路由。
				url: BA_GK_HOME,
				// 备选：Nexon 官方更新日誌（境外可达时信息更全；label 里注明"大陆不可达"）
				altSources: [
					{ label: "Nexon 更新日誌（直连不稳）", url: BA_GLOBAL_NEXON_URL, fetcher: "ba-global-nexon" }
				],
				// 活动默认源与卡池源相同（同一份 GameKee 载荷同时含"国际服当期活动"），可独立切换（如 Nexon）
				eventUrl: BA_GK_HOME,
				eventSource: "GameKee \u5F53\u671F\u6D3B\u52A8",
				// 活动备选来源
				eventAltSources: [
					{ label: "Nexon 更新日誌（直连不稳）", url: BA_GLOBAL_NEXON_URL, fetcher: "ba-global-nexon" }
				]
		});

		registerSource({
				id: "ba-jp",
				defaultHidden: false,
				tz: TZ_JP,
				parserVersion: 1,
				name: "蔚蓝档案·日服",
				icon: "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/b2/83/84/b28384e9-b106-b48e-fc66-04679cd44d76/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
				source: "官方公告（日文）",
				// 日服官网新闻接口（api-web.bluearchive.jp，经 host 代理）：「ピックアップ募集紹介」公告
				// 内含逐池「ピックアップ名／ピックアップ生徒」与「実施期間」，可直接得到日文官方池名与 UP 生徒
				url: BA_JP_NEWS_URL,
				// 卡池备选：GameKee 当期卡池（原标题解析，只有池名+档期、无角色名）
				altSources: [
					{ label: "GameKee 当期卡池", id: "ba-jp:gamekee", fetcher: "ba-jp-gamekee" }
				],
				// 活动源与卡池源保持独立（解耦）：默认仍是原「GameKee 当期活动」条目；
				// 官方公告的イベント条目作为**可选备选**（备选 value 用其接口地址，抓取器 ba-jp-official）
				eventUrl: "https://www.gamekee.com/ba/huodong/15",
				eventSource: "GameKee 当期活动",
				eventAltSources: [
					{ label: "官方公告（日文）", url: BA_JP_NEWS_URL, fetcher: "ba-jp-official" }
				]
		});

		// ── 抓取器登记 ──
		GACHA_FETCHERS["ba-cn"] = (url, signal, tz) => fetchBaCn(url, signal, tz);
		// 国际服默认 = GameKee（大陆可直达）；Nexon 官方降为备选（-nexon 后缀的抓取器键）
		GACHA_FETCHERS["ba-global"] = () => fetchGameKeeBa("global");
		// 旧备选标识的抓取器键保留：它仍是同一份 GameKee 逻辑，老配置若还带着
		// "ba-global:gamekee"（见 60-helpers.js 的 LEGACY_ALT_IDS）也不会抓不到东西。
		GACHA_FETCHERS["ba-global-gamekee"] = GACHA_FETCHERS["ba-global"];
		GACHA_FETCHERS["ba-global-nexon"] = (url, signal, tz) => fetchBaGlobal(url, signal, tz);
		GACHA_FETCHERS["ba-jp"] = (url, signal, tz) => fetchBaJpGacha(url, signal, tz);
		GACHA_FETCHERS["ba-jp-gamekee"] = () => fetchGameKeeBa("jp");
					// 蔚蓝国服：默认与卡池同 URL（维护公告含活动名），也可独立配置其他来源
EVENT_FETCHERS["ba-cn"] = {
				default: (url, signal, tz) => fetchBaCn(url, signal, tz)
			};
					// 蔚蓝国际服：默认与卡池同 URL（GameKee 同一份载荷含"国际服当期活动"）；备选 Nexon
EVENT_FETCHERS["ba-global"] = {
				default: () => fetchGameKeeBa("global"),
				"ba-global-gamekee": () => fetchGameKeeBa("global"),
				"ba-global-nexon": (url, signal, tz) => fetchBaGlobal(url, signal, tz)
			};
					// 蔚蓝日服：活动源与卡池源独立——默认 GameKee 当期活动条目（原行为不变）；
			// 备选 = 日服官方公告里的イベント条目（抓取器复用官方解析，仅取 event/eventDates）
EVENT_FETCHERS["ba-jp"] = {
				default: () => fetchGameKeeBa("jp"),
				"ba-jp-official": (url, signal, tz) => fetchBaJpOfficialEvent(url, signal, tz)
			};
