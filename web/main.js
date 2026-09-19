import { app } from "../../scripts/app.js";
import { createBrowserEntry } from "./modules/browser_entry.js";
import { createInterfaceSettings, getCurrentLanguage, setAbyssalScarletTheme, t } from "./modules/interface_settings.js";

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
            position: fixed; bottom: 30px; right: 30px; background: #2a2a2b; color: ${color || '#fff'};
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

    showExportModal() {
        const overlay = document.createElement('div');
        overlay.id = 'amb-export-modal';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.6); backdrop-filter: blur(5px);
            z-index: 999999; display: flex; justify-content: center; align-items: center;
            font-family: Arial, sans-serif;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: #2a2a2b; color: #fff; padding: 30px; border-radius: 12px;
            width: 500px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            display: flex; flex-direction: column; gap: 20px;
        `;
        
        const title = document.createElement('h2');
        title.style.margin = '0';
        title.textContent = t('mainExportTitle');
        
        const typeSelectContainer = document.createElement('div');
        typeSelectContainer.innerHTML = `
            <label style="display: block; margin-bottom: 8px; cursor: pointer;">
                <input type="radio" name="amb-share-type" value="skeleton" checked />
                ${t('mainSkeletonOption')}
            </label>
            <label style="display: block; cursor: pointer;">
                <input type="radio" name="amb-share-type" value="full" />
                ${t('mainFullOption')}
            </label>
        `;
        
        const textArea = document.createElement('textarea');
        textArea.style.cssText = `
            width: 100%; height: 150px; background: #1e1e1f; color: #eee;
            border: 1px solid #444; border-radius: 6px; padding: 10px;
            font-family: monospace; font-size: 12px; resize: none; box-sizing: border-box;
        `;
        textArea.readOnly = true;
        
        const btnGroup = document.createElement('div');
        btnGroup.style.cssText = `display: flex; gap: 10px; justify-content: flex-end;`;
        
        const generateBtn = document.createElement('button');
        generateBtn.textContent = t('mainGenerate');
        generateBtn.style.cssText = `padding: 8px 16px; background: #4a90e2; color: #fff; border: none; border-radius: 6px; cursor: pointer;`;
        
        const copyBtn = document.createElement('button');
        copyBtn.textContent = t('mainCopyClipboard');
        copyBtn.style.cssText = `padding: 8px 16px; background: #5cb85c; color: #fff; border: none; border-radius: 6px; cursor: pointer; display: none;`;
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = t('mainClose');
        closeBtn.style.cssText = `padding: 8px 16px; background: #555; color: #fff; border: none; border-radius: 6px; cursor: pointer;`;
        
        closeBtn.onclick = () => overlay.remove();
        
        generateBtn.onclick = async () => {
            const isSkeleton = document.querySelector('input[name="amb-share-type"]:checked').value === 'skeleton';
            
            // Get current workflow from app graph
            const p = await app.graphToPrompt();
            const workflowJson = p.workflow;
            
            try {
                const code = await AMB_WorkflowShare.encodeShareCode(workflowJson, isSkeleton);
                textArea.value = code;
                copyBtn.style.display = 'block';
            } catch (err) {
                textArea.value = 'Error generating code: ' + err.message;
            }
        };
        
        copyBtn.onclick = () => {
            textArea.select();
            document.execCommand('copy');
            AMB_WorkflowShare.showToast(t('mainCopied'), '#5cb85c');
        };
        
        btnGroup.appendChild(generateBtn);
        btnGroup.appendChild(copyBtn);
        btnGroup.appendChild(closeBtn);
        
        content.appendChild(title);
        content.appendChild(typeSelectContainer);
        content.appendChild(textArea);
        content.appendChild(btnGroup);
        overlay.appendChild(content);
        
        document.body.appendChild(overlay);
    },
    
    showImportModal() {
        const overlay = document.createElement('div');
        overlay.id = 'amb-import-modal';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.6); backdrop-filter: blur(5px);
            z-index: 999999; display: flex; justify-content: center; align-items: center;
            font-family: Arial, sans-serif;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: #2a2a2b; color: #fff; padding: 30px; border-radius: 12px;
            width: 600px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            display: flex; flex-direction: column; gap: 20px;
        `;
        
        const title = document.createElement('h2');
        title.style.margin = '0';
        title.textContent = t('mainImportTitle');
        
        const inputArea = document.createElement('textarea');
        inputArea.placeholder = t('mainSharePlaceholder');
        inputArea.style.cssText = `
            width: 100%; height: 100px; background: #1e1e1f; color: #eee;
            border: 1px solid #444; border-radius: 6px; padding: 10px;
            font-family: monospace; font-size: 12px; resize: none; box-sizing: border-box;
        `;
        
        const btnGroup = document.createElement('div');
        btnGroup.style.cssText = `display: flex; gap: 10px; justify-content: flex-end;`;
        
        const loadBtn = document.createElement('button');
        loadBtn.textContent = t('mainImportLoad');
        loadBtn.style.cssText = `padding: 8px 16px; background: #e07a5f; color: #fff; border: none; border-radius: 6px; cursor: pointer;`;
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = t('mainCancel');
        closeBtn.style.cssText = `padding: 8px 16px; background: #555; color: #fff; border: none; border-radius: 6px; cursor: pointer;`;
        
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
        
        btnGroup.appendChild(loadBtn);
        btnGroup.appendChild(closeBtn);
        
        content.appendChild(title);
        content.appendChild(inputArea);
        content.appendChild(btnGroup);
        overlay.appendChild(content);
        
        document.body.appendChild(overlay);
    },
    showUnifiedModal() {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.6); backdrop-filter: blur(5px);
            z-index: 999999; display: flex; justify-content: center; align-items: center;
            font-family: Arial, sans-serif;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: #2a2a2b; color: #fff; padding: 30px; border-radius: 12px;
            width: 400px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            display: flex; flex-direction: column; gap: 20px; text-align: center;
        `;
        
        const title = document.createElement('h2');
        title.style.margin = '0';
        title.textContent = t('mainUnifiedTitle');
        
        const exportBtn = document.createElement('button');
        exportBtn.textContent = t('mainExportWorkflow');
        exportBtn.style.cssText = `padding: 12px; background: #4a90e2; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;`;
        exportBtn.onclick = () => { overlay.remove(); this.showExportModal(); };
        
        const importBtn = document.createElement('button');
        importBtn.textContent = t('mainImportWorkflow');
        importBtn.style.cssText = `padding: 12px; background: #e07a5f; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;`;
        importBtn.onclick = () => { overlay.remove(); this.showImportModal(); };
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = t('mainClose');
        closeBtn.style.cssText = `padding: 8px; background: #555; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; margin-top: 10px;`;
        closeBtn.onclick = () => overlay.remove();
        
        content.appendChild(title);
        content.appendChild(exportBtn);
        content.appendChild(importBtn);
        content.appendChild(closeBtn);
        overlay.appendChild(content);
        
        document.body.appendChild(overlay);
    }
};

window.AMB_WorkflowShare = AMB_WorkflowShare;
