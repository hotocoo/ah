#!/usr/bin/env bash
# Head-to-head: ah vs Hermes Agent vs DeepSeek Harness (dsh) on the same model, tasks and hidden graders.
# Run it yourself (it starts autonomous agents with full shell access inside bench sandboxes):
#   bash scripts/h2h.sh [--trials N] [--suite DIR] [--task ID]... [--only ah|hermes|dsh]
# Needs: a local OpenAI-compatible runtime that ah discovers (ah doctor); override with MODEL_REF=provider/model.
# Trials run one after another, never in parallel, so harnesses never share the server's slot.
set -euo pipefail
cd "$(dirname "$0")/.."

TRIALS=3
ONLY=""
PASS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --trials) TRIALS="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    *) PASS+=("$1"); shift ;;
  esac
done

# Server and model come from ah's own discovery (the model it would auto-select, i.e. one already
# loaded in a local runtime) unless MODEL_REF=provider/model is given. Nothing is hardcoded.
read -r BASE_URL MODEL_REF < <(MODEL_REF="${MODEL_REF:-}" bun -e '
  const { buildEnvironment, autoSelectModel } = await import("./src/app/session.ts");
  const { parseModelRef } = await import("./src/config.ts");
  const env = await buildEnvironment({});
  const ref = process.env.MODEL_REF || env.cfg.defaultModel || autoSelectModel(env);
  if (!ref) { console.error("no local model found (ah doctor)"); process.exit(2); }
  const rt = env.registry.runtimes.get(parseModelRef(ref).provider);
  if (!rt) { console.error(`${ref} is not served by a local runtime`); process.exit(2); }
  console.log(`${rt.baseURL}/v1 ${ref}`);
  process.exit(0);
')
[ -n "${MODEL_REF:-}" ] || exit 2
MODEL="${MODEL_REF#*/}"
STAMP="$(date +%Y-%m-%dT%H-%M-%S)"
OUT="${OUT:-examples/bench/h2h-$STAMP}"
mkdir -p "$OUT"
echo "model: $MODEL"; echo "out:   $OUT"

want() { [ -z "$ONLY" ] || [ "$ONLY" = "$1" ]; }

# ah: in-process, default features (memory and user extensions are off in every bench trial).
if want ah; then
  bun src/cli/main.ts bench run --model "$MODEL_REF" --trials "$TRIALS" --out "$OUT/ah" ${PASS[@]+"${PASS[@]}"} 2>&1 | tee "$OUT/ah.log"
fi

# Hermes: isolated HERMES_HOME (no user memory, skills or cloud keys), custom provider at the same server.
if want hermes; then
  HH="$OUT/hermes-home"; mkdir -p "$HH"
  cat > "$HH/config.yaml" <<EOF
model:
  provider: custom
  base_url: $BASE_URL
  default: $MODEL
  api_key: local
toolsets:
  - hermes-cli
EOF
  bun src/cli/main.ts bench run --label hermes --trials "$TRIALS" --out "$OUT/hermes" ${PASS[@]+"${PASS[@]}"} \
    --agent-cmd "HERMES_HOME='$PWD/$HH' hermes -z {prompt} --in {dir} --yolo" 2>&1 | tee "$OUT/hermes.log"
fi

# dsh: headless profile with the user's own settings (its default model must be the same server's model).
if want dsh; then
  bun src/cli/main.ts bench run --label dsh --trials "$TRIALS" --out "$OUT/dsh" ${PASS[@]+"${PASS[@]}"} \
    --agent-cmd "cd {dir} && NODE_OPTIONS='--import file://$HOME/.dsh/net-timeouts.mjs' dsh --profile headless {prompt}" 2>&1 | tee "$OUT/dsh.log"
fi

for b in hermes dsh; do
  [ -f "$OUT/ah/results.json" ] && [ -f "$OUT/$b/results.json" ] && bun src/cli/main.ts bench compare "$OUT/$b/results.json" "$OUT/ah/results.json" | tee "$OUT/ah-vs-$b.md"
done
echo "done: $OUT"
