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
			const eventHover = buildEventHover(evOrdered);
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
			})));
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
			})));
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


		// GameKee：按服务器拉当期卡池+活动（标题含排期）
		// serverKey: "jp"|"global"；返回 {banner, roles, bannerDates, event, eventDates}
		async function fetchGameKeeBa(serverKey) {
			const ref = "https://www.gamekee.com/ba/huodong/15";
			const headers = { "game-alias": "ba" };
			// 1. 目录树 → 找"当期活动 | 当期卡池"子条目
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
			// 找该服条目：日服(jp) 活动/卡池；国际服(global) 活动/卡池
			const isJp = serverKey === "jp";
			const kw = isJp ? "日服" : "国际服";
			const eventEntry = child.find((c) => c.name.includes(kw + "活动"));
			const bannerEntry = child.find((c) => c.name.includes(kw + "当期卡池"));
			// 2. 拉标题（含排期）
			const getTitle = async (entry) => {
				if (!entry?.content_id) return null;
				const d = await proxyFetchJson(`https://www.gamekee.com/v1/content/detail/${entry.content_id}`, ref, headers);
				return typeof d?.data?.title === "string" ? d.data.title : "";
			};
			const bannerTitle = bannerEntry ? await getTitle(bannerEntry) : "";
			const eventTitle = eventEntry ? await getTitle(eventEntry) : "";
			const nowYear = new Date(nowMs()).getFullYear();   // 走注入时钟（core 不得直接读宿主时钟）
			const data = { banner: "", roles: "", bannerDates: "", event: "", eventDates: "" };
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
			if (eventTitle) {
				const rng = parseGkRange(eventTitle, nowYear);
				if (rng) {
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
			if (!data.banner || !data.bannerDates) return null;
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
			if (!maintTitle?.id) return null;
			// 选中那篇若已经在上面抓过详情（列表 content 被截断的情况）→ 直接复用，省掉一次代理往返
			const content = maintRaw || String((await proxyFetchJson(`https://bluearchive-cn.com/api/news/detail?id=${maintTitle.id}`, ref, H))?.data?.news?.content || "");
			if (!content) return null;
			// HTML → 文本
			const text = String(content)
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(/<[^>]+>/g, "")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/&ldquo;/g, "「").replace(/&rdquo;/g, "」")
				.replace(/&hellip;/g, "…").replace(/&times;/g, "×").replace(/&bull;/g, "·")
				.replace(/\n\s*\n+/g, "\n").trim();
			return parseBaCnMaintText(text, nowYear, tz);
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


		// ── 条目 ──
		registerSource({
				id: "ba-cn",
				defaultHidden: false,
				tz: TZ_CN,
				parserVersion: 1,
				name: "蔚蓝档案·国服",
				icon: "https://webcnstatic.yostar.net/ba_cn_web/prod/web/favicon.png?x-oss-process=image/resize,w_64",
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
				icon: "https://storage.moegirl.org.cn/moegirl/commons/2/25/AppIcon_Arona.png!/fw/64",
				source: "Nexon \u66F4\u65B0\u65E5\u8A8C",
				// 经 host 代理抓取（nexon CORS 只允许同源）；「更新日誌」board(3352) 同时含当期卡池与活动排期
				url: "https://forum.nexon.com/api/v1/board/3352/threads?alias=bluearchiveTW&countryCode=KR&pageNo=1&paginationType=PAGING&pageSize=30&blockSize=5&hideType=WEB",
				// 卡池备选：GameKee（中文标题含排期；默认仍是 Nexon 官方更新日誌）
				altSources: [
					{ label: "GameKee \u5F53\u671F\u5361\u6C60", id: "ba-global:gamekee", fetcher: "ba-global-gamekee" }
				],
				// 活动默认源与卡池源相同（更新日誌解析活动排期），可独立切换（如 GameKee）
				eventUrl: "https://forum.nexon.com/api/v1/board/3352/threads?alias=bluearchiveTW&countryCode=KR&pageNo=1&paginationType=PAGING&pageSize=30&blockSize=5&hideType=WEB",
				eventSource: "Nexon \u66F4\u65B0\u65E5\u8A8C",
				// 活动备选来源
				eventAltSources: [
					{ label: "GameKee \u5F53\u671F\u6D3B\u52A8", id: "ba-global:gamekee", fetcher: "ba-global-gamekee" }
				]
		});

		registerSource({
				id: "ba-jp",
				defaultHidden: false,
				tz: TZ_JP,
				parserVersion: 1,
				name: "蔚蓝档案·日服",
				icon: "https://play-lh.googleusercontent.com/H975s6W1-boCSogzpF5_rIyawbjiXfG842ncgjIRiVGzhXHFTCVut0DkBhlDR4CgN1nn98OOC1fWN-LE7kUHnQ=s64",
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
		GACHA_FETCHERS["ba-global"] = (url, signal, tz) => fetchBaGlobal(url, signal, tz);
		GACHA_FETCHERS["ba-global-gamekee"] = () => fetchGameKeeBa("global");
		GACHA_FETCHERS["ba-jp"] = (url, signal, tz) => fetchBaJpGacha(url, signal, tz);
		GACHA_FETCHERS["ba-jp-gamekee"] = () => fetchGameKeeBa("jp");
					// 蔚蓝国服：默认与卡池同 URL（维护公告含活动名），也可独立配置其他来源
EVENT_FETCHERS["ba-cn"] = {
				default: (url, signal, tz) => fetchBaCn(url, signal, tz)
			};
					// 蔚蓝国际服：默认与卡池同 URL（更新日誌含活动排期）；备选 GameKee
EVENT_FETCHERS["ba-global"] = {
				default: (url, signal, tz) => fetchBaGlobal(url, signal, tz),
				"ba-global-gamekee": () => fetchGameKeeBa("global")
			};
					// 蔚蓝日服：活动源与卡池源独立——默认 GameKee 当期活动条目（原行为不变）；
			// 备选 = 日服官方公告里的イベント条目（抓取器复用官方解析，仅取 event/eventDates）
EVENT_FETCHERS["ba-jp"] = {
				default: () => fetchGameKeeBa("jp"),
				"ba-jp-official": (url, signal, tz) => fetchBaJpOfficialEvent(url, signal, tz)
			};
