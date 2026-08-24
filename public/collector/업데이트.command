#!/bin/bash
# GIA 토들 픽업 수집기 - 자동 업데이트 (맥용)
#
# 더블클릭하면 이 폴더의 파일들을 최신으로 바꿉니다. 폴더를 다시 옮길 필요가 없고,
# 새 폴더가 생기지도 않습니다(같은 자리에 덮어씁니다).
#
# 처음 한 번만 운영앱 주소를 물어보고, 그 뒤로는 기억합니다.

cd "$(dirname "$0")" || exit 1

echo "════════════════════════════════════════"
echo "  GIA 토들 픽업 수집기 업데이트"
echo "════════════════════════════════════════"
echo

# ── 운영앱 주소 ──────────────────────────────────────────────────────────────
if [ -f ".server" ]; then
  SERVER=$(cat .server)
else
  echo "운영앱 주소를 알려주세요."
  echo "예: https://gia-ops-web.vercel.app"
  read -r -p "주소: " SERVER
  SERVER="${SERVER%/}"
  if [ -z "$SERVER" ]; then
    echo "주소가 비어 있어 중단합니다."
    read -r -p "엔터를 누르면 닫힙니다..."
    exit 1
  fi
  echo "$SERVER" > .server
fi
echo "서버: $SERVER"
echo

BASE="$SERVER/collector"

# ── 받을 파일 목록 ───────────────────────────────────────────────────────────
# 목록 자체를 서버에서 받아옵니다. 나중에 파일이 늘어나도 이 스크립트를 고칠 필요가 없습니다.
echo "파일 목록을 확인하는 중..."
LIST=$(curl -fsSL "$BASE/files.json" 2>/dev/null)
if [ -z "$LIST" ]; then
  echo "❌ 서버에 연결하지 못했습니다."
  echo "   주소가 맞는지 확인해주세요. 주소를 바꾸시려면 이 폴더의 .server 파일을 지우고 다시 실행하세요."
  read -r -p "엔터를 누르면 닫힙니다..."
  exit 1
fi

# python3는 맥에 기본으로 있습니다(Command Line Tools). 없으면 아래 grep 방식으로 넘어갑니다.
FILES=$(printf '%s' "$LIST" | python3 -c "import sys,json; print('\n'.join(json.load(sys.stdin)['files']))" 2>/dev/null)
if [ -z "$FILES" ]; then
  FILES=$(printf '%s' "$LIST" | grep -o '"[^"]*\.\(json\|js\|html\|md\|command\|bat\)"' | tr -d '"')
fi

# ── 내려받기 ─────────────────────────────────────────────────────────────────
# 임시 폴더에 먼저 다 받고, 전부 성공했을 때만 덮어씁니다. 중간에 끊겨서 반쪽짜리 확장이
# 남는 것이 가장 나쁩니다.
TMP=$(mktemp -d)
OK=1
while IFS= read -r f; do
  [ -z "$f" ] && continue
  printf "  %s ... " "$f"
  if curl -fsSL "$BASE/$f" -o "$TMP/$f" 2>/dev/null; then
    echo "받음"
  else
    echo "실패"
    OK=0
  fi
done <<< "$FILES"

if [ "$OK" -ne 1 ]; then
  echo
  echo "❌ 일부 파일을 받지 못해 업데이트하지 않았습니다(기존 파일은 그대로입니다)."
  rm -rf "$TMP"
  read -r -p "엔터를 누르면 닫힙니다..."
  exit 1
fi

cp "$TMP"/* . 2>/dev/null
rm -rf "$TMP"
chmod +x "업데이트.command" 2>/dev/null

echo
echo "✅ 업데이트를 마쳤습니다."
echo
echo "마지막 한 단계가 남았습니다:"
echo "  크롬 주소창에 chrome://extensions 를 치고,"
echo "  \"GIA 토들 픽업 수집기\" 카드의 🔄 새로고침 아이콘을 눌러주세요."
echo "  (크롬을 껐다 켜셔도 됩니다)"
echo
read -r -p "엔터를 누르면 닫힙니다..."
