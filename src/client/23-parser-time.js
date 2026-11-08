// src/client/23-parser-time.js —— 时间解析（2026-10-28 由 25-parser-shared.js 拆出，第 1/7 段）
//
// ⚠️ 2026-10-03 重组（用户要求「28 款一视同仁」）：不再有「内置 11 款 / 另外 17 款」的文件分层，
//    每款/每组游戏一个**自包含**文件（条目 + 解析器 + 抓取器 + 登记）。
//    本次只挪位置，**符号名一个都没改** —— 所以导出表、注册表快照、所有用例都不受影响。
//
// ⚠️ 这些文件在 core 产物里位于 `createEngine` **内部**，每建一个引擎都会重跑一遍 →
//    对 `SOURCES` 的写操作**必须幂等**（统一走 `registerSource`，它按 id 找到就合并、否则追加）。

		//#region scrape parsers
		// 纯函数解析器：同一 HTML 输入必然产生同一输出（确定性），
		// 保证网页内容未变时手动刷新结果保持一致。
		function stripTags(s) {
			return (s || "")
				.replace(/<br\s*\/?>/gi, " ")
				.replace(/<[^>]+>/g, "")
				.replace(/&amp;/g, "&")
				.replace(/&lt;/g, "<")
				.replace(/&gt;/g, ">")
				.replace(/&quot;/g, '"')
				.replace(/&#91;/g, "[")
				.replace(/&#93;/g, "]")
				.replace(/&#39;/g, "'")
				.replace(/&#8211;/g, "\u2013")
				.replace(/&#160;/g, " ")
				.replace(/&nbsp;/g, " ")
				// 通用数字实体兜底：源站会用**白名单之外**的数字实体（FGO 卡池一览实测 89 处 `&#32;`，
				// 即空格），旧实现只认上面那几个硬编码 → 面板上直接显示成
				// `阿蒂拉&#32; 罗摩&#32; 兰斯洛特(Saber)&#32; …`（2026-10-03 修）。
				// 位置刻意放在硬编码白名单**之后**：已知实体优先，尽量不改变既有解析结果。
				// 注：`next-sources/lib/env.js` 的 decodeEntities（压平后见 27-parser-text.js）本来就是通用实现，
				//     这次补齐后两者语义一致，不再有"测试对、插件错"的落差。
				.replace(/&#(\d+);/g, (m, n) => {
					try { return String.fromCodePoint(Number(n)); } catch { return m; }
				})
				.replace(/\s+/g, " ")
				.trim();
		}


		// 解析单个时间 → {ts, text}；无法解析返回 {ts:null, text:null}
		// `tz`（可选）= 源站墙钟时区（见 15-env.js / 20-sources.js 的 `tz`）。
		// 传了 → 绝对时刻按**源站时区**换算；不传 → 沿用本机时区（= 改造前行为）。
		// **text 一律是源站墙钟原文**，不随 tz 变 —— 玩家看游戏内公告走的就是这串时间。
		//
		// 兜底：`sourceInstant` 定义在 15-env.js。若调用方只把本文件单独抽出来用
		// （回归脚本用 `new Function` 注入单个函数、或把 core 拆到别处），它可能不在作用域；
		// 那时退回 `new Date(...)`（本机时区）而不是抛 ReferenceError ——
		// 少一次时区换算，但绝不让"抽函数"这种用法直接崩掉。
		function parseTime(s, tz) {
			const mkTs = (y, mo, d, h, mi) => (typeof sourceInstant === "function"
				? sourceInstant(y, mo, d, h, mi, tz)
				: new Date(y, mo - 1, d, h, mi).getTime());
			const m = String(s).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
			if (m) {
				const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4]), mi = Number(m[5]);
				const text = `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
				return { ts: mkTs(y, mo, d, h, mi), text };
			}
			// 回退：`YYYY/MM/DD <版本更新后>`（日期 + 版本标签，缺时分）→ 按锚点时刻补全。
			// 注意只认**带日期前缀**的这种；纯标签（`4.6版本更新后`）保持 null —— 那种确实
			// 给不出日期（下一版本何时更新是未知的），硬造时间会错得更离谱。
			const v = String(s).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s*(?:\d+(?:\.\d+)?\s*版本更新后|版本更新后)/);
			if (v) {
				const y = Number(v[1]), mo = Number(v[2]), d = Number(v[3]);
				const { h, mi } = VERSION_UPDATE_ANCHOR;
				const text = `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
				return { ts: mkTs(y, mo, d, h, mi), text };
			}
			return { ts: null, text: null };
		}


		// ── 「相对起点」统一锚定（**唯一真源**，2026-11-09 用户拍板）─────────────────────
		//
		// 源站最常见的"起点"不是绝对时刻，而是**相对版本/开服**的一天：
		//   · 星铁  `2026/09/28 4.6版本更新后`（日期 + 版本标签）/ `4.7版本更新后`（只有版本）
		//   · 无期迷途 `10月27日 开服后`（只有日期，钟点写在维护公告里）
		// 这些写法的**钟点**源站不给。用户 2026-11-09 定了口径：钟点直接锚定，不去解析维护公告：
		//   · 星铁 = 该日 **10:00**（+08）：版本更新 06:00 开始、维护 5 小时；
		//   · 无期迷途 = 该日 **14:00**（+08）：官方公告「维护时间：10月27日 10:00-14:00」，开服 = 窗口结束。
		// **只有版本标签、没有日期**（`4.7版本更新后`）⇒ 那一天是哪天根本不知道 ⇒ 返 null（起点未知）。
		//
		// 三态（返回值只有两种：绝对毫秒 / null）：
		//   ① `YYYY/MM/DD [X.Y版本更新后|开服后]` → 该日 anchorHour:00（源站时区）
		//   ② `M月D日 [开服后]`（无年份）        → 借 `hint`（`{y, mo}`，通常 = 公告发布时刻的墙钟）补年份
		//   ③ 只有 `X.Y版本更新后` / 没有日期     → null（**不猜**，见下方调用方的"起点未知"口径）
		// 附带：文本里已经写了绝对时刻（`YYYY/MM/DD HH:MM`）⇒ 原样返回，好让调用方只留一个入口。
		//
		// ⚠️ 拿到的 null 绝不能再被当成"已开始"（24-parser-window.js 的 coversNow 已收紧）。

		function anchorStartOf(text, anchorHour, tz, hint) {
			const h = Number(anchorHour);
			if (!Number.isFinite(h) || h < 0 || h > 23) return null;
			const s = stripTags(text == null ? "" : text).replace(/\u00a0/g, " ");
			// ① 已有绝对时刻 ⇒ 原样（这类文本不需要锚）
			const abs = s.match(/(\d{4})\s*[\/\-]\s*(\d{1,2})\s*[\/\-]\s*(\d{1,2})\s+(\d{1,2})\s*[:：]\s*(\d{2})/);
			if (abs) return sourceInstant(Number(abs[1]), Number(abs[2]), Number(abs[3]), Number(abs[4]), Number(abs[5]), tz);
			// ② 有日期（带不带「版本更新后 / 开服后」都一样）⇒ 该日 anchorHour:00
			const ymd = s.match(/(\d{4})\s*[\/\-年]\s*(\d{1,2})\s*[\/\-月]\s*(\d{1,2})/);
			if (ymd) return sourceInstant(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]), h, 0, tz);
			// ③ 只有月日（`10月27日`）⇒ 年份只能借线索；借不到就不产出（inferYear 的既有口径）
			const md = s.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
			if (md) {
				const mo = Number(md[1]), d = Number(md[2]);
				if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
				const y = typeof inferYear === "function" ? inferYear(null, mo, hint) : null;
				return y == null ? null : sourceInstant(y, mo, d, h, 0, tz);
			}
			// ④ 只有版本标签（`4.7版本更新后`）⇒ 起点未知
			return null;
		}


		// 时间段 → startTs/endTs + 统一文本 mm-dd hh:mm ~ mm-dd hh:mm（无法解析的一侧保留原文）
		// `tz` 同 parseTime：源站墙钟时区（可选，不传 = 本机时区）
		function parseRange(raw, tz) {
			const t = stripTags(raw);
			const parts = t.split(/~/).map((x) => x.trim());
			if (parts.length < 2) {
				const p = parseTime(parts[0], tz);
				return { startTs: p.ts, endTs: null, startText: p.text, endText: null, raw: p.text ?? t };
			}
			const a = parseTime(parts[0], tz);
			const b = parseTime(parts[1], tz);
			return {
				startTs: a.ts, endTs: b.ts,
				startText: a.text ?? parts[0], endText: b.text ?? parts[1],
				raw: `${a.text ?? parts[0]} ~ ${b.text ?? parts[1]}`
			};
		}


		// bwiki 通用：解析所有含「时间+版本」的卡池表（原神/星铁/绝区零）
		function parseAllBwiki(html, tz) {
			const out = [];
			const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)];
			for (const t of tables) {
				const body = t[1];
				if (!/<th[^>]*>\s*时间\s*<\/th>/i.test(body)) continue;
				if (!/<th[^>]*>\s*版本\s*<\/th>/i.test(body)) continue;
				let banner = "";
				const tc = body.match(/<th[^>]*colspan\s*=\s*"?2"?[^>]*>([\s\S]*?)<\/th>/i);
				if (tc) {
					const alt = tc[1].match(/<img[^>]*alt\s*=\s*"([^"]*)"/i);
					banner = alt ? alt[1] : stripTags(tc[1]);
				}
				if (!banner) {
					const t2 = body.match(/<th[^>]*>([\s\S]*?)<\/th>/i);
					if (t2) banner = stripTags(t2[1]);
				}
				const timeM = body.match(/<th[^>]*>\s*时间\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
				const charM = body.match(/<th[^>]*>\s*(?:5星角色|S级代理人|6星干员|5星干员)\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
				if (!timeM) continue;
				const range = parseRange(timeM[1], tz);
				out.push({
					banner,
					roles: charM ? stripTags(charM[1]) : "",
					...range,
					isMain: isMainBanner(banner)
				});
			}
			return out;
		}
