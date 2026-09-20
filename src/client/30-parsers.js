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
				.replace(/\s+/g, " ")
				.trim();
		}

		// 解析单个时间 → {ts, text}；无法解析返回 {ts:null, text:null}
		function parseTime(s) {
			const m = String(s).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
			if (!m) return { ts: null, text: null };
			const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4]), mi = Number(m[5]);
			const text = `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
			return { ts: new Date(y, mo - 1, d, h, mi).getTime(), text };
		}

		// 时间段 → startTs/endTs + 统一文本 mm-dd hh:mm ~ mm-dd hh:mm（无法解析的一侧保留原文）
		function parseRange(raw) {
			const t = stripTags(raw);
			const parts = t.split(/~/).map((x) => x.trim());
			if (parts.length < 2) {
				const p = parseTime(parts[0]);
				return { startTs: p.ts, endTs: null, startText: p.text, endText: null, raw: p.text ?? t };
			}
			const a = parseTime(parts[0]);
			const b = parseTime(parts[1]);
			return {
				startTs: a.ts, endTs: b.ts,
				startText: a.text ?? parts[0], endText: b.text ?? parts[1],
				raw: `${a.text ?? parts[0]} ~ ${b.text ?? parts[1]}`
			};
		}

		// 角色名清理：去首尾方括号/空白（zzz 的 [希格莉德（强攻·冰）]）
		function cleanRoles(roles) {
			const r = stripTags(roles).replace(/^[\[【\s]+|[\]】\s]+$/g, "");
			return r;
		}

		// 主池过滤：排除武器/光锥/音擎/回响/重映等副池
		function isMainBanner(banner) {
			if (!banner) return false;
			if (/武器|光锥|音擎|回响|重映|神铸赋形|流光定影|溯回忆象/.test(banner)) return false;
			return /角色活动祈愿|角色活动跃迁|独家频段|寻访|频段/.test(banner) || banner.includes("「");
		}

		// bwiki 通用：解析所有含「时间+版本」的卡池表（原神/星铁/绝区零）
		function parseAllBwiki(html) {
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
				const range = parseRange(timeM[1]);
				out.push({
					banner,
					roles: charM ? stripTags(charM[1]) : "",
					...range,
					isMain: isMainBanner(banner)
				});
			}
			return out;
		}

		// 方舟：解析「干员轮换卡池」（标准寻访/当期轮换池）所有数据行。
		// 该表行结构：序号 | 寻访页面(title=寻访模拟/干员轮换卡池N) | 开启时间 | 特定干员(6星) | 特定干员(5星)。
		// 兼容历史「限时寻访」表（寻访页面|开启时间|特定干员6星|特定干员5星&4星）作为兜底。
		function parseArknights(html) {
			const out = [];
			// 标准（干员轮换卡池N）+ 中坚（中坚甄选N / 中坚干员轮换卡池N）：
			// 行内 title="寻访模拟/<池名>"。**档位按池名判定且中坚优先**——「中坚干员轮换卡池74」
			// 名字里也含"干员轮换卡池"，先测标准会把整批中坚池误判进标准档（实测踩过）。
			for (const rm of html.matchAll(/<tr(?:[^>]*)>([\s\S]*?)<\/tr>/g)) {
				const row = rm[1];
				const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
				if (tds.length < 3) continue;
				const titleM = (tds[1] || "").match(/title="([^"]*)"/);
				if (!titleM) continue;
				const banner = String(titleM[1]).replace(/^寻访模拟\//, ""); // 干员轮换卡池192 / 中坚甄选14
				if (!/干员轮换卡池|中坚甄选/.test(banner)) continue;         // 只认这两类轮换池行
				const tier = /中坚/.test(banner) ? "中坚" : "标准";
				const roles = [...((tds[3] || "") + (tds[4] || "")).matchAll(/<a[^>]*title="([^"]+)"/g)]
					.map((m) => m[1]).filter(Boolean);
				const range = parseRange(tds[2]);
				out.push({ tier, banner, roles: roles.join("、"), ...range, isMain: true });
			}
			// 限时（联合行动/限定）：解析「限时寻访」表
			const i = html.indexOf("限时寻访");
			if (i >= 0) {
				const seg = html.slice(i);
				const tableM = seg.match(/<table[^>]*>([\s\S]*?)<\/table>/);
				if (tableM) {
					const body = tableM[1];
					for (const rm of body.matchAll(/<tr>([\s\S]*?<td[\s\S]*?)<\/tr>/g)) {
						const row = rm[1];
						const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
						if (tds.length < 2) continue;
						const banner = stripTags(tds[0]);
						if (!banner) continue;
						const roles = tds.length > 2
							? [...tds[2].matchAll(/<a[^>]*href="\/w\/[^"]*"[^>]*title="([^"]*)"/g)]
								.map((m) => m[1].trim()).filter(Boolean).join("、")
							: "";
						const range = parseRange(tds[1]);
						out.push({ tier: "限时", banner, roles, ...range, isMain: true });
					}
				}
			}
			return out;
		}

		// 明日方舟当期卡池：**外显与悬停共用同一份"当期池"列表**（不再各挑一个）——
		// 外显按档位优先（限时 > 标准 > 中坚）、档内先结束者优先；悬停走统一的 buildPoolHover，
		// 与其它游戏同格式（每池『池名：角色』+ 时间行、同窗口合并时间、结束时间升序）。
		function selectArknights(html, now = nowMs()) {
			const items = parseArknights(html);
			fillMissingStarts(items);
			const tiers = ["限时", "标准", "中坚"];
			const rank = (it) => {
				const i = tiers.indexOf(it.tier);
				return i < 0 ? tiers.length : i;
			};
			const active = items
				.filter((it) => it.startTs != null && it.endTs != null && it.startTs <= now && it.endTs >= now)
				.sort((a, b) => (rank(a) - rank(b)) || (a.endTs - b.endTs) || (a.startTs - b.startTs));
			if (active.length === 0) return null;
			const win = active[0];
			return {
				banner: win.banner,
				roles: win.roles,
				bannerDates: win.raw,
				bannerDatesRaw: win.rawOriginal || win.raw,
				bannerHover: buildPoolHover(active.map((it) => ({
					name: it.banner,
					label: `${it.banner}${it.roles ? `\uFF1A${it.roles}` : ""}`,
					startTs: it.startTs, endTs: it.endTs, raw: it.rawOriginal || it.raw
				})))
			};
		}

		// ---- 明日方舟官方公告（web-news.hypergryph.com CMS，code=arknights）----
		// 官方 CMS：列表接口的 brief 被服务端截断（只有时间与开头几个 UP），角色全量需按 cid 取详情。
		// 标题格式：[家族]【池名】限时寻访(即将)开启；brief 首段即"活动时间：X月X日 HH:mm - X月X日 HH:mm"。

		// 从公告正文/brief 提取 UP 干员（"★★★★★★：结城理（占…）★★★★★：埃癸斯 / 岳羽由加莉（…）"）
		function parseAkOfficialRoles(text) {
			const s = String(text || "")
				.replace(/<[^>]+>/g, " ")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/\\/g, " ")
				.replace(/\s+/g, " ");
			const segM = s.match(/(?:出现率上升|获得概率提升)\s*([\s\S]*?)(?:注意|抽取概率公示|在本期|$)/);
			const seg = segM ? segM[1] : s;
			const names = [];
			for (const um of seg.matchAll(/(?:★{3,6})\s*[：:]\s*([^★（(\n]+)/g)) {
				for (let tok of String(um[1]).split(/[\/、,，\\\s]+/)) {
					tok = tok.replace(/\[[^\]]*\]/g, "").trim();
					if (tok && !/^[0-9.%占出率概]+$/.test(tok) && tok.length >= 2 && tok.length <= 10) names.push(tok);
				}
			}
			return [...new Set(names)].join("、");
		}

		// 列表 → 当期 限时/联动寻访池数组（bannerDates 统一为 "MM-DD HH:mm ~ MM-DD HH:mm"）
		function parseAkOfficialPools(list, now = nowMs()) {
			const nowYear = new Date(now).getFullYear();
			const out = [];
			for (const it of list || []) {
				const title = String(it.title || "");
				const brief = String(it.brief || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
				if (!/寻访/.test(title) || !/活动时间/.test(brief)) continue;
				const nameM = title.match(/【([^】]+)】\s*限时寻访/);
				if (!nameM) continue;
				const timeM = brief.match(/活动时间\s*[：:]\s*(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})\s*[-—~]\s*(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})/);
				if (!timeM) continue;
				const mk = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();
				const sm = Number(timeM[1]), sd = Number(timeM[2]);
				const em = Number(timeM[5]), ed = Number(timeM[6]);
				const startTs = mk(nowYear, sm, sd, Number(timeM[3]), Number(timeM[4]));
				const endTs = mk(em < sm ? nowYear + 1 : nowYear, em, ed, Number(timeM[7]), Number(timeM[8]));
				if (startTs > now || endTs < now) continue; // 只要当期覆盖
				const fmt = (mo, d, h, mi) => `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
				const startText = fmt(sm, sd, Number(timeM[3]), Number(timeM[4]));
				const endText = fmt(em, ed, Number(timeM[7]), Number(timeM[8]));
				const raw = `${startText} ~ ${endText}`;
				const familyM = title.match(/^\[([^\]]+)\]/);
				out.push({
					cid: String(it.cid || ""),
					family: familyM ? familyM[1] : "",
					banner: nameM[1],
					roles: parseAkOfficialRoles(brief),
					bannerDates: raw,
					bannerDatesRaw: raw,
					startTs, endTs, startText, endText, raw,
					tier: "限时",
					isMain: true
				});
			}
			return out;
		}

		// 官方当期限时寻访（经 host 代理：列表 + 每池详情各 1 次请求）
		async function fetchArknightsOfficialPools(signal, now = nowMs()) {
			const ref = "https://ak.hypergryph.com/";
			const listUrl = AK_OFFICIAL_BULLETIN + "?lang=zh-cn&code=arknights&page=1&pageSize=30";
			const json = await proxyFetchJson(listUrl, ref);
			const list = Array.isArray(json?.data?.list) ? json.data.list : [];
			const pools = parseAkOfficialPools(list, now);
			await Promise.all(pools.map(async (p) => {
				try {
					const d = await proxyFetchJson(`${AK_OFFICIAL_BULLETIN}/${p.cid}?lang=zh-cn&code=arknights`, ref);
					const content = typeof d?.data?.data === "string" ? d.data.data : "";
					if (content) {
						const roles = parseAkOfficialRoles(content);
						if (roles) p.roles = roles;
					}
				} catch { /* 详情失败保留 brief 解析的角色 */ }
			}));
			return pools;
		}

		// 方舟卡池默认抓取器：官方公告 CMS 优先（当期限时/联动寻访），
		// 官方无当期寻访公告（常规轮换周）或官方失败时自动回退 PRTS 卡池一览（逻辑同 selectArknights）。
		// 设置页手动切到 PRTS 备选源时则走 GACHA_FETCHERS["arknights-prts"]，不经本函数。
		async function fetchArknightsGacha(url, signal, now = nowMs()) {
			try {
				const official = await fetchArknightsOfficialPools(signal, now);
				if (official.length > 0) {
					// 外显与悬停同源同序：先结束者优先（与 PRTS 路径、其它游戏一致），不再取列表首条
					const sorted = official.slice().sort((a, b) => (a.endTs - b.endTs) || (a.startTs - b.startTs));
					const p = sorted[0];
					// 悬停：与其它游戏统一为「池名：角色」+ 时间（多池时逐池一行、同窗口合并时间、结束时间升序）
					const pools = sorted.map((x) => ({
						name: x.banner,
						label: `${x.banner}${x.roles ? `\uFF1A${x.roles}` : (x.family ? `\uFF1A${x.family}` : "")}`,
						startTs: x.startTs,
						endTs: x.endTs,
						raw: x.raw || x.bannerDatesRaw || x.bannerDates
					}));
					return {
						banner: p.banner,
						roles: p.roles,
						bannerDates: p.bannerDates,
						bannerDatesRaw: p.bannerDatesRaw,
						bannerHover: buildPoolHover(pools)
					};
				}
			} catch { /* 官方失败 → 回退 PRTS */ }
			const apiUrl = ARKNIGHTS_PRTS_URL + (ARKNIGHTS_PRTS_URL.includes("?") ? "&" : "?") + "origin=*";
			const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
			if (!res.ok) throw new Error("http-" + res.status);
			const json = await res.json();
			const html = json?.parse?.text;
			if (typeof html !== "string") throw new Error("bad-json");
			const d = selectArknights(html, now);
			return d ? { ...d } : null;
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
		// 同期多张主池（如 104期+104-2期）合并角色。返回 null 时调用方回退内置数据。
		// bannerDates 为补全后用于倒计时的文本；bannerDatesRaw 为源站原文（悬停展示）。
		function selectCurrent(items, now) {
			fillMissingStarts(items);
			const exact = items.filter((it) => it.startTs != null && it.startTs <= now && it.endTs != null && it.endTs >= now);
			const loose = items.filter((it) => it.startTs == null && it.endTs != null && it.endTs >= now);
			const pool = (exact.length > 0 ? exact : loose).filter((it) => it.isMain);
			if (pool.length === 0) return null;
			const first = pool[0];
			const sameRange = pool.filter((it) => it.startTs === first.startTs && it.endTs === first.endTs);
			const roles = [...new Set(sameRange.map((it) => cleanRoles(it.roles)).filter(Boolean))].join("、");
			return {
				banner: first.banner,
				roles,
				bannerDates: first.raw,
				bannerDatesRaw: first.rawOriginal || first.raw
			};
		}

		// MM-DD HH:MM（同年窗口用）
		function fmtMdHm(ts) {
			const d = new Date(ts);
			return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
		}

		// YYYY-MM-DD HH:MM（跨年窗口用：避免"05-15 16:00 ~ 05-15 03:59"看着像结束早于开始）
		function fmtYmdHm(ts) {
			const d = new Date(ts);
			return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
		}

		// 窗口起止文本：两端同一年 → MM-DD；跨年 → 两端都带年份
		function fmtWindow(startTs, endTs) {
			const sameYear = new Date(startTs).getFullYear() === new Date(endTs).getFullYear();
			return sameYear ? `${fmtMdHm(startTs)} ~ ${fmtMdHm(endTs)}` : `${fmtYmdHm(startTs)} ~ ${fmtYmdHm(endTs)}`;
		}

		// 长期/常驻玩法判定：声明窗口超过该天数的不当作"当期活动"（外显与悬停共用，①）。
		// 依据：各游戏限时活动实测最长约 84 天（原神），而常驻玩法动辄半年以上——
		// 明日方舟 PRTS 活动一览里「生息演算：重启锚点」245 天、「集成战略：沉沦者的黑流树海」179 天，
		// 两者都是常驻玩法（表内含"进行中"徽标），且因外显不带年份会被误读成"结束早于开始"。
		const EVENT_MAX_WINDOW_DAYS = 120;

		function isLongTermEvent(x) {
			return !!x && x.startTs != null && x.endTs != null && (x.endTs - x.startTs) > EVENT_MAX_WINDOW_DAYS * 864e5;
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

		// 活动列悬停（鸣潮式多行）：按传入顺序（调用方已 sortEventItems）每条一行；
		// 各行窗口完全相同 → 时间只在末尾写一遍；缺起止的行原样显示该行原文；跨年窗口两端带年份（②）。
		// 兜底：只有 0/1 条时返回 ""，由 UI 退回原有"活动名 + 时间"单条展示 ——
		// 公告类单条源（蔚蓝国服/日服、1999、异环等）因此完全不受影响，也不会出现空行或半截区间。
		function buildEventHover(items) {
			const list = (Array.isArray(items) ? items : [])
				.filter((x) => x && typeof x.name === "string" && x.name.trim() !== "")
				.filter((x) => !isLongTermEvent(x));
			if (list.length < 2) return "";
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

		// 鸣潮：角色轮换池页（Bwiki 汇总页，逐期列出）→ 取"覆盖当前时刻"的那一组：
		// 每一组 = 该组 data-start/data-end 之后、到下一组之前的那段里的「共鸣者/xxx」。
		// 旧实现取页面第一组时间 + 整页前 6 个角色名 → 备选/兜底源会显示"过期档期 + 跨池混入的角色"，
		// 且不报任何失败（实测该页当前只有一组已过期计时器）。没有覆盖当前的组 → 返回 null（未公布）。
		function parseWuwaPool(html, now = nowMs()) {
			const text = String(html || "");
			const marks = [...text.matchAll(/data-start="([^"]+)"\s+data-end="([^"]+)"/g)];
			// 页面拿到了却一个计时器都没有 → 汇总页改版（抛错让面板显示"卡池失败"），
			// 而不是伪装成"新卡池未公布"（这是本条目的备选/兜底源）
			if (marks.length === 0) throw new Error("wuwa-pool-no-timer");
			for (let i = 0; i < marks.length; i++) {
				const m = marks[i];
				const start = parseTime(m[1]);
				const end = parseTime(m[2]);
				if (start.ts == null || end.ts == null) continue;
				if (!(start.ts <= now && now <= end.ts)) continue;
				const seg = text.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : text.length);
				const chars = [...new Set([...seg.matchAll(/共鸣者\/([^"]+)"/g)].map((x) => x[1]))].slice(0, 6);
				if (chars.length === 0) continue;
				return {
					banner: "\u89D2\u8272\u6362\u53EC\u6C60",
					roles: chars.join("、"),
					startTs: start.ts, endTs: end.ts,
					bannerDates: `${start.text} ~ ${end.text}`
				};
			}
			return null;
		}

		// 鸣潮官方公告解析：从全量公告（game/activity/recommend）中取"覆盖当前时刻"的「角色活动唤取」
		// 公告形如：tabTitle="[身赴三途]角色活动唤取"，content 内含"✦活动时间✦ 2026年9月10日10:00 ~ 2026年9月29日11:59"
		function parseWuwaNotice(list, now = nowMs()) {
			const groups = [list?.game, list?.activity, list?.recommend].filter(Array.isArray);
			const stripH = (s) => String(s || "")
				.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&hellip;/g, "…")
				.replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”")
				.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
			const pools = [];
			for (const arr of groups) {
				for (const it of arr) {
					const title = stripH(it.tabTitle || it.title || "");
					if (!/活动唤取/.test(title)) continue;
					const text = stripH(it.content || "");
					const m = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})\s*[~～-]\s*(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/);
					if (!m) continue;
					const sTs = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
					const eTs = new Date(+(m[6] || m[1]), +m[7] - 1, +m[8], +m[9], +m[10]).getTime();
					if (sTs > now || eTs < now) continue; // 只要当期覆盖
					const name = title
						.replace(/\s*(?:角色|武器)活动唤取\s*$/, "")
						.replace(/^[\[【「]\s*/, "")
						.replace(/\s*[\]】」]$/, "")
						.trim();
					const upPart = text.split(/✦\s*活动时间/)[0] || "";
					const ups = [...upPart.matchAll(/[「【]([^」】]+)[」】]/g)].map((x) => x[1].trim()).filter(Boolean);
					pools.push({ name, isChar: /角色活动唤取/.test(title), roles: ups.join("、"), startTs: sTs, endTs: eTs });
				}
			}
			const cur = pools.filter((p) => p.isChar && p.name);
			if (cur.length === 0) return null;
			const first = cur[0];
			const roles = [...new Set(cur.flatMap((p) => p.roles.split("、")).filter(Boolean))].join("、");
			const fmt = (ts) => {
				const d = new Date(ts);
				return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			};
			const raw = fmtWindow(first.startTs, first.endTs);
			// 悬停：每池"池名：角色"一行 + 时间一行；各池窗口相同则时间只在末尾写一遍；按结束时间升序
			const bannerHover = buildPoolHover(cur.map((p) => ({
				name: p.name,
				label: `${p.name}\uFF1A${p.roles || "-"}`,
				startTs: p.startTs,
				endTs: p.endTs
			})));
			return { banner: first.name, roles, bannerDates: raw, bannerDatesRaw: raw, startTs: first.startTs, endTs: first.endTs, bannerHover };
		}

		// 鸣潮卡池默认抓取器：官方公告（entrypoint → 目录 → zh-Hans.json 全量）优先；
		// 无当期公告 / 抓取失败 → 自动回退 Bwiki 角色轮换池（逻辑同 parseWuwaPool）
		async function fetchWuwaGacha(entryUrl, signal, now = nowMs()) {
			try {
				const ref = "https://aki-gm-resources.aki-game.com/";
				const ej = await proxyFetchJson(entryUrl, ref);
				const contentUrl = Array.isArray(ej?.contentUrl) ? ej.contentUrl[0] : "";
				const dir = contentUrl ? contentUrl.replace(/[^/]*$/, "") : String(entryUrl).replace(/[^/]*$/, "");
				let list = null;
				try { list = await proxyFetchJson(dir + "zh-Hans.json", ref); } catch { list = null; }
				if (!list || typeof list !== "object") list = await proxyFetchJson(dir + "notice.json", ref);
				const d = parseWuwaNotice(list, now);
				if (d) return d;
			} catch { /* 官方失败 → Bwiki 备选 */ }
			const apiUrl = WUWA_BWIKI_URL + (WUWA_BWIKI_URL.includes("?") ? "&" : "?") + "origin=*";
			const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
			if (!res.ok) throw new Error("http-" + res.status);
			const json = await res.json();
			const html = json?.parse?.text;
			if (typeof html !== "string") throw new Error("bad-json");
			return parseWuwaPool(html);
		}

		// 绝区零官网公告解析：从公告频道（iChanId=279）取「X.Y版本限时频段（上/下期）」，选覆盖当前时刻的一期。
		// 公告形如：sIntro="本期代理人与音擎调频活动时间为：3.2版本更新后 ~ 2026/09/30 11:59"，
		// sContent 内含「活动期间，限定S级代理人[克拉蕾(电·锋御)]、[南宫羽(以太·击破)]…」。
		// 起点为"版本更新后"时，用同版本「更新公告」的 dtStartTime 补全；「独家重映/音擎回响」自选段跳过。
		function parseZzzFreq(payload, now = nowMs()) {
			const list = Array.isArray(payload?.data?.list) ? payload.data.list : [];
			const clean = (s) => stripTags(s);
			// 版本更新公告 → "X.Y版本更新后"的起点；同时抽取「S级代理人[X] → 「Y」频段」对应表
			// （频段名只写在更新公告里，逐期频段公告不含频段名，故用它回填卡池标题）
			// 注意：必须排除「X.Y版本…预下载开启&更新通知」——它比正式更新早 1~2 天发布，
			// 若当成版本起点，下一期频段会被提前判成"覆盖当前"、把真实在跑的上一期挤掉
			// （与活动侧 parseZzzEventsOfficial 同一口径）。
			const verStart = {};
			const poolOf = {};
			for (const it of list) {
				const t = clean(it?.sTitle);
				const vm = t.match(/(\d+\.\d+)\s*版本/);
				if (!vm) continue;
				if (/更新(?:公告|通知)/.test(t) && !/预下载|预约|前瞻|预抽/.test(t)) {
					const p = parseTime(it.dtStartTime);
					if (p.ts != null && verStart[vm[1]] == null) verStart[vm[1]] = p;
				}
				const text = clean(it.sIntro) + " " + clean(it.sContent);
				for (const m of text.matchAll(/S级代理人\s*[\[【]([^\]】]+)[\]】][^「]{0,40}?「([^」]{2,14})」频段/g)) {
					const name = m[1].replace(/[（(].*$/, "").trim();
					if (name && poolOf[name] == null) poolOf[name] = m[2].trim();
				}
			}
			// 角色名统一为「职业·属性」全角括号（与 Bwiki 显示一致）：克拉蕾(电·锋御) → 克拉蕾（锋御·电）
			const normRole = (name) => {
				const m = name.match(/^([^（()]+)[（(]([^）)]+)[）)]\s*$/);
				if (!m) return name;
				const bits = m[2].split("·");
				return bits.length === 2 ? `${m[1]}（${bits[1]}·${bits[0]}）` : `${m[1]}（${m[2]}）`;
			};
			const pools = [];
			for (const it of list) {
				const title = clean(it?.sTitle);
				const vm = title.match(/(\d+\.\d+)\s*版本限时频段\s*((?:（[上下]期）)?)/);
				if (!vm) continue;
				const ver = vm[1];
				const part = vm[2] || "";
				const text = clean(it.sIntro) + " " + clean(it.sContent);
				const re = /((?:\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s+\d{1,2}:\d{2})|(?:\d+\.\d+\s*版本更新后))\s*[~～]\s*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s+\d{1,2}:\d{2})/g;
				const marks = [];
				let m;
				while ((m = re.exec(text)) !== null) {
					marks.push({ start: m[1], end: m[2], from: m.index, to: m.index + m[0].length, after: /版本更新后/.test(m[1]) });
				}
				const created = parseTime(it.dtCreateTime).ts ?? 0;
				for (let i = 0; i < marks.length; i++) {
					const seg = text.slice(marks[i].to, i + 1 < marks.length ? marks[i + 1].from : text.length);
					// 该时间窗对应的「限定S级代理人」句（排除独家重映/音擎回响的自选说明）
					const sentence = seg.split(/[。！；]/).find((s) => /限定S级代理人/.test(s) && !/重映|回响|可自选/.test(s));
					if (!sentence) continue;
					const roleM = sentence.match(/限定S级代理人\s*((?:[\[【][^\]】]+[\]】][、，,及和与\s]*)+)/);
					if (!roleM) continue;
					const roles = [...roleM[1].matchAll(/[\[【]([^\]】]+)[\]】]/g)].map((x) => normRole(x[1].trim())).join("、");
					if (!roles) continue;
					const sp = marks[i].after ? (verStart[ver] || { ts: null, text: null }) : parseTime(marks[i].start);
					const ep = parseTime(marks[i].end);
					if (ep.ts == null) continue;
					pools.push({
						ver, part, roles,
						startTs: sp.ts, endTs: ep.ts,
						startText: sp.text, endText: ep.text,
						raw: `${marks[i].after ? `${ver}版本更新后` : sp.text} ~ ${ep.text}`,
						created,
						isMain: true
					});
				}
			}
			if (pools.length === 0) return null;
			const cover = pools.filter((p) => p.startTs != null && p.startTs <= now && p.endTs >= now);
			// 起点未知（同版本更新公告未收录）但结束在未来 → 仍作为当期（与 selectCurrent 的宽松分支一致）
			const loose = pools.filter((p) => p.startTs == null && p.endTs >= now);
			const picked = (cover.length > 0 ? cover : loose).sort((a, b) => (b.created - a.created) || (a.endTs - b.endTs));
			if (picked.length === 0) return null;
			const first = picked[0];
			const same = picked.filter((p) => p.ver === first.ver && p.part === first.part);
			const roles = [...new Set(same.flatMap((p) => p.roles.split("、")).filter(Boolean))].join("、");
			// 卡池名：优先用更新公告里的「频段名」（当期名单命中的新代理人）；复刻期无名时退回版本期名称
			let poolName = "";
			for (const r of roles.split("、")) {
				const base = r.replace(/[（(].*$/, "").trim();
				if (base && poolOf[base]) { poolName = poolOf[base]; break; }
			}
			return {
				banner: poolName ? `「${poolName}」频段` : `${first.ver}版本限时频段${first.part}`,
				roles,
				bannerDates: first.startText && first.endText ? `${first.startText} ~ ${first.endText}` : first.raw,
				bannerDatesRaw: first.raw,
				startTs: first.startTs,
				endTs: first.endTs
			};
		}

		// 绝区零卡池默认抓取器：官网公告优先；无当期频段公告 / 抓取失败 → 自动回退 Bwiki 往期调频
		async function fetchZzzGacha(listUrl, signal, now = nowMs()) {
			try {
				const payload = await proxyFetchJson(listUrl, "https://zzz.mihoyo.com/");
				const d = parseZzzFreq(payload, now);
				if (d) return d;
			} catch { /* 官方失败 → Bwiki 备选 */ }
			const apiUrl = ZZZ_BWIKI_URL + (ZZZ_BWIKI_URL.includes("?") ? "&" : "?") + "origin=*";
			const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
			if (!res.ok) throw new Error("http-" + res.status);
			const json = await res.json();
			const html = json?.parse?.text;
			if (typeof html !== "string") throw new Error("bad-json");
			return selectCurrent(parseAllBwiki(html), now);
		}

		// 绝区零：官方公告列表（api-takumi-static，与卡池侧同一接口，经 host 代理）→ 当期活动。
		// 活动时间就写在公告正文里（【活动时间】A ~ B），**不需要再抓详情页**；
		// A/B 可能是绝对时间，也可能是"X.Y版本更新后" / "X.Y版本结束"——用「X.Y版本更新公告」的发布时间折算：
		//   版本起点 = 该版本更新公告发布时间；版本结束 = 下一个已知版本起点 − 1 分钟。
		// 当前版本还没有下一版本公告 → 结束时间未知：这类活动**保留**（endTs=null），
		// 由 sortEventItems / pickEventPrimary 的既有规则自然沉到外显与悬停的最后，不跳过、不丢弃。
		const ZZZ_EVENT_WINDOW_RE = /((?:\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s+\d{1,2}:\d{2})|(?:\d+\.\d+\s*版本更新后))\s*[~～\-—]\s*((?:\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s+\d{1,2}:\d{2})|(?:\d+\.\d+\s*版本结束))/g;

		function parseZzzEventsOfficial(payload, now = nowMs()) {
			const list = Array.isArray(payload?.data?.list) ? payload.data.list : [];
			const clean = (s) => stripTags(s);
			// 版本起点表：取该版本的「更新公告」发布时间。
			// 必须排除「X.Y版本…预下载开启&更新通知」——它比正式更新早 1~2 天发布，
			// 若当成版本起点，会把上一版本"版本结束"型活动提前判死、并让新版本活动提前出现。
			const verStart = {};
			for (const it of list) {
				const title = clean(it?.sTitle);
				const vm = title.match(/(\d+\.\d+)\s*版本/);
				if (!vm || !/更新(?:公告|通知)/.test(title)) continue;
				if (/预下载|预约|前瞻|预抽/.test(title)) continue;
				const ts = parseTime(it.dtStartTime).ts;
				if (ts != null && verStart[vm[1]] == null) verStart[vm[1]] = ts;
			}
			const versions = Object.keys(verStart).sort((a, b) => verStart[a] - verStart[b]);
			// 折算一个窗口的两个端点；返回 null 表示**窗口此刻不成立**（含"该版本还没开始/无法判定"）。
			// 规则：绝对时间直接用；"X.Y版本更新后"要求该版本已开始（版本更新公告已发布）；
			//      "X.Y版本结束" = 下一个已知版本起点 − 1 分钟；若 X.Y 已是最新版本 → 结束时间未知（endTs=null，
			//      仍算成立：活动在跑，只是没有绝对结束日）→ 由排序规则沉底，不跳过、不丢弃。
			const windowAt = (startText, endText) => {
				let startTs = null;
				const sv = startText.match(/(\d+\.\d+)\s*版本更新后/);
				if (sv) {
					if (verStart[sv[1]] == null) return null;   // 该版本尚未开始 → 活动还没上线
					startTs = verStart[sv[1]];
				} else {
					const p = parseTime(startText);
					if (p.ts == null) return null;
					startTs = p.ts;
				}
				if (startTs > now) return null;
				let endTs = null;
				const ev = endText.match(/(\d+\.\d+)\s*版本结束/);
				if (ev) {
					if (verStart[ev[1]] == null) return null;   // 版本未知 → 无法判定，保守略过
					const later = versions.find((v) => verStart[v] > verStart[ev[1]]);
					if (later != null) endTs = verStart[later] - 60000;
				} else {
					const p = parseTime(endText);
					if (p.ts == null) return null;
					endTs = p.ts;
				}
				if (endTs != null && endTs < now) return null;
				return { startTs, endTs };
			};
			// 标题筛选用「活动说明」：正文里带活动时间的都是这类；商城/城募/剧情/频段公告不在此列
			const byName = new Map();
			for (const it of list) {
				const title = clean(it?.sTitle);
				if (!/活动说明/.test(title)) continue;
				const name = (title.match(/^「([^」]+)」/) || [])[1] || title.replace(/活动说明$/, "").trim();
				if (!name || byName.has(name)) continue;
				const text = clean(it.sIntro) + " " + clean(it.sContent);
				for (const m of text.matchAll(ZZZ_EVENT_WINDOW_RE)) {
					const w = windowAt(m[1], m[2]);
					if (!w) continue;                                  // 这个窗口此刻不成立 → 看下一个窗口
					byName.set(name, { banner: name, name, cat: "", ...w, raw: `${m[1]} ~ ${m[2]}` });
					break;                                             // 一篇公告只取第一个成立的窗口
				}
			}
			const active = sortEventItems([...byName.values()]);
			if (active.length === 0) return null;
			const primary = pickEventPrimary(active) || active[0];
			const dates = primary.startTs != null && primary.endTs != null ? fmtWindow(primary.startTs, primary.endTs) : (primary.raw || "");
			return {
				event: primary.name,
				eventDates: dates,
				eventDatesRaw: primary.raw || "",
				// 只有 1 条时 buildEventHover 返回 ""，由 UI 退回单条展示（与其它源一致）
				eventHover: buildEventHover(active)
			};
		}

		async function fetchZzzEventsOfficial(listUrl, signal) {
			const payload = await proxyFetchJson(listUrl, "https://zzz.mihoyo.com/");
			return parseZzzEventsOfficial(payload);
		}

		// 鸣潮：活动日历页 → font-size:17px 标题 + font-size:11px 时间，选当期
		// 注意：复用 selectCurrent 需要 isMain 字段（该函数按 isMain 过滤主池）
		function parseWuwaCalendar(html) {
			const items = [];
			const re = /font-size:17px[^>]*>\s*<p>\s*([\s\S]*?)\s*<\/p>([\s\S]*?)(?=font-size:17px|$)/g;
			let m;
			while ((m = re.exec(html)) !== null) {
				const name = stripTags(m[1]);
				if (!name) continue;
				const timeM = m[2].match(/font-size:11px[^>]*>\s*<p>\s*([\s\S]*?)\s*<\/p>/);
				const timeText = timeM ? stripTags(timeM[1]) : "";
				if (!/20\d{2}\//.test(timeText)) continue;
				const range = parseRange(timeText);
				items.push({ banner: name, name, ...range, isMain: true });
			}
			const now = nowMs();
			const active = sortEventItems(items
				.filter((it) => it.endTs != null && it.endTs >= now && (it.startTs == null || it.startTs <= now))
				.map((it) => ({ name: it.name || it.banner, startTs: it.startTs, endTs: it.endTs, raw: it.rawOriginal || it.raw })));
			if (active.length === 0) return null;
			// 外显：类别优先（战斗/高难类优先），同级内结束时间升序（③）；悬停仍按 endTs 升序全量
			const primary = pickEventPrimary(active) || active[0];
			const dates = primary.startTs != null && primary.endTs != null ? fmtWindow(primary.startTs, primary.endTs) : (primary.raw || "");
			return { banner: primary.name, roles: "", bannerDates: dates, bannerDatesRaw: primary.raw || dates, eventHover: buildEventHover(active) };
		}

		// 解 HTML 数字实体（wiki.gg 的区间分隔符写成 &#8211; = en dash、&#8722; = 减号）+
		// 常见具名实体。stripTags 不解实体，所以需要它才能把时间串拆干净。
		function decodeHtmlEntities(s) {
			return String(s)
				.replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(Number(d)); } catch { return ""; } })
				.replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; } })
				.replace(/&nbsp;/g, " ").replace(/&minus;/g, "\u2212").replace(/&ndash;/g, "\u2013").replace(/&mdash;/g, "\u2014").replace(/&amp;/g, "&");
		}

		// 英文月份日期 → { ts, text }（如 "Sep 02, 2026, 12:00"、"September 2, 2026"）。
		// 英文源站（wiki.gg / Game8 等）用这种写法，而 parseTime 只认纯数字日期，需要单独一支。
		// 与插件其余来源同一口径：按"源站墙钟时间"直接构造（CN 用户本地即 UTC+8）。
		const EN_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
		function parseEnDate(raw) {
			const m = String(raw).match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?/);
			if (!m) return null;
			const mo = EN_MONTHS[m[1].slice(0, 3).toLowerCase()];
			if (!mo) return null;
			const d = Number(m[2]), y = Number(m[3]);
			const h = m[4] ? Number(m[4]) : 0, mi = m[5] ? Number(m[5]) : 0;
			const pad = (n) => String(n).padStart(2, "0");
			return { ts: new Date(y, mo - 1, d, h, mi).getTime(), text: `${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}` };
		}

		// 终末地（wiki.gg）：Headhunting/Banners 页 Current 分节 → 当期卡池
		// 该源经 host 代理抓取（fetchEndfieldWikiGg → proxyFetchText 设 Referer=wiki.gg origin），
		// 满足 Wiki.gg 的 Referer 校验，不会触发 403；本解析器仅处理代理返回的 HTML。
		// 线上真实标记（2026-09 实测）：Asia 行是 "Sep 02, 2026, 12:00 &#8211; Sep 30, 2026, 11:59 (UTC+8)"，
		// 同一格里还有 AM/EU 行（UTC−5）；旧实现用 parseTime + split(/[–-]/) 解不了英文月份与实体，恒返回 null
		// → 该备选源长期"抓得到但解析不出"。现在：解实体 + 只取 Asia 行 + 英文月份解析。
		function parseEndfieldCurrent(html) {
			const i = html.indexOf('id="Current"');
			// 页面拿到了却没有 Current 分节 → wiki 页改版（抛错，别伪装成"未公布"）
			if (i < 0) throw new Error("endfield-current-no-section");
			const seg = html.slice(i);
			const tableEnd = seg.indexOf("</table>");
			const table = tableEnd >= 0 ? seg.slice(0, tableEnd) : seg;
			const nameM = table.match(/class="header"[^>]*>([^<]+)</);
			const asiaM = table.match(/Asia:<\/b>([\s\S]*?)<\/span>/);
			const upM = [...table.matchAll(/<li>[\s\S]*?title="([^"]+)"[\s\S]*?\(Drop Rate-UP\)/g)];
			const banner = nameM ? nameM[1].trim() : "";
			let startTs = null, endTs = null, startText = null, endText = null;
			if (asiaM) {
				// 只取 Asia 行（非贪婪已停在 Asia span 结束处）；解实体后按 en/em dash 或"带空格的短横线"切两段
				const asiaText = decodeHtmlEntities(stripTags(asiaM[1]));
				const parts = asiaText.split(/[\u2013\u2014\u2212]|\s+-\s+/).map((x) => x.trim()).filter(Boolean);
				const a = parseEnDate(parts[0] || "");
				const b = parseEnDate(parts[1] || "");
				if (a) { startTs = a.ts; startText = a.text; }
				if (b) { endTs = b.ts; endText = b.text; }
			}
			// 分节在、但卡池名/Asia 档期读不出来 → 表结构变了（抛错）；读得出但不覆盖当前 → null（未公布）
			if (!banner) throw new Error("endfield-current-no-banner");
			if (startTs == null || endTs == null) throw new Error("endfield-current-no-dates");
			if (!(startTs <= nowMs() && endTs >= nowMs())) return null;
			return {
				banner,
				roles: [...new Set(upM.map((m) => m[1]))].join("、"),
				bannerDates: startText && endText ? `${startText} ~ ${endText}` : ""
			};
		}

		// 终末地（GachaTracker）：banners 表格 → 当期卡池（卡池名/干员/起止）
		// GachaTracker 提供 CORS=[*]，浏览器端可直接抓取（替代被 Referer 反爬拦截的 wiki.gg）
		function parseGachaTracker(html) {
			const rows = [...html.matchAll(/<tr id="([^"]+)">([\s\S]*?)<\/tr>/g)];
			const items = [];
			for (const rm of rows) {
				const body = rm[2];
				if (!body.includes("date-cell")) continue;
				const nameM = body.match(/banner-name-cell">[\s\S]*?<a[^>]*>([^<]+)<\/a>/);
				const dateM = [...body.matchAll(/date-cell">([\d-]+)<\/td>/g)];
				const charM = [...body.matchAll(/\/games\/endfield\/characters\/[^"]+" title="([^"]+)"/g)];
				if (!nameM || dateM.length < 2) continue;
				const start = dateM[0][1];
				const end = dateM[1][1];
				items.push({
					banner: stripTags(nameM[1]),
					roles: [...new Set(charM.map((m) => m[1]))].join("、"),
					startTs: new Date(start + "T00:00:00+08:00").getTime(),
					endTs: new Date(end + "T23:59:59+08:00").getTime()
				});
			}
			const now = nowMs();
			const cur = items.find((it) => it.startTs <= now && it.endTs >= now) || null;
			if (!cur) return null;
			const fmt = (ts) => {
				const d = new Date(ts);
				return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			};
			return {
				banner: cur.banner,
				roles: cur.roles,
				bannerDates: `${fmt(cur.startTs)} ~ ${fmt(cur.endTs)}`
			};
		}

		// 通用：从 Next.js flight payload HTML 中定位指定组件引用的 JS chunk URL 列表。
		// 适用于"HTML 无数据、数据编译在组件 chunk 里"的 Next.js 站点（如 canmoe）。
		// componentName 形如 "BannerCalendar"；baseUrl 用于把相对路径补全为绝对 URL。
		function nextJsChunkUrls(html, componentName, baseUrl) {
			const i = html.indexOf(componentName);
			if (i < 0) return [];
			const seg = html.slice(Math.max(0, i - 1500), i);
			const br = seg.lastIndexOf("[");
			if (br < 0) return [];
			// flight payload 内 chunk 路径是双重转义（\\\"），还原一层后提取
			const raw = seg.slice(br).replace(/\\\\"/g, '"').replace(/\\"/g, '"');
			const names = [...raw.matchAll(/\/_next\/static\/chunks\/([A-Za-z0-9_.~-]+\.js)/g)].map((x) => x[1]);
			// 补全为绝对 URL：优先页面 origin（chunk 路径是站内相对路径）
			let origin = "";
			try { origin = new URL(baseUrl || "").origin; } catch { /* 无 baseUrl 时保持相对 */ }
			return [...new Set(names)].map((n) => origin + "/_next/static/chunks/" + n);
		}

		// 从 canmoe chunk JS 提取当期卡池：
		// ① 当期角色窗口形如 d={梨诺:{windows:[{start,end,version,period,isRerun}]}},u=[...]
		//   （注意：d 在 canmoe 侧可能长期不更新，只能当"覆盖当前时刻才采信"的快速路径）
		// ② 期次列表形如 <变量>=[{id,title,subtitle,version,periodStart,periodEnd,featured:[...]}]，
		//   变量名随构建变化（曾见 p= / 现为 f=），由 extractCanmoePeriods 按内容定位。
		// 只采用"时间窗口覆盖当前时刻"的条目。
		// 返回值三态：数据对象 / null（**结构在**但没有覆盖当前时刻的期次 → 未公布）/ undefined
		// （这份 JS 里**根本没有**卡池数据结构 → 交给调用方决定：多 chunk 时继续找下一个，
		//  全部 chunk 都没有则说明页面改版 → 报错，而不是伪装成"未公布"）。
		function currentFromCanmoe(js, now) {
			now = now || nowMs();
			let sawStructure = false;
			const fmt = (iso) => {
				const d = new Date(iso);
				return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			};
			// 1) 当期 d：windows 覆盖当前 → 直接用
			const curM = js.match(/\bd=\{(.+?)\},\s*u=\[/);
			if (curM) {
				sawStructure = true;
				const inner = curM[1];
				const featuredM = inner.match(/([^:{}]+):\{windows:/);
				const roles = featuredM ? featuredM[1].trim() : "";
				for (const w of inner.matchAll(/windows\s*:\s*\[\s*\{\s*start\s*:\s*"([^"]+)"\s*,\s*end\s*:\s*"([^"]+)"\s*,\s*version\s*:\s*"([^"]+)"\s*,\s*period\s*:\s*(\d+)\s*,\s*isRerun\s*:\s*(!0|!1|true|false)\s*\}\s*\]/g)) {
					const a = new Date(w[1]).getTime(), b = new Date(w[2]).getTime();
					if (a <= now && now <= b) return { banner: `\u3010${w[3]}\u3011${roles}`, roles, bannerDates: `${fmt(w[1])} ~ ${fmt(w[2])}` };
				}
			}
			// 2) p 数组中的"当前进行中"条目（过期当期后以此为兜底）
			const arr = extractCanmoePeriods(js);
			if (arr) {
				sawStructure = true;
				for (const e of arr) {
					const ps = (e.match(/periodStart\s*:\s*"([^"]*)"/) || [])[1];
					const pe = (e.match(/periodEnd\s*:\s*"([^"]*)"/) || [])[1];
					if (!ps || !pe) continue;
					const a = new Date(ps).getTime(), b = new Date(pe).getTime();
					if (a <= now && now <= b) {
						const title = (e.match(/title\s*:\s*"([^"]*)"/) || [])[1] || "";
						const subtitle = (e.match(/subtitle\s*:\s*"([^"]*)"/) || [])[1] || "";
						const version = (e.match(/version\s*:\s*"([^"]*)"/) || [])[1] || "";
						const roles = subtitle || title;
						return { banner: title || `\u3010${version}\u3011${subtitle}`, roles, bannerDates: `${fmt(ps)} ~ ${fmt(pe)}`, bannerDatesRaw: `${fmt(ps)} ~ ${fmt(pe)}` };
					}
				}
			}
			// 结构在但没覆盖当前时刻 → null（未公布）；连结构都没有 → undefined（页面改版，交上层决定）
			return sawStructure ? null : void 0;
		}

		// 提取 canmoe chunk 里的"卡池期次数组"（元素含 periodStart/periodEnd 的那个），返回元素子串数组。
		// 数组的变量名是压缩产物的一部分：canmoe 每次重新构建都可能改名（曾见 p=[…]，现为 f=[…]），
		// 所以按"任意 `名字=[` 且数组体里有 periodStart"来定位，不写死变量名
		// （曾因写死 p= 而在 canmoe 改版后静默抓不到当期卡池）。
		function extractCanmoePeriods(js) {
			const re = /[A-Za-z_$][\w$]*\s*=\s*\[/g;
			for (let m = re.exec(js); m; m = re.exec(js)) {
				const start = js.indexOf("[", m.index);
				// 便宜预筛：数组开头不远处就有 periodStart 字段，省掉对每个数组都做括号平衡扫描
				if (!/periodStart\s*:/.test(js.slice(start, start + 4000))) continue;
				let depth = 0, inStr = false, q = "", end = -1;
				for (let i = start; i < js.length; i++) {
					const ch = js[i];
					if (inStr) { if (ch === "\\") i++; else if (ch === q) inStr = false; continue; }
					if (ch === '"' || ch === "'") { inStr = true; q = ch; continue; }
					if (ch === "[") depth++;
					else if (ch === "]") { depth--; if (depth === 0) { end = i; break; } }
				}
				if (end < 0) continue;
				const body = js.slice(start + 1, end);
				if (!/periodStart\s*:/.test(body)) continue;
				const out = [];
				let d2 = 0, s2 = false, q2 = "", st = 0;
				for (let k = 0; k < body.length; k++) {
					const ch = body[k];
					if (s2) { if (ch === "\\") k++; else if (ch === q2) s2 = false; continue; }
					if (ch === '"' || ch === "'") { s2 = true; q2 = ch; continue; }
					if (ch === "{" || ch === "[") d2++;
					else if (ch === "}" || ch === "]") d2--;
					else if (ch === "," && d2 === 0) { out.push(body.slice(st, k)); st = k + 1; }
				}
				out.push(body.slice(st));
				return out;
			}
			return null;
		}

		// 兼容旧调用：parseCanmoe / parseCanmoeLoose 均走统一的"当期选择"逻辑（now 可注入）。
		// 这两个是**给通用解析（自定义条目/自定义地址）用的宽松包装**：把 undefined 归一成 null，
		// 即"读不出来 → 未公布"，不在这里抛错（用户自定义地址读不出内容是常态，不该报成源站故障）。
		function parseCanmoe(js, now = nowMs()) { const d = currentFromCanmoe(js, now); return d === void 0 ? null : d; }
		function parseCanmoeLoose(js, now = nowMs()) { return parseCanmoe(js, now); }

		// 终末地（canmoe 经 host 代理）：页面 HTML → 定位 BannerCalendar chunk → 抓 chunk JS → 窗口匹配当期
		// canmoe 无 CORS 头，两步都经 host 代理（referer 用页面 origin 满足反爬）
		// 数据在某一组件的 chunk 里（含当期 d={...} 与历史期次数组），currentFromCanmoe(js, now) 做窗口匹配
		//
		// 三态（这是本条目的**默认来源**，必须把"源站改版"和"没公布"分开，否则会重演长期静默失灵）：
		//   · 有覆盖当前时刻的期次 → 返回数据；
		//   · 拿到 JS 且里面有卡池结构、但没有覆盖当前的期次 → return null（未公布）；
		//   · 页面/所有 chunk 里都找不到卡池结构（或 chunk 全抓失败）→ **抛错**（面板显示"卡池失败"）。
		async function fetchCanmoeEndfield(pageUrl, now = nowMs()) {
			const html = await proxyFetchText(pageUrl, "https://end.canmoe.com/");
			const chunks = nextJsChunkUrls(html, "BannerCalendar", pageUrl);
			if (chunks.length === 0) throw new Error("canmoe-no-chunk");   // 页面拿到了但没有数据块链接 = 改版
			let fetchedAny = false, sawStructure = false, lastErr = null;
			for (const c of chunks) {
				let js = null;
				try {
					js = await proxyFetchText(c, "https://end.canmoe.com/");
				} catch (err) {
					lastErr = err;      // 单个 chunk 抓失败：继续试下一个（错误留着，全失败时抛出去）
					continue;
				}
				fetchedAny = true;
				const d = currentFromCanmoe(js, now);
				if (d === void 0) continue;      // 这份 chunk 里没有卡池结构 → 看下一个
				sawStructure = true;
				if (d) {
					const hover = canmoePoolHover(js, now);
					if (hover) d.bannerHover = hover;
					return d;
				}
			}
			if (!fetchedAny) throw (lastErr || new Error("canmoe-chunk-fetch-failed"));
			if (!sawStructure) throw new Error("canmoe-layout-changed");
			return null;   // 结构在、但当期没有覆盖现在的期次 → 未公布
		}

		// 终末地卡池列悬停：canmoe 卡池日历 chunk 内同期全部卡池条目（特许寻访 / 重构寻访 等），
		// 每池"卡池名：角色"一行 + 时间；窗口相同则合并时间；结束时间升序（0/1 池返回 "" 走单条兜底）
		function canmoePoolHover(js, now) {
			const arr = extractCanmoePeriods(js);
			if (!arr) return "";
			const pools = [];
			for (const e of arr) {
				const ps = (e.match(/periodStart\s*:\s*"([^"]*)"/) || [])[1];
				const pe = (e.match(/periodEnd\s*:\s*"([^"]*)"/) || [])[1];
				if (!ps || !pe) continue;
				const a = new Date(ps).getTime(), b = new Date(pe).getTime();
				if (!(a <= now && now <= b)) continue;
				const title = (e.match(/title\s*:\s*"([^"]*)"/) || [])[1] || "";
				const subtitle = (e.match(/subtitle\s*:\s*"([^"]*)"/) || [])[1] || "";
				if (!title && !subtitle) continue;
				pools.push({
					name: title || subtitle,
					label: title && subtitle ? `${title}\uFF1A${subtitle}` : (title || subtitle),
					startTs: a,
					endTs: b
				});
			}
			return buildPoolHover(pools);
		}

		// 异环（ldshop 繁体）：解析「項目/資訊」卡池表（含 期間/角色/棋盤 行），返回全部卡池
		// 表格行结构：<td><p>期間</p></td><td><p>8月19日－9月9日</p></td>
		function parseLdshopPools(html) {
			const out = [];
			const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)];
			for (const tb of tables) {
				const body = tb[1];
				if (!/期間/.test(body.replace(/<[^>]+>/g, "|"))) continue;
				let info = {};
				for (const rm of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
					const tds = [...rm[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]).trim());
					if (tds.length >= 2 && tds[0] && tds[0] !== "項目") info[tds[0]] = tds[1];
				}
				if (!info["期間"]) continue;
				const range = parseLdshopRange(info["期間"]);
				if (!range) continue;
				const chars = [info["全新S級角色"], info["復刻S級角色"]].filter(Boolean).join("/");
				out.push({
					banner: info["角色棋盤"] || "异环卡池",
					roles: chars,
					...range,
					isMain: true
				});
			}
			return out;
		}

		// 中文明期间 → startTs/endTs/bannerDates（如 "8月19日－9月9日"；跨年自动+1年）
		function parseLdshopRange(raw, now) {
			const s = String(raw).trim();
			const m = s.match(/(\d{1,2})月(\d{1,2})日\s*[－\-]\s*(\d{1,2})月(\d{1,2})日/);
			if (!m) return null;
			const base = now || new Date(nowMs());   // 缺省走注入时钟（core 不得直接读宿主时钟）
			const y = base.getFullYear();
			const a = new Date(y, Number(m[1]) - 1, Number(m[2]), 0, 0);
			let b = new Date(y, Number(m[3]) - 1, Number(m[4]), 23, 59);
			if (b < a) b = new Date(y + 1, Number(m[3]) - 1, Number(m[4]), 23, 59);
			const fmt = (d) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			return { startTs: a.getTime(), endTs: b.getTime(), startText: fmt(a), endText: fmt(b), raw: `${fmt(a)} ~ ${fmt(b)}` };
		}

		// 异环（ldshop 经 host 代理）：抓页面 → 解析卡池表 → 选当期
		async function fetchLdshopNte(pageUrl) {
			const html = await proxyFetchText(pageUrl, "https://www.ldshop.gg/");
			const pools = parseLdshopPools(html);
			if (pools.length === 0) return null;
			return selectCurrent(pools, nowMs());
		}

		// 异环（官网 yh.wanmei.com 公告，经 host 代理）：抓游戏公告列表 → 取最新维护/更新公告 → 解析当期限定棋盘卡池与限时活动
		// 官网公告列表条目：<a href="/news/gamebroad/YYYYMMDD/N.html">…<h2 class="title">标题</h2>
		const NTE_ITEM_RE = /<a href="(\/news\/gamebroad\/\d+\/\d+\.html)"[\s\S]*?<h2 class="title">([^<]+)<\/h2>/g;
		// 带新卡池的公告标题：停服维护/版本更新；"1.3版本「…」更新公告"这类版本名夹在中间，所以"更新公告"也要算
		const NTE_MAINT_RE = /停服维护|停服更新|维护公告|版本更新|更新公告/;
		// 逐页向下的上限：维护公告会随新公告发布被挤到第 2、3 页，只看第 1 页会把"进行中的卡池"误判成未公布
		const NTE_MAX_LIST_PAGES = 3;
		// 每次最多试几篇公告正文（按从新到旧），避免某篇规则失效时白抓一堆
		const NTE_MAX_DETAILS = 3;

		// 取分页控件里的后续页地址（相对当前页）：<ul class="pagination"> … <a href="index1.html">2</a>
		function nteNextPageUrls(listUrl, html, seen) {
			const pg = String(html || "").match(/<ul class="pagination">[\s\S]*?<\/ul>/);
			if (!pg) return [];
			const dir = listUrl.split("#")[0].split("?")[0].replace(/[^/]*$/, "");
			const out = [];
			for (const m of pg[0].matchAll(/href="(index\d+\.html)"/g)) {
				const u = dir + m[1];
				if (u !== listUrl && !seen.has(u) && !out.includes(u)) out.push(u);
			}
			return out;
		}

		// 逐页（index.html → index1.html → index2.html …）从新到旧找"带新卡池"的维护/版本更新公告，
		// 取第一篇能解析出当期卡池/活动的正文；"不停服更新"不含新卡池，跳过。
		// 三态：有当期内容 → 数据；列表页有公告但都不含当期内容（或"不停服更新"）→ null（未公布）；
		//      列表页**一条公告链接都没有** → 抛错（官网列表改版，让面板显示"卡池失败"而不是"未公布"）。
		async function fetchNteWanmei(listUrl, signal) {
			const ref = "https://yh.wanmei.com/";
			const seen = new Set();
			const queue = [listUrl];
			let details = 0;
			let sawAnyLink = false;
			while (queue.length && seen.size < NTE_MAX_LIST_PAGES) {
				const url = queue.shift();
				if (seen.has(url)) continue;
				seen.add(url);
				const html = await proxyFetchText(url, ref);
				if (/\/news\/gamebroad\/\d+\/\d+\.html/.test(html)) sawAnyLink = true;
				// 列表条目本身从新到旧：边收集边试，命中当期内容立刻返回
				for (const m of html.matchAll(NTE_ITEM_RE)) {
					if (!NTE_MAINT_RE.test(m[2]) || /不停服/.test(m[2])) continue;
					if (details >= NTE_MAX_DETAILS) return null;   // 试读额度用完（此时必然已见到公告链接）
					details++;
					const data = parseNteWanmei(await proxyFetchText("https://yh.wanmei.com" + m[1], ref));
					if (data) return data;
				}
				for (const u of nteNextPageUrls(listUrl, html, seen)) if (!queue.includes(u)) queue.push(u);
			}
			if (!sawAnyLink) throw new Error("nte-list-shape-changed");
			return null;
		}

		// 解析官网公告正文 → 当期卡池（全新限定S级角色所属限定棋盘）+ 当期活动（限时活动）
		function parseNteWanmei(html) {
			const text = String(html || "")
				.replace(/<script[\s\S]*?<\/script>/gi, " ")
				.replace(/<style[\s\S]*?<\/style>/gi, " ")
				.replace(/<[^>]+>/g, "\n")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/\n\s*\n+/g, "\n").trim();
			const fmt = (mo, d, h, mi) => `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
			const data = { banner: "", roles: "", bannerDates: "", bannerDatesRaw: "", event: "", eventDates: "", eventDatesRaw: "" };
			// 当期卡池：全新限定S级角色「X」→「Y」限定棋盘, 开放时间 M月D日维护更新后-M月D日05:59
			const newRole = text.match(/全新限定S级角色「([^」]+)」[\s\S]{0,400}?可通过「([^」]+)」限定棋盘获得[\s\S]{0,300}?开放时间：(\d+)月(\d+)日维护更新后-(\d+)月(\d+)日05:59/);
			if (newRole) {
				const mo = +newRole[3], d = +newRole[4], emo = +newRole[5], ed = +newRole[6];
				data.banner = `「${newRole[2]}」限定棋盘`;
				data.roles = newRole[1];
				data.bannerDates = `${fmt(mo, d, 11, 0)} ~ ${fmt(emo, ed, 5, 59)}`;
				data.bannerDatesRaw = data.bannerDates;
			}
			// 当期活动：「X」限时活动 活动时间：M月D日(维护更新后|hh:mm)-M月D日hh:mm
			const ev = text.match(/「([^」]+)」限时活动[\s\S]{0,200}?活动时间：(\d+)月(\d+)日(?:维护更新后|(\d{2}):(\d{2}))-(\d+)月(\d+)日(\d{2}):(\d{2})/);
			if (ev) {
				const sMo = +ev[2], sD = +ev[3], sH = ev[4] ? +ev[4] : 11, sMi = ev[5] ? +ev[5] : 0;
				const eMo = +ev[6], eD = +ev[7], eH = +ev[8], eMi = +ev[9];
				data.event = ev[1];
				data.eventDates = `${fmt(sMo, sD, sH, sMi)} ~ ${fmt(eMo, eD, eH, eMi)}`;
				data.eventDatesRaw = data.eventDates;
			}
			if (!data.banner) return null;
			return data;
		}

		// 通用抓取网页文本：MediaWiki api.php（action=parse）→ JSON 的 parse.text；其它 URL → 原始 HTML
		async function fetchHtmlText(url, signal) {
			const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
			const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
			if (!res.ok) throw new Error("http-" + res.status);
			if (/action\s*=\s*parse/i.test(url)) {
				const json = await res.json();
				const text = json?.parse?.text;
				if (typeof text !== "string") throw new Error("bad-json");
				return text;
			}
			return res.text();
		}

		// 通用卡池解析（新增自定义条目的"卡池来源"地址用）：
		// 依次尝试 bwiki 式「时间+版本」表、方舟式「限时寻访」表、GachaTracker 式日期表、
		// Next.js SPA（canmoe 等，页面无表格、数据在组件 chunk 里），选当期；
		// 全部失败返回 null（调用方按解析失败处理，不做可达性健康检查）
		async function tryParseGenericGacha(url, signal) {
			const html = await fetchHtmlText(url, signal);
			const now = nowMs();
			const cur = selectCurrent(parseAllBwiki(html), now) || selectCurrent(parseArknights(html), now);
			if (cur && cur.banner && cur.bannerDates) return cur;
			const gt = parseGachaTracker(html);
			if (gt && gt.banner && gt.bannerDates) return gt;
			// Next.js SPA：HTML 无表格数据，定位组件 chunk 后抓 chunk JS 解析。
			// chunk 与页面同源：页面能直连（CORS 允许）时 chunk 直连，否则经 host 代理。
			const chunks = nextJsChunkUrls(html, "BannerCalendar", url);
			for (const c of chunks) {
				try {
					const js = await fetchHtmlText(c, signal);
					// 只调一次：parseCanmoe 与 parseCanmoeLoose 是同一实现，旧写法 a || a 在最重的解析
					// （chunk 的括号平衡扫描）上白跑两遍，而"没命中当期"恰恰是最常见的情况
					const d = parseCanmoe(js);
					if (d && d.banner && d.bannerDates) return d;
				} catch { /* 下一个 chunk */ }
			}
			return null;
		}

		// 通用活动解析：扫描含「时间」（或「活动时间」）表头的表格，行内找时间与名称列，选当期
		// 起始为"版本更新后"等无日期文本时保留 startTs=null，由 selectCurrent 的 fillMissingStarts 补全
		function collectGenericEvents(html) {
			const items = [];
			const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)];
			for (const t of tables) {
				const body = t[1];
				if (!/<th[^>]*>[^<]*时间[^<]*<\/th>/i.test(body)) continue;
				// 「类型」列（如 版本活动/常规活动/剧情活动）→ 用于活动外显的类别优先级
				const heads = [...body.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => stripTags(m[1]).trim());
				const catIdx = heads.findIndex((h) => /类型|類型/.test(h));
				for (const rm of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
					const row = rm[1];
					if (!/<td/i.test(row)) continue;
					const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]).trim());
					if (tds.length < 2) continue;
					// 时间列（含日期/区间）与名称列分开
					let name = "", time = "";
					for (const td of tds) {
						if (!time && /20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}|[~～]/.test(td)) time = td;
						else if (td && !name) name = td;
					}
					if (!time || !name) continue;
					// 名字里偶发混进图片文件名残渣（如「文件:巡星之礼第二十六期.png 」）→ 去掉该前缀
					name = name.replace(/^文件:[^\s]*?\.(?:png|jpe?g|gif|webp|svg)\s*/i, "").trim();
					if (!name) continue;
					const range = parseRange(time);
					// 起始可为 null（"版本更新后"），结束时间必须有效
					if (range.endTs == null) continue;
					items.push({ banner: name, cat: catIdx >= 0 ? (tds[catIdx] || "") : "", ...range, isMain: true });
				}
			}
			return items;
		}

		// 当期活动（外显取 selectCurrent 的那条，行为同旧版）
		function parseGenericEvents(html) {
			return selectCurrent(collectGenericEvents(html), nowMs());
		}

		// Bwiki 卡池列载荷（原神/星铁）：外显沿用 selectCurrent（同窗口主池角色合并、武器/光锥池不入选）；
		// bannerHover 列出同期全部主池（每池"池名：角色"+时间；窗口相同则合并时间；结束时间升序）
		function bwikiGachaPayload(html) {
			const items = parseAllBwiki(html);
			// 页面拿到了却连一行候选都没有 → wiki 表结构变了（抛错，面板显示"卡池失败"）；
			// 有候选但都不覆盖当前时刻 → 下面返回 null（未公布）。这两件事必须分开。
			if (items.length === 0) throw new Error("bwiki-gacha-no-table");
			// selectCurrent 会就地补全缺失起点（fillMissingStarts），故先取快照
			const snapshot = items.map((it) => ({ banner: it.banner, roles: it.roles, startTs: it.startTs, endTs: it.endTs, raw: it.rawOriginal || it.raw, isMain: it.isMain }));
			const cur = selectCurrent(items, nowMs());
			if (!cur) return null;
			const now = nowMs();
			const pools = snapshot
				.filter((it) => it.isMain && it.endTs != null && it.endTs >= now && (it.startTs == null || it.startTs <= now))
				.map((it) => ({
					name: it.banner,
					label: `${it.banner}${it.roles ? `\uFF1A${cleanRoles(it.roles)}` : ""}`,
					startTs: it.startTs,
					endTs: it.endTs,
					raw: it.raw
				}));
			return { ...cur, bannerHover: buildPoolHover(pools) };
		}

		// 活动列载荷：外显=排序第一条（最快结束的当期活动，③）；eventHover=全部覆盖当前时刻的活动（同序）。
		// 注意 selectCurrent 会就地补全缺失起点（fillMissingStarts），故这里只取快照自行排序，
		// 避免"版本更新后 ~ 未来"这类起点未给的行被补成未来起点而漏掉。
		// 只有 1 条时 buildEventHover 返回 ""，由 UI 退回单条展示（兜底）。
		function genericEventPayload(html) {
			const items = collectGenericEvents(html);
			// 页面拿到了却连一行候选都没有 → 活动表结构变了（抛错 = "活动失败"）；
			// 有候选但当期没有覆盖现在的 → 下面返回 null（未公布）
			if (items.length === 0) throw new Error("bwiki-event-no-table");
			const snapshot = items.map((it) => ({ name: it.banner, cat: it.cat || "", startTs: it.startTs, endTs: it.endTs, raw: it.rawOriginal || it.raw }));
			const now = nowMs();
			const active = sortEventItems(snapshot.filter((it) => it.endTs != null && it.endTs >= now && (it.startTs == null || it.startTs <= now)));
			if (active.length === 0) return null;
			// 外显：类别优先（剧情/叙事、限时高难），同级内结束时间升序；悬停仍按 endTs 升序全量
			const primary = pickEventPrimary(active) || active[0];
			return {
				event: primary.name,
				eventDates: primary.startTs != null && primary.endTs != null ? fmtWindow(primary.startTs, primary.endTs) : (primary.raw || ""),
				eventDatesRaw: primary.raw || "",
				eventHover: buildEventHover(active)
			};
		}

		// 明日方舟（PRTS 活动一览）：表格含「活动开始时间」列 + 隐藏 data-time="开始秒,结束秒"（Unix 秒）。
		// 开始时间用第一列文本（"2026-08-22 04:00"），结束时间用 data-time 第二个值（UTC 秒 → +08）。
		// 注意 data-time 第一个值是页面缓存时刻（非开始时间），故开始以文本列为准。
		// 活动名带核心分类前缀（"支线故事：墟·复刻"）：分类取第三列 <a title="分类:XXX"> 链接，
		// 核心分类 = 排除"复刻活动"（修饰词）后的第一个。
		function collectPrtsEvents(html) {
			const items = [];
			const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)];
			for (const t of tables) {
				const body = t[1];
				if (!/<th[^>]*>[^<]*时间[^<]*<\/th>/i.test(body)) continue;
				for (const rm of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
					const row = rm[1];
					if (!/data-time="(\d+),(\d+)"/.test(row)) continue;
					const tm = row.match(/data-time="(\d+),(\d+)"/);
					if (!tm) continue;
					const endTs = Number(tm[2]) * 1000; // 结束（UTC 秒 → ms）
					if (!endTs) continue;
					const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
					if (tds.length < 3) continue;
					// 名称：第二列第一个 <a> 的文本（"墟·复刻"），避开状态徽章与 <script> 内容
					const aM = tds[1].match(/<a[^>]*>([\s\S]*?)<\/a>/);
					const name = aM ? stripTags(aM[1]).trim() : "";
					if (!name) continue;
					// 分类：第三列所有 <a title="分类:XXX">；核心分类排除"复刻活动"修饰后取第一个
					const catLinks = [...tds[2].matchAll(/title="分类:([^"]+)"/g)].map((m) => m[1]);
					let coreCat = "";
					if (catLinks.length > 0) {
						coreCat = catLinks.find((c) => c !== "\u590D\u523B\u6D3B\u52A8") || catLinks[0];
					} else {
						coreCat = stripTags(tds[2]).replace(/\s+/g, " ").trim();
					}
					const label = coreCat ? `${coreCat}\uFF1A${name}` : name;
					// 开始：第一列文本（"2026-08-22 04:00"）
					const st = parseTime(stripTags(tds[0]).trim());
					items.push({
						banner: label,
						cat: coreCat,
						...range2(st, endTs),
						isMain: true
					});
				}
			}
			return items;
		}

		// 当期活动（外显取 selectCurrent 的那条，行为同旧版）
		function parsePrtsEvents(html) {
			return selectCurrent(collectPrtsEvents(html), nowMs());
		}

		// 活动列载荷：外显=排序第一条（最快结束的当期活动，③）；eventHover=全部覆盖当前时刻的活动（同序）
		function prtsEventPayload(html) {
			const items = collectPrtsEvents(html);
			const snapshot = items.map((it) => ({ name: it.banner, cat: it.cat || "", startTs: it.startTs, endTs: it.endTs, raw: it.raw }));
			const now = nowMs();
			const active = sortEventItems(snapshot.filter((it) => it.endTs != null && it.endTs >= now && (it.startTs == null || it.startTs <= now)));
			if (active.length === 0) return null;
			// 外显：类别优先（支线故事/危机合约等 vs 登录活动），同级内结束时间升序
			const primary = pickEventPrimary(active) || active[0];
			return {
				event: primary.name,
				eventDates: primary.startTs != null && primary.endTs != null ? fmtWindow(primary.startTs, primary.endTs) : (primary.raw || ""),
				eventDatesRaw: primary.raw || "",
				eventHover: buildEventHover(active)
			};
		}
		// PRTS 起止 → 统一文本（parsePrtsEvents 内部用）
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

		// 终末地（Game8 英文站）：活动排期表，条目形如
		// <a class="a-link" href="...">Bedazzling Dawnstar Sign-In</a><br>(Version 1.4)<br>08/09/26 - 09/02/26
		// 日期为美式 MM/DD/YY；多个并行当期活动时选"结束最晚"（覆盖全部当期窗口）。
		// 无起止区间（只有开始日，如 "07/16"）的条目跳过。
		function parseGame8Events(html) {
			const items = [];
			for (const m of html.matchAll(/<a class="a-link"[^>]*>([^<]+)<\/a><br>\((Version[^)]*)\)<br>([^<]*)/g)) {
				const period = m[3].trim();
				if (!/^\d{1,2}\/\d{1,2}\/\d{2}\s*-\s*\d{1,2}\/\d{1,2}\/\d{2}/.test(period)) continue;
				const mm = period.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{2})/);
				if (!mm) continue;
				const y = 2000 + Number(mm[3]);
				const a = new Date(y, Number(mm[1]) - 1, Number(mm[2]), 0, 0);
				let b = new Date(y, Number(mm[4]) - 1, Number(mm[5]), 23, 59);
				if (b < a) b = new Date(y + 1, Number(mm[4]) - 1, Number(mm[5]), 23, 59);
				items.push({
					banner: m[1].trim(),
					roles: "",
					startTs: a.getTime(),
					endTs: b.getTime(),
					isMain: true
				});
			}
			if (items.length === 0) return null;
			const now = nowMs();
			// 当期（进行中）选结束最晚；无当期时返回 null
			const cur = items
				.filter((it) => it.startTs <= now && it.endTs >= now)
				.sort((x, y) => y.endTs - x.endTs)[0];
			if (!cur) return null;
			const fmt = (ts) => {
				const d = new Date(ts);
				return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			};
			return {
				banner: cur.banner,
				roles: "",
				bannerDates: `${fmt(cur.startTs)} ~ ${fmt(cur.endTs)}`,
				bannerDatesRaw: `${fmt(cur.startTs)} ~ ${fmt(cur.endTs)}`
			};
		}

		// parseGame8Events 的宽松回退：容忍 <a> 属性顺序/空白变化。仅在主解析未命中时使用。
		function parseGame8EventsLoose(html) {
			const items = [];
			for (const m of html.matchAll(/<a[^>]*>\s*([^<]+?)\s*<\/a>[\s\S]*?\(Version[^)]*\)[\s\S]*?(\d{1,2}\/\d{1,2}\/\d{2,4}\s*-\s*\d{1,2}\/\d{1,2}\/\d{2,4})/g)) {
				const period = m[2].trim();
				const mm = period.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
				if (!mm) continue;
				const y = mm[3].length === 2 ? 2000 + Number(mm[3]) : Number(mm[3]);
				const a = new Date(y, Number(mm[1]) - 1, Number(mm[2]), 0, 0);
				let b = new Date(y, Number(mm[4]) - 1, Number(mm[5]), 23, 59);
				if (b < a) b = new Date(y + 1, Number(mm[4]) - 1, Number(mm[5]), 23, 59);
				items.push({ banner: m[1].trim(), roles: "", startTs: a.getTime(), endTs: b.getTime(), isMain: true });
			}
			if (items.length === 0) return null;
			const now = nowMs();
			const cur = items.filter((it) => it.startTs <= now && it.endTs >= now).sort((x, y) => y.endTs - x.endTs)[0];
			if (!cur) return null;
			const fmt = (ts) => {
				const d = new Date(ts);
				return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			};
			return {
				banner: cur.banner,
				roles: "",
				bannerDates: `${fmt(cur.startTs)} ~ ${fmt(cur.endTs)}`,
				bannerDatesRaw: `${fmt(cur.startTs)} ~ ${fmt(cur.endTs)}`
			};
		}

		// 终末地（Game8 经 host 代理，无 CORS）：活动排期页
		async function fetchGame8Endfield(pageUrl) {
			const html = await proxyFetchText(pageUrl, "https://game8.co/");
			return parseGame8Events(html) || parseGame8EventsLoose(html);
		}

		// 从 fz.wiki 页面（Next.js App Router）内联 RSC flight payload 中抽取 contentJson 的 JSON 字符串。
		// 数据被序列化为 self.__next_f.push([1,"..."])；拼接后按引号转义还原，再按大括号平衡取 contentJson 对象。
		function extractFzContentJson(html) {
			const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
			let full = "";
			let m;
			while ((m = re.exec(html))) {
				try { full += JSON.parse('"' + m[1] + '"'); } catch { full += m[1]; }
			}
			if (!full.includes('"contentJson"')) return null;
			const ci = full.indexOf('"contentJson"');
			let start = full.indexOf("{", ci);
			if (start < 0) return null;
			let depth = 0, i = start, inStr = false, esc = false;
			for (; i < full.length; i++) {
				const c = full[i];
				if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
				if (c === '"') { inStr = true; continue; }
				if (c === "{") depth++;
				else if (c === "}") { depth--; if (depth === 0) break; }
			}
			try { return JSON.parse(full.slice(start, i + 1)); } catch { return null; }
		}

		// 终末地（FZ Wiki /wiki/活动）：页面 RSC payload → 覆盖当前时刻的活动列表。
		// 活动节点有三种历史结构，全部兼容：
		//   ① endfieldCardActivityIndex.attrs.activities[]（最早）
		//   ② 独立子节点 type=*endfieldCardActivityIndex__activities（字段在自身 attrs）
		//   ③ endfieldCardActivityIndex.content[] → wikiCardItem.attrs.data（当前线上结构）
		// 只收"有明确起止"的活动（timeRanges 末段的 open+close 都非空），
		// 与旧行为一致——无 close 的是新手/每周/引导等常驻活动，不当作当期活动。
		// 时间格式 "2026/9/2 7:00:00"；外显=排序第一条（结束最早的），悬停按同序逐行。
		function parseFzWikiActivities(html, now) {
			const obj = extractFzContentJson(html);
			if (!obj) return null;
			const acts = [];
			const pushAct = (name, tags, trs) => {
				if (typeof name !== "string" || !name) return;
				if (!Array.isArray(trs) || trs.length === 0) return;
				const tr = trs[trs.length - 1];
				if (!tr || !tr.open || !tr.close) return;
				acts.push({ name, tags: tags || [], open: tr.open, close: tr.close });
			};
			(function walk(n) {
				if (!n || typeof n !== "object") return;
				if (Array.isArray(n)) { n.forEach(walk); return; }
				// ① 旧结构：活动在父节点 attrs.activities
				if (n.type === "endfieldCardActivityIndex" && Array.isArray(n.attrs?.activities)) {
					for (const a of n.attrs.activities) pushAct(a.name, a.tags, a.timeRanges);
				}
				// ② 旧结构：独立的 __activities 子节点，字段在各自 attrs 上
				if (n.attrs && typeof n.type === "string" && n.type.includes("endfieldCardActivityIndex__activities")) {
					pushAct(n.attrs.name, n.attrs.tags, n.attrs.timeRanges);
				}
				// ③ 当前结构：endfieldCardActivityIndex.content[] → wikiCardItem.attrs.data
				if (n.type === "endfieldCardActivityIndex" && Array.isArray(n.content)) {
					for (const c of n.content) {
						const d = c && c.attrs && c.attrs.data;
						if (d) pushAct(d.name, d.tags, d.timeRanges);
					}
				}
				for (const k of Object.keys(n)) walk(n[k]);
			})(obj);
			// 一条活动都没解析出来 → 页面结构变了（不是"当期没活动"）：抛错让该侧记 down，
			// 面板会显示"活动失败"，而不是伪装成"新活动未公布"（历史教训：源站改版长期静默失灵）。
			if (acts.length === 0) throw new Error("fz-wiki-no-activities");
			const parseT = (s) => new Date(String(s).replace(/\//g, "-")).getTime();
			const t0 = now || nowMs();
			// 覆盖当前时刻的活动统一排序（③ 结束时间升序）供悬停；外显另按类别优先挑选
			const activeActs = sortEventItems(acts
				.filter((a) => parseT(a.open) <= t0 && parseT(a.close) >= t0)
				.map((a) => ({ name: a.name, tags: (a.tags || []).join("/"), startTs: parseT(a.open), endTs: parseT(a.close) })));
			// 解析到活动、但当期没有覆盖当前时刻的 → 返回 null（这一侧记 nomatch = "新活动未公布"）
			if (activeActs.length === 0) return null;
			const primary = pickEventPrimary(activeActs) || activeActs[0]; // 叙事活动/挑战活动优先于签到类
			const win = fmtWindow(primary.startTs, primary.endTs);
			return {
				banner: primary.name,
				bannerDatesRaw: win,
				bannerDates: win,
				eventHover: buildEventHover(activeActs)
			};
		}

		// 终末地（FZ Wiki 经 host 代理，无 CORS）：活动排期页。
		// 三态口径：有当期活动 → 数据；解析到活动但没有当期 → null（nomatch）；
		// 页面结构变了/一条都解析不出 → parseFzWikiActivities 抛错（down）。
		async function fetchFzWikiEndfield(pageUrl, now = nowMs()) {
			const html = await proxyFetchText(pageUrl, "https://fz.wiki/");
			return parseFzWikiActivities(html, now);
		}

		// 通用活动源解析（自定义条目/自定义活动来源地址用）：抓取页面 → parseGenericEvents → {event, eventDates}
		async function tryParseGenericEvent(url, signal) {
			const html = await fetchHtmlText(url, signal);
			const cur = parseGenericEvents(html);
			if (cur && cur.banner) return {
				event: cur.banner,
				eventDates: cur.bannerDates || "",
				eventDatesRaw: cur.bannerDatesRaw || cur.bannerDates || ""
			};
			return null;
		}

		// 原神（bwiki SMW 语义查询）：活动一览页数据在 JS 动态加载（Dquery + SMW），
		// 改用 api.php?action=ask 直接查询「分类:活动」的开始/结束时间，选当期。
		// 属性：名称/开始时间/结束时间/所属版本；结束时间 9999/01/01 为永久活动占位（跳过）。
		// 查询 URL 由 fetchYsActivity 构造，浏览器直连（api.php 带 origin=* 有 CORS）。
		function parseSmwActivity(json) {
			const results = json?.query?.results || {};
			const now = nowMs();
			const covering = [];
			// SMW timestamp 是 UTC 秒，raw 形如 "1/2026/8/28/10/0/0/0"（服务器本地时间 +08）。
			// 用 raw 直接构造本地时间，避免 UTC 秒被本地时区再偏移。
			const parseRaw = (v) => {
				if (!v) return null;
				if (v.raw != null) {
					const p = String(v.raw).split("/");
					if (p.length >= 8) {
						const y = Number(p[1]), mo = Number(p[2]), d = Number(p[3]), h = Number(p[4]), mi = Number(p[5]);
						if (y && mo && d) return new Date(y, mo - 1, d, h || 0, mi || 0).getTime();
					}
				}
				// 回退：value 若是严格 ISO 本地时间则用之（避免把展示文本误判为时间）
				const iso = v.value != null ? String(v.value) : "";
				if (/^\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}/.test(iso)) {
					const t = new Date(iso.replace(" ", "T")).getTime();
					if (!Number.isNaN(t)) return t;
				}
				return null;
			};
			for (const [title, r] of Object.entries(results)) {
				const p = r.printouts || {};
				const nameArr = p["名称"] || [];
				const name = Array.isArray(nameArr) && nameArr[0] ? String(nameArr[0]) : title;
				const startTs = parseRaw(p["开始时间"]?.[0]);
				const endTs = parseRaw(p["结束时间"]?.[0]);
				if (startTs == null || endTs == null) continue;
				// 永久活动占位（9999 年）跳过
				if (endTs > 4102444800000) continue; // 2100-01-01
				if (startTs <= now && endTs >= now) {
					// 类型属性（如 剧情活动/常规活动/版本活动）→ 活动外显的类别优先级。
					// 注意 SMW 这里返回的是字符串数组（不是 {fulltext} 值对象），两种形态都兼容。
					const catArr = p["类型"] || [];
					const cat = catArr
						.map((x) => (typeof x === "string" ? x : String((x && (x.fulltext || x.value)) || "")))
						.filter(Boolean)
						.join("/");
					covering.push({ name, cat, startTs, endTs });
				}
			}
			if (covering.length === 0) return null;
			// 悬停按结束时间升序；外显按类别优先（剧情活动/挑战类优先于常规/网页类）
			const ordered = sortEventItems(covering);
			const best = pickEventPrimary(ordered) || ordered[0];
			const win = fmtWindow(best.startTs, best.endTs);
			return {
				banner: best.name,
				roles: "",
				bannerDates: win,
				bannerDatesRaw: win,
				eventHover: buildEventHover(ordered)
			};
		}

		// 原神 SMW 活动查询（经 origin=* 直连）
		// 返回 EVENT_FETCHERS 契约格式 {event, eventDates, eventDatesRaw}（parseSmwActivity 产出卡池格式，这里转换）
		async function fetchYsActivity(signal) {
			const nowYear = new Date(nowMs()).getFullYear();   // 走注入时钟（core 不得直接读宿主时钟）
			const q = "[[\u5206\u7C7B:\u6D3B\u52A8]][[\u7ED3\u675F\u65F6\u95F4::>" + nowYear + "/01/01]]|?\u540D\u79F0|?\u5F00\u59CB\u65F6\u95F4|?\u7ED3\u675F\u65F6\u95F4|?\u7C7B\u578B|sort=\u5F00\u59CB\u65F6\u95F4|order=desc|limit=60";
			const apiUrl = "https://wiki.biligame.com/ys/api.php?action=ask&query=" + encodeURIComponent(q) + "&format=json&origin=*";
			const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
			if (!res.ok) throw new Error("http-" + res.status);
			const json = await res.json();
			const d = parseSmwActivity(json);
			if (!d) return null;
			return {
				event: d.banner,
				eventDates: d.bannerDates || "",
				eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "",
				eventHover: d.eventHover || ""
			};
		}

		// ---- 抓取器工厂 ----
		// mkMediaWiki：MediaWiki api.php JSON 源（追加 &origin=* 绕过 CORS）
		// mkRaw：直接抓取原始 HTML（非 MediaWiki 源，如 GachaTracker）
		// 经 host 同源代理的来源（蔚蓝系列 / 终末地 wiki.gg / 1999 等）不用工厂包装：
		// 其抓取器内部自行调用 proxyFetchText / proxyFetchJson（绕过 CORS 与 Referer 反爬）。
		// 抓取器签名：async (url, signal) → 数据对象 | null
		function mkMediaWiki(parse) {
			return async (url, signal) => {
				const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
				const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
				if (!res.ok) throw new Error("http-" + res.status);
				const json = await res.json();
				const text = json?.parse?.text;
				if (typeof text !== "string") throw new Error("bad-json");
				return parse(text);
			};
		}
		function mkRaw(parse) {
			return async (url, signal) => {
				const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
				const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
				if (!res.ok) throw new Error("http-" + res.status);
				return parse(await res.text());
			};
		}
		// bwiki 通用"选当期"包装（原神/星铁/绝区零/方舟）
		const pickCurrent = (parse) => (html) => selectCurrent(parse(html), nowMs());
		//#endregion
