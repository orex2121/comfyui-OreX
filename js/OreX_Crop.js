import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

function getImageUrl(node, depth = 0) {
    if (!node || depth > 5) return null;
    try {
        // 1. Узнаем, является ли текущий узел узлом загрузки
        const isLoad = (node.type || "").toLowerCase().includes("load") || (node.comfyClass || "").toLowerCase().includes("load");

        // 2. Для узлов загрузки (Load Image) - всегда приоритет у виджета выбора файла!
        if (isLoad) {
            const findWidget = (n) => (node.widgets || []).find(w => w && (w.name === n || w.label === n));
            const imageWidget = findWidget("image") || findWidget("image_path") || findWidget("file_path");
            if (imageWidget && imageWidget.value) {
                let filename = "", subfolder = "", type = "input";
                const val = imageWidget.value;
                if (typeof val === "string") {
                    filename = val.trim().replace(/^"|"$/g, "");
                    if (filename.includes("/") || filename.includes("\\")) {
                        const parts = filename.split(/[/\\]/);
                        filename = parts.pop(); subfolder = parts.join("/");
                    }
                } else if (typeof val === "object" && val.filename) {
                    filename = val.filename; subfolder = val.subfolder || "";
                }
                if (filename) return api.apiURL(`/view?filename=${encodeURIComponent(filename)}&type=${type}&subfolder=${encodeURIComponent(subfolder)}`);
            }
        }

        // 3. Для узла Crop (и других) ПЕРВЫМ ДЕЛОМ проверяем входящий кабель (link)
        // Это решает проблему переподключения: мы игнорируем свой старый кэш и идем по кабелю к источнику
        const imageInput = (node.inputs || []).find(i => i && (i.name.toLowerCase().includes("image") || i.type === "IMAGE"));
        if (imageInput && imageInput.link) {
            const link = app.graph.links[imageInput.link];
            if (link) {
                const originNode = app.graph.getNodeById(link.origin_id);
                if (originNode) {
                    const linkedUrl = getImageUrl(originNode, depth + 1);
                    if (linkedUrl) return linkedUrl;
                }
            }
        }

        // 4. Если кабеля нет или он пустой (ничего еще не сгенерировано на источнике), проверяем кэш выходов узла
        const output = app.node_outputs?.[node.id];
        if (output) {
            if (output.images && output.images.length > 0) {
                const img = output.images[0];
                return api.apiURL(`/view?filename=${encodeURIComponent(img.filename)}&type=${img.type}&subfolder=${encodeURIComponent(img.subfolder || "")}`);
            }
            for (const key in output) {
                const slot = output[key];
                if (slot && slot.images && slot.images.length > 0) {
                    const img = slot.images[0];
                    return api.apiURL(`/view?filename=${encodeURIComponent(img.filename)}&type=${img.type}&subfolder=${encodeURIComponent(img.subfolder || "")}`);
                }
            }
        }

        // 5. Фолбэк на внутренние картинки (стандартный кэш интерфейса ComfyUI)
        if (node.imgs && node.imgs.length > 0 && node.imgs[0].src) return node.imgs[0].src;

    } catch (e) { console.error("Error fetching image URL: ", e); } 
    return null;
}

