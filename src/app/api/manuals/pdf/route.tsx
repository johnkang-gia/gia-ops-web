import path from "node:path";
import { todayKst } from "@/lib/kst";
import { Document, Page, Text, View, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import type { ManualSection } from "@/lib/types";
import { htmlToPlainText } from "@/lib/manualHtml";

// 구글 문서를 대체하는 자체 PDF 매뉴얼 생성. 한글 표시를 위해 Pretendard 폰트를
// 프로젝트에 내장해서 등록합니다(원격 폰트 서버에 의존하지 않아 배포 환경에 관계없이 안정적으로 동작).
const FONT_DIR = path.join(process.cwd(), "src/assets/fonts");
let fontRegistered = false;
function ensureFontRegistered() {
  if (fontRegistered) return;
  Font.register({
    family: "Pretendard",
    fonts: [
      { src: path.join(FONT_DIR, "Pretendard-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "Pretendard-Bold.ttf"), fontWeight: 700 },
    ],
  });
  // 문장 중간에 한글이 잘리며 하이픈 처리가 되는 것을 방지(react-pdf 기본 줄바꿈 규칙 완화)
  Font.registerHyphenationCallback((word) => [word]);
  fontRegistered = true;
}

const styles = StyleSheet.create({
  page: { padding: 48, fontFamily: "Pretendard", fontSize: 10.5, lineHeight: 1.6, color: "#1a1a1a" },
  coverTitle: { fontSize: 26, fontWeight: 700, marginBottom: 8, textAlign: "center" },
  coverSubtitle: { fontSize: 11, color: "#666666", textAlign: "center", marginBottom: 4 },
  h2: { fontSize: 14, fontWeight: 700, marginTop: 18, marginBottom: 8, borderBottom: "1pt solid #cccccc", paddingBottom: 4 },
  paragraph: { marginBottom: 10, whiteSpace: "pre-wrap" },
  footer: { position: "absolute", bottom: 24, left: 48, right: 48, fontSize: 8, color: "#999999", textAlign: "center" },
  pageNumber: { position: "absolute", bottom: 24, right: 48, fontSize: 8, color: "#999999" },
  signatureBox: { marginTop: 6, marginBottom: 14, padding: 10, border: "1pt solid #cccccc", borderRadius: 4 },
  signatureLabel: { fontSize: 9, color: "#666666", marginBottom: 8 },
  signatureRow: { flexDirection: "row", marginBottom: 4 },
  signatureField: { flexDirection: "row", alignItems: "flex-end", marginRight: 20 },
  signatureFieldLabel: { fontSize: 9, color: "#444444", marginRight: 4 },
  signatureLine: { borderBottom: "0.75pt solid #999999", width: 90, height: 12 },
});

function ManualDocument({
  title,
  sections,
}: {
  title: string;
  sections: ManualSection[];
}) {
  const today = todayKst();
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.coverTitle}>{title}</Text>
        <Text style={styles.coverSubtitle}>GIA Micro Lab · 최종 정리일: {today}</Text>
        <Text
          fixed
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
        />
        <Text fixed style={styles.footer}>GIA · {title}</Text>

        {sections.length === 0 && (
          <Text style={styles.paragraph}>아직 발행된 내용이 없습니다.</Text>
        )}
        {sections.map((s) => (
          <View key={s.id} break={false}>
            <Text style={styles.h2}>{s.category}</Text>
            {/* 매뉴얼 내용은 리치 텍스트(HTML)로 저장되므로, PDF에는 태그 없이 읽기 좋은
                일반 텍스트로 변환해서 출력합니다(굵게 등 서식은 PDF에서는 생략). */}
            <Text style={styles.paragraph}>{htmlToPlainText(s.content)}</Text>
            {/* 앱에서 "서명 필요"로 표시한 항목은 종이로 배포했을 때 학부모가 바로 서명할 수
                있도록 PDF에 서명란을 자동으로 넣습니다(내부 인원만 쓰는 앱이라 전자서명 기능
                대신, 배포용 문서 자체에 서명란을 마련하는 방식을 씁니다). */}
            {s.requires_signature && (
              <View style={styles.signatureBox}>
                <Text style={styles.signatureLabel}>
                  ✍️ 위 내용을 확인하였으며 이에 동의합니다.
                </Text>
                <View style={styles.signatureRow}>
                  <View style={styles.signatureField}>
                    <Text style={styles.signatureFieldLabel}>학생명</Text>
                    <View style={styles.signatureLine} />
                  </View>
                  <View style={styles.signatureField}>
                    <Text style={styles.signatureFieldLabel}>보호자 성명</Text>
                    <View style={styles.signatureLine} />
                  </View>
                  <View style={styles.signatureField}>
                    <Text style={styles.signatureFieldLabel}>서명</Text>
                    <View style={styles.signatureLine} />
                  </View>
                  <View style={styles.signatureField}>
                    <Text style={styles.signatureFieldLabel}>날짜</Text>
                    <View style={styles.signatureLine} />
                  </View>
                </View>
              </View>
            )}
          </View>
        ))}
      </Page>
    </Document>
  );
}

export async function GET(request: Request) {
  ensureFontRegistered();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("로그인이 필요합니다.", { status: 401 });

  const { searchParams } = new URL(request.url);
  const doc = searchParams.get("doc") === "실무자용" ? "실무자용" : "학부모용";
  const title = doc === "학부모용" ? "GIA 운영계획안" : "GIA 실무자매뉴얼";

  const { data, error } = await supabase
    .from("manual_sections")
    .select("*")
    .eq("target_doc", doc)
    .order("category", { ascending: true });
  if (error) return new Response(error.message, { status: 500 });

  const buffer = await renderToBuffer(
    <ManualDocument title={title} sections={(data as ManualSection[]) ?? []} />
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${title}.pdf"`,
    },
  });
}
