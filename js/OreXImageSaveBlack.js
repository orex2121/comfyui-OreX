import { app } from "../../../scripts/app.js";

const SAVE_HELP_DESCRIPTIONS = [
    { name: "active", label: "Active / Активность узла", desc: "Toggle node activity. If OFF, image is passed through without saving", ru_desc: "Вкл/выкл работу узла. Если OFF, картинка передается дальше без сохранения на диск" },
    { name: "output_path", label: "Output Path / Путь сохранения", desc: "Custom folder path (Absolute like E:\\Folder or relative to output)", ru_desc: "Свой путь к папке (абсолютный вида E:\\Folder или относительно папки output)" },
    { name: "create_current_date_folder", label: "Current Date Folder / Папка с датой", desc: "Create a subfolder named with current date (YYYY-MM-DD)", ru_desc: "Создать подпапку с текущей датой (ГГГГ-ММ-ДД)" },
    { name: "create_processed_folder", label: "Processed Folder / Папка 'Processed'", desc: "Create an additional 'Processed' subfolder", ru_desc: "Создать дополнительную подпапку с именем 'Processed'" },
    { name: "filename_prefix_1", label: "Prefix 1 / Префикс имени 1", desc: "First block of the filename", ru_desc: "Первый block в названии файла" },
    { name: "filename_prefix_2", label: "Prefix 2 / Префикс имени 2", desc: "Second block of the filename", ru_desc: "Второй блок в названии файла" },
    { name: "filename_prefix_3", label: "Prefix 3 / Префикс имени 3", desc: "Third block of the filename", ru_desc: "Третий блок в названии файла" },
    { name: "filename_separator", label: "Separator / Разделитель", desc: "Character used between filename prefixes", ru_desc: "Символ-разделитель между блоками имени" },
    { name: "use_counter", label: "Naming Mode / Режим именования", desc: "Toggle between serial 4-digit index counter and timestamp-on-conflict", ru_desc: "Переключатель: порядковый счетчик (0001) или фиксация времени при конфликте" },
    { name: "embed_workflow", label: "Embed Workflow / Вшить рабочий процесс", desc: "Save ComfyUI workflow metadata inside image or into a side JSON file", ru_desc: "Сохранять метаданные рабочей схемы внутри картинки или в отдельный JSON" },
    { name: "image_format", label: "Image Format / Формат файла", desc: "Select extension: PNG, JPG, or WEBP", ru_desc: "Выбор формата файла: PNG, JPG или WEBP" },
    { name: "quality_jpg_webp", label: "quality (jpg/webp) / Качество", desc: "Compression quality slider. Active for JPG and WEBP only (Ignored for PNG)", ru_desc: "Ползунок качества сжатия. Активен только для JPG и WEBP (Для PNG игнорируется)" },
    { name: "optimize_png", label: "Optimize PNG / Оптимизация PNG", desc: "Lossless/lossy compression via external pngquant and oxipng binaries", ru_desc: "Сжатие утилитами pngquant и oxipng (создает резервный JSON-воркфлоу)" }
];

app.registerExtension({
    name: "OreXSaveImage.Antigravity.Unique",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        
        // Делаем проверку по аналогии с ratio — проверяем оба возможных варианта регистрации имени
        if (nodeData.name === "orex Save Image" || nodeData.name === "OreXSaveImage") {
            
            const proto = nodeType.prototype;
            const onNodeCreated = proto.onNodeCreated;

            proto.onNodeCreated = function () {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);
                
                // Принудительно красим в черный цвет при создании
                this.color = "#000000";
                this.bgcolor = "#0f0f0f";
                
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
                SAVE_HELP_DESCRIPTIONS.forEach((item) => { maxLabelW = Math.max(maxLabelW, ctx.measureText(item.label).width); ctx.font = descFont; maxDescW = Math.max(maxDescW, ctx.measureText(`- ${item.desc} / ${item.ru_desc}`).width); ctx.font = labelFont; });
                let firstWidget = this.widgets?.find(w => w.last_y !== undefined); let lastWidget = this.widgets ? [...this.widgets].reverse().find(w => w.last_y !== undefined) : null;
                let minWidgetY = firstWidget ? firstWidget.last_y : 30; let lastWidgetY = lastWidget ? lastWidget.last_y : this.size[1] - 30;
                const labelX = bx + margin + 10, descX = labelX + maxLabelW + 15; const boxW = (descX - bx) + maxDescW + margin; const by = minWidgetY - 45, boxH = (lastWidgetY + widgetH + 10) - by;
                ctx.fillStyle = "rgba(0,0,0,0.95)"; ctx.strokeStyle = "#00ff44"; ctx.lineWidth = 1.6;
                if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 12); ctx.fill(); ctx.stroke(); } else { ctx.fillRect(bx, by, boxW, boxH); ctx.strokeRect(bx, by, boxW, boxH); }
                
                ctx.font = "bold 16px Arial"; ctx.textAlign = "left"; ctx.fillStyle = "#fff"; 
                ctx.fillText("Explanations / Описание", bx + margin, by + 22);
                let fallbackY = by + 60;
                SAVE_HELP_DESCRIPTIONS.forEach((item) => {
                    const w = this.widgets?.find(wd => wd.name === item.name || wd.label === item.name); const y = (w && w.last_y !== undefined) ? w.last_y + (widgetH / 2) : fallbackY; if (!w || w.last_y === undefined) fallbackY += 28;
                    ctx.font = labelFont; ctx.fillStyle = "#fff"; ctx.fillText(item.label, labelX, y); ctx.font = descFont; ctx.fillStyle = "#aaa"; ctx.fillText(`- ${item.desc} / ${item.ru_desc}`, descX, y);
                });
                ctx.restore();
            };

        }
    }
});