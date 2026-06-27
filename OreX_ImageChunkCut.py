import torch

class OreXImageChunkCut:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "images": ("IMAGE",),
                "chunk_length": ("INT", {"default": 81, "min": 1, "max": 10000, "step": 4}), 
            }
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT", "INT")
    RETURN_NAMES = ("image_chunks", "shortfall", "chunk_length", "full_length")
    
    OUTPUT_IS_LIST = (True, False, False, False) 
    
    FUNCTION = "split_into_chunks"
    CATEGORY = "OreX/Image"

    def split_into_chunks(self, images, chunk_length):
        total_frames = images.shape[0]
        
        # Считаем классический остаток от деления
        mod = total_frames % chunk_length
        
        # Вычисляем дефицит кадров относительно исходной секвенции
        shortfall = (chunk_length - mod) if mod != 0 else 0
        
        # Если есть дефицит, наращиваем секвенцию реверсом
        if shortfall > 0:
            # Генерируем индексы кадров для реверса (начиная с последнего к первому).
            # Конструкция (i % total_frames) страхует от ошибки выхода за пределы массива,
            # если shortfall вдруг окажется больше, чем total_frames.
            pad_indices = [total_frames - 1 - (i % total_frames) for i in range(shortfall)]
            
            # Извлекаем кадры по сгенерированным индексам
            padding = images[pad_indices]
            
            # Присоединяем реверсивные кадры к исходной секвенции
            working_images = torch.cat([images, padding], dim=0)
        else:
            working_images = images

        chunks = []
        full_length = working_images.shape[0]
        
        # Нарезаем уже дополненный тензор
        for i in range(0, full_length, chunk_length):
            chunk = working_images[i:i + chunk_length]
            chunks.append(chunk)
            
        return (chunks, shortfall, chunk_length, full_length)