import { app } from "../../scripts/app.js";
import { createBrowserEntry } from "./modules/browser_entry.js";
import { createInterfaceSettings, getCurrentLanguage, setAbyssalScarletTheme, t } from "./modules/interface_settings.js";
import { isModelFilename } from "./modules/model_source_links.js";

export { setAbyssalScarletTheme };

const browserEntry = createBrowserEntry({ translate: t, getCurrentLanguage });

app.registerExtension({
    name: "Anomalous.ModelBrowser",
    settings: [...browserEntry.settings, ...createInterfaceSettings()],
    actionBarButtons: browserEntry.actionBarButtons,
    commands: browserEntry.commands,
    keybindings: browserEntry.keybindings,
    menuCommands: browserEntry.menuCommands,
    setup: browserEntry.setup
});

// --- INJECTED WORKFLOW SHARE MODULE ---
// Workflow Share and Preview Modal for Anomalous_Model_Browser

const AMB_WorkflowShare = {
    // ----------------------------------------------------------------------
    // 1. Data Compression & Base64 Utils
    // ----------------------------------------------------------------------
    strToU8(str) {
        return new TextEncoder().encode(str);
    },
    u8ToStr(u8) {
        return new TextDecoder().decode(u8);
    },
    u8ToBase64(u8) {
        let binary = '';
        const len = u8.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(u8[i]);
        }
        return window.btoa(binary);
    },
    base64ToU8(b64) {
        const binary = window.atob(b64);
        const len = binary.length;
        const u8 = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            u8[i] = binary.charCodeAt(i);
        }
        return u8;
    },
    async compress(str) {
        const stream = new Blob([this.strToU8(str)]).stream();
        const compressedStream = stream.pipeThrough(new CompressionStream('deflate-raw'));
        const response = new Response(compressedStream);
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        return new Uint8Array(buffer);
    },
    async decompress(u8) {
        const stream = new Blob([u8]).stream();
        const decompressedStream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
        const response = new Response(decompressedStream);
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        return this.u8ToStr(new Uint8Array(buffer));
    },

    // ----------------------------------------------------------------------
    // 2. Skeleton Generation (Strip visual / default data)
    // ----------------------------------------------------------------------
    skeletonize(workflowJson) {
        const wf = JSON.parse(JSON.stringify(workflowJson)); // deep copy
        
        // ComfyUI workflow JSON format has "nodes" array
        if (wf.nodes && Array.isArray(wf.nodes)) {
            wf.nodes.forEach(node => {
                // Delete layout coords and styles
                delete node.pos;
                delete node.size;
                delete node.color;
                delete node.bgcolor;
                delete node.shape;
                delete node.flags;
                // Delete empty properties
                if (node.properties && Object.keys(node.properties).length === 0) {
                    delete node.properties;
                }
            });
        }
        
        // Remove view metadata
        if (wf.extra) {
            delete wf.extra.ds; // scale/offset
        }
        
        return wf;
    },

    // ----------------------------------------------------------------------
    // 3. Auto-Layout Algorithm
    // ----------------------------------------------------------------------
    autoLayout(workflowJson) {
        if (!workflowJson.nodes || !Array.isArray(workflowJson.nodes)) return workflowJson;
        
        const nodes = workflowJson.nodes;
        
        // 1. Build adjacency list and in-degrees
        const adj = new Map();
        const inDegree = new Map();
        
        nodes.forEach(n => {
            adj.set(n.id, []);
            if (!inDegree.has(n.id)) inDegree.set(n.id, 0);
        });
        
        // Check links
        if (workflowJson.links) {
            workflowJson.links.forEach(link => {
                if (!link) return;
                const fromId = link[1];
                const toId = link[3];
                if (adj.has(fromId) && adj.has(toId)) {
                    adj.get(fromId).push(toId);
                    inDegree.set(toId, inDegree.get(toId) + 1);
                }
            });
        }
        
        // 2. Topological sort with depth levels
        const depthMap = new Map(); // id -> depth
        const queue = [];
        
        nodes.forEach(n => {
            if (inDegree.get(n.id) === 0) {
                queue.push(n.id);
                depthMap.set(n.id, 0);
            }
        });
        
        while (queue.length > 0) {
            const curr = queue.shift();
            const currDepth = depthMap.get(curr);
            
            const neighbors = adj.get(curr);
            if (neighbors) {
                neighbors.forEach(nxt => {
                    // Reduce in-degree
                    const ind = inDegree.get(nxt) - 1;
                    inDegree.set(nxt, ind);
                    
                    // Update depth to be max(existing depth, currDepth + 1)
                    const existingDepth = depthMap.get(nxt) || 0;
                    depthMap.set(nxt, Math.max(existingDepth, currDepth + 1));
                    
                    if (ind === 0) {
                        queue.push(nxt);
                    }
                });
            }
        }
        
        // Handle cycles (nodes not reached)
        nodes.forEach(n => {
            if (!depthMap.has(n.id)) {
                depthMap.set(n.id, 0);
            }
        });
        
        // 3. Assign X, Y coordinates
        const nodesByDepth = {};
        nodes.forEach(n => {
            const d = depthMap.get(n.id);
            if (!nodesByDepth[d]) nodesByDepth[d] = [];
            nodesByDepth[d].push(n);
        });
        
        // Spacing constants
        const X_SPACING = 400;
        const Y_SPACING = 300;
        
        Object.keys(nodesByDepth).forEach(d => {
            const levelNodes = nodesByDepth[d];
            const depth = parseInt(d);
            levelNodes.forEach((n, idx) => {
                // Approximate size
                n.pos = [
                    depth * X_SPACING,
                    idx * Y_SPACING
                ];
            });
        });
        
        return workflowJson;
    },

    // ----------------------------------------------------------------------
    // 4. Encode / Decode
    // ----------------------------------------------------------------------
    async encodeShareCode(workflowJson, isSkeleton) {
        let targetJson = workflowJson;
        if (isSkeleton) {
            targetJson = this.skeletonize(workflowJson);
        }
        
        const jsonStr = JSON.stringify(targetJson);
        const compressedU8 = await this.compress(jsonStr);
        const base64Str = this.u8ToBase64(compressedU8);
        
        const prefix = isSkeleton ? 'AMB1-' : 'AMB0-';
        return prefix + base64Str;
    },
    
    async decodeShareCode(shareCode) {
        if (!shareCode.startsWith('AMB0-') && !shareCode.startsWith('AMB1-')) {
            throw new Error('Invalid Share Code Format.');
        }
        
        const isSkeleton = shareCode.startsWith('AMB1-');
        const base64Str = shareCode.substring(5);
        
        const compressedU8 = this.base64ToU8(base64Str);
        const jsonStr = await this.decompress(compressedU8);
        
        let workflowJson = JSON.parse(jsonStr);
        
        if (isSkeleton) {
            workflowJson = this.autoLayout(workflowJson);
        }
        
        return workflowJson;
    },
    
    // ----------------------------------------------------------------------
    // 5. UI Modals
    // ----------------------------------------------------------------------
    showToast(message, color) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed; bottom: 30px; right: 30px; background: var(--amb-bg-card-hover); color: ${color || '#fff'};
            padding: 12px 20px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            font-family: Arial, sans-serif; font-size: 14px; z-index: 9999999;
            opacity: 0; transition: opacity 0.3s ease; border-left: 4px solid ${color || '#fff'};
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.style.opacity = '1', 10);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    /** A dimmed overlay with one dialog box; looks come from .anomalous-share-* in the styles. */
    createShareDialog(id, titleText, variant = '') {
        const overlay = document.createElement('div');
        if (id) overlay.id = id;
        overlay.className = 'anomalous-share-overlay';
        const content = document.createElement('div');
        content.className = `anomalous-share-dialog${variant ? ` ${variant}` : ''}`;
        const title = document.createElement('h2');
        title.className = 'anomalous-share-title';
        title.textContent = titleText;
        content.appendChild(title);
        overlay.appendChild(content);
        return { overlay, content };
    },

    shareButton(label, variant = '') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `anomalous-share-btn${variant ? ` ${variant}` : ''}`;
        button.textContent = label;
        return button;
    },

    /** What a workflow tells others about its models: how many carry a fingerprint, how many links. */
    provenanceSummary(workflow) {
        const models = new Set();
        for (const node of workflow.nodes || []) {
            for (const value of Array.isArray(node.widgets_values) ? node.widgets_values : []) {
                if (isModelFilename(value)) models.add(`${node.id}_${value}`);
            }
        }
        const hashes = workflow.extra?.anomalous_hashes || {};
        const hashed = [...models].filter(key => hashes[key]?.hash).length;
        return { models: models.size, hashed, links: Object.keys(workflow.extra?.anomalous_model_sources || {}).length };
    },

    provenanceNote(summary) {
        if (!summary.models) return '';
        if (localStorage.getItem('anomalous_inject_hash') === 'false') return t('mainShareProvenanceOff');
        const missing = summary.models - summary.hashed;
        return [t('mainShareFingerprints', { hashed: summary.hashed, total: summary.models }),
            missing ? t('mainShareNoFingerprint', { count: missing }) : ''].filter(Boolean).join(' ');
    },

    showExportModal() {
        const { overlay, content } = this.createShareDialog('amb-export-modal', t('mainExportTitle'));
        const summary = this.provenanceSummary(app.graph.serialize());
        const note = document.createElement('p');
        note.className = 'anomalous-share-note';
        note.textContent = this.provenanceNote(summary);
        note.hidden = !note.textContent;
        const linksLabel = document.createElement('label');
        linksLabel.className = 'anomalous-share-check';
        const linksBox = document.createElement('input');
        linksBox.type = 'checkbox';
        linksBox.checked = true;
        linksLabel.append(linksBox, ` ${t('mainShareLinks', { count: summary.links })}`);
        linksLabel.hidden = !summary.links;

        const typeSelectContainer = document.createElement('div');
        typeSelectContainer.className = 'anomalous-share-options';
        typeSelectContainer.innerHTML = `
            <label>
                <input type="radio" name="amb-share-type" value="skeleton" checked />
                ${t('mainSkeletonOption')}
            </label>
            <label>
                <input type="radio" name="amb-share-type" value="full" />
                ${t('mainFullOption')}
            </label>
        `;

        const textArea = document.createElement('textarea');
        textArea.className = 'anomalous-share-code';
        textArea.readOnly = true;

        const btnGroup = document.createElement('div');
        btnGroup.className = 'anomalous-share-actions';
        const generateBtn = this.shareButton(t('mainGenerate'), 'is-primary');
        const copyBtn = this.shareButton(t('mainCopyClipboard'));
        copyBtn.hidden = true;
        const closeBtn = this.shareButton(t('mainClose'), 'is-quiet');

        closeBtn.onclick = () => overlay.remove();

        generateBtn.onclick = async () => {
            const isSkeleton = document.querySelector('input[name="amb-share-type"]:checked').value === 'skeleton';

            // Get current workflow from app graph
            const p = await app.graphToPrompt();
            const workflowJson = p.workflow;
            if (!linksBox.checked) delete workflowJson.extra?.anomalous_model_sources;

            try {
                const code = await AMB_WorkflowShare.encodeShareCode(workflowJson, isSkeleton);
                textArea.value = code;
                copyBtn.hidden = false;
            } catch (err) {
                textArea.value = 'Error generating code: ' + err.message;
            }
        };

        copyBtn.onclick = () => {
            textArea.select();
            document.execCommand('copy');
            AMB_WorkflowShare.showToast(t('mainCopied'), '#5cb85c');
        };

        btnGroup.append(generateBtn, copyBtn, closeBtn);
        content.append(typeSelectContainer, note, linksLabel, textArea, btnGroup);
        document.body.appendChild(overlay);
    },

    showImportModal() {
        const { overlay, content } = this.createShareDialog('amb-import-modal', t('mainImportTitle'), 'is-wide');

        const inputArea = document.createElement('textarea');
        inputArea.className = 'anomalous-share-code is-input';
        inputArea.placeholder = t('mainSharePlaceholder');

        const btnGroup = document.createElement('div');
        btnGroup.className = 'anomalous-share-actions';
        const loadBtn = this.shareButton(t('mainImportLoad'), 'is-primary');
        const closeBtn = this.shareButton(t('mainCancel'), 'is-quiet');

        closeBtn.onclick = () => overlay.remove();

        loadBtn.onclick = async () => {
            const code = inputArea.value.trim();
            if (!code) {
                AMB_WorkflowShare.showToast(t('mainShareEmpty'), '#ff6b6b');
                return;
            }
            try {
                const pendingWorkflow = await AMB_WorkflowShare.decodeShareCode(code);
                app.loadGraphData(pendingWorkflow);
                overlay.remove();

                const nodesCount = pendingWorkflow.nodes ? pendingWorkflow.nodes.length : 0;
                AMB_WorkflowShare.showToast(t('mainImportedNodes', { count: nodesCount }), '#5cb85c');

                // Auto close the main browser panel
                const mainCloseBtn = document.getElementById('anomalous-close');
                if (mainCloseBtn) mainCloseBtn.click();
            } catch (err) {
                AMB_WorkflowShare.showToast(t('mainDecodeFailed') + err.message, '#ff6b6b');
            }
        };

        btnGroup.append(loadBtn, closeBtn);
        content.append(inputArea, btnGroup);
        document.body.appendChild(overlay);
    },
    showUnifiedModal() {
        const { overlay, content } = this.createShareDialog('', t('mainUnifiedTitle'), 'is-menu');

        const exportBtn = this.shareButton(t('mainExportWorkflow'), 'is-primary is-large');
        exportBtn.onclick = () => { overlay.remove(); this.showExportModal(); };

        const importBtn = this.shareButton(t('mainImportWorkflow'), 'is-large');
        importBtn.onclick = () => { overlay.remove(); this.showImportModal(); };

        const closeBtn = this.shareButton(t('mainClose'), 'is-quiet');
        closeBtn.onclick = () => overlay.remove();

        content.append(exportBtn, importBtn, closeBtn);
        document.body.appendChild(overlay);
    }
};

window.AMB_WorkflowShare = AMB_WorkflowShare;
