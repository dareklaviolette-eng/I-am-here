# Meshy model order desk (for I'M HERE XR agents)
1. Put the reference image in `meshy/inputs/` (PNG or JPG).
2. Add `meshy/requests/<name>.json`, e.g.
   `{ "image": "meshy/inputs/drone.png", "texture_prompt": "matte white scout drone, blue lights", "target_polycount": 30000 }`
3. Push to `prototype`. GitHub Actions orders the model from Meshy (secret MESHY_API_KEY) and commits
   `meshy/models/<name>.glb` plus `meshy/results/<name>.json`, usually 5–15 min later.
- **Daily cap:** 5 models (DAILY_CAP in .github/workflows/meshy.yml). The Meshy key also has its own monthly credit limit.
- **License:** generated on the founder's Meshy Pro plan; I'M HERE owns the output.
- To re-run a model, delete its results json.
