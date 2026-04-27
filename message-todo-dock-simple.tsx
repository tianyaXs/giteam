/**
 * 消息发送时的 Todo 进度显示组件（简化版）
 * 
 * 不依赖 opencode 内部 UI 库，使用纯 SolidJS + Tailwind CSS
 * 适合集成到任何桌面端项目中
 */

import { createMemo, createSignal, For, Show, onCleanup } from "solid-js"

// ============ 类型定义 ============

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled"

export interface TodoItem {
  id: string
  content: string
  status: TodoStatus
}

export interface MessageTodoDockProps {
  /** 当前任务列表 */
  todos: TodoItem[]
  /** 是否正在处理中（AI 回复中） */
  isProcessing: boolean
  /** 自定义关闭延迟（毫秒），默认 800ms */
  closeDelay?: number
  /** 点击展开/折叠的回调 */
  onToggle?: (collapsed: boolean) => void
  /** 自定义样式类 */
  class?: string
}

// ============ 辅助组件 ============

/**
 * 脉冲动画指示器
 */
function PulseIndicator() {
  return (
    <span class="relative flex size-2.5">
      <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75"></span>
      <span class="relative inline-flex rounded-full size-2.5 bg-current"></span>
    </span>
  )
}

/**
 * 复选框图标
 */
function TodoCheckbox(props: { status: TodoStatus }) {
  const isCompleted = () => props.status === "completed"
  const isInProgress = () => props.status === "in_progress"
  const isPending = () => props.status === "pending"

  return (
    <div
      class="size-4 rounded border flex items-center justify-center shrink-0 mt-0.5 transition-all duration-200"
      classList={{
        "border-gray-300 dark:border-gray-600 bg-transparent": isPending() || isInProgress(),
        "border-green-500 bg-green-500": isCompleted(),
        "text-gray-400 dark:text-gray-500": isPending(),
        "text-blue-500": isInProgress(),
        "text-white": isCompleted(),
      }}
    >
      <Show when={isCompleted()}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M2 5L4 7L8 3"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </Show>
      <Show when={isInProgress()}>
        <PulseIndicator />
      </Show>
    </div>
  )
}

/**
 * 单个 Todo 项
 */
function TodoListItem(props: { todo: TodoItem }) {
  const isCompleted = () => props.todo.status === "completed"
  const isCancelled = () => props.todo.status === "cancelled"
  const isPending = () => props.todo.status === "pending"

  return (
    <div class="flex items-start gap-2 py-1" data-state={props.todo.status}>
      <TodoCheckbox status={props.todo.status} />
      <span
        class="text-sm break-words transition-all duration-200"
        classList={{
          "text-gray-900 dark:text-gray-100": !isCompleted() && !isCancelled(),
          "text-gray-400 dark:text-gray-500 line-through": isCompleted() || isCancelled(),
          "opacity-70": isPending(),
        }}
      >
        {props.todo.content}
      </span>
    </div>
  )
}

// ============ 主组件 ============

/**
 * 消息发送时的 Todo 进度显示 Dock
 * 
 * 使用示例：
 * ```tsx
 * <MessageTodoDock
 *   todos={[
 *     { id: "1", content: "分析需求", status: "completed" },
 *     { id: "2", content: "编写代码", status: "in_progress" },
 *     { id: "3", content: "测试验证", status: "pending" },
 *   ]}
 *   isProcessing={true}
 * />
 * ```
 */
