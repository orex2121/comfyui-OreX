import { app } from "../../../scripts/app.js";

const BATCH_SIZE_HELP_DESCRIPTIONS = [
    { name: "folder_path", label: "folder_path / Путь к папке", desc: "Absolute directory path or relative path inside ComfyUI/input/", ru_desc: "Абсолютный путь к папке с картинками или относительный внутри каталога ComfyUI/input/" },
    { name: "file_pattern", label: "file_pattern / Шаблон имен", desc: "Filter format (* for all, *upscale*.png, or specific naming rules)", ru_desc: "Фильтр имен файлов (например, * для всех, или *.png, поддерживается регистронезависимый fnmatch)" },
    { name: "batch_size", label: "batch_size / Размер пачки", desc: "Number of images to load simultaneously into a list (1-1000)", ru_desc: "Количество изображений, загружаемых одновременно списком за один шаг генерации" },
    { name: "start_index", label: "start_index / Начальный индекс", desc: "The file index from which loading begins (the countdown starts from zero)", ru_desc: "Индекс файла, с которого начинается чтение (отсчет начинается с нуля)" },
    { name: "file_name_without_extension", label: "file_name_without_extension", desc: "Strip extensions (.png, .jpg) from the output filename text list", ru_desc: "🟢 ON: Отрезать расширения файлов в выходном текстовом списке | 🔴 OFF: Оставить как есть" },
    { name: "seed", label: "seed / Случайное число", desc: "Changes node state execution to force recalculation if needed. (Do not select fixed mode!)", ru_desc: "Сид для обновления состояния работы узла и принудительного перезапуска чтения. (Не выбирать режим fixed!)" }
];

