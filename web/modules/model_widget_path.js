/**
 * Puts a model path into a loader node's model widget: the drop-down's own spelling of it when
 * the list has it (either slash), else the path as given.
 */

export function setWidgetValuePath(node, relPath) {
    if (!node.widgets || node.widgets.length === 0) return;
    const w = node.widgets.find(wg => wg.type === 'combo');
    const targetWidget = w || node.widgets[0];
    if (!targetWidget) return;

    if (targetWidget.options && targetWidget.options.values) {
        const normalizedTarget = relPath.replace(/\\/g, '/');
        const match = targetWidget.options.values.find(v => {
            return String(v).replace(/\\/g, '/') === normalizedTarget;
        });
        if (match) {
            targetWidget.value = match;
            return;
        }
    }
    targetWidget.value = relPath;
}
