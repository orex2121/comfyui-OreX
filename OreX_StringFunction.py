import re

# Создаем специальный класс для обхода строгой типизации ComfyUI
class AnyType(str):
    def __ne__(self, __value: object) -> bool:
        return False

any_type = AnyType("*")

class OreX_StringFunction:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # Многострочное поле для ввода текста
                "string_function": ("STRING", {"multiline": True, "default": ""}),
            },
            "optional": {
                # Опциональные входы любого типа
                "A": (any_type, ),
                "B": (any_type, ),
                "C": (any_type, ),
                "D": (any_type, ),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("string",)
    FUNCTION = "execute"
    CATEGORY = "OreX"

    def execute(self, string_function, A=None, B=None, C=None, D=None):
        result = string_function
        
        # Если вход не подключен (None), мы присваиваем ему пустую строку "".
        values = {
            "A": str(A) if A is not None else "",
            "B": str(B) if B is not None else "",
            "C": str(C) if C is not None else "",
            "D": str(D) if D is not None else "",
        }
        
        # Функция обработки каждой найденной переменной и её цепочки замен
        def process_variable(match):
            var_name = match.group(1) # Буква переменной (A, B, C или D)
            replacements_chain = match.group(2) # Вся цепочка (old->new)
            
            val = values.get(var_name, "")
            
            if not val:
                return ""
            
            if replacements_chain:
                # Разбиваем цепочку на отдельные пары
                pairs = re.findall(r'\((.*?)\-\>(.*?)\)', replacements_chain, flags=re.DOTALL)
                for old_str, new_str in pairs:
                    # Проверяем, есть ли переменные в строке, НА которую мы заменяем
                    for k, v in values.items():
                        if f"{{{k}}}" in new_str:
                            new_str = new_str.replace(f"{{{k}}}", v)
                            
                    # Применяем замену.
                    val = val.replace(old_str, new_str)
                    
            return val

        # Регулярное выражение: ищет {A}, за которым могут следовать (old->new) 
        pattern = r'\{([ABCD])\}((?:(?:\s*\(.*?\-\>.*?\))*))'
        
        # 1. Основной проход замен
        result = re.sub(pattern, process_variable, result, flags=re.DOTALL)
        
        # 2. ФИНАЛЬНЫЕ ФИЛЬТРЫ ОЧИСТКИ
        # Если какие-то паттерны (old->new) были написаны отдельно от переменных 
        # или попали в текст из других узлов, они не должны выводиться "в чистую"
        result = re.sub(r'\([^)]*?\-\>[^)]*?\)', '', result)
        
        # Удаляем любые сырые переменные {A}, {B}, {C}, {D}, которые 
        # не отработали или случайно остались в тексте
        result = re.sub(r'\{[ABCD]\}', '', result)
        
        return (result,)

# Регистрация узла в системе ComfyUI
NODE_CLASS_MAPPINGS = {
    "orex String Function": OreX_StringFunction
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "orex String Function": "✍️ String Function (OreX)"
}