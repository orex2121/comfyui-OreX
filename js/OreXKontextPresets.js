import { app } from "../../../scripts/app.js";

// Массив описаний параметров для узла Kontext Presets (OreX) с премиальными иконками
const KONTEXT_HELP_DESCRIPTIONS = [
    { icon: "🎬", name: "start_instruction", label: "Start Instruction / Начало", desc: "Global layout or default system behavior instructions", ru_desc: "Стартовая базовая инструкция, задающая общие правила генерации" },
    { icon: "✍️", name: "manual_prompt", label: "Manual Prompt / Ручной промпт", desc: "User prompt text with optional *image* wildcard support", ru_desc: "Текст вашего запроса; поддерживает замену маски *image* на описание" },
    { icon: "🖼️", name: "image_description_enabled", label: "Image Description Enable / Включить описание картинки", desc: "🟢ON - Enable auto-substitution of description text instead of the *image* tag", ru_desc: "🟢ON - Включить атоматическую замену текста описания вместо тега *image*" },
    { icon: "📝", name: "image_description", label: "Image Description / Описание картинки", desc: "Incoming image description text from connection", ru_desc: "Входящий текст описания изображения (подключается от других узлов)" },
    { icon: "🔌", name: "Enable_Preset", label: "Enable Basic Preset / Включить базовый пресет", desc: "🟢ON - Mix the prompt of the selected base preset", ru_desc: "🟢ON - Подмешать промпт выбранного базового пресета" },
    { icon: "📋", name: "preset", label: "Basic Preset / Базовый пресет", desc: "Select a template from the OreXKontextPresets.json configuration file", ru_desc: "Выбрать шаблон из конфигурационного файла OreXKontextPresets.json" },
    { icon: "📂", name: "Manual_Preset", label: "Enable Custom Preset / Включить пользовательский пресет", desc: "🟢ON - Mix prompt from user presets file", ru_desc: "🟢ON - Подмешать промпт из файла пользовательских пресетов" },
    { icon: "📖", name: "manual_preset", label: "Custom Preset / Пользовательский пресет", desc: "Select custom configurations from OreXKontextPresetsManual.json", ru_desc: "Выбрать шаблон из файла пользовательских пресетов OreXKontextPresetsManual.json" },
    { icon: "🛑", name: "end_instruction", label: "End Instruction / Финальный промпт", desc: "Closing instructions or quality modifiers added at the text end", ru_desc: "Заключительные требования или модификаторы качества в самом конце" }
];

// Предварительно кэшируем нормализованные имена для ускорения поиска при движении мыши
const PROCESSED_HELPS = KONTEXT_HELP_DESCRIPTIONS.map(item => ({
    ...item,
    normalizedName: (item.name || "").toLowerCase().trim().replace(/_/g, " ")
}));

// Функция умного поиска нужной подсказки
function findTooltipInfo(wName, wLabel) {
    const wNameStrict = (wName || "").trim();
    const wLabelStrict = (wLabel || "").trim();

    let tooltipInfo = PROCESSED_HELPS.find(item => 
        wNameStrict === item.name || wLabelStrict === item.name
    );

    if (!tooltipInfo) {
        const wNameSoft = wNameStrict.toLowerCase().replace(/_/g, " ");
        const wLabelSoft = wLabelStrict.toLowerCase().replace(/_/g, " ");
        tooltipInfo = PROCESSED_HELPS.find(item => 
            wNameSoft === item.normalizedName || wLabelSoft === item.normalizedName
        );
    }
    return tooltipInfo;
}

