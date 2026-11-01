// tools/remind/lib/format.mjs —— 纯格式化助手（只吃数字 / 节点，不读环境、不做 I/O）
//
// 时间一律按**本机时区**显示（与插件面板的「还剩 X」同口径）。
// 跨年的档期会补上年份：11-26 与 01-31 同时出现时，读者才不会误判年份。

const pad2 = (n) => (n < 10 ? "0" + n : String(n));

/** 紧凑时间：`MM-DD HH:MM`（非今年则补 `YYYY-`）。 */
export function fmtTs(ts) {
	const d = new Date(Number(ts));
	if (Number.isNaN(d.getTime())) return "—";
	const year = d.getFullYear() === new Date().getFullYear() ? "" : d.getFullYear() + "-";
	return year + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

/** 完整时间：`YYYY-MM-DD HH:MM:SS`。日志 / JSON 用这个。 */
export function fmtFull(ts) {
	const d = new Date(Number(ts));
	if (Number.isNaN(d.getTime())) return "—";
	return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
		" " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}

/** 本机时区偏移，形如 `UTC+08:00`。 */
export function localOffsetText(ts = Date.now()) {
	const off = -new Date(Number(ts)).getTimezoneOffset();
	const sign = off >= 0 ? "+" : "-";
	const abs = Math.abs(off);
	return "UTC" + sign + pad2(Math.floor(abs / 60)) + ":" + pad2(abs % 60);
}

/** 时长的人话：`2 天 3 小时` / `11 小时 48 分` / `7 分`。 */
export function humanSpan(ms) {
	const t = Math.max(0, Number(ms));
	const d = Math.floor(t / 86400000);
	const h = Math.floor((t % 86400000) / 3600000);
	const m = Math.floor((t % 3600000) / 60000);
	if (d > 0) return d + " 天 " + h + " 小时";
	if (h > 0) return h + " 小时 " + m + " 分";
	return Math.max(1, m) + " 分";
}

/** 单个节点的展示名：`T-24h`（小数节点原样保留，如 `T-0.5h`）。 */
export function nodeLabel(n) {
	return "T-" + String(n) + "h";
}

/** 一组节点：`T-72h / T-24h / T-6h / T-2h`；空数组给 `—`。 */
export function nodesLabel(nodes) {
	return Array.isArray(nodes) && nodes.length ? nodes.map(nodeLabel).join(" / ") : "—";
}

/** 缓存年龄的人话：`0 分钟前` / `1 小时 10 分钟前`。 */
export function cacheAgeText(ms) {
	const totalMin = Math.floor(Math.max(0, Number(ms)) / 60000);
	if (totalMin < 1) return "0 分钟前";
	if (totalMin < 60) return totalMin + " 分钟前";
	const h = Math.floor(totalMin / 60);
	const m = totalMin % 60;
	return h + " 小时" + (m ? " " + m + " 分钟" : "") + "前";
}
