import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkbenchShell, workbenchSessionScope } from "../src/index";

test("sidebar shows only the current expert's conversation history", () => {
  const markup = renderToStaticMarkup(<WorkbenchShell
    navItems={[{ path: "/dashboard/ai", label: "AI 对话" }, { path: "/dashboard/ai?agent=executive-brand", label: "品牌战略顾问" }]}
    activePath="/dashboard/ai/conversation-brand?agent=executive-brand"
    onNavigate={() => undefined}
    collapsed={false}
    onToggleCollapsed={() => undefined}
    locale="zh"
    sessions={[
      { path: "/dashboard/ai/conversation-brand?agent=executive-brand", title: "品牌定位", agentId: "executive-brand", updatedAt: "刚刚" },
      { path: "/dashboard/ai/conversation-general", title: "通用会话", updatedAt: "昨天" },
    ]}
    activeSessionAgentId="executive-brand"
    activeSessionAgentLabel="品牌战略顾问"
    onNewSession={() => undefined}
    initialSessionsExpanded
  ><div>内容</div></WorkbenchShell>);

  assert.match(markup, /品牌战略顾问/);
  assert.match(markup, /品牌定位/);
  assert.doesNotMatch(markup, /通用会话/);
  const rootNavIndex = markup.indexOf('data-agent-nav="AI 对话"');
  const expertNavIndex = markup.indexOf('data-agent-nav="品牌战略顾问"');
  assert.equal(markup.slice(rootNavIndex, expertNavIndex).includes("wb-sidebar-sessions"), false);
  assert.match(markup.slice(expertNavIndex), /<section class="wb-sidebar-sessions"/);
  assert.match(markup, /title="品牌战略顾问"[^>]*aria-expanded="true"/);
  assert.doesNotMatch(markup, /class="wb-sidebar-session-heading">品牌战略顾问/);
});

test("sidebar keeps general AI conversations out of an expert entry", () => {
  const markup = renderToStaticMarkup(<WorkbenchShell
    navItems={[{ path: "/dashboard/ai", label: "AI 对话" }, { path: "/dashboard/ai?agent=executive-brand", label: "品牌战略顾问" }]}
    activePath="/dashboard/ai"
    onNavigate={() => undefined}
    collapsed={false}
    onToggleCollapsed={() => undefined}
    locale="zh"
    sessions={[
      { path: "/dashboard/ai/general-1", title: "通用会话", updatedAt: "昨天" },
      { path: "/dashboard/ai/expert-1?agent=executive-brand", title: "品牌定位", agentId: "executive-brand", updatedAt: "刚刚" },
    ]}
    activeSessionAgentId={null}
    onNewSession={() => undefined}
    initialSessionsExpanded
  ><div>内容</div></WorkbenchShell>);

  assert.match(markup, /通用会话/);
  assert.doesNotMatch(markup, /品牌定位/);
});

test("creative workspace assistants render only their own conversation history", () => {
  const navItems = [
    { path: "/dashboard/ai", label: "AI 对话" },
    { path: "/dashboard/writer", label: "多平台写作" },
    { path: "/dashboard/image-assistant", label: "图片设计助手" },
  ];
  const sessions = [
    { path: "/dashboard/ai/general-1", title: "通用会话", updatedAt: "昨天" },
    { path: "/dashboard/writer/writer-1", title: "公众号文案", agentId: "entry:writer", updatedAt: "刚刚" },
    { path: "/dashboard/image-assistant/image-1", title: "产品海报", agentId: "entry:image-assistant", updatedAt: "刚刚" },
  ];
  const renderCreativeShell = (activePath: string, scope: string, label: string) => renderToStaticMarkup(<WorkbenchShell
    navItems={navItems}
    activePath={activePath}
    onNavigate={() => undefined}
    collapsed={false}
    onToggleCollapsed={() => undefined}
    locale="zh"
    sessions={sessions}
    activeSessionAgentId={scope}
    activeSessionAgentLabel={label}
    hideSessionScopes={["entry:image-assistant"]}
    onNewSession={() => undefined}
    initialSessionsExpanded
  ><div>内容</div></WorkbenchShell>);

  const writerMarkup = renderCreativeShell("/dashboard/writer/writer-1", "entry:writer", "多平台写作");
  assert.match(writerMarkup, /公众号文案/);
  assert.match(writerMarkup, /aria-expanded="true"/);
  assert.doesNotMatch(writerMarkup, /class="wb-sidebar-session-heading">多平台写作/);
  assert.doesNotMatch(writerMarkup, /产品海报/);
  assert.doesNotMatch(writerMarkup, /通用会话/);

  const imageMarkup = renderCreativeShell("/dashboard/image-assistant/image-1", "entry:image-assistant", "图片设计助手");
  assert.doesNotMatch(imageMarkup, /产品海报/);
  assert.doesNotMatch(imageMarkup, /wb-sidebar-sessions/);
  assert.doesNotMatch(imageMarkup, /aria-expanded="true"/);
  assert.doesNotMatch(imageMarkup, /公众号文案/);
  assert.doesNotMatch(imageMarkup, /通用会话/);
});

test("PPT agents and dedicated creative entries never share a session scope", () => {
  assert.equal(workbenchSessionScope("/dashboard/ai/conversation-ppt?agent=executive-presentation-ppt"), "executive-presentation-ppt");
  assert.equal(workbenchSessionScope("/dashboard/writer/conversation-writing?agent=executive-presentation-ppt"), "entry:writer");

  const markup = renderToStaticMarkup(<WorkbenchShell
    navItems={[
      { path: "/dashboard/ai", label: "AI 对话" },
      { path: "/dashboard/ai?agent=executive-presentation-ppt", label: "演讲型 PPT 助手" },
      { path: "/dashboard/writer", label: "多平台写作" },
    ]}
    activePath="/dashboard/ai/conversation-ppt?agent=executive-presentation-ppt"
    onNavigate={() => undefined}
    collapsed={false}
    onToggleCollapsed={() => undefined}
    locale="zh"
    sessions={[
      { path: "/dashboard/ai/conversation-general", title: "通用会话", updatedAt: "昨天" },
      { path: "/dashboard/ai/conversation-ppt?agent=executive-presentation-ppt", title: "路演 PPT", agentId: "executive-presentation-ppt", updatedAt: "刚刚" },
      { path: "/dashboard/writer/conversation-writing", title: "品牌文章", agentId: "entry:writer", updatedAt: "刚刚" },
    ]}
    activeSessionAgentId="executive-presentation-ppt"
    activeSessionAgentLabel="演讲型 PPT 助手"
    initialSessionsExpanded
  ><div>内容</div></WorkbenchShell>);

  assert.match(markup, /路演 PPT/);
  assert.doesNotMatch(markup, /通用会话/);
  assert.doesNotMatch(markup, /品牌文章/);
});
