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
				// 通用数字实体兜底：源站会用**白名单之外**的数字实体（FGO 卡池一览实测 89 处 `&#32;`，
				// 即空格），旧实现只认上面那几个硬编码 → 面板上直接显示成
				// `阿蒂拉&#32; 罗摩&#32; 兰斯洛特(Saber)&#32; …`（2026-10-03 修）。
				// 位置刻意放在硬编码白名单**之后**：已知实体优先，尽量不改变既有解析结果。
				// 注：`next-sources/lib/env.js` 的 decodeEntities 本来就是通用实现，
				//     这次补齐后两者语义一致，不再有"测试对、插件错"的落差。
				.replace(/&#(\d+);/g, (m, n) => {
					try { return String.fromCodePoint(Number(n)); } catch { return m; }
				})
				.replace(/\s+/g, " ")
				.trim();
		}

		// 「版本更新后」这类**只有日期没有时分**的写法，默认按当日该时刻折算。
		// 为什么需要一个默认值：源站常见 `2026/09/28 4.6版本更新后`（日期 + 版本标签的混合体），
		// 日期是明确的，缺的只是时分；不补的话 startTs 会是 null，外显只能回落源站原文
		// （星铁活动列一度显示成 `2026/09/28 4.6版本更新后 ~ 11-10 15:00`，与其它游戏的
		// `09-28 04:00 ~ 11-10 15:00` 口径不一致）。
		// 取 04:00 是因为国内二游版本更新普遍落在凌晨维护窗口（该表内 04:00 出现最多），
		// 拿它当锚点比"不补"更接近真实，也不会让"活动是否已开始"的判定偏移一天。
		const VERSION_UPDATE_ANCHOR = { h: 4, mi: 0 };

		// 解析单个时间 → {ts, text}；无法解析返回 {ts:null, text:null}
		// `tz`（可选）= 源站墙钟时区（见 15-env.js / 20-sources.js 的 `tz`）。
		// 传了 → 绝对时刻按**源站时区**换算；不传 → 沿用本机时区（= 改造前行为）。
		// **text 一律是源站墙钟原文**，不随 tz 变 —— 玩家看游戏内公告走的就是这串时间。
		//
		// 兜底：`sourceInstant` 定义在 15-env.js。若调用方只把本文件单独抽出来用
		// （回归脚本用 `new Function` 注入单个函数、或把 core 拆到别处），它可能不在作用域；
		// 那时退回 `new Date(...)`（本机时区）而不是抛 ReferenceError ——
		// 少一次时区换算，但绝不让"抽函数"这种用法直接崩掉。
		function parseTime(s, tz) {
			const mkTs = (y, mo, d, h, mi) => (typeof sourceInstant === "function"
				? sourceInstant(y, mo, d, h, mi, tz)
				: new Date(y, mo - 1, d, h, mi).getTime());
			const m = String(s).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
			if (m) {
				const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4]), mi = Number(m[5]);
				const text = `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
				return { ts: mkTs(y, mo, d, h, mi), text };
			}
			// 回退：`YYYY/MM/DD <版本更新后>`（日期 + 版本标签，缺时分）→ 按锚点时刻补全。
			// 注意只认**带日期前缀**的这种；纯标签（`4.6版本更新后`）保持 null —— 那种确实
			// 给不出日期（下一版本何时更新是未知的），硬造时间会错得更离谱。
			const v = String(s).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s*(?:\d+(?:\.\d+)?\s*版本更新后|版本更新后)/);
			if (v) {
				const y = Number(v[1]), mo = Number(v[2]), d = Number(v[3]);
				const { h, mi } = VERSION_UPDATE_ANCHOR;
				const text = `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
				return { ts: mkTs(y, mo, d, h, mi), text };
			}
			return { ts: null, text: null };
		}

		// 时间段 → startTs/endTs + 统一文本 mm-dd hh:mm ~ mm-dd hh:mm（无法解析的一侧保留原文）
		// `tz` 同 parseTime：源站墙钟时区（可选，不传 = 本机时区）
		function parseRange(raw, tz) {
			const t = stripTags(raw);
			const parts = t.split(/~/).map((x) => x.trim());
			if (parts.length < 2) {
				const p = parseTime(parts[0], tz);
				return { startTs: p.ts, endTs: null, startText: p.text, endText: null, raw: p.text ?? t };
			}
			const a = parseTime(parts[0], tz);
			const b = parseTime(parts[1], tz);
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
		function parseAllBwiki(html, tz) {
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
				const range = parseRange(timeM[1], tz);
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
		function parseArknights(html, tz) {
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
				const range = parseRange(tds[2], tz);
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
						const range = parseRange(tds[1], tz);
						out.push({ tier: "限时", banner, roles, ...range, isMain: true });
					}
				}
			}
			return out;
		}

		// 明日方舟当期卡池：**外显与悬停共用同一份"当期池"列表**（不再各挑一个）——
		// 外显按档位优先（限时 > 标准 > 中坚）、档内先结束者优先；悬停走统一的 buildPoolHover，
		// 与其它游戏同格式（每池『池名：角色』+ 时间行、同窗口合并时间、结束时间升序）。
		function selectArknights(html, now = nowMs(), tz) {
			const items = parseArknights(html, tz);
			fillMissingStarts(items);
			const tiers = ["限时", "标准", "中坚"];
			const rank = (it) => {
				const i = tiers.indexOf(it.tier);
				return i < 0 ? tiers.length : i;
			};
			const active = items
				.filter((it) => coversNowBounded(it, now))
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
				const endTs = mk(endsNextYear(sm, null, em, null) ? nowYear + 1 : nowYear, em, ed, Number(timeM[7]), Number(timeM[8]));
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
		async function fetchArknightsGacha(url, signal, tz, now = nowMs()) {
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
			const d = selectArknights(html, now, tz);
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
		// **当期多个主池的角色全部合并**（见下方合并说明）。返回 null 时调用方回退内置数据。
		// bannerDates 为补全后用于倒计时的文本；bannerDatesRaw 为源站原文（悬停展示）。
		function selectCurrent(items, now) {
			// 先记下**补全前**哪些行的起点是"版本更新后"（startTs 原本为 null）。
			// 为什么要记：fillMissingStarts 会用"上一组结束时间"去猜这类行的起点，
			// 而那个猜测**并非总是对的** —— 星铁 4.6 上线时间期有两池：
			//   「韶艾裁英」4.6版本更新后 ~ 10-21 11:59
			//   「沧海萃珠」4.6版本更新后 ~ 11-10 15:00
			// 两者同为"4.6 上线"，只是结束不同；按"上一组结束"补会把后者补成 10-21，
			// 于是"起点已过"判定失败、它被踢出当期 —— 而它其实覆盖当前时刻
			// （用户实测：卡片只显示绯英，真珠不见了）。
			const hadOpenStart = new Set(items.filter((it) => it.startTs == null).map((it) => it));
			fillMissingStarts(items);
			const inWindow = (it) => it.endTs != null && it.endTs >= now
				&& (it.startTs == null ? true : it.startTs <= now || hadOpenStart.has(it));
			// 说明最后一个条件：起点原本为 null（写作"版本更新后"）的行，**一定已经开始**——
			// 源站表只列**已发布版本**的排期，"X.Y版本更新后"里的 X.Y 必已上线，
			// 所以它的真实起点在版本更新那天（≤ now），补出来的那个值不可信、不应用来判"未开始"。
			// 注意这里**不覆盖**补全后的 startTs：显示（bannerDates 等）仍用补出来的窗口，
			// 悬停也仍显示源站原文"4.6版本更新后 ~ …"，不编造日期。
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
		//   · `41-sources-shared.js` `HOVER_MAX_WINDOW_DAYS = 120` + `hoverIsLongTerm`（**逐字重复**）
		//   · `42-parsers-bestdori.js` `LONG_MS = 400 天` ← **值不同**（sekai 是 120）
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
		// `endTs == null` 表示"没有结束时间"（永久/常驻，或源站没给）——**不覆盖 now**（不以"没结束"当"永远在开"）。

		/** 覆盖 now（常用）：起可为 null（视为"已开始"，如源站写"X.Y版本更新后"），末必须有且未过。 */
		function coversNow(x, now) {
			return !!x && x.endTs != null && x.endTs >= now && (x.startTs == null || x.startTs <= now);
		}

		/** 覆盖 now（**两端都必须有**）：需要明确起止的场合（如按窗口合并/排序的源）。 */
		function coversNowBounded(x, now) {
			return !!x && x.startTs != null && x.endTs != null && x.startTs <= now && x.endTs >= now;
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

		// 活动列悬停（鸣潮式多行）：按传入顺序（调用方已 sortEventItems）每条一行；
		// 各行窗口完全相同 → 时间只在末尾写一遍；缺起止的行原样显示该行原文；跨年窗口两端带年份（②）。
		// 兜底：只有 0/1 条时返回 ""，由 UI 退回原有"活动名 + 时间"单条展示 ——
		// 公告类单条源（蔚蓝国服/日服、1999、异环等）因此完全不受影响，也不会出现空行或半截区间。
		// permanentCount：永久/常驻活动的条数（不参与排序，只在末尾补一行计数，避免"源站有、面板没有"）。
		function buildEventHover(items, permanentCount = 0) {
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
					return same ? x.name : `${x.name}   ${fmtWindow(x.startTs, x.endTs)}`;
				}
				const raw = String(x.raw || "").trim();
				return raw ? `${x.name}   ${raw}` : x.name;
			});
			if (same) lines.push(fmtWindow(list[0].startTs, list[0].endTs));
			if (permanentCount > 0) lines.push(permanentLine(permanentCount));
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
		function parseWuwaPool(html, now = nowMs(), tz) {
			const text = String(html || "");
			const marks = [...text.matchAll(/data-start="([^"]+)"\s+data-end="([^"]+)"/g)];
			// 页面拿到了却一个计时器都没有 → 汇总页改版（抛错让面板显示"卡池失败"），
			// 而不是伪装成"新卡池未公布"（这是本条目的备选/兜底源）
			if (marks.length === 0) throw new Error("wuwa-pool-no-timer");
			for (let i = 0; i < marks.length; i++) {
				const m = marks[i];
				const start = parseTime(m[1], tz);
				const end = parseTime(m[2], tz);
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

		// 鸣潮官方公告解析：从全量公告（game/activity/recommend）中取"覆盖当前时刻"的「角色活动唤取」。
		//
		// ⚠️ 时间**必须用 JSON 里的绝对时间戳** `startTimeMs` / `endTimeMs`，不要再去解析正文。
		// 正文写的是 `✦活动时间✦ 3.7版本更新后 ~ 2026年10月22日09:59（服务器时间）` ——
		// 起始端是**版本标签**而非绝对日期，旧实现用 `(\d{4})年(\d{1,2})月…` 匹配整段 → 恒失败 →
		// 卡池侧返回 null（2026-10-01 实测：官方 JSON 已带 3 个在开角色池，却显示"未公布"）。
		// 现在源站直接给了时间戳，比解析正文更准，也不受措辞漂移影响。
		function parseWuwaNotice(list, now = nowMs(), tz) {
			const groups = [list?.game, list?.activity, list?.recommend].filter(Array.isArray);
			const stripH = (s) => String(s || "")
				.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&hellip;/g, "…")
				.replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”")
				.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
			const pools = [];
			for (const arr of groups) {
				for (const it of arr) {
					// 标题可能是 "[但愿长圆如此夜]\n角色活动唤取" / "「玉阙玄华」武器活动唤取"
					const title = stripH(it.tabTitle || it.title || "").replace(/\s+/g, " ").trim();
					const isChar = /角色活动唤取/.test(title);
					const isWeapon = /武器活动唤取/.test(title);
					if (!isChar && !isWeapon) continue;
					const sTs = Number(it.startTimeMs), eTs = Number(it.endTimeMs);
					if (!Number.isFinite(sTs) || !Number.isFinite(eTs)) continue;
					if (sTs > now || eTs < now) continue; // 只要当期覆盖
					const name = title
						.replace(/\s*(?:角色|武器)活动唤取\s*$/, "")
						.replace(/^[\[【「]\s*/, "")
						.replace(/\s*[\]】」]$/, "")
						.trim();
					if (!name) continue;
					// 类型名（外显用）：标题尾部那一段，如 `角色活动唤取` / `武器活动唤取`
					const type = isChar ? "角色活动唤取" : "武器活动唤取";
					// 角色名：正文开头那句「活动期间，5星角色「心」，4星角色「卜灵」、「桃祈」、「釉瑚」唤取概率限时提升！」
					// 用 [^。！？\n]+ 限在一句内，避免把后面「唤取说明」里的角色也带进来
					const text = stripH(it.content || "");
					const upM = text.match(/活动期间，([^。！？\n]+?)唤取概率限时提升/);
					const roles = upM
						? [...new Set([...upM[1].matchAll(/[「【]([^」】]+)[」】]/g)].map((x) => x[1].trim()).filter(Boolean))].join("、")
						: "";
					pools.push({ name, type, isChar, roles, startTs: sTs, endTs: eTs });
				}
			}
			const cur = pools.filter((p) => p.isChar && p.name);
			if (cur.length === 0) return null;
			// 外显与窗口取**结束最早**的那个池（与 selectCurrent 的 first 同口径）。
			const first = cur.slice().sort((a, b) => a.endTs - b.endTs)[0];
			// 角色：**先拆成单个名字再去重**，然后合并。
			// ⚠️ 别写成 `new Set(cur.map(p => p.roles))` —— 那样比较的是"整串"（各池的 4★ 名单相同
			// 但 5★ 不同 → 整串不同 → 重复留下）。拆开才能把三池共有的 4★ 去成一份。
			// 顺序 = 各池依次展开（5★ 在前、4★ 共有名在后），去重后即 `心、千咲、尤诺、卜灵、桃祈、釉瑚`。
			const roles = [...new Set(cur.flatMap((p) => p.roles.split("、").map((s) => s.trim()).filter(Boolean)))].join("、");
			const fmt = (ts) => {
				const d = new Date(ts);
				return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			};
			const raw = fmtWindow(first.startTs, first.endTs, tz);
			// 悬停：首行=卡池类型（与卡片外显同源），随后每池"池名：角色"一行；窗口相同则时间只在末尾写一遍；
			// 按结束时间升序。**类型行只在本源补**，不动全站共用的 buildPoolHover（它按约定对 0/1 池返回 ""）。
			const poolHover = buildPoolHover(cur.map((p) => ({
				name: p.name,
				label: `${p.name}\uFF1A${p.roles || "-"}`,
				startTs: p.startTs,
				endTs: p.endTs
			})));
			const bannerHover = poolHover ? `${first.type}\n${poolHover}` : "";
			// **外显用卡池类型**（`角色活动唤取`），不用某一个池名：
			// 角色是多池合并的，若外显挂"但愿长圆如此夜"，卡片就成了"标题只说一个池、角色却是三个池的合成"。
			// 与用户 2026-09-30 定的统一口径一致（国服显示 `限时限定招募`、异环显示 `限定棋盘`）。
			// 具体池名在悬停里逐条列出，不丢信息。
			return { banner: first.type, roles, bannerDates: raw, bannerDatesRaw: raw, startTs: first.startTs, endTs: first.endTs, bannerHover };
		}

		// 鸣潮官方活动解析：同一份全量公告的 `recommend` 组里，`tag === 7` 是卡池、**`tag === 5` 是限时活动**。
		// 活动条目形如 tabTitle="[团团勇者大乱斗]休闲活动"，同样带绝对时间戳。
		// 这是 2026-10-01 起鸣潮活动的**默认源**——Bwiki 活动日历页已停更（最新一条结束于 2026/9/29），
		// 而官方源有当期 3.7 的活动，且**与卡池是同一条 URL**、同一次请求即可拿到两侧数据。
		function parseWuwaRecommendEvents(list, now = nowMs(), tz) {
			const arr = Array.isArray(list?.recommend) ? list.recommend : [];
			const stripH = (s) => String(s || "")
				.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
			const events = [];
			for (const it of arr) {
				if (Number(it.tag) !== 5) continue; // 7=卡池；5=限时活动
				const name = stripH(it.tabTitle || "").replace(/\s+/g, " ").trim();
				if (!name) continue;
				const sTs = Number(it.startTimeMs), eTs = Number(it.endTimeMs);
				if (!Number.isFinite(sTs) || !Number.isFinite(eTs)) continue;
				if (sTs > now || eTs < now) continue;
				events.push({ name, cat: "", startTs: sTs, endTs: eTs });
			}
			if (events.length === 0) return null;
			const sorted = sortEventItems(events);
			if (sorted.length === 0) return null;
			const primary = pickEventPrimary(sorted) || sorted[0];
			const dates = fmtWindow(primary.startTs, primary.endTs, tz);
			return { banner: primary.name, bannerDates: dates, bannerDatesRaw: dates, eventHover: buildEventHover(sorted) };
		}

		// 鸣潮卡池默认抓取器：官方公告（entrypoint → 目录 → zh-Hans.json 全量）优先；
		// 无当期公告 / 抓取失败 → 自动回退 Bwiki 角色轮换池（逻辑同 parseWuwaPool）
		async function fetchWuwaGacha(entryUrl, signal, tz, now = nowMs()) {
			try {
				const ref = "https://aki-gm-resources.aki-game.com/";
				const ej = await proxyFetchJson(entryUrl, ref);
				const contentUrl = Array.isArray(ej?.contentUrl) ? ej.contentUrl[0] : "";
				const dir = contentUrl ? contentUrl.replace(/[^/]*$/, "") : String(entryUrl).replace(/[^/]*$/, "");
				let list = null;
				try { list = await proxyFetchJson(dir + "zh-Hans.json", ref); } catch { list = null; }
				if (!list || typeof list !== "object") list = await proxyFetchJson(dir + "notice.json", ref);
				// **同一份 JSON 里卡池（tag=7）与活动（tag=5）都在** → 顺带把活动字段也返回。
				// 这是"统一来源注册表"里写明的复用契约：**两侧是同一条 URL** 且卡池载荷带 event 字段时，
				// refresh 不再为活动侧另抓一次（否则每轮会向同一条 URL 重复发一次请求）。
				// ⚠️ 我重写解析时一度只返回卡池字段，导致鸣潮每轮请求从 1 次变成 2 次 —— 已补回。
				// 活动侧仍保留自己的抓取器（fetchWuwaEventsOfficial）：卡池侧失败、或用户在设置里
				// 单独选活动来源时，活动侧要能自己抓、自己报错（解耦不变）。
				const ev = parseWuwaRecommendEvents(list, now, tz);
				const evFields = ev
					? { event: ev.banner, eventDates: ev.bannerDates || "", eventDatesRaw: ev.bannerDatesRaw || ev.bannerDates || "", eventHover: ev.eventHover || "" }
					: {};
				const d = parseWuwaNotice(list, now, tz);
				if (d) return { ...d, ...evFields };
			} catch { /* 官方失败 → Bwiki 备选 */ }
			const apiUrl = WUWA_BWIKI_URL + (WUWA_BWIKI_URL.includes("?") ? "&" : "?") + "origin=*";
			const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
			if (!res.ok) throw new Error("http-" + res.status);
			const json = await res.json();
			const html = json?.parse?.text;
			if (typeof html !== "string") throw new Error("bad-json");
			return parseWuwaPool(html, nowMs(), tz);
		}

		// 鸣潮活动默认抓取器：抓同一份官方公告，取 `recommend` 组里 tag=5 的限时活动。
		// 与卡池侧是**同一条 URL**（entrypoint.json），所以 refresh 的复用会让两侧共用一次请求。
		async function fetchWuwaEventsOfficial(entryUrl, _signal, tz) {
			const ref = "https://aki-gm-resources.aki-game.com/";
			const ej = await proxyFetchJson(entryUrl, ref);
			const contentUrl = Array.isArray(ej?.contentUrl) ? ej.contentUrl[0] : "";
			const dir = contentUrl ? contentUrl.replace(/[^/]*$/, "") : String(entryUrl).replace(/[^/]*$/, "");
			const list = await proxyFetchJson(dir + "zh-Hans.json", ref);
			if (!list || typeof list !== "object") throw new Error("wuwa-event-bad-json");
			const d = parseWuwaRecommendEvents(list, nowMs(), tz);
			if (!d) return null;
			return {
				event: d.banner,
				eventDates: d.bannerDates || "",
				eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "",
				eventHover: d.eventHover || ""
			};
		}

		// 绝区零官网公告解析：从公告频道（iChanId=279）取「X.Y版本限时频段（上/下期）」，选覆盖当前时刻的一期。
		// 公告形如：sIntro="本期代理人与音擎调频活动时间为：3.2版本更新后 ~ 2026/09/30 11:59"，
		// sContent 内含「活动期间，限定S级代理人[克拉蕾(电·锋御)]、[南宫羽(以太·击破)]…」。
		// 起点为"版本更新后"时，用同版本「更新公告」的 dtStartTime 补全；「独家重映/音擎回响」自选段跳过。
		function parseZzzFreq(payload, now = nowMs(), tz) {
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
					const p = parseTime(it.dtStartTime, tz);
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
				const created = parseTime(it.dtCreateTime, tz).ts ?? 0;
				for (let i = 0; i < marks.length; i++) {
					const seg = text.slice(marks[i].to, i + 1 < marks.length ? marks[i + 1].from : text.length);
					// 该时间窗对应的「限定S级代理人」句（排除独家重映/音擎回响的自选说明）
					const sentence = seg.split(/[。！；]/).find((s) => /限定S级代理人/.test(s) && !/重映|回响|可自选/.test(s));
					if (!sentence) continue;
					const roleM = sentence.match(/限定S级代理人\s*((?:[\[【][^\]】]+[\]】][、，,及和与\s]*)+)/);
					if (!roleM) continue;
					const roles = [...roleM[1].matchAll(/[\[【]([^\]】]+)[\]】]/g)].map((x) => normRole(x[1].trim())).join("、");
					if (!roles) continue;
					const sp = marks[i].after ? (verStart[ver] || { ts: null, text: null }) : parseTime(marks[i].start, tz);
					const ep = parseTime(marks[i].end, tz);
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
			const cover = pools.filter((p) => p.startTs != null && coversNow(p, now));
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
		async function fetchZzzGacha(listUrl, signal, tz, now = nowMs()) {
			try {
				const payload = await proxyFetchJson(listUrl, "https://zzz.mihoyo.com/");
				// **同一份 payload 里活动数据也在**（该接口同时含频段公告与「活动说明」公告）→ 顺带返回活动字段。
				// 这是"统一来源注册表"里写明的复用契约：卡池载荷带 event 字段时，refresh 不再为活动侧
				// 另抓一次。绝区零两侧是**同一条 URL**（同一 iChanId=279），所以此前每轮会向它发 2 次请求：
				// 一次 parseZzzFreq 取频段、一次 parseZzzEventsOfficial 取活动 —— 纯重复（2026-10-01 实测）。
				// 活动侧**仍保留**自己的抓取器（fetchZzzEventsOfficial 与 `zzz-event-bwiki` 备选）：
				// 卡池侧失败、或用户在设置里单独选活动来源时，活动侧要能自己抓、自己报错（解耦不变）。
				const ev = parseZzzEventsOfficial(payload, now, tz);
				const evFields = ev
					? { event: ev.event, eventDates: ev.eventDates || "", eventDatesRaw: ev.eventDatesRaw || "", eventHover: ev.eventHover || "" }
					: {};
				const d = parseZzzFreq(payload, now, tz);
				if (d) return { ...d, ...evFields };
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

		function parseZzzEventsOfficial(payload, now = nowMs(), tz) {
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
				const ts = parseTime(it.dtStartTime, tz).ts;
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
					const p = parseTime(startText, tz);
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
					const p = parseTime(endText, tz);
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
			const dates = primary.startTs != null && primary.endTs != null ? fmtWindow(primary.startTs, primary.endTs, tz) : (primary.raw || "");
			return {
				event: primary.name,
				eventDates: dates,
				eventDatesRaw: primary.raw || "",
				// 只有 1 条时 buildEventHover 返回 ""，由 UI 退回单条展示（与其它源一致）
				eventHover: buildEventHover(active)
			};
		}

		async function fetchZzzEventsOfficial(listUrl, signal, tz) {
			const payload = await proxyFetchJson(listUrl, "https://zzz.mihoyo.com/");
			return parseZzzEventsOfficial(payload, nowMs(), tz);
		}

		// 鸣潮：活动日历页 → font-size:17px 标题 + font-size:11px 时间，选当期
		// 注意：复用 selectCurrent 需要 isMain 字段（该函数按 isMain 过滤主池）
		function parseWuwaCalendar(html, tz) {
			const items = [];
			const re = /font-size:17px[^>]*>\s*<p>\s*([\s\S]*?)\s*<\/p>([\s\S]*?)(?=font-size:17px|$)/g;
			let m;
			while ((m = re.exec(html)) !== null) {
				const name = stripTags(m[1]);
				if (!name) continue;
				const timeM = m[2].match(/font-size:11px[^>]*>\s*<p>\s*([\s\S]*?)\s*<\/p>/);
				const timeText = timeM ? stripTags(timeM[1]) : "";
				if (!/20\d{2}\//.test(timeText)) continue;
				const range = parseRange(timeText, tz);
				items.push({ banner: name, name, ...range, isMain: true });
			}
			const now = nowMs();
			const active = sortEventItems(items
				.filter((it) => coversNow(it, now))
				.map((it) => ({ name: it.name || it.banner, startTs: it.startTs, endTs: it.endTs, raw: it.rawOriginal || it.raw })));
			if (active.length === 0) return null;
			// 外显：类别优先（战斗/高难类优先），同级内结束时间升序（③）；悬停仍按 endTs 升序全量
			const primary = pickEventPrimary(active) || active[0];
			const dates = primary.startTs != null && primary.endTs != null ? fmtWindow(primary.startTs, primary.endTs, tz) : (primary.raw || "");
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
		//
		// `tz`（可选）= 源站墙钟时区：
		//  · 传了 → 墙钟按该时区换算成绝对时刻，输出文本也按该时区渲染（海外用户也正确）；
		//  · 没传 → **保持改造前行为逐字节不变**（字符串自带 `+08:00` 定绝对时刻，
		//    文本按本机时区取字段）。为什么不统一成"没传也按 +08 渲染"：
		//    那会改变既有输出（实测让 `_batch6` C4 的文本从 `10-01 00:11` 偏成 `00:12`），
		//    而调用方没声明时区时，我们**没有依据**断定它一定是 +08。
		function parseGachaTracker(html, tz) {
			const shift = (d) => (typeof sourceInstant === "function" ? sourceInstant(d.y, d.mo, d.d, 0, 0, tz) : new Date(d.y, d.mo - 1, d.d, 0, 0).getTime());
			const shiftEnd = (d) => (typeof sourceInstant === "function" ? sourceInstant(d.y, d.mo, d.d, 23, 59, tz) : new Date(d.y, d.mo - 1, d.d, 23, 59).getTime());
			const parse = (s) => { const m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null; };
			const rows = [...html.matchAll(/<tr id="([^"]+)">([\s\S]*?)<\/tr>/g)];
			const items = [];
			for (const rm of rows) {
				const body = rm[2];
				if (!body.includes("date-cell")) continue;
				const nameM = body.match(/banner-name-cell">[\s\S]*?<a[^>]*>([^<]+)<\/a>/);
				const dateM = [...body.matchAll(/date-cell">([\d-]+)<\/td>/g)];
				const charM = [...body.matchAll(/\/games\/endfield\/characters\/[^"]+" title="([^"]+)"/g)];
				if (!nameM || dateM.length < 2) continue;
				const sd = parse(dateM[0][1]);
				const ed = parse(dateM[1][1]);
				if (!sd || !ed) continue;
				items.push({
					banner: stripTags(nameM[1]),
					roles: [...new Set(charM.map((m) => m[1]))].join("、"),
					// 传了 tz → 按源站墙钟换算；没传 → 沿用字符串自带 +08:00（改造前行为）
					startTs: tz ? shift(sd) : new Date(dateM[0][1] + "T00:00:00+08:00").getTime(),
					endTs: tz ? shiftEnd(ed) : new Date(dateM[1][1] + "T23:59:59+08:00").getTime(),
					// 文本用**源站墙钟原文**（不经过 Date 再解释）—— 这样不传 tz 时也与改造前一致
					startText: dateM[0][1],
					endText: dateM[1][1]
				});
			}
			const now = nowMs();
			const cur = items.find((it) => coversNow(it, now)) || null;
			if (!cur) return null;
			// 输出文本：直接用源站墙钟原文（`YYYY-MM-DD` → `MM-DD`），不随本机时区变
			const fmtDate = (s) => {
				const m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
				return m ? `${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : String(s);
			};
			return {
				banner: cur.banner,
				roles: cur.roles,
				bannerDates: `${fmtDate(cur.startText)} 00:00 ~ ${fmtDate(cur.endText)} 23:59`
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
		function currentFromCanmoe(js, now, tz) {
			now = now || nowMs();
			let sawStructure = false;
			const fmt = (iso) => {
				// 按**源站时区**（`tz`）渲染，而不是本机时区：否则海外用户会看到
				// 与 `startTs/endTs`（已按源站时区换算）不一致的钟点。
				const w = sourceWallParts(new Date(iso).getTime(), tz);
				return `${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")} ${String(w.h).padStart(2, "0")}:${String(w.mi).padStart(2, "0")}`;
			};
			// **统一规则（§49）**：当前时刻落在持续期间内的卡池**全部合并**外显。
			// 旧实现是"两个分支各自命中第一个就 return" → 只显示一个池，同期的另一个池看不到
			// （用户实测：终末地外显没合并）。现在先把两类候选都收集起来再合并。
			//
			// ⚠️ 这条路径**不走 `selectCurrent`**（canmoe 的 chunk 是压缩 JS，得单独解析），
			// 所以 §49 改 `selectCurrent` 时漏了这里 —— 教训：改"通用规则"要**枚举所有外显路径**，
			// 不能只改名字最像的那个函数。
			const active = [];
			// 1) 当期 d：windows 覆盖当前 → 收进来
			const curM = js.match(/\bd=\{(.+?)\},\s*u=\[/);
			if (curM) {
				sawStructure = true;
				const inner = curM[1];
				const featuredM = inner.match(/([^:{}]+):\{windows:/);
				const roles = featuredM ? featuredM[1].trim() : "";
				for (const w of inner.matchAll(/windows\s*:\s*\[\s*\{\s*start\s*:\s*"([^"]+)"\s*,\s*end\s*:\s*"([^"]+)"\s*,\s*version\s*:\s*"([^"]+)"\s*,\s*period\s*:\s*(\d+)\s*,\s*isRerun\s*:\s*(!0|!1|true|false)\s*\}\s*\]/g)) {
					const a = new Date(w[1]).getTime(), b = new Date(w[2]).getTime();
					if (a <= now && now <= b) {
						active.push({ banner: `\u3010${w[3]}\u3011${roles}`, roles, startTs: a, endTs: b, dates: `${fmt(w[1])} ~ ${fmt(w[2])}`, raw: `${fmt(w[1])} ~ ${fmt(w[2])}` });
					}
				}
			}
			// 2) p 数组中的"当前进行中"条目（过期当期后以此为兜底）—— 同样**全部收**，不是取第一个
			const arr = extractCanmoePeriods(js);
			if (arr) {
				sawStructure = true;
				for (const e of arr) {
					const ps = (e.match(/periodStart\s*:\s*"([^"]*)"/) || [])[1];
					const pe = (e.match(/periodEnd\s*:\s*"([^"]*)"/) || [])[1];
					if (!ps || !pe) continue;
					const a = new Date(ps).getTime(), b = new Date(pe).getTime();
					if (!(a <= now && now <= b)) continue;
					const title = (e.match(/title\s*:\s*"([^"]*)"/) || [])[1] || "";
					const subtitle = (e.match(/subtitle\s*:\s*"([^"]*)"/) || [])[1] || "";
					const version = (e.match(/version\s*:\s*"([^"]*)"/) || [])[1] || "";
					active.push({
						banner: title || `\u3010${version}\u3011${subtitle}`,
						roles: subtitle || title,
						startTs: a, endTs: b,
						dates: `${fmt(ps)} ~ ${fmt(pe)}`, raw: `${fmt(ps)} ~ ${fmt(pe)}`
					});
				}
			}
			if (active.length > 0) {
				// 外显名与窗口取**结束最早**的那个池（越快结束越该被盯住；与 selectCurrent 的 first 同口径）
				const first = active.slice().sort((x, y) => x.endTs - y.endTs)[0];
				return {
					banner: first.banner,
					roles: [...new Set(active.map((p) => p.roles).filter(Boolean))].join("、"),
					bannerDates: first.dates,
					bannerDatesRaw: first.raw
				};
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

		// 终末地当期选择：走统一的"当期选择"逻辑（now 可注入）。
		// 这是**给通用解析（自定义条目/自定义地址）用的宽松包装**：把 undefined 归一成 null，
		// 即"读不出来 → 未公布"，不在这里抛错（用户自定义地址读不出内容是常态，不该报成源站故障）。
		//
		// ⚠️ 2026-10-03：原来还有一个 `parseCanmoeLoose`（同样实现）作为"旧写法"别名，
		//    经全仓引用分析确认**生产与测试都没用**，已删 —— 留两个同名同实现的包装只会让人猜该用哪个。
		function parseCanmoe(js, now = nowMs(), tz) { const d = currentFromCanmoe(js, now, tz); return d === void 0 ? null : d; }
		// 终末地（canmoe 经 host 代理）：页面 HTML → 定位 BannerCalendar chunk → 抓 chunk JS → 窗口匹配当期
		// canmoe 无 CORS 头，两步都经 host 代理（referer 用页面 origin 满足反爬）
		// 数据在某一组件的 chunk 里（含当期 d={...} 与历史期次数组），currentFromCanmoe(js, now) 做窗口匹配
		//
		// 三态（这是本条目的**默认来源**，必须把"源站改版"和"没公布"分开，否则会重演长期静默失灵）：
		//   · 有覆盖当前时刻的期次 → 返回数据；
		//   · 拿到 JS 且里面有卡池结构、但没有覆盖当前的期次 → return null（未公布）；
		//   · 页面/所有 chunk 里都找不到卡池结构（或 chunk 全抓失败）→ **抛错**（面板显示"卡池失败"）。
		async function fetchCanmoeEndfield(pageUrl, _signal, tz, now = nowMs()) {
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
				const d = currentFromCanmoe(js, now, tz);
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
		async function fetchLdshopNte(pageUrl, _signal, tz) {
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
		async function fetchNteWanmei(listUrl, signal, tz) {
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
					const data = parseNteWanmei(await proxyFetchText("https://yh.wanmei.com" + m[1], ref), tz);
					if (data) return data;
				}
				for (const u of nteNextPageUrls(listUrl, html, seen)) if (!queue.includes(u)) queue.push(u);
			}
			if (!sawAnyLink) throw new Error("nte-list-shape-changed");
			return null;
		}

		// 异环公告里的「棋盘」条目解析（角色卡池）。
		//
		// 为什么从**「棋盘」**入手（用户建议，2026-09-30）：
		//   异环的角色卡池在公告里叫「X」**限定棋盘**，条目形如
		//     ● 全新限定S级角色「黑羽」
		//     开放时间：9月24日版本更新后-10月15日05:59
		//     棋盘说明：可通过「预言终幕时」限定棋盘获得S级角色「黑羽」。…
		//   `棋盘说明` 是**角色卡池独有的锚点** —— 弧盘走 `研募说明`、剧情段没有这个字段。
		//   用「有棋盘说明」筛，比用"全新限定S级角色"精确：后者漏掉**返场**（`限定S级角色「安魂曲」返场`，
		//   没有"全新"二字），而那也是一张在开的角色池。
		//
		// 旧实现只认 `全新限定S级角色「X」…开放时间：N月N日**维护**更新后-…` 一条正则，
		// 而现公告写的是 `**版本**更新后` → 一条都匹配不上 → 卡池为空 → `if (!data.banner) return null`
		// → `fetchNteWanmei` 继续往下试，最终拿 index1 页那篇**已过期**的旧公告冒充当期。
		function parseNteBoards(text, nowYear) {
			const lines = text.split("\n").map((l) => l.trim());
			// 「一、 全新角色&弧盘」这一段的边界（只在这里找，避免匹配到别处的"开放时间"）
			const start = lines.findIndex((l) => /^一、/.test(l));
			if (start < 0) return [];
			let end = lines.findIndex((l, i) => i > start && /^二、/.test(l));
			if (end < 0) end = lines.length;
			const pools = [];
			for (let i = start; i < end; i++) {
				const m = lines[i].match(/^●\s*(?:全新)?(限定S级角色|S级角色)「([^」]+)」(返场)?/);
				if (!m) continue;
				// 往后找该条目的「开放时间」与「棋盘说明」（各限 8 行内）
				let range = null, board = "";
				for (let j = i + 1; j < Math.min(end, i + 8); j++) {
					if (!range) {
						const t = lines[j].match(/^开放时间：(\d+)月(\d+)日(?:(?:维护|版本)更新后|(\d{1,2}):(\d{2}))\s*[-–—]\s*(\d+)月(\d+)日(\d{1,2}):(\d{2})/);
						if (t) {
							range = {
								sMo: +t[1], sD: +t[2], sH: t[3] ? +t[3] : 11, sMi: t[4] ? +t[4] : 0,
								eMo: +t[5], eD: +t[6], eH: +t[7], eMi: +t[8]
							};
						}
					}
					if (!board) {
						const b = lines[j].match(/棋盘说明：可通过「([^」]+)」限定棋盘获得/);
						if (b) board = b[1];
					}
				}
				// **有棋盘说明才是角色卡池**（弧盘那条走研募说明，会在这里被排除）
				if (!range || !board) continue;
				pools.push({
					name: board,
					// 类型：`全新限定S级角色` → 限定棋盘；`限定S级角色…返场` → 返场限定棋盘。
					// 注意 `限定` 属于**类型的一部分**，不是动词/修饰（与国服"更新限时限定招募"同理）。
					type: `${m[3] ? "返场" : ""}限定棋盘`,
					roles: baRoleName(m[2]),
					startTs: new Date(nowYear, range.sMo - 1, range.sD, range.sH, range.sMi).getTime(),
					endTs: new Date(nowYear, range.eMo - 1, range.eD, range.eH, range.eMi).getTime()
				});
			}
			return pools;
		}

		// 解析官网公告正文 → 当期卡池（有「棋盘说明」的角色卡池，按**统一规则**合并）+ 当期活动（限时活动）
		function parseNteWanmei(html, tz) {
			const text = String(html || "")
				.replace(/<script[\s\S]*?<\/script>/gi, " ")
				.replace(/<style[\s\S]*?<\/style>/gi, " ")
				.replace(/<[^>]+>/g, "\n")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/\n\s*\n+/g, "\n").trim();
			const fmt = (mo, d, h, mi) => `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
			const data = { banner: "", roles: "", bannerDates: "", bannerDatesRaw: "", event: "", eventDates: "", eventDatesRaw: "" };
			// 当期卡池：**按统一规则**——当前时刻落在开放期间内的「棋盘」全部合并外显。
			// 卡片/悬停都走 banner + roles（与其它游戏一致）：类型进 `banner`，
			// 悬停由面板兜底显示 `类型：角色` + 日期。**不构造 bannerHover**（同国服，见 §48.3d）。
			const now = nowMs();
			const nowYear = new Date(now).getFullYear();
			const active = parseNteBoards(text, nowYear)
				.filter((p) => p.endTs >= now && p.startTs <= now)
				.sort((a, b) => a.endTs - b.endTs);
			if (active.length > 0) {
				data.banner = [...new Set(active.map((p) => p.type))].join(" & ");
				data.roles = [...new Set(active.map((p) => p.roles).filter(Boolean))].join("、");
				// 窗口取结束最早的那个（与 selectCurrent 的 `first` 同口径）
				const first = active[0];
				data.bannerDates = `${fmt(new Date(first.startTs).getMonth() + 1, new Date(first.startTs).getDate(), new Date(first.startTs).getHours(), new Date(first.startTs).getMinutes())} ~ ${fmt(new Date(first.endTs).getMonth() + 1, new Date(first.endTs).getDate(), new Date(first.endTs).getHours(), new Date(first.endTs).getMinutes())}`;
				data.bannerDatesRaw = data.bannerDates;
			}
			// 当期活动：「X」限时活动 活动时间：M月D日(维护|版本)更新后|hh:mm-M月D日hh:mm
			const ev = text.match(/「([^」]+)」限时活动[\s\S]{0,200}?活动时间：(\d+)月(\d+)日(?:(?:维护|版本)更新后|(\d{1,2}):(\d{2}))\s*[-–—]\s*(\d+)月(\d+)日(\d{1,2}):(\d{2})/);
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
		//
		// 同一轮里按 URL 缓存：两侧同址时（自定义条目最常见：用户把同一个页面同时填给
		// 卡池与活动），需要在**不重复发请求**的前提下拿到同一份文本 —— 见 50-refresh.js
		// 的「两侧同一条 URL、活动侧无注册抓取器」分支。缓存按轮清空（refreshAll 开始时重置），
		// 避免跨轮拿到过期数据。
		let htmlTextCache = null;
		function resetHtmlTextCache() { htmlTextCache = new Map(); }
		// **只读**查询：命中才返回，绝不发起请求。
		// 用途见 50-refresh.js：两侧同址且活动侧没有注册抓取器时，**只有在卡池那次
		// 已经通过本函数取过同一 URL 的情况下**才复用；否则宁可记"未公布"，
		// 也**绝不**去打那次注定被 CORS 拦的直连（这条语义有测试守护，别改成会发请求）。
		function peekHtmlText(url) {
			return (htmlTextCache && htmlTextCache.get(url)) || null;
		}
		async function fetchHtmlText(url, signal) {
			if (htmlTextCache && htmlTextCache.has(url)) return htmlTextCache.get(url);
			const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
			const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
			if (!res.ok) throw new Error("http-" + res.status);
			let out;
			if (/action\s*=\s*parse/i.test(url)) {
				const json = await res.json();
				const text = json?.parse?.text;
				if (typeof text !== "string") throw new Error("bad-json");
				out = text;
			} else {
				out = await res.text();
			}
			if (htmlTextCache) htmlTextCache.set(url, out);
			return out;
		}

		// 通用卡池解析（新增自定义条目的"卡池来源"地址用）：
		// 依次尝试 bwiki 式「时间+版本」表、方舟式「限时寻访」表、GachaTracker 式日期表、
		// Next.js SPA（canmoe 等，页面无表格、数据在组件 chunk 里），选当期；
		// 最后再退到**普通 HTML 表**（见下方 collectGenericGacha）；
		// 全部失败返回 null（调用方按解析失败处理，不做可达性健康检查）
		async function tryParseGenericGacha(url, signal, tz) {
			const html = await fetchHtmlText(url, signal);
			const now = nowMs();
			const cur = selectCurrent(parseAllBwiki(html, tz), now) || selectCurrent(parseArknights(html, tz), now);
			if (cur && cur.banner && cur.bannerDates) return cur;
			const gt = parseGachaTracker(html, tz);
			if (gt && gt.banner && gt.bannerDates) return gt;
			// Next.js SPA：HTML 无表格数据，定位组件 chunk 后抓 chunk JS 解析。
			// chunk 与页面同源：页面能直连（CORS 允许）时 chunk 直连，否则经 host 代理。
			const chunks = nextJsChunkUrls(html, "BannerCalendar", url);
			for (const c of chunks) {
				try {
					const js = await fetchHtmlText(c, signal);
					// 每个 chunk 只解析一次：解析里最重的是 chunk 的括号平衡扫描，
					// 而"没命中当期"恰恰是最常见的情况 → 不要为了`a || b`那种写法白跑两遍
					const d = parseCanmoe(js, now, tz);
					if (d && d.banner && d.bannerDates) return d;
				} catch { /* 下一个 chunk */ }
			}
			// 末位兜底：**普通 HTML 表**（时间 + 名称两列，或含「类型」列）。
			// 为什么需要（2026-10-01 用户点名）：上面三条都是各自的**私有格式**
			// （bwiki 卡池列 / PRTS 卡池一览 / GachaTracker），而用户给自定义条目
			// 填一个普通 wiki 页面时，**活动列能出、卡池列恒空** —— 同一张表明显有内容。
			// 这一兜底复用与活动侧同一套"时间+名称"列识别，保证自定义条目两侧口径一致。
			const generic = selectCurrent(collectGenericGacha(html, tz), now);
			if (generic && generic.banner && generic.bannerDates) return generic;
			return null;
		}

		// 通用活动解析：扫描含「时间」（或「活动时间」）表头的表格，行内找时间与名称列，选当期
		// 起始为"版本更新后"等无日期文本时保留 startTs=null，由 selectCurrent 的 fillMissingStarts 补全
		function collectGenericEvents(html, tz) {
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
					const range = parseRange(time, tz);
					// 起始可为 null（"版本更新后"），结束时间必须有效——**除非这行是永久活动**。
					// 原来这里一律 `endTs == null → continue`，把「…~永久」的行在采集阶段就丢了，
					// 下游连"它存在过"都看不到（表现为源站表里有、面板悬停里没有）。
					// 永久活动（结束写作「永久」）保留下来，由 genericEventPayload 单独计数；
					// 其它无结束时间的行仍按旧规则丢弃（起止都拿不到，画不出来）。
					const cat0 = catIdx >= 0 ? (tds[catIdx] || "") : "";
					const isPermanent = range.endTs == null && (/永久/.test(cat0) || /永久\s*$/.test(String(range.raw || time)));
					if (range.endTs == null && !isPermanent) continue;
					items.push({ banner: name, cat: cat0, ...range, isMain: true });
				}
			}
			return items;
		}

		// 当期活动（外显取 selectCurrent 的那条，行为同旧版）
				// 通用**卡池**采集（末位兜底，2026-10-01 加）：
		// 与 collectGenericEvents 同一套「时间 + 名称」列识别，但用于**卡池列**。
		//
		// 为什么需要：tryParseGenericGacha 前三条路径（parseAllBwiki / parseArknights /
		// parseGachaTracker）认的都是各自源站的**私有结构**；用户给自定义条目填一个普通
		// wiki 页面时，活动列（走 collectGenericEvents）能出内容，**卡池列却恒空**。
		// 这一条让"同一张表、两侧都能读"，与活动侧口径一致。
		//
		// 与活动侧的唯一差别：**不丢"永久"行**（卡池没有"永久"语义，但也不该在采集阶段
		// 就无声消失），并保留 roles 空串（普通表里没有角色列的结构约定）。
		function collectGenericGacha(html, tz) {
			const items = [];
			const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)];
			for (const t of tables) {
				const body = t[1];
				if (!/<th[^>]*>[^<]*时间[^<]*<\/th>/i.test(body)) continue;
				const heads = [...body.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => stripTags(m[1]).trim());
				const catIdx = heads.findIndex((h) => /类型|類型/.test(h));
				for (const rm of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
					const row = rm[1];
					if (!/<td/i.test(row)) continue;
					const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]).trim());
					if (tds.length < 2) continue;
					let name = "", time = "";
					for (const td of tds) {
						if (!time && /20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}|[~～]/.test(td)) time = td;
						else if (td && !name) name = td;
					}
					if (!time || !name) continue;
					name = name.replace(/^文件:[^\s]*?\.(?:png|jpe?g|gif|webp|svg)\s*/i, "").trim();
					if (!name) continue;
					const range = parseRange(time, tz);
					// 起止都拿不到的行画不出来（活动侧对"永久"有特例，卡池没有该语义）
					if (range.startTs == null && range.endTs == null) continue;
					const cat0 = catIdx >= 0 ? (tds[catIdx] || "") : "";
					items.push({ banner: name, roles: "", cat: cat0, ...range, isMain: true });
				}
			}
			return items;
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
			return { ...cur, bannerHover: buildPoolHover(pools) };
		}

		// 活动列载荷：外显=排序第一条（最快结束的当期活动，③）；eventHover=全部覆盖当前时刻的活动（同序）。
		// 注意 selectCurrent 会就地补全缺失起点（fillMissingStarts），故这里只取快照自行排序，
		// 避免"版本更新后 ~ 未来"这类起点未给的行被补成未来起点而漏掉。
		// 只有 1 条时 buildEventHover 返回 ""，由 UI 退回单条展示（兜底）。
		function genericEventPayload(html, tz) {
			const items = collectGenericEvents(html, tz);
			// 页面拿到了却连一行候选都没有 → 活动表结构变了（抛错 = "活动失败"）；
			// 有候选但当期没有覆盖现在的 → 下面返回 null（未公布）
			if (items.length === 0) throw new Error("bwiki-event-no-table");
			const snapshot = items.map((it) => ({ name: it.banner, cat: it.cat || "", startTs: it.startTs, endTs: it.endTs, raw: it.rawOriginal || it.raw }));
			const now = nowMs();
			// 永久/常驻活动单独计一项：它们 endTs 为 null，本就不该混进"当期"排序，
			// 但也不能像以前那样无声丢掉（见 isPermanentEvent 注释）。
			const permanent = snapshot.filter((it) => isPermanentEvent(it));
			const active = sortEventItems(snapshot.filter((it) => coversNow(it, now)));
			if (active.length === 0) return null;
			// 外显：类别优先（剧情/叙事、限时高难），同级内结束时间升序；悬停仍按 endTs 升序全量
			const primary = pickEventPrimary(active) || active[0];
			return {
				event: primary.name,
				eventDates: primary.startTs != null && primary.endTs != null ? fmtWindow(primary.startTs, primary.endTs, tz) : (primary.raw || ""),
				eventDatesRaw: primary.raw || "",
				eventHover: buildEventHover(active, permanent.length)
			};
		}

		// 明日方舟（PRTS 活动一览）：表格含「活动开始时间」列 + 隐藏 data-time="开始秒,结束秒"（Unix 秒）。
		// 开始时间用第一列文本（"2026-08-22 04:00"），结束时间用 data-time 第二个值（UTC 秒 → +08）。
		// 注意 data-time 第一个值是页面缓存时刻（非开始时间），故开始以文本列为准。
		// 活动名带核心分类前缀（"支线故事：墟·复刻"）：分类取第三列 <a title="分类:XXX"> 链接，
		// 核心分类 = 排除"复刻活动"（修饰词）后的第一个。
		function collectPrtsEvents(html, tz) {
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
					const st = parseTime(stripTags(tds[0]).trim(), tz);
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
				// 活动列载荷：外显=排序第一条（最快结束的当期活动，③）；eventHover=全部覆盖当前时刻的活动（同序）
		function prtsEventPayload(html, tz) {
			const items = collectPrtsEvents(html, tz);
			const snapshot = items.map((it) => ({ name: it.banner, cat: it.cat || "", startTs: it.startTs, endTs: it.endTs, raw: it.raw }));
			const now = nowMs();
			const active = sortEventItems(snapshot.filter((it) => coversNow(it, now)));
			if (active.length === 0) return null;
			// 外显：类别优先（支线故事/危机合约等 vs 登录活动），同级内结束时间升序
			const primary = pickEventPrimary(active) || active[0];
			return {
				event: primary.name,
				eventDates: primary.startTs != null && primary.endTs != null ? fmtWindow(primary.startTs, primary.endTs, tz) : (primary.raw || ""),
				eventDatesRaw: primary.raw || "",
				eventHover: buildEventHover(active)
			};
		}
		// 起止时间戳 → 统一文本 `MM-DD HH:MM ~ MM-DD HH:MM`
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
		function parseGame8Events(html, tz) {
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
				.filter((it) => coversNow(it, now))
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
		function parseGame8EventsLoose(html, tz) {
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
			const cur = items.filter((it) => coversNow(it, now)).sort((x, y) => y.endTs - x.endTs)[0];
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
		async function fetchGame8Endfield(pageUrl, _signal, tz) {
			const html = await proxyFetchText(pageUrl, "https://game8.co/");
			return parseGame8Events(html, tz) || parseGame8EventsLoose(html, tz);
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
		function parseFzWikiActivities(html, now, tz) {
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
			// 时间格式 "2026/9/2 7:00:00"（fz.wiki 的**服务器墙钟**，+08）。
			// 不能直接丢给 `new Date(str)`：那个格式不是 ISO，会被当**本机时区**解释 →
			// 海外用户拿到偏移的时刻。这里显式拆出字段，按**源站时区**（`tz`）构造。
			const parseT = (s) => {
				const m = String(s).match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
				if (m) return sourceInstant(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), tz);
				return new Date(String(s).replace(/\//g, "-")).getTime();
			};
			const t0 = now || nowMs();
			// 覆盖当前时刻的活动统一排序（③ 结束时间升序）供悬停；外显另按类别优先挑选
			const activeActs = sortEventItems(acts
				.filter((a) => parseT(a.open) <= t0 && parseT(a.close) >= t0)
				.map((a) => ({ name: a.name, tags: (a.tags || []).join("/"), startTs: parseT(a.open), endTs: parseT(a.close) })));
			// 解析到活动、但当期没有覆盖当前时刻的 → 返回 null（这一侧记 nomatch = "新活动未公布"）
			if (activeActs.length === 0) return null;
			const primary = pickEventPrimary(activeActs) || activeActs[0]; // 叙事活动/挑战活动优先于签到类
			const win = fmtWindow(primary.startTs, primary.endTs, tz);
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
		async function fetchFzWikiEndfield(pageUrl, _signal, tz, now = nowMs()) {
			const html = await proxyFetchText(pageUrl, "https://fz.wiki/");
			return parseFzWikiActivities(html, now, tz);
		}

		// 通用活动源解析（自定义条目/自定义活动来源地址用）：抓取页面 → collectGenericEvents → {event, eventDates}
		// ⚠️ 2026-10-03：原来这里还有个 `parseGenericEvents(html, tz)`（collectGenericEvents + selectCurrent 的组合），
		//    经全仓引用分析确认**生产与测试都没用**（活路径走的是下面的 `genericEventPayloadFromHtml`，
		//    它多一层"表里一行都没有 → null"的错误语义处理），已删。
		async function tryParseGenericEvent(url, signal, tz) {
			const html = await fetchHtmlText(url, signal);
			return genericEventPayloadFromHtml(html, tz);
		}

		// 已拿到 HTML 时的活动载荷（**不抛错**版本）：
		// 供「两侧同一条 URL、且活动侧没有注册抓取器」（自定义条目）复用卡池那次已经取到的
		// HTML —— 省掉第二次请求，同时保证活动侧也能被通用解析命中。
		// 与 genericEventPayload 的差别：表里一行都没有时返回 null（交给调用方按 nomatch 处理），
		// 而不是抛 "bwiki-event-no-table"（那条错误语义是给"内置源站改版"用的）。
		function genericEventPayloadFromHtml(html, tz) {
			let items;
			try { items = collectGenericEvents(html, tz); } catch { return null; }
			if (items.length === 0) return null;
			const cur = selectCurrent(items, nowMs());
			if (!cur || !cur.banner) return null;
			return {
				event: cur.banner,
				eventDates: cur.bannerDates || "",
				eventDatesRaw: cur.bannerDatesRaw || cur.bannerDates || ""
			};
		}

		// 原神（bwiki SMW 语义查询）：活动一览页数据在 JS 动态加载（Dquery + SMW），
		// 改用 api.php?action=ask 直接查询「分类:活动」的开始/结束时间，选当期。
		// 属性：名称/开始时间/结束时间/所属版本；结束时间 9999/01/01 为永久活动占位（跳过）。
		// 查询 URL 由 fetchYsActivity 构造，浏览器直连（api.php 带 origin=* 有 CORS）。
		function parseSmwActivity(json, tz) {
			const results = json?.query?.results || {};
			const now = nowMs();
			const covering = [];
			// SMW timestamp 是 UTC 秒，raw 形如 "1/2026/8/28/10/0/0/0"（**服务器本地时间 +08**）。
			// 用 raw 的值直接构造，但必须按**源站时区**（`tz`）解释 —— 否则海外用户
			// 得到的绝对时刻会整体偏移（"是否在开/倒计时"随之出错）。
			const parseRaw = (v) => {
				if (!v) return null;
				if (v.raw != null) {
					const p = String(v.raw).split("/");
					if (p.length >= 8) {
						const y = Number(p[1]), mo = Number(p[2]), d = Number(p[3]), h = Number(p[4]), mi = Number(p[5]);
						if (y && mo && d) return sourceInstant(y, mo, d, h || 0, mi || 0, tz);
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
			const win = fmtWindow(best.startTs, best.endTs, tz);
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
		async function fetchYsActivity(signal, tz) {
			const nowYear = new Date(nowMs()).getFullYear();   // 走注入时钟（core 不得直接读宿主时钟）
			const q = "[[\u5206\u7C7B:\u6D3B\u52A8]][[\u7ED3\u675F\u65F6\u95F4::>" + nowYear + "/01/01]]|?\u540D\u79F0|?\u5F00\u59CB\u65F6\u95F4|?\u7ED3\u675F\u65F6\u95F4|?\u7C7B\u578B|sort=\u5F00\u59CB\u65F6\u95F4|order=desc|limit=60";
			const apiUrl = "https://wiki.biligame.com/ys/api.php?action=ask&query=" + encodeURIComponent(q) + "&format=json&origin=*";
			const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
			if (!res.ok) throw new Error("http-" + res.status);
			const json = await res.json();
			const d = parseSmwActivity(json, tz);
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
		// 抓取器签名：async (url, signal, tz) → 数据对象 | null
		//   第三个参数 `tz` = 源站墙钟时区（可选，见 15-env.js）。工厂把它透传给解析函数，
		//   解析函数再交给 parseTime/parseRange —— 这样"源站时区"只需在来源声明里写一次。
		function mkMediaWiki(parse) {
			return async (url, signal, tz) => {
				const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
				const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
				if (!res.ok) throw new Error("http-" + res.status);
				const json = await res.json();
				const text = json?.parse?.text;
				if (typeof text !== "string") throw new Error("bad-json");
				return parse(text, tz);
			};
		}
		function mkRaw(parse) {
			return async (url, signal, tz) => {
				const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
				const res = await transportFetchRaw(apiUrl, { signal, headers: rawHeaders(apiUrl) });
				if (!res.ok) throw new Error("http-" + res.status);
				return parse(await res.text(), tz);
			};
		}
		// bwiki 通用"选当期"包装（原神/星铁/绝区零/方舟）
		const pickCurrent = (parse) => (html) => selectCurrent(parse(html), nowMs());
		//#endregion

		// ═══════════════════════════════════════════════════════════════════════════
		// ⚠️ 2026-10-03 合并：以下内容原为独立文件 `src/client/41-sources-shared.js`，
		//    现按用户要求内联到本体（它本就是「本体已有的 pad2/decodeEntities/textOf + 新增来源共用工具」，
		//    分成两个文件只让人来回跳）。符号名与实现**一律未改**。
		//    原文件头保留在下面，信息不丢。
		// ═══════════════════════════════════════════════════════════════════════════

// src/client/41-sources-shared.js —— 新增来源解析器共用的：抓取桥接 + 悬停排版工具
//
// 历史沿革：这些代码原本在 `next-sources/lib/env.js`（ESM 模块，由外部生成器内联进 45-next-sources.js）。
// 2026-10-03 按用户要求「把 next-sources 合并进原 source，不留 next-source」压平成普通源码段，
// `next-sources/` 目录与生成器均已删除 —— **这里就是唯一真源，直接改这里**。
//
// 本段提供（解析器直接引用这些名字，不再有 import）：
//   · 抓取：fetchText / fetchJson / fetchMediaWikiText（走宿主代理或直连）
//   · 文本：pad2 / decodeEntities / textOf
//   · 悬停排版：hoverPool / hoverEvent（与本体 buildPoolHover / buildEventHover 逐字一致）
// 其余 env 名字（sourceInstant / sourceWallParts / fmtWindow / fmtMdHm / stripTags）由 30-parsers.js 与 15-env.js 提供。

		// 解析器原本 import ./lib/env.js；这里用插件已有实现 + 少量补齐顶上（解析器代码不改）。
		//   sourceInstant / sourceWallParts / fmtWindow / fmtMdHm / stripTags → 本体已有
		//   pad2 / decodeEntities / textOf                                    → 本区补
		//   fetchText / fetchJson / fetchMediaWikiText                        → 接宿主代理 / 直连
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

		async function fetchText(url, opts) {
			const o = opts || {};
			if (o.mode === "direct") {
				const res = await transportFetchRaw(url, { signal: o.signal, headers: Object.assign({}, rawHeaders(url), o.headers || {}) });
				if (!res.ok) throw new Error("http-" + res.status);
				return res.text();
			}
			return proxyFetchText(url, o.referer || "", o.headers, o.body);
		}
		async function fetchJson(url, opts) {
			const t = await fetchText(url, opts);
			try { return JSON.parse(t); } catch { throw new Error("bad-json"); }
		}
		async function fetchMediaWikiText(url, opts) {
			const apiUrl = url + (url.includes("?") ? "&" : "?") + "origin=*";
			const json = await fetchJson(apiUrl, opts);
			const text = json && json.parse && json.parse.text;
			if (typeof text !== "string") throw new Error("bad-json");
			return text;
		}
		//#endregion

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
		// （落点原本是 next-sources/lib/env.js，压平后就是本文件；测试与运行时读的是同一份代码。）
// ── 与本体唯一的差别 ──
// 本体的两个函数调 `fmtWindow(ts, endTs)` **漏传 tz**（`wallOf` 会退回本机时区）；
// 这里 tz 是**显式参数**，非 UTC+8 的源（日服 JST / 国际服 UTC）才能排对时刻。
//
// ── 返回 "" 的语义（与本体一致，调用方必须遵守）──
// 「当期条数 < 2」时返回 ""，表示**交回 UI 的默认单条两行式**：
//   卡池 `池名：角色名` ⏎ `档期`；活动 `名称` ⏎ `档期`。
// 所以调用方**不要**在返回值后面再拼任何东西；空串就让字段留空。

// 长期/常驻判定：**直接用本体 30-parsers.js 的那一条**（阈值也只有那一处）。
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
				// 永久/常驻活动计数行 —— **直接用本体 `permanentLine`**（30-parsers.js）。
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
