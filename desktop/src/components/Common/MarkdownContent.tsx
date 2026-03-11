import React, { Suspense } from 'react';

const RichMarkdownContent = React.lazy(async () => {
    const module = await import('./RichMarkdownContent');
    return { default: module.RichMarkdownContent };
});

interface MarkdownContentProps {
    content: string;
}

export const MarkdownContent: React.FC<MarkdownContentProps> = ({ content }) => (
    <Suspense fallback={<div>{content}</div>}>
        <RichMarkdownContent content={content} />
    </Suspense>
);
