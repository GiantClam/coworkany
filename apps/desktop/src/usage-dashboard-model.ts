import type { MetricsQueryResult } from "@coworkany/workbench-client";

export type UsageDashboardView = {
  readonly overview: MetricsQueryResult["overview"];
  readonly series: MetricsQueryResult["series"];
  readonly rows: readonly {
    readonly run: MetricsQueryResult["runs"][number];
    readonly inputTokensLabel: string;
    readonly outputTokensLabel: string;
    readonly cachedInputTokensLabel: string;
    readonly reasoningTokensLabel: string;
    readonly totalTokensLabel: string;
    readonly costLabel: string;
  }[];
};

function valueLabel(value: number | undefined, locale: "zh" | "en") {
  return value === undefined ? (locale === "zh" ? "未提供" : "Not provided") : new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US").format(value);
}
export function buildUsageDashboardView(result: MetricsQueryResult, locale: "zh" | "en"): UsageDashboardView {
  return {
    overview: result.overview,
    series: result.series,
    rows: result.runs.map((run) => {
      const input = run.metrics.tokens.input;
      const output = run.metrics.tokens.output;
      const total = input === undefined && output === undefined ? undefined : (input ?? 0) + (output ?? 0);
      return {
        run,
        inputTokensLabel: valueLabel(input, locale),
        outputTokensLabel: valueLabel(output, locale),
        cachedInputTokensLabel: valueLabel(run.metrics.tokens.cachedInput, locale),
        reasoningTokensLabel: valueLabel(run.metrics.tokens.reasoning, locale),
        totalTokensLabel: valueLabel(total, locale),
        costLabel: run.metrics.providerCost === undefined ? (locale === "zh" ? "未提供" : "Not provided") : `$${run.metrics.providerCost.toFixed(6)}`,
      };
    }),
  };
}
