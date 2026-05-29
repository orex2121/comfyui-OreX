import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

function getImageUrl(node, depth = 0) {
    if (!node || depth > 5) return null;
    try {
        const output = app.node_outputs?.[node.id];
        if (output) {
            if (output.images && output.images.length > 0) {
                const img = output.images[0];
                return api.apiURL(`/view?filename=${encodeURIComponent(img.filename)}&type=${img.type}&subfolder=${encodeURIComponent(img.subfolder)}`);
            }
            for (const key in output) {
                const slot = output[key];
                if (slot && slot.images && slot.images.length > 0) {
                    const img = slot.images[0];
                    return api.apiURL(`/view?filename=${encodeURIComponent(img.filename)}&type=${img.type}&subfolder=${encodeURIComponent(img.subfolder)}`);
                }
            }
        }
        if (node.imgs && node.imgs.length > 0 && node.imgs[0].src) return node.imgs[0].src;
        const findWidget = (n) => (node.widgets || []).find(w => w.name === n || w.label === n);
        const imageWidget = findWidget("image") || findWidget("image_path") || findWidget("file_path");
        if (imageWidget && imageWidget.value) {
            const t = (node.type || "").toLowerCase(), c = (node.comfyClass || "").toLowerCase();
            const isLoad = t.includes("load") || c.includes("load");
            let filename = "", subfolder = "", type = isLoad ? "input" : "output";
            const val = imageWidget.value;
            if (typeof val === "string") {
                filename = val.trim().replace(/^"|"$/g, "");
                if (filename.includes("/") || filename.includes("\\")) {
                    const parts = filename.split(/[/\\]/);
                    filename = parts.pop(); subfolder = parts.join("/");
                }
            } else if (typeof val === "object" && val.filename) {
                filename = val.filename; subfolder = val.subfolder || "";
                type = val.type || type;
            }
            if (filename) return api.apiURL(`/view?filename=${encodeURIComponent(filename)}&type=${type}&subfolder=${encodeURIComponent(subfolder)}`);
        }
        const imageInput = (node.inputs || []).find(i => i.name.toLowerCase().includes("image") || i.type === "IMAGE");
        if (imageInput && imageInput.link) {
            const originNode = app.graph.getNodeById(app.graph.links[imageInput.link].origin_id);
            if (originNode) return getImageUrl(originNode, depth + 1);
        }
    } catch (e) { } return null;
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

// Исправлено: Полный список элементов, имена (name) строго соответствуют виджетам и кнопкам
const HELP_DESCRIPTIONS = [
    { icon: "⬅️", name: "crop_left", label: "Left Crop / Обрезка слева", desc: "Remove pixels from the left side", ru_desc: "Удалить пиксели с левого края" },
    { icon: "➡️", name: "crop_right", label: "Right Crop / Обрезка справа", desc: "Remove pixels from the right side", ru_desc: "Удалить пиксели с правого края" },
    { icon: "⬆️", name: "crop_top", label: "Top Crop / Обрезка сверху", desc: "Remove pixels from the top", ru_desc: "Удалить пиксели сверху" },
    { icon: "⬇️", name: "crop_bottom", label: "Bottom Crop / Обрезка снизу", desc: "Remove pixels from the bottom", ru_desc: "Удалить пиксели снизу" },
    { icon: "↔️", name: "width", label: "Width / Ширина", desc: "Target output width in pixels", ru_desc: "Целевая ширина в пикселях" },
    { icon: "↕️", name: "height", label: "Height / Высота", desc: "Target output height in pixels", ru_desc: "Целевая высота в пикселях" },
    { icon: "🔢", name: "multiplicity", label: "Multiplicity / Кратность", desc: "Snap dimensions to multiples of this value", ru_desc: "Округлять размеры до кратных этому значению" },
    { icon: "🖥️", name: "resolution (MP)", label: "Resolution / Разрешение", desc: "Target resolution in megapixels (0 = disabled)", ru_desc: "Целевое разрешение в мегапикселях (0 = откл)" },
    { icon: "⚙️", name: "upscale_method", label: "Upscale Method / Метод апскейла", desc: "Interpolation method for resizing image", ru_desc: "Метод интерполяции при изменении размера" },
    { icon: "📐", name: "aspect_ratio", label: "Aspect Ratio / Пропорции", desc: "Set a specific width-to-height ratio", ru_desc: "Установить соотношение сторон" },
    { icon: "求", name: "Ratio Presets", label: "Presets / Шаблоны", desc: "Quickly apply standard aspect ratios", ru_desc: "Быстро применить стандартные пропорции" },
    { icon: "🔒", name: "ratio_lock", label: "Ratio Lock / Блок. пропорций", desc: "Maintain the aspect ratio during resize", ru_desc: "Сохранять пропорции при изменении размера" },
    { icon: "🖼️", name: "Full Image", label: "Full Image / Всё изображение", desc: "Reset selection to cover the entire image", ru_desc: "Сбросить выделение на всё изображение" },
    { icon: "🎯", name: "Center", label: "Center / По центру", desc: "Move the current selection box to the center", ru_desc: "Переместить область выделения в центр" },
    { icon: "✅", name: "Maximize", label: "Maximize / Максимизировать по центру", desc: "Enforce current ratio and center logic", ru_desc: "Принудительно применить пропорции и центрирование" }
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
            this._isSyncing = false;
            this.previewScale = 1.0;
            this.isHoveringHelp = false;
            this.showHelpSidebar = false;

            this.image.onload = () => {
                this.imageLoaded = true;
                this.syncWidgetsFromProperties(true);
                const minSize = this.computeSize();
                if (this.size[1] < minSize[1]) this.size[1] = minSize[1];
                this.setDirtyCanvas(true);
            };

            this._setupWidgets();

            this._globalClickListener = (event) => {
                if (!this.showHelpSidebar || !app.graph._nodes.includes(this)) return;

                const graphPos = app.canvas.convertEventToCanvasOffset(event);
                if (!graphPos) {
                    this.showHelpSidebar = false;
                    this.setDirtyCanvas(true);
                    return;
                }

                const mx = graphPos[0] - this.pos[0];
                const my = graphPos[1] - this.pos[1];
                const iconArea = [this.size[0] - 25, -LiteGraph.NODE_TITLE_HEIGHT, 25, LiteGraph.NODE_TITLE_HEIGHT];
                if (mx >= iconArea[0] && mx <= iconArea[0] + iconArea[2] && my >= iconArea[1] && my <= iconArea[1] + iconArea[3]) return;

                this.showHelpSidebar = false;
                this.setDirtyCanvas(true);
            };

            document.addEventListener("pointerdown", this._globalClickListener, true);
        };

        const onDestroy = proto.onDestroy;
        proto.onDestroy = function () {
            if (this._globalClickListener) {
                document.removeEventListener("pointerdown", this._globalClickListener, true);
            }
            if (onDestroy) onDestroy.apply(this, arguments);
        };

        proto._setupWidgets = function () {
            const node = this;

            node.addWidget("combo", "Ratio Presets", "Custom", (v) => {
                const ar = node.widgets.find(w => w.name === "aspect_ratio");
                if (ar && v !== "Custom") {
                    ar.value = v;
                    node.applyAspectRatio(v);
                }
            }, { values: ["1:1", "4:3", "3:4", "16:9", "9:16", "9:20", "2:3", "3:2", "21:9", "Custom"] });

            const arIdx = node.widgets.findIndex(w => w.name === "aspect_ratio");
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
                const find = (n) => (this.widgets || []).find(w => w.name === n || w.label === n);
                const imgW = this.properties.actualImageWidth || (this.image && this.image.width > 0 ? this.image.width : 1024);
                const imgH = this.properties.actualImageHeight || (this.image && this.image.height > 0 ? this.image.height : 1024);

                if (imgW === 0) return;

                const [x1, y1] = this.properties.dragStart, [x2, y2] = this.properties.dragEnd;
                const setIfChanged = (n, val) => {
                    const w = find(n);
                    if (w && Math.round(w.value * 10) !== Math.round(val * 10)) w.value = Math.round(val * 10) / 10;
                };

                setIfChanged("crop_left", (x1 / imgW) * 100);
                setIfChanged("crop_right", ((imgW - x2) / imgW) * 100);
                setIfChanged("crop_top", (y1 / imgH) * 100);
                setIfChanged("crop_bottom", ((imgH - y2) / imgH) * 100);

                const curW = Math.abs(x2 - x1), curH = Math.abs(y2 - y1);
                const resWidget = find("resolution (MP)");
                const res = resWidget ? parseFloat(resWidget.value) || 0 : 0;
                const mult = Math.max(1, parseInt(find("multiplicity")?.value) || 16);
                
                let outW = curW, outH = curH;
                if (res > 0 && curH > 0) {
                    const targetArea = res * 1000000;
                    const ratio = curW / curH;
                    outW = Math.sqrt(targetArea * ratio);
                    outH = Math.sqrt(targetArea / ratio);
                }
                
                setIfChanged("width", Math.max(mult, Math.round(outW / mult) * mult));
                setIfChanged("height", Math.max(mult, Math.round(outH / mult) * mult));

                const arWidget = find("aspect_ratio"), lockWidget = find("ratio_lock"), presetWidget = find("Ratio Presets");
                if (arWidget && (!lockWidget || !lockWidget.value)) {
                    const newAR = `${Math.round(curW)}:${Math.round(curH)}`;
                    if (arWidget.value !== newAR) arWidget.value = newAR;
                }

                if (presetWidget && arWidget) {
                    presetWidget.value = Math.abs((curW / curH) - parseRatio(arWidget.value)) > 0.01 ? "Custom" : (presetWidget.options.values.includes(arWidget.value) ? arWidget.value : "Custom");
                }
            } finally { this._isSyncing = wasSyncing; }
        };

        proto.syncPropertiesFromWidgets = function () {
            if (this._isSyncing) return;
            this._isSyncing = true;
            try {
                const find = (n) => (this.widgets || []).find(w => w.name === n || w.label === n);
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
                const find = (n) => (this.widgets || []).find(w => w.name === n || w.label === n);
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
            const cw = this.properties.dragEnd[0] - this.properties.dragStart[0], ch = this.properties.dragEnd[1] - this.properties.dragStart[1];
            const nx = Math.round((imgW - cw) / 2), ny = Math.round((imgH - ch) / 2);
            this.properties.dragStart = [nx, ny];
            this.properties.dragEnd = [nx + cw, ny + ch];
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
            const [mx, my] = pos;
            const iconArea = [this.size[0] - 25, -LiteGraph.NODE_TITLE_HEIGHT, 25, LiteGraph.NODE_TITLE_HEIGHT];
            if (mx >= iconArea[0] && mx <= iconArea[0] + iconArea[2] && my >= iconArea[1] && my <= iconArea[1] + iconArea[3]) {
                this.showHelpSidebar = !this.showHelpSidebar;
                this.setDirtyCanvas(true);
                return true; 
            }

            if (!this.imageLoaded) return false;
            const imgPos = this.convertToImageSpace(pos);
            if (imgPos) {
                let hit = this.getHitArea(imgPos);
                if (hit) {
                    this.dragging = true; this.dragMode = hit; this.dragStartImg = imgPos;
                    this.origStart = [...this.properties.dragStart]; this.origEnd = [...this.properties.dragEnd];
                    return true;
                }
            }
            return false;
        };

        proto.onMouseMove = function (e, pos) {
            const [mx, my] = pos;
            const iconArea = [this.size[0] - 25, -LiteGraph.NODE_TITLE_HEIGHT, 25, LiteGraph.NODE_TITLE_HEIGHT];
            const wasHoveringHelp = this.isHoveringHelp;
            this.isHoveringHelp = (mx >= iconArea[0] && mx <= iconArea[0] + iconArea[2] && my >= iconArea[1] && my <= iconArea[1] + iconArea[3]);
            if (wasHoveringHelp !== this.isHoveringHelp) this.setDirtyCanvas(true);
            if (this.isHoveringHelp) return true;

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
            const dx = imgPos[0] - this.dragStartImg[0], dy = imgPos[1] - this.dragStartImg[1];
            let [nx1, ny1] = [...this.origStart], [nx2, ny2] = [...this.origEnd];
            const imgW = this.properties.actualImageWidth, imgH = this.properties.actualImageHeight;
            const lock = this.widgets.find(wi => wi.name === "ratio_lock")?.value;
            const rat = lock ? parseRatio(this.widgets.find(wi => wi.name === "aspect_ratio")?.value || "1:1") : 1;

            if (this.dragMode === "move") {
                const w = nx2 - nx1, h = ny2 - ny1;
                nx1 = Math.max(0, Math.min(imgW - w, nx1 + dx)); ny1 = Math.max(0, Math.min(imgH - h, ny1 + dy));
                nx2 = nx1 + w; ny2 = ny1 + h;
            } else {
                if (this.dragMode.includes("l")) nx1 += dx; if (this.dragMode.includes("r")) nx2 += dx;
                if (this.dragMode.includes("t")) ny1 += dy; if (this.dragMode.includes("b")) ny2 += dy;

                if (lock) {
                    const ow = this.origEnd[0] - this.origStart[0], oh = this.origEnd[1] - this.origStart[1];
                    if (["l", "r"].includes(this.dragMode)) {
                        let cw = oh * rat;
                        if (this.dragMode === "l") nx1 = nx2 - cw; else nx2 = nx1 + cw;
                        ny1 = this.origStart[1]; ny2 = this.origEnd[1];
                    } else if (["t", "b"].includes(this.dragMode)) {
                        let ch = ow / rat;
                        if (this.dragMode === "t") ny1 = ny2 - ch; else ny2 = ny1 + ch;
                        nx1 = this.origStart[0]; nx2 = this.origEnd[0];
                    } else {
                        let cw = Math.abs(nx2 - nx1), ch = Math.abs(ny2 - ny1);
                        if (cw / rat > ch) ch = cw / rat; else cw = ch * rat;
                        if (this.dragMode.includes("l")) nx1 = nx2 - cw; else nx2 = nx1 + cw;
                        if (this.dragMode.includes("t")) ny1 = ny2 - ch; else ny2 = ny1 + ch;
                    }
                }
                nx1 = Math.max(0, nx1); ny1 = Math.max(0, ny1);
                nx2 = Math.min(imgW, nx2); ny2 = Math.min(imgH, ny2);
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

        proto.onDrawForeground = function (ctx) {
            const iconX = this.size[0] - 22, iconY = -LiteGraph.NODE_TITLE_HEIGHT + 5, iconR = 8;
            ctx.save();
            ctx.fillStyle = this.isHoveringHelp ? "#fff" : "#ff0";
            ctx.font = "bold 15px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText("?", iconX + iconR, iconY + iconR);
            if (this.showHelpSidebar) this._drawHelpSidebar(ctx);
            ctx.restore();
        };

        // Исправлено: Динамический и абсолютно надежный расчет координат строк справки
        proto._drawHelpSidebar = function (ctx) {
            const margin = 15, bx = this.size[0] + 15, widgetH = 24;
            const labelFont = "bold 13px Arial", descFont = "normal 11px Arial";

            ctx.save();
            ctx.textBaseline = "middle";

            let maxLabelW = 0, maxDescW = 0;
            ctx.font = labelFont;
            
            HELP_DESCRIPTIONS.forEach((item) => {
                maxLabelW = Math.max(maxLabelW, ctx.measureText(item.label).width);
                ctx.font = descFont;
                maxDescW = Math.max(maxDescW, ctx.measureText(`- ${item.desc} / ${item.ru_desc}`).width);
                ctx.font = labelFont;
            });

            // Находим начальный Y по первому доступному виджету на панели
            let firstWidget = this.widgets.find(w => w.last_y !== undefined);
            let lastWidget = [...this.widgets].reverse().find(w => w.last_y !== undefined);
            
            let minWidgetY = firstWidget ? firstWidget.last_y : 50;
            let lastWidgetY = lastWidget ? lastWidget.last_y : 400;

            const labelX = bx + margin + 28, descX = labelX + maxLabelW + 15;
            const boxW = (descX - bx) + maxDescW + margin;
            const by = minWidgetY - 45, boxH = (lastWidgetY + widgetH + 10) - by;

            // Рендеринг фона плашки
            ctx.fillStyle = "rgba(0,0,0,0.95)"; ctx.strokeStyle = "#00ff44"; ctx.lineWidth = 1.6;
            if (ctx.roundRect) { 
                ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 12); ctx.fill(); ctx.stroke(); 
            } else { 
                ctx.fillRect(bx, by, boxW, boxH); ctx.strokeRect(bx, by, boxW, boxH); 
            }

            ctx.font = "bold 16px Arial"; ctx.textAlign = "left"; ctx.fillStyle = "#00ff44";
            ctx.fillText("Explanations / Описание", bx + margin, by + 22);

            // Построчный вывод текста, привязанный к физическому положению виджетов
            HELP_DESCRIPTIONS.forEach((item) => {
                const w = this.widgets.find(wd => wd.name === item.name || wd.label === item.name);
                // Если виджет или кнопка найдены, берем их Y, если нет (на всякий случай) — смещаем вниз
                const y = (w && w.last_y !== undefined) ? w.last_y + (widgetH / 2) : by + 60;
                
                ctx.font = "14px Arial"; ctx.fillStyle = "#fff"; ctx.fillText(item.icon, bx + margin, y);
                ctx.font = labelFont; ctx.fillText(item.label, labelX, y);
                ctx.font = descFont; ctx.fillStyle = "#aaa"; ctx.fillText(`- ${item.desc} / ${item.ru_desc}`, descX, y);
            });
            ctx.restore();
        };

        proto._drawPreviewCanvas = function (ctx, node, width, y) {
            const margin = 10, drawW = width - margin * 2;
            const drawH = Math.max(50, node.size[1] - y - margin * 2);
            const startY = y + margin;
            ctx.fillStyle = "#161616"; ctx.fillRect(margin, startY, drawW, drawH);

            if (!node.imageLoaded) { ctx.fillStyle = "#666"; ctx.textAlign = "center"; ctx.fillText("No Image", margin + drawW / 2, startY + drawH / 2); return; }
            
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

            const curW = Math.round(x2 - x1), curH = Math.round(y2 - y1);
            const outW = node.widgets.find(w => w.name === "width")?.value || curW;
            const outH = node.widgets.find(w => w.name === "height")?.value || curH;

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
            const find = (n) => this.widgets.find(w => w.name === n);

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
                const res = parseFloat(find("resolution (MP)")?.value) || 0;
                if (res > 0) {
                    const arWidget = find("aspect_ratio");
                    if (arWidget && find("width") && find("height")) arWidget.value = `${Math.round(find("width").value)}:${Math.round(find("height").value)}`;
                    this.applyAspectRatio();
                } else {
                    const [x1, y1] = this.properties.dragStart, [x2, y2] = this.properties.dragEnd, cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
                    let nw = (name === "width") ? val : Math.abs(x2 - x1), nh = (name === "height") ? val : Math.abs(y2 - y1);
                    if (find("ratio_lock")?.value) nw = (name === "width") ? nw : nh * parseRatio(find("aspect_ratio")?.value);
                    const mult = Math.max(1, parseInt(find("multiplicity")?.value) || 16);
                    nw = Math.max(mult, Math.round(nw / mult) * mult); nh = Math.max(mult, Math.round(nh / mult) * mult);
                    this.properties.dragStart = [Math.max(0, cx - nw / 2), Math.max(0, cy - nh / 2)];
                    this.properties.dragEnd = [this.properties.dragStart[0] + nw, this.properties.dragStart[1] + nh];
                    this.syncWidgetsFromProperties(true);
                    this.setDirtyCanvas(true);
                }
            } else if (["multiplicity", "resolution (MP)"].includes(name)) {
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
                const img = message.images[0], url = api.apiURL(`/view?filename=${encodeURIComponent(img.filename)}&type=${img.type}&subfolder=${encodeURIComponent(img.subfolder || "")}`);
                if (message.orig_size) {
                    const [newW, newH] = message.orig_size, oldW = this.properties.actualImageWidth, oldH = this.properties.actualImageHeight;
                    this.properties.actualImageWidth = newW; this.properties.actualImageHeight = newH;
                    if (newW !== oldW || newH !== oldH) this.applyAspectRatio(this.widgets.find(w => w.name === "ratio_lock")?.value ? undefined : "Full");
                }
                if (message.preview_scale) this.previewScale = Array.isArray(message.preview_scale) ? message.preview_scale[0] : message.preview_scale;
                this.image.src = url; this.imageLoaded = false; this.setDirtyCanvas(true);
            }
        };
    },
    nodeCreated(node) {
        if (node.comfyClass === "orex Crop") {
            const lock = node.widgets.find(w => w.name === "ratio_lock");
            if (lock) lock.value = false;
            const preset = node.widgets.find(w => w.name === "Ratio Presets");
            if (preset) preset.value = "Custom";
        }
    }
});