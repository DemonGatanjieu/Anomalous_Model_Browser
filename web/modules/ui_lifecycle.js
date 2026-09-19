// Resources belong to the view that creates them, including every close path.
export function createViewScope() {
    const controller = new AbortController();
    const cleanups = new Set();
    const onDispose = cleanup => {
        if (controller.signal.aborted) cleanup();
        else cleanups.add(cleanup);
        return () => cleanups.delete(cleanup);
    };
    return {
        signal: controller.signal,
        onDispose,
        listen(target, event, handler, options) {
            target.addEventListener(event, handler, options);
            return onDispose(() => target.removeEventListener(event, handler, options));
        },
        dispose() {
            if (controller.signal.aborted) return;
            controller.abort();
            for (const cleanup of cleanups) cleanup();
            cleanups.clear();
        },
    };
}

export function bindDrawerResize(handle, panel, scope, { side, minWidth, setWidth, saveWidth, enabled = () => true }) {
    let finish = null;
    handle.onmousedown = event => {
        if (event.button !== 0 || scope.signal.aborted || !enabled()) return;
        finish?.();
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = panel.getBoundingClientRect().width;
        const previousSelect = document.body.style.userSelect;
        const previousCursor = document.body.style.cursor;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'ew-resize';
        handle.classList.add('is-resizing');
        const move = moveEvent => {
            const delta = (moveEvent.clientX - startX) * (side() === 'left' ? 1 : -1);
            setWidth(Math.max(minWidth, Math.min(window.innerWidth * 0.85, startWidth + delta)));
        };
        const stop = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
            document.body.style.userSelect = previousSelect;
            document.body.style.cursor = previousCursor;
            handle.classList.remove('is-resizing');
            finish = null;
        };
        const up = () => { stop(); saveWidth(panel.getBoundingClientRect().width); };
        finish = stop;
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };
    scope.onDispose(() => { finish?.(); handle.onmousedown = null; });
}
