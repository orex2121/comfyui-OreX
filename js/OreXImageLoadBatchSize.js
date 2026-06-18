import { app } from "../../scripts/app.js";

const BATCH_SIZE_HELP_DESCRIPTIONS = [
    { keys: ["folder path"], icon: "📁", label: "folder path / путь к папке", desc: "Absolute directory path or relative path inside ComfyUI/input/", ru_desc: "Абсолютный путь к папке с картинками или относительный внутри каталога ComfyUI/input/" },
    { keys: ["file pattern"], icon: "🔍", label: "file pattern / шаблон имен", desc: "Filter format (* for all, *upscale*.png, or specific naming rules)", ru_desc: "Фильтр имен файлов (например, * для всех, или *.png, поддерживается регистронезависимый fnmatch)" },
    { keys: ["batch size"], icon: "📦", label: "batch size / размер пачки", desc: "Number of images to load simultaneously into a list (1-1000)", ru_desc: "Количество изображений, загружаемых одновременно списком за один шаг генерации" },
    { keys: ["start index"], icon: "🔢", label: "start index / начальный индекс", desc: "The file index from which loading begins (the countdown starts from zero)", ru_desc: "Индекс файла, с которого начинается чтение (отсчет начинается с нуля)" },
    { keys: ["label"], icon: "🏷️", label: "label / идентификатор сессии", desc: "Change this name to force rescan the folder and pick up new files", ru_desc: "Измените это имя, чтобы заново просканировать папку и подхватить новые файлы" },
    { keys: ["file name without extension", "without expansion"], icon: "📛", label: "without expansion / без расширения", desc: "Strip extensions (.png, .jpg) from the output filename text list", ru_desc: "🟢ON: Удалять расширения файлов в выходном текстовом списке | 🔴OFF: Оставить как есть" },
    { keys: ["seed"], icon: "🎲", label: "seed / сид перезапуска", desc: "Changes node state execution to force image list reloading and recalculation.", ru_desc: "Сид для обновления состояния работы узла и принудительного перезапуска чтения списка изображений." },
    { keys: ["control before generate", "control after generate"], icon: "🔄", label: "behavior of the seed / поведение сида", desc: "Determines the behavior of the seed before generation. (Do not select the fixed mode!)", ru_desc: "Определяет поведение сида перед генерацией. (Не выбирать режим fixed!)" }
];

