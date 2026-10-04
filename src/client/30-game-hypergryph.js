// src/client/30-game-hypergryph.js —— 鹰角（明日方舟 / 终末地）
//
// ⚠️ 2026-10-03 重组（用户要求「28 款一视同仁」）：不再有「内置 11 款 / 另外 17 款」的文件分层，
//    每款/每组游戏一个**自包含**文件（条目 + 解析器 + 抓取器 + 登记）。
//    本次只挪位置，**符号名一个都没改** —— 所以导出表、注册表快照、所有用例都不受影响。
//
// ⚠️ 这些文件在 core 产物里位于 `createEngine` **内部**，每建一个引擎都会重跑一遍 →
//    对 `SOURCES` 的写操作**必须幂等**（统一走 `registerSource`，它按 id 找到就合并、否则追加）。


		// ── 解析器 / 抓取器 ──

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


		// 从 fz.wiki 的数据里抽出 contentJson 的 JSON 对象。两种输入都要支持：
		//   ① 活动页 HTML（Next.js App Router）：数据在 `self.__next_f.push([1,"..."])` 的 RSC 流里；
		//   ② REST API 响应（`api.fz.wiki`）：**直接就是 JSON**，没有 `__next_f` 外壳。
		// 2026-10-04：fz.wiki 的活动页已不再在 HTML/RSC 里输出卡片数据（页面只剩导航外壳，
		// 实测 `endfieldCardActivityIndex` / `wikiCardItem` 在页面里 **0 处**），数据改由 API 提供
		// （`revision.contentJson`，结构与原来的 RSC payload 一致）。所以 fetcher 改走 API，
		// 这里补一条"输入本来就是 JSON"的分支；旧格式分支保留，页面若改回来也照样能用。
		function extractFzContentJson(html) {
			let full = "";
			if (html.includes("self.__next_f.push")) {
				const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
				let m;
				while ((m = re.exec(html))) {
					try { full += JSON.parse('"' + m[1] + '"'); } catch { full += m[1]; }
				}
			} else {
				full = html;
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
		// 时间格式 "2026/9/2 7:00:00"；悬停按**结束时间升序**逐行，外显另由 `pickEventPrimary`
		// 挑选（叙事/挑战类优先于签到/减耗类），不是简单的"第一条"。
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


		// 终末地（FZ Wiki 经 host 代理，无 CORS）：活动排期。
		// 三态口径：有当期活动 → 数据；解析到活动但没有当期 → null（nomatch）；
		// 结构变了/一条都解析不出 → parseFzWikiActivities 抛错（down）。
		// 2026-10-04：fz.wiki 把活动数据从页面 HTML/RSC 移到了 REST API（页面只剩外壳）→
		// 改为请求 `api.fz.wiki/api/v1/articles/by-title?ns=0&title=<页面名>&withRevision=1`。
		// 条目里的 `eventUrl` 仍是**给人看的页面地址**（设置页显示它）；标题由该地址的路径推出，
		// 所以用户把 eventUrl 换成别的 wiki 页也能用。若直接把 eventUrl 配成 API 地址，则原样使用。
		async function fetchFzWikiEndfield(pageUrl, _signal, tz, now = nowMs()) {
			let url = pageUrl;
			if (!/api\.fz\.wiki/.test(pageUrl)) {
				const m = /\/wiki\/([^/?#]+)/.exec(pageUrl);
				const title = m ? decodeURIComponent(m[1]) : "活动";
				url = "https://api.fz.wiki/api/v1/articles/by-title?ns=0&title=" + encodeURIComponent(title) + "&withRevision=1";
			}
			const text = await proxyFetchText(url, "https://fz.wiki/");
			return parseFzWikiActivities(text, now, tz);
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


		// 终末地（wiki.gg 经 host 代理）：抓取 Headhunting/Banners HTML → parseEndfieldCurrent
		// ⚠️ 2026-10-03 实测更正（原注释说"校验 Referer，非 wiki.gg 域名 403"，**是错的**）：
		//    wiki.gg 拦的是 **浏览器型 User-Agent**，不是 Referer。逐项实测（同一 URL）：
		//      无头 200 / 仅 Referer 200 / 仅 Accept 200 / Referer+Accept 200
		//      仅 UA=Chrome/126 **403** / 仅 UA=curl/8.0 200 / 仅 UA=dsh-gacha-calendar 200
		//    而宿主代理 `src/index.js` 对所有请求统一发**浏览器 UA**（它的注释写着
		//    "browser-like, to satisfy anti-scrape"）—— 于是这个备选源经代理必然 403。
		//    修法：本抓取器显式覆盖 UA 为中性值（代理的 `headers` 参数会覆盖默认 UA）。
		//    不给末端用户添麻烦，也不动全局 UA（别处可能正依赖浏览器 UA）。
		const ENDFIELD_WG_UA = "dsh-gacha-calendar";

		// 注意：这个地址是 MediaWiki 的 **api.php**，返回的是 JSON（`{"parse":{"text":"<html>"}}`）——
		// 必须取 parse.text 再解析。旧实现直接把原始 JSON 串喂给解析器，于是 id="Current" 在 JSON 里是
		// 转义形式（id=\"Current\"）永远匹配不到 → 该备选源长期"抓得到但解析不出"（这才是真根因）。
		async function fetchEndfieldWikiGg(proxyUrl) {
			const json = await proxyFetchJson(proxyUrl, "https://endfield.wiki.gg/", { "User-Agent": ENDFIELD_WG_UA });
			const html = json?.parse?.text;
			if (typeof html !== "string") throw new Error("bad-json");
			return parseEndfieldCurrent(html);
		}

		const ARKNIGHTS_OFFICIAL_LIST_URL = AK_OFFICIAL_BULLETIN + "?lang=zh-cn&code=arknights&page=1&pageSize=30";


		const ARKNIGHTS_PRTS_URL = "https://prts.wiki/api.php?action=parse&page=%E5%8D%A1%E6%B1%A0%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2";


		// ── 条目 ──
		registerSource({
				id: "arknights",
				defaultHidden: false,
				tz: TZ_CN,
				// 2：档位改按池名判定（中坚优先）+ 外显与悬停共用同一份排序列表（v0.9.25 修）
				parserVersion: 2,
				name: "明日方舟",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/4/41/ArknightsAppIcon.png!/fw/64",
				source: "官方公告+PRTS",
				// 默认卡池源=官方公告 CMS（经 host 代理）：官方只对限时/联动类寻访发公告，
				// 无当期寻访公告（常规轮换周）时由抓取器自动回退 PRTS；也可在设置中手动切 PRTS 卡池一览（备选）
				url: ARKNIGHTS_OFFICIAL_LIST_URL,
				altSources: [
					{ label: "PRTS 卡池一览", url: ARKNIGHTS_PRTS_URL, fetcher: "arknights-prts" }
				],
				// 独立活动源：PRTS 活动一览（「活动开始时间」表 + data-time 起止时间戳）
				eventUrl: "https://prts.wiki/api.php?action=parse&page=%E6%B4%BB%E5%8A%A8%E4%B8%80%E8%A7%88&prop=text&format=json&formatversion=2",
				eventSource: "PRTS \u6D3B\u52A8\u4E00\u89C8"
		});

		registerSource({
				id: "endfield",
				defaultHidden: false,
				tz: TZ_CN,
				parserVersion: 2,
				name: "明日方舟：终末地",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/f/f1/ArknightsEndfieldAppIcon.png!/fw/64",
				source: "Canmoe",
				// 经 host 代理抓取（canmoe 无 CORS 头，浏览器直连会被拦截）；
				// 数据在 Next.js 组件 chunk 的 JS 里，需先抓页面定位 chunk 再抓 chunk 解析
				url: "https://end.canmoe.com/zh-CN/banner-calendar",
				// 卡池备选来源（设置页下拉可切换；GachaTracker 浏览器直连，wiki.gg 经 host 代理）
				altSources: [
					{
						label: "GachaTracker\uff08\u82F1\u6587\uff09",
						url: "https://gachatracker.app/games/endfield/banners/",
						fetcher: "endfield-gachatracker"
					},
					{
						label: "wiki.gg\uff08\u82F1\u6587\uff09",
						// wiki.gg 校验 Referer：抓取器内部经 host 代理（代理默认 Referer=目标 origin 满足要求）
						url: "https://endfield.wiki.gg/api.php?action=parse&page=Headhunting%2FBanners&prop=text&format=json&formatversion=2",
						fetcher: "endfield-wiki-gg"
					}
				],
				// 独立活动源：FZ Wiki（中文社区维护，经 host 代理抓 RSC 数据；当期并行活动选结束最晚）
				eventUrl: "https://fz.wiki/wiki/%E6%B4%BB%E5%8A%A8",
				eventSource: "FZ Wiki",
				// 活动备选来源：Game8（英文，经 host 代理）
				eventAltSources: [
					{ label: "Game8\uff08\u82F1\u6587\uff09", url: "https://game8.co/games/Arknights-Endfield/archives/535443", fetcher: "endfield-game8" }
				]
		});

		// ── 抓取器登记 ──
		GACHA_FETCHERS["arknights"] = (url, signal, tz) => fetchArknightsGacha(url, signal, tz);
					// ⚠️ `selectArknights` / `parseWuwaPool` 的**第二参是 `now`**（不是 tz），
			// 而 mkMediaWiki 只会传 `(text, tz)` —— 直接包进去会让 `now` 收到时区值，
			// `startTs <= now` 恒为 false → 解析结果恒为 null（静默"未公布"，极难查）。
			// 所以这两个注册点必须**显式传 nowMs()**。
GACHA_FETCHERS["arknights-prts"] = (url, signal, tz) => mkMediaWiki((text) => selectArknights(text, nowMs(), tz))(url, signal, tz);
					// 终末地默认：Canmoe（中文，Next.js 数据经 host 代理两步抓取）
GACHA_FETCHERS["endfield"] = (url, signal, tz) => fetchCanmoeEndfield(url, signal, tz);
					// 终末地备选：GachaTracker（英文，浏览器直连）/ wiki.gg（英文，经 host 代理）
GACHA_FETCHERS["endfield-gachatracker"] = mkRaw(parseGachaTracker);
		GACHA_FETCHERS["endfield-wiki-gg"] = (url, signal, tz) => fetchEndfieldWikiGg(url, signal, tz);
					// 明日方舟：PRTS 活动一览（「活动开始时间」表 + data-time 起止时间戳）→ 同上
EVENT_FETCHERS["arknights"] = {
				default: mkMediaWiki(prtsEventPayload)
			};
					// 终末地：FZ Wiki（中文，经 host 代理、抓 RSC 数据；外显当期=结束最晚，悬停列出全部并行）
EVENT_FETCHERS["endfield"] = {
				default: (url, signal, tz) => fetchFzWikiEndfield(url, signal, tz).then((d) =>
					d ? { event: d.banner, eventDates: d.bannerDates || "", eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "", eventHover: d.eventHover || "" } : null
				),
				"endfield-game8": (url, signal, tz) => fetchGame8Endfield(url, signal, tz).then((d) =>
					d ? { event: d.banner, eventDates: d.bannerDates || "", eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "" } : null
				)
			};
