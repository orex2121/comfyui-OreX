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
                
                // Важно: Отключаем перенос строк. Если строки будут переноситься (одна строка займет 2 визуальные),
                // то математика высоты строк сломается и подсветка "поедет".
                textarea.style.whiteSpace = "pre";
                textarea.style.overflowX = "auto";

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

                // Обработка клика по текстовому полю
                textarea.addEventListener('click', (e) => {
                    const text = stringsWidget.value || "";
                    const lines = text.split('\n');
                    if (lines.length === 0 || text.trim() === "") return;

                    const computed = window.getComputedStyle(textarea);
                    let lineHeight = parseFloat(computed.lineHeight);
                    if (isNaN(lineHeight)) {
                        lineHeight = parseFloat(computed.fontSize) * 1.2;
                    }
                    const paddingTop = parseFloat(computed.paddingTop) || 0;

                    // Получаем координаты поля ввода на экране (они зависят от зума!)
                    const rect = textarea.getBoundingClientRect();
                    
                    // Вычисляем масштаб (зум) ноды в ComfyUI
                    // rect.height - высота с учетом зума, offsetHeight - "оригинальная" высота элемента
                    const scaleY = rect.height / textarea.offsetHeight;
                    
                    // Вычисляем Y-координату клика, убирая влияние зума (делим на scaleY), плюс учитываем скролл
                    const clickY = (e.clientY - rect.top) / scaleY + textarea.scrollTop;

                    // Вычисляем индекс строки, по которой кликнули (начиная с 0)
                    const clickedLineIndex = Math.floor((clickY - paddingTop) / lineHeight);

                    // Если клик был по существующей строке текста
                    if (clickedLineIndex >= 0 && clickedLineIndex < lines.length) {
                        // Обновляем значение виджета (добавляем 1, т.к. счет у нас с 1)
                        selectWidget.value = clickedLineIndex + 1;
                        
                        // Вызываем коллбек виджета, чтобы ComfyUI увидел изменения
                        if (selectWidget.callback) {
                            selectWidget.callback(selectWidget.value);
                        }
                        
                        // Принудительно обновляем зеленую подсветку
                        updateHighlight();
                    }
                });

                // Вызываем первый раз при создании
                updateHighlight();
            }, 100);
        }
    }
});