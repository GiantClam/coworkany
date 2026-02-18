/**
 * QuickChatView Component
 *
 * A lightweight floating chat window for quick interactions
 * Designed for enterprise users who want AI assistance without leaving their work
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './QuickChat.css';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

const SendIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"></line>
        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
    </svg>
);

const CloseIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
);

const MinimizeIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
);

export const QuickChatView: React.FC = () => {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleClose = useCallback(async () => {
        try {
            const win = getCurrentWindow();
            await win.hide();
        } catch (e) {
            console.error('Failed to close window:', e);
        }
    }, []);

    const handleMinimize = useCallback(async () => {
        try {
            const win = getCurrentWindow();
            await win.minimize();
        } catch (e) {
            console.error('Failed to minimize window:', e);
        }
    }, []);

    const handleSubmit = useCallback(async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!query.trim() || isLoading) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: query.trim(),
            timestamp: Date.now(),
        };

        setMessages(prev => [...prev, userMessage]);
        setQuery('');
        setIsLoading(true);

        try {
            // TODO: Implement actual AI chat integration
            // For now, simulate a response
            setTimeout(() => {
                const assistantMessage: Message = {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: t('quickChat.devHint'),
                    timestamp: Date.now(),
                };
                setMessages(prev => [...prev, assistantMessage]);
                setIsLoading(false);
            }, 1000);
        } catch (error) {
            console.error('Failed to send message:', error);
            setIsLoading(false);
        }
    }, [query, isLoading, t]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    }, [handleSubmit]);

    return (
        <div className="quickchat-container">
            <div className="quickchat-header">
                <div className="quickchat-title">
                    <span className="quickchat-logo">💬</span>
                    <span>{t('quickChat.title')}</span>
                </div>
                <div className="quickchat-controls">
                    <button className="quickchat-btn" onClick={handleMinimize} title={t('quickChat.minimize')}>
                        <MinimizeIcon />
                    </button>
                    <button className="quickchat-btn close" onClick={handleClose} title={t('quickChat.close')}>
                        <CloseIcon />
                    </button>
                </div>
            </div>

            <div className="quickchat-messages">
                {messages.length === 0 ? (
                    <div className="quickchat-empty">
                        <p>👋 {t('quickChat.emptyGreeting')}</p>
                        <p className="quickchat-empty-hint">{t('chat.startTaskHint')}</p>
                    </div>
                ) : (
                    messages.map(msg => (
                        <div key={msg.id} className={`quickchat-message ${msg.role}`}>
                            <div className="message-content">{msg.content}</div>
                        </div>
                    ))
                )}
                {isLoading && (
                    <div className="quickchat-message assistant">
                        <div className="message-content loading">
                            <span className="loading-dot">●</span>
                            <span className="loading-dot">●</span>
                            <span className="loading-dot">●</span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <form className="quickchat-input" onSubmit={handleSubmit}>
                <textarea
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t('chat.placeholderBuild')}
                    disabled={isLoading}
                    rows={1}
                />
                <button 
                    type="submit" 
                    className="send-button" 
                    disabled={!query.trim() || isLoading}
                >
                    <SendIcon />
                </button>
            </form>
        </div>
    );
};

export default QuickChatView;
