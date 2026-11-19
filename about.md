Imports `.glb` / `.gltf` files **with their skeleton**. Blockbench's other glTF import turns bones into plain groups.

**Brings in**
- Armature and bones: names, hierarchy and rest pose
- Skinned meshes with their vertex weights
- Base colour textures with UVs
- Animations as bone rotation, position and scale keyframes

**Use:** File ▸ Import ▸ Import glTF with Armature... Set **Import Scale** to the Model Export Scale the file was exported with: 16 by default, 100 for 1 unit = 1 cm.

**Not imported:** vertex colours, morph targets, cameras and lights, and Draco- or meshopt-compressed files.
