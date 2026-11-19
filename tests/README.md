# Offline tests (Node 18+)

Run from the repository root.

```sh
# Pose the import result with Blockbench's rules and compare it with glTF skinning at every keyframe.
# Optional: SCALE=100 (default 16); -v prints bones and keys.
node tests/verify_skinning.js ./gltf_armature_importer.js path/to/rigged.glb

# Rebuild the textured test files, then check images, texture assignment and UVs in all three storage types.
node tests/make_textured.js test-files
node tests/verify_textures.js ./gltf_armature_importer.js test-files
```

`make_textured.js` also writes `expected.json`, which `verify_textures.js` reads.
