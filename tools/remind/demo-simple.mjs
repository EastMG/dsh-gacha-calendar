#!/usr/bin/env node
// tools/remind/demo-simple.mjs —— 「缓存优先」的单一路径 demo（独立脚本，**不进插件本体**）
//
// 只有一条路，没有快照、没有多源降级、没有花式参数：
//
//   每轮：
//     ① 读本地缓存 cache.json
//          没有 / 超过 TTL（默认 6 小时）/ --refresh ⇒ 用 core 抓一次并写回缓存
//     ② 用缓存里的数据判到期（双向：即将结束 / 即将开始，窗口默认 2 小时）
//     ③ 有命中 ⇒ 弹系统通知（去重：同一件事只弹一次）
//
// 与 demo.mjs 的分工：demo.mjs 演示「数据从哪来」（每轮都现场抓一遍）；
// 本文件演示「一轮怎么跑才便宜」（同一份判定/去重/送达逻辑，数据换成缓存）。
// 两个文件都留着，方便对照。判定与送达**不是重写的** —— 见下面「复制自 demo.mjs」一节的说明。
//
// 用法：
//   node tools/remind/demo-simple.mjs --dry-run                # 首次：缓存不存在 → 抓取
//   node tools/remind/demo-simple.mjs --dry-run                # 再跑：命中缓存（0 分钟前）
//   node tools/remind/demo-simple.mjs --dry-run --hours=336    # 14 天窗口（命中会多很多）
//   node tools/remind/demo-simple.mjs --refresh --dry-run      # 强制重抓
//   node tools/remind/demo-simple.mjs --limit=1                # 真弹一条
//
// 零依赖：只用 node 内置模块 + Windows 自带的 Windows PowerShell 5.1。
// 不改 src/、不改测试、不动版本号 —— 这是 demo。

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine } from "../../packages/core/core.mjs";

// ── 常量与路径 ────────────────────────────────────────────────────────────────
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOAST_SCRIPT = path.join(HERE, "toast.ps1");
const LOCAL_APP_DATA = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");

// 缓存：%LOCALAPPDATA%\dsh-gacha-calendar\cache.json
// 结构 = { "at": 写缓存的时间戳, "source": "core", "data": <core.refresh() 的原样返回值> }
const CACHE_DIR = path.join(LOCAL_APP_DATA, "dsh-gacha-calendar");
const CACHE_FILE = path.join(CACHE_DIR, "cache.json");

// 去重状态：和 demo.mjs **同一个目录、不同文件** —— 两个 demo 各自观察，互不把对方的记录压掉。
const STATE_DIR = path.join(LOCAL_APP_DATA, "dsh-gacha-remind");
const STATE_FILE = path.join(STATE_DIR, "demo-simple-state.json");
const APP_NAME = "二游日历";

// 每个游戏的卡池侧 / 活动侧 = 一个「条目」（与面板列的「还剩 X」同源：都是那一侧的档期文本）
const SIDES = [
	{ side: "gacha", label: "卡池", titleKey: "banner", dateKey: "bannerDates", failKey: "gachaFail" },
	{ side: "event", label: "活动", titleKey: "event", dateKey: "eventDates", failKey: "eventFail" }
];

// ── 参数 ──────────────────────────────────────────────────────────────────────
function usage(stream = process.stdout) {
	stream.write(
		[
			"到期提醒 demo-simple —— 缓存优先的单一路径（独立脚本，未接入插件）",
			"",
			"用法：node tools/remind/demo-simple.mjs [选项]",
			"",
			"选项：",
			"  --hours=N      提前量（小时），默认 2；双向：结束落在窗口内 / 开始落在窗口内",
			"  --ttl-hours=N  缓存有效期（小时），默认 6；超过就重抓",
			"  --refresh      忽略缓存，强制重抓一次并写回",
			"  --dry-run      只打印，不弹系统通知、也不写去重状态（缓存仍会写）",
			"  --limit=N      最多弹几条，默认 3（0 = 只统计不弹，避免刷屏）",
			"  --help         显示本帮助",
			"",
			"缓存文件：" + CACHE_FILE,
			"去重状态：" + STATE_FILE,
			""
		].join("\n")
	);
}

