import { app } from "../../scripts/app.js";

const RATIO_HELP_DESCRIPTIONS = [
    { icon: "📐", name: "ratio", label: "ratio / Пропорция", desc: "Select a predefined aspect ratio or 'Custom' for manual dragging", ru_desc: "Выбор готовой пропорции кадра или 'Custom' для произвольного растягивания" },
    { icon: "🖥️", name: "Megapixel", label: "Megapixel / Разрешение (MP)", desc: "Target resolution in Megapixels. The node will scale width and height to match this area", ru_desc: "Целевое разрешение в мегапикселях. Размеры кадра будут подогнаны под эту площадь" },
    { icon: "⚙️", name: "Megapixel = 1024^2", label: "Megapixel = 1024^2 / База площади", desc: "Toggle between 1024x1024 (1.05 MP) or 1000x1000 (1.00 MP) as 1 Megapixel", ru_desc: "🟢 ENABLED: База 1024x1024 (1.05 MP) | 🔴 DISABLED: База 1000x1000 (1.00 MP)" },
    { icon: "🔢", name: "Multiplicity", label: "Multiplicity / Кратность сторон", desc: "Round the dimensions to integers multiples of this value (8, 16, 32, 64)", ru_desc: "Округлять размеры до чисел кратных этому значению (8, 16, 32, 64)" }
];

function getHitArea(node, pos, widget) {
    const [mx, my] = pos;
    const y = widget.last_y;
    if (y === undefined) return null;
    
    const height = 260;
    const width = node.size[0];

    if (my < y || my > y + height) return null;

    const { w, h } = widget.getOutputDimensions(node);
    const scale = node.dragging ? (node.dragScale || 1) : (node.previewScale || 1);

    const cx = width / 2;
    const cy = y + height / 2;
    const boxW = w * scale;
    const boxH = h * scale;

    const left = cx - boxW / 2;
    const right = cx + boxW / 2;
    const top = cy - boxH / 2;
    const bottom = cy + boxH / 2;
    const hr = 12;

    const onL = Math.abs(mx - left) < hr;
    const onR = Math.abs(mx - right) < hr;
    const onT = Math.abs(my - top) < hr;
    const onB = Math.abs(my - bottom) < hr;
    const inX = mx > left - hr && mx < right + hr;
    const inY = my > top - hr && my < bottom + hr;

    if (onL && onT) return "tl";
    if (onR && onT) return "tr";
    if (onL && onB) return "bl";
    if (onR && onB) return "br";
    if (onL && inY) return "l";
    if (onR && inY) return "r";
    if (onT && inX) return "t";
    if (onB && inX) return "b";
    return null;
}

