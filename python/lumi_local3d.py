"""Lumi local 3D worker: image -> 3D shape with Hunyuan3D-2 on the local NVIDIA GPU.

Protocol: one JSON request per line on stdin, JSON events per line on stdout.
All library chatter is redirected to stderr so stdout stays clean.
"""
import json
import os
import sys
import time
import traceback

_proto = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
sys.stdout = sys.stderr  # anything printed by libraries goes to stderr


def send(**kw):
    _proto.write(json.dumps(kw) + "\n")
    _proto.flush()


MODELS = {
    # key: (repo, subfolder, default steps, flashvdm)
    "standard": ("tencent/Hunyuan3D-2", "hunyuan3d-dit-v2-0", 30, False),
    "turbo": ("tencent/Hunyuan3D-2", "hunyuan3d-dit-v2-0-turbo", 5, True),
    "mini": ("tencent/Hunyuan3D-2mini", "hunyuan3d-dit-v2-mini-turbo", 5, True),
}

_pipes = {}
_rembg = None


def ensure_model(repo, sub):
    """Download the model folder into HY3DGEN_MODELS with retries (resumes partial files)."""
    from huggingface_hub import snapshot_download

    target = os.path.join(os.environ.get("HY3DGEN_MODELS", os.path.expanduser("~/.cache/hy3dgen")), repo)
    folder = os.path.join(target, sub)
    if os.path.isdir(folder) and any(f.endswith(".safetensors") for f in os.listdir(folder)):
        return
    last = None
    for attempt in range(10):
        try:
            send(type="status", message="Downloading model (first run only, a few GB)…" if attempt == 0
                 else f"Connection dropped — resuming download (try {attempt + 1}/10)…")
            snapshot_download(repo_id=repo, allow_patterns=[f"{sub}/*"], local_dir=target, max_workers=4)
            return
        except Exception as e:  # network hiccups: back off and resume
            last = e
            print("download retry:", e)
            time.sleep(min(20, 2 + 2 * attempt))
    raise RuntimeError(f"Could not download {repo}/{sub}: {last}")


def get_pipe(key):
    if key in _pipes:
        return _pipes[key]
    # keep only one model in VRAM at a time
    for k in list(_pipes):
        del _pipes[k]
    import torch
    torch.cuda.empty_cache()
    from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline

    repo, sub, _, flash = MODELS[key]
    ensure_model(repo, sub)
    send(type="status", message=f"Loading {key} model onto the GPU…")
    pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(repo, subfolder=sub, use_safetensors=True, device="cuda")
    if flash:
        try:
            pipe.enable_flashvdm()
        except Exception as e:  # older hy3dgen
            print("flashvdm unavailable:", e)
    _pipes[key] = pipe
    return pipe


def generate(req):
    global _rembg
    import torch
    from PIL import Image

    t0 = time.time()
    img = Image.open(req["image"])
    if req.get("rembg", True):
        send(type="status", message="Removing background…")
        if _rembg is None:
            from hy3dgen.rembg import BackgroundRemover
            _rembg = BackgroundRemover()
        img = _rembg(img.convert("RGB"))
    else:
        img = img.convert("RGBA")

    key = req.get("model", "turbo")
    pipe = get_pipe(key)
    steps = int(req.get("steps") or MODELS[key][2])
    if MODELS[key][3]:
        steps = min(steps, 10)  # turbo models are distilled for few steps
    send(type="status", message="Generating shape on your GPU…")
    mesh = pipe(
        image=img,
        num_inference_steps=steps,
        octree_resolution=int(req.get("octree", 256)),
        num_chunks=20000,
        generator=torch.manual_seed(int(req.get("seed", 1234))),
        output_type="trimesh",
    )[0]
    send(type="status", message="Saving mesh…")
    mesh.export(req["out"])
    send(type="done", path=req["out"], faces=int(len(mesh.faces)), seconds=round(time.time() - t0, 1))


def main():
    send(type="ready")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            if req.get("cmd") == "generate":
                generate(req)
            elif req.get("cmd") == "ping":
                import torch
                send(type="done", cuda=torch.cuda.is_available(), name=torch.cuda.get_device_name(0))
        except Exception as e:
            send(type="error", message=str(e) or e.__class__.__name__, trace=traceback.format_exc()[-1500:])


if __name__ == "__main__":
    main()
