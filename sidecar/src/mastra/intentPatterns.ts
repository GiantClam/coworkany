export const MARKET_QUERY_PATTERN = /\b(stock|stocks|share|shares|price|prices|quote|quotes|market|markets|equity|equities|finance|financial|ticker|tickers|investment|invest|portfolio|analyst|rating|buy|sell|hold|earnings|revenue|valuation|hkex|nasdaq|nyse|a-share)\b|a股|港股|美股|股价|行情|涨跌|走势|市值|成交量|成交额|开盘|收盘|最高|最低|投资|买入|卖出|持有|评级|目标价|财报|营收|估值|\(([A-Z]{1,5}|\d{3,5}\.HK)\)/iu;

export const BUSINESS_COOPERATION_QUERY_PATTERN = /\b(partnership|partner(?:ship)?|collaboration|collaborate|joint venture|strategic alliance|business cooperation|business development|go[-\s]?to[-\s]?market|channel partner|vendor|supplier|distribution deal|commercial deal)\b|商业合作|业务合作|商务合作|合作伙伴|渠道合作|战略合作|联合(?:方案|营销|推广)|生态合作|供应商/u;

export const DECISION_REQUEST_PATTERN = /\b(recommend(?:ation)?|advice|strategy|plan|feasib(?:le|ility)|evaluate|assessment|pros?\s+and\s+cons?|risk|roi|worth|should\s+we|go\/no-go)\b|建议|策略|方案|可行性|评估|分析|利弊|风险|回报|值不值得|是否应该/u;

export const WEATHER_QUERY_PATTERN = /\b(weather|forecast|temperature|humidity|rain|snow|wind|uv|aqi|air quality|meteo)\b|天气|气温|温度|湿度|降雨|下雨|下雪|风力|空气质量|预报/iu;

