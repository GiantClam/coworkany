import './StartupSkeleton.css';

interface StartupSkeletonProps {
    visible: boolean;
}

export function StartupSkeleton({ visible }: StartupSkeletonProps) {
    if (!visible) return null;

    return (
        <div className="startup-skeleton-overlay" aria-hidden="true">
            <div className="startup-skeleton-card">
                <div className="startup-skeleton-chip" />
                <div className="startup-skeleton-line" />
                <div className="startup-skeleton-line startup-skeleton-line-short" />
            </div>
        </div>
    );
}
