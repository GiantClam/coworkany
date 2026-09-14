import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkbenchWorkflowDirectory } from "../src/index";

test("shared workflow directory renders online list, metrics, templates and recent runs before Canvas", () => {
  const markup = renderToStaticMarkup(<WorkbenchWorkflowDirectory
    locale="zh"
    workflows={[{ id: "workflow-1", title: "内容生产", description: "生成并审核内容", status: "live", updatedAt: "2026-08-12T00:00:00Z", nodeCount: 3 }]}
    templates={[{ id: "template-1", title: "营销内容模板", description: "从模板创建", status: "ready" }]}
    recentRuns={[{ id: "run-1", workflowId: "workflow-1", workflowTitle: "内容生产", status: "succeeded", createdAt: "2026-08-12T00:00:00Z", finishedAt: "2026-08-12T00:01:00Z" }]}
    onAction={() => undefined}
  />);
  assert.match(markup, /data-cloud-surface="workflow-directory"/);
  assert.match(markup, /工作流总数/);
  assert.match(markup, /已保存的工作流/);
  assert.match(markup, /工作流模板/);
  assert.match(markup, /最近运行/);
  assert.ok(markup.indexOf('data-workflow-section="saved"') < markup.indexOf('data-workflow-section="templates"'));
  assert.ok(markup.indexOf('data-workflow-section="templates"') < markup.indexOf('data-workflow-section="recent-runs"'));
  assert.match(markup, /打开 Canvas/);
});

test("workflow directory hides unsupported destructive host actions", () => {
  const markup = renderToStaticMarkup(<WorkbenchWorkflowDirectory
    locale="zh"
    workflows={[{ id: "workflow-1", title: "内容生产", description: "生成并审核内容", status: "live", updatedAt: "2026-08-12T00:00:00Z", nodeCount: 3 }]}
    templates={[]}
    recentRuns={[]}
    actionAvailability={{ duplicate: true, delete: false }}
    onAction={() => undefined}
  />);
  assert.match(markup, />复制</);
  assert.doesNotMatch(markup, />删除</);
});

test("workflow deletion is gated by an in-page confirmation", () => {
  const source = readFileSync(resolve(process.cwd(), "src/workflow-directory.tsx"), "utf8");
  assert.match(source, /pendingDeleteWorkflowId/u);
  assert.match(source, /data-workflow-delete-confirmation="true"/u);
  assert.match(source, /确认删除|Confirm delete/u);
  assert.match(source, /onAction\(\{ type: "delete", id: pendingDeleteWorkflowId \}\)/u);
  assert.doesNotMatch(source, /onAction\(\{ type: "delete", id: workflow\.id \}\)/u);
});
