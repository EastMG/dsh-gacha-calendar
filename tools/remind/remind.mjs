#!/usr/bin/env node
// tools/remind/remind.mjs —— 到期提醒（送达）主程序：CLI + 数据 + 判定 + 通知 + 日志
//
// 一次运行：
//   ① 读配置（remind-config.json / CLI 覆盖）        lib/config.mjs
//   ② 取数据（缓存优先，过期或 --refresh 才抓）      lib/data.mjs
//   ③ 派生条目（档期文本 → 绝对时刻）                lib/derive.mjs
//   ④ tick 判定（多档节点 + 去重 + 只发最紧急）      lib/tick.mjs（纯函数）
//   ⑤ 送达（toast.ps1）+ 落状态 / 日志               lib/notify.mjs / lib/state.mjs
//
// 用法见 --help；装成计划任务见 install.ps1 / README.md。
//
// 退出码：0 正常 ｜ 1 失败（抓取异常 / 送达失败 / 状态写失败 / 非 Windows 真弹） ｜ 2 参数错误

import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CACHE_FILE, CONFIG_FILE, DATA_DIR, LOG_FILE, STATE_FILE, loadData } from "./lib/data.mjs";
import { deriveItems } from "./lib/derive.mjs";
import { HOUR_MS, normalizeState, tick } from "./lib/tick.mjs";
import { readState, stateCount, writeState } from "./lib/state.mjs";
import { resolveNodeConfig } from "./lib/config.mjs";
import { notifySupport, sendOne, toastBodyLines, toastTitle } from "./lib/notify.mjs";
import { cacheAgeText, fmtFull, fmtTs, humanSpan, localOffsetText, nodeLabel, nodesLabel } from "./lib/format.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_CONFIG = path.join(HERE, "remind-config.json");
const LOG_ROTATE_BYTES = 1024 * 1024;
const CANDIDATE_LIST_CAP = 20;

