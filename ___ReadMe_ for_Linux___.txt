Даем права на запуск pngquant и oxipng

В Jupyter Lab в верхнем меню нажмите File -> New -> Terminal (откроется черное окошко консоли).

Скопируйте туда и запустите (нажав Enter) следующую команду, которая сама найдет файлы в вашей папке и разрешит им работать:

chmod +x /workspace/ComfyUI/custom_nodes/comfyui-OreX/bin/pngquant/pngquant /workspace/ComfyUI/custom_nodes/comfyui-OreX/bin/oxipng/oxipng

(Примечание: путь /workspace/ — это стандартный корневой путь на RunPod, где лежит ComfyUI).