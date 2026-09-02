import fs from "node:fs";
import path from "node:path";
import { Font } from "@react-pdf/renderer";

// PDF 한글 글꼴.
//
// 글꼴 파일을 **경로로** 읽습니다. 코드에서 import 하지 않는 파일이라 배포본에서 빠지기 쉽고,
// 빠지면 PDF를 만들다 통째로 실패합니다 - 로컬에서는 잘 되는데 실제 배포에서만 500이 나는,
// 알아채기 어려운 종류의 고장입니다(운행일지 PDF가 그랬습니다).
//
// 그래서 두 가지를 합니다.
//   · next.config 의 outputFileTracingIncludes 로 배포본에 넣습니다.
//   · 그래도 없으면 **그 사실을 말합니다.** 조용히 넘기면 글자가 네모로 나간 종이를 학부모나
//     기사님이 받게 됩니다.

const CANDIDATES = [
  path.join(process.cwd(), "src/assets/fonts"),
  path.join(process.cwd(), ".next/server/src/assets/fonts"),
  path.join(process.cwd(), "assets/fonts"),
];

let registered = false;

/** 글꼴을 준비합니다. 파일을 못 찾으면 그 경로들을 담은 오류를 던집니다. */
export function ensureKoreanFont(): void {
  if (registered) return;
  const dir = CANDIDATES.find((d) => fs.existsSync(path.join(d, "Pretendard-Regular.ttf")));
  if (!dir) {
    throw new Error(
      `한글 글꼴 파일을 찾지 못했습니다. 확인한 자리: ${CANDIDATES.join(" · ")}`,
    );
  }
  Font.register({
    family: "Pretendard",
    fonts: [
      { src: path.join(dir, "Pretendard-Regular.ttf"), fontWeight: 400 },
      { src: path.join(dir, "Pretendard-Bold.ttf"), fontWeight: 700 },
    ],
  });
  // 한국어는 단어 중간에서 끊지 않습니다. 이걸 빼면 이름이 두 줄로 갈라집니다.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

/**
 * 파일 이름을 담은 `content-disposition` 헤더.
 *
 * **HTTP 헤더에는 한글을 그대로 넣을 수 없습니다.** 넣으면 응답을 만드는 순간
 * `Cannot convert argument to a ByteString` 으로 터지고, 화면에는 아무것도 안 뜹니다 -
 * 운행일지 PDF가 이것 때문에 통째로 안 나오고 있었습니다.
 *
 * 그래서 두 벌을 함께 보냅니다.
 *   · `filename=` — 영문·숫자만 남긴 이름(오래된 브라우저용)
 *   · `filename*=UTF-8''…` — 퍼센트로 감싼 한글 이름(요즘 브라우저가 이것을 씁니다)
 */
export function pdfDisposition(name: string, mode: "inline" | "attachment" = "inline"): string {
  const safe = name.replace(/[^\w.\-]+/g, "_").replace(/^_+|_+$/g, "") || "document";
  return `${mode}; filename="${safe}.pdf"; filename*=UTF-8''${encodeURIComponent(`${name}.pdf`)}`;
}
