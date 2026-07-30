import path from "node:path";
import { Document, Page, Text, View, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import type { ManualSection } from "@/lib/types";

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
});

function ManualDocument({
  title,
  sections,
}: {
  title: string;
  sections: ManualSection[];
}) {
  const today = new Date().toISOString().slice(0, 10);
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
            <Text style={styles.paragraph}>{s.content}</Text>
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
