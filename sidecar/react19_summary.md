# React 19 新特性简短技术总结

基于 React 官方发布文档（React v19，2024-12-05）整理。

## 1) Actions：异步状态管理范式升级
React 19 将“数据变更 + 提交状态 + 错误处理 + 乐观更新”整合为统一的 Actions 模型：
- 支持在 `startTransition` 中直接使用 async 函数
- 自动管理 pending 状态
- 与错误边界和乐观更新联动
- 与表单能力深度集成

**价值**：减少手写 `isPending/error` 样板代码，让提交交互更一致。

## 2) 新 Hook：`useActionState`
用于封装常见 Action 流程：
- 返回上次 Action 结果
- 提供包装后的提交函数
- 提供 pending 状态

典型场景：表单提交后返回错误信息或成功结果，组件内逻辑更集中。

## 3) React DOM 表单增强：`<form action={fn}>`
React 19 支持给 `<form>` / `<button>` / `<input>` 直接传函数作为 action：
- 提交更声明式
- 成功后可自动重置（非受控表单）
- 可配合 `requestFormReset` 做手动重置

**价值**：表单提交从“事件驱动 + 手工拼装”转向“声明式动作调用”。

## 4) 新 Hook：`useFormStatus`（react-dom）
在设计系统组件里无需层层透传 props，即可读取父级 form 状态（如 `pending`）。

**价值**：提升按钮、输入组件等通用组件的可复用性和解耦程度。

## 5) 新 Hook：`useOptimistic`
为异步提交提供内置乐观更新能力：
- 请求发出时立即显示预期结果
- 请求成功或失败后自动回到真实状态

**价值**：显著改善交互“响应速度感知”，降低自行回滚的复杂度。

## 6) 新 API：`use`
`use` 允许在 render 阶段读取资源：
- 可读取 Promise（配合 Suspense）
- 可条件化读取 Context（相比 `useContext` 更灵活）

注意：不支持在客户端组件 render 内即时创建且未缓存的 Promise。

## 7) 新静态渲染 API（`react-dom/static`）
新增：
- `prerender`
- `prerenderToNodeStream`

用于静态 HTML 生成，支持等待数据就绪后输出，更适合 SSG 场景。

## 8) Server Components 能力进入稳定版本生态
React 19 将 Canary 阶段的相关能力纳入稳定版本，便于框架和库以 React 19 为依赖目标推进全栈 React 架构。

---

## 升级建议（简短）
1. **先升级核心依赖**：`react` / `react-dom` 到 19，并按官方 Upgrade Guide 处理 breaking changes。
2. **优先改造表单流**：从 `onSubmit + useState` 逐步迁移到 `action + useActionState`。
3. **引入乐观交互**：在高频提交场景使用 `useOptimistic`。
4. **结合 Suspense 评估 `use`**：先在框架支持良好的数据流中试点。

## 结论
React 19 的核心方向是：
- **把异步交互“内建化”**（Actions / 表单 / 乐观更新）
- **把资源读取“渲染期化”**（`use` + Suspense）
- **把服务端与静态能力“平台化”**（static APIs / Server Components）

这会让 React 应用在“数据提交、加载协同、全栈渲染”三个方面代码更少、语义更统一。
