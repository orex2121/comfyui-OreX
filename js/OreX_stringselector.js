import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "OreX.StringSelector",
    async nodeCreated(node) {
        if (node.comfyClass === "orex String Selector") {
            
            // Запускаем с небольшой задержкой, чтобы ComfyUI успел создать все элементы (DOM)
            setTimeout(() => {
                const stringsWidget = node.widgets.find(w => w.name === "strings");
                const selectWidget = node.widgets.find(w => w.name === "select");

                if (!stringsWidget || !selectWidget) return;
                
                const textarea = stringsWidget.inputEl;
                if (!textarea) return;

                // Важно: заставляем фон скроллиться вместе с текстом!
                textarea.style.backgroundAttachment = "local";

                // Главная функция подсветки
                const updateHighlight = () => {
                    // Если ноду удалили, прекращаем выполнение
                    if (!textarea || !document.body.contains(textarea)) return;
                    
                    const text = stringsWidget.value || "";
                    const lines = text.split('\n');

                    if (lines.length === 0 || text.trim() === "") {
                        textarea.style.backgroundImage = "none";
                        return;
                    }

                    // Вычисляем индекс выбранной строки (select начинается с 1)
                    const index = Math.max(0, selectWidget.value - 1) % lines.length;

                    // Вычисляем высоту одной строки (line-height) и отступ сверху
                    const computed = window.getComputedStyle(textarea);
                    let lineHeight = parseFloat(computed.lineHeight);
                    if (isNaN(lineHeight)) {
                        // Если браузер возвращает "normal", берем размер шрифта * 1.2
                        lineHeight = parseFloat(computed.fontSize) * 1.2;
                    }
                    const paddingTop = parseFloat(computed.paddingTop) || 0;

                    // Вычисляем точные координаты для зеленой полосы
                    const startY = paddingTop + index * lineHeight;
                    const endY = startY + lineHeight;

                    // Рисуем градиент на фоне: прозрачный -> зеленая полоса -> прозрачный
                    textarea.style.backgroundImage = `linear-gradient(to bottom, 
                        transparent 0px, 
                        transparent ${startY}px, 
                        rgba(0, 200, 50, 0.35) ${startY}px, 
                        rgba(0, 200, 50, 0.35) ${endY}px, 
                        transparent ${endY}px, 
                        transparent 100%)`;
                };

                // Отслеживаем изменения в тексте
                const origStringsCb = stringsWidget.callback;
                stringsWidget.callback = function() {
                    updateHighlight();
                    if (origStringsCb) origStringsCb.apply(this, arguments);
                };

                // Отслеживаем изменения ползунка "select"
                const origSelectCb = selectWidget.callback;
                selectWidget.callback = function() {
                    updateHighlight();
                    if (origSelectCb) origSelectCb.apply(this, arguments);
                };
                
                // Отслеживаем загрузку готовых воркфлоу (чтобы сразу правильно красило)
                const origOnConfigure = node.onConfigure;
                node.onConfigure = function() {
                    if (origOnConfigure) origOnConfigure.apply(this, arguments);
                    setTimeout(updateHighlight, 50);
                };

                // Вызываем первый раз при создании
                updateHighlight();
            }, 100);
        }
    }
});