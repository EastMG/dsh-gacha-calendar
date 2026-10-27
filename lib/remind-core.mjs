		//#region 到期提醒（送达）—— 判定 + 文案（平台无关纯函数）
		// 为什么要单独一段、且必须是"自给自足"的：判定只依赖「绝对时刻 + 节点配置 + 已发状态」，
		// 与宿主/平台无关。而 DSH 的**宿主半边**（src/index.js）拿不到浏览器 bundle 里的任何东西，
		// 所以 build.mjs 把这一个文件原样拼成 `lib/remind-core.mjs`（再多加几行 export），宿主
		// `import` 的就是**同一份源码** —— 判定规则只有一处，面板、core 包、宿主不会各写一套。
		// 因此本文件里**不得引用其它拼接段的标识符**（DEFAULT_SETTINGS / SOURCES / sourceInstant …），
		// 也不得出现 window / document / fetch / localStorage / 裸 new Date() / 裸 Date.now()
		// —— build.mjs 的 core 纯净度守卫会查。
		//
		// 规则（沿用 tools/remind 的原型，2026-10-27 定稿，别改）：
		//   ① 条目分方向：kind=end（结束）/ start（开始），T = 该方向的绝对时刻（毫秒）。
		//   ② 节点 n ∈ endNodes / startNodes；节点 n 的到期时刻 = T − n 小时。
		//   ③ now ≥ T − n 且 n 还没发过 ⇒ 候选。
		//   ④ 同一条目（同一个 key）同时有多个节点到期 ⇒ **只发最紧急的那一档**（n 最小），
		//      其余到期节点一并标成已发 —— 不补发风暴、不刷屏。
		//   ⑤ T 已过（条目已结束 / 已开始）⇒ 整条作废：不发，状态里的键一并清掉。
		//
		// 状态形状（就是落盘的 JSON 平表，没有版本壳子）：
		//   { "ba-jp|gacha|end|1793113200000": { "fired": [72, 24] }, ... }
		//   fired 存的是**节点小时数**（不是时间戳）：同一条目补跑时能判断"哪几档已经打扰过"。
		const REMIND_HOUR_MS = 3600000;
		// 出厂节点：结束后 3 天 / 1 天 / 6 小时 / 2 小时，开始前 1 天 / 2 小时。
		// 设置项 `remindEndNodes` / `remindStartNodes` 是**字符串**（"72,24,6,2"），解析失败回落这两份。
		const REMIND_DEFAULT_END_NODES = [72, 24, 6, 2];
		const REMIND_DEFAULT_START_NODES = [24, 2];
		// 一条档期 = 某款游戏的卡池侧或活动侧；字段名与 Result JSON 里的记录一致。
		const REMIND_SIDES = [
			{ side: "gacha", label: "卡池", titleKey: "banner", dateKey: "bannerDates" },
			{ side: "event", label: "活动", titleKey: "event", dateKey: "eventDates" }
		];
		// 源站时区表（id → 源站 tz）。**这是 SOURCES[].tz 的副本**，因为宿主半边读不到 SOURCES。
		// 守卫见 test/cases-remind.mjs：每个来源的 tz 必须与 SOURCES 逐项一致（多一个/少一个/值不同都红）。
		const REMIND_TZ_BY_ID = {
			"genshin": "Asia/Shanghai",
			"hsr": "Asia/Shanghai",
			"zzz": "Asia/Shanghai",
			"bh3": "Asia/Shanghai",
			"wuwa": "Asia/Shanghai",
			"arknights": "Asia/Shanghai",
			"endfield": "Asia/Shanghai",
			"ba-cn": "Asia/Shanghai",
			"ba-global": "UTC",
			"ba-jp": "Asia/Tokyo",
			"bandori": "Asia/Shanghai",
			"ournotes": "Asia/Tokyo",
			"ournotes-global": "Asia/Shanghai",
			"wuhuamixin": "Asia/Shanghai",
			"zspms": "Asia/Shanghai",
			"czn": "Asia/Shanghai",
			"kedr": "Asia/Shanghai",
			"ddlezj": "+540",
			"uma-cn": "Asia/Shanghai",
			"uma-jp": "Asia/Tokyo",
			"uma-global": "UTC",
			"p5x": "Asia/Shanghai",
			"nte": "Asia/Shanghai",
			"gf2": "Asia/Shanghai",
			"fgo": "Asia/Shanghai",
			"pjsk": "Asia/Shanghai",
			"stellasora": "Asia/Shanghai",
			"r1999": "Asia/Shanghai"
		};
		// 状态键 / 档期文本的两条形态（正则只在这里写一次）
		const REMIND_KEY_RE = /^[^|]+\|[^|]+\|(?:end|start)\|\d+$/;
		const REMIND_PART_RE = /^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/;

		// 提醒总开关的读取口径：只有明确的 false 才算关（老配置没有这个键 ⇒ 默认开）。
		// 设置页与宿主共用这一处，避免"设置页显示开着、宿主却没发"。
		function remindOnOf(v) {
			return v !== false;
		}

		// 节点配置解析："72,24,6,2" → [72,24,6,2]（降序、去重、只留正数）。
		// 也接受数组 / 数字（宿主设置库里历史值可能是数组）。解析不出任何有效节点 ⇒ 用 fallback 的副本。
		// **不抛**：配置被手改坏了不该让提醒整个停摆。
		function remindNodesOf(value, fallback) {
			const out = [];
			const push = (raw) => {
				const n = typeof raw === "string" ? Number(raw.trim()) : raw;
				if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return;
				if (!out.includes(n)) out.push(n);
			};
			if (Array.isArray(value)) value.forEach(push);
			else if (typeof value === "string") value.split(/[,，\s]+/).forEach(push);
			else if (typeof value === "number") push(value);
			if (!out.length) return fallback.slice();
			out.sort((a, b) => b - a);
			return out;
		}

		// 设置项 → 两套节点。键名与插件设置项同名（宿主把 config 原样递进来即可）。
		function remindConfigOf(input) {
			const raw = input && typeof input === "object" ? input : {};
			return {
				endNodes: remindNodesOf(raw.remindEndNodes, REMIND_DEFAULT_END_NODES),
				startNodes: remindNodesOf(raw.remindStartNodes, REMIND_DEFAULT_START_NODES)
			};
		}

		// 条目的去重键：条目自带 key 优先（派生时就编码了方向与 T），否则按同一规则现拼。
		function remindKeyOf(item) {
			if (item && typeof item.key === "string" && item.key) return item.key;
			return String(item.gameId) + "|" + String(item.side) + "|" + String(item.kind) + "|" + String(item.T);
		}

		// 从键的末段取回 T（毫秒）。取不到 → NaN。
		function remindTimeOfKey(key) {
			const tail = String(key).split("|").pop();
			const n = Number(tail);
			return Number.isFinite(n) ? n : NaN;
		}

		// 状态文件的防御性归一：只留本模块认识的键与 fired 数组，丢掉空记录 / 垃圾键。
		// 读坏的状态不该让提醒停摆，也不该被原样写回。
		function remindStateOf(state) {
			const out = {};
			if (!state || typeof state !== "object" || Array.isArray(state)) return out;
			for (const [key, rec] of Object.entries(state)) {
				if (!REMIND_KEY_RE.test(key)) continue;
				const firedRaw = rec && typeof rec === "object" ? rec.fired : null;
				const fired = Array.isArray(firedRaw)
					? firedRaw.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
					: [];
				if (!fired.length) continue;   // 没有已发节点的记录没有信息量
				out[key] = { fired: [...new Set(fired)].sort((a, b) => b - a) };
			}
			return out;
		}

		// ── 源站墙钟 → 绝对毫秒（与 15-env.js 的 sourceInstant / 80-components.js 的外显换算同口径）──
		// 时区只接受三种写法：IANA 名（走 Intl，含 DST）、分钟偏移数字、"±分钟"字符串（如 "+540"）。
		// 认不出来 / 空 ⇒ 退回本机时区（与面板对"读不出时区"的条目按本机解释的行为一致）。
		const REMIND_TZ_FORMATTERS = new Map();
		function remindTzFormatter(name) {
			if (REMIND_TZ_FORMATTERS.has(name)) return REMIND_TZ_FORMATTERS.get(name);
			let f = null;
			try {
				f = new Intl.DateTimeFormat("en-US", {
					timeZone: name,
					hour12: false,
					year: "numeric",
					month: "2-digit",
					day: "2-digit",
					hour: "2-digit",
					minute: "2-digit",
					second: "2-digit"
				});
			} catch {
				f = null;   // ICU 缺这个时区名 ⇒ 调用方回落本机时区
			}
			REMIND_TZ_FORMATTERS.set(name, f);
			return f;
		}
		function remindTzOffsetAt(tz, ts) {
			const localOffset = () => -new Date(ts).getTimezoneOffset();
			if (tz === null || tz === void 0 || tz === "") return localOffset();
			if (typeof tz === "number") return Number.isFinite(tz) ? tz : localOffset();
			const name = String(tz).trim();
			if (/^[+-]?\d+$/.test(name)) return Number(name);
			const f = remindTzFormatter(name);
			if (!f) return localOffset();
			const parts = f.formatToParts(new Date(ts));
			const part = (k) => {
				const hit = parts.find((p) => p.type === k);
				return hit ? Number(hit.value) : NaN;
			};
			const hour = part("hour") % 24;   // hour12:false 在个别环境对午夜给 24
			const asUTC = Date.UTC(part("year"), part("month") - 1, part("day"), hour, part("minute"), part("second"));
			return (asUTC - Math.floor(ts / 1000) * 1000) / 60000;
		}
		// 墙钟（源站时区）→ 绝对毫秒。两遍法处理 DST 边界（与 15-env.js 的 sourceInstant 同做法）。
		function remindWallTs(y, mo, d, h, mi, tz) {
			const guess = Date.UTC(y, mo - 1, d, h, mi);
			const off = remindTzOffsetAt(tz, guess);
			let ts = guess - off * 60000;
			const off2 = remindTzOffsetAt(tz, ts);
			if (off2 !== off) ts = guess - off2 * 60000;
			return ts;
		}
		function remindWallPartsOf(text) {
			const m = String(text || "").match(REMIND_PART_RE);
			if (!m) return null;
			const mo = Number(m[2]);
			const d = Number(m[3]);
			const h = m[4] ? Number(m[4]) : 0;
			const mi = m[5] ? Number(m[5]) : 0;
			if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
			return { y: m[1] ? Number(m[1]) : null, mo, d, h, mi };
		}

		// 档期文本 `MM-DD HH:MM ~ MM-DD HH:MM`（两端也可带 4 位年份，跨年档期就是这种）→ 绝对窗口。
		// 年份补全规则与面板一致：不带年份时按 now 的**本机年**补，结束月 < 开始月 ⇒ 次年。
		// 读不出来（"版本更新后 ~ …" / 长期 / 全角波浪号 / 只写了半截）⇒ null，**绝不硬凑一个猜的时刻**。
		function remindWindowOf(raw, now, tz) {
			const text = typeof raw === "string" ? raw.trim() : "";
			if (!text) return null;
			const nowTs = Number(now);
			if (!Number.isFinite(nowTs)) return null;
			const parts = text.split("~").map((s) => s.trim());
			if (parts.length < 2) return null;
			const a = remindWallPartsOf(parts[0]);
			const b = remindWallPartsOf(parts[1]);
			if (!a || !b) return null;
			const y = new Date(nowTs).getFullYear();
			const ay = a.y === null ? y : a.y;
			const by = b.y === null ? (b.mo < a.mo ? ay + 1 : ay) : b.y;
			const startTs = remindWallTs(ay, a.mo, a.d, a.h, a.mi, tz);
			const endTs = remindWallTs(by, b.mo, b.d, b.h, b.mi, tz);
			if (!(endTs > startTs)) return null;
			return { startTs, endTs };
		}

		// lastData 里的 games（{ id: { banner, bannerDates, event, eventDates, … } }）→ 提醒条目。
		// 每个游戏侧最多两条：结束（T=endTs）/ 开始（T=startTs）；已经过去的方向直接不派生。
		// extraTzById 用来覆盖时区（自定义条目自己填的 tz 不在 REMIND_TZ_BY_ID 里）。
		function remindItemsOf(games, now, extraTzById) {
			const nowTs = Number(now);
			const out = [];
			if (!Number.isFinite(nowTs) || !games || typeof games !== "object") return out;
			const extra = extraTzById && typeof extraTzById === "object" ? extraTzById : {};
			for (const [gameId, game] of Object.entries(games)) {
				if (!game || typeof game !== "object") continue;
				const gameName = String(game.name || gameId);
				const tz = extra[gameId] || REMIND_TZ_BY_ID[gameId] || null;
				for (const s of REMIND_SIDES) {
					const raw = String(game[s.dateKey] || "").trim();
					if (!raw) continue;
					const win = remindWindowOf(raw, nowTs, tz);
					if (!win) continue;
					const base = {
						gameId,
						gameName,
						side: s.side,
						sideLabel: s.label,
						title: String(game[s.titleKey] || "").trim() || gameName,
						startTs: win.startTs,
						endTs: win.endTs
					};
					if (win.endTs > nowTs) {
						out.push({ ...base, kind: "end", T: win.endTs, key: gameId + "|" + s.side + "|end|" + win.endTs });
					}
					if (win.startTs > nowTs) {
						out.push({ ...base, kind: "start", T: win.startTs, key: gameId + "|" + s.side + "|start|" + win.startTs });
					}
				}
			}
			return out;
		}

		// 一轮判定。**纯函数**：同样的 (now, items, config, state) ⇒ 同样的返回值；入参一概不改。
		// 返回 { toNotify, stateNext }：
		//   toNotify = 这一轮该送达的（每条形如 { key, gameId, gameName, side, sideLabel, kind, title,
		//              T, node, dueAt, nodesMarked, startTs, endTs }，按 T 升序 = 最紧迫的在前）
		//   stateNext = 下一轮该写回的状态（已过期的键已清掉、被折叠的节点已标已发）
		function remindTickOf(now, items, config, state) {
			const nowTs = Number(now);
			if (!Number.isFinite(nowTs)) throw new TypeError("remindTickOf: now 必须是有限毫秒时间戳");
			const cfg = remindConfigOf(config);
			const prev = remindStateOf(state);
			const next = {};
			const toNotify = [];
			// ① 先清状态：键里的 T 已过 ⇒ 那一期已经结束/已开始，记录不再需要。
			//    只按"键里的 T"判，不看条目是否还在本轮数据里 —— 数据源掉线不会误删未过期的记录。
			for (const [key, rec] of Object.entries(prev)) {
				const T = remindTimeOfKey(key);
				if (!Number.isFinite(T) || T <= nowTs) continue;
				next[key] = { fired: [...rec.fired] };
			}
			// ② 逐条判节点（同一个 key 只算一次；同一轮里不重复打扰）。
			const seen = new Set();
			for (const rawItem of Array.isArray(items) ? items : []) {
				if (!rawItem || typeof rawItem !== "object") continue;
				const key = remindKeyOf(rawItem);
				if (seen.has(key)) continue;
				seen.add(key);
				const kind = rawItem.kind === "start" ? "start" : "end";
				const T = Number(rawItem.T);
				// 规则⑤：T 已过（或脏数据）⇒ 整条作废，不发，也不留键。
				if (!Number.isFinite(T) || T <= nowTs) {
					delete next[key];
					continue;
				}
				const nodes = kind === "start" ? cfg.startNodes : cfg.endNodes;
				const firedPrev = new Set(next[key] ? next[key].fired : []);
				const due = [];
				for (const n of nodes) {
					if (firedPrev.has(n)) continue;
					if (nowTs >= T - n * REMIND_HOUR_MS) due.push(n);
				}
				if (!due.length) continue;
				// 规则④：n 最小的最紧急；同一条目其余到期节点一并标已发（不单独打扰）。
				due.sort((a, b) => a - b);
				next[key] = { fired: [...new Set([...firedPrev, ...due])].sort((a, b) => b - a) };
				toNotify.push({
					key,
					gameId: rawItem.gameId,
					gameName: rawItem.gameName || rawItem.gameId,
					side: rawItem.side,
					sideLabel: rawItem.sideLabel || rawItem.side,
					kind,
					title: rawItem.title || rawItem.gameName || rawItem.gameId,
					T,
					node: due[0],
					dueAt: T - due[0] * REMIND_HOUR_MS,
					nodesMarked: [...due],
					startTs: rawItem.startTs,
					endTs: rawItem.endTs
				});
			}
			// ③ 排序：最早截止的排前面（同一时刻先发档位更紧急的那条）。
			toNotify.sort((a, b) => a.T - b.T || a.node - b.node || a.key.localeCompare(b.key));
			return { toNotify, stateNext: next };
		}

		// ── 通知文案（纯函数：只吃 notify + now，产出 { title, lines }）────────────────
		// 时间一律按**本机时区**显示（玩家要回答的是"我这边几点"），与面板外显同口径。
		function remindPad2(n) {
			return (n < 10 ? "0" : "") + n;
		}
		function remindClockOf(ts) {
			const d = new Date(Number(ts));
			if (!Number.isFinite(d.getTime())) return "";
			return remindPad2(d.getMonth() + 1) + "-" + remindPad2(d.getDate()) + " " + remindPad2(d.getHours()) + ":" + remindPad2(d.getMinutes());
		}
		// 剩余时长：<1 小时说"分"、<1 天说"小时"、再往上"天 + 小时"（通知里空间够，不往下取整骗人）。
		function remindSpanText(ms) {
			const t = Number(ms);
			if (!Number.isFinite(t) || t <= 0) return "不到 1 分";
			const mins = Math.floor(t / 60000);
			if (mins < 60) return Math.max(1, mins) + " 分";
			const hours = Math.floor(mins / 60);
			if (hours < 24) return hours + " 小时";
			const days = Math.floor(hours / 24);
			const rest = hours % 24;
			return rest > 0 ? days + " 天 " + rest + " 小时" : days + " 天";
		}
		function remindNodeText(node) {
			const n = Number(node);
			if (!Number.isFinite(n) || n <= 0) return "";
			return n + " 小时";   // 统一按小时说：24 小时比"1 天"更不容易和"还剩 1 天"混淆
		}
		function remindToastOf(notify, now) {
			const n = notify || {};
			const gameName = String(n.gameName || n.gameId || "二游日历");
			const title = (n.kind === "start" ? "即将开始 · " : "即将结束 · ") + gameName;
			const head = String(n.sideLabel || "") + "「" + String(n.title || gameName) + "」";
			const span = remindSpanText(Number(n.T) - Number(now));
			const node = remindNodeText(n.node);
			const lines = [head];
			if (n.kind === "start") {
				lines.push(remindClockOf(n.startTs) + " 开始 → " + remindClockOf(n.endTs) + " 结束");
				lines.push("还有 " + span + "（" + (node ? node + "提醒" : "到点提醒") + "）");
			} else {
				lines.push(remindClockOf(n.startTs) + " → " + remindClockOf(n.endTs) + " 结束");
				lines.push("还剩 " + span + "（" + (node ? node + "提醒" : "到点提醒") + "）");
			}
			return { title, lines };
		}
		//#endregion
// ── 出口：上面的代码与 lib/client.js / packages/core/core.mjs 里的是**同一份源码**
// （65-remind.js，由 build.mjs 原样拼出，一字未改）。宿主 src/index.js 只 import 这里。
export {
  REMIND_HOUR_MS,
  REMIND_DEFAULT_END_NODES,
  REMIND_DEFAULT_START_NODES,
  REMIND_TZ_BY_ID,
  remindOnOf,
  remindNodesOf,
  remindConfigOf,
  remindKeyOf,
  remindStateOf,
  remindWindowOf,
  remindItemsOf,
  remindTickOf,
  remindToastOf
};
