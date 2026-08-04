import { app } from "../../../scripts/app.js";
import { i18n } from './locales.js';
import { escapeHtml } from './safe_dom.js';

const t = (key) => {
    let lang = window.anomalous_browser_lang || 'zh';
    if (lang.startsWith('en')) lang = 'en';
    return (i18n[lang] && i18n[lang][key]) ? i18n[lang][key] : (i18n['zh'][key] || key);
};

export function showParameters() {
    if (this.paramInitialized) {
        if (this.nbPanel) this.nbPanel.style.display = 'none';
        this.paramPanel.style.display = 'flex';
        this.refreshParameters(true);
        return;
    }
    this.paramInitialized = true;

    this.paramPanel = document.createElement('div');
    this.paramPanel.className = 'anomalous-nb-modal';
    this.paramPanel.style.display = 'flex';
    this.paramPanel.onclick = (e) => {
        if (e.target === this.paramPanel) {
            this.paramPanel.style.display = 'none';
            this.closeWorkspace();
        }
    };
    this.modal.querySelector('.anomalous-container').appendChild(this.paramPanel);

    const container = document.createElement('div');
    container.className = 'anomalous-nb-container';

    const header = document.createElement('div');
    header.className = 'anomalous-nb-header';
    const headerMain = document.createElement('div');
    headerMain.className = 'anomalous-nb-header-main';
    const heading = document.createElement('h2');
    heading.textContent = t('parameterNotebookTitle') || 'Parameter Notebooks';
    headerMain.appendChild(heading);
    header.appendChild(headerMain);
    const closeBtn = document.createElement('span');
    closeBtn.className = 'anomalous-nb-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = () => {
        this.paramPanel.style.display = 'none';
        this.closeWorkspace();
    };
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'anomalous-nb-body';

    const sidebar = document.createElement('div');
    sidebar.className = 'anomalous-nb-sidebar';

    this.paramListEl = document.createElement('div');
    this.paramListEl.className = 'anomalous-nb-list';

    sidebar.appendChild(this.paramListEl);

    this.paramEditor = document.createElement('div');
    this.paramEditor.className = 'anomalous-nb-editor';

    body.appendChild(sidebar);
    body.appendChild(this.paramEditor);

    container.appendChild(header);
    container.appendChild(body);
    this.paramPanel.appendChild(container);

    this.refreshParameters(true);
}

export async function refreshParameters(autoOpenFirst = false) {
    try {
        const res = await fetch('/anomalous/parameters');
        const data = await res.json();
        this.paramListEl.innerHTML = '';

        if (data.notebooks && data.notebooks.length > 0) {
            if (autoOpenFirst && !this.currentParameter) {
                this.currentParameter = data.notebooks[0];
            }
            if (this.currentParameter) {
                this.renderParameterEditor();
            }

            data.notebooks.forEach(nb => {
                const item = document.createElement('div');
                item.className = 'anomalous-nb-item';
                if (this.currentParameter && this.currentParameter.filename === nb.filename) {
                    item.classList.add('active');
                }
                item.innerHTML = `<span class="anomalous-nb-item-icon">📄&nbsp;</span><span class="anomalous-nb-item-text">${escapeHtml(nb.name)}</span>`;
                item.onclick = () => {
                    this.currentParameter = nb;
                    this.renderParameterEditor();
                    this.refreshParameters();
                };
                this.paramListEl.appendChild(item);
            });
        }
    } catch (e) { console.error('Failed to refresh parameters:', e); }
}

export async function deleteCurrentParameter() {
    if (!this.currentParameter) return;
    if (!confirm(t('deleteNotebook') + ' ?')) return;
    try {
        await fetch('/anomalous/delete_parameter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: this.currentParameter.filename })
        });
        this.currentParameter = null;
        this.paramEditor.innerHTML = '';
        this.refreshParameters();
    } catch (e) { }
}

function displayValue(value) {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'object') {
        try { return JSON.stringify(value); } catch (e) { return String(value); }
    }
    return String(value);
}

