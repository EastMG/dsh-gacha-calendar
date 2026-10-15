		//#region styles
		const STYLE = `
			.gacha-cal-btn{display:flex;align-items:center;gap:8px;width:calc(100% + 4px);min-height:42px;padding:0 10px 0 8px;margin:4px -2px;border:none;background:transparent;color:var(--dsw-alias-label-primary);border-radius:12px;font-size:14px;line-height:22px;font-weight:400;cursor:pointer;box-sizing:border-box;white-space:nowrap;overflow:hidden;text-align:left}
			.gacha-cal-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
			.gacha-cal-btn:active{background:var(--dsw-alias-interactive-bg-hover)}
			.gacha-cal-btn svg{flex:none;width:16px;height:16px}
			/* 这里曾有一条指向宿主内部 CSS Modules 类名的覆盖：
			 *   .hHd-Xa_footerActions{flex-wrap:wrap;align-content:flex-start;align-items:stretch}
			 * 它来自 v0.9.1「源码恢复」（从手改过的 lib/client.js 回填 src/），**不属于我们的契约**。
			 * dsh-client-ui-sidebar 升级后该类名换成了别的哈希（0.2.0 实装为 l4U6KG_footerActions），
			 * 覆盖静默失效——哈希随构建变，写死它必然迟早断，且断了没有任何提示。
			 * 故删除：页脚动作区的排布交还给宿主，我们只保证自己那个按钮的样式。
			 * 若将来需要影响父容器，请用不依赖哈希的方式（例如容器上的稳定属性）。 */
			.gacha-cal-pop{position:fixed;z-index:9999;width:690px;max-height:72vh;overflow:auto;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:10px 12px;font-size:12px;color:var(--dsw-alias-label-primary)}
			.gacha-cal-title{font-size:13px;font-weight:600;margin:0 0 4px;display:flex;justify-content:space-between;align-items:center;gap:8px}
			.gacha-cal-meta{color:var(--dsw-alias-label-tertiary);font-size:11px;margin:0 0 8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
			/* flex-basis 用 0（不是 auto）：长文案不会整块掉到下一行，而是留在本行被省略号截断；
			   cursor:help + title 引导用户悬停看逐条原因 */
			.gacha-cal-scrape{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.4;min-width:0;flex:1 1 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:help}
			.gacha-cal-refresh{padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;font-size:11px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;line-height:1}
			.gacha-cal-refresh:hover{background:var(--dsw-alias-interactive-bg-hover)}
			.gacha-cal-refresh:disabled{opacity:.5;cursor:default}
			.gacha-cal-spin{animation:gacha-cal-rotate 0.8s linear infinite}
			@keyframes gacha-cal-rotate{to{transform:rotate(360deg)}}
			.gacha-cal-row{display:grid;grid-template-columns:22px 96px 1fr 150px 1.3fr 150px;gap:6px;align-items:center;padding:5px 4px;border-bottom:1px solid var(--dsw-alias-border-l1)}
			.gacha-cal-row:last-child{border-bottom:none}
			/* 所有列居中：图标列水平居中，文本列 text-align:center，时间列等宽数字 */
			.gacha-cal-row > *{text-align:center}
			.gacha-cal-row > :first-child{justify-self:center}
			.gacha-cal-row img{width:20px;height:20px;border-radius:5px;object-fit:cover}
			.gacha-cal-name{font-weight:600;white-space:nowrap;overflow:hidden}
			.gacha-cal-cell{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
			.gacha-cal-cell b{color:var(--dsw-alias-state-business-primary)}
			/* 截断文字悬停自动滚动显示全文（marquee）：
			   统一由 JS 计算超宽与精确距离（gacha-cal-marq + --gacha-marq-d），仅超宽才滚动；
			   面板保持原速 3.5s，设置页单独慢速 6s */
			.gacha-cal-inner{display:inline-block;white-space:nowrap;will-change:transform}
			.gacha-cal-marq .gacha-cal-inner{animation:gacha-cal-marquee 3.5s ease-in-out infinite}
			@keyframes gacha-cal-marquee{0%,10%{transform:translateX(0)}45%,75%{transform:translateX(var(--gacha-marq-d,-80px))}100%{transform:translateX(0)}}
			.gacha-cal-settings-name.gacha-cal-marq .gacha-cal-inner{animation:gacha-cal-marquee-slow 6s ease-in-out infinite}
			@keyframes gacha-cal-marquee-slow{0%,14%{transform:translateX(0)}40%,72%{transform:translateX(var(--gacha-marq-d,-80px))}93%,100%{transform:translateX(0)}}
			/* 时间列（卡池起止/活动起止，第 4/6 列）：等宽数字，不同位数倒计时左右对齐 */
			.gacha-cal-row > :nth-child(4), .gacha-cal-row > :nth-child(6) { font-variant-numeric: tabular-nums }
			.gacha-cal-h{display:grid;grid-template-columns:22px 96px 1fr 150px 1.3fr 150px;gap:6px;align-items:center;padding:6px 4px 2px;color:var(--dsw-alias-label-tertiary);font-size:11px}
			.gacha-cal-h > *{text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			.gacha-cal-sort-row{display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
			.gacha-cal-sort-row img{width:22px;height:22px;border-radius:5px;object-fit:cover}
			.gacha-cal-sort-name{flex:1;font-size:13px}
			.gacha-cal-sort-btn{padding:1px 8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;font-size:11px;cursor:pointer}
			.gacha-cal-sort-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
			.gacha-cal-sort-btn:disabled{opacity:.35;cursor:default}
			.gacha-cal-del-btn{color:#e5484d;padding:1px 6px}
			.gacha-cal-del-btn:hover{background:rgba(229,72,77,.12)}
			/* ══ 实验：新「日程」面板视图（settings.newPanel 打开时才渲染，见 80-components.js）══
			 * 设计稿（**唯一真源**）：dsh-gacha-ui-lab/a-v6.html（效果图 a-v6.png）
			 *
			 * 三条**互不抢**的分工 —— 改这里的任何一条颜色/图案前先读它：
			 *   · **颜色 = 游戏**：每行由 JS 内联一个 --g（该游戏代表色，来自 SOURCES 的 color）
			 *     → 同一款游戏的**卡池=深色、活动=浅色**（浅色由 color-mix 与白混出）
			 *   · **图案 = 状态**：实心=在期 / 斜纹=已结束 / 点线=长期 / 空心描边=还没开始 / 灰底=该来源无数据
			 *   · **文字 = 紧迫度**：今天到期 / 还剩 X 天 X 时 / MM-DD HH:MM 开始
			 *     —— 迷你条的**颜色不再表紧迫度**（颜色已让给"认游戏"）
			 *
			 * 颜色一律 --dsw-* 语义令牌 + fallback → 跟随 DSH 的浅/深色，**不写**深色专用色值；
			 * 唯一的字面色是"游戏代表色"（那是数据，不是主题色）。
			 * 尺寸与设计稿对齐：游戏列 174px / 表头刻度与迷你条共用 14 格 / 图标框 26 与 40（图 24 与 38 + 1px 描边）。
			 */
			.gacha-cal-sched{display:flex;flex-direction:column;font-size:12px;color:var(--dsw-alias-label-primary,#1f2329)}
			.gacha-cal-sched-num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum"}
			/* ① 标题「二游日历」+ 日期胶囊（**没有**总计数胶囊） */
			.gacha-cal-sched-head{display:flex;align-items:center;gap:10px;padding:2px 0 8px}
			.gacha-cal-sched-head h4{margin:0;font-size:15px;font-weight:650;letter-spacing:-.2px}
			.gacha-cal-sched-sp{margin-left:auto;display:flex;gap:6px}
			.gacha-cal-sched-pill{display:inline-flex;align-items:center;padding:2px 9px;border-radius:999px;font-size:11px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));color:var(--dsw-alias-label-secondary,#4a5261)}
			.gacha-cal-sched-pill--live{background:color-mix(in oklab,var(--dsw-alias-state-business-primary,#3b5bfd) 12%,transparent);border-color:transparent;color:var(--dsw-alias-link,#3b5bfd)}
			/* ② 一行总览：今天 N 条到期 · N 条即将开始 · N 条在期 · N 个来源刷新失败 */
			.gacha-cal-sched-glance{display:flex;align-items:center;gap:10px;margin:0 0 6px;font-size:12px;color:var(--dsw-alias-label-secondary,#4a5261);flex-wrap:wrap}
			.gacha-cal-sched-glance b{color:var(--dsw-alias-label-primary,#1f2329);font-weight:650}
			.gacha-cal-sched-warn{color:var(--dsw-alias-state-warn-label,#9a4a06)}
			.gacha-cal-sched-sep{color:var(--dsw-alias-label-tertiary,#6b7280);margin:0 5px}
			/* ③ 「近期」：跨游戏、按紧迫度、**全列出**（不折叠不点开），占左约 64% */
			.gacha-cal-sched-h2{display:flex;align-items:baseline;gap:8px;margin:0 0 5px}
			.gacha-cal-sched-h2 h4{margin:0;font-size:12px;font-weight:650}
			.gacha-cal-sched-recent{display:flex;gap:10px;margin:0 0 10px;align-items:stretch}
			.gacha-cal-sched-urgent{flex:0 0 64%;min-width:0}
			/* 右侧虚线空框：用途未定，先留空（设计稿的 .slot） */
			.gacha-cal-sched-slot{flex:1 1 auto;border:1px dashed var(--dsw-alias-border-l2,rgba(127,127,127,.4));border-radius:12px}
			.gacha-cal-sched-u{display:flex;align-items:center;gap:9px;padding:6px 8px;border-radius:12px}
			.gacha-cal-sched-u:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
			.gacha-cal-sched-u + .gacha-cal-sched-u{margin-top:1px}
			.gacha-cal-sched-uic{display:inline-flex;flex:0 0 auto;width:26px;height:26px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));border-radius:7px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08))}
			.gacha-cal-sched-who{flex:0 0 auto;width:78px;font-size:12.5px;color:var(--dsw-alias-label-secondary,#4a5261);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			.gacha-cal-sched-kind{flex:0 0 auto;display:inline-flex;align-items:center;gap:4px;font-size:10px;padding:1px 5px;border-radius:999px}
			/* 图标形状已可辨（星芒 vs 旗帜），收窄后不再显示「卡池/活动」二字（设计稿的取舍） */
						.gacha-cal-sched-kind[data-t="gacha"]{color:var(--dsw-alias-link,#3b5bfd);background:color-mix(in oklab,var(--dsw-alias-state-business-primary,#3b5bfd) 10%,transparent)}
			.gacha-cal-sched-kind[data-t="event"]{color:var(--dsw-alias-state-warn-label,#9a4a06);background:color-mix(in oklab,var(--dsw-alias-state-warn-primary,#f5a524) 16%,transparent)}
			.gacha-cal-sched-what{flex:1 1 auto;min-width:0;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			/* 时间结论 = 紧迫度。全屏只有这几处用颜色表紧迫度（文字=紧迫度，颜色=游戏，各管一件事） */
			.gacha-cal-sched-when{flex:0 0 auto;font-size:12px;font-weight:650;text-align:right}
			.gacha-cal-sched-when small{font-size:10px;font-weight:500;color:var(--dsw-alias-label-tertiary,#6b7280);margin-left:1px}
			.gacha-cal-sched-u[data-u="1"] .gacha-cal-sched-when{color:var(--dsw-alias-state-error-primary,#b3261e)}
			.gacha-cal-sched-u[data-u="2"] .gacha-cal-sched-when{color:var(--dsw-alias-state-warn-label,#9a4a06)}
			.gacha-cal-sched-u[data-u="wait"] .gacha-cal-sched-when{color:var(--dsw-alias-link,#3b5bfd);font-weight:600}
			/* ④ 游戏表：**没有区块标题**，列表头直接跟在后面；列 = 游戏(174px) / 卡池 / 活动 */
			.gacha-cal-sched-tcap{display:grid;grid-template-columns:174px 1fr 1fr;gap:0 12px;padding:2px 8px 0;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#6b7280)}
			.gacha-cal-sched-th{display:inline-flex;align-items:center;gap:5px;padding-left:9px}
			.gacha-cal-sched-th[data-t="gacha"]{color:var(--dsw-alias-link,#3b5bfd)}
			.gacha-cal-sched-th[data-t="event"]{color:var(--dsw-alias-state-warn-label,#9a4a06)}
			.gacha-cal-sched-tic{width:12px;height:12px;flex:0 0 auto;display:inline-block;vertical-align:-1.5px}
			.gacha-cal-sched-rulerrow{display:grid;grid-template-columns:174px 1fr 1fr;gap:0 12px;padding:0 8px}
			.gacha-cal-sched-ruler{display:grid;grid-template-columns:repeat(14,1fr);gap:1px;margin-top:4px;font-size:8px;color:var(--dsw-alias-label-tertiary,#6b7280);text-align:center}
			.gacha-cal-sched-ruler span[data-today]{color:var(--dsw-alias-label-primary,#1f2329);font-weight:700}
			.gacha-cal-sched-theadline{height:1px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.25));margin-top:3px}
			/* 一行 = 一款游戏；--g 由 JS 内联（游戏代表色），这里只是拿不到内联值时的兜底 */
			.gacha-cal-sched-trow{--g:var(--dsw-alias-state-business-primary,#3b5bfd);display:grid;grid-template-columns:174px 1fr 1fr;gap:0 12px;padding:9px 8px 10px;align-items:start;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25))}
			.gacha-cal-sched-trow:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
			.gacha-cal-sched-gm{display:flex;align-items:center;gap:11px;min-width:0;align-self:center}
			.gacha-cal-sched-gic{display:inline-flex;flex:0 0 auto;width:40px;height:40px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));border-radius:11px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08))}
			.gacha-cal-sched-gn{font-size:13px;font-weight:650;line-height:1.32;letter-spacing:-.1px;white-space:normal;overflow-wrap:break-word;text-wrap:balance}
			/* 一格 = 该游戏的卡池侧或活动侧：名称 + 「档期 · 状态」，不折叠不点开；同格多条时露一条 + 「另有 N 条」 */
			.gacha-cal-sched-cell{min-width:0}
			.gacha-cal-sched-cell[data-t="gacha"]{--gf:var(--g)}
			.gacha-cal-sched-cell[data-t="event"]{--gf:color-mix(in oklab,var(--g) 42%,#fff)}
			.gacha-cal-sched-cn{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			.gacha-cal-sched-cm{margin-top:1px;font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			.gacha-cal-sched-more{color:var(--dsw-alias-label-secondary,#4a5261)}
			.gacha-cal-sched-cell[data-u="1"] .gacha-cal-sched-cn{color:var(--dsw-alias-state-error-primary,#b3261e);font-weight:650}
			.gacha-cal-sched-cell[data-u="1"] .gacha-cal-sched-cm{color:var(--dsw-alias-state-error-primary,#b3261e)}
			.gacha-cal-sched-cell[data-u="2"] .gacha-cal-sched-cm{color:var(--dsw-alias-state-warn-label,#9a4a06)}
			.gacha-cal-sched-cell--none .gacha-cal-sched-cn{color:var(--dsw-alias-label-tertiary,#6b7280);font-weight:400}
			/* 14 天迷你条：所有行**共用同一根轴**（与表头刻度同列宽）；今天**只有一列** */
			.gacha-cal-sched-tl{display:grid;grid-template-columns:repeat(14,1fr);gap:1px;height:9px;margin-top:5px;position:relative}
			.gacha-cal-sched-tl i{background:color-mix(in oklab,var(--dsw-alias-label-primary,#1f2329) 7%,transparent);border-radius:1.5px}
			.gacha-cal-sched-tl i[data-f]{background:var(--gf,var(--dsw-alias-state-business-primary,#3b5bfd))}
			.gacha-cal-sched-tl i[data-f="done"]{background:repeating-linear-gradient(45deg,color-mix(in oklab,var(--gf,var(--dsw-alias-label-primary,#1f2329)) 45%,transparent) 0 2px,transparent 2px 4px)}
			.gacha-cal-sched-tl i[data-f="long"]{background:repeating-linear-gradient(90deg,color-mix(in oklab,var(--gf,var(--dsw-alias-label-primary,#1f2329)) 55%,transparent) 0 3px,transparent 3px 6px)}
			.gacha-cal-sched-tl[data-state="wait"] i[data-f]{background:transparent;box-shadow:inset 0 0 0 1.5px color-mix(in oklab,var(--dsw-alias-state-business-primary,#3b5bfd) 55%,transparent)}
			/* 今天那一格：**不用竖线**（用户 2026-10-15 要求），改为格子本身上下各加高 3px，与刻度上的今天对齐。
			   设计稿按**格**画（只贯穿迷你条上下各 3px），不跨过上面的事项名文字 —— 跨过去会压在字上。 */
			.gacha-cal-sched-tl i[data-today]{margin-block:-2px;border-radius:2.5px}
			/* ⑤ 图例：颜色认游戏、图案看状态 */
			.gacha-cal-sched-legend{display:flex;gap:12px;margin-top:8px;font-size:10px;color:var(--dsw-alias-label-tertiary,#6b7280);flex-wrap:wrap}
			.gacha-cal-sched-k{display:inline-flex;align-items:center;gap:4px}
			.gacha-cal-sched-sw{display:inline-block;flex:0 0 auto;width:9px;height:9px;border-radius:2px}
			.gacha-cal-sched-sw[data-sw="game"]{background:var(--dsw-alias-state-business-primary,#3b5bfd)}
			.gacha-cal-sched-sw[data-sw="done"]{background:repeating-linear-gradient(45deg,color-mix(in oklab,var(--dsw-alias-label-primary,#1f2329) 26%,transparent) 0 2px,transparent 2px 4px)}
			.gacha-cal-sched-sw[data-sw="long"]{background:repeating-linear-gradient(90deg,color-mix(in oklab,var(--dsw-alias-label-primary,#1f2329) 30%,transparent) 0 3px,transparent 3px 6px)}
			.gacha-cal-sched-sw[data-sw="wait"]{box-shadow:inset 0 0 0 1.5px color-mix(in oklab,var(--dsw-alias-state-business-primary,#3b5bfd) 55%,transparent)}
			.gacha-cal-sched-sw[data-sw="today"]{background:color-mix(in oklab,var(--dsw-alias-label-primary,#1f2329) 7%,transparent);outline:1px solid var(--dsw-alias-label-primary,#1f2329);outline-offset:-1px}
			/* ⑥ 刷新失败横条 + 重试（重试 = 整轮刷新：引擎没有单源刷新接口，见 50-refresh.js） */
			.gacha-cal-sched-failbar{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:11px;color:var(--dsw-alias-state-warn-label,#9a4a06)}
			.gacha-cal-sched-fic{width:12px;height:12px;flex:0 0 auto}
			.gacha-cal-sched-failtext{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			.gacha-cal-sched-retry{flex:0 0 auto;margin-left:6px;padding:0;border:none;background:transparent;font:inherit;color:inherit;cursor:pointer;border-bottom:1px dashed currentColor}
			.gacha-cal-sched-retry:hover{color:var(--dsw-alias-label-primary,#1f2329)}
			.gacha-cal-sched-retry:disabled{opacity:.5;cursor:default}
			/* ⑦ 底部：上次更新 X 分钟前 + 刷新 */
			.gacha-cal-sched-foot{display:flex;align-items:center;gap:8px;margin-top:9px;padding-top:9px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));font-size:10.5px;color:var(--dsw-alias-label-tertiary,#6b7280)}
			.gacha-cal-sched-foot > span{flex:1 1 0;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			.gacha-cal-sched-btn{flex:0 0 auto;margin-left:auto;padding:4px 11px;border-radius:999px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.08));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));color:var(--dsw-alias-label-secondary,#4a5261);font:inherit;font-size:10.5px;cursor:pointer}
			.gacha-cal-sched-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
			.gacha-cal-sched-btn:disabled{opacity:.5;cursor:default}
			.gacha-cal-sched-empty{padding:12px 8px;text-align:center;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#6b7280)}
		`;
		//#endregion
