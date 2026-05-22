/**
 * Skeleton loading utility for table rows
 * Shows animated placeholder rows while data is being fetched
 */

/**
 * Generate skeleton rows for a table body
 * @param {string} tableBodyId - The ID of the tbody element
 * @param {number} rowCount - Number of skeleton rows to show (default: 5)
 * @param {number} colCount - Number of columns (default: auto-detected from thead)
 */
export function showSkeleton(tableBodyId, rowCount = 5, colCount) {
    const body = document.getElementById(tableBodyId);
    if (!body) return;

    // Auto-detect column count from thead if not specified
    if (!colCount) {
        const table = body.closest('table');
        if (table) {
            const headerRow = table.querySelector('thead tr');
            if (headerRow) {
                colCount = headerRow.querySelectorAll('th').length;
            }
        }
    }
    colCount = colCount || 6;

    // Generate skeleton rows with varied cell widths for a natural look
    const cellWidths = ['skeleton-cell-sm', 'skeleton-cell-md', 'skeleton-cell-lg', 'skeleton-cell-xl', 'skeleton-cell-full', 'skeleton-cell-md'];
    
    let html = '';
    for (let r = 0; r < rowCount; r++) {
        html += '<tr class="skeleton-row">';
        for (let c = 0; c < colCount; c++) {
            const widthClass = cellWidths[c % cellWidths.length];
            // First column often has an icon
            if (c === 0 && colCount > 3) {
                html += `<td><div class="flex items-center gap-2"><div class="skeleton-icon skeleton-cell"></div><div class="${widthClass} skeleton-cell"></div></div></td>`;
            } else {
                html += `<td><div class="${widthClass} skeleton-cell"></div></td>`;
            }
        }
        html += '</tr>';
    }

    body.innerHTML = html;
}
