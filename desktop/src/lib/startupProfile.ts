type StartupProfile = 'baseline' | 'optimized';

function resolveStartupProfile(): StartupProfile {
    const raw = String((import.meta as any).env?.VITE_COWORKANY_STARTUP_PROFILE ?? '').toLowerCase();
    return raw === 'baseline' ? 'baseline' : 'optimized';
}

export const STARTUP_PROFILE: StartupProfile = resolveStartupProfile();
export const IS_STARTUP_BASELINE = STARTUP_PROFILE === 'baseline';
