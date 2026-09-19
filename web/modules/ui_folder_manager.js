/** Folder visibility, ordering, and presentation-mode dialog. */

import { translate } from './locales.js';

const t = (key, params) => translate(key, params);

export async function openFolderManager() {
    let modal = document.getElementById('anomalous-folder-manager-modal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'anomalous-folder-manager-modal';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100vw';
    modal.style.height = '100vh';
    modal.style.backgroundColor = 'rgba(0,0,0,0.7)';
    modal.style.zIndex = '9999999';
    modal.style.display = 'flex';
    modal.style.justifyContent = 'center';
    modal.style.alignItems = 'center';
    modal.style.fontFamily = 'Roboto, "Segoe UI", sans-serif';

    const content = document.createElement('div');
    content.style.background = '#1e1e1e';
    content.style.borderRadius = '12px';
    content.style.padding = '24px';
    content.style.width = '500px';
    content.style.maxWidth = '90%';
    content.style.maxHeight = '85vh';
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';

    const header = document.createElement('h2');
    header.textContent = t('sidebarFolderManagerTitle');
    header.style.margin = '0 0 16px 0';
    header.style.color = '#fff';
    header.style.fontSize = '1.4em';
    content.appendChild(header);

    const desc = document.createElement('div');
    desc.textContent = t('sidebarFolderManagerDesc');
    desc.style.color = '#aaa';
    desc.style.fontSize = '0.9em';
    desc.style.marginBottom = '20px';
    desc.style.lineHeight = '1.5';
    content.appendChild(desc);

    const toggleContainer = document.createElement('div');
    toggleContainer.style.display = 'flex';
    toggleContainer.style.alignItems = 'center';
    toggleContainer.style.justifyContent = 'center';
    toggleContainer.style.marginBottom = '15px';
    toggleContainer.style.gap = '20px';
    toggleContainer.style.background = '#222';
    toggleContainer.style.padding = '10px';
    toggleContainer.style.borderRadius = '8px';
    toggleContainer.style.border = '1px solid #444';

    const abstractRadio = document.createElement('input');
    abstractRadio.type = 'radio';
    abstractRadio.name = 'viewMode';
    abstractRadio.value = 'abstract';
    abstractRadio.id = 'anomalous_mode_abstract';
    
    const abstractLabel = document.createElement('label');
    abstractLabel.htmlFor = 'anomalous_mode_abstract';
    abstractLabel.textContent = t('sidebarCategoryMode');
    abstractLabel.style.cursor = 'pointer';
    abstractLabel.style.color = '#ccc';

    const physicalRadio = document.createElement('input');
    physicalRadio.type = 'radio';
    physicalRadio.name = 'viewMode';
    physicalRadio.value = 'physical';
    physicalRadio.id = 'anomalous_mode_physical';

    const physicalLabel = document.createElement('label');
    physicalLabel.htmlFor = 'anomalous_mode_physical';
    physicalLabel.textContent = t('sidebarPhysicalMode');
    physicalLabel.style.cursor = 'pointer';
    physicalLabel.style.color = '#ccc';
    
    const div1 = document.createElement('div');
    div1.style.display = 'flex';
    div1.style.alignItems = 'center';
    div1.style.gap = '6px';
    div1.appendChild(abstractRadio);
    div1.appendChild(abstractLabel);

    const div2 = document.createElement('div');
    div2.style.display = 'flex';
    div2.style.alignItems = 'center';
    div2.style.gap = '6px';
    div2.appendChild(physicalRadio);
    div2.appendChild(physicalLabel);

    toggleContainer.appendChild(div1);
    toggleContainer.appendChild(div2);
    content.appendChild(toggleContainer);

    const listContainer = document.createElement('div');
    listContainer.style.flex = '1';
    listContainer.style.overflowY = 'auto';
    listContainer.style.border = '1px solid #444';
    listContainer.style.borderRadius = '8px';
    listContainer.style.background = '#2a2a2a';
    listContainer.style.padding = '8px';

    content.appendChild(listContainer);

    let typesData = [];
    let currentMode = 'abstract';
    
    const fetchData = async () => {
        try {
            const res = await fetch('/anomalous/all_folder_types');
            const data = await res.json();
            typesData = data.folder_types || [];
            currentMode = data.folder_view_mode || 'abstract';
            
            if (currentMode === 'physical') {
                physicalRadio.checked = true;
            } else {
                abstractRadio.checked = true;
            }
            
            typesData.sort((a, b) => {
                if (a.visible && !b.visible) return -1;
                if (!a.visible && b.visible) return 1;
                return 0;
            });
            renderList();
        } catch(e) {
            alert(t('sidebarFolderLoadFailed'));
        }
    };
    
    const onModeSwitch = async (e) => {
        const newMode = e.target.value;
        if (newMode === currentMode) return;
        
        try {
            await fetch('/anomalous/save_config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder_view_mode: newMode })
            });
            await fetchData();
            this.firstLoadDone = false;
            this.expandedFolders.clear();
            await this.loadFolders();
        } catch(err) {
            alert(t('sidebarFolderModeError'));
        }
    };
    
    abstractRadio.addEventListener('change', onModeSwitch);
    physicalRadio.addEventListener('change', onModeSwitch);

    let dragSrcEl = null;

    const renderList = () => {
        listContainer.innerHTML = '';
        typesData.forEach((item, index) => {
            const row = document.createElement('div');
            row.className = 'anomalous-folder-manager-row';
            row.draggable = true;
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.justifyContent = 'space-between';
            row.style.padding = '10px 12px';
            row.style.margin = '4px 0';
            row.style.background = '#333';
            row.style.borderRadius = '6px';
            row.style.cursor = 'grab';
            row.style.border = '1px solid transparent';
            
            row.dataset.index = index;
            row.dataset.type = item.type;
            row.dataset.visible = item.visible;

            row.addEventListener('dragstart', function(e) {
                this.style.opacity = '0.4';
                dragSrcEl = this;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', this.innerHTML);
            });

            row.addEventListener('dragover', function(e) {
                if (e.preventDefault) e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                return false;
            });

            row.addEventListener('dragenter', function(e) {
                this.style.border = '1px dashed #e5e7eb';
            });

            row.addEventListener('dragleave', function(e) {
                this.style.border = '1px solid transparent';
            });

            row.addEventListener('drop', function(e) {
                if (e.stopPropagation) e.stopPropagation();
                if (dragSrcEl !== this) {
                    const fromIdx = parseInt(dragSrcEl.dataset.index);
                    const toIdx = parseInt(this.dataset.index);
                    const movedItem = typesData.splice(fromIdx, 1)[0];
                    typesData.splice(toIdx, 0, movedItem);
                    renderList();
                }
                return false;
            });

            row.addEventListener('dragend', function(e) {
                this.style.opacity = '1';
                const rows = listContainer.querySelectorAll('.anomalous-folder-manager-row');
                rows.forEach(r => r.style.border = '1px solid transparent');
            });

            const leftGroup = document.createElement('div');
            leftGroup.style.display = 'flex';
            leftGroup.style.alignItems = 'center';
            leftGroup.style.gap = '12px';
            
            const handle = document.createElement('div');
            handle.innerHTML = '☰';
            handle.style.color = '#888';
            handle.style.cursor = 'grab';

            const name = document.createElement('div');
            name.innerText = item.type;
            name.style.color = item.visible ? '#fff' : '#666';
            name.style.fontWeight = '500';

            leftGroup.appendChild(handle);
            leftGroup.appendChild(name);

            const visBtn = document.createElement('button');
            visBtn.innerHTML = item.visible ? '👁️' : '❌';
            visBtn.style.background = 'transparent';
            visBtn.style.border = 'none';
            visBtn.style.cursor = 'pointer';
            visBtn.style.fontSize = '1.2em';
            visBtn.style.opacity = item.visible ? '1' : '0.5';
            visBtn.title = t(item.visible ? 'sidebarVisible' : 'sidebarHidden');
            
            visBtn.onclick = (e) => {
                e.stopPropagation();
                typesData[index].visible = !typesData[index].visible;
                renderList();
            };

            row.appendChild(leftGroup);
            row.appendChild(visBtn);

            listContainer.appendChild(row);
        });
    };
    fetchData(); // initial load
    
    // --- End Drag & Drop Logic ---

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '12px';
    footer.style.marginTop = '20px';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = t('sidebarCancel');
    cancelBtn.style.padding = '8px 16px';
    cancelBtn.style.background = 'transparent';
    cancelBtn.style.color = '#ccc';
    cancelBtn.style.border = '1px solid #555';
    cancelBtn.style.borderRadius = '6px';
    cancelBtn.style.cursor = 'pointer';
    cancelBtn.onclick = () => modal.remove();

    const saveBtn = document.createElement('button');
    saveBtn.textContent = t('sidebarSaveReload');
    saveBtn.style.padding = '8px 16px';
    saveBtn.style.background = '#e5e7eb';
    saveBtn.style.color = '#111827';
    saveBtn.style.border = 'none';
    saveBtn.style.borderRadius = '6px';
    saveBtn.style.cursor = 'pointer';
    saveBtn.style.fontWeight = 'bold';
    saveBtn.onclick = async () => {
        saveBtn.innerText = '⏳...';
        saveBtn.disabled = true;
        try {
            const payload = {};
            if (currentMode === 'physical') {
                payload.physical_folders_config = typesData;
            } else {
                payload.folder_types_config = typesData;
            }
            await fetch('/anomalous/save_config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            modal.remove();
            
            this.firstLoadDone = false;
            this.expandedFolders.clear();
            await this.loadFolders();
        } catch(e) {
            alert(t('sidebarSaveConfigError') + e);
            saveBtn.textContent = t('sidebarSaveReload');
            saveBtn.disabled = false;
        }
    };

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    content.appendChild(footer);
    modal.appendChild(content);
    document.body.appendChild(modal);
}

