import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const CLASS = "OreXCreateBoundingBoxes";
const COLORS = ["#ff4848", "#3884ff", "#22c55e", "#a855f7", "#facc15", "#06b6d4", "#ec4899", "#f97316"];
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number(v) || 0));

function cleanRegion(r, i = 0) {
    return {
        x: clamp(r?.x), y: clamp(r?.y),
        w: Math.max(0.002, Math.min(1, Math.abs(Number(r?.w) || 0.2))),
        h: Math.max(0.002, Math.min(1, Math.abs(Number(r?.h) || 0.2))),
        type: r?.type === "text" ? "text" : (r?.type === "character" ? "character" : "obj"),
        text: typeof r?.text === "string" ? r.text : "",
        desc: typeof r?.desc === "string" ? r.desc : "",
        // The editor outline colour is visual chrome, not a requested object colour.
        // Only colours explicitly entered by the user belong in color_palette.
        palette: Array.isArray(r?.palette) ? r.palette.slice(0, 5) : [],
    };
}

function state(node) {
    node.properties ??= {};
    const p = node.properties.orexBoundingBoxes ??= { regions: [], last_incoming: [] };
    if (!Array.isArray(p.regions)) p.regions = [];
    if (!Array.isArray(p.last_incoming)) p.last_incoming = [];
    // v1 accidentally stored each box's editor outline as a semantic palette.
    // Remove that generated value once; explicitly entered palettes otherwise survive.
    if ((p.version || 1) < 2) {
        p.regions.forEach((r, i) => {
            const generated = COLORS[i % COLORS.length].toLowerCase();
            if (Array.isArray(r?.palette) && r.palette.length === 1 && String(r.palette[0]).toLowerCase() === generated) {
                r.palette = [];
            }
        });
        p.version = 2;
    }
    return p;
}

function mark(node) {
    node.graph?.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
}

function el(tag, css = {}, text = "") {
    const x = document.createElement(tag);
    Object.assign(x.style, css);
    if (text) x.textContent = text;
    return x;
}

function makeButton(text) {
    return el("button", {
        padding: "5px 9px", border: "1px solid #555", borderRadius: "5px",
        background: "#303030", color: "#eee", cursor: "pointer"
    }, text);
}

