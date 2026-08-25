import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const COMPARE_HELP_DESCRIPTIONS = [
    {
        name: "mode",
        label: "Mode / Режим сравнения",
        icon: "↔️",
        lines: [
            "Slider: Интерактивный слайдер со шторкой / Interactive wipe slider",
            "Side-by-Side: Полнокадровый просмотр двух фото рядом / Side-by-side full view",
            "Overlap: Наложение с регулируемой прозрачностью / Overlay mode",
            "Difference: Подсветка пиксельных различий / Difference composite",
            "Blink: Поочередное смена кадров / Alternating frame change"
        ]
    },
    {
        name: "opacity",
        label: "Opacity / Прозрачность",
        icon: "🎨",
        lines: [
            "RU: Непрозрачность первого изображения для режима Overlap (0 - прозрачное, 1 - непрозрачное)",
            "EN: Opacity of the first image for Overlap mode (0 - transparent, 1 - opaque)"
        ]
    },
    {
        name: "blink_speed",
        label: "Blink Speed / Скорость мигания",
        icon: "⏱️",
        lines: [
            "RU: Плавное переключение кадров по фазам (1.0 - 3.0 сек)",
            "EN: Smooth phased toggle interval between images (1.0 - 3.0 sec)"
        ]
    },
    {
        name: "zoom_help",
        label: "Zoom & Pan / Навигация",
        icon: "🔍",
        lines: [
            "Alt + Wheel: Зуммирование кадра (1.0x — 10.0x) / Zoom in/out",
            "Middle Click + Drag: Перемещение кадра / Pan image",
            "Double Click: Сброс масштаба и позиции / Reset Zoom & Pan"
        ]
    }
];

