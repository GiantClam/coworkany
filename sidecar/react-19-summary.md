# React 19 新特性技术总结

> 来源：https://react.dev/blog/2024/12/05/react-19  
> 发布日期：2024 年 12 月 5 日（稳定版）

---

## 1. Actions — 异步操作的统一模式

React 19 最核心的变化是引入了 **Actions** 概念：在 `useTransition` 中直接使用 async 函数，React 会自动管理 pending 状态、错误处理和乐观更新。

```jsx
// React 19 之前：手动管理 isPending / error
const [isPending, setIsPending] = useState(false);
const handleSubmit = async () => {
  setIsPending(true);
  const error = await updateName(name);
  setIsPending(false);
};

// React 19：useTransition 自动处理
const [isPending, startTransition] = useTransition();
const handleSubmit = () => {
  startTransition(async () => {
    const error = await updateName(name);
    if (error) { setError(error); return; }
    redirect("/path");
  });
};
```

Actions 自动提供：
- **Pending 状态**：请求开始时自动设为 true，结束后重置
- **错误处理**：请求失败时触发 Error Boundary，并回滚乐观更新
- **表单重置**：`<form>` 提交成功后自动重置非受控组件

---

## 2. 新 Hook：useActionState

简化 Action 的常见模式，返回 `[result, action, isPending]`：

```jsx
const [error, submitAction, isPending] = useActionState(
  async (previousState, formData) => {
    const error = await updateName(formData.get("name"));
    if (error) return error;
    redirect("/path");
    return null;
  },
  null
);
```

> 注意：Canary 版本中叫 `ReactDOM.useFormState`，已重命名并废弃旧名。

---

## 3. `<form>` Actions 集成

`<form>`、`<input>`、`<button>` 的 `action` / `formAction` 属性现在支持直接传入函数：

```jsx
<form action={submitAction}>
  <input type="text" name="name" />
  <button type="submit" disabled={isPending}>Update</button>
</form>
```

---

## 4. 新 Hook：useFormStatus

在设计系统中，子组件可以直接读取父 `<form>` 的状态，无需 prop drilling：

```jsx
import { useFormStatus } from 'react-dom';

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>Submit</button>;
}
```

---

## 5. 新 Hook：useOptimistic

在异步请求进行中立即展示乐观结果，请求完成后自动同步真实状态：

```jsx
const [optimisticName, setOptimisticName] = useOptimistic(currentName);

const submitAction = async (formData) => {
  const newName = formData.get("name");
  setOptimisticName(newName);           // 立即显示
  const updated = await updateName(newName); // 等待真实结果
  onUpdateName(updated);
};
```

---

## 6. 新 API：use()

`use()` 可以在渲染期间读取 Promise 或 Context，支持条件调用（不同于其他 Hook）：

```jsx
const value = use(SomeContext);
const data = use(fetchPromise); // 配合 Suspense 使用
```

---

## 7. React Server Components & Server Actions

- **Server Components** 正式稳定，支持在服务端渲染组件，减少客户端 bundle 体积
- **Server Actions**：客户端组件可通过 `"use server"` 指令调用服务端异步函数

---

## 8. 其他改进

| 特性 | 说明 |
|------|------|
| `ref` 作为 prop | 函数组件可直接接收 `ref` prop，无需 `forwardRef` |
| `<Context>` 作为 Provider | 可直接用 `<MyContext value={...}>` 替代 `<MyContext.Provider>` |
| Document Metadata | 支持在组件内直接渲染 `<title>`、`<meta>`、`<link>`，React 自动提升到 `<head>` |
| 样式表优先级 | `<link rel="stylesheet">` 支持 `precedence` 属性，React 管理加载顺序 |
| 异步脚本 | `<script async>` 去重，避免重复加载 |
| 资源预加载 API | 新增 `preload()`、`prefetchDNS()`、`preconnect()` 等 API |
| Suspense 预热 | 挂起树在提交前预热，减少白屏时间 |
| React DOM Static APIs | 新增 `prerender` / `prerenderToNodeStream` 用于静态生成 |

---

## 总结

React 19 的核心主题是**减少样板代码**：Actions 体系统一了异步数据变更的处理方式，新 Hook（`useActionState`、`useOptimistic`、`useFormStatus`）覆盖了最常见的 UI 交互模式。Server Components 正式稳定也标志着 React 全栈渲染能力的成熟。对于大多数项目，升级 React 19 的主要收益在于表单和异步逻辑的大幅简化。
