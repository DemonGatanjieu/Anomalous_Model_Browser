/**
 * The models page's folder column: the folders of the type the chips show, not every type. Its
 * heading names the type with 📂 Open (Explorer opens the type's folder); then All (the whole
 * type), the subfolders as a tree whose numbers count their subfolders too (empty ones dimmed,
 * ▸ folds one away for this session), and "In the top folder" for models lying directly in the
 * type's folder when it has subfolders. The listed folder is highlighted; a subfolder's 📂
 * shows on hover.
 */

import { translate as t } from './locales.js';
import { openType, typeLabel } from './ui_model_types.js';
import { openModelFolder } from './model_location.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function openButton(where, label = '') {
    const button = el('button', 'anomalous-folder-open', `📂${label ? ` ${label}` : ''}`);
    button.type = 'button';
    button.title = t('folderOpenHint');
    button.onclick = (event) => {
        event.stopPropagation();
        openModelFolder(where);
    };
    return button;
}

function listFolder(owner, group, subfolder) {
    owner.modelScope = { type: group.type, path_idx: group.path_idx, subfolder };
    owner.modelView = '';
    owner.currentType = group.type;
    owner.currentPathIdx = group.path_idx;
    owner.currentSubfolder = subfolder;
    owner.hideAllPanels();
    owner.grid.style.display = 'grid';
    owner.renderSidebar();
    owner.loadModels();
}

export function renderFolderColumn(owner) {
    const box = el('div', 'anomalous-folder-column');
    const scope = owner.modelScope;
    const group = (owner.foldersData || []).find(item => item.type === scope?.type && item.path_idx === scope?.path_idx);
    if (!group) return box;
    const where = (subfolder) => ({ type: group.type, path_idx: group.path_idx, subfolder });
    const folders = group.folders || {};
    const paths = Object.keys(folders);
    const subfolders = paths.filter(path => path !== '/').sort((a, b) => a.localeCompare(b));
    const count = (path) => paths
        .filter(item => path === '/' || item === path || item.startsWith(`${path}/`))
        .reduce((sum, item) => sum + (folders[item].model_count || 0), 0);
    const folded = owner.collapsedFolders;

    const row = ({ label, number, depth, active, onPick, path, toggle }) => {
        const item = el('div', 'anomalous-folder-item');
        item.style.paddingLeft = `${12 + depth * 14}px`;
        item.classList.toggle('active', active);
        item.classList.toggle('is-empty', !number);
        const fold = el('span', 'anomalous-folder-toggle', toggle ? (folded.has(toggle) ? '▸' : '▾') : '');
        if (toggle) {
            fold.onclick = (event) => {
                event.stopPropagation();
                if (folded.has(toggle)) folded.delete(toggle);
                else folded.add(toggle);
                owner.renderSidebar();
            };
        }
        const name = el('span', 'anomalous-folder-name', label);
        name.title = label;
        item.append(fold, name, el('span', 'anomalous-folder-count', String(number)));
        if (path) item.append(openButton(where(path)));
        item.onclick = onPick;
        return item;
    };

    const head = el('div', 'anomalous-folder-head');
    head.append(el('span', 'anomalous-folder-head-name', typeLabel(group)), openButton(where('/'), t('folderOpen')));
    box.append(head, row({ label: t('folderAll'), number: count('/'), depth: 0, active: !scope.subfolder, onPick: () => openType(owner, group) }));
    for (const path of subfolders) {
        const parts = path.split('/').filter(Boolean);
        const hidden = parts.slice(0, -1).some((_, index) => folded.has(`${group.type}/${parts.slice(0, index + 1).join('/')}`));
        if (hidden) continue;
        const hasChildren = subfolders.some(item => item.startsWith(`${path}/`));
        box.append(row({
            label: folders[path].name, number: count(path), depth: parts.length, path,
            active: scope.subfolder === path, toggle: hasChildren ? group.type + path : '',
            onPick: () => listFolder(owner, group, path),
        }));
    }
    if (subfolders.length && folders['/']?.model_count) {
        box.append(row({ label: t('folderTopOnly'), number: folders['/'].model_count, depth: 0, path: '/', active: scope.subfolder === '/', onPick: () => listFolder(owner, group, '/') }));
    }
    return box;
}
