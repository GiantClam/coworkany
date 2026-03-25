export const LANGUAGE_CHINESE_PATTERN = /[\u4e00-\u9fff]/;

export const PRICE_SENSITIVE_INVESTMENT_PATTERN =
    /(买入价|买入价格|买入区间|建仓价|建仓区间|入场价|买点|目标价|target price|entry price|buy price|buy range|entry range|price range|at what price)/i;

export const COMPLEX_PLANNING_SCHEDULED_CUE_PATTERN =
    /(计划|规划|拆分|分解|设计|方案|架构|多步|workflow|multi-step|plan|break down|decompose|best practice|调研|research|analysis)/i;

export const COMPLEX_PLANNING_GENERAL_CUE_PATTERN =
    /(计划|规划|拆分|分解|设计|方案|架构|实现|多步|multi-step|plan|break down|decompose|workflow|research)/i;

export const EXPLICIT_WEB_LOOKUP_CUE_PATTERN =
    /(检索|搜索|查找|查询|搜集|收集|爬取|crawl|scrape|search|lookup|find|news|新闻|latest|最新|事实核验|核验|source|来源|证据|时间线|timeline)/i;

export const WEB_ANALYSIS_CUE_PATTERN = /(深度分析|深入分析|analysis|why|为什么|原因|解读)/i;

export const WEB_FRESHNESS_STATUS_CUE_PATTERN = /(最新|today|今日|最近|近期|news|动态|官方|公告|关闭|关停|停用|下线)/i;

export const LOCAL_SEARCH_SCOPE_PATTERN =
    /(当前项目|当前仓库|现有流程|workspace|repo|repository|代码库|本地|目录|文件夹|文件|路径|log|日志|代码|src|package\.json)/i;

export const UI_FORMAT_ARTIFACT_CUE_PATTERN = /(ppt|slides|deck|演示|幻灯片|汇报)/i;

export const UI_FORMAT_REPORT_CUE_PATTERN = /(报告|report|总结|summary|分析|analysis|方案)/i;

export const UI_FORMAT_TABLE_CUE_PATTERN = /(表格|table|清单|list)/i;

export const ARTIFACT_FORMAT_JSON_CUE_PATTERN = /(json)/i;

export const EXPLICIT_ARTIFACT_OUTPUT_INTENT_PATTERN =
    /(?:保存(?:到|为)?|写入(?:到)?|写到|输出到|导出(?:到|为)?|生成(?:到)?|save(?:\s+it)?\s+to|write(?:\s+it)?\s+to|output(?:\s+it)?\s+to|export(?:\s+it)?\s+(?:to|as)|create\s+(?:an?\s+)?(?:file|document))/i;

export const CODE_CHANGE_EXCLUSION_PATTERN = /(方案|plan|规划|拆分|设计|architecture|验收标准)/i;

export const CODE_CHANGE_PRIMARY_PATTERN = /(代码|code|refactor|修复|fix|实现功能|实现代码)/i;

export const CODE_CHANGE_POSITIVE_PATTERN =
    /(代码|code|refactor|修复|fix|实现功能|实现代码|实现一个.*功能|改这个 bug|修这个 bug)/i;

export const PLAN_APPROVAL_CUE_PATTERN =
    /(按这个方案继续|按该方案继续|就按这个方案|可以执行了|继续执行|开始执行|用户确认|user approval|go ahead|proceed|approved?|ship it|looks good,? continue)/i;

export const PREFERENCE_PERSISTENCE_PATTERN =
    /\b(preference|prefer|default setting|remember that i|save.*preference)\b|偏好|喜欢|默认设置|记住我/i;

export const COWORKANY_SELF_MANAGEMENT_DOMAIN_PATTERN =
    /(coworkany|skillhub|clawhub|github:|github\.com|serper key|api key|工作区|workspace|配置|config|技能|skill)/i;

export const COWORKANY_SELF_MANAGEMENT_ACTION_PATTERN =
    /(安装|install|启用|enable|禁用|disable|删除|remove|卸载|uninstall|查看|inspect|列出|list|配置|config)/i;

export const TASK_CATEGORY_BROWSER_CUE_PATTERN = /(browser|playwright|网页|网站|页面|登录|timeline|时间线)/i;

export const TASK_CATEGORY_RESEARCH_CUE_PATTERN = /(研究|research|调研|分析|best practice|最佳实践|方案)/i;

export const TASK_CATEGORY_MIXED_CUE_PATTERN = /(以及|and|同时|across|multi)/i;

export const PREFERENCE_BEST_PRACTICE_PATTERN = /(最优|optimal|best practice|最佳实践)/i;

export const PREFERENCE_CONCISE_PATTERN = /(简洁|concise|简明)/i;

export const PREFERENCE_DEEP_PATTERN = /(详细|深入|deep|深度)/i;

export const PREFERENCE_CHINESE_PATTERN = /(中文|zh|汉语)/i;

export const CONTEXT_CURRENT_PROJECT_PATTERN = /(当前项目|当前仓库|现有流程|workspace|repo|repository|代码库)/i;

export const CONTEXT_FOLLOW_UP_PATTERN = /(继续|resume|follow-up|接着|刚才|上面的)/i;

export const CONTEXT_FOLLOW_UP_EXTENDED_PATTERN = /(继续|resume|follow-up|接着|刚才|上面的|上述|前述)/i;

export const RESEARCH_BEST_PRACTICE_CUE_PATTERN = /(最佳实践|best practice|调研|research|架构|方案|设计)/i;

export const LOCAL_PLAN_WRITE_WORKFLOW_PATTERN = /(organize|deduplicate|delete)/i;

export const LOCAL_PLAN_HOST_SCOPE_PATTERN = /downloads|host-folder|explicit-path/i;

export const AMBIGUOUS_REFERENCE_PATTERNS: ReadonlyArray<RegExp> = [
    /^(?:继续|接着|按刚才|照上面|continue|resume|follow up|same as above)(?:\s+(?:处理|做|看|handle|work on))?(?:\s+(?:这个|那个|这些|上面的|刚才的|this|that|those|it|them))?[.!?？。!]*$/i,
    /^(?:这个|那个|这些|上面的|刚才的|this|that|those|it|them|same as above)[.!?？。!]*$/i,
    /^(?:继续处理|继续做|continue with|resume with|handle|work on)\s*(?:这个|那个|this|that|it|them)[.!?？。!]*$/i,
];

export const ACCEPTANCE_CRITERIA_OUTPUT_PATTERN =
    /(只保留|必须|不要|输出|格式|每篇|唯一标识|summary|summarize|reply only|只回复)/i;

export const ACCEPTANCE_CRITERIA_PRICE_PATTERN = /(价格|价位|区间|买入|目标价|price|entry|buy)/i;

export const ACCEPTANCE_CRITERIA_TIME_ANCHOR_PATTERN = /(截至|时间|日期|交易日|盘中|收盘|as of|timestamp|date|session)/i;
