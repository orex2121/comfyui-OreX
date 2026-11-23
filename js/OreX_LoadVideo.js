import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";


function fileUrl(value) {
    if (!value || typeof value !== "string") return null;
    const normalized = value.replace(/\\/g, "/").replace(/\s+\[input\]$/, "");
    const split = normalized.lastIndexOf("/");
    const filename = split >= 0 ? normalized.slice(split + 1) : normalized;
    const subfolder = split >= 0 ? normalized.slice(0, split) : "";
    const query = new URLSearchParams({ filename, subfolder, type: "input" });
    return api.apiURL(`/view?${query.toString()}`);
}


function previewVideos(node) {
    const videos = new Set();
    const collect = (value) => {
        if (value instanceof HTMLVideoElement) videos.add(value);
        else if (value instanceof HTMLElement) value.querySelectorAll("video").forEach((video) => videos.add(video));
    };
    for (const widget of node.widgets ?? []) {
        for (const key of ["element", "inputEl", "video", "container"]) collect(widget?.[key]);
    }
    for (const value of node.imgs ?? []) collect(value);
    return [...videos];
}


function findWidget(node, ...names) {
    return node.widgets?.find((widget) => names.includes(widget.name));
}


function trimRange(node) {
    const start = Math.max(0, Number(findWidget(node, "start_time", "start_time (frame)")?.value) || 0);
    const duration = Math.max(0, Number(findWidget(node, "durations", "durations (max_frames)")?.value) || 0);
    const imagesMode = Boolean(node.outputs?.[1]?.links?.length);
    if (imagesMode && !node._orexVideoFps) return null;
    const divisor = imagesMode ? node._orexVideoFps : 1;
    return { start: start / divisor, duration: duration / divisor };
}


function updateTrimPreview(node) {
    const range = trimRange(node);
    const value = findWidget(node, "file")?.value;
    const url = fileUrl(value);
    if (!range || !url) return;

    for (const video of previewVideos(node)) {
        const applyRange = () => {
            const end = range.duration > 0 ? Math.min(video.duration, range.start + range.duration) : video.duration;
            video._orexTrimStart = Math.min(range.start, video.duration || range.start);
            video._orexTrimEnd = end;
            video.currentTime = video._orexTrimStart;
        };
        if (!video._orexTrimBound) {
            video._orexTrimBound = true;
            video.addEventListener("timeupdate", () => {
                if (video._orexTrimEnd == null || video.currentTime < video._orexTrimEnd) return;
                video.currentTime = video._orexTrimStart || 0;
            });
            video.addEventListener("seeking", () => {
                if (video._orexTrimEnd == null) return;
                if (video.currentTime < video._orexTrimStart || video.currentTime > video._orexTrimEnd) {
                    video.currentTime = video._orexTrimStart;
                }
            });
        }
        if (video.dataset.orexInputFile !== String(value)) {
            video.dataset.orexInputFile = String(value);
            video.src = url;
            video.load();
            video.addEventListener("loadedmetadata", applyRange, { once: true });
        } else if (video.readyState >= 1) {
            applyRange();
        } else {
            video.addEventListener("loadedmetadata", applyRange, { once: true });
        }
    }
}


async function updateFps(node) {
    const value = findWidget(node, "file")?.value;
    node._orexVideoFps = 0;
    if (!value) return;
    try {
        const query = new URLSearchParams({ file: String(value) });
        const response = await api.fetchApi(`/orex/load-video-metadata?${query.toString()}`);
        if (response.ok) node._orexVideoFps = Number((await response.json()).fps) || 0;
    } finally {
        node.graph?.setDirtyCanvas(true, true);
        updateTrimPreview(node);
    }
}


function wrapWidget(node, names, afterChange) {
    const widget = findWidget(node, ...names);
    if (!widget || widget._orexWrapped) return;
    widget._orexWrapped = true;
    const callback = widget.callback;
    widget.callback = function () {
        const result = callback?.apply(this, arguments);
        afterChange();
        return result;
    };
}


