# React 19 新特性技术总结

> 发布时间：2024 年 12 月正式稳定版  
> 参考来源：ZeonEdge、ECOSIRE、DEV Community（2026-03 ~ 2026-04）

---

## 概述

React 19 是自 Hooks 以来最重要的一次版本更新，核心目标是让并发模式真正可用，同时大幅减少处理异步状态、表单和性能优化所需的样板代码。

---

## 主要新特性

### 1. Actions —— 异步状态处理新范式

React 19 引入 **Actions** 概念，任何传给 `<form action={...}>` 或 `useActionState` 的异步函数都是 Action。它取代了 React 18 中 `useTransition + useState + try/catch` 的繁琐组合。

```tsx
import { useActionState } from 'react'

async function updateProfileAction(prevState, formData) {
  try {
    await updateProfile({ name: formData.get('name') })
    return { error: null, success: true }
  } catch (err) {
    return { error: err.message, success: false }
  }
}

function ProfileForm() {
  const [state, action, isPending] = useActionState(
    updateProfileAction,
    { error: null, success: false }
  )
  return (
    <form action={action}>
      <input name="name" />
      <button disabled={isPending}>{isPending ? '保存中...' : '保存'}</button>
      {state.error && <p>{state.error}</p>}
    </form>
  )
}
```

### 2. `useFormStatus` —— 读取父级表单状态

子组件可以直接读取最近父级 `<form>` 的提交状态，无需 prop drilling。

```tsx
import { useFormStatus } from 'react-dom'

function SubmitButton() {
  const { pending } = useFormStatus()
  return <button disabled={pending}>{pending ? '提交中...' : '提交'}</button>
}
```

### 3. `useOptimistic` —— 乐观更新

在服务器响应返回前立即更新 UI，若请求失败则自动回滚。

```tsx
import { useOptimistic } from 'react'

const [optimisticto dos, addOptimisticto do] = useOptimistic(
  to dos,
  (state, newto do) => [...state, newto do]
)
```

### 4. `use()` Hook —— 在渲染中读取 Promise 和 Context

`use()` 是一个突破性的 Hook，可以在条件语句和循环中调用（打破了原有 Hook 规则），用于直接消费 Promise 和 Context。

```tsx
import { use } from 'react'

function UserProfile({ userPromise }) {
  // 可以在条件分支中使用
  const user = use(userPromise)
  return <div>{user.name}</div>
}
```

配合 `<Suspense>` 使用，实现声明式数据加载。

### 5. React Compiler（原 React Forget）

React 19 同期发布了 **React Compiler** 的 Beta 版，作为 Babel 插件在构建时自动插入 `useMemo` / `useCallback`，彻底告别手动记忆化。

```bash
npm install --save-dev babel-plugin-react-compiler
```

开发者无需再手动编写：
```tsx
// 以前
const memoizedValue = useMemo(() => compute(a, b), [a, b])
// 现在：编译器自动处理
const value = compute(a, b)
```

### 6. Server Components 正式稳定

React Server Components（RSC）从实验性功能升级为稳定 API，完全集成到并发渲染模型中。服务端组件无状态、无生命周期，直接在服务器渲染，减少客户端 JS 体积。

### 7. 资源预加载 API

新增 `preload`、`preinit` 等 API，可在组件内控制资源加载时机：

```tsx
import { preload, preinit } from 'react-dom'

preinit('/critical.js', { as: 'script' })
preload('/hero.png', { as: 'image' })
```

### 8. 文档元数据支持

可以在任意组件中直接使用 `<title>`、`<meta>`、`<link>` 等标签，React 会自动将其提升到 `<head>`，无需第三方库（如 react-helmet）。

```tsx
function BlogPost({ title }) {
  return (
    <>
      <title>{title}</title>
      <meta name="description" content="..." />
      <article>...</article>
    </>
  )
}
```

---

## 升级方式

```bash
# 新项目
npm create vite@latest my-app -- --template react-ts
npm install react@19 react-dom@19

# 已有项目升级
npm install react@19 react-dom@19 @types/react@19 @types/react-dom@19
npx react-codemod update-react-imports .
```

---

## 总结

| 特性 | 解决的问题 |
|------|-----------|
| Actions / `useActionState` | 表单和异步操作的样板代码 |
| `useFormStatus` | 表单状态的 prop drilling |
| `useOptimistic` | 乐观更新的复杂实现 |
| `use()` Hook | Suspense 数据加载的繁琐写法 |
| React Compiler | 手动 `useMemo`/`useCallback` |
| Server Components 稳定 | 客户端 JS 体积过大 |
| 文档元数据 | 依赖 react-helmet 等第三方库 |

React 19 的核心思路是：把常见的复杂模式内置到框架层，让开发者专注于业务逻辑。
