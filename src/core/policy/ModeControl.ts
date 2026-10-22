export type AutonomyMode = 'semi_auto' | 'full_auto_lab';

/**
 * Read the effective runtime mode. Unknown values fail closed to semi-auto.
 * The interactive UI intentionally exposes only a downgrade to safe mode;
 * enabling full-auto lab mode must be configured explicitly outside the UI.
 */
export function getAutonomyMode(): AutonomyMode {
    return process.env.AUTONOMY_MODE === 'full_auto_lab' ? 'full_auto_lab' : 'semi_auto';
}

export function forceSafeMode(): AutonomyMode {
    process.env.AUTONOMY_MODE = 'semi_auto';
    return 'semi_auto';
}
