import os, json

# 1. Update scraper.py
path = r'E:\ComfyUI_windows_portable\ComfyUI\custom_nodes\Anomalous_Model_Browser\scraper.py'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add counters
content = content.replace('rename_log = {}', 'rename_log = {}\n    success_count = 0\n    fail_count = 0')

# Fail count
content = content.replace('civitai_data = fetch_civitai_info(file_hash)\n            if not civitai_data:\n                continue', 'civitai_data = fetch_civitai_info(file_hash)\n            if not civitai_data:\n                fail_count += 1\n                continue')

# Success count - inject right before the end of the file loop
content = content.replace('else:\n                print("[*] 文件名已符合规范，无需重命名。")', 'else:\n                print("[*] 文件名已符合规范，无需重命名。")\n            success_count += 1')

# Write result
write_result = '''    
    # Save scan results
    if not args.dry_run:
        result_path = os.path.join(target_folder, ".scan_result.json")
        try:
            with open(result_path, 'w', encoding='utf-8') as f:
                json.dump({"success": success_count, "fail": fail_count}, f)
        except Exception as e:
            print(f"[-] 保存统计结果失败: {e}")
            
    if not args.dry_run and rename_log:'''
content = content.replace('    if not args.dry_run and rename_log:', write_result.strip('\n'))

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Updated scraper.py')

# 2. Update api.py
path_api = r'E:\ComfyUI_windows_portable\ComfyUI\custom_nodes\Anomalous_Model_Browser\api.py'
with open(path_api, 'r', encoding='utf-8') as f:
    content_api = f.read()

old_status = '''    marker_file = os.path.join(target_dir, '.scan_in_progress')
    return web.json_response({"scanning": os.path.exists(marker_file)})'''

new_status = '''    marker_file = os.path.join(target_dir, '.scan_in_progress')
    result_file = os.path.join(target_dir, '.scan_result.json')
    scanning = os.path.exists(marker_file)
    
    data = {"scanning": scanning}
    if not scanning and os.path.exists(result_file):
        try:
            with open(result_file, 'r', encoding='utf-8') as f:
                data["result"] = __import__('json').load(f)
            os.remove(result_file)
        except:
            pass
            
    return web.json_response(data)'''

content_api = content_api.replace(old_status, new_status)
with open(path_api, 'w', encoding='utf-8') as f:
    f.write(content_api)
print('Updated api.py')
