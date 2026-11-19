# glTF Armature Importer for Blockbench

A Blockbench 5.2+ plugin that imports `.glb` / `.gltf` files **with their skeleton**: armature, bones, skin
weights, textures and animations. Without it, glTF files come into Blockbench with their bones as plain groups
and no weights, so rigged models can't be brought back in for editing.

## Install
1. Download [`gltf_armature_importer.js`](gltf_armature_importer.js) and keep `about.md` next to it (optional,
   it fills the plugin's About tab).
2. Blockbench (desktop): **File ▸ Plugins**, then **Load Plugin from File** and pick the `.js`. It loads and
   enables straight away, and Blockbench reloads it on every start.
3. Open or create a **Generic Model** project. The **File ▸ Import** menu only shows while a project is open.

## Use
1. **File ▸ Import ▸ Import glTF with Armature...**
2. Set **Import Scale** (units per metre) to the **Model Export Scale** the file was exported with.
   - **16** (default): Blockbench's default export scale. A default export re-imports 1:1, and a 1.8 m
     character comes in about 29 units tall.
   - **100**: use for models exported at 1 unit = 1 cm.
   - Files from Blender, Mixamo and similar are in metres. Pick whichever scale you want to work at.

   The scale applies to everything: vertices, bone rest positions, position keyframes and the skin's bind
   pose. The model stays correct at any value; only its size changes. A wrong value just gives a model
   that's too small or too big (scale 1 makes a doll-sized character).
3. Click **Confirm** and pick a `.glb` or `.gltf`.

If the open project isn't a format with armatures and meshes, the plugin opens a new Generic Model tab.

## What comes in
| glTF | Blockbench |
|---|---|
| Skin | One **armature** per skin. Skins that share bones are merged into one armature. |
| Joints | **Bones** with the same names (kept exactly, even `mixamorig:Hips`), hierarchy and rest pose (taken from the bind matrices). |
| Skinned mesh | A **mesh** inside the armature. JOINTS/WEIGHTS become **vertex weights** (up to 8 per vertex, normalised). |
| Mesh parented to a bone | A mesh in that armature, weighted 100% to that bone. |
| Other meshes | Root-level meshes, origin at the node's position. |
| Base colour texture | A **texture** with UVs mapped. |
| Animations | One **animation** per clip, with rotation, position and scale keys on each bone. STEP clips stay as Step keys; the rest use Linear. |

Pairs of triangles that form a flat quad become quads again, so loop cuts work. Untick **Rebuild quads** to keep the triangles.

## Tested
With Blockbench 5.2.2 on Windows:
- **Blockbench's own exports round-trip:** an armature with two bones and an animation comes back with the same
  hierarchy, weights and keyframes.
- **Blender-exported rigs:** 19 creature and character rigs (2 to 22 bones, 6 clips each, including scale
  squash-and-stretch and non-uniform parent scale), plus 11 unrigged props.
- **A Mixamo-rigged character:** 65 bones, names such as `mixamorig:Hips` kept exactly, and a 2048 px JPEG
  texture.
- **Textures:** the files in [`test-files/`](test-files): one textured, two-bone model stored three ways.
  - `tex_embedded.glb`: images inside the .glb.
  - `tex_datauri.gltf`: images written into the .gltf as data URIs.
  - `tex_external.gltf`: a separate `.bin` plus `checker.png` and `stripes b.png`.

  In each, both images arrive byte-identical, each face gets the right texture and every corner keeps its UV.

Every rig was also checked offline with the scripts in [`tests/`](tests). They pose the import result with
Blockbench's rules and compare it, vertex by vertex, with the glTF's own skinning at every keyframe. The
difference was under 0.0001 units. Between keyframes it stays under 0.02 units, because Blockbench blends Euler
angles where glTF blends quaternions.

## Limitations
- **Loop setting:** glTF doesn't store it. Clips import as **Play Once**, except names ending in `-loop` or `_loop`.
- **Interpolation:** CUBICSPLINE curves import as Linear keys at the same times. Shapes between keys can differ slightly.
- **Keyframe density:** baked animations (Blender, Mixamo) keep one key per frame per bone. They play correctly but are dense to edit.
- **Rest pose:** comes from the skin's bind matrices. If a file's node rest pose differs from its bind pose, animations still play correctly, because keys are made relative to the bind pose.
- **Texture size:** with **Embed Textures** on, Blockbench's exporter pads any texture whose size isn't a
  power of two up to the next one (48×48 becomes 64×64, image top-left) and shrinks the UVs to match. Such a
  texture imports at the padded size with an empty margin. It still lines up.
- **Bone length and width:** glTF has no bone tails. Lengths are guessed from child positions; leaf bones copy their parent's length. This only affects how bones look.
- **Bone names:** kept exactly as in the file. Renaming a bone inside Blockbench applies its own character rules (letters, digits, `_`).
- **Vertex colours** (`COLOR_0`) aren't imported: Blockbench meshes can't store them. Models coloured only that
  way come in untextured; the shape, bones and animations are unaffected.
- **Not imported:** morph targets/shape keys, material colours without a texture, metal/roughness/normal maps, cameras and lights, animated non-bone objects, and a mesh's own origin/rotation for skinned meshes (it's baked into the vertices, as Blockbench's exporter does).
- **Not supported:** Draco- or meshopt-compressed files (re-export uncompressed), and loose `.gltf` + `.bin` files in the web version (use `.glb`). The plugin is desktop-only.

## Credits
Written with the help of an AI coding assistant (Claude), and tested as described above. Issues and pull
requests are welcome.

## License
[MIT](LICENSE)
