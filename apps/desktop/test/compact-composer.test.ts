import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("desktop home and conversation routes activate the compact composer controls", () => {
  const source = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(source, /model=\{modelSelection \?\? model\} onModelChange=\{onModelChange\} reasoningEffort=\{reasoningEffort\} onReasoningChange=\{onReasoningChange\} knowledgeBases=\{knowledgeBases\} knowledgeEnabled=\{knowledgeEnabled\} onKnowledgeToggle=\{onKnowledgeToggle\}/);
  assert.match(source, /model=\{activeModel\} onModelChange=\{updateModel\} reasoningEffort=\{reasoningEffort\} onReasoningChange=\{updateReasoning\} knowledgeBases=\{knowledgeBaseOptions\} knowledgeEnabled=\{knowledgeContextEnabled\} onKnowledgeToggle=/);
  assert.match(source, /function knowledgeBaseOptionsForConfig/);
  assert.match(source, /knowledgeBases=\{knowledgeBaseOptions\}/);
  assert.doesNotMatch(source, /Ctrl\+Enter 发送 · Enter 换行/);
  assert.doesNotMatch(source, /Ctrl\+Enter to send · Enter for a new line/);
});
