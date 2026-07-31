// 회의 녹음 파일을 텍스트로 바꾸는 용도로만 씁니다. Claude API는 아직 오디오 입력을 지원하지
// 않아서, 이 부분만 별도 음성 인식(STT) API를 씁니다. Groq는 Whisper 모델을 무료 티어로
// 제공합니다(신용카드 등록 없이 가입, 하루 2,000건/시간당 오디오 7,200초까지 무료 - 학교
// 회의록 용도로는 충분합니다). 서버(Route Handler)에서만 import 하세요 - GROQ_API_KEY는
// 절대 클라이언트에 노출하면 안 됩니다.

// 회의에서 자주 나오는 고유명사/용어를 미리 알려주면(Whisper의 prompt 파라미터) 인식률이
// 눈에 띄게 좋아집니다(특히 학교 고유 용어, 직함처럼 일반 모델이 잘 못 알아듣는 단어).
const DEFAULT_PROMPT =
  "GIA국제학교(GIA Micro Lab) 행정 회의록입니다. 부이사장님, 실장님, 부장님, 담임, 부담임, " +
  "학부모, 플리마켓, 캠프, 부스, 구글폼, 공문, 실무자매뉴얼, 운영계획안, 학기 같은 표현이 " +
  "자주 나옵니다.";

export async function transcribeAudioWithGroq(
  audioBlob: Blob,
  filename: string,
  opts?: { language?: string; prompt?: string }
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY가 설정되어 있지 않습니다(Vercel 환경변수 확인).");
  }

  const form = new FormData();
  form.append("file", audioBlob, filename);
  // whisper-large-v3(전체 모델)이 -turbo보다 인식률이 좋습니다. 무료 티어 한도는 두 모델이
  // 동일해서(하루 2,000건) turbo를 쓸 이유가 없습니다.
  form.append("model", "whisper-large-v3");
  // 언어를 명시하면 자동감지보다 정확도가 올라갑니다(특히 아주 짧은 구간에서는 자동감지가
  // 흔들릴 수 있습니다). GIA 회의는 기본적으로 한국어로 진행된다고 가정합니다.
  form.append("language", opts?.language ?? "ko");
  form.append("prompt", opts?.prompt ?? DEFAULT_PROMPT);

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  const raw = await response.text();
  let json: { text?: string; error?: { message?: string } };
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`음성 변환 응답을 해석할 수 없습니다(코드 ${response.status}): ${raw.slice(0, 300)}`);
  }
  if (!response.ok || json.error) {
    throw new Error(`음성 변환 오류: ${json.error?.message || raw.slice(0, 300)}`);
  }
  // 조용한 구간(침묵)만 있으면 빈 문자열이 정상 응답일 수 있으므로, 필드 자체가 없을 때만 오류로
  // 취급합니다.
  if (typeof json.text !== "string") {
    throw new Error("음성 변환 응답에 텍스트가 없습니다.");
  }
  return json.text;
}
