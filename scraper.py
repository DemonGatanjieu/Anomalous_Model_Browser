import os
import sys
try:
    sys.stdout.reconfigure(encoding="utf-8")
except:
    pass
try:
    sys.stderr.reconfigure(encoding="utf-8")
except:
    pass
import time
import json
import hashlib
import re
import urllib.request
import urllib.error
import urllib.parse
import argparse
import shutil
from typing import Dict, Optional


# Fixed tuples avoid rebuilding long extension lists for every scanned model.
# Exact-path checks are intentionally used instead of directory-wide globbing.
MEDIA_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".mp4", ".webm", ".mov", ".avi")
PREVIEW_SUFFIXES = tuple(f".preview{ext}" for ext in MEDIA_EXTENSIONS)
CIVITAI_BACKUP_SUFFIXES = tuple(f".civitai_bak{ext}" for ext in MEDIA_EXTENSIONS)
COVER_SUFFIXES = MEDIA_EXTENSIONS + PREVIEW_SUFFIXES
ACTIVE_COVER_SUFFIXES = PREVIEW_SUFFIXES + MEDIA_EXTENSIONS
SIDECAR_SUFFIXES = (
    ".info", ".civitai.info", ".json", ".txt", ".yaml",
    *MEDIA_EXTENSIONS,
    *PREVIEW_SUFFIXES,
    *CIVITAI_BACKUP_SUFFIXES,
)

# ==============================================================================
# CIVITAI API 配置读取
# 请在插件目录 (Anomalous_Model_Browser) 下新建 config.json 文件：
# { "CIVITAI_API_KEY": "你的KEY" }
# ==============================================================================
CIVITAI_API_KEY = None
plugin_dir = os.path.dirname(os.path.abspath(__file__))
config_paths = [os.path.join(plugin_dir, "api", "config.json"), os.path.join(plugin_dir, "config.json")]
for config_path in config_paths:
    if not os.path.exists(config_path):
        continue
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        configured_key = cfg.get("CIVITAI_API_KEY", "")
        if isinstance(configured_key, str) and configured_key.strip():
            CIVITAI_API_KEY = configured_key.strip()
            break
    except Exception as e:
        print(f"[-] 读取 config.json 失败: {e}")

if not CIVITAI_API_KEY:
    print("[!] 未配置 Civitai API Key。部分限制级模型或将无法获取图片。")

