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
import requests
import argparse
import shutil
from typing import Dict, Optional

# ==============================================================================
# CIVITAI API 配置读取
# 请在插件目录 (Anomalous_Model_Browser) 下新建 config.json 文件：
# { "CIVITAI_API_KEY": "你的KEY" }
# ==============================================================================
CIVITAI_API_KEY = None
config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
if os.path.exists(config_path):
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
            CIVITAI_API_KEY = cfg.get("CIVITAI_API_KEY", "").strip()
    except Exception as e:
        print(f"[-] 读取 config.json 失败: {e}")
else:
    print("[!] 未找到 config.json，本次请求将不使用 API Key。部分限制级模型或将无法获取图片。")

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
                
            # 优先级2: 其他带 hash 的键
            for k, v in metadata.items():
                if ('hash' in k.lower() or 'civitai' in k.lower()) and isinstance(v, str):
                    if len(v) == 64 and all(c in '0123456789abcdefABCDEF' for c in v):
                        return v
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
            response = requests.get(url, headers=headers, timeout=15)
            if response.status_code == 200:
                return response.json()
            elif response.status_code == 404:
                print(f"\033[93m[Skip] 模型 Hash {file_hash} 未在 Civitai 找到 (404)，已跳过。\033[0m")
                return None
            else:
                print(f"[-] 请求异常，状态码: {response.status_code} (尝试 {attempt+1}/{max_retries})")
        except requests.exceptions.RequestException as e:
            print(f"[-] 网络请求超时或异常: {e} (尝试 {attempt+1}/{max_retries})")
            
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
            response = requests.get(url, stream=True, headers=headers, timeout=15)
            if response.status_code == 200:
                content_type = response.headers.get("Content-Type", "").lower()
                ext = ".png" # default
                if "video/mp4" in content_type: ext = ".mp4"
                elif "video/webm" in content_type: ext = ".webm"
                elif "image/jpeg" in content_type: ext = ".jpg"
                elif "image/webp" in content_type: ext = ".webp"
                elif url.endswith(".mp4"): ext = ".mp4"
                
                final_path = base_path + ext
                with open(final_path, 'wb') as f:
                    for chunk in response.iter_content(8192):
                        f.write(chunk)
                return final_path
            else:
                print(f"[-] 媒体下载失败，状态码: {response.status_code} (尝试 {attempt+1}/{max_retries})")
        except requests.exceptions.RequestException as e:
            print(f"[-] 媒体下载网络异常: {e} (尝试 {attempt+1}/{max_retries})")
    return None

