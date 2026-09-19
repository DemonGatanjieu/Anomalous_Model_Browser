export function showWorkbenchToast(message) {
    const toast = document.createElement('div');
    toast.className = 'anomalous-mixer-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('is-show'), 10);
    setTimeout(() => {
        toast.classList.remove('is-show');
        setTimeout(() => toast.remove(), 300);
    }, 2400);
}
