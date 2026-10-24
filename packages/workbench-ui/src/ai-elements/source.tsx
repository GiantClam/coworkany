"use client";

import React, { createContext, forwardRef, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ComponentProps, type CSSProperties, type FormEvent, type HTMLAttributes, type ReactNode, type RefObject, type TextareaHTMLAttributes } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Accordion from "@radix-ui/react-accordion";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as HoverCard from "@radix-ui/react-hover-card";
import * as Select from "@radix-ui/react-select";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "cmdk";
import { Check, ChevronDown, ChevronRight, Copy, Download, ExternalLink, FileText, LoaderCircle, Paperclip, Plus, Search, Send, Square, X } from "lucide-react";
import { MediaControlBar, MediaController, MediaDurationDisplay, MediaMuteButton, MediaPlayButton, MediaSeekBackwardButton, MediaSeekForwardButton, MediaTimeDisplay, MediaTimeRange, MediaVolumeRange } from "media-chrome/react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";
import { shouldSubmitPromptInput, type PromptInputSubmitMode } from "./prompt-input-shortcut";

export type AIElementStatus = "queued" | "running" | "streaming" | "waiting" | "blocked" | "completed" | "succeeded" | "failed" | "cancelled" | "denied";

export type AttachmentItem = {
  readonly id: string;
  readonly name: string;
  readonly mediaType?: string;
  readonly uri?: string;
  readonly status?: "queued" | "uploading" | "ready" | "failed";
};

export type ModelOption = {
  readonly id: string;
  readonly label: string;
  readonly provider?: string;
  readonly description?: string;
};

export type PlanStep = { readonly id: string; readonly title: string; readonly status?: AIElementStatus; readonly detail?: string };
export type TaskStep = PlanStep & { readonly toolName?: string };

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function statusLabel(status: AIElementStatus | undefined, locale: "zh" | "en") {
  if (locale === "en") {
    return status === "failed" ? "Failed" : status === "completed" || status === "succeeded" ? "Completed" : status === "denied" ? "Denied" : status === "cancelled" ? "Cancelled" : status === "waiting" ? "Waiting" : status === "queued" ? "Queued" : "Running";
  }
  return status === "failed" ? "失败" : status === "completed" || status === "succeeded" ? "已完成" : status === "denied" ? "已拒绝" : status === "cancelled" ? "已取消" : status === "waiting" ? "等待操作" : status === "queued" ? "排队中" : "运行中";
}