app.registerExtension({
    name: "OreXImageLoadBatchSize.HelpPanel.Unique",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        
        if (nodeData.name === "orex Load Image Batch Size" || 
            nodeData.name === "OreXImageLoadBatchSize" || 
            nodeData.name === "OreX Load Image Batch Size") {

            const proto = nodeType.prototype;
            
            const originalOnNodeCreated = proto.onNodeCreated;
            const originalOnMouseMove = proto.onMouseMove;
            const originalOnMouseLeave = proto.onMouseLeave;
            const originalOnDrawForeground = proto.onDrawForeground;

            proto.onNodeCreated = function () {
                if (originalOnNodeCreated) originalOnNodeCreated.apply(this, arguments);
                
                this.color = "#0096ff";
                this.bgcolor = "#0096ff"; 
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

            proto.onMouseMove = function (e, pos, canvas) {
                // ИСПРАВЛЕНИЕ ЗАВИСАНИЙ: Обязательно сохраняем и возвращаем результат выполнения оригинального метода
                let r = false;
                if (originalOnMouseMove) {
                    r = originalOnMouseMove.apply(this, arguments);
                }

                if (!pos || !this.size) return r;
                const [mx, my] = pos;

                // Проверка выхода за пределы с запасом
                if (mx < -10 || mx > this.size[0] + 10 || my < -10 || my > this.size[1] + 10) {
                    this._clearTooltip();
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

                // Убираем системные title
                if (hoveredWidget && app.canvas && app.canvas.canvas) {
                    app.canvas.canvas.title = "";
                }

                let tooltipInfo = null;
                if (hoveredWidget) {
                    const wName = (hoveredWidget.name || "").toLowerCase().trim().replace(/_/g, " ");
                    const wLabel = (hoveredWidget.label || "").toLowerCase().trim().replace(/_/g, " ");
                    
                    tooltipInfo = BATCH_SIZE_HELP_DESCRIPTIONS.find(item => {
                        return item.keys.some(key => wName === key || wLabel === key);
                    });
                }

                if (this.currentHoverTarget !== tooltipInfo) {
                    this.currentHoverTarget = tooltipInfo;
                    
                    if (this.hoverTimer) {
                        clearTimeout(this.hoverTimer);
                        this.hoverTimer = null;
                    }

                    if (!tooltipInfo) {
                        this._clearTooltip();
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
                
                return r; // Возвращаем r, чтобы LiteGraph понимал, что событие обработано!
            };

            proto._clearTooltip = function() {
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

            proto.onMouseLeave = function () {
                if (originalOnMouseLeave) originalOnMouseLeave.apply(this, arguments);
                this._clearTooltip();
            };

            proto.onDrawForeground = function (ctx) {
                if (originalOnDrawForeground) originalOnDrawForeground.apply(this, arguments);
                if (this.flags?.collapsed) return;

                // DOM-элементы (для путей, строковых полей)
                if (this.widgets) {
                    for (const w of this.widgets) {
                        if (w.inputEl && !w.inputEl._hasTooltipListeners) {
                            w.inputEl._hasTooltipListeners = true;
                            
                            w.inputEl.addEventListener("pointerenter", () => {
                                const wName = (w.name || "").toLowerCase().trim().replace(/_/g, " ");
                                const wLabel = (w.label || "").toLowerCase().trim().replace(/_/g, " ");
                                
                                const tooltipInfo = BATCH_SIZE_HELP_DESCRIPTIONS.find(item => {
                                    return item.keys.some(key => wName === key || wLabel === key);
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
                                this._clearTooltip();
                            });
                        }
                    }
                }

                if (this.activeTooltip && ctx) {
                    this._drawTooltip(ctx);
                }
            };

            // === Продвинутая отрисовка тултипа со стрелочкой (arcTo) ===
            proto._drawTooltip = function (ctx) {
                if (!this.activeTooltip || !this.size || !this.size[0]) return;
                
                const item = this.activeTooltip;
                const wy = this.activeTooltipY !== null ? this.activeTooltipY : 100;
                
                const margin = 12;
                
                // Отодвигаем от ноды
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
                ctx.strokeStyle = "rgba(0, 150, 255, 0.7)"; // Фирменный синий
                ctx.lineWidth = 1.5;
                ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
                ctx.shadowBlur = 10;
                ctx.shadowOffsetY = 4;
                
                // Отрисовка контура
                const r = 6;             // Скругления
                const arrowW = 8;        // Вылет влево
                const arrowH = 6;        // Ширина основания
                const arrowTipY = boxH / 2; // Центр
                
                ctx.beginPath();
                ctx.moveTo(bx + r, by);
                
                ctx.lineTo(bx + boxW - r, by);
                ctx.arcTo(bx + boxW, by, bx + boxW, by + r, r);
                
                ctx.lineTo(bx + boxW, by + boxH - r);
                ctx.arcTo(bx + boxW, by + boxH, bx + boxW - r, by + boxH, r);
                
                ctx.lineTo(bx + r, by + boxH);
                ctx.arcTo(bx, by + boxH, bx, by + boxH - r, r);
                
                ctx.lineTo(bx, by + arrowTipY + arrowH);
                ctx.lineTo(bx - arrowW, by + arrowTipY);
                ctx.lineTo(bx, by + arrowTipY - arrowH);
                
                ctx.lineTo(bx, by + r);
                ctx.arcTo(bx, by, bx + r, by, r);
                ctx.closePath();
                
                ctx.fill();
                ctx.shadowColor = "transparent"; // Убираем тень, чтобы рамка не мазалась
                ctx.stroke();

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