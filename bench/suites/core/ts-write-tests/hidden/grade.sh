set -e
# 1. the agent's tests must pass on the correct implementation
bun test src/slugify.test.ts
cp src/slugify.ts /tmp/slug.orig.$$
killed=0; total=0
for m in mutants/*.ts; do
  total=$((total+1)); cp "$m" src/slugify.ts
  if ! bun test src/slugify.test.ts >/dev/null 2>&1; then killed=$((killed+1)); fi
done
cp /tmp/slug.orig.$$ src/slugify.ts
echo "mutants killed: $killed/$total"
# 2. must kill at least 4 of 5 mutants
[ "$killed" -ge 4 ]
