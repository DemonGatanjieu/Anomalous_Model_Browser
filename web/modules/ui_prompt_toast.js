/**
 * A short message at the top right. With `action` ({ label, run }) it carries a button
 * (an undo, say) and stays longer, and as long as the pointer is on it.
 */
export function showWorkbenchToast(message, action = null) {
    const toast = document.createElement('div');
    toast.className = 'anomalous-mixer-toast';
    toast.append(document.createTextNode(message));
    let timer = null;
    const close = () => {
        clearTimeout(timer);
        toast.classList.remove('is-show');
        setTimeout(() => toast.remove(), 300);
    };
    const wait = () => { timer = setTimeout(close, action ? 8000 : 2400); };
    if (action) {
        toast.classList.add('has-action');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'anomalous-mixer-toast-action';
        button.textContent = action.label;
        button.onclick = () => { close(); action.run(); };
        toast.append(button);
        toast.onpointerenter = () => clearTimeout(timer);
        toast.onpointerleave = wait;
    }
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('is-show'), 10);
    wait();
}
