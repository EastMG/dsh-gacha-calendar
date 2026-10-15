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
			 * 设计稿：dsh-gacha-ui-lab/a-optimized.html（浅色效果图 a-optimized-light.png）
			 *
			 * 颜色**一律**走 --dsw-* 语义令牌 + fallback → 跟随 DSH 的浅/深色。
			 * ⚠️ 浅色不是深色反相：所以这里只出现语义令牌（label-* / border-* / bg-layer-* /
			 *    state-* / interactive-bg-hover），**不写** #cfd8ff 这类"深色专用"硬编码色值。
			 * ⚠️ 每行只有一个进度表达（.gacha-cal-sched-bar）；别在这里再加第二个。
			 * ⚠️ 每个部件一个职责：图标=身份 / 栏=类别 / bar=窗口进度（颜色只表紧迫度）/ cd=时间结论。 */
			.gacha-cal-sched{display:flex;flex-direction:column;gap:0;font-size:12px;color:var(--dsw-alias-label-primary,inherit)}
			.gacha-cal-sched-head{display:flex;align-items:center;gap:8px;padding:0 2px 9px}
			.gacha-cal-sched-head h4{margin:0;font-size:14px;font-weight:600;letter-spacing:-.2px}
			.gacha-cal-sched-pill{display:inline-flex;align-items:center;padding:2px 9px;border-radius:999px;font-size:11px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.08));border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));color:var(--dsw-alias-label-secondary,inherit)}
			/* 四格摘要：先给结论，再给明细 */
			.gacha-cal-sched-sum{display:flex;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));border-radius:12px;overflow:hidden;margin-bottom:9px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.05))}
			.gacha-cal-sched-sum > div{flex:1;padding:7px 10px}
			.gacha-cal-sched-sum > div + div{border-left:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25))}
			.gacha-cal-sched-sum b{display:block;font-size:15px;font-weight:700;line-height:1.15;font-variant-numeric:tabular-nums}
			.gacha-cal-sched-sum span{font-size:10.5px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.85))}
			.gacha-cal-sched-sum > div[data-warn="true"] b{color:var(--dsw-alias-state-warn-label,var(--dsw-static-amber-500,#9a4a06))}
			/* 分区标题（写明排序依据，不含糊） */
			.gacha-cal-sched-sec{display:flex;align-items:center;gap:6px;margin:9px 2px 5px;font-size:10.5px;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.85))}
			.gacha-cal-sched-sec::after{content:"";flex:1;height:1px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.25))}
			.gacha-cal-sched-sec em{font-style:normal;font-weight:600;color:var(--dsw-alias-label-secondary,inherit)}
			/* 行 */
			.gacha-cal-sched-row{display:flex;align-items:center;gap:10px;padding:8px 9px;border-radius:12px;border:1px solid transparent;margin:1px 0}
			.gacha-cal-sched-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));border-color:var(--dsw-alias-border-l1,rgba(127,127,127,.25))}
			.gacha-cal-sched-ic{flex:none;display:inline-flex}
			.gacha-cal-sched-mid{display:flex;flex-direction:column;min-width:0;flex:1 1 auto;gap:3px}
			.gacha-cal-sched-t1{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			.gacha-cal-sched-t2{display:flex;align-items:center;gap:5px;font-size:10.5px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.85));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
			/* 唯一的进度表达：颜色只表紧迫度 */
			.gacha-cal-sched-bar{display:block;height:3px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.2));overflow:hidden}
			.gacha-cal-sched-bar > i{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary,var(--dsw-static-deepseek-500,#3b5bfd))}
			.gacha-cal-sched-row[data-urgency="soon"] .gacha-cal-sched-bar > i{background:var(--dsw-alias-state-warn-primary,var(--dsw-static-amber-400,#f5a524))}
			.gacha-cal-sched-row[data-urgency="due"] .gacha-cal-sched-bar > i,.gacha-cal-sched-row[data-urgency="fail"] .gacha-cal-sched-bar > i{background:var(--dsw-alias-state-error-primary,var(--dsw-static-red-600,#e5484d))}
			.gacha-cal-sched-row[data-state="long"] .gacha-cal-sched-bar > i{background:repeating-linear-gradient(90deg,var(--dsw-static-neutral-bluish-300,#98a2b3) 0 4px,transparent 4px 8px)}
			.gacha-cal-sched-row[data-state="wait"] .gacha-cal-sched-bar > i{background:var(--dsw-alias-border-l2,rgba(127,127,127,.35))}
			/* 右侧：唯一的时间结论 */
			.gacha-cal-sched-rt{flex:none;min-width:64px;text-align:right;display:flex;flex-direction:column;gap:1px}
			.gacha-cal-sched-lab{font-size:9.5px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.85))}
			.gacha-cal-sched-cd{font-size:16px;font-weight:700;letter-spacing:-.4px;line-height:1.1;font-variant-numeric:tabular-nums}
			.gacha-cal-sched-cd small{font-size:9.5px;font-weight:500;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.85));margin-left:1px}
			.gacha-cal-sched-row[data-urgency="due"] .gacha-cal-sched-cd{color:var(--dsw-alias-state-error-primary,var(--dsw-static-red-600,#b3261e))}
			.gacha-cal-sched-row[data-urgency="soon"] .gacha-cal-sched-cd{color:var(--dsw-alias-state-warn-label,var(--dsw-static-amber-500,#9a4a06))}
			.gacha-cal-sched-row[data-state="long"] .gacha-cal-sched-cd,.gacha-cal-sched-row[data-state="wait"] .gacha-cal-sched-cd{font-size:12px;color:var(--dsw-alias-label-secondary,inherit)}
			/* 刷新失败：独立分区 + 可重试（重试 = 整轮刷新，引擎没有单源刷新接口，见 50-refresh.js） */
			.gacha-cal-sched-row[data-state="fail"]{background:var(--dsw-alias-state-error-tertiary,rgba(229,72,77,.08));border-color:var(--dsw-alias-border-l2,rgba(229,72,77,.3))}
			.gacha-cal-sched-retry{flex:none;padding:3px 9px;border-radius:999px;font-size:11px;cursor:pointer;background:transparent;color:var(--dsw-alias-label-error,var(--dsw-static-red-600,#b3261e));border:1px solid var(--dsw-alias-border-l2,rgba(229,72,77,.35))}
			.gacha-cal-sched-retry:hover{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(229,72,77,.12))}
			.gacha-cal-sched-retry:disabled{opacity:.5;cursor:default}
			.gacha-cal-sched-more{margin:6px 2px 0;padding:5px;width:calc(100% - 4px);text-align:center;font-size:11px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.85));background:transparent;border:1px dashed var(--dsw-alias-border-l1,rgba(127,127,127,.25));border-radius:8px;cursor:pointer}
			.gacha-cal-sched-more:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
			.gacha-cal-sched-empty{padding:14px 4px;text-align:center;font-size:11.5px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.85))}
			/* ══ 两栏（栏 = 类别）：左卡池 / 右活动。窄栏降级靠 flex-wrap + min-width，不用媒体查询 ══ */
			.gacha-cal-sched-cols{display:flex;flex-wrap:wrap;align-items:flex-start}
			.gacha-cal-sched-col{flex:1 1 300px;min-width:300px;padding:0 2px}
			.gacha-cal-sched-col + .gacha-cal-sched-col{border-left:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));padding-left:10px;margin-left:10px}
			.gacha-cal-sched-colhead{display:flex;align-items:center;gap:7px;padding:2px 2px 6px;font-size:12px;font-weight:600}
			.gacha-cal-sched-coln{margin-left:auto;font-size:10.5px;font-weight:500;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.85))}
			.gacha-cal-sched-colname{display:inline-flex;align-items:baseline;gap:4px}
			/* 刷新失败：来源级问题 → 跨栏底部横条（不属于任何一栏） */
			.gacha-cal-sched-errstrip{display:flex;align-items:center;gap:8px;margin-top:9px;padding:7px 10px;border-radius:12px;background:var(--dsw-alias-state-error-tertiary,rgba(229,72,77,.08));border:1px solid var(--dsw-alias-border-l2,rgba(229,72,77,.3));font-size:11px}
			.gacha-cal-sched-errstrip > b{flex:none;color:var(--dsw-alias-label-error,var(--dsw-static-red-600,#b3261e))}
			.gacha-cal-sched-errtext{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary,inherit);cursor:help}
			.gacha-cal-sched-foot{display:flex;align-items:center;gap:8px;margin-top:10px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));font-size:11px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.85))}
			.gacha-cal-sched-foot > span{min-width:0;flex:1 1 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:help}
		`;
		//#endregion
