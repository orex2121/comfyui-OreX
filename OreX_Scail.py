import math
import torch
import comfy.model_management
import comfy.utils
import comfy.samplers

def _plan_chunks(n_frames, chunk_len, overlap):
    n_eff = ((n_frames - 1) // 4) * 4 + 1
    if n_eff <= chunk_len:
        return n_eff, [n_eff]
    step = chunk_len - overlap
    k = math.ceil((n_eff - chunk_len) / step)
    final_len = n_eff - step * k
    return n_eff, [chunk_len] * k + [final_len]

class OreX_Scail:
    CATEGORY = "OreX/SCAIL"
    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("images", "frames_numb", "iteration_numb")
    FUNCTION = "generate"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "positive": ("CONDITIONING",),
                "negative": ("CONDITIONING",),
                "vae": ("VAE",),
                "pose_video": ("IMAGE",),
                "width": ("INT", {"default": 512, "min": 32, "max": 8192, "step": 32}),
                "height": ("INT", {"default": 896, "min": 32, "max": 8192, "step": 32}),
                "noise_seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff, "control_after_generate": True}),
                "steps": ("INT", {"default": 6, "min": 1, "max": 10000}),
                "cfg": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 100.0, "step": 0.1}),
                "sampler_name": (comfy.samplers.KSampler.SAMPLERS, ),
                "scheduler": (comfy.samplers.KSampler.SCHEDULERS, ),
                "denoise": ("FLOAT", {"default": 1.00, "min": 0.0, "max": 1.0, "step": 0.01}),
                "chunk_length": ("INT", {"default": 81, "min": 9, "max": 1024, "step": 4}),
                "overlap": ("INT", {"default": 5, "min": 1, "max": 81, "step": 4}),
            },
            "optional": {
                "pose_video_mask": ("IMAGE",),
                "reference_image": ("IMAGE",),
                "reference_image_mask": ("IMAGE",),
                "clip_vision_output": ("CLIP_VISION_OUTPUT",),
                "pose_strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 10.0, "step": 0.01}),
                "pose_start": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "pose_end": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "replacement_mode": ("BOOLEAN", {"default": True}),
            },
        }

    def generate(self, model, positive, negative, vae, pose_video,
                 width, height, noise_seed, steps, cfg, sampler_name, scheduler, denoise,
                 chunk_length, overlap, pose_video_mask=None, reference_image=None,
                 reference_image_mask=None, clip_vision_output=None,
                 pose_strength=1.0, pose_start=0.0, pose_end=1.0, replacement_mode=True):
        
        color_transfer = True
        add_noise = True
        seed_mode = "increment"

        from comfy_extras.nodes_scail import WanSCAILToVideo
        from comfy_extras.nodes_custom_sampler import SamplerCustom, KSamplerSelect, BasicScheduler
        from comfy_extras.nodes_post_processing import ColorTransfer

        sampler = KSamplerSelect().get_sampler(sampler_name)[0]
        sigmas = BasicScheduler().get_sigmas(model, scheduler, steps, denoise)[0]

        chunk_length = ((chunk_length - 1) // 4) * 4 + 1
        if overlap % 4 != 1:
            overlap = max(1, ((overlap - 1) // 4) * 4 + 1)
        if chunk_length - overlap < 4:
            raise ValueError(f"chunk_length ({chunk_length}) must exceed overlap ({overlap}) by at least 4.")

        if width % 32 != 0 or height % 32 != 0:
            print(f"[OreX_Scail] Warning: Resolution {width}x{height} is not a multiple of 32. This may cause edge artifacts.")

        n_input = pose_video.shape[0]
        n_eff, lengths = _plan_chunks(n_input, chunk_length, overlap)
        
        print(f"[OreX_Scail] Frames: {n_input} -> {n_eff} | Chunks: {len(lengths)} {lengths}")

        pbar = comfy.utils.ProgressBar(len(lengths))
        chunks = []          
        prev_frames = None   
        offset = 0

        for i, length in enumerate(lengths):
            comfy.model_management.throw_exception_if_processing_interrupted()
            seed = noise_seed + i if seed_mode == "increment" else noise_seed

            cond = WanSCAILToVideo.execute(
                positive=positive, negative=negative, vae=vae,
                width=width, height=height, length=length, batch_size=1,
                pose_strength=pose_strength, pose_start=pose_start, pose_end=pose_end,
                video_frame_offset=offset, previous_frame_count=overlap,
                replacement_mode=replacement_mode,
                reference_image=reference_image,
                clip_vision_output=clip_vision_output,
                pose_video=pose_video, pose_video_mask=pose_video_mask,
                reference_image_mask=reference_image_mask,
                previous_frames=prev_frames,
            )
            pos_c, neg_c, latent, offset = cond.args

            sampled = SamplerCustom.execute(
                model=model, add_noise=add_noise, noise_seed=seed, cfg=cfg,
                positive=pos_c, negative=neg_c, sampler=sampler, sigmas=sigmas,
                latent_image=latent,
            )
            denoised = sampled.args[1] 

            images = vae.decode(denoised["samples"])
            if images.ndim == 5:
                images = images.reshape(-1, *images.shape[-3:])

            if i == 0:
                contrib = images
            else:
                contrib = images[overlap:]
                if color_transfer and prev_frames is not None:
                    contrib = ColorTransfer.execute(
                        image_target=contrib,
                        image_ref=prev_frames[-1:],
                        method="reinhard_lab",
                        source_stats={"source_stats": "per_frame"},
                        strength=1.0,
                    ).args[0]

            # [ОПТИМИЗАЦИЯ 1]: Выгружаем готовый тензор в RAM (отвязываем от VRAM)
            cpu_contrib = contrib.cpu()
            chunks.append(cpu_contrib)
            
            # Для следующего шага контекст тоже лежит в RAM (WanSCAILToVideo сам вернет его на GPU)
            prev_frames = cpu_contrib 
            
            # [ОПТИМИЗАЦИЯ 2]: Удаляем локальные переменные, чтобы разорвать связи графа
            del cond, pos_c, neg_c, latent, sampled, denoised, images, contrib
            
            # [ОПТИМИЗАЦИЯ 3]: Принудительно чистим кэш VRAM
            comfy.model_management.soft_empty_cache()
            
            pbar.update(1)
            print(f"[OreX_Scail] Chunk {i + 1}/{len(lengths)} done ({length} frames, offset: {offset})")

        # [ОПТИМИЗАЦИЯ 4]: Сборка итогового тензора происходит в оперативной памяти (CPU)
        out = torch.cat(chunks, dim=0)
        
        return (out, out.shape[0], len(lengths))

NODE_CLASS_MAPPINGS = {
    "OreX_Scail": OreX_Scail,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "OreX_Scail": "OreX SCAIL Sampler",
}