export function renderParameterEditor() {
    this.paramEditor.innerHTML = '';
    if (!this.currentParameter) return;

    const data = this.currentParameter.data || {};

    const tb = document.createElement('div');
    tb.className = 'anomalous-nb-toolbar';

    const titleArea = document.createElement('h3');
    titleArea.textContent = this.currentParameter.name;
    titleArea.style.margin = '0';

    const rightBtns = document.createElement('div');

    const delBtn = document.createElement('button');
    delBtn.innerHTML = t('deleteNotebook');
    delBtn.className = 'anomalous-btn-danger';
    delBtn.onclick = () => this.deleteCurrentParameter();

    rightBtns.appendChild(delBtn);

    tb.appendChild(titleArea);
    tb.appendChild(rightBtns);

    this.paramEditor.appendChild(tb);

    const content = document.createElement('div');
    content.className = 'anomalous-recipe-detail-content';
    content.style.padding = '20px';
    content.style.overflowY = 'auto';
    content.style.flex = '1';

    const gallerySection = document.createElement('div');
    gallerySection.className = 'anomalous-recipe-detail-gallery';
    gallerySection.style.marginBottom = '20px';
    gallerySection.style.display = 'grid';
    gallerySection.style.gridTemplateColumns = 'repeat(auto-fill, minmax(120px, 1fr))';
    gallerySection.style.gap = '10px';
    content.appendChild(gallerySection);

    const loadGallery = async () => {
        try {
            const res = await fetch(`/anomalous/parameter_gallery?filename=${encodeURIComponent(this.currentParameter.filename)}`);
            const payload = await res.json();
            if (payload.status === 'success' && payload.images && payload.images.length > 0) {
                for (const img of payload.images) {
                    const imgEl = document.createElement('img');
                    const params = new URLSearchParams({ filename: img.filename, type: 'output' });
                    if (img.subfolder) params.set('subfolder', img.subfolder);
                    imgEl.src = `/view?${params.toString()}`;
                    imgEl.style.width = '100%';
                    imgEl.style.aspectRatio = '1 / 1';
                    imgEl.style.objectFit = 'cover';
                    imgEl.style.borderRadius = '4px';
                    gallerySection.appendChild(imgEl);
                }
            } else {
                gallerySection.style.display = 'none';
            }
        } catch (e) {
            console.error('Failed to load parameter gallery', e);
            gallerySection.style.display = 'none';
        }
    };
    loadGallery();

    const renderParams = () => {
        const nodes = data.params?.nodes || [];
        if (!nodes.length) {
            const empty = document.createElement('p');
            empty.textContent = t('recipeDetailNoParameters') || 'No parameters saved.';
            empty.className = 'anomalous-recipe-detail-muted';
            content.appendChild(empty);
            return;
        }

        for (const node of nodes) {
            const widgets = node.widgets || [];
            if (!widgets.length) continue;

            const block = document.createElement('article');
            block.className = 'anomalous-recipe-detail-parameter-node';
            block.style.marginBottom = '15px';
            block.style.padding = '10px';
            block.style.background = 'rgba(0,0,0,0.2)';
            block.style.borderRadius = '8px';

            const title = document.createElement('strong');
            title.textContent = node.title || node.type || 'Unknown Node';
            title.style.display = 'block';
            title.style.marginBottom = '8px';
            block.appendChild(title);

            for (const widget of widgets) {
                const row = document.createElement('div');
                row.className = 'anomalous-recipe-detail-parameter-widget';
                row.style.display = 'flex';
                row.style.justifyContent = 'space-between';
                row.style.marginBottom = '4px';
                
                const nameSpan = document.createElement('span');
                nameSpan.className = 'anomalous-recipe-detail-parameter-name';
                nameSpan.textContent = widget.name;
                nameSpan.style.color = 'rgba(255,255,255,0.7)';
                
                const valSpan = document.createElement('span');
                valSpan.textContent = displayValue(widget.value);
                
                row.appendChild(nameSpan);
                row.appendChild(valSpan);
                block.appendChild(row);
            }
            content.appendChild(block);
        }
    };
    renderParams();

    this.paramEditor.appendChild(content);
}
