
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
// import { invoke } from '@tauri-apps/api/core';

interface Directive {
    id: string;
    name: string;
    content: string;
    enabled: boolean;
    priority: number;
}

export const DirectivesEditor: React.FC = () => {
    const { t } = useTranslation();
    const [directives, setDirectives] = useState<Directive[]>([]);
    // const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadDirectives();
    }, []);

    const loadDirectives = async () => {
        // In real app, call backend
        // const data = await invoke('get_directives');
        // Mock for now as we haven't exposed IPC for this yet
        setDirectives([
            { id: '1', name: 'No Any', content: 'Do not use "any"', enabled: true, priority: 1 },
            { id: '2', name: 'Concise', content: 'Be concise', enabled: false, priority: 0 }
        ]);
        // setLoading(false);
    };

    const toggleDirective = (id: string) => {
        setDirectives(prev => prev.map(d =>
            d.id === id ? { ...d, enabled: !d.enabled } : d
        ));
    };

    return (
        <div className="p-4 space-y-4">
            <h2 className="text-xl font-bold">{t('settings.personalizedDirectives')}</h2>
            <p className="text-gray-400 text-sm">{t('settings.directivesHint')}</p>

            <div className="space-y-2">
                {directives.map(d => (
                    <div key={d.id} className="flex items-center justify-between bg-gray-800 p-3 rounded border border-gray-700">
                        <div>
                            <div className="font-medium text-white">{d.name}</div>
                            <div className="text-sm text-gray-400">{d.content}</div>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">P{d.priority}</span>
                            <button
                                onClick={() => toggleDirective(d.id)}
                                className={`px-2 py-1 rounded text-xs ${d.enabled ? 'bg-green-600' : 'bg-gray-600'}`}
                            >
                                {d.enabled ? 'ON' : 'OFF'}
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <button className="w-full py-2 bg-blue-600 rounded hover:bg-blue-700 text-sm">
                + {t('settings.addNewDirective')}
            </button>
        </div>
    );
};