function failUsage(message) {
	process.stderr.write("参数错误：" + message + "\n\n");
	usage(process.stderr);
	process.exit(2);
}

function takeNumber(value, flag, { min = 0, integer = false } = {}) {
	const n = Number(value);
	if (!Number.isFinite(n) || n < min) failUsage(flag + " 需要一个 ≥ " + min + " 的数字，收到 " + JSON.stringify(value));
	if (integer && !Number.isInteger(n)) failUsage(flag + " 需要一个整数，收到 " + JSON.stringify(value));
	return n;
}

function parseArgs(argv) {
	const opt = { hours: 2, ttlHours: 6, refresh: false, dryRun: false, limit: 3, help: false };
	for (const arg of argv) {
		if (arg === "--dry-run") opt.dryRun = true;
		else if (arg === "--refresh") opt.refresh = true;
		else if (arg === "--help" || arg === "-h" || arg === "/?") opt.help = true;
		else if (arg.startsWith("--hours=")) opt.hours = takeNumber(arg.slice("--hours=".length), "--hours", { min: 0.001 });
		else if (arg.startsWith("--ttl-hours=")) opt.ttlHours = takeNumber(arg.slice("--ttl-hours=".length), "--ttl-hours", { min: 0 });
		else if (arg.startsWith("--limit=")) opt.limit = takeNumber(arg.slice("--limit=".length), "--limit", { min: 0, integer: true });
		else if (arg === "--") continue;
		else failUsage("未知参数 " + JSON.stringify(arg));
	}
	return opt;
}

// ══════════════════════════════════════════════════════════════════════════════
// 复制自 demo.mjs（**不是重写**）—— 为什么是复制而不是 import：
//   demo.mjs 末尾有顶层 `await main(); process.exit(code)`（第 527-528 行），
//   一旦 `import "./demo.mjs"` 就会立刻把那个 demo 整体跑一遍并退出本进程，
//   所以它不提供任何可 import 的导出。这里只把**已经验证过**的那几段原样搬过来，
//   每段标注 demo.mjs 的行号，行为一致；改判定规则时两个文件要一起改。
// ──────────────────────────────────────────────────────────────────────────────

