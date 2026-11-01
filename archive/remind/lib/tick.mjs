// tools/remind/lib/tick.mjs —— 纯函数 tick：给定 now 与条目，算出「这一轮该发哪些」
//
// 平台无关、宿主无关：**不读时钟、不读文件、不弹通知、不看进程环境**。
// 任何宿主（Windows 计划任务 / 扩展的 chrome.alarms / 打开 App 时）只要把 now 和条目递进来，
// 拿到的结果就是同一份 —— 判定只取决于 now 与数据，**与 tick 的频率无关**。
//
// 规则（用户 2026-10-27 定稿）：
//   ① 每个条目只属于一个方向：kind=end（结束）/ start（开始），T = 该方向的绝对时刻。
//   ② 该方向的节点集合 n ∈ config.endNodes / startNodes；节点 n 的到期时刻 = T - n 小时。
//   ③ now >= T - n 小时 且 n 未被发过 ⇒ 候选。
//   ④ 同一条目（同 key：同一 gameId|side|kind|T）同时有多个节点到期 ⇒ **只发最紧急的**（n 最小），
//      其余到期节点一并标成已发 —— 不补发风暴、不刷屏。
//   ⑤ T 已过（条目已结束 / 已开始）⇒ 整条记录作废，不发，状态里的键一并清掉。
//
// state 的形状（与 state.json 一致，纯数据、可直接 JSON 序列化）：
//   { "ba-jp|event|end|1793113200000": { "fired": [72, 24] }, ... }
//   - fired 里存的是**节点小时数**，不是时间戳：同一条目补跑时能判断"哪几档已经打扰过"。
//
// 返回 { toNotify, stateNext, stats }，都是新对象：入参 items / state 一概不改。

/** 1 小时的毫秒数。tick 只认这一个时间单位。 */
export const HOUR_MS = 3600000;

/** 出厂默认节点：结束后 3 天 / 1 天 / 6 小时 / 2 小时，开始前 1 天 / 2 小时。 */
export const DEFAULT_CONFIG = Object.freeze({
	endNodes: Object.freeze([72, 24, 6, 2]),
	startNodes: Object.freeze([24, 2])
});

const VALID_KIND = new Set(["end", "start"]);

/**
 * 把节点数组规整成「去重 + 降序（宽松 → 紧急）」的正数数组。
 * 非法输入返回 fallback 的副本（fallback 也缺就返回 null），**不抛** —— 配置文件读坏了不该让提醒停摆。
 *
 * @param {unknown} value
 * @param {{ fallback?: readonly number[] | null }} [opts]
 * @returns {number[] | null}
 */
export function normalizeNodes(value, { fallback = null } = {}) {
	if (!Array.isArray(value)) return fallback ? [...fallback] : null;
	const out = [];
	for (const raw of value) {
		const n = typeof raw === "string" ? Number(raw.trim()) : raw;
		if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) continue;
		if (!out.includes(n)) out.push(n);
	}
	if (!out.length) return fallback ? [...fallback] : null;
	out.sort((a, b) => b - a);
	return out;
}

/**
 * 把「可能不完整 / 可能脏」的配置补成完整的两套节点。
 * 只认 endNodes / startNodes 两个键（面板以后要加别的键，走独立字段，别往这里塞）。
 *
 * @param {{ endNodes?: unknown, startNodes?: unknown } | null | undefined} input
 * @returns {{ endNodes: number[], startNodes: number[] }}
 */
export function normalizeConfig(input) {
	const raw = input && typeof input === "object" ? input : {};
	const endNodes = normalizeNodes(raw.endNodes, { fallback: DEFAULT_CONFIG.endNodes });
	const startNodes = normalizeNodes(raw.startNodes, { fallback: DEFAULT_CONFIG.startNodes });
	return {
		endNodes: endNodes || [...DEFAULT_CONFIG.endNodes],
		startNodes: startNodes || [...DEFAULT_CONFIG.startNodes]
	};
}

