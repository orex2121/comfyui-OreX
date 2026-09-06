import { app } from "../../scripts/app.js";

const VIDEOPREVIEW_HELP_DESCRIPTIONS = [
    { icon: "🖼️", name: "images", label: "Images", desc: "Image sequence input. Has priority over video input.", ru_desc: "Вход секвенции изображений. Имеет приоритет над видео." },
    { icon: "🎬", name: "video", label: "Video", desc: "Video input. Used if images are not connected.", ru_desc: "Вход видео. Используется, если секвенция изображений не подключена." },
    { icon: "🎵", name: "audio", label: "Audio", desc: "Audio input for mixing or replacing the original audio.", ru_desc: "Вход аудио для микширования или замены оригинального звука." },
    { icon: "💾", name: "save_output", label: "Save Output / Сохранение", desc: "🟢ON - Save to output; 🔴OFF - Save to temp (applies 'ultrafast' preset to bypass heavy compression for instant preview)", ru_desc: "🟢ON - Сохранить в output; 🔴OFF - Сохранить в temp (включает пресет 'ultrafast' в обход тяжелого сжатия для мгновенного превью)" },
    { icon: "🧩", name: "embed_workflow", label: "Embed Workflow", desc: "Embed the current ComfyUI workflow metadata into the output file", ru_desc: "Встроить метаданные текущего рабочего процесса ComfyUI в итоговый файл" },
    { icon: "📝", name: "filename_prefix", label: "Filename Prefix", desc: "Prefix for the saved file name", ru_desc: "Префикс для имени сохраняемого файла" },
    { icon: "⏱️", name: "fps_for_images", label: "FPS for Images", desc: "Frame rate (FPS). Applies only when using 'images' input", ru_desc: "Частота кадров (FPS). Применяется только при использовании входа 'images'" },
    { icon: "📦", name: "format", label: "Format / Контейнер", desc: "Video container format (e.g., MP4, WebM, MKV)", ru_desc: "Формат контейнера видео (например, MP4, WebM, MKV)" },
    { icon: "🗜️", name: "codec", label: "Codec / Кодек", desc: "Video encoding codec. 'auto' selects based on format", ru_desc: "Кодек видео. 'auto' выбирает оптимальный на основе формата контейнера" },
    { icon: "🌈", name: "bit_depth", label: "Bit Depth / Глубина цвета", desc: "Color bit depth. Auto uses 8-bit for sRGB and 10-bit for HDR", ru_desc: "Глубина цвета. Auto использует 8-бит для sRGB и 10-бит для HDR" },
    { icon: "🎨", name: "color_space", label: "Color Space", desc: "Colorspace of the input images/video", ru_desc: "Цветовое пространство входных изображений или видео" },
    { icon: "📏", name: "resolution", label: "Resolution / Разрешение", desc: "Scale video to this resolution while maintaining aspect ratio", ru_desc: "Масштабирование видео до указанного разрешения с сохранением пропорций" },
    { icon: "🎚️", name: "audio_mix", label: "Audio Mix / Громкость", desc: "Volume percentage of the input audio (0-100%)", ru_desc: "Процент громкости подключенного внешнего аудио (0-100%)" }
];

app.registerExtension({
    name: "OreXVideoPreview.Antigravity.Unique",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        
        if (!nodeData.name || nodeData.name !== "OreX Video Preview") return;

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
                tooltipInfo = VIDEOPREVIEW_HELP_DESCRIPTIONS.find(item => {
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

            if (this.widgets) {
                for (const w of this.widgets) {
                    if (w.inputEl && !w.inputEl._hasTooltipListeners) {
                        w.inputEl._hasTooltipListeners = true;
                        
                        w.inputEl.addEventListener("pointerenter", () => {
                            const tooltipInfo = VIDEOPREVIEW_HELP_DESCRIPTIONS.find(item => {
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
                this._drawTooltip(ctx);
            }
        };

        proto._drawTooltip = function (ctx) {
            if (!this.activeTooltip) return;
            const item = this.activeTooltip;
            const wy = this.activeTooltipY !== null ? this.activeTooltipY : 100;
            
            const margin = 12;
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
            ctx.strokeStyle = "rgba(0, 255, 70, 0.5)";
            ctx.lineWidth = 1.5;
            ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
            ctx.shadowBlur = 10;
            ctx.shadowOffsetY = 4;
            
            const r = 6;
            const arrowW = 8;
            const arrowH = 6;
            const arrowTipY = boxH / 2;
            
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
            ctx.shadowColor = "transparent";
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
});