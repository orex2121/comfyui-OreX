import os
import json
import random

import torch
import numpy as np
from PIL import Image, ImageFilter
import folder_paths

class OreX_CameraRaw:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image": ("IMAGE",),
                "Enable Settings": ("BOOLEAN", {"default": True}),
                
                # ==== Camera Raw Settings ====
                "Exposure": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1, "display": "slider"}),
                "Contrast": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1, "display": "slider"}),
                "Highlights": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1, "display": "slider"}),
                "Shadows": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1, "display": "slider"}),
                "Whites": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1, "display": "slider"}),
                "Blacks": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1, "display": "slider"}),
                "Temperature": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1, "display": "slider"}),
                "Tint": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1, "display": "slider"}),
                "Colorfulness": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1, "display": "slider"}),
                "Saturation": ("INT", {"default": 0, "min": -100, "max": 100, "step": 1, "display": "slider"}),
                "Texture": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1, "display": "slider"}),
                "Clarity": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1, "display": "slider"}),
                "Dehaze": ("INT", {"default": 0, "min": -150, "max": 150, "step": 1, "display": "slider"}),
                "Grain": ("INT", {"default": 0, "min": 0, "max": 150, "step": 1, "display": "slider"}),
                "Sharpening": ("INT", {"default": 0, "min": 0, "max": 150, "step": 1, "display": "slider"}),
                "Gaussian Blur": ("INT", {"default": 0, "min": 0, "max": 150, "step": 1, "display": "slider"}),
                "Vignette": ("INT", {"default": 0, "min": 0, "max": 150, "step": 1, "display": "slider"}),
                
                # ==== Hidden Data Fields ====
                "HSL Active": ("BOOLEAN", {"default": False}),
                "HSL Data": ("STRING", {"default": "{}"}),
                "Curve Active": ("BOOLEAN", {"default": False}),
                "Curve Data": ("STRING", {"default": "{}"}),
            }
        }

    CATEGORY = "🤫OreX/Filters"
    DESCRIPTION = "Advanced Color Correction Node featuring Camera Raw, HSL, and RGB Curves."
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("IMAGE",)
    FUNCTION = "process"
    OUTPUT_NODE = True 

    @staticmethod
    def rgb_to_hsl(rgb):
        r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        maxc = np.max(rgb, axis=-1)
        minc = np.min(rgb, axis=-1)
        l = (maxc + minc) / 2.0
        
        s = np.zeros_like(l)
        h = np.zeros_like(l)
        
        mask = maxc != minc
        d = np.zeros_like(l)
        d[mask] = maxc[mask] - minc[mask]
        
        denom = np.where(l > 0.5, 2.0 - maxc - minc, maxc + minc)
        denom = np.where(denom == 0, 1.0, denom) 
        s[mask] = d[mask] / denom[mask]
        
        idx_r = mask & (maxc == r)
        idx_g = mask & (maxc == g) & (~idx_r)
        idx_b = mask & (maxc == b) & (~idx_r) & (~idx_g)
        
        h[idx_r] = (g[idx_r] - b[idx_r]) / d[idx_r] + np.where(g[idx_r] < b[idx_r], 6.0, 0.0)
        h[idx_g] = (b[idx_g] - r[idx_g]) / d[idx_g] + 2.0
        h[idx_b] = (r[idx_b] - g[idx_b]) / d[idx_b] + 4.0
        
        h = (h / 6.0) * 360.0
        return np.stack([h, s, l], axis=-1)

    @staticmethod
    def hsl_to_rgb(hsl):
        h, s, l = hsl[..., 0] / 360.0, hsl[..., 1], hsl[..., 2]
        
        def hue_to_rgb(p, q, t):
            t = np.where(t < 0.0, t + 1.0, t)
            t = np.where(t > 1.0, t - 1.0, t)
            
            res = np.empty_like(t)
            m1 = t < 1.0/6.0
            m2 = (~m1) & (t < 0.5)
            m3 = (~m1) & (~m2) & (t < 2.0/3.0)
            m4 = (~m1) & (~m2) & (~m3)
            
            res[m1] = p[m1] + (q[m1] - p[m1]) * 6.0 * t[m1]
            res[m2] = q[m2]
            res[m3] = p[m3] + (q[m3] - p[m3]) * (2.0/3.0 - t[m3]) * 6.0
            res[m4] = p[m4]
            return res
            
        q = np.where(l < 0.5, l * (1.0 + s), l + s - l * s)
        p = 2.0 * l - q
        
        r = np.where(s == 0, l, hue_to_rgb(p, q, h + 1.0/3.0))
        g = np.where(s == 0, l, hue_to_rgb(p, q, h))
        b = np.where(s == 0, l, hue_to_rgb(p, q, h - 1.0/3.0))
        
        return np.stack([r, g, b], axis=-1)

    @staticmethod
    def build_curve_lut(points):
        default_points = [(0.0, 0.0), (255.0, 255.0)]
        parsed_points = []

        if isinstance(points, list):
            for p in points:
                if not isinstance(p, dict):
                    continue
                try:
                    x = float(p.get("x", 0))
                    y = float(p.get("y", 0))
                except Exception:
                    continue
                parsed_points.append((float(np.clip(x, 0, 255)), float(np.clip(y, 0, 255))))

        if len(parsed_points) < 2:
            parsed_points = default_points.copy()

        parsed_points.sort(key=lambda pt: pt[0])
        dedup_points = []
        for pt in parsed_points:
            if dedup_points and abs(dedup_points[-1][0] - pt[0]) < 1e-6:
                dedup_points[-1] = pt
            else:
                dedup_points.append(pt)
        parsed_points = dedup_points

        if parsed_points[0][0] > 0:
            parsed_points.insert(0, (0.0, parsed_points[0][1]))
        if parsed_points[-1][0] < 255:
            parsed_points.append((255.0, parsed_points[-1][1]))

        # Сплайн Catmull-Rom через все контрольные точки — та же математика,
        # что и evalCurveSpline в OreX_CameraRaw.js, чтобы финальный рендер
        # (Run) совпадал с живым превью в редакторе, а не давал ломаную
        # линию вместо плавной кривой.
        xs = [p[0] for p in parsed_points]
        ys = [p[1] for p in parsed_points]
        n = len(xs)
        lut = np.zeros(256, dtype=np.float32)
        for x_int in range(256):
            x = float(x_int)
            i = 0
            while i < n - 2 and x > xs[i + 1]:
                i += 1
            p1x, p1y = xs[i], ys[i]
            p2x, p2y = xs[min(i + 1, n - 1)], ys[min(i + 1, n - 1)]
            # На границах линейно экстраполируем недостающего соседа,
            # а не дублируем крайнюю точку — иначе даже прямая линия
            # из 2 точек искривлялась бы у краёв.
            p0y = ys[i - 1] if i > 0 else (2 * p1y - p2y)
            p3y = ys[i + 2] if i < n - 2 else (2 * p2y - p1y)
            dx = (p2x - p1x) or 1.0
            t = max(0.0, min(1.0, (x - p1x) / dx))
            t2 = t * t
            t3 = t2 * t
            y = 0.5 * (
                (2 * p1y) +
                (-p0y + p2y) * t +
                (2 * p0y - 5 * p1y + 4 * p2y - p3y) * t2 +
                (-p0y + 3 * p1y - 3 * p2y + p3y) * t3
            )
            lut[x_int] = y
        return np.clip(lut, 0, 255).astype(np.uint8)

    @staticmethod
    def curve_is_active(curve_state):
        if not isinstance(curve_state, dict):
            return False
        default_line = [(0, 0), (255, 255)]

        for ch in ["rgb", "r", "g", "b"]:
            points = curve_state.get(ch, [])
            if not isinstance(points, list) or len(points) < 2:
                continue
            normalized = []
            for p in points:
                if not isinstance(p, dict):
                    continue
                normalized.append((
                    int(np.clip(round(float(p.get("x", 0))), 0, 255)),
                    int(np.clip(round(float(p.get("y", 0))), 0, 255))
                ))
            normalized.sort(key=lambda pt: pt[0])
            if len(normalized) >= 2 and normalized != default_line:
                return True
        return False

    @staticmethod
    def apply_lightness_like_photoshop(lightness, delta):
        delta = np.clip(delta, -1.0, 1.0)
        positive = delta >= 0
        out = np.where(
            positive,
            lightness + (1.0 - lightness) * delta,
            lightness + lightness * delta
        )
        return np.clip(out, 0.0, 1.0)

    @staticmethod
    def apply_detail_pass(arr, radius, amount, midtone_only=False):
        if abs(amount) < 1e-6:
            return arr

        base_img = Image.fromarray(np.clip(arr * 255.0, 0, 255).astype(np.uint8))
        blur_img = base_img.filter(ImageFilter.GaussianBlur(radius=max(0.1, float(radius))))
        blur_arr = np.array(blur_img).astype(np.float32) / 255.0

        diff = arr - blur_arr
        if midtone_only:
            luma = np.dot(arr[..., :3], [0.2126, 0.7152, 0.0722])
            mask = 1.0 - np.clip(np.abs(luma - 0.5) * 2.0, 0.0, 1.0)
            mask = np.power(mask, 1.25)[..., None]
            diff = diff * mask

        arr = arr + diff * float(amount)
        return np.clip(arr, 0.0, 1.0)

    def apply_camera_raw(self, img, kwargs):
        if not kwargs.get("cr_enable", False):
            return img

        # Extract arguments
        exp = kwargs.get("cr_exp", 0)
        cont = kwargs.get("cr_cont", 0)
        sat = kwargs.get("cr_sat", 0)
        sharp = kwargs.get("cr_sharp", 0)
        clar = kwargs.get("cr_clar", 0)
        tex = kwargs.get("cr_tex", 0)
        blur = kwargs.get("cr_blur", 0)
        high = kwargs.get("cr_high", 0)
        shad = kwargs.get("cr_shad", 0)
        white = kwargs.get("cr_white", 0)
        black = kwargs.get("cr_black", 0)
        temp = kwargs.get("cr_temp", 0)
        tint = kwargs.get("cr_tint", 0)
        colorfulness = kwargs.get("cr_colorfulness", 0)
        dehz = kwargs.get("cr_dehz", 0)
        grain = kwargs.get("cr_grain", 0)
        vignette = kwargs.get("cr_vignette", 0)

        needs_cr = any(v != 0 for v in [exp, high, shad, white, black, temp, tint, colorfulness, dehz, grain, vignette, cont, sat, sharp, clar, tex, blur])
        needs_hsl = kwargs.get("hsl_active", False) and kwargs.get("hsl_data", "{}") != "{}"
        
        hsl_state = {}
        if needs_hsl:
            try:
                hsl_state = json.loads(kwargs["hsl_data"])
                has_hsl_changes = hsl_state.get("colorize", False)
                if not has_hsl_changes:
                    for key in ["master", "reds", "yellows", "greens", "cyans", "blues", "magentas"]:
                        conf = hsl_state.get(key, {})
                        if conf.get("h", 0) != 0 or conf.get("s", 0) != 0 or conf.get("l", 0) != 0:
                            has_hsl_changes = True
                            break
                needs_hsl = has_hsl_changes
            except Exception as e:
                print(f"OreX_CameraRaw: Не удалось разобрать HSL Data - {e}")
                needs_hsl = False

        needs_curve = kwargs.get("curve_active", False) and kwargs.get("curve_data", "{}") != "{}"
        curve_state = {}
        if needs_curve:
            try:
                curve_state = json.loads(kwargs.get("curve_data", "{}"))
                needs_curve = self.curve_is_active(curve_state)
            except Exception as e:
                print(f"OreX_CameraRaw: Не удалось разобрать Curve Data - {e}")
                needs_curve = False

        if needs_cr or needs_hsl or needs_curve:
            arr = np.array(img.convert("RGB")).astype(np.float32) / 255.0
            
            if needs_cr:
                if temp != 0 or tint != 0:
                    arr[:,:,0] += temp / 200.0 + (tint * 2.0) / 400.0
                    arr[:,:,1] -= (tint * 2.0) / 400.0
                    arr[:,:,2] -= temp / 200.0 - (tint * 2.0) / 400.0

                luma = np.dot(arr[..., :3], [0.299, 0.587, 0.114])

                if exp != 0: 
                    mult = 2.0 ** (exp / 50.0)
                    arr = arr * mult
                    luma = luma * mult

                if shad != 0: 
                    shad_v = shad / 100.0
                    mask = np.clip((0.72 - luma) / 0.72, 0.0, 1.0)
                    mask = mask * mask * (3.0 - 2.0 * mask)
                    if shad_v >= 0:
                        lift = mask[..., None] * shad_v * 0.85
                        arr += (1.0 - arr) * lift
                    else:
                        darken = mask[..., None] * (-shad_v) * 0.8
                        arr *= (1.0 - darken)

                if high != 0:
                    mask = np.clip((luma - 0.5) / 0.5, 0, 1)
                    arr += arr * mask[..., None] * (high/100.0) * 0.5

                if white != 0:
                    arr += (arr ** 2) * (white/100.0) * 0.5

                if black != 0:
                    arr -= ((1.0 - arr) ** 2) * (black/100.0) * 0.5

                if cont != 0:
                    f = 1.0 + (cont / 100.0)
                    arr = (arr - 0.5) * f + 0.5

                if sat != 0:
                    luma_new = np.dot(arr[..., :3], [0.299, 0.587, 0.114])
                    arr = luma_new[..., None] + (arr - luma_new[..., None]) * (1.0 + sat/100.0)

                if colorfulness != 0:
                    luma_c = np.dot(arr[..., :3], [0.299, 0.587, 0.114])
                    max_color = np.max(arr[..., :3], axis=2, keepdims=True)
                    min_color = np.min(arr[..., :3], axis=2, keepdims=True)
                    sat_mask = 1.0 - (max_color - min_color)
                    arr[..., :3] = arr[..., :3] + (arr[..., :3] - luma_c[..., None]) * (colorfulness/100.0) * sat_mask

                if dehz != 0:
                    dehz_v = dehz / 150.0
                    luma_d = np.dot(arr[..., :3], [0.299, 0.587, 0.114])[..., None]
                    max_color = np.max(arr[..., :3], axis=2, keepdims=True)
                    min_color = np.min(arr[..., :3], axis=2, keepdims=True)
                    haze = np.clip(1.0 - (max_color - min_color) * 2.0, 0.0, 1.0)
                    mid = 1.0 - np.clip(np.abs(luma_d - 0.5) * 2.0, 0.0, 1.0)
                    weight = np.clip(0.35 + 0.65 * haze * mid, 0.0, 1.0)

                    if dehz_v > 0:
                        contrast = 1.0 + dehz_v * 0.9 * weight
                        arr = (arr - 0.5) * contrast + 0.5
                        neutral = np.mean(arr[..., :3], axis=2, keepdims=True)
                        sat_boost = dehz_v * 0.18 * weight
                        arr[..., :3] += (arr[..., :3] - neutral) * sat_boost
                    else:
                        soften = (-dehz_v) * 0.45 * weight
                        arr = (arr - 0.5) * (1.0 - soften) + 0.5

                if vignette > 0:
                    h_img, w_img = arr.shape[:2]
                    y_mesh, x_mesh = np.ogrid[:h_img, :w_img]
                    center_y, center_x = h_img / 2, w_img / 2
                    radius = np.sqrt((x_mesh - center_x)**2 + (y_mesh - center_y)**2)
                    max_radius = np.sqrt(center_x**2 + center_y**2)
                    vig_mask = 1.0 - np.clip((radius / max_radius - 0.3) * (vignette / 50.0), 0, 1)
                    arr = arr * vig_mask[..., None]

                if grain > 0:
                    noise = np.random.normal(0, grain/200.0, arr.shape)
                    arr += noise

            arr = np.clip(arr, 0.0, 1.0)
            
            if needs_hsl:
                hsl = self.rgb_to_hsl(arr)
                hh, ss, ll = hsl[..., 0], hsl[..., 1], hsl[..., 2]
                sat_strength = np.log(6.0)
                
                if hsl_state.get("colorize", False):
                    master = hsl_state.get("master", {"h":0, "s":0, "l":0})
                    h_val = master.get("h", 0)
                    if h_val < 0: h_val += 360
                    hh = np.full_like(hh, h_val)
                    ss = np.clip(0.5 + (master.get("s", 0) / 100.0), 0.0, 1.0)
                    ll = self.apply_lightness_like_photoshop(ll, master.get("l", 0) / 100.0)
                else:
                    master = hsl_state.get("master", {"h":0, "s":0, "l":0})
                    total_h_shift = np.full_like(hh, master.get("h", 0))
                    total_s_mult = np.full_like(ss, np.exp((master.get("s", 0) / 100.0) * sat_strength))
                    total_l_shift = np.full_like(ll, master.get("l", 0) / 100.0)
                    
                    for ch in ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas']:
                        if ch in hsl_state:
                            conf = hsl_state[ch]
                            if conf.get("h",0) == 0 and conf.get("s",0) == 0 and conf.get("l",0) == 0:
                                continue
                            
                            center = conf.get("center", 0)
                            width = conf.get("width", 60)
                            
                            diff = np.abs(hh - center)
                            diff = np.where(diff > 180, 360.0 - diff, diff)
                            half = max(5.0, width / 2.0)
                            falloff = max(12.0, half * 0.65)
                            
                            weight = np.zeros_like(hh)
                            m1 = diff <= half
                            m2 = (~m1) & (diff <= half + falloff)
                            
                            weight[m1] = 1.0
                            t = (diff[m2] - half) / falloff
                            weight[m2] = 0.5 * (1.0 + np.cos(np.pi * t))
                            
                            if np.any(weight > 0):
                                total_h_shift += conf.get("h",0) * weight
                                total_s_mult *= np.exp((conf.get("s",0) / 100.0) * sat_strength * weight)
                                total_l_shift += (conf.get("l",0) / 100.0) * weight
                                
                    hh = (hh + total_h_shift) % 360.0
                    hh = np.where(hh < 0, hh + 360.0, hh)
                    ss = np.clip(ss * total_s_mult, 0.0, 1.0)
                    ll = self.apply_lightness_like_photoshop(ll, total_l_shift)
                    
                hsl = np.stack([hh, ss, ll], axis=-1)
                arr = self.hsl_to_rgb(hsl)
                arr = np.clip(arr, 0.0, 1.0)

            if needs_curve:
                lut_rgb = self.build_curve_lut(curve_state.get("rgb", []))
                lut_r = self.build_curve_lut(curve_state.get("r", []))
                lut_g = self.build_curve_lut(curve_state.get("g", []))
                lut_b = self.build_curve_lut(curve_state.get("b", []))

                rgb = np.clip(np.round(arr[..., :3] * 255.0), 0, 255).astype(np.uint8)
                rgb[..., 0] = lut_rgb[rgb[..., 0]]
                rgb[..., 1] = lut_rgb[rgb[..., 1]]
                rgb[..., 2] = lut_rgb[rgb[..., 2]]

                rgb[..., 0] = lut_r[rgb[..., 0]]
                rgb[..., 1] = lut_g[rgb[..., 1]]
                rgb[..., 2] = lut_b[rgb[..., 2]]
                arr[..., :3] = rgb.astype(np.float32) / 255.0

            if tex != 0:
                arr = self.apply_detail_pass(arr, radius=0.9, amount=tex / 140.0, midtone_only=False)
            if clar != 0:
                arr = self.apply_detail_pass(arr, radius=2.0, amount=clar / 130.0, midtone_only=True)
            if sharp > 0:
                arr = self.apply_detail_pass(arr, radius=1.6, amount=sharp / 110.0, midtone_only=False)
            if blur > 0:
                blur_img = Image.fromarray(np.clip(arr * 255.0, 0, 255).astype(np.uint8))
                blur_img = blur_img.filter(ImageFilter.GaussianBlur(radius=blur / 10.0))
                arr = np.array(blur_img).astype(np.float32) / 255.0
                
            arr = np.clip(arr, 0.0, 1.0)
            img = Image.fromarray((arr * 255.0).astype(np.uint8))

        return img

    def process(self, image, **kwargs):
        cr_enable = kwargs.get("Enable Settings", True)
        if not cr_enable:
            return self._generate_output(image)

        mapped_kwargs = {
            "cr_enable": cr_enable,
            "cr_exp": kwargs.get("Exposure", 0),
            "cr_cont": kwargs.get("Contrast", 0),
            "cr_high": kwargs.get("Highlights", 0),
            "cr_shad": kwargs.get("Shadows", 0),
            "cr_white": kwargs.get("Whites", 0),
            "cr_black": kwargs.get("Blacks", 0),
            "cr_temp": kwargs.get("Temperature", 0),
            "cr_tint": kwargs.get("Tint", 0),
            "cr_colorfulness": kwargs.get("Colorfulness", 0),
            "cr_sat": kwargs.get("Saturation", 0),
            "cr_tex": kwargs.get("Texture", 0),
            "cr_clar": kwargs.get("Clarity", 0),
            "cr_dehz": kwargs.get("Dehaze", 0),
            "cr_grain": kwargs.get("Grain", 0),
            "cr_sharp": kwargs.get("Sharpening", 0),
            "cr_blur": kwargs.get("Gaussian Blur", 0),
            "cr_vignette": kwargs.get("Vignette", 0),
            
            "hsl_active": kwargs.get("HSL Active", False),
            "hsl_data": kwargs.get("HSL Data", "{}"),
            "curve_active": kwargs.get("Curve Active", False),
            "curve_data": kwargs.get("Curve Data", "{}")
        }
        
        out_images = []
        for img_tensor in image:
            arr = img_tensor.cpu().numpy()
            img_pil = Image.fromarray(np.clip(arr * 255.0, 0, 255).astype(np.uint8))
            
            res_pil = self.apply_camera_raw(img_pil, mapped_kwargs)
            
            res_tensor = torch.from_numpy(np.array(res_pil).astype(np.float32) / 255.0)
            out_images.append(res_tensor)
            
        result_tensor = torch.stack(out_images, dim=0)
        return self._generate_output(result_tensor, image)

    def _generate_output(self, result_tensor, original_tensor=None):
        """
        Сохраняем превью оригинального (неотфильтрованного) изображения.
        Это позволяет JS-редактору и ноде применять свои живые фильтры к исходнику, а не поверх других фильтров.
        """
        if original_tensor is None:
            original_tensor = result_tensor
            
        ui_images = []
        try:
            preview_arr = original_tensor[0].cpu().numpy()
            preview_pil = Image.fromarray(np.clip(preview_arr * 255.0, 0, 255).astype(np.uint8))
            
            preview_filename = f"orex_cr_preview_{random.randint(100000, 999999)}.png"
            preview_path = os.path.join(folder_paths.get_temp_directory(), preview_filename)
            preview_pil.save(preview_path, compress_level=1)
            
            ui_images.append({
                "filename": preview_filename,
                "subfolder": "",
                "type": "temp"
            })
        except Exception as e:
            print(f"OreX_CameraRaw: Не удалось сгенерировать превью - {e}")

        # Возвращаем превью оригинала в UI, а результат - отфильтрованный
        return {"ui": {"images": ui_images}, "result": (result_tensor,)}

NODE_CLASS_MAPPINGS = {
    "orex Camera Raw": OreX_CameraRaw
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "orex Camera Raw": "📸 Camera Raw (OreX)"
}

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']