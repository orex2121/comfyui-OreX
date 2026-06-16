import { app } from "../../../scripts/app.js";

const OLLAMA_HELP_DESCRIPTIONS = [
    { icon: "✍️", name: "text_input", label: "Text Input / Входной текст", desc: "Main prompt or question for the language model", ru_desc: "Основной промпт или вопрос для языковой модели" },
    { icon: "⚙️", name: "system_prompt", label: "System Prompt / Системный промпт", desc: "Instructions defining the model's behavior and role", ru_desc: "Инструкции, задающие поведение и роль модели" },
    { icon: "📋", name: "system_preset", label: "System Presets / Системные пресеты", desc: "Pre-configured system prompt presets", ru_desc: "Предустановленные системные промпты" },
    { icon: "🦙", name: "model_key", label: "Model Key / Выбор модели", desc: "Select the specific Ollama model to use", ru_desc: "Выбор конкретной установленной модели Ollama" },
    { icon: "🧠", name: "include_reasoning", label: "Include Reasoning / Мышление модели", desc: "🟢ON - enable reasoning chain, 🔴OFF - hide reasoning", ru_desc: "🟢ON - показывать теги <think>, 🔴OFF - скрывать теги <think>" },
    { icon: "🔌", name: "auto_unload_model", label: "Auto Unload Model / Автовыгрузка модели", desc: "🟢ON - Automatically unloading the model after generation to free up VRAM", ru_desc: "🟢ON - Автоматически выгружать модель после генерации для освобождения VRAM" },
    { icon: "⏳", name: "unload_delay", label: "Unload Delay / Задержка выгрузки", desc: "Time in seconds to wait before unloading the model", ru_desc: "Время в секундах перед выгрузкой модели" },
    { icon: "🧹", name: "clean_vram_before", label: "Clean VRAM / Очистка VRAM", desc: "🟢ON - Unload all ComfyUI models from VRAM before calling Ollama", ru_desc: "🟢ON - Выгрузить все модели ComfyUI из VRAM перед вызовом Ollama" },
    { icon: "🎲", name: "seed", label: "Seed / Сид", desc: "Randomness control for generations", ru_desc: "Контроль случайности для воспроизводимости" },
    { icon: "🔄", name: "control_after_generate", label: "Control After Generate / Поведение сида", desc: "Behavior of the seed after generation (random, incremental, fix)", ru_desc: "Поведение сида после генерации (рандом, инкремент, фиксировать)" },
    { icon: "🔄", name: "control_before_generate", label: "Control Before Generate / Поведение сида", desc: "Behavior of the seed before generation (random, incremental, fix)", ru_desc: "Поведение сида перед генерацией (рандом, инкремент, фиксировать)" },
    { icon: "📏", name: "context_length", label: "Context Length / Длина контекста", desc: "Maximum context window size in tokens", ru_desc: "Максимальный размер окна контекста в токенах" },
    { icon: "🪙", name: "max_tokens", label: "Max Tokens / Максимум токенов", desc: "Limit the maximum number of generated tokens", ru_desc: "Ограничение на максимальное количество генерируемых токенов" },
    { icon: "🎛️", name: "generation_parameters", label: "Gen Parameters / Доп. параметры", desc: "Enable or disable sampling configuration below", ru_desc: "Включить или выключить настройки семплирования ниже" },
    { icon: "🔥", name: "temperature", label: "Temperature / Температура", desc: "Creativity slider. Higher values mean more random output", ru_desc: "Ползунок креативности. Выше значение — более случайный ответ" },
    { icon: "📊", name: "top_k", label: "Top K", desc: "Limits pool of top tokens to choose from", ru_desc: "Ограничение выборки только из K самых вероятных токенов" },
    { icon: "🎯", name: "top_p", label: "Top P", desc: "Nucleus sampling threshold based on cumulative probability", ru_desc: "Порог выборки по кумулятивной вероятности токенов" },
    { icon: "🚫", name: "repeat_penalty", label: "Repeat Penalty / Штраф за повторы", desc: "Prevents the model from repeating the same phrases", ru_desc: "Предотвращает зацикливание и повторение одинаковых фраз" }
];