def calculate_sha256(file_path: str) -> str:
    """计算文件的 SHA256 哈希值 (用于 Civitai 匹配)"""
    sha256_hash = hashlib.sha256()
    print(f"[*] 正在计算 Hash (大文件可能需要几分钟): {os.path.basename(file_path)}")
    with open(file_path, "rb") as f:
        for byte_block in iter(lambda: f.read(4096 * 1024), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

import struct

def extract_safetensors_hash(file_path: str) -> Optional[str]:
    """尝试从 safetensors 头文件中以 O(1) 速度提取内置的 Hash，跳过全量计算"""
    try:
        with open(file_path, "rb") as f:
            header_size_bytes = f.read(8)
            if len(header_size_bytes) < 8:
                return None
            header_size = struct.unpack('<Q', header_size_bytes)[0]
            if header_size > 100 * 1024 * 1024:  # 异常大小保护 (头文件大于100MB)
                return None
            
            header_json_bytes = f.read(header_size)
            header_str = header_json_bytes.decode('utf-8')
            header_json = json.loads(header_str)
            
            metadata = header_json.get('__metadata__', {})
            if not metadata:
                return None
                
            # 优先级1: 标准 modelspec
            if 'modelspec.hash.sha256' in metadata:
                return metadata['modelspec.hash.sha256']
            if 'modelspec.hash.blake3' in metadata:
                return metadata['modelspec.hash.blake3']
                
    except Exception as e:
        pass
    return None

def infer_base_model_from_header(file_path: str) -> str:
    """从 safetensors 头文件的张量键名推断底层 Base Model (用于脱机/HuggingFace 兼容)"""
    try:
        with open(file_path, "rb") as f:
            header_size_bytes = f.read(8)
            if len(header_size_bytes) < 8: return 'Unknown'
            header_size = struct.unpack('<Q', header_size_bytes)[0]
            if header_size > 100 * 1024 * 1024: return 'Unknown'
            
            header_json = json.loads(f.read(header_size).decode('utf-8'))
            
            # 1. 尝试从 __metadata__ 提取
            metadata = header_json.get('__metadata__', {})
            arch = metadata.get('modelspec.architecture', '')
            if 'stable-diffusion-xl' in arch.lower(): return 'SDXL'
            if 'stable-diffusion-v1' in arch.lower() or 'runwayml/stable-diffusion-v1-5' in arch.lower(): return 'SD 1.5'
            if 'flux' in arch.lower(): return 'Flux.1 D'
            if 'sd3' in arch.lower(): return 'SD3'
            
            # 2. 暴力张量键名指纹匹配 (Tensor Fingerprinting)
            # 把前 500 个键拼接成字符串以提高检索效率，大部分核心键都在前面
            keys_str = " ".join(list(header_json.keys())[:500])
            
            # Flux 指纹
            if 'double_blocks.0.img_attn' in keys_str or 'img_in.weight' in keys_str: return 'Flux.1 D'
            # SD3 指纹
            if 'joint_blocks.0.x_block' in keys_str: return 'SD3'
            # SDXL 指纹 (包含两套 text encoder)
            if 'conditioner.embedders.1.model' in keys_str or 'label_emb.0.0.weight' in keys_str: return 'SDXL'
            # SD 1.5 指纹
            if 'cond_stage_model.transformer.text_model' in keys_str or 'model.diffusion_model.input_blocks.0.0.weight' in keys_str: return 'SD 1.5'
            
            return 'Unknown'
    except Exception as e:
        print(f"[-] 离线底模推断失败: {e}")
        return 'Unknown'

def sanitize_filename(name: str) -> str:
    """清理文件名中的非法字符"""
    name = re.sub(r'[\r\n\t]+', ' ', name)
    name = re.sub(r'[\\/*?:"<>|#]', "", name)
    return name.strip(' .')

def fetch_civitai_info(file_hash: str, max_retries: int = 3) -> Optional[Dict]:
    """向 Civitai API 获取模型信息，支持重试机制"""
    url = f"https://civitai.com/api/v1/model-versions/by-hash/{file_hash}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    if CIVITAI_API_KEY:
        headers["Authorization"] = f"Bearer {CIVITAI_API_KEY}"
    
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as response:
                return json.loads(response.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                print(f"\033[93m[Skip] 模型 Hash {file_hash} 未在 Civitai 找到 (404)，已跳过。\033[0m")
                return None
            print(f"[-] 请求异常，状态码: {e.code} (尝试 {attempt+1}/{max_retries})")
        except urllib.error.URLError as e:
            print(f"[-] 网络请求超时或异常: {e.reason} (尝试 {attempt+1}/{max_retries})")
        except Exception as e:
            print(f"[-] 未知异常: {e} (尝试 {attempt+1}/{max_retries})")
            
        if attempt < max_retries - 1:
            time.sleep(2)

    print(f"\033[93m[Skip] 模型 Hash {file_hash} 网络重试失败，已跳过该文件。\033[0m")
    return None

def download_media(url: str, base_path: str, max_retries: int = 3):
    """下载图片或视频并自动识别扩展名"""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    if CIVITAI_API_KEY:
        headers["Authorization"] = f"Bearer {CIVITAI_API_KEY}"
        
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as response:
                content_type = response.headers.get("Content-Type", "").lower()
                ext = ".png" # default
                if "video/mp4" in content_type: ext = ".mp4"
                elif "video/webm" in content_type: ext = ".webm"
                elif "image/jpeg" in content_type: ext = ".jpg"
                elif "image/webp" in content_type: ext = ".webp"
                elif url.endswith(".mp4"): ext = ".mp4"
                
                final_path = base_path + ext
                with open(final_path, 'wb') as f:
                    while True:
                        chunk = response.read(8192)
                        if not chunk:
                            break
                        f.write(chunk)
                return final_path
        except urllib.error.HTTPError as e:
            print(f"[-] 媒体下载失败，状态码: {e.code} (尝试 {attempt+1}/{max_retries})")
        except urllib.error.URLError as e:
            print(f"[-] 媒体下载网络异常: {e.reason} (尝试 {attempt+1}/{max_retries})")
        except Exception as e:
            pass
    return None

def main():
    parser = argparse.ArgumentParser(description="ComfyUI 模型 Civitai 嗅探与重命名工具")
    parser.add_argument("folder", help="要扫描的文件夹路径 (例如: models/checkpoints)")
    parser.add_argument("--dry-run", action="store_true", help="空跑模式，仅打印将要执行的操作，不修改任何文件")
    parser.add_argument("--undo", action="store_true", help="根据 backup_rename_log.json 恢复文件名")
    parser.add_argument("--skip-rename", action="store_true", help="只下载信息文件，不重命名主文件")
    parser.add_argument("--virtual-rename", action="store_true", help="虚拟重命名：修改 JSON 注入标准名称，不修改底层物理文件名")
    parser.add_argument("--physical-rename", action="store_true", help="物理重命名：真实修改底层的 safetensors 及其附属文件名")
    parser.add_argument("--skip-media", action="store_true", help="不下载预览图或视频")
    parser.add_argument("--offline-only", action="store_true", help="跳过 Civitai 联网获取，强制使用本地脱机张量推断提取 Base Model")
    parser.add_argument("--force-overwrite", action="store_true", help="强制覆盖已存在的信息文件")
    parser.add_argument("--skip-local-metadata", action="store_true", help="忽略本地已有的.info / .json文件")
    parser.add_argument("--target-files", type=str, default="", help="仅扫描逗号分隔的具体文件(相对路径)")
    args = parser.parse_args()

    target_folder = args.folder
    if not os.path.isdir(target_folder):
        print(f"[-] 错误: 文件夹不存在 -> {target_folder}")
        sys.exit(1)

    backup_log_path = os.path.join(target_folder, "backup_rename_log.json")

    # ==========================
    # 模式一：Undo 回滚模式
    # ==========================
    if args.undo:
        if not os.path.exists(backup_log_path):
            print("[-] 未找到备份日志 backup_rename_log.json，无法撤销。")
            sys.exit(1)
        
        with open(backup_log_path, 'r', encoding='utf-8') as f:
            log_data = json.load(f)
            
        print("[*] 开始回滚文件名...")
        for old_path, new_path in log_data.items():
            if os.path.exists(new_path):
                print(f"[*] 恢复主文件: {os.path.basename(new_path)} -> {os.path.basename(old_path)}")
                if not args.dry_run:
                    os.replace(new_path, old_path)
            else:
                print(f"[-] 找不到被重命名的文件: {new_path}")
                
            old_base = os.path.splitext(old_path)[0]
            new_base = os.path.splitext(new_path)[0]
            
            for ext in SIDECAR_SUFFIXES:
                new_ext_path = new_base + ext
                old_ext_path = old_base + ext
                if os.path.exists(new_ext_path):
                    print(f"[*] 恢复配套文件: {os.path.basename(new_ext_path)} -> {os.path.basename(old_ext_path)}")
                    if not args.dry_run:
                        os.replace(new_ext_path, old_ext_path)

        print("[+] 回滚完成！")
        sys.exit(0)

    # ==========================
    # 模式二：正常嗅探与重命名
    # ==========================
    rename_log = {}
    success_count = 0
    fail_count = 0
    if os.path.exists(backup_log_path):
        with open(backup_log_path, 'r', encoding='utf-8') as f:
            rename_log = json.load(f)

    target_files_basenames = []
    target_file_path = os.path.join(target_folder, '.scan_targets.json')
    if os.path.exists(target_file_path):
        try:
            with open(target_file_path, 'r', encoding='utf-8') as f:
                target_files_basenames = [os.path.basename(t.strip()) for t in __import__('json').load(f)]
            os.remove(target_file_path)
        except:
            pass
            
    if args.target_files:
        target_files_basenames.extend([os.path.basename(t.strip()) for t in args.target_files.split(',')])

    print(f"[*] 开始扫描文件夹: {target_folder}")
    if args.dry_run:
        print("==================================================")
        print("[警告]: 当前处于 Dry-Run (空跑) 模式，不会修改系统中的任何文件！")
        print("==================================================")

    for root, _, files in os.walk(target_folder):
        for filename in files:
            if not filename.endswith(".safetensors"):
                continue

            if target_files_basenames and filename not in target_files_basenames:
                continue

            file_path = os.path.join(root, filename)
            old_base = os.path.splitext(file_path)[0]
            
            info_exists = os.path.exists(old_base + ".info") or os.path.exists(old_base + ".civitai.info")
            if args.force_overwrite:
                info_exists = False
                
            preview_exists = args.skip_media
            if not preview_exists:
                for ext in COVER_SUFFIXES:
                    if os.path.exists(old_base + ext):
                        preview_exists = True
                        break
                    
            needs_rename = False
            if not args.skip_rename and args.physical_rename:
                needs_rename = True
            elif args.virtual_rename:
                needs_rename = True
                
            if info_exists and preview_exists and not needs_rename:
                print(f"[*] 已跳过 (信息满足要求): {filename}")
                continue
                
            print(f"\n---> 处理文件: {filename} (位于 {root})")
            
            civitai_data = None
            if info_exists and needs_rename:
                info_path = old_base + ".info"
                if not os.path.exists(info_path):
                    info_path = old_base + ".civitai.info"
                try:
                    with open(info_path, 'r', encoding='utf-8') as f:
                        civitai_data = json.load(f)
                    print(f"[*] 本地信息存在，直接进入重命名流程")
                except:
                    pass
            
            if not civitai_data:
                file_hash = None
                
                if not args.offline_only:
                    # Fallback 1: Try header hash on Civitai
                    header_hash = extract_safetensors_hash(file_path)
                    if header_hash:
                        print(f"[*] 成功从头文件提取 Hash: {header_hash}，尝试请求 Civitai...")
                        civitai_data = fetch_civitai_info(header_hash)
                        if civitai_data:
                            file_hash = header_hash
                            
                    # Fallback 2: If header hash fails (or doesn't exist), compute full SHA256
                    if not civitai_data:
                        print(f"[*] 头文件 Hash 未命中或不存在，计算全量物理 SHA256...")
                        full_hash = calculate_sha256(file_path)
                        civitai_data = fetch_civitai_info(full_hash)
                        file_hash = full_hash
                else:
                    print(f"[*] Offline-only: 跳过 Civitai 获取，将强制使用脱机张量推断")
                    file_hash = extract_safetensors_hash(file_path)
                    if not file_hash:
                        file_hash = calculate_sha256(file_path)
            
            # Fallback 3: Local Offline Inference (if Civitai still fails or offline_only)
            if not civitai_data:
                if args.skip_local_metadata:
                    print(f"[*] Civitai 获取失败，且禁用了本地元数据解析。跳过 {filename}")
                    fail_count += 1
                    continue
                # 尝试离线推断底模
                inferred_base = infer_base_model_from_header(file_path)
                if inferred_base == 'Unknown':
                    inferred_base = ""
                
                print(f"[*] 使用本地哈希重建基础元数据 ({filename})")
                civitai_data = {
                    "id": -1,
                    "modelId": -1,
                    "name": os.path.splitext(filename)[0],
                    "baseModel": inferred_base,
                    "description": "<p>Automatically inferred by Anomalous Local Engine.</p>",
                    "model": {
                        "name": os.path.splitext(filename)[0],
                        "type": "LORA" if "lora" in root.lower() else "Checkpoint"
                    },
                    "files": [{"hashes": {"SHA256": file_hash}}]
                }
                
            # --- 额外获取模型主页的说明文字 ---
            model_id = civitai_data.get("modelId")
            if model_id and model_id != -1:
                try:
                    headers = {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                    }
                    if CIVITAI_API_KEY:
                        headers["Authorization"] = f"Bearer {CIVITAI_API_KEY}"
                    req = urllib.request.Request(f"https://civitai.com/api/v1/models/{model_id}", headers=headers)
                    with urllib.request.urlopen(req, timeout=10) as m_resp:
                        m_data = json.loads(m_resp.read().decode('utf-8'))
                        if "description" in m_data and m_data["description"]:
                            civitai_data["description"] = m_data["description"]
                            if "model" not in civitai_data or not isinstance(civitai_data["model"], dict):
                                civitai_data["model"] = {}
                            civitai_data["model"]["description"] = m_data["description"]
                except Exception as e:
                    print(f"[-] 获取模型主页详细说明失败: {e}")
            # ----------------------------------
                
            model_name = sanitize_filename(civitai_data.get("model", {}).get("name", "UnknownModel"))
            version_name = sanitize_filename(civitai_data.get("name", "UnknownVersion"))
            
            new_filename = f"{model_name}_{version_name}.safetensors"
            new_file_path = os.path.join(root, new_filename)
            new_base = os.path.splitext(new_file_path)[0]
            
            # ==========================================
            # 兼容性大刀阔斧改革：直接保存全宇宙最原汁原味的格式
            # ==========================================
            info_data = civitai_data

            if args.virtual_rename:
                info_data["anomalous_custom_name"] = f"{model_name}_{version_name}"
            
            if not args.dry_run:
                info_path = old_base + ".info"
                with open(info_path, 'w', encoding='utf-8') as f:
                    json.dump(info_data, f, ensure_ascii=True, indent=4)
                print(f"[+] 写入纯净版 Civitai 描述 -> .info")
            else:
                print(f"[Dry-Run] 拟生成标准描述信息 -> .info")
                
            media_url = None
            images = civitai_data.get("images", [])
            if images and len(images) > 0:
                for img_obj in images:
                    if not args.skip_media:
                        if img_obj.get("url"):
                            media_url = img_obj.get("url")
                            break
            
            if media_url and not args.skip_media:
                if not args.dry_run:
                    print(f"[*] 正在下载预览媒体...")
                    saved_path = download_media(media_url, old_base + ".civitai_bak")
                    if saved_path:
                        print(f"[+] 媒体下载成功 -> {os.path.basename(saved_path)}")
                        # Promote to .preview if no custom cover exists
                        has_custom = False
                        if not args.force_overwrite:
                            for c_ext in ACTIVE_COVER_SUFFIXES:
                                p = old_base + c_ext
                                if os.path.exists(p) and not p.endswith('.civitai_bak' + c_ext):
                                    has_custom = True
                                    break
                        if not has_custom:
                            ext = os.path.splitext(saved_path)[1]
                            import shutil
                            if args.force_overwrite:
                                for c_ext in ACTIVE_COVER_SUFFIXES:
                                    p = old_base + c_ext
                                    if os.path.exists(p) and not p.endswith('.civitai_bak' + c_ext):
                                        try:
                                            os.remove(p)
                                            print(f"[*] 强制覆盖: 已删除旧预览文件 {os.path.basename(p)}")
                                        except:
                                            pass
                            preview_ext = ext if ext.startswith('.preview.') else f".preview{ext}"
                            shutil.copy2(saved_path, old_base + preview_ext)
                else:
                    print(f"[Dry-Run] 拟下载预览媒体...")
                        
            if args.skip_rename or not args.physical_rename:
                print(f"[*] 物理重命名已跳过。仅保存 .info 及其可能包含的虚拟重命名。")
                success_count += 1
            elif file_path != new_file_path and new_filename != filename:
                if os.path.exists(new_file_path):
                    print(f"[*] 目标文件名已存在，正在验证内容是否完全相同: {filename}")
                    try:
                        files_identical = os.path.getsize(file_path) == os.path.getsize(new_file_path)
                        if files_identical:
                            files_identical = calculate_sha256(file_path) == calculate_sha256(new_file_path)
                    except OSError:
                        files_identical = False

                    if not files_identical:
                        print(f"\033[91m[-] 目标名称冲突但文件内容不同，已保留两个模型并跳过重命名: {filename}\033[0m")
                        fail_count += 1
                    elif not args.dry_run:
                        try:
                            print(f"[*] Hash 一致，删除已确认的重复副本: {filename}")
                            os.remove(file_path)
                            for ext in SIDECAR_SUFFIXES:
                                old_ext = old_base + ext
                                if os.path.exists(old_ext):
                                    os.remove(old_ext)
                            success_count += 1
                        except Exception as e:
                            print(f"[-] 删除多余副本失败 (可能文件被占用): {e}")
                            fail_count += 1
                    else:
                        print(f"[Dry-Run] Hash 一致，拟删除重复副本及其附属文件: {filename}")
                else:
                    if not args.dry_run:
                        os.rename(file_path, new_file_path)
                        rename_log[file_path] = new_file_path
                        
                        for ext in SIDECAR_SUFFIXES:
                            old_ext = old_base + ext
                            new_ext = new_base + ext
                            if os.path.exists(old_ext):
                                os.replace(old_ext, new_ext)
                                
                        print(f"[+] 物理重命名完成: {filename}  ==>  {new_filename}")
                        success_count += 1
                    else:
                        print(f"[Dry-Run] 拟物理重命名文件: {filename}  ==>  {new_filename}")
                        print(f"[Dry-Run] 拟连带重命名附属文件 (.info / .png 等)")
            else:
                print("[*] 文件名已符合规范，无需重命名。")
                success_count += 1
                    
    
    # Save scan results
    if not args.dry_run:
        result_path = os.path.join(target_folder, ".scan_result.json")
        try:
            with open(result_path, 'w', encoding='utf-8') as f:
                json.dump({"success": success_count, "fail": fail_count}, f)
        except Exception as e:
            print(f"[-] 保存统计结果失败: {e}")
            
    if not args.dry_run and rename_log:
        with open(backup_log_path, 'w', encoding='utf-8') as f:
            json.dump(rename_log, f, ensure_ascii=True, indent=4)
        print(f"\n[+] 重命名映射日志已保存至: {backup_log_path}")

if __name__ == "__main__":
    main()