export const NEWS_QUERY_PATTERN = /\b(news|headlines?|breaking|latest|today(?:'s)?|trend(?:ing)?)\b|新闻|资讯|快讯|头条|最新|趋势/iu;

export const GENERIC_WEB_LOOKUP_PATTERN = /(?:\b(search|lookup|find|research|web\s*search|crawl)\b|搜索|查询|检索|调研|查找|搜一下|查一下)|(?:(?:\b(latest|recent|current|today|real[-\s]?time)\b|最新|近期|当前|今天|实时).{0,12}(?:\b(news|weather|forecast|price|quote|rating|review|exchange\s*rate|box\s*office|trend|data|paper|papers)\b|新闻|资讯|天气|预报|价格|报价|评分|汇率|票房|趋势|数据|论文|研报))/iu;

export const VOICE_OUTPUT_REQUEST_PATTERN = /(语音|朗读|读给我听|播报|tts|text-to-speech|voice\s*(?:read|speak|tts)?|read\s+(?:it|this|that)\s+aloud|speak\s+(?:it|this|that)\s+aloud)/iu;

export const CURRENT_DATETIME_QUERY_PATTERN = /(?:(?:今天|现在|当前).{0,10}(?:几号|几月几日|日期|时间|几点|星期几|周几|礼拜几))|(?:今天是几号)|(?:现在几点)|(?:today(?:'s)?\s+(?:date|day))|(?:current\s+(?:date|time|day))|(?:what(?:'s| is)?\s+(?:the\s+)?(?:date|time|day)(?:\s+today)?)|(?:what\s+day\s+is\s+it)|(?:what\s+date\s+is\s+it)/iu;

export const LOCAL_HOST_OPERATION_VERB_PATTERN = /\b(move|rename|copy|delete|remove|relocate|organize|clean(?:up)?|archive|compress|extract|backup|sync|open|close|start|stop|restart|kill|launch|install|uninstall|empty|clear)\b|移动|迁移|重命名|复制|拷贝|删除|移除|整理|清理|归档|压缩|解压|备份|同步|打开|关闭|启动|停止|重启|结束|安装|卸载|清空/u;

export const LOCAL_HOST_OPERATION_OBJECT_PATTERN = /\b(file|files|folder|folders|directory|directories|path|paths|recycle\s*bin|trash|clipboard|desktop|downloads|documents|terminal|process|service|app|application|window)\b|文件|文件夹|目录|路径|回收站|垃圾桶|剪贴板|桌面|下载|文档|终端|进程|服务|应用|程序|窗口/u;

export const FILESYSTEM_PATH_TOKEN_PATTERN = /(?:^|[\s"'`])(?:(?:\/|\.\/|\.\.\/|~\/|[A-Za-z]:\\)[^\s"'`]+|(?:[A-Za-z0-9._-]+[\\/][^\s"'`]+))/u;
export const PLATFORM_MEDIA_SOURCE_PATTERN = /\b(bilibili|blibli|bili|youtube|youtu\.be|douyin|tiktok|kuaishou|xiaohongshu|weibo)\b|哔哩哔哩|哔哩|B站|抖音|快手|小红书|微博/iu;
export const PLATFORM_TRENDING_SIGNAL_PATTERN = /\b(hot|trending|popular|top|viral|rank(?:ing)?|recommend(?:ed|ation)?)\b|热门|热榜|热搜|趋势|排行|榜单|爆款|推荐|高赞/iu;
export const PLATFORM_MEDIA_CONTENT_PATTERN = /\b(video|videos|clip|clips|shorts?|post|posts|channel|channels)\b|视频|短视频|作品|频道|UP主|博主/u;
export const WEB_DISCOVERY_QUERY_CUE_PATTERN = /\b(what|which|find|search|show|today|latest|current)\b|什么|哪些|有什么|看看|查询|搜一下|查一下|今天|最新|当前/u;
export const LOOKUP_REQUEST_TONE_PATTERN = /[?？]|(?:请|帮我|给我|麻烦|推荐|看看|show me|tell me)/iu;

export function isBusinessDecisionSupportQuery(message: string): boolean {
    const normalized = message.trim();
    if (normalized.length === 0) {
        return false;
    }
    return BUSINESS_COOPERATION_QUERY_PATTERN.test(normalized)
        && DECISION_REQUEST_PATTERN.test(normalized);
}

export function isCurrentDateTimeQuery(message: string): boolean {
    const normalized = message.trim();
    if (normalized.length === 0) {
        return false;
    }
    return CURRENT_DATETIME_QUERY_PATTERN.test(normalized);
}

export function isLocalHostOperationIntent(message: string): boolean {
    const normalized = message.trim();
    if (normalized.length === 0) {
        return false;
    }
    const hasVerb = LOCAL_HOST_OPERATION_VERB_PATTERN.test(normalized);
    if (!hasVerb) {
        return false;
    }
    return LOCAL_HOST_OPERATION_OBJECT_PATTERN.test(normalized)
        || FILESYSTEM_PATH_TOKEN_PATTERN.test(normalized);
}

export function isPlatformTrendingLookupQuery(message: string): boolean {
    const normalized = message.trim();
    if (normalized.length === 0) {
        return false;
    }
    if (
        isLocalHostOperationIntent(normalized)
        || (LOCAL_HOST_OPERATION_VERB_PATTERN.test(normalized) && /[\\/]/u.test(normalized))
    ) {
        return false;
    }
    const hasSourceSignal = PLATFORM_MEDIA_SOURCE_PATTERN.test(normalized);
    const hasTrendingSignal = PLATFORM_TRENDING_SIGNAL_PATTERN.test(normalized);
    const hasContentSignal = PLATFORM_MEDIA_CONTENT_PATTERN.test(normalized);
    const hasDiscoveryCue = WEB_DISCOVERY_QUERY_CUE_PATTERN.test(normalized);
    const hasLookupRequestTone = LOOKUP_REQUEST_TONE_PATTERN.test(normalized);
    if (!hasTrendingSignal) {
        return false;
    }
    if (hasSourceSignal) {
        return hasDiscoveryCue || hasContentSignal || hasLookupRequestTone;
    }
    return hasContentSignal
        && (hasDiscoveryCue || hasLookupRequestTone);
}
