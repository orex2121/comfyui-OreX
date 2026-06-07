import { app } from "../../scripts/app.js";

// Вспомогательная функция для определения зоны, над которой находится курсор мыши
function getHitArea(node, pos, widget) {
    const [mx, my] = pos;
    const y = widget.last_y;
    if (y === undefined) return null;
    
    const height = 260;
    const width = node.size[0];

    if (my < y || my > y + height) return null;

    const { w, h } = widget.getOutputDimensions(node);
    const scale = node.dragging ? node.dragScale : node.previewScale;

    const cx = width / 2;
    const cy = y + height / 2;
    const boxW = w * scale;
    const boxH = h * scale;

    const left = cx - boxW / 2;
    const right = cx + boxW / 2;
    const top = cy - boxH / 2;
    const bottom = cy + boxH / 2;
    const hr = 12; // Зона захвата в пикселях

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
            nodeType.prototype.onMouseMove = function(e, pos, canvas) {
                if (onMouseMove) onMouseMove.apply(this, arguments);

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
                        app.canvas.canvas.style.cursor = "";
                        return false;
                    }
                }
                return false;
            };

            nodeType.prototype.onNodeCreated = function() {
                if (onNodeCreated) {
                    onNodeCreated.apply(this, arguments);
                }
                
                this.color = "#855185";
                this.bgcolor = "#5f3a5f"; 
                
                const setupWidgetsAndCallbacks = () => {
                    const node = this; 
                    
                    const cw = node.widgets?.find(w => w.name === "custom_width");
                    if (cw) { cw.type = "hidden"; cw.computeSize = () => [0, -4]; }
                    const ch = node.widgets?.find(w => w.name === "custom_height");
                    if (ch) { ch.type = "hidden"; ch.computeSize = () => [0, -4]; }

                    const baseWidget = node.widgets?.find(w => w.name === "Megapixel = 1024^2");
                    if (baseWidget && !baseWidget._setupDone) {
                        baseWidget.options = baseWidget.options || {};
                        baseWidget.options.on = "🟢 ENABLED";
                        baseWidget.options.off = "🔴 DISABLED";
                        baseWidget._setupDone = true;
                    }
                    
                    const mpWidget = node.widgets?.find(w => w.name === "Megapixel");
                    const ratioWidget = node.widgets?.find(w => w.name === "ratio");
                    
                    if (mpWidget && !mpWidget._setupDone) {
                        const origMpCallback = mpWidget.callback;
                        mpWidget.callback = function(value, appCanvas, node_arg, pos, event) {
                            if (origMpCallback) origMpCallback.apply(this, arguments);
                            
                            // Пересчет кастомной рамки при ручном изменении Megapixel
                            const ratioW = node.widgets?.find(w => w.name === "ratio");
                            if (ratioW && ratioW.value === "Custom" && !node._is_dragging_sync) {
                                const cwW = node.widgets?.find(w => w.name === "custom_width");
                                const chW = node.widgets?.find(w => w.name === "custom_height");
                                
                                if (cwW && chW && chW.value > 0) {
                                    // Захватываем текущую пропорцию рамки
                                    const currentRatio = cwW.value / chW.value;
                                    const baseWidget = node.widgets?.find(w => w.name === "Megapixel = 1024^2");
                                    const use1024 = baseWidget ? !!baseWidget.value : true;
                                    const basePixels = use1024 ? (1024 * 1024) : (1000 * 1000);
                                    const targetPixels = value * basePixels;

                                    // Вычисляем новые габариты, сохраняя пропорцию
                                    const newH = Math.sqrt(targetPixels / currentRatio);
                                    const newW = newH * currentRatio;

                                    cwW.value = newW;
                                    chW.value = newH;
                                }
                            }
                            node.setDirtyCanvas(true); // Форсируем перерисовку, которая сама синхронизирует скрытые поля
                        };
                        mpWidget._setupDone = true;
                    }

                    if (baseWidget && !baseWidget._hookDone) {
                        const origBaseCallback = baseWidget.callback;
                        baseWidget.callback = function(value, appCanvas, node_arg, pos, event) {
                            if (origBaseCallback) origBaseCallback.apply(this, arguments);
                            node.setDirtyCanvas(true);
                        };
                        baseWidget._hookDone = true;
                    }

                    // Добавляем коллбэк на изменение Ratio, чтобы обновлять холст сразу
                    if (ratioWidget && !ratioWidget._hookDone) {
                        const origRatioCallback = ratioWidget.callback;
                        ratioWidget.callback = function(value, appCanvas, node_arg, pos, event) {
                            if (origRatioCallback) origRatioCallback.apply(this, arguments);
                            node.setDirtyCanvas(true);
                        };
                        ratioWidget._hookDone = true;
                    }
                };

                setupWidgetsAndCallbacks();
                setTimeout(setupWidgetsAndCallbacks.bind(this), 100);

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

                        // ЖЕСТКАЯ СИНХРОНИЗАЦИЯ: Что бы ни происходило, мы принудительно
                        // записываем рассчитанные визуальные размеры в скрытые поля, 
                        // чтобы бэкенд Python 100% получил именно то, что на экране.
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
                        
                        const baseWidget = node.widgets?.find(w => w.name === "Megapixel = 1024^2");
                        if (baseWidget && baseWidget.options) {
                            baseWidget.options.on = "🟢 ENABLED";
                            baseWidget.options.off = "🔴 DISABLED";
                        }
                        
                        ctx.fillStyle = "#1e1e1e";
                        ctx.fillRect(0, y, width, height);
                        
                        // Вызов getOutputDimensions здесь также автоматически синхронизирует скрытые поля
                        const { w, h } = this.getOutputDimensions(node);
                        
                        if (!node.dragging) {
                            node.previewScale = Math.min((width - 40) / Math.max(256, w), (height - 40) / Math.max(256, h));
                        }
                        const scale = node.dragging ? node.dragScale : node.previewScale;
                        
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
                                node.dragScale = node.previewScale;
                                
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
                                app.canvas.canvas.style.cursor = "";
                                return false;
                            }
                            
                            const cx = width / 2;
                            const cy = y + height / 2;
                            
                            let dx = Math.abs(mx - cx) * 2 / node.dragScale;
                            let dy = Math.abs(my - cy) * 2 / node.dragScale;
                            
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
                                app.canvas.canvas.style.cursor = "";
                                node.setDirtyCanvas(true);
                                return true;
                            }
                        }
                        return false;
                    }
                };
                
                delete nodeType.prototype.onDrawForeground;
                delete nodeType.prototype.computeSize;

                this.addCustomWidget(canvasWidget);
            };
        }
    }
});