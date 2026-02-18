/**
 * Global Toast Notification System
 *
 * Provides a `toast` API callable from anywhere in the app:
 *   toast.success('Title', 'Description')
 *   toast.error('Title', 'Description')
 *   toast.warning('Title', 'Description')
 *   toast.info('Title', 'Description')
 *
 * Uses @radix-ui/react-toast with a Zustand-backed queue.
 */

import React, { useEffect, useState } from 'react';
import * as RadixToast from '@radix-ui/react-toast';
import styles from '../../styles/toast.module.css';

// ============================================================================
// Types
// ============================================================================

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
    id: string;
    type: ToastType;
    title: string;
    description?: string;
    duration?: number; // ms — error defaults to Infinity (manual close)
}

// ============================================================================
// Module-level toast queue (no context needed)
// ============================================================================

type ToastListener = (item: ToastItem) => void;
const listeners = new Set<ToastListener>();
let nextId = 0;

function emitToast(type: ToastType, title: string, description?: string, duration?: number) {
    const item: ToastItem = {
        id: `toast-${++nextId}`,
        type,
        title,
        description,
        duration,
    };
    listeners.forEach((fn) => fn(item));
}

/** Global toast API — import and call from anywhere */
export const toast = {
    success: (title: string, description?: string) => emitToast('success', title, description, 3000),
    error: (title: string, description?: string) => emitToast('error', title, description, 8000),
    warning: (title: string, description?: string) => emitToast('warning', title, description, 5000),
    info: (title: string, description?: string) => emitToast('info', title, description, 3000),
};

// ============================================================================
// Single Toast Item Component
// ============================================================================

function ToastItemView({ item, onOpenChange }: { item: ToastItem; onOpenChange: (open: boolean) => void }) {
    const iconMap: Record<ToastType, string> = {
        success: '✓',
        error: '✗',
        warning: '⚠',
        info: 'ℹ',
    };

    return (
        <RadixToast.Root
            className={`${styles.root} ${styles[item.type]}`}
            duration={item.duration}
            onOpenChange={onOpenChange}
        >
            <div className={styles.icon}>{iconMap[item.type]}</div>
            <div className={styles.content}>
                <RadixToast.Title className={styles.title}>{item.title}</RadixToast.Title>
                {item.description && (
                    <RadixToast.Description className={styles.description}>
                        {item.description}
                    </RadixToast.Description>
                )}
            </div>
            <RadixToast.Close className={styles.close} aria-label="Close">
                ×
            </RadixToast.Close>
        </RadixToast.Root>
    );
}

// ============================================================================
// Toast Provider (wrap root)
// ============================================================================

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<ToastItem[]>([]);

    useEffect(() => {
        const listener: ToastListener = (item) => {
            setToasts((prev) => [...prev, item]);
        };
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    }, []);

    const removeToast = (id: string) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    };

    return (
        <RadixToast.Provider swipeDirection="right">
            {children}
            {toasts.map((item) => (
                <ToastItemView
                    key={item.id}
                    item={item}
                    onOpenChange={(open) => { if (!open) removeToast(item.id); }}
                />
            ))}
            <RadixToast.Viewport className={styles.viewport} />
        </RadixToast.Provider>
    );
}
