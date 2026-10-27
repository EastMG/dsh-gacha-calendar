// tools/remind/lib/derive.mjs —— 缓存数据 → 提醒条目列表（纯函数，不读文件、不看表）
//
// 一条「条目」= 某款游戏的**卡池侧**或**活动侧**的某个方向：
//   { gameId, side, kind: "end"|"start", title, T, startTs, endTs, key }
// T = 该方向的绝对时刻（结束用 endTs，开始用 startTs）。tick 只认 T 与节点，不再关心游戏/时区。
//
// 时区 / 墙钟换算**原样复用** demo-simple.mjs（L114-184）里已经验证过的那几段：
//   源站档期是「源站墙钟」（如 `10-20 23:00`，JST/UTC-5 各不相同），必须先按源站 tz 换成绝对毫秒，
//   「还剩多久」才是真值。tz 不在 Result JSON 里（core 的 CONTENT_FIELDS 只有文本），
//   所以由调用方从 core 的注册表（`engine.__test.SOURCES`）取同一份 tz 传进来。
// 这里与 demo 的唯一差别：不在这里判「窗口内没在窗口内」，窗口概念被节点取代 —— 一条条目只被派生一次，
// 由 tick 按节点判断该不该发。

/** 卡池侧 / 活动侧：与面板列「还剩 X」同源（都是那一侧的档期文本）。 */
export const SIDES = Object.freeze([
	{ side: "gacha", label: "卡池", titleKey: "banner", dateKey: "bannerDates" },
	{ side: "event", label: "活动", titleKey: "event", dateKey: "eventDates" }
]);

// ── 时区偏移 / 源站墙钟 → 绝对毫秒（两遍法处理 DST 边界） ───────────────────────
const TZ_FORMATTERS = new Map();

function tzFormatter(name) {
	if (TZ_FORMATTERS.has(name)) return TZ_FORMATTERS.get(name);
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
		f = null; // 环境不认识这个时区名（ICU 缺失）⇒ 调用方回落到本机时区
	}
	TZ_FORMATTERS.set(name, f);
	return f;
}

function offsetMinutesAt(tz, ts) {
	const localOffset = () => -new Date(ts).getTimezoneOffset();
	if (tz === null || tz === void 0 || tz === "") return localOffset();
	if (typeof tz === "number") return Number.isFinite(tz) ? tz : localOffset();
	const name = String(tz).trim();
	if (/^[+-]?\d+$/.test(name)) return Number(name);
	const f = tzFormatter(name);
	if (!f) return localOffset();
	const parts = f.formatToParts(new Date(ts));
	const part = (k) => {
		const hit = parts.find((p) => p.type === k);
		return hit ? Number(hit.value) : NaN;
	};
	const hour = part("hour") % 24; // hour12:false 在个别环境对午夜给 24
	const asUTC = Date.UTC(part("year"), part("month") - 1, part("day"), hour, part("minute"), part("second"));
	return (asUTC - Math.floor(ts / 1000) * 1000) / 60000;
}

function wallToTs(y, mo, d, h, mi, tz) {
	const guess = Date.UTC(y, mo - 1, d, h, mi);
	const off = offsetMinutesAt(tz, guess);
	let ts = guess - off * 60000;
	const off2 = offsetMinutesAt(tz, ts);
	if (off2 !== off) ts = guess - off2 * 60000;
	return ts;
}

// ── 档期文本 `MM-DD HH:MM ~ MM-DD HH:MM`（也接受带年份） → 绝对窗口 ─────────────
function parsePart(text) {
	const m = String(text || "").match(/^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
	if (!m) return null;
	const mo = Number(m[2]);
	const d = Number(m[3]);
	const h = m[4] ? Number(m[4]) : 0;
	const mi = m[5] ? Number(m[5]) : 0;
	if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
	return { y: m[1] ? Number(m[1]) : null, mo, d, h, mi };
}

/**
 * 档期文本 → 绝对窗口。年份补全规则与 core 面板一致：文本不带年份时按 now 所在年补，
 * 结束月 < 开始月 ⇒ 跨年。
 *
 * @param {string} raw
 * @param {Date} nowDate
 * @param {string|number|null} tz 源站时区（IANA 名 / 分钟偏移 / null=本机）
 * @returns {{ startTs: number, endTs: number } | null}
 */
export function windowOf(raw, nowDate, tz) {
	const parts = String(raw || "").split("~").map((s) => s.trim());
	if (parts.length < 2) return null;
	const a = parsePart(parts[0]);
	const b = parsePart(parts[1]);
	if (!a || !b) return null;
	if (a.y === null) a.y = nowDate.getFullYear();
	if (b.y === null) {
		b.y = a.y;
		if (b.mo < a.mo) b.y = a.y + 1;
	}
	const startTs = wallToTs(a.y, a.mo, a.d, a.h, a.mi, tz);
	const endTs = wallToTs(b.y, b.mo, b.d, b.h, b.mi, tz);
	if (!(endTs > startTs)) return null;
	return { startTs, endTs };
}

function tzOf(tzById, id) {
	if (!tzById) return null;
	if (typeof tzById.get === "function") return tzById.get(id) ?? null;
	return tzById[id] ?? null;
}

/**
 * 派生提醒条目：每个有档期的游戏侧，最多产出两个条目（结束 / 开始）。
 * **已过的方向直接不派生**（T 已过 ⇒ 永不发，tick 里还有一道同样的守卫），并在 stats 里计数。
 *
 * @param {{ data: { games?: Record<string, Record<string, unknown>> }, tzById?: Map<string, unknown> | Record<string, unknown>,
 *   now: number }} input
 * @returns {{
 *   items: Array<Record<string, unknown>>,
 *   unparsed: Array<{ gameId: string, gameName: string, side: string, sideLabel: string, raw: string }>,
 *   stats: Record<string, number>
 * }}
 */
export function deriveItems({ data, tzById = null, now }) {
	const nowTs = Number(now);
	const nowDate = new Date(nowTs);
	const games = (data && data.games) || {};
	const items = [];
	const unparsed = [];
	const stats = { games: Object.keys(games).length, windows: 0, items: 0, end: 0, start: 0, pastEnd: 0, pastStart: 0, noData: 0 };

	for (const [gameId, game] of Object.entries(games)) {
		if (!game || typeof game !== "object") continue;
		const tz = tzOf(tzById, gameId);
		const gameName = String(game.name || gameId);
		for (const s of SIDES) {
			const raw = String(game[s.dateKey] || "").trim();
			if (!raw) {
				stats.noData++;
				continue;
			}
			const title = String(game[s.titleKey] || "").trim() || gameName;
			const win = windowOf(raw, nowDate, tz);
			if (!win) {
				unparsed.push({ gameId, gameName, side: s.side, sideLabel: s.label, raw });
				continue;
			}
			stats.windows++;
			const base = {
				gameId,
				gameName,
				side: s.side,
				sideLabel: s.label,
				title,
				startTs: win.startTs,
				endTs: win.endTs,
				raw
			};
			if (win.endTs > nowTs) {
				items.push({
					...base,
					kind: "end",
					T: win.endTs,
					key: gameId + "|" + s.side + "|end|" + win.endTs
				});
				stats.end++;
			} else {
				stats.pastEnd++;
			}
			if (win.startTs > nowTs) {
				items.push({
					...base,
					kind: "start",
					T: win.startTs,
					key: gameId + "|" + s.side + "|start|" + win.startTs
				});
				stats.start++;
			} else {
				stats.pastStart++;
			}
		}
	}
	stats.items = items.length;
	return { items, unparsed, stats };
}