/**
 * 条目的去重键。条目自带的 key 优先（derive 生成时就把方向与 T 编码进去了），
 * 否则按同一个规则现拼 —— 保证「同一条目」在任何宿主里都得到同一个键。
 *
 * @param {{ key?: string, gameId: string, side: string, kind: string, T: number }} item
 * @returns {string}
 */
export function stateKeyOf(item) {
	if (item && typeof item.key === "string" && item.key) return item.key;
	return String(item.gameId) + "|" + String(item.side) + "|" + String(item.kind) + "|" + String(item.T);
}

/** 从键的末段取回 T（毫秒时间戳）。取不到返回 NaN。 */
export function tOfKey(key) {
	const tail = String(key).split("|").pop();
	const n = Number(tail);
	return Number.isFinite(n) ? n : NaN;
}

const KEY_RE = /^[^|]+\|[^|]+\|(?:end|start)\|\d+$/;

/**
 * 状态文件的防御性归一：只保留本模块认识的键与 fired 数组，丢弃空记录 / 垃圾键。
 * 读坏的状态文件不该让提醒停摆，也不该被原样写回。
 *
 * @param {unknown} state
 * @returns {Record<string, { fired: number[] }>}
 */
export function normalizeState(state) {
	const out = {};
	if (!state || typeof state !== "object" || Array.isArray(state)) return out;
	for (const [key, value] of Object.entries(state)) {
		if (!KEY_RE.test(key)) continue;
		const firedRaw = value && typeof value === "object" ? value.fired : null;
		const fired = Array.isArray(firedRaw)
			? firedRaw.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
			: [];
		if (!fired.length) continue; // 没有已发节点的记录没有信息量
		out[key] = { fired: [...new Set(fired)].sort((a, b) => b - a) };
	}
	return out;
}

function normalizeLimit(value) {
	if (value === void 0 || value === null) return Infinity;
	const n = Number(value);
	if (!Number.isFinite(n) || n < 0) throw new TypeError("tick: limit 必须是 ≥ 0 的数字");
	return Math.floor(n);
}

/**
 * 一轮判定。**纯函数**：同样的 (now, items, config, state, options) ⇒ 同样的返回值。
 *
 * @param {number} now 当前毫秒时间戳（由宿主提供 —— tick 自己不看表）
 * @param {Array<{key?: string, gameId: string, side: string, sideLabel?: string, kind: "end"|"start",
 *   title?: string, T: number, startTs?: number, endTs?: number, gameName?: string}>} items
 * @param {{ endNodes?: unknown, startNodes?: unknown }} [config] 节点配置（缺省用内置默认）
 * @param {Record<string, { fired?: number[] }>} [state] 上次运行留下的已发状态
 * @param {{ limit?: number, ignoreState?: boolean }} [options]
 *   - limit：最多产生几条通知（默认不限）。**被截断的条目不记已发**，留给下一轮。
 *   - ignoreState：忽略「已发」标记（对应 CLI 的 --all）；同一轮内仍只发最紧急的一档。
 * @returns {{
 *   toNotify: Array<Record<string, unknown>>,
 *   stateNext: Record<string, { fired: number[] }>,
 *   stats: Record<string, number>
 * }}
 */