function updateResolution(node) {
    const value = node.widgets?.find((widget) => widget.name === "file")?.value;
    const url = fileUrl(value);
    node._orexVideoResolution = "";
    node._orexVideoDuration = 0;
    node._orexResolutionProbe?.removeAttribute("src");
    node._orexResolutionProbe?.load?.();
    if (!url) {
        node.graph?.setDirtyCanvas(true, true);
        return;
    }

    const video = document.createElement("video");
    node._orexResolutionProbe = video;
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
        if (node._orexResolutionProbe !== video) return;
        node._orexVideoResolution = `${video.videoWidth}x${video.videoHeight}`;
        node._orexVideoDuration = Number(video.duration) || 0;
        node.graph?.setDirtyCanvas(true, true);
        video.removeAttribute("src");
        video.load();
    };
    video.onerror = () => {
        if (node._orexResolutionProbe === video) node._orexVideoResolution = "";
        node.graph?.setDirtyCanvas(true, true);
    };
    video.src = url;
}


app.registerExtension({
    name: "OreX.LoadVideo",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "OreXLoadVideo") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated?.apply(this, arguments);
            const node = this;
            wrapWidget(node, ["file"], () => {
                updateResolution(node);
                updateFps(node);
                requestAnimationFrame(() => updateTrimPreview(node));
            });
            wrapWidget(node, ["start_time", "start_time (frame)"], () => requestAnimationFrame(() => updateTrimPreview(node)));
            wrapWidget(node, ["durations", "durations (max_frames)"], () => requestAnimationFrame(() => updateTrimPreview(node)));
            queueMicrotask(() => {
                updateResolution(node);
                updateFps(node);
                updateTrimPreview(node);
            });
            return result;
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = onConfigure?.apply(this, arguments);
            queueMicrotask(() => {
                updateResolution(this);
                updateFps(this);
                updateTrimPreview(this);
            });
            return result;
        };

        const onConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function () {
            const result = onConnectionsChange?.apply(this, arguments);
            queueMicrotask(() => updateTrimPreview(this));
            return result;
        };

        const onDrawForeground = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function (ctx) {
            onDrawForeground?.apply(this, arguments);
            if (this.flags?.collapsed || !this._orexVideoResolution) return;
            ctx.save();
            ctx.fillStyle = "#39e66b";
            ctx.font = "bold 13px sans-serif";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(this._orexVideoResolution, 10, 14);
            if (this._orexVideoFps) {
                ctx.fillStyle = "#2196ff";
                ctx.fillText(`FPS: ${Number(this._orexVideoFps.toFixed(3))}`, 10, 32);
            }
            if (this._orexVideoDuration) {
                ctx.fillStyle = "#ff4fa3";
                ctx.fillText(`Duration: ${this._orexVideoDuration.toFixed(2)} s`, 10, 50);
            }
            ctx.restore();
        };

        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            this._orexResolutionProbe?.removeAttribute("src");
            this._orexResolutionProbe?.load?.();
            this._orexResolutionProbe = null;
            return onRemoved?.apply(this, arguments);
        };
    },
});


app.registerExtension({
    name: "OreX.PurpleVideoHeaders",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!new Set(["OreXLoadVideo", "RelayVSRAutoChunked"]).has(nodeData.name)) return;

        const applyHeaderColor = (node) => {
            node.color = "#A000FF";
            node.setDirtyCanvas?.(true, true);
        };

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated?.apply(this, arguments);
            applyHeaderColor(this);
            return result;
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = onConfigure?.apply(this, arguments);
            applyHeaderColor(this);
            return result;
        };
    },
});


app.registerExtension({
    name: "OreX.RelayVSRResolution",
    async setup() {
        api.addEventListener("executed", (event) => {
            const node = app.graph?.getNodeById(event.detail?.node);
            if ((node?.comfyClass ?? node?.type) !== "RelayVSRAutoChunked") return;
            const resolution = event.detail?.output?.orex_resolution?.[0];
            if (!resolution) return;
            requestAnimationFrame(() => {
                let widget = node.widgets?.find((item) => item.name === "orex_result_resolution");
                if (!widget) {
                    const oldHeight = node.size[1];
                    const element = document.createElement("div");
                    Object.assign(element.style, {
                        height: "28px",
                        color: "#39e66b",
                        font: "bold 13px sans-serif",
                        display: "flex",
                        alignItems: "center",
                        paddingLeft: "10px",
                        boxSizing: "border-box",
                        pointerEvents: "none",
                    });
                    widget = node.addDOMWidget("orex_result_resolution", "div", element, {
                        serialize: false,
                        hideOnZoom: false,
                        getMinHeight: () => 28,
                        getMaxHeight: () => 28,
                    });
                    node.setSize([node.size[0], Math.max(node.size[1], oldHeight + 28)]);
                }
                widget.element.textContent = resolution;
                node.setDirtyCanvas?.(true, true);
            });
        });
    },
});
