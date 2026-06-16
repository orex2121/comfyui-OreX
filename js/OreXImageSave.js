import { app } from "../../../scripts/app.js";

const SAVE_HELP_DESCRIPTIONS = [
    { icon: "🟢", name: "active", label: "Active / Активность", desc: "Toggle node activity. If 🔴OFF, image is passed through without saving", ru_desc: "Вкл/Выкл работу узла. Если 🔴OFF, картинка передается дальше" },
    { icon: "📁", name: "output_path", label: "Output Path / Путь сохранения", desc: "Custom folder path (Absolute like E:\\Folder or relative to output)", ru_desc: "Путь к папке (абсолютный вида E:\\Folder или относительно output)" },
    { icon: "📅", name: "create_current_date_folder", label: "Current Date Folder / Папка текущей даты", desc: "🟢ON - Create a subfolder named with current date (YYYY-MM-DD)", ru_desc: "🟢ON - Создавать подпапку с именем текущей даты (ГГГГ-ММ-ДД)" },
    { icon: "📦", name: "create_processed_folder", label: "Processed Folder / Доп. папка", desc: "🟢ON - Create an additional 'Processed' subfolder", ru_desc: "🟢ON - Создавать дополнительную подпапку с именем 'Processed'" },
    { icon: "✍️", name: "filename_prefix_1", label: "Prefix 1 / Префикс 1", desc: "First part of the saved filename", ru_desc: "Первая часть имени сохраняемого файла" },
    { icon: "✍️", name: "filename_prefix_2", label: "Prefix 2 / Префикс 2", desc: "Second part of the saved filename", ru_desc: "Вторая часть имени сохраняемого файла" },
    { icon: "✍️", name: "filename_prefix_3", label: "Prefix 3 / Префикс 3", desc: "Third part of the saved filename", ru_desc: "Третья часть имени сохраняемого файла" },
    { icon: "➖", name: "filename_separator", label: "Separator / Разделитель", desc: "Symbol used to separate filename prefix parts", ru_desc: "Символ-разделитель для разделения частей имени файла" },
    { icon: "🔢", name: "use_counter", label: "Counter (suffix) / Счетчик", desc: "🟢ON - sequence number (0001); 🔴OFF - current time (seconds)", ru_desc: "🟢ON - порядковый номер (0001); 🔴OFF - текущее время (сек)" },
    { icon: "🔌", name: "embed_workflow", label: "Embed Workflow / Схема в файл", desc: "🟢ON - Save the working diagram inside PNG or as separate JSON", ru_desc: "🟢ON - Сохранять рабочую схему внутри PNG или как JSON файл" },
    { icon: "⚙️", name: "image_format", label: "Image Format / Формат файла", desc: "Select output format (PNG, JPG, WEBP)", ru_desc: "Выбор формата выходного файла (PNG, JPG, WEBP)" },
    { icon: "📊", name: "jpg_quality", label: "JPG Quality / Качество JPG", desc: "JPEG image quality slider (50-100)", ru_desc: "Ползунок реулировки качества JPG изображения (50-100)" },
    { icon: "🎯", name: "webp_quality", label: "WebP Qquality / Качество WebP", desc: "WebP image quality slider (50-100)", ru_desc: "Ползунок реулировки качества WebP изображения (50-100)" },
    { icon: "⚡", name: "optimize_png", label: "Optimize PNG / Оптимизация PNG", desc: "🟢ON - Compression using pngquant/oxipng (reduces size 2-4x)", ru_desc: "🟢ON - Сжатие утилитами pngquant/oxipng (уменьшает вес 2-4x)" }
];

