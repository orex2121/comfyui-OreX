import { app } from "../../../scripts/app.js";

const BATCH_LOAD_HELP_DESCRIPTIONS = [
    { icon: "⚙️", name: "mode", label: "Mode / Режим работы", desc: "single_image - one file from the position of start_index (counting starts from zero) | incremental_image - step forward each generation", ru_desc: "single_image - один файл из позиции start_index (отсчет начинается с нуля) | incremental_image - шаг вперед при каждой генерации" },
    { icon: "📁", name: "folder_path", label: "Folder Path / Путь к папке", desc: "Absolute directory path or relative path inside ComfyUI/input/", ru_desc: "Абсолютный путь к папке с картинками или относительный внутри каталога ComfyUI/input/" },
    { icon: "🔍", name: "file_pattern", label: "File Pattern / Маска файлов", desc: "Filter format (* for all, *.png, or specific naming pattern)", ru_desc: "Фильтр форматов (* для всех, *.png или по паттерну в имени файла)" },
    { icon: "🔢", name: "start_index", label: "Start Index / Начальный индекс", desc: "The file index from which loading begins (the countdown starts from zero)", ru_desc: "Индекс файла, с которого начинается чтение (отсчет начинается с нуля)" },
    { icon: "🎲", name: "seed", label: "Seed / Сид перезапуска", desc: "Seed for updating the operation status of nodes and forced restarting image reading", ru_desc: "Сид для обновления состояния работы узла и принудительного перезапуска чтения изображений" },
    { icon: "🔄", name: "control after generate", label: "Behavior of the seed / Поведение сида", desc: "Determines the behavior of the seed before generation. (Do not select the fixed mode!)", ru_desc: "Определяет поведение сида перед генерацией. (Не выбирать режим fixed!)" },
    { icon: "🔄", name: "control before generate", label: "Behavior of the seed / Поведение сида", desc: "Determines the behavior of the seed before generation. (Do not select the fixed mode!)", ru_desc: "Определяет поведение сида перед генерацией. (Не выбирать режим fixed!)" },
    { icon: "🏷️", name: "label", label: "Batch Identifier / Идентификатор батча", desc: "Unique group name (ID); protects against conflicts if there are two such nodes on the canvas", ru_desc: "Уникальное имя группы (ID); защищает от конфликтов, если на холсте две такие ноды" },
    { icon: "🖼️", name: "allow_rgba_output", label: "Alpha Channel / Альфа-канал", desc: "🟢ON - keep transparent alpha layer (RGBA); 🔴OFF - force-convert to standard RGB", ru_desc: "🟢ON - сохранять прозрачный альфа-канал (RGBA); 🔴OFF - принудительно переводить в RGB" }
];