app.registerExtension({
    name: "OreXOllama.Antigravity.Unique",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "OreXOllama" && nodeData.name !== "orex Ollama") return;

        const proto = nodeType.prototype;
        const onNodeCreated = proto.onNodeCreated;

        proto.onNodeCreated = function () {
            if (onNodeCreated) onNodeCreated.apply(this, arguments);
            this.activeTooltip = null;
            this.activeTooltipY = null;
            this.hoverTimer = null;
            this.currentHoverTarget = null;
        };

        const onDestroy = proto.onDestroy;
        proto.onDestroy = function () {
            if (this.hoverTimer) {
                clearTimeout(this.hoverTimer);
                this.hoverTimer = null;
            }
            if (onDestroy) onDestroy.apply(this, arguments);
        };

        const onMouseMove = proto.onMouseMove;
        proto.onMouseMove = function (e, pos, canvas) {
            if (onMouseMove) onMouseMove.apply(this, arguments);
            
            if (!pos) return false;
            const [mx, my] = pos;

            const isInsideNode = mx >= 0 && mx <= this.size[0] && my >= 0 && my <= this.size[1];

            if (!isInsideNode) {
                this._clearTooltipState();
                return false;
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

            if (hoveredWidget && app.canvas && app.canvas.canvas) {
                app.canvas.canvas.title = "";
            }

            let tooltipInfo = null;
            if (hoveredWidget) {
                tooltipInfo = OLLAMA_HELP_DESCRIPTIONS.find(item => {
                    const wName = (hoveredWidget.name || "").toLowerCase().trim().replace(/_/g, " ");
                    const wLabel = (hoveredWidget.label || "").toLowerCase().trim().replace(/_/g, " ");
                    const itemName = (item.name || "").toLowerCase().trim().replace(/_/g, " ");
                    return wName === itemName || wLabel === itemName;
                });
            }

            if (this.currentHoverTarget !== tooltipInfo) {
                this.currentHoverTarget = tooltipInfo;
                
                if (this.hoverTimer) {
                    clearTimeout(this.hoverTimer);
                    this.hoverTimer = null;
                }

                if (!tooltipInfo) {
                    if (this.activeTooltip) {
                        this.activeTooltip = null;
                        this.activeTooltipY = null;
                        this.setDirtyCanvas(true, true);
                    }
                } else {
                    const widgetY = hoveredWidget.last_y;
                    this.hoverTimer = setTimeout(() => {
                        this.activeTooltip = tooltipInfo;
                        this.activeTooltipY = widgetY;
                        this.setDirtyCanvas(true, true);
                        this.hoverTimer = null;
                    }, 800);
                }
            }
            return false;
        };

        const onMouseLeave = proto.onMouseLeave;
        proto.onMouseLeave = function () {
            if (onMouseLeave) onMouseLeave.apply(this, arguments);
            this._clearTooltipState();
        };

        proto._clearTooltipState = function() {
            this.currentHoverTarget = null;
            if (app.canvas && app.canvas.canvas) {
                app.canvas.canvas.title = "";
            }
            if (this.hoverTimer) {
                clearTimeout(this.hoverTimer);
                this.hoverTimer = null;
            }
            if (this.activeTooltip) {
                this.activeTooltip = null;
                this.activeTooltipY = null;
                this.setDirtyCanvas(true, true);
            }
        };

        const onDrawForeground = proto.onDrawForeground;
        proto.onDrawForeground = function (ctx) {
            if (onDrawForeground) onDrawForeground.apply(this, arguments);
            if (this.flags?.collapsed) return;

            // DOM-элементы (для text_input)
            if (this.widgets) {
                for (const w of this.widgets) {
                    if (w.inputEl && !w.inputEl._hasTooltipListeners) {
                        w.inputEl._hasTooltipListeners = true;
                        
                        w.inputEl.addEventListener("pointerenter", () => {
                            const tooltipInfo = OLLAMA_HELP_DESCRIPTIONS.find(item => {
                                const wName = (w.name || "").toLowerCase().trim().replace(/_/g, " ");
                                const wLabel = (w.label || "").toLowerCase().trim().replace(/_/g, " ");
                                const itemName = (item.name || "").toLowerCase().trim().replace(/_/g, " ");
                                return wName === itemName || wLabel === itemName;
                            });

                            if (tooltipInfo) {
                                this.currentHoverTarget = tooltipInfo;
                                if (this.hoverTimer) {
                                    clearTimeout(this.hoverTimer);
                                }
                                
                                this.hoverTimer = setTimeout(() => {
                                    this.activeTooltip = tooltipInfo;
                                    this.activeTooltipY = w.last_y !== undefined ? w.last_y : 50;
                                    this.setDirtyCanvas(true, true);
                                    this.hoverTimer = null;
                                }, 800);
                            }
                        });

                        w.inputEl.addEventListener("pointerleave", () => {
                            this.currentHoverTarget = null;
                            if (this.hoverTimer) {
                                clearTimeout(this.hoverTimer);
                                this.hoverTimer = null;
                            }
                            if (this.activeTooltip) {
                                this.activeTooltip = null;
                                this.activeTooltipY = null;
                                this.setDirtyCanvas(true, true);
                            }
                        });
                    }
                }
            }

            if (this.activeTooltip) {
                this._drawTooltip(ctx, this.activeTooltip, this.activeTooltipY);
            }
        };

        // Рисование красивого тултипа со стрелочкой (единый путь)
        proto._drawTooltip = function (ctx, item, wy) {
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
            ctx.strokeStyle = "rgba(0, 255, 70, 0.5)"; // Зеленый цвет
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
});