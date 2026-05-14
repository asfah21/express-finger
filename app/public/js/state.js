/**
 * Global application state
 */

export const state = {
    currentUser: null,
    currentPath: 'overview',
    pagination: {
        overview: { page: 0, size: 10, total: 0 },
        devices: { page: 0, size: 10, total: 0 },
        employees: { page: 0, size: 25, total: 0 },
        logs: { page: 0, size: 25, total: 0 },
        activity: { page: 0, size: 25, total: 0 }
    }
};
