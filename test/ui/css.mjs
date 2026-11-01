// test/ui/css.mjs —— 取**真实产物 CSS**（按 build.mjs 的 CSS_ORDER 拼接）
//
// 为什么不 import "../load.mjs" 的 readStylesSource()：
// 那一份是按**文件名字典序** join 的（test/load.mjs 里写明「文件名顺序无关」—— 因为它只被
// "在拼回来的 CSS 文本里 grep 某条规则"这类静态守卫用）。渲染不一样：**层叠顺序就是产物顺序**，
// 字典序与 build.mjs 的 CSS_ORDER 不同（例如 sidebar-footer.css 必须排在最后、settings.css 在
// chip.css 之前）。所以这里读 build.mjs 里的 CSS_ORDER 清单再逐文件拼，顺序与产物逐字节一致。
//
// 两个方向的守卫都做（与 build.mjs 的 checkStyleFiles 同款）：
//   · CSS_ORDER 里的文件必须都在
//   · 目录里的每个 .css 必须都进了清单（加了文件没接线 ⇒ 样式静默不生效）
// 任一条不满足就**抛错**（不是 skip）：这不是"环境缺依赖"，是仓库自相矛盾。

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "..", "..");
export const STYLES_DIR = path.join(REPO, "src", "client", "styles");
const BUILD_MJS = path.join(REPO, "build.mjs");

/** 从 build.mjs 的源码里抽出 CSS_ORDER（不 import：build.mjs 顶层有写盘副作用）。 */
export function cssOrder() {
	let src;
	try {
		src = readFileSync(BUILD_MJS, "utf8");
	} catch (e) {
		throw new Error(`读不到 build.mjs：${BUILD_MJS}（${e && e.message}）`);
	}
	const block = /const CSS_ORDER = \[([\s\S]*?)\n\];/.exec(src);
	if (!block) {
		throw new Error("build.mjs 里找不到 `const CSS_ORDER = [...];` 块 —— 清单改名/换写法了？CSS 拼接顺序必须先同步这里（test/ui/css.mjs）");
	}
	const names = [...block[1].matchAll(/"([^"]+\.css)"/g)].map((m) => m[1]);
	if (!names.length) throw new Error("build.mjs 的 CSS_ORDER 里一个 .css 都没解析到");
	return names;
}

/** 真实产物 CSS 文本（各文件原文直接相连，与 build.mjs 的 readStyleFiles().join("") 相同）。 */
export function readProductCss() {
	const order = cssOrder();
	const present = readdirSync(STYLES_DIR).filter((f) => f.endsWith(".css")).sort();
	const missing = order.filter((f) => !present.includes(f));
	if (missing.length) throw new Error(`src/client/styles 缺少 CSS_ORDER 里的文件：${missing.join("、")}`);
	const unused = present.filter((f) => !order.includes(f));
	if (unused.length) throw new Error(`src/client/styles 有文件没进 CSS_ORDER（样式会静默不生效）：${unused.join("、")}`);
	const texts = order.map((f) => readFileSync(path.join(STYLES_DIR, f), "utf8"));
	return { text: texts.join(""), files: order, chars: texts.reduce((n, t) => n + t.length, 0) };
}

