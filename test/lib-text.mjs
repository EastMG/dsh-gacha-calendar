// test/lib-text.mjs —— 悬停文本的**共用判定**（文案不变量只有一份实现）
//
// ── 为什么要有这个文件 ──
// 明日方舟那套「两阶段（活动 / 奖励领取）+ 双 deadline + 名称去重 + 悬停格式」的回归有**两处**在用：
//   · `cases-arknights-claim.mjs` ⑥ —— 2026-11-07 真机 bug 的**逐字基线**（那一版悬停读起来是什么样）；
//   · `cases-arknights-timeline.mjs` —— 一整个活动周期里**每个时刻**都要成立的结构性不变量
//     （同一行不许出现两次 / 相邻行不许完全相同 / 不许「名称单独一行 ⏎ 下一行只有区间」）。
// 如果两份各写一套谓词，改规则时必然只改一处 —— 2026-10-03 的悬停三条形态判定就踩过同性质的坑
// （三个用例文件各写各的，其中两处把「折叠式」误判成不合规，见 `harness.mjs` 的 assertHoverConvention 注释）。
// 所以：**谓词 + 断言** 都放这里，两个用例文件都 import 这一份。
//
// ── 加新东西时该改哪里 ──
//   · 只是"又有一个游戏要判同样的悬停形态" ⇒ 直接 `import { assertHoverTextInvariants }` 用，别复制；
//   · 悬停**新增合法形态**（例如以后允许第三行说明）⇒ 改本文件 `assertHoverTextInvariants` 里的
//     `singleActivity` 分支，并同步 `harness.mjs` 的 `assertHoverConvention`（那一条守的是"悬停只许有名称与档期"）；
//   · 新增"只进提示框"的提示行（如 `… 兑换截止`）⇒ 在 `NOTE_LINE` 旁边加正则，别在用例里另写一份。

import { check } from "./harness.mjs";

// 纯档期行（`MM-DD HH:MM ~ MM-DD HH:MM`，两端可带 4 位年份 = 跨年窗口）。
// 一行**只有区间**、没有名称：在活动侧它就是"名称被单独甩到上一行"的痕迹。
export const PURE_WINDOW_LINE = /^(?:\d{4}-)?\d{2}-\d{2} \d{2}:\d{2} ~ (?:\d{4}-)?\d{2}-\d{2} \d{2}:\d{2}$/;
// 活动侧「名称 + **3 个空格** + 档期」行（`buildEventHover` 的唯一排版）。
export const SHARED_EVENT_LINE = /^(\S.*?)   ((?:\d{4}-)?\d{2}-\d{2} \d{2}:\d{2} ~ (?:\d{4}-)?\d{2}-\d{2} \d{2}:\d{2})$/;
// 「只进提示框」的单条截止日提示行：`<活动标签> 兑换截止   MM-DD HH:MM`。
// 注意与**兑换期主行**区分：主行是「… 兑换截止   MM-DD HH:MM ~ MM-DD HH:MM」（带完整区间，合法）。
export const NOTE_LINE = /^(\S.*) 兑换截止   (\d{2}-\d{2} \d{2}:\d{2})$/;

/** 非空行（悬停文本按行是一个数组，空行一律不参与判定）。 */
export function linesOf(text) {
	return String(text == null ? "" : text).split("\n").filter((l) => l !== "");
}

/** 整段文本里**出现两次及以上**的行（去重断言：任意一行不许重复）。 */
export function dupLinesOf(text) {
	const seen = new Set(), dup = [];
	for (const l of linesOf(text)) {
		if (seen.has(l)) dup.push(l);
		seen.add(l);
	}
	return dup;
}

/** **相邻两行完全相同**的行（第二个及之后的重复行）。 */
export function consecutiveDupOf(text) {
	const L = linesOf(text), out = [];
	for (let i = 1; i < L.length; i++) if (L[i] === L[i - 1]) out.push(L[i]);
	return out;
}

/** 「名称单独一行 ⏎ 下一行只有区间」这种两行形态（= 旧实现追加 `title` + `rawSrc` 的形状）。 */
export function bareTwoLineFormOf(text) {
	const L = linesOf(text), out = [];
	for (let i = 0; i + 1 < L.length; i++) if (PURE_WINDOW_LINE.test(L[i + 1])) out.push(L[i] + " ⏎ " + L[i + 1]);
	return out;
}

