// test/legacy-golden.mjs —— 「改造前」oracle 的**字面量 golden** 读取器（P5 清理，2026-11-08）
//
// ── 为什么有这个文件 ──
// P3c ~ P4 的逐字等价证据靠一批"改造前老路"的冻结 oracle（`legacyCellOf` / `legacySynthArrOf`），
// 它们跑在测试里、但**依赖产品里的死代码**：
//   · `scheduleHoverItems`（悬停文本 → [{ title, win }]）
//   · `dataArrayExtrasFromEntriesOf` 的 `win` 分支（{ title, win } → 数组条目）
// 于是"删死代码"与"保留等价性证据"互相卡住。
//
// ── 怎么解开的 ──
// 第一步：把 oracle 的**输出**跑一次、固化成 JSON 字面量（`fixtures/legacy-oracle-golden.json`）。
// 断言改成"**当前实现 == 该字面量**"—— 等价性证据从"两段代码比大小"变成"钉死的字面量"，
// 于是第二步可以删实现，证据不丢（断言条数不变）。
//
// ⚠️ 采集来源：HEAD `d3e9d35`（删除前）的 `legacy*` oracle 原样跑出来的结果，采集时给
//    `cases-core.mjs` / `cases-p3.mjs` 临时加过 `--capture-legacy`（采集代码**已随本批删除** ——
//    它依赖的 oracle 本身没了）。重采只能回到那个提交：
//        git show d3e9d35:test/cases-core.mjs  > test/cases-core.mjs
//        git show d3e9d35:test/cases-p3.mjs    > test/cases-p3.mjs
//        git show d3e9d35:test/legacy-golden.mjs > test/legacy-golden.mjs
//        node test/all.mjs --capture-legacy        # UTC 与 Asia/Shanghai 各跑一次，产物必须逐字节相同
// ⚠️ 字面量**故意不做任何归一**：JSON.stringify 原样落盘，比较时也原样比 —— 否则"改了字面量
//    仍绿"的假证据就会出现（反向证明见 README_Dev：改一个字面量 ⇒ 对应断言红）。
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { FIXTURES_DIR } from "./load.mjs";

export const LEGACY_GOLDEN_FILE = path.join(FIXTURES_DIR, "legacy-oracle-golden.json");

function readGolden() {
	if (!existsSync(LEGACY_GOLDEN_FILE)) throw new Error("缺 test/fixtures/legacy-oracle-golden.json（P5 起等价性 oracle 的唯一真源）");
	try {
		return JSON.parse(readFileSync(LEGACY_GOLDEN_FILE, "utf8"));
	} catch (e) {
		throw new Error("legacy-oracle-golden.json 解析失败（它必须是合法 JSON）：" + (e && e.message));
	}
}

/** 模块级单例：cases-core 与 cases-p3 共用同一份。 */
export const LEGACY = readGolden();
