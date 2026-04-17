# React 19 新特性简短技术总结

## 资料来源
1. React 官方博客（稳定版）: https://react.dev/blog/2024/12/05/react-19
2. React 官方博客（RC 原文入口，已更新到稳定版说明）: https://react.dev/blog/2024/04/25/react-19

## 核心新特性（面向开发者）

### 1) Actions：把“提交 + 异步状态 + 错误处理 + 乐观更新”整合为一等能力
React 19 强化了对异步更新流的支持。通过在 transition 中使用 async 函数（通常称为 Actions），可以更自然地处理提交中的 pending 状态、错误回滚与界面响应性，减少手写样板代码。

**价值**：
- 减少 `useState` 管理 loading/error 的重复逻辑
- 在异步请求期间保持 UI 可交互
- 更好地和错误边界、乐观更新配合

### 2) 新 Hook：`useActionState`
`useActionState` 用于封装常见 Action 场景，返回“最新结果 + 包装后的 action + pending 状态”。

**价值**：
- 统一 action 的输入输出模型
- 降低表单/提交逻辑复杂度
- 更适合构建可复用的数据提交组件

### 3) React DOM 表单能力升级：`<form action={fn}>`
在 React 19 中，`<form>`、`<input>`、`<button>` 支持函数形式 `action/formAction`，可直接触发 Actions。提交成功后，非受控表单可自动 reset。

**价值**：
- 表单提交语义更贴近 HTML 原生模型
- 代码更简洁，减少事件处理模板代码
- 与服务端/异步提交模式更容易衔接

### 4) 新 Hook：`useFormStatus`（react-dom）
`useFormStatus` 可在表单内部任意层级读取父表单状态（如 `pending`），避免层层透传 props。

**价值**：
- 设计系统组件（如 SubmitButton）更易复用
- 降低 Context/props drilling 成本

### 5) 新 Hook：`useOptimistic`
`useOptimistic` 用于快速实现乐观更新：请求发出后先更新 UI，失败再自动回退。

**价值**：
- 提升交互“秒响应”体验
- 乐观状态管理更标准化

### 6) 稳定版补充点（相较 RC）
官方稳定版说明里额外强调了：
- Suspense 的改进（含 suspended trees 的预热能力）
- 新的 React DOM 静态 API

这说明 React 19 不仅是 Hook/表单层面的易用性提升，也继续强化了渲染与服务端相关能力。

## 升级与落地建议（简要）
1. **先迁移提交链路**：优先把关键表单从手写 `loading/error` 迁移到 `action + useActionState`。
2. **统一按钮状态模型**：在组件库中使用 `useFormStatus` 做提交态禁用与 loading 展示。
3. **谨慎引入乐观更新**：对冲突敏感或强一致场景，先小范围试点 `useOptimistic`。
4. **配合官方升级指南排查 breaking changes**：先在核心业务路径做灰度。

## 一句话总结
React 19 的主线是：让“数据提交”成为 React 的内建工作流（Actions + Form + Status + Optimistic），以更少样板代码换取更稳定的异步交互体验。