/** 纯档期行（只有区间、没有名称的那些行）。 */
export function windowLinesOf(text) {
	return linesOf(text).filter((l) => PURE_WINDOW_LINE.test(l));
}

/** 「名称 + 3 空格 + 档期」行 → `[{ label, win }]`（悬停里那些**活动条目**行）。 */
export function eventRowsOf(text) {
	const out = [];
	for (const l of linesOf(text)) {
		const m = l.match(SHARED_EVENT_LINE);
		if (m) out.push({ label: m[1], win: m[2] });
	}
	return out;
}

/** 「… 兑换截止   MM-DD HH:MM」提示行 → `[{ label, deadline }]`（只进提示框的那些行）。 */
export function noteRowsOf(text) {
	const out = [];
	for (const l of linesOf(text)) {
		const m = l.match(NOTE_LINE);
		if (m) out.push({ label: m[1], deadline: m[2] });
	}
	return out;
}

/**
 * `eventHoverExtra`（每两条一组：① 标签做锚点 ② 提示行）→ 锚点标签数组。
 * 奇数长度时最后那个落单的锚点也算进来（宁可多判，也不能默默放过一条对不上的锚点）。
 */
export function noteAnchorsOf(extra) {
	const L = String(extra == null ? "" : extra).split("\n").filter((l) => l !== "");
	const out = [];
	for (let i = 0; i < L.length; i += 2) out.push(L[i]);
	return out;
}

/**
 * 分类前缀**出现两次**的检测：`<cat>：<cat>：<name>` / `<cat>:<cat>:…` / `<cat> <cat> …`。
 *
 * 为什么不只靠 `labelOf` 的幂等性：`labelOf(cat, "<cat>：<cat>：名称")` 会**原样返回**它
 * （规则是"已带前缀就不再加"），所以幂等性**抓不到**"多加了一层"这种错。
 * 两条一起用才完整：幂等性守"同一串不会越拼越长"，本函数守"当初就不该拼第二下"。
 */
export function doubledCatPrefixOf(label, cats) {
	const s = String(label == null ? "" : label).trim().toLowerCase();
	if (!s) return "";
	for (const raw of Array.isArray(cats) ? cats : []) {
		const c = String(raw == null ? "" : raw).trim().toLowerCase();
		if (!c) continue;
		for (const sep of ["\uFF1A", ":", " "]) {
			if (s.indexOf(c + sep + c) === 0) return c + sep + c;
		}
	}
	return "";
}

/**
 * 悬停全文的三条结构不变量（每个时刻都跑，失败信息带「哪条 + 期望 + 实测」）。
 *
 * `opts.singleActivity = true`：当期只有 **1 条**活动时，`buildEventHover` 按契约返回空串
 * ⇒ UI 退回**默认两行式**「名称 ⏎ 档期」（用户 2026-11-06 定的合法形态，见 `harness.mjs`
 * 的 assertHoverConvention ①与 `cases-arknights-claim.mjs` ⑥⑦）。此时第三条判据换成
 * 「纯档期行 ≤ 1 条」——单条兜底本来就该只有一个区间，出现两条就是同一区间被重复追加了。
 */
export function assertHoverTextInvariants(label, text, opts = {}) {
	const L = linesOf(text);
	if (L.length === 0) {
		check(`${label}：悬停文本非空`, false, "不变量=非空｜期望=至少 1 行｜实测=空文本");
		return false;
	}
	const dup = dupLinesOf(text);
	check(`${label}：任意一行都不出现两次（去重断言）`, dup.length === 0,
		`不变量=行去重｜期望=0 条重复行｜实测=${JSON.stringify(dup)}`);
	const cd = consecutiveDupOf(text);
	check(`${label}：不得出现连续两行完全相同`, cd.length === 0,
		`不变量=相邻行不重复｜期望=0 条｜实测=${JSON.stringify(cd)}`);
	if (opts.singleActivity === true) {
		const wins = windowLinesOf(text);
		check(`${label}：单条活动的兜底两行式 ⇒ 纯档期行至多 1 条（同一区间不出现两次）`, wins.length <= 1,
			`不变量=档期只出现一次｜期望=≤1 条纯档期行｜实测=${JSON.stringify(wins)}`);
	} else {
		const bare = bareTwoLineFormOf(text);
		check(`${label}：不出现「名称单独一行 ⏎ 下一行只有区间」的两行形态`, bare.length === 0,
			`不变量=无 title⏎rawSrc 追加｜期望=0 条｜实测=${JSON.stringify(bare)}`);
	}
	return true;
}
