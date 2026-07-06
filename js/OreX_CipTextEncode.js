import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "OreX.CipTextEncode",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "orex Cip Text Encode") {
            
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated) {
                    onNodeCreated.apply(this, arguments);
                }
                this.updateStringInputs();
            };

            const onConnectionsChange = nodeType.prototype.onConnectionsChange;
            nodeType.prototype.onConnectionsChange = function (type, index, connected, link_info) {
                if (onConnectionsChange) {
                    onConnectionsChange.apply(this, arguments);
                }
                if (type === LiteGraph.INPUT) {
                    this.updateStringInputs();
                }
            };

            nodeType.prototype.updateStringInputs = function () {
                if (!this.inputs) {
                    this.inputs = [];
                }

                let lastConnectedIndex = 0;

                for (let i = 0; i < this.inputs.length; i++) {
                    const input = this.inputs[i];
                    if (input.name.startsWith("string")) {
                        const idx = parseInt(input.name.replace("string", ""), 10);
                        if (!isNaN(idx)) {
                            if (input.link != null && idx > lastConnectedIndex) {
                                lastConnectedIndex = idx;
                            }
                        }
                    }
                }

                const targetCount = lastConnectedIndex + 1;

                for (let i = this.inputs.length - 1; i >= 0; i--) {
                    const input = this.inputs[i];
                    if (input.name.startsWith("string")) {
                        const idx = parseInt(input.name.replace("string", ""), 10);
                        if (!isNaN(idx) && idx > targetCount) {
                            this.removeInput(i);
                        }
                    }
                }

                for (let i = 1; i <= targetCount; i++) {
                    let found = false;
                    for (let j = 0; j < this.inputs.length; j++) {
                        if (this.inputs[j].name === "string" + i) {
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        this.addInput("string" + i, "STRING");
                    }
                }

                if (this.computeSize) {
                    this.setSize(this.computeSize());
                }
            };
        }
    }
});