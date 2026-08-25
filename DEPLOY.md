# 배포 순서 (반드시 main 먼저)

```bash
# 1) 검증
npx tsc --noEmit && npm run build

# 2) 버전 올리기 (package.json + src/lib/version.ts + CHANGELOG.md 세 곳 모두)
#    package-lock.json의 version도 함께 맞춥니다:
npm install --package-lock-only --ignore-scripts

# 3) 배포 — main 먼저!
git checkout main
git add -A && git commit -m "vX.Y.Z - 설명"
git push origin main          # ← Vercel Production 빌드가 여기서 생성됩니다

# 4) staging 동기화 (main을 따라가기만 함)
git checkout staging
git merge --ff-only main
git push origin staging
```

## 왜 main을 먼저 푸시해야 하나

예전에는 `staging → main(fast-forward)` 순서로 올렸습니다. 이 경우 **두 브랜치가 완전히 같은
커밋 SHA**가 되는데, Vercel은 이미 빌드한 SHA를 다시 빌드하지 않습니다. 그래서

1. staging 푸시 → 그 SHA로 **Preview** 배포 생성
2. main 푸시(같은 SHA) → "이미 빌드함"으로 **Production 배포가 생성되지 않음**

이 되어, 프로덕션 화면이 계속 한 버전씩 뒤처졌습니다(실제로 v0.230~v0.233이 프로덕션에
반영되지 않았습니다). **새 SHA를 main이 가장 먼저 보게** 하면 Production 빌드가 항상
생성되고, 뒤이은 staging 푸시는 중복이라 건너뛰어도 문제가 없습니다.

## 배포 확인법

Vercel → Deployments 맨 윗줄에서 두 가지를 봅니다.

- `Branch: main` + **Production** 라벨인지 (staging이면 Preview라 프로덕션에 반영 안 됨)
- Commit 해시가 방금 푸시한 것과 같은지

빌드 로그 안의 `> gia-ops-web@X.Y.Z build` 줄에 실제 배포되는 버전이 찍힙니다. 앱 사이드바
하단 `🏷️ vX.Y.Z` 배지와 이 값이 같아야 정상입니다.

## 참고

- `package-lock.json`의 version이 package.json과 어긋나면 `npm ci`가 실패합니다. 버전을 올릴
  때 `npm install --package-lock-only`를 함께 돌려주세요.
- 빌드 로그의 `npm warn deprecated`, `npm warn allow-scripts sharp@...` 는 경고일 뿐
  실패 원인이 아닙니다.
