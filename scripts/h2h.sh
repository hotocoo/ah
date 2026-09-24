#!/usr/bin/env bash
# Head-to-head: ah vs Hermes Agent vs DeepSeek Harness (dsh) on the same model, tasks and hidden graders.
# Run it yourself (it starts autonomous agents with full shell access inside bench sandboxes):
#   bash scripts/h2h.sh [--trials N] [--suite DIR] [--task ID]... [--only ah|hermes|dsh]
# Needs: a llama.cpp (or other OpenAI-compatible) server; BASE_URL defaults to http://127.0.0.1:8080/v1.
# Trials run one after another, never in parallel, so harnesses never share the server's slot.
set -euo pipefail
cd "$(dirname "$0")/.."

BASE_URL="${BASE_URL:-http://127.0.0.1:8080/v1}"
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

# The model is whatever the server is serving; nothing is hardcoded.
MODEL="$(curl -sf "$BASE_URL/models" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["data"][0]["id"] if d.get("data") else d["models"][0]["model"])')"
[ -n "$MODEL" ] || { echo "no model served at $BASE_URL" >&2; exit 2; }
STAMP="$(date +%Y-%m-%dT%H-%M-%S)"
OUT="${OUT:-examples/bench/h2h-$STAMP}"
mkdir -p "$OUT"
echo "model: $MODEL"; echo "out:   $OUT"

want() { [ -z "$ONLY" ] || [ "$ONLY" = "$1" ]; }

# ah: in-process, default features (memory and user extensions are off in every bench trial).
if want ah; then
  bun src/cli/main.ts bench run --model "llamacpp/$MODEL" --trials "$TRIALS" --out "$OUT/ah" ${PASS[@]+"${PASS[@]}"} 2>&1 | tee "$OUT/ah.log"
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
