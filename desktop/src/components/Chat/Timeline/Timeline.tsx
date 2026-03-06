/**
 * Timeline Component
 *
 * Main timeline interface for displaying chat history
 */

import React from 'react';
import styles from './Timeline.module.css';
import type { TaskSession } from '../../../types';
import { useTimelineItems } from './hooks/useTimelineItems';
import { ToolCard } from './components/ToolCard';
import { MessageBubble } from './components/MessageBubble';
import { SystemBadge } from './components/SystemBadge';
import { IS_STARTUP_BASELINE } from '../../../lib/startupProfile';

// ============================================================================
// Main Timeline Component
// ============================================================================

export const Timeline: React.FC<{ session: TaskSession }> = ({ session }) => {
    const [showFullHistory, setShowFullHistory] = React.useState(false);
    const shouldCollapseHistory = !IS_STARTUP_BASELINE && !showFullHistory && session.events.length > 320;
    const { items, hiddenEventCount } = useTimelineItems(session, shouldCollapseHistory ? 320 : undefined);
    const endRef = React.useRef<HTMLDivElement>(null);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const [userScrolled, setUserScrolled] = React.useState(false);
    const scrollTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(() => {
        setShowFullHistory(false);
    }, [session.taskId]);

    // Detect if user manually scrolled up
    React.useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container;
            const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
            setUserScrolled(!isAtBottom);
        };

        container.addEventListener('scroll', handleScroll);
        return () => container.removeEventListener('scroll', handleScroll);
    }, []);

    // Auto-scroll to bottom with debounce - only if user hasn't scrolled up
    React.useEffect(() => {
        if (userScrolled) return;

        // Clear previous timeout
        if (scrollTimeoutRef.current) {
            clearTimeout(scrollTimeoutRef.current);
        }

        // Debounce scroll - wait 100ms after last update
        scrollTimeoutRef.current = setTimeout(() => {
            endRef.current?.scrollIntoView({ behavior: 'auto' });
        }, 100);

        return () => {
            if (scrollTimeoutRef.current) {
                clearTimeout(scrollTimeoutRef.current);
            }
        };
    }, [items.length, userScrolled]);

    // Reset userScrolled when new message starts (items.length changes)
    React.useEffect(() => {
        setUserScrolled(false);
    }, [items.length]);

    return (
        <div className={styles.timeline} ref={containerRef}>
            {hiddenEventCount > 0 && (
                <button
                    type="button"
                    onClick={() => setShowFullHistory(true)}
                    style={{
                        alignSelf: 'center',
                        border: '1px solid var(--border-subtle)',
                        background: 'var(--bg-panel)',
                        color: 'var(--text-secondary)',
                        borderRadius: '999px',
                        padding: '6px 12px',
                        fontSize: '12px',
                        cursor: 'pointer',
                    }}
                >
                    Show earlier activity ({hiddenEventCount} hidden events)
                </button>
            )}
            {items.map((item) => {
                switch (item.type) {
                    case 'user_message':
                        return <MessageBubble key={item.id} item={item as any} isUser={true} />;
                    case 'assistant_message':
                        return <MessageBubble key={item.id} item={item as any} isUser={false} />;
                    case 'tool_call':
                        return <ToolCard key={item.id} item={item as any} />;
                    case 'system_event':
                        return <SystemBadge key={item.id} content={(item as any).content} />;
                    default:
                        return null;
                }
            })}
            <div ref={endRef} />
        </div>
    );
};
