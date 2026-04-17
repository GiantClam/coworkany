# React 19 新特性技术总结

React 19 于 2024 年 12 月发布稳定版，这是自 Hooks 以来最重大的更新。以下是核心新特性：

## 1. Actions - 表单处理革命

React 19 引入了 Actions 机制，可以直接将异步函数传递给表单的 `action` 属性，框架自动处理 pending 状态、过渡和错误边界。

**传统方式**：需要手动管理多个 useState（loading、error、success）

**React 19 方式**：
```jsx
<form action={submitAction}>
  <input name="email" type="email" required />
  <button disabled={isPending}>
    {isPending ? '发送中...' : '发送'}
  </button>
</form>
```

## 2. useActionState Hook

专门用于表单状态管理的新 Hook，返回 `[state, action, isPending]`：

```jsx
const [state, submitAction, isPending] = useActionState(
  async (prevState, formData) => {
    try {
      await submitContact(formData);
      return { status: 'success' };
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  },
  { status: 'idle' }
);
```

大幅减少表单处理的样板代码。

## 3. useOptimistic - 乐观更新

让乐观 UI 更新成为一等公民，无需手动回滚状态：

```jsx
const [optimisticLikes, addOptimisticLike] = useOptimistic(
  likes,
  (current, increment) => current + increment
);

async function handleLike() {
  addOptimisticLike(1); // 立即显示 +1
  const newCount = await likePost(postId); // 网络请求
  setLikes(newCount); // 更新真实数据
}
```

适用场景：点赞、关注、书签等成功率高的交互。

## 4. use() Hook - 突破性设计

这是唯一可以**条件调用**的 Hook，可以在循环、条件语句中使用：

```jsx
function UserProfile({ userPromise }) {
  const user = use(userPromise); // 组件挂起直到 Promise 完成
  return <div>{user.name}</div>;
}
```

支持 Promise 和 Context，与 Suspense 配合实现真正的数据挂起。

## 5. ref 作为 Prop - 告别 forwardRef

不再需要 `forwardRef` 包装器，ref 现在是普通 prop：

```jsx
// React 19
function Input({ label, ref }) {
  return <input ref={ref} aria-label={label} />;
}
```

更简洁的组件签名，`forwardRef` 成为遗留 API。

## 6. useFormStatus Hook

子组件可以读取父表单的 pending 状态，无需 prop drilling：

```jsx
function SubmitButton() {
  const { pending } = useFormStatus();
  return <button disabled={pending}>
    {pending ? '提交中...' : '提交'}
  </button>;
}
```

## 7. Ref 清理函数

ref 回调现在支持返回清理函数，类似 useEffect：

```jsx
<input ref={(node) => {
  if (node) {
    node.focus();
    return () => node.blur(); // 卸载时清理
  }
}} />
```

## 8. 文档元数据支持

可以在组件中直接渲染 `<title>`、`<meta>`、`<link>` 标签，React 自动提升到 `<head>`：

```jsx
function BlogPost({ post }) {
  return (
    <article>
      <title>{post.title} — 我的博客</title>
      <meta name="description" content={post.description} />
      {/* 文章内容 */}
    </article>
  );
}
```

## 9. React Server Components 稳定版

Server Components 从实验性功能转为稳定版，与并发渲染模型完全集成，零客户端 JavaScript 成本。

## 总结

React 19 的核心目标是**减少样板代码**，让常见模式（表单、异步状态、乐观更新、refs）更符合直觉。这不是理论改进，而是实实在在提升日常开发体验的更新。

**升级建议**：如果你的项目大量使用表单和异步交互，React 19 能显著简化代码。

---
*基于 React 19 官方稳定版（2024 年 12 月）整理*