export function tick(now, items, config = {}, state = {}, options = {}) {
	const nowTs = Number(now);
	if (!Number.isFinite(nowTs)) throw new TypeError("tick: now 必须是有限毫秒时间戳");
	const cfg = normalizeConfig(config);
	const limit = normalizeLimit(options.limit);
	const ignoreState = options.ignoreState === true;

	const statePrev = normalizeState(state);
	const stateNext = {};

	const stats = {
		items: 0,
		duplicateKeys: 0,
		end: 0,
		start: 0,
		passedT: 0,
		expiredKeys: 0,
		stateKeysBefore: Object.keys(statePrev).length,
		stateKeys: 0,
		duePairs: 0,
		alreadyFiredPairs: 0,
		collapsed: 0,
		notified: 0,
		limitedOut: 0
	};

	// ① 先清理：状态里 T 已过的键作废（条目都结束了，记录不再需要）。
	//    注意规则只按「键里的 T」判，不看条目是否还在本轮数据里 —— 数据源掉线也不会误删未过期的记录。
	for (const [key, rec] of Object.entries(statePrev)) {
		const T = tOfKey(key);
		if (!Number.isFinite(T) || T <= nowTs) {
			stats.expiredKeys++;
			continue;
		}
		stateNext[key] = { fired: [...rec.fired] };
	}

	// ② 同 key 的条目只留一条（derive 正常不会产生重复，但宿主可能把两套数据拼在一起）。
	const order = [];
	const byKey = new Map();
	for (const rawItem of Array.isArray(items) ? items : []) {
		if (!rawItem || typeof rawItem !== "object") continue;
		const key = stateKeyOf(rawItem);
		if (byKey.has(key)) {
			stats.duplicateKeys++;
			continue;
		}
		const kind = VALID_KIND.has(rawItem.kind) ? rawItem.kind : "end";
		const item = { ...rawItem, key, kind, T: Number(rawItem.T) };
		byKey.set(key, item);
		order.push(key);
		stats.items++;
		stats[kind]++;
	}

	// ③ 逐条判节点。
	const plans = [];
	for (const key of order) {
		const item = byKey.get(key);
		const T = item.T;
		if (!Number.isFinite(T)) {
			stats.passedT++;
			delete stateNext[key];
			continue;
		}
		if (T <= nowTs) {
			// 规则⑤：T 已过 ⇒ 整条记录作废，不发（也不留键）。
			stats.passedT++;
			delete stateNext[key];
			continue;
		}
		const nodes = item.kind === "start" ? cfg.startNodes : cfg.endNodes;
		const firedPrev = new Set(ignoreState ? [] : stateNext[key] ? stateNext[key].fired : []);
		const due = [];
		for (const n of nodes) {
			if (firedPrev.has(n)) {
				stats.alreadyFiredPairs++;
				continue;
			}
			if (nowTs >= T - n * HOUR_MS) due.push(n);
		}
		if (!due.length) continue;
		// 规则④：n 最小的最紧急；同一个条目的其余到期节点一并标已发（不单独打扰）。
		due.sort((a, b) => a - b);
		const node = due[0];
		const prevFired = stateNext[key] ? stateNext[key].fired : [];
		stateNext[key] = {
			fired: [...new Set([...prevFired, ...due])].sort((a, b) => b - a)
		};
		stats.duePairs += due.length;
		stats.collapsed += due.length - 1;
		plans.push({
			key,
			item,
			node,
			due,
			extra: due.slice(1),
			dueAt: T - node * HOUR_MS
		});
	}

	// ④ 排序：最早截止的排前面（--limit 的预算优先给最近的事），同 T 时先发最紧急的档。
	plans.sort((a, b) => a.item.T - b.item.T || a.node - b.node || a.key.localeCompare(b.key));
	const selected = limit === Infinity ? plans : plans.slice(0, limit);
	stats.limitedOut = plans.length - selected.length;
	stats.notified = selected.length;

	// ⑤ 被 limit 截断的条目：本次没有送达，**不能**记已发（否则会静默漏掉）。
	const selectedKeys = new Set(selected.map((p) => p.key));
	for (const plan of plans) {
		if (selectedKeys.has(plan.key)) continue;
		if (statePrev[plan.key]) stateNext[plan.key] = { fired: [...statePrev[plan.key].fired] };
		else delete stateNext[plan.key];
	}

	stats.stateKeys = Object.keys(stateNext).length;

	const toNotify = selected.map((plan) => {
		const it = plan.item;
		return {
			key: plan.key,
			gameId: it.gameId,
			gameName: it.gameName || it.gameId,
			side: it.side,
			sideLabel: it.sideLabel || it.side,
			kind: it.kind,
			title: it.title || it.gameName || it.gameId,
			T: it.T,
			node: plan.node,
			dueAt: plan.dueAt,
			nodesMarked: [...plan.due],
			collapsedNodes: [...plan.extra],
			startTs: it.startTs,
			endTs: it.endTs,
			raw: it.raw
		};
	});

	return { toNotify, stateNext, stats };
}
