// Workflow Share and Preview Modal for Anomalous_Model_Browser
import { app } from "../../scripts/app.js";

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
    showExportModal() {
        const lang = window.anomalous_browser_lang || 'en';
        
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
        title.textContent = lang === 'zh' ? '📦 导出工作流分享码' : '📦 Export Workflow Share Code';
        
        const typeSelectContainer = document.createElement('div');
        typeSelectContainer.innerHTML = `
            <label style="display: block; margin-bottom: 8px; cursor: pointer;">
                <input type="radio" name="amb-share-type" value="skeleton" checked />
                ${lang === 'zh' ? '精简版 (推荐 B站评论区, 体积小, 丢失坐标)' : 'Skeleton (Compact, best for comments, loses coords)'}
            </label>
            <label style="display: block; cursor: pointer;">
                <input type="radio" name="amb-share-type" value="full" />
                ${lang === 'zh' ? '完整版 (保留所有坐标与颜色, 较长)' : 'Full (Keeps coords and colors, longer string)'}
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
        generateBtn.textContent = lang === 'zh' ? '生成分享码' : 'Generate';
        generateBtn.style.cssText = `padding: 8px 16px; background: #4a90e2; color: #fff; border: none; border-radius: 6px; cursor: pointer;`;
        
        const copyBtn = document.createElement('button');
        copyBtn.textContent = lang === 'zh' ? '复制到剪贴板' : 'Copy';
        copyBtn.style.cssText = `padding: 8px 16px; background: #5cb85c; color: #fff; border: none; border-radius: 6px; cursor: pointer; display: none;`;
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = lang === 'zh' ? '关闭' : 'Close';
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
            alert(lang === 'zh' ? '复制成功！' : 'Copied successfully!');
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
        const lang = window.anomalous_browser_lang || 'en';
        
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
        title.textContent = lang === 'zh' ? '📥 导入工作流分享码' : '📥 Import Workflow Share Code';
        
        const inputArea = document.createElement('textarea');
        inputArea.placeholder = lang === 'zh' ? '粘贴 AMB0- 或 AMB1- 开头的分享码...' : 'Paste AMB0- or AMB1- share code here...';
        inputArea.style.cssText = `
            width: 100%; height: 100px; background: #1e1e1f; color: #eee;
            border: 1px solid #444; border-radius: 6px; padding: 10px;
            font-family: monospace; font-size: 12px; resize: none; box-sizing: border-box;
        `;
        
        const previewArea = document.createElement('div');
        previewArea.style.cssText = `
            min-height: 80px; max-height: 300px; overflow-y: auto;
            background: #1e1e1f; border-radius: 6px; padding: 10px; display: none;
            font-size: 14px; color: #ccc;
        `;
        
        const btnGroup = document.createElement('div');
        btnGroup.style.cssText = `display: flex; gap: 10px; justify-content: flex-end;`;
        
        const previewBtn = document.createElement('button');
        previewBtn.textContent = lang === 'zh' ? '预览分析' : 'Preview';
        previewBtn.style.cssText = `padding: 8px 16px; background: #4a90e2; color: #fff; border: none; border-radius: 6px; cursor: pointer;`;
        
        const loadBtn = document.createElement('button');
        loadBtn.textContent = lang === 'zh' ? '加载工作流' : 'Load Workflow';
        loadBtn.style.cssText = `padding: 8px 16px; background: #e07a5f; color: #fff; border: none; border-radius: 6px; cursor: pointer; display: none;`;
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = lang === 'zh' ? '取消' : 'Cancel';
        closeBtn.style.cssText = `padding: 8px 16px; background: #555; color: #fff; border: none; border-radius: 6px; cursor: pointer;`;
        
        closeBtn.onclick = () => overlay.remove();
        
        let pendingWorkflow = null;
        
        previewBtn.onclick = async () => {
            const code = inputArea.value.trim();
            if (!code) return;
            try {
                pendingWorkflow = await AMB_WorkflowShare.decodeShareCode(code);
                
                // Analyze
                const nodesCount = pendingWorkflow.nodes ? pendingWorkflow.nodes.length : 0;
                
                // Get required extensions / node types
                const requiredNodes = new Set();
                if (pendingWorkflow.nodes) {
                    pendingWorkflow.nodes.forEach(n => requiredNodes.add(n.type));
                }
                
                // Check if they exist in LiteGraph
                const missingNodes = [];
                requiredNodes.forEach(t => {
                    if (window.LiteGraph && !window.LiteGraph.registered_node_types[t]) {
                        missingNodes.push(t);
                    }
                });
                
                let html = `<strong>${lang === 'zh' ? '工作流概览' : 'Workflow Overview'}</strong><br>`;
                html += `${lang === 'zh' ? '总节点数' : 'Total Nodes'}: ${nodesCount}<br><br>`;
                
                if (missingNodes.length > 0) {
                    html += `<span style="color: #ff6b6b;">⚠️ ${lang === 'zh' ? '缺失以下节点 (导入后将显示红框)' : 'Missing Node Types (will be red on canvas)'}:</span><br>`;
                    html += `<ul style="margin-top:5px; color:#ff9f43; font-size:12px;">`;
                    missingNodes.forEach(m => {
                        html += `<li>${m}</li>`;
                    });
                    html += `</ul>`;
                } else {
                    html += `<span style="color: #5cb85c;">✅ ${lang === 'zh' ? '所有所需节点已在当前环境安装！' : 'All required nodes are installed!'}</span>`;
                }
                
                previewArea.innerHTML = html;
                previewArea.style.display = 'block';
                loadBtn.style.display = 'block';
                
            } catch (err) {
                previewArea.style.display = 'block';
                previewArea.innerHTML = `<span style="color:#ff6b6b;">${lang === 'zh' ? '解析失败' : 'Decode Failed'}: ${err.message}</span>`;
            }
        };
        
        loadBtn.onclick = () => {
            if (pendingWorkflow) {
                app.loadGraphData(pendingWorkflow);
                overlay.remove();
            }
        };
        
        btnGroup.appendChild(previewBtn);
        btnGroup.appendChild(loadBtn);
        btnGroup.appendChild(closeBtn);
        
        content.appendChild(title);
        content.appendChild(inputArea);
        content.appendChild(previewArea);
        content.appendChild(btnGroup);
        overlay.appendChild(content);
        
        document.body.appendChild(overlay);
    }
    showUnifiedModal() {
        const lang = window.anomalous_browser_lang || 'en';
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
        title.textContent = lang === 'zh' ? '🔄 工作流分享与导入' : '🔄 Workflow Share & Import';
        
        const exportBtn = document.createElement('button');
        exportBtn.textContent = lang === 'zh' ? '📤 导出当前工作流为分享码' : '📤 Export Workflow to Share Code';
        exportBtn.style.cssText = `padding: 12px; background: #4a90e2; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;`;
        exportBtn.onclick = () => { overlay.remove(); this.showExportModal(); };
        
        const importBtn = document.createElement('button');
        importBtn.textContent = lang === 'zh' ? '📥 从分享码导入工作流' : '📥 Import Workflow from Share Code';
        importBtn.style.cssText = `padding: 12px; background: #e07a5f; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;`;
        importBtn.onclick = () => { overlay.remove(); this.showImportModal(); };
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = lang === 'zh' ? '关闭' : 'Close';
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