// demo.mjs L92-136：时区偏移 / 源站墙钟 → 绝对毫秒（两遍法处理 DST 边界）
const TZ_FORMATTERS = new Map();
function tzFormatter(name) {
	if (TZ_FORMATTERS.has(name)) return TZ_FORMATTERS.get(name);
	let f = null;
	try {
		f = new Intl.DateTimeFormat("en-US", {
			timeZone: name, hour12: false,
			year: "numeric", month: "2-digit", day: "2-digit",
			hour: "2-digit", minute: "2-digit", second: "2-digit"
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

// demo.mjs L142-168：档期文本 `MM-DD HH:MM ~ MM-DD HH:MM` → 绝对窗口
function parsePart(text) {
	const m = String(text || "").match(/^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
	if (!m) return null;
	const mo = Number(m[2]), d = Number(m[3]);
	const h = m[4] ? Number(m[4]) : 0, mi = m[5] ? Number(m[5]) : 0;
	if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
	return { y: m[1] ? Number(m[1]) : null, mo, d, h, mi };
}

function windowOf(raw, nowDate, tz) {
	const parts = String(raw || "").split("~").map((s) => s.trim());
	if (parts.length < 2) return null;
	const a = parsePart(parts[0]);
	const b = parsePart(parts[1]);
	if (!a || !b) return null;
	// 年份补全：源站文本多数不带年份 ⇒ 按当前年补；结束月 < 开始月 ⇒ 跨年（core 同一规则）。
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

// demo.mjs L173-180：双向判定（结束落在窗口内 = end；开始落在窗口内 = start）
function dueKindOf(startTs, endTs, nowTs, hours) {
	if (!(hours > 0)) return "";
	if (!(endTs > startTs)) return "";
	const horizon = hours * 3600000;
	if (startTs > nowTs) return startTs - nowTs <= horizon ? "start" : "";
	if (!(endTs > nowTs)) return "";
	return endTs - nowTs <= horizon ? "end" : "";
}

// demo.mjs L182-209：格式化
const pad2 = (n) => (n < 10 ? "0" + n : String(n));
const THIS_YEAR = new Date().getFullYear();
function fmtTs(ts) {
	const d = new Date(ts);
	const year = d.getFullYear() === THIS_YEAR ? "" : d.getFullYear() + "-";
	return year + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}
function fmtFull(ts) {
	const d = new Date(ts);
	return d.getFullYear() + "-" + fmtTs(ts) + ":" + pad2(d.getSeconds());
}
function localOffsetText(ts) {
	const off = -new Date(ts).getTimezoneOffset();
	const sign = off >= 0 ? "+" : "-";
	const abs = Math.abs(off);
	return "UTC" + sign + pad2(Math.floor(abs / 60)) + ":" + pad2(abs % 60);
}
function humanSpan(ms) {
	const t = Math.max(0, ms);
	const d = Math.floor(t / 86400000);
	const h = Math.floor((t % 86400000) / 3600000);
	const m = Math.floor((t % 3600000) / 60000);
	if (d > 0) return d + " 天 " + h + " 小时";
	if (h > 0) return h + " 小时 " + m + " 分";
	return Math.max(1, m) + " 分";
}

// demo.mjs L215-249：去重状态文件（键 = gameId|side|kind|时间戳；带 side 是因为卡池与活动常在
// 同一刻结束，少这段会把后一条压掉）
function loadState() {
	try {
		const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8"));
		const notified = parsed && typeof parsed.notified === "object" && parsed.notified ? parsed.notified : {};
		return { version: 1, notified };
	} catch {
		return { version: 1, notified: {} };
	}
}

function saveState(state) {
	mkdirSync(STATE_DIR, { recursive: true });
	const body = JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), notified: state.notified }, null, 2) + "\n";
	const tmp = STATE_FILE + ".tmp";
	writeFileSync(tmp, body, "utf8");
	renameSync(tmp, STATE_FILE); // 同目录 rename：原子替换
}

function keyTs(key) {
	const tail = String(key).split("|").pop();
	const n = Number(tail);
	return Number.isFinite(n) ? n : 0;
}

function pruneState(state, nowTs) {
	let dropped = 0;
	for (const key of Object.keys(state.notified)) {
		if (keyTs(key) <= nowTs) {
			delete state.notified[key];
			dropped++;
		}
	}
	return dropped;
}

// demo.mjs L252-280：送达（execFile 调 toast.ps1，失败不崩，把退出码/stderr 交回上层）
function pickPowershell() {
	if (process.platform !== "win32") return null;
	const sysRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
	const ps51 = path.join(sysRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
	return existsSync(ps51) ? ps51 : "powershell.exe";
}

function runToast(exe, { title, body }) {
	return new Promise((resolve) => {
		const args = [
			"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
			"-File", TOAST_SCRIPT,
			"-Title", title,
			"-Body", body,
			"-AppName", APP_NAME
		];
		execFile(exe, args, { windowsHide: true, timeout: 30000 }, (err, stdout, stderr) => {
			resolve({
				ok: !err,
				code: err && typeof err.code === "number" ? err.code : err ? 1 : 0,
				stdout: String(stdout || "").trim(),
				stderr: String(stderr || "").trim() || (err ? String(err.message || "") : "")
			});
		});
	});
}

// demo.mjs L515-525：通知文案
function toastTitleOf(it) {
	return (it.kind === "end" ? "即将结束 · " : "即将开始 · ") + it.gameName;
}

function toastBodyLines(it, nowTs) {
	const title = it.sideLabel + "「" + (it.title || it.gameName) + "」";
	if (it.kind === "end") {
		return [title, fmtTs(it.startTs) + " → " + fmtTs(it.endTs) + " 结束", "还剩 " + humanSpan(it.endTs - nowTs) + "（" + fmtTs(it.endTs) + " 截止）"];
	}
	return [title, fmtTs(it.startTs) + " 开始 · 至 " + fmtTs(it.endTs), humanSpan(it.startTs - nowTs) + "后开始"];
}

// ══════════════════════════════════════════════════════════════════════════════
// 本文件新增的部分：缓存读写 + TTL 判断（就这一件事）
// ──────────────────────────────────────────────────────────────────────────────

// 读缓存。四种结果：ok / missing / invalid / 由调用方按时钟判过期。
// 损坏（半截 JSON、缺字段）一律当"没有缓存"处理 —— 不猜、不降级。
function readCache() {
	let text;
	try {
		text = readFileSync(CACHE_FILE, "utf8");
	} catch (err) {
		if (err && err.code === "ENOENT") return { kind: "missing" };
		return { kind: "invalid", detail: String((err && err.message) || err) };
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch (err) {
		return { kind: "invalid", detail: "不是合法 JSON（" + String((err && err.message) || err) + "）" };
	}
	if (!parsed || typeof parsed !== "object") return { kind: "invalid", detail: "顶层不是对象" };
	if (!Number.isFinite(parsed.at)) return { kind: "invalid", detail: "缺 at 时间戳" };
	const data = parsed.data;
	if (!data || typeof data !== "object") return { kind: "invalid", detail: "缺 data" };
	if (!data.games || typeof data.games !== "object") return { kind: "invalid", detail: "data.games 不是对象" };
	return { kind: "ok", at: Number(parsed.at), source: String(parsed.source || ""), data };
}

// 写缓存：先写同目录 .tmp，再 rename 覆盖 —— 中途崩了也不会留下半截 JSON。
// 返回写盘那一刻的时间戳（= 下一轮算 TTL 的起点）。
function writeCache(data) {
	mkdirSync(CACHE_DIR, { recursive: true });
	const at = Date.now();
	const body = JSON.stringify({ at, source: "core", data }, null, 2) + "\n";
	const tmp = CACHE_FILE + ".tmp";
	writeFileSync(tmp, body, "utf8");
	renameSync(tmp, CACHE_FILE);
	return at;
}

// 缓存年龄的人话：验收要求的就是「0 分钟前」这种形态。
function cacheAgeText(ms) {
	const totalMin = Math.floor(Math.max(0, ms) / 60000);
	if (totalMin < 1) return "0 分钟前";
	if (totalMin < 60) return totalMin + " 分钟前";
	const h = Math.floor(totalMin / 60);
	const m = totalMin % 60;
	return h + " 小时" + (m ? " " + m + " 分钟" : "") + "前";
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
async function main() {
	const opt = parseArgs(process.argv.slice(2));
	if (opt.help) {
		usage();
		return 0;
	}

	const t0 = Date.now();
	const nowDate = new Date();
	const nowTs = nowDate.getTime();
	const ttlMs = opt.ttlHours * 3600000;

	console.log("二游日历 · 到期提醒 demo-simple（缓存优先 · 单一路径）");
	console.log("  时间：" + fmtFull(nowTs) + "（" + localOffsetText(nowTs) + "，" + (Intl.DateTimeFormat().resolvedOptions().timeZone || "本机时区") + "）");
	console.log("  窗口：" + opt.hours + " 小时（双向：即将结束 / 即将开始）");
	console.log("  缓存：" + CACHE_FILE + "（TTL " + opt.ttlHours + " 小时）");
	console.log("  去重：" + STATE_FILE);
	console.log("  上限：" + opt.limit + " 条");
	console.log("  模式：" + (opt.dryRun ? "干跑（只打印，不弹通知、不写去重状态）" : "真实送达（弹系统通知）"));
	console.log("");

	// 引擎实例只用来「抓数据」；建实例本身不联网（tz 注册表是代码元信息，本地就有）。
	const engine = createEngine({
		transport: {
			async fetchRaw(url, opts) {
				return fetch(url, opts);
			},
			async fetchViaProxy(url, { referer, headers, body, contentType } = {}) {
				const h = { Accept: "application/json" };
				if (referer) h.Referer = referer;
				if (headers && typeof headers === "object") Object.assign(h, headers);
				const init = { headers: h, method: body !== void 0 ? "POST" : "GET" };
				if (body !== void 0) {
					const ct = contentType || "application/json; charset=utf-8";
					h["Content-Type"] = ct;
					init.body = typeof body === "string" ? body : JSON.stringify(body);
				}
				const res = await fetch(url, init);
				if (!res.ok) throw new Error("proxy-http-" + res.status);
				return await res.text();
			}
		},
		// 一轮数据就够：内存 Map，不落盘（缓存由本文件自己写）
		storage: (() => {
			const map = new Map();
			return {
				async get(key) { return map.get(key); },
				async set(key, value) { map.set(key, value); }
			};
		})(),
		now: () => Date.now()
	});

	const sources = (engine.__test && engine.__test.SOURCES) || [];
	const tzById = new Map(sources.map((s) => [s.id, s.tz === void 0 ? null : s.tz]));
	const hiddenIds = sources.filter((s) => s.defaultHidden).map((s) => s.id);

	// [1/3] 数据来源：缓存 or 抓取（**唯一**的分支）
	console.log("[1/3] 数据来源");
	const cached = readCache();
	let data;
	let fetchMs = 0;
	let cacheAgeMs = -1;
	let reasonToFetch = "";

	if (opt.refresh) reasonToFetch = "--refresh 强制刷新";
	else if (cached.kind === "missing") reasonToFetch = "缓存不存在";
	else if (cached.kind === "invalid") reasonToFetch = "缓存损坏（" + cached.detail + "）";
	else {
		cacheAgeMs = nowTs - cached.at;
		if (cacheAgeMs >= ttlMs) reasonToFetch = "缓存过期（" + humanSpan(cacheAgeMs) + " > TTL " + opt.ttlHours + " 小时）";
	}

	let origin;
	if (reasonToFetch) {
		console.log("  ✗ " + reasonToFetch + " ⇒ 抓取（core 直连，与插件 UI 同源）");
		const tf = Date.now();
		try {
			data = await engine.refresh();
		} catch (err) {
			console.error("  ✗ 抓取整轮失败：" + String((err && err.message) || err));
			console.error("    （core 的单条目失败不会抛到这里；能抛到这里说明是引擎级异常）");
			console.error("    本轮不写缓存、不弹通知 —— 下一轮会再试。");
			return 1;
		}
		fetchMs = Date.now() - tf;
		const n = Object.keys(data.games || {}).length;
		const down = Object.values(data.games || {}).filter((g) => (g.gachaFail && g.gachaFail.kind === "down") || (g.eventFail && g.eventFail.kind === "down")).length;
		console.log("  ✓ 抓取完成 " + fetchMs + " ms / " + n + " 条记录" + (down ? "（其中 " + down + " 条有侧抓取失败）" : ""));
		const at = writeCache(data);
		console.log("  ✓ 已写缓存 " + fmtFull(at) + "（tmp + rename 原子替换）");
		origin = "抓取";
	} else {
		cacheAgeMs = Math.max(0, nowTs - cached.at);
		data = cached.data;
		console.log("  ✓ 命中缓存（" + cacheAgeText(cacheAgeMs) + "）→ 本轮不抓网络");
		console.log("  · 缓存写于 " + fmtFull(cached.at) + " · TTL " + opt.ttlHours + " 小时");
		origin = "缓存";
	}

	console.log("  → 本轮来源：" + origin + (origin === "抓取" ? "（抓取耗时 " + fetchMs + " ms）" : "（缓存年龄 " + cacheAgeText(cacheAgeMs) + "）"));
	if (opt.dryRun && origin === "抓取") console.log("  · 干跑也会写缓存：下一轮就能走缓存（这正是验收第 2 步要看的效果）");
	if (hiddenIds.length) console.log("  · 本轮未抓取（出厂默认隐藏，设置里没勾选）：" + hiddenIds.join("、"));
	console.log("");

	// [2/3] 判定（用缓存里的档期文本 + 源站 tz 还原绝对时刻）
	const games = data.games || {};
	const candidates = [];
	const unparsed = [];
	for (const [id, g] of Object.entries(games)) {
		const tz = tzById.has(id) ? tzById.get(id) : null;
		for (const s of SIDES) {
			const title = String(g[s.titleKey] || "").trim();
			const raw = String(g[s.dateKey] || "").trim();
			if (!raw) continue; // 这一侧没有档期文本（未公布 / 抓取失败 / 未抓取）
			const w = windowOf(raw, nowDate, tz);
			if (!w) {
				unparsed.push({ name: g.name || id, side: s.label, raw });
				continue;
			}
			const kind = dueKindOf(w.startTs, w.endTs, nowTs, opt.hours);
			const dueTs = kind === "start" ? w.startTs : w.endTs;
			candidates.push({
				key: id + "|" + s.side + "|" + (kind || "none") + "|" + dueTs,
				gameId: id,
				gameName: g.name || id,
				side: s.side,
				sideLabel: s.label,
				title,
				startTs: w.startTs,
				endTs: w.endTs,
				kind,
				dueTs,
				dueMs: kind ? dueTs - nowTs : 0
			});
		}
	}

	const hits = candidates.filter((c) => c.kind).sort((a, b) => a.dueMs - b.dueMs || a.key.localeCompare(b.key));

	console.log("[2/3] 判定到期（窗口 " + opt.hours + " 小时）");
	console.log("  · 读到的条目：" + Object.keys(games).length + " 个游戏 · 能还原绝对档期的 " + candidates.length + " 条" + (unparsed.length ? " · 读不出档期的 " + unparsed.length + " 条" : ""));
	if (unparsed.length) {
		for (const u of unparsed.slice(0, 3)) console.log("    - 读不出：" + u.name + " / " + u.side + "：" + u.raw);
		if (unparsed.length > 3) console.log("    - （其余 " + (unparsed.length - 3) + " 条略）");
	}

	const state = loadState();
	const dropped = pruneState(state, nowTs);
	const skipped = [];
	const pending = [];

	console.log("  命中窗口（" + opt.hours + " 小时内）：" + hits.length + " 条" + (dropped > 0 ? "　[过期去重项已清理 " + dropped + " 条]" : ""));
	for (const it of hits) {
		const kindLabel = it.kind === "end" ? "即将结束" : "即将开始";
		const when = it.kind === "end" ? fmtTs(it.endTs) + " 结束" : fmtTs(it.startTs) + " 开始";
		const left = humanSpan(it.dueMs);
		const stamp = state.notified[it.key];
		if (stamp) {
			skipped.push(it);
			console.log("  ↷ 已通知过，跳过 · [" + kindLabel + "] " + it.gameName + " / " + it.sideLabel + " · " + when + "（" + stamp + "）");
			continue;
		}
		console.log("  ✓ [" + kindLabel + "] " + it.gameName + " / " + it.sideLabel + " · " + when + "（还剩 " + left + "）");
		pending.push(it);
	}
	if (!hits.length) {
		// 窗口外最近到期的几条，方便判断是"参数太小"还是"真没有"
		const soon = candidates.slice().sort((a, b) => a.endTs - b.endTs).filter((c) => c.endTs > nowTs).slice(0, 5);
		console.log("  （无）");
		if (soon.length) {
			console.log("  窗口外最近的 5 条（把 --hours 调大就能命中）：");
			for (const it of soon) console.log("    - " + it.gameName + " / " + it.sideLabel + " · " + fmtTs(it.endTs) + " 结束（" + humanSpan(it.endTs - nowTs) + " 后）");
		}
	}
	console.log("");

	// [3/3] 送达（有命中才弹；去重靠状态文件）
	console.log("[3/3] 送达" + (opt.dryRun ? "（干跑）" : ""));
	const picked = pending.slice(0, opt.limit);
	const overLimit = pending.length - picked.length;
	const summary = (delivered, failed) =>
		"汇总：本轮来源 " + origin + (origin === "抓取" ? "（" + fetchMs + " ms）" : "") +
		" · 命中 " + hits.length +
		" · 去重跳过 " + skipped.length +
		" · 计划弹 " + picked.length +
		" · 实弹 " + delivered +
		" · 失败 " + failed +
		" · 总用时 " + (Date.now() - t0) + " ms";

	if (opt.dryRun) {
		if (!picked.length) {
			console.log(pending.length === 0
				? "  本会弹出 0 条（窗口内没有需要送达的条目）"
				: "  本会弹出 0 条（--limit=0，只统计不弹；待送达 " + pending.length + " 条）");
		}
		for (let i = 0; i < picked.length; i++) {
			const it = picked[i];
			console.log("  将要弹出 " + (i + 1) + "/" + picked.length + "：" + toastTitleOf(it));
			for (const line of toastBodyLines(it, nowTs)) console.log("    │ " + line);
		}
		if (overLimit > 0) console.log("  （另有 " + overLimit + " 条被 --limit 截断）");
		console.log("  干跑：不发通知、不写去重状态。");
		console.log("");
		console.log(summary(0, 0));
		return 0;
	}

	if (!picked.length) {
		console.log("  没有需要送达的条目（窗口内命中 " + hits.length + " 条，去重跳过 " + skipped.length + " 条）。");
		console.log("");
		console.log(summary(0, 0));
		return 0;
	}

	const exe = pickPowershell();
	if (!exe) {
		console.log("  ✗ 当前平台不是 Windows，toast 送达不可用。");
		console.log("");
		console.log(summary(0, picked.length));
		return 1;
	}
	if (!existsSync(TOAST_SCRIPT)) {
		console.log("  ✗ 找不到 " + TOAST_SCRIPT);
		return 1;
	}

	let delivered = 0;
	let failed = 0;
	for (let i = 0; i < picked.length; i++) {
		const it = picked[i];
		const title = toastTitleOf(it);
		const body = toastBodyLines(it, Date.now()).join("\\n"); // toast.ps1 用字面 \n 拆行
		const res = await runToast(exe, { title, body });
		if (res.ok) {
			delivered++;
			state.notified[it.key] = new Date().toISOString();
			console.log("  ✓ 已送达 " + (i + 1) + "/" + picked.length + "：" + title);
			console.log("    " + fmtTs(it.startTs) + " → " + fmtTs(it.endTs) + " · " + it.title);
		} else {
			failed++;
			console.log("  ✗ 送达失败（退出码 " + res.code + "）：" + title);
			if (res.stderr) console.log("    " + res.stderr.split(/\r?\n/).join("\n    "));
			if (res.stdout) console.log("    stdout: " + res.stdout);
		}
	}
	if (overLimit > 0) console.log("  （另有 " + overLimit + " 条被 --limit 截断，未送达也不记状态）");

	// 只在真的有成功送达时写状态（失败不记 ⇒ 下一轮还会再试，不会静默漏掉）
	if (delivered > 0) {
		saveState(state);
		console.log("  去重状态已更新：" + STATE_FILE + "（" + Object.keys(state.notified).length + " 条记录）");
	}
	console.log("");
	console.log(summary(delivered, failed));
	return failed > 0 ? 1 : 0;
}

const code = await main();
process.exit(code);
