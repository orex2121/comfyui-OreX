import { app } from "../../../scripts/app.js";

app.registerExtension({
    name: "OreXImageLoad.Style.Unique",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        
        // Точная привязка к имени из NODE_CLASS_MAPPINGS в Python
        if (nodeData.name === "orex Load Image") {
            
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);
                
                // Устанавливаем сплошной ярко-голубой цвет (RGB: 0, 150, 255 -> #0096ff)
                this.color = "#0096ff";
                this.bgcolor = "#0096ff";
            };
            
        }
    }
});