def main():
    parser = argparse.ArgumentParser(description="ComfyUI 模型 Civitai 嗅探与重命名工具")
    parser.add_argument("folder", help="要扫描的文件夹路径 (例如: models/checkpoints)")
    parser.add_argument("--dry-run", action="store_true", help="空跑模式，仅打印将要执行的操作，不修改任何文件")
    parser.add_argument("--undo", action="store_true", help="根据 backup_rename_log.json 恢复文件名")
    parser.add_argument("--skip-rename", action="store_true", help="只下载信息文件，不重命名主文件")
    parser.add_argument("--skip-media", action="store_true", help="不下载预览图或视频")
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
            
            for ext in [".info", ".civitai.info", ".png", ".jpg", ".webp", ".mp4", ".webm", ".json", ".txt", ".yaml"]:
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

    print(f"[*] 开始扫描文件夹: {target_folder}")
    if args.dry_run:
        print("==================================================")
        print("[警告]: 当前处于 Dry-Run (空跑) 模式，不会修改系统中的任何文件！")
        print("==================================================")

    for root, _, files in os.walk(target_folder):
        for filename in files:
            if not filename.endswith(".safetensors"):
                continue

            file_path = os.path.join(root, filename)
            old_base = os.path.splitext(file_path)[0]
            
            info_exists = os.path.exists(old_base + ".info") or os.path.exists(old_base + ".civitai.info")
            preview_exists = args.skip_media
            if not preview_exists:
                for ext in [".png", ".preview.png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm"]:
                    if os.path.exists(old_base + ext):
                        preview_exists = True
                        break
                    
            if info_exists and preview_exists:
                print(f"[*] 已跳过 (信息满足要求): {filename}")
                continue
                
            print(f"\n---> 处理文件: {filename} (位于 {root})")
            file_hash = extract_safetensors_hash(file_path)
            if file_hash:
                print(f"[*] 成功从头文件极速提取 Hash: {file_hash}")
            else:
                file_hash = calculate_sha256(file_path)
                print(f"[*] 全量物理 SHA256: {file_hash}")
            
            civitai_data = fetch_civitai_info(file_hash)
            if not civitai_data:
                # 尝试离线推断底模
                inferred_base = infer_base_model_from_header(file_path)
                if inferred_base != 'Unknown':
                    print(f"[*] 离线推断底模成功 ({filename}): {inferred_base}")
                    civitai_data = {
                        "id": -1,
                        "modelId": -1,
                        "name": os.path.splitext(filename)[0],
                        "baseModel": inferred_base,
                        "description": "<p>Automatically inferred by Anomalous Local Engine.</p>",
                        "model": {
                            "name": os.path.splitext(filename)[0],
                            "type": "LORA" if "lora" in root.lower() else "Checkpoint"
                        }
                    }
                else:
                    fail_count += 1
                    continue
                
            # --- 额外获取模型主页的说明文字 ---
            model_id = civitai_data.get("modelId")
            if model_id and model_id != -1:
                try:
                    headers = {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                    }
                    if CIVITAI_API_KEY:
                        headers["Authorization"] = f"Bearer {CIVITAI_API_KEY}"
                    m_resp = requests.get(f"https://civitai.com/api/v1/models/{model_id}", headers=headers, timeout=10)
                    if m_resp.status_code == 200:
                        m_data = m_resp.json()
                        main_desc = m_data.get("description")
                        if main_desc:
                            if "model" not in civitai_data or not isinstance(civitai_data["model"], dict):
                                civitai_data["model"] = {}
                            civitai_data["model"]["description"] = main_desc
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

            if not args.dry_run:
                info_path = old_base + ".info"
                with open(info_path, 'w', encoding='utf-8') as f:
                    json.dump(info_data, f, ensure_ascii=True, indent=4)
                print(f"[+] 写入纯净版 Civitai 描述 -> .info")
            else:
                print(f"[Dry-Run] 拟生成标准描述信息 -> .info")
                
            images = civitai_data.get("images", [])
            if images and len(images) > 0:
                media_url = None
                for img_obj in images:
                    if not args.skip_media:
                        if img_obj.get("url"):
                            media_url = img_obj.get("url")
                            break
            
            if media_url and not args.skip_media:
                if not args.dry_run:
                    print(f"[*] 正在下载预览媒体...")
                    saved_path = download_media(media_url, old_base)
                    if saved_path:
                        print(f"[+] 媒体下载成功 -> {os.path.basename(saved_path)}")
                else:
                    print(f"[Dry-Run] 拟下载预览媒体...")
                        
            if args.skip_rename:
                print(f"[*] --skip-rename 开启，跳过主文件重命名。仅保存 .info。")
                success_count += 1
            elif file_path != new_file_path and new_filename != filename:
                if os.path.exists(new_file_path):
                    print(f"\033[91m[-] 目标版本已存在 (重复模型)，执行永久删除多余副本: {filename}\033[0m")
                    if not args.dry_run:
                        try:
                            os.remove(file_path)
                            for ext in [".info", ".civitai.info", ".png", ".jpg", ".webp", ".mp4", ".webm", ".json", ".txt", ".yaml"]:
                                old_ext = old_base + ext
                                if os.path.exists(old_ext):
                                    os.remove(old_ext)
                        except Exception as e:
                            print(f"[-] 删除多余副本失败 (可能文件被占用): {e}")
                    else:
                        print(f"[Dry-Run] 拟永久删除多余副本及其附属文件: {filename}")
                else:
                    if not args.dry_run:
                        os.rename(file_path, new_file_path)
                        rename_log[file_path] = new_file_path
                        
                        for ext in [".info", ".civitai.info", ".png", ".jpg", ".webp", ".mp4", ".webm", ".json", ".txt", ".yaml"]:
                            old_ext = old_base + ext
                            new_ext = new_base + ext
                            if os.path.exists(old_ext):
                                os.replace(old_ext, new_ext) # Safety: replace overwrites existing files on Windows
                                
                        print(f"[+] 重命名完成: {filename}  ==>  {new_filename}")
                    else:
                        print(f"[Dry-Run] 拟重命名文件: {filename}  ==>  {new_filename}")
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