ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGION="${AWS_REGION:-eu-central-1}"
DEMOS="$ROOT/evidence/demos.txt"

set_evidence() {
    mkdir -p "$(dirname "$DEMOS")"
    touch "$DEMOS"
    grep -v "^$1=" "$DEMOS" > "$DEMOS.tmp" || true
    echo "$1=$2" >> "$DEMOS.tmp"
    mv "$DEMOS.tmp" "$DEMOS"
    echo "$1=$2"
}

demo_output() {
    (cd "$ROOT/infra/demo" && PULUMI_BACKEND_URL="${PULUMI_BACKEND_URL:-file://$ROOT/.pulumi-aws}" pulumi stack output "$1" --stack demo)
}
