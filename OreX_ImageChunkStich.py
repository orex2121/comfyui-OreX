import torch

class OreXImageChunkStich:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image_chunks": ("IMAGE",),
                "trim_first": ("INT", {"default": 0, "min": 0, "max": 100000, "step": 1}),
                "trim_end": ("INT", {"default": 0, "min": 0, "max": 100000, "step": 1}),
            }
        }

    # Возвращаем IMAGE и INT (frame_count)
    RETURN_TYPES = ("IMAGE", "INT")
    RETURN_NAMES = ("image", "frame_count")
    
    INPUT_IS_LIST = True 
    
    FUNCTION = "stitch_chunks"
    CATEGORY = "OreX/Image"

    def stitch_chunks(self, image_chunks, trim_first, trim_end):
        # Поскольку INPUT_IS_LIST = True, ComfyUI оборачивает входы в списки.
        # Достаем значения из списков.
        t_first = trim_first[0] if isinstance(trim_first, list) else trim_first
        t_end = trim_end[0] if isinstance(trim_end, list) else trim_end
        
        if not image_chunks or len(image_chunks) == 0:
            print("Warning: OreXImageChunkStich received no images.")
            # Возвращаем 0 кадров, если на вход ничего не пришло
            return (None, 0)

        # Склеиваем все чанки обратно в единую секвенцию
        stitched_video = torch.cat(image_chunks, dim=0)
        total_frames = stitched_video.shape[0]
        
        # Вычисляем индексы для обрезки
        start_idx = t_first
        end_idx = total_frames - t_end
        
        # Защита: проверяем, не отрезаем ли мы больше кадров, чем вообще есть
        if start_idx >= end_idx:
            print(f"Warning: OreXImageChunkStich trim values (first: {t_first}, end: {t_end}) exceed or equal total frames ({total_frames}). Returning 1 frame.")
            stitched_video = stitched_video[:1]
        else:
            # Применяем подрезку: срезаем начало до start_idx и конец после end_idx
            stitched_video = stitched_video[start_idx:end_idx]
                
        # Считаем итоговое количество кадров по первому измерению тензора
        frame_count = stitched_video.shape[0]
                
        return (stitched_video, frame_count)