// ── 宿主的"基础样式"（不是我们的产物）────────────────────────────────────────
// 真实的 DSH 侧栏 / 面板外壳不在这 11 个 .css 里：宿主管 flex 容器、侧栏宽度、其它插件入口的
// 外边距。渲染夹具必须把这些**宿主条件**也摆出来，否则被测的 CSS 是在一个不存在的环境里量的。
// 每一段都注明它对应真机上的什么东西；**不要**在这里写任何"修 bug 用"的样式 —— 它必须是与产品
// 无关的中性宿主。
export const HOST_BASE_CSS = `
/* 宿主全局：字体、基础色（我们的规则大量用 var(--dsw-*, fallback)，缺变量时走 fallback；
   这里给一层宿主默认值，逼近真机浅色主题，同时**不**去覆盖任何 .gacha-cal-* 规则）。 */
html, body { margin: 0; padding: 0; }
body {
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei UI", sans-serif;
  font-size: 13px; line-height: 1.45; color: #1f2329; background: #fff;
  --dsw-alias-bg-base: #fff;
  --dsw-alias-bg-layer-1: #f3f4f6;
  --dsw-alias-bg-layer-2: rgba(127,127,127,.08);
  --dsw-alias-label-primary: #1f2329;
  --dsw-alias-label-secondary: #4a5261;
  --dsw-alias-label-tertiary: #6b7280;
  --dsw-alias-border-l1: rgba(127,127,127,.25);
  --dsw-alias-border-l2: rgba(127,127,127,.4);
  --dsw-alias-interactive-bg-hover: rgba(127,127,127,.1);
  --dsw-alias-link: #3b5bfd;
  --dsw-alias-state-business-primary: #3b5bfd;
  --dsw-alias-state-warn-label: #9a4a06;
  --dsw-alias-state-error-primary: #b3261e;
}
/* 侧栏容器：真机 .footerActions 是 flex 容器、**wrap 已关**（宿主原样，我们的
   styles/sidebar-footer.css 就是在它下面改方向）。宽度取真机侧栏宽 240。
   ⚠️ 那 4px 内边距是**宿主自己的**，不是给测试凑数的：槽位按 width:calc(100% + 8px) +
      margin-inline:-4px 向外溢 4px（注释里写明「几何照 DSH Desktop 自己的写法」），
      靠父容器的 4px 内边距把这圈外溢收进 padding box —— 少了它，父容器 scrollWidth 必然
      比 clientWidth 大 8px，而那是**设计如此**的几何，不该被断言当成 bug。
      （注：本文件的 CSS 都是 JS 模板字符串，注释里**不许出现反引号与美元花括号**。） */
.host-footer-actions { display: flex; flex-wrap: nowrap; width: 240px; padding: 0 4px; box-sizing: border-box; }
/* 侧栏里**别的插件**的入口（宿主自己渲染的那两行）。几何照 2026-10-30 真机实测：
   每个入口自带 margin:4px，所以相邻两行之间天然是 4+4 = 8px。 */
.host-entry {
  margin: 4px 0; min-height: 42px; width: 100%; box-sizing: border-box;
  display: flex; align-items: center; padding: 0 10px;
  border: none; background: transparent; border-radius: 12px;
  font: inherit; font-size: 14px; line-height: 22px; text-align: left; cursor: pointer;
}
/* 夹具排版用（把各组隔开、给个标题），**不参与任何断言**。 */
.fx-wrap { padding: 8px 12px; }
.fx-title { font-size: 11px; color: #888; margin: 6px 0 4px; }
`;

// ── "宿主强制 padding" 压力场景 ───────────────────────────────────────────────
// 2026-11-01 的真实事故：设置页搜索框上挂了**行内** `{ ...inputStyle, fontSize: 11 }`，
// 而 inputStyle 里就有 `padding:"2px 6px"` —— 行内优先级压过类规则里的 padding-left:20px，
// 于是放大器与占位文字在真机上重叠 11.33px。那次的教训是：**不许靠 input 的 padding 避让图标**。
//
// 这个压力场景就是那次事故的可重复版本：给页面上**所有** input 强加一层宿主式内边距。
// 选 `input{padding:0 14px}`（真机宿主那套数值）而不是别的花样，是为了保证"谁都能看懂"。
// ⚠️ 它是一条**元素选择器**规则（特异性 0,0,1）：我们自己的 `.gacha-cal-sched-find input`
//    （0,1,1）与 `.gacha-cal-set-find-in`（0,1,0）都赢它 —— 这是**已知且要报告的边界**，
//    报告里那条 `⚠ 诊断` 就是把这个事实摆到台面上（强覆盖仍会重叠，属现存脆弱点）。
export const HOST_PRESSURE_CSS = `
input { padding: 0 14px; }
`;