app.registerExtension({
    name: "OreXImageLoadBatch.HelpPanel.SmartTimer",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        
        const safeName = (nodeData.name || "").toLowerCase();
        if (safeName.includes("orex") && safeName.includes("batch")) {

            const proto = nodeType.prototype;
            
            const onNodeCreated = proto.onNodeCreated;
            const onMouseMove = proto.onMouseMove;
            const onMouseLeave = proto.onMouseLeave;
            const onDrawForeground = proto.onDrawForeground;

            proto.onNodeCreated = function () {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);
                
                this.color = "#0096ff";
                this.bgcolor = "#0096ff";
                
                this.activeTooltip = null;
                this.activeTooltipY = null;
                this.hoverTimer = null;
                this.currentHoverWidgetName = null; 
            };

            const onDestroy = proto.onDestroy;
            proto.onDestroy = function () {
                if (this.hoverTimer) {
                    clearTimeout(this.hoverTimer);
                    this.hoverTimer = null;
                }
                if (onDestroy) onDestroy.apply(this, arguments);
            };

            proto.onMouseMove = function (e, pos) {
                let r = false;
                if (onMouseMove) r = onMouseMove.apply(this, arguments);
                
                const [mx, my] = pos;

                // Запас при выходе за пределы (сбрасываем тултип)
                if (mx < 0 || mx > this.size[0] || my < 0 || my > this.size[1]) {
                    this._clearTooltipState();
                    return r;
                }

                let hoveredWidget = null;
                if (this.widgets) {
                    for (const w of this.widgets) {
                        if (w.last_y === undefined) continue;
                        const wy = w.last_y;
                        const wh = w.computeSize ? w.computeSize(this.size[0])[1] : 24;
                        
                        if (mx >= 10 && mx <= this.size[0] - 10 && my >= wy && my <= wy + wh) {
                            hoveredWidget = w;
                            w.tooltip = ""; 
                            break;
                        }
                    }
                }

                // Сброс нативных тултипов (Title) для канваса
                if (hoveredWidget && app.canvas && app.canvas.canvas) {
                    app.canvas.canvas.title = "";
                }

                const widgetIdentifier = hoveredWidget ? (hoveredWidget.name || hoveredWidget.label) : null;

                if (this.currentHoverWidgetName !== widgetIdentifier) {
                    this.currentHoverWidgetName = widgetIdentifier;
                    
                    if (this.hoverTimer) {
                        clearTimeout(this.hoverTimer);
                        this.hoverTimer = null;
                    }
                    this.activeTooltip = null;
                    this.activeTooltipY = null;
                    app.canvas.setDirty(true, true); 

                    if (hoveredWidget) {
                        const hwName = String(hoveredWidget.name || "").toLowerCase().trim().replace(/_/g, " ");
                        const hwLabel = String(hoveredWidget.label || "").toLowerCase().trim().replace(/_/g, " ");
                        
                        const tooltipInfo = BATCH_LOAD_HELP_DESCRIPTIONS.find(item => {
                            const itemName = String(item.name || "").toLowerCase().trim().replace(/_/g, " ");
                            return hwName === itemName || hwLabel === itemName;
                        });

                        if (tooltipInfo) {
                            const widgetY = hoveredWidget.last_y;
                            this.hoverTimer = setTimeout(() => {
                                this.activeTooltip = tooltipInfo;
                                this.activeTooltipY = widgetY;
                                app.canvas.setDirty(true, true);
                                this.hoverTimer = null;
                            }, 800); // 800 мс для быстрого отклика
                        }
                    }
                }

                return r;
            };

            proto.onMouseLeave = function () {
                if (onMouseLeave) onMouseLeave.apply(this, arguments);
                this._clearTooltipState();
                
                if (app.canvas && app.canvas.canvas) {
                    app.canvas.canvas.title = "";
                }
            };

            proto._clearTooltipState = function() {
                if (this.hoverTimer) {
                    clearTimeout(this.hoverTimer);
                    this.hoverTimer = null;
                }
                this.currentHoverWidgetName = null;
                if (this.activeTooltip) {
                    this.activeTooltip = null;
                    this.activeTooltipY = null;
                    app.canvas.setDirty(true, true);
                }
            };

            proto.onDrawForeground = function (ctx) {
                if (onDrawForeground) onDrawForeground.apply(this, arguments);
                if (this.flags?.collapsed) return;

                // Связывание событий для текстовых полей ввода HTML DOM (пути, лейблы и т.д.)
                if (this.widgets) {
                    for (const w of this.widgets) {
                        if (w.tooltip) w.tooltip = null; 
                        
                        if (w.inputEl && !w.inputEl._hasTooltipListeners) {
                            w.inputEl._hasTooltipListeners = true;
                            
                            if (w.inputEl.title) w.inputEl.title = "";
                            if (w.inputEl.getAttribute("title")) w.inputEl.removeAttribute("title");
                            
                            w.inputEl.addEventListener("pointerenter", () => {
                                const hwName = String(w.name || "").toLowerCase().trim().replace(/_/g, " ");
                                const hwLabel = String(w.label || "").toLowerCase().trim().replace(/_/g, " ");
                                
                                const tooltipInfo = BATCH_LOAD_HELP_DESCRIPTIONS.find(item => {
                                    const itemName = String(item.name || "").toLowerCase().trim().replace(/_/g, " ");
                                    return hwName === itemName || hwLabel === itemName;
                                });

                                if (tooltipInfo) {
                                    this.currentHoverWidgetName = w.name || w.label;
                                    if (this.hoverTimer) clearTimeout(this.hoverTimer);
                                    
                                    this.hoverTimer = setTimeout(() => {
                                        this.activeTooltip = tooltipInfo;
                                        this.activeTooltipY = w.last_y !== undefined ? w.last_y : 50;
                                        app.canvas.setDirty(true, true);
                                        this.hoverTimer = null;
                                    }, 800);
                                }
                            });

                            w.inputEl.addEventListener("pointerleave", () => {
                                this._clearTooltipState();
                            });
                        }
                    }
                }
                
                if (this.activeTooltip && this.activeTooltipY !== null) {
                    this._drawTooltip(ctx);
                }
            };

            // Рисование красивого тултипа со стрелочкой (единый путь)
            proto._drawTooltip = function (ctx) {
                if (!this.activeTooltip) return;
                const item = this.activeTooltip;
                const wy = this.activeTooltipY !== null ? this.activeTooltipY : 100;
                
                const margin = 12;
                
                // Сдвигаем бокс вправо, освобождая место под стрелочку и предотвращая наложения
                const bx = this.size[0] + 25; 
                
                ctx.save();
                
                ctx.font = "bold 13px sans-serif";
                const titleText = `${item.icon || "💡"} ${item.label}`;
                const titleW = ctx.measureText(titleText).width;
                
                ctx.font = "11px sans-serif";
                const descText = `EN: ${item.desc}`;
                const ruDescText = `RU: ${item.ru_desc}`;
                const descW = ctx.measureText(descText).width;
                const ruDescW = ctx.measureText(ruDescText).width;
                
                const boxW = Math.max(titleW, descW, ruDescW) + margin * 2;
                const boxH = 74;
                
                const by = wy + 12 - boxH / 2;
                
                ctx.fillStyle = "rgba(18, 18, 18, 0.98)";
                ctx.strokeStyle = "rgba(0, 150, 255, 0.7)"; // Сохранен оригинальный синий цвет
                ctx.lineWidth = 1.5;
                ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
                ctx.shadowBlur = 10;
                ctx.shadowOffsetY = 4;
                
                // === ПРОДВИНУТАЯ ОТРИСОВКА ПУТИ СО СТРЕЛОЧКОЙ (arcTo) ===
                const r = 6;             // Радиус скругления углов
                const arrowW = 8;        // Длина стрелочки (вылет влево)
                const arrowH = 6;        // Половина ширины основания стрелочки
                const arrowTipY = boxH / 2; // Центр стрелочки по вертикали
                
                ctx.beginPath();
                // Начинаем с левого верхнего угла (после скругления)
                ctx.moveTo(bx + r, by);
                
                // Верхняя грань и правый верхний угол
                ctx.lineTo(bx + boxW - r, by);
                ctx.arcTo(bx + boxW, by, bx + boxW, by + r, r);
                
                // Правая грань и правый нижний угол
                ctx.lineTo(bx + boxW, by + boxH - r);
                ctx.arcTo(bx + boxW, by + boxH, bx + boxW - r, by + boxH, r);
                
                // Нижняя грань и левый нижний угол
                ctx.lineTo(bx + r, by + boxH);
                ctx.arcTo(bx, by + boxH, bx, by + boxH - r, r);
                
                // Левая грань (идет вверх) -> нижняя половина основания стрелочки
                ctx.lineTo(bx, by + arrowTipY + arrowH);
                
                // Рисуем саму стрелочку: точка влево (наконечник)
                ctx.lineTo(bx - arrowW, by + arrowTipY);
                
                // Идем обратно к левой грани (верхняя половина основания стрелочки)
                ctx.lineTo(bx, by + arrowTipY - arrowH);
                
                // Заканчиваем левую грань и соединяем с левым верхним углом
                ctx.lineTo(bx, by + r);
                ctx.arcTo(bx, by, bx + r, by, r);
                ctx.closePath();
                
                ctx.fill();
                ctx.shadowColor = "transparent"; // Отключаем тень, чтобы рамка была кристально четкой
                ctx.stroke();
                // ============================================

                ctx.textBaseline = "top";
                ctx.textAlign = "left";

                ctx.font = "bold 13px sans-serif";
                ctx.fillStyle = "#ffffff";
                ctx.fillText(titleText, bx + margin, by + margin);

                ctx.font = "11px sans-serif";
                ctx.fillStyle = "#cccccc";
                ctx.fillText(descText, bx + margin, by + margin + 22);

                ctx.font = "11px sans-serif";
                ctx.fillStyle = "#999999";
                ctx.fillText(ruDescText, bx + margin, by + margin + 38);

                ctx.restore();
            };
        }
    }
});