function drawTypeIcon(ctx, type, x, y, size, dpr) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.95)";
    ctx.fillStyle = "rgba(255,255,255,.95)";
    ctx.lineWidth = Math.max(1, 1.2 * dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (type === "text") {
        ctx.font = `bold ${10 * dpr}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("T", x + size / 2, y + size / 2 + .3 * dpr);
    } else if (type === "character") {
        // Head and shoulders.
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size * .32, size * .21, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + size * .16, y + size * .9);
        ctx.quadraticCurveTo(x + size * .5, y + size * .53, x + size * .84, y + size * .9);
        ctx.stroke();
    } else {
        // Small isometric cube for ordinary objects.
        ctx.beginPath();
        ctx.moveTo(x + size * .5, y + size * .08);
        ctx.lineTo(x + size * .9, y + size * .3);
        ctx.lineTo(x + size * .9, y + size * .76);
        ctx.lineTo(x + size * .5, y + size * .96);
        ctx.lineTo(x + size * .1, y + size * .76);
        ctx.lineTo(x + size * .1, y + size * .3);
        ctx.closePath();
        ctx.moveTo(x + size * .1, y + size * .3);
        ctx.lineTo(x + size * .5, y + size * .53);
        ctx.lineTo(x + size * .9, y + size * .3);
        ctx.moveTo(x + size * .5, y + size * .53);
        ctx.lineTo(x + size * .5, y + size * .96);
        ctx.stroke();
    }
    ctx.restore();
}

function buildEditor(node) {
    const root = el("div", {
        display: "flex", flexDirection: "column", gap: "7px", padding: "8px",
        boxSizing: "border-box", width: "100%", height: "100%", minHeight: "430px",
        background: "#1d1d1d", color: "#eee", font: "12px Arial, sans-serif"
    });
    root.tabIndex = -1;
    root.style.outline = "none";
    const bar = el("div", { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" });
    const add = makeButton("+ Box"), del = makeButton("Delete"), clear = makeButton("Clear");
    const hint = el("span", { opacity: ".7", marginLeft: "auto" }, "Drag empty area to draw • drag box to move • drag corner to resize");
    bar.append(add, del, clear, hint);

    const wrap = el("div", { flex: "1 1 auto", minHeight: "250px", position: "relative", overflow: "hidden", border: "1px solid #555", borderRadius: "5px", background: "#262626" });
    const canvas = el("canvas", { width: "100%", height: "100%", display: "block", touchAction: "none", cursor: "crosshair" });
    wrap.append(canvas);

    const form = el("div", { display: "grid", gridTemplateColumns: "92px 1fr", gap: "7px 8px", alignItems: "center" });
    const type = document.createElement("select");
    type.innerHTML = '<option value="obj">Object</option><option value="character">Character</option><option value="text">Text</option>';
    const exact = el("input"), desc = el("textarea");
    const paletteRow = el("div", { display: "flex", alignItems: "center", gap: "7px", minHeight: "38px", flexWrap: "wrap" });
    exact.placeholder = "Exact text inside the box";
    desc.placeholder = "Description"; desc.rows = 2;
    for (const input of [type, exact, desc]) Object.assign(input.style, { width: "100%", boxSizing: "border-box", background: "#292929", color: "#eee", border: "1px solid #555", borderRadius: "4px", padding: "5px" });
    form.append(el("label", {}, "Type"), type, el("label", {}, "Text"), exact, el("label", {}, "Description"), desc, el("label", {}, "color_palette"), paletteRow);
    root.append(bar, wrap, form);

    const ui = node._orexBB = {
        root, wrap, canvas, form, type, exact, desc, paletteRow,
        selected: -1, drag: null, rainbowPhase: 0, rainbowFrame: 0
    };

    // In Classic mode the DOM editor is layered over LiteGraph's canvas, so
    // wheel events over the editor never reach ComfyUI's workflow zoom handler.
    // Nodes 2.0 already forwards these events itself and must not receive a
    // second synthetic event.
    const forwardWheelToGraph = event => {
        if (window.LiteGraph?.vueNodesMode) return;
        const graphCanvas = app.canvas?.canvas;
        if (!graphCanvas) return;
        event.preventDefault();
        event.stopPropagation();
        const { clientX, clientY, deltaX, deltaY, deltaZ, deltaMode,
            ctrlKey, altKey, metaKey, shiftKey } = event;
        graphCanvas.dispatchEvent(new WheelEvent("wheel", {
            clientX, clientY, deltaX, deltaY, deltaZ, deltaMode,
            ctrlKey, altKey, metaKey, shiftKey,
            bubbles: true, cancelable: true
        }));
    };
    root.addEventListener("wheel", forwardWheelToGraph, { passive: false });
    ui.removeWheelHandler = () => root.removeEventListener("wheel", forwardWheelToGraph);

    function animateSelection(time) {
        if (ui.selected < 0 || !node.graph || !document.contains(root)) {
            ui.rainbowFrame = 0;
            return;
        }
        ui.rainbowPhase = time * 0.06;
        draw();
        ui.rainbowFrame = requestAnimationFrame(animateSelection);
    }

    function ensureSelectionAnimation() {
        if (ui.selected >= 0 && !ui.rainbowFrame) {
            ui.rainbowFrame = requestAnimationFrame(animateSelection);
        }
    }

    function selected() { return state(node).regions[ui.selected]; }
    function renderPalette() {
        paletteRow.replaceChildren();
        const r = selected(), colors = r?.palette || [];
        paletteRow.style.opacity = r ? "1" : ".45";
        paletteRow.style.pointerEvents = r ? "auto" : "none";

        colors.forEach((color, index) => {
            const picker = document.createElement("input");
            picker.type = "color";
            picker.value = /^#[0-9a-f]{6}$/i.test(color) ? color : "#ffffff";
            picker.title = "Click to choose a colour. Right-click to remove it.";
            Object.assign(picker.style, {
                width: "40px", height: "36px", padding: "2px", boxSizing: "border-box",
                border: "1px solid #777", borderRadius: "6px", background: "#303030",
                cursor: "pointer"
            });
            picker.oninput = () => {
                const current = selected(); if (!current) return;
                current.palette[index] = picker.value.toUpperCase();
                mark(node); draw();
            };
            picker.oncontextmenu = event => {
                event.preventDefault();
                const current = selected(); if (!current) return;
                current.palette.splice(index, 1);
                mark(node); renderPalette(); draw();
            };
            paletteRow.append(picker);
        });

        if (colors.length < 5) {
            const plus = makeButton("+");
            plus.title = colors.length ? "Add another colour" : "Add a colour";
            plus.setAttribute("aria-label", plus.title);
            Object.assign(plus.style, { width: "40px", height: "36px", padding: "0", fontSize: "20px", lineHeight: "32px" });
            plus.onclick = () => {
                const current = selected(); if (!current || current.palette.length >= 5) return;
                current.palette.push("#FFFFFF");
                mark(node); renderPalette(); draw();
            };
            paletteRow.append(plus);
        }
    }

    function syncForm() {
        const r = selected(), disabled = !r;
        for (const c of [type, exact, desc]) c.disabled = disabled;
        type.value = r?.type || "obj";
        exact.value = r?.text || "";
        exact.parentElement;
        exact.style.display = r?.type === "text" ? "block" : "none";
        form.children[2].style.display = r?.type === "text" ? "block" : "none";
        desc.value = r?.desc || "";
        renderPalette();
        ensureSelectionAnimation();
    }

    function update(mutator) {
        const r = selected(); if (!r) return;
        mutator(r); mark(node); draw();
    }
    type.onchange = () => { update(r => r.type = type.value); syncForm(); };
    exact.oninput = () => update(r => r.text = exact.value);
    desc.oninput = () => update(r => r.desc = desc.value);

    function addBox() {
        const rs = state(node).regions;
        rs.push(cleanRegion({ x: .15 + (rs.length % 5) * .04, y: .15 + (rs.length % 5) * .04, w: .3, h: .25, palette: [] }, rs.length));
        ui.selected = rs.length - 1; syncForm(); mark(node); draw();
    }
    function deleteSelected() {
        if (ui.selected < 0) return false;
        state(node).regions.splice(ui.selected, 1);
        ui.selected = Math.min(ui.selected, state(node).regions.length - 1);
        syncForm(); mark(node); draw();
        return true;
    }
    add.onclick = addBox;
    del.onclick = deleteSelected;
    clear.onclick = () => { state(node).regions = []; ui.selected = -1; syncForm(); mark(node); draw(); };

    // ComfyUI normally handles Delete as "remove selected node".  While this
    // editor owns keyboard focus, consume it first and remove the selected box.
    // Inputs keep their normal text-editing behaviour.
    const handleDeleteKey = event => {
        if (event.key !== "Delete" && event.key !== "Backspace") return;
        if (document.activeElement !== root && !root.contains(document.activeElement)) return;
        const tag = document.activeElement?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (event.type === "keydown" && !event.repeat) deleteSelected();
    };
    window.addEventListener("keydown", handleDeleteKey, true);
    window.addEventListener("keyup", handleDeleteKey, true);
    ui.removeKeyboardHandlers = () => {
        window.removeEventListener("keydown", handleDeleteKey, true);
        window.removeEventListener("keyup", handleDeleteKey, true);
    };

    function metrics() {
        const dpr = window.devicePixelRatio || 1, rect = canvas.getBoundingClientRect();
        const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        const wi = Number(node.widgets?.find(x => x.name === "width")?.value) || 1024;
        const hi = Number(node.widgets?.find(x => x.name === "height")?.value) || 1024;
        const aspect = wi / Math.max(1, hi), avail = w / h;
        const cw = avail > aspect ? h * aspect : w, ch = avail > aspect ? h : w / aspect;
        return { dpr, x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch };
    }
    function draw() {
        const m = metrics(), ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#333"; ctx.fillRect(m.x, m.y, m.w, m.h);
        const img = node._orexBBImage;
        if (img?.complete && img.naturalWidth) { ctx.globalAlpha = .45; ctx.drawImage(img, m.x, m.y, m.w, m.h); ctx.globalAlpha = 1; }
        state(node).regions.forEach((r, i) => {
            const x = m.x + r.x * m.w, y = m.y + r.y * m.h, w = r.w * m.w, h = r.h * m.h;
            const c = r.palette?.[0] || COLORS[i % COLORS.length];
            ctx.fillStyle = c + "36"; ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = c; ctx.lineWidth = 2 * m.dpr; ctx.strokeRect(x, y, w, h);
            const boxNumber = String(i + 1).padStart(2, "0");
            ctx.fillStyle = c;
            ctx.font = `${12 * m.dpr}px sans-serif`;
            ctx.fillText(boxNumber, x + 4 * m.dpr, y + 14 * m.dpr);

            const numberWidth = ctx.measureText(boxNumber).width;
            const iconSize = 11 * m.dpr;
            const badgeX = x + 4 * m.dpr + numberWidth + 5 * m.dpr;
            const badgeY = y + 2 * m.dpr;
            const badgeWidth = iconSize + 6 * m.dpr;
            const badgeHeight = 15 * m.dpr;
            ctx.fillStyle = "rgba(18,18,18,.72)";
            if (typeof ctx.roundRect === "function") {
                ctx.beginPath();
                ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 3 * m.dpr);
                ctx.fill();
            } else {
                ctx.fillRect(badgeX, badgeY, badgeWidth, badgeHeight);
            }
            drawTypeIcon(ctx, r.type, badgeX + 3 * m.dpr, badgeY + 2 * m.dpr, iconSize, m.dpr);
            ctx.textAlign = "left";
            ctx.textBaseline = "alphabetic";

            // Show only colours explicitly selected by the user.  Up to three
            // compact swatches sit immediately to the right of the box number.
            const swatches = (r.palette || []).filter(value => /^#[0-9a-f]{6}$/i.test(value)).slice(0, 3);
            if (swatches.length) {
                const swatchSize = 9 * m.dpr;
                const swatchGap = 3 * m.dpr;
                const swatchY = y + 4 * m.dpr;
                swatches.forEach((colour, swatchIndex) => {
                    const swatchX = badgeX + badgeWidth + 5 * m.dpr + swatchIndex * (swatchSize + swatchGap);
                    ctx.fillStyle = colour;
                    ctx.fillRect(swatchX, swatchY, swatchSize, swatchSize);
                    ctx.strokeStyle = "rgba(255,255,255,.85)";
                    ctx.lineWidth = Math.max(1, m.dpr);
                    ctx.strokeRect(swatchX, swatchY, swatchSize, swatchSize);
                });
            }
            if (i === ui.selected) {
                ctx.save();
                // Dark under-stroke keeps the rainbow readable on any image.
                ctx.strokeStyle = "rgba(0,0,0,.8)";
                ctx.lineWidth = 3 * m.dpr;
                ctx.setLineDash([]);
                ctx.strokeRect(x, y, w, h);

                const rainbow = ctx.createLinearGradient(x, y, x + w, y + h);
                for (let stop = 0; stop <= 6; stop++) {
                    const hue = (stop * 60 + ui.rainbowPhase * 2.2) % 360;
                    rainbow.addColorStop(stop / 6, `hsl(${hue} 100% 60%)`);
                }
                ctx.strokeStyle = rainbow;
                ctx.lineWidth = 2 * m.dpr;
                ctx.setLineDash([11 * m.dpr, 5 * m.dpr]);
                ctx.lineDashOffset = -ui.rainbowPhase * m.dpr;
                ctx.strokeRect(x, y, w, h);
                ctx.restore();

                ctx.fillStyle = `hsl(${(ui.rainbowPhase * 2.2) % 360} 100% 60%)`;
                ctx.fillRect(x + w - 6 * m.dpr, y + h - 6 * m.dpr, 12 * m.dpr, 12 * m.dpr);
            }
        });
    }
    ui.draw = draw; ui.syncForm = syncForm;

    function point(e) { const m = metrics(), r = canvas.getBoundingClientRect(); return { m, x: (e.clientX - r.left) * m.dpr, y: (e.clientY - r.top) * m.dpr }; }
    canvas.onpointerdown = e => {
        root.focus({ preventScroll: true });
        canvas.setPointerCapture(e.pointerId); const p = point(e), rs = state(node).regions;
        let found = -1, mode = "new";
        for (let i = rs.length - 1; i >= 0; --i) {
            const r = rs[i], x = p.m.x + r.x*p.m.w, y = p.m.y + r.y*p.m.h, w=r.w*p.m.w, h=r.h*p.m.h;
            if (Math.abs(p.x-(x+w)) < 15*p.m.dpr && Math.abs(p.y-(y+h)) < 15*p.m.dpr) { found=i; mode="resize"; break; }
            if (p.x>=x && p.x<=x+w && p.y>=y && p.y<=y+h) { found=i; mode="move"; break; }
        }
        if (found < 0) { const x=clamp((p.x-p.m.x)/p.m.w), y=clamp((p.y-p.m.y)/p.m.h); rs.push(cleanRegion({x,y,w:.002,h:.002},rs.length)); found=rs.length-1; }
        ui.selected=found; const b={...rs[found]}; ui.drag={mode, sx:p.x, sy:p.y, b}; syncForm(); ensureSelectionAnimation(); draw();
    };
    canvas.onpointermove = e => {
        if (!ui.drag) return; const p=point(e), r=selected(), dx=(p.x-ui.drag.sx)/p.m.w, dy=(p.y-ui.drag.sy)/p.m.h, b=ui.drag.b;
        if (ui.drag.mode === "move") { r.x=clamp(b.x+dx,0,1-b.w); r.y=clamp(b.y+dy,0,1-b.h); }
        else { r.w=Math.max(.002,Math.min(1-r.x,b.w+dx)); r.h=Math.max(.002,Math.min(1-r.y,b.h+dy)); }
        mark(node); draw();
    };
    canvas.onpointerup = canvas.onpointercancel = () => { ui.drag=null; };
    ui.resizeObserver = new ResizeObserver(draw);
    ui.resizeObserver.observe(wrap);
    syncForm(); queueMicrotask(draw);
    return root;
}

function applyExecution(node, message) {
    const value = message?.orex_create_bounding_boxes?.[0];
    if (!value) return;
    const p = state(node);
    p.regions = (value.regions || []).map(cleanRegion);
    p.last_incoming = Array.isArray(value.last_incoming) ? value.last_incoming : [];
    const image = value.background_image;
    if (image?.filename) {
        const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || "", type: image.type || "temp" });
        const img = new Image();
        img.onload = () => node._orexBB?.draw?.();
        img.src = api.apiURL(`/view?${query}`);
        node._orexBBImage = img;
    } else {
        node._orexBBImage = null;
    }
    node._orexBB?.syncForm?.(); node._orexBB?.draw?.();
}

app.registerExtension({
    name: "OreX.CreateBoundingBoxesClassic",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== CLASS) return;
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            created?.apply(this, arguments);
            const root = buildEditor(this);
            this.addDOMWidget("orex_bbox_editor", "custom", root, { serialize: false, hideOnZoom: false });
            this.setSize([Math.max(460, this.size?.[0] || 0), Math.max(620, this.size?.[1] || 0)]);
        };
        const configured = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () { const r=configured?.apply(this,arguments); queueMicrotask(()=>{ this._orexBB?.syncForm?.(); this._orexBB?.draw?.(); }); return r; };
        const executed = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (m) { executed?.apply(this,arguments); applyExecution(this,m); };
        const removed = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            const ui = this._orexBB;
            if (ui?.rainbowFrame) cancelAnimationFrame(ui.rainbowFrame);
            ui?.removeKeyboardHandlers?.();
            ui?.removeWheelHandler?.();
            ui?.resizeObserver?.disconnect?.();
            return removed?.apply(this, arguments);
        };
    }
});

const originalGraphToPrompt = app.graphToPrompt;
app.graphToPrompt = async function (...args) {
    const result = await originalGraphToPrompt.apply(this, args);
    for (const id in result?.output || {}) {
        const entry = result.output[id];
        if (entry?.class_type !== CLASS) continue;
        const node = app.graph?.getNodeById?.(Number(id)) || app.graph?.getNodeById?.(id);
        if (node) (entry.inputs ??= {}).editor_state = JSON.stringify(state(node));
    }
    return result;
};
