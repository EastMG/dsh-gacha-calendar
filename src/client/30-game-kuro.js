// src/client/30-game-kuro.js —— 库洛（鸣潮）
//
// ⚠️ 2026-10-03 重组（用户要求「28 款一视同仁」）：不再有「内置 11 款 / 另外 17 款」的文件分层，
//    每款/每组游戏一个**自包含**文件（条目 + 解析器 + 抓取器 + 登记）。
//    本次只挪位置，**符号名一个都没改** —— 所以导出表、注册表快照、所有用例都不受影响。
//
// ⚠️ 这些文件在 core 产物里位于 `createEngine` **内部**，每建一个引擎都会重跑一遍 →
//    对 `SOURCES` 的写操作**必须幂等**（统一走 `registerSource`，它按 id 找到就合并、否则追加）。


		// ── 解析器 / 抓取器 ──

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

		const WUWA_NOTICE_ENTRY = "https://aki-gm-resources-back.aki-game.com/gamenotice/G152/76402e5b20be2c39f095a152090afddc/entrypoint.json";


		const WUWA_BWIKI_URL = "https://wiki.biligame.com/wutheringwaves/api.php?action=parse&page=%E9%A6%96%E9%A1%B5%2F%E8%A7%92%E8%89%B2%E8%BD%AE%E6%8D%A2%E6%B1%A0&prop=text&format=json&formatversion=2";


		const WUWA_EVENT_BWIKI_URL = "https://wiki.biligame.com/wutheringwaves/api.php?action=parse&page=%E9%A6%96%E9%A1%B5%2F%E6%B4%BB%E5%8A%A8%E6%97%A5%E5%8E%86&prop=text&format=json&formatversion=2";


		// ── 条目 ──
		registerSource({
				id: "wuwa",
				defaultHidden: false,
				tz: TZ_CN,
				parserVersion: 2,
				name: "鸣潮",
				icon: "https://storage.moegirl.org.cn/moegirl/commons/2/29/WutheringWavesIcon.png!/fw/64",
				source: "官方公告",
				// 默认卡池源=官方公告（aki-gm-resources-back，经 host 代理）：
				// entrypoint.json → <dir>/zh-Hans.json，其 `recommend` 组里 tag=7 为逐期「角色/武器活动唤取」，
				// 条目自带 `startTimeMs`/`endTimeMs` 绝对时间戳（不再解析正文，见 parseWuwaNotice）。
				// 无当期公告或抓取失败时由抓取器自动回退 Bwiki 角色轮换池；也可在设置中手动切 Bwiki（备选）
				url: WUWA_NOTICE_ENTRY,
				altSources: [
					{ label: "Bwiki 角色轮换池", url: WUWA_BWIKI_URL, fetcher: "wuwa-bwiki" }
				],
				// 活动源：**默认=同一份官方公告**（`recommend` 组里 tag=5 为限时活动，见 parseWuwaRecommendEvents），
				// 与卡池是**同一条 URL** → 一次请求复用两侧数据。
				// ⚠️ 2026-10-01 改：Bwiki 活动日历页**已停更**（最新一条结束于 2026/9/29，无 3.7 内容），
				// 所以把它从默认**降级为备选**（eventAltSources），仍可在设置里手动切回。
				eventUrl: WUWA_NOTICE_ENTRY,
				eventSource: "官方公告",
				eventAltSources: [
					{ label: "Bwiki 活动日历", url: WUWA_EVENT_BWIKI_URL, fetcher: "wuwa-event-bwiki" }
				]
		});

		// ── 抓取器登记 ──
		GACHA_FETCHERS["wuwa"] = (url, signal, tz) => fetchWuwaGacha(url, signal, tz);
		GACHA_FETCHERS["wuwa-bwiki"] = (url, signal, tz) => mkMediaWiki((text) => parseWuwaPool(text, nowMs(), tz))(url, signal, tz);
					// 鸣潮：**默认=同一份官方公告**（`recommend` 组里 tag=5 为限时活动），与卡池是**同一条 URL**
			// → 一次请求复用两侧数据（refresh 的复用优化）。
			// ⚠️ 2026-10-01 改：Bwiki 活动日历**已停更**（最新一条结束于 2026/9/29），
			// 所以把官方提为默认、Bwiki 降级为备选（`wuwa-event-bwiki`），仍可在设置里手动切回。
EVENT_FETCHERS["wuwa"] = {
				default: (url, signal, tz) => fetchWuwaEventsOfficial(url, signal, tz),
				// ⚠️ 回调**必须**声明第二个参数 `tz`：mkMediaWiki 的契约是 `parse(text, tz)`
				//   （见 30-parsers.js 的 mkMediaWiki）。原来只写了 `(html)` 却在体内用 `tz`
				//   → 运行时 `tz is not defined`：用户在设置页把鸣潮活动源切到「Bwiki 活动日历」就必然抓取失败。
				//   2026-10-03 修正（同批还加了静态守卫 `test/cases-fetcher-args.mjs`）。
				"wuwa-event-bwiki": mkMediaWiki((html, tz) => {
					const d = parseWuwaCalendar(html, tz);
					return d ? { event: d.banner, eventDates: d.bannerDates || "", eventDatesRaw: d.bannerDatesRaw || d.bannerDates || "", eventHover: d.eventHover || "" } : null;
				})
			};
