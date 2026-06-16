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
        # Если значение не подано, оставляем None.
        values = {
            "A": A,
            "B": B,
            "C": C,
            "D": D,
        }
        
        # Функция обработки каждой найденной переменной и её цепочки замен
        def process_variable(match):
            var_name = match.group(1) # Буква переменной (A, B, C или D)
            replacements_chain = match.group(2) # Вся цепочка (old->new)
            
            raw_val = values.get(var_name)
            
            # Если вход не подключен, возвращаем пустую строку (полностью удаляем тег)
            if raw_val is None:
                return ""
            
            val = str(raw_val)
            
            if replacements_chain:
                # Находим все пары (old->new)
                pairs = re.findall(r'\(([^)]+?)\-\>([^)]*?)\)', replacements_chain)
                for old_str, new_str in pairs:
                    
                    # 1. Раскрываем переменные в строке, КОТОРУЮ мы ищем (old_str)
                    for k, v in values.items():
                        if v is not None and f"{{{k}}}" in old_str:
                            old_str = old_str.replace(f"{{{k}}}", str(v))
                            
                    # 2. Раскрываем переменные в строке, НА КОТОРУЮ мы заменяем (new_str)
                    for k, v in values.items():
                        if v is not None and f"{{{k}}}" in new_str:
                            new_str = new_str.replace(f"{{{k}}}", str(v))
                            
                    # 3. Применяем замену к основному тексту
                    if old_str: # Защита от попытки заменить пустую строку
                        val = val.replace(old_str, new_str)
                    
            return val

        # Регулярное выражение: ищет {A}, за которым могут следовать (old->new)
        pattern = r'\{([ABCD])\}((?:(?:\s*\([^)]+?\-\>[^)]*?\))*))'
        
        # Основной проход замен
        result = re.sub(pattern, process_variable, string_function, flags=re.DOTALL)
        
        return (result,)

# Регистрация узла в системе ComfyUI
NODE_CLASS_MAPPINGS = {
    "orex String Function": OreX_StringFunction
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "orex String Function": "✍️ String Function (OreX)"
}