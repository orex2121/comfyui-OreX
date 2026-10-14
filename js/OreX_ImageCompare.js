import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

// Зазор (px) между половинами в режиме Side-by-Side — общая константа для
// отрисовки и для расчёта зума/панорамирования, чтобы значения не разошлись.
const SBS_GAP = 2;

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
    },
    {
        name: "save_btn",
        label: "Save Current View / Сохранить текущий вид",
        icon: "💾",
        lines: [
            "RU: Сохраняет ИМЕННО текущий режим и текущий вид (позиция слайдера, zoom, pan). Без подключённого output_path — в output/<дата>/<режим>/. С подключённым output_path — в <путь>/<режим>/ (без даты). Для Blink — GIF с плавным кроссфейдом (фиксированный цикл A→B→A, независимо от виджета blink_speed).",
            "EN: Saves the CURRENT mode and current view (slider position, zoom, pan). Without output_path connected — to output/<date>/<mode>/. With output_path connected — to <path>/<mode>/ (no date). For Blink — a GIF with a smooth crossfade (fixed A→B→A loop, independent of the blink_speed widget)."
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
                lastMousePos: [0, 0],
                meta1: null,
                meta2: null,
                outputPath: "",
                // Точка фокуса (0..1 от размера картинки) для независимого
                // зума половин в Side-by-Side — общая для обеих половин,
                // чтобы при увеличении было видно одно и то же место.
                sbsFocusU: 0.5,
                sbsFocusV: 0.5
            };

            this.size = [440, 520];

            this._saveBtnWidget = this.addWidget(
                "button",
                "💾 Сохранить текущий вид",
                null,
                () => this._saveCompareOutput()
            );
            this._saveBtnWidget.tooltipKey = "save_btn";

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

            this._getMode = function () {
                const w = this.widgets?.find(w => w.name === "mode");
                return w ? w.value : "Slider";
            };

            // Геометрия половины Side-by-Side для конкретного изображения:
            // ширина половины, её левый край (boxX) и масштаб вписывания.
            // Используется и отрисовкой, и обработчиками зума/панорамирования —
            // чтобы расчёты точки фокуса всегда совпадали с тем, что на экране.
            this._sbsHalfLayout = function (rect, img, boxX) {
                const halfW = rect.w / 2 - SBS_GAP / 2;
                // Общий холст (максимум по ширине и высоте обоих изображений) —
                // обе половины используют одинаковую геометрию, меньшее
                // изображение вписывается внутрь холста без растягивания.
                const cd = this._canvasDims();
                const iw = cd.w;
                const ih = cd.h;
                const fitScale = Math.min(halfW / iw, rect.h / ih);
                return {
                    halfW, iw, ih, fitScale,
                    halfCenterX: boxX + halfW / 2,
                    halfCenterY: rect.y + rect.h / 2
                };
            };

            // Определяет, над какой половиной (и над каким изображением)
            // сейчас курсор, для расчёта точки фокуса зума.
            this._sbsHalfAt = function (rect, localX) {
                const st = this.compareState;
                const seamX = rect.x + rect.w / 2;
                if (localX < seamX) {
                    return st.img1 ? { img: st.img1, boxX: rect.x } : null;
                }
                return st.img2 ? { img: st.img2, boxX: seamX + SBS_GAP / 2 } : null;
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
                            const mode = this._getMode();

                            if (mode === "Side-by-Side") {
                                if (Math.abs(newZoom - 1.0) < 0.001) {
                                    newZoom = 1.0;
                                    st.sbsFocusU = 0.5;
                                    st.sbsFocusV = 0.5;
                                } else {
                                    const half = this._sbsHalfAt(rect, localX);
                                    if (half) {
                                        const { halfCenterX, halfCenterY, iw, ih, fitScale } = this._sbsHalfLayout(rect, half.img, half.boxX);
                                        const effOld = fitScale * prevZoom;

                                        // Точка изображения (0..1), которая сейчас под курсором
                                        const uCursor = st.sbsFocusU + (localX - halfCenterX) / (iw * effOld);
                                        const vCursor = st.sbsFocusV + (localY - halfCenterY) / (ih * effOld);

                                        const effNew = fitScale * newZoom;
                                        // Подбираем новый фокус так, чтобы та же точка осталась под курсором
                                        st.sbsFocusU = uCursor - (localX - halfCenterX) / (iw * effNew);
                                        st.sbsFocusV = vCursor - (localY - halfCenterY) / (ih * effNew);

                                        st.sbsFocusU = Math.max(0, Math.min(1, st.sbsFocusU));
                                        st.sbsFocusV = Math.max(0, Math.min(1, st.sbsFocusV));
                                    }
                                }
                            } else {
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
                                this._clampPan(rect);
                            }

                            st.zoom = newZoom;
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
                            const rect = this.getViewerRect();
                            const mode = this._getMode();

                            if (mode === "Side-by-Side") {
                                const img = st.img1 || st.img2;
                                if (rect && img) {
                                    const boxX = st.img1 ? rect.x : (rect.x + rect.w / 2 + SBS_GAP / 2);
                                    const { iw, ih, fitScale } = this._sbsHalfLayout(rect, img, boxX);
                                    const effScale = fitScale * st.zoom;

                                    st.sbsFocusU -= (dx / canvasScale) / (iw * effScale);
                                    st.sbsFocusV -= (dy / canvasScale) / (ih * effScale);
                                    st.sbsFocusU = Math.max(0, Math.min(1, st.sbsFocusU));
                                    st.sbsFocusV = Math.max(0, Math.min(1, st.sbsFocusV));
                                }
                            } else {
                                st.panX += dx / canvasScale;
                                st.panY += dy / canvasScale;
                                if (rect) this._clampPan(rect);
                            }

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
                            this.compareState.sbsFocusU = 0.5;
                            this.compareState.sbsFocusV = 0.5;
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
                            // Курсор (mx) — это координата в системе координат
                            // ОТРИСОВАННОГО (уже зумленного/панорамированного)
                            // изображения, а splitX/sliderPos живут в исходной,
                            // "дозумовой" системе координат. Отрисовка линии
                            // проходит через ту же трансформацию zoom/pan, что
                            // и картинка — значит, курсор нужно обратно
                            // пересчитать через ту же трансформацию, иначе на
                            // зуме и при sliderPos far from center линия и
                            // курсор расходятся.
                            const viewCenterX = rect.x + rect.w / 2;
                            const splitXFromCursor = viewCenterX + (mx - viewCenterX - st.panX) / st.zoom;
                            let relX = (splitXFromCursor - rect.x) / rect.w;
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
                                return wName === itemName
                                    || (hoveredWidget.label || "").toLowerCase() === itemName
                                    || (hoveredWidget.tooltipKey || "") === item.name;
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
            st.meta1 = null;
            st.meta2 = null;
            st.layout = null;
            st.alignInfo = "";

            // Путь для сохранения (если подключён вход output_path) —
            // становится известен только после выполнения графа.
            st.outputPath = (message.output_path && message.output_path[0]) ? message.output_path[0] : "";

            const loadPromises = [];
            message.images.forEach(imgData => {
                const url = api.apiURL(`/view?filename=${encodeURIComponent(imgData.filename)}&subfolder=${encodeURIComponent(imgData.subfolder)}&type=${imgData.type}`);
                const img = new Image();
                img.src = url;
                img.onload = () => this.setDirtyCanvas(true, true);
                loadPromises.push(new Promise(res => {
                    img.addEventListener("load", res, { once: true });
                    img.addEventListener("error", res, { once: true });
                }));

                const meta = { filename: imgData.filename, subfolder: imgData.subfolder, type: imgData.type };

                if (imgData.slot === 1) {
                    st.img1 = img;
                    st.meta1 = meta;
                    if (imgData.width && imgData.height) st.dim1 = `${imgData.width}×${imgData.height}`;
                }
                if (imgData.slot === 2) {
                    st.img2 = img;
                    st.meta2 = meta;
                    if (imgData.width && imgData.height) st.dim2 = `${imgData.width}×${imgData.height}`;
                }
            });

            // Когда обе картинки загружены — ищем, где неизменённая часть
            // (Image 1 и Image 2 могут быть разного размера, например аутпейнт).
            const a = st.img1, b = st.img2;
            Promise.all(loadPromises).then(() => {
                if (st.img1 !== a || st.img2 !== b) return; // пришёл новый запуск
                setTimeout(() => {
                    if (st.img1 !== a || st.img2 !== b) return;
                    this._computeLayout();
                    this.setDirtyCanvas(true, true);
                }, 0);
            });
        };

        // Общая отрисовка композита текущего режима в произвольный ctx/rect.
        // Используется и для живого превью (onDrawForeground), и для захвата
        // "как видишь" при сохранении по кнопке (offscreen-канвас).
        // Side-by-Side отрисовывается ОТДЕЛЬНО от остальных режимов: каждая
        // половина зумится независимо вокруг общей точки фокуса (в
        // нормализованных 0..1 координатах картинки), а не через единую
        // трансформацию на весь rect (как раньше) — иначе при зуме "плыло"
        // относительное положение картинок друг к другу и терялась привязка
        // к одному и тому же месту на фото.
        // Раскладка двух изображений на общем холсте. Находится в
        // st.layout (считает _computeLayout): одно изображение — опорное
        // (большее, масштаб 1), второе — меньшее, оно сдвинуто на (ox, oy)
        // и масштабировано в k раз, чтобы его содержимое совпало с опорным.
        // Пока раскладка не найдена (или совпадения нет) — меньшее
        // изображение центрируется в натуральном масштабе.
        // Возвращает размер холста и позиции/масштабы обоих изображений.
        proto._layout = function (img1, img2) {
            const st = this.compareState;
            const a = img1 !== undefined ? img1 : st.img1;
            const b = img2 !== undefined ? img2 : st.img2;
            const sz = (i) => i ? { w: i.naturalWidth || i.width, h: i.naturalHeight || i.height } : null;
            const sa = sz(a), sb = sz(b);
            if (!sa || !sb) {
                const one = sa || sb;
                return {
                    w: one.w, h: one.h,
                    p1: { x: 0, y: 0, s: 1 }, p2: { x: 0, y: 0, s: 1 }
                };
            }
            let rA, rB;
            const L = st.layout;
            if (L && L.img1 === a && L.img2 === b) {
                if (L.refIs1) {
                    rA = { x: 0, y: 0, w: sa.w, h: sa.h, s: 1 };
                    rB = { x: L.ox, y: L.oy, w: sb.w * L.k, h: sb.h * L.k, s: L.k };
                } else {
                    rB = { x: 0, y: 0, w: sb.w, h: sb.h, s: 1 };
                    rA = { x: L.ox, y: L.oy, w: sa.w * L.k, h: sa.h * L.k, s: L.k };
                }
            } else {
                rA = { x: 0, y: 0, w: sa.w, h: sa.h, s: 1 };
                rB = {
                    x: Math.round((sa.w - sb.w) / 2),
                    y: Math.round((sa.h - sb.h) / 2),
                    w: sb.w, h: sb.h, s: 1
                };
            }
            const minX = Math.min(rA.x, rB.x), maxX = Math.max(rA.x + rA.w, rB.x + rB.w);
            const minY = Math.min(rA.y, rB.y), maxY = Math.max(rA.y + rA.h, rB.y + rB.h);
            return {
                w: Math.ceil(maxX - minX),
                h: Math.ceil(maxY - minY),
                p1: { x: rA.x - minX, y: rA.y - minY, s: rA.s },
                p2: { x: rB.x - minX, y: rB.y - minY, s: rB.s }
            };
        };

        proto._canvasDims = function (img1, img2) {
            const l = this._layout(img1, img2);
            return { w: l.w, h: l.h };
        };

        // Поиск положения и масштаба меньшего изображения (mov) относительно
        // опорного (ref) по совпадению пикселей общей (неизменённой) части.
        // Поиск идёт «пирамидой»: грубо на малых копиях (перебор масштаба и
        // смещения), затем уточнение на среднем размере и на оригинале.
        // Возвращает { ox, oy, k, err }: левый верхний угол mov в координатах
        // ref и коэффициент масштаба mov. grayFnOverride нужен только тестам.
        proto._autoAlign = function (ref, mov, grayFnOverride) {
            const dimsOf = (i) => ({ w: i.naturalWidth || i.width, h: i.naturalHeight || i.height });
            const R = dimsOf(ref), M = dimsOf(mov);
            if (R.w === M.w && R.h === M.h) return { ox: 0, oy: 0, k: 1, err: 0 };

            // Структурный слой: вычитаем локальное среднее (убирает общую
            // яркость/тон и плавные пятна), выбросы (трещины, засветы)
            // ограничиваем. Так сравнивается форма (контуры, лицо), а не цвет.
            // Радиус считается от размера опорного изображения на текущем
            // уровне пирамиды, чтобы оба изображения обрабатывались одинаково.
            const prep = (r, rad) => {
                const { w, h, g } = r;
                const iw = w + 1;
                const I = new Float64Array(iw * (h + 1));
                for (let y = 0; y < h; y++) {
                    let row = 0;
                    for (let x = 0; x < w; x++) {
                        row += g[y * w + x];
                        I[(y + 1) * iw + x + 1] = I[y * iw + x + 1] + row;
                    }
                }
                const out = new Float32Array(w * h);
                let sum = 0, sum2 = 0;
                for (let y = 0; y < h; y++) {
                    const y0 = Math.max(0, y - rad), y1 = Math.min(h, y + rad + 1);
                    for (let x = 0; x < w; x++) {
                        const x0 = Math.max(0, x - rad), x1 = Math.min(w, x + rad + 1);
                        const area = (x1 - x0) * (y1 - y0);
                        const m = (I[y1 * iw + x1] - I[y0 * iw + x1] - I[y1 * iw + x0] + I[y0 * iw + x0]) / area;
                        const v = g[y * w + x] - m;
                        out[y * w + x] = v;
                        sum += v; sum2 += v * v;
                    }
                }
                const n = w * h;
                const sd = Math.sqrt(Math.max(1e-6, sum2 / n - (sum / n) * (sum / n)));
                const c = 2.5 * sd;
                for (let i = 0; i < n; i++) {
                    out[i] = out[i] > c ? c : (out[i] < -c ? -c : out[i]);
                }
                return { w, h, g: out };
            };

            const grayRaw = grayFnOverride || ((img, s) => {
                const d0 = dimsOf(img);
                const w = Math.max(1, Math.round(d0.w * s));
                const h = Math.max(1, Math.round(d0.h * s));
                const c = document.createElement("canvas");
                c.width = w; c.height = h;
                const x = c.getContext("2d", { willReadFrequently: true });
                x.imageSmoothingEnabled = true;
                x.imageSmoothingQuality = "high";
                x.drawImage(img, 0, 0, w, h);
                const d = x.getImageData(0, 0, w, h).data;
                const g = new Float32Array(w * h);
                for (let i = 0, j = 0; i < g.length; i++, j += 4) {
                    g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
                }
                return { w, h, g };
            });
            const gray = (img, s, refScale) =>
                prep(grayRaw(img, s), Math.max(2, Math.round(0.02 * Math.min(R.w, R.h) * refScale)));

            const search = (A, B, oxMin, oxMax, oyMin, oyMax, samples, stepO) => {
                let best = null;
                stepO = stepO || 1;
                for (let oy = oyMin; oy <= oyMax; oy += stepO) {
                    for (let ox = oxMin; ox <= oxMax; ox += stepO) {
                        const x0 = Math.max(0, ox), x1 = Math.min(A.w, ox + B.w);
                        const y0 = Math.max(0, oy), y1 = Math.min(A.h, oy + B.h);
                        const ow = x1 - x0, oh = y1 - y0;
                        if (ow < 8 || oh < 8) continue;
                        // Общая часть должна составлять не меньше половины
                        // площади меньшего из двух изображений (иначе —
                        // случайные совпадения). Меньшее изображение может
                        // оказаться и больше опорного после подгонки масштаба
                        // (если оно содержит нарощенные области).
                        if (ow * oh < 0.5 * Math.min(A.w * A.h, B.w * B.h)) continue;
                        const step = Math.max(1, Math.floor(Math.sqrt(ow * oh / samples)));
                        // Нормированная взаимная корреляция (NCC): не зависит от
                        // яркости/контраста, поэтому находит совпадение и у
                        // отреставрированного/перекрашенного варианта.
                        let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
                        for (let y = y0; y < y1; y += step) {
                            const ra = y * A.w;
                            const rb = (y - oy) * B.w - ox;
                            for (let x = x0; x < x1; x += step) {
                                const va = A.g[ra + x], vb = B.g[rb + x];
                                sa += va; sb += vb;
                                saa += va * va; sbb += vb * vb; sab += va * vb;
                                n++;
                            }
                        }
                        const cov = sab - sa * sb / n;
                        const varA = saa - sa * sa / n;
                        const varB = sbb - sb * sb / n;
                        const ncc = (varA > 1e-3 && varB > 1e-3) ? cov / Math.sqrt(varA * varB) : 0;
                        const err = (1 - ncc) * 100; // 0 — идеальное совпадение
                        if (!best || err < best.err) best = { ox, oy, err };
                    }
                }
                return best;
            };

            const rng = (dA, dB) => [Math.min(0, dA - dB), Math.max(0, dA - dB)];

            // Перебор смещений для заданного масштаба mov (k).
            // cx, cy, rad заданы — локальный поиск вокруг центра;
            // иначе — по всему допустимому диапазону (с шагом для скорости).
            const trial = (A, scale, k, samples, cx, cy, rad) => {
                const B = gray(mov, scale * k, scale);
                if (B.w * B.h < 0.1 * A.w * A.h) return null; // слишком мелко — случайные совпадения
                const [xMin, xMax] = rng(A.w, B.w);
                const [yMin, yMax] = rng(A.h, B.h);
                let r, stepO = 1;
                if (cx === undefined) {
                    stepO = Math.max(1, Math.ceil(Math.max(xMax - xMin, yMax - yMin) / 40));
                    r = search(A, B, xMin, xMax, yMin, yMax, samples, stepO);
                } else {
                    r = search(
                        A, B,
                        Math.max(xMin, cx - rad), Math.min(xMax, cx + rad),
                        Math.max(yMin, cy - rad), Math.min(yMax, cy + rad),
                        samples, 1
                    );
                }
                return r ? { ox: r.ox, oy: r.oy, err: r.err, k, stepO } : null;
            };

            const m = Math.max(R.w, R.h);
            const cs = Math.min(1, 160 / m);   // грубый уровень
            const ms = Math.min(1, 800 / m);   // средний уровень

            // --- 1. Грубо: перебор масштаба k (0.33 … 3.0) и смещения
            const cA = gray(ref, cs, cs);
            const ks = [1];
            for (let k = 0.33; k <= 3.0; k *= 1.03) ks.push(k);
            const results = [];
            let r1 = null;
            for (const k of ks) {
                const r = trial(cA, cs, k, 1200);
                if (!r) continue;
                if (k === 1) r1 = r;
                results.push(r);
            }
            if (!results.length) return null;
            results.sort((p, q) => p.err - q.err);

            // Масштаб 1 предпочтителен, если он не заметно хуже лучшего.
            // Иначе к нему добавляются до трёх лучших «кандидатов» с заметно
            // разными масштабами; выбор — по итогам уточнения.
            let cands = [];
            if (r1) cands.push({ ...r1, unit: true });
            if (!(r1 && r1.err <= results[0].err + 1.5)) {
                const others = [];
                for (const r of results) {
                    if (others.length >= 3) break;
                    if (r.k === 1) continue;
                    if (others.every(c => Math.abs(Math.log(c.k / r.k)) > 0.08)) {
                        others.push({ ...r, unit: false });
                    }
                }
                cands = cands.concat(others);
            }

            let mA = null, fA = null;
            const refine = (c) => {
                let cur = c, kc = c.k;

                // --- 2. Грубо: уточнение масштаба (шаг 0.6 %) для не-единичного k
                if (!c.unit) {
                    let b2 = cur;
                    for (let i = 0; i <= 10; i++) {
                        const k = c.k * (0.97 + 0.006 * i);
                        const r = trial(cA, cs, k, 1200, c.ox, c.oy, c.stepO + 3);
                        if (r && r.err < b2.err) b2 = r;
                    }
                    cur = b2; kc = b2.k;
                }

                // --- 3. Средний уровень: масштаб (шаг 0.12 %) и смещение
                if (!mA) mA = gray(ref, ms, ms);
                const f1 = ms / cs;
                let cx = Math.round(cur.ox * f1), cy = Math.round(cur.oy * f1);
                const rad1 = Math.ceil(f1) * (c.unit ? cur.stepO : 2) + 6;
                let mb = null;
                const kList1 = c.unit ? [1] : Array.from({ length: 11 }, (_, i) => kc * (1 + (i - 5) * 0.0012));
                for (const k of kList1) {
                    const r = trial(mA, ms, k, 3000, cx, cy, rad1);
                    if (r && (!mb || r.err < mb.err)) mb = r;
                }
                if (!mb) return null;

                // --- 4. Полный размер: итоговое смещение (и масштаб, шаг 0.06 %)
                if (!fA) fA = gray(ref, 1, 1);
                const f2 = 1 / ms;
                cx = Math.round(mb.ox * f2); cy = Math.round(mb.oy * f2);
                const rad2 = Math.ceil(f2) * 2 + 6;
                let fb = null;
                const kList2 = c.unit ? [1] : Array.from({ length: 5 }, (_, i) => mb.k * (1 + (i - 2) * 0.0006));
                for (const k of kList2) {
                    const r = trial(fA, 1, k, 6000, cx, cy, rad2);
                    if (r && (!fb || r.err < fb.err)) fb = r;
                }
                return fb ? { ox: fb.ox, oy: fb.oy, k: fb.k, err: fb.err } : null;
            };

            let final = null, unitRes = null;
            for (const c of cands) {
                const f = refine(c);
                if (!f) continue;
                if (c.unit) unitRes = f;
                if (!final || f.err < final.err) final = f;
            }
            // Ровный масштаб 1 побеждает, если он не заметно хуже лучшего
            if (unitRes && final && unitRes.err <= final.err + 1.5) final = unitRes;
            return final;
        };

        // Считает раскладку для текущей пары изображений (после загрузки).
        proto._computeLayout = function () {
            const st = this.compareState;
            const a = st.img1, b = st.img2;
            st.layout = null;
            st.alignInfo = "";
            if (!a || !b) return;
            const wA = a.naturalWidth || a.width, hA = a.naturalHeight || a.height;
            const wB = b.naturalWidth || b.width, hB = b.naturalHeight || b.height;
            if (wA === wB && hA === hB) return; // размеры равны — выравнивать нечего
            try {
                // Опорное — большее по площади (масштаб 1); меньшее
                // подгоняется к нему по положению и масштабу.
                const refIs1 = wA * hA >= wB * hB;
                const res = this._autoAlign(refIs1 ? a : b, refIs1 ? b : a);
                // err = (1 − NCC)·100. Совпадением считаем NCC > 0.12:
                // реставрация, перекраска и повреждения оригинала сильно
                // снижают корреляцию, но структура (лицо, контуры) должна
                // совпадать; у несвязанных изображений NCC около нуля.
                if (res) {
                    console.log(`[OreX Image Compare] align: offset=(${res.ox}, ${res.oy}) scale=${res.k.toFixed(4)} NCC=${(1 - res.err / 100).toFixed(3)}`);
                }
                if (res && res.err < 88) {
                    st.layout = { img1: a, img2: b, refIs1, ox: res.ox, oy: res.oy, k: res.k };
                    const ncc = (1 - res.err / 100).toFixed(2);
                    st.alignInfo = Math.abs(res.k - 1) > 0.002
                        ? `авто-совмещение: масштаб меньшего ×${res.k.toFixed(3)}, NCC ${ncc}`
                        : `авто-совмещение: NCC ${ncc}`;
                } else {
                    st.alignInfo = "по центру (совпадение не найдено)";
                }
            } catch (err) {
                console.warn("[OreX Image Compare] auto-align failed:", err);
                st.alignInfo = "по центру";
            }
        };

        proto._drawSideBySideComposite = function (ctx, rect, img1, img2, st) {
            const focusU = st.sbsFocusU !== undefined ? st.sbsFocusU : 0.5;
            const focusV = st.sbsFocusV !== undefined ? st.sbsFocusV : 0.5;

            const lay = this._layout(img1, img2);
            const boxes = [
                { img: img1, boxX: rect.x },
                { img: img2, boxX: rect.x + rect.w / 2 + SBS_GAP / 2 }
            ];

            for (const box of boxes) {
                const { halfW, iw, ih, fitScale, halfCenterX, halfCenterY } = this._sbsHalfLayout(rect, box.img, box.boxX);
                const effScale = fitScale * st.zoom;
                const dW = iw * effScale;
                const dH = ih * effScale;
                // Точка фокуса (в пикселях изображения) всегда попадает в
                // центр своей половины — одинаково для обеих картинок.
                const dX = halfCenterX - focusU * iw * effScale;
                const dY = halfCenterY - focusV * ih * effScale;

                ctx.save();
                ctx.beginPath();
                ctx.rect(box.boxX, rect.y, halfW, rect.h);
                ctx.clip();
                // (dX, dY) — левый верхний угол ОБЩЕГО холста; картинка
                // стоит на нём в своей позиции (авто-совмещение).
                const nw = box.img.naturalWidth || box.img.width;
                const nh = box.img.naturalHeight || box.img.height;
                const pp = box.img === img1 ? lay.p1 : lay.p2;
                ctx.drawImage(
                    box.img,
                    dX + pp.x * effScale,
                    dY + pp.y * effScale,
                    nw * pp.s * effScale,
                    nh * pp.s * effScale
                );
                ctx.restore();
            }

            ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
            ctx.lineWidth = 1 / st.zoom;
            ctx.beginPath();
            ctx.moveTo(rect.x + rect.w / 2, rect.y);
            ctx.lineTo(rect.x + rect.w / 2, rect.y + rect.h);
            ctx.stroke();
        };

        proto._drawComposite = function (ctx, rect, mode, img1, img2, opacityVal, blinkSpeedVal, st) {
            if (mode === "Side-by-Side" && img1 && img2) {
                this._drawSideBySideComposite(ctx, rect, img1, img2, st);
                return;
            }

            // Применение матрицы трансформации Zoom & Pan (остальные режимы —
            // единая трансформация на весь rect, т.к. там всегда ОДНА
            // общая область просмотра, а не две независимые половины)
            const viewCenterX = rect.x + rect.w / 2;
            const viewCenterY = rect.y + rect.h / 2;

            ctx.save();
            ctx.translate(viewCenterX + st.panX, viewCenterY + st.panY);
            ctx.scale(st.zoom, st.zoom);
            ctx.translate(-viewCenterX, -viewCenterY);

            // Холст = максимум по обоим изображениям (а не размер img1)
            const lay = this._layout(img1, img2);
            const baseW = lay.w;
            const baseH = lay.h;

            const fitScale = Math.min(rect.w / baseW, rect.h / baseH);
            const drawW = baseW * fitScale;
            const drawH = baseH * fitScale;

            const drawX = rect.x + (rect.w - drawW) / 2;
            const drawY = rect.y + (rect.h - drawH) / 2;

            // Рисует изображение в натуральном масштабе холста, в найденной позиции
            const drawImg = (im) => {
                const nw = im.naturalWidth || im.width;
                const nh = im.naturalHeight || im.height;
                const pp = im === img1 ? lay.p1 : lay.p2;
                ctx.drawImage(
                    im,
                    drawX + pp.x * fitScale,
                    drawY + pp.y * fitScale,
                    nw * pp.s * fitScale,
                    nh * pp.s * fitScale
                );
            };

            if (img1 && img2) {
                if (mode === "Slider") {
                    // Слева от линии — только Image 2, справа — только Image 1:
                    // слайдер справа → виден Image 2, слайдер слева → виден Image 1.
                    // Фон холста чёрный, поэтому там, где меньшего изображения
                    // нет, большее не просвечивает.
                    ctx.fillStyle = "#000";
                    ctx.fillRect(drawX, drawY, drawW, drawH);

                    const splitX = rect.x + rect.w * st.sliderPos;

                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(rect.x, rect.y, splitX - rect.x, rect.h);
                    ctx.clip();
                    drawImg(img2);
                    ctx.restore();

                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(splitX, rect.y, rect.x + rect.w - splitX, rect.h);
                    ctx.clip();
                    drawImg(img1);
                    ctx.restore();

                    // Тонкая жёлтая линия без тени и без компенсации под
                    // размер канваса захвата — тень убрана, значит и
                    // масштабировать толщину линии больше не для чего;
                    // такая же логика толщины, как у разделителя Side-by-Side.
                    ctx.strokeStyle = "#FFEE00";
                    ctx.lineWidth = 1 / st.zoom;

                    ctx.beginPath();
                    ctx.moveTo(splitX, rect.y);
                    ctx.lineTo(splitX, rect.y + rect.h);
                    ctx.stroke();

                } else if (mode === "Overlap") {
                    drawImg(img2);
                    ctx.globalAlpha = Math.max(0, Math.min(1, opacityVal));
                    drawImg(img1);
                    ctx.globalAlpha = 1.0;

                } else if (mode === "Difference") {
                    drawImg(img1);
                    ctx.globalCompositeOperation = "difference";
                    drawImg(img2);
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

                    // Чёрный фон + взвешенное сложение: результат = a·Image1 +
                    // (1−a)·Image2. Там, где одного из изображений нет, на
                    // этом месте чёрный фон (а не просвечивающее второе
                    // изображение).
                    const a1 = Math.max(0, Math.min(1, alpha1));
                    ctx.fillStyle = "#000";
                    ctx.fillRect(drawX, drawY, drawW, drawH);
                    ctx.globalAlpha = 1 - a1;
                    drawImg(img2);
                    ctx.globalCompositeOperation = "lighter";
                    ctx.globalAlpha = a1;
                    drawImg(img1);
                    ctx.globalCompositeOperation = "source-over";
                    ctx.globalAlpha = 1.0;

                    this.setDirtyCanvas(true, true);
                }
            } else {
                const targetImg = img1 || img2;
                if (targetImg) drawImg(targetImg);
            }
            ctx.restore(); // Сброс матрицы трансформации
        };

        // Захват "как видишь" для Slider/Side-by-Side/Overlap/Difference:
        // рендерит композит на отдельном офскрин-канвасе 1:1 с областью
        // просмотра и возвращает PNG data URL.
        proto._captureComposite = function (mode) {
            const rect = this.getViewerRect();
            const st = this.compareState;
            if (!rect || !st.img1 || !st.img2) return null;

            const w1 = st.img1.naturalWidth || st.img1.width;
            const h1 = st.img1.naturalHeight || st.img1.height;
            const w2 = st.img2.naturalWidth || st.img2.width;
            const h2 = st.img2.naturalHeight || st.img2.height;

            const capLay = this._layout(st.img1, st.img2);
            const bigW = capLay.w;
            const bigH = capLay.h;

            // Side-by-Side: канвас вдвое шире — под ДВЕ половины размером с
            // более крупное изображение. Само вписывание картинок в половины
            // (с сохранением пропорций) делает общий _drawComposite ниже —
            // он уже это умеет, просто передаём ему увеличенную рамку.
            const offW = mode === "Side-by-Side" ? bigW * 2 : bigW;
            const offH = bigH;

            const offCanvas = document.createElement("canvas");
            offCanvas.width = offW;
            offCanvas.height = offH;
            const offCtx = offCanvas.getContext("2d");

            const offRect = { x: 0, y: 0, w: offW, h: offH };

            offCtx.fillStyle = "#18181c";
            offCtx.fillRect(0, 0, offW, offH);

            const opacityWidget = this.widgets?.find(w => w.name === "opacity");
            const opacityVal = opacityWidget ? opacityWidget.value : st.opacity;
            const blinkSpeedWidget = this.widgets?.find(w => w.name === "blink_speed");
            const blinkSpeedVal = blinkSpeedWidget ? blinkSpeedWidget.value : 1.0;

            // Пересчитываем pan (в пикселях) под увеличенный канвас, чтобы
            // сохранить то же относительное положение, что видно на экране узла.
            // На Side-by-Side pan/zoom не действуют (см. _drawComposite), так
            // что пересчёт для неё безвреден, но и не используется.
            const scaleX = offW / rect.w;
            const scaleY = offH / rect.h;
            const scaledState = Object.assign({}, st, {
                panX: st.panX * scaleX,
                panY: st.panY * scaleY,
                // Для линий/теней, которые рисуются в абсолютных пикселях
                // (например, разделитель Slider) — единый коэффициент
                // масштабирования под увеличенный канвас захвата.
                captureScale: (scaleX + scaleY) / 2
            });

            this._drawComposite(offCtx, offRect, mode, st.img1, st.img2, opacityVal, blinkSpeedVal, scaledState);

            // JPEG, качество 0.80 — картинки нужны для ориентировочной оценки,
            // не для пиксель-в-пиксель сверки, поэтому размер файла важнее.
            return offCanvas.toDataURL("image/jpeg", 0.80);
        };

        // Обработчик кнопки "Сохранить": для статичных режимов отправляет
        // снимок канваса, для Blink — просит бэкенд собрать GIF из исходников.
        proto._saveCompareOutput = async function () {
            const modeWidget = this.widgets?.find(w => w.name === "mode");
            const mode = modeWidget ? modeWidget.value : "Slider";
            const st = this.compareState;
            const saveWidget = this._saveBtnWidget;

            const setBtnLabel = (text) => { if (saveWidget) saveWidget.name = text; };

            if (!st.img1 || !st.img2) {
                setBtnLabel("⚠️ Нет обоих изображений");
                setTimeout(() => setBtnLabel("💾 Сохранить текущий вид"), 1800);
                this.setDirtyCanvas(true, true);
                return;
            }

            try {
                let resp;
                if (mode === "Blink") {
                    if (!st.meta1 || !st.meta2) throw new Error("Нет метаданных исходных файлов");
                    resp = await api.fetchApi("/orex/save_blink_gif", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ img1: st.meta1, img2: st.meta2, output_path: st.outputPath || "" })
                    });
                } else {
                    const dataUrl = this._captureComposite(mode);
                    if (!dataUrl) throw new Error("Не удалось захватить изображение");
                    resp = await api.fetchApi("/orex/save_compare", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ mode, image: dataUrl, output_path: st.outputPath || "" })
                    });
                }

                const result = await resp.json();
                if (result.success) {
                    setBtnLabel(`✅ Сохранено: ${result.filename}`);
                } else {
                    setBtnLabel(`⚠️ Ошибка: ${result.error || "неизвестно"}`);
                }
            } catch (err) {
                setBtnLabel(`⚠️ Ошибка: ${err.message}`);
            }

            this.setDirtyCanvas(true, true);
            setTimeout(() => setBtnLabel("💾 Сохранить текущий вид"), 2200);
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
            if (st.alignInfo) {
                ctx.fillStyle = st.layout ? "#a3e635" : "#fb923c";
                ctx.font = "10px sans-serif";
                ctx.textAlign = "center";
                ctx.fillText(`⌖ ${st.alignInfo}`, rect.x + rect.w / 2, barY + 1);
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
                const modeWidget = this.widgets?.find(w => w.name === "mode");
                const mode = modeWidget ? modeWidget.value : "Slider";
                const opacityWidget = this.widgets?.find(w => w.name === "opacity");
                const opacityVal = opacityWidget ? opacityWidget.value : st.opacity;
                const blinkSpeedWidget = this.widgets?.find(w => w.name === "blink_speed");
                const blinkSpeedVal = blinkSpeedWidget ? blinkSpeedWidget.value : 0.5;

                this._drawComposite(ctx, rect, mode, img1, img2, opacityVal, blinkSpeedVal, st);

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