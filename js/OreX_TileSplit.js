import { app } from "../../../scripts/app.js";


function hideWidget(widget) {
    if (!widget || widget.__orexHidden) return;
    widget.__orexHidden = true;
    widget.__orexType = widget.type;
    widget.__orexComputeSize = widget.computeSize;
    widget.computeSize = () => [0, -4];
    widget.type = `converted-widget:${widget.name}`;
}


function showWidget(widget) {
    if (!widget || !widget.__orexHidden) return;
    widget.type = widget.__orexType;
    widget.computeSize = widget.__orexComputeSize;
    delete widget.__orexHidden;
    delete widget.__orexType;
    delete widget.__orexComputeSize;
}


function updateScaleWidgets(node) {
    const mode = node.widgets?.find((widget) => widget.name === "mode_scale");
    const factor = node.widgets?.find((widget) => widget.name === "min_scale_factor");
    const longest = node.widgets?.find((widget) => widget.name === "min_longest_size");
    const tiles = node.widgets?.find((widget) => widget.name === "max_tiles_by_side");
    if (!mode || !factor || !longest || !tiles) return;

    if (mode.value === "min_longest_size") {
        hideWidget(factor);
        showWidget(longest);
        hideWidget(tiles);
    } else if (mode.value === "max_tiles_by_side") {
        hideWidget(factor);
        hideWidget(longest);
        showWidget(tiles);
    } else {
        showWidget(factor);
        hideWidget(longest);
        hideWidget(tiles);
    }

    requestAnimationFrame(() => {
        const computed = node.computeSize();
        node.setSize([Math.max(node.size[0], computed[0]), computed[1]]);
        app.graph?.setDirtyCanvas(true, true);
    });
}


app.registerExtension({
    name: "OreX.TileCrop.ScaleMode",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "OreX_TileSplit") return;

        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            originalCreated?.apply(this, arguments);
            const mode = this.widgets?.find((widget) => widget.name === "mode_scale");
            if (!mode) return;

            const originalCallback = mode.callback;
            mode.callback = (value) => {
                const result = originalCallback?.call(mode, value);
                updateScaleWidgets(this);
                return result;
            };
            updateScaleWidgets(this);
        };

        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = originalConfigure?.apply(this, arguments);
            requestAnimationFrame(() => updateScaleWidgets(this));
            return result;
        };
    },
});
