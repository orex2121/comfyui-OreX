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
    CATEGORY = "OreX"

    def select_string(self, strings, select):
        # Разбиваем на строки
        lines = strings.split('\n')
        
        # Если строк нет, возвращаем пустоту
        if not lines or not strings.strip():
            return ("", )

        # Переводим из человеческого счета (начинается с 1) в программистский (начинается с 0)
        index = select - 1
        
        # Берем строку, используя остаток от деления, чтобы избежать ошибок выхода за пределы
        selected = lines[index % len(lines)]

        return (selected, )