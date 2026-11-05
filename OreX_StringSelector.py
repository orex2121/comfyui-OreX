import sys

class OreXStringSelector:
    @classmethod
    def INPUT_TYPES(s):
        return {"required": {
            "strings": ("STRING", {"multiline": True}),
            "select": ("INT", {"min": 1, "max": sys.maxsize, "step": 1, "default": 1}),
        }}

    RETURN_TYPES = ("STRING",)
    FUNCTION = "select_string"
    CATEGORY = "OreX/Prompt"

    def select_string(self, strings, select):
        # Разбиваем на строки
        lines = strings.split('\n')
        
        # Если строк нет, возвращаем пустоту
        if not lines or not strings.strip():
            return ("", )

        # Переводим из человеческого счета (начинается с 1) в программистский (начинается с 0)
        # и ограничиваем значение: меньше первой строки -> первая, больше последней -> последняя
        index = min(max(select, 1), len(lines)) - 1

        selected = lines[index]

        return (selected, )


NODE_CLASS_MAPPINGS = {
    "orex String Selector": OreXStringSelector,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "orex String Selector": "📝 String Selector (OreX)",
}