app.registerExtension({
    name: "OreXImageLoadBatchSize.HelpPanel.Unique",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        
        // Надежная проверка имени по аналогии с узлом Ratio
        if (nodeData.name === "orex Load Image Batch Size" || 
            nodeData.name === "OreXImageLoadBatchSize" || 
            nodeData.name === "OreX Load Image Batch Size") {

            const proto = nodeType.prototype;
            const onNodeCreated = proto.onNodeCreated;

            proto.onNodeCreated = function () {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);
                
                // Устанавливаем кастомный ярко-голубой цвет (RGB: 0, 150, 255 -> #0096ff)
                // Для заголовка и фона используем один и тот же цвет, как на левом узле.
                this.color = "#0096ff";
                this.bgcolor = "#0096ff"; 
                
                this.isHoveringHelp = false;
                this.showHelpSidebar = false;

                this._globalClickListener = (event) => {
                    if (!this.showHelpSidebar || !app.graph._nodes.includes(this)) return;
                    const graphPos = app.canvas.convertEventToCanvasOffset(event);
                    if (!graphPos) { this.showHelpSidebar = false; this.setDirtyCanvas(true); return; }
                    const mx = graphPos[0] - this.pos[0]; const my = graphPos[1] - this.pos[1];
                    const iconArea = [this.size[0] - 25, -LiteGraph.NODE_TITLE_HEIGHT, 25, LiteGraph.NODE_TITLE_HEIGHT];
                    if (mx >= iconArea[0] && mx <= iconArea[0] + iconArea[2] && my >= iconArea[1] && my <= iconArea[1] + iconArea[3]) return;
                    this.showHelpSidebar = false; this.setDirtyCanvas(true);
                };
                document.addEventListener("pointerdown", this._globalClickListener, true);
            };

            const onDestroy = proto.onDestroy;
            proto.onDestroy = function () {
                if (this._globalClickListener) document.removeEventListener("pointerdown", this._globalClickListener, true);
                if (onDestroy) onDestroy.apply(this, arguments);
            };

            proto.onMouseDown = function (e, pos) {
                const [mx, my] = pos;
                const iconArea = [this.size[0] - 25, -LiteGraph.NODE_TITLE_HEIGHT, 25, LiteGraph.NODE_TITLE_HEIGHT];
                if (mx >= iconArea[0] && mx <= iconArea[0] + iconArea[2] && my >= iconArea[1] && my <= iconArea[1] + iconArea[3]) {
                    this.showHelpSidebar = !this.showHelpSidebar; this.setDirtyCanvas(true); return true;
                }
                return false;
            };

            proto.onMouseMove = function (e, pos) {
                const [mx, my] = pos;
                const iconArea = [this.size[0] - 25, -LiteGraph.NODE_TITLE_HEIGHT, 25, LiteGraph.NODE_TITLE_HEIGHT];
                const wasHoveringHelp = this.isHoveringHelp;
                this.isHoveringHelp = (mx >= iconArea[0] && mx <= iconArea[0] + iconArea[2] && my >= iconArea[1] && my <= iconArea[1] + iconArea[3]);
                if (wasHoveringHelp !== this.isHoveringHelp) this.setDirtyCanvas(true); if (this.isHoveringHelp) return true;
                return false;
            };

            proto.onDrawForeground = function (ctx) {
                if (this.flags?.collapsed) return;
                const iconX = this.size[0] - 22, iconY = -LiteGraph.NODE_TITLE_HEIGHT + 5, iconR = 8;
                ctx.save(); ctx.fillStyle = this.isHoveringHelp ? "#ff0" : "#fff"; ctx.font = "bold 15px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
                ctx.fillText("?", iconX + iconR, iconY + iconR); if (this.showHelpSidebar) this._drawHelpSidebar(ctx); ctx.restore();
            };

            proto._drawHelpSidebar = function (ctx) {
                const margin = 15, bx = this.size[0] + 15, widgetH = 24; const labelFont = "bold 13px Arial", descFont = "normal 11px Arial";
                ctx.save(); ctx.textBaseline = "middle"; let maxLabelW = 0, maxDescW = 0; ctx.font = labelFont;
                BATCH_SIZE_HELP_DESCRIPTIONS.forEach((item) => { maxLabelW = Math.max(maxLabelW, ctx.measureText(item.label).width); ctx.font = descFont; maxDescW = Math.max(maxDescW, ctx.measureText(`- ${item.desc} / ${item.ru_desc}`).width); ctx.font = labelFont; });
                let firstWidget = this.widgets?.find(w => w.last_y !== undefined); let lastWidget = this.widgets ? [...this.widgets].reverse().find(w => w.last_y !== undefined) : null;
                let minWidgetY = firstWidget ? firstWidget.last_y : 30; let lastWidgetY = lastWidget ? lastWidget.last_y : this.size[1] - 30;
                const labelX = bx + margin + 10, descX = labelX + maxLabelW + 15; const boxW = (descX - bx) + maxDescW + margin; const by = minWidgetY - 45, boxH = (lastWidgetY + widgetH + 10) - by;
                ctx.fillStyle = "rgba(0,0,0,0.95)"; ctx.strokeStyle = "#00ff44"; ctx.lineWidth = 1.6;
                if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 12); ctx.fill(); ctx.stroke(); } else { ctx.fillRect(bx, by, boxW, boxH); ctx.strokeRect(bx, by, boxW, boxH); }
                
                ctx.font = "bold 16px Arial"; ctx.textAlign = "left"; ctx.fillStyle = "#fff"; 
                ctx.fillText("Explanations / Описание параметров Load Image Batch Size", bx + margin, by + 22);
                let fallbackY = by + 55;
                BATCH_SIZE_HELP_DESCRIPTIONS.forEach((item) => {
                    const w = this.widgets?.find(wd => wd.name === item.name || wd.label === item.name); const y = (w && w.last_y !== undefined) ? w.last_y + (widgetH / 2) : fallbackY; if (!w || w.last_y === undefined) fallbackY += 32;
                    ctx.font = labelFont; ctx.fillStyle = "#fff"; ctx.fillText(item.label, labelX, y); ctx.font = descFont; ctx.fillStyle = "#aaa"; ctx.fillText(`- ${item.desc} / ${item.ru_desc}`, descX, y);
                });
                ctx.restore();
            };

        }
    }
});