function formatValue(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

type AttachmentsContextValue = { variant: "grid" | "inline" | "list" };
type AttachmentContextValue = { item: AttachmentItem; variant: "grid" | "inline" | "list"; onRemove?: () => void };
const AttachmentsContext = createContext<AttachmentsContextValue | null>(null);
const AttachmentContext = createContext<AttachmentContextValue | null>(null);

export function Attachments({ items = [], variant = "inline", onRemove, children, className, ...props }: { items?: readonly AttachmentItem[]; variant?: "grid" | "inline" | "list"; onRemove?: (id: string) => void; children?: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  if (!items.length && !children) return null;
  return <AttachmentsContext.Provider value={{ variant }}><div {...props} className={cx("ai-elements-attachments", `ai-elements-attachments-${variant}`, "wb-ai-attachments", `wb-ai-attachments-${variant}`, className)} data-slot="attachments" aria-label={props["aria-label"] ?? "Attachments"}>{children ?? items.map((item) => <Attachment key={item.id} item={item} onRemove={onRemove ? () => onRemove(item.id) : undefined} />)}</div></AttachmentsContext.Provider>;
}

export function Attachment({ item, data, onRemove, children, className, ...props }: { item?: AttachmentItem; data?: AttachmentItem; onRemove?: () => void; children?: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  const resolvedItem = data ?? item;
  if (!resolvedItem) return null;
  const variant = useContext(AttachmentsContext)?.variant ?? "inline";
  return <AttachmentContext.Provider value={{ item: resolvedItem, variant, onRemove }}><div {...props} className={cx("ai-elements-attachment", "wb-ai-attachment", variant === "grid" && "ai-elements-attachment-grid", className)} data-slot="attachment" data-attachment-id={resolvedItem.id} data-status={resolvedItem.status ?? "ready"}>{children ?? <><AttachmentPreview /><AttachmentInfo /><AttachmentRemove /></>}</div></AttachmentContext.Provider>;
}

export function AttachmentPreview({ item, className, children, ...props }: { item?: AttachmentItem; className?: string; children?: ReactNode } & HTMLAttributes<HTMLSpanElement>) {
  const context = useContext(AttachmentContext);
  const resolvedItem = item ?? context?.item;
  if (!resolvedItem) return null;
  const image = resolvedItem.mediaType?.startsWith("image/");
  const body = children ?? (image && resolvedItem.uri ? <img src={resolvedItem.uri} alt="" /> : image ? "▧" : resolvedItem.mediaType?.startsWith("video/") ? "▣" : <FileText size={16} />);
  return <span {...props} className={cx("ai-elements-attachment-preview", "wb-ai-attachment-preview", className)} data-slot="attachment-preview" aria-hidden={children ? undefined : true}>{body}</span>;
}

export function AttachmentInfo({ item, showMediaType = true, className, children, ...props }: { item?: AttachmentItem; showMediaType?: boolean; className?: string; children?: ReactNode } & HTMLAttributes<HTMLSpanElement>) {
  const context = useContext(AttachmentContext);
  const resolvedItem = item ?? context?.item;
  if (!resolvedItem) return null;
  return <span {...props} className={cx("ai-elements-attachment-info", "wb-ai-attachment-info", className)} data-slot="attachment-info">{children ?? <><strong>{resolvedItem.name}</strong>{showMediaType && resolvedItem.mediaType ? <small>{resolvedItem.mediaType}</small> : null}{resolvedItem.status && resolvedItem.status !== "ready" ? <small>{resolvedItem.status}</small> : null}</>}</span>;
}

export function AttachmentRemove({ name, onClick, label = "Remove attachment", className, children, ...props }: { name?: string; onClick?: () => void; label?: string; className?: string; children?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const context = useContext(AttachmentContext);
  const resolvedName = name ?? context?.item.name ?? "attachment";
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => { event.stopPropagation(); onClick?.(); context?.onRemove?.(); };
  if (!onClick && !context?.onRemove) return null;
  return <button {...props} type="button" className={cx("ai-elements-attachment-remove", "wb-ai-attachment-remove", className)} onClick={handleClick} aria-label={props["aria-label"] ?? `${label}: ${resolvedName}`} title={props.title ?? label} data-slot="attachment-remove">{children ?? <X size={14} aria-hidden="true" />}</button>;
}

export function AttachmentHoverCard({ children, ...props }: ComponentProps<typeof HoverCard.Root>) {
  return <HoverCard.Root {...props}>{children}</HoverCard.Root>;
}
export function AttachmentHoverCardTrigger({ children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) { return <HoverCard.Trigger asChild><button {...props} type="button" className={cx("ai-elements-attachment-hover-card-trigger", className)} data-slot="attachment-hover-card-trigger">{children}</button></HoverCard.Trigger>; }
export function AttachmentHoverCardContent({ children, className, ...props }: ComponentProps<typeof HoverCard.Content>) { return <HoverCard.Portal><HoverCard.Content {...props} className={cx("ai-elements-attachment-hover-card-content", className)} data-slot="attachment-hover-card-content">{children}</HoverCard.Content></HoverCard.Portal>; }

export type PromptInputFile = AttachmentItem & { readonly type: "file"; readonly filename: string; readonly url?: string };
export type PromptInputMessage = { readonly text: string; readonly files: readonly PromptInputFile[] };
export type PromptInputAttachments = {
  readonly files: readonly PromptInputFile[];
  readonly add: (files: File[] | FileList) => void;
  readonly remove: (id: string) => void;
  readonly clear: () => void;
  readonly openFileDialog: () => void;
  readonly fileInputRef: RefObject<HTMLInputElement | null>;
};
export type PromptInputController = {
  readonly textInput: { readonly value: string; readonly setInput: (value: string) => void; readonly clear: () => void };
  readonly attachments: PromptInputAttachments;
};
const PromptInputControllerContext = createContext<PromptInputController | null>(null);
const PromptInputProviderAttachmentsContext = createContext<PromptInputAttachments | null>(null);
const LocalPromptInputAttachmentsContext = createContext<PromptInputAttachments | null>(null);
const promptInputFileId = (file: File, index: number) => `${file.name}:${file.size}:${file.lastModified}:${Date.now()}:${index}`;

export function usePromptInputController() {
  const context = useContext(PromptInputControllerContext);
  if (!context) throw new Error("Wrap your component inside <PromptInputProvider> to use usePromptInputController().");
  return context;
}

export function useProviderAttachments() {
  const context = useContext(PromptInputProviderAttachmentsContext);
  if (!context) throw new Error("Wrap your component inside <PromptInputProvider> to use useProviderAttachments().");
  return context;
}

export type PromptInputProviderProps = { initialInput?: string; children?: ReactNode };
export function PromptInputProvider({ initialInput = "", children }: PromptInputProviderProps) {
  const [value, setValue] = useState(initialInput);
  const [files, setFiles] = useState<PromptInputFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const filesRef = useRef(files);
  const add = useCallback((incoming: File[] | FileList) => {
    const next = Array.from(incoming).map((file, index) => ({ id: promptInputFileId(file, index), name: file.name, filename: file.name, mediaType: file.type || undefined, status: "queued" as const, type: "file" as const, url: typeof URL !== "undefined" ? URL.createObjectURL(file) : undefined }));
    setFiles((current) => [...current, ...next]);
  }, []);
  const remove = useCallback((id: string) => setFiles((current) => { const item = current.find((file) => file.id === id); if (item?.url) URL.revokeObjectURL(item.url); return current.filter((file) => file.id !== id); }), []);
  const clear = useCallback(() => setFiles((current) => { current.forEach((file) => { if (file.url) URL.revokeObjectURL(file.url); }); return []; }), []);
  useEffect(() => { filesRef.current = files; }, [files]);
  useEffect(() => () => { filesRef.current.forEach((file) => { if (file.url) URL.revokeObjectURL(file.url); }); }, []);
  const attachments = useMemo<PromptInputAttachments>(() => ({ files, add, remove, clear, openFileDialog: () => fileInputRef.current?.click(), fileInputRef }), [files, add, remove, clear]);
  const controller = useMemo<PromptInputController>(() => ({ textInput: { value, setInput: setValue, clear: () => setValue("") }, attachments }), [value, attachments]);
  return <PromptInputControllerContext.Provider value={controller}><PromptInputProviderAttachmentsContext.Provider value={attachments}>{children}</PromptInputProviderAttachmentsContext.Provider></PromptInputControllerContext.Provider>;
}

type PromptInputContextValue = { value: string; onValueChange: (value: string) => void; status: "ready" | "streaming" | "error"; disabled: boolean; maxHeight?: number | string; attachments: readonly AttachmentItem[]; onRemoveAttachment?: (id: string) => void; onStop?: () => void; locale: "zh" | "en"; promptInputAttachments: PromptInputAttachments };
const PromptInputContext = createContext<PromptInputContextValue | null>(null);
function usePromptInputContext() {
  const context = useContext(PromptInputContext);
  if (!context) throw new Error("PromptInput children must be rendered inside PromptInput");
  return context;
}

export function usePromptInputAttachments() {
  const local = useContext(LocalPromptInputAttachmentsContext);
  const provider = useContext(PromptInputProviderAttachmentsContext);
  const context = local ?? provider;
  if (!context) throw new Error("usePromptInputAttachments must be used within a PromptInput or PromptInputProvider");
  return context;
}

type PromptInputProps = { value?: string; onValueChange?: (value: string) => void; onSubmit: ((message?: PromptInputMessage, event?: FormEvent<HTMLFormElement>) => void | Promise<void>); onAddAttachments?: (files: FileList | null) => void; attachments?: readonly AttachmentItem[]; onRemoveAttachment?: (id: string) => void; status?: "ready" | "streaming" | "error"; isLoading?: boolean; maxHeight?: number | string; onStop?: () => void; disabled?: boolean; locale?: "zh" | "en"; children?: ReactNode; className?: string; accept?: string; multiple?: boolean } & Omit<HTMLAttributes<HTMLFormElement>, "onSubmit">;
export function PromptInput({ value, onValueChange, onSubmit, onAddAttachments, attachments, onRemoveAttachment, status = "ready", isLoading = false, maxHeight, onStop, disabled = false, locale = "zh", children, className, accept, multiple = true, ...props }: PromptInputProps) {
  const resolvedStatus = isLoading ? "streaming" : status;
  const provider = useContext(PromptInputControllerContext);
  const isControlled = value !== undefined || onValueChange !== undefined;
  const [localValue, setLocalValue] = useState("");
  const [localFiles, setLocalFiles] = useState<PromptInputFile[]>([]);
  const inputValue = value ?? provider?.textInput.value ?? localValue;
  const setInputValue = onValueChange ?? provider?.textInput.setInput ?? setLocalValue;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const providerAttachments = provider?.attachments;
  const resolvedAttachments = attachments ?? providerAttachments?.files ?? localFiles;
  const addLocalFiles = useCallback((incoming: File[] | FileList) => {
    const accepted = Array.from(incoming).filter((file) => !accept || accept.split(",").some((pattern) => pattern.trim().endsWith("/*") ? file.type.startsWith(pattern.trim().slice(0, -1)) : file.type === pattern.trim()));
    const next = accepted.map((file, index) => ({ id: promptInputFileId(file, index), name: file.name, filename: file.name, mediaType: file.type || undefined, status: "queued" as const, type: "file" as const, url: typeof URL !== "undefined" ? URL.createObjectURL(file) : undefined }));
    if (providerAttachments) providerAttachments.add(accepted);
    else if (!attachments) setLocalFiles((current) => [...current, ...next]);
    onAddAttachments?.(incoming instanceof FileList ? incoming : null);
  }, [accept, attachments, onAddAttachments, providerAttachments]);
  const removeLocalFile = useCallback((id: string) => {
    if (providerAttachments) providerAttachments.remove(id);
    else { const item = localFiles.find((file) => file.id === id); if (item?.url) URL.revokeObjectURL(item.url); setLocalFiles((current) => current.filter((file) => file.id !== id)); }
    onRemoveAttachment?.(id);
  }, [localFiles, onRemoveAttachment, providerAttachments]);
  const promptInputAttachments = useMemo<PromptInputAttachments>(() => ({ files: resolvedAttachments.map((file) => ({ ...file, type: "file" as const, filename: file.name })), add: addLocalFiles, remove: removeLocalFile, clear: () => resolvedAttachments.forEach((file) => removeLocalFile(file.id)), openFileDialog: () => fileInputRef.current?.click(), fileInputRef }), [addLocalFiles, removeLocalFile, resolvedAttachments]);
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (resolvedStatus === "streaming" || disabled || (!inputValue.trim() && !resolvedAttachments.length)) return;
    if (isControlled) void onSubmit(undefined, event);
    else void onSubmit({ text: inputValue, files: promptInputAttachments.files }, event);
  };
  const dragDepth = useRef(0);
  const [dragActive, setDragActive] = useState(false);
  return <LocalPromptInputAttachmentsContext.Provider value={promptInputAttachments}><PromptInputContext.Provider value={{ value: inputValue, onValueChange: setInputValue, status: resolvedStatus, disabled, maxHeight, attachments: resolvedAttachments, onRemoveAttachment, onStop, locale, promptInputAttachments }}><form {...props} className={cx("ai-elements-prompt-input", "wb-ai-prompt-input", className)} onSubmit={handleSubmit} data-slot="prompt-input" data-status={resolvedStatus} data-drag-active={dragActive ? "true" : undefined} data-dropzone="prompt-input" onDragEnter={(event) => { if (!onAddAttachments && !providerAttachments) return; if (!event.dataTransfer.types.includes("Files")) return; event.preventDefault(); dragDepth.current += 1; setDragActive(true); }} onDragOver={(event) => { if (!onAddAttachments && !providerAttachments) return; if (!event.dataTransfer.types.includes("Files")) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDragLeave={(event) => { if (!onAddAttachments && !providerAttachments) return; if (!event.dataTransfer.types.includes("Files")) return; event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragActive(false); }} onDrop={(event) => { if (!onAddAttachments && !providerAttachments) return; if (!event.dataTransfer.types.includes("Files")) return; event.preventDefault(); dragDepth.current = 0; setDragActive(false); addLocalFiles(event.dataTransfer.files); }}><input ref={fileInputRef} type="file" accept={accept} multiple={multiple} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => { if (event.currentTarget.files) addLocalFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />{children}</form></PromptInputContext.Provider></LocalPromptInputAttachmentsContext.Provider>;
}

export function PromptInputHeader({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={cx("ai-elements-prompt-input-header", "wb-ai-prompt-header", className)} data-slot="prompt-input-header">{children}</div>; }
export function PromptInputBody({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={cx("ai-elements-prompt-input-body", "wb-ai-prompt-body", className)} data-slot="prompt-input-body">{children}</div>; }
export function PromptInputFooter({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={cx("ai-elements-prompt-input-footer", "wb-ai-prompt-footer", className)} data-slot="prompt-input-footer">{children}</div>; }
export function PromptInputTools({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={cx("ai-elements-prompt-input-tools", "wb-ai-prompt-tools", className)} data-slot="prompt-input-tools">{children}</div>; }
export function PromptInputActions({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={cx("ai-elements-prompt-input-actions", "wb-ai-prompt-actions", className)} data-slot="prompt-input-actions">{children}</div>; }
export function PromptInputAction({ children, tooltip, className, ...props }: { children: ReactNode; tooltip?: ReactNode; className?: string } & HTMLAttributes<HTMLSpanElement>) { return <span {...props} className={cx("ai-elements-prompt-input-action", className)} title={typeof tooltip === "string" ? tooltip : undefined} data-slot="prompt-input-action">{children}</span>; }

type PromptInputTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  submitMode?: PromptInputSubmitMode;
  minRows?: number;
  maxRows?: number;
};

function assignTextareaRef(ref: React.ForwardedRef<HTMLTextAreaElement>, node: HTMLTextAreaElement | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}

export const PromptInputTextarea = forwardRef<HTMLTextAreaElement, PromptInputTextareaProps>(function PromptInputTextarea({ className, onChange, onKeyDown, style, value: inputValue, submitMode = "modifier-enter", minRows = 1, maxRows, ...props }, forwardedRef) {
  const { value, onValueChange, status, disabled, maxHeight, locale } = usePromptInputContext();
  const composingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const resolvedValue = inputValue ?? value;

  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node || maxRows === undefined) return;
    const lineHeight = Number.parseFloat(window.getComputedStyle(node).lineHeight) || 24;
    const minHeight = lineHeight * Math.max(1, minRows);
    const rowMaxHeight = lineHeight * Math.max(minRows, maxRows);
    // Override shared textarea bounds before measuring. Several consumers set a
    // larger CSS min-height, which would otherwise inflate scrollHeight for an
    // empty compact composer and make it start at the max row height.
    node.style.minHeight = `${minHeight}px`;
    node.style.maxHeight = `${rowMaxHeight}px`;
    node.style.height = "auto";
    const contentHeight = node.scrollHeight;
    const nextHeight = Math.min(Math.max(contentHeight, minHeight), rowMaxHeight);
    node.style.height = `${nextHeight}px`;
    node.style.overflowY = contentHeight > rowMaxHeight ? "auto" : "hidden";
  }, [maxRows, minRows, resolvedValue]);

  return <textarea {...props} ref={(node) => { textareaRef.current = node; assignTextareaRef(forwardedRef, node); }} rows={props.rows ?? minRows} value={resolvedValue} onChange={(event) => { onChange?.(event); if (!event.defaultPrevented) onValueChange(event.target.value); }} className={cx("ai-elements-prompt-input-textarea", "wb-ai-prompt-textarea", className)} style={{ ...style, ...(maxHeight !== undefined ? { maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight } : {}) }} disabled={disabled || status === "streaming"} aria-label={props["aria-label"] ?? (locale === "zh" ? "消息输入" : "Message input")} aria-busy={status === "streaming"} onCompositionStart={(event) => { composingRef.current = true; props.onCompositionStart?.(event); }} onCompositionEnd={(event) => { composingRef.current = false; props.onCompositionEnd?.(event); }} onKeyDown={(event) => { onKeyDown?.(event); if (event.defaultPrevented) return; const nativeComposing = Boolean((event.nativeEvent as unknown as { isComposing?: boolean }).isComposing); if (shouldSubmitPromptInput({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, isComposing: nativeComposing }, composingRef.current, submitMode)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />;
});

export function PromptInputSubmit({ children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { status, disabled, locale, onStop } = usePromptInputContext();
  if (status === "streaming") return <button {...props} type="button" className={cx("ai-elements-prompt-input-submit", "wb-ai-prompt-stop", className)} aria-label={props["aria-label"] ?? (locale === "zh" ? "停止生成" : "Stop generating")} onClick={props.onClick ?? onStop}><Square size={14} fill="currentColor" aria-hidden="true" />{children}</button>;
  return <button {...props} type="submit" className={cx("ai-elements-prompt-input-submit", "wb-ai-prompt-submit", className)} disabled={disabled || props.disabled} aria-label={props["aria-label"] ?? (locale === "zh" ? "发送" : "Send")}>{children ?? <Send size={16} aria-hidden="true" />}</button>;
}

export const PromptInputButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { "data-slot"?: string }>(function PromptInputButton({ children, className, type = "button", "data-slot": dataSlot, ...props }, ref) { return <button {...props} ref={ref} type={type} className={cx("ai-elements-prompt-input-button", "wb-ai-prompt-icon-button", className)} data-slot={dataSlot ?? "prompt-input-button"}>{children}</button>; });

export function PromptInputActionMenu({ children, ...props }: ComponentProps<typeof DropdownMenu.Root> & { children: ReactNode }) { return <DropdownMenu.Root {...props}>{children}</DropdownMenu.Root>; }
export function PromptInputActionMenuTrigger({ children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) { return <DropdownMenu.Trigger asChild><PromptInputButton {...props} className={cx("ai-elements-prompt-input-action-menu-trigger", className)} data-slot="prompt-input-action-menu-trigger">{children ?? <Plus size={16} aria-hidden="true" />}</PromptInputButton></DropdownMenu.Trigger>; }
export function PromptInputActionMenuContent({ children, className, ...props }: ComponentProps<typeof DropdownMenu.Content>) { return <DropdownMenu.Portal><DropdownMenu.Content {...props} align="start" className={cx("ai-elements-prompt-input-action-menu-content", "wb-ai-prompt-file-menu", className)} data-slot="prompt-input-action-menu-content">{children}</DropdownMenu.Content></DropdownMenu.Portal>; }
export function PromptInputActionMenuItem({ children, className, ...props }: ComponentProps<typeof DropdownMenu.Item>) { return <DropdownMenu.Item {...props} className={cx("ai-elements-prompt-input-action-menu-item", className)} data-slot="prompt-input-action-menu-item">{children}</DropdownMenu.Item>; }
export function PromptInputActionMenuSub({ children, ...props }: ComponentProps<typeof DropdownMenu.Sub> & { children: ReactNode }) { return <DropdownMenu.Sub {...props}>{children}</DropdownMenu.Sub>; }
export function PromptInputActionMenuSubTrigger({ children, className, ...props }: ComponentProps<typeof DropdownMenu.SubTrigger>) { return <DropdownMenu.SubTrigger {...props} className={cx("ai-elements-prompt-input-action-menu-item", "ai-elements-prompt-input-action-menu-sub-trigger", className)} data-slot="prompt-input-action-menu-sub-trigger">{children}<ChevronRight className="ai-elements-prompt-input-action-menu-sub-arrow" size={15} aria-hidden="true" /></DropdownMenu.SubTrigger>; }
export function PromptInputActionMenuSubContent({ children, className, ...props }: ComponentProps<typeof DropdownMenu.SubContent>) { return <DropdownMenu.Portal><DropdownMenu.SubContent {...props} className={cx("ai-elements-prompt-input-action-menu-content", "ai-elements-prompt-input-action-menu-sub-content", "wb-ai-prompt-file-menu", className)} data-slot="prompt-input-action-menu-sub-content">{children}</DropdownMenu.SubContent></DropdownMenu.Portal>; }
export function PromptInputActionMenuRadioGroup({ children, ...props }: ComponentProps<typeof DropdownMenu.RadioGroup> & { children: ReactNode }) { return <DropdownMenu.RadioGroup {...props}>{children}</DropdownMenu.RadioGroup>; }
export function PromptInputActionMenuRadioItem({ children, className, ...props }: ComponentProps<typeof DropdownMenu.RadioItem>) { return <DropdownMenu.RadioItem {...props} className={cx("ai-elements-prompt-input-action-menu-item", "ai-elements-prompt-input-action-menu-radio-item", className)} data-slot="prompt-input-action-menu-radio-item">{children}<DropdownMenu.ItemIndicator className="ai-elements-prompt-input-action-menu-item-indicator"><Check size={15} aria-hidden="true" /></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>; }
export function PromptInputActionAddAttachments({ label = "Add photos or files", description, className, ...props }: ComponentProps<typeof DropdownMenu.Item> & { label?: ReactNode; description?: ReactNode }) {
  const attachments = usePromptInputAttachments();
  return <DropdownMenu.Item {...props} className={cx("ai-elements-prompt-input-action-menu-item", className)} data-slot="prompt-input-action-add-attachments" onSelect={(event) => { props.onSelect?.(event); if (!event.defaultPrevented) { event.preventDefault(); attachments.openFileDialog(); } }}><span className="ai-elements-prompt-input-action-menu-item-icon"><Paperclip size={16} aria-hidden="true" /></span><span className="ai-elements-prompt-input-action-menu-item-copy"><span className="ai-elements-prompt-input-action-menu-item-label">{label}</span>{description ? <span className="ai-elements-prompt-input-action-menu-item-description">{description}</span> : null}</span></DropdownMenu.Item>;
}

export function PromptInputSelect({ children, className, ...props }: ComponentProps<typeof Select.Root> & { children: ReactNode; className?: string }) { return <div className={cx("ai-elements-prompt-input-select", className)} data-slot="prompt-input-select"><Select.Root {...props}>{children}</Select.Root></div>; }
export function PromptInputSelectTrigger({ children, className, ...props }: ComponentProps<typeof Select.Trigger>) { return <Select.Trigger {...props} className={cx("ai-elements-prompt-input-select-trigger", "wb-ai-model-trigger", className)} data-slot="prompt-input-select-trigger">{children ?? <><Select.Value placeholder="Select" /><ChevronDown size={14} aria-hidden="true" /></>}</Select.Trigger>; }
export function PromptInputSelectContent({ children, className, ...props }: ComponentProps<typeof Select.Content>) { return <Select.Portal><Select.Content {...props} className={cx("ai-elements-prompt-input-select-content", className)} data-slot="prompt-input-select-content"><Select.Viewport>{children}</Select.Viewport></Select.Content></Select.Portal>; }
export function PromptInputSelectItem({ children, className, ...props }: ComponentProps<typeof Select.Item>) { return <Select.Item {...props} className={cx("ai-elements-prompt-input-select-item", className)} data-slot="prompt-input-select-item"><Select.ItemText>{children}</Select.ItemText></Select.Item>; }
export function PromptInputSelectValue({ children, ...props }: ComponentProps<typeof Select.Value>) { return <Select.Value {...props}>{children}</Select.Value>; }

export function ModelSelector({ children, className, ...props }: ComponentProps<typeof Dialog.Root> & { children?: ReactNode; className?: string }) {
  return <div className={cx("ai-elements-model-selector", "wb-ai-model-selector", className)} data-slot="model-selector"><Dialog.Root {...props}>{children}</Dialog.Root></div>;
}

export function ModelSelectorTrigger({ children, className, ...props }: ComponentProps<typeof Dialog.Trigger> & { children?: ReactNode }) {
  return <Dialog.Trigger {...props} className={props.asChild ? className : cx("ai-elements-model-selector-trigger", "wb-ai-model-trigger", className)}>{children ?? <><span>Select model</span><ChevronDown size={14} aria-hidden="true" /></>}</Dialog.Trigger>;
}

export const ModelSelectorContent = forwardRef<HTMLDivElement, ComponentProps<typeof Dialog.Content> & { title?: ReactNode }>(function ModelSelectorContent({ children, className, title = "Model Selector", ...props }, ref) {
  return <Dialog.Portal><Dialog.Overlay className="ai-elements-model-selector-overlay" /><Dialog.Content {...props} ref={ref} className={cx("ai-elements-model-selector-content", "wb-ai-model-popover", className)} aria-describedby={undefined}><Dialog.Title className="sr-only">{title}</Dialog.Title><Command className="ai-elements-model-selector-command">{children}</Command></Dialog.Content></Dialog.Portal>;
});

export function ModelSelectorInput({ className, ...props }: ComponentProps<typeof CommandInput>) { return <div className="ai-elements-model-selector-input-wrap" data-slot="model-selector-input-wrapper"><Search size={16} aria-hidden="true" /><CommandInput {...props} className={cx("ai-elements-model-selector-input", "wb-ai-model-search", className)} placeholder={props.placeholder ?? "Search models…"} aria-label={props["aria-label"] ?? "Search models"} data-slot="model-selector-input" /></div>; }
export function ModelSelectorList({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) { return <CommandList {...props} className={cx("ai-elements-model-selector-list", "wb-ai-model-list", className)} data-slot="model-selector-list">{children}</CommandList>; }
export function ModelSelectorEmpty({ children, className, ...props }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) { return <CommandEmpty {...props} className={cx("ai-elements-model-selector-empty", "wb-ai-model-empty", className)}>{children ?? "No matching models"}</CommandEmpty>; }
export function ModelSelectorGroup({ heading, children, className, ...props }: ComponentProps<typeof CommandGroup> & { heading?: ReactNode }) { return <CommandGroup {...props} heading={heading} className={cx("ai-elements-model-selector-group", "wb-ai-model-group", className)}>{children}</CommandGroup>; }
export function ModelSelectorItem({ model, selected, onSelect, className, children, ...props }: ComponentProps<typeof CommandItem> & { model?: ModelOption; selected?: boolean; onSelect?: (value: string) => void }) { const value = props.value ?? (model ? `${model.label} ${model.provider ?? ""} ${model.id}` : undefined); return <CommandItem {...props} value={value} className={cx("ai-elements-model-selector-item", "wb-ai-model-option", className)} data-slot="model-selector-item" data-selected={selected ? "true" : undefined} onSelect={onSelect}>{children ?? (model ? <><span><strong>{model.label}</strong>{model.description ? <small>{model.description}</small> : null}</span>{selected ? <Check size={14} aria-hidden="true" /> : null}</> : null)}</CommandItem>; }
export function ModelSelectorShortcut({ children, className, ...props }: ComponentProps<"kbd">) { return <kbd {...props} className={cx("ai-elements-model-selector-shortcut", className)}>{children}</kbd>; }
export function ModelSelectorSeparator({ className, ...props }: ComponentProps<typeof CommandSeparator>) { return <CommandSeparator {...props} className={cx("ai-elements-model-selector-separator", className)} />; }
export function ModelSelectorLogo({ children, className, ...props }: ComponentProps<"span"> & { children?: ReactNode }) { return <span {...props} className={cx("ai-elements-model-selector-logo", className)}>{children}</span>; }
export function ModelSelectorLogoGroup({ children, className, ...props }: ComponentProps<"span"> & { children?: ReactNode }) { return <span {...props} className={cx("ai-elements-model-selector-logo-group", className)}>{children}</span>; }
export function ModelSelectorName({ children, className, ...props }: ComponentProps<"span"> & { children?: ReactNode }) { return <span {...props} className={cx("ai-elements-model-selector-name", className)}>{children}</span>; }

type MessageBranchContextValue = { currentBranch: number; totalBranches: number; goToPrevious: () => void; goToNext: () => void; setBranches: (branches: React.ReactElement[]) => void; };
const MessageBranchContext = createContext<MessageBranchContextValue | null>(null);
function useMessageBranchContext() { const context = useContext(MessageBranchContext); if (!context) throw new Error("MessageBranch components must be used within MessageBranch"); return context; }
export function MessageBranch({ children, defaultBranch = 0, onBranchChange, className, ...props }: HTMLAttributes<HTMLDivElement> & { defaultBranch?: number; onBranchChange?: (branchIndex: number) => void }) {
  const [currentBranch, setCurrentBranch] = useState(defaultBranch);
  const [branches, setBranches] = useState<React.ReactElement[]>([]);
  const changeBranch = useCallback((next: number) => { setCurrentBranch(next); onBranchChange?.(next); }, [onBranchChange]);
  const goToPrevious = useCallback(() => changeBranch(currentBranch > 0 ? currentBranch - 1 : Math.max(0, branches.length - 1)), [branches.length, changeBranch, currentBranch]);
  const goToNext = useCallback(() => changeBranch(currentBranch < branches.length - 1 ? currentBranch + 1 : 0), [branches.length, changeBranch, currentBranch]);
  const context = useMemo(() => ({ currentBranch, totalBranches: branches.length, goToPrevious, goToNext, setBranches }), [currentBranch, branches.length, goToPrevious, goToNext]);
  return <MessageBranchContext.Provider value={context}><div {...props} className={cx("ai-elements-message-branch", className)} data-slot="message-branch">{children}</div></MessageBranchContext.Provider>;
}
export function MessageBranchContent({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) { const { currentBranch, setBranches } = useMessageBranchContext(); const childrenArray = useMemo(() => React.Children.toArray(children).filter(React.isValidElement) as React.ReactElement[], [children]); useEffect(() => { setBranches(childrenArray); }, [childrenArray, setBranches]); return <>{childrenArray.map((branch, index) => <div {...props} className={cx("ai-elements-message-branch-content", className, index === currentBranch ? "is-active" : "is-hidden")} data-slot="message-branch-content" key={branch.key ?? index} hidden={index !== currentBranch}>{branch}</div>)}</>; }
export function MessageBranchSelector({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) { const { totalBranches } = useMessageBranchContext(); if (totalBranches <= 1) return null; return <div {...props} className={cx("ai-elements-message-branch-selector", className)} data-slot="message-branch-selector" role="group">{children}</div>; }
export function MessageBranchPrevious({ onClick, disabled = false, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) { const { goToPrevious, totalBranches } = useMessageBranchContext(); return <button {...props} type="button" onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) goToPrevious(); }} disabled={disabled || totalBranches <= 1} aria-label={props["aria-label"] ?? "Previous response"}>{children ?? "←"}</button>; }
export function MessageBranchNext({ onClick, disabled = false, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) { const { goToNext, totalBranches } = useMessageBranchContext(); return <button {...props} type="button" onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) goToNext(); }} disabled={disabled || totalBranches <= 1} aria-label={props["aria-label"] ?? "Next response"}>{children ?? "→"}</button>; }
export function MessageBranchPage({ current, total }: { current?: number; total?: number }) { const context = useMessageBranchContext(); return <span aria-live="polite">{current ?? context.currentBranch + 1} / {total ?? context.totalBranches}</span>; }

export function ChainOfThought({ steps, isStreaming = false, className }: { steps: readonly PlanStep[]; isStreaming?: boolean; className?: string }) { return <details className={cx("ai-elements-chain-of-thought", "wb-ai-process", className)} open={isStreaming}><summary>Chain of Thought <span>{steps.length}</span></summary><ol>{steps.map((step) => <li key={step.id} data-status={step.status}><span>{step.title}</span><small>{statusLabel(step.status, "en")}</small></li>)}</ol></details>; }
type PlanContextValue = { isStreaming: boolean };
const PlanContext = createContext<PlanContextValue | null>(null);
function usePlanContext() { const value = useContext(PlanContext); if (!value) throw new Error("Plan components must be used within Plan"); return value; }
export type PlanProps = ComponentProps<typeof Collapsible> & { title?: string; description?: string; steps?: readonly PlanStep[]; isStreaming?: boolean; status?: AIElementStatus; locale?: "zh" | "en"; children?: ReactNode };
export function Plan({ title = "Plan", description, steps = [], isStreaming = false, status = "running", locale = "zh", className, children, defaultOpen, ...props }: PlanProps) { const body = children ?? <><PlanHeader><div><PlanTitle>{title}</PlanTitle>{description ? <PlanDescription>{description}</PlanDescription> : null}</div><PlanAction><PlanTrigger aria-label={locale === "zh" ? "展开或收起计划" : "Toggle plan"} /></PlanAction></PlanHeader><PlanContent><ol className="wb-ai-plan-steps">{steps.map((step) => <li key={step.id} data-status={step.status}><span aria-hidden="true">{step.status === "completed" || step.status === "succeeded" ? "✓" : step.status === "failed" ? "!" : "·"}</span><span><strong>{step.title}</strong>{step.detail ? <small>{step.detail}</small> : null}</span><em>{statusLabel(step.status, locale)}</em></li>)}</ol></PlanContent></>; return <PlanContext.Provider value={{ isStreaming }}><Collapsible {...props} defaultOpen={defaultOpen ?? (isStreaming || status === "running" || status === "failed")}><div className={cx("ai-elements-plan", "wb-ai-process", "wb-ai-plan", className)} data-slot="plan" data-status={status} aria-busy={isStreaming}>{body}</div></Collapsible></PlanContext.Provider>; }
export function PlanHeader({ children, className, ...props }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) { return <div {...props} className={cx("ai-elements-plan-header", className)} data-slot="plan-header">{children}</div>; }
export function PlanTitle({ children, className, ...props }: HTMLAttributes<HTMLHeadingElement> & { children: ReactNode }) { const { isStreaming } = usePlanContext(); return <h3 {...props} className={cx("ai-elements-plan-title", className)} data-slot="plan-title">{isStreaming ? <Shimmer>{children}</Shimmer> : children}</h3>; }
export function PlanDescription({ children, className, ...props }: HTMLAttributes<HTMLParagraphElement> & { children: ReactNode }) { const { isStreaming } = usePlanContext(); return <p {...props} className={cx("ai-elements-plan-description", className)} data-slot="plan-description">{isStreaming ? <Shimmer>{children}</Shimmer> : children}</p>; }
export function PlanAction({ children, className, ...props }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) { return <div {...props} className={cx("ai-elements-plan-action", className)} data-slot="plan-action">{children}</div>; }
export function PlanContent({ children, className, ...props }: ComponentProps<typeof CollapsibleContent>) { return <CollapsibleContent {...props} className={cx("ai-elements-plan-content", className)} data-slot="plan-content">{children}</CollapsibleContent>; }
export function PlanFooter({ children, className, ...props }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) { return <div {...props} className={cx("ai-elements-plan-footer", className)} data-slot="plan-footer">{children}</div>; }
export function PlanTrigger({ className, ...props }: ComponentProps<typeof CollapsibleTrigger>) { return <CollapsibleTrigger {...props} asChild><button type="button" className={cx("ai-elements-plan-trigger", className)} data-slot="plan-trigger"><ChevronDown size={15} aria-hidden="true" /><span className="sr-only">Toggle plan</span></button></CollapsibleTrigger>; }
export type TaskItemFileProps = HTMLAttributes<HTMLDivElement>;
export function TaskItemFile({ children, className, ...props }: TaskItemFileProps) { return <div {...props} className={cx("ai-elements-task-item-file", className)} data-slot="task-item-file">{children}</div>; }
export function TaskItem({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={cx("ai-elements-task-item", className)} data-slot="task-item">{children}</div>; }
export function TaskTrigger({ title, status, locale = "zh", children, className, ...props }: React.ComponentProps<typeof CollapsibleTrigger> & { title: string; status?: AIElementStatus; locale?: "zh" | "en"; children?: ReactNode }) { const content = children && typeof children !== "string" ? children : <div className="ai-elements-task-trigger-content"><span className="wb-ai-process-icon" aria-hidden="true">□</span><strong>{children ?? title}</strong>{status ? <span className="wb-ai-process-status">{statusLabel(status, locale)}</span> : null}<ChevronDown className="ai-elements-task-chevron" size={15} aria-hidden="true" /></div>; return <CollapsibleTrigger {...props} className={cx("ai-elements-task-trigger", className)} data-slot="task-trigger" asChild>{content}</CollapsibleTrigger>; }
export function TaskContent({ children, className, ...props }: React.ComponentProps<typeof CollapsibleContent>) { return <CollapsibleContent {...props} className={cx("ai-elements-task-content", "wb-ai-process-body", className)} data-slot="task-content"><div className="ai-elements-task-items">{children}</div></CollapsibleContent>; }
export function Task({ title, description, steps = [], status = "running", isStreaming = false, locale = "zh", className, children, defaultOpen, ...props }: React.ComponentProps<typeof Collapsible> & { title?: string; description?: string; steps?: readonly TaskStep[]; status?: AIElementStatus; isStreaming?: boolean; locale?: "zh" | "en"; children?: ReactNode }) { const body = children ?? (title ? <><TaskTrigger title={title} status={status} locale={locale} /><TaskContent>{description ? <TaskItem>{description}</TaskItem> : null}{steps.map((step) => <TaskItem key={step.id} data-status={step.status}><span aria-hidden="true">{step.status === "completed" || step.status === "succeeded" ? "✓" : "·"}</span><span><strong>{step.title}</strong>{step.toolName ? <small>{step.toolName}</small> : null}</span><em>{statusLabel(step.status, locale)}</em></TaskItem>)}</TaskContent></> : null); if (!body) return null; return <Collapsible {...props} defaultOpen={defaultOpen ?? (isStreaming || status === "running" || status === "failed")} className={cx("ai-elements-task", "wb-ai-process", "wb-ai-task", className)} data-status={status} data-slot="task" aria-busy={isStreaming}>{body}</Collapsible>; }
export type ToolState = "approval-requested" | "approval-responded" | "input-available" | "input-streaming" | "output-available" | "output-denied" | "output-error";
export function Shimmer({ children, duration = 1.5, className }: { children: ReactNode; duration?: number; className?: string }) { return <span className={cx("ai-elements-shimmer", className)} style={{ animationDuration: `${duration}s` }}>{children}</span>; }
export type SuggestionProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type"> & { suggestion: string; onClick?: (suggestion: string) => void; variant?: "outline" | "secondary" | "ghost"; size?: "sm" | "default" };
export function Suggestion({ suggestion, children, onClick, className, variant = "outline", size = "sm", ...props }: SuggestionProps) {
  const handleClick = useCallback(() => onClick?.(suggestion), [onClick, suggestion]);
  return <button {...props} type="button" onClick={handleClick} className={cx("ai-elements-suggestion", `ai-elements-suggestion-${variant}`, `ai-elements-suggestion-${size}`, className)} data-slot="suggestion">{children ?? suggestion}</button>;
}
export function Suggestions({ children, className, ...props }: ComponentProps<typeof ScrollArea.Root>) { return <ScrollArea.Root {...props} className={cx("ai-elements-suggestions", className)} data-slot="suggestions"><ScrollArea.Viewport className="ai-elements-suggestions-viewport"><div className="ai-elements-suggestions-list">{children}</div></ScrollArea.Viewport><ScrollArea.Scrollbar className="ai-elements-suggestions-scrollbar" orientation="horizontal"><ScrollArea.Thumb /></ScrollArea.Scrollbar></ScrollArea.Root>; }

type ConfirmationState = ToolState;
type ConfirmationApproval = { id: string; approved?: boolean; reason?: string };
type ConfirmationContextValue = { approval?: ConfirmationApproval; state: ConfirmationState };
const ConfirmationContext = createContext<ConfirmationContextValue | null>(null);
function useConfirmation() { const value = useContext(ConfirmationContext); if (!value) throw new Error("Confirmation components must be used within Confirmation"); return value; }
export type ConfirmationProps = HTMLAttributes<HTMLElement> & { approval?: ConfirmationApproval; state?: ConfirmationState; status?: "approval-requested" | "approval-responded" | "output-denied" | "output-available"; onApprove?: () => void; onReject?: () => void; children?: ReactNode };
export function Confirmation({ approval, state, status, onApprove, onReject, children, className, ...props }: ConfirmationProps) {
  const resolvedState = state ?? status ?? "approval-requested";
  const resolvedApproval = approval ?? (status ? { id: "legacy-confirmation" } : undefined);
  if (!resolvedApproval) return null;
  const contextValue = useMemo(() => ({ approval: resolvedApproval, state: resolvedState }), [resolvedApproval, resolvedState]);
  const fallback = <><ConfirmationTitle>{children ?? (resolvedState === "output-denied" ? "Tool denied" : resolvedState === "output-available" ? "Tool result" : "Approval required")}</ConfirmationTitle>{resolvedState === "approval-requested" ? <ConfirmationActions><ConfirmationAction onClick={onReject}>Reject</ConfirmationAction><ConfirmationAction onClick={onApprove}>Approve</ConfirmationAction></ConfirmationActions> : null}</>;
  return <ConfirmationContext.Provider value={contextValue}><section {...props} className={cx("ai-elements-confirmation", className)} data-slot="confirmation" data-state={resolvedState} data-status={resolvedState} role="alert">{children && (onApprove || onReject) ? fallback : children ?? fallback}</section></ConfirmationContext.Provider>;
}
export function ConfirmationTitle({ children, className, ...props }: HTMLAttributes<HTMLSpanElement> & { children?: ReactNode }) { return <span {...props} className={cx("ai-elements-confirmation-title", className)} data-slot="confirmation-title">{children}</span>; }
export function ConfirmationRequest({ children }: { children?: ReactNode }) { return useConfirmation().state === "approval-requested" ? children : null; }
export function ConfirmationAccepted({ children }: { children?: ReactNode }) { const { approval, state } = useConfirmation(); return approval?.approved && ["approval-responded", "output-denied", "output-available"].includes(state) ? children : null; }
export function ConfirmationRejected({ children }: { children?: ReactNode }) { const { approval, state } = useConfirmation(); return approval?.approved === false && ["approval-responded", "output-denied", "output-available"].includes(state) ? children : null; }
export function ConfirmationActions({ children, className, ...props }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) { return useConfirmation().state === "approval-requested" ? <div {...props} className={cx("ai-elements-confirmation-actions", className)} data-slot="confirmation-actions">{children}</div> : null; }
export function ConfirmationAction({ children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode }) { return <button {...props} type="button" className={cx("ai-elements-confirmation-action", className)} data-slot="confirmation-action">{children}</button>; }
export type QueueItemProps = HTMLAttributes<HTMLLIElement>;
export function QueueItem({ children, className, ...props }: QueueItemProps & { children?: ReactNode }) { return <li {...props} className={cx("ai-elements-queue-item", className)} data-slot="queue-item">{children}</li>; }
export type QueueItemIndicatorProps = HTMLAttributes<HTMLSpanElement> & { completed?: boolean };
export function QueueItemIndicator({ completed = false, className, ...props }: QueueItemIndicatorProps) { return <span {...props} className={cx("ai-elements-queue-item-indicator", completed && "is-completed", className)} data-slot="queue-item-indicator" aria-hidden="true" />; }
export type QueueItemContentProps = HTMLAttributes<HTMLSpanElement> & { completed?: boolean };
export function QueueItemContent({ completed = false, children, className, ...props }: QueueItemContentProps & { children?: ReactNode }) { return <span {...props} className={cx("ai-elements-queue-item-content", completed && "is-completed", className)} data-slot="queue-item-content">{children}</span>; }
export type QueueItemDescriptionProps = HTMLAttributes<HTMLDivElement> & { completed?: boolean };
export function QueueItemDescription({ completed = false, children, className, ...props }: QueueItemDescriptionProps & { children?: ReactNode }) { return <div {...props} className={cx("ai-elements-queue-item-description", completed && "is-completed", className)} data-slot="queue-item-description">{children}</div>; }
export function QueueItemActions({ children, className, ...props }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) { return <div {...props} className={cx("ai-elements-queue-item-actions", className)} data-slot="queue-item-actions">{children}</div>; }
export function QueueItemAction({ children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode }) { return <button {...props} type="button" className={cx("ai-elements-queue-item-action", className)} data-slot="queue-item-action">{children}</button>; }
export function QueueItemAttachment({ children, className, ...props }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) { return <div {...props} className={cx("ai-elements-queue-item-attachment", className)} data-slot="queue-item-attachment">{children}</div>; }
export function QueueItemImage({ className, ...props }: React.ComponentProps<"img">) { return <img {...props} alt={props.alt ?? ""} width={props.width ?? 32} height={props.height ?? 32} className={cx("ai-elements-queue-item-image", className)} data-slot="queue-item-image" />; }
export function QueueItemFile({ children, className, ...props }: HTMLAttributes<HTMLSpanElement>) { return <span {...props} className={cx("ai-elements-queue-item-file", className)} data-slot="queue-item-file"><Paperclip size={12} aria-hidden="true" />{children}</span>; }
export function QueueList({ children, className, ...props }: ComponentProps<typeof ScrollArea.Root> & { children?: ReactNode }) { return <ScrollArea.Root {...props} className={cx("ai-elements-queue-list", className)} data-slot="queue-list"><ScrollArea.Viewport><div className="ai-elements-queue-list-content"><ul>{children}</ul></div></ScrollArea.Viewport></ScrollArea.Root>; }
export function QueueSection({ defaultOpen = true, className, ...props }: ComponentProps<typeof Collapsible>) { return <Collapsible {...props} defaultOpen={defaultOpen} className={cx("ai-elements-queue-section", className)} data-slot="queue-section" />; }
export function QueueSectionTrigger({ children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) { return <CollapsibleTrigger asChild><button {...props} type="button" className={cx("ai-elements-queue-section-trigger", className)} data-slot="queue-section-trigger"><span>{children}</span><ChevronDown size={16} aria-hidden="true" /></button></CollapsibleTrigger>; }
export function QueueSectionLabel({ count, label, icon, className, ...props }: HTMLAttributes<HTMLSpanElement> & { count?: number; label: string; icon?: ReactNode }) { return <span {...props} className={cx("ai-elements-queue-section-label", className)} data-slot="queue-section-label"><ChevronDown size={16} aria-hidden="true" />{icon}<span>{count} {label}</span></span>; }
export function QueueSectionContent({ className, ...props }: ComponentProps<typeof CollapsibleContent>) { return <CollapsibleContent {...props} className={cx("ai-elements-queue-section-content", className)} data-slot="queue-section-content" />; }
export type QueueProps = ComponentProps<"div"> & { items?: readonly { id: string; title: string; status?: AIElementStatus }[]; children?: ReactNode };
export function Queue({ items, children, className, ...props }: QueueProps) { return <div {...props} className={cx("ai-elements-queue", className)} data-slot="queue">{children ?? (items?.length ? <QueueList><>{items.map((item) => { const completed = item.status === "completed" || item.status === "succeeded"; return <QueueItem key={item.id} data-status={item.status ?? "queued"}><QueueItemContent completed={completed}>{item.title}</QueueItemContent><QueueItemDescription completed={completed}>{statusLabel(item.status ?? "queued", "en")}</QueueItemDescription></QueueItem>; })}</></QueueList> : null)}</div>; }
export type CheckpointProps = HTMLAttributes<HTMLDivElement> & { title?: string; description?: string; onRestore?: () => void; onBranch?: () => void; children?: ReactNode };
export function Checkpoint({ title = "Checkpoint", description, onRestore, onBranch, children, className, ...props }: CheckpointProps) { const body = children ?? <><CheckpointIcon /><div className="ai-elements-checkpoint-copy"><strong>{title}</strong>{description ? <p>{description}</p> : null}</div><div className="ai-elements-checkpoint-actions"><CheckpointTrigger onClick={onRestore}>Restore</CheckpointTrigger><CheckpointTrigger onClick={onBranch}>Branch</CheckpointTrigger></div></>; return <div {...props} className={cx("ai-elements-checkpoint", className)} data-slot="checkpoint">{body}</div>; }
export function CheckpointIcon({ children, className, ...props }: HTMLAttributes<HTMLSpanElement> & { children?: ReactNode }) { return <span {...props} className={cx("ai-elements-checkpoint-icon", className)} data-slot="checkpoint-icon">{children ?? "↺"}</span>; }
export function CheckpointTrigger({ children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tooltip?: string; children?: ReactNode }) { const buttonProps = { ...props }; delete buttonProps.tooltip; return <button {...buttonProps} type="button" className={cx("ai-elements-checkpoint-trigger", className)} data-slot="checkpoint-trigger">{children}</button>; }
type ContextUsage = { inputTokens?: number; outputTokens?: number; reasoningTokens?: number; cachedInputTokens?: number; cachedTokens?: number; cost?: number };
type ContextValue = { maxTokens: number; usedTokens: number; usage?: ContextUsage; modelId?: string };
const ContextContext = createContext<ContextValue | null>(null);
function useContextValue() { const value = useContext(ContextContext); if (!value) throw new Error("Context components must be used within Context"); return value; }
export type ContextProps = ComponentProps<typeof HoverCard.Root> & { maxTokens?: number; usedTokens?: number; usage?: ContextUsage; modelId?: string };
export function Context({ maxTokens = 1, usedTokens = 0, usage, modelId, children, ...props }: ContextProps & { children?: ReactNode }) { const contextValue = useMemo(() => ({ maxTokens: Math.max(maxTokens, 1), modelId, usage, usedTokens: Math.max(usedTokens, 0) }), [maxTokens, modelId, usage, usedTokens]); return <ContextContext.Provider value={contextValue}><HoverCard.Root {...props} openDelay={0} closeDelay={0} data-slot="context">{children}</HoverCard.Root></ContextContext.Provider>; }
export function ContextTrigger({ children, className, ...props }: ComponentProps<typeof HoverCard.Trigger> & { children?: ReactNode }) { const { maxTokens, usedTokens } = useContextValue(); const percentage = Math.min(100, Math.round((usedTokens / maxTokens) * 100)); return <HoverCard.Trigger asChild {...props}><button type="button" className={cx("ai-elements-context-trigger", className)} data-slot="context-trigger">{children ?? <><span>{percentage}% used</span><svg aria-label="Model context usage" height="20" role="img" viewBox="0 0 24 24" width="20"><circle cx="12" cy="12" fill="none" opacity=".25" r="10" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" fill="none" opacity=".7" r="10" stroke="currentColor" strokeDasharray={`${2 * Math.PI * 10} ${2 * Math.PI * 10}`} strokeDashoffset={2 * Math.PI * 10 * (1 - usedTokens / maxTokens)} strokeLinecap="round" strokeWidth="2" style={{ transform: "rotate(-90deg)", transformOrigin: "center" }} /></svg></>}</button></HoverCard.Trigger>; }
export function ContextContent({ children, className, ...props }: ComponentProps<typeof HoverCard.Content>) { return <HoverCard.Content {...props} className={cx("ai-elements-context-content", className)} data-slot="context-content">{children}</HoverCard.Content>; }
export function ContextContentHeader({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) { const { maxTokens, usedTokens } = useContextValue(); const percentage = Math.min(100, Math.round((usedTokens / maxTokens) * 100)); return <div {...props} className={cx("ai-elements-context-content-header", className)} data-slot="context-content-header">{children ?? <><div><span>{percentage}% used</span><span>{usedTokens.toLocaleString()} / {maxTokens.toLocaleString()}</span></div><progress max={maxTokens} value={usedTokens} aria-label="Context usage" /></>}</div>; }
export function ContextContentBody({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={cx("ai-elements-context-content-body", className)} data-slot="context-content-body">{children}</div>; }
export function ContextContentFooter({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) { const { usage } = useContextValue(); return <div {...props} className={cx("ai-elements-context-content-footer", className)} data-slot="context-content-footer">{children ?? <><span>Total cost</span><span>{usage?.cost === undefined ? "—" : `$${usage.cost.toFixed(4)}`}</span></>}</div>; }
function ContextUsageRow({ label, value, className, ...props }: HTMLAttributes<HTMLDivElement> & { label: string; value?: number }) { return <div {...props} className={cx("ai-elements-context-usage-row", className)} data-slot="context-usage"><span>{label}</span><span>{value === undefined ? "—" : value.toLocaleString()}</span></div>; }
export function ContextInputUsage({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) { const { usage } = useContextValue(); return children ?? (usage?.inputTokens !== undefined ? <ContextUsageRow {...props} className={className} label="Input" value={usage.inputTokens} /> : null); }
export function ContextOutputUsage({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) { const { usage } = useContextValue(); return children ?? (usage?.outputTokens !== undefined ? <ContextUsageRow {...props} className={className} label="Output" value={usage.outputTokens} /> : null); }
export function ContextReasoningUsage({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) { const { usage } = useContextValue(); const value = usage?.reasoningTokens; return children ?? (value !== undefined ? <ContextUsageRow {...props} className={className} label="Reasoning" value={value} /> : null); }
export function ContextCacheUsage({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) { const { usage } = useContextValue(); const value = usage?.cachedInputTokens ?? usage?.cachedTokens; return children ?? (value !== undefined ? <ContextUsageRow {...props} className={className} label="Cache" value={value} /> : null); }
export function Sources({ children, className, open, defaultOpen, onOpenChange, ...props }: ComponentProps<typeof Collapsible> & { children: ReactNode }) { return <Collapsible {...props} open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange} className={cx("ai-elements-sources", className)} data-slot="sources">{children}</Collapsible>; }
export function SourcesTrigger({ count, children, className, ...props }: ComponentProps<typeof CollapsibleTrigger> & { count?: number }) { return <CollapsibleTrigger {...props} className={cx("ai-elements-sources-trigger", className)} data-slot="sources-trigger">{children ?? <><span>Used {count ?? 0} sources</span><ChevronDown size={14} aria-hidden="true" /></>}</CollapsibleTrigger>; }
export function SourcesContent({ children, className, ...props }: ComponentProps<typeof CollapsibleContent>) { return <CollapsibleContent {...props} className={cx("ai-elements-sources-content", className)} data-slot="sources-content">{children}</CollapsibleContent>; }
export function Source({ title, href, excerpt, children, className, ...props }: HTMLAttributes<HTMLElement> & { title: string; href?: string; excerpt?: string; children?: ReactNode; className?: string }) { return <article {...props} className={cx("ai-elements-source", className)} data-slot="source">{href ? <a href={href} target="_blank" rel="noreferrer">{title}</a> : <strong>{title}</strong>}{excerpt ? <p>{excerpt}</p> : null}{children}</article>; }
export function InlineCitation({ title, href, children }: { title: string; href?: string; children?: ReactNode }) { return <a className="ai-elements-inline-citation" href={href} target={href ? "_blank" : undefined} rel={href ? "noreferrer" : undefined}>{children ?? title}</a>; }
export function CodeBlock({ code, language = "text", children, className }: { code?: string; language?: string; children?: ReactNode; className?: string }) { return <pre className={cx("ai-elements-code-block", className)} data-language={language}><code>{children ?? code}</code></pre>; }
export type ImageProps = { src?: string; base64?: string; mediaType?: string; uint8Array?: Uint8Array; alt?: string; className?: string } & Omit<React.ComponentProps<"img">, "src" | "alt" | "className">;
export function Image({ src, base64, mediaType, alt = "Generated image", className, ...props }: ImageProps) { delete props.uint8Array; const imageSource = src ?? (base64 && mediaType ? `data:${mediaType};base64,${base64}` : undefined); return <img {...props} src={imageSource} alt={alt} className={cx("ai-elements-image", className)} data-slot="image" />; }
export function OpenInChat({ href, label = "Open in chat", children }: { href: string; label?: string; children?: ReactNode }) { return <a className="ai-elements-open-in-chat" href={href} target="_blank" rel="noreferrer">{children ?? <>{label}<ExternalLink size={14} aria-hidden="true" /></>}</a>; }

export function Branch({ children, className, ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) { return <section {...props} className={cx("ai-elements-branch", className)} data-slot="branch">{children}</section>; }
export function BranchMessages({ children, className, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) { return <div {...props} className={cx("ai-elements-branch-messages", className)} data-slot="branch-messages">{children}</div>; }
export function BranchSelector({ children, className, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) { return <div {...props} className={cx("ai-elements-branch-selector", className)} data-slot="branch-selector" role="group">{children}</div>; }
export function BranchPrevious({ onClick, disabled = false, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} type="button" className={className} onClick={onClick} disabled={disabled} aria-label={props["aria-label"] ?? "Previous branch"}>{children ?? "←"}</button>; }
export function BranchNext({ onClick, disabled = false, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} type="button" className={className} onClick={onClick} disabled={disabled} aria-label={props["aria-label"] ?? "Next branch"}>{children ?? "→"}</button>; }
export function BranchPage({ current, total }: { current: number; total: number }) { return <span aria-live="polite">{current} / {total}</span>; }

export function FileTree({ children, className }: { children: ReactNode; className?: string }) { return <nav className={cx("ai-elements-file-tree", className)} aria-label="Files">{children}</nav>; }
export function FileTreeItem({ name, path, children }: { name: string; path?: string; children?: ReactNode }) { return <div className="ai-elements-file-tree-item" data-path={path}><span>{name}</span>{children}</div>; }
export function Terminal({ children, title = "Terminal", className }: { children?: ReactNode; title?: string; className?: string }) { return <section className={cx("ai-elements-terminal", className)}><header>{title}</header><pre>{children}</pre></section>; }
export function TestResults({ results, children, className }: { results?: readonly { id: string; name: string; status: "passed" | "failed" | "skipped"; detail?: string }[]; children?: ReactNode; className?: string }) { return <section className={cx("ai-elements-test-results", className)}>{children ?? results?.map((result) => <div key={result.id} data-status={result.status}><strong>{result.name}</strong>{result.detail ? <small>{result.detail}</small> : null}</div>)}</section>; }
export function SchemaDisplay({ schema, children, className }: { schema?: unknown; children?: ReactNode; className?: string }) { return <pre className={cx("ai-elements-schema-display", className)}>{children ?? JSON.stringify(schema, null, 2)}</pre>; }
export function StackTrace({ error, children, className }: { error?: string; children?: ReactNode; className?: string }) { return <pre className={cx("ai-elements-stack-trace", className)}>{children ?? error}</pre>; }
export function WebPreview({ src, title = "Web preview", children, className }: { src?: string; title?: string; children?: ReactNode; className?: string }) { return <section className={cx("ai-elements-web-preview", className)}><header>{title}</header>{children ?? (src ? <iframe title={title} src={src} /> : <span>Preview unavailable</span>)}</section>; }
export function Sandbox({ children, className }: { children: ReactNode; className?: string }) { return <section className={cx("ai-elements-sandbox", className)}>{children}</section>; }
export function JSXPreview({ children, className }: { children: ReactNode; className?: string }) { return <section className={cx("ai-elements-jsx-preview", className)}>{children}</section>; }
export function DataTable({ columns, rows, className }: { columns: readonly string[]; rows: readonly (readonly ReactNode[])[]; className?: string }) { return <div className={cx("ai-elements-data-table", className)}><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>; }

export function Agent({ children, className, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) { return <div {...props} className={cx("ai-elements-agent", className)} data-slot="agent">{children}</div>; }
export function AgentHeader({ name, model, children, className, ...props }: HTMLAttributes<HTMLDivElement> & { name: string; model?: string; children?: ReactNode }) { return <div {...props} className={cx("ai-elements-agent-header", className)} data-slot="agent-header"><div><strong>{name}</strong>{model ? <small>{model}</small> : null}</div>{children}</div>; }
export function AgentContent({ children, className, ...props }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) { return <div {...props} className={cx("ai-elements-agent-content", className)} data-slot="agent-content">{children}</div>; }
export function AgentInstructions({ children, className, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) { return <div {...props} className={cx("ai-elements-agent-instructions", className)} data-slot="agent-instructions"><span>Instructions</span><div>{children}</div></div>; }
type AgentToolsProps = Omit<ComponentProps<typeof Accordion.Root>, "type" | "value" | "defaultValue" | "onValueChange"> & { children: ReactNode; value?: string[]; defaultValue?: string[]; onValueChange?: (value: string[]) => void };
export function AgentTools({ children, className, ...props }: AgentToolsProps) { return <div className={cx("ai-elements-agent-tools", className)} data-slot="agent-tools"><span>Tools</span><Accordion.Root {...props} type="multiple" className="ai-elements-agent-tool-list">{children}</Accordion.Root></div>; }
type AgentToolSchema = { description?: string; inputSchema?: unknown; jsonSchema?: unknown };
export function AgentTool({ name, description, tool, value, children, className, ...props }: Omit<ComponentProps<typeof Accordion.Item>, "value"> & { name?: string; description?: string; tool?: AgentToolSchema; value?: string; children?: ReactNode }) { const itemValue = value ?? name ?? "tool"; const resolvedDescription = description ?? tool?.description; const schema = tool?.jsonSchema ?? tool?.inputSchema; return <Accordion.Item {...props} value={itemValue} className={cx("ai-elements-agent-tool", className)} data-slot="agent-tool"><Accordion.Header><Accordion.Trigger className="ai-elements-agent-tool-trigger">{name ?? resolvedDescription ?? "Tool"}</Accordion.Trigger></Accordion.Header><Accordion.Content className="ai-elements-agent-tool-content">{resolvedDescription ? <p>{resolvedDescription}</p> : null}{schema !== undefined ? <CodeBlock code={formatValue(schema)} language="json" /> : null}{children}</Accordion.Content></Accordion.Item>; }
export function AgentOutput({ children, schema, className, ...props }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode; schema?: string }) { return <div {...props} className={cx("ai-elements-agent-output", className)} data-slot="agent-output"><span>Output Schema</span>{schema ? <CodeBlock code={schema} language="typescript" /> : children}</div>; }

const audioPlayerStyle: CSSProperties = { "--media-background-color": "transparent", "--media-button-icon-height": "1rem", "--media-button-icon-width": "1rem", "--media-control-background": "transparent", "--media-control-hover-background": "var(--ai-elements-surface)", "--media-control-padding": "0", "--media-font-size": "10px", "--media-icon-color": "currentColor", "--media-primary-color": "var(--ai-elements-brand)", "--media-range-bar-color": "var(--ai-elements-brand)", "--media-range-track-background": "var(--ai-elements-border)", "--media-text-color": "currentColor" } as CSSProperties;
export type AudioPlayerProps = Omit<ComponentProps<typeof MediaController>, "audio"> & { src?: string; title?: string };
export function AudioPlayer({ src, title = "Audio", children, className, style, ...props }: AudioPlayerProps) {
  return <MediaController {...props} audio data-slot="audio-player" className={cx("ai-elements-audio-player", className)} style={{ ...audioPlayerStyle, ...style }}>
    {children ?? <><AudioPlayerElement src={src} aria-label={title} /><AudioPlayerControlBar><AudioPlayerSeekBackwardButton /><AudioPlayerPlayButton /><AudioPlayerSeekForwardButton /><AudioPlayerTimeRange /><AudioPlayerTimeDisplay /><AudioPlayerDurationDisplay /><AudioPlayerMuteButton /><AudioPlayerVolumeRange /></AudioPlayerControlBar></>}
  </MediaController>;
}
export type AudioPlayerElementProps = ComponentProps<"audio"> & { data?: { base64: string; mediaType: string } };
export function AudioPlayerElement({ data, src, controls = true, ...props }: AudioPlayerElementProps) { return <audio {...props} controls={controls} data-slot="audio-player-element" slot="media" src={src ?? (data ? `data:${data.mediaType};base64,${data.base64}` : undefined)} />; }
export function AudioPlayerControlBar({ children, ...props }: ComponentProps<typeof MediaControlBar>) { return <MediaControlBar {...props} data-slot="audio-player-control-bar">{children}</MediaControlBar>; }
export function AudioPlayerPlayButton(props: ComponentProps<typeof MediaPlayButton>) { return <MediaPlayButton {...props} data-slot="audio-player-play-button" />; }
export function AudioPlayerSeekBackwardButton({ seekOffset = 10, ...props }: ComponentProps<typeof MediaSeekBackwardButton>) { return <MediaSeekBackwardButton {...props} seekOffset={seekOffset} data-slot="audio-player-seek-backward-button" />; }
export function AudioPlayerSeekForwardButton({ seekOffset = 10, ...props }: ComponentProps<typeof MediaSeekForwardButton>) { return <MediaSeekForwardButton {...props} seekOffset={seekOffset} data-slot="audio-player-seek-forward-button" />; }
export function AudioPlayerTimeDisplay(props: ComponentProps<typeof MediaTimeDisplay>) { return <MediaTimeDisplay {...props} data-slot="audio-player-time-display" />; }
export function AudioPlayerTimeRange(props: ComponentProps<typeof MediaTimeRange>) { return <MediaTimeRange {...props} data-slot="audio-player-time-range" />; }
export function AudioPlayerDurationDisplay(props: ComponentProps<typeof MediaDurationDisplay>) { return <MediaDurationDisplay {...props} data-slot="audio-player-duration-display" />; }
export function AudioPlayerMuteButton(props: ComponentProps<typeof MediaMuteButton>) { return <MediaMuteButton {...props} data-slot="audio-player-mute-button" />; }
export function AudioPlayerVolumeRange(props: ComponentProps<typeof MediaVolumeRange>) { return <MediaVolumeRange {...props} data-slot="audio-player-volume-range" />; }
export function MicSelector({ devices = [], value, onValueChange, className }: { devices?: readonly { id: string; label: string }[]; value?: string; onValueChange?: (value: string) => void; className?: string }) { return <label className={cx("ai-elements-mic-selector", className)}>Microphone<select value={value} onChange={(event) => onValueChange?.(event.target.value)}><option value="">Default microphone</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.label}</option>)}</select></label>; }
export function SpeechInput({ onTranscript, disabled = false, className }: { onTranscript?: (text: string) => void; disabled?: boolean; className?: string }) { return <button type="button" className={cx("ai-elements-speech-input", className)} disabled={disabled} onClick={() => onTranscript?.("")} aria-label="Start speech input">Speak</button>; }
export function Transcription({ lines, onSeek, className }: { lines: readonly { id: string; text: string; start: number }[]; onSeek?: (start: number) => void; className?: string }) { return <ol className={cx("ai-elements-transcription", className)}>{lines.map((line) => <li key={line.id}><button type="button" onClick={() => onSeek?.(line.start)}>{line.text}</button></li>)}</ol>; }
export function VoiceSelector({ voices = [], value, onValueChange, className }: { voices?: readonly { id: string; name: string; provider?: string }[]; value?: string; onValueChange?: (value: string) => void; className?: string }) { return <label className={cx("ai-elements-voice-selector", className)}>Voice<select value={value} onChange={(event) => onValueChange?.(event.target.value)}><option value="">Select voice</option>{voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.provider ? `${voice.provider} · ` : ""}{voice.name}</option>)}</select></label>; }
export function Persona({ state = "idle", label = "AI", className }: { state?: "idle" | "listening" | "thinking" | "speaking" | "asleep"; label?: string; className?: string }) { return <div className={cx("ai-elements-persona", className)} data-state={state} aria-label={label}>{label}</div>; }

export function Canvas({ children, className, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) { return <div {...props} className={cx("ai-elements-canvas", className)}>{children}</div>; }
export function Node({ title, description, children, className, bare = false, ...props }: HTMLAttributes<HTMLElement> & { title?: string; description?: string; children?: ReactNode; bare?: boolean }) { return <article {...props} className={cx("ai-elements-node", className)}>{bare ? children : <><header><strong>{title}</strong>{description ? <small>{description}</small> : null}</header>{children}</>}</article>; }
export function Edge({ animated = false, as = "div", children, className, ...props }: { animated?: boolean; as?: "div" | "g"; children?: ReactNode; className?: string } & HTMLAttributes<HTMLElement>) {
  const edgeClassName = cx("ai-elements-edge", animated && "is-animated", className);
  if (as === "g") return <g {...(props as React.SVGProps<SVGGElement>)} className={edgeClassName}>{children}</g>;
  return <div {...props} className={edgeClassName}>{children}</div>;
}
export function Connection({ children, className, ...props }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) { return <div {...props} className={cx("ai-elements-connection", className)}>{children}</div>; }
export function Controls({ children, className, ...props }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) { return <div {...props} className={cx("ai-elements-controls", className)}>{children}</div>; }
export function Panel({ children, position = "top-right", className, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode; position?: string }) { return <div {...props} className={cx(`ai-elements-panel ai-elements-panel-${position}`, className)}>{children}</div>; }
export function Toolbar({ children, className, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) { return <div {...props} className={cx("ai-elements-toolbar", className)}>{children}</div>; }

export function copyTextAction(text: string) { return async () => { if (typeof navigator !== "undefined" && navigator.clipboard) await navigator.clipboard.writeText(text); }; }
export const AIElementsIcons = { Check, ChevronDown, Copy, Download, ExternalLink, LoaderCircle, Plus, Search, Send, Square, X };

export { Conversation, ConversationContent, ConversationDownload, ConversationEmptyState, ConversationScrollButton, Message, MessageAction, MessageActions, MessageContent, MessagePlainText, MessageResponse, MessageToolbar, Reasoning, ReasoningContent, ReasoningTrigger, Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "./message-adapters";
