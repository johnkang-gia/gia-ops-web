// 회의 녹음 파일을 텍스트로 바꾸는 용도로만 씁니다. Claude API는 아직 오디오 입력을 지원하지
// 않아서, 이 부분만 OpenAI의 음성 인식(STT) API를 별도로 사용합니다. 서버(Route Handler)에서만
// import 하세요 - OPENAI_API_KEY는 절대 클라이언트에 노출하면 안 됩니다.
export async function transcribeAudioWithOpenAI(audioBlob: Blob, filename: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY가 설정되어 있지 않습니다(Vercel 환경변수 확인).");
  }

  const form = new FormData();
  form.append("file", audioBlob, filename);
  // gpt-4o-mini-transcribe: OpenAI의 최신 음성 인식 모델 중 가장 저렴한 등급(분당 약 0.003달러).
  form.append("model", "gpt-4o-mini-transcribe");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
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
  if (!json.text) {
    throw new Error("음성 변환 응답에 텍스트가 없습니다.");
  }
  return json.text;
}