app.registerExtension({
    name: "OreXSaveImage.Antigravity.Unique",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        
        if (
            nodeData.name === "OreXImageSave" || 
            nodeData.name === "OreX Image Save" || 
            nodeData.name === "orex Save Image" || 
            nodeData.name === "OreXSaveImage"
        ) {
            
            const proto = nodeType.prototype;
            const onNodeCreated = proto.onNodeCreated;

            proto.color = "#000000";
            proto.bgcolor = "#0f0f0f";

            proto.onNodeCreated = function () {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);
                
                this.color = "#000000";
                this.bgcolor = "#0f0f0f";

                this.activeTooltip = null;
                this.activeTooltipY = null;
                this.hoverTimer = null;
                this.lastHoveredWidgetName = null;
            };

            const onDestroy = proto.onDestroy;
            proto.onDestroy = function () {
                if (this.hoverTimer) clearTimeout(this.hoverTimer);
                if (onDestroy) onDestroy.apply(this, arguments);
            };

            // Отключаем старую логику кликов по заголовку
            proto.onMouseDown = function (e, pos) { return false; };

            // Оптимизированная проверка наведения мыши
            proto.onMouseMove = function (e, pos) {
                const [mx, my] = pos;

                // Сброс при выходе за пределы (с небольшим запасом, чтобы мышь не соскакивала)
                if (mx < -10 || mx > this.size[0] + 10 || my < -10 || my > this.size[1] + 10) {
                    this._clearTooltip();
                    return false;
                }

                if (this.widgets) {
                    let hoveredWidget = null;
                    for (const w of this.widgets) {
                        if (w.last_y === undefined) continue;
                        const wy = w.last_y;
                        const wh = w.computeSize ? w.computeSize(this.size[0])[1] : LiteGraph.NODE_WIDGET_HEIGHT;
                        
                        // Если мышь над виджетом
                        if (my >= wy && my <= wy + wh) {
                            hoveredWidget = w;
                            break;
                        }
                    }

                    if (hoveredWidget) {
                        const wName = (hoveredWidget.name || "").toLowerCase().trim();
                        // Если навели на другой виджет
                        if (this.lastHoveredWidgetName !== wName) {
                            this._clearTooltip();
                            this.lastHoveredWidgetName = wName;

                            const tooltipInfo = SAVE_HELP_DESCRIPTIONS.find(item => {
                                const itemName = item.name.toLowerCase();
                                return wName === itemName || (hoveredWidget.label || "").toLowerCase() === itemName;
                            });

                            if (tooltipInfo) {
                                this.hoverTimer = setTimeout(() => {
                                    this.activeTooltip = tooltipInfo;
                                    this.activeTooltipY = hoveredWidget.last_y;
                                    this.setDirtyCanvas(true, true); // true, true - отрисовка UI поверх графа
                                }, 800); // 800мс ощущается приятнее, чем 1000мс
                            }
                        }
                    } else {
                        this._clearTooltip();
                    }
                }
                return false;
            };

            proto.onMouseLeave = function () {
                this._clearTooltip();
            };

            // Вспомогательная функция очистки тултипа, предотвращающая лишние рендеры
            proto._clearTooltip = function() {
                if (this.hoverTimer) {
                    clearTimeout(this.hoverTimer);
                    this.hoverTimer = null;
                }
                this.lastHoveredWidgetName = null;
                if (this.activeTooltip) {
                    this.activeTooltip = null;
                    this.activeTooltipY = null;
                    this.setDirtyCanvas(true, true);
                }
            };

            // Очищаем DOM-элементы от title ТОЛЬКО при их создании, а не 60 раз в секунду
            const onConfigure = proto.onConfigure;
            proto.onConfigure = function() {
                if (onConfigure) onConfigure.apply(this, arguments);
                this._stripNativeTooltips();
            };

            proto._stripNativeTooltips = function() {
                if (this.widgets) {
                    for (const w of this.widgets) {
                        if (w.tooltip) w.tooltip = null;
                        if (w.inputEl && w.inputEl.title) {
                            w.inputEl.title = "";
                            w.inputEl.removeAttribute("title");
                        }
                    }
                }
                if (this.inputs) this.inputs.forEach(i => i.tooltip = null);
                if (this.outputs) this.outputs.forEach(o => o.tooltip = null);
            };

            proto.onDrawForeground = function (ctx) {
                if (this.flags?.collapsed) return;
                
                // Периодически чистим HTML title, так как ComfyUI иногда пересоздает их
                if (Math.random() < 0.05) this._stripNativeTooltips();

                if (this.activeTooltip) {
                    this._drawTooltip(ctx);
                }
            };

            // Рисование красивого тултипа со стрелочкой (единый путь)
            proto._drawTooltip = function (ctx) {
                if (!this.activeTooltip) return;
                const item = this.activeTooltip;
                const wy = this.activeTooltipY !== null ? this.activeTooltipY : 100;
                
                const margin = 12;
                
                ctx.save();
                
                ctx.font = "bold 13px Arial, sans-serif";
                const titleText = `${item.icon || "💡"} ${item.label}`;
                const titleW = ctx.measureText(titleText).width;
                
                ctx.font = "11px Arial, sans-serif";
                const descText = `EN: ${item.desc}`;
                const ruDescText = `RU: ${item.ru_desc}`;
                const descW = ctx.measureText(descText).width;
                const ruDescW = ctx.measureText(ruDescText).width;
                
                const boxW = Math.max(titleW, descW, ruDescW) + margin * 2;
                const boxH = 74;
                
                // Выносим тултип вправо ЗА ПРЕДЕЛЫ ноды, чтобы стрелочка не перекрывала элементы
                const bx = this.size[0] + 25; 
                
                // Выравниваем по центру относительно наведенного виджета
                const widgetH = LiteGraph.NODE_WIDGET_HEIGHT || 24;
                let by = wy + (widgetH / 2) - (boxH / 2);
                
                ctx.fillStyle = "rgba(18, 18, 18, 0.98)";
                ctx.strokeStyle = "rgba(0, 255, 70, 0.5)"; // Фирменный зеленый цвет
                ctx.lineWidth = 1.5;
                ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
                ctx.shadowBlur = 10;
                ctx.shadowOffsetY = 4;
                
                // --- Отрисовка контура со стрелочкой ---
                const r = 6;             // Радиус скругления углов
                const arrowW = 8;        // Вылет стрелочки влево
                const arrowH = 6;        // Ширина основания стрелочки
                const arrowTipY = boxH / 2; // Стрелка по центру окна тултипа
                
                ctx.beginPath();
                ctx.moveTo(bx + r, by);
                ctx.lineTo(bx + boxW - r, by);
                ctx.arcTo(bx + boxW, by, bx + boxW, by + r, r);
                ctx.lineTo(bx + boxW, by + boxH - r);
                ctx.arcTo(bx + boxW, by + boxH, bx + boxW - r, by + boxH, r);
                ctx.lineTo(bx + r, by + boxH);
                ctx.arcTo(bx, by + boxH, bx, by + boxH - r, r);
                
                // Стрелка (указывает налево)
                ctx.lineTo(bx, by + arrowTipY + arrowH);
                ctx.lineTo(bx - arrowW, by + arrowTipY);
                ctx.lineTo(bx, by + arrowTipY - arrowH);
                
                ctx.lineTo(bx, by + r);
                ctx.arcTo(bx, by, bx + r, by, r);
                ctx.closePath();
                
                ctx.fill();
                ctx.shadowColor = "transparent"; // Отключаем тень для обводки
                ctx.stroke();

                ctx.textBaseline = "top";
                ctx.textAlign = "left";

                ctx.font = "bold 13px Arial, sans-serif";
                ctx.fillStyle = "#ffffff";
                ctx.fillText(titleText, bx + margin, by + margin);

                ctx.font = "11px Arial, sans-serif";
                ctx.fillStyle = "#cccccc";
                ctx.fillText(descText, bx + margin, by + margin + 22);

                ctx.font = "11px Arial, sans-serif";
                ctx.fillStyle = "#999999";
                ctx.fillText(ruDescText, bx + margin, by + margin + 38);

                ctx.restore();
            };
        }
    },

    nodeCreated(node) {
        if (
            node.comfyClass === "OreXImageSave" || 
            node.type === "OreXImageSave" || 
            node.comfyClass === "OreX Image Save" || 
            node.comfyClass === "OreXSaveImage"
        ) {
            node.color = "#000000";
            node.bgcolor = "#0f0f0f";
        }
    }
});