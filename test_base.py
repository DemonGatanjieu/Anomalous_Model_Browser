import sys, json, struct
def identify_base_model(file_path):
    try:
        with open(file_path, 'rb') as f:
            header_size_bytes = f.read(8)
            if len(header_size_bytes) < 8: return 'Unknown'
            header_size = struct.unpack('<Q', header_size_bytes)[0]
            if header_size > 100 * 1024 * 1024: return 'Unknown'
            header_json = json.loads(f.read(header_size).decode('utf-8'))
            
            metadata = header_json.get('__metadata__', {})
            arch = metadata.get('modelspec.architecture', '')
            if 'stable-diffusion-xl' in arch.lower(): return 'SDXL'
            if 'stable-diffusion-v1' in arch.lower(): return 'SD 1.5'
            
            keys = " ".join(header_json.keys())
            if 'double_blocks.0.img_attn' in keys or 'img_in.weight' in keys: return 'Flux.1 D'
            if 'joint_blocks.0.x_block' in keys: return 'SD3'
            if 'conditioner.embedders.1.model' in keys or 'label_emb.0.0.weight' in keys: return 'SDXL'
            if 'cond_stage_model.transformer.text_model' in keys or 'model.diffusion_model.input_blocks.0.0.weight' in keys: return 'SD 1.5'
            return 'Unknown'
    except:
        return 'Error'
