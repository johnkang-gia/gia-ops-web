"use client";

import { createPortal } from "react-dom";

// 새로 들어온 기능이 많아지면서(빠른등록/칸반/채팅/업무기록 등) 처음 쓰는 사람은 뭐가 뭔지
// 헷갈릴 수 있어, 화면 우상단 ❓ 아이콘을 누르면 각 영역 사용법을 요약해 보여주는 팝업입니다
// (요청 #7). 별도 라우트 없이 그냥 모달로만 띄웁니다.
const SECTIONS: { title: string; lines: string[] }[] = [
  {
    title: "🖥️ 화면 구성 - 세 칸",
    lines: [
      "가장 많이 쓰는 💬 등록·채팅이 가운데에 가장 넓게 있습니다. 왼쪽 📥 인박스에서 들어온 것을 받고, 가운데에서 등록·소통하고, 오른쪽 🔀 흐름판에서 진행상황을 훑어봅니다.",
      "흐름판은 카드를 드래그해 상태를 옮기는 현황판이라 좁은 칸이면 충분합니다 - 예정→진행중→완료가 위에서 아래로 쌓입니다.",
      "칸 사이 회색 경계선을 마우스로 끌면 폭이 바뀝니다. 머리글의 ✕를 누르면 그 칸이 세로 막대로 접히고, 가운데 등록·채팅이 그만큼 넓어집니다.",
      "바꾼 폭과 접어둔 상태는 이 브라우저에 기억되어 다음에 들어와도 그대로입니다. 좁은 기기(휴대폰·태블릿)에서는 세 칸이 탭으로 바뀝니다.",
    ],
  },
  {
    title: "📥 인박스 - 들어오는 것",
    lines: [
      "학부모 문의 · 출결내역 · 출결알림 · 선생님요청을 한 곳에서 받습니다. 예전에는 화면 곳곳에 흩어져 있어 무엇을 확인해야 하는지 한눈에 안 보였습니다.",
      "탭의 빨간 숫자는 아직 처리하지 않은 건수입니다. 다른 탭을 보고 있어도 새 요청이 오면 숫자가 올라갑니다.",
      "각 항목의 [→업무등록]을 누르면 그 내용 그대로 업무 카드가 만들어져 가운데 흐름판으로 넘어갑니다.",
    ],
  },
  {
    title: "🔀 업무 흐름판 - 처리하는 곳",
    lines: [
      "진행대기 → 진행중 → 완료 3단계가 항상 보이고, 카드를 끌어다 놓거나 눌러서 상태를 옮깁니다.",
      "머리글의 [🙋 내 업무만 | 🗂️ 전체]로 내가 태그된 업무만 볼지 부서 전체를 볼지 고릅니다. 옆의 '진행 N건'은 지금 보고 있는 기준의 미완료 건수입니다.",
      "보류/이슈는 아래 '⏸️ 보류/이슈' 버튼을 눌러야 펼쳐집니다. 상태를 '보류'로 바꾸면 단순 보류인지 이슈(메모 필요)인지 물어봅니다.",
      "담당자로 태그된 업무는 카드의 체크박스로 '확인'을 남길 수 있습니다.",
    ],
  },
  {
    title: "💬 소통 - 이야기하는 곳",
    lines: [
      "맨 위 📌 부서 메모는 팀 전체가 함께 고쳐 쓰는 메모입니다. 잠깐 멈추면 자동 저장됩니다.",
      "그 아래 빠른 업무등록에서 나 / 전체 / 공유로 담당자를 정해 바로 카드를 만듭니다. '내일까지'처럼 문장 안에 쓴 마감 표현도 자동으로 인식됩니다.",
      "부서 채팅은 파일 첨부 · 답장 · 반응(이모지) · 고정 · 검색을 지원합니다.",
    ],
  },
  {
    title: "📢 전체공지 · 🗂 지난 업무 · 🗑 휴지통",
    lines: [
      "전체공지는 부서 줄 바로 아래 배너로 뜹니다. 다 읽으면 각자 접어둘 수 있고, 접어도 다른 사람 화면에는 그대로 보입니다. 지난 공지는 배너 오른쪽 위 히스토리 아이콘에 모여 있습니다.",
      "완료한 업무는 다음날 밤 자동으로 [지난 업무]로 옮겨져 연도 · 학기 · 날짜별로 쌓입니다. 삭제한 업무는 [휴지통]에서 7일 안에 되살릴 수 있습니다. 둘 다 화면 맨 위 대분류 탭에서 바로 갑니다.",
      "업무 삭제는 등록자 본인 또는 관리자만 할 수 있습니다. 상세 화면의 📅 버튼으로 마감을 내 기기 캘린더에 넣을 수 있습니다.",
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