const parseRatio = (r) => {
    if (!r) return 1; if (typeof r === 'number') return r;
    const s = String(r).replace(/\//g, ":"), p = s.split(":");
    if (p.length === 2) {
        const n1 = parseFloat(p[0]), n2 = parseFloat(p[1]);
        return n2 !== 0 ? (n1 / n2 || 1) : 1;
    }
    return parseFloat(s) || 1;
};

const HELP_DESCRIPTIONS = [
    { icon: "⬅️", name: "crop_left", label: "Left Crop / Обрезка слева", desc: "Remove pixels from the left side", ru_desc: "Удалить пиксели с левого края" },
    { icon: "➡️", name: "crop_right", label: "Right Crop / Обрезка справа", desc: "Remove pixels from the right side", ru_desc: "Удалить пиксели с правого края" },
    { icon: "⬆️", name: "crop_top", label: "Top Crop / Обрезка сверху", desc: "Remove pixels from the top", ru_desc: "Удалить пиксели сверху" },
    { icon: "⬇️", name: "crop_bottom", label: "Bottom Crop / Обрезка снизу", desc: "Remove pixels from the bottom", ru_desc: "Удалить пиксели снизу" },
    { icon: "↔️", name: "width", label: "Width / Ширина", desc: "Target output width in pixels", ru_desc: "Целевая ширина в пикселях" },
    { icon: "↕️", name: "height", label: "Height / Высота", desc: "Target output height in pixels", ru_desc: "Целевая высота в пикселях" },
    { icon: "🔢", name: "multiplicity", label: "Multiplicity / Кратность", desc: "Round the dimensions to integers multiples of this value (8, 16, 32, 64)", ru_desc: "Округлять размеры до чисел кратных этому значению (8, 16, 32, 64)" },
    { icon: "🖥️", name: "resolution (MP)", label: "Resolution / Разрешение", desc: "Target resolution in megapixels (0 = disabled)", ru_desc: "Целевое разрешение в мегапикселях (0 = отключено)" },
    { icon: "⚙️", name: "upscale_method", label: "Upscale Method / Метод апскейла", desc: "Interpolation method for resizing image", ru_desc: "Метод интерполяции при изменении размера" },
    { icon: "📐", name: "aspect_ratio", label: "Aspect Ratio / Пропорции", desc: "Set a custom aspect ratio (e.g. 5:7 or 300:1000 pixels)", ru_desc: "Установить произвольное соотношение сторон (например: 5:7 либо пиксели 300:1000)" },
    { icon: "🔢", name: "Ratio Presets", label: "Presets / Шаблоны", desc: "Choose from preset ratios", ru_desc: "Выбор предустановленных пропорций" },
    { icon: "🔒", name: "ratio_lock", label: "Ratio Lock / Блокировка пропорций", desc: "🟢ON - preserve proportions when resizing; 🔴OFF - free transformation", ru_desc: "🟢ON - сохранять пропорции при изменении размера; 🔴OFF - свободное трансформирование" },
    { icon: "🖼️", name: "Full Image", label: "Full Image / Всё изображение", desc: "Reset selection to cover the entire image", ru_desc: "Сбросить выделение на всё изображение" },
    { icon: "🎯", name: "Center", label: "Center / По центру", desc: "Move the current selection box to the center", ru_desc: "Переместить область выделения в центр" },
    { icon: "✅", name: "Maximize", label: "Maximize / Максимизировать", desc: "Stretch to the nearest frame boundaries while maintaining proportions.", ru_desc: "Растянуть до ближайших границ кадра с сохранением пропорций." }
];

app.registerExtension({
    name: "OreXCrop.Antigravity",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "orex Crop") return;

        const proto = nodeType.prototype;
        const onNodeCreated = proto.onNodeCreated;

        proto.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            this._initNode();
        };

        proto._initNode = function () {
            this.properties = this.properties || {};
            this.properties.dragStart = this.properties.dragStart || [0, 0];
            this.properties.dragEnd = this.properties.dragEnd || [512, 512];
            this.properties.actualImageWidth = 0;
            this.properties.actualImageHeight = 0;

            this.image = new Image();
            this.imageLoaded = false;
            this.dragging = false;
            this.dragMode = null;
            this.dragStartRatio = 1;
            this._isSyncing = false;
            this._lastLoadedUrl = null;
            this.previewScale = 1.0;
            
            this.activeTooltip = null;
            this.activeTooltipY = null;
            this.hoverTimer = null;

            // Интеллектуальное масштабирование рамки без сброса выделения
            this.image.onload = () => {
                this.imageLoaded = true;
                
                // Вычисляем реальный размер исходника, отменяя сжатие превью
                const newW = Math.round(this.image.naturalWidth / this.previewScale);
                const newH = Math.round(this.image.naturalHeight / this.previewScale);

                const oldW = this.properties.actualImageWidth || 0;
                const oldH = this.properties.actualImageHeight || 0;

                this.properties.actualImageWidth = newW;
                this.properties.actualImageHeight = newH;

                if (oldW === 0 || oldH === 0) {
                    // Самая первая загрузка картинки в ноду - охватываем всё изображение
                    this.properties.dragStart = [0, 0];
                    this.properties.dragEnd = [newW, newH];
                    this.syncWidgetsFromProperties(true);
                } else {
                    // Загрузился новый кадр или батч. Мы не сбрасываем координаты, 
                    // а заново применяем текущие проценты виджетов к новому размеру!
                    this.syncPropertiesFromWidgets();
                }

                const minSize = this.computeSize();
                if (this.size[1] < minSize[1]) this.size[1] = minSize[1];
                this.setDirtyCanvas(true);
            };

            this._setupWidgets();
        };

        const onConnectionsChange = proto.onConnectionsChange;
        proto.onConnectionsChange = function(type, index, connected, link_info) {
            if (onConnectionsChange) onConnectionsChange.apply(this, arguments);
            // Если переподключили линк - форсируем перерисовку, чтобы новая картинка подтянулась сразу
            this.setDirtyCanvas(true);
        };

        const onDestroy = proto.onDestroy;
        proto.onDestroy = function () {
            if (this.hoverTimer) {
                clearTimeout(this.hoverTimer);
                this.hoverTimer = null;
            }
            if (onDestroy) onDestroy.apply(this, arguments);
        };

        proto._setupWidgets = function () {
            const node = this;

            node.addWidget("combo", "Ratio Presets", "Custom", (v) => {
                const ar = node.widgets.find(w => w && w.name === "aspect_ratio");
                if (ar && v !== "Custom") {
                    ar.value = v;
                    node.applyAspectRatio(v);
                }
            }, { values: ["1:1", "4:3", "3:4", "16:9", "9:16", "9:20", "2:3", "3:2", "21:9", "Custom"] });

            const arIdx = node.widgets.findIndex(w => w && w.name === "aspect_ratio");
            if (arIdx !== -1) {
                const presetWidget = node.widgets.pop();
                node.widgets.splice(arIdx + 1, 0, presetWidget);
            }

            node.addWidget("button", "Full Image", null, () => node.applyAspectRatio("Full"));
            node.addWidget("button", "Center", null, () => node.centerSelection());
            node.addWidget("button", "Maximize", null, () => node.applyAspectRatio());

            const canvasWidget = {
                type: "custom_canvas", name: "crop_preview",
                draw: (ctx, node, width, y) => this._drawPreviewCanvas(ctx, node, width, y),
                computeSize: function(width) {
                    const margin = 10;
                    const drawW = width - margin * 2;
                    if (node.imageLoaded && node.image && node.image.width > 0 && node.image.height > 0) {
                        return [width, Math.max(200, (drawW / (node.image.width / node.image.height)) + margin * 2)];
                    }
                    return [width, 200];
                },
                mouse: function (event, pos, graphNode) {
                    if (["pointerdown", "mousedown"].includes(event.type)) return graphNode.onMouseDown?.(event, pos) || false;
                    if (["pointermove", "mousemove"].includes(event.type)) return graphNode.onMouseMove?.(event, pos) || false;
                    if (["pointerup", "mouseup"].includes(event.type)) return graphNode.onMouseUp?.(event, pos) || false;
                    return false;
                }
            };
            node.addCustomWidget(canvasWidget);
        };

        proto.syncWidgetsFromProperties = function (force = false) {
            if (this._isSyncing && !force) return;
            const wasSyncing = this._isSyncing;
            this._isSyncing = true;
            try {
                const find = (n) => (this.widgets || []).find(w => w && (w.name === n || w.label === n));
                const imgW = this.properties.actualImageWidth || (this.image && this.image.width > 0 ? this.image.width : 1024);
                const imgH = this.properties.actualImageHeight || (this.image && this.image.height > 0 ? this.image.height : 1024);

                if (imgW === 0) return;

                const [x1, y1] = this.properties.dragStart, [x2, y2] = this.properties.dragEnd;
                const setIfChanged = (n, val) => {
                    const w = find(n);
                    if (w && Math.round(w.value * 100) !== Math.round(val * 100)) w.value = Math.round(val * 100) / 100;
                };

                setIfChanged("crop_left", (x1 / imgW) * 100);
                setIfChanged("crop_right", ((imgW - x2) / imgW) * 100);
                setIfChanged("crop_top", (y1 / imgH) * 100);
                setIfChanged("crop_bottom", ((imgH - y2) / imgH) * 100);

                const curW = Math.abs(x2 - x1), curH = Math.abs(y2 - y1);
                const mult = Math.max(1, parseInt(find("multiplicity")?.value) || 16);
                const resWidget = find("resolution (MP)");
                const res = resWidget ? parseFloat(resWidget.value) || 0 : 0;
                
                let outW = curW;
                let outH = curH;

                if (res > 0 && curH > 0) {
                    const targetArea = res * 1000000;
                    const ratio = curW / curH;
                    outW = Math.sqrt(targetArea * ratio);
                    outH = Math.sqrt(targetArea / ratio);
                }
                
                outW = Math.max(mult, Math.round(outW / mult) * mult);
                outH = Math.max(mult, Math.round(outH / mult) * mult);
                
                setIfChanged("width", outW);
                setIfChanged("height", outH);

                const arWidget = find("aspect_ratio"), lockWidget = find("ratio_lock"), presetWidget = find("Ratio Presets");
                if (arWidget) {
                    const currentRatio = curW / curH;
                    let matchedPreset = null;
                    
                    if (presetWidget) {
                        for (const preset of presetWidget.options.values) {
                            if (preset !== "Custom" && Math.abs(currentRatio - parseRatio(preset)) < 0.01) {
                                matchedPreset = preset;
                                break;
                            }
                        }
                    }

                    if (!lockWidget || !lockWidget.value) {
                        if (matchedPreset) {
                            if (arWidget.value !== matchedPreset) arWidget.value = matchedPreset;
                            if (presetWidget && presetWidget.value !== matchedPreset) presetWidget.value = matchedPreset;
                        } else {
                            const currentARVal = arWidget.value;
                            const matchesCurrentAR = Math.abs(currentRatio - parseRatio(currentARVal)) < 0.01;
                            
                            if (!matchesCurrentAR) {
                                const newAR = `${Math.round(curW)}:${Math.round(curH)}`;
                                if (arWidget.value !== newAR) arWidget.value = newAR;
                                if (presetWidget && presetWidget.value !== "Custom") presetWidget.value = "Custom";
                            } else {
                                if (presetWidget && presetWidget.value !== "Custom") presetWidget.value = "Custom";
                            }
                        }
                    } else {
                        if (presetWidget) {
                            const expectedPreset = presetWidget.options.values.includes(arWidget.value) ? arWidget.value : "Custom";
                            if (presetWidget.value !== expectedPreset) presetWidget.value = expectedPreset;
                        }
                    }
                }
            } finally { this._isSyncing = wasSyncing; }
        };

        proto.syncPropertiesFromWidgets = function () {
            if (this._isSyncing) return;
            this._isSyncing = true;
            try {
                const find = (n) => (this.widgets || []).find(w => w && (w.name === n || w.label === n));
                const imgW = this.properties.actualImageWidth, imgH = this.properties.actualImageHeight;
                if (!imgW || !imgH) return;

                this.properties.dragStart = [(find("crop_left")?.value || 0) / 100 * imgW, (find("crop_top")?.value || 0) / 100 * imgH];
                this.properties.dragEnd = [imgW - ((find("crop_right")?.value || 0) / 100 * imgW), imgH - ((find("crop_bottom")?.value || 0) / 100 * imgH)];
                this.setDirtyCanvas(true);
            } finally { this._isSyncing = false; }
        };

        proto.applyAspectRatio = function (val) {
            if (this._isSyncing) return;
            this._isSyncing = true;
            try {
                const find = (n) => (this.widgets || []).find(w => w && (w.name === n || w.label === n));
                const imgW = this.properties.actualImageWidth, imgH = this.properties.actualImageHeight;
                if (!imgW || !imgH) return;

                const arWidget = find("aspect_ratio");
                let nw, nh;

                if (val === "Full") {
                    if (arWidget) arWidget.value = `${imgW}:${imgH}`;
                    nw = imgW; nh = imgH;
                } else {
                    if (val && arWidget) arWidget.value = val;
                    const ratio = parseRatio(arWidget?.value || "1:1");
                    if (imgW / imgH > ratio) { nh = imgH; nw = nh * ratio; } else { nw = imgW; nh = nw / ratio; }
                }

                const cx = (val === "Full") ? imgW / 2 : (this.properties.dragStart[0] + this.properties.dragEnd[0]) / 2;
                const cy = (val === "Full") ? imgH / 2 : (this.properties.dragStart[1] + this.properties.dragEnd[1]) / 2;
                let nx = Math.max(0, Math.min(imgW - nw, cx - nw / 2)), ny = Math.max(0, Math.min(imgH - nh, cy - nh / 2));

                this.properties.dragStart = [Math.round(nx), Math.round(ny)];
                this.properties.dragEnd = [Math.round(nx + nw), Math.round(ny + nh)];
            } finally { this._isSyncing = false; }
            this.syncWidgetsFromProperties(true);
            this.setDirtyCanvas(true);
        };

        proto.centerSelection = function () {
            const imgW = this.properties.actualImageWidth, imgH = this.properties.actualImageHeight;
            if (!imgW) return;
            const cb_w = this.properties.dragEnd[0] - this.properties.dragStart[0], cb_h = this.properties.dragEnd[1] - this.properties.dragStart[1];
            const nx = Math.round((imgW - cb_w) / 2), ny = Math.round((imgH - cb_h) / 2);
            this.properties.dragStart = [nx, ny];
            this.properties.dragEnd = [nx + cb_w, ny + cb_h];
            this.syncWidgetsFromProperties(true);
            this.setDirtyCanvas(true);
        };

        proto.convertToImageSpace = function (pos) {
            if (!this.previewArea) return null;
            const p = this.previewArea;
            if (pos[0] < p.x || pos[0] > p.x + p.width || pos[1] < p.y || pos[1] > p.y + p.height) return null;
            return [(pos[0] - p.x) / p.scale, (pos[1] - p.y) / p.scale];
        };

        proto.getHitArea = function (imgPos) {
            const [x1, y1] = this.properties.dragStart, [x2, y2] = this.properties.dragEnd;
            const [ix, iy] = imgPos, threshold = 15 / (this.previewArea?.scale || 1);
            const nearL = Math.abs(ix - x1) < threshold, nearR = Math.abs(ix - x2) < threshold;
            const nearT = Math.abs(iy - y1) < threshold, nearB = Math.abs(iy - y2) < threshold;
            const inX = ix > Math.min(x1, x2) && ix < Math.max(x1, x2), inY = iy > Math.min(y1, y2) && iy < Math.max(y1, y2);
            if (nearL && nearT) return "tl"; if (nearR && nearT) return "tr";
            if (nearL && nearB) return "bl"; if (nearR && nearB) return "br";
            if (nearT && inX) return "t"; if (nearB && inX) return "b";
            if (nearL && inY) return "l"; if (nearR && inY) return "r";
            return (inX && inY) ? "move" : null;
        };

        proto.onMouseDown = function (e, pos) {
            if (!this.imageLoaded) return false;
            const imgPos = this.convertToImageSpace(pos);
            if (imgPos) {
                let hit = this.getHitArea(imgPos);
                if (hit) {
                    this.dragging = true; this.dragMode = hit; this.dragStartImg = imgPos;
                    this.origStart = [...this.properties.dragStart]; this.origEnd = [...this.properties.dragEnd];
                    
                    const curW = Math.abs(this.origEnd[0] - this.origStart[0]);
                    const curH = Math.abs(this.origEnd[1] - this.origStart[1]);
                    this.dragStartRatio = curH !== 0 ? curW / curH : 1;

                    return true;
                }
            }
            return false;
        };

        proto.onMouseMove = function (e, pos) {
            const [mx, my] = pos;

            if (mx < 0 || mx > this.size[0] || my < 0 || my > this.size[1]) {
                if (this.hoverTimer) {
                    clearTimeout(this.hoverTimer);
                    this.hoverTimer = null;
                }
                if (this.activeTooltip) {
                    this.activeTooltip = null;
                    this.activeTooltipY = null;
                    this.setDirtyCanvas(true);
                }
            }

            if (!this.dragging && this.widgets) {
                let hoveredWidget = null;
                for (const w of this.widgets) {
                    if (!w || w.last_y === undefined) continue;
                    const wy = w.last_y;
                    const wh = w.computeSize ? w.computeSize(this.size[0])[1] : 24;
                    
                    if (mx >= 10 && mx <= this.size[0] - 10 && my >= wy && my <= wy + wh) {
                        hoveredWidget = w;
                        break;
                    }
                }

                let tooltipInfo = null;
                if (hoveredWidget) {
                    tooltipInfo = HELP_DESCRIPTIONS.find(item => {
                        const wName = (hoveredWidget.name || "").toLowerCase().trim().replace(/_/g, " ");
                        const wLabel = (hoveredWidget.label || "").toLowerCase().trim().replace(/_/g, " ");
                        const itemName = (item.name || "").toLowerCase().trim().replace(/_/g, " ");
                        return wName === itemName || wLabel === itemName;
                    });
                }

                if (this.activeTooltip !== tooltipInfo) {
                    if (this.hoverTimer) {
                        clearTimeout(this.hoverTimer);
                        this.hoverTimer = null;
                    }

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

                        const widgetY = hoveredWidget.last_y;
                        this.hoverTimer = setTimeout(() => {
                            this.activeTooltip = tooltipInfo;
                            this.activeTooltipY = widgetY;
                            this.setDirtyCanvas(true);
                            this.hoverTimer = null;
                        }, 800);
                    }
                }
            } else if (this.dragging) {
                if (this.hoverTimer) {
                    clearTimeout(this.hoverTimer);
                    this.hoverTimer = null;
                }
                this.activeTooltip = null;
                this.activeTooltipY = null;
            }

            const imgPos = this.convertToImageSpace(pos);
            if (!this.dragging) {
                let hit = imgPos ? this.getHitArea(imgPos) : null;
                const cursors = { move: "move", tl: "nwse-resize", br: "nwse-resize", tr: "nesw-resize", bl: "nesw-resize", t: "ns-resize", b: "ns-resize", l: "ew-resize", r: "ew-resize" };
                app.canvas.canvas.style.cursor = hit ? cursors[hit] : "default";
                return !!hit;
            }
            if (e.buttons === 0) { this.onMouseUp(e); return false; }
            if (imgPos) this._handleDrag(imgPos);
            return true;
        };

        proto._handleDrag = function (imgPos) {
            let dx = imgPos[0] - this.dragStartImg[0];
            let dy = imgPos[1] - this.dragStartImg[1];
            
            let [nx1, ny1] = [...this.origStart];
            let [nx2, ny2] = [...this.origEnd];
            
            const imgW = this.properties.actualImageWidth;
            const imgH = this.properties.actualImageHeight;
            
            const isCorner = this.dragMode && this.dragMode.length === 2;
            const lockWidget = this.widgets.find(wi => wi && wi.name === "ratio_lock")?.value;
            
            const shouldLock = !!lockWidget;

            let rat = 1;
            if (lockWidget) {
                rat = parseRatio(this.widgets.find(wi => wi && wi.name === "aspect_ratio")?.value || "1:1");
            } else if (isCorner) {
                rat = this.dragStartRatio || 1;
            }

            if (this.dragMode === "move") {
                const w = nx2 - nx1, h = ny2 - ny1;
                nx1 = Math.max(0, Math.min(imgW - w, nx1 + dx)); 
                ny1 = Math.max(0, Math.min(imgH - h, ny1 + dy));
                nx2 = nx1 + w; 
                ny2 = ny1 + h;
            } else {
                if (this.dragMode.includes("l")) nx1 += dx; 
                if (this.dragMode.includes("r")) nx2 += dx;
                if (this.dragMode.includes("t")) ny1 += dy; 
                if (this.dragMode.includes("b")) ny2 += dy;

                if (shouldLock) {
                    let anchorX = this.dragMode.includes("l") ? this.origEnd[0] : this.origStart[0];
                    let anchorY = this.dragMode.includes("t") ? this.origEnd[1] : this.origStart[1];
                    
                    let activeX = this.dragMode.includes("l") ? nx1 : nx2;
                    let activeY = this.dragMode.includes("t") ? ny1 : ny2;

                    let nw = Math.abs(activeX - anchorX);
                    let nh = Math.abs(activeY - anchorY);

                    if (this.dragMode === "l" || this.dragMode === "r") {
                        nh = nw / rat;
                    } else if (this.dragMode === "t" || this.dragMode === "b") {
                        nw = nh * rat;
                    } else {
                        if (nw / rat > nh) nh = nw / rat; else nw = nh * rat;
                    }

                    let targetX = anchorX + nw * (this.dragMode.includes("l") ? -1 : 1);
                    let targetY = anchorY + nh * (this.dragMode.includes("t") ? -1 : 1);

                    if (targetX < 0) { targetX = 0; nw = Math.abs(targetX - anchorX); nh = nw / rat; }
                    if (targetX > imgW) { targetX = imgW; nw = Math.abs(targetX - anchorX); nh = nw / rat; }
                    
                    targetY = anchorY + nh * (this.dragMode.includes("t") ? -1 : 1);

                    if (targetY < 0) { targetY = 0; nh = Math.abs(targetY - anchorY); nw = nh * rat; }
                    if (targetY > imgH) { targetY = imgH; nh = Math.abs(targetY - anchorY); nw = nh * rat; }

                    targetX = anchorX + nw * (this.dragMode.includes("l") ? -1 : 1);

                    if (this.dragMode.includes("l")) nx1 = targetX; else nx2 = targetX;
                    if (this.dragMode.includes("t")) ny1 = targetY; else ny2 = targetY;
                }

                if (nx1 < 0) nx1 = 0; if (ny1 < 0) ny1 = 0;
                if (nx2 > imgW) nx2 = imgW; if (ny2 > imgH) ny2 = imgH;

                if (nx2 - nx1 < 16) { if (this.dragMode.includes("l")) nx1 = nx2 - 16; else nx2 = nx1 + 16; }
                if (ny2 - ny1 < 16) { if (this.dragMode.includes("t")) ny1 = ny2 - 16; else ny2 = ny1 + 16; }
            }

            this.properties.dragStart = [Math.round(nx1), Math.round(ny1)];
            this.properties.dragEnd = [Math.round(nx2), Math.round(ny2)];
            this.syncWidgetsFromProperties(true); 
            this.setDirtyCanvas(true);
        };

        proto.onMouseUp = function (e) {
            if (this.dragging) { 
                this.dragging = false; this.dragMode = null; 
                app.canvas.canvas.style.cursor = "default"; 
                this.syncWidgetsFromProperties(true);
                this.setDirtyCanvas(true); 
                return true; 
            }
            return false;
        };

        proto.onMouseLeave = function () {
            if (this.hoverTimer) {
                clearTimeout(this.hoverTimer);
                this.hoverTimer = null;
            }
            if (this.activeTooltip) {
                this.activeTooltip = null;
                this.activeTooltipY = null;
                this.setDirtyCanvas(true);
            }
        };

        proto.onDrawForeground = function (ctx) {
            if (this.flags?.collapsed) return;

            if (this.widgets) {
                for (const w of this.widgets) {
                    if (w) {
                        if (w.tooltip) w.tooltip = null;
                        
                        if (w.inputEl) {
                            if (w.inputEl.title) {
                                w.inputEl.title = "";
                                w.inputEl.removeAttribute("title");
                            }
                            if (!w.inputEl._hasTooltipListeners) {
                                w.inputEl._hasTooltipListeners = true;
                                
                                w.inputEl.addEventListener("pointerenter", () => {
                                    const tooltipInfo = HELP_DESCRIPTIONS.find(item => {
                                        const wName = (w.name || "").toLowerCase().trim().replace(/_/g, " ");
                                        const wLabel = (w.label || "").toLowerCase().trim().replace(/_/g, " ");
                                        const itemName = (item.name || "").toLowerCase().trim().replace(/_/g, " ");
                                        return wName === itemName || wLabel === itemName;
                                    });

                                    if (tooltipInfo) {
                                        if (this.hoverTimer) {
                                            clearTimeout(this.hoverTimer);
                                        }
                                        
                                        this.hoverTimer = setTimeout(() => {
                                            this.activeTooltip = tooltipInfo;
                                            this.activeTooltipY = w.last_y !== undefined ? w.last_y : 50;
                                            this.setDirtyCanvas(true);
                                            this.hoverTimer = null;
                                        }, 800);
                                    }
                                });

                                w.inputEl.addEventListener("pointerleave", () => {
                                    if (this.hoverTimer) {
                                        clearTimeout(this.hoverTimer);
                                        this.hoverTimer = null;
                                    }
                                    if (this.activeTooltip) {
                                        this.activeTooltip = null;
                                        this.activeTooltipY = null;
                                        this.setDirtyCanvas(true);
                                    }
                                });
                            }
                        }
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

        proto._drawPreviewCanvas = function (ctx, node, width, y) {
            const margin = 10, drawW = width - margin * 2;
            const drawH = Math.max(50, node.size[1] - y - margin * 2);
            const startY = y + margin;
            ctx.fillStyle = "#161616"; ctx.fillRect(margin, startY, drawW, drawH);

            const currentUrl = getImageUrl(node);
            if (currentUrl && node._lastLoadedUrl !== currentUrl) {
                node._lastLoadedUrl = currentUrl;
                
                // ИСПРАВЛЕНИЕ: Если загрузилась совершенно новая картинка (не наше превью),
                // сбрасываем масштаб превью на единицу
                if (!currentUrl.includes("orex_crop_preview")) {
                    node.previewScale = 1.0;
                }

                node.image.src = currentUrl;
                node.imageLoaded = false;
                node.setDirtyCanvas(true);
            }

            if (!node.imageLoaded) { ctx.fillStyle = "#666"; ctx.textAlign = "center"; ctx.fillText("No Image (Connect image input)", margin + drawW / 2, startY + drawH / 2); return; }
            
            const imgAR = node.image.width / node.image.height, areaAR = drawW / drawH;
            let pw, ph, px, py;
            if (imgAR > areaAR) { pw = drawW; ph = drawW / imgAR; px = margin; py = startY + (drawH - ph) / 2; }
            else { ph = drawH; pw = drawH * imgAR; px = margin + (drawW - pw) / 2; py = startY; }
            
            ctx.drawImage(node.image, px, py, pw, ph);

            const scale = pw / node.properties.actualImageWidth;
            const [x1, y1] = node.properties.dragStart, [x2, y2] = node.properties.dragEnd;
            const rx = px + x1 * scale, ry = py + y1 * scale, rw = (x2 - x1) * scale, rh = (y2 - y1) * scale;

            ctx.save(); 
            ctx.fillStyle = "rgba(0,0,0,0.6)"; 
            ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.rect(rx, ry, rw, rh); ctx.fill("evenodd");
            
            ctx.strokeStyle = "#0f0"; ctx.lineWidth = 2; ctx.strokeRect(rx, ry, rw, rh);

            const outW = node.widgets.find(w => w && w.name === "width")?.value || Math.round(x2 - x1);
            const outH = node.widgets.find(w => w && w.name === "height")?.value || Math.round(y2 - y1);

            ctx.strokeStyle = "rgba(170, 255, 0, 0.5)"; ctx.lineWidth = 1;
            ctx.beginPath();
            const cx = rx + rw / 2, cy = ry + rh / 2;
            ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy);
            ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10);
            ctx.stroke();

            ctx.font = "bold 14px Arial"; ctx.textAlign = "center"; 
            ctx.shadowColor = "black"; ctx.shadowBlur = 4; ctx.fillStyle = "#aaff00"; 
            ctx.fillText(`${outW} × ${outH} px`, cx, ry + rh - 10);

            ctx.font = "bold 12px Arial"; ctx.fillStyle = "#00aaff"; 
            const imgW = node.properties.actualImageWidth || 1, imgH = node.properties.actualImageHeight || 1;

            const drawText = (text, x, y, align = "center") => { ctx.textAlign = align; ctx.fillText(text, x, y); };
            drawText(`${Math.round((x1 / imgW) * 100)}%`, rx - 5, cy, "right");
            drawText(`${Math.round(((imgW - x2) / imgW) * 100)}%`, rx + rw + 5, cy, "left");
            drawText(`${Math.round((y1 / imgH) * 100)}%`, cx, ry - 10); 
            drawText(`${Math.round(((imgH - y2) / imgH) * 100)}%`, cx, ry + rh + 15);

            ctx.restore();
            node.previewArea = { x: px, y: py, width: pw, height: ph, scale: scale };
        };

        proto.onWidgetChanged = function (name, val) {
            if (this._isSyncing) return;
            const find = (n) => this.widgets.find(w => w && w.name === n);

            if (["crop_left", "crop_right", "crop_top", "crop_bottom"].includes(name)) {
                this.syncPropertiesFromWidgets();
                if (find("ratio_lock")?.value) {
                    const [ox1, oy1] = [...this.origStart || this.properties.dragStart], [ox2, oy2] = [...this.origEnd || this.properties.dragEnd];
                    const ow = ox2 - ox1, oh = oy2 - oy1, imgW = this.properties.actualImageWidth, imgH = this.properties.actualImageHeight;
                    let fx1 = this.properties.dragStart[0], fy1 = this.properties.dragStart[1], fx2 = this.properties.dragEnd[0], fy2 = this.properties.dragEnd[1];
                    if (name === "crop_left") fx2 = fx1 + ow; else if (name === "crop_right") fx1 = fx2 - ow;
                    else if (name === "crop_top") fy2 = fy1 + oh; else if (name === "crop_bottom") fy1 = fy2 - oh;
                    this.properties.dragStart = [Math.max(0, Math.min(imgW - 1, fx1)), Math.max(0, Math.min(imgH - 1, fy1))];
                    this.properties.dragEnd = [Math.max(fx1 + 1, Math.min(imgW, fx2)), Math.max(fy1 + 1, Math.min(imgH, fy2))];
                }
                this.syncWidgetsFromProperties(true);
            } else if (["width", "height"].includes(name)) {
                const imgW = this.properties.actualImageWidth || 512;
                const imgH = this.properties.actualImageHeight || 512;
                
                let valW = parseFloat(find("width")?.value) || 512;
                let valH = parseFloat(find("height")?.value) || 512;
                const lock = find("ratio_lock")?.value;
                const mult = Math.max(1, parseInt(find("multiplicity")?.value) || 16);

                if (lock) {
                    const rat = parseRatio(find("aspect_ratio")?.value || "1:1");
                    if (name === "width") valH = valW / rat;
                    else valW = valH * rat;
                }

                valW = Math.max(mult, Math.round(valW / mult) * mult);
                valH = Math.max(mult, Math.round(valH / mult) * mult);

                const targetRatio = valW / valH;
                let boxW = valW;
                let boxH = valH;
                
                let exceeds = (boxW > imgW || boxH > imgH);
                let resWidget = find("resolution (MP)");
                let currentRes = parseFloat(resWidget?.value) || 0;

                if (exceeds || currentRes > 0) {
                    if (boxW > imgW || boxH > imgH) {
                        if (imgW / imgH < targetRatio) {
                            boxW = imgW;
                            boxH = boxW / targetRatio;
                        } else {
                            boxH = imgH;
                            boxW = boxH * targetRatio;
                        }
                    }
                    
                    if (resWidget) {
                        const exactMP = (valW * valH) / 1000000;
                        resWidget.value = Math.round(exactMP * 100) / 100;
                    }
                }

                boxW = Math.max(16, boxW);
                boxH = Math.max(16, boxH);

                const [x1, y1] = this.properties.dragStart, [x2, y2] = this.properties.dragEnd;
                const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
                
                let nx1 = cx - boxW / 2;
                let ny1 = cy - boxH / 2;
                
                if (nx1 < 0) { nx1 = 0; }
                if (ny1 < 0) { ny1 = 0; }
                if (nx1 + boxW > imgW) { nx1 = imgW - boxW; if (nx1 < 0) nx1 = 0; }
                if (ny1 + boxH > imgH) { ny1 = imgH - boxH; if (ny1 < 0) ny1 = 0; }
                
                this.properties.dragStart = [Math.round(nx1), Math.round(ny1)];
                this.properties.dragEnd = [Math.round(nx1 + boxW), Math.round(ny1 + boxH)];
                
                if (find("aspect_ratio")) find("aspect_ratio").value = `${Math.round(valW)}:${Math.round(valH)}`;
                
                this.syncWidgetsFromProperties(true);
                this.setDirtyCanvas(true);
            } else if (name === "resolution (MP)") {
                this.syncWidgetsFromProperties(true);
                this.setDirtyCanvas(true);
            } else if (name === "multiplicity") {
                this.syncWidgetsFromProperties(true);
                this.setDirtyCanvas(true);
            } else if (name === "ratio_lock" && val) {
                if (find("aspect_ratio")) find("aspect_ratio").value = `${Math.round(this.properties.dragEnd[0] - this.properties.dragStart[0])}:${Math.round(this.properties.dragEnd[1] - this.properties.dragStart[1])}`;
                if (find("Ratio Presets")) find("Ratio Presets").value = "Custom";
            } else if (name === "aspect_ratio") {
                if (find("Ratio Presets") && find("Ratio Presets").value !== val) find("Ratio Presets").value = find("Ratio Presets").options.values.includes(val) ? val : "Custom";
                this.applyAspectRatio(val);
            }
        };

        proto.onExecuted = function (message) {
            if (message?.images && message.images.length > 0) {
                const img = message.images[0];
                const url = api.apiURL(`/view?filename=${encodeURIComponent(img.filename)}&type=${img.type}&subfolder=${encodeURIComponent(img.subfolder || "")}`);
                
                if (message.preview_scale) {
                    this.previewScale = Array.isArray(message.preview_scale) ? message.preview_scale[0] : message.preview_scale;
                }

                if (message.orig_size) {
                    const [newW, newH] = message.orig_size;
                    this.properties.actualImageWidth = newW; 
                    this.properties.actualImageHeight = newH;
                    
                    // Мы не сбрасываем выделение, а применяем текущие проценты!
                    this.syncPropertiesFromWidgets();
                }
                
                this.image.src = url; 
                this.imageLoaded = false; 
                this.setDirtyCanvas(true);
            }
        };
    },
    nodeCreated(node) {
        if (node.comfyClass === "orex Crop") {
            const lock = node.widgets.find(w => w && w.name === "ratio_lock");
            if (lock) lock.value = false;
            const preset = node.widgets.find(w => w && w.name === "Ratio Presets");
            if (preset) preset.value = "Custom";
        }
    }
});