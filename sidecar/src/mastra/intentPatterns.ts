export const MARKET_QUERY_PATTERN = /\b(stock|stocks|share|shares|price|prices|quote|quotes|market|markets|equity|equities|finance|financial|ticker|tickers|investment|invest|portfolio|analyst|rating|buy|sell|hold|earnings|revenue|valuation|hkex|nasdaq|nyse|a-share)\b|a股|港股|美股|股价|行情|涨跌|走势|市值|成交量|成交额|开盘|收盘|最高|最低|投资|买入|卖出|持有|评级|目标价|财报|营收|估值|\(([A-Z]{1,5}|\d{3,5}\.HK)\)/iu;

export const WEATHER_QUERY_PATTERN = /\b(weather|forecast|temperature|humidity|rain|snow|wind|uv|aqi|air quality|meteo)\b|天气|气温|温度|湿度|降雨|下雨|下雪|风力|空气质量|预报/iu;

export const NEWS_QUERY_PATTERN = /\b(news|headlines?|breaking|latest|today(?:'s)?|trend(?:ing)?)\b|新闻|资讯|快讯|头条|最新|趋势/iu;

export const GENERIC_WEB_LOOKUP_PATTERN = /(?:\b(search|lookup|find|research|web\s*search|crawl)\b|搜索|查询|检索|调研|查找|搜一下|查一下)|(?:(?:\b(latest|recent|current|today|real[-\s]?time)\b|最新|近期|当前|今天|实时).{0,12}(?:\b(news|weather|forecast|price|quote|rating|review|exchange\s*rate|box\s*office|trend|data|paper|papers)\b|新闻|资讯|天气|预报|价格|报价|评分|汇率|票房|趋势|数据|论文|研报))/iu;

export const VOICE_OUTPUT_REQUEST_PATTERN = /(语音|朗读|读给我听|播报|tts|text-to-speech|voice\s*(?:read|speak|tts)?|read\s+(?:it|this|that)\s+aloud|speak\s+(?:it|this|that)\s+aloud)/iu;