app.registerExtension({
    name: "OreX.ImageCompare",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "OreX Image Compare") return;

        // Удаляем встроенные значение tooltip из данных узла
        if (nodeData.input && nodeData.input.required) {
            Object.values(nodeData.input.required).forEach(item => {
                if (Array.isArray(item) && item[1] && typeof item[1] === 'object') {
                    delete item[1].tooltip;
                }
            });
        }

        const proto = nodeType.prototype;
        const onNodeCreated = proto.onNodeCreated;

        proto.onNodeCreated = function () {
            const me = onNodeCreated?.apply(this, arguments);

            this.compareState = {
                sliderPos: 0.5,
                opacity: 0.5,
                img1: null,
                img2: null,
                dim1: null,
                dim2: null,
                zoom: 1.0,
                panX: 0,
                panY: 0,
                isDraggingPan: false,
                lastMousePos: [0, 0]
            };

            this.size = [440, 520];
            this.activeTooltip = null;
            this.activeTooltipY = null;
            this.hoverTimer = null;
            this.lastHoveredWidgetName = null;

            this.getViewerRect = function () {
                let widgetBottom = 30;
                let lastY = 30;
                if (this.widgets && this.widgets.length > 0) {
                    this.widgets.forEach(w => {
                        if (w.last_y !== undefined && w.last_y > lastY) {
                            lastY = w.last_y;
                        }
                    });
                    widgetBottom = lastY > 30 ? lastY + 2 : 30 + this.widgets.length * 25;
                }

                const barY = widgetBottom;
                const dimBarHeight = 13;
                const topMargin = barY + dimBarHeight + 2;
                const bottomMargin = 8;
                const sideMargin = 8;

                const w = this.size[0] - sideMargin * 2;
                const h = this.size[1] - topMargin - bottomMargin;

                if (w <= 0 || h <= 0) return null;
                return { x: sideMargin, y: topMargin, w: w, h: h, barY: barY };
            };

            this._clampPan = function (rect) {
                const st = this.compareState;
                if (st.zoom <= 1.0) {
                    st.panX = 0;
                    st.panY = 0;
                    return;
                }
                const maxPanX = (rect.w * (st.zoom - 1.0)) / 2;
                const maxPanY = (rect.h * (st.zoom - 1.0)) / 2;

                st.panX = Math.max(-maxPanX, Math.min(maxPanX, st.panX));
                st.panY = Math.max(-maxPanY, Math.min(maxPanY, st.panY));
            };

            // Глобальный перехват событий мыши
            const canvasEl = app.canvas?.canvas;
            if (canvasEl && !this._domHandlers) {
                const getLocalPos = (e) => {
                    const bRect = canvasEl.getBoundingClientRect();
                    const x = e.clientX - bRect.left;
                    const y = e.clientY - bRect.top;
                    const graph_pos = app.canvas.convertCanvasToOffset([x, y]);
                    return [graph_pos[0] - this.pos[0], graph_pos[1] - this.pos[1]];
                };

                this._domHandlers = {
                    wheel: (e) => {
                        if (app.canvas.node_over !== this) return;
                        if (!e.altKey) return; // Строго по Alt

                        const [localX, localY] = getLocalPos(e);
                        const rect = this.getViewerRect();

                        if (rect && localX >= rect.x && localX <= rect.x + rect.w && localY >= rect.y && localY <= rect.y + rect.h) {
                            e.preventDefault();
                            e.stopPropagation();
                            e.stopImmediatePropagation();

                            const st = this.compareState;
                            const prevZoom = st.zoom;
                            const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
                            let newZoom = Math.max(1.0, Math.min(10.0, prevZoom * zoomFactor));

                            if (Math.abs(newZoom - 1.0) < 0.001) {
                                newZoom = 1.0;
                                st.panX = 0;
                                st.panY = 0;
                            } else {
                                const centerX = rect.x + rect.w / 2;
                                const centerY = rect.y + rect.h / 2;
                                const mouseRelX = localX - centerX;
                                const mouseRelY = localY - centerY;
                                const scaleRatio = newZoom / prevZoom;
                                st.panX = (st.panX - mouseRelX) * scaleRatio + mouseRelX;
                                st.panY = (st.panY - mouseRelY) * scaleRatio + mouseRelY;
                            }

                            st.zoom = newZoom;
                            this._clampPan(rect);
                            this.setDirtyCanvas(true, true);
                        }
                    },
                    pointerdown: (e) => {
                        if (app.canvas.node_over !== this) return;
                        if (e.button === 1) { // Middle Mouse Button
                            const [localX, localY] = getLocalPos(e);
                            const rect = this.getViewerRect();
                            if (rect && localX >= rect.x && localX <= rect.x + rect.w && localY >= rect.y && localY <= rect.y + rect.h) {
                                const st = this.compareState;
                                if (st.zoom > 1.0) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    e.stopImmediatePropagation();
                                    st.isDraggingPan = true;
                                    st.lastMousePos = [e.clientX, e.clientY];
                                }
                            }
                        }
                    },
                    pointermove: (e) => {
                        const st = this.compareState;
                        if (st.isDraggingPan) {
                            e.preventDefault();
                            e.stopPropagation();
                            e.stopImmediatePropagation();

                            const dx = e.clientX - st.lastMousePos[0];
                            const dy = e.clientY - st.lastMousePos[1];
                            st.lastMousePos = [e.clientX, e.clientY];

                            const canvasScale = app.canvas.ds.scale || 1.0;
                            st.panX += dx / canvasScale;
                            st.panY += dy / canvasScale;

                            const rect = this.getViewerRect();
                            if (rect) this._clampPan(rect);
                            this.setDirtyCanvas(true, true);
                        }
                    },
                    pointerup: (e) => {
                        if (this.compareState.isDraggingPan) {
                            this.compareState.isDraggingPan = false;
                            e.preventDefault();
                            e.stopPropagation();
                            e.stopImmediatePropagation();
                        }
                    },
                    dblclick: (e) => {
                        if (app.canvas.node_over !== this) return;
                        const [localX, localY] = getLocalPos(e);
                        const rect = this.getViewerRect();
                        if (rect && localX >= rect.x && localX <= rect.x + rect.w && localY >= rect.y && localY <= rect.y + rect.h) {
                            e.preventDefault();
                            e.stopPropagation();
                            e.stopImmediatePropagation();
                            this.compareState.zoom = 1.0;
                            this.compareState.panX = 0;
                            this.compareState.panY = 0;
                            this.setDirtyCanvas(true, true);
                        }
                    }
                };

                canvasEl.addEventListener("wheel", this._domHandlers.wheel, { capture: true, passive: false });
                canvasEl.addEventListener("pointerdown", this._domHandlers.pointerdown, { capture: true, passive: false });
                window.addEventListener("pointermove", this._domHandlers.pointermove, { capture: true, passive: false });
                window.addEventListener("pointerup", this._domHandlers.pointerup, { capture: true, passive: false });
                canvasEl.addEventListener("dblclick", this._domHandlers.dblclick, { capture: true, passive: false });
            }

            this.onMouseMove = function (e, pos) {
                const [mx, my] = pos;
                const rect = this.getViewerRect();
                const st = this.compareState;

                // 1. Движение слайдера
                if (rect && (st.img1 || st.img2)) {
                    if (mx >= rect.x && mx <= rect.x + rect.w && my >= rect.y && my <= rect.y + rect.h) {
                        const modeWidget = this.widgets?.find(w => w.name === "mode");
                        const mode = modeWidget ? modeWidget.value : "Slider";

                        if (mode === "Slider" && !st.isDraggingPan) {
                            let relX = (mx - rect.x) / rect.w;
                            st.sliderPos = Math.max(0, Math.min(1, relX));
                            this.setDirtyCanvas(true, true);
                        }
                    }
                }

                // 2. Иконка вопроса (?)
                if (rect) {
                    const btnR = 10;
                    const btnX = rect.x + rect.w - btnR - 6;
                    const btnY = rect.y + btnR + 6;
                    const distSq = (mx - btnX) ** 2 + (my - btnY) ** 2;

                    if (distSq <= btnR ** 2) {
                        if (this.lastHoveredWidgetName !== "zoom_help") {
                            this._clearTooltip();
                            this.lastHoveredWidgetName = "zoom_help";
                            const tooltipInfo = COMPARE_HELP_DESCRIPTIONS.find(i => i.name === "zoom_help");
                            this.activeTooltip = tooltipInfo;
                            this.activeTooltipY = rect.y;
                            this.setDirtyCanvas(true, true);
                        }
                        return false;
                    }
                }

                // 3. Тултипы обычных виджетов
                if (mx < -10 || mx > this.size[0] + 10 || my < -10 || my > this.size[1] + 10) {
                    this._clearTooltip();
                    return false;
                }

                if (this.widgets) {
                    let hoveredWidget = null;
                    for (const w of this.widgets) {
                        if (w.last_y === undefined) continue;
                        const wy = w.last_y;
                        const wh = w.computeSize ? w.computeSize(this.size[0])[1] : (LiteGraph.NODE_WIDGET_HEIGHT || 24);

                        if (my >= wy && my <= wy + wh) {
                            hoveredWidget = w;
                            break;
                        }
                    }

                    if (hoveredWidget) {
                        const wName = (hoveredWidget.name || "").toLowerCase().trim();
                        if (this.lastHoveredWidgetName !== wName) {
                            this._clearTooltip();
                            this.lastHoveredWidgetName = wName;

                            const tooltipInfo = COMPARE_HELP_DESCRIPTIONS.find(item => {
                                const itemName = item.name.toLowerCase();
                                return wName === itemName || (hoveredWidget.label || "").toLowerCase() === itemName;
                            });

                            if (tooltipInfo) {
                                this.hoverTimer = setTimeout(() => {
                                    this.activeTooltip = tooltipInfo;
                                    this.activeTooltipY = hoveredWidget.last_y;
                                    this.setDirtyCanvas(true, true);
                                }, 350);
                            }
                        }
                    } else {
                        this._clearTooltip();
                    }
                }
                return false;
            };

            this._stripNativeTooltips();
            return me;
        };

        const onDestroy = proto.onDestroy;
        proto.onDestroy = function () {
            if (this.hoverTimer) clearTimeout(this.hoverTimer);

            if (this._domHandlers && app.canvas?.canvas) {
                const canvasEl = app.canvas.canvas;
                canvasEl.removeEventListener("wheel", this._domHandlers.wheel, { capture: true });
                canvasEl.removeEventListener("pointerdown", this._domHandlers.pointerdown, { capture: true });
                window.removeEventListener("pointermove", this._domHandlers.pointermove, { capture: true });
                window.removeEventListener("pointerup", this._domHandlers.pointerup, { capture: true });
                canvasEl.removeEventListener("dblclick", this._domHandlers.dblclick, { capture: true });
            }

            if (onDestroy) onDestroy.apply(this, arguments);
        };

        proto.onMouseLeave = function () {
            this._clearTooltip();
        };

        proto._clearTooltip = function () {
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

        proto._stripNativeTooltips = function () {
            if (this.widgets) {
                for (const w of this.widgets) {
                    w.tooltip = null;
                    if (w.options) w.options.tooltip = null;
                    if (w.inputEl) {
                        w.inputEl.title = "";
                        w.inputEl.removeAttribute("title");
                    }
                }
            }
            if (this.inputs) {
                this.inputs.forEach(i => { i.tooltip = null; if (i.options) i.options.tooltip = null; });
            }
            if (this.outputs) {
                this.outputs.forEach(o => { o.tooltip = null; if (o.options) o.options.tooltip = null; });
            }
        };

        const onConfigure = proto.onConfigure;
        proto.onConfigure = function () {
            if (onConfigure) onConfigure.apply(this, arguments);
            this._stripNativeTooltips();
        };

        const onExecuted = proto.onExecuted;
        proto.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            this.imgs = null;

            if (!message?.images) return;

            const st = this.compareState;
            st.img1 = null;
            st.img2 = null;
            st.dim1 = null;
            st.dim2 = null;

            message.images.forEach(imgData => {
                const url = api.apiURL(`/view?filename=${encodeURIComponent(imgData.filename)}&subfolder=${encodeURIComponent(imgData.subfolder)}&type=${imgData.type}`);
                const img = new Image();
                img.src = url;
                img.onload = () => this.setDirtyCanvas(true, true);

                if (imgData.slot === 1) {
                    st.img1 = img;
                    if (imgData.width && imgData.height) st.dim1 = `${imgData.width}×${imgData.height}`;
                }
                if (imgData.slot === 2) {
                    st.img2 = img;
                    if (imgData.width && imgData.height) st.dim2 = `${imgData.width}×${imgData.height}`;
                }
            });
        };

        const onDrawForeground = proto.onDrawForeground;
        proto.onDrawForeground = function (ctx) {
            onDrawForeground?.apply(this, arguments);
            if (this.flags?.collapsed) return;
            this._stripNativeTooltips();
            this.imgs = null;

            const rect = this.getViewerRect();
            if (!rect) return;
            const st = this.compareState;

            ctx.save();
            ctx.font = "11px sans-serif";
            ctx.textBaseline = "top";
            const barY = rect.barY;

            if (st.dim1) {
                ctx.fillStyle = "#38bdf8";
                ctx.fillText(`Image 1  ${st.dim1}`, rect.x, barY);
            }
            if (st.dim2) {
                ctx.fillStyle = "#f43f5e";
                ctx.textAlign = "right";
                ctx.fillText(`${st.dim2}  Image 2`, rect.x + rect.w, barY);
            }
            ctx.restore();

            ctx.save();
            ctx.fillStyle = "#18181c";
            ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

            ctx.beginPath();
            ctx.rect(rect.x, rect.y, rect.w, rect.h);
            ctx.clip();

            const img1 = st.img1;
            const img2 = st.img2;

            if (!img1 && !img2) {
                ctx.fillStyle = "#666666";
                ctx.font = "12px sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("Подключите изображения и запустите схему...", rect.x + rect.w / 2, rect.y + rect.h / 2);
                ctx.restore();
            } else {
                // Применение матрицы трансформации Zoom & Pan
                const viewCenterX = rect.x + rect.w / 2;
                const viewCenterY = rect.y + rect.h / 2;

                ctx.save();
                ctx.translate(viewCenterX + st.panX, viewCenterY + st.panY);
                ctx.scale(st.zoom, st.zoom);
                ctx.translate(-viewCenterX, -viewCenterY);

                const baseImg = img1 || img2;
                const baseW = baseImg.naturalWidth || baseImg.width;
                const baseH = baseImg.naturalHeight || baseImg.height;

                const fitScale = Math.min(rect.w / baseW, rect.h / baseH);
                const drawW = baseW * fitScale;
                const drawH = baseH * fitScale;

                const drawX = rect.x + (rect.w - drawW) / 2;
                const drawY = rect.y + (rect.h - drawH) / 2;

                const modeWidget = this.widgets?.find(w => w.name === "mode");
                const mode = modeWidget ? modeWidget.value : "Slider";
                const opacityWidget = this.widgets?.find(w => w.name === "opacity");
                const opacityVal = opacityWidget ? opacityWidget.value : st.opacity;
                const blinkSpeedWidget = this.widgets?.find(w => w.name === "blink_speed");
                const blinkSpeedVal = blinkSpeedWidget ? blinkSpeedWidget.value : 0.5;

                if (img1 && img2) {
                    if (mode === "Slider") {
                        ctx.drawImage(img1, drawX, drawY, drawW, drawH);

                        const splitX = rect.x + rect.w * st.sliderPos;
                        ctx.save();
                        ctx.beginPath();
                        ctx.rect(splitX, rect.y, rect.x + rect.w - splitX, rect.h);
                        ctx.clip();
                        ctx.drawImage(img2, drawX, drawY, drawW, drawH);
                        ctx.restore();

                        ctx.strokeStyle = "#ffffff";
                        ctx.lineWidth = 1 / st.zoom;
                        ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
                        ctx.shadowBlur = 3;

                        ctx.beginPath();
                        ctx.moveTo(splitX, rect.y);
                        ctx.lineTo(splitX, rect.y + rect.h);
                        ctx.stroke();

                    } else if (mode === "Side-by-Side") {
                        const gap = 2;
                        const halfW = rect.w / 2 - gap / 2;

                        const w1 = img1.naturalWidth || img1.width;
                        const h1 = img1.naturalHeight || img1.height;
                        const fit1 = Math.min(halfW / w1, rect.h / h1);
                        const dW1 = w1 * fit1;
                        const dH1 = h1 * fit1;
                        const dX1 = rect.x + (halfW - dW1) / 2;
                        const dY1 = rect.y + (rect.h - dH1) / 2;

                        ctx.drawImage(img1, dX1, dY1, dW1, dH1);

                        const w2 = img2.naturalWidth || img2.width;
                        const h2 = img2.naturalHeight || img2.height;
                        const fit2 = Math.min(halfW / w2, rect.h / h2);
                        const dW2 = w2 * fit2;
                        const dH2 = h2 * fit2;
                        const dX2 = rect.x + rect.w / 2 + gap / 2 + (halfW - dW2) / 2;
                        const dY2 = rect.y + (rect.h - dH2) / 2;

                        ctx.drawImage(img2, dX2, dY2, dW2, dH2);

                        ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
                        ctx.lineWidth = 1 / st.zoom;
                        ctx.beginPath();
                        ctx.moveTo(rect.x + rect.w / 2, rect.y);
                        ctx.lineTo(rect.x + rect.w / 2, rect.y + rect.h);
                        ctx.stroke();

                    } else if (mode === "Overlap") {
                        ctx.drawImage(img2, drawX, drawY, drawW, drawH);
                        ctx.globalAlpha = Math.max(0, Math.min(1, opacityVal));
                        ctx.drawImage(img1, drawX, drawY, drawW, drawH);
                        ctx.globalAlpha = 1.0;

                    } else if (mode === "Difference") {
                        ctx.drawImage(img1, drawX, drawY, drawW, drawH);
                        ctx.globalCompositeOperation = "difference";
                        ctx.drawImage(img2, drawX, drawY, drawW, drawH);
                        ctx.globalCompositeOperation = "source-over";

                    } else if (mode === "Blink") {
                        const speedSec = Math.max(1.0, blinkSpeedVal);
                        const phaseDurMs = speedSec * 1000;
                        const totalLoopMs = phaseDurMs * 2; // Полный цикл A -> B -> A
                        const elapsed = Date.now() % totalLoopMs;

                        let alpha1 = 1.0;

                        if (elapsed < phaseDurMs) {
                            // Фаза A -> B
                            const t = elapsed / phaseDurMs;
                            if (t < 1 / 3) {
                                alpha1 = 1.0; // 1/3 времени: Первое фото на 100%
                            } else if (t < 2 / 3) {
                                // 1/3 времени: Плавный переход 1.0 -> 0.0
                                const progress = (t - 1 / 3) * 3;
                                alpha1 = 0.5 + 0.5 * Math.cos(progress * Math.PI);
                            } else {
                                alpha1 = 0.0; // 1/3 времени: Второе фото на 100%
                            }
                        } else {
                            // Фаза B -> A
                            const t = (elapsed - phaseDurMs) / phaseDurMs;
                            if (t < 1 / 3) {
                                alpha1 = 0.0; // 1/3 времени: Второе фото на 100%
                            } else if (t < 2 / 3) {
                                // 1/3 времени: Плавный возврат 0.0 -> 1.0
                                const progress = (t - 1 / 3) * 3;
                                alpha1 = 0.5 - 0.5 * Math.cos(progress * Math.PI);
                            } else {
                                alpha1 = 1.0; // 1/3 времени: Первое фото на 100%
                            }
                        }

                        // Отрисовка Image 2 как базового фонового слоя
                        ctx.drawImage(img2, drawX, drawY, drawW, drawH);
                        // Отрисовка Image 1 поверх с вычисленной прозрачностью
                        ctx.globalAlpha = Math.max(0, Math.min(1, alpha1));
                        ctx.drawImage(img1, drawX, drawY, drawW, drawH);
                        ctx.globalAlpha = 1.0;

                        this.setDirtyCanvas(true, true);
                    }
                } else {
                    const targetImg = img1 || img2;
                    if (targetImg) ctx.drawImage(targetImg, drawX, drawY, drawW, drawH);
                }
                ctx.restore(); // Сброс матрицы трансформации

                // Индикатор Zoom
                if (st.zoom > 1.01) {
                    ctx.save();
                    const badgeText = `${st.zoom.toFixed(1)}×`;
                    ctx.font = "bold 10px sans-serif";
                    const tw = ctx.measureText(badgeText).width;
                    const bx = rect.x + rect.w - tw - 36;
                    const by = rect.y + 6;

                    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
                    ctx.beginPath();
                    if (typeof ctx.roundRect === "function") {
                        ctx.roundRect(bx, by, tw + 8, 16, 4);
                    } else {
                        ctx.rect(bx, by, tw + 8, 16);
                    }
                    ctx.fill();

                    ctx.fillStyle = "#38bdf8";
                    ctx.textAlign = "left";
                    ctx.textBaseline = "middle";
                    ctx.fillText(badgeText, bx + 4, by + 8);
                    ctx.restore();
                }

                // Иконка '?'
                ctx.save();
                const btnR = 9;
                const btnX = rect.x + rect.w - btnR - 6;
                const btnY = rect.y + btnR + 6;

                ctx.fillStyle = "rgba(24, 24, 28, 0.75)";
                ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(btnX, btnY, btnR, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = "#ffffff";
                ctx.font = "bold 11px sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("?", btnX, btnY + 0.5);
                ctx.restore();

                ctx.restore(); // Сброс clip
            }

            if (this.activeTooltip) {
                this._drawTooltip(ctx);
            }
        };

        proto._drawTooltip = function (ctx) {
            if (!this.activeTooltip) return;
            const item = this.activeTooltip;
            const wy = this.activeTooltipY !== null ? this.activeTooltipY : 30;

            const margin = 12;
            ctx.save();
            ctx.font = "bold 13px Arial, sans-serif";
            const titleText = `${item.icon || "💡"} ${item.label}`;
            const titleW = ctx.measureText(titleText).width;

            ctx.font = "11px Arial, sans-serif";
            const lines = item.lines || [];
            let maxLineW = 0;
            lines.forEach(line => {
                const w = ctx.measureText(line).width;
                if (w > maxLineW) maxLineW = w;
            });

            const boxW = Math.max(titleW, maxLineW) + margin * 2;
            const boxH = margin * 2 + 18 + (lines.length * 16);

            const bx = this.size[0] + 18;
            const widgetH = LiteGraph.NODE_WIDGET_HEIGHT || 24;
            let by = wy + (widgetH / 2) - (boxH / 2);

            ctx.fillStyle = "rgba(18, 18, 18, 0.98)";
            ctx.strokeStyle = "rgba(56, 189, 248, 0.6)";
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

            ctx.font = "bold 13px Arial, sans-serif";
            ctx.fillStyle = "#ffffff";
            ctx.fillText(titleText, bx + margin, by + margin);

            ctx.font = "11px Arial, sans-serif";
            ctx.fillStyle = "#cccccc";
            let curY = by + margin + 22;
            lines.forEach(line => {
                ctx.fillText(line, bx + margin, curY);
                curY += 16;
            });
            ctx.restore();
        };
    }
});