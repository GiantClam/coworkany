import { useMemo, useState } from 'react';
import type { PolicyAuditEvent } from '../../../types';
import styles from '../SettingsView.module.css';

interface PolicyAuditTrailProps {
    events: PolicyAuditEvent[];
    loading: boolean;
    clearing: boolean;
    onRefresh: () => Promise<void>;
    onClear: () => Promise<void>;
}

function summarizeTarget(event: PolicyAuditEvent): string {
    return (
        event.request.payload.command
        || event.request.payload.url
        || event.request.payload.path
        || event.request.payload.description
        || 'No target details'
    );
}

function matchesSearch(event: PolicyAuditEvent, query: string): boolean {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
        return true;
    }

    return [
        event.eventType,
        event.request.effectType,
        event.request.source,
        event.request.sourceId,
        event.request.payload.command,
        event.request.payload.url,
        event.request.payload.path,
        event.request.payload.description,
        event.note,
    ].some((value) => value?.toLowerCase().includes(normalized));
}

export function PolicyAuditTrail({
    events,
    loading,
    clearing,
    onRefresh,
    onClear,
}: PolicyAuditTrailProps) {
    const [eventFilter, setEventFilter] = useState<string>('all');
    const [effectFilter, setEffectFilter] = useState<string>('all');
    const [search, setSearch] = useState('');

    const eventTypes = useMemo(
        () => Array.from(new Set(events.map((event) => event.eventType))).sort(),
        [events]
    );

    const effectTypes = useMemo(
        () => Array.from(new Set(events.map((event) => event.request.effectType))).sort(),
        [events]
    );

    const filteredEvents = useMemo(() => (
        [...events]
            .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
            .filter((event) => eventFilter === 'all' || event.eventType === eventFilter)
            .filter((event) => effectFilter === 'all' || event.request.effectType === effectFilter)
            .filter((event) => matchesSearch(event, search))
            .slice(0, 50)
    ), [effectFilter, eventFilter, events, search]);

    return (
        <div className={styles.section} data-testid="policy-audit-trail">
            <div className={styles.sectionHeader}>
                <div>
                    <h3>Policy audit trail</h3>
                    <p>Persistent host approval history with local filters, manual refresh, and safe log clearing.</p>
                </div>
                <div className={styles.inlineMeta}>
                    <span className={styles.scopeBadge}>{events.length} loaded</span>
                    <span className={styles.scopeBadge}>{filteredEvents.length} visible</span>
                </div>
            </div>

            <div className={styles.auditToolbar}>
                <label className={styles.field}>
                    <span className={styles.label}>Search</span>
                    <input
                        className={styles.inputField}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="command, source, effect, note..."
                        data-testid="policy-audit-search"
                    />
                </label>
                <label className={styles.field}>
                    <span className={styles.label}>Event type</span>
                    <select
                        className={styles.selectField}
                        value={eventFilter}
                        onChange={(event) => setEventFilter(event.target.value)}
                        data-testid="policy-audit-event-filter"
                    >
                        <option value="all">All events</option>
                        {eventTypes.map((eventType) => (
                            <option key={eventType} value={eventType}>{eventType}</option>
                        ))}
                    </select>
                </label>
                <label className={styles.field}>
                    <span className={styles.label}>Effect type</span>
                    <select
                        className={styles.selectField}
                        value={effectFilter}
                        onChange={(event) => setEffectFilter(event.target.value)}
                        data-testid="policy-audit-effect-filter"
                    >
                        <option value="all">All effects</option>
                        {effectTypes.map((effectType) => (
                            <option key={effectType} value={effectType}>{effectType}</option>
                        ))}
                    </select>
                </label>
            </div>

            <div className={styles.inlineActions}>
                <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => void onRefresh()}
                    disabled={loading || clearing}
                    data-testid="policy-audit-refresh"
                >
                    {loading ? 'Refreshing...' : 'Refresh audit'}
                </button>
                <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => {
                        setSearch('');
                        setEventFilter('all');
                        setEffectFilter('all');
                    }}
                    disabled={loading || clearing}
                    data-testid="policy-audit-reset-filters"
                >
                    Reset filters
                </button>
                <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => void onClear()}
                    disabled={clearing || loading || events.length === 0}
                    data-testid="policy-audit-clear"
                >
                    {clearing ? 'Clearing...' : 'Clear audit log'}
                </button>
            </div>

            {filteredEvents.length === 0 ? (
                <div className={styles.emptyState}>
                    {events.length === 0
                        ? 'No policy audit events have been captured yet.'
                        : 'No policy audit events match the current filters.'}
                </div>
            ) : (
                <div className={styles.auditList}>
                    {filteredEvents.map((event) => (
                        <div key={event.id} className={styles.auditItem}>
                            <div className={styles.auditHeader}>
                                <span className={styles.scopeBadge}>{event.eventType}</span>
                                <span className={styles.auditTimestamp}>{new Date(event.timestamp).toLocaleString()}</span>
                            </div>
                            <div className={styles.auditPrimary}>{summarizeTarget(event)}</div>
                            <div className={styles.auditMeta}>
                                <span>{event.request.effectType}</span>
                                <span>{event.request.source}</span>
                                {event.request.sourceId && <span>{event.request.sourceId}</span>}
                            </div>
                            {event.note && <div className={styles.auditNote}>{event.note}</div>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default PolicyAuditTrail;
