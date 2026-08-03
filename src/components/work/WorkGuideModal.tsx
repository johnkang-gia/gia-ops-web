"use client";

import { createPortal } from "react-dom";

// 새로 들어온 기능이 많아지면서(빠른등록/칸반/채팅/업무기록 등) 처음 쓰는 사람은 뭐가 뭔지
// 헷갈릴 수 있어, 화면 우상단 ❓ 아이콘을 누르면 각 영역 사용법을 요약해 보여주는 팝업입니다
// (요청 #7). 별도 라우트 없이 그냥 모달로만 띄웁니다.
const SECTIONS: { title: string; lines: string[] }[] = [
  {
    title: "🏷️ 빠른 업무등록 위젯",
    lines: [
      "나 / 전체 / 공유 뱃지로 담당자를 정합니다 - 나: 내 업무, 전체: 부서원 전원, 공유: 직접 고른 사람들.",
      "오늘·내일·이번주 뱃지를 누르거나, 날짜·시간을 직접 입력해 마감을 정할 수 있습니다.",
      "문장에 '내일까지'처럼 마감 표현을 써도 자동으로 인식됩니다.",
      "각 뱃지 옆 색상 점은 관리자가 클릭해 색을 바꿀 수 있고, 그 색이 업무카드 테두리에도 그대로 쓰입니다.",
    ],
  },
  {
    title: "💬 채팅",
    lines: [
      "부서원과 실시간으로 대화합니다. 파일 첨부, 답장, 반응(이모지), 메시지 고정/검색을 지원합니다.",
      "채팅 입력창 위 서식 아이콘으로 굵게·기울임·취소선·코드 서식을 바로 넣을 수 있습니다.",
    ],
  },
  {
    title: "📋 업무 칸반보드",
    lines: [
      "진행대기 → 진행중 → 완료 3단계가 항상 위에 보이고, 카드를 드래그하거나 클릭해 상태를 옮길 수 있습니다.",
      "보류/이슈는 아래 '⏸️ 보류/이슈' 버튼을 눌러야 펼쳐집니다. 업무를 클릭해 상태를 '보류'로 바꾸면 단순 보류인지 이슈(메모 필요)인지 물어봅니다.",
      "이슈 메모는 업무를 공유하는 모두에게 보이고, 작성자도 함께 표시됩니다.",
      "담당자로 태그된 업무는 카드의 체크박스로 '확인'을 남길 수 있습니다.",
    ],
  },
  {
    title: "🗂 업무기록",
    lines: [
      "완료된 업무는 다음날 밤 자동으로 업무기록으로 옮겨져, 연도 · 학기 · 날짜별로 모아 볼 수 있습니다.",
      "우상단 '🗂 업무기록' 아이콘을 눌러 이동합니다.",
    ],
  },
  {
    title: "🗑 삭제 / 📅 캘린더",
    lines: [
      "업무 삭제는 등록자 본인 또는 관리자만 할 수 있습니다.",
      "업무 상세패널의 📅 버튼을 누르면 마감 일정을 내 기기의 기본 캘린더 앱에 추가할 수 있습니다.",
    ],
  },
];

export default function WorkGuideModal({ onClose }: { onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-4 py-3">
          <span className="text-sm font-bold text-slate-800">❓ 업무 페이지 사용 가이드</span>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-100">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="flex flex-col gap-4">
            {SECTIONS.map((section) => (
              <div key={section.title}>
                <div className="mb-1 text-[13px] font-bold text-slate-700">{section.title}</div>
                <ul className="flex flex-col gap-1">
                  {section.lines.map((line, i) => (
                    <li key={i} className="text-[12px] leading-relaxed text-slate-500">
                      · {line}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
