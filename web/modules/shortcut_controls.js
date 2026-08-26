export const DEFAULT_BROWSER_SHORTCUT = Object.freeze({
    key: 'm',
    ctrl: true,
    shift: true
});

export function formatKeyCombo(combo) {
    if (!combo) return '';
    if (typeof combo.getKeySequences === 'function') {
        return combo.getKeySequences().join(' + ');
    }

    const keys = [];
    if (combo.ctrl || combo.meta) keys.push('Ctrl');
    if (combo.alt) keys.push('Alt');
    if (combo.shift) keys.push('Shift');
    if (combo.key) {
        keys.push(combo.key.length === 1 ? combo.key.toUpperCase() : combo.key);
    }
    return keys.join(' + ');
}

function getCommand(app, commandId) {
    return app.extensionManager?.command?.commands?.find((command) => command.id === commandId);
}

function waitForElement(selector, timeout = 1500) {
    return new Promise((resolve) => {
        const existing = document.querySelector(selector);
        if (existing) {
            resolve(existing);
            return;
        }

        const observer = new MutationObserver(() => {
            const element = document.querySelector(selector);
            if (!element) return;
            observer.disconnect();
            clearTimeout(timer);
            resolve(element);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        const timer = setTimeout(() => {
            observer.disconnect();
            resolve(null);
        }, timeout);
    });
}

function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

export async function openNativeKeybindingEditor(commandId) {
    const settingsDialog = document.querySelector('[data-testid="settings-dialog"]');
    const keybindingNav = settingsDialog?.querySelector('[data-nav-id="keybinding"]');
    if (!(keybindingNav instanceof HTMLElement)) return false;

    keybindingNav.click();
    const searchInput = await waitForElement('#keybinding-panel-header input');
    if (!(searchInput instanceof HTMLInputElement)) return false;

    setInputValue(searchInput, commandId);
    const commandTitle = await waitForElement(`.keybinding-panel [title="${CSS.escape(commandId)}"]`);
    const commandRow = commandTitle?.closest('tr');
    if (!commandRow) return false;

    const actionButtons = commandRow.querySelectorAll('.actions button');
    const bindingCellText = commandRow.children[1]?.textContent?.trim();
    const canOpenRecorderDirectly = actionButtons.length >= 4 || bindingCellText === '-';
    if (canOpenRecorderDirectly && actionButtons[0] instanceof HTMLButtonElement) {
        actionButtons[0].click();
    }
    return true;
}

export function createShortcutSettingControl({ app, commandId, translate }) {
    const container = document.createElement('div');
    container.className = 'anomalous-shortcut-setting';

    const current = document.createElement('kbd');
    current.className = 'anomalous-shortcut-current';
    const combo = getCommand(app, commandId)?.keybinding?.combo;
    current.textContent = formatKeyCombo(combo) || translate('mainShortcutUnassigned');

    const customize = document.createElement('button');
    customize.type = 'button';
    customize.className = 'anomalous-shortcut-customize';
    customize.textContent = translate('mainShortcutCustomize');
    customize.addEventListener('click', async () => {
        customize.disabled = true;
        const opened = await openNativeKeybindingEditor(commandId);
        customize.disabled = false;
        if (!opened) {
            app.extensionManager?.toast?.add?.({
                severity: 'warn',
                summary: translate('mainShortcutSetting'),
                detail: translate('mainShortcutOpenFailed'),
                life: 3500
            });
        }
    });

    container.append(current, customize);
    return container;
}