export function MessageTodoDock(props: MessageTodoDockProps) {
  // 展开/折叠状态
  const [isCollapsed, setIsCollapsed] = createSignal(true)
  
  // 动画进度（0-1）
  const [animProgress, setAnimProgress] = createSignal(0)
  const [collapseProgress, setCollapseProgress] = createSignal(1)
  
  // 计算进度
  const total = createMemo(() => props.todos.length)
  const done = createMemo(() => 
    props.todos.filter(t => t.status === "completed").length
  )
  
  // 当前活跃的任务（用于预览）
  const activeTodo = createMemo(() =>
    props.todos.find(t => t.status === "in_progress") ??
    props.todos.find(t => t.status === "pending") ??
    props.todos.filter(t => t.status === "completed").at(-1) ??
    props.todos[0]
  )
  
  // 是否应该显示
  const shouldShow = createMemo(() => 
    props.todos.length > 0 && props.isProcessing
  )
  
  // 是否应该关闭
  const shouldClose = createMemo(() => 
    props.todos.length > 0 && !props.isProcessing
  )
  
  // 动画帧 ID
  let animFrame: number | undefined
  let closeTimer: number | undefined
  
  // 平滑动画函数
  const animate = (from: number, to: number, duration: number, setter: (v: number) => void) => {
    const start = performance.now()
    
    const step = (now: number) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setter(from + (to - from) * eased)
      
      if (progress < 1) {
        animFrame = requestAnimationFrame(step)
      }
    }
    
    if (animFrame) cancelAnimationFrame(animFrame)
    animFrame = requestAnimationFrame(step)
  }
  
  // 监听显示状态
  createMemo(() => {
    if (shouldShow()) {
      animate(animProgress(), 1, 300, setAnimProgress)
    } else if (shouldClose()) {
      // 延迟关闭
      if (closeTimer) clearTimeout(closeTimer)
      closeTimer = window.setTimeout(() => {
        animate(animProgress(), 0, 300, setAnimProgress)
      }, props.closeDelay ?? 800)
    }
  })
  
  // 监听折叠状态
  createMemo(() => {
    animate(collapseProgress(), isCollapsed() ? 1 : 0, 300, setCollapseProgress)
  })
  
  // 切换展开/折叠
  const toggle = () => {
    const next = !isCollapsed()
    setIsCollapsed(next)
    props.onToggle?.(next)
  }
  
  // 计算值
  const showValue = createMemo(() => Math.max(0, Math.min(1, animProgress())))
  const collapseValue = createMemo(() => Math.max(0, Math.min(1, collapseProgress())))
  const isHidden = createMemo(() => showValue() < 0.02)
  const isListVisible = createMemo(() => !isCollapsed() && showValue() > 0.1)
  
  // 清理
  onCleanup(() => {
    if (animFrame) cancelAnimationFrame(animFrame)
    if (closeTimer) clearTimeout(closeTimer)
  })
  
  return (
    <div
      class={`
        bg-white dark:bg-gray-900
        border border-gray-200 dark:border-gray-700
        rounded-xl
        overflow-hidden
        transition-shadow duration-300
        hover:shadow-sm
        ${props.class ?? ""}
      `}
      classList={{
        "opacity-0 pointer-events-none": isHidden(),
      }}
      style={{
        "max-height": isHidden() 
          ? "0px" 
          : `${Math.max(60, 280 - collapseValue() * (280 - 60))}px`,
        "margin-bottom": `${12 * showValue()}px`,
        opacity: showValue(),
        transform: `translateY(${(1 - showValue()) * 8}px)`,
      }}
    >
      {/* 头部：进度概览 */}
      <div
        class="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors duration-150"
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return
          e.preventDefault()
          toggle()
        }}
      >
        {/* 进度数字 */}
        <span class="text-sm text-gray-900 dark:text-gray-100 inline-flex items-baseline shrink-0">
          <span class="font-semibold">{done()}</span>
          <span class="text-gray-400 dark:text-gray-500 mx-0.5">/</span>
          <span>{total()}</span>
        </span>
        
        {/* 当前任务预览 */}
        <div class="ml-1 min-w-0 overflow-hidden flex-1">
          <Show when={isCollapsed()}>
            <span class="text-sm text-gray-600 dark:text-gray-300 truncate block">
              {activeTodo()?.content}
            </span>
          </Show>
        </div>
        
        {/* 展开/折叠按钮 */}
        <button
          class="ml-auto transition-transform duration-300 ease-out p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
          style={{
            transform: `rotate(${collapseValue() * 180}deg)`,
          }}
          onClick={(e) => {
            e.stopPropagation()
            toggle()
          }}
          aria-label={isCollapsed() ? "展开" : "折叠"}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="text-gray-500 dark:text-gray-400">
            <path
              d="M4 6L8 10L12 6"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
      
      {/* 任务列表 */}
      <div
        class="px-3 pb-3 flex flex-col gap-1 overflow-y-auto"
        classList={{
          "pointer-events-none": !isListVisible(),
        }}
        style={{
          visibility: isListVisible() ? "visible" : "hidden",
          opacity: Math.max(0, Math.min(1, (1 - collapseValue()) * showValue())),
          "max-height": isListVisible() ? "160px" : "0px",
        }}
      >
        <For each={props.todos}>
          {(todo) => <TodoListItem todo={todo} />}
        </For>
      </div>
    </div>
  )
}

export default MessageTodoDock
