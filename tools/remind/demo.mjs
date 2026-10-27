#!/usr/bin/env node
// tools/remind/demo.mjs —— 「到期提醒（送达）」全链路 demo（独立脚本，**不进插件本体**）
//
// 链路：core 引擎现场拉一轮真实数据 → 判定「即将结束 / 即将开始」→ 状态文件去重 → toast.ps1 弹系统通知
//
// 为什么不走 `/api/gacha-calendar-snapshot.json`：见 README「已知问题」——本机 HTTP 客户端拿 403
// （带 ?token=、带浏览器同源头、真实 Chromium 导航都一样）。所以 demo 改走和插件 UI **同源**的一条路：
// 直接 import packages/core/core.mjs，用一个 node 版 transport 现场抓一轮。
//
// 用法：
//   node tools/remind/demo.mjs --dry-run                 # 默认 2 小时窗口，干跑
//   node tools/remind/demo.mjs --dry-run --hours=336     # 14 天窗口
//   node tools/remind/demo.mjs --hours=336 --limit=1     # 真弹一条
//   node tools/remind/demo.mjs --all --limit=5           # 忽略去重，强制重弹（调试用）
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
// 去重状态：%LOCALAPPDATA%\dsh-gacha-remind\demo-state.json
const STATE_DIR = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "dsh-gacha-remind");
const STATE_FILE = path.join(STATE_DIR, "demo-state.json");
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
			"到期提醒（送达）demo —— 独立脚本，未接入插件",
			"",
			"用法：node tools/remind/demo.mjs [选项]",
			"",
			"选项：",
			"  --hours=N    提前量（小时），默认 2；双向：结束落在窗口内 / 开始落在窗口内",
			"  --dry-run    只打印，不弹系统通知、也不写去重状态",
			"  --all        忽略去重，强制重弹（调试用）；仍会记录本次通知",
			"  --limit=N    最多弹几条，默认 3（0 = 只统计不弹，避免刷屏）",
			"  --help       显示本帮助",
			"",
			"去重状态文件：" + STATE_FILE,
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
	const opt = { hours: 2, dryRun: false, all: false, limit: 3, help: false };
	for (const arg of argv) {
		if (arg === "--dry-run") opt.dryRun = true;
		else if (arg === "--all") opt.all = true;
		else if (arg === "--help" || arg === "-h" || arg === "/?") opt.help = true;
		else if (arg.startsWith("--hours=")) opt.hours = takeNumber(arg.slice("--hours=".length), "--hours", { min: 0.001 });
		else if (arg.startsWith("--limit=")) opt.limit = takeNumber(arg.slice("--limit=".length), "--limit", { min: 0, integer: true });
		else if (arg === "--") continue;
		else failUsage("未知参数 " + JSON.stringify(arg));
	}
	return opt;
}

// ── 时间 / 时区 ──────────────────────────────────────────────────────────────
// 各来源的档期文本是**源站墙钟**（core 的 parser 原样保留），要还原成绝对时刻必须知道源站时区 `tz`。
// Result JSON 里没有 tz（CONTENT_FIELDS 只有文本），面板是在 UI 层用条目元信息里的 tz 换算的；
// demo 从 core 如实暴露的注册表 `__test.SOURCES` 取同一份 tz（自定义条目没有声明 ⇒ null ⇒ 本机时区）。
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

// 某时刻在 tz 的偏移（分钟，东为正）。tz 为空 / 认不出 ⇒ 本机时区。
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

// 源站墙钟（y-mo-d h:mi）→ 绝对毫秒。两遍法处理 DST 边界（与 core 的 sourceInstant 同口径）。
function wallToTs(y, mo, d, h, mi, tz) {
	const guess = Date.UTC(y, mo - 1, d, h, mi);
	const off = offsetMinutesAt(tz, guess);
	let ts = guess - off * 60000;
	const off2 = offsetMinutesAt(tz, ts);
	if (off2 !== off) ts = guess - off2 * 60000;
	return ts;
}

// ── 档期文本 → 绝对窗口 ───────────────────────────────────────────────────────
// core 的 parseDisplayRange 只认 `MM-DD HH:MM`（在闭包内，没有从公开接口暴露）。
// demo 照抄这条规则，另外**额外**接受带年份的 `YYYY-MM-DD HH:MM`（否则 uma-jp / gf2 这种
// 源站直出年份的条目会被当成「读不出档期」直接丢掉，demo 里那几条就永远不可能提醒）。
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
	// 显式写了年份的以源站为准（那种文本是精确的，别覆盖）。
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

// 双向「快到期」判定（与 core 的 dueKindOf 同语义；core 没把它放进公开接口）：
//   结束 = startTs <= now 且 endTs ∈ (now, now + 提前量]
//   开始 = startTs ∈ (now, now + 提前量]
function dueKindOf(startTs, endTs, nowTs, hours) {
	if (!(hours > 0)) return "";
	if (!(endTs > startTs)) return "";
	const horizon = hours * 3600000;
	if (startTs > nowTs) return startTs - nowTs <= horizon ? "start" : "";
	if (!(endTs > nowTs)) return "";
	return endTs - nowTs <= horizon ? "end" : "";
}

// ── 格式化 ────────────────────────────────────────────────────────────────────
const pad2 = (n) => (n < 10 ? "0" + n : String(n));
const THIS_YEAR = new Date().getFullYear();
// 跨年的窗口（如 10-19 → 2027-01-25）不写年份会看不出是哪一年，所以非本年时补上年份
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

// ── 去重状态文件 ──────────────────────────────────────────────────────────────
// 键 = `gameId|side|kind|时间戳`（时间戳 = endTs 或 startTs）。
// 为什么比需求里的 `gameId|kind|时间戳` 多一段 `side`：同一款游戏的卡池与活动**常常在同一刻结束**
// （鸣潮/绝区零的卡池与当期活动就是同一个结束时间），少一段 side 会让后一条被前一条压掉。
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
	renameSync(tmp, STATE_FILE); // 同目录 rename：原子替换，避免写一半留坏文件
}

function keyTs(key) {
	const tail = String(key).split("|").pop();
	const n = Number(tail);
	return Number.isFinite(n) ? n : 0;
}

// 顺手清理过期项：时间戳已经过去的通知记录不再需要（窗口不会再回来）。
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

// ── 送达（toast.ps1）────────────────────────────────────────────────────────
function pickPowershell() {
	if (process.platform !== "win32") return null;
	// 优先用 Windows PowerShell 5.1：toast.ps1 的 AppId 兜底用的就是它的 AUMID。
	const sysRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
	const ps51 = path.join(sysRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
	return existsSync(ps51) ? ps51 : "powershell.exe";
}

// 调 toast.ps1：-NoProfile -NonInteractive（不读用户配置、也绝不弹交互式窗口），windowsHide 不闪黑窗。
// 失败**不让调用方崩**：把退出码与 stderr 原样返回，由上层记日志。
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

// ── 主流程 ────────────────────────────────────────────────────────────────────
async function main() {
	const opt = parseArgs(process.argv.slice(2));
	if (opt.help) {
		usage();
		return 0;
	}

	const nowDate = new Date();
	const nowTs = nowDate.getTime();
	const windowMs = opt.hours * 3600000;

	console.log("二游日历 · 到期提醒（送达）demo");
	console.log("  时间：" + fmtFull(nowTs) + "（" + localOffsetText(nowTs) + "，" + (Intl.DateTimeFormat().resolvedOptions().timeZone || "本机时区") + "）");
	console.log("  提前量：" + opt.hours + " 小时（双向：结束 / 开始）");
	console.log("  去重：" + (opt.all ? "关（--all 强制重弹）" : "开") + " → " + STATE_FILE);
	console.log("  上限：" + opt.limit + " 条");
	console.log("  模式：" + (opt.dryRun ? "干跑（只打印，不弹通知、不写状态）" : "真实送达（弹系统通知）"));
	console.log("");

	// [1/4] 拉数据
	console.log("[1/4] 拉取数据（core 直连，与插件 UI 同源）");
	const engine = createEngine({
		transport: {
			// 直连源：把 WHATWG Response 原样交给 core（它自己看 ok/status/text）
			async fetchRaw(url, opts) {
				return fetch(url, opts);
			},
			// 代理源：DSH 里由宿主代发；node 里没有 CORS/Referer 反爬限制，直接发即可。
			// 契约：referer + headers + 可选 body（给了 body 就 POST）→ 返回**目标站原始 body 字符串**。
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
		// demo 只需要一轮数据，不落盘：内存 Map 足够（core 会写 lastData / lastRefresh …）
		storage: (() => {
			const map = new Map();
			return {
				async get(key) { return map.get(key); },
				async set(key, value) { map.set(key, value); }
			};
		})(),
		now: () => Date.now()
	});

	const t0 = Date.now();
	let result;
	try {
		result = await engine.refresh();
	} catch (err) {
		console.error("  ✗ 抓取整轮失败：" + String((err && err.message) || err));
		console.error("    （core 的单条目失败不会抛到这里；能抛到这里说明是引擎级异常）");
		return 1;
	}
	const elapsed = Date.now() - t0;

	const games = result.games || {};
	const ids = Object.keys(games);
	const tzById = new Map(((engine.__test && engine.__test.SOURCES) || []).map((s) => [s.id, s.tz === void 0 ? null : s.tz]));
	const hiddenIds = ((engine.__test && engine.__test.SOURCES) || []).filter((s) => s.defaultHidden).map((s) => s.id);

	let gachaDown = 0, eventDown = 0, nomatch = 0;
	for (const g of Object.values(games)) {
		for (const s of SIDES) {
			const f = g[s.failKey];
			if (!f) continue;
			if (f.kind === "down") { if (s.side === "gacha") gachaDown++; else eventDown++; }
			else if (f.kind === "nomatch") nomatch++;
		}
	}

	console.log("  ✓ " + (elapsed / 1000).toFixed(1) + " 秒 / " + ids.length + " 条记录（抓取失败 " + (gachaDown + eventDown) + " 侧、未公布 " + nomatch + " 侧）");
	if (hiddenIds.length) console.log("  · 本轮未抓取（出厂默认隐藏，设置里没勾选）：" + hiddenIds.join("、"));
	console.log("");

	// [2/4] 候选
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
				unparsed.push({ id, name: g.name || id, side: s.label, raw });
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
				raw,
				tz,
				startTs: w.startTs,
				endTs: w.endTs,
				kind,
				dueTs,
				dueMs: kind ? dueTs - nowTs : 0
			});
		}
	}

	candidates.sort((a, b) => a.endTs - b.endTs || a.gameId.localeCompare(b.gameId) || a.side.localeCompare(b.side));

	console.log("[2/4] 候选（能还原出绝对档期的条目 " + candidates.length + " 条）");
	const clip = (s, n) => (s.length > n ? s.slice(0, n) + "…" : s);
	for (const it of candidates) {
		let state;
		if (nowTs < it.startTs) state = "未开始（" + humanSpan(it.startTs - nowTs) + " 后开始）";
		else if (nowTs > it.endTs) state = "已结束";
		else state = "进行中（还剩 " + humanSpan(it.endTs - nowTs) + "）";
		console.log("  · " + it.gameName + " / " + it.sideLabel + " · " + fmtTs(it.startTs) + " → " + fmtTs(it.endTs) + " · " + state + " · " + clip(it.title || "（无标题）", 26));
	}
	if (unparsed.length) {
		console.log("  · 档期读不出（源站原文不是 MM-DD HH:MM ~ MM-DD HH:MM 形态，demo 不硬猜）：" + unparsed.length + " 条");
		for (const u of unparsed.slice(0, 5)) console.log("    - " + u.name + " / " + u.side + "：" + u.raw);
	}
	console.log("");

	// [3/4] 判定 + 去重
	const hits = candidates.filter((c) => c.kind).sort((a, b) => a.dueMs - b.dueMs || a.key.localeCompare(b.key));
	const state = loadState();
	const nowState = Object.keys(state.notified).length;
	const dropped = pruneState(state, nowTs);

	console.log("[3/4] 命中窗口（" + opt.hours + " 小时内，" + hits.length + " 条）" + (dropped > 0 ? "　[过期去重项已清理 " + dropped + " 条，原 " + nowState + " 条]" : ""));
	if (!hits.length) {
		console.log("  （无）");
		// 空窗口时给点上下文：窗口外最近到期的几条，方便判断是"参数太小"还是"真没有"
		const soon = candidates.filter((c) => c.endTs > nowTs).sort((a, b) => a.endTs - b.endTs).slice(0, 5);
		if (soon.length) {
			console.log("  窗口外最近的 5 条（把 --hours 调大就能命中）：");
			for (const it of soon) console.log("    - " + it.gameName + " / " + it.sideLabel + " · " + fmtTs(it.endTs) + " 结束（" + humanSpan(it.endTs - nowTs) + " 后）");
		}
	}

	const pending = [];
	for (const it of hits) {
		const stamp = state.notified[it.key];
		const kindLabel = it.kind === "end" ? "即将结束" : "即将开始";
		const when = it.kind === "end" ? fmtTs(it.endTs) + " 结束" : fmtTs(it.startTs) + " 开始";
		if (stamp && !opt.all) {
			console.log("  ↷ 已通知过，跳过 · [" + kindLabel + "] " + it.gameName + " / " + it.sideLabel + " · " + when + "（" + stamp + "）");
			continue;
		}
		console.log("  ✓ [" + kindLabel + "] " + it.gameName + " / " + it.sideLabel + " · " + when + "（还剩 " + humanSpan(it.kind === "end" ? it.endTs - nowTs : it.startTs - nowTs) + "）");
		pending.push(it);
	}
	console.log("");

	// [4/4] 送达
	console.log("[4/4] 送达" + (opt.dryRun ? "（干跑）" : ""));
	const picked = pending.slice(0, opt.limit);
	const overLimit = pending.length - picked.length;

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
		console.log("  干跑：不发通知、不写状态文件。");
		console.log("");
		console.log("汇总：命中 " + hits.length + " · 计划弹 " + picked.length + " · 实弹 0 · 失败 0 · 总用时 " + ((Date.now() - t0) / 1000).toFixed(1) + " 秒");
		return 0;
	}

	const exe = pickPowershell();
	if (!exe) {
		console.log("  ✗ 当前平台不是 Windows，toast 送达不可用（其它步骤照常执行）");
		console.log("");
		console.log("汇总：命中 " + hits.length + " · 计划弹 " + picked.length + " · 实弹 0 · 失败 " + picked.length + " · 总用时 " + ((Date.now() - t0) / 1000).toFixed(1) + " 秒");
		return 1;
	}
	if (!existsSync(TOAST_SCRIPT)) {
		console.log("  ✗ 找不到 " + TOAST_SCRIPT);
		return 1;
	}

	let delivered = 0, failed = 0;
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
		console.log("  状态已更新：" + STATE_FILE + "（" + Object.keys(state.notified).length + " 条记录）");
	}
	console.log("");
	console.log("汇总：命中 " + hits.length + " · 去重跳过 " + (hits.length - pending.length) + " · 计划弹 " + picked.length + " · 实弹 " + delivered + " · 失败 " + failed + " · 总用时 " + ((Date.now() - t0) / 1000).toFixed(1) + " 秒");
	return failed > 0 ? 1 : 0;
}

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

const code = await main();
process.exit(code);
