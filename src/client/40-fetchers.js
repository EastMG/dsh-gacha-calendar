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
			const b = parseZhTime(parts[1], am != null && bm != null && bm < am ? nowYear + 1 : nowYear);
			if (!a || !b) return null;
			return { startTs: a.ts, endTs: b.ts, startText: a.text, endText: b.text, raw: `${a.text} ~ ${b.text}` };
		}

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
		async function fetchBaGlobal(logListUrl, signal, now = nowMs()) {
			const ref = "https://forum.nexon.com/bluearchiveTW/";
			const list = await proxyFetchJson(logListUrl, ref);
			const threads = Array.isArray(list?.threads) ? list.threads : [];
			// 每篇日志的维护日取标题日期（"8/18(二) 更新日誌"）；日期跨年按当前年推断
			const y = new Date(now).getFullYear();
			const threadDate = (t) => {
				const m = String(t.title || "").match(/(\d{1,2})\/(\d{1,2})\(/);
				if (!m) return null;
				let d = new Date(y, Number(m[1]) - 1, Number(m[2]), 0, 0);
				if (d.getTime() > now + 45 * 864e5) d = new Date(y - 1, Number(m[1]) - 1, Number(m[2]), 0, 0);
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
			const bannerRow = rows.find((r) => /特選招募/.test(r.cat) && r.range && r.range.startTs <= now && r.range.endTs >= now);
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
			const recRows = rows.filter((r) => /招募/.test(r.cat) && r.range && r.range.startTs != null && r.range.endTs != null && r.range.startTs <= now && r.range.endTs >= now);
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

		// 终末地（wiki.gg 经 host 代理）：抓取 Headhunting/Banners HTML → parseEndfieldCurrent
		// wiki.gg 校验 Referer（非 wiki.gg 域名 403），经代理后 Referer=目标 origin 满足要求。
		// 注意：这个地址是 MediaWiki 的 **api.php**，返回的是 JSON（`{"parse":{"text":"<html>"}}`）——
		// 必须取 parse.text 再解析。旧实现直接把原始 JSON 串喂给解析器，于是 id="Current" 在 JSON 里是
		// 转义形式（id=\"Current\"）永远匹配不到 → 该备选源长期"抓得到但解析不出"（这才是真根因）。
		async function fetchEndfieldWikiGg(proxyUrl) {
			const json = await proxyFetchJson(proxyUrl, "https://endfield.wiki.gg/");
			const html = json?.parse?.text;
			if (typeof html !== "string") throw new Error("bad-json");
			return parseEndfieldCurrent(html);
		}

		// ---- 蔚蓝档案·日服 官方公告（api-web.bluearchive.jp）----
		// 「ピックアップ募集紹介」条目结构（同一公告内多池、逐池给出）：
		//   ▼ピックアップ対象
		//   ピックアップ名： 「そして夏は爆破で終わる！」
		//   ピックアップ生徒：★3「カスミ(水着)」
		//   ▼実施期間 2026年9月9日(水) メンテナンス後 ~ 2026年9月23日(水・祝) 10:59
		// 时间按 JST(+09:00) 解析（展示时转本地）；起点写「メンテナンス後」时取同期维护公告
		// 「▼実施時間 … ～ … 17:00前後」的结束时刻。活动取同期「イベント」条目的開催期間。
		function parseBaJpNews(json, now = nowMs()) {
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
			const cur = pools.filter((p) => p.endTs != null && p.endTs >= now && (p.startTs == null || p.startTs <= now));
			if (cur.length === 0) return null;
			// 展示用的档期必须取"被选中的那个池"自己的窗口（cur[0]）—— 旧实现固定取 windows[0]，
			// 一旦当期命中的不是第一个池，就会显示"B 池名字 + A 池时间"，倒计时按错档期跑。
			const win0 = cur[0];
			const dates = win0.startTs != null && win0.endTs != null ? fmtWindow(win0.startTs, win0.endTs) : (win0.raw || "");
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
		async function fetchBaJpGacha(url, signal, now = nowMs()) {
			try {
				const json = await proxyFetchJson(url, "https://bluearchive.jp/");
				const d = parseBaJpNews(json, now);
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
		async function fetchBaJpOfficialEvent(url, signal, now = nowMs()) {
			const json = await proxyFetchJson(url, "https://bluearchive.jp/");
			const d = parseBaJpNews(json, now);
			if (!d || !d.event) return null;
			return { event: d.event, eventDates: d.eventDates || "", eventDatesRaw: d.eventDatesRaw || d.eventDates || "" };
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
			const b = parseGkTime(parts[1], am != null && bm != null && bm < am ? nowYear + 1 : nowYear);
			if (!a || !b) return null;
			return { startTs: a.ts, endTs: b.ts, startText: a.text, endText: b.text, raw: `${a.text} ~ ${b.text}` };
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
		async function fetchBaCn(listUrl, now = nowMs()) {
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
			// 当期卡池名（第一个"更新限时招募【X】"或复刻）
			const bannerM = text.match(/更新限时招募【([^】]+)】/);
			const bannerR = text.match(/更新限时复刻招募【([^】]+)】/);
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
			// 公告里同期全部招募池（更新限时招募 / 更新限时限定复刻招募 / 更新限时复刻招募）：
			// 池名 + 该行成员名，如
			// 2、更新限时招募【夏日思绪长…】，…全新3★成员「桔梗（泳装）」、2★成员「莲华（泳装）」登场
			const recPools = [];
			for (const m of text.matchAll(/更新限时(?:限定复刻|复刻|)招募【([^】]+)】([^\n]*)/g)) {
				const members = [...new Set([...m[2].matchAll(/(?:\d★)?(?:限定)?成员\s*[「“"]([^」”"]+)[」”"]/g)].map((x) => baRoleName(x[1].trim())).filter(Boolean))];
				recPools.push({ name: m[1], members });
			}
			// 外显：合并同期各池成员（与其它游戏"同窗口角色合并"一致；此前只取第一个池的成员，导致外显不全）
			const roleNames = [...new Set(recPools.flatMap((p) => p.members))];
			const data = {
				banner: bannerM ? bannerM[1] : (bannerR ? `复刻·${bannerR[1]}` : ""),
				roles: roleNames.join("、"),
				bannerDates,
				event: eventM ? eventM[1] : "",
				eventDates
			};
			// 卡池列悬停：每池"池名：成员"一行；公告只给整期维护窗口 → 各池窗口相同，时间按"相同窗口合并"只在末尾写一遍
			if (maintM) {
				const mo = Number(maintM[1]), d = Number(maintM[2]);
				const sTs = new Date(nowYear, mo - 1, d, Number(maintM[3]), Number(maintM[4])).getTime();
				const eTs = new Date(nowYear, mo - 1, d + 14, 13, 59).getTime();
				const hover = buildPoolHover(recPools.map((p) => ({
					name: p.name,
					label: `${p.name}${p.members.length ? `\uFF1A${p.members.join("、")}` : ""}`,
					startTs: sTs,
					endTs: eTs,
					raw: bannerDates
				})));
				if (hover) data.bannerHover = hover;
			}
			if (!data.banner) return null;
			return data;
		}

		// 重返未来：1999 征集名增强源（小米游戏中心官方资讯流，SSR 页免登录可抓）
		// 官网资讯接口不发布征集名；小米游戏中心游戏页（game.xiaomi.com/game/62346241）的 SSR 数据
		// 含官方账号「神秘学研究员」最新 3 条资讯全文，其中「活动征集」公告带真实征集名与征集时间
		// （如【烈火悬流无尽】8/13 10:00-9/3 4:59、【湖的馈赠】自选六星 8/28 5:00-9/14 4:59）。
		// 主池优先：只认"征集时间覆盖当前时刻"且带定向 UP 的征集公告，且 UP 角色属于官网「新增角色」
		// （官方 SixStar 列表，如 赫多涅/纳西索斯）——自选六星池（无定向 UP）不作为主池；
		// 无主池匹配返回 null（由官网解析兜底显示角色名）。多条主池匹配取最新发布者。
		async function fetchXiaomiR99Gacha(gamePageUrl, officialSixStars) {
			const html = await proxyFetchText(gamePageUrl, "https://game.xiaomi.com/");
			const start = html.indexOf('"official":{"viewpoints":{"infos":[');
			if (start < 0) return null;
			const raw = html.slice(start);
			const marks = [...raw.matchAll(/\{"viewpointId":"/g)].map((x) => x.index);
			if (marks.length === 0) return null;
			const now = nowMs();
			const nowYear = new Date(now).getFullYear();   // 复用同一注入时钟（core 不得直接读宿主时钟）
			const fmt = (mo, d, h, mi) => `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
			let best = null;
			for (let i = 0; i < marks.length; i++) {
				const seg = raw.slice(marks[i], i + 1 < marks.length ? marks[i + 1] : raw.length);
				const title = (seg.match(/"title":"([^"]*)"/) || [])[1] || "";
				const texts = [...seg.matchAll(/"contentType":1,"positionIndex":\d+,"content":"([\s\S]*?)"/g)].map((x) => x[1]);
				const content = texts.join(" ").replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\u002F/g, "/").replace(/\\n/g, " ");
				if (!/征集/.test(title + content)) continue;
				const nameM = title.match(/【([^】]+)】活动征集/) || content.match(/【([^】]+)】活动征集/);
				if (!nameM) continue;
				// 征集时间："8/28 5:00-9/14 4:59" / "8/13 10:00 - 9/3 4:59"
				const timeM = content.match(/征集(?:开放)?时间[◀◀:：\s]*(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?\s*[-—~]\s*(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
				if (!timeM) continue;
				const sm = Number(timeM[1]), sd = Number(timeM[2]), sh = timeM[3] ? Number(timeM[3]) : 0, smi = timeM[4] ? Number(timeM[4]) : 0;
				const em = Number(timeM[5]), ed = Number(timeM[6]), eh = timeM[7] ? Number(timeM[7]) : 0, emi = timeM[8] ? Number(timeM[8]) : 0;
				const startTs = new Date(nowYear, sm - 1, sd, sh, smi).getTime();
				// 跨年（如 12/28-1/5）结束补下一年
				const endTs = new Date(em < sm ? nowYear + 1 : nowYear, em - 1, ed, eh, emi).getTime();
				if (startTs > now || endTs < now) continue; // 只取覆盖当期的征集
				// 主池判定：带定向 UP（【X】受邀概率UP）且 UP 角色属于官网新增角色
				const upM = title.match(/【([^】]+)】受邀概率UP/) || content.match(/【([^】]+)】受邀概率UP/);
				const upName = upM ? cleanRoles(upM[1]).replace(/[（）()].*$/, "") : "";
				const isMain = upName !== "" && Array.isArray(officialSixStars) && officialSixStars.includes(upName);
				if (!isMain) continue; // 自选六星池等非主池不作为当期卡池
				const cand = {
					banner: nameM[1],
					bannerDates: `${fmt(sm, sd, sh, smi)} ~ ${fmt(em, ed, eh, emi)}`,
					roles: upName,
					order: i
				};
				// 多条主池覆盖当期时取最新发布（feed 靠前者更新）
				if (!best || cand.order < best.order) best = cand;
			}
			return best ? { banner: best.banner, bannerDates: best.bannerDates, roles: best.roles } : null;
		}

		// ---- 重返未来：1999 官方游戏内公告（noticecp）----
		// 官网 CMS 公告只发布维护时间与活动名，**逐期征集起止**只出现在官方游戏内公告的
		// 「X.X「…」版本活动一览」里：正文是块状富文本（content 为 JSON 字符串），按
		// `「名称」类型` 分段 —— 征集段含【征集时间】+【征集说明】(6★/5★ UP)，活动段含【活动时间】。
		// 接口归属：notice.sl916.com 证书主体=广州深蓝互动网络科技有限公司（与官网 re.bluepoch.com
		// 同主体、同 EdgeOne CDN），免登录/无 CORS，经 host 代理读取；开源项目 MAA1999/M9A 长期使用
		// 同一接口（见 README 致谢）。一版本上下半场两期都列在同一篇里，下期常提前公布。
		// 征集类别 → 外显优先级（用户拍板的口径）：
		//   限定系（巡游限定 › 限定复刻 › 巡游限定复刻 › 联动 › 限定）＞ 活动征集 ＞ 限时征集 ＞ 轮换征集。
		// 同类内先结束者优先（与其它游戏"越快结束越靠前"一致）；**未登记的类别排到最后**（只进悬停、不抢外显），
		// 将来官方造新词时不会顶掉主池。
		const R99_POOL_TIERS = ["巡游限定征集", "限定复刻自选征集", "巡游限定复刻征集", "联动征集", "限定征集", "活动征集", "限时征集", "轮换征集"];

		// 块状富文本 → 纯文本行数组（保持原顺序）；content 不是预期的 JSON 数组时返回 null
		function r99NoticeLines(item) {
			const raw = item && item.contentMap && item.contentMap["zh-CN"] && item.contentMap["zh-CN"].content;
			if (typeof raw !== "string" || raw === "") return null;
			let blocks;
			try { blocks = JSON.parse(raw); } catch { return null; }
			if (!Array.isArray(blocks)) return null;
			return blocks.map((b) => stripTags(String((b && b.content) || ""))).filter((x) => x !== "");
		}

		// "8/13 10:00 - 9/3 4:59" → 时间戳；年份用公告自身的 beginTime 锚定（避免跨年误判）
		function r99ParseWindow(text, year) {
			const m = String(text).match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s*[-\u2014~]\s*(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
			if (!m) return null;
			const sm = Number(m[1]), sd = Number(m[2]), sh = Number(m[3]), smi = Number(m[4]);
			const em = Number(m[5]), ed = Number(m[6]), eh = Number(m[7]), emi = Number(m[8]);
			const startTs = new Date(year, sm - 1, sd, sh, smi).getTime();
			const endYear = em < sm || (em === sm && ed < sd) ? year + 1 : year;   // 跨年（如 12/28 - 1/5）
			return { startTs, endTs: new Date(endYear, em - 1, ed, eh, emi).getTime() };
		}

		// 解析一篇「版本活动一览」→ { pools, events, rotations }
		function parseR99Overview(item, now = nowMs()) {
			const lines = r99NoticeLines(item);
			if (!lines) return null;
			const year = new Date(Number(item.beginTime) || now).getFullYear();
			// 段：`「名称」类型` 开一段，其后各行归该段（直至下一个段标题）
			const sections = [];
			let cur = null;
			for (const line of lines) {
				const head = line.match(/^\u300c([^\u300d]{1,40})\u300d([^\u3010\u203b\uff1a:]{1,16})[\uff1a:]?$/);
				if (head) { cur = { name: head[1], kind: head[2].trim(), lines: [] }; sections.push(cur); continue; }
				if (cur) cur.lines.push(line);
			}
			const pools = [], events = [];
			const seenEvent = new Set();
			for (const sec of sections) {
				const body = sec.lines.join("\n");
				// UP 角色：6★ 单个；5★ 常写成「阿夫西维（木）」、「X（智）」连列 → 取标记后的整串
				const six = [...body.matchAll(/6\u661f\u89d2\u8272\s*\u300c([^\u300d]+)\u300d/g)].map((m) => cleanRoles(m[1]));
				const five = [];
				for (const m of body.matchAll(/5\u661f\u89d2\u8272\s*((?:\u300c[^\u300d]+\u300d[\u3001\s]*)+)/g)) {
					for (const x of String(m[1]).matchAll(/\u300c([^\u300d]+)\u300d/g)) five.push(cleanRoles(x[1]));
				}
				const roles = six.concat(five).filter((x) => x !== "").join("\u3001");
				if (/\u5f81\u96c6/.test(sec.kind)) {
					// 征集段：只认【征集时间】（活动段才有【活动时间】）
					const line = sec.lines.find((l) => /^\u3010\u5f81\u96c6\u65f6\u95f4\u3011/.test(l));
					const w = line ? r99ParseWindow(line, year) : null;
					if (!w) continue;   // 该段没有可解析的征集时间 → 跳过（整篇都没有则由上层按结构异常处理）
					pools.push({
						name: `\u300c${sec.name}\u300d${sec.kind}`, kind: sec.kind, roles,
						startTs: w.startTs, endTs: w.endTs,
						raw: (line.match(/\u3010\u5f81\u96c6\u65f6\u95f4\u3011\s*(.+)$/) || [])[1] || "",
						display: fmtWindow(w.startTs, w.endTs)
					});
					continue;
				}
				// 活动段：取该段全部【…时间】/【…模式】窗口的整体跨度
				// （如「活动正篇」＝故事模式起 → 商店兑换止；段落内没有时间的不算活动）
				const wins = [];
				for (const l of sec.lines) {
					if (!/^\u3010[^\u3011]{1,12}\u3011/.test(l)) continue;
					const w = r99ParseWindow(l, year);
					if (w) wins.push(w);
				}
				if (wins.length === 0) continue;
				const startTs = Math.min.apply(null, wins.map((w) => w.startTs));
				const endTs = Math.max.apply(null, wins.map((w) => w.endTs));
				// 同一活动在一篇里可能出现多次（同名同窗口，如两处「衣着风尚」）→ 去重
				const key = `${sec.name}|${startTs}|${endTs}`;
				if (seenEvent.has(key)) continue;
				seenEvent.add(key);
				events.push({ name: sec.name, cat: sec.kind, startTs, endTs, raw: fmtWindow(startTs, endTs) });
			}
			// 轮换征集：一览以「X月X日更新：角色、角色」逐期公布（14 天一期，末日 04:59）
			const rotations = [];
			for (const line of lines) {
				const m = line.match(/^(\d{1,2})\u6708(\d{1,2})\u65e5\u66f4\u65b0[\uff1a:]\s*(.+)$/);
				if (!m) continue;
				const startTs = new Date(year, Number(m[1]) - 1, Number(m[2]), 5, 0).getTime();
				const endTs = startTs + 14 * 864e5 - 6e4;
				rotations.push({
					name: "\u300c\u8f6e\u6362\u5f81\u96c6\u300d", kind: "\u8f6e\u6362\u5f81\u96c6", roles: cleanRoles(m[3]),
					startTs, endTs, raw: `\u3010${m[1]}\u6708${m[2]}\u65e5\u66f4\u65b0\u3011${cleanRoles(m[3])}`,
					display: fmtWindow(startTs, endTs)
				});
			}
			return { pools, events, rotations };
		}

		// 官方游戏内公告 → 当期征集（含真实起止、悬停列全部并行）+ 当期活动（同其它游戏的活动列规则）。
		// 结构异常（接口改版 / 正文不再可解析）→ 抛错，由上层回退官网公告；
		// 结构正常但没有覆盖当前时刻的征集/活动 → 返回 null（该侧按"未公布"）。
		async function fetchR99Notice(now = nowMs()) {
			const json = await proxyFetchJson(R1999_NOTICE_URL, "https://www.sl916.com/");
			const items = json && Array.isArray(json.data) ? json.data : null;
			if (!items) throw new Error("r1999-notice-no-section");
			const titleOf = (it) => String((it.contentMap && it.contentMap["zh-CN"] && it.contentMap["zh-CN"].title) || "");
			const overviews = items.filter((it) => /\u7248\u672c\u6d3b\u52a8\u4e00\u89c8/.test(titleOf(it)));
			if (overviews.length === 0) throw new Error("r1999-notice-no-section");
			const pools = [], events = [], rotations = [];
			let parsed = 0;
			for (const it of overviews) {
				const o = parseR99Overview(it, now);
				if (!o) continue;
				parsed++;
				pools.push.apply(pools, o.pools);
				events.push.apply(events, o.events);
				rotations.push.apply(rotations, o.rotations);
			}
			if (parsed === 0) throw new Error("r1999-notice-no-dates");
			const data = {};
			const active = pools.concat(rotations).filter((p) => p.startTs <= now && p.endTs >= now);
			if (active.length > 0) {
				const rank = (p) => {
					const i = R99_POOL_TIERS.indexOf(p.kind);
					return i < 0 ? R99_POOL_TIERS.length : i;
				};
				const win = active.slice().sort((a, b) => (rank(a) - rank(b)) || (a.endTs - b.endTs))[0];
				data.banner = win.name;
				data.roles = win.roles || "";
				data.bannerDates = win.display;
				data.bannerDatesRaw = win.raw || win.display;
				const hover = buildPoolHover(active.map((p) => ({
					name: p.name,
					label: `${p.name}${p.roles ? `\uFF1A${p.roles}` : ""}`,
					startTs: p.startTs, endTs: p.endTs, raw: p.raw
				})));
				if (hover) data.bannerHover = hover;
			}
			const activeEvents = sortEventItems(events.filter((e) => e.startTs <= now && e.endTs >= now));
			const primary = pickEventPrimary(activeEvents);
			if (primary) {
				data.event = primary.name;
				data.eventDates = fmtWindow(primary.startTs, primary.endTs);
				data.eventDatesRaw = primary.raw || data.eventDates;
				const hover = buildEventHover(activeEvents);
				if (hover) data.eventHover = hover;
			}
			return (data.banner || data.event) ? data : null;
		}

		// 重返未来：1999 入口：默认源＝官方游戏内公告（逐期征集时间）；
		// 来源被切到官网维护公告（备选源）或自定义地址时直接走官网解析（旧行为）。
		async function fetchR99(url, signal, now = nowMs()) {
			if (!/noticecp/.test(String(url || ""))) return fetchR99Official(url, signal, now);
			try {
				return await fetchR99Notice(now);
			} catch {
				// 游戏内公告接口不可用/结构变了 → 回退官网维护公告（宁可少时间信息，也不要整格报错）
				return fetchR99Official(R1999_OFFICIAL_URL, signal, now);
			}
		}

		// 重返未来：1999（官网 re.bluepoch.com 新闻 API，POST 经 host 代理）
		// 列表接口（informationType=2 资讯）按上线时间倒序返回含全文的公告，
		// 取最新一期「版本更新维护公告」：当期卡池（首位6星角色名，官网无征集名）/ 当期活动 / 维护起止 + 下一期维护日
		async function fetchR99Official(listUrl, signal, now = nowMs()) {
			const ref = "https://re.bluepoch.com/";
			const list = await proxyFetchJson(listUrl, ref, {}, { current: 1, pageSize: 30, informationType: 2 });
			const items = list?.data?.pageData || [];
			const nowYear = new Date(now).getFullYear();
			const cleanText = (raw) => String(raw)
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(/<[^>]+>/g, "")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/&ldquo;/g, "「").replace(/&rdquo;/g, "」")
				.replace(/&hellip;/g, "…").replace(/&times;/g, "×").replace(/&bull;/g, "·")
				.replace(/\n\s*\n+/g, "\n").trim();
			// 单条版本公告的"版本窗口"（仅用于判断哪一期覆盖当前，不再用于展示）：
			// 起点 = 本篇维护结束时刻；结束端 = **比本篇更新的一期维护公告的维护开始时间**；
			// 若还没有更新的一期（下一版本公告未发布）→ 按"维护起 + 42 天"兜底（1999 版本实测 21~42 天）。
			// 注意：不再使用公告里「可在X月X日上午5点之后」——实测那是**心相观测商店兑换**说明，
			// 曾据此把版本判成提前结束，导致版本中后期整格空白。
			const maintWindow = (text, olderThanIdx) => {
				const maintM = text.match(/【维护时间】\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s*-\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
				if (!maintM) return null;
				const mk = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();
				const sm = Number(maintM[1]), mm = Number(maintM[2]), md = Number(maintM[3]);
				const startTs = mk(Number(maintM[6]), Number(maintM[7]), Number(maintM[8]), Number(maintM[9]), Number(maintM[10]));
				let endTs = null;
				// 列表按发布时间倒序：下标更小的一期更新 → 取其维护开始时间作为本篇结束端
				for (let i = olderThanIdx - 1; i >= 0; i--) {
					const t2 = cleanText(versions[i].content);
					const m2 = t2.match(/【维护时间】\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
					if (!m2) continue;
					const cand = mk(Number(m2[1]), Number(m2[2]), Number(m2[3]), Number(m2[4]), Number(m2[5]));
					if (cand > startTs) { endTs = cand; break; }
				}
				if (endTs == null) endTs = new Date(sm, mm - 1, md + 42, 4, 59).getTime();
				return { maintM, startTs, endTs };
			};
			// 窗口匹配：选"版本更新维护公告"中版本窗口覆盖 now 的那一期（不再无条件取最新）
			const versions = items.filter((n) => /版本更新维护公告/.test(n.title || "") && n.content);
			let maint = null, win = null, text = "";
			for (let i = 0; i < versions.length; i++) {
				const n = versions[i];
				const t = cleanText(n.content);
				const w = maintWindow(t, i);
				if (w && w.startTs <= now && w.endTs >= now) { maint = n; win = w; text = t; break; }
			}
			if (!maint) {
				// 官方无当期覆盖 → 小米资讯流当期主池兜底（UP 名单取最新版本公告）
				let sixStars = [];
				if (versions[0]) {
					sixStars = [...cleanText(versions[0].content).matchAll(/6星角色「([^」]+)」/g)]
						.map((m) => cleanRoles(m[1]).replace(/[（）()].*$/, ""))
						.filter(Boolean);
				}
				try {
					const xiaomi = await fetchXiaomiR99Gacha("https://game.xiaomi.com/game/62346241", sixStars);
					if (xiaomi && xiaomi.banner && xiaomi.bannerDates) {
						return {
							banner: xiaomi.banner,
							roles: xiaomi.roles || "",
							bannerDates: xiaomi.bannerDates,
							bannerDatesRaw: xiaomi.bannerDates,
							event: ""
						};
					}
				} catch { /* 兜底失败 → 返回空，由上层"失败沿用上次成功数据"保留展示原数据 */ }
				return null;
			}
			// —— 官方当期公告解析（text 已清洗）——
			// 当期新增角色（当期多池）：只取「版本全新内容一览 → 新增角色」段内的 6 星角色，
			// 避免把复刻/心相/其它段的角色也算进来；多池外显合并角色（如 赫多涅、纳西索斯）
			const newSeg = text.match(/新增角色([\s\S]{0,220}?)(?=\d+\s*[.、]\s*新增|【|$)/);
			const newSix = (newSeg ? [...newSeg[1].matchAll(/6星角色「([^」]+)」/g)] : [])
				.map((m) => cleanRoles(m[1]).replace(/[（）()].*$/, ""))
				.filter(Boolean);
			const sixStars = newSix.length > 0
				? newSix
				: [...text.matchAll(/6星角色「([^」]+)」/g)].map((m) => cleanRoles(m[1]).replace(/[（）()].*$/, "")).filter(Boolean);
			const bannerName = sixStars[0] || "";
			// 卡池时间：官网不发布逐池征集时间，靠"下一期维护/版本周期"推算并不可靠 →
			// 外显暂时固定为简短文案（等有可靠时间源再显示真实起止）
			const bannerDates = "暂无时间信息";
			// 当期活动：新增活动列表第 2 项（首位6星角色剧情活动，"「赫多涅·凡人或英雄」"）
			const actM = text.match(/活动正篇[，,]\s*「([^」]+)」/);
			const eventName = actM ? String(actM[1]).replace(/^[^·]+·/, "") : "";
			// 活动时间与卡池同一规则：官网不发布可靠起止，外显固定为同一文案
			const eventDates = bannerDates;
			const data = {
				banner: bannerName,
				roles: sixStars.join("、"),
				bannerDates,
				event: eventName,
				eventDates
			};
			if (!data.banner || !data.bannerDates) return null;
			// 征集名增强：小米官方资讯流有"主池"征集公告（UP 属于官网新增角色）时，
			// 用真实征集名/征集时间/UP 角色覆盖卡池字段；无主池匹配则保持官网"角色名"显示
			try {
				const xiaomi = await fetchXiaomiR99Gacha("https://game.xiaomi.com/game/62346241", sixStars);
				if (xiaomi && xiaomi.banner && xiaomi.bannerDates) {
					data.banner = xiaomi.banner;
					data.bannerDates = xiaomi.bannerDates;
					data.roles = xiaomi.roles || "";
				}
			} catch { /* 增强源失败不影响官网解析结果 */ }
			return data;
		}

		// ---- 统一来源注册表 ----
		// 卡池来源与活动来源完全独立，契约如下：
		// - GACHA_FETCHERS[id]：卡池字段抓取器（async (url, signal) → 数据对象 | null），
		//   数据对象形如 {banner, roles?, bannerDates, event?, eventDates?}；
		//   当活动源与卡池源同 URL 时，event/eventDates 由卡池载荷复用（避免重复请求）。
		// - EVENT_FETCHERS[id]：活动源注册表（{ 默认抓取器, 备选抓取器... }），
		//   抓取器同 GACHA_FETCHERS 契约；fetchEntry 只取其中的 event/eventDates 字段。
		//   活动源与卡池源不同 URL 时独立抓取（来源选择互不影响）。
		// - altSources / eventAltSources：备选源列表，字段为 { label, fetcher, url? , id? }
		//   （url = 该来源的地址；id = 抓取器自带地址的内部来源标识）。
		//   设置页选中后按 url ?? id 路由到对应抓取器；是否走 host 代理由抓取器自己决定。见 normalizeSourceId。
		const GACHA_FETCHERS = {
			genshin: mkMediaWiki(bwikiGachaPayload),
			hsr: mkMediaWiki(bwikiGachaPayload),
			zzz: (url, signal) => fetchZzzGacha(url, signal),
			"zzz-bwiki": mkMediaWiki(pickCurrent(parseAllBwiki)),
			arknights: (url, signal) => fetchArknightsGacha(url, signal),
			"arknights-prts": mkMediaWiki(selectArknights),
			wuwa: (url, signal) => fetchWuwaGacha(url, signal),
			"wuwa-bwiki": mkMediaWiki(parseWuwaPool),
			// 终末地默认：Canmoe（中文，Next.js 数据经 host 代理两步抓取）
			endfield: (url, signal) => fetchCanmoeEndfield(url),
			// 终末地备选：GachaTracker（英文，浏览器直连）/ wiki.gg（英文，经 host 代理）
			"endfield-gachatracker": mkRaw(parseGachaTracker),
			"endfield-wiki-gg": (url, signal) => fetchEndfieldWikiGg(url),
			// 异环：ldshop（繁体，静态表格经 host 代理）
			nte: (url, signal) => fetchNteWanmei(url, signal),
			"nte-ldshop": (url, signal) => fetchLdshopNte(url),
			"ba-cn": (url, signal) => fetchBaCn(url),
			"ba-global": (url, signal) => fetchBaGlobal(url, signal),
			"ba-global-gamekee": () => fetchGameKeeBa("global"),
			"ba-jp": (url, signal) => fetchBaJpGacha(url, signal),
			"ba-jp-gamekee": () => fetchGameKeeBa("jp"),
			"r1999": (url, signal) => fetchR99(url, signal),
			// 重返未来1999 备选：官网维护公告（只有维护时间与活动名，无逐期征集时间）
			"r1999-official": (url, signal) => fetchR99Official(url, signal)
		};
		// 活动源注册表：条目 → { 默认 + 备选抓取器 }。没有独立活动源的条目活动来源显示"未配置"。
		const EVENT_FETCHERS = {
			// 原神：活动一览为 JS 动态加载（Dquery+SMW），走 SMW ask 查询（fetchYsActivity 忽略 URL 参数）
			genshin: {
				default: (url, signal) => fetchYsActivity(signal)
			},
			// 星铁：活动一览（静态「活动时间」表，api.php 可直连）→ 外显当期 + 悬停列出全部并行活动
			hsr: {
				default: mkMediaWiki(genericEventPayload)
			},
			// 绝区零：默认=官方公告（api-takumi-static，与卡池侧同一接口；活动时间写在公告正文里，
			// 含"X.Y版本更新后/版本结束"的换算；结束时间未知的活动保留并沉底）→ 备选=Bwiki 活动一览
			zzz: {
				default: (url, signal) => fetchZzzEventsOfficial(url, signal),
				"zzz-event-bwiki": mkMediaWiki(genericEventPayload)
			},
			// 异环：活动源就是同一篇官网公告（与卡池侧同址，fetchNteWanmei 一个函数同时解析两者）。
			// 注册成独立活动源的意义：卡池侧本轮抓挂、或用户把**卡池**来源改成自定义/备选时，
			// 活动侧仍能自己抓、自己报错，而不是整列空掉（同址复用只是"能省一次请求"的优化，不是它的腿）。
			nte: {
				default: (url, signal) => fetchNteWanmei(url, signal)
			},
			// 明日方舟：PRTS 活动一览（「活动开始时间」表 + data-time 起止时间戳）→ 同上
			arknights: {
				default: mkMediaWiki(prtsEventPayload)
			},
			// 终末地：FZ Wiki（中文，经 host 代理、抓 RSC 数据；外显当期=结束最晚，悬停列出全部并行）
			endfield: {
				default: (url, signal) => fetchFzWikiEndfield(url).then((d) =>
					d ? { event: d.banner, eventDates: d.bannerDates || "", eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "", eventHover: d.eventHover || "" } : null
				),
				"endfield-game8": (url, signal) => fetchGame8Endfield(url).then((d) =>
					d ? { event: d.banner, eventDates: d.bannerDates || "", eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "" } : null
				)
			},
			// 鸣潮：活动日历页（独立 eventUrl 源）→ 外显当期 + 悬停列出全部并行活动
			wuwa: {
				default: mkMediaWiki((html) => {
					const d = parseWuwaCalendar(html);
					return d ? { event: d.banner, eventDates: d.bannerDates || "", eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "", eventHover: d.eventHover || "" } : null;
				})
			},
			// 蔚蓝国服：默认与卡池同 URL（维护公告含活动名），也可独立配置其他来源
			"ba-cn": {
				default: (url, signal) => fetchBaCn(url)
			},
			// 蔚蓝国际服：默认与卡池同 URL（更新日誌含活动排期）；备选 GameKee
			"ba-global": {
				default: (url, signal) => fetchBaGlobal(url, signal),
				"ba-global-gamekee": () => fetchGameKeeBa("global")
			},
			// 蔚蓝日服：活动源与卡池源独立——默认 GameKee 当期活动条目（原行为不变）；
			// 备选 = 日服官方公告里的イベント条目（抓取器复用官方解析，仅取 event/eventDates）
			"ba-jp": {
				default: () => fetchGameKeeBa("jp"),
				"ba-jp-official": (url, signal) => fetchBaJpOfficialEvent(url, signal)
			},
			// 重返未来：默认与卡池同 URL（同一篇「版本活动一览」同时含征集与活动）；
			// 备选＝官网维护公告（只有维护时间与活动名）
			"r1999": {
				default: (url, signal) => fetchR99(url, signal),
				"r1999-official": (url, signal) => fetchR99Official(url, signal)
			}
		};

		// —— 备选源（altSources / eventAltSources）的字段约定与 altSourceId / normalizeSourceId，
		//    以及下面的 gachaFetcherFor / eventFetcherFor 用到的标识归一，都在 60-helpers.js ——
		//    （设置页也要用这两个纯函数，所以放在 core 与外壳共用的 helpers 里，而不是 core 内部）
		// 取条目当前卡池源的抓取器：命中的备选源 > 默认抓取器（无 → null）
		function gachaFetcherFor(source, url) {
			const want = normalizeSourceId(url);
			const alt = (source.altSources || []).find((a) => altSourceId(a) === want && GACHA_FETCHERS[a.fetcher]);
			return alt ? GACHA_FETCHERS[alt.fetcher] : GACHA_FETCHERS[source.id] || null;
		}

		// 取条目当前活动源的抓取器：命中的活动备选源 > 默认活动抓取器（无 → null）
		function eventFetcherFor(source, url) {
			const table = EVENT_FETCHERS[source.id];
			if (!table) return null;
			const want = normalizeSourceId(url);
			const alt = (source.eventAltSources || []).find((a) => altSourceId(a) === want && table[a.fetcher]);
			return alt ? table[alt.fetcher] : table.default || null;
		}
		//#endregion