app.registerExtension({
    name: "orex.Ratio",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "orex Ratio") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            const onMouseMove = nodeType.prototype.onMouseMove;
            const onConfigure = nodeType.prototype.onConfigure;

            nodeType.prototype.onConfigure = function(info) {
                if (onConfigure) onConfigure.apply(this, arguments);
                this.setupWidgetsAndCallbacks();
            };

            nodeType.prototype.onMouseMove = function(e, pos, canvas) {
                if (onMouseMove) onMouseMove.apply(this, arguments);

                const [mx, my] = pos;
                const isOutside = mx < 0 || mx > this.size[0] || my < 0 || my > this.size[1];

                if (isOutside || this.dragging) {
                    this._clearTooltip();
                } else if (this.widgets) {
                    let hoveredWidget = null;
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

                    if (hoveredWidget && app.canvas && app.canvas.canvas) {
                        app.canvas.canvas.title = "";
                    }

                    if (this.lastHoveredWidget !== hoveredWidget) {
                        this.lastHoveredWidget = hoveredWidget;
                        this._clearTooltip();

                        if (hoveredWidget) {
                            const wNameStrict = (hoveredWidget.name || "").trim();
                            const wLabelStrict = (hoveredWidget.label || "").trim();

                            let tooltipInfo = RATIO_HELP_DESCRIPTIONS.find(item => 
                                wNameStrict === item.name || wLabelStrict === item.name
                            );

                            if (!tooltipInfo) {
                                const wName = wNameStrict.toLowerCase().replace(/_/g, " ");
                                const wLabel = wLabelStrict.toLowerCase().replace(/_/g, " ");
                                tooltipInfo = RATIO_HELP_DESCRIPTIONS.find(item => {
                                    const itemName = (item.name || "").toLowerCase().trim().replace(/_/g, " ");
                                    return wName === itemName || wLabel === itemName;
                                });
                            }

                            if (tooltipInfo) {
                                const widgetY = hoveredWidget.last_y;
                                this.hoverTimer = setTimeout(() => {
                                    this.activeTooltip = tooltipInfo;
                                    this.activeTooltipY = widgetY;
                                    this.setDirtyCanvas(true, true);
                                    this.hoverTimer = null;
                                }, 800);
                            }
                        }
                    }
                }

                const widget = this.widgets?.find(w => w.name === "ratio_preview");
                if (!widget) return false;

                if (!this.dragging) {
                    const hit = getHitArea(this, pos, widget);
                    const cursors = { 
                        tl: "nwse-resize", br: "nwse-resize", 
                        tr: "nesw-resize", bl: "nesw-resize", 
                        t: "ns-resize", b: "ns-resize", 
                        l: "ew-resize", r: "ew-resize" 
                    };
                    
                    if (hit) {
                        app.canvas.canvas.style.cursor = cursors[hit];
                        return true;
                    } else {
                        app.canvas.canvas.style.cursor = "default";
                        return false;
                    }
                }
                return false;
            };

            nodeType.prototype._clearTooltip = function() {
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

            nodeType.prototype.setupWidgetsAndCallbacks = function() {
                if (this._widgetsSetupDone) return;
                
                const node = this; 
                
                const cw = node.widgets?.find(w => w.name === "custom_width");
                if (cw) { cw.type = "hidden"; cw.computeSize = () => [0, -4]; }
                const ch = node.widgets?.find(w => w.name === "custom_height");
                if (ch) { ch.type = "hidden"; ch.computeSize = () => [0, -4]; }

                const baseWidget = node.widgets?.find(w => w.name === "Megapixel = 1024^2");
                if (baseWidget) {
                    baseWidget.options = baseWidget.options || {};
                    baseWidget.options.on = "🟢 ENABLED";
                    baseWidget.options.off = "🔴 DISABLED";
                    
                    if (!baseWidget._hookDone) {
                        const origBaseCallback = baseWidget.callback;
                        baseWidget.callback = function() {
                            if (origBaseCallback) origBaseCallback.apply(this, arguments);
                            node.setDirtyCanvas(true);
                        };
                        baseWidget._hookDone = true;
                    }
                }
                
                const mpWidget = node.widgets?.find(w => w.name === "Megapixel");
                if (mpWidget && !mpWidget._hookDone) {
                    const origMpCallback = mpWidget.callback;
                    mpWidget.callback = function(value) {
                        if (origMpCallback) origMpCallback.apply(this, arguments);
                        
                        const ratioW = node.widgets?.find(w => w.name === "ratio");
                        if (ratioW && ratioW.value === "Custom" && !node._is_dragging_sync) {
                            const cwW = node.widgets?.find(w => w.name === "custom_width");
                            const chW = node.widgets?.find(w => w.name === "custom_height");
                            
                            if (cwW && chW && chW.value > 0) {
                                const currentRatio = cwW.value / chW.value;
                                const basePixels = (baseWidget && !!baseWidget.value) ? (1024 * 1024) : (1000 * 1000);
                                const targetPixels = value * basePixels;

                                const newH = Math.sqrt(targetPixels / currentRatio);
                                const newW = newH * currentRatio;

                                cwW.value = newW;
                                chW.value = newH;
                            }
                        }
                        node.setDirtyCanvas(true);
                    };
                    mpWidget._hookDone = true;
                }

                const ratioWidget = node.widgets?.find(w => w.name === "ratio");
                if (ratioWidget && !ratioWidget._hookDone) {
                    const origRatioCallback = ratioWidget.callback;
                    ratioWidget.callback = function() {
                        if (origRatioCallback) origRatioCallback.apply(this, arguments);
                        node.setDirtyCanvas(true);
                    };
                    ratioWidget._hookDone = true;
                }
                
                this._widgetsSetupDone = true;
            };

            nodeType.prototype.onNodeCreated = function() {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);
                
                this.color = "#855185";
                this.bgcolor = "#5f3a5f"; 

                this.activeTooltip = null;
                this.activeTooltipY = null;
                this.hoverTimer = null;
                this.lastHoveredWidget = null;
                
                this.setupWidgetsAndCallbacks();

                const canvasWidget = {
                    type: "custom_canvas", 
                    name: "ratio_preview",
                    
                    getOutputDimensions: function(node) {
                        const ratioW = node.widgets?.find(w => w.name === "ratio");
                        const ratioVal = ratioW ? ratioW.value : "1:1 ◻";
                        const cleanRatio = ratioVal.split(' ')[0];
                        const mult = node.widgets?.find(w => w.name === "Multiplicity")?.value || 16;
                        
                        let outW = 1024;
                        let outH = 1024;

                        if (cleanRatio === "Custom") {
                            let cw_val = node.widgets?.find(w => w.name === "custom_width")?.value || 1024;
                            let ch_val = node.widgets?.find(w => w.name === "custom_height")?.value || 1024;
                            outW = Math.max(mult, Math.round(cw_val / mult) * mult);
                            outH = Math.max(mult, Math.round(ch_val / mult) * mult);
                        } else {
                            const mp = node.widgets?.find(w => w.name === "Megapixel")?.value || 1.0;
                            const baseWidget = node.widgets?.find(w => w.name === "Megapixel = 1024^2");
                            const use1024 = baseWidget ? !!baseWidget.value : true;
                            const basePixels = use1024 ? (1024 * 1024) : (1000 * 1000);
                            const targetPixels = mp * basePixels;
                            
                            const parts = cleanRatio.split(':');
                            const rw = Number(parts[0]) || 1;
                            const rh = Number(parts[1]) || 1;
                            const ratioFraction = rw / rh;
                            let hBase = Math.sqrt(targetPixels / ratioFraction);
                            let wBase = hBase * ratioFraction;
                            
                            outW = Math.max(mult, Math.round(wBase / mult) * mult);
                            outH = Math.max(mult, Math.round(hBase / mult) * mult);
                        }

                        const cwW = node.widgets?.find(w => w.name === "custom_width");
                        const chW = node.widgets?.find(w => w.name === "custom_height");
                        if (cwW && cwW.value !== outW) cwW.value = outW;
                        if (chW && chW.value !== outH) chW.value = outH;

                        return { w: outW, h: outH };
                    },
                    
                    computeSize: function(width) {
                        return [width, 260];
                    },
                    
                    draw: function(ctx, node, width, y) {
                        this.last_y = y;
                        const height = 260;
                        
                        ctx.fillStyle = "#1e1e1e";
                        ctx.fillRect(0, y, width, height);
                        
                        const { w, h } = this.getOutputDimensions(node);
                        
                        if (!node.dragging) {
                            node.previewScale = Math.min((width - 40) / Math.max(256, w), (height - 40) / Math.max(256, h));
                        }
                        const scale = node.dragging ? (node.dragScale || 1) : (node.previewScale || 1);
                        
                        const cx = width / 2;
                        const cy = y + height / 2;
                        
                        const gridSize = 128 * scale;
                        ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        for (let x = cx; x < width; x += gridSize) { ctx.moveTo(x, y); ctx.lineTo(x, y + height); }
                        for (let x = cx - gridSize; x > 0; x -= gridSize) { ctx.moveTo(x, y); ctx.lineTo(x, y + height); }
                        for (let yy = cy; yy < y + height; yy += gridSize) { ctx.moveTo(0, yy); ctx.lineTo(width, yy); }
                        for (let yy = cy - gridSize; yy > y; yy -= gridSize) { ctx.moveTo(0, yy); ctx.lineTo(width, yy); }
                        ctx.stroke();
                        
                        const boxW = w * scale;
                        const boxH = h * scale;
                        const bx = cx - boxW / 2;
                        const by = cy - boxH / 2;
                        
                        ctx.fillStyle = "rgba(0,0,0,0.5)";
                        ctx.fillRect(bx, by, boxW, boxH);
                        
                        ctx.strokeStyle = "#0f0";
                        ctx.lineWidth = 2;
                        ctx.strokeRect(bx, by, boxW, boxH);
                        
                        ctx.strokeStyle = "rgba(170, 255, 0, 0.8)";
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy);
                        ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10);
                        ctx.stroke();
                        
                        ctx.font = "bold 16px Arial"; 
                        ctx.textAlign = "center"; 
                        ctx.shadowColor = "black"; 
                        ctx.shadowBlur = 4; 
                        ctx.fillStyle = "#ADFF2F"; 
                        let textY = cy + boxH / 2 - 10;
                        if (boxH < 30) textY = cy + 5;
                        ctx.fillText(`${w} × ${h} px`, cx, textY);
                        ctx.shadowBlur = 0; 
                    },
                    
                    mouse: function(event, pos, node) {
                        const [mx, my] = pos;
                        const y = this.last_y || 0;
                        const height = 260;
                        const width = node.size[0];
                        
                        if (my < y || my > y + height) {
                            if (!node.dragging) return false;
                        }
                        
                        const hit = getHitArea(node, pos, this);
                        
                        if (event.type === "pointerdown" || event.type === "mousedown") {
                            if (hit) {
                                node.dragging = true;
                                node.dragMode = hit;
                                node.dragScale = node.previewScale || 1;
                                
                                const { w, h } = this.getOutputDimensions(node);
                                node.dragStartW = w;
                                node.dragStartH = h;
                                
                                const ratioW = node.widgets?.find(w => w.name === "ratio");
                                if (ratioW && ratioW.value !== "Custom") {
                                    ratioW.value = "Custom";
                                }
                                return true;
                            }
                        } 
                        else if (event.type === "pointermove" || event.type === "mousemove") {
                            if (!node.dragging) return false;
                            
                            if (event.buttons === 0) {
                                node.dragging = false;
                                app.canvas.canvas.style.cursor = "default";
                                return false;
                            }
                            
                            const cx = width / 2;
                            const cy = y + height / 2;
                            const dragScale = node.dragScale || 1;
                            
                            let dx = Math.abs(mx - cx) * 2 / dragScale;
                            let dy = Math.abs(my - cy) * 2 / dragScale;
                            
                            let newW = node.dragStartW;
                            let newH = node.dragStartH;
                            const ar = node.dragStartW / node.dragStartH;
                            
                            if (node.dragMode === "l" || node.dragMode === "r") {
                                newW = dx;
                            } else if (node.dragMode === "t" || node.dragMode === "b") {
                                newH = dy;
                            } else {
                                if (dx / ar > dy) {
                                    newW = dx;
                                    newH = newW / ar;
                                } else {
                                    newH = dy;
                                    newW = newH * ar;
                                }
                            }
                            
                            const cwW = node.widgets?.find(w => w.name === "custom_width");
                            const chW = node.widgets?.find(w => w.name === "custom_height");
                            if (cwW) cwW.value = Math.max(64, Math.round(newW));
                            if (chW) chW.value = Math.max(64, Math.round(newH));
                            
                            const mult = node.widgets?.find(w => w.name === "Multiplicity")?.value || 16;
                            const finalW = Math.max(mult, Math.round(newW / mult) * mult);
                            const finalH = Math.max(mult, Math.round(newH / mult) * mult);
                            
                            const mpWidget = node.widgets?.find(w => w.name === "Megapixel");
                            const baseWidget = node.widgets?.find(w => w.name === "Megapixel = 1024^2");
                            if (mpWidget) {
                                const use1024 = baseWidget ? !!baseWidget.value : true;
                                const basePixels = use1024 ? (1024 * 1024) : (1000 * 1000);
                                
                                node._is_dragging_sync = true;
                                mpWidget.value = parseFloat(((finalW * finalH) / basePixels).toFixed(2));
                                node._is_dragging_sync = false;
                            }
                            
                            node.setDirtyCanvas(true);
                            return true;
                        } 
                        else if (event.type === "pointerup" || event.type === "mouseup") {
                            if (node.dragging) {
                                node.dragging = false;
                                app.canvas.canvas.style.cursor = "default";
                                node.setDirtyCanvas(true);
                                return true;
                            }
                        }
                        return false;
                    }
                };

                this.addCustomWidget(canvasWidget);
            };

            nodeType.prototype.onMouseLeave = function () {
                this._clearTooltip();
                if (app.canvas && app.canvas.canvas) {
                    app.canvas.canvas.title = "";
                }
            };

            const onDestroy = nodeType.prototype.onDestroy;
            nodeType.prototype.onDestroy = function () {
                this._clearTooltip();
                if (onDestroy) onDestroy.apply(this, arguments);
            };

            // Восстановил onDrawForeground вместо того, чтобы его удалять!
            nodeType.prototype.onDrawForeground = function (ctx) {
                if (this.flags?.collapsed) return;

                if (this.widgets) {
                    for (const w of this.widgets) {
                        if (w.tooltip) w.tooltip = null; 
                    }
                }

                if (this.activeTooltip) {
                    this._drawTooltip(ctx);
                }
            };

            nodeType.prototype._drawTooltip = function (ctx) {
                if (!this.activeTooltip) return;
                const item = this.activeTooltip;
                const wy = this.activeTooltipY !== null ? this.activeTooltipY : 100;
                
                const margin = 12;
                const bx = this.size[0] + 20; 
                
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
                
                ctx.fillStyle = "rgba(18, 18, 18, 0.95)";
                ctx.strokeStyle = "rgba(133, 81, 133, 0.7)"; 
                ctx.lineWidth = 1.5;
                ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
                ctx.shadowBlur = 8;
                
                const radius = 8;        
                const arrowWidth = 8;    
                const arrowHeight = 14;  
                const arrowTipY = wy + 12; 
                
                ctx.beginPath();
                ctx.moveTo(bx + radius, by);
                ctx.lineTo(bx + boxW - radius, by);
                ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + radius);
                ctx.lineTo(bx + boxW, by + boxH - radius);
                ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - radius, by + boxH);
                ctx.lineTo(bx + radius, by + boxH);
                ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - radius);
                ctx.lineTo(bx, arrowTipY + arrowHeight / 2);
                ctx.lineTo(bx - arrowWidth, arrowTipY);
                ctx.lineTo(bx, arrowTipY - arrowHeight / 2);
                ctx.lineTo(bx, by + radius);
                ctx.quadraticCurveTo(bx, by, bx + radius, by);
                ctx.closePath();
                
                ctx.fill();
                ctx.stroke();
                
                ctx.shadowColor = "transparent";

                ctx.textBaseline = "top";
                ctx.textAlign = "left";

                ctx.font = "bold 13px sans-serif";
                ctx.fillStyle = "#ffffff";
                ctx.fillText(titleText, bx + margin, by + margin);

                ctx.font = "11px sans-serif";
                ctx.fillStyle = "#cccccc";
                ctx.fillText(descText, bx + margin, by + margin + 20);

                ctx.font = "11px sans-serif";
                ctx.fillStyle = "#999999";
                ctx.fillText(ruDescText, bx + margin, by + margin + 36);

                ctx.restore();
            };
        }
    }
});