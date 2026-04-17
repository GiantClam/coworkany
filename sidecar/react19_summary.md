# React 19 新特性简短技术总结

## 版本与背景
React 19 已于 **2024-12-05** 稳定发布。相比 React 18，React 19 的重点是：
- 更完整的异步交互模型（Actions）
- 更原生的表单与乐观更新支持
- 更强的资源加载与文档元数据能力
- RSC（React Server Components）生态稳定化

## 核心新特性

### 1) Actions：异步状态更新的一等公民
React 19 允许在 `startTransition` 中直接使用 async 函数（称为 Actions），从而统一处理：
- pending 状态
- 错误处理
- 乐观更新
- 表单提交流程

这降低了以往手动管理 `isPending/error` 等状态的样板代码。

### 2) 新 Hooks：`useActionState`、`useOptimistic`、`use`
- **`useActionState`**：封装 Action 调用，直接得到 action 结果和 pending 状态。
- **`useOptimistic`**：请求未完成时先显示“预期结果”，提升交互体验。
- **`use`**：可在 render 中读取 Promise 或 Context；传 Promise 时会触发 Suspense。

### 3) 表单能力增强（React DOM）
React 19 中 `<form action={fn}>`、`formAction` 支持函数，配合：
- **`useFormStatus`**：读取父级表单状态（`pending/data/method/action`）
- **`requestFormReset`**：手动重置表单

这使“提交按钮随提交状态禁用/展示提交中”等场景更标准化。

### 4) 资源与文档管理能力提升
React DOM 新增对以下能力的原生支持：
- 文档元数据标签（自动提升到 `<head>`）
- 样式表插入顺序优化（配合 Suspense）
- 异步脚本渲染顺序与去重
- 资源预加载 API（`preinit/preload/prefetchDNS/preconnect`）

对首屏性能优化和框架层 SSR/Streaming 有明显价值。

### 5) Server Components 进入稳定阶段
React 19 中与 RSC 相关的指令、Server Components、Server Functions 已稳定，便于库作者将 React 19 作为 peer 目标。

## 升级关注点（简）
- 官方建议先升级到 **18.3.1**（含 React 19 迁移预警）再升 19。
- React 19 要求 **新 JSX Transform**。
- `ref` 作为 prop 更主流（减少 `forwardRef` 需求），部分旧 API 已弃用或发出警告。

## 一句话结论
React 19 的核心价值是把“异步交互 + 表单 + Suspense + 资源调度”打通：开发体验更统一、用户体验更流畅，也为全栈 React（尤其 RSC/SSR）提供了更稳的基础设施。

## 参考资料（检索证据）
1. React 官方博客：React v19（稳定发布）  
   https://react.dev/blog/2024/12/05/react-19
2. React 官方 Changelog（19.0.0）  
   https://raw.githubusercontent.com/facebook/react/1825990c5608f0ab0c1475b4292218a508a171c9/CHANGELOG.md
