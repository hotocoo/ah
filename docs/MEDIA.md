# Image generation and 3D modelling

Both are available to the agent as tools (`generate_image`, `generate_3d`) when a backend exists, from the CLI (`ah image`, `ah 3d`) and in the web app.

## Images

Backend selection: `imageModel` in config (e.g. `comfyui/<checkpoint>`, `sdapi/<model>`, or any provider with an image API such as `openai/gpt-image-1`), else the first discovered local backend (ComfyUI with a checkpoint, then an sdapi server). If none exists the tool is not offered to the model.

- **ComfyUI**: `ah` builds a text-to-image graph from core nodes (`CheckpointLoaderSimple` → `CLIPTextEncode` ×2 → `EmptyLatentImage` → `KSampler` → `VAEDecode` → `SaveImage`), queues it with `POST /prompt`, polls `/history/{id}` and downloads from `/view`.
- **sdapi** (stable-diffusion.cpp `sd-server`, AUTOMATIC1111, Forge): `POST /sdapi/v1/txt2img`.
- **Provider APIs**: OpenAI-compatible `/images/generations`, Gemini image models and Imagen `:predict`.

Defaults (`image` in config): 1024×1024, 20 steps, CFG 7, `euler`/`normal`, a generic negative prompt.

```bash
ah image "isometric pixel-art server rack" -o rack.png --size 512x512
```

Note on Ollama: its experimental image generation was removed in v0.32.6+ while `/api/tags` still reports an `image` capability, so `ah` does not trust that flag.

## 3D models

**Procedural modelling** works with any chat model and no extra weights: the model designs the object as a scene of primitives (box, sphere, cylinder, cone, torus, plane, capsule with position, rotation, scale, colour), `ah` validates the scene against a schema (retrying with the error message when invalid), builds meshes with normals, and exports:

| format | notes |
|---|---|
| GLB | binary glTF 2.0, one node/mesh/PBR material per part |
| glTF | JSON with embedded base64 buffer |
| OBJ | vertex colours, normals |
| STL | binary, for 3D printing |

A PNG preview is rendered by a built-in software rasteriser (z-buffer, Lambert shading, 3/4 perspective view), and the scene JSON is saved next to the model so it can be edited and recompiled:

```bash
ah 3d "a wooden desk with a lamp" -o desk.glb          # designs with the default chat model
ah 3d --scene desk.scene.json -o desk.stl               # recompile an edited scene
```

The designer model is `model3d` in config, else the session's own model.

Image-to-3D servers (Hunyuan3D-2 `api_server.py`, TRELLIS.2 ports) have ad-hoc APIs; wiring one in is on the roadmap.