app.registerExtension({
    name: "OreXKontextPresets.HelpPanel.Unique",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        
        // Гибкое сопоставление по имени, чтобы работало при любых алиасах
        const nameLower = (nodeData.name || "").toLowerCase();
        if (!nameLower.includes("kontext") || !nameLower.includes("orex")) return;

        const proto = nodeType.prototype;
        const onNodeCreated = proto.onNodeCreated;

        proto.onNodeCreated = function () {
            if (onNodeCreated) onNodeCreated.apply(this, arguments);
            
            this.activeTooltip = null;
            this.activeTooltipY = null;
            this.hoverTimer = null;
            this._leaveTimer = null;
            this._lastHoveredWidget = null;
        };

        const onDestroy = proto.onDestroy;
        proto.onDestroy = function () {
            this._clearTooltipTimers();
            if (onDestroy) onDestroy.apply(this, arguments);
        };

        proto._clearTooltipTimers = function () {
            if (this.hoverTimer) { clearTimeout(this.hoverTimer); this.hoverTimer = null; }
            if (this._leaveTimer) { clearTimeout(this._leaveTimer); this._leaveTimer = null; }
        };

        proto.onMouseMove = function (e, pos) {
            const [mx, my] = pos;

            // Сбрасываем таймер "покидания", если мышь движется внутри ноды
            if (this._leaveTimer) { clearTimeout(this._leaveTimer); this._leaveTimer = null; }

            if (mx < 0 || mx > this.size[0] || my < 0 || my > this.size[1]) {
                if (this._lastHoveredWidget !== null) {
                    this._lastHoveredWidget = null;
                    this._clearTooltipTimers();
                    if (this.activeTooltip) {
                        this.activeTooltip = null;
                        this.activeTooltipY = null;
                        this.setDirtyCanvas(true);
                    }
                }
                return false;
            }

            let hoveredWidget = null;
            if (this.widgets) {
                for (const w of this.widgets) {
                    if (w.last_y === undefined) continue;
                    const wy = w.last_y;
                    const wh = w.computeSize ? w.computeSize(this.size[0])[1] : 24;
                    
                    // Увеличенный допуск (+/- 2px), чтобы мышь не "соскальзывала" в микрозазоры
                    if (mx >= 10 && mx <= this.size[0] - 10 && my >= wy - 2 && my <= wy + wh + 2) {
                        hoveredWidget = w;
                        break;
                    }
                }
            }

            if (this._lastHoveredWidget !== hoveredWidget) {
                this._lastHoveredWidget = hoveredWidget;
                this._clearTooltipTimers();

                let tooltipInfo = hoveredWidget ? findTooltipInfo(hoveredWidget.name, hoveredWidget.label) : null;

                if (!tooltipInfo) {
                    if (this.activeTooltip) {
                        this.activeTooltip = null;
                        this.activeTooltipY = null;
                        this.setDirtyCanvas(true);
                    }
                } else {
                    if (this.activeTooltip) {
                        this.activeTooltip = null;
                        this.activeTooltipY = null;
                        this.setDirtyCanvas(true);
                    }

                    // Оптимальная задержка - 800мс
                    const widgetY = hoveredWidget.last_y;
                    this.hoverTimer = setTimeout(() => {
                        this.activeTooltip = tooltipInfo;
                        this.activeTooltipY = widgetY;
                        this.setDirtyCanvas(true);
                        this.hoverTimer = null;
                    }, 800);
                }
            }
            return false;
        };

        // Используем debounce (задержку) перед скрытием, чтобы подружить Canvas и HTML Input
        proto.onMouseLeave = function () {
            this._leaveTimer = setTimeout(() => {
                this._lastHoveredWidget = null;
                this._clearTooltipTimers();
                if (this.activeTooltip) {
                    this.activeTooltip = null;
                    this.activeTooltipY = null;
                    this.setDirtyCanvas(true);
                }
            }, 50);
        };

        proto.onDrawForeground = function (ctx) {
            if (this.flags?.collapsed) return;

            if (this.widgets) {
                for (const w of this.widgets) {
                    if (w.tooltip) w.tooltip = null; 
                    
                    if (w.inputEl && !w.inputEl._hasTooltipListeners) {
                        w.inputEl._hasTooltipListeners = true;
                        
                        if (w.inputEl.title) w.inputEl.title = "";
                        if (w.inputEl.getAttribute("title")) w.inputEl.removeAttribute("title");
                        
                        w.inputEl.addEventListener("pointerenter", () => {
                            if (this._leaveTimer) { clearTimeout(this._leaveTimer); this._leaveTimer = null; }

                            const tooltipInfo = findTooltipInfo(w.name, w.label);

                            if (tooltipInfo) {
                                this._clearTooltipTimers();
                                this.hoverTimer = setTimeout(() => {
                                    this.activeTooltip = tooltipInfo;
                                    this.activeTooltipY = w.last_y !== undefined ? w.last_y : 50;
                                    this.setDirtyCanvas(true);
                                    this.hoverTimer = null;
                                }, 800);
                            }
                        });

                        w.inputEl.addEventListener("pointerleave", () => {
                            this.onMouseLeave(); // Вызываем общую функцию плавного скрытия
                        });
                    }
                }
            }

            if (this.inputs) {
                for (const input of this.inputs) {
                    if (input.tooltip) input.tooltip = null;
                }
            }
            if (this.outputs) {
                for (const output of this.outputs) {
                    if (output.tooltip) output.tooltip = null;
                }
            }

            if (this.activeTooltip) {
                this._drawTooltip(ctx);
            }
        };

        // Рисование тултипа с рамкой и стрелкой
        proto._drawTooltip = function (ctx) {
            if (!this.activeTooltip) return;
            const item = this.activeTooltip;
            const wy = this.activeTooltipY !== null ? this.activeTooltipY : 100;
            
            const margin = 14;
            // Увеличили отступ bx, чтобы стрелка точно не наезжала на границы узла
            const bx = this.size[0] + 25; 
            
            ctx.save();
            
            // Расчет ширины блока по тексту
            ctx.font = "bold 14px sans-serif";
            const titleText = `${item.icon || "💡"} ${item.label}`;
            const titleW = ctx.measureText(titleText).width;
            
            ctx.font = "12px sans-serif";
            const descText = `EN: ${item.desc}`;
            const ruDescText = `RU: ${item.ru_desc}`;
            const descW = ctx.measureText(descText).width;
            const ruDescW = ctx.measureText(ruDescText).width;
            
            const boxW = Math.max(titleW, descW, ruDescW) + margin * 2;
            const boxH = 76;
            
            // Центрируем тултип вертикально относительно виджета (высчитано как wy + 12)
            const by = wy + 12 - boxH / 2;
            
            // Параметры для стрелки и рамки
            const r = 6; // Радиус скругления
            const arrowW = 8; // Длина стрелки (выступает влево)
            const arrowH = 6; // Половина ширины стрелки
            const arrowY = boxH / 2; // Стрелка по центру блока по вертикали
            
            // Формируем единый путь (рамка + стрелка)
            ctx.beginPath();
            ctx.moveTo(bx + r, by); // верхний левый угол (начало)
            ctx.lineTo(bx + boxW - r, by); // линия вправо
            ctx.arcTo(bx + boxW, by, bx + boxW, by + r, r); // скругление верх-право
            ctx.lineTo(bx + boxW, by + boxH - r); // линия вниз
            ctx.arcTo(bx + boxW, by + boxH, bx + boxW - r, by + boxH, r); // скругление низ-право
            ctx.lineTo(bx + r, by + boxH); // линия влево
            ctx.arcTo(bx, by + boxH, bx, by + boxH - r, r); // скругление низ-лево
            
            // Стрелка (указывает налево)
            ctx.lineTo(bx, by + arrowY + arrowH); // до нижней части стрелки
            ctx.lineTo(bx - arrowW, by + arrowY); // острие стрелки
            ctx.lineTo(bx, by + arrowY - arrowH); // до верхней части стрелки
            
            ctx.lineTo(bx, by + r); // линия вверх к началу
            ctx.arcTo(bx, by, bx + r, by, r); // скругление верх-лево
            ctx.closePath();

            // Стилизация: зеленый цвет, как в предыдущих узлах
            ctx.fillStyle = "rgba(18, 18, 18, 0.95)";
            ctx.strokeStyle = "rgba(0, 255, 70, 0.5)"; // Зеленая рамка
            ctx.lineWidth = 1.5;
            ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
            ctx.shadowBlur = 10;
            ctx.shadowOffsetY = 4;
            
            ctx.fill();
            ctx.shadowColor = "transparent"; // Отключаем тень для обводки, чтобы не мазалась
            ctx.stroke();

            // Отрисовка текста
            ctx.textBaseline = "top";
            ctx.textAlign = "left";

            // Заголовок
            ctx.font = "bold 14px sans-serif";
            ctx.fillStyle = "#ffffff";
            ctx.fillText(titleText, bx + margin, by + 12);

            // Описание (Английское)
            ctx.font = "12px sans-serif";
            ctx.fillStyle = "#cccccc"; // Выровняли цвета с другими узлами
            ctx.fillText(descText, bx + margin, by + 34);

            // Описание (Русское)
            ctx.font = "12px sans-serif";
            ctx.fillStyle = "#999999"; // Выровняли цвета с другими узлами
            ctx.fillText(ruDescText, bx + margin, by + 52);

            ctx.restore();
        };
    }
});