// ── 参数 ──────────────────────────────────────────────────────────────────────
function usage(stream = process.stdout) {
	stream.write(
		[
			"二游日历 · 到期提醒（送达）",
			"",
			"用法：node tools/remind/remind.mjs [选项]",
			"",
			"节点（每个 T 配多档提醒）：",
			"  默认 结束 T-72h / T-24h / T-6h / T-2h，开始 T-24h / T-2h",
			"  配置文件 " + CONFIG_FILE,
			"  形如 { \"endNodes\": [72,24,6,2], \"startNodes\": [24,2] }；读不到就用内置默认",
			"",
			"选项：",
			"  --hours=N           单节点模式（调试用）：结束与开始都只留 T-Nh；与 --nodes 互斥",
			"  --nodes=72,24,6,2   结束方向的节点（覆盖配置文件）",
			"  --start-nodes=24,2  开始方向的节点（覆盖配置文件）",
			"  --ttl-hours=N       缓存有效期（小时），默认 6；超过就重抓",
			"  --refresh           忽略缓存强制重抓一次（并写回缓存）",
			"  --dry-run           只打印：不弹通知、不写状态（缓存仍会写）",
			"  --limit=N           本轮最多弹几条，默认 3（0 = 只统计不弹）；被截断的不记已发",
			"  --all               忽略状态强制重发（调试用）；同一轮内仍只发最紧急的一档",
			"  --json              stdout 输出机器可读 JSON（日志照常写文件）",
			"  --help              显示本帮助",
			"",
			"数据目录：" + DATA_DIR,
			"  缓存 cache.json · 状态 state.json · 日志 remind.log · 配置 remind-config.json",
			"",
			"退出码：0 正常 / 1 失败 / 2 参数错误",
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

function parseNodesArg(value, flag) {
	const parts = String(value)
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s !== "");
	if (!parts.length) failUsage(flag + " 需要至少一个节点，例如 " + flag + "=72,24,6,2");
	const out = [];
	for (const part of parts) {
		const n = Number(part);
		if (!Number.isFinite(n) || n <= 0) failUsage(flag + " 的每个节点必须是 > 0 的小时数，收到 " + JSON.stringify(part));
		if (!out.includes(n)) out.push(n);
	}
	out.sort((a, b) => b - a); // 宽松 → 紧急
	return out;
}

function parseArgs(argv) {
	const opt = {
		hours: null,
		endNodes: null,
		startNodes: null,
		ttlHours: 6,
		refresh: false,
		dryRun: false,
		all: false,
		limit: 3,
		json: false,
		help: false
	};
	for (const arg of argv) {
		if (arg === "--") continue;
		else if (arg === "--dry-run") opt.dryRun = true;
		else if (arg === "--refresh") opt.refresh = true;
		else if (arg === "--all") opt.all = true;
		else if (arg === "--json") opt.json = true;
		else if (arg === "--help" || arg === "-h" || arg === "/?") opt.help = true;
		else if (arg.startsWith("--hours=")) opt.hours = takeNumber(arg.slice("--hours=".length), "--hours", { min: 0.001 });
		else if (arg.startsWith("--ttl-hours=")) opt.ttlHours = takeNumber(arg.slice("--ttl-hours=".length), "--ttl-hours", { min: 0 });
		else if (arg.startsWith("--limit=")) opt.limit = takeNumber(arg.slice("--limit=".length), "--limit", { min: 0, integer: true });
		else if (arg.startsWith("--nodes=")) opt.endNodes = parseNodesArg(arg.slice("--nodes=".length), "--nodes");
		else if (arg.startsWith("--start-nodes=")) opt.startNodes = parseNodesArg(arg.slice("--start-nodes=".length), "--start-nodes");
		else failUsage("未知参数 " + JSON.stringify(arg));
	}
	if (opt.hours !== null && (opt.endNodes || opt.startNodes)) {
		failUsage("--hours 与 --nodes / --start-nodes 不能同时用（--hours 是单节点调试模式）");
	}
	return opt;
}

// ── 日志（追加；超过 1MB 轮转为 .1） ─────────────────────────────────────────
function rotateLog(file) {
	try {
		const size = statSync(file).size;
		if (size <= LOG_ROTATE_BYTES) return false;
		rmSync(file + ".1", { force: true });
		renameSync(file, file + ".1");
		return true;
	} catch (err) {
		if (err && err.code === "ENOENT") return false;
		throw err;
	}
}

function createLogger({ file, mirror }) {
	mkdirSync(path.dirname(file), { recursive: true });
	let rotated = false;
	try {
		rotated = rotateLog(file);
	} catch (err) {
		process.stderr.write("警告：日志轮转失败：" + String((err && err.message) || err) + "\n");
	}
	const buf = [];
	const stamp = () => fmtFull(Date.now());
	return {
		file,
		rotated,
		line(text = "") {
			buf.push(text === "" ? "" : "[" + stamp() + "] " + text);
			if (mirror) process.stdout.write(text + "\n");
		},
		header({ argv }) {
			const cmd = "node tools/remind/remind.mjs" + (argv.length ? " " + argv.join(" ") : "");
			buf.push("===== " + fmtFull(Date.now()) + " " + localOffsetText(Date.now()) + " ｜ " + cmd + " ｜ pid " + process.pid + " =====");
		},
		finish(code, elapsedMs) {
			buf.push("----- 退出码 " + code + " · 用时 " + elapsedMs + " ms -----");
			try {
				appendFileSync(file, buf.join("\n") + "\n", "utf8");
			} catch (err) {
				process.stderr.write("警告：日志写入失败：" + String((err && err.message) || err) + "（" + file + "）\n");
			}
		}
	};
}

function tzName() {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "本机时区";
	} catch {
		return "本机时区";
	}
}

function sourceText(source) {
	if (!source || source === "内置默认") return "内置默认";
	if (source === CONFIG_FILE) return "用户配置 " + CONFIG_FILE;
	if (source === BUNDLED_CONFIG) return "仓库示例 remind-config.json";
	if (source.startsWith("--")) return source;
	return source;
}

/** 候选列表里的节点状态：已发 / 到期 / 未到。 */
function nodeStatusText(item, nodes, now, state) {
	const fired = new Set((state[item.key] && state[item.key].fired) || []);
	return nodes
		.map((n) => nodeLabel(n) + " " + (fired.has(n) ? "已发" : now >= item.T - n * HOUR_MS ? "到期" : "未到"))
		.join(" / ");
}

function itemLine(item, now) {
	const left = humanSpan(item.T - now);
	const when = item.kind === "end" ? "结束于 " + fmtTs(item.T) : "开始于 " + fmtTs(item.T);
	return "[" + (item.kind === "end" ? "结束" : "开始") + "] " + item.gameName + " / " + item.sideLabel + "「" + item.title + "」 · " + when + "（还剩 " + left + "）";
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
async function run({ opt, argv, now, logger }) {
	const t0 = Date.now();
	const jsonBase = {
		ok: false,
		argv,
		now,
		nowISO: new Date(now).toISOString(),
		mode: opt.dryRun ? "dry-run" : "deliver",
		all: opt.all,
		limit: opt.limit
	};

	// ── 配置 ──
	const cfg = resolveNodeConfig({
		userFile: CONFIG_FILE,
		bundledFile: BUNDLED_CONFIG,
		overrides: { endNodes: opt.endNodes, startNodes: opt.startNodes, hours: opt.hours }
	});

	logger.line("二游日历 · 到期提醒（送达）");
	logger.line("  运行时间：" + fmtFull(now) + "（" + localOffsetText(now) + " / " + tzName() + "）");
	logger.line("  命令行：node tools/remind/remind.mjs" + (argv.length ? " " + argv.join(" ") : ""));
	logger.line("  节点：结束 " + nodesLabel(cfg.endNodes) + " ｜ 开始 " + nodesLabel(cfg.startNodes) + "（共 " + (cfg.endNodes.length + cfg.startNodes.length) + " 档）");
	logger.line("  配置来源：结束 ← " + sourceText(cfg.sources.end) + " ｜ 开始 ← " + sourceText(cfg.sources.start));
	for (const f of cfg.files) {
		const label = f.file === CONFIG_FILE ? "用户配置" : "仓库示例";
		logger.line("    · " + label + " " + f.file + "：" + (f.status === "ok" ? "已读" : f.status === "missing" ? "不存在" : "读不了（" + f.detail + "）"));
	}
	for (const w of cfg.warnings) logger.line("  ⚠ " + w);
	logger.line("  数据目录：" + DATA_DIR);
	logger.line("  缓存：" + path.basename(CACHE_FILE) + "（TTL " + opt.ttlHours + " 小时）· 状态：" + path.basename(STATE_FILE));
	logger.line("  日志：" + logger.file + "（追加；> 1MB 轮转为 .1" + (logger.rotated ? "；本轮已轮转" : "") + "）");
	logger.line("  模式：" + (opt.dryRun
		? "干跑（只打印，不弹通知、不写状态" + (opt.all ? "；--all 忽略去重" : "") + "）"
		: "真实送达（最多 " + opt.limit + " 条" + (opt.all ? "；--all 忽略去重" : "") + "）"));

	const loadedState = readState(STATE_FILE);
	if (loadedState.status === "invalid") {
		logger.line("  ⚠ 状态文件损坏，按空状态继续（最坏只是同一档再提醒一次）：" + loadedState.detail);
	}
	const state = normalizeState(loadedState.state);
	logger.line("  状态：" + path.basename(STATE_FILE) + "（" + stateCount(state) + " 条记录" + (loadedState.status === "missing" ? "，首次运行" : "") + "）");
	logger.line("");

	// ── [1/4] 数据 ──
	logger.line("[1/4] 数据来源");
	let d;
	try {
		d = await loadData({ now, ttlHours: opt.ttlHours, refresh: opt.refresh });
	} catch (err) {
		logger.line("  ✗ 抓取整轮失败：" + String((err && err.message) || err));
		logger.line("    （core 的单条目失败不会抛到这里；能抛到这里说明是引擎级异常）");
		logger.line("    本轮不写状态、不弹通知 —— 下一轮会再试。");
		return { exitCode: 1, json: { ...jsonBase, error: "fetch-failed", detail: String((err && err.message) || err) } };
	}
	if (d.origin === "fetch") {
		logger.line("  ✗ " + d.reasonToFetch + " ⇒ 抓取（core 直连，与插件 UI 同源）");
		logger.line("  ✓ 抓取完成 " + d.fetchMs + " ms / " + d.gamesCount + " 条记录" + (d.downCount ? "（其中 " + d.downCount + " 条有侧抓取失败）" : ""));
		logger.line("  ✓ 已写缓存 " + fmtFull(d.cacheAt) + "（tmp + rename 原子替换）");
	} else {
		logger.line("  ✓ 命中缓存（" + cacheAgeText(d.cacheAgeMs) + "）→ 本轮不抓网络");
		logger.line("  · 缓存写于 " + fmtFull(d.cacheAt) + " · TTL " + opt.ttlHours + " 小时");
	}
	if (d.hiddenIds.length) logger.line("  · 本轮未抓取（出厂默认隐藏，设置里没勾选）：" + d.hiddenIds.join("、"));
	logger.line("  → 本轮来源：" + (d.origin === "fetch" ? "抓取（" + d.fetchMs + " ms）" : "缓存（年龄 " + cacheAgeText(d.cacheAgeMs) + "）"));
	logger.line("");

	// ── [2/4] 派生 ──
	const derived = deriveItems({ data: d.data, tzById: d.tzById, now });
	const ds = derived.stats;
	logger.line("[2/4] 派生提醒条目（档期文本 → 绝对时刻）");
	logger.line("  · " + ds.games + " 个游戏 · " + ds.windows + " 条可还原档期 → " + ds.items + " 个条目（结束 " + ds.end + " / 开始 " + ds.start + "）");
	logger.line("  · 已过 T 的跳过 " + (ds.pastEnd + ds.pastStart) + " 个方向（结束 " + ds.pastEnd + " / 开始 " + ds.pastStart + "）—— 不补发");
	if (derived.unparsed.length) {
		logger.line("  · 读不出档期 " + derived.unparsed.length + " 条（不硬猜时刻）：");
		for (const u of derived.unparsed.slice(0, 5)) logger.line("    - " + u.gameName + " / " + u.sideLabel + "：" + u.raw);
		if (derived.unparsed.length > 5) logger.line("    - （其余 " + (derived.unparsed.length - 5) + " 条略）");
	}
	if (derived.items.length) {
		const shown = derived.items.slice().sort((a, b) => a.T - b.T || a.key.localeCompare(b.key));
		const cap = Math.min(shown.length, CANDIDATE_LIST_CAP);
		logger.line("  候选条目（" + shown.length + " 个，按 T 升序" + (shown.length > cap ? "只列前 " + cap + " 个；完整列表用 --json" : "") + "）：");
		for (let i = 0; i < cap; i++) {
			const it = shown[i];
			const nodes = it.kind === "start" ? cfg.startNodes : cfg.endNodes;
			logger.line("    · " + itemLine(it, now) + " 节点 " + nodeStatusText(it, nodes, now, state));
		}
		if (shown.length > cap) logger.line("    · （其余 " + (shown.length - cap) + " 个略）");
	} else {
		logger.line("  候选条目：0 个（缓存里没有可还原的档期，试试 --refresh）");
	}
	logger.line("");

	// ── [3/4] tick ──
	const ticked = tick(now, derived.items, { endNodes: cfg.endNodes, startNodes: cfg.startNodes }, state, {
		limit: opt.limit,
		ignoreState: opt.all
	});
	const { toNotify, stateNext, stats } = ticked;
	const nodeChecks = ds.end * cfg.endNodes.length + ds.start * cfg.startNodes.length;

	logger.line("[3/4] tick 判定（now = " + fmtFull(now) + "）");
	logger.line("  · 节点检查：" + nodeChecks + " 个（结束 " + ds.end + "×" + cfg.endNodes.length + " + 开始 " + ds.start + "×" + cfg.startNodes.length + "）");
	logger.line("  · 状态清理：过期键 " + stats.expiredKeys + " 个（T 已过 ⇒ 整条作废）");
	const stateAdded = Object.keys(stateNext).filter((key) => !state[key]).length;
	logger.line("  · 状态：开始 " + stats.stateKeysBefore + " 条 → 本轮判定后 " + stats.stateKeys + " 条（新增 " + stateAdded + " 条）");
	logger.line("  · 已到期且未发：" + stats.duePairs + " 个节点 · 去重跳过（节点已发过）" + stats.alreadyFiredPairs + " 个节点");
	if (stats.collapsed > 0) {
		logger.line("  · 合并：" + stats.collapsed + " 个节点与同一条目的更紧急节点同时到期 ⇒ 只发最紧急那档，其余一并记为已发");
	}
	const totalPlans = stats.notified + stats.limitedOut;
	logger.line("  · 本轮计划 " + totalPlans + " 条" + (stats.limitedOut ? "，--limit=" + opt.limit + " 截断 " + stats.limitedOut + " 条（截断的不记已发，下一轮补）" : ""));
	logger.line("");
	if (toNotify.length) {
		for (let i = 0; i < toNotify.length; i++) {
			const n = toNotify[i];
			logger.line("  ✓ [" + (n.kind === "end" ? "结束" : "开始") + " " + nodeLabel(n.node) + "] " + n.gameName + " / " + n.sideLabel + "「" + n.title + "」");
			logger.line("      " + fmtTs(n.startTs) + " → " + fmtTs(n.endTs) + " " + (n.kind === "end" ? "结束" : "开始") + " · 还剩 " + humanSpan(n.T - now));
			if (n.collapsedNodes.length) {
				logger.line("      ↳ 同时到期：" + n.collapsedNodes.map(nodeLabel).join("、") + " 与 " + nodeLabel(n.node) + " ⇒ 只发 " + nodeLabel(n.node) + "；" + n.collapsedNodes.map(nodeLabel).join("、") + " 一并记为已发（不重复打扰）");
			}
		}
	} else {
		logger.line("  （无：本轮没有到期且未发的节点）");
	}

	logger.line("");
	logger.line("  状态里已发（" + stateCount(state) + " 条记录）：");
	if (!stateCount(state)) {
		logger.line("    （无）");
	} else {
		const liveKeys = new Set(derived.items.map((it) => it.key));
		for (const key of Object.keys(state).sort()) {
			const fired = state[key].fired || [];
			const T = Number(String(key).split("|").pop());
			const live = liveKeys.has(key);
			const note = !Number.isFinite(T) ? "（键不合法）" : T <= now ? "（T 已过，本轮清理）" : live ? "（仍在提醒范围内）" : "（本轮数据里没有这个条目）";
			logger.line("    - " + key + " · 已发 " + (fired.length ? fired.map(nodeLabel).join("、") : "—") + " · T=" + (Number.isFinite(T) ? fmtTs(T) : "—") + " " + note);
		}
	}
	logger.line("");

	// ── [4/4] 送达 ──
	logger.line("[4/4] 送达" + (opt.dryRun ? "（干跑：不发通知、不写状态）" : ""));
	const results = [];
	let delivered = 0;
	let failed = 0;
	let wroteState = false;
	let stateError = null;
	let committedState = state;
	// 本机根本没法送达时（非 Windows / 缺 toast.ps1），连"已发"都不能记 —— 否则会静默漏提醒。
	// 状态清理（过期键）也一并留到下次真正跑通的那轮再落盘，不急着写。
	let mayPersist = true;

	if (opt.dryRun) {
		if (!toNotify.length) {
			logger.line(stats.limitedOut > 0
				? "  本会弹出 0 条（--limit=" + opt.limit + "，只统计不弹；待发送 " + stats.limitedOut + " 条）"
				: "  本会弹出 0 条（没有到期且未发的节点）");
		}
		for (let i = 0; i < toNotify.length; i++) {
			const n = toNotify[i];
			logger.line("  将要弹出 " + (i + 1) + "/" + toNotify.length + "：" + toastTitle(n));
			for (const line of toastBodyLines(n, now)) logger.line("    │ " + line);
		}
		if (stats.limitedOut) logger.line("  （另有 " + stats.limitedOut + " 条被 --limit 截断，本轮不发也不记状态）");
		logger.line("  干跑：不发通知、不写状态。");
	} else if (!toNotify.length) {
		if (stats.limitedOut > 0) {
			logger.line("  本轮不发：--limit=" + opt.limit + "（只统计不弹）；待发送 " + stats.limitedOut + " 条，均未记状态。");
		} else {
			logger.line("  没有需要送达的条目（本轮到期节点均已在状态里标记为已发）。");
		}
	} else {
		const support = notifySupport();
		if (!support.ok) {
			logger.line("  ✗ " + support.reason);
			logger.line("  （判定已完成，但本机无法送达；用 --dry-run 可以只看计划）");
			failed = toNotify.length;
			mayPersist = false;
		} else {
			for (let i = 0; i < toNotify.length; i++) {
				const n = toNotify[i];
				const res = await sendOne({ notify: n, exe: support.exe, now });
				results.push({ ...res, key: n.key, node: n.node });
				if (res.ok) {
					delivered++;
					logger.line("  ✓ 已送达 " + (i + 1) + "/" + toNotify.length + "：" + res.title);
					for (const line of toastBodyLines(n, now)) logger.line("    │ " + line);
				} else {
					failed++;
					logger.line("  ✗ 送达失败（退出码 " + res.code + "）：" + res.title);
					if (res.stderr) logger.line("    " + res.stderr.replace(/\r?\n/g, "\n    "));
					if (res.stdout) logger.line("    stdout: " + res.stdout);
				}
			}
			if (stats.limitedOut) logger.line("  （另有 " + stats.limitedOut + " 条被 --limit 截断，未送达也不记状态）");
		}

		// 只有真的送达成功的条目才落已发；失败的保留原状态 ⇒ 下一轮自动重试。
		const failedKeys = new Set(results.filter((r) => !r.ok).map((r) => r.key));
		let committed = stateNext;
		if (failedKeys.size) {
			committed = { ...stateNext };
			for (const key of failedKeys) {
				if (state[key]) committed[key] = state[key];
				else delete committed[key];
			}
		}
		if (mayPersist && (delivered > 0 || stats.expiredKeys > 0)) {
			try {
				writeState(STATE_FILE, committed);
				wroteState = true;
				committedState = committed;
				logger.line("  去重状态已更新：" + STATE_FILE + "（" + stateCount(committed) + " 条记录）");
			} catch (err) {
				stateError = String((err && err.message) || err);
				failed++;
				logger.line("  ✗ 状态写入失败：" + stateError);
			}
		} else {
			logger.line("  去重状态未变，不写盘。");
		}
	}

	const exitCode = failed > 0 ? 1 : 0;
	logger.line("");
	logger.line(
		"  汇总：来源 " + (d.origin === "fetch" ? "抓取" : "缓存") +
		" · 条目 " + ds.items +
		" · 到期节点 " + stats.duePairs +
		" · 合并省下 " + stats.collapsed +
		" · 去重跳过 " + stats.alreadyFiredPairs +
		" · 计划 " + totalPlans +
		" · 实弹 " + delivered +
		" · 失败 " + failed +
		" · 状态 " + (wroteState ? "已写" : opt.dryRun ? "未写（干跑）" : "未变") +
		" · 用时 " + (Date.now() - t0) + " ms" +
		"（退出码 " + exitCode + "）"
	);

	return {
		exitCode,
		json: {
			...jsonBase,
			ok: exitCode === 0,
			config: {
				endNodes: cfg.endNodes,
				startNodes: cfg.startNodes,
				sources: cfg.sources,
				files: cfg.files,
				warnings: cfg.warnings
			},
			data: {
				origin: d.origin,
				reasonToFetch: d.reasonToFetch,
				cacheFile: CACHE_FILE,
				cacheAt: d.cacheAt,
				cacheAgeMs: d.cacheAgeMs,
				fetchMs: d.fetchMs,
				games: d.gamesCount,
				down: d.downCount,
				hiddenIds: d.hiddenIds
			},
			derive: {
				games: ds.games,
				windows: ds.windows,
				items: ds.items,
				end: ds.end,
				start: ds.start,
				pastEnd: ds.pastEnd,
				pastStart: ds.pastStart,
				unparsed: derived.unparsed
			},
			tick: {
				stats,
				toNotify: toNotify.map((n) => ({
					...n,
					nodeLabel: nodeLabel(n.node),
					collapsedLabels: n.collapsedNodes.map(nodeLabel),
					dueAtISO: new Date(n.dueAt).toISOString()
				}))
			},
			notify: {
				planned: toNotify.length,
				delivered,
				failed,
				results: results.map((r) => ({ key: r.key, node: r.node, ok: r.ok, code: r.code, title: r.title, stdout: r.stdout, stderr: r.stderr }))
			},
			state: {
				file: STATE_FILE,
				before: stateCount(state),
				after: stateCount(committedState),
				written: wroteState,
				error: stateError
			},
			log: { file: logger.file, rotated: logger.rotated }
		}
	};
}

async function main() {
	const argv = process.argv.slice(2);
	const opt = parseArgs(argv);
	if (opt.help) {
		usage();
		return 0;
	}

	const t0 = Date.now();
	const now = t0; // 本轮统一用同一个 now：判定、文案、状态清理都基于它
	const logger = createLogger({ file: LOG_FILE, mirror: !opt.json });
	logger.header({ argv });

	let exitCode = 0;
	let json = null;
	try {
		const result = await run({ opt, argv, now, logger });
		exitCode = result.exitCode;
		json = result.json;
	} catch (err) {
		logger.line("✗ 运行失败：" + String((err && err.message) || err));
		if (err && err.stack) logger.line(String(err.stack).replace(/\r?\n/g, "\n    "));
		exitCode = 1;
		json = { ok: false, argv, now, nowISO: new Date(now).toISOString(), error: "crashed", detail: String((err && err.message) || err) };
	} finally {
		logger.finish(exitCode, Date.now() - t0);
	}

	if (opt.json) process.stdout.write(JSON.stringify(json || { ok: false, error: "no-result" }, null, 2) + "\n");
	return exitCode;
}

const code = await main();
process.exit(code);
