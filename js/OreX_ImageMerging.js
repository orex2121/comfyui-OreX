import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "OreX.ImageMerging",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "orex Image Merging") {
            
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                
                this._lastImageCount = -1; 
                
                this.updateImageInputs = function() {
                    const widget = this.widgets?.find(w => w.name === "image_number");
                    if (!widget) return;
                    
                    const count = Math.floor(widget.value);
                    if (count === this._lastImageCount) return;
                    this._lastImageCount = count;
                    
                    // 1. Добавляем недостающие пины
                    for (let i = 1; i <= count; i++) {
                        const inputName = "image" + i;
                        const exists = this.inputs && this.inputs.find(inp => inp.name === inputName);
                        if (!exists) {
                            this.addInput(inputName, "IMAGE");
                        }
                    }
                    
                    // 2. Удаляем лишние пины (чтобы они исчезали при уменьшении значения)
                    if (this.inputs) {
                        for (let i = this.inputs.length - 1; i >= 0; i--) {
                            const inp = this.inputs[i];
                            if (inp.name.startsWith("image")) {
                                const idx = parseInt(inp.name.replace("image", ""));
                                if (idx > count) {
                                    this.removeInput(i);
                                }
                            }
                        }
                    }

                    // 3. Жесткое схлопывание высоты! (Исправление бага "небоскреба")
                    const sz = this.computeSize();
                    this.size[0] = Math.max(this.size[0], sz[0]); // Сохраняем или расширяем ширину
                    this.size[1] = sz[1]; // ЖЕСТКО приравниваем высоту к минимально необходимой
                    this.setDirtyCanvas(true, true);
                };

                setTimeout(() => {
                    const widget = this.widgets?.find(w => w.name === "image_number");
                    if (widget) {
                        let val = widget.value;
                        Object.defineProperty(widget, 'value', {
                            get: function() { return val; },
                            set: (newVal) => {
                                val = newVal;
                                this.updateImageInputs();
                            }
                        });
                        
                        // Запускаем очистку сразу при появлении узла
                        this.updateImageInputs();
                    }
                }, 50);

                return r;
            };
            
            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function (info) {
                if (onConfigure) {
                    onConfigure.apply(this, arguments);
                }
                if (this.widgets) {
                    setTimeout(() => this.updateImageInputs(), 50);
                }
            };
        }
    }
});