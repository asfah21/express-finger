/**
 * Global application state
 */

/**
 * Global application state
 * All pagination sizes are centralized here for consistency
 */
export const state = {
    currentUser: null,
    currentPath: 'overview',
    pagination: {
        overview: { page: 0, size: 25, total: 0 },
        devices: { page: 0, size: 25, total: 0 },
        employees: { page: 0, size: 25, total: 0 },
        logs: { page: 0, size: 25, total: 0 },
        activity: { page: 0, size: 25, total: 0 }
    },
    isSettingsUnlocked: false,
    // Maximum export limit - centralized to avoid hardcoded values
    EXPORT_LIMIT